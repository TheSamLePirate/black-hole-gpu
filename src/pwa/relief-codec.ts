// The relief's grids kept small (docs/ANALYSE-IGN-LIDAR.md §9.3, I8c): the IGN's WMS-R answers float32 heights, 256² (256 KB)
// or 512² (1 MB) — three quarters of an offline zone's bytes. The Service Worker (src/sw.ts) keeps them here instead: each
// height to the centimetre (an error ≤ 5 mm), told from its neighbours (LOCO-I's median predictor: the left, the one above,
// their sum less the one between), the difference on 16 bits — a cliff past ±327 m an escape to its full value, a hole
// (no-data, or what the game reads as one: under −100 m, over 9 000 m, not finite) a code of its own —, its low and high
// bytes in two planes, the whole deflated. Read back, the same float32 grid, the holes the value the source gave them: the
// game's loads (system/earth-tiles.ts ignGrid) see what the network sent, to the centimetre. Pure (tests/relief-codec.test.ts).

/** the codec's mark, the cached response's header naming it */
export const RELIEF_CODEC = "krh1";
const MAGIC = 0x3148524b; // "KRH1"
/** a residual's codes: the next escape's full value, a hole */
const ESC = -32768,
  HOLE = -32767;
/** the heights the game reads as holes (earth-tiles.ts ignGrid) */
const isHole = (h: number) => !Number.isFinite(h) || h < -100 || h > 9000;

/** A float32 height grid whose length is a square's (256², 512²): one the codec takes. */
export const isReliefGrid = (url: string, bytes: number) =>
  url.includes("image/x-bil") && bytes > 0 && Number.isInteger(Math.sqrt(bytes / 4));

/** A grid packed before its deflation: the header, the residuals' low then high bytes, the escapes' values. */
export function packGrid(src: Float32Array): Uint8Array {
  const n = src.length;
  const w = Math.round(Math.sqrt(n));
  const res = new Int16Array(n);
  const esc: number[] = [];
  const cm = new Int32Array(n);
  let holeValue = Number.NaN;
  let holeSeen = false;
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const a = x > 0 ? cm[i - 1]! : i >= w ? cm[i - w]! : 0;
    const b = i >= w ? cm[i - w]! : a;
    const c = x > 0 && i >= w ? cm[i - w - 1]! : b;
    const p = c >= Math.max(a, b) ? Math.min(a, b) : c <= Math.min(a, b) ? Math.max(a, b) : a + b - c;
    const h = src[i]!;
    if (isHole(h)) {
      if (!holeSeen) {
        holeValue = h;
        holeSeen = true;
      }
      res[i] = HOLE;
      cm[i] = p;
      continue;
    }
    const v = Math.round(h * 100);
    const d = v - p;
    cm[i] = v;
    if (d > HOLE && d <= 32767) res[i] = d;
    else {
      res[i] = ESC;
      esc.push(v);
    }
  }
  const out = new Uint8Array(16 + 2 * n + 4 * esc.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, w, true);
  dv.setUint32(8, esc.length, true);
  dv.setFloat32(12, holeValue, true);
  for (let i = 0; i < n; i++) {
    out[16 + i] = res[i]! & 0xff;
    out[16 + n + i] = (res[i]! >> 8) & 0xff;
  }
  for (let k = 0; k < esc.length; k++) dv.setInt32(16 + 2 * n + 4 * k, esc[k]!, true);
  return out;
}

/** The grid again from its packing (null: not one of the codec's). */
export function unpackGrid(buf: Uint8Array): Float32Array | null {
  if (buf.byteLength < 16) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) return null;
  const w = dv.getUint32(4, true);
  const n = w * w;
  const nEsc = dv.getUint32(8, true);
  const holeValue = dv.getFloat32(12, true);
  if (buf.byteLength !== 16 + 2 * n + 4 * nEsc) return null;
  const out = new Float32Array(n);
  const cm = new Int32Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const a = x > 0 ? cm[i - 1]! : i >= w ? cm[i - w]! : 0;
    const b = i >= w ? cm[i - w]! : a;
    const c = x > 0 && i >= w ? cm[i - w - 1]! : b;
    const p = c >= Math.max(a, b) ? Math.min(a, b) : c <= Math.min(a, b) ? Math.max(a, b) : a + b - c;
    const d = ((buf[16 + i]! | (buf[16 + n + i]! << 8)) << 16) >> 16;
    if (d === HOLE) {
      cm[i] = p;
      out[i] = holeValue;
      continue;
    }
    const v = d === ESC ? dv.getInt32(16 + 2 * n + 4 * e++, true) : p + d;
    cm[i] = v;
    out[i] = v / 100;
  }
  return out;
}

const through = async (bytes: Uint8Array, t: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(t)).arrayBuffer());

/** A float32 grid's bytes kept small: packed, deflated. */
export async function encodeRelief(body: ArrayBuffer): Promise<Uint8Array> {
  return through(packGrid(new Float32Array(body)), new CompressionStream("deflate-raw"));
}
/** Its float32 bytes again (null: not one of the codec's). */
export async function decodeRelief(stored: ArrayBuffer): Promise<ArrayBuffer | null> {
  const g = unpackGrid(await through(new Uint8Array(stored), new DecompressionStream("deflate-raw")).catch(() => new Uint8Array()));
  return g ? (g.buffer as ArrayBuffer) : null;
}
