// The relief's ceiling round the camera (trace.wgsl earthMarch, earthTerrainShadow, keyRelief: the shell the ground's
// marches work in — 9 600 m over the ellipsoid before): the highest the ground a ray from the camera may meet can be.
// The heights drawn are weighted means of the global map's texels and the terrain tiles' (a B-spline, bilinear, the
// levels blended: none above the highest it weighs), with the tracer's detail over them (earthDetail: its mountains'
// ridges up to 1 500 m over a ground over 2 500 m, its hills ±50 m, its rocks ±11 m). So: the global map's highest
// within the horizons' reach (1° cells' maxima, each worked out once), the tiles' highest (every one held), and the
// most the detail adds over that — a ray above it, rising, has nothing more to meet; one coming down from above it
// meets nothing before it.

const DEG = Math.PI / 180;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** the most the tracer's detail (trace.wgsl earthDetail) adds over a ground of height h [m] — its ridges ~1 (a quarter
 *  more kept), its hills and rocks half again (trace.wgsl detailMargin, the same) */
export function detailMargin(h: number): number {
  return 1900 * smoothstep(300, 2500, h) + 95;
}

/** The highest height of the global map in 1° cells (whole metres per texel, W × H equirectangular, half floats). */
export class MapCells {
  private cells = new Map<number, number>();
  constructor(
    private map: Int16Array,
    private W: number,
    private H: number,
  ) {}

  /** the highest texel of the 1° cell (lat index 0…179 from the north, lon index 0…359 from −180°), its neighbours'
   *  edge texels with it (the B-spline reaches a texel over) */
  cell(i: number, j: number): number {
    const key = i * 360 + j;
    const c = this.cells.get(key);
    if (c !== undefined) return c;
    const { map, W, H } = this;
    const y0 = Math.max(Math.floor((i / 180) * H) - 2, 0);
    const y1 = Math.min(Math.ceil(((i + 1) / 180) * H) + 2, H - 1);
    const x0 = Math.floor((j / 360) * W) - 2;
    const x1 = Math.ceil(((j + 1) / 360) * W) + 2;
    let m = -Infinity;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = map[y * W + (((x % W) + W) % W)]!;
        if (v > m) m = v;
      }
    this.cells.set(key, m);
    return m;
  }

  /** the highest height within reach [m] of (lat, lon) [rad] */
  around(lat: number, lon: number, reach: number): number {
    const R = 6_371_000;
    const dLat = reach / R / DEG + 1;
    const i0 = Math.max(Math.floor((90 - (lat / DEG + dLat)) * 1), 0);
    const i1 = Math.min(Math.floor(90 - (lat / DEG - dLat)), 179);
    let m = -Infinity;
    for (let i = i0; i <= i1; i++) {
      // (the cell's nearest latitude to the pole: the widest span of longitudes there)
      const latC = 90 - i - 0.5;
      const cosL = Math.max(Math.cos(Math.min(Math.abs(latC) + 0.5, 89.9) * DEG), 1e-3);
      const dLon = Math.min(reach / (R * cosL) / DEG + 1, 180);
      const j0 = Math.floor(lon / DEG + 180 - dLon);
      const j1 = Math.floor(lon / DEG + 180 + dLon);
      for (let j = j0; j <= Math.min(j1, j0 + 359); j++) m = Math.max(m, this.cell(i, ((j % 360) + 360) % 360));
    }
    return m;
  }
}

/** How far [m] a ray from a camera alt [m] over the ground may meet ground as high as top [m]: both horizons. */
export function horizonsReach(alt: number, top: number): number {
  const R = 6_371_000;
  const a = Math.max(alt, 0);
  return Math.sqrt(2 * R * a + a * a) + Math.sqrt(2 * R * Math.max(top, 0)) + 20_000;
}
