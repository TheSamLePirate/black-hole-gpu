// The Ranger's cockpit controls (PLAN-COCKPIT K1): the levers, switches, lit buttons and the knob the pilot
// works with the pointer — their places on the dashboard's panels (measured on the cabin mesh: each panel a
// plane, its point and its normal towards the pilot), their geometry generated here (the cabin's model has no
// buttons of its own: its consoles are merged blocks), and each moving part's pose from its state. Pure: the
// mesh (the cabin's vertex layout — scripts/build-cockpit.ts — material 73, the control and its part in the
// uv), the poses (a uniform for ship.wgsl ctlVs), the boxes the pointer is tested against.
//
// Panel frame: a along the panel to the pilot's right, b up it, n out of it (towards the pilot) — the
// ship's frame is x left, y up, z the nose.

import type { Text } from "../i18n";

type V3 = [number, number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));
const lin = (...t: [V3, number][]): V3 => t.reduce<V3>((s, [v, k]) => add(s, mul(v, k)), [0, 0, 0]);

export interface Panel {
  /** a point on it (its centre) and its normal, towards the pilot */
  o: V3;
  n: V3;
}

/** The dashboard's panels (the cabin's planes: a point on each and its normal, measured by rays from the
 *  pilot's eye — a guess off by a centimetre buried a panel's placards). */
export const PANELS = {
  // left of the screens, before the pilot: the gear, the flaps, the air brake (its face ends 4 cm up)
  A: { o: [1.5958, 1.1366, 3.7612], n: norm([0.059, 0.53, -0.846]) },
  // the slanted panel beside the attitude screen: the lights
  B: { o: [1.2652, 1.1396, 3.7708], n: norm([-0.301, 0.482, -0.823]) },
  // right of the navigation screen, between the seats' reach: the autopilot
  C: { o: [0.4815, 1.1088, 3.7539], n: norm([0.186, 0.527, -0.829]) },
} satisfies Record<string, Panel>;
export type PanelId = keyof typeof PANELS;

/** A panel's axes: a (to the pilot's right), b (up it), n. */
export function panelFrame(p: Panel): { a: V3; b: V3; n: V3 } {
  const b = norm(lin([[0, 1, 0], 1], [p.n, -p.n[1]]));
  return { a: norm(cross(b, p.n)), b, n: p.n };
}

export type ControlKind = "lever" | "toggle" | "button" | "knob";

export interface ControlDef {
  id: string;
  kind: ControlKind;
  panel: PanelId;
  /** where on the panel [m]: along a, along b */
  at: [number, number];
  /** a lever's knob: the gear's wheel, the flaps' wedge, the air brake's T */
  knob?: "wheel" | "wedge" | "tee";
  /** a lever's or a toggle's swing [rad] at state 0 and 1 (positive: the arm's tip up the panel) */
  swing?: [number, number];
  /** a lit button's colour when on */
  lamp?: V3;
  /** its placard (aviation English, as cockpits' are): on a button's cap, under the others */
  placard: string;
  /** its name (the pointer's tip) */
  name: Text;
  /** a lever's detents (its positions 0…1; none: anywhere between) */
  stops?: number[];
}

const GREEN: V3 = [0.25, 1, 0.45],
  AMBER: V3 = [1, 0.6, 0.15],
  WHITE: V3 = [0.9, 0.95, 1];
const D = Math.PI / 180;

