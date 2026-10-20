// The system map's scene (PLAN-VAISSEAUX K3): what the 3D view draws, built from the K1 blocks — our side, the Sun
// and its planets with their orbits (each rebuilt about its parent: orbitmath.ts), the moons of the body visited, the
// sphere of influence, the craft and its paths (free cyan, planned magenta), the plan's burns, the target; Gargantua's
// side, the hole (its horizon, its ergosphere, the photon orbit, the ISCO), its worlds on their circles, the mouth, the
// craft and its fall. A time ahead moves the bodies along their orbits and the craft along its path (the prediction
// scrolled). Pure: no canvas, no GPU — the renderers (gpu.ts, draw2d.ts) draw it.

import type { InstrumentSnapshot } from "../../net/instruments";
import { type Conic, conicOf, nuAfter, radiusAt, type V3 } from "../orbitmath";

export interface SceneSphere {
  id: string;
  name: string;
  pos: V3;
  radius: number;
  colour: [number, number, number];
  /** lit by the star (planets), glowing (the Sun), black (the hole) */
  shade: "lit" | "star" | "hole" | "mouth";
}
export interface SceneLine {
  pts: V3[];
  colour: [number, number, number, number];
  width: number;
  dashed?: boolean;
}
export interface SceneMark {
  pos: V3;
  label: string;
  colour: string;
  kind: "craft" | "node" | "target" | "body" | "ghost";
}
export interface SystemScene {
  side: "ours" | "hole";
  /** lengths' unit: km on our side, M on Gargantua's */
  unit: "km" | "M";
  spheres: SceneSphere[];
  lines: SceneLine[];
  marks: SceneMark[];
  /** where the view centres (the focus) and how far its interest goes */
  focus: V3;
  extent: number;
  /** the time ahead the scene is drawn at [s], the longest a path reaches [s] */
  ahead: number;
  span: number;
}

export type Focus = "craft" | "body" | "sun";

const COLOURS: Record<string, [number, number, number]> = {
  sun: [1, 0.86, 0.45],
  mercury: [0.62, 0.6, 0.58],
  venus: [0.92, 0.82, 0.6],
  earth: [0.3, 0.55, 1],
  moon: [0.75, 0.75, 0.78],
  mars: [0.9, 0.42, 0.25],
  phobos: [0.6, 0.55, 0.5],
  deimos: [0.65, 0.6, 0.55],
  jupiter: [0.88, 0.75, 0.6],
  io: [0.95, 0.85, 0.4],
  europa: [0.85, 0.8, 0.72],
  ganymede: [0.7, 0.66, 0.6],
  callisto: [0.5, 0.47, 0.44],
  saturn: [0.93, 0.83, 0.6],
  titan: [0.9, 0.65, 0.3],
  uranus: [0.6, 0.85, 0.9],
  neptune: [0.35, 0.5, 0.95],
  pluto: [0.8, 0.72, 0.62],
  miller: [0.35, 0.6, 0.85],
  mann: [0.85, 0.9, 0.95],
  edmunds: [0.75, 0.6, 0.45],
  k2: [1, 0.7, 0.4],
};
const colourOf = (id: string): [number, number, number] => COLOURS[id] ?? [0.7, 0.75, 0.8];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** A conic's ring in the frame [km] about its focus (n points; a hyperbola's arm to `rMax`). */
export function conicRing(o: Conic, rMax: number, n = 128): V3[] {
  const out: V3[] = [];
  const lim = o.e < 1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, (o.p / rMax - 1) / o.e)));
  for (let k = 0; k <= n; k++) {
    const nu = -lim + (2 * lim * k) / n;
    const r = radiusAt(o, nu);
    if (!Number.isFinite(r)) continue;
    const c = r * Math.cos(nu),
      s = r * Math.sin(nu);
    out.push([o.P[0] * c + o.Q[0] * s, o.P[1] * c + o.Q[1] * s, o.P[2] * c + o.Q[2] * s]);
  }
  return out;
}
/** A place on a conic some seconds on [km about its focus]. */
function placeAfter(o: Conic, dt: number): V3 {
  const nu = nuAfter(o, dt);
  const r = radiusAt(o, nu);
  const c = r * Math.cos(nu),
    s = r * Math.sin(nu);
  return [o.P[0] * c + o.Q[0] * s, o.P[1] * c + o.Q[1] * s, o.P[2] * c + o.Q[2] * s];
}

/** The Kerr hole's radii [M] for its spin: the horizon, the prograde photon orbit and ISCO (Bardeen 1972). */
export function kerrRadii(a: number) {
  const rh = 1 + Math.sqrt(Math.max(0, 1 - a * a));
  const photon = 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const isco = 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return { rh, photon, isco, ergo: 2 };
}
const circleXY = (R: number, n = 160): V3[] =>
  Array.from({ length: n + 1 }, (_, k) => [R * Math.cos((k / n) * 2 * Math.PI), R * Math.sin((k / n) * 2 * Math.PI), 0] as V3);

