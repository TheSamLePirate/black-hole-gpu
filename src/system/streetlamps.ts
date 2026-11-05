// Q8 L10 — the streets' lamps (docs/progress/refraction-horizons/Q8.md, "L10"): plausible lamps along the town's streets — not
// their real places: OpenStreetMap's street_lamp nodes are too sparse to stand for them —, set along the map's streets
// (OpenMapTiles' primary, secondary, tertiary and minor roads, off bridges and tunnels) where buildings stand about them, at a
// spacing and height by the road's class, on alternate sides of the wider roads. Each is a pole (a ribbon widened to a pixel,
// its coverage dithered as the conductors') and a head (a quad opened to a pixel and a half: shadeLite lights it at night in a
// lit town); their light on the ground is not a light each but one map baked here: the pools under the heads (lampLight, a
// grid of 4 m round the scene's centre), which shadeLite reads at night in place of the streets' even wash.

/** the lamps kept round the centre [m] and their count at most */
export const LAMP_REACH_M = 1500;
export const LAMP_MAX = 4000;
/** the light's grid round the centre: its half side and texel [m] (512² bytes) */
export const LAMP_GRID = { half: 1024, texel: 4 } as const;
/** the pool's encoding: a texel's byte / 255 × this (the sum of the lamps' light reaching it, 1 under a lamp alone) */
export const LAMP_LIGHT_RANGE = 2;
/** a pole's width [m] */
export const LAMP_POLE_M = 0.14;
/** the buildings a lamp wants about it (within a 3 × 3 block of BUILT_CELL_M cells) */
export const BUILT_CELL_M = 50;
export const BUILT_MIN = 4;

/** the classes that get lamps, their spacing, pole height [m] and whether their lamps alternate sides */
export const LAMP_CLASSES: Record<string, { spacing: number; height: number; staggered: boolean }> = {
  primary: { spacing: 36, height: 10, staggered: true },
  secondary: { spacing: 34, height: 9, staggered: true },
  tertiary: { spacing: 32, height: 8, staggered: false },
  minor: { spacing: 28, height: 6.5, staggered: false },
};

export interface StreetLamp {
  /** its pole's foot (the frame's local metres, the foot's z the ground's) and its head (over the road's edge) */
  foot: [number, number, number];
  head: [number, number, number];
  /** where on its street: the segment's index and the share along it (the caller's ground height there) */
  seg: number;
  frac: number;
  /** the street's direction there (unit, x y): its pool stretched along it */
  dir: [number, number];
}

/** a deterministic share in [0, 1) from two numbers (a line's first point): the lamps' phase along it */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The lamps along one street (its points in the frame's metres, x y), every `spacing` metres from a phase its first point
 * draws; on the right of its direction, or alternately right and left (staggered); the pole `width / 2 + 0.6` m off the
 * axis, its head leaning 1.2 m back over the road. z left 0: the ground's height set by the caller.
 */
export function lampsAlong(points: [number, number][], cls: string, width: number): StreetLamp[] {
  const c = LAMP_CLASSES[cls];
  if (!c || points.length < 2) return [];
  const out: StreetLamp[] = [];
  const off = width / 2 + 0.6;
  let next = c.spacing * hash2(points[0]![0], points[0]![1]);
  let walked = 0,
    k = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i]!,
      [bx, by] = points[i + 1]!;
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const dx = (bx - ax) / L,
      dy = (by - ay) / L;
    while (next <= walked + L) {
      const s = next - walked;
      const side = c.staggered && k % 2 === 1 ? 1 : -1;
      // (right of the direction: (dy, −dx); left its opposite)
      const nx = -side * dy,
        ny = side * dx;
      const px = ax + dx * s,
        py = ay + dy * s;
      out.push({
        foot: [px + nx * off, py + ny * off, 0],
        head: [px + nx * (off - 1.2), py + ny * (off - 1.2), c.height],
        seg: i,
        frac: s / L,
        dir: [dx, dy],
      });
      next += c.spacing;
      k++;
    }
    walked += L;
  }
  return out;
}

/** A lamp's eight vertices (scenery-data.ts packScenery: from a vertex index ≡ 0 mod 4): its pole a pair at its foot and a pair
 *  at its top (meshVs widens each pair across the view, the even one to the left), its head four at its centre (opened to a
 *  quad by the index mod 4); two triangles each — the pole's first. */
export function lampMesh(l: StreetLamp): { positions: number[]; triangles: number[] } {
  const [fx, fy, fz] = l.foot;
  const top = fz + l.head[2] + 0.2;
  const [hx, hy] = l.head;
  const hz = fz + l.head[2];
  return {
    positions: [fx, fy, fz, fx, fy, fz, fx, fy, top, fx, fy, top, hx, hy, hz, hx, hy, hz, hx, hy, hz, hx, hy, hz],
    triangles: [0, 1, 3, 0, 3, 2, 4, 5, 6, 4, 6, 7],
  };
}

/** a street luminaire's pool: its reach along the street and across it, in its pole's heights — its light thrown along the
 *  carriageway, little into the gardens (a first wide round pool, 1.3 heights every way, lit a whole town's ground cream) */
export const POOL_ALONG = 1.5;
export const POOL_ACROSS = 0.8;

/** The lamps' light on the ground (LAMP_GRID's bytes, rows north from the south edge): each head's pool — a point's
 *  illuminance under a lamp, cos³, its distance scaled by POOL_ALONG heights along the street and POOL_ACROSS across it —
 *  summed, to LAMP_LIGHT_RANGE. */
export function lampLight(lamps: StreetLamp[]): Uint8Array {
  const { half, texel } = LAMP_GRID;
  const N = Math.round((2 * half) / texel);
  const acc = new Float32Array(N * N);
  for (const l of lamps) {
    const [x, y] = l.head;
    const [ux, uy] = l.dir;
    const a = POOL_ALONG * l.head[2],
      b = POOL_ACROSS * l.head[2];
    const R = 3.5 * a;
    const i0 = Math.max(0, Math.floor((x - R + half) / texel)),
      i1 = Math.min(N - 1, Math.ceil((x + R + half) / texel));
    const j0 = Math.max(0, Math.floor((y - R + half) / texel)),
      j1 = Math.min(N - 1, Math.ceil((y + R + half) / texel));
    for (let j = j0; j <= j1; j++) {
      const py = -half + (j + 0.5) * texel - y;
      for (let i = i0; i <= i1; i++) {
        const px = -half + (i + 0.5) * texel - x;
        const s = px * ux + py * uy,
          t = -px * uy + py * ux;
        const r2 = (s / a) ** 2 + (t / b) ** 2;
        if (r2 < 12) acc[j * N + i]! += (1 + r2) ** -1.5;
      }
    }
  }
  const out = new Uint8Array(N * N);
  for (let n = 0; n < N * N; n++) out[n] = Math.round(Math.min(acc[n]! / LAMP_LIGHT_RANGE, 1) * 255);
  return out;
}

/** The built-up test: the buildings' centres counted in BUILT_CELL_M cells; a point is in town where its cell and the eight
 *  about it hold BUILT_MIN or more. */
export function builtUp(centres: Iterable<[number, number]>): (x: number, y: number) => boolean {
  const cells = new Map<string, number>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const [x, y] of centres) {
    const k = key(Math.floor(x / BUILT_CELL_M), Math.floor(y / BUILT_CELL_M));
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  return (x, y) => {
    const i = Math.floor(x / BUILT_CELL_M),
      j = Math.floor(y / BUILT_CELL_M);
    let n = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += cells.get(key(i + a, j + b)) ?? 0;
    return n >= BUILT_MIN;
  };
}
