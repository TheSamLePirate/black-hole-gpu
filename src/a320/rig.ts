// The A320's mesh and its rig (docs/PLAN-A320.md, A1–A2): assets/a320/a320.bin, as scripts/build-a320.py writes
// it — the vertices in the ship's frame with everything at rest (the gear down, the surfaces neutral, the doors
// shut), and FlightGear's own animations (the A320-family's fuselage.xml, a320.cfm.xml, A320-common.xml) as a tree
// of nodes, each turning, sliding, spinning, hiding or tracking (the gear's linkages) the parts under it from a
// property's value. Evaluated here per frame into each part's affine map (ship.wgsl partM: rows of a 3 × 4
// matrix) exactly as SimGear evaluates them (scripts/a320/fgrig.py). Pure: no GPU here.

type V3 = [number, number, number];

/** A condition (FlightGear's <condition>, as build-a320.py writes it). */
export type Cond =
  | ["prop", string]
  | ["val", number]
  | ["not", Cond]
  | ["and" | "or", ...Cond[]]
  | ["greater-than" | "less-than" | "greater-than-equals" | "less-than-equals" | "equals" | "not-equals", Cond, Cond];

export interface RigNode {
  type: "rotate" | "translate" | "spin" | "select" | "locked-track" | "slave";
  parent: number;
  objects: string[];
  name?: string;
  prop?: string;
  factor?: number;
  offset?: number;
  table?: [number, number][];
  min?: number;
  max?: number;
  axis?: V3;
  center?: V3;
  cond?: Cond | null;
  // (locked-track: SGTrackToAnimation's constants — its lock axis, track and up axes, the target's centre at rest
  // and the node carrying it, the two-link chain's slave centre and lengths)
  lock?: V3;
  t?: V3;
  u?: V3;
  targetCenter?: V3;
  target?: number;
  B0?: number;
  slaveCenter?: V3;
  a?: number;
  s?: number;
  sigma0?: number;
  slave?: number;
  master?: number;
}

export interface RigLamp {
  kind: "nav" | "strobe" | "beacon" | "wing" | "landing" | "taxi" | "turnoff";
  colour: "red" | "green" | "white";
  p: V3;
  /** on the wingtip fence or the sharklet (shown with it) */
  wingtip?: "fence" | "sharklet";
  /** riding a rig node (the landing lights' housings, the nose gear) */
  node?: number;
}

export interface A320Mesh {
  /** 10 floats a vertex (ship.ts's layout); the part (rig node + 1) and its ambient occlusion packed in the 8th */
  verts: Float32Array<ArrayBuffer>;
  idx: Uint32Array<ArrayBuffer>;
  lo: V3;
  hi: V3;
  nodes: RigNode[];
  lamps: RigLamp[];
}

export function parseA320(buf: ArrayBuffer): A320Mesh {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  if (magic !== "A320") throw new Error("bad a320.bin");
  const [, nv, ni] = new Uint32Array(buf, 4, 3) as unknown as [number, number, number];
  const b = new Float32Array(buf, 16, 6);
  let off = 40;
  const n = new Uint32Array(buf, off, 1)[0]!;
  const rig = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 4, n))) as { nodes: RigNode[]; lamps: RigLamp[] };
  off += 4 + n;
  const verts = new Float32Array(buf.slice(off, off + nv * 40));
  off += nv * 40;
  const idx = new Uint32Array(buf.slice(off, off + ni * 4));
  return { verts, idx, lo: [b[0]!, b[1]!, b[2]!], hi: [b[3]!, b[4]!, b[5]!], nodes: rig.nodes, lamps: rig.lamps };
}

/** The parts: the still airframe and each rig node. */
export const partCount = (m: A320Mesh) => m.nodes.length + 1;

/** Property values by FlightGear's path (without the leading "/"), and the spins' angles [rad] by path. */
export type Props = Record<string, number>;

