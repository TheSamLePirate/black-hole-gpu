// The network's protocol (docs/PLAN-RESEAU.md), shared by the page, the room server (server/rooms.ts) and the
// bot (src/net/bot.ts): JSON text frames for the room's business (rare, reliable), binary frames for the
// craft's samples (many, droppable). Nothing here imports the game: the server's image copies src/net/ alone.

/** the protocol's version: the server takes this one and the one before, an older page is told to reload */
export const PROTO_VERSION = 1;
export const PROTO_MIN = PROTO_VERSION - 1;

/** a room's devices and pilots at most */
export const MAX_DEVICES = 8;
export const MAX_PILOTS = 4;

export type Role = "pilot" | "spectator" | "instruments";

/** a room's clock: its time t [s, the scene's coordinate time] = t0 + warp · (server's ms − h0) / 1000 */
export interface RoomClock {
  t0: number;
  h0: number;
  warp: number;
}

export const roomTime = (c: RoomClock, serverMs: number) => c.t0 + (c.warp * (serverMs - c.h0)) / 1000;

export interface Member {
  slot: number;
  name: string;
  colour: string;
  role: Role;
  /** the device's id (stable across its visits: a reconnection takes its own slot back) */
  device: string;
}

export interface RoomInfo {
  code: string;
  name: string;
  members: number;
  hasPassword: boolean;
  used: number;
}

// ---- the page → the server (text frames). `id`: the request's, echoed in its answer's `re`
export type ClientMsg =
  | { type: "hello"; v: number; build: string; device: string; name: string; colour: string }
  | { type: "ping"; c: number }
  | { type: "create"; id: number; name: string; password?: string; t: number }
  | { type: "join"; id: number; code: string; role: Role; password?: string }
  | { type: "leave" }
  | { type: "delete"; id: number; code: string; owner: string }
  | { type: "info"; id: number; codes: string[] }
  | { type: "profile"; name: string; colour: string }
  | { type: "event"; ev: NetEvent };

// ---- the server → the page
export type ServerMsg =
  | { type: "welcome"; v: number; build: string; s: number }
  | { type: "pong"; c: number; s: number }
  | { type: "created"; re: number; code: string; owner: string }
  | { type: "joined"; re: number; code: string; name: string; slot: number; clock: RoomClock; members: Member[] }
  | { type: "deleted"; re: number; code: string }
  | { type: "info"; re: number; rooms: RoomInfo[] }
  | { type: "roster"; members: Member[] }
  | { type: "event"; from: number; ev: NetEvent }
  | { type: "error"; re?: number; code: ErrorCode; msg: string };

export type ErrorCode = "update" | "unknown-room" | "full" | "pilots-full" | "password" | "owner" | "bad" | "not-in-room" | "limit";

/** a reliable event relayed to the room (a shot, a hit, a spawn…; R1+ fill it in) */
export interface NetEvent {
  kind: string;
  [k: string]: unknown;
}

// ---- the binary samples
export const MSG_CRAFT = 1;

/** the sample's frame: fixed to its body (near it: ECEF on the Earth), or inertial centred on it */
export const FRAME_FIXED = 0;
export const FRAME_INERTIAL = 1;

/** the bodies a sample can name (index on the wire; 255: another) */
export const BODIES = ["earth", "moon", "sun", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
/** the crafts' kinds (vessels.ts VesselId) */
export const KINDS = ["ranger", "lander", "endurance", "f35"] as const;

/** flags of a sample */
export const F_GROUND = 1,
  F_PARKED = 2,
  F_LIGHTS = 4,
  F_AFTERBURNER = 8,
  F_DESTROYED = 16,
  F_PLASMA = 32;

/** what a craft shows besides its pose (enough to pose an F-35 and draw its plume and its vapour) */
export interface Visual {
  /** throttle 0–1, boost (afterburner) 0–2.5 */
  throttle: number;
  boost: number;
  /** gear extended, flaps, air brake 0–1 */
  gear: number;
  flaps: number;
  brake: number;
  /** STOVL conversion, lift fan 0–1; the nozzle's swivel [°] */
  stovl: number;
  fan: number;
  nozzle: number;
  /** the stick, −1–1 */
  stickX: number;
  stickY: number;
  /** angle of attack [°], lift coefficient, Mach */
  alpha: number;
  cl: number;
  mach: number;
}

export interface CraftSample {
  /** the sender's slot (stamped by the server) */
  slot: number;
  seq: number;
  /** the room's time [s] */
  t: number;
  frame: number;
  body: number;
  kind: number;
  flags: number;
  /**
   * position [m] (float64), velocity [m/s], attitude (quaternion x, y, z, w: the craft's axes — x forward, y up,
   * z right — turned into the frame's), angular velocity [rad/s, the frame's axes], acceleration [m/s²]
   */
  p: [number, number, number];
  v: [number, number, number];
  q: [number, number, number, number];
  w: [number, number, number];
  a: [number, number, number];
  vis: Visual;
}

export const CRAFT_BYTES = 100;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 0));
const u8 = (x: number, scale: number) => Math.round(clamp(x * scale, 0, 255));
const i8 = (x: number, scale: number) => Math.round(clamp(x * scale, -127, 127));

