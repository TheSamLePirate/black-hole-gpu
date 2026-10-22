// What the A320 shows of the air and the ground (docs/PLAN-A320.md, A13): the trails' sources (contrails.ts, drawn by
// ship.wgsl) its flight makes this frame, in the ship's frame — the air condensing over the upper wing at a high lift
// in humid air (an approach with the flaps out, a rotation, a pull), its tip vortices and its flaps' outer edges'; the
// CFM56's inlet vortex, a thin funnel from the ground at high power and low speed; the tyres' smoke as the mains spin up
// at the touchdown; the spray a wet runway throws up behind the wheels and the reversers' flow in front of the
// nacelles. Where on the airframe: the exterior model's (assets/a320/a320.bin: the wing's upper surface, the nacelles'
// inlets, the gear — src/gear.ts). Pure but for its own memory of the gear's loads.

import type { TrailKind } from "../contrails";

type V3 = [number, number, number];

/** A source of the A320's (ship frame): as contrails.ts's, and a column's other end (the inlet vortex: drawn whole). */
export interface FxSource {
  key: string;
  q: V3;
  kind: TrailKind;
  str: number;
  to?: V3;
  mid?: V3;
}

/** A frame's figures. */
export interface FxIn {
  dt: number;
  /** the lift coefficient, the air's density [kg/m³] and temperature [K], the airspeed [m/s], the relative
   *  humidity 0…1, the flaps' angle [deg] */
  cl: number;
  rho: number;
  T: number;
  speed: number;
  humidity: number;
  flap: number;
  /** on its wheels, the speed over the ground [m/s], the vertical speed [m/s, up > 0] */
  onGround: boolean;
  gs: number;
  vz: number;
  /** each engine: its N1 [%], its reverser's doors 0…1 */
  engines: { n1: number; rev: number }[];
  /** the runway wet 0…1 (the rain on it) */
  wet: number;
  /** each leg's load [N] — the nose's, the left main's, the right main's (src/gear.ts) —, none in the air */
  legs: number[] | null;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The wing's upper surface, a little over its thickest line (the exterior model's: 1.84 m up at 5 m out, 2.53 at
 *  11 m, 3.06 at 16.5 m), the left one; its tip, its outer flap's outer edge. */
const SHEET_ROOT: V3 = [4.5, 1.98, 1.3];
const SHEET_TIP: V3 = [15.0, 2.95, -1.5];
const TIP: V3 = [17.0, 2.95, -2.0];
const FLAP_EDGE: V3 = [13.4, 2.5, -2.7];
/** the CFM56s' inlets (the nacelles' axes 5.63 m out, 0.43 m up; the lips 7.5 m ahead of the origin, 1 m round), the
 *  ground under them at rest */
const INLET_X = 5.63;
const GROUND_Y = -1.68;
/** the legs' contacts: the nose's, the mains' (src/gear.ts — 4.33 m out, 1.14 m ahead) */
const LEGS: V3[] = [
  [0, GROUND_Y + 0.25, 13.65],
  [4.326, GROUND_Y + 0.25, 1.139],
  [-4.326, GROUND_Y + 0.25, 1.139],
];

/** The relative humidity of the weather: the model's (its dew point), else its kind's (fog and rain saturated, the
 *  fair weather's 60 %). */
export function humidityOf(wx: { kind?: string; rain?: number; model?: { T: number; Td: number } } | null | undefined): number {
  const m = wx?.model;
  if (m && Number.isFinite(m.T) && Number.isFinite(m.Td)) {
    // (Magnus: e_s(T) ∝ exp(17.62 T / (243.12 + T)), T in °C)
    const es = (t: number) => Math.exp((17.62 * t) / (243.12 + t));
    return Math.min(Math.max(es(m.Td) / es(m.T), 0), 1);
  }
  const k = wx?.kind ?? "fair";
  const base = { fog: 1, rain: 0.95, storm: 0.95, overcast: 0.85, cloudy: 0.75, windy: 0.6, dust: 0.2 }[k] ?? 0.6;
  return Math.max(base, (wx?.rain ?? 0) > 0.05 ? 0.92 : 0);
}

export class A320Fx {
  /** each leg's load last frame [N], each main's spin-up left [s] and its smoke's strength */
  private last: number[] = [0, 0, 0];
  private spin: { t: number; str: number }[] = [
    { t: 0, str: 0 },
    { t: 0, str: 0 },
    { t: 0, str: 0 },
  ];

  private clock = 0;

