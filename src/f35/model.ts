// The F-35's mesh and its moving parts (docs/PLAN-F35.md, F1–F2): assets/f35/f35.bin, as scripts/build-f35.py
// writes it — the vertices in the ship's frame with the gear out and every surface at rest, a table of parts
// (each control surface on its hinge, the gear's legs, doors and wheels on the tracks sampled from the
// model's clip, the nozzle's petals, the canopy, the pilot), and per frame each part's affine map (ship.wgsl
// partM: three rows of a 3 × 4 matrix) from the craft's state. Pure: no GPU here.

type V3 = [number, number, number];

/** A part's kind (build-f35.py): 0 still, 1 a hinge, 2 on a track, 3 a wheel (on its leg), 4 a nozzle petal. */
export const PART_STILL = 0;
export const PART_HINGE = 1;
export const PART_TRACK = 2;
export const PART_WHEEL = 3;
export const PART_PETAL = 4;
/** a segment of the three-bearing swivel module (the F-35B's nozzle), a lift fan's stage, a marker (no vertices) */
export const PART_SWIVEL = 5;
export const PART_FAN = 6;
export const PART_MARKER = 7;
/** the pilot's side stick (tilted about its base) and throttle (slid along its axis) */
export const PART_STICK = 8;
export const PART_THROTTLE = 9;

export interface F35Part {
  name: string;
  kind: number;
  parent: number;
  pivot: V3;
  axis: V3;
  /** a hinge's travel down / up [rad] (the canopy's: open); a wheel's radius, a petal's ring radius [m] */
  a: number;
  b: number;
  track: number;
  /** +1 left, −1 right, 0 the centre */
  side: number;
}

export interface F35Mesh {
  /** 10 floats a vertex (ship.ts's layout); the part and its ambient occlusion packed in the 8th */
  verts: Float32Array<ArrayBuffer>;
  idx: Uint32Array<ArrayBuffer>;
  lo: V3;
  hi: V3;
  parts: F35Part[];
  /** per track K affine maps (12 floats: 3 rows of 4), from the extended pose to extension k / (K − 1) */
  tracks: Float32Array[];
  K: number;
}

/** The part names (build-f35.py) of what the flight moves, found once. */
const NAMES = {
  stab: ["stabilator left", "stabilator right"],
  flaperon: ["flaperon left", "flaperon right"],
  lef: ["leading-edge flap left", "leading-edge flap right"],
  rudder: ["rudder left", "rudder right"],
  wheel: ["nose wheel", "left wheel", "right wheel"],
  leg: ["nose leg", "left leg", "right leg"],
} as const;

export function parseF35(buf: ArrayBuffer): F35Mesh {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  if (magic !== "F35B") throw new Error("bad f35.bin");
  const [ver, nv, ni] = new Uint32Array(buf, 4, 3) as unknown as [number, number, number];
  const b = new Float32Array(buf, 16, 6);
  const [np, K] = new Uint32Array(buf, 40, 2) as unknown as [number, number];
  let off = 48;
  const parts: F35Part[] = [];
  const P = new Float32Array(buf, off, np * 16);
  off += np * 64;
  let nTracks = 0;
  for (let i = 0; i < np; i++) {
    const r = P.subarray(16 * i, 16 * i + 16);
    const p: F35Part = {
      name: "",
      kind: Math.round(r[0]!),
      parent: Math.round(r[1]!),
      pivot: [r[2]!, r[3]!, r[4]!],
      axis: [r[5]!, r[6]!, r[7]!],
      a: r[8]!,
      b: r[9]!,
      track: Math.round(r[10]!),
      side: Math.round(r[11]!),
    };
    nTracks = Math.max(nTracks, p.track + 1);
    parts.push(p);
  }
  const tracks: Float32Array[] = [];
  for (let k = 0; k < nTracks; k++) {
    tracks.push(new Float32Array(buf.slice(off, off + K * 48)));
    off += K * 48;
  }
  // (v2: the parts' names, JSON)
  if (ver >= 2) {
    const n = new Uint32Array(buf, off, 1)[0]!;
    const names = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 4, n))) as string[];
    parts.forEach((p, i) => (p.name = names[i] ?? `part ${i}`));
    off += 4 + n;
  } else nameParts(parts);
  const verts = new Float32Array(buf.slice(off, off + nv * 40));
  off += nv * 40;
  const idx = new Uint32Array(buf.slice(off, off + ni * 4));
  return { verts, idx, lo: [b[0]!, b[1]!, b[2]!], hi: [b[3]!, b[4]!, b[5]!], parts, tracks, K };
}

