// OBC I/O Bridge: connects the Linux guest to the simulator's __bh/engine state via:
//   1. 9p Host Mount (`/obc`): live computed `/obc/telemetry.json`, `/obc/tau`, `/obc/status.json`,
//      writable `/obc/cmd`, plus live project scripts (`/obc/scripts/*`) and libraries (`/obc/lib/*`).
//   2. AF_VSOCK (port 4747): bidirectional newline-delimited JSON RPC (`read`, `cmd`, `ping`)
//      for low-latency 20-50 Hz avionics control loops in Python or Node.js.
//
// The `__bh` / TARS RPC over 9p is keyed by request id (docs/PLAN-LINUX-OBC.md §5): a client writes one JSON line to
// `/obc/rpc/<id>.req` and reads `/obc/rpc/<id>.res`, so concurrent programs (several Rust TUIs, a Python loop, the `bh`
// CLI) never read each other's replies. The legacy single slot `/obc/rpc_req` -> `/obc/rpc_res` stays for old guest
// binaries and as the fallback (every reply is written to both). Ids carry the
// client's pid and a random nonce (`rs-<pid>-<nonce>-<seq>`, `py-…`, `js-…`), so two processes never mint the same one.

import type { MemoryFs, Vsock, VsockConnection, VsockListener } from "unkernel/web";
import { handleBhRpc, handleBhRpcMaybeSync, type BhRpcRequest } from "./bh-rpc";
import { formatTauText, parseObcCommand } from "./protocol";
import type { ObcCommand, ObcCommandResult, ObcStatus, ObcTelemetry } from "./types";

export const OBC_VSOCK_PORT = 4747;

/** The keyed RPC directory inside the `/obc` mount (guest path `/obc/rpc`). */
export const OBC_RPC_DIR = "/rpc";
/** A request id usable as a file name: letters, digits, `_`, `.`, `-` (1–96 characters, not starting with `.`). */
export const OBC_RPC_ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,95}$/;
/** The longest JSON line a guest may send (9p request file or AF_VSOCK line) [UTF-16 code units]. */
export const OBC_RPC_MAX_LINE = 256 * 1024;
/** How long an unread keyed reply is kept before being swept [ms], and how many at most. */
export const OBC_RPC_RES_TTL_MS = 60_000;
export const OBC_RPC_RES_MAX = 256;

/** Whether `id` can name a keyed RPC file (`/obc/rpc/<id>.req|.res`). */
export function isSafeRpcId(id: unknown): id is string {
  return typeof id === "string" && OBC_RPC_ID_RE.test(id) && !id.includes("..");
}

/** One item out of a JSONL stream: a complete line, or a line refused for exceeding the limit (its length so far). */
export type JsonlItem = { line: string } | { overflow: number };

/**
 * Split a newline-delimited stream into lines, bounded: a line longer than `maxLine` is reported once as an overflow,
 * then everything up to the next newline is discarded, and reading resumes cleanly on the following line — a long
 * line never leaves its tail to be parsed as a request of its own.
 */
export class JsonlLineSplitter {
  private pending = "";
  private discarding = false;
  constructor(private readonly maxLine = OBC_RPC_MAX_LINE) {}

  push(chunk: string): JsonlItem[] {
    const out: JsonlItem[] = [];
    let rest = chunk;
    while (rest.length > 0) {
      const nl = rest.indexOf("\n");
      if (this.discarding) {
        if (nl < 0) return out;
        this.discarding = false;
        rest = rest.slice(nl + 1);
        continue;
      }
      if (nl < 0) {
        if (this.pending.length + rest.length > this.maxLine) {
          out.push({ overflow: this.pending.length + rest.length });
          this.pending = "";
          this.discarding = true;
          return out;
        }
        this.pending += rest;
        return out;
      }
      const line = this.pending + rest.slice(0, nl);
      this.pending = "";
      rest = rest.slice(nl + 1);
      out.push(line.length > this.maxLine ? { overflow: line.length } : { line });
    }
    return out;
  }

  /** Whether the splitter is skipping the rest of an oversize line. */
  get skipping(): boolean {
    return this.discarding;
  }
}

/** The error reply to an oversize line (code E2BIG, like the errno). */
export function oversizeReply(len: number, max = OBC_RPC_MAX_LINE): Record<string, unknown> {
  return {
    ok: false,
    code: "E2BIG",
    error: `request line too long (${len} > ${max} characters); discarded up to the next newline`,
  };
}

export interface ObcHostAdapter {
  /** Sample the live avionics telemetry snapshot from the simulator. */
  sampleTelemetry(): ObcTelemetry;
  /** Execute a validated command from the Linux OBC on the simulator. */
  executeCommand(cmd: ObcCommand): ObcCommandResult;
}

