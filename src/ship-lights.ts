// The Ranger's own lights (PLAN-COCKPIT K6): the navigation lights — red on the left wingtip, green on the
// right, white aft —, the white strobes at the wingtips (a double flash every 1.2 s), the two landing lights
// under the nose, ahead and a little down. Each set on the hull where a ray from outside meets it (its mesh:
// assets/ranger/ranger.bin — a delta, its tips at x ±4.1 m), a few centimetres out. Pure: their places,
// what each shows now (the cockpit's switches, the strobes' rhythm), the uniform ship.wgsl reads (S.lampN,
// S.lamp: its lenses lit on the hull, their glare drawn with the flames).
//
// The ship's frame: x to the left, y up, z the nose.

type V3 = [number, number, number];

export type LampKind = "nav" | "strobe" | "landing";

export interface LampDef {
  id: string;
  kind: LampKind;
  /** roughly where (the ship's frame) [m], and the way out of the hull there: the ray comes in along −out */
  at: V3;
  out: V3;
  /** its colour (linear) and strength: the glare's display-referred brightness */
  colour: V3;
  /** a beam's direction (the landing lights'), its half-angle's cosine; none: all round */
  beam?: V3;
  cone?: number;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const RANGER_LAMPS: LampDef[] = [
  { id: "navLeft", kind: "nav", at: [4.1, 0.45, -0.05], out: [1, 0, 0], colour: [3, 0.18, 0.09] },
  { id: "navRight", kind: "nav", at: [-4.05, 0.6, -0.05], out: [-1, 0, 0], colour: [0.24, 3, 0.9] },
  { id: "navTail", kind: "nav", at: [0.06, 0.5, -5.3], out: [0, 0, -1], colour: [2.4, 2.3, 2] },
  { id: "strobeLeft", kind: "strobe", at: [4.0, 0.45, -0.45], out: [1, 0, 0], colour: [4, 4, 4.4] },
  { id: "strobeRight", kind: "strobe", at: [-3.95, 0.6, -0.45], out: [-1, 0, 0], colour: [4, 4, 4.4] },
  {
    id: "landingLeft",
    kind: "landing",
    at: [1.1, 0.3, 6.2],
    out: [0, -1, 0],
    colour: [6, 5.8, 5.2],
    beam: norm([0, -0.14, 1]),
    cone: Math.cos((14 * Math.PI) / 180),
  },
  {
    id: "landingRight",
    kind: "landing",
    at: [-1.1, 0.3, 6.2],
    out: [0, -1, 0],
    colour: [6, 5.8, 5.2],
    beam: norm([0, -0.14, 1]),
    cone: Math.cos((14 * Math.PI) / 180),
  },
];

/** The lamps the shader takes (ship.wgsl S.lamp: three vec4s each). */
export const MAX_LAMPS = 8;

/** A lamp set on the hull: its place [m], the hull's normal there. */
export interface PlacedLamp extends LampDef {
  p: V3;
  n: V3;
}

/** Each lamp onto the hull: a ray from 3 m out along `out` back in; where it meets the hull, 6 cm back out
 *  (or where it was said, if the ray misses). */
export function placeLamps(
  hull: { segment(o: V3, e: V3): { t: number; n: V3 } | null } | null,
  defs: LampDef[] = RANGER_LAMPS,
): PlacedLamp[] {
  return defs.map((L) => {
    const o: V3 = [L.at[0] + 3 * L.out[0], L.at[1] + 3 * L.out[1], L.at[2] + 3 * L.out[2]];
    const e: V3 = [L.at[0] - L.out[0], L.at[1] - L.out[1], L.at[2] - L.out[2]];
    const h = hull?.segment(o, e) ?? null;
    if (!h) return { ...L, p: L.at, n: L.out };
    const p: V3 = [o[0] + (e[0] - o[0]) * h.t, o[1] + (e[1] - o[1]) * h.t, o[2] + (e[2] - o[2]) * h.t];
    // (the face's normal, out of the hull: towards where the ray came from)
    const s = h.n[0] * L.out[0] + h.n[1] * L.out[1] + h.n[2] * L.out[2] < 0 ? -1 : 1;
    const n: V3 = [h.n[0] * s, h.n[1] * s, h.n[2] * s];
    // (out along the way the ray came: a thin wingtip's faces point up or down)
    return { ...L, p: [p[0] + 0.06 * L.out[0], p[1] + 0.06 * L.out[1], p[2] + 0.06 * L.out[2]], n };
  });
}

/** The strobes' light at time t [s]: two 50 ms flashes 150 ms apart, every 1.2 s. */
export function strobeAt(t: number): number {
  const f = (((t % 1.2) + 1.2) % 1.2) / 1.2;
  const k = f * 1.2;
  return k < 0.05 || (k >= 0.15 && k < 0.2) ? 1 : 0;
}

/** What each lamp shows now: its share of its light (0: off) — the cockpit's switches, the strobes' rhythm. */
export function lampLevels(
  lamps: LampDef[],
  s: { navLights: boolean; strobeLights: boolean; landingLights: boolean },
  t: number,
): number[] {
  return lamps.map((L) =>
    L.kind === "nav" ? (s.navLights ? 1 : 0) : L.kind === "strobe" ? (s.strobeLights ? strobeAt(t) : 0) : s.landingLights ? 1 : 0,
  );
}

/** The lamps' uniform (ship.wgsl S.lampN then S.lamp): the count; per lamp its place and lens radius, its
 *  colour × level, its beam and cone's cosine (−2: all round). Those off left out. */
export function lampUniform(lamps: PlacedLamp[], levels: number[]): Float32Array<ArrayBuffer> {
  const u = new Float32Array(4 + MAX_LAMPS * 12);
  let n = 0;
  lamps.forEach((L, i) => {
    const k = levels[i] ?? 0;
    if (k <= 0 || n >= MAX_LAMPS) return;
    const r = L.kind === "landing" ? 0.09 : 0.05;
    const b = L.beam ?? [0, 0, 0];
    u.set([...L.p, r, L.colour[0] * k, L.colour[1] * k, L.colour[2] * k, 0, ...b, L.beam ? (L.cone ?? 0.9) : -2], 4 + n * 12);
    n++;
  });
  u[0] = n;
  return u;
}