/** The parts' names, from the build's order (the binary keeps none): what partIndex looks up. */
function nameParts(parts: F35Part[]) {
  // (build-f35.py's order: the airframe; per side the stabilator, the leading-edge flap, the flaperon, the
  // rudder; the legs each followed by its wheel; the six doors; the canopy, the pilot, the nozzle; the petals)
  const order = [
    "airframe",
    "stabilator left",
    "leading-edge flap left",
    "flaperon left",
    "rudder left",
    "stabilator right",
    "leading-edge flap right",
    "flaperon right",
    "rudder right",
    "nose leg",
    "nose wheel",
    "left leg",
    "left wheel",
    "right leg",
    "right wheel",
    "nose door, right",
    "nose door, left",
    "left inner door",
    "right inner door",
    "left outer door",
    "right outer door",
    "canopy",
    "pilot",
    "nozzle",
  ];
  parts.forEach((p, i) => (p.name = order[i] ?? (p.kind === PART_PETAL ? "petal" : `part ${i}`)));
}

export const partIndex = (m: F35Mesh, name: string) => m.parts.findIndex((p) => p.name === name);

/** What moves on the F-35 this frame. Angles in radians. */
export interface F35Pose {
  /** the gear: out 0…1 (its clip's time), each oleo compressed [m] (nose, left, right), each wheel's turn [rad] */
  gear: number;
  comp: V3;
  spin: V3;
  /** the nose wheel steered [rad] (> 0: to the left) */
  steer: number;
  /** the stabilators, the flaperons, the leading-edge flaps: their trailing edge down (> 0) — left, right */
  stab: [number, number];
  flaperon: [number, number];
  lef: [number, number];
  /** the rudders: their trailing edge to the left (> 0) — left, right (toed in together: the air brake) */
  rudder: [number, number];
  /** the canopy open 0…1; the nozzle's petals open 0…1 (the afterburner) */
  canopy: number;
  petals: number;
  /** the pilot drawn (not in the cockpit's view) */
  pilot: boolean;
  /** the F-35B's short take-off and vertical landing: its doors open 0…1 (the lift fan's, the inlets', the roll
   *  posts'), its nozzle swivelled down 0…1 (95°), its lift fan's turn [rad] */
  stovl: number;
  nozzle: number;
  fan: number;
  /** the side stick (> 0 back — the nose up —, > 0 right) −1…1, the throttle 0…1 */
  stick: [number, number];
  throttle: number;
}

export const restPose = (): F35Pose => ({
  gear: 1,
  comp: [0, 0, 0],
  spin: [0, 0, 0],
  steer: 0,
  stab: [0, 0],
  flaperon: [0, 0],
  lef: [0, 0],
  rudder: [0, 0],
  canopy: 0,
  petals: 0,
  pilot: true,
  stovl: 0,
  nozzle: 0,
  fan: 0,
  stick: [0, 0],
  throttle: 0,
});

