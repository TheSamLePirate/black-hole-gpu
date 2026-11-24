// A real aircraft's landing through the gap in its reports (controller/traffic.ts; ported from the worktree-airliners-runway
// branch of 29 Oct 2026, 24 Nov 2026): the receivers lose an airliner
// some 50–120 m over the field, and hear it again — if at all — rolling, off the runway already, on a taxiway; a path
// through what is heard cuts across the grass from its last report on final to its first on the ground. Its landing
// put back where it was: the runway its last report lines up with (its track within 20°, within 400 m of its axis,
// short of its middle), and reports made up along it — down its axis at its descent's slope onto the runway, its
// touchdown, its rollout braking to a taxi —, to where it left it for its first report heard on the ground (or to a
// stop, none heard). Their timeline fitted to the reports heard about them.

import type { Plane } from "../../server/traffic";
import type { RunwayFrame } from "../game/sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";

const D = Math.PI / 180;
type V3 = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

export const LANDING = {
  /** its last report this low over its wheels' rest at most [m], descending this fast at least [m/s] */
  low: 250,
  sink: 1,
  /** its reports this far apart at least [s]: a gap (closer, what is heard is its landing) */
  gap: 8,
  /** lined up: its track within this of the runway's [°], this near its axis [m] */
  trk: 20,
  cross: 400,
  /** the descent's slope [°] at most and at least, the touchdown this far past the threshold at least [m]; the flare
   *  from this high [m] over the wheels' rest, the sink at touchdown [m/s] */
  slopeMax: 4,
  slopeMin: 2,
  touch: 300,
  flare: 12,
  sinkTd: 0.8,
  /** the rollout's braking [m/s²] — the reversers' and the autobrake's down to `vRev` [m/s], the wheel brakes' after —,
   *  the taxi's speed [m/s], the turn-off's radius [m]; a made-up report every this many [s] */
  brake: 2.6,
  brakeLow: 1.2,
  vRev: 35,
  taxi: 12,
  turnR: 150,
  every: 3,
} as const;

/** A runway as it is landed on: its threshold [m, fixed to the Earth, on the ellipsoid], its direction, its right, its
 *  length [m], its true heading [°], half its width [m]. */
export interface Way {
  key: string;
  o: V3;
  d: V3;
  r: V3;
  len: number;
  hdg: number;
  halfWidth: number;
}

/** each runway's two ways, made once (a frame's runways are kept objects: game/sites.ts EARTH_RUNWAYS) */
const waysMade = new WeakMap<RunwayFrame, Way[]>();
/** Its two ways (landing either end). */
export function waysOf(R: RunwayFrame): Way[] {
  const had = waysMade.get(R);
  if (had) return had;
  const w = makeWays(R);
  waysMade.set(R, w);
  return w;
}
function makeWays(R: RunwayFrame): Way[] {
  const o = R.origin as V3,
    a = R.along as V3,
    c = R.across as V3;
  const far: V3 = [o[0] + a[0] * R.len, o[1] + a[1] * R.len, o[2] + a[2] * R.len];
  const g = cartToGeodetic(WGS84_A, WGS84_F, o);
  // (its heading: its direction on the local east and north)
  const E = [-Math.sin(g.lon), Math.cos(g.lon), 0],
    N = [-Math.sin(g.lat) * Math.cos(g.lon), -Math.sin(g.lat) * Math.sin(g.lon), Math.cos(g.lat)];
  const h = Math.atan2(dot(a, E), dot(a, N)) / D;
  const name = R.world ? `${R.world.field}:${R.site.name}` : R.site.name;
  return [
    { key: `${name}>`, o, d: a, r: c, len: R.len, hdg: (h + 360) % 360, halfWidth: R.halfWidth },
    {
      key: `${name}<`,
      o: far,
      d: [-a[0], -a[1], -a[2]],
      r: [-c[0], -c[1], -c[2]],
      len: R.len,
      hdg: (h + 540) % 360,
      halfWidth: R.halfWidth,
    },
  ];
}

