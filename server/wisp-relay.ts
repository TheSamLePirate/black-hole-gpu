// AAA Wisp v1 WebSocket-to-TCP/UDP relay (docs/PLAN-LINUX-OBC.md §6, docs/DEPLOY.md).
// Shared by local dev (`server.ts` on `/__wisp`) and production (`server/wisp-main.ts` on `wss://code.samlepirate.org/`).
//
// Features:
// - Full Wisp v1 binary protocol: CONNECT (0x01 TCP + UDP), DATA (0x02), CONTINUE (0x03), CLOSE (0x04)
// - Real OS-level TCP backpressure (`socket.pause()` / `socket.resume()`) coupled with WebSocket
//   `getBufferedAmount()` + `websocket.drain(ws)` and an ordered FIFO outbound frame queue so large
//   downloads (Bun 48 MB, Claude Code 130 MB, Debian/Rust toolchains) NEVER drop frames or stall
// - Strict DATA-before-CLOSE ordering on EOF
// - Multi-layer SSRF protection on both hostnames AND resolved DNS IP addresses (loopback, RFC1918,
//   CGNAT, link-local, cloud metadata, IPv6 ULA/link-local/mapped IPv4)

import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import { foreignOrigin } from "./ear-relay";

const PKT_CONNECT = 0x01;
const PKT_DATA = 0x02;
const PKT_CONTINUE = 0x03;
const PKT_CLOSE = 0x04;

const STREAM_TCP = 0x01;
const STREAM_UDP = 0x02;

const CLOSE_NORMAL = 0x02;
const CLOSE_INVALID = 0x03;
const CLOSE_UNREACHABLE = 0x42;
const CLOSE_TIMEOUT = 0x43;
const CLOSE_REFUSED = 0x44;
const CLOSE_BLOCKED = 0x48;
const CLOSE_THROTTLED = 0x49;

export const WISP_LIMITS = {
  maxClients: 64,
  maxStreamsPerClient: 96,
  initialBuffer: 128,
  maxHostLen: 253,
  maxClientQueueBytes: 1024 * 1024,
  maxFrameBytes: 32 * 1024,
  wsHighWaterBytes: 512 * 1024,
  wsLowWaterBytes: 128 * 1024,
  connectTimeoutMs: 15_000,
} as const;

export interface WispUpgradeOptions {
  enabled: boolean;
  maxClients?: number;
  maxStreamsPerClient?: number;
  maxClientsPerIp?: number;
  clientIp?: string;
  allowOrigin?: (origin: string) => boolean;
  /** Test-only override allowing connections to 127.0.0.1 / ::1 in isolated unit tests. */
  allowLoopbackForTest?: boolean;
}

export interface WispSocketLike {
  data: unknown;
  send(data: Uint8Array): number;
  getBufferedAmount?(): number;
  readyState?: number;
}

export interface WispStream {
  id: number;
  kind: "tcp" | "udp";
  tcp?: net.Socket;
  udp?: dgram.Socket;
  udpHost?: string;
  udpPort?: number;
  clientQueue: Uint8Array[];
  clientQueuedBytes: number;
  connected: boolean;
  pausedByWs: boolean;
  rxPacketsSinceCredit: number;
  closed: boolean;
}

export interface WispSession {
  kind: "wisp";
  ip: string;
  maxStreams: number;
  allowLoopbackForTest: boolean;
  streams: Map<number, WispStream>;
  ws: WispSocketLike | null;
  outQueue: Uint8Array[];
  outQueueHead: number;
  outQueuedBytes: number;
  streamsPaused: boolean;
  drainTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

let activeClients = 0;
let activeStreams = 0;
let totalConnections = 0;
let totalStreams = 0;
let totalBytesIn = 0;
let totalBytesOut = 0;
let blockedHosts = 0;
let backpressurePauses = 0;
let wsSendRetries = 0;
const clientsByIp = new Map<string, number>();

export function wispStats() {
  return {
    activeClients,
    activeStreams,
    totalConnections,
    totalStreams,
    totalBytesIn,
    totalBytesOut,
    blockedHosts,
    backpressurePauses,
    wsSendRetries,
  };
}

/** Build a Wisp v1 CONTINUE packet for `streamId` with `remaining` packet credits. */
export function encodeContinue(streamId: number, remaining: number): Uint8Array {
  const buf = new Uint8Array(9);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, PKT_CONTINUE);
  dv.setUint32(1, streamId, true);
  dv.setUint32(5, remaining, true);
  return buf;
}

