// OBC I/O Bridge: connects the Linux guest to the simulator's __bh/engine state via:
//   1. 9p Host Mount (`/obc`): live computed `/obc/telemetry.json`, `/obc/tau`, `/obc/status.json`,
//      writable `/obc/cmd`, plus live project scripts (`/obc/scripts/*`) and libraries (`/obc/lib/*`).
//   2. AF_VSOCK (port 4747): bidirectional newline-delimited JSON RPC (`read`, `cmd`, `ping`)
//      for low-latency 20-50 Hz avionics control loops in Python or Node.js.

import type { MemoryFs, Vsock, VsockConnection, VsockListener } from "unkernel/web";
import { handleBhRpc, handleBhRpcMaybeSync, type BhRpcRequest } from "./bh-rpc";
import { formatTauText, parseObcCommand } from "./protocol";
import type { ObcCommand, ObcCommandResult, ObcStatus, ObcTelemetry } from "./types";

export const OBC_VSOCK_PORT = 4747;

export interface ObcHostAdapter {
  /** Sample the live avionics telemetry snapshot from the simulator. */
  sampleTelemetry(): ObcTelemetry;
  /** Execute a validated command from the Linux OBC on the simulator. */
  executeCommand(cmd: ObcCommand): ObcCommandResult;
}

/** Populate a `MemoryFs` mounted at `/obc` with live telemetry, tau, command sink, scripts, libs, and native `obc-rs` binary. */
export function wireObcMountFs(
  mem: MemoryFs,
  adapter: ObcHostAdapter,
  getStatus: () => ObcStatus,
  scripts: Record<string, string>,
  lib: Record<string, string>,
  onCommandHandled: () => void,
  rustBinary?: Uint8Array | null,
): () => void {
  const atomicWrite = (path: string, content: string, mode = 0o444) => {
    const tmp = `${path}.tmp`;
    mem.writeFile(tmp, content, { mode });
    mem.rename(tmp, path);
  };
  let lastStatusJson = "";
  let lastTauText = "";
  const refreshLiveFiles = () => {
    try {
      const t = adapter.sampleTelemetry();
      // Fixed-width trailing space padding keeps st_size constant so Linux 9p never truncates reads mid-token.
      const telRaw = JSON.stringify(t);
      const telPadded = telRaw.length < 2047 ? `${telRaw}${" ".repeat(2047 - telRaw.length)}\n` : `${telRaw}\n`;
      atomicWrite("/telemetry.json", telPadded);
      const tauTxt = formatTauText({
        dtau_dt: t.dtau_dt,
        proper_time_s: t.proper_time_s,
        sim_time_s: t.sim_time_s,
        warp: t.warp,
        frozen: t.frozen,
        body: t.body,
      });
      if (tauTxt !== lastTauText) {
        lastTauText = tauTxt;
        atomicWrite("/tau", tauTxt);
      }
      const stJson = `${JSON.stringify(getStatus())}\n`;
      if (stJson !== lastStatusJson) {
        lastStatusJson = stJson;
        atomicWrite("/status.json", stJson);
      }
    } catch {
      // keep previous snapshot on transient state transitions
    }
  };
  refreshLiveFiles();
  const refreshTimer = setInterval(refreshLiveFiles, 200);
  mem.writeFile("/cmd", "", { mode: 0o666 });
  mem.writeFile("/last_result.json", '{"ok":true,"msg":"ready"}\n', { mode: 0o444 });
  mem.writeFile("/rpc_req", "", { mode: 0o666 });
  mem.writeFile("/rpc_res", '{"ok":true,"id":0,"result":"ready"}\n', { mode: 0o444 });

  mem.mkdirp("/scripts", { mode: 0o755 });
  for (const [name, body] of Object.entries(scripts)) {
    mem.writeFile(`/scripts/${name}`, body, { mode: 0o755 });
  }
  mem.mkdirp("/lib", { mode: 0o755 });
  for (const [name, body] of Object.entries(lib)) {
    mem.writeFile(`/lib/${name}`, body, { mode: 0o644 });
  }
  if (rustBinary && rustBinary.byteLength > 0) {
    mem.mkdirp("/bin", { mode: 0o755 });
    mem.writeFile("/bin/obc-rs", rustBinary, { mode: 0o755 });
  }

  let handling = false;
  let handlingRpc = false;
  const unsubChange = mem.onChange((change) => {
    if (change.type !== "write" && change.type !== "create") return;

    // 1. Universal __bh & TARS RPC channel (/obc/rpc_req -> /obc/rpc_res)
    // Runs synchronously inside onChange whenever the RPC is synchronous (zero guest polling latency),
    // and resolves asynchronously when the invoked tool/method returns a Promise.
    if (change.path === "/rpc_req" && !handlingRpc) {
      let rawRpc = "";
      try {
        rawRpc = mem.readText("/rpc_req").trim();
      } catch {
        return;
      }
      if (!rawRpc) return;
      handlingRpc = true;
      try {
        mem.writeFile("/rpc_req", "", { mode: 0o666 });
        let parsed: BhRpcRequest;
        try {
          parsed = JSON.parse(rawRpc) as BhRpcRequest;
        } catch (e) {
          atomicWrite("/rpc_res", `${JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "malformed rpc json" })}\n`);
          return;
        }
        const maybe = handleBhRpcMaybeSync(parsed);
        if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
          void (maybe as Promise<unknown>).then(
            (res) => {
              onCommandHandled();
              atomicWrite("/rpc_res", `${JSON.stringify(res)}\n`);
            },
            (e) => {
              atomicWrite(
                "/rpc_res",
                `${JSON.stringify({ id: parsed.id, ok: false, error: e instanceof Error ? e.message : String(e) })}\n`,
              );
            },
          );
        } else {
          onCommandHandled();
          // Always atomicWrite (write .tmp + rename) so Linux 9p gets a fresh inode and never truncates larger responses!
          atomicWrite("/rpc_res", `${JSON.stringify(maybe)}\n`);
        }
      } finally {
        handlingRpc = false;
      }
      return;
    }

    // 2. Fast flight control command sink (/obc/cmd -> /obc/last_result.json)
    if (handling || change.path !== "/cmd") return;
    let raw = "";
    try {
      raw = mem.readText("/cmd").trim();
    } catch {
      return;
    }
    if (!raw) return;
    handling = true;
    try {
      let lastRes: ObcCommandResult = { ok: false, msg: "empty" };
      for (const line of raw.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) continue;
        const parsed = parseObcCommand(s);
        if (!parsed) {
          lastRes = { ok: false, msg: "invalid command" };
        } else {
          lastRes = adapter.executeCommand(parsed);
          onCommandHandled();
        }
      }
      mem.writeFile("/last_result.json", `${JSON.stringify(lastRes)}\n`, { mode: 0o444 });
      mem.writeFile("/cmd", "", { mode: 0o666 });
    } finally {
      handling = false;
    }
  });
  return () => {
    clearInterval(refreshTimer);
    unsubChange();
  };
}