  /** The sources this frame. */
  step(i: FxIn): FxSource[] {
    this.clock += i.dt;
    const out: FxSource[] = [];
    const humid = smooth(0.62, 0.92, i.humidity);
    const above0 = smooth(268, 276, i.T);
    // ---- the air over the wing: a high lift (the flaps out at the approach's speeds, a pull) in humid air
    if (!i.onGround || i.gs > 40) {
      const lift = smooth(0.95, 1.7, i.cl) * smooth(45, 70, i.speed) + smooth(0.75, 1.1, i.cl) * smooth(110, 160, i.speed);
      const sheet = Math.min(lift, 1) * humid * smooth(0.6, 1.0, i.rho) * above0;
      if (sheet > 0.01)
        for (const sx of [1, -1])
          for (let k = 0; k < 6; k++) {
            const f = k / 5;
            const q: V3 = [
              (SHEET_ROOT[0] + (SHEET_TIP[0] - SHEET_ROOT[0]) * f) * sx,
              SHEET_ROOT[1] + (SHEET_TIP[1] - SHEET_ROOT[1]) * f + 0.12,
              SHEET_ROOT[2] + (SHEET_TIP[2] - SHEET_ROOT[2]) * f,
            ];
            // (thickest inboard of the flaps' track, ragged outward)
            out.push({ key: `a320v${sx}${k}`, q, kind: 9, str: 0.7 * sheet * (0.55 + 0.45 * Math.sin(Math.PI * (0.2 + 0.7 * f))) });
          }
      // ---- the tip vortices, and the flaps' outer edges' with the flaps out
      const vort =
        smooth(0.8, 1.4, i.cl) * smooth(40, 65, i.speed) * smooth(0.5, 0.85, i.humidity) * smooth(0.45, 0.9, i.rho) * smooth(258, 270, i.T);
      if (vort > 0.01)
        for (const sx of [1, -1]) {
          // (a thin swirl, a couple of seconds — a humid day's)
          out.push({ key: `a320t${sx}`, q: [TIP[0] * sx, TIP[1], TIP[2]], kind: 3, str: vort });
          const fe = vort * smooth(5, 20, i.flap);
          if (fe > 0.01) out.push({ key: `a320f${sx}`, q: [FLAP_EDGE[0] * sx, FLAP_EDGE[1], FLAP_EDGE[2]], kind: 3, str: 0.8 * fe });
        }
    }
    // ---- the inlet vortex: on the ground, slow, at high power, in humid air — a funnel from the ground ahead of the
    // lip into the inlet
    if (i.onGround)
      i.engines.forEach((e, k) => {
        const s = smooth(55, 85, e.n1) * smooth(28, 6, i.gs) * smooth(0.55, 0.9, i.humidity) * smooth(266, 274, i.T);
        const x = k === 0 ? INLET_X : -INLET_X;
        // (bending into the inlet's lip from below, its foot wandering on the ground)
        const t = this.clock;
        const foot: V3 = [x + 0.3 + 0.35 * Math.sin(t * 1.3 + k), GROUND_Y + 0.02, 10.4 + 0.4 * Math.sin(t * 0.9 + 2 * k)];
        if (s > 0.01) out.push({ key: `a320i${k}`, q: foot, mid: [x + 0.1, -1.1, 8.0], to: [x, 0.05, 7.45], kind: 3, str: s });
      });
    // ---- the tyres' smoke: a main touching at speed — its wheels spun up from rest in some 0.5 s, burning rubber
    const L = i.legs;
    for (let k = 0; k < 3; k++) {
      const now = L?.[k] ?? 0;
      if (now > 0 && (this.last[k] ?? 0) <= 0 && i.gs > 25) {
        const hard = 0.75 + 0.25 * smooth(0.4, 2.5, -i.vz);
        this.spin[k] = { t: k === 0 ? 0.4 : 0.8, str: smooth(25, 70, i.gs) * hard * (k === 0 ? 0.5 : 1) };
      }
      this.last[k] = now;
      const S = this.spin[k]!;
      if (S.t > 0) {
        S.t -= i.dt;
        out.push({ key: `a320s${k}`, q: LEGS[k]!, kind: 8, str: S.str * smooth(0, 0.15, S.t + 0.05) });
      }
    }
    // ---- the spray off a wet runway: behind each wheel at speed; in front of the nacelles, the reversers' flow
    if (i.onGround && i.wet > 0.02) {
      const w = smooth(0.02, 0.4, i.wet);
      const sp = w * smooth(15, 55, i.gs);
      if (sp > 0.01)
        LEGS.forEach((p, k) => out.push({ key: `a320w${k}`, q: [p[0], p[1] + 0.15, p[2] - 1.2], kind: 7, str: sp * (k === 0 ? 0.6 : 1) }));
      i.engines.forEach((e, k) => {
        const r = w * smooth(0.3, 0.9, e.rev) * smooth(10, 35, i.gs) * smooth(40, 75, e.n1);
        const x = k === 0 ? INLET_X : -INLET_X;
        if (r > 0.01)
          for (const dx of [1.5, -1.5]) out.push({ key: `a320r${k}${dx}`, q: [x + dx, GROUND_Y + 0.5, 5.2], kind: 7, str: 0.8 * r });
      });
    }
    return out;
  }

  reset() {
    this.last = [0, 0, 0];
    for (const s of this.spin) s.t = 0;
  }
}