/** Build a Wisp v1 CLOSE packet for `streamId` with `reason`. */
export function encodeClose(streamId: number, reason: number): Uint8Array {
  const buf = new Uint8Array(6);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, PKT_CLOSE);
  dv.setUint32(1, streamId, true);
  dv.setUint8(5, reason);
  return buf;
}

/** Build a Wisp v1 DATA packet for `streamId` carrying `payload`. */
export function encodeData(streamId: number, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(5 + payload.byteLength);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, PKT_DATA);
  dv.setUint32(1, streamId, true);
  buf.set(payload, 5);
  return buf;
}

/** Parse a raw Wisp v1 client packet. Returns null if malformed. */
export function decodeWispPacket(
  raw: Uint8Array,
):
  | { type: "connect"; streamId: number; streamType: number; port: number; host: string }
  | { type: "data"; streamId: number; payload: Uint8Array }
  | { type: "close"; streamId: number; reason: number }
  | null {
  if (raw.byteLength < 5) return null;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const type = dv.getUint8(0);
  const streamId = dv.getUint32(1, true);
  if (type === PKT_CONNECT) {
    if (raw.byteLength < 8) return null;
    const streamType = dv.getUint8(5);
    const port = dv.getUint16(6, true);
    const hostBytes = raw.subarray(8);
    if (hostBytes.byteLength === 0 || hostBytes.byteLength > WISP_LIMITS.maxHostLen) return null;
    const host = new TextDecoder().decode(hostBytes).trim();
    if (!host || port < 1 || port > 65535 || /[\s\0]/.test(host)) return null;
    return { type: "connect", streamId, streamType, port, host };
  }
  if (type === PKT_DATA) {
    return { type: "data", streamId, payload: raw.subarray(5) };
  }
  if (type === PKT_CLOSE) {
    const reason = raw.byteLength >= 6 ? dv.getUint8(5) : CLOSE_NORMAL;
    return { type: "close", streamId, reason };
  }
  return null;
}

/**
 * SSRF guard: block loopback, RFC1918 private networks, CGNAT, link-local,
 * cloud metadata endpoints, IPv6 loopback/ULA/link-local/mapped-IPv4, and local hostnames.
 */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "metadata.google.internal" ||
    h === "metadata" ||
    h === "0.0.0.0" ||
    h === "::" ||
    h === "::1"
  ) {
    return true;
  }
  // IPv6 private / link-local / mapped IPv4
  if (h.includes(":")) {
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("::ffff:")) return true;
  }
  // Dotted IPv4 checks
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, 127/8
    if (a === 169 && b === 254) return true; // link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