const fixed = (q: { lat: number; lon: number }) => geodeticToCart(WGS84_A, WGS84_F, q.lat * D, q.lon * D, 0) as V3;
const geo = (p: V3) => {
  const g = cartToGeodetic(WGS84_A, WGS84_F, p);
  return { lat: g.lat / D, lon: g.lon / D };
};
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * The descent from `h0` [m over the wheels' rest] to the runway: on the slope `k` (its tangent) down to the flare's
 * height, then the flare — a parabola joined to the slope at its top (C¹), its slope at the ground `k0` (the sink at
 * touchdown over the speed). `x`: how far it runs [m]; `xf`: the flare's length; `h(d)`: the height `d` short of the
 * touchdown.
 */
export function descent(h0: number, k: number, k0: number) {
  const hf = Math.min(LANDING.flare, h0);
  // h = hf·((1 − c)·u² + c·u), u = d/xf: its slope at the top hf·(2 − c)/xf = k, at the ground c·hf/xf = k0
  const c = Math.min(1, (2 * k0) / (k + k0));
  const xf = hf > 0 ? (hf * (2 - c)) / k : 0;
  const x = xf + (h0 - hf) / k;
  const h = (d: number) => {
    if (d >= xf) return hf + (d - xf) * k;
    const u = d / Math.max(xf, 1e-9);
    return hf * ((1 - c) * u * u + c * u);
  };
  return { x, xf, h };
}

/** The way a report lines up with: its distance past the threshold, off its axis [m] (null: none). */
export function linedUp(p: Plane, runways: readonly RunwayFrame[]): { w: Way; a: number; c: number } | null {
  const q = fixed(p);
  let best: { w: Way; a: number; c: number } | null = null;
  for (const R of runways)
    for (const w of waysOf(R)) {
      if (angle(p.trk, w.hdg) > LANDING.trk) continue;
      const v = [q[0] - w.o[0], q[1] - w.o[1], q[2] - w.o[2]];
      const a = dot(v, w.d),
        c = dot(v, w.r);
      if (a < -12_000 || a > 0.5 * w.len || Math.abs(c) > LANDING.cross) continue;
      if (!best || Math.abs(c) < Math.abs(best.c)) best = { w, a, c };
    }
  return best;
}

/**
 * Its reports with its landing made up through their gap (the same array: none to make). `rest`: its wheels' rest
 * over the ellipsoid at a place [m] (the runway's levelled ground under them).
 */
export function withLanding(
  hist: readonly Plane[],
  runways: readonly RunwayFrame[],
  rest: (lat: number, lon: number) => number,
): {
  hist: readonly Plane[];
  key: string;
  /** from when on its reports are made up [s] (+∞: none) — their heights its own, its wheels on the runway */
  from: number;
  /** where it touches down: its runway's way, and when [s] */
  way?: Way;
  td?: number;
} {
  const none = { hist, key: "", from: Number.POSITIVE_INFINITY };
  if (!runways.length) return none;
  // (its last report in the air, low, descending: followed by none, or by one on the ground after a gap)
  let i = hist.length - 1;
  while (i >= 0 && hist[i]!.gnd) i--;
  if (i < 0) return none;
  const A = hist[i]!;
  const G = hist[i + 1];
  if (G && G.t - A.t < LANDING.gap) return none;
  const hA = A.alt - rest(A.lat, A.lon);
  if (hA > LANDING.low || A.vs > -LANDING.sink || A.gs < 20) return none;
  const L = linedUp(A, runways);
  if (!L) return none;
  const { w } = L;
  // (down at its slope — its own, 2° … 4° — onto the runway, its offset off the axis closed on the way; flared)
  const slope = Math.min(LANDING.slopeMax * D, Math.max(LANDING.slopeMin * D, Math.atan2(-A.vs, A.gs)));
  const prof = descent(Math.max(hA, 0), Math.tan(slope), LANDING.sinkTd / A.gs);
  const aTd = Math.max(L.a + prof.x, LANDING.touch, L.a + 50);
  if (aTd > w.len - 300) return none;
  // (where it left the runway: the point of its axis nearest its first report on the ground — none: near its end)
  const aG = G
    ? (() => {
        const q = fixed(G);
        return dot([q[0] - w.o[0], q[1] - w.o[1], q[2] - w.o[2]], w.d);
      })()
    : w.len - 100;
  const aOut = Math.min(Math.max(aG, aTd + 200), w.len - 50);
  const at = (a: number, c: number) => geo([0, 1, 2].map((k) => w.o[k]! + w.d[k]! * a + w.r[k]! * c) as V3);
  const made: Plane[] = [];
  const base = { ...A, hdg: w.hdg, roll: 0, rate: 0, trk: w.hdg };
  // the descent: along the axis, a report every few seconds — every second in the flare, its curve kept
  const tDown = (aTd - L.a) / A.gs;
  const us: number[] = [];
  for (let x = aTd - L.a; x > 1e-6; ) {
    x = Math.max(0, x - A.gs * (x < prof.xf * 1.2 ? 1 : LANDING.every));
    us.push(1 - x / (aTd - L.a));
  }
  const n = us.length;
  for (let k = 1; k <= n; k++) {
    const u = us[k - 1]!;
    const a = L.a + (aTd - L.a) * u;
    // (its offset off the axis closed by seven tenths of the way: lined up over the threshold, not crabbing in)
    const P = at(a, L.c * (1 - Math.min(1, u / 0.7)) ** 2);
    made.push({
      ...base,
      ...P,
      alt: rest(P.lat, P.lon) + prof.h((aTd - a) * (prof.x / Math.max(aTd - L.a, 1e-6))),
      vs: k < n ? A.vs : 0,
      // (its speed and track between its neighbours: closing on the axis, not along it — the path's chord)
      gs: k === n ? A.gs : 0,
      gnd: k === n,
      t: A.t + tDown * u,
    });
  }
  // the rollout, from its touchdown to where it left the runway, in the time its reports leave: none heard after,
  // braking to a stop; else as far as its turn-off by the time it must leave it for where it was heard taxiing —
  // braking evenly to the speed that gets it there, or harder to a taxi and on at that pace, then waiting there
  const v0 = A.gs,
    vt = LANDING.taxi,
    tTd = A.t + tDown,
    Dr = aOut - aTd;
  /** its rollout: its way down the runway [m] and its speed [m/s] at a time past its touchdown [s]; its length [s] */
  let roll: (s: number) => { a: number; v: number };
  let Tr: number;
  if (!G) {
    // (the reversers and the autobrake down to 35 m/s, the brakes gently after: to a stop on the runway)
    const b1 = LANDING.brake,
      b2 = LANDING.brakeLow,
      vr = Math.min(LANDING.vRev, v0);
    const T1 = (v0 - vr) / b1,
      a1 = aTd + ((v0 + vr) / 2) * T1;
    const T2 = vr / b2;
    Tr = T1 + T2;
    roll = (s) =>
      s < T1
        ? { a: aTd + v0 * s - 0.5 * b1 * s * s, v: v0 - b1 * s }
        : { a: a1 + vr * (s - T1) - 0.5 * b2 * (s - T1) ** 2, v: Math.max(vr - b2 * (s - T1), 0) };
    // (the runway too short for it so: stopped at its end)
    const aMax = w.len - 60;
    const r0 = roll;
    roll = (s) => {
      const r = r0(s);
      return r.a > aMax ? { a: aMax, v: 0 } : r;
    };
  } else {
    const qO = fixed(at(aOut, 0)),
      qG = fixed(G);
    Tr = G.t - Math.hypot(qG[0] - qO[0], qG[1] - qO[1], qG[2] - qO[2]) / vt - tTd;
    // (heard too soon to have rolled there at its touchdown's speed: none made)
    if (!(Tr > Dr / v0)) return none;
    const v1 = (2 * Dr) / Tr - v0;
    if (v1 >= vt) {
      const b = (v0 - v1) / Tr;
      roll = (s) => ({ a: aTd + v0 * s - 0.5 * b * s * s, v: v0 - b * s });
    } else {
      // (braking to a taxi in T1, on at that pace; harder than 4 m/s² never — waiting at its turn-off then)
      const T1 = Math.max((Dr - vt * Tr) / ((v0 - vt) / 2), (v0 - vt) / 4);
      const b = (v0 - vt) / T1,
        a1 = aTd + ((v0 + vt) / 2) * T1;
      roll = (s) =>
        s < T1
          ? { a: aTd + v0 * s - 0.5 * b * s * s, v: v0 - b * s }
          : a1 + vt * (s - T1) < aOut
            ? { a: a1 + vt * (s - T1), v: vt }
            : { a: aOut, v: 0.5 };
    }
  }
  const m = Math.max(1, Math.ceil(Tr / LANDING.every));
  for (let k = 1; k <= m; k++) {
    const r = roll((Tr * k) / m);
    const P = at(Math.min(r.a, aOut), 0);
    made.push({ ...base, ...P, alt: 0, vs: 0, gs: Math.max(r.v, 0), gnd: true, t: tTd + (Tr * k) / m });
  }
  // (off the runway towards where it was heard: a turn-off's curve — a quarter of a circle at most —, not a corner)
  if (G) {
    const qG = fixed(G);
    const cG = dot([qG[0] - w.o[0], qG[1] - w.o[1], qG[2] - w.o[2]], w.r);
    const side = Math.sign(cG);
    const R = LANDING.turnR;
    const tO = made.at(-1)!.t;
    const thMax = Math.min(Math.PI / 2, Math.acos(Math.max(-1, Math.min(1, 1 - Math.abs(cG) / R))));
    if (Math.abs(cG) > 30 && G.t - tO > (R * thMax) / LANDING.taxi + 2)
      for (const th of [thMax / 3, (2 * thMax) / 3, thMax]) {
        const P = at(aOut + R * Math.sin(th), side * R * (1 - Math.cos(th)));
        made.push({ ...base, ...P, alt: 0, vs: 0, gs: 0, gnd: true, t: tO + (R * th) / LANDING.taxi });
      }
  }
  return { hist: [...hist.slice(0, i + 1), ...made, ...hist.slice(i + 1)], key: `${w.key}@${A.t}`, from: A.t, way: w, td: tTd };
}