export interface ObcMountHandle {
  dispose(): void;
  setTtySize(cols: number, rows: number): void;
}

/** Populate a `MemoryFs` mounted at `/obc` with live telemetry, tau, tty_size, command sink, scripts, libs, pilot-kit docs/skills, and native `obc-rs` binary. */
export function wireObcMountFs(
  mem: MemoryFs,
  adapter: ObcHostAdapter,
  getStatus: () => ObcStatus,
  scripts: Record<string, string>,
  lib: Record<string, string>,
  onCommandHandled: () => void,
  rustBinary?: Uint8Array | null,
  pilotKit?: Record<string, string>,
  initialTtySize: { cols: number; rows: number } = { cols: 100, rows: 26 },
): ObcMountHandle {
  const atomicWrite = (path: string, content: string, mode = 0o444) => {
    const tmp = `${path}.tmp`;
    mem.writeFile(tmp, content, { mode });
    mem.rename(tmp, path);
  };
  let lastStatusJson = "";
  let lastTauText = "";
  let lastTelSig = "";
  let lastTelWriteMs = 0;
  const refreshLiveFiles = (force = false) => {
    try {
      const t = adapter.sampleTelemetry();
      const now = Date.now();
      // Fixed-width trailing space padding keeps st_size constant so Linux 9p never truncates reads mid-token.
      // Skip redundant .tmp + rename churn when telemetry (excluding wall_ms) is unchanged; refresh at least every 1000 ms.
      const telRaw = JSON.stringify(t);
      const telSig = telRaw.replace(/"wall_ms":\d+,?/, "");
      if (force || telSig !== lastTelSig || now - lastTelWriteMs >= 1000) {
        lastTelSig = telSig;
        lastTelWriteMs = now;
        const telPadded = telRaw.length < 2047 ? `${telRaw}${" ".repeat(2047 - telRaw.length)}\n` : `${telRaw}\n`;
        atomicWrite("/telemetry.json", telPadded);
      }
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
  refreshLiveFiles(true);
  const refreshTimer = setInterval(() => refreshLiveFiles(false), 250);
  mem.writeFile("/cmd", "", { mode: 0o666 });
  mem.writeFile("/last_result.json", '{"ok":true,"msg":"ready"}\n', { mode: 0o444 });
  mem.writeFile("/rpc_req", "", { mode: 0o666 });
  mem.writeFile("/rpc_res", '{"ok":true,"id":0,"result":"ready"}\n', { mode: 0o444 });
  const setTtySize = (cols: number, rows: number) => {
    const raw = `${Math.round(cols)} ${Math.round(rows)}`;
    // Fixed 16-byte padded file so 9p st_size never shrinks or truncates across live resizes
    atomicWrite("/tty_size", `${raw.padEnd(15, " ")}\n`);
  };
  setTtySize(initialTtySize.cols, initialTtySize.rows);

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
  if (pilotKit) {
    for (const [rel, body] of Object.entries(pilotKit)) {
      const clean = rel.replace(/^\/+/, "");
      const slash = clean.lastIndexOf("/");
      if (slash > 0) mem.mkdirp(`/pilot-kit/${clean.slice(0, slash)}`, { mode: 0o755 });
      else mem.mkdirp("/pilot-kit", { mode: 0o755 });
      mem.writeFile(`/pilot-kit/${clean}`, body, { mode: 0o444 });
    }
  }

  let handling = false;
  let handlingRpc = false;
  mem.mkdirp(OBC_RPC_DIR, { mode: 0o777 });
  /** Keyed replies written and not yet swept: id -> time written [ms] (insertion order = age order). */
  const keyedReplies = new Map<string, number>();
  const sweepKeyedReplies = (now: number) => {
    for (const [id, at] of keyedReplies) {
      if (now - at <= OBC_RPC_RES_TTL_MS && keyedReplies.size <= OBC_RPC_RES_MAX) break;
      keyedReplies.delete(id);
      try {
        mem.rm(`${OBC_RPC_DIR}/${id}.res`, { force: true });
      } catch {
        // already removed by its reader
      }
    }
  };
  /** Publish one reply: in its keyed file (when the id is a safe file name) and in the legacy single slot. */
  const publishReply = (id: unknown, reply: unknown) => {
    const text = `${JSON.stringify(reply)}\n`;
    if (isSafeRpcId(id)) {
      // Always write .tmp + rename so Linux 9p gets a fresh inode and never truncates larger responses.
      atomicWrite(`${OBC_RPC_DIR}/${id}.res`, text);
      keyedReplies.delete(id);
      keyedReplies.set(id, Date.now());
      sweepKeyedReplies(Date.now());
    }
    // The single slot too: the fallback a guest reads when its 9p client caches the keyed file as missing.
    atomicWrite("/rpc_res", text);
  };
  /** Run one RPC line and publish its reply (synchronously when the target is synchronous). */
  const dispatchRpc = (raw: string, fileId: string | null) => {
    let parsed: BhRpcRequest;
    try {
      parsed = JSON.parse(raw) as BhRpcRequest;
    } catch (e) {
      publishReply(fileId, { id: fileId ?? undefined, ok: false, error: e instanceof Error ? e.message : "malformed rpc json" });
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      publishReply(fileId, { id: fileId ?? undefined, ok: false, error: "expected a JSON object" });
      return;
    }
    // A keyed request is answered under its file's id, whatever its body says.
    if (fileId !== null) parsed.id = fileId;
    const maybe = handleBhRpcMaybeSync(parsed);
    if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
      void (maybe as Promise<unknown>).then(
        (res) => {
          onCommandHandled();
          publishReply(parsed.id, res);
        },
        (e) => {
          publishReply(parsed.id, { id: parsed.id, ok: false, error: e instanceof Error ? e.message : String(e) });
        },
      );
    } else {
      onCommandHandled();
      publishReply(parsed.id, maybe);
    }
  };
  const sweepTimer = setInterval(() => sweepKeyedReplies(Date.now()), 5_000);
  const keyedReqRe = /^\/rpc\/([^/]+)\.req$/;
  const unsubChange = mem.onChange((change) => {
    if (change.type !== "write" && change.type !== "create" && change.type !== "rename") return;
    const path = change.type === "rename" ? (change.to ?? "") : change.path;

    // 1a. Keyed __bh & TARS RPC (/obc/rpc/<id>.req -> /obc/rpc/<id>.res): one file per request, so concurrent
    // clients never collide. Taken once the line is complete (it ends with a newline: a request larger than the 9p
    // message size arrives in several writes); the request file is removed as soon as it is taken.
    const keyed = keyedReqRe.exec(path);
    if (keyed) {
      const fileId = keyed[1] ?? "";
      let raw = "";
      try {
        raw = mem.readText(path);
      } catch {
        return;
      }
      if (!isSafeRpcId(fileId)) {
        mem.rm(path, { force: true });
        return;
      }
      if (raw.length > OBC_RPC_MAX_LINE) {
        mem.rm(path, { force: true });
        publishReply(fileId, { id: fileId, ...oversizeReply(raw.length) });
        return;
      }
      if (!raw.endsWith("\n")) return;
      mem.rm(path, { force: true });
      const line = raw.trim();
      if (line) dispatchRpc(line, fileId);
      return;
    }

    // 1b. Legacy single-slot RPC (/obc/rpc_req -> /obc/rpc_res), kept for older guest binaries.
    // Runs synchronously inside onChange whenever the RPC is synchronous (zero guest polling latency),
    // and resolves asynchronously when the invoked tool/method returns a Promise.
    if (path === "/rpc_req" && !handlingRpc) {
      let rawRpc = "";
      try {
        rawRpc = mem.readText("/rpc_req");
      } catch {
        return;
      }
      if (rawRpc.length > OBC_RPC_MAX_LINE) {
        mem.writeFile("/rpc_req", "", { mode: 0o666 });
        atomicWrite("/rpc_res", `${JSON.stringify(oversizeReply(rawRpc.length))}\n`);
        return;
      }
      // Wait for the whole line (a large request arrives in several 9p writes).
      if (!rawRpc.endsWith("\n")) return;
      rawRpc = rawRpc.trim();
      if (!rawRpc) return;
      handlingRpc = true;
      try {
        mem.writeFile("/rpc_req", "", { mode: 0o666 });
        dispatchRpc(rawRpc, null);
      } finally {
        handlingRpc = false;
      }
      return;
    }

    // 2. Fast flight control command sink (/obc/cmd -> /obc/last_result.json)
    if (handling || path !== "/cmd") return;
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
  return {
    dispose() {
      clearInterval(refreshTimer);
      clearInterval(sweepTimer);
      unsubChange();
    },
    setTtySize,
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
    const splitter = new JsonlLineSplitter(OBC_RPC_MAX_LINE);
    try {
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const item of splitter.push(decoder.decode(value, { stream: true }))) {
          // An oversize line is answered with an error (never dropped silently) and skipped up to its newline.
          let reply: Record<string, unknown> | null = null;
          if ("overflow" in item) reply = oversizeReply(item.overflow);
          else if (item.line.trim()) reply = await handleVsockRpc(item.line.trim(), adapter, onCommandHandled);
          if (reply) await writer.write(encoder.encode(`${JSON.stringify(reply)}\n`));
        }
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

const BH_RPC_OPS = new Set(["ls", "get", "set", "call", "tools", "tool", "search", "eval", "mcdu", "catalog"]);

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
