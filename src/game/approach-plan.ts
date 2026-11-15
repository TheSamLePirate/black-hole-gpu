// The approach's join planned (docs/PLAN-APPROCHES.md §4.4, AP2), pure: from where the craft is to the point where it meets the
// localizer, as a controller would vector it — in the runway's frame (along the final course from the threshold, > 0 down the
// runway; across, > 0 to its right):
//
// - on the line: already on the final's axis, heading in, outside the final fix: intercepted from there, no detour;
// - straight in: coming from outside, roughly in line (beyond the intercept point): to a point 30° off the final, then the join;
// - vectors: else — inside the join, abeam the field, beyond it —: a downwind 6 km off the final on the craft's side, parallel to
//   it and out past the join, then a base onto the final at ~35°: never over the field, never a turn back at a fix;
// - the heights: the join under the glideslope (met from below), the downwind 300 m higher; each never under the ground along its
//   leg + 300 m (its ground read every 500 m, on the leg and 2 km either side); from the join to the final fix a step-down, the
//   least height until the glideslope is captured (a ridge under the localizer's outer part: held over, the slope met from above
//   past it). A built approach whose glideslope itself is not clear is left out of the choice (game/approach-choice.ts « relief »).
//
// Before 15 Nov 2026 the jet flew straight at a fixed initial fix 18.5 km out on the axis: from the other side, over the field and a
// turn back; the relief checked on the final only (Sam: « l'AP ILS n'est pas fiable pour se placer sur le glide »).

import { fromRunway, glideHeight, ILS, type IlsRunway, onRunway } from "./ils";

const D = Math.PI / 180;

export const PLAN = {
  /** the join on the final [m before the threshold]: outside the final fix with room for the capture */
  join: 16_000,
  /** the intercept leg's length [m] and angle [°] (straight in) */
  intLeg: 5000,
  intDeg: 30,
  /** the downwind's offset from the final [m], its end past the join [m] */
  dwOffset: 6000,
  dwPast: 8000,
  /** above the ground along a leg [m] */
  clear: 300,
  /** the join under the glideslope [m], its least height over the threshold [m]; the downwind higher by [m] */
  underGs: 50,
  minJoin: 450,
  dwAbove: 300,
  /** the steepest descent planned to the join [°]: too high for it, track miles added (a dogleg, a base farther out) */
  descDeg: 3,
  /** the dogleg's offset and the base's push at most [m] */
  dogMax: 15_000,
  pushMax: 20_000,
} as const;

export interface PathPoint {
  /** the runway frame [m] */
  x: number;
  y: number;
  /** the place [°] */
  lat: number;
  lon: number;
  /** the height to be at, over the sea [m]; the least its legs' relief allows (their ground + 300 m) */
  alt: number;
  floor: number;
  name: string;
}

export interface JoinPlan {
  entry: "straight" | "vectors";
  pts: PathPoint[];
  /** the least clearance asked of the ground along the way [m over the sea], the way's least ground clearance found [m] */
  msa: number;
  /** the step-down from the join (or the craft, on the line already) to the final fix: at each `x` along the final [m], the
   *  least height until the glideslope is captured [m over the sea] — the ground over the next 3 km of it (1 km either side)
   *  + 300 m. A ridge under the localizer's outer part held over, then the slope met from above past it. */
  floors: { x: number; m: number }[];
}

/** The step-down's least height at `along` [m over the sea] — the highest still ahead (−∞ inside the final fix, or none). */
export function floorAt(plan: JoinPlan, along: number): number {
  // (a step-down holds until its obstacle is passed: the highest floor of the samples at or ahead of the craft — each covers
  // the 3 km ahead of it, the one just behind it included —; a craft let down before a ridge could not climb back over it)
  let m = Number.NEGATIVE_INFINITY;
  for (const f of plan.floors) if (f.x > along - 1000) m = Math.max(m, f.m);
  return m;
}

/** The step-down from `x0` to the final fix, every kilometre (see JoinPlan.floors). */
function stepDown(W: IlsRunway, x0: number, ground: (lat: number, lon: number) => number) {
  const out: { x: number; m: number }[] = [];
  for (let x = Math.min(x0, -ILS.faf); x < -ILS.faf; x += 1000)
    out.push({ x, m: legGround(W, { x, y: 0 }, { x: Math.min(x + 3000, -ILS.faf), y: 0 }, ground) + PLAN.clear });
  return out;
}