/** Every control, in their uniform's order (its index: the vertices' uv.x). */
export const CONTROLS: ControlDef[] = [
  // panel A: the gear (up the panel: up; down: down — its wheel), the flaps (0, ½, full: down), the air brake
  {
    id: "gear",
    name: { fr: "Train d'atterrissage", en: "Landing gear" },
    placard: "GEAR",
    kind: "lever",
    panel: "A",
    at: [-0.12, -0.032],
    knob: "wheel",
    stops: [0, 1],
    swing: [28 * D, -28 * D],
    lamp: [1, 0.12, 0.06],
  },
  {
    id: "flaps",
    name: { fr: "Volets", en: "Flaps" },
    placard: "FLAPS",
    kind: "lever",
    panel: "A",
    at: [-0.01, -0.032],
    knob: "wedge",
    stops: [0, 0.5, 1],
    swing: [30 * D, -30 * D],
  },
  {
    id: "airBrake",
    name: { fr: "Aérofrein", en: "Air brake" },
    placard: "SPD BRK",
    kind: "lever",
    panel: "A",
    at: [0.09, -0.032],
    knob: "tee",
    swing: [30 * D, -30 * D],
  },
  // panel B: the cabin's dimmer, the red night lighting; the navigation lights, the strobes, the landing lights
  {
    id: "dimmer",
    name: { fr: "Éclairage de la cabine", en: "Cabin lighting" },
    placard: "CABIN",
    kind: "knob",
    panel: "B",
    at: [-0.035, 0.045],
  },
  {
    id: "night",
    name: { fr: "Éclairage de nuit (rouge)", en: "Night lighting (red)" },
    placard: "NIGHT",
    kind: "toggle",
    panel: "B",
    at: [0.04, 0.045],
    swing: [-25 * D, 25 * D],
  },
  {
    id: "navLights",
    name: { fr: "Feux de navigation", en: "Navigation lights" },
    placard: "NAV",
    kind: "toggle",
    panel: "B",
    at: [-0.05, -0.045],
    swing: [-25 * D, 25 * D],
  },
  {
    id: "strobe",
    name: { fr: "Feux anticollision", en: "Strobe lights" },
    placard: "STROBE",
    kind: "toggle",
    panel: "B",
    at: [0, -0.045],
    swing: [-25 * D, 25 * D],
  },
  {
    id: "landingLights",
    name: { fr: "Phares d'atterrissage", en: "Landing lights" },
    placard: "LAND LT",
    kind: "toggle",
    panel: "B",
    at: [0.05, -0.045],
    swing: [-25 * D, 25 * D],
  },
  // panel C: the autopilot — the flight's phases (its top row, over the model's studs as the row under it),
  // the attitude holds, the modes, the disconnect; the SAS, the chronometer
  {
    id: "autoTakeoff",
    name: { fr: "Autopilote : décollage vers l'orbite", en: "Autopilot: take-off to orbit" },
    placard: "TKOFF",
    kind: "button",
    panel: "C",
    at: [-0.06, 0.13],
    lamp: GREEN,
  },
  {
    id: "autoCirc",
    name: { fr: "Autopilote : circulariser", en: "Autopilot: circularize" },
    placard: "CIRC",
    kind: "button",
    panel: "C",
    at: [0, 0.13],
    lamp: GREEN,
  },
  {
    id: "autoApproach",
    name: { fr: "Autopilote : approche de la cible", en: "Autopilot: approach the target" },
    placard: "APPR",
    kind: "button",
    panel: "C",
    at: [0.06, 0.13],
    lamp: GREEN,
  },
  {
    id: "holdPrograde",
    name: { fr: "Maintien : prograde", en: "Hold: prograde" },
    placard: "PRO",
    kind: "button",
    panel: "C",
    at: [-0.06, 0.065],
    lamp: GREEN,
  },
  {
    id: "holdRetrograde",
    name: { fr: "Maintien : rétrograde", en: "Hold: retrograde" },
    placard: "RETRO",
    kind: "button",
    panel: "C",
    at: [0, 0.065],
    lamp: GREEN,
  },
  {
    id: "holdTarget",
    name: { fr: "Maintien : vers la cible", en: "Hold: towards the target" },
    placard: "TGT",
    kind: "button",
    panel: "C",
    at: [0.06, 0.065],
    lamp: GREEN,
  },
  {
    id: "assist",
    name: { fr: "Mode assisté", en: "Assisted mode" },
    placard: "ASSIST",
    kind: "button",
    panel: "C",
    at: [-0.06, 0],
    lamp: WHITE,
  },
  {
    id: "autoEntry",
    name: { fr: "Autopilote : rentrée et atterrissage", en: "Autopilot: entry and landing" },
    placard: "ENTRY",
    kind: "button",
    panel: "C",
    at: [0, 0],
    lamp: GREEN,
  },
  {
    id: "autoLand",
    name: { fr: "Autopilote : atterrir", en: "Autopilot: land" },
    placard: "LAND",
    kind: "button",
    panel: "C",
    at: [0.06, 0],
    lamp: GREEN,
  },
  {
    id: "sas",
    name: { fr: "SAS (stabilisation)", en: "SAS (stability assist)" },
    placard: "SAS",
    kind: "button",
    panel: "C",
    at: [-0.06, -0.065],
    lamp: GREEN,
  },
  {
    id: "chrono",
    name: { fr: "Chronomètre", en: "Chronometer" },
    placard: "CHRONO",
    kind: "button",
    panel: "C",
    at: [0, -0.065],
    lamp: WHITE,
  },
  {
    id: "apOff",
    name: { fr: "Autopilote et maintiens coupés", en: "Autopilot and holds off" },
    placard: "AP OFF",
    kind: "button",
    panel: "C",
    at: [0.06, -0.065],
    lamp: AMBER,
  },
];

