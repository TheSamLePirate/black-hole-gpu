// A player without a screen (docs/PLAN-RESEAU.md, « Tests »): it joins a room and flies a circle over
// Edwards — an F-35 at 3 km, 200 m/s, banked into its turn —, its samples sent 30 times a second, as a page
// would. For the tests and to try the network alone:
//   bun src/net/bot.ts --room CODE [--url ws://localhost:3000/net] [--name Bot] [--rate 30]

import { NetClient } from "./client";
import { BODIES, emptyVisual, FRAME_FIXED, KINDS } from "./proto";

type V3 = [number, number, number];

/** WGS84: geodetic → ECEF [m] */
export function ecef(latDeg: number, lonDeg: number, h: number): V3 {
  const a = 6378137,
    f = 1 / 298.257223563,
    e2 = f * (2 - f);
  const la = (latDeg * Math.PI) / 180,
    lo = (lonDeg * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la)];
}

/** the local east, north, up at a place (ECEF unit vectors) */
export function enuAxes(latDeg: number, lonDeg: number): { e: V3; n: V3; u: V3 } {
  const la = (latDeg * Math.PI) / 180,
    lo = (lonDeg * Math.PI) / 180;
  return {
    e: [-Math.sin(lo), Math.cos(lo), 0],
    n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    u: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  };
}

/** the quaternion of a rotation whose columns are the craft's forward, up and right */
export function quatFromAxes(f: V3, u: V3, r: V3): [number, number, number, number] {
  // m[row][col]: columns x = f, y = u, z = r
  const m00 = f[0],
    m01 = u[0],
    m02 = r[0],
    m10 = f[1],
    m11 = u[1],
    m12 = r[1],
    m20 = f[2],
    m21 = u[2],
    m22 = r[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lin = (e: V3, n: V3, u: V3, x: number, y: number, z: number): V3 => [
  e[0] * x + n[0] * y + u[0] * z,
  e[1] * x + n[1] * y + u[1] * z,
  e[2] * x + n[2] * y + u[2] * z,
];

export interface BotFlight {
  lat: number;
  lon: number;
  alt: number;
  radius: number;
  speed: number;
}

export const EDWARDS: BotFlight = { lat: 34.905, lon: -117.884, alt: 3000, radius: 3000, speed: 200 };

/** The bot's craft at the room's time t: on its circle, its velocity, its acceleration, banked. */
export function botState(t: number, F: BotFlight = EDWARDS) {
  const { e, n, u } = enuAxes(F.lat, F.lon);
  const c = ecef(F.lat, F.lon, F.alt);
  const om = F.speed / F.radius;
  const th = om * t;
  const p = add(c, lin(e, n, u, F.radius * Math.cos(th), F.radius * Math.sin(th), 0));
  const v = lin(e, n, u, -F.speed * Math.sin(th), F.speed * Math.cos(th), 0);
  const a = lin(e, n, u, -F.speed * om * Math.cos(th), -F.speed * om * Math.sin(th), 0);
  // (banked into the turn: tan φ = v ω / g)
  const bank = Math.atan((F.speed * om) / 9.81);
  const fwd = lin(e, n, u, -Math.sin(th), Math.cos(th), 0);
  const inward = lin(e, n, u, -Math.cos(th), -Math.sin(th), 0);
  const up = add(lin(e, n, u, 0, 0, Math.cos(bank)), inward, Math.sin(bank));
  const right: V3 = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
  return { p, v, a, q: quatFromAxes(fwd, up, right), w: lin(e, n, u, 0, 0, om) };
}

export interface BotOptions {
  url: string;
  room: string;
  name?: string;
  rate?: number;
  flight?: BotFlight;
}

/** Joins the room and flies; returns its client and its stop. */
export async function runBot(o: BotOptions) {
  const net = new NetClient({
    url: o.url,
    build: "bot",
    id: { device: `bot-${o.name ?? "bot"}-${Math.random().toString(36).slice(2, 8)}`, name: o.name ?? "Bot", colour: "#ffcc33" },
  });
  await net.join(o.room, "pilot");
  const timer = setInterval(
    () => {
      const t = net.roomNow();
      if (!Number.isFinite(t)) return;
      const s = botState(t, o.flight);
      net.sendCraft({
        t,
        frame: FRAME_FIXED,
        body: BODIES.indexOf("earth"),
        kind: KINDS.indexOf("f35"),
        flags: 0,
        ...s,
        vis: { ...emptyVisual(), throttle: 0.8, mach: 0.6, alpha: 4, cl: 0.4 },
      });
    },
    1000 / (o.rate ?? 30),
  );
  return {
    net,
    stop: () => {
      clearInterval(timer);
      net.close();
    },
  };
}

if (import.meta.main) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const room = arg("room");
  if (!room) {
    console.error("bun src/net/bot.ts --room CODE [--url ws://localhost:3000/net] [--name Bot] [--rate 30]");
    process.exit(1);
  }
  const bot = await runBot({ url: arg("url") ?? "ws://localhost:3000/net", room, name: arg("name"), rate: Number(arg("rate") ?? 30) });
  console.log(`bot in ${room} (slot ${bot.net.room?.slot}), flying over Edwards — Ctrl+C to stop`);
  process.on("SIGINT", () => {
    bot.stop();
    process.exit(0);
  });
}