/** The highest ground along a leg (on it and 2 km either side, every 500 m) [m over the sea]. */
function legGround(W: IlsRunway, a: { x: number; y: number }, b: { x: number; y: number }, ground: (lat: number, lon: number) => number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / 500));
  const ux = (b.x - a.x) / (len || 1),
    uy = (b.y - a.y) / (len || 1);
  let top = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n,
      y = a.y + ((b.y - a.y) * i) / n;
    // (2 km either side: a turn at 170 m/s cuts its corner by about that)
    for (const s of [-2000, -1000, 0, 1000, 2000]) {
      const p = fromRunway(W, x - uy * s, y + ux * s);
      top = Math.max(top, ground(p.lat, p.lon));
    }
  }
  return top;
}

/**
 * The join from the craft's place: its points in order (the last one the join on the final), each its height over the sea —
 * never under its legs' ground + 300 m. `ground`: the ground's height over the sea [m] at a place.
 */
export function planJoin(
  W: IlsRunway,
  own: { lat: number; lon: number; alt: number; trk: number },
  ground: (lat: number, lon: number) => number,
  /** the craft's planned descent [°] (the A320's 2.5: slowing down as it descends) */
  opts: { descDeg?: number } = {},
): JoinPlan {
  const descDeg = opts.descDeg ?? PLAN.descDeg;
  const o = onRunway(W, { ...own, alt: own.alt });
  const crs = W.hdg * D;
  const hJoin = W.elev + Math.max(glideHeight(W, -PLAN.join) - PLAN.underGs, PLAN.minJoin);
  const J = { x: -PLAN.join, y: 0 };
  const pIntX = -PLAN.join - PLAN.intLeg * Math.cos(PLAN.intDeg * D);
  let entry: JoinPlan["entry"];
  const raw: { x: number; y: number; name: string; dw?: boolean }[] = [];
  // (the side: the craft's own — or, near the axis, the one its track turns to)
  const trkRel = Math.atan2(Math.sin(own.trk - crs), Math.cos(own.trk - crs));
  const side = Math.abs(o.across) > 1000 ? Math.sign(o.across) : trkRel >= 0 ? 1 : -1;
  // (too high to reach the join at the planned descent from where it is — and over the step-down's highest floor —: not « on the
  // line », track miles added below; the A320 on Nice's 22R line 2 200 m up stayed over the slope to the runway)
  const lineFloors = stepDown(W, o.along, ground);
  const topFloor = Math.max(hJoin, ...lineFloors.map((f) => f.m));
  const lowEnough = own.alt - hJoin <= Math.max(-PLAN.join - o.along, 0) * Math.tan(descDeg * D) || own.alt <= topFloor + 150;
  if (o.along < -ILS.faf - 2500 && Math.abs(o.across) < 3000 && Math.abs(trkRel) < PLAN.intDeg * D && lowEnough) {
    // (on the final's line already, heading in, outside the final fix: the localizer intercepted from here — no detour)
    return {
      entry: "straight",
      pts: [],
      msa: legGround(W, { x: o.along, y: o.across }, { x: -ILS.faf, y: 0 }, ground) + PLAN.clear,
      floors: lineFloors,
    };
  }
  if (o.along < pIntX) {
    // (outside the intercept point: straight in — to a point 30° off the final on the craft's side, unless near the axis already)
    entry = "straight";
    const lat = Math.abs(o.across);
    const yInt = side * PLAN.intLeg * Math.sin(PLAN.intDeg * D);
    if (lat > 800) raw.push({ x: pIntX, y: lat < Math.abs(yInt) ? side * lat : yInt, name: "INT" });
  } else {
    // (inside it, abeam or beyond the field: vectors — a downwind on the craft's side out past the join, then the base)
    entry = "vectors";
    const y = side * PLAN.dwOffset;
    const x1 = Math.min(Math.max(o.along, -PLAN.join), 4000);
    raw.push({ x: x1, y, name: "DW", dw: true });
    raw.push({ x: -PLAN.join - PLAN.dwPast, y, name: "BASE", dw: true });
  }
  raw.push({ ...J, name: "JOIN" });
  // (too high to make the join at the planned descent: track miles added — a dogleg on the craft's side straight in, the base
  // pushed out on vectors — as a controller does; from 3 000 m 45 km out behind the final, the A320 met the slope 6.5 km out)
  const pathLen = (pts: { x: number; y: number }[]) => {
    let L = 0,
      a = { x: o.along, y: o.across };
    for (const p of pts) (L += Math.hypot(p.x - a.x, p.y - a.y)), (a = p);
    return L;
  };
  const need = (own.alt - hJoin) / Math.tan(descDeg * D);
  if (pathLen(raw) < need) {
    if (entry === "straight") {
      const t0 = raw[0]!;
      const mid = { x: (o.along + t0.x) / 2, y: (o.across + t0.y) / 2 };
      let lo = 0,
        hi: number = PLAN.dogMax;
      const at = (Y: number) => ({ x: mid.x, y: mid.y + side * Y, name: "DOG" });
      for (let k = 0; k < 24; k++) {
        const Y = (lo + hi) / 2;
        if (pathLen([at(Y), ...raw]) < need) lo = Y;
        else hi = Y;
      }
      raw.unshift(at(hi));
    } else {
      const base = raw.find((p) => p.name === "BASE")!;
      base.x -= Math.min((need - pathLen(raw)) / 2, PLAN.pushMax);
    }
  }
  // the heights: the join's, the downwind's above; each at least its legs' ground + clearance
  const start = { x: o.along, y: o.across };
  const legs = [start, ...raw];
  const legTop: number[] = [];
  for (let i = 1; i < legs.length; i++) legTop.push(legGround(W, legs[i - 1]!, legs[i]!, ground) + PLAN.clear);
  // (from where the craft is: the localizer may be taken before the join — the intercept begun on the last leg)
  const floors = stepDown(W, Math.min(o.along, J.x), ground);
  // (the descent spread along the way: each point no lower than the craft's height less the path to it at the planned slope)
  const cum: number[] = [];
  {
    let L = 0,
      a = { x: o.along, y: o.across };
    for (const p of raw) (L += Math.hypot(p.x - a.x, p.y - a.y)), (a = p), cum.push(L);
  }
  const pts: PathPoint[] = raw.map((p, i) => {
    const nominal = p.dw ? hJoin + PLAN.dwAbove : hJoin;
    const want = p.name === "JOIN" ? hJoin : Math.max(nominal, own.alt - cum[i]! * Math.tan(descDeg * D));
    // (the join: over the step-down's first part too — the localizer's outer kilometres flown at its height)
    const after = p.name === "JOIN" ? floorAt({ floors } as JoinPlan, J.x) : Number.NEGATIVE_INFINITY;
    const floor = Math.max(legTop[i] ?? Number.NEGATIVE_INFINITY, legTop[i + 1] ?? Number.NEGATIVE_INFINITY, after);
    const g = fromRunway(W, p.x, p.y);
    return { x: p.x, y: p.y, lat: g.lat, lon: g.lon, alt: Math.max(want, floor), floor, name: p.name };
  });
  return { entry, pts, msa: Math.max(...legTop), floors };
}