export const MAX_CONTROLS = 32;
/** The uniform's vec4s per control: its moving part's pivot and angle, the axis, a push, the lamp and hover. */
export const POSE_VEC4 = 4;

/** A control's state: its position 0…1 (a lever's, a toggle's, the knob's), lit, pressed now, hovered. */
export interface ControlState {
  pos: number;
  lit?: number;
  pressed?: boolean;
  hover?: boolean;
}

/** Where a control is: its panel's axes and its base's centre. */
export function controlFrame(c: ControlDef): { o: V3; a: V3; b: V3; n: V3 } {
  const P = PANELS[c.panel];
  const f = panelFrame(P);
  return { ...f, o: lin([P.o, 1], [f.a, c.at[0]], [f.b, c.at[1]]) };
}

// ---- the geometry: boxes and cylinders, in the cabin's vertex layout
const STRIDE = 10;
class MeshOut {
  v: number[] = [];
  i: number[] = [];
  vert(p: V3, n: V3, ctl: number, part: number, fu = 0, fv = 0) {
    // (uv: the control's index and its part — their fractions a placard's place on it, 0…0.9)
    this.v.push(...p, ...n, 73, 1, ctl + fu, part + fv);
    return this.v.length / STRIDE - 1;
  }
  quad(p: [V3, V3, V3, V3], n: V3, ctl: number, part: number) {
    const k = p.map((q) => this.vert(q, n, ctl, part));
    // (wound counter-clockwise seen from n: the cabin's pipeline culls the back faces)
    const flip = dot(cross(add(p[1], mul(p[0], -1)), add(p[2], mul(p[0], -1))), n) < 0;
    const [a, b, c, d] = flip ? [k[0]!, k[3]!, k[2]!, k[1]!] : [k[0]!, k[1]!, k[2]!, k[3]!];
    this.i.push(a, b, c, a, c, d);
  }
  /** a placard: a quad (centre, half-extents along the panel's a and b, its normal) mapped onto the
   *  control's cell of the placards' texture */
  placard(c: V3, ea: V3, eb: V3, n: V3, ctl: number, part: number) {
    const k = [
      this.vert(lin([c, 1], [ea, -1], [eb, -1]), n, ctl, part, 0, 0),
      this.vert(lin([c, 1], [ea, 1], [eb, -1]), n, ctl, part, 0.9, 0),
      this.vert(lin([c, 1], [ea, 1], [eb, 1]), n, ctl, part, 0.9, 0.9),
      this.vert(lin([c, 1], [ea, -1], [eb, 1]), n, ctl, part, 0, 0.9),
    ];
    const flip = dot(cross(ea, eb), n) < 0;
    if (flip) this.i.push(k[0]!, k[2]!, k[1]!, k[0]!, k[3]!, k[2]!);
    else this.i.push(k[0]!, k[1]!, k[2]!, k[0]!, k[2]!, k[3]!);
  }
  /** a box: its centre, its three half-extent vectors (orthogonal) */
  box(c: V3, ex: V3, ey: V3, ez: V3, ctl: number, part: number) {
    for (const [u, v, w] of [
      [ex, ey, ez],
      [ey, ez, ex],
      [ez, ex, ey],
    ] as [V3, V3, V3][])
      for (const s of [1, -1]) {
        const f = add(c, mul(w, s));
        const n = norm(mul(w, s));
        this.quad(
          [lin([f, 1], [u, -1], [v, -1]), lin([f, 1], [u, 1], [v, -1]), lin([f, 1], [u, 1], [v, 1]), lin([f, 1], [u, -1], [v, 1])],
          n,
          ctl,
          part,
        );
      }
  }
  /** a cylinder: its centre, its axis (unit), radius, half length, segments; its caps */
  cylinder(c: V3, ax: V3, r: number, h: number, seg: number, ctl: number, part: number) {
    const e1 = norm(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const e2 = cross(ax, e1);
    const ring = (k: number) => {
      const t = (2 * Math.PI * k) / seg;
      return lin([e1, Math.cos(t)], [e2, Math.sin(t)]);
    };
    for (let k = 0; k < seg; k++) {
      const d0 = ring(k),
        d1 = ring(k + 1);
      const p = (d: V3, s: number) => lin([c, 1], [d, r], [ax, s * h]);
      // the side, smooth
      const q = [
        this.vert(p(d0, -1), d0, ctl, part),
        this.vert(p(d1, -1), d1, ctl, part),
        this.vert(p(d1, 1), d1, ctl, part),
        this.vert(p(d0, 1), d0, ctl, part),
      ];
      const flip = dot(cross(add(p(d1, -1), mul(p(d0, -1), -1)), add(p(d1, 1), mul(p(d0, -1), -1))), d0) < 0;
      if (flip) this.i.push(q[0]!, q[2]!, q[1]!, q[0]!, q[3]!, q[2]!);
      else this.i.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!);
      // the caps
      for (const s of [1, -1]) {
        const cc = lin([c, 1], [ax, s * h]);
        const n = mul(ax, s);
        const t = [this.vert(cc, n, ctl, part), this.vert(p(d0, s), n, ctl, part), this.vert(p(d1, s), n, ctl, part)];
        const fl = dot(cross(add(p(d0, s), mul(cc, -1)), add(p(d1, s), mul(cc, -1))), n) < 0;
        this.i.push(t[0]!, fl ? t[2]! : t[1]!, fl ? t[1]! : t[2]!);
      }
    }
  }
}

