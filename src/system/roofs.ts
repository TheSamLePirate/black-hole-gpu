// The buildings' roofs (docs/PLAN-BATIMENTS-AAA.md B1): from a footprint and what the data say of it — the BD TOPO's eave
// and ridge, its roof's and walls' materials, its storeys and use; OSM's height to the top and colour — the roof's shape
// and the planes that make it. A roof is the surface z(x, y) = min of its planes over the footprint (the space under it
// convex): a flat roof one plane, a gabled one two and its cap, a hipped one a plane a side, a mansard two a side (the
// steep brisis, then the shallow terrasson). Each plane passes through a side of the footprint at the eave and rises
// inwards; a side shared with a neighbour (a party wall) has none — two terraced houses' roofs meet there, no gutter
// between them. Pure: the scenery's worker calls it, the tests too.

/** a point of a footprint, in the scenery's local metres (east, north) */
export type Pt = [number, number];
/** a roof's plane: z = a·x + b·y + c over the building's base [m] */
export type Plane = [number, number, number];

/** the BD TOPO's roof materials (the land registry's `dmatto`: a digit a material, two at most) */
export enum RoofMaterial {
  Unknown = 0,
  Tiles = 1,
  Slate = 2,
  Zinc = 3,
  Concrete = 4,
  /** (not the registry's: sheet metal, a light construction's or a warehouse's) */
  Metal = 5,
  Other = 9,
}
/** the BD TOPO's wall materials (`dmatgm`) */
export enum WallMaterial {
  Unknown = 0,
  Stone = 1,
  Millstone = 2,
  Concrete = 3,
  Brick = 4,
  Render = 5,
  Wood = 6,
  Other = 9,
}
export type RoofShape = "flat" | "gabled" | "hipped" | "mansard" | "shed";

/** the first known material of a registry code ("30", "04", "13" → 3, 4, 1), 0 when none */
export function materialCode(v: unknown): number {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  for (const c of s) {
    const d = c.charCodeAt(0) - 48;
    if (d >= 1 && d <= 9) return d;
  }
  return 0;
}
export function roofMaterial(v: unknown, region?: Region): RoofMaterial {
  // (in Paris, tiles and zinc together are a zinc roof with tiled parts: the zinc seen)
  if (region === "paris" && String(v ?? "").includes("3")) return RoofMaterial.Zinc;
  const d = materialCode(v);
  return d >= 1 && d <= 4 ? (d as RoofMaterial) : d === 9 ? RoofMaterial.Other : RoofMaterial.Unknown;
}
export function wallMaterial(v: unknown): WallMaterial {
  const d = materialCode(v);
  return d >= 1 && d <= 6 ? (d as WallMaterial) : d === 9 ? WallMaterial.Other : WallMaterial.Unknown;
}

// ---- the regions: what a roof is made of and how steep where the data say nothing

