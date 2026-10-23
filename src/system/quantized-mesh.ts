// Cesium's quantized-mesh 1.0 (https://github.com/CesiumGS/quantized-mesh): a terrain tile as a triangulated irregular
// network — its vertices' east, north and height quantized to 0 … 32767 over the tile's box and its heights' range, zig-zag
// delta coded; its triangles' indices high-water-mark coded —, here decoded and drawn into a grid: each cell's height the
// triangle's under the cell's centre, by its barycentric weights. swisstopo's terrain service serves swissALTI3D so (I7:
// national.ts), its tiles in the global-geodetic TMS profile: level g has 2^(g+1) × 2^g tiles of 180 / 2^g degrees, row 0
// at the south pole.

/** a decoded tile: its vertices' longitude, latitude [°] and height [m above the sea], its triangles' indices */
export interface QuantizedMesh {
  lon: Float64Array;
  lat: Float64Array;
  h: Float32Array;
  tri: Uint32Array;
}

/** a geodetic tile's box [°]: west, south, east, north */
export function geodeticTileBox(g: number, x: number, y: number): [number, number, number, number] {
  const s = 180 / 2 ** g;
  return [-180 + x * s, -90 + y * s, -180 + (x + 1) * s, -90 + (y + 1) * s];
}
/** the geodetic tiles of level g a box [°] touches */
export function geodeticTilesOver(g: number, west: number, south: number, east: number, north: number): [number, number][] {
  const s = 180 / 2 ** g;
  const out: [number, number][] = [];
  const x0 = Math.floor((west + 180) / s),
    x1 = Math.floor((east + 180) / s - 1e-9),
    y0 = Math.floor((south + 90) / s),
    y1 = Math.floor((north + 90) / s - 1e-9);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

const zigzag = (v: number) => (v >> 1) ^ -(v & 1);

/** A tile's bytes decoded (its extensions after the indices left unread); `box` its geodetic box. */
export function decodeQuantizedMesh(bytes: ArrayBuffer, box: readonly [number, number, number, number]): QuantizedMesh {
  const dv = new DataView(bytes);
  // (the header: the centre, 3 doubles; the heights' range, 2 floats; the bounding sphere, 4 doubles; the horizon point, 3)
  const minH = dv.getFloat32(24, true),
    maxH = dv.getFloat32(28, true);
  const n = dv.getUint32(88, true);
  let o = 92;
  const lon = new Float64Array(n),
    lat = new Float64Array(n),
    h = new Float32Array(n);
  let u = 0;
  for (let i = 0; i < n; i++, o += 2) lon[i] = box[0] + ((u += zigzag(dv.getUint16(o, true))) / 32767) * (box[2] - box[0]);
  let v = 0;
  for (let i = 0; i < n; i++, o += 2) lat[i] = box[1] + ((v += zigzag(dv.getUint16(o, true))) / 32767) * (box[3] - box[1]);
  let w = 0;
  for (let i = 0; i < n; i++, o += 2) h[i] = minH + ((w += zigzag(dv.getUint16(o, true))) / 32767) * (maxH - minH);
  // (the indices: 16 bits under 65 536 vertices, else 32 — aligned to their size)
  const wide = n > 65536;
  if (wide && o % 4) o += 4 - (o % 4);
  const tris = dv.getUint32(o, true);
  o += 4;
  const tri = new Uint32Array(3 * tris);
  let top = 0;
  for (let i = 0; i < tri.length; i++) {
    const code = wide ? dv.getUint32(o, true) : dv.getUint16(o, true);
    o += wide ? 4 : 2;
    tri[i] = top - code;
    if (code === 0) top++;
  }
  return { lon, lat, h, tri };
}

/**
 * The meshes drawn into an n × n grid (row 0 the north): `cell(lon, lat)` a place's fractional cell [px] — the cell (i, j)
 * spans [i, i + 1) × [j, j + 1), its centre at (i + 0.5, j + 0.5) —; each cell under a triangle gets that triangle's height at
 * its centre, the others kept (NaN: none).
 */
export function drawMeshes(
  meshes: QuantizedMesh[],
  n: number,
  cell: (lon: number, lat: number) => [number, number],
  out: Float32Array = new Float32Array(n * n).fill(Number.NaN),
): Float32Array {
  for (const m of meshes) {
    const vc = m.h.length;
    const px = new Float64Array(vc),
      py = new Float64Array(vc);
    for (let i = 0; i < vc; i++) [px[i], py[i]] = cell(m.lon[i]!, m.lat[i]!);
    for (let t = 0; t < m.tri.length; t += 3) {
      const a = m.tri[t]!,
        b = m.tri[t + 1]!,
        c = m.tri[t + 2]!;
      const ax = px[a]!,
        ay = py[a]!,
        bx = px[b]!,
        by = py[b]!,
        cx = px[c]!,
        cy = py[c]!;
      const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (det === 0) continue;
      // (the cells whose centres the triangle's box holds, within the grid)
      const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)),
        i1 = Math.min(n - 1, Math.floor(Math.max(ax, bx, cx) - 0.5)),
        j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)),
        j1 = Math.min(n - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
      if (i0 > i1 || j0 > j1) continue;
      const ha = m.h[a]!,
        hb = m.h[b]!,
        hc = m.h[c]!;
      for (let j = j0; j <= j1; j++) {
        const y = j + 0.5;
        for (let i = i0; i <= i1; i++) {
          const x = i + 0.5;
          const wb = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det,
            wc = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det,
            wa = 1 - wb - wc;
          // (inside, its edges' cells kept by a hair's tolerance: the next triangle has them all the same)
          if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
          out[j * n + i] = wa * ha + wb * hb + wc * hc;
        }
      }
    }
  }
  return out;
}

/** drawMeshes in slices of about `sliceMs` [ms], the event loop given back between them: a mountain's 60 000 triangles cost
 *  13–20 ms on the main thread — one frame's whole budget —, spread so over several */
export async function drawMeshesSliced(
  meshes: QuantizedMesh[],
  n: number,
  cell: (lon: number, lat: number) => [number, number],
  sliceMs = 2,
): Promise<Float32Array> {
  const out = new Float32Array(n * n).fill(Number.NaN);
  for (const m of meshes) {
    const step = 3 * 2048;
    let t0 = performance.now();
    for (let k = 0; k < m.tri.length; k += step) {
      drawMeshes([{ lon: m.lon, lat: m.lat, h: m.h, tri: m.tri.subarray(k, Math.min(k + step, m.tri.length)) }], n, cell, out);
      if (performance.now() - t0 > sliceMs) {
        await new Promise((done) => setTimeout(done, 0));
        t0 = performance.now();
      }
    }
  }
  return out;
}
