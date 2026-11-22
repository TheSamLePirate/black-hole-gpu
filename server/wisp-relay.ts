// Dev-only Wisp v1 WebSocket-to-TCP relay (docs/PLAN-LINUX-OBC.md §6).
// Implements the 4 Wisp v1 packet types (CONNECT=0x01, DATA=0x02, CONTINUE=0x03, CLOSE=0x04)
// using Bun's native TCP socket API (`Bun.connect`), bounded per client and strictly restricted
// to same-origin pages in local development via `foreignOrigin(req)`.

import type { Socket } from "bun";
import { foreignOrigin } from "./ear-relay";

const PKT_CONNECT = 0x01;
const PKT_DATA = 0x02;
const PKT_CONTINUE = 0x03;
const PKT_CLOSE = 0x04;

const STREAM_TCP = 0x01;
const CLOSE_NORMAL = 0x02;
const CLOSE_REFUSED = 0x43;
const CLOSE_UNREACHABLE = 0x42;
const CLOSE_INVALID = 0x03;
const CLOSE_THROTTLED = 0x44;

export const WISP_LIMITS = {
  maxClients: 4,
  maxStreamsPerClient: 32,
  initialBuffer: 128,
  maxHostLen: 253,
  maxQueueBytes: 512 * 1024,
} as const;

export interface WispStream {
  id: number;
  socket?: Socket<WispSocketCtx>;
  queue: Uint8Array[];
  queuedBytes: number;
  closed: boolean;
}

export interface WispSession {
  kind: "wisp";
  streams: Map<number, WispStream>;
  send(data: Uint8Array): void;
}

interface WispSocketCtx {
  session: WispSession;
  stream: WispStream;
}

let activeClients = 0;

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

/** Check whether a host is a blocked link-local/metadata address (cloud metadata safety). */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "169.254.169.254" || h === "metadata.google.internal" || h.startsWith("169.254.");
}

export function wispUpgrade(
  req: Request,
  srv: { upgrade(r: Request, o: { data: unknown }): boolean },
  enabled: boolean,
): Response | undefined {
  if (!enabled) return new Response("disabled", { status: 404 });
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ ok: true, protocol: "wisp/1", clients: activeClients });
  }
  if (foreignOrigin(req)) return new Response("forbidden", { status: 403 });
  if (activeClients >= WISP_LIMITS.maxClients) return new Response("too many clients", { status: 429 });
  const ok = srv.upgrade(req, {
    data: {
      kind: "wisp",
      streams: new Map<number, WispStream>(),
      send: () => {},
    } satisfies WispSession,
  });
  return ok ? undefined : new Response("upgrade failed", { status: 400 });
}

export function wispOpen(ws: { data: unknown; send(d: Uint8Array): unknown }) {
  activeClients++;
  const session = ws.data as WispSession;
  session.send = (d: Uint8Array) => {
    try {
      ws.send(d);
    } catch {
      // socket already closed
    }
  };
  // Wisp v1 handshake: server sends CONTINUE on stream 0 with initial buffer credit.
  session.send(encodeContinue(0, WISP_LIMITS.initialBuffer));
}

function closeStream(session: WispSession, streamId: number, reason: number, notifyClient: boolean) {
  const s = session.streams.get(streamId);
  if (!s || s.closed) return;
  s.closed = true;
  session.streams.delete(streamId);
  try {
    s.socket?.end();
  } catch {
    // ignore
  }
  s.queue.length = 0;
  if (notifyClient) session.send(encodeClose(streamId, reason));
}

export function wispMessage(ws: { data: unknown }, msg: string | ArrayBuffer | Uint8Array) {
  const session = ws.data as WispSession;
  const raw =
    typeof msg === "string"
      ? new TextEncoder().encode(msg)
      : msg instanceof Uint8Array
        ? msg
        : new Uint8Array(msg);
  const pkt = decodeWispPacket(raw);
  if (!pkt) return;

  if (pkt.type === "connect") {
    if (pkt.streamId === 0 || pkt.streamType !== STREAM_TCP) {
      session.send(encodeClose(pkt.streamId, CLOSE_INVALID));
      return;
    }
    if (isBlockedHost(pkt.host)) {
      session.send(encodeClose(pkt.streamId, CLOSE_REFUSED));
      return;
    }
    if (session.streams.size >= WISP_LIMITS.maxStreamsPerClient) {
      session.send(encodeClose(pkt.streamId, CLOSE_THROTTLED));
      return;
    }
    if (session.streams.has(pkt.streamId)) {
      closeStream(session, pkt.streamId, CLOSE_NORMAL, false);
    }
    const stream: WispStream = { id: pkt.streamId, queue: [], queuedBytes: 0, closed: false };
    session.streams.set(pkt.streamId, stream);
    void Bun.connect<WispSocketCtx>({
      hostname: pkt.host,
      port: pkt.port,
      data: { session, stream },
      socket: {
        open(socket) {
          if (stream.closed) {
            socket.end();
            return;
          }
          stream.socket = socket;
          for (const chunk of stream.queue) socket.write(chunk);
          stream.queue.length = 0;
          stream.queuedBytes = 0;
          session.send(encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
        },
        data(_socket, chunk) {
          if (stream.closed) return;
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          session.send(encodeData(stream.id, bytes));
        },
        close() {
          closeStream(session, stream.id, CLOSE_NORMAL, true);
        },
        error() {
          closeStream(session, stream.id, CLOSE_UNREACHABLE, true);
        },
        connectError() {
          closeStream(session, stream.id, CLOSE_REFUSED, true);
        },
      },
    }).catch(() => {
      closeStream(session, stream.id, CLOSE_REFUSED, true);
    });
    return;
  }

  if (pkt.type === "data") {
    const stream = session.streams.get(pkt.streamId);
    if (!stream || stream.closed) return;
    if (stream.socket) {
      stream.socket.write(pkt.payload);
      session.send(encodeContinue(stream.id, WISP_LIMITS.initialBuffer));
    } else if (stream.queuedBytes + pkt.payload.byteLength <= WISP_LIMITS.maxQueueBytes) {
      const copy = new Uint8Array(pkt.payload.byteLength);
      copy.set(pkt.payload);
      stream.queue.push(copy);
      stream.queuedBytes += copy.byteLength;
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
  activeClients = Math.max(0, activeClients - 1);
  const session = ws.data as WispSession;
  for (const id of [...session.streams.keys()]) {
    closeStream(session, id, CLOSE_NORMAL, false);
  }
}