export type Region = "paris" | "france-west" | "france-north" | "france-south" | "alpine" | "mediterranean" | "north" | "temperate";
export function regionOf(lat: number, lon: number): Region {
  const france = lat > 41.3 && lat < 51.2 && lon > -5.2 && lon < 9.6;
  // (the Alps' and the Pyrenees' and Jura's valleys: a broad box, the plains round them hardly ever under it)
  if (lat > 44 && lat < 47.8 && lon > 5.7 && lon < 16.5) return "alpine";
  if (france) {
    // (Paris and its inner suburbs: zinc and slate over Haussmann's blocks — the registry silent on half of them)
    if (lat > 48.76 && lat < 48.96 && lon > 2.2 && lon < 2.5) return "paris";
    if (lat < 44.6) return "france-south";
    // (Brittany, Normandy, the Loire's west: slate)
    if (lon < 0.6 && lat > 46.2) return "france-west";
    return "france-north";
  }
  if (lat < 44 && lat > 30 && lon > -10 && lon < 40) return "mediterranean";
  if (Math.abs(lat) > 52) return "north";
  return "temperate";
}
interface RegionStyle {
  /** the roof most built there, and its pitch [°] */
  roof: RoofMaterial;
  pitch: number;
  /** the share of detached houses with a hipped roof (the rest gabled) */
  hip: number;
}
const REGION: Record<Region, RegionStyle> = {
  paris: { roof: RoofMaterial.Zinc, pitch: 35, hip: 0.3 },
  "france-west": { roof: RoofMaterial.Slate, pitch: 45, hip: 0.15 },
  "france-north": { roof: RoofMaterial.Tiles, pitch: 38, hip: 0.35 },
  "france-south": { roof: RoofMaterial.Tiles, pitch: 25, hip: 0.4 },
  alpine: { roof: RoofMaterial.Slate, pitch: 26, hip: 0.15 },
  mediterranean: { roof: RoofMaterial.Tiles, pitch: 22, hip: 0.35 },
  north: { roof: RoofMaterial.Tiles, pitch: 42, hip: 0.2 },
  temperate: { roof: RoofMaterial.Tiles, pitch: 35, hip: 0.3 },
};
/** a material's pitch [°] where the region's is not its (slate steeper, canal tiles flatter) */
function pitchOf(mat: RoofMaterial, region: Region) {
  const r = REGION[region];
  if (mat === RoofMaterial.Slate) return Math.max(r.pitch, region === "alpine" ? 26 : 42);
  if (mat === RoofMaterial.Zinc) return 30;
  if (mat === RoofMaterial.Metal || mat === RoofMaterial.Other) return 12;
  return r.pitch;
}

// ---- colours (linear albedo), a building's own variation from its seed

const lerp3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t) as [number, number, number];
export function roofColour(mat: RoofMaterial, region: Region, s: number): [number, number, number] {
  switch (mat) {
    case RoofMaterial.Tiles:
      // (the south's canal tiles orange and pale, the north's mechanical ones red-brown, some weathered dark)
      return region === "france-south" || region === "mediterranean"
        ? lerp3([0.38, 0.2, 0.12], [0.32, 0.22, 0.16], s)
        : lerp3([0.17, 0.088, 0.064], [0.13, 0.088, 0.07], s);
    case RoofMaterial.Slate:
      return lerp3([0.065, 0.072, 0.085], [0.095, 0.098, 0.105], s);
    case RoofMaterial.Zinc:
      return lerp3([0.27, 0.29, 0.31], [0.21, 0.23, 0.25], s);
    case RoofMaterial.Concrete:
      // (a terrace: gravel over its membrane, some bare bitumen)
      return lerp3([0.2, 0.195, 0.18], [0.11, 0.11, 0.105], s);
    case RoofMaterial.Metal:
      return lerp3([0.32, 0.33, 0.34], [0.2, 0.24, 0.22], s);
    case RoofMaterial.Other:
      return lerp3([0.16, 0.15, 0.14], [0.24, 0.22, 0.2], s);
    default:
      return roofColour(REGION[region].roof, region, s);
  }
}
export function wallColour(mat: WallMaterial, region: Region, s: number): [number, number, number] {
  switch (mat) {
    case WallMaterial.Stone:
      // (dressed limestone, Paris's and the Loire's: cream, greyer where it has weathered)
      return lerp3([0.5, 0.44, 0.33], [0.4, 0.37, 0.31], s);
    case WallMaterial.Millstone:
      return lerp3([0.34, 0.23, 0.13], [0.28, 0.21, 0.15], s);
    case WallMaterial.Concrete:
      return lerp3([0.34, 0.33, 0.31], [0.26, 0.26, 0.25], s);
    case WallMaterial.Brick:
      return lerp3([0.3, 0.11, 0.065], [0.24, 0.12, 0.08], s);
    case WallMaterial.Wood:
      return lerp3([0.19, 0.11, 0.055], [0.12, 0.08, 0.05], s);
    default: {
      // (render: white to cream to the south's ochres and pinks)
      const warm = region === "france-south" || region === "mediterranean";
      return warm ? lerp3([0.6, 0.5, 0.36], [0.55, 0.38, 0.3], s) : lerp3([0.58, 0.56, 0.5], [0.46, 0.42, 0.34], s);
    }
  }
}
/** an OSM `colour` ("#b4a995", "beige") as a linear albedo, kept within a wall's range; null when unknown */
export function osmColour(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const named: Record<string, string> = {
    white: "#e8e6e0",
    beige: "#d8c9a8",
    lightyellow: "#efe6b8",
    yellow: "#d8c060",
    grey: "#909090",
    gray: "#909090",
    silver: "#b8b8b8",
    brown: "#7a5236",
    red: "#a04030",
    black: "#303030",
    tan: "#c8a878",
  };
  const hex = (named[v.toLowerCase()] ?? v).replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const lin = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  // (a painted wall's albedo between 0.05 and 0.7: a "white" no brighter than fresh render)
  return [lin(0), lin(2), lin(4)].map((c) => 0.05 + 0.65 * c) as [number, number, number];
}