function isHostAllowed(host: string, allowLoopbackForTest: boolean): boolean {
  if (!isBlockedHost(host)) return true;
  if (!allowLoopbackForTest) return false;
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

function setAllStreamsPaused(session: WispSession, paused: boolean) {
  if (session.streamsPaused === paused) return;
  session.streamsPaused = paused;
  if (paused) backpressurePauses++;
  for (const s of session.streams.values()) {
    if (!s.tcp || s.closed) continue;
    if (paused && !s.pausedByWs) {
      s.pausedByWs = true;
      s.tcp.pause();
    } else if (!paused && s.pausedByWs) {
      s.pausedByWs = false;
      s.tcp.resume();
    }
  }
}

function scheduleDrainPoll(session: WispSession) {
  if (session.drainTimer || session.closed) return;
  session.drainTimer = setTimeout(() => {
    session.drainTimer = null;
    flushWsOut(session);
  }, 15);
}

/**
 * Flush queued server→client Wisp frames respecting WebSocket backpressure.
 * Never drops a frame: if `ws.send()` returns `0` or bufferedAmount exceeds `wsHighWaterBytes`,
 * upstream TCP sockets are paused until the client drains.
 */
function flushWsOut(session: WispSession) {
  const ws = session.ws;
  if (!ws || session.closed) return;
  if (ws.readyState !== undefined && ws.readyState > 1) return;

  while (session.outQueueHead < session.outQueue.length) {
    const buffered = ws.getBufferedAmount?.() ?? 0;
    if (buffered >= WISP_LIMITS.wsHighWaterBytes) {
      setAllStreamsPaused(session, true);
      scheduleDrainPoll(session);
      return;
    }
    const frame = session.outQueue[session.outQueueHead]!;
    let ret: number;
    try {
      ret = ws.send(frame);
    } catch {
      return;
    }
    if (ret === 0) {
      // Bun refused the frame due to full send buffer — keep it at the head and retry after drain!
      wsSendRetries++;
      setAllStreamsPaused(session, true);
      scheduleDrainPoll(session);
      return;
    }
    // ret > 0 (sent immediately) or ret < 0 (accepted & queued in Bun's internal WS send buffer)
    session.outQueueHead++;
    session.outQueuedBytes -= frame.byteLength;
    if (ret < 0) {
      setAllStreamsPaused(session, true);
      scheduleDrainPoll(session);
      break;
    }
  }

  // Compact queue array once head advances
  if (session.outQueueHead > 0) {
    if (session.outQueueHead >= session.outQueue.length) {
      session.outQueue.length = 0;
      session.outQueueHead = 0;
      session.outQueuedBytes = 0;
    } else if (session.outQueueHead >= 64) {
      session.outQueue = session.outQueue.slice(session.outQueueHead);
      session.outQueueHead = 0;
    }
  }

  // Resume upstream TCP streams only once our queue is empty AND WebSocket send buffer is below low-water mark
  if (session.outQueue.length === 0) {
    const buffered = ws.getBufferedAmount?.() ?? 0;
    if (buffered <= WISP_LIMITS.wsLowWaterBytes) {
      setAllStreamsPaused(session, false);
    } else {
      setAllStreamsPaused(session, true);
      scheduleDrainPoll(session);
    }
  }
}

function enqueueWsFrame(session: WispSession, frame: Uint8Array) {
  if (session.closed || !session.ws) return;
  session.outQueue.push(frame);
  session.outQueuedBytes += frame.byteLength;
  flushWsOut(session);
}

export function wispUpgrade(
  req: Request,
  srv: { upgrade(r: Request, o: { data: unknown }): boolean },
  enabledOrOpts: boolean | WispUpgradeOptions,
): Response | undefined {
  const opts: WispUpgradeOptions = typeof enabledOrOpts === "boolean" ? { enabled: enabledOrOpts } : enabledOrOpts;
  if (!opts.enabled) return new Response("disabled", { status: 404 });
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json(
      { ok: true, protocol: "wisp/1", ...wispStats() },
      { headers: { "access-control-allow-origin": "*" } },
    );
  }
  const origin = req.headers.get("origin");
  if (opts.allowOrigin) {
    if (origin && !opts.allowOrigin(origin)) return new Response("forbidden", { status: 403 });
  } else if (foreignOrigin(req)) {
    return new Response("forbidden", { status: 403 });
  }
  const maxClients = opts.maxClients ?? WISP_LIMITS.maxClients;
  if (activeClients >= maxClients) return new Response("too many clients", { status: 429 });
  const ip = opts.clientIp ?? "local";
  const maxPerIp = opts.maxClientsPerIp ?? 12;
  if ((clientsByIp.get(ip) ?? 0) >= maxPerIp) return new Response("too many connections from ip", { status: 429 });

  const ok = srv.upgrade(req, {
    data: {
      kind: "wisp",
      ip,
      maxStreams: opts.maxStreamsPerClient ?? WISP_LIMITS.maxStreamsPerClient,
      allowLoopbackForTest: Boolean(opts.allowLoopbackForTest),
      streams: new Map<number, WispStream>(),
      ws: null,
      outQueue: [],
      outQueueHead: 0,
      outQueuedBytes: 0,
      streamsPaused: false,
      drainTimer: null,
      closed: false,
    } satisfies WispSession,
  });
  return ok ? undefined : new Response("upgrade failed", { status: 400 });
}

