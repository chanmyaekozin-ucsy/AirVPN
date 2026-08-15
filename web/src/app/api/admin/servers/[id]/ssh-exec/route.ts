import { NextRequest } from "next/server";
import type { Client as SshClient, ConnectConfig } from "ssh2";
import { jsonError, requireAdmin } from "@/lib/auth";
import { readStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

type Action = "restart" | "status";

type StreamEvent =
  | { type: "log"; line: string }
  | { type: "status"; phase: string }
  | { type: "done"; exitCode: number }
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
  onData: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        onData(`(exec error: ${err.message})`);
        return resolve(1);
      }
      let code = 0;
      stream
        .on("close", (c: number) => { code = c ?? 0; resolve(code); })
        .on("data", (d: Buffer) => {
          const text = d.toString("utf8").trimEnd();
          if (text) onData(text);
        });
      stream.stderr.on("data", (d: Buffer) => {
        const text = d.toString("utf8").trimEnd();
        if (text) onData(text);
      });
    });
  });
}

const CMDS: Record<Action, string> = {
  restart: "systemctl restart x-ui 2>&1 && systemctl status x-ui --no-pager -l 2>&1 | head -30",
  status:  "systemctl status x-ui --no-pager -l 2>&1 | head -40",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return Response.json({ error: msg }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    ip?: string;
    password?: string;
  };

  const action = (body.action ?? "restart") as Action;
  if (!CMDS[action]) {
    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const store = await readStore();
  const server = store.servers.find((s) => s.id === id);
  if (!server) return Response.json({ error: "Server not found." }, { status: 404 });

  const ip = String(body.ip ?? server.host ?? "").trim();
  const password = String(body.password ?? "");
  if (!ip || !password) {
    return Response.json({ error: "IP and root password are required." }, { status: 400 });
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
          host: ip, port: 22, username: "root", password,
          readyTimeout: 20_000, hostVerifier: () => true,
        });

        send({ type: "status", phase: "running" });
        send({ type: "log", line: `Running: ${action}` });
        const exitCode = await sshExec(conn, CMDS[action], (line) =>
          send({ type: "log", line }),
        );
        send({ type: "done", exitCode });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "SSH error";
        send({ type: "error", message: msg });
      } finally {
        conn?.end();
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