/** A path's place at a time [s from now] (its points' times), or null beyond it. */
function alongPath(pts: V3[], t: number[], at: number): V3 | null {
  if (!pts.length || at < t[0]! || at > t.at(-1)!) return null;
  for (let k = 1; k < pts.length; k++)
    if (t[k]! >= at) {
      const u = (at - t[k - 1]!) / Math.max(t[k]! - t[k - 1]!, 1e-9);
      return lerp(pts[k - 1]!, pts[k]!, u);
    }
  return pts.at(-1)!;
}

/** The scene for a snapshot: `ahead` seconds on, centred on `focus`. */
export function systemScene(s: InstrumentSnapshot | null, focus: Focus = "body", ahead = 0): SystemScene | null {
  if (!s) return null;
  if (s.hole) return holeScene(s, ahead);
  const B = s.bodies ?? [];
  if (!B.length && !s.state) return null;
  const byId = new Map(B.map((b) => [b.id, b]));
  // the bodies moved on their orbits by `ahead` (about their parents, moved first)
  const placed = new Map<string, V3>();
  const conics = new Map<string, Conic>();
  const place = (id: string): V3 => {
    const hit = placed.get(id);
    if (hit) return hit;
    const b = byId.get(id);
    if (!b) return [0, 0, 0];
    const par = b.parent ? byId.get(b.parent) : undefined;
    let at = b.r;
    if (par && b.v && par.v && par.mu) {
      const o = conicOf(sub(b.r, par.r), sub(b.v, par.v), par.mu);
      if (o && o.e < 1) {
        conics.set(id, o);
        at = add(place(par.id), ahead ? placeAfter(o, ahead) : sub(b.r, par.r));
      }
    }
    placed.set(id, at);
    return at;
  };
  const spheres: SceneSphere[] = B.map((b) => ({
    id: b.id,
    name: b.id,
    pos: place(b.id),
    radius: b.radius,
    colour: colourOf(b.id),
    shade: b.id === "sun" ? "star" : "lit",
  }));
  const lines: SceneLine[] = [];
  for (const b of B) {
    const o = conics.get(b.id);
    const par = b.parent ? placed.get(b.parent) : undefined;
    if (!o || !par) continue;
    const moon = b.parent !== "sun";
    lines.push({
      pts: conicRing(o, Infinity).map((q) => add(par, q)),
      colour: moon ? [0.45, 0.55, 0.62, 0.55] : [0.4, 0.5, 0.6, 0.7],
      width: moon ? 1 : 1.2,
    });
  }
  // the craft, its paths: each piece about its body (where that body is now — the scene's frame)
  const marks: SceneMark[] = [];
  const st = s.state;
  const home = st ? place(st.body) : ([0, 0, 0] as V3);
  let span = 0;
  const pathLine = (segs: NonNullable<InstrumentSnapshot["traj"]>["free"], colour: [number, number, number, number], dashed: boolean) => {
    for (const seg of segs) {
      const at = place(seg.body);
      lines.push({ pts: seg.pts.map((q) => add(at, q)), colour, width: 2, dashed });
      span = Math.max(span, seg.t.at(-1) ?? 0);
    }
  };
  pathLine(s.traj?.free ?? [], [0.25, 0.85, 1, 0.95], false);
  pathLine(s.traj?.plan ?? [], [1, 0.36, 0.88, 0.95], true);
  if (st) {
    // the sphere of influence, a ring in the craft's orbital plane
    const o = conicOf(st.r, st.v, st.mu);
    if (st.soi > 0 && Number.isFinite(st.soi) && o) {
      const ring: V3[] = Array.from({ length: 97 }, (_, k) => {
        const a = (k / 96) * 2 * Math.PI;
        return add(home, [
          st.soi * (o.P[0] * Math.cos(a) + o.Q[0] * Math.sin(a)),
          st.soi * (o.P[1] * Math.cos(a) + o.Q[1] * Math.sin(a)),
          st.soi * (o.P[2] * Math.cos(a) + o.Q[2] * Math.sin(a)),
        ]);
      });
      lines.push({ pts: ring, colour: [0.55, 0.7, 0.8, 0.35], width: 1, dashed: true });
    }
    // the craft's own conic (bound): its orbit about the body
    if (o && o.e < 1) lines.push({ pts: conicRing(o, Infinity).map((q) => add(home, q)), colour: [0.25, 0.85, 1, 0.55], width: 1.4 });
    marks.push({ pos: add(home, st.r), label: s.craft?.name ?? "vaisseau", colour: "#f6fbff", kind: "craft" });
    // the craft ahead: along its free path, else its conic
    if (ahead > 0) {
      const seg = (s.traj?.free ?? []).find((q) => q.t.length && ahead >= q.t[0]! && ahead <= q.t.at(-1)!);
      const p = seg ? alongPath(seg.pts, seg.t, ahead) : null;
      const ghost = p ? add(place(seg!.body), p) : o && o.e < 1 ? add(home, placeAfter(o, ahead)) : null;
      if (ghost) marks.push({ pos: ghost, label: `+${Math.round(ahead / 60)} min`, colour: "#3fd8ff", kind: "ghost" });
    }
    // the plan's burns: on the planned path at their time
    for (const n of s.nodes ?? []) {
      const seg = (s.traj?.plan ?? []).find((q) => q.t.length && n.in >= q.t[0]! && n.in <= q.t.at(-1)!);
      const p = seg ? alongPath(seg.pts, seg.t, n.in) : o ? placeAfter(o, n.in) : null;
      if (p)
        marks.push({
          pos: seg ? add(place(seg.body), p) : add(home, p),
          label: `Δv ${Math.round(Math.hypot(...n.dv))} m/s`,
          colour: "#ff5ce1",
          kind: "node",
        });
    }
  }
  if (s.target && byId.has(s.target.id)) marks.push({ pos: place(s.target.id), label: s.target.name, colour: "#ffb43c", kind: "target" });
  // the focus and its extent: the craft's body and its sphere; the Sun and the farthest planet's orbit
  const sun = placed.get("sun") ?? [0, 0, 0];
  let fpos: V3, extent: number;
  if (focus === "sun" || !st) {
    fpos = sun;
    const visited = st ? len(sub(home, sun)) : 0;
    extent = Math.max(
      visited * 1.6,
      ...B.filter((b) => b.parent === "sun" && len(sub(b.r, sun)) < 2.5e9).map((b) => len(sub(b.r, sun)) * 1.1),
      3e8,
    );
  } else if (focus === "craft") {
    fpos = add(home, st.r);
    extent = Math.max(len(st.r) * 0.6, st.radius * 2);
  } else {
    fpos = home;
    const o = conicOf(st.r, st.v, st.mu);
    extent = Math.max(len(st.r) * 1.4, o && o.e < 1 ? o.ra * 1.2 : len(st.r) * 3, st.radius * 3);
    if (Number.isFinite(st.soi) && st.soi > 0) extent = Math.min(extent, st.soi * 1.2);
  }
  return { side: "ours", unit: "km", spheres, lines, marks, focus: fpos, extent, ahead, span };
}