// ---- footprints

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** a ring's signed area (positive anticlockwise; closed or not) */
export function ringArea(r: Pt[]) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!,
      b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
/** a ring open (its last point not its first again) */
export function openRing(r: Pt[]): Pt[] {
  return r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? r.slice(0, -1) : r.slice();
}
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lo: Pt[] = [],
    hi: Pt[] = [];
  for (const v of p) {
    while (lo.length >= 2 && cross(lo.at(-2)!, lo.at(-1)!, v) <= 0) lo.pop();
    lo.push(v);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const v = p[i]!;
    while (hi.length >= 2 && cross(hi.at(-2)!, hi.at(-1)!, v) <= 0) hi.pop();
    hi.push(v);
  }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}
/** the least-area rectangle round points (a side of their hull's along one of its sides): its centre, its unit axis u
 *  (the long one), its half-sides along u and the perpendicular v */
export interface Obb {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  hu: number;
  hv: number;
}
export function orientedBox(points: Pt[]): Obb {
  const h = convexHull(points);
  let best: Obb = { cx: 0, cy: 0, ux: 1, uy: 0, hu: 0, hv: 0 },
    area = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!,
      b = h[(i + 1) % h.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const ux = (b[0] - a[0]) / l,
      uy = (b[1] - a[1]) / l;
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const c of h) {
      const u = c[0] * ux + c[1] * uy,
        v = -c[0] * uy + c[1] * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    if ((u1 - u0) * (v1 - v0) < area - 1e-9) {
      area = (u1 - u0) * (v1 - v0);
      const cu = (u0 + u1) / 2,
        cv = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = {
        cx: cu * ux - cv * uy,
        cy: cu * uy + cv * ux,
        ux: long ? ux : -uy,
        uy: long ? uy : ux,
        hu: (long ? u1 - u0 : v1 - v0) / 2,
        hv: (long ? v1 - v0 : u1 - u0) / 2,
      };
    }
  }
  return best;
}

/** a side of a footprint: its ends, its line (an outward unit normal, the line's offset along it: the outermost of the
 *  corners it joined), its length, whether a neighbour shares it */
export interface Side {
  a: Pt;
  b: Pt;
  nx: number;
  ny: number;
  q: number;
  length: number;
  party: boolean;
}
/**
 * The footprint's outer ring as sides: anticlockwise, the corners nearer than `tol` [m] merged and the near-straight runs
 * (within 6°) joined — a cadastral outline's jogs of a few centimetres are not sides —; each side's party flag where most
 * of its length was a party edge (`party`: the ring's own edges', in its order).
 */