/** The parts: 0 the base (still), 1 the moving arm, 2 the moving knob, 3 the moving lit cap, 4 the placard
 *  (still). */
export const PART = { base: 0, arm: 1, knob: 2, cap: 3, placard: 4 } as const;

/** The placards' texture: a cell per control (4 × 8 of 256 × 64 px), its text centred. */
export const PLACARD_GRID = { cols: 4, rows: 8, w: 256, h: 64 } as const;

/** The controls' mesh, at rest (each moving part where state 0.5 puts it: the arm out of the panel). */
export function controlMesh(list: ControlDef[] = CONTROLS): { verts: Float32Array<ArrayBuffer>; idx: Uint32Array<ArrayBuffer> } {
  const m = new MeshOut();
  list.forEach((c, k) => {
    const { o, a, b, n } = controlFrame(c);
    // (out of the panel by a hair: its own surface under it)
    const at = (da: number, db: number, dn: number) => lin([o, 1], [a, da], [b, db], [n, dn]);
    if (c.kind === "lever") {
      // a plate and its slot's lips; the arm (6 cm) out of the panel, swinging up and down it; its knob
      m.box(at(0, 0, 0.004), mul(a, 0.022), mul(b, 0.044), mul(n, 0.004), k, PART.base);
      m.box(at(-0.006, 0, 0.009), mul(a, 0.003), mul(b, 0.036), mul(n, 0.002), k, PART.base);
      m.box(at(0.006, 0, 0.009), mul(a, 0.003), mul(b, 0.036), mul(n, 0.002), k, PART.base);
      m.box(at(0, 0, 0.04), mul(a, 0.0035), mul(b, 0.0035), mul(n, 0.032), k, PART.arm);
      if (c.knob === "wheel") m.cylinder(at(0, 0, 0.074), n, 0.017, 0.007, 20, k, PART.knob);
      else if (c.knob === "wedge") m.box(at(0, 0, 0.074), mul(a, 0.016), mul(b, 0.006), mul(n, 0.009), k, PART.knob);
      else m.box(at(0, 0, 0.074), mul(a, 0.022), mul(b, 0.005), mul(n, 0.005), k, PART.knob);
    } else if (c.kind === "toggle") {
      // a bezel, the bat (2 cm) out of it
      m.box(at(0, 0, 0.003), mul(a, 0.012), mul(b, 0.016), mul(n, 0.003), k, PART.base);
      m.cylinder(at(0, 0, 0.007), n, 0.005, 0.002, 12, k, PART.base);
      m.cylinder(at(0, 0, 0.018), n, 0.0022, 0.011, 8, k, PART.arm);
      m.cylinder(at(0, 0, 0.03), n, 0.0034, 0.003, 10, k, PART.knob);
    } else if (c.kind === "button") {
      // a square bezel, the cap (lit when on) in it
      m.box(at(0, 0, 0.003), mul(a, 0.019), mul(b, 0.019), mul(n, 0.003), k, PART.base);
      m.box(at(0, 0, 0.009), mul(a, 0.015), mul(b, 0.015), mul(n, 0.004), k, PART.cap);
      m.placard(at(0, 0, 0.0134), mul(a, 0.014), mul(b, 0.0035 * 1.0), n, k, PART.cap);
    } else {
      // the knob: a skirt with its scale, the grip turning on it, its pointer
      m.cylinder(at(0, 0, 0.002), n, 0.024, 0.002, 28, k, PART.base);
      m.cylinder(at(0, 0, 0.012), n, 0.015, 0.008, 24, k, PART.knob);
      m.box(at(0, 0.011, 0.0205), mul(a, 0.0015), mul(b, 0.004), mul(n, 0.0006), k, PART.cap);
    }
    // (the others' placard: a strip under them)
    if (c.kind !== "button") {
      const below = c.kind === "lever" ? 0.058 : c.kind === "knob" ? 0.032 : 0.025;
      m.placard(
        at(0, -below, 0.0025),
        mul(a, c.kind === "lever" ? 0.024 : 0.018),
        mul(b, c.kind === "lever" ? 0.006 : 0.0045),
        n,
        k,
        PART.placard,
      );
    }
  });
  return { verts: new Float32Array(m.v), idx: new Uint32Array(m.i) };
}