/** 3 × 4 affine maps (rows) */
type M34 = Float64Array;
const ident = (): M34 => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
const zero = (): M34 => new Float64Array(12);
function mul(A: M34, B: M34): M34 {
  const o = new Float64Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? A[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) s += A[r * 4 + k]! * B[k * 4 + c]!;
      o[r * 4 + c] = s;
    }
  }
  return o;
}
/** A turn by `ang` (rad, right hand) about the line through `p` along `axis`. */
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
  const o = new Float64Array(12);
  for (let r = 0; r < 3; r++) {
    o[r * 4] = R[r * 3]!;
    o[r * 4 + 1] = R[r * 3 + 1]!;
    o[r * 4 + 2] = R[r * 3 + 2]!;
    o[r * 4 + 3] = p[r]! - (R[r * 3]! * p[0] + R[r * 3 + 1]! * p[1] + R[r * 3 + 2]! * p[2]);
  }
  return o;
}
const apply = (M: M34, p: V3): V3 =>
  [0, 1, 2].map((r) => M[r * 4]! * p[0] + M[r * 4 + 1]! * p[1] + M[r * 4 + 2]! * p[2] + M[r * 4 + 3]!) as V3;
/** The inverse of a rigid map (or the identity where it is singular: a hidden part's). */
function invRigid(M: M34): M34 {
  const o = new Float64Array(12);
  // (R^T, −R^T t)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 4 + c] = M[c * 4 + r]!;
  for (let r = 0; r < 3; r++) o[r * 4 + 3] = -(o[r * 4]! * M[3]! + o[r * 4 + 1]! * M[7]! + o[r * 4 + 2]! * M[11]!);
  return o;
}