export function sidesOf(ring: Pt[], party: boolean[] | undefined, tol = 0.25): Side[] {
  let r = openRing(ring);
  let flags = party ? party.slice(0, r.length) : r.map(() => false);
  if (ringArea(r) < 0) {
    // (clockwise: reversed, each edge's flag following it — edge i from r[i] to r[i+1])
    r = r.slice().reverse();
    flags = flags.slice().reverse();
    flags = [...flags.slice(1), flags[0]!];
  }
  // (edges with their length and party flag, then merged)
  type E = { a: Pt; b: Pt; partyLen: number; len: number; pts: Pt[] };
  let edges: E[] = r.map((a, i) => {
    const b = r[(i + 1) % r.length]!,
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, b, len, partyLen: flags[i] ? len : 0, pts: [a, b] };
  });
  edges = edges.filter((e) => e.len > 1e-6);
  const dir = (e: E) => Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]);
  const near = (x: number) => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
  let merged = true;
  while (merged && edges.length > 3) {
    merged = false;
    for (let i = 0; i < edges.length && edges.length > 3; i++) {
      const e = edges[i]!,
        f = edges[(i + 1) % edges.length]!;
      if (e.len < tol || f.len < tol || near(dir(e) - dir(f)) < (6 * Math.PI) / 180) {
        const g: E = {
          a: e.a,
          b: f.b,
          len: Math.hypot(f.b[0] - e.a[0], f.b[1] - e.a[1]),
          partyLen: e.partyLen + f.partyLen,
          pts: [...e.pts, ...f.pts.slice(1)],
        };
        if (i === edges.length - 1) {
          // (the pair wrapped round — the last edge and the first —: the merged one in the first's place)
          edges.pop();
          edges[0] = g;
        } else edges.splice(i, 2, g);
        merged = true;
        break;
      }
    }
  }
  return edges.map((e) => {
    const len = Math.max(e.len, 1e-6),
      nx = (e.b[1] - e.a[1]) / len,
      ny = -(e.b[0] - e.a[0]) / len;
    // (the party share over the joined edges' own lengths: a run's chord is shorter than they are)
    const own = e.pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - e.pts[i]![0], p[1] - e.pts[i]![1]), 0);
    return {
      a: e.a,
      b: e.b,
      nx,
      ny,
      q: Math.max(...e.pts.map((p) => p[0] * nx + p[1] * ny)),
      length: e.len,
      party: e.partyLen > 0.5 * own,
    };
  });
}

/**
 * The party edges among buildings (rings in the same local metres): an edge is shared where another building's edge runs
 * within `gap` [m] of it, parallel within 8°, over more than half of its length. Each ring's flags in its edges' order
 * (edge i from point i to i + 1, the closing edge last).
 */
export function partyEdges(buildings: Pt[][][], gap = 0.8): boolean[][][] {
  type E = { ax: number; ay: number; bx: number; by: number; who: number };
  const all: E[] = [];
  buildings.forEach((rings, who) => {
    for (const ring of rings) {
      const r = openRing(ring);
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!,
          b = r[(i + 1) % r.length]!;
        all.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], who });
      }
    }
  });
  const CELL = 6;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  all.forEach((e, j) => {
    const n = Math.max(1, Math.ceil(Math.hypot(e.bx - e.ax, e.by - e.ay) / CELL));
    const seen = new Set<string>();
    for (let s = 0; s <= n; s++) {
      const k = key(e.ax + ((e.bx - e.ax) * s) / n, e.ay + ((e.by - e.ay) * s) / n);
      if (seen.has(k)) continue;
      seen.add(k);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(j);
    }
  });
  const sin8 = Math.sin((8 * Math.PI) / 180);
  const shared = all.map((e) => {
    const l = Math.hypot(e.bx - e.ax, e.by - e.ay);
    if (l < 0.3) return false;
    const ux = (e.bx - e.ax) / l,
      uy = (e.by - e.ay) / l;
    const cand = new Set<number>();
    const n = Math.max(1, Math.ceil(l / CELL));
    for (let s = 0; s <= n; s++) {
      const x = e.ax + ((e.bx - e.ax) * s) / n,
        y = e.ay + ((e.by - e.ay) * s) / n;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(key(x + dx * CELL, y + dy * CELL)) ?? []) cand.add(j);
    }
    // (the lengths of the neighbours' edges along this one, as intervals of it, unioned)
    const spans: [number, number][] = [];
    for (const j of cand) {
      const o = all[j]!;
      if (o.who === e.who) continue;
      const ol = Math.hypot(o.bx - o.ax, o.by - o.ay);
      if (ol < 0.3) continue;
      if (Math.abs((ux * (o.by - o.ay)) / ol - (uy * (o.bx - o.ax)) / ol) > sin8) continue;
      const d1 = Math.abs((o.ax - e.ax) * uy - (o.ay - e.ay) * ux),
        d2 = Math.abs((o.bx - e.ax) * uy - (o.by - e.ay) * ux);
      if (Math.max(d1, d2) > gap) continue;
      const s1 = (o.ax - e.ax) * ux + (o.ay - e.ay) * uy,
        s2 = (o.bx - e.ax) * ux + (o.by - e.ay) * uy;
      const lo = Math.max(0, Math.min(s1, s2)),
        hi = Math.min(l, Math.max(s1, s2));
      if (hi > lo) spans.push([lo, hi]);
    }
    spans.sort((p, q) => p[0] - q[0]);
    let cover = 0,
      end = -Infinity;
    for (const [lo, hi] of spans) {
      if (hi <= end) continue;
      cover += hi - Math.max(lo, end);
      end = hi;
    }
    return cover > 0.5 * l;
  });
  let k = 0;
  return buildings.map((rings) => rings.map((ring) => openRing(ring).map(() => shared[k++]!)));
}