/** A control's moving part: the pivot, the axis it turns about and the angle, a push along the panel's
 *  normal [m]. */
export function controlPose(c: ControlDef, s: ControlState): { pivot: V3; axis: V3; angle: number; push: number } {
  const { o, a, n } = controlFrame(c);
  const p = Math.min(Math.max(s.pos, 0), 1);
  if (c.kind === "lever" || c.kind === "toggle") {
    const [s0, s1] = c.swing ?? [0, 0];
    // (about the panel's a axis: a positive angle tips the arm's tip up the panel — b)
    return { pivot: lin([o, 1], [n, c.kind === "lever" ? 0.008 : 0.007]), axis: mul(a, -1), angle: s0 + (s1 - s0) * p, push: 0 };
  }
  if (c.kind === "knob") return { pivot: o, axis: n, angle: (-135 + 270 * p) * D, push: 0 };
  return { pivot: o, axis: n, angle: 0, push: s.pressed ? -0.0025 : 0 };
}

/** The poses' uniform (ship.wgsl Controls): per control its pivot and angle, the axis, the push along the
 *  panel's normal, the lamp's light (its colour × lit) and the hover. */
export function poseData(states: Record<string, ControlState>, list: ControlDef[] = CONTROLS): Float32Array<ArrayBuffer> {
  const out = new Float32Array(MAX_CONTROLS * POSE_VEC4 * 4);
  list.forEach((c, k) => {
    const s = states[c.id] ?? { pos: 0 };
    const q = controlPose(c, s);
    const { n } = controlFrame(c);
    const lamp = c.lamp ?? WHITE;
    const lit = s.lit ?? 0;
    out.set([...q.pivot, q.angle, ...q.axis, 0, ...mul(n, q.push), 0, ...mul(lamp, lit), s.hover ? 1 : 0], k * POSE_VEC4 * 4);
  });
  return out;
}

/** The box the pointer is tested against for a control: its centre, its axes (unit), its half-extents —
 *  generous: the whole swing of a lever, a button's bezel. */
export function controlBox(c: ControlDef): { c: V3; axes: [V3, V3, V3]; half: V3 } {
  const { o, a, b, n } = controlFrame(c);
  const h: V3 =
    c.kind === "lever"
      ? [0.03, 0.06, 0.045]
      : c.kind === "toggle"
        ? [0.014, 0.02, 0.018]
        : c.kind === "knob"
          ? [0.024, 0.024, 0.012]
          : [0.02, 0.02, 0.008];
  return { c: lin([o, 1], [n, h[2]]), axes: [a, b, n], half: h };
}

/** The ray (o, unit d) against a control's box: the distance, or null. */
export function rayBox(o: V3, d: V3, box: { c: V3; axes: [V3, V3, V3]; half: V3 }): number | null {
  let t0 = 0,
    t1 = Infinity;
  const rel = add(o, mul(box.c, -1));
  for (let k = 0; k < 3; k++) {
    const ax = box.axes[k]!;
    const e = dot(rel, ax),
      f = dot(d, ax);
    const h = box.half[k]!;
    if (Math.abs(f) < 1e-9) {
      if (Math.abs(e) > h) return null;
      continue;
    }
    let ta = (-h - e) / f,
      tb = (h - e) / f;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