export function wispOpen(ws: WispSocketLike) {
  activeClients++;
  totalConnections++;
  const session = ws.data as WispSession;
  session.ws = ws;
  clientsByIp.set(session.ip, (clientsByIp.get(session.ip) ?? 0) + 1);
  // Wisp v1 handshake: server sends CONTINUE on stream 0 with initial buffer credit.
  enqueueWsFrame(session, encodeContinue(0, WISP_LIMITS.initialBuffer));
}

/** Must be wired to `Bun.serve({ websocket: { drain(ws) { wispDrain(ws); } } })` for full backpressure. */
export function wispDrain(ws: WispSocketLike) {
  const session = ws.data as WispSession;
  if (session?.kind !== "wisp") return;
  flushWsOut(session);
}

function closeStream(session: WispSession, streamId: number, reason: number, notifyClient: boolean) {
  const s = session.streams.get(streamId);
  if (!s || s.closed) return;
  s.closed = true;
  session.streams.delete(streamId);
  activeStreams = Math.max(0, activeStreams - 1);
  if (s.tcp) {
    try {
      s.tcp.removeAllListeners();
      s.tcp.destroy();
    } catch {
      // ignore
    }
    s.tcp = undefined;
  }
  if (s.udp) {
    try {
      s.udp.close();
    } catch {
      // ignore
    }
    s.udp = undefined;
  }
  s.clientQueue.length = 0;
  s.clientQueuedBytes = 0;
  // Enqueue CLOSE in FIFO order so every preceding DATA frame arrives at the client first!
  if (notifyClient) enqueueWsFrame(session, encodeClose(streamId, reason));
}

function flushClientToTcp(session: WispSession, stream: WispStream) {
  const sock = stream.tcp;
  if (!sock || !stream.connected || stream.closed) return;
  let flushedAny = false;
  while (stream.clientQueue.length > 0) {
    const chunk = stream.clientQueue.shift()!;
    stream.clientQueuedBytes -= chunk.byteLength;
    flushedAny = true;
    const ok = sock.write(chunk);
    if (!ok) {
      // Kernel TCP send buffer is full — wait for socket "drain" before issuing more Wisp CONTINUE credits
      sock.once("drain", () => {
        if (!stream.closed) {
          flushClientToTcp(session, stream);
          if (stream.clientQueue.length === 0) {
            stream.rxPacketsSinceCredit = 0;
            enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
          }
        }
      });
      return;
    }
  }
  if (flushedAny) {
    stream.rxPacketsSinceCredit = 0;
    enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
  }
}

