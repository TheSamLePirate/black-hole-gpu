// Q8 D1 — the road traffic (docs/progress/refraction-horizons/Q8.md, "D1"): cars on OpenStreetMap's main roads (OpenMapTiles'
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

/**
 * A car's triangles in its own frame (x ahead, y to its left, z up from the road) — a body box 4.4 × 1.8 × 1.2 m on its
 * wheels' 30 cm, its lane LANE_M to the right — and its four lamps, each a quad of four vertices at its centre (meshVs opens it
 * towards the camera): 8 + 16 vertices (a multiple of four: each quad from a vertex index ≡ 0 mod 4), 12 body triangles, then
 * the two headlights' 4, then the two tail lights' 4.
 */
export function carMesh() {
  const positions: number[] = [],
    triangles: number[] = [];
  const y0 = -LANE_M;
  const v = (x: number, y: number, z: number) => {
    positions.push(x, y0 + y, z);
    return positions.length / 3 - 1;
  };
  const k = Array.from({ length: 8 }, (_, i) => v(i & 1 ? 2.2 : -2.2, i & 2 ? 0.9 : -0.9, i & 4 ? 1.5 : 0.3));
  const quad = (a: number, b: number, c: number, d: number) => triangles.push(a, b, c, a, c, d);
  quad(k[0]!, k[1]!, k[3]!, k[2]!);
  quad(k[4]!, k[6]!, k[7]!, k[5]!);
  quad(k[0]!, k[4]!, k[5]!, k[1]!);
  quad(k[2]!, k[3]!, k[7]!, k[6]!);
  quad(k[0]!, k[2]!, k[6]!, k[4]!);
  quad(k[1]!, k[5]!, k[7]!, k[3]!);
  const lamp = (x: number, y: number) => {
    const a = v(x, y, 0.75);
    v(x, y, 0.75);
    v(x, y, 0.75);
    v(x, y, 0.75);
    quad(a, a + 1, a + 2, a + 3);
  };
  lamp(2.25, 0.6);
  lamp(2.25, -0.6);
  lamp(-2.25, 0.6);
  lamp(-2.25, -0.6);
  return { positions, triangles };
}

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