/** 3 × 4 affine maps (rows) */
type M34 = Float32Array;
const ident = (): M34 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
function mul(A: M34, B: M34): M34 {
  const o = new Float32Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? A[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) s += A[r * 4 + k]! * B[k * 4 + c]!;
      o[r * 4 + c] = s;
    }
  }
  return o;
}
/** A turn by `ang` about the axis through `p` (Rodrigues). */
function turnAbout(p: V3, axis: V3, ang: number): M34 {
  const l = Math.hypot(...axis) || 1;
  const [x, y, z] = [axis[0] / l, axis[1] / l, axis[2] / l];
  const c = Math.cos(ang),
    s = Math.sin(ang),
    t = 1 - c;
  const R = [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
  const o = new Float32Array(12);
  for (let r = 0; r < 3; r++) {
    o[r * 4] = R[r * 3]!;
    o[r * 4 + 1] = R[r * 3 + 1]!;
    o[r * 4 + 2] = R[r * 3 + 2]!;
    o[r * 4 + 3] = p[r]! - (R[r * 3]! * p[0] + R[r * 3 + 1]! * p[1] + R[r * 3 + 2]! * p[2]);
  }
  return o;
}
function translate(d: V3): M34 {
  const o = ident();
  o[3] = d[0];
  o[7] = d[1];
  o[11] = d[2];
  return o;
}

/** A track's map at extension s (0 up … 1 down), linear between its samples. */
function trackAt(m: F35Mesh, k: number, s: number): M34 {
  const T = m.tracks[k]!;
  const x = Math.min(Math.max(s, 0), 1) * (m.K - 1);
  const i = Math.min(Math.floor(x), m.K - 2);
  const f = x - i;
  const o = new Float32Array(12);
  for (let j = 0; j < 12; j++) o[j] = T[i * 12 + j]! * (1 - f) + T[(i + 1) * 12 + j]! * f;
  return o;
}

/** The swivel's segments' own maps for a swivel 0…1: the first's (the duct's own turn, then its bearing's), the
 *  second's (its bearing's, back). */
function swivel(m: F35Mesh, s: number): Map<number, M34> {
  const out = new Map<number, M34>();
  const segs = m.parts.map((p, i) => [p, i] as const).filter(([p]) => p.kind === PART_SWIVEL);
  if (segs.length < 2 || s <= 0) return out;
  const psi = Math.min(s, 1) * Math.PI;
  const [[A, ia], [B, ib]] = segs as [readonly [F35Part, number], readonly [F35Part, number]];
  const RA = turnAbout(A.pivot, A.axis, psi * A.a);
  const RB = turnAbout(B.pivot, B.axis, psi * B.a);
  // (where the exit points: the duct's axis — aft — through both)
  const R = mul(RA, RB);
  const e: V3 = [-R[2]!, -R[6]!, -R[10]!];
  // (turned about the duct's axis — z — so it points straight down: −y)
  const chi = -Math.PI / 2 - Math.atan2(e[1], e[0]);
  const roll = Math.hypot(e[0], e[1]) > 1e-6 ? turnAbout(A.pivot, [0, 0, 1], chi) : ident();
  out.set(ia, mul(roll, RA));
  out.set(ib, RB);
  return out;
}

/** The nozzle's exit now (ship frame): its centre and the way the jet leaves — the swivel's marker, posed. */
export function nozzleExit(m: F35Mesh, mats: Float32Array): { p: V3; d: V3 } | null {
  const i = m.parts.findIndex((p) => p.kind === PART_MARKER && p.name === "nozzle exit");
  if (i < 0) return null;
  const P = m.parts[i]!;
  const M = mats.subarray(i * 12, i * 12 + 12);
  const ap = (v: V3, w: number): V3 =>
    [0, 1, 2].map((r) => M[r * 4]! * v[0] + M[r * 4 + 1]! * v[1] + M[r * 4 + 2]! * v[2] + w * M[r * 4 + 3]!) as V3;
  const d = ap(P.axis, 0);
  const l = Math.hypot(...d) || 1;
  return { p: ap(P.pivot, 1), d: [d[0] / l, d[1] / l, d[2] / l] };
}

/** Looks the named parts up once per mesh. */
const lookups = new WeakMap<F35Mesh, Record<keyof typeof NAMES, number[]>>();
function names(m: F35Mesh) {
  let L = lookups.get(m);
  if (!L) {
    L = Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [k, v.map((n) => partIndex(m, n))])) as Record<
      keyof typeof NAMES,
      number[]
    >;
    lookups.set(m, L);
  }
  return L;
}

/**
 * Each part's map for a pose: 12 floats a part (rows of 3 × 4), ship.wgsl's partM — a parent's map applied
 * after its child's own (a wheel turns on its leg, a petal on the nozzle).
 */