function openTcpStream(session: WispSession, stream: WispStream, host: string, port: number) {
  const sock = net.createConnection({
    host,
    port,
    lookup: (hostname, opts, cb) => {
      dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return cb(err, "", 4);
        // Handle both `{ all: true }` array form and single address form cleanly
        if (Array.isArray(address)) {
          const safe = address.filter((entry) => isHostAllowed(entry.address, session.allowLoopbackForTest));
          if (safe.length === 0) {
            blockedHosts++;
            return cb(Object.assign(new Error("blocked address"), { code: "EACCES" }), [] as never, 4);
          }
          return cb(null, safe as never, family);
        }
        if (!isHostAllowed(address, session.allowLoopbackForTest)) {
          blockedHosts++;
          return cb(Object.assign(new Error("blocked address"), { code: "EACCES" }), "", 4);
        }
        return cb(null, address, family);
      });
    },
  });
  stream.tcp = sock;
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 30_000);
  sock.setTimeout(WISP_LIMITS.connectTimeoutMs);

  sock.on("connect", () => {
    sock.setTimeout(0);
    if (stream.closed || session.closed) {
      sock.destroy();
      return;
    }
    stream.connected = true;
    if (session.streamsPaused) {
      stream.pausedByWs = true;
      sock.pause();
    }
    flushClientToTcp(session, stream);
    enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
  });

  sock.on("timeout", () => {
    if (!stream.connected) {
      closeStream(session, stream.id, CLOSE_TIMEOUT, true);
    }
  });

  sock.on("data", (buf: Buffer) => {
    if (stream.closed || session.closed) return;
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    totalBytesOut += bytes.byteLength;
    const MAX = WISP_LIMITS.maxFrameBytes;
    if (bytes.byteLength <= MAX) {
      enqueueWsFrame(session, encodeData(stream.id, bytes));
    } else {
      for (let off = 0; off < bytes.byteLength; off += MAX) {
        enqueueWsFrame(session, encodeData(stream.id, bytes.subarray(off, Math.min(off + MAX, bytes.byteLength))));
      }
    }
  });

  sock.on("end", () => {
    closeStream(session, stream.id, CLOSE_NORMAL, true);
  });

  sock.on("close", () => {
    closeStream(session, stream.id, CLOSE_NORMAL, true);
  });

  sock.on("error", (err: NodeJS.ErrnoException) => {
    const code = err?.code;
    const reason =
      code === "EACCES"
        ? CLOSE_BLOCKED
        : code === "ECONNREFUSED"
          ? CLOSE_REFUSED
          : code === "ETIMEDOUT"
            ? CLOSE_TIMEOUT
            : CLOSE_UNREACHABLE;
    closeStream(session, stream.id, reason, true);
  });
}

function openUdpStream(session: WispSession, stream: WispStream, host: string, port: number) {
  dns.lookup(host, (err, address, family) => {
    if (stream.closed || session.closed) return;
    if (err || !address) {
      closeStream(session, stream.id, CLOSE_UNREACHABLE, true);
      return;
    }
    if (!isHostAllowed(address, session.allowLoopbackForTest)) {
      blockedHosts++;
      closeStream(session, stream.id, CLOSE_BLOCKED, true);
      return;
    }
    const udp = dgram.createSocket(family === 6 ? "udp6" : "udp4");
    stream.udp = udp;
    stream.udpHost = address;
    stream.udpPort = port;
    stream.connected = true;
    udp.on("message", (msg) => {
      if (stream.closed || session.closed) return;
      const bytes = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
      totalBytesOut += bytes.byteLength;
      enqueueWsFrame(session, encodeData(stream.id, bytes));
    });
    udp.on("error", () => closeStream(session, stream.id, CLOSE_UNREACHABLE, true));
    while (stream.clientQueue.length > 0) {
      const payload = stream.clientQueue.shift()!;
      stream.clientQueuedBytes -= payload.byteLength;
      udp.send(payload, port, address);
    }
    enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
  });
}

