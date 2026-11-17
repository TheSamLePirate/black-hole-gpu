// PLAN-J8 J8-VB VB3 (docs/PLAN-DETAILS-VOL-BAS-FABLEFLIGHT.md) — the near cars' silhouettes: five shapes shared by every car of the
// scene (a compact, a saloon, an SUV, a van, a bus or lorry), each a painted lower body, a cabin narrower than it — its roof painted,
// its windscreen, rear window and side windows glazed — and four lamps; a car's shape picked from its index (carKind: the same car
// the same shape whichever scene holds it). Built in the car's own frame (x ahead, y its left, z up from the road), its lane LANE_M
// to the right: scenery-raster.ts meshVertexAt drives each along its piece of road by the game's clock, meshVs opens its lamps
// towards the camera (a quad's four vertices at one place, from a vertex index ≡ 0 mod 4), shadeLite paints the body (one of eight
// paints by the car's index), darkens and mirrors the glass (its triangles' tag CAR_GLASS_BIT) and lights the lamps at night.
// (Before VB3 every car was one box 4.4 × 1.8 × 1.2 m — traffic.ts carMesh, retired with this lot.)
import { LANE_M } from "./traffic";

/** the shapes, in carKind's order */
export enum CarKind {
  Compact = 0,
  Saloon = 1,
  Suv = 2,
  Van = 3,
  Bus = 4,
}

/** a shape's dimensions [m]: length, width; the body's belt line, the roof; the cabin's base and top along x (rear, front) and
 *  its inset from the body's sides at the roof */
interface ShapeSpec {
  length: number;
  width: number;
  belt: number;
  roof: number;
  base: [number, number];
  top: [number, number];
  inset: number;
}
/** the wheels' height: the body's underside [m] */
export const CAR_SILL_M = 0.3;
const SPECS: Record<CarKind, ShapeSpec> = {
  [CarKind.Compact]: { length: 3.9, width: 1.72, belt: 0.95, roof: 1.48, base: [-1.75, 0.95], top: [-1.45, 0.3], inset: 0.14 },
  [CarKind.Saloon]: { length: 4.7, width: 1.82, belt: 0.92, roof: 1.44, base: [-1.65, 1.15], top: [-1.05, 0.35], inset: 0.16 },
  [CarKind.Suv]: { length: 4.6, width: 1.92, belt: 1.12, roof: 1.75, base: [-2.15, 1.05], top: [-2.05, 0.45], inset: 0.12 },
  [CarKind.Van]: { length: 5.3, width: 2.0, belt: 1.15, roof: 2.45, base: [-2.6, 1.85], top: [-2.6, 1.4], inset: 0.06 },
  [CarKind.Bus]: { length: 11.0, width: 2.5, belt: 1.05, roof: 3.1, base: [-5.45, 5.45], top: [-5.45, 5.3], inset: 0.04 },
};
/** a shape's share of the cars [%] (a town's traffic: mostly compacts and saloons, a bus or lorry now and then) */
const SHARES: [CarKind, number][] = [
  [CarKind.Compact, 34],
  [CarKind.Saloon, 30],
  [CarKind.Suv, 20],
  [CarKind.Van, 11],
  [CarKind.Bus, 5],
];

/** a car's shape from its index (a hash: neighbours differ, the same index the same shape) */
export function carKind(index: number): CarKind {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  let p = (h ^ (h >>> 16)) % 100;
  for (const [k, s] of SHARES) {
    if (p < s) return k;
    p -= s;
  }
  return CarKind.Compact;
}

/** a shape's triangles: the body's (painted), the glass's, the two headlights' quads, the two tail lights' quads — in that order */
export interface CarShape {
  positions: number[];
  triangles: number[];
  body: number;
  glass: number;
  head: number;
  tail: number;
}