function lookup(tab: [number, number][], x: number): number {
  if (x <= tab[0]![0]) return tab[0]![1];
  for (let i = 1; i < tab.length; i++) {
    const [x1, y1] = tab[i]!;
    if (x <= x1) {
      const [x0, y0] = tab[i - 1]!;
      return x1 !== x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return tab[tab.length - 1]![1];
}

/** A node's value from its property: its table, or factor × value + offset; clamped. */
export function nodeValue(n: RigNode, props: Props): number {
  const v = props[n.prop ?? ""] ?? 0;
  let r = n.table ? lookup(n.table, v) : v * (n.factor ?? 1) + (n.offset ?? 0);
  if (n.min !== undefined) r = Math.max(r, n.min);
  if (n.max !== undefined) r = Math.min(r, n.max);
  return r;
}

export function condition(c: Cond | null | undefined, props: Props): number | boolean {
  if (!c) return true;
  switch (c[0]) {
    case "prop":
      return props[c[1]] ?? 0;
    case "val":
      return c[1];
    case "not":
      return !condition(c[1], props);
    case "and":
      return (c.slice(1) as Cond[]).every((k) => condition(k, props));
    case "or":
      return (c.slice(1) as Cond[]).some((k) => condition(k, props));
    default: {
      const a = Number(condition(c[1], props));
      const b = Number(condition(c[2], props));
      return c[0] === "greater-than"
        ? a > b
        : c[0] === "less-than"
          ? a < b
          : c[0] === "greater-than-equals"
            ? a >= b
            : c[0] === "less-than-equals"
              ? a <= b
              : c[0] === "equals"
                ? a === b
                : a !== b;
    }
  }
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** the angle between sides p and q, opposite r (clamped) */
function sss(p: number, q: number, r: number) {
  const c = (p * p + q * q - r * r) / (2 * p * q);
  return c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);
}

/** SGTrackToAnimation: the root's and the slave's angles for the target's centre in the node's frame. */
function trackAngles(n: RigNode, tl: V3): [number, number] {
  const N = n.center!,
    L = n.lock!;
  const d: V3 = [tl[0] - N[0], tl[1] - N[1], tl[2] - N[2]];
  const dist = Math.hypot(...d);
  const k = dot(d, L);
  const dp: V3 = [d[0] - L[0] * k, d[1] - L[1] * k, d[2] - L[2] * k];
  let root = -(n.B0 ?? 0) + Math.atan2(dot(dp, n.u!), dot(dp, n.t!));
  let slave = 0;
  if (n.slaveCenter) {
    slave = -n.sigma0!;
    if (dist < n.a! + n.s!) {
      root += sss(n.a!, dist, n.s!);
      slave = sss(n.a!, n.s!, dist) - Math.PI - n.sigma0!;
    }
  }
  return [root, slave];
}

/**
 * Each part's map for the properties (and the spins' angles by property [rad]): 12 floats a part (rows of
 * 3 × 4; part 0 the still airframe), ship.wgsl's partM. The locked-tracks' targets are taken through the maps
 * themselves: a few passes settle the linkages (the gear's side stays track each other).
 */
export function rigMatrices(
  m: A320Mesh,
  props: Props,
  spins: Props = {},
  out = new Float32Array(partCount(m) * 12),
  passes = 3,
): Float32Array {
  const N = m.nodes;
  const local: M34[] = N.map(() => ident());
  const world: M34[] = N.map(() => ident());
  const tracks = new Float64Array(N.length * 2);
  const evalLocal = (i: number) => {
    const n = N[i]!;
    switch (n.type) {
      case "rotate":
        return turnAbout(n.center!, n.axis!, (nodeValue(n, props) * Math.PI) / 180);
      case "translate": {
        const v = nodeValue(n, props);
        const o = ident();
        o[3] = n.axis![0] * v;
        o[7] = n.axis![1] * v;
        o[11] = n.axis![2] * v;
        return o;
      }
      case "spin":
        return turnAbout(n.center!, n.axis!, spins[n.prop ?? ""] ?? 0);
      case "select":
        return condition(n.cond, props) ? ident() : zero();
      case "locked-track":
        return turnAbout(n.center!, n.lock!, tracks[2 * i]!);
      case "slave": {
        const M = N[n.master!]!;
        return turnAbout(M.slaveCenter!, M.lock!, tracks[2 * n.master! + 1]!);
      }
    }
    return ident();
  };
  // (the nodes come parents first)
  const settle = () => {
    for (let i = 0; i < N.length; i++) {
      local[i] = evalLocal(i);
      const p = N[i]!.parent;
      // (a hidden node — a select not holding — hides everything under it: its map all zeros)
      const L = local[i]!;
      world[i] = L[0] === 0 && L[5] === 0 && L[10] === 0 ? zero() : p >= 0 ? mul(world[p]!, L) : L;
    }
  };
  const hasTracks = N.some((n) => n.type === "locked-track");
  for (let pass = 0; pass < (hasTracks ? passes : 0); pass++) {
    // (each pass: the maps from the last pass's track angles, then the angles from those maps)
    settle();
    for (let i = 0; i < N.length; i++) {
      const n = N[i]!;
      if (n.type !== "locked-track") continue;
      const T = n.target! >= 0 ? apply(world[n.target!]!, n.targetCenter!) : n.targetCenter!;
      const P = n.parent >= 0 ? world[n.parent]! : ident();
      // (a hidden parent: nothing to track)
      if (P[0] === 0 && P[5] === 0 && P[10] === 0) continue;
      const [a, b] = trackAngles(n, apply(invRigid(P), T));
      tracks[2 * i] = a;
      tracks[2 * i + 1] = b;
    }
  }
  settle();
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 0);
  for (let i = 0; i < N.length; i++) out.set(world[i]!, (i + 1) * 12);
  return out;
}

/** The rig nodes named by an object (its innermost node), −1: still. */
export function nodeOfObject(m: A320Mesh, name: string): number {
  let best = -1;
  m.nodes.forEach((n, i) => {
    if (n.objects.includes(name)) best = i;
  });
  return best;
}
