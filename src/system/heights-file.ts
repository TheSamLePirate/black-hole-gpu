// The height maps' file (scripts/build-earth-relief.py, scripts/build-dem.py: "ELV1", gzip): u32 magic,
// width, height, 0, then the i16 heights [m] row by row — each row's first value whole, the others as the
// difference from the one before —, little-endian, in two planes: all the low bytes, then all the high.

/** A height map [m], W × H equirectangular (u = 0.5 + longitude/360°, texel centres). */
export interface HeightMap {
  map: Int16Array<ArrayBuffer>;
  W: number;
  H: number;
}

/** The heights from their file, the rows summed a band at a time (no long task on the main thread). */
export async function loadHeights(url: string, get: (url: string) => Promise<Response> = (u) => fetch(u)): Promise<HeightMap> {
  const res = await get(url);
  if (!res.ok || !res.body) throw new Error(`Height map: HTTP ${res.status}`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== 0x31564c45) throw new Error("Height map: bad header");
  const W = head[1]!,
    H = head[2]!,
    n = W * H;
  const lo = new Uint8Array(buf, 16, n),
    hi = new Uint8Array(buf, 16 + n, n);
  const map = new Int16Array(n);
  for (let y0 = 0; y0 < H; y0 += 256) {
    for (let y = y0; y < Math.min(y0 + 256, H); y++) {
      let o = y * W;
      let v = 0;
      for (let x = 0; x < W; x++, o++) map[o] = v = v + (((lo[o]! | (hi[o]! << 8)) << 16) >> 16);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { map, W, H };
}
