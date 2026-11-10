// The sea's surface as a mesh (PLAN-MER-WEBGPU S2, after web-ocean's CDLOD): the nodes of a quadtree over the sea's anchored
// plane, chosen each frame about the camera — a node split where the camera is within its range (RANGE × its size, measured in
// three dimensions: from the camera's height, the near nodes are coarse already), kept whole beyond, culled out of the view's
// cone. Each node a grid of GRID × GRID quads, its vertices morphing onto the next coarser level's over the outer fifth of its
// range (system/sea-surface WGSL), so that no seam opens between levels.
//
// The lattice is fixed on the sea, not on the camera: a node's origin is a whole multiple of its size on the sea's axes from a
// far anchor (FAR = 2¹⁸ m, beyond any node), its place relative to the camera reckoned here in float64 — the vertices never slide
// under a moving craft, and float32 sees only metres-from-the-camera. Pure.

/** quads a node's side */
export const SEA_GRID = 16;
/** the finest node's side [m]: 12.5 cm between vertices next to the camera */
export const SEA_LEAF = 2;
/** a level's range in its nodes' sides: a node split while the camera is within RANGE × its size */
export const SEA_RANGE = 8;
/** the levels (the coarsest's nodes 2¹⁴ × LEAF = 32.8 km, their range 262 km) */
export const SEA_LEVELS = 15;
/** the most nodes drawn */
export const SEA_MAX_NODES = 2048;
/** the lattice's anchor [m]: its nodes' origins whole multiples of their size from it */
const FAR = 2 ** 18;

export interface SeaView {
  /** the camera's place on the sea's plane [m, float64] — along its axes, from any fixed origin (the renderer's anchor) */
  x: number;
  y: number;
  /** its height over the sea [m] */
  h: number;
  /** the view's cone in the sea's frame: its axis (x, y along the plane, z up) and the cosine of its half-angle (diagonal) */
  fwd: [number, number, number];
  cosHalf: number;
  /** the farthest sea drawn [m] (its horizon, capped) */
  maxDist: number;
  /** the Earth's radius there [m]: the far nodes' drop under the camera's plane */
  radius: number;
  /** the waves' bound [m]: the most a crest rises or a trough sinks, and drifts sideways */
  amp: number;
}

export interface SeaNodes {
  /** per node (x0, y0 relative to the camera [m], size [m], level) */
  data: Float32Array<ArrayBuffer>;
  count: number;
}

/** The nodes for a view, into `out` (SEA_MAX_NODES × 4 floats). */
export function seaNodes(v: SeaView, out = new Float32Array(SEA_MAX_NODES * 4)): SeaNodes {
  let count = 0;
  const ranges: number[] = [];
  for (let l = 0; l < SEA_LEVELS; l++) ranges.push(SEA_RANGE * SEA_LEAF * 2 ** l);
  // (a node's nearest point to the camera, in three dimensions: its height under the camera — the plane's, dropped by the
  // Earth's curvature at that distance — with the waves' bound)
  const dist2 = (x0: number, y0: number, s: number) => {
    const dx = Math.max(x0 - v.x, 0, v.x - (x0 + s));
    const dy = Math.max(y0 - v.y, 0, v.y - (y0 + s));
    const d2 = dx * dx + dy * dy;
    const drop = d2 / (2 * v.radius);
    const dz = Math.max(v.h + drop - v.amp, 0);
    return d2 + dz * dz;
  };
  // (in the view's cone: its bounding sphere's centre within the cone widened by its radius)
  const inView = (x0: number, y0: number, s: number) => {
    const cx = x0 + s / 2 - v.x,
      cy = y0 + s / 2 - v.y;
    const d2 = cx * cx + cy * cy;
    const cz = -v.h - d2 / (2 * v.radius);
    const r = s * 0.7072 + v.amp + (s * s) / (8 * v.radius);
    const len = Math.sqrt(d2 + cz * cz);
    if (len <= r) return true;
    const cosA = (cx * v.fwd[0] + cy * v.fwd[1] + cz * v.fwd[2]) / len;
    const sinR = Math.min(r / len, 1);
    // (cos(angle − asin(r/len)) ≥ cosHalf: the sphere touches the cone)
    const cosR = Math.sqrt(1 - sinR * sinR);
    const sinA = Math.sqrt(Math.max(1 - cosA * cosA, 0));
    return cosA * cosR + sinA * sinR >= v.cosHalf;
  };
  const maxD2 = v.maxDist * v.maxDist;
  const add = (x0: number, y0: number, s: number, l: number) => {
    if (count >= SEA_MAX_NODES) return;
    out.set([x0 - v.x, y0 - v.y, s, l], 4 * count);
    count++;
  };
  // (a node: false when out of its level's range — its parent draws the area —; otherwise its area is drawn, by it or its
  // children)
  const select = (x0: number, y0: number, s: number, l: number): boolean => {
    const d2 = dist2(x0, y0, s);
    if (d2 > ranges[l]! * ranges[l]!) return false;
    if (d2 > maxD2 || !inView(x0, y0, s)) return true;
    if (l === 0 || dist2(x0, y0, s) > ranges[l - 1]! * ranges[l - 1]!) {
      add(x0, y0, s, l);
      return true;
    }
    const h = s / 2;
    for (let i = 0; i < 4; i++) {
      const nx = x0 + (i & 1) * h,
        ny = y0 + (i >> 1) * h;
      if (!select(nx, ny, h, l - 1)) {
        if (dist2(nx, ny, h) <= maxD2 && inView(nx, ny, h)) add(nx, ny, h, l - 1);
      }
    }
    return true;
  };
  // (the coarsest level's nodes about the camera, on the lattice, out to the farthest sea drawn)
  const top = SEA_LEVELS - 1;
  const S = SEA_LEAF * 2 ** top;
  const bx = Math.floor((v.x + FAR) / S) * S - FAR,
    by = Math.floor((v.y + FAR) / S) * S - FAR;
  const n = Math.ceil(Math.min(v.maxDist, ranges[top]!) / S) + 1;
  for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) select(bx + i * S, by + j * S, S, top);
  return { data: out, count };
}
