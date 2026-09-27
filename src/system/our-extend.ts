// Beyond a predicted path (the map's preview): patched conics. From the path's last state, a Kepler
// conic around the body of its sphere of influence; entering a moon's (or a planet's) sphere of
// influence, a conic around it; leaving one, around its primary; stopped at a surface. The spheres
// a (m/M)^0.4 as elsewhere; each change found to a fraction of a step by bisection; the samples
// dense where the motion turns fast (a flyby's periapsis). A picture, not the n-body flight: the
// predicted paths stay the reference.

import { propagate, type V3 } from "../game/kepler";
import { SOLAR_BODIES, solarState } from "./solar";
import type { OurPath } from "./our-predict";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

const BODY = new Map(SOLAR_BODIES.map((b) => [b.id, b]));
const CHILDREN = new Map<string, string[]>();
for (const b of SOLAR_BODIES) if (b.parent) CHILDREN.set(b.parent, [...(CHILDREN.get(b.parent) ?? []), b.id]);

/** A body's sphere of influence at t (the Sun: all of it). */
function soiAt(id: string, t: number): number {
  const b = BODY.get(id);
  if (!b?.parent) return Infinity;
  const p = BODY.get(b.parent)!;
  return len(sub(solarState(id, t).pos, solarState(p.id, t).pos)) * (b.mass / p.mass) ** 0.4;
}

/** A planet's band of distances from the Sun, its sphere of influence included (a cheap test first). */
function band(id: string, sphere: number): [number, number] {
  const e = BODY.get(id)!.elements;
  if (!e) return [0, Infinity];
  const a = e[0]![0]! * (1.495978707e11 / 1.476625e11), ecc = e[0]![1]!;
  return [a * (1 - ecc) - 1.2 * sphere, a * (1 + ecc) + 1.2 * sphere];
}

export interface Extension extends OurPath {
  /** the lowest point in each sphere of influence crossed (not the Sun's): index, altitude [M], body */
  apsides: { i: number; alt: number; body: string }[];
}

/**
 * The path continued for `horizon` (scene time) after its end — at most `maxPts` samples; null when
 * it ends on a surface or in the wormhole.
 */
export function extendOurs(p: OurPath, horizon = extensionHorizon(p.refs[p.refs.length - 1] ?? "sun"), maxPts = 900): Extension | null {
  if (p.fate !== "continues" || p.pts.length < 2) return null;
  const n = p.pts.length - 1;
  return extendFrom(p.pts[n]!, p.vels[n]!, p.times[n]!, p.refs[n] ?? "sun", horizon, maxPts);
}

/** How far to look beyond a path ending in a body's sphere: a moon's 10 days, a planet's 40, the Sun's 2 years. */
export function extensionHorizon(ref: string) {
  const day = 86400 / 492.5490947;
  const b = BODY.get(ref);
  return (!b?.parent ? 730 : b.parent === "sun" ? 40 : 10) * day;
}

/** The conics from a state (home frame) in a body's sphere of influence, for `horizon` of scene time. */
export function extendFrom(X0: V3, V0: V3, tStart: number, ref0: string, horizon: number, maxPts = 900): Extension {
  let t = tStart;
  const tEnd = t + horizon;
  let ref = ref0;
  const p = { pts: [X0], vels: [V0] };
  const n = 0;
  // the conic: its epoch and state relative to the body
  let t0 = t;
  const rel0 = (X: V3, V: V3, id: string, at: number) => {
    const s = solarState(id, at);
    return { r: sub(X, s.pos), v: sub(V, s.vel) };
  };
  let { r: r0, v: v0 } = rel0(p.pts[n]!, p.vels[n]!, ref, t);
  const stateAt = (tt: number) => {
    const k = propagate(BODY.get(ref)!.mass, r0, v0, tt - t0);
    const s = solarState(ref, tt);
    return { X: add(k.r, s.pos), V: add(k.v, s.vel), r: len(k.r), speed: len(k.v) };
  };
  // (the spheres barely change over the preview: taken once)
  const sphere = new Map<string, number>();
  const soi = (id: string) => {
    let v = sphere.get(id);
    if (v === undefined) sphere.set(id, (v = soiAt(id, t)));
    return v;
  };
  const bands = new Map<string, [number, number]>();
  const out: Extension = { pts: [p.pts[n]!], vels: [p.vels[n]!], times: [t], refs: [ref], fate: "continues", nodeAt: [], apsides: [] };
  let low = { i: 0, alt: Infinity, body: ref };
  let segStart = 0;
  const closeLow = () => {
    // (a lowest point inside the segment: not where it starts or ends — the path's own end is its periapsis often)
    if (low.body !== "sun" && Number.isFinite(low.alt) && low.i > segStart + 1 && low.i < out.pts.length - 1) out.apsides.push({ ...low });
  };
  const dtMax = horizon / 250;
  while (t < tEnd && out.pts.length < maxPts) {
    const cur = stateAt(t);
    // (a step of ~2 % of the time the motion takes to turn around the body)
    const dt = Math.min(dtMax, Math.max((0.02 * cur.r) / Math.max(cur.speed, 1e-30), dtMax / 400), tEnd - t);
    const tn = t + dt;
    const s = stateAt(tn);
    // what happens within the step: a surface, leaving the sphere, entering a smaller one
    const R = BODY.get(ref)!.radius;
    const exit = ref !== "sun" && s.r > soi(ref);
    let enter: string | null = null;
    for (const c of CHILDREN.get(ref) ?? []) {
      if (ref === "sun") {
        let bd = bands.get(c);
        if (!bd) bands.set(c, (bd = band(c, soi(c))));
        if (s.r < bd[0] || s.r > bd[1]) continue;
      }
      if (len(sub(s.X, solarState(c, tn).pos)) < soi(c)) enter = c;
    }
    if (s.r < R || exit || enter) {
      // the change's time, by bisection
      const test = (tt: number) => {
        const q = stateAt(tt);
        if (q.r < R) return true;
        if (ref !== "sun" && q.r > soi(ref)) return true;
        return !!enter && len(sub(q.X, solarState(enter, tt).pos)) < soi(enter);
      };
      let a = t, b = tn;
      for (let k = 0; k < 24; k++) {
        const m = (a + b) / 2;
        if (test(m)) b = m;
        else a = m;
      }
      const q = stateAt(b);
      out.pts.push(q.X);
      out.vels.push(q.V);
      out.times.push(b);
      out.refs.push(ref);
      t = b;
      if (q.r < R) {
        out.fate = "impact";
        out.hit = ref;
        break;
      }
      closeLow();
      const next = enter ?? BODY.get(ref)!.parent ?? "sun";
      ({ r: r0, v: v0 } = rel0(q.X, q.V, next, b));
      ref = next;
      t0 = b;
      low = { i: out.pts.length - 1, alt: Infinity, body: ref };
      segStart = out.pts.length - 1;
      out.refs[out.refs.length - 1] = ref;
      continue;
    }
    out.pts.push(s.X);
    out.vels.push(s.V);
    out.times.push(tn);
    out.refs.push(ref);
    const alt = s.r - R;
    if (alt < low.alt) low = { i: out.pts.length - 1, alt, body: ref };
    t = tn;
  }
  closeLow();
  return out;
}