// ---- the roof

export interface RoofInput {
  /** the footprint: its outer ring first, then its courtyards' (local metres) */
  rings: Pt[][];
  /** the outer ring's party flags (partyEdges), in its edges' order */
  party?: boolean[];
  /** the walls' height over the base [m]: the BD TOPO's eave; OSM's height to the top (`top` true) */
  height: number;
  /** `height` is to the top of the roof (OSM's), not to the eave (the BD TOPO's) */
  top?: boolean;
  /** the roof's measured height over the eave [m] (the BD TOPO's ridge less its eave), null when unknown */
  roof: number | null;
  storeys: number | null;
  roofMat: RoofMaterial;
  wallMat: WallMaterial;
  /** the BD TOPO's `usage_1`, `nature`, `construction_legere` */
  usage?: string;
  nature?: string;
  light?: boolean;
  region: Region;
  /** a stable number in [0, 1) of the building's own (its variations) */
  seed: number;
}
export interface RoofPlan {
  shape: RoofShape;
  /** the walls' height (the eave) and the roof's top over the base [m] */
  wall: number;
  top: number;
  /** z = min of these over the footprint, over the base */
  planes: Plane[];
  /** the roof's pitch [°] (0 flat; a mansard's its brisis') */
  pitch: number;
  roofMat: RoofMaterial;
  /** the storeys under the eave (the walls' floors, for their windows) */
  storeys: number;
}

/**
 * The most a point of the footprint is from the sloped sides — the roof's height over its pitch's tangent at its apex:
 * the maximum over the polygon of the least of the sloped sides' distances, within all the sides (convex: a concave function
 * over it, two nested golden searches over the oriented box).
 */
export function apexDistance(sides: Side[], sloped: Side[], box: Obb): number {
  if (!sloped.length) return 0;
  const vx = -box.uy,
    vy = box.ux;
  const f = (u: number, v: number) => {
    const x = box.cx + u * box.ux + v * vx,
      y = box.cy + u * box.uy + v * vy;
    let m = Infinity,
      inside = Infinity;
    for (const s of sides) {
      const d = s.q - x * s.nx - y * s.ny;
      inside = Math.min(inside, d);
      if (sloped.includes(s)) m = Math.min(m, d);
    }
    // (outside the footprint: the more outside, the less — still concave)
    return inside < 0 ? inside * 1e3 : m;
  };
  const g = 0.381966;
  const golden = (lo: number, hi: number, fn: (x: number) => number) => {
    let a = lo,
      b = hi,
      c = a + g * (b - a),
      d = b - g * (b - a),
      fc = fn(c),
      fd = fn(d);
    for (let i = 0; i < 40; i++) {
      if (fc < fd) {
        a = c;
        c = d;
        fc = fd;
        d = b - g * (b - a);
        fd = fn(d);
      } else {
        b = d;
        d = c;
        fd = fc;
        c = a + g * (b - a);
        fc = fn(c);
      }
    }
    return Math.max(fc, fd);
  };
  return Math.max(
    0,
    golden(-box.hu, box.hu, (u) => golden(-box.hv, box.hv, (v) => f(u, v))),
  );
}

