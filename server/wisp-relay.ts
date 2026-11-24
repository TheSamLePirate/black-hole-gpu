// AAA Wisp v1 WebSocket-to-TCP/UDP relay (docs/PLAN-LINUX-OBC.md §6, docs/DEPLOY.md).
// Shared by local dev (`server.ts` on `/__wisp`) and production (`server/wisp-main.ts` on `wss://code.samlepirate.org/`).
//
// Protocol: Wisp v1 binary — CONNECT (0x01, TCP and UDP), DATA (0x02), CONTINUE (0x03), CLOSE (0x04).
//
// Security (review of 24 Nov 2026 — the relay is reachable by anyone who can open a WebSocket to it):
// - Destinations checked numerically on the canonical address (src/util/ip-guard.ts), for IP literals AND for every resolved
//   address; the relay resolves names itself and connects to the checked IP literal (no second resolution, no rebinding).
// - Destination ports: an allowlist per protocol (WispPolicy.tcpPorts / udpPorts, WISP_TCP_PORTS / WISP_UDP_PORTS), and mail
//   submission/relay ports (25, 465, 587, 2525) refused whatever the list says.
// - An allowed Origin is required on the upgrade when the server gives `allowOrigin` (production).
// - Byte-rate caps per client IP and for the whole relay (token buckets, both directions), a CONNECT-rate cap per IP; the client
//   IP comes from server/address.ts (proxy headers trusted only from a trusted proxy).
//
// Flow control:
// - Client → upstream: each stream has ONE drain handler (installed once), a `writeBlocked` flag and a bounded queue; CONTINUE
//   credits are granted only while the stream is neither blocked nor queued nor rate-limited, so a client honouring its
//   credits never queues more than about two windows. A client ignoring them is closed (THROTTLED) at the queue cap.
// - Upstream → client: an ordered FIFO of frames to the WebSocket; upstream sockets paused while the WebSocket's buffer is above
//   its high-water mark or the rate caps are in debt, resumed below the low-water mark (DATA-before-CLOSE preserved).
// - UDP: the relay's socket is connected to its one destination (the kernel drops datagrams from any other source; the handler
//   checks again) and inbound datagrams are dropped, not queued, past the session's outbound cap or while rate-limited.

import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import { foreignOrigin } from "./ear-relay";
import { classifyHost, isBlockedAddress, isBlockedHost, isBlockedName, isLoopbackAddress } from "../src/util/ip-guard";

export { isBlockedHost } from "../src/util/ip-guard";

const PKT_CONNECT = 0x01;
const PKT_DATA = 0x02;
const PKT_CONTINUE = 0x03;
const PKT_CLOSE = 0x04;

const STREAM_TCP = 0x01;
const STREAM_UDP = 0x02;

export const CLOSE_NORMAL = 0x02;
export const CLOSE_INVALID = 0x03;
export const CLOSE_UNREACHABLE = 0x42;
export const CLOSE_TIMEOUT = 0x43;
export const CLOSE_REFUSED = 0x44;
export const CLOSE_BLOCKED = 0x48;
export const CLOSE_THROTTLED = 0x49;

export const WISP_LIMITS = {
  maxClients: 64,
  maxStreamsPerClient: 96,
  /** The credit window, in packets (a client packet is at most 64 KiB — unkernel's MAX_PACKET). */
  initialBuffer: 32,
  maxHostLen: 253,
  /** Client→upstream bytes queued per stream before a client ignoring its credits is closed (≈ two windows of 64 KiB packets). */
  maxStreamQueueBytes: 2 * 32 * 64 * 1024 + 64 * 1024,
  /** The same, summed over a session's streams. */
  maxSessionQueueBytes: 16 * 1024 * 1024,
  /** Upstream→client bytes queued for the WebSocket past which inbound UDP datagrams are dropped. */
  maxSessionOutBytes: 4 * 1024 * 1024,
  maxUdpDatagram: 65_507,
  maxFrameBytes: 32 * 1024,
  wsHighWaterBytes: 512 * 1024,
  wsLowWaterBytes: 128 * 1024,
  connectTimeoutMs: 15_000,
} as const;