/** Gargantua's side: the hole at the origin, its radii, its worlds, the craft's fall. */
function holeScene(s: InstrumentSnapshot, ahead: number): SystemScene {
  const H = s.hole!;
  const K = kerrRadii(H.spin);
  const spheres: SceneSphere[] = [];
  const lines: SceneLine[] = [];
  const marks: SceneMark[] = [];
  spheres.push({ id: "gargantua", name: "Gargantua", pos: [0, 0, 0], radius: K.rh, colour: [0, 0, 0], shade: "hole" });
  lines.push({ pts: circleXY(K.ergo), colour: [0.6, 0.45, 1, 0.5], width: 1, dashed: true });
  lines.push({ pts: circleXY(K.photon), colour: [1, 0.75, 0.3, 0.8], width: 1.2 });
  lines.push({ pts: circleXY(K.isco), colour: [1, 0.36, 0.3, 0.8], width: 1.2, dashed: true });
  let extent = 0;
  for (const b of H.bodies) {
    if (b.id === "gargantua") continue;
    const shade = b.id === "mouth" ? "mouth" : b.id === "k2" ? "star" : "lit";
    spheres.push({ id: b.id, name: b.id, pos: b.r, radius: Math.max(b.radius, 0.02), colour: colourOf(b.id), shade });
    if (b.orbit > 0 && b.orbit < 1e4) {
      lines.push({ pts: circleXY(b.orbit), colour: [0.4, 0.5, 0.6, 0.6], width: 1 });
      extent = Math.max(extent, b.orbit);
    }
  }
  if (H.path.length > 1) lines.push({ pts: H.path, colour: [0.25, 0.85, 1, 0.95], width: 2 });
  if (H.craft) marks.push({ pos: H.craft, label: s.craft?.name ?? "vaisseau", colour: "#f6fbff", kind: "craft" });
  const rc = H.craft ? len(H.craft) : 0;
  return {
    side: "hole",
    unit: "M",
    spheres,
    lines,
    marks,
    focus: [0, 0, 0],
    // (about the craft's radius: its world and the hole's radii in sight — the mouth, Mann farther, zoomed out to)
    extent: rc > 0 ? Math.min(Math.max(rc * 1.6, 12, K.isco * 3), 60) : Math.min(Math.max(extent, K.isco * 3), 60),
    ahead,
    span: 0,
  };
}