/**
 * The course to fly along the plan: the leg towards point `i` (the next), switched to the one after when the turn's lead is
 * reached — its radius at the speed and 30° of bank, the course change halved —; the height aimed at: the next point's.
 * Returns the index of the point flown to now (the plan done past the last).
 */
export function followJoin(
  plan: JoinPlan,
  i: number,
  W: IlsRunway,
  own: { lat: number; lon: number; alt: number; trk: number; gs: number },
): { i: number; crs: number; alt: number; floor: number; dist: number } {
  const o = onRunway(W, { ...own, alt: own.alt });
  const crs0 = W.hdg * D;
  const toRad = (x: number, y: number) => {
    // (a runway-frame direction to a true course: along the final is its heading, across is 90° right of it)
    return crs0 + Math.atan2(y, x);
  };
  let k = i;
  for (; k < plan.pts.length; k++) {
    const p = plan.pts[k]!;
    const dx = p.x - o.along,
      dy = p.y - o.across;
    const dist = Math.hypot(dx, dy);
    const legCrs = toRad(dx, dy);
    const next = plan.pts[k + 1] ?? { x: 0, y: 0 };
    const outCrs = toRad(next.x - p.x, next.y - p.y);
    const turn = Math.abs(Math.atan2(Math.sin(outCrs - legCrs), Math.cos(outCrs - legCrs)));
    const radius = Math.max(own.gs, 60) ** 2 / (9.80665 * Math.tan(30 * D));
    const lead = Math.max(800, radius * Math.tan(turn / 2));
    if (dist > lead) return { i: k, crs: legCrs, alt: p.alt, floor: p.floor, dist };
  }
  // (done — or none to fly: on the final's line already)
  return { i: k, crs: crs0, alt: plan.pts.at(-1)?.alt ?? own.alt, floor: plan.pts.at(-1)?.floor ?? Number.NEGATIVE_INFINITY, dist: 0 };
}