/** A craft's sample on the wire: 100 bytes, little-endian. */
export function encodeCraft(s: CraftSample): ArrayBuffer {
  const b = new ArrayBuffer(CRAFT_BYTES);
  const d = new DataView(b);
  d.setUint8(0, MSG_CRAFT);
  d.setUint8(1, s.slot & 255);
  d.setUint16(2, s.seq & 0xffff, true);
  d.setFloat64(4, s.t, true);
  d.setUint8(12, s.frame);
  d.setUint8(13, s.body);
  d.setUint8(14, s.kind);
  d.setUint8(15, s.flags);
  for (let k = 0; k < 3; k++) d.setFloat64(16 + 8 * k, s.p[k]!, true);
  for (let k = 0; k < 3; k++) d.setFloat32(40 + 4 * k, s.v[k]!, true);
  // (the attitude: 4 × int16, a 3e-5 rad step)
  const [qx, qy, qz, qw] = s.q;
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  const sg = qw < 0 ? -1 : 1;
  [qx, qy, qz, qw].forEach((c, k) => d.setInt16(52 + 2 * k, Math.round(((c * sg) / n) * 32767), true));
  for (let k = 0; k < 3; k++) d.setFloat32(60 + 4 * k, s.w[k]!, true);
  for (let k = 0; k < 3; k++) d.setFloat32(72 + 4 * k, s.a[k]!, true);
  const V = s.vis;
  d.setUint8(84, u8(V.throttle, 255));
  d.setUint8(85, u8(V.boost, 100));
  d.setUint8(86, u8(V.gear, 255));
  d.setUint8(87, u8(V.flaps, 255));
  d.setUint8(88, u8(V.brake, 255));
  d.setUint8(89, u8(V.stovl, 255));
  d.setUint8(90, u8(V.fan, 255));
  d.setInt8(91, i8(V.nozzle, 1));
  d.setInt8(92, i8(V.stickX, 127));
  d.setInt8(93, i8(V.stickY, 127));
  d.setInt16(94, Math.round(clamp(V.alpha * 100, -32767, 32767)), true);
  d.setInt16(96, Math.round(clamp(V.cl * 1000, -32767, 32767)), true);
  d.setUint16(98, Math.round(clamp(V.mach * 1000, 0, 65535)), true);
  return b;
}

export function decodeCraft(b: ArrayBuffer | Uint8Array): CraftSample | null {
  const buf = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (buf.byteLength < CRAFT_BYTES || buf[0] !== MSG_CRAFT) return null;
  const d = new DataView(buf.buffer, buf.byteOffset, CRAFT_BYTES);
  const f3 = (o: number): [number, number, number] => [d.getFloat32(o, true), d.getFloat32(o + 4, true), d.getFloat32(o + 8, true)];
  const q = [0, 1, 2, 3].map((k) => d.getInt16(52 + 2 * k, true) / 32767) as [number, number, number, number];
  const n = Math.hypot(...q) || 1;
  return {
    slot: d.getUint8(1),
    seq: d.getUint16(2, true),
    t: d.getFloat64(4, true),
    frame: d.getUint8(12),
    body: d.getUint8(13),
    kind: d.getUint8(14),
    flags: d.getUint8(15),
    p: [d.getFloat64(16, true), d.getFloat64(24, true), d.getFloat64(32, true)],
    v: f3(40),
    q: q.map((c) => c / n) as [number, number, number, number],
    w: f3(60),
    a: f3(72),
    vis: {
      throttle: d.getUint8(84) / 255,
      boost: d.getUint8(85) / 100,
      gear: d.getUint8(86) / 255,
      flaps: d.getUint8(87) / 255,
      brake: d.getUint8(88) / 255,
      stovl: d.getUint8(89) / 255,
      fan: d.getUint8(90) / 255,
      nozzle: d.getInt8(91),
      stickX: d.getInt8(92) / 127,
      stickY: d.getInt8(93) / 127,
      alpha: d.getInt16(94, true) / 100,
      cl: d.getInt16(96, true) / 1000,
      mach: d.getUint16(98, true) / 1000,
    },
  };
}

export const emptyVisual = (): Visual => ({
  throttle: 0,
  boost: 0,
  gear: 0,
  flaps: 0,
  brake: 0,
  stovl: 0,
  fan: 0,
  nozzle: 0,
  stickX: 0,
  stickY: 0,
  alpha: 0,
  cl: 0,
  mach: 0,
});

/** A room's code: 6 letters and digits, the ambiguous ones (0 O 1 I L) left out. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const isCode = (s: string) => new RegExp(`^[${CODE_ALPHABET}]{6}$`).test(s);
export const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