const built = new Map<CarKind, CarShape>();
/** a shape's mesh (built once): its vertices a multiple of four, its lamps' quads each from a vertex index ≡ 0 mod 4 */
export function carShape(kind: CarKind): CarShape {
  const hit = built.get(kind);
  if (hit) return hit;
  const s = SPECS[kind];
  const positions: number[] = [];
  const body: number[] = [],
    glass: number[] = [],
    lamps: number[] = [];
  const y0 = -LANE_M;
  const v = (x: number, y: number, z: number) => {
    positions.push(x, y0 + y, z);
    return positions.length / 3 - 1;
  };
  const at = (i: number) => [positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!];
  // (a face's two triangles wound as traffic.ts's box was — their cross product towards the part's middle: the scene's meshes'
  // convention)
  const face = (into: number[], c: number[], a: number, b: number, cc: number, d: number) => {
    const [A, B, C] = [at(a), at(b), at(cc)];
    const u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!],
      w = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const m = [(A[0]! + C[0]!) / 2 - c[0]!, (A[1]! + C[1]!) / 2 - c[1]!, (A[2]! + C[2]!) / 2 - c[2]!];
    const inward = n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! < 0;
    if (inward) into.push(a, b, cc, a, cc, d);
    else into.push(a, d, cc, a, cc, b);
  };
  // the lower body: a box from the sill to the belt line (its eight corners: bit 1 front, bit 2 left, bit 4 up)
  const L = s.length / 2,
    W = s.width / 2;
  const k = Array.from({ length: 8 }, (_, i) => v(i & 1 ? L : -L, i & 2 ? W : -W, i & 4 ? s.belt : CAR_SILL_M));
  const bc = [0, y0, (CAR_SILL_M + s.belt) / 2];
  face(body, bc, k[0]!, k[1]!, k[3]!, k[2]!);
  face(body, bc, k[4]!, k[6]!, k[7]!, k[5]!);
  face(body, bc, k[0]!, k[4]!, k[5]!, k[1]!);
  face(body, bc, k[2]!, k[3]!, k[7]!, k[6]!);
  face(body, bc, k[0]!, k[2]!, k[6]!, k[4]!);
  face(body, bc, k[1]!, k[5]!, k[7]!, k[3]!);
  // the cabin: its base on the belt line (a hair inside the body's sides), its top the roof, narrower by the inset — the roof painted,
  // its four sloping or upright faces glazed (bit 1 front, bit 2 left, bit 4 the top)
  const bw = W - 0.03,
    tw = W - s.inset;
  const q = Array.from({ length: 8 }, (_, i) =>
    v((i & 4 ? s.top : s.base)[i & 1]!, (i & 2 ? 1 : -1) * (i & 4 ? tw : bw), i & 4 ? s.roof : s.belt),
  );
  const cc = [(s.base[0] + s.base[1]) / 2, y0, (s.belt + s.roof) / 2];
  face(body, cc, q[4]!, q[6]!, q[7]!, q[5]!);
  face(glass, cc, q[1]!, q[5]!, q[7]!, q[3]!);
  face(glass, cc, q[0]!, q[2]!, q[6]!, q[4]!);
  face(glass, cc, q[0]!, q[4]!, q[5]!, q[1]!);
  face(glass, cc, q[2]!, q[3]!, q[7]!, q[6]!);
  // the lamps: four vertices at one place each, from an index ≡ 0 mod 4 (16 vertices before them), at two thirds of the body's height
  const lz = CAR_SILL_M + (s.belt - CAR_SILL_M) * 0.62,
    ly = W - Math.min(0.32, W * 0.3);
  const lamp = (x: number, y: number) => {
    const a = v(x, y, lz);
    v(x, y, lz);
    v(x, y, lz);
    v(x, y, lz);
    lamps.push(a, a + 1, a + 2, a, a + 2, a + 3);
  };
  lamp(L + 0.05, ly);
  lamp(L + 0.05, -ly);
  lamp(-L - 0.05, ly);
  lamp(-L - 0.05, -ly);
  const shape: CarShape = {
    positions,
    triangles: [...body, ...glass, ...lamps],
    body: body.length / 3,
    glass: glass.length / 3,
    head: 4,
    tail: 4,
  };
  built.set(kind, shape);
  return shape;
}
