// Q8 D1 — the road traffic (docs/progress/refraction-horizons/Q8.md, "D1"; its shapes since PLAN-J8 VB3: car-shapes.ts): cars on OpenStreetMap's main roads (OpenMapTiles'
// transportation lines: motorway, trunk, primary, secondary) round the scenery's centre, each a painted body with two headlights
// and two tail lights, driving on the right of its way at its road's usual speed. Their triangles go after the pylons' and
// conductors' in the scenery's meshes (packScenery: CAR_BODY / CAR_HEAD / CAR_TAIL | its index), built in the car's own frame
// (x ahead, y to its left, z up): scenery-raster.ts meshVertex moves each along its piece of road by the game's clock — its
// table entry: the piece's start (w its speed), end (w its phase) —, meshVs turns its lights to the camera and widens them to a
// pixel and a half, shadeLite paints the body and lights the lamps at night (white ahead, red behind).
// First step: each car runs along its own piece of road (≤ PIECE_M) and starts it again at its end; the traffic's density a
// plausible one by the road's class, not counted.

/** the cars kept round the centre [m] and at most (the nearest pieces first), a piece of road's longest [m] */
export const TRAFFIC_REACH_M = 3000;
export const TRAFFIC_MAX = 1500;
export const PIECE_M = 250;
/** by road class: a car every `spacing` metres each way, at `speed` [m/s] (a motorway's 130 km/h, a main road's 80) */
export const ROAD_TRAFFIC: Record<string, { spacing: number; speed: number }> = {
  motorway: { spacing: 70, speed: 36 },
  trunk: { spacing: 110, speed: 28 },
  primary: { spacing: 180, speed: 22 },
  secondary: { spacing: 320, speed: 20 },
};
/** the lane's offset to the right of the way's middle [m] (driving on the right) */
export const LANE_M = 1.8;

// (a car's shape: car-shapes.ts — PLAN-J8 VB3, five silhouettes; the box carMesh retired with it)

export interface CarPlace {
  /** its piece of road's start and end in the scenery's frame [m] — it drives from start to end —, its speed [m/s], phase [0, 1) */
  start: [number, number, number];
  end: [number, number, number];
  speed: number;
  phase: number;
}

/** the cars on a piece of road (start → end), one way: a car every `spacing` metres or so, their phases from a seed */
export function carsOn(start: [number, number, number], end: [number, number, number], cls: string, seed: number): CarPlace[] {
  const t = ROAD_TRAFFIC[cls];
  if (!t) return [];
  const L = Math.hypot(end[0] - start[0], end[1] - start[1]);
  let n = Math.floor(L / t.spacing);
  // (a piece shorter than the spacing: a car on it now and then — by its seed)
  const h = (k: number) => {
    const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  if (n === 0 && h(0) < L / t.spacing) n = 1;
  return Array.from({ length: n }, (_, i) => ({
    start,
    end,
    speed: t.speed * (0.85 + 0.3 * h(i + 1)),
    phase: (i + h(i + 7)) / Math.max(n, 1),
  }));
}

/** a road's line simplified to chords within this [m] before it is cut (a curve's short segments: one piece, not twenty) */
export const CHORD_M = 2;

/** a piece of a road and its cars (carsAlong) */
export interface StreamPiece {
  a: [number, number, number];
  b: [number, number, number];
  cars: CarPlace[];
}

/** a polyline's points kept within `tol` [m] of it (Douglas-Peucker on x, y; z carried) */
function chords(points: readonly [number, number, number][], tol: number): [number, number, number][] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = points[i]!,
      b = points[j]!;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      L = Math.hypot(dx, dy) || 1;
    let far = -1,
      best = tol;
    for (let k = i + 1; k < j; k++) {
      const p = points[k]!;
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
      if (d > best) {
        best = d;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * VB6 — a road's cars as one stream, within the GPU's contract (each car on its own straight piece, start → end, looped by the clock:
 * scenery-raster.ts meshVertexAt): the line (one way, its points in the scenery's frame) simplified to chords (CHORD_M), each cut into
 * equal pieces of PIECE_M at most; one speed for the whole road and way (no car through another); on each piece round(L / spacing) cars
 * evenly spaced (a piece shorter than the spacing: one car or none, by its seed), their phases from the abscissa along the road — on pieces of a chord, of one length, a car leaving a piece is the one
 * entering the next. The phases' seam at a chord's corner (pieces of other lengths) remains: the plan's (B), chains, if it shows.
 */
export function carsAlong(line: readonly [number, number, number][], cls: string, seed: number): StreamPiece[] {
  // (ROAD_TRAFFIC's classes alone — the render session, 17 Nov 2026: the tertiary and minor streets hold VB4's parked cars, their lane
  // and LANE_M's would cross where the scene's lines carry no width; their traffic, if any, from KSC3's segments with the plan's (B))
  const t = ROAD_TRAFFIC[cls];
  if (!t || line.length < 2) return [];
  const h = (k: number) => {
    const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const speed = t.speed * (0.9 + 0.2 * h(1));
  const offset = h(2) * t.spacing;
  const pts = chords(line, CHORD_M);
  const out: StreamPiece[] = [];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i]!,
      B = pts[i + 1]!;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 1e-3) continue;
    const m = Math.max(1, Math.ceil(L / PIECE_M));
    const len = L / m;
    for (let q = 0; q < m; q++) {
      // (as many cars as the spacing gives: rounded where a piece holds one or more — the stream —, else one now and then by the
      // piece's seed — a sparse street's density kept on average, its pieces each with its car or none)
      const r = len / t.spacing;
      const n = r >= 1 ? Math.round(r) : h(10 + out.length) < r ? 1 : 0;
      const f0 = q / m,
        f1 = (q + 1) / m;
      const a: [number, number, number] = [A[0] + (B[0] - A[0]) * f0, A[1] + (B[1] - A[1]) * f0, A[2] + (B[2] - A[2]) * f0];
      const b: [number, number, number] = [A[0] + (B[0] - A[0]) * f1, A[1] + (B[1] - A[1]) * f1, A[2] + (B[2] - A[2]) * f1];
      const cars: CarPlace[] = [];
      if (n > 0) {
        const gap = len / n;
        // (the stream's first car on this piece at the clock's 0: the road's cars at `offset + k gap` along it)
        const x0 = ((((offset - s) % gap) + gap) % gap) / len;
        for (let j = 0; j < n; j++) cars.push({ start: a, end: b, speed, phase: (x0 + j / n) % 1 });
      }
      out.push({ a, b, cars });
      s += len;
    }
  }
  return out;
}