export function wispMessage(ws: { data: unknown }, msg: string | ArrayBuffer | Uint8Array) {
  const session = ws.data as WispSession;
  if (session.closed) return;
  const raw =
    typeof msg === "string"
      ? new TextEncoder().encode(msg)
      : msg instanceof Uint8Array
        ? msg
        : new Uint8Array(msg);
  const pkt = decodeWispPacket(raw);
  if (!pkt) return;

  if (pkt.type === "connect") {
    if (pkt.streamId === 0 || (pkt.streamType !== STREAM_TCP && pkt.streamType !== STREAM_UDP)) {
      enqueueWsFrame(session, encodeClose(pkt.streamId, CLOSE_INVALID));
      return;
    }
    if (!isHostAllowed(pkt.host, session.allowLoopbackForTest)) {
      blockedHosts++;
      enqueueWsFrame(session, encodeClose(pkt.streamId, CLOSE_BLOCKED));
      return;
    }
    if (session.streams.size >= session.maxStreams) {
      enqueueWsFrame(session, encodeClose(pkt.streamId, CLOSE_THROTTLED));
      return;
    }
    if (session.streams.has(pkt.streamId)) {
      closeStream(session, pkt.streamId, CLOSE_NORMAL, false);
    }
    totalStreams++;
    activeStreams++;
    const stream: WispStream = {
      id: pkt.streamId,
      kind: pkt.streamType === STREAM_UDP ? "udp" : "tcp",
      clientQueue: [],
      clientQueuedBytes: 0,
      connected: false,
      pausedByWs: false,
      rxPacketsSinceCredit: 0,
      closed: false,
    };
    session.streams.set(pkt.streamId, stream);
    if (pkt.streamType === STREAM_UDP) {
      openUdpStream(session, stream, pkt.host, pkt.port);
    } else {
      openTcpStream(session, stream, pkt.host, pkt.port);
    }
    return;
  }

  if (pkt.type === "data") {
    const stream = session.streams.get(pkt.streamId);
    if (!stream || stream.closed) return;
    totalBytesIn += pkt.payload.byteLength;
    if (stream.kind === "udp") {
      if (stream.udp && stream.connected && stream.udpHost && stream.udpPort) {
        stream.udp.send(pkt.payload, stream.udpPort, stream.udpHost);
      } else if (stream.clientQueuedBytes + pkt.payload.byteLength <= WISP_LIMITS.maxClientQueueBytes) {
        const copy = new Uint8Array(pkt.payload.byteLength);
        copy.set(pkt.payload);
        stream.clientQueue.push(copy);
        stream.clientQueuedBytes += copy.byteLength;
      }
      return;
    }
    if (stream.tcp && stream.connected && stream.clientQueue.length === 0) {
      const ok = stream.tcp.write(pkt.payload);
      if (ok) {
        stream.rxPacketsSinceCredit++;
        if (stream.rxPacketsSinceCredit >= 16) {
          stream.rxPacketsSinceCredit = 0;
          enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
        }
      } else {
        stream.tcp.once("drain", () => {
          if (!stream.closed) {
            flushClientToTcp(session, stream);
            stream.rxPacketsSinceCredit = 0;
            enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
          }
        });
      }
    } else if (stream.clientQueuedBytes + pkt.payload.byteLength <= WISP_LIMITS.maxClientQueueBytes) {
      const copy = new Uint8Array(pkt.payload.byteLength);
      copy.set(pkt.payload);
      stream.clientQueue.push(copy);
      stream.clientQueuedBytes += copy.byteLength;
      if (stream.connected) flushClientToTcp(session, stream);
    } else {
      closeStream(session, stream.id, CLOSE_THROTTLED, true);
    }
    return;
  }

  if (pkt.type === "close") {
    closeStream(session, pkt.streamId, pkt.reason, false);
  }
}

export function wispClose(ws: { data: unknown }) {
  const session = ws.data as WispSession;
  if (session.closed) return;
  session.closed = true;
  session.ws = null;
  if (session.drainTimer) {
    clearTimeout(session.drainTimer);
    session.drainTimer = null;
  }
  session.outQueue.length = 0;
  session.outQueueHead = 0;
  session.outQueuedBytes = 0;
  activeClients = Math.max(0, activeClients - 1);
  const n = (clientsByIp.get(session.ip) ?? 1) - 1;
  if (n <= 0) clientsByIp.delete(session.ip);
  else clientsByIp.set(session.ip, n);
  for (const id of [...session.streams.keys()]) {
    closeStream(session, id, CLOSE_NORMAL, false);
  }
}
