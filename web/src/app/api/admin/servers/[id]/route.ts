import { NextRequest } from "next/server";
import type { Client as SshClient, ConnectConfig } from "ssh2";
import { requireAdmin } from "@/lib/auth";
import { updateStore } from "@/lib/store";
import { forgetHostKey, tofuHostVerifier } from "@/lib/ssh-hosts";

export const runtime = "nodejs";
export const maxDuration = 120;

type StreamEvent =
  | { type: "log"; line: string }
  | { type: "status"; phase: string }
  | { type: "done" }
  | { type: "error"; message: string };

function sshConnect(cfg: ConnectConfig): Promise<SshClient> {
  return import("ssh2").then(
    ({ Client }) =>
      new Promise<SshClient>((resolve, reject) => {
        const conn = new Client();
        conn
          .on("ready", () => resolve(conn as SshClient))
          .on("error", reject)
          .connect(cfg);
      }),
  );
}

function sshExec(
  conn: SshClient,
  cmd: string,
  onData?: (line: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        onData?.(`(exec error: ${err.message})`);
        return resolve();
      }
      stream
        .on("close", () => resolve())
        .on("data", (d: Buffer) => {
          const text = d.toString("utf8").trimEnd();
          if (text) onData?.(text);
        });
      stream.stderr.on("data", (d: Buffer) => {
        const text = d.toString("utf8").trimEnd();
        if (text) onData?.(text);
      });
    });
  });
}

async function removeServerRecord(id: string) {
  await updateStore((store) => {
    const idx = store.servers.findIndex((s) => s.id === id);
    if (idx !== -1) {
      store.servers.splice(idx, 1);
      store.plans = store.plans.filter((p) => p.serverId !== id);
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    const status =
      typeof err === "object" && err && "status" in err
        ? Number((err as { status: number }).status)
        : 401;
    return Response.json({ error: message }, { status });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    mode?: "record" | "uninstall";
    ip?: string;
    password?: string;
  };
  const mode = body.mode === "uninstall" ? "uninstall" : "record";

  // ── Record-only delete ─────────────────────────────────────────────────────
  if (mode === "record") {
    await removeServerRecord(id);
    return Response.json({ ok: true });
  }

  // ── Uninstall mode (streaming) ─────────────────────────────────────────────
  const ip = String(body.ip ?? "").trim();
  const password = String(body.password ?? "");
  if (!ip || !password) {
    return Response.json(
      { error: "IP and root password are required to uninstall." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      let conn: SshClient | null = null;
      try {
        send({ type: "status", phase: "connecting" });
        send({ type: "log", line: `Connecting to root@${ip}…` });

        conn = await sshConnect({
          host: ip,
          port: 22,
          username: "root",
          password,
          readyTimeout: 30_000,
          hostVerifier: tofuHostVerifier(`${ip}:22`).verify,
        });

        const log = (line: string) => send({ type: "log", line });

        send({ type: "status", phase: "uninstalling" });
        send({ type: "log", line: "Stopping x-ui service…" });
        await sshExec(conn, "systemctl stop x-ui 2>/dev/null || true", log);

        send({ type: "log", line: "Running x-ui uninstaller…" });
        await sshExec(
          conn,
          // Try the built-in uninstall command first, then fall back to re-downloading installer
          "if command -v x-ui >/dev/null 2>&1; then" +
            "  echo y | x-ui uninstall 2>/dev/null || true;" +
            "fi;" +
            "systemctl disable x-ui 2>/dev/null || true",
          log,
        );

        send({ type: "log", line: "Removing x-ui files…" });
        await sshExec(
          conn,
          "rm -rf /usr/local/x-ui /etc/x-ui /var/log/x-ui* " +
            "/usr/bin/x-ui /lib/systemd/system/x-ui.service " +
            "/tmp/airvpn-* 2>/dev/null || true;" +
            "systemctl daemon-reload 2>/dev/null || true",
          log,
        );

        send({ type: "log", line: "✓ 3x-ui uninstalled from VPS." });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "SSH connection failed";
        send({ type: "log", line: `⚠ SSH error: ${msg}` });
        send({ type: "log", line: "Removing server record anyway…" });
      } finally {
        conn?.end();
        // Server is gone — drop its host-key pin so a rebuilt VPS can be re-pinned.
        forgetHostKey(`${ip}:22`);
      }

      // Always remove the store record after uninstall attempt
      try {
        send({ type: "status", phase: "removing" });
        await removeServerRecord(id);
        send({ type: "log", line: "✓ Server record removed." });
        send({ type: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Store update failed";
        send({ type: "error", message: msg });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