export function partMatrices(m: F35Mesh, pose: F35Pose, out = new Float32Array(m.parts.length * 12)): Float32Array {
  const L = names(m);
  const own: M34[] = m.parts.map(() => ident());
  const hinge = (i: number, ang: number) => {
    if (i < 0) return;
    const p = m.parts[i]!;
    own[i] = turnAbout(p.pivot, p.axis, Math.max(-p.a, Math.min(p.b, ang)));
  };
  L.stab.forEach((i, s) => hinge(i, pose.stab[s]!));
  L.flaperon.forEach((i, s) => hinge(i, pose.flaperon[s]!));
  L.lef.forEach((i, s) => hinge(i, pose.lef[s]!));
  L.rudder.forEach((i, s) => hinge(i, pose.rudder[s]!));
  // (the doors of the F-35B's vertical flight: open with the conversion; the bay's with the nozzle)
  const doorOpen = (name: string) =>
    name.startsWith("nozzle bay door")
      ? Math.min(1, pose.nozzle * 4)
      : name.startsWith("lift fan") || name.startsWith("auxiliary inlet") || name.startsWith("roll post")
        ? pose.stovl
        : -1;
  // (the three-bearing swivel: half a turn about each oblique bearing, opposite ways, at the full swivel; the
  // first bearing turns the whole about the duct to keep the exit in the vertical plane)
  const sw = swivel(m, pose.nozzle);
  m.parts.forEach((p, i) => {
    const open = p.kind === PART_HINGE ? doorOpen(p.name) : -1;
    if (open >= 0) own[i] = turnAbout(p.pivot, p.axis, p.b * Math.min(Math.max(open, 0), 1));
    else if (p.kind === PART_SWIVEL) own[i] = sw.get(i) ?? ident();
    else if (p.kind === PART_FAN) own[i] = turnAbout(p.pivot, p.axis, pose.fan * p.a);
    // (the stick: 12° back or forth, 10° aside — about its base; the throttle along its quadrant)
    else if (p.kind === PART_STICK)
      own[i] = mul(turnAbout(p.pivot, [0, 0, 1], (pose.stick[1] ?? 0) * 0.17), turnAbout(p.pivot, [1, 0, 0], -(pose.stick[0] ?? 0) * 0.21));
    else if (p.kind === PART_THROTTLE) own[i] = translate(p.axis.map((x) => x * p.a * Math.min(Math.max(pose.throttle, 0), 1)) as V3);
    else if (p.kind === PART_TRACK) own[i] = trackAt(m, p.track, pose.gear);
    else if (p.kind === PART_HINGE && p.name === "canopy") own[i] = turnAbout(p.pivot, p.axis, p.b * Math.min(Math.max(pose.canopy, 0), 1));
    else if (p.kind === PART_PETAL) own[i] = turnAbout(p.pivot, p.axis, 0.2 * Math.min(Math.max(pose.petals, 0), 1));
    else if ((p.name === "pilot" || p.name === "canopy arches") && !pose.pilot) own[i] = new Float32Array(12);
  });
  // (the wheels: up their leg by the oleo's compression, turned about their axle; the nose's steered about
  // the vertical through its axle)
  L.wheel.forEach((i, k) => {
    if (i < 0) return;
    const p = m.parts[i]!;
    let M = turnAbout(p.pivot, p.axis, pose.spin[k]!);
    if (k === 0 && pose.steer) M = mul(turnAbout(p.pivot, [0, 1, 0], pose.steer), M);
    own[i] = mul(translate([0, pose.comp[k]! * 0.5, 0]), M);
  });
  // (the legs' oleos: the leg's lower part is not cut from it — the whole leg rides up a little, as the
  // wheel does; the fuselage hides it)
  L.leg.forEach((i, k) => {
    if (i >= 0) own[i] = mul(own[i]!, translate([0, pose.comp[k]! * 0.5, 0]));
  });
  const world: (M34 | null)[] = m.parts.map(() => null);
  const resolve = (i: number): M34 => {
    if (world[i]) return world[i]!;
    const p = m.parts[i]!;
    const W = p.parent >= 0 ? mul(resolve(p.parent), own[i]!) : own[i]!;
    return (world[i] = W);
  };
  for (let i = 0; i < m.parts.length; i++) out.set(resolve(i), i * 12);
  return out;
}