/** Ports never relayed, whatever the allowlist says (mail submission and relay: spam). */
export const WISP_DENIED_PORTS: ReadonlySet<number> = new Set([25, 465, 587, 2525]);

/** What a relay lets its clients reach and how fast. */
export interface WispPolicy {
  tcpPorts: ReadonlySet<number>;
  udpPorts: ReadonlySet<number>;
  /** Bytes per second per client IP (both directions summed); 0 = no cap. */
  ipBytesPerSec: number;
  ipBurstBytes: number;
  /** Bytes per second for the whole relay; 0 = no cap. */
  globalBytesPerSec: number;
  globalBurstBytes: number;
  /** CONNECTs per second per client IP, and their burst. */
  ipConnectsPerSec: number;
  ipConnectBurst: number;
}

export const DEFAULT_WISP_POLICY: WispPolicy = {
  // HTTP, HTTPS (apk, pip, npm, cargo, curl, git over HTTPS), git:// — SSH (22) only when an operator adds it
  tcpPorts: new Set([80, 443, 9418]),
  // DNS only (unkernel's client resolves through CONNECT host names and never opens UDP streams today)
  udpPorts: new Set([53]),
  ipBytesPerSec: 4 * 1024 * 1024,
  ipBurstBytes: 32 * 1024 * 1024,
  globalBytesPerSec: 24 * 1024 * 1024,
  globalBurstBytes: 64 * 1024 * 1024,
  ipConnectsPerSec: 20,
  ipConnectBurst: 100,
};

function parsePorts(raw: string | undefined, fallback: ReadonlySet<number>): ReadonlySet<number> {
  if (raw === undefined) return fallback;
  const out = new Set<number>();
  for (const p of raw.split(",")) {
    const n = Number(p.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 65535 && !WISP_DENIED_PORTS.has(n)) out.add(n);
  }
  return out;
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The policy from the environment (both servers): WISP_TCP_PORTS (default `80,443,9418`), WISP_UDP_PORTS (default `53`, empty
 * = no UDP), WISP_IP_BYTES_PER_SEC (default 4 MiB/s), WISP_GLOBAL_BYTES_PER_SEC (default 24 MiB/s), WISP_IP_CONNECTS_PER_SEC
 * (default 20); bursts are 8 s of the per-IP rate, 64 MiB for the relay, 5 s of connects.
 */
export function wispPolicyFromEnv(env: Record<string, string | undefined> = process.env): WispPolicy {
  const d = DEFAULT_WISP_POLICY;
  const ipRate = parseRate(env.WISP_IP_BYTES_PER_SEC, d.ipBytesPerSec);
  const globalRate = parseRate(env.WISP_GLOBAL_BYTES_PER_SEC, d.globalBytesPerSec);
  const connects = parseRate(env.WISP_IP_CONNECTS_PER_SEC, d.ipConnectsPerSec);
  return {
    tcpPorts: parsePorts(env.WISP_TCP_PORTS, d.tcpPorts),
    udpPorts: parsePorts(env.WISP_UDP_PORTS, d.udpPorts),
    ipBytesPerSec: ipRate,
    ipBurstBytes: Math.max(256 * 1024, ipRate * 8),
    globalBytesPerSec: globalRate,
    globalBurstBytes: Math.max(d.globalBurstBytes, globalRate * 2),
    ipConnectsPerSec: connects,
    ipConnectBurst: Math.max(10, connects * 5),
  };
}

/** A token bucket: `take(n)` spends n (may go into debt) and returns the wait until the debt is repaid [ms]; rate 0 = no cap. */
export class RateBucket {
  private tokens: number;
  private last: number;
  constructor(
    readonly rate: number,
    readonly burst: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }
  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
  }
  take(n: number): number {
    if (this.rate <= 0) return 0;
    this.refill();
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000;
  }
  /** The wait before the bucket is out of debt [ms]. */
  wait(): number {
    if (this.rate <= 0) return 0;
    this.refill();
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000;
  }
}

