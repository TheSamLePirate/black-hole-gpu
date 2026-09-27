// Patched conics (the map's preview beyond the predicted paths), for any system: from a state, a
// Kepler conic around the body of its sphere of influence; entering a smaller sphere (a moon's, a
// planet's), a conic around that body; leaving one, around its primary; stopped at a surface (or a
// horizon). Each change found to a fraction of a step by bisection; the samples dense where the
// motion turns fast (a flyby's periapsis). A picture, not the flight: the predicted paths stay the
// reference.

import { propagate, type V3 } from "../game/kepler";
import type { OurPath } from "./our-predict";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** A body of the patched system: its field (GM), its size, its sphere of influence, its motion. */
export interface PatchedBody {
  id: string;
  parent: string | null;
  mass: number;
  /** what stops a path: its surface (a hole: its horizon) */
  radius: number;
  /** sphere of influence (the root: Infinity) */
  soi: number;
  state(t: number): { pos: V3; vel: V3 };
  /** its band of distances from its primary (sphere included): a cheap test before its place is computed */
  band?: [number, number];
}

export interface Extension extends OurPath {
  /** the lowest point in each sphere crossed (not the root's, unless `rootApsides`): index, altitude, body */
  apsides: { i: number; alt: number; body: string }[];
}

/** The conics from a state in a body's sphere of influence, for `horizon` of time — at most `maxPts` samples. */
export function patchedConics(
  bodies: Map<string, PatchedBody>, X0: V3, V0: V3, tStart: number, ref0: string, horizon: number,
  o: { maxPts?: number; rootApsides?: boolean } = {},
): Extension {
  const maxPts = o.maxPts ?? 900;
  const children = new Map<string, string[]>();
  for (const b of bodies.values()) if (b.parent && bodies.has(b.parent)) children.set(b.parent, [...(children.get(b.parent) ?? []), b.id]);
  let t = tStart;
  const tEnd = t + horizon;
  let ref = bodies.has(ref0) ? ref0 : [...bodies.values()].find((b) => !b.parent)!.id;
  let t0 = t;
  const rel0 = (X: V3, V: V3, id: string, at: number) => {
    const s = bodies.get(id)!.state(at);
    return { r: sub(X, s.pos), v: sub(V, s.vel) };
  };
  let { r: r0, v: v0 } = rel0(X0, V0, ref, t);
  const stateAt = (tt: number) => {
    const k = propagate(bodies.get(ref)!.mass, r0, v0, tt - t0);
    const s = bodies.get(ref)!.state(tt);
    return { X: add(k.r, s.pos), V: add(k.v, s.vel), r: len(k.r), speed: len(k.v) };
  };
  const out: Extension = { pts: [X0], vels: [V0], times: [t], refs: [ref], fate: "continues", nodeAt: [], apsides: [] };
  let low = { i: 0, alt: Infinity, body: ref };
  let segStart = 0;
  const isRoot = (id: string) => !bodies.get(id)!.parent;
  const closeLow = () => {
    // (a lowest point inside the segment: not where it starts or ends)
    if ((!isRoot(low.body) || o.rootApsides) && Number.isFinite(low.alt) && low.i > segStart + 1 && low.i < out.pts.length - 1) out.apsides.push({ ...low });
  };
  const dtMax = horizon / 250;
  const inside = (X: V3, c: string, tt: number, rRef: number) => {
    const b = bodies.get(c)!;
    if (b.band && (rRef < b.band[0] || rRef > b.band[1])) return false;
    return len(sub(X, b.state(tt).pos)) < b.soi;
  };
  while (t < tEnd && out.pts.length < maxPts) {
    const cur = stateAt(t);
    // (a step of ~2 % of the time the motion takes to turn around the body — and, nearing a smaller
    // sphere, never more than half the way to it: a small Hill sphere is not stepped over)
    let dt = Math.min(dtMax, Math.max((0.02 * cur.r) / Math.max(cur.speed, 1e-30), dtMax / 400));
    for (const c of children.get(ref) ?? []) {
      const b = bodies.get(c)!;
      if (b.band && (cur.r < b.band[0] || cur.r > b.band[1])) continue;
      const st = b.state(t);
      const d = len(sub(cur.X, st.pos));
      const vr = len(sub(cur.V, st.vel));
      dt = Math.min(dt, Math.max(0.5 * (d - b.soi), 0.25 * b.soi) / Math.max(vr, 1e-30));
    }
    dt = Math.min(Math.max(dt, horizon * 1e-7), tEnd - t);
    const tn = t + dt;
    const s = stateAt(tn);
    const B = bodies.get(ref)!;
    const exit = !isRoot(ref) && s.r > B.soi;
    let enter: string | null = null;
    for (const c of children.get(ref) ?? []) if (inside(s.X, c, tn, s.r)) enter = c;
    if (s.r < B.radius || exit || enter) {
      // the change's time, by bisection
      const test = (tt: number) => {
        const q = stateAt(tt);
        if (q.r < B.radius) return true;
        if (!isRoot(ref) && q.r > B.soi) return true;
        return !!enter && len(sub(q.X, bodies.get(enter)!.state(tt).pos)) < bodies.get(enter)!.soi;
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
      if (q.r < B.radius) {
        out.fate = "impact";
        out.hit = ref;
        break;
      }
      closeLow();
      const next = enter ?? B.parent!;
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
    const alt = s.r - B.radius;
    if (alt < low.alt) low = { i: out.pts.length - 1, alt, body: ref };
    t = tn;
  }
  closeLow();
  return out;
}