/** the plane through a side at the eave `wall`, rising inwards at `k` (rise over run), `lift` over it from `run` in */
function sidePlane(s: Side, wall: number, k: number, lift = 0, run = 0): Plane {
  return [-k * s.nx, -k * s.ny, wall + lift + k * (s.q - run)];
}
/** the planes a roof keeps at most (its cap among them): the kernel's loop over them, the leaf's room */
export const MAX_PLANES = 12;
/** the longest of `sides`, as many as `n` */
const longest = (sides: Side[], n: number) => (sides.length <= n ? sides : [...sides].sort((p, q) => q.length - p.length).slice(0, n));

const DEG = Math.PI / 180;

export function planRoof(b: RoofInput): RoofPlan {
  const outer = openRing(b.rings[0]!);
  const area = Math.abs(ringArea(outer));
  const sides = sidesOf(outer, b.party);
  const box = orientedBox(outer);
  const hullArea = Math.abs(ringArea(convexHull(outer)));
  const convex = hullArea > 0 ? area / hullArea : 0;
  // (unknown: a light construction's sheet metal, else what the region builds — Paris's zinc, Brittany's slate)
  const mat = b.roofMat === RoofMaterial.Unknown ? (b.light ? RoofMaterial.Metal : REGION[b.region].roof) : b.roofMat;
  const usage = b.usage ?? "",
    nature = b.nature ?? "";
  const industrial = usage === "Industriel" || nature.startsWith("Industriel") || usage === "Agricole";
  const storeysOf = (wall: number) => Math.max(1, Math.round(b.storeys ?? wall / 3));
  const flat = (wall: number, roofMat = mat): RoofPlan => ({
    shape: "flat",
    wall,
    top: wall,
    planes: [[0, 0, wall]],
    pitch: 0,
    roofMat,
    storeys: storeysOf(wall),
  });
  const H0 = b.top ? null : b.roof;
  const minWall = 2.2;
  // ---- flat: measured so, a terrace, a complex outline (B4 cuts it into parts), a wide hall, a tower block
  if (b.top && b.height < 4) return flat(b.height);
  if (H0 !== null && H0 <= 0.8) return flat(b.height);
  if (mat === RoofMaterial.Concrete && (H0 === null || H0 <= 1.5)) return flat(b.height, RoofMaterial.Concrete);
  if (convex < 0.88 || b.rings.length > 1 || sides.length > 12) {
    // (its measured roof's volume kept as a flat top halfway up it: the complex outlines' parts are B4's)
    return flat(b.height + (H0 !== null ? 0.5 * H0 : 0));
  }
  if (H0 === null && (area > 900 || (industrial && area > 400)))
    return flat(b.height, mat === RoofMaterial.Unknown ? RoofMaterial.Concrete : mat);
  if (H0 === null && b.top && b.height > 18) return flat(b.height);
  const exterior = sides.filter((s) => !s.party);
  if (!exterior.length) return flat(b.height + (H0 !== null ? 0.5 * H0 : 0));

  // ---- the sloped sides
  const vx = -box.uy,
    vy = box.ux;
  // (a side along the box's u axis — its normal along v — or along v)
  const alongU = (s: Side) => Math.abs(s.nx * vx + s.ny * vy) > Math.cos(35 * DEG);
  const alongV = (s: Side) => Math.abs(s.nx * box.ux + s.ny * box.uy) > Math.cos(35 * DEG);
  const lenU = exterior.filter(alongU).reduce((t, s) => t + s.length, 0),
    lenV = exterior.filter(alongV).reduce((t, s) => t + s.length, 0);
  const square = box.hu < 1.15 * box.hv;
  const allFree = sides.every((s) => !s.party);
  // (the Paris mansard: zinc or slate over five storeys and more, its roof's storeys in the registry's count)
  const wallStoreys = Math.max(1, Math.round((b.height - 1) / 3.1));
  const roofStoreys = b.storeys ? Math.max(0, Math.min(2, b.storeys - wallStoreys)) : 0;
  const mansard =
    !b.top && (mat === RoofMaterial.Zinc || mat === RoofMaterial.Slate) && (b.storeys ?? 0) >= 5 && b.height >= 12 && box.hv > 3.5;
  let shape: RoofShape;
  let sloped: Side[];
  if (mansard) {
    shape = "mansard";
    sloped = exterior;
  } else if ((b.light || usage === "Annexe") && area < 40 && !allFree) {
    // (a lean-to: its one slope away from the wall it leans on — the free side facing the longest party side)
    shape = "shed";
    const wallSide = sides.filter((s) => s.party).sort((p, q) => q.length - p.length)[0]!;
    const facing = exterior
      .map((s) => ({ s, d: s.nx * wallSide.nx + s.ny * wallSide.ny }))
      .sort((p, q) => p.d - q.d || q.s.length - p.s.length)[0]!.s;
    sloped = [facing];
  } else if (allFree && (square || b.seed < REGION[b.region].hip)) {
    shape = "hipped";
    sloped = exterior;
  } else {
    shape = "gabled";
    // (the ridge along the axis whose free sides are longest: a terraced house's along its street, between its party walls)
    sloped = exterior.filter(lenU >= 0.95 * lenV ? alongU : alongV);
    if (!sloped.length) sloped = exterior;
  }
  sloped = longest(sloped, shape === "mansard" ? (MAX_PLANES - 1) >> 1 : MAX_PLANES - 1);
  const run = apexDistance(sides, sloped, box);
  if (run < 0.5) return flat(b.height + (H0 !== null ? 0.5 * H0 : 0));

  // ---- the heights: the measured roof's (its pitch then follows), else the material's pitch — within sane bounds
  let wall = b.height;
  let H: number;
  let k: number;
  if (shape === "mansard") {
    // (its storeys' height, a storey at least; the brisis at 72° up to 85 % of it, the terrasson at 15° after)
    H = H0 ?? Math.max(1, roofStoreys) * 3 + 0.4;
    const h1 = 0.85 * H,
      k1 = Math.tan(72 * DEG),
      k2 = Math.tan(15 * DEG);
    const planes: Plane[] = [];
    for (const s of sloped) planes.push(sidePlane(s, wall, k1), sidePlane(s, wall, k2, h1, h1 / k1));
    planes.push([0, 0, wall + H]);
    return { shape, wall, top: wall + H, planes, pitch: 72, roofMat: mat, storeys: storeysOf(wall) };
  }
  const pitch = pitchOf(mat, b.region);
  if (H0 !== null) {
    H = H0;
    k = H / run;
    // (a measured roof too flat or too steep for its width: the pitch held within 12–60°, its top capped at the measure)
    k = Math.min(Math.tan(60 * DEG), Math.max(Math.tan(12 * DEG), k));
  } else {
    k = Math.tan(pitch * DEG);
    H = Math.min(k * run, 12, 0.9 * (b.top ? b.height : wall) + 2);
    if (b.top) {
      // (OSM's height is to the top: the roof inside it, the walls what is left — two metres at least)
      wall = Math.max(minWall, b.height - H);
      H = b.height - wall;
      if (H < 1) return flat(b.height);
    }
  }
  const planes: Plane[] = sloped.map((s) => sidePlane(s, wall, k));
  // (the cap: the ridge's height — the planes meet below it for a measured roof as steep as it reads; above it a flat top)
  planes.push([0, 0, wall + Math.min(H, k * run)]);
  return {
    shape,
    wall,
    top: wall + Math.min(H, k * run),
    planes,
    pitch: Math.atan(k) / DEG,
    roofMat: mat,
    storeys: storeysOf(wall),
  };
}

/** the roof's height over the base at (x, y): the least of its planes */
export function roofAt(planes: Plane[], x: number, y: number): number {
  let z = Infinity;
  for (const [a, b, c] of planes) z = Math.min(z, a * x + b * y + c);
  return z;
}