/** Resolves a host name to its addresses (default: the system resolver, every address). */
export type WispResolver = (host: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: WispResolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

export interface WispUpgradeOptions {
  enabled: boolean;
  maxClients?: number;
  maxStreamsPerClient?: number;
  maxClientsPerIp?: number;
  /** The client's address (server/address.ts `clientAddress`, or the socket's in dev). */
  clientIp?: string;
  /** Production: an upgrade must carry an Origin this accepts. Without it, the Origin must be the server's own host. */
  allowOrigin?: (origin: string) => boolean;
  policy?: WispPolicy;
  resolver?: WispResolver;
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
  /** Client→upstream bytes waiting (before the connection, or while the upstream write is blocked). */
  clientQueue: Uint8Array[];
  clientQueuedBytes: number;
  connected: boolean;
  /** The last upstream write returned false: everything waits for the stream's one drain handler. */
  writeBlocked: boolean;
  pausedByRelay: boolean;
  /** Client packets received since the last CONTINUE sent. */
  rxPacketsSinceCredit: number;
  closed: boolean;
}

interface IpState {
  sessions: number;
  bytes: RateBucket;
  connects: RateBucket;
}

export interface WispSession {
  kind: "wisp";
  ip: string;
  maxStreams: number;
  allowLoopbackForTest: boolean;
  policy: WispPolicy;
  resolver: WispResolver;
  streams: Map<number, WispStream>;
  ws: WispSocketLike | null;
  outQueue: Uint8Array[];
  outQueueHead: number;
  outQueuedBytes: number;
  /** Client→upstream bytes queued over all streams. */
  inQueuedBytes: number;
  /** The WebSocket is above its high-water mark. */
  wsBlocked: boolean;
  /** A rate cap is in debt. */
  rateBlocked: boolean;
  streamsPaused: boolean;
  drainTimer: ReturnType<typeof setTimeout> | null;
  rateTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

let activeClients = 0;
let activeStreams = 0;
let totalConnections = 0;
let totalStreams = 0;
let totalBytesIn = 0;
let totalBytesOut = 0;
let blockedHosts = 0;
let blockedPorts = 0;
let throttledStreams = 0;
let backpressurePauses = 0;
let ratePauses = 0;
let udpDropped = 0;
let wsSendRetries = 0;
const ipStates = new Map<string, IpState>();
let globalBucket: RateBucket | null = null;
let globalBucketPolicy: WispPolicy | null = null;

export function wispStats() {
  return {
    activeClients,
    activeStreams,
    totalConnections,
    totalStreams,
    totalBytesIn,
    totalBytesOut,
    blockedHosts,
    blockedPorts,
    throttledStreams,
    backpressurePauses,
    ratePauses,
    udpDropped,
    wsSendRetries,
  };
}

function globalBucketFor(policy: WispPolicy): RateBucket {
  if (!globalBucket || globalBucketPolicy !== policy) {
    globalBucket = new RateBucket(policy.globalBytesPerSec, policy.globalBurstBytes);
    globalBucketPolicy = policy;
  }
  return globalBucket;
}

/** Forget the IPs with no session left and no debt (their caps start full again). */
function pruneIpStates() {
  for (const [ip, st] of ipStates) if (st.sessions <= 0 && st.bytes.wait() === 0) ipStates.delete(ip);
}

function ipStateOf(session: WispSession): IpState {
  let s = ipStates.get(session.ip);
  if (!s) {
    s = {
      sessions: 0,
      bytes: new RateBucket(session.policy.ipBytesPerSec, session.policy.ipBurstBytes),
      connects: new RateBucket(session.policy.ipConnectsPerSec, session.policy.ipConnectBurst),
    };
    ipStates.set(session.ip, s);
  }
  return s;
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

/** Build a Wisp v1 CONNECT packet (client side; tests and tools). */
export function encodeConnect(streamId: number, streamType: number, port: number, host: string): Uint8Array {
  const hb = new TextEncoder().encode(host);
  const buf = new Uint8Array(8 + hb.byteLength);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, PKT_CONNECT);
  dv.setUint32(1, streamId, true);
  dv.setUint8(5, streamType);
  dv.setUint16(6, port, true);
  buf.set(hb, 8);
  return buf;
}

/** Parse a raw Wisp v1 client packet. Returns null if malformed. */
export function decodeWispPacket(
  raw: Uint8Array,
):
  | { type: "connect"; streamId: number; streamType: number; port: number; host: string }
  | { type: "data"; streamId: number; payload: Uint8Array }
  | { type: "continue"; streamId: number; remaining: number }
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
  if (type === PKT_CONTINUE) {
    if (raw.byteLength < 9) return null;
    return { type: "continue", streamId, remaining: dv.getUint32(5, true) };
  }
  if (type === PKT_CLOSE) {
    const reason = raw.byteLength >= 6 ? dv.getUint8(5) : CLOSE_NORMAL;
    return { type: "close", streamId, reason };
  }
  return null;
}

/** Whether a resolved/literal address may be reached (loopback only in the unit tests). */
function addressAllowed(allowLoopbackForTest: boolean, address: string): boolean {
  if (!isBlockedAddress(address)) return true;
  return allowLoopbackForTest && isLoopbackAddress(address);
}

/** Whether a port may be reached with this stream type. */
export function wispPortAllowed(policy: WispPolicy, streamType: number, port: number): boolean {
  if (WISP_DENIED_PORTS.has(port)) return false;
  return (streamType === STREAM_UDP ? policy.udpPorts : policy.tcpPorts).has(port);
}

/**
 * The address to connect to for `host`, checked: an IP literal (any spelling) is canonicalised and checked; a name is checked,
 * resolved, and the first allowed address returned. Null: refused (blocked), with `unreachable` when resolution failed.
 */
export async function resolveWispTarget(
  session: { allowLoopbackForTest: boolean; resolver: WispResolver },
  host: string,
): Promise<{ address: string; family: 4 | 6 } | { refused: "blocked" | "unreachable" }> {
  const loop = session.allowLoopbackForTest;
  const c = classifyHost(host);
  if (c.kind === "ipv4" || c.kind === "ipv6") {
    return addressAllowed(loop, c.text) ? { address: c.text, family: c.kind === "ipv4" ? 4 : 6 } : { refused: "blocked" };
  }
  if (c.kind === "numeric") return { refused: "blocked" };
  if (isBlockedName(c.text) && !(loop && c.text === "localhost")) return { refused: "blocked" };
  let list: { address: string; family: number }[];
  try {
    list = await session.resolver(c.text);
  } catch {
    return { refused: "unreachable" };
  }
  if (!list.length) return { refused: "unreachable" };
  // (IPv4 first: a container often has no IPv6 route out; the order is otherwise the resolver's)
  const ordered = [...list.filter((e) => !e.address.includes(":")), ...list.filter((e) => e.address.includes(":"))];
  for (const entry of ordered) {
    const e = classifyHost(entry.address);
    if ((e.kind === "ipv4" || e.kind === "ipv6") && addressAllowed(loop, e.text)) {
      return { address: e.text, family: e.kind === "ipv4" ? 4 : 6 };
    }
  }
  return { refused: "blocked" };
}

function applyPause(session: WispSession) {
  const paused = session.wsBlocked || session.rateBlocked;
  if (session.streamsPaused === paused) return;
  session.streamsPaused = paused;
  if (paused) backpressurePauses++;
  for (const s of session.streams.values()) {
    if (!s.tcp || s.closed) continue;
    if (paused && !s.pausedByRelay) {
      s.pausedByRelay = true;
      s.tcp.pause();
    } else if (!paused && s.pausedByRelay) {
      s.pausedByRelay = false;
      s.tcp.resume();
    }
  }
}

function setWsBlocked(session: WispSession, blocked: boolean) {
  session.wsBlocked = blocked;
  applyPause(session);
}

/** The wait before this session's rate caps are out of debt [ms]. */
function rateWait(session: WispSession): number {
  const ip = ipStates.get(session.ip);
  return Math.max(ip?.bytes.wait() ?? 0, globalBucketFor(session.policy).wait());
}

/** Spend `n` bytes from the session's caps; when in debt, pause its upstream reads and hold its credits until repaid. */
function chargeBytes(session: WispSession, n: number) {
  const wait = Math.max(ipStateOf(session).bytes.take(n), globalBucketFor(session.policy).take(n));
  if (wait > 0) scheduleRateResume(session, wait);
}

function scheduleRateResume(session: WispSession, waitMs: number) {
  if (session.closed) return;
  if (!session.rateBlocked) {
    ratePauses++;
    session.rateBlocked = true;
    applyPause(session);
  }
  if (session.rateTimer) return;
  session.rateTimer = setTimeout(
    () => {
      session.rateTimer = null;
      if (session.closed) return;
      const still = rateWait(session);
      if (still > 0) {
        scheduleRateResume(session, still);
        return;
      }
      session.rateBlocked = false;
      applyPause(session);
      flushWsOut(session);
      for (const s of session.streams.values()) maybeGrantCredit(session, s, true);
    },
    Math.min(1000, Math.max(5, Math.ceil(waitMs))),
  );
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

  while (session.outQueueHead < session.outQueue.length && !session.rateBlocked) {
    const buffered = ws.getBufferedAmount?.() ?? 0;
    if (buffered >= WISP_LIMITS.wsHighWaterBytes) {
      setWsBlocked(session, true);
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
      // Bun refused the frame (send buffer full): keep it at the head and retry after the drain
      wsSendRetries++;
      setWsBlocked(session, true);
      scheduleDrainPoll(session);
      return;
    }
    // ret > 0 (sent) or ret < 0 (accepted and queued in Bun's WebSocket buffer)
    session.outQueueHead++;
    session.outQueuedBytes -= frame.byteLength;
    // (the rate caps count what leaves: a DATA frame's payload, spent as it is sent; in debt, the next frames wait)
    if (frame[0] === PKT_DATA) chargeBytes(session, frame.byteLength - 5);
    if (ret < 0) {
      setWsBlocked(session, true);
      scheduleDrainPoll(session);
      break;
    }
    if (session.rateBlocked) break;
  }

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

  // Resume upstream reads only once the queue is empty AND the WebSocket's buffer is below the low-water mark
  if (session.outQueue.length === 0) {
    const buffered = ws.getBufferedAmount?.() ?? 0;
    if (buffered <= WISP_LIMITS.wsLowWaterBytes) {
      setWsBlocked(session, false);
    } else {
      setWsBlocked(session, true);
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
    // (production: an Origin is required — a browser always sends one; a script that forges it still meets the ports, the
    // address guard and the caps)
    if (!origin || !opts.allowOrigin(origin)) return new Response("forbidden", { status: 403 });
  } else if (foreignOrigin(req)) {
    return new Response("forbidden", { status: 403 });
  }
  const maxClients = opts.maxClients ?? WISP_LIMITS.maxClients;
  if (activeClients >= maxClients) return new Response("too many clients", { status: 429 });
  const ip = opts.clientIp || "local";
  if (ipStates.size > 256) pruneIpStates();
  const maxPerIp = opts.maxClientsPerIp ?? 12;
  if ((ipStates.get(ip)?.sessions ?? 0) >= maxPerIp) return new Response("too many connections from ip", { status: 429 });

  const ok = srv.upgrade(req, {
    data: {
      kind: "wisp",
      ip,
      maxStreams: opts.maxStreamsPerClient ?? WISP_LIMITS.maxStreamsPerClient,
      allowLoopbackForTest: Boolean(opts.allowLoopbackForTest),
      policy: opts.policy ?? DEFAULT_WISP_POLICY,
      resolver: opts.resolver ?? systemResolver,
      streams: new Map<number, WispStream>(),
      ws: null,
      outQueue: [],
      outQueueHead: 0,
      outQueuedBytes: 0,
      inQueuedBytes: 0,
      wsBlocked: false,
      rateBlocked: false,
      streamsPaused: false,
      drainTimer: null,
      rateTimer: null,
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
  ipStateOf(session).sessions++;
  // Wisp v1 handshake: server sends CONTINUE on stream 0 with initial buffer credit.
  enqueueWsFrame(session, encodeContinue(0, WISP_LIMITS.initialBuffer));
}

/** Must be wired to `Bun.serve({ websocket: { drain(ws) { wispDrain(ws); } } })` for full backpressure. */
export function wispDrain(ws: WispSocketLike) {
  const session = ws.data as WispSession;
  if (session?.kind !== "wisp") return;
  flushWsOut(session);
}

function dropClientQueue(session: WispSession, stream: WispStream) {
  session.inQueuedBytes = Math.max(0, session.inQueuedBytes - stream.clientQueuedBytes);
  stream.clientQueue.length = 0;
  stream.clientQueuedBytes = 0;
}

function closeStream(session: WispSession, streamId: number, reason: number, notifyClient: boolean) {
  const s = session.streams.get(streamId);
  if (!s || s.closed) return;
  s.closed = true;
  session.streams.delete(streamId);
  activeStreams = Math.max(0, activeStreams - 1);
  if (reason === CLOSE_THROTTLED) throttledStreams++;
  if (s.tcp) {
    try {
      s.tcp.removeAllListeners();
      s.tcp.on("error", () => {});
      s.tcp.destroy();
    } catch {
      // ignore
    }
    s.tcp = undefined;
  }
  if (s.udp) {
    try {
      s.udp.removeAllListeners();
      s.udp.close();
    } catch {
      // ignore
    }
    s.udp = undefined;
  }
  dropClientQueue(session, s);
  // CLOSE goes through the FIFO, after every DATA frame queued before it
  if (notifyClient) enqueueWsFrame(session, encodeClose(streamId, reason));
}

/**
 * Grant the client a new window of credits when the stream can take it: connected, not blocked upstream, nothing queued,
 * rate caps not in debt, and at least half a window used (`force`: any packet used — after an unblock, so a client
 * waiting at zero credit always resumes).
 */
function maybeGrantCredit(session: WispSession, stream: WispStream, force = false) {
  if (stream.closed || !stream.connected || session.closed) return;
  if (stream.writeBlocked || stream.clientQueue.length > 0) return;
  if (stream.rxPacketsSinceCredit === 0) return;
  if (!force && stream.rxPacketsSinceCredit < WISP_LIMITS.initialBuffer / 2) return;
  const wait = rateWait(session);
  if (wait > 0) {
    scheduleRateResume(session, wait);
    return;
  }
  stream.rxPacketsSinceCredit = 0;
  enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
}

/** Write the stream's queue upstream until empty or the socket's buffer is full. */
function flushClientQueue(session: WispSession, stream: WispStream) {
  const sock = stream.tcp;
  if (!sock || !stream.connected || stream.closed) return;
  while (stream.clientQueue.length > 0 && !stream.writeBlocked) {
    const chunk = stream.clientQueue.shift()!;
    stream.clientQueuedBytes -= chunk.byteLength;
    session.inQueuedBytes = Math.max(0, session.inQueuedBytes - chunk.byteLength);
    if (!sock.write(chunk)) stream.writeBlocked = true;
  }
}

function queueClientData(session: WispSession, stream: WispStream, payload: Uint8Array): boolean {
  if (
    stream.clientQueuedBytes + payload.byteLength > WISP_LIMITS.maxStreamQueueBytes ||
    session.inQueuedBytes + payload.byteLength > WISP_LIMITS.maxSessionQueueBytes
  ) {
    return false;
  }
  const copy = new Uint8Array(payload.byteLength);
  copy.set(payload);
  stream.clientQueue.push(copy);
  stream.clientQueuedBytes += copy.byteLength;
  session.inQueuedBytes += copy.byteLength;
  return true;
}

function deliverUpstream(session: WispSession, stream: WispStream, bytes: Uint8Array) {
  totalBytesOut += bytes.byteLength;
  const MAX = WISP_LIMITS.maxFrameBytes;
  for (let off = 0; off < bytes.byteLength; off += MAX) {
    enqueueWsFrame(session, encodeData(stream.id, bytes.subarray(off, Math.min(off + MAX, bytes.byteLength))));
  }
}

function openTcpStream(session: WispSession, stream: WispStream, address: string, port: number) {
  const sock = net.createConnection({ host: address, port });
  stream.tcp = sock;
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 30_000);
  sock.setTimeout(WISP_LIMITS.connectTimeoutMs);
  if (session.streamsPaused) {
    stream.pausedByRelay = true;
    sock.pause();
  }

  sock.on("connect", () => {
    sock.setTimeout(0);
    if (stream.closed || session.closed) {
      sock.destroy();
      return;
    }
    stream.connected = true;
    flushClientQueue(session, stream);
    // (the first window of this stream, the packets sent before the connection already counted)
    if (!stream.writeBlocked && stream.clientQueue.length === 0) {
      stream.rxPacketsSinceCredit = 0;
      enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
    }
  });

  // The stream's ONE drain handler: unblock, flush what queued, then the credits the client waits for.
  sock.on("drain", () => {
    if (stream.closed) return;
    stream.writeBlocked = false;
    flushClientQueue(session, stream);
    maybeGrantCredit(session, stream, true);
  });

  sock.on("timeout", () => {
    if (!stream.connected) closeStream(session, stream.id, CLOSE_TIMEOUT, true);
  });

  sock.on("data", (buf: Buffer) => {
    if (stream.closed || session.closed) return;
    deliverUpstream(session, stream, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  });

  sock.on("end", () => closeStream(session, stream.id, CLOSE_NORMAL, true));
  sock.on("close", () => closeStream(session, stream.id, CLOSE_NORMAL, true));
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

function openUdpStream(session: WispSession, stream: WispStream, address: string, family: 4 | 6, port: number) {
  const udp = dgram.createSocket(family === 6 ? "udp6" : "udp4");
  stream.udp = udp;
  stream.udpHost = address;
  stream.udpPort = port;
  udp.on("error", () => closeStream(session, stream.id, CLOSE_UNREACHABLE, true));
  udp.on("message", (msg, rinfo) => {
    if (stream.closed || session.closed) return;
    // (the socket is connected — the kernel already filters — but a datagram from anyone else is never relayed)
    if (rinfo.address !== address || rinfo.port !== port) {
      udpDropped++;
      return;
    }
    // (datagrams are droppable: never queued past the session's cap, nor while a rate cap is in debt)
    if (session.outQueuedBytes > WISP_LIMITS.maxSessionOutBytes || rateWait(session) > 0) {
      udpDropped++;
      return;
    }
    deliverUpstream(session, stream, new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
  });
  udp.connect(port, address, () => {
    if (stream.closed || session.closed) return;
    stream.connected = true;
    while (stream.clientQueue.length > 0) {
      const payload = stream.clientQueue.shift()!;
      stream.clientQueuedBytes -= payload.byteLength;
      session.inQueuedBytes = Math.max(0, session.inQueuedBytes - payload.byteLength);
      udp.send(payload);
    }
    stream.rxPacketsSinceCredit = 0;
    enqueueWsFrame(session, encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
  });
}

function refuseConnect(session: WispSession, streamId: number, reason: number) {
  enqueueWsFrame(session, encodeClose(streamId, reason));
}

function handleConnect(session: WispSession, pkt: { streamId: number; streamType: number; port: number; host: string }) {
  if (pkt.streamId === 0 || (pkt.streamType !== STREAM_TCP && pkt.streamType !== STREAM_UDP)) {
    refuseConnect(session, pkt.streamId, CLOSE_INVALID);
    return;
  }
  if (!wispPortAllowed(session.policy, pkt.streamType, pkt.port)) {
    blockedPorts++;
    refuseConnect(session, pkt.streamId, CLOSE_BLOCKED);
    return;
  }
  // (a first check on the text, before any resolution: literals of any spelling, numeric forms, local names)
  if (isBlockedHost(pkt.host) && !(session.allowLoopbackForTest && (isLoopbackAddress(pkt.host) || pkt.host === "localhost"))) {
    blockedHosts++;
    refuseConnect(session, pkt.streamId, CLOSE_BLOCKED);
    return;
  }
  if (session.streams.size >= session.maxStreams || ipStateOf(session).connects.take(1) > 0) {
    refuseConnect(session, pkt.streamId, CLOSE_THROTTLED);
    return;
  }
  if (session.streams.has(pkt.streamId)) closeStream(session, pkt.streamId, CLOSE_NORMAL, false);
  totalStreams++;
  activeStreams++;
  const stream: WispStream = {
    id: pkt.streamId,
    kind: pkt.streamType === STREAM_UDP ? "udp" : "tcp",
    clientQueue: [],
    clientQueuedBytes: 0,
    connected: false,
    writeBlocked: false,
    pausedByRelay: false,
    rxPacketsSinceCredit: 0,
    closed: false,
  };
  session.streams.set(pkt.streamId, stream);
  void resolveWispTarget(session, pkt.host).then((target) => {
    if (stream.closed || session.closed) return;
    if ("refused" in target) {
      if (target.refused === "blocked") blockedHosts++;
      closeStream(session, stream.id, target.refused === "blocked" ? CLOSE_BLOCKED : CLOSE_UNREACHABLE, true);
      return;
    }
    if (stream.kind === "udp") openUdpStream(session, stream, target.address, target.family, pkt.port);
    else openTcpStream(session, stream, target.address, pkt.port);
  });
}

function handleData(session: WispSession, stream: WispStream, payload: Uint8Array) {
  totalBytesIn += payload.byteLength;
  stream.rxPacketsSinceCredit++;
  chargeBytes(session, payload.byteLength);
  if (stream.kind === "udp") {
    if (payload.byteLength > WISP_LIMITS.maxUdpDatagram) return;
    if (stream.udp && stream.connected) stream.udp.send(payload);
    else if (!queueClientData(session, stream, payload)) {
      closeStream(session, stream.id, CLOSE_THROTTLED, true);
      return;
    }
    maybeGrantCredit(session, stream);
    return;
  }
  if (stream.tcp && stream.connected && !stream.writeBlocked && stream.clientQueue.length === 0) {
    if (!stream.tcp.write(payload)) stream.writeBlocked = true;
  } else if (!queueClientData(session, stream, payload)) {
    // (a client that keeps sending past its credits while the upstream is blocked)
    closeStream(session, stream.id, CLOSE_THROTTLED, true);
    return;
  }
  maybeGrantCredit(session, stream);
}

export function wispMessage(ws: { data: unknown }, msg: string | ArrayBuffer | Uint8Array) {
  const session = ws.data as WispSession;
  if (session.closed) return;
  const raw =
    typeof msg === "string" ? new TextEncoder().encode(msg) : msg instanceof Uint8Array ? msg : new Uint8Array(msg);
  const pkt = decodeWispPacket(raw);
  if (!pkt) return;
  if (pkt.type === "connect") {
    handleConnect(session, pkt);
    return;
  }
  if (pkt.type === "data") {
    const stream = session.streams.get(pkt.streamId);
    if (!stream || stream.closed) return;
    handleData(session, stream, pkt.payload);
    return;
  }
  if (pkt.type === "close") closeStream(session, pkt.streamId, pkt.reason, false);
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
  if (session.rateTimer) {
    clearTimeout(session.rateTimer);
    session.rateTimer = null;
  }
  session.outQueue.length = 0;
  session.outQueueHead = 0;
  session.outQueuedBytes = 0;
  activeClients = Math.max(0, activeClients - 1);
  const st = ipStates.get(session.ip);
  if (st) {
    st.sessions--;
    // (the IP's buckets kept while in debt, so reconnecting does not reset a cap)
    if (st.sessions <= 0 && st.bytes.wait() === 0) ipStates.delete(session.ip);
  }
  for (const id of [...session.streams.keys()]) closeStream(session, id, CLOSE_NORMAL, false);
}
