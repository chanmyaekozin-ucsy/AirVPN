import { readFileSync } from "fs";
import path from "path";
import { Client, type ConnectConfig } from "ssh2";
import { tofuHostVerifier } from "./ssh-hosts";

export type ProvisionMode = "fresh" | "reuse" | "auto";

export type ProvisionInput = {
  ip: string;
  password: string;
  sshUser?: string;
  mode: ProvisionMode;
  serverId: string;
  name: string;
  nameMy?: string;
  region: string;
  sni?: string;
  panelUser?: string;
  panelPass?: string;
  panelUrl?: string;
  reuseInboundId?: string;
  vlessPort?: string;
  panelPort?: string;
  onLog?: (line: string) => void;
};

export type ProvisionResult = Record<string, unknown>;

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function connect(cfg: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", reject)
      .connect(cfg);
  });
}

function exec(
  conn: Client,
  command: string,
  onData?: (chunk: string) => void,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code: number) => resolve({ code: code ?? 0, stdout, stderr }))
        .on("data", (d: Buffer) => {
          const text = d.toString("utf8");
          stdout += text;
          onData?.(text);
        });
      stream.stderr.on("data", (d: Buffer) => {
        const text = d.toString("utf8");
        stderr += text;
        onData?.(text);
      });
    });
  });
}

function sftpWrite(conn: Client, remotePath: string, contents: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remotePath);
      stream.on("error", reject);
      stream.on("close", () => resolve());
      stream.end(contents);
    });
  });
}

function parseResult(log: string): ProvisionResult {
  const match = log.match(/AIRVPN_RESULT_BEGIN\n([\s\S]*?)\nAIRVPN_RESULT_END/);
  if (!match?.[1]) {
    throw new Error("Provisioning finished but no AIRVPN_RESULT was returned. Check VPS logs.");
  }
  return JSON.parse(match[1].trim()) as ProvisionResult;
}

/** SSH into a VPS, run remote-bootstrap.sh, return the node JSON. */
export async function provisionVps(input: ProvisionInput): Promise<ProvisionResult> {
  const ip = input.ip.trim();
  const password = input.password;
  if (!ip || !password) throw new Error("IP and password are required.");
  if (!input.serverId.trim()) throw new Error("Server id is required.");

  const bootstrapPath = path.join(process.cwd(), "scripts", "remote-bootstrap.sh");
  const bootstrap = readFileSync(bootstrapPath);

  const log = input.onLog || (() => undefined);
  log(`Connecting to root@${ip}…`);

  const conn = await connect({
    host: ip,
    port: 22,
    username: input.sshUser || "root",
    password,
    readyTimeout: 30_000,
    // TOFU: pin the host key on first connect, reject changes afterwards.
    hostVerifier: tofuHostVerifier(`${ip}:22`).verify,
  });

  try {
    const remotePath = `/tmp/airvpn-remote-bootstrap-${Date.now()}.sh`;
    log("Uploading bootstrap script…");
    await sftpWrite(conn, remotePath, bootstrap);
    await exec(conn, `chmod +x ${shellQuote(remotePath)}`);

    const envExports = [
      `AIRVPN_SERVER_ID=${shellQuote(input.serverId.trim())}`,
      `AIRVPN_SERVER_NAME=${shellQuote(input.name.trim())}`,
      `AIRVPN_SERVER_NAME_MY=${shellQuote((input.nameMy || input.name).trim())}`,
      `AIRVPN_REGION=${shellQuote(input.region.trim().toUpperCase() || "US")}`,
      `AIRVPN_SNI=${shellQuote(input.sni || "www.amazon.com")}`,
      `AIRVPN_PANEL_USER=${shellQuote(input.panelUser || "dominate")}`,
      `AIRVPN_PANEL_PASS=${shellQuote(input.panelPass || "")}`,
      `AIRVPN_PANEL_URL=${shellQuote(input.panelUrl || "")}`,
      `AIRVPN_VLESS_PORT=${shellQuote(input.vlessPort || "")}`,
      `AIRVPN_PANEL_PORT=${shellQuote(input.panelPort || "")}`,
      `AIRVPN_MODE=${shellQuote(input.mode)}`,
      `AIRVPN_REUSE_INBOUND_ID=${shellQuote(input.reuseInboundId || "")}`,
    ].join(" ");

    log(`Running install (mode=${input.mode}) — this can take a few minutes…`);
    let lineBuf = "";
    const { code, stdout, stderr } = await exec(
      conn,
      `${envExports} bash ${shellQuote(remotePath)}`,
      (chunk) => {
        lineBuf += chunk;
        const parts = lineBuf.split(/\r?\n/);
        lineBuf = parts.pop() || "";
        for (const line of parts) {
          if (line.trim()) log(line.replace(/\x1b\[[0-9;]*m/g, ""));
        }
      },
    );
    if (lineBuf.trim()) log(lineBuf.replace(/\x1b\[[0-9;]*m/g, ""));

    const combined = `${stdout}\n${stderr}`;
    if (code !== 0) {
      throw new Error(`Remote install failed (exit ${code}). Last output:\n${combined.slice(-1200)}`);
    }
    return parseResult(combined);
  } finally {
    try {
      await exec(conn, "rm -f /tmp/airvpn-remote-bootstrap-*.sh").catch(() => false);
    } catch {
      // ignore cleanup error
    }
    conn.end();
  }
}