export interface ObcVsockHandle {
  readonly clients: number;
  close(): void;
}

/** Start the AF_VSOCK JSONL RPC server on port 4747 inside the host. */
export function startObcVsockServer(vsock: Vsock, adapter: ObcHostAdapter, onCommandHandled: () => void): ObcVsockHandle {
  let listener: VsockListener | null = null;
  let closed = false;
  let clientCount = 0;

  try {
    listener = vsock.listen(OBC_VSOCK_PORT);
  } catch (e) {
    console.warn("[OBC] AF_VSOCK listen failed:", e);
    return {
      get clients() {
        return 0;
      },
      close() {},
    };
  }

  const serveConnection = async (conn: VsockConnection) => {
    clientCount++;
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let nl = pending.indexOf("\n");
        while (nl >= 0) {
          const line = pending.slice(0, nl).trim();
          pending = pending.slice(nl + 1);
          if (line) {
            const reply = await handleVsockRpc(line, adapter, onCommandHandled);
            await writer.write(encoder.encode(`${JSON.stringify(reply)}\n`));
          }
          nl = pending.indexOf("\n");
        }
        if (pending.length > 16_384) pending = "";
      }
    } catch {
      // connection reset by guest
    } finally {
      clientCount = Math.max(0, clientCount - 1);
      try {
        reader.releaseLock();
      } catch {}
      try {
        writer.releaseLock();
      } catch {}
      try {
        conn.close();
      } catch {}
    }
  };

  const activeListener = listener;
  void (async () => {
    while (!closed) {
      try {
        const conn = await activeListener.accept();
        if (!conn) break;
        if (closed) {
          conn.close();
          break;
        }
        void serveConnection(conn);
      } catch {
        break;
      }
    }
  })();

  return {
    get clients() {
      return clientCount;
    },
    close() {
      closed = true;
      try {
        activeListener.close();
      } catch {}
    },
  };
}

const BH_RPC_OPS = new Set(["ls", "get", "set", "call", "tools", "tool", "search", "eval", "mcdu"]);

async function handleVsockRpc(line: string, adapter: ObcHostAdapter, onCommandHandled: () => void): Promise<Record<string, unknown>> {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return { ok: false, msg: "malformed json" };
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { ok: false, msg: "expected object" };
  }
  const o = msg as Record<string, unknown>;
  const op = typeof o.op === "string" ? o.op : "cmd";
  if (op === "read") {
    return { ok: true, telemetry: adapter.sampleTelemetry() };
  }
  if (op === "ping") {
    return { ok: true, pong: true, t: Date.now() };
  }
  if (BH_RPC_OPS.has(op)) {
    const res = await handleBhRpc(o as unknown as BhRpcRequest);
    onCommandHandled();
    return res as unknown as Record<string, unknown>;
  }
  const parsed = parseObcCommand(op === "cmd" && o.cmd !== undefined ? o.cmd : o);
  if (!parsed) return { ok: false, msg: "invalid command" };
  const res = adapter.executeCommand(parsed);
  onCommandHandled();
  return { ...res };
}
