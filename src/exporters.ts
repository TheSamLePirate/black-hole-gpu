// Image encoders: 16-bit PNG (display-referred, sRGB) and OpenEXR (scene-referred, linear half float).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return crc;
}

async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate")); // zlib wrapper
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff;
  dv.setUint32(8 + data.length, crc >>> 0);
  return out;
}

/** 16-bit-per-channel RGB PNG from display-referred values in [0, 1] (RGBA float input). */
export async function encodePNG16(rgba: Float32Array, width: number, height: number): Promise<Blob> {
  const stride = 1 + width * 6;
  const raw = new Uint8Array(stride * height);
  const dv = new DataView(raw.buffer);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = Math.round(Math.min(1, Math.max(0, rgba[i + c]!)) * 65535);
        dv.setUint16(y * stride + 1 + x * 6 + c * 2, v);
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([16, 2, 0, 0, 0], 8); // bit depth 16, colour type RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const srgb = new Uint8Array([0]); // perceptual rendering intent
  const idat = await deflate(raw);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("sRGB", srgb), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array())];
  return new Blob(parts as BlobPart[], { type: "image/png" });
}

// ---------------------------------------------------------------------------------------------
// OpenEXR 2.0, single-part scanline, no compression, HALF channels B, G, R (alphabetical order).
// ---------------------------------------------------------------------------------------------
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
  if (exp >= 0x1f) return sign | 0x7c00; // overflow → inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow → 0
    mant |= 0x800000;
    const shift = 14 - exp;
    let h = mant >>> shift;
    if ((mant >>> (shift - 1)) & 1) h++; // round
    return sign | h;
  }
  let h = sign | (exp << 10) | (mant >>> 13);
  if (mant & 0x1000) h++; // round to nearest
  return h;
}

export function encodeEXR(rgba: Float32Array, width: number, height: number): Blob {
  const header: number[] = [];
  const bytes = (...b: number[]) => header.push(...b);
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) header.push(s.charCodeAt(i));
    header.push(0);
  };
  const i32 = (v: number) => bytes(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const f32le = (v: number) => {
    const b = new Uint8Array(new Float32Array([v]).buffer);
    bytes(...b);
  };
  const attr = (name: string, type: string, size: number, write: () => void) => {
    str(name);
    str(type);
    i32(size);
    write();
  };

  bytes(0x76, 0x2f, 0x31, 0x01); // magic
  i32(2); // version 2, scanline
  const channels = ["B", "G", "R"];
  attr("channels", "chlist", channels.length * 18 + 1, () => {
    for (const c of channels) {
      str(c);
      i32(1); // HALF
      bytes(0, 0, 0, 0); // pLinear + reserved
      i32(1);
      i32(1);
    }
    bytes(0);
  });
  attr("compression", "compression", 1, () => bytes(0));
  attr("dataWindow", "box2i", 16, () => [0, 0, width - 1, height - 1].forEach(i32));
  attr("displayWindow", "box2i", 16, () => [0, 0, width - 1, height - 1].forEach(i32));
  attr("lineOrder", "lineOrder", 1, () => bytes(0));
  attr("pixelAspectRatio", "float", 4, () => f32le(1));
  attr("screenWindowCenter", "v2f", 8, () => {
    f32le(0);
    f32le(0);
  });
  attr("screenWindowWidth", "float", 4, () => f32le(1));
  bytes(0); // end of header

  const lineBytes = width * 2 * channels.length;
  const blockSize = 8 + lineBytes;
  const tableOffset = header.length;
  const dataStart = tableOffset + height * 8;
  const out = new Uint8Array(dataStart + height * blockSize);
  out.set(header, 0);
  const dv = new DataView(out.buffer);
  for (let y = 0; y < height; y++) {
    dv.setBigUint64(tableOffset + y * 8, BigInt(dataStart + y * blockSize), true);
    const o = dataStart + y * blockSize;
    dv.setInt32(o, y, true);
    dv.setInt32(o + 4, lineBytes, true);
    channels.forEach((_, ci) => {
      const src = 2 - ci; // B, G, R ← rgba[2], [1], [0]
      for (let x = 0; x < width; x++) {
        dv.setUint16(o + 8 + ci * width * 2 + x * 2, toHalf(rgba[(y * width + x) * 4 + src]!), true);
      }
    });
  }
  return new Blob([out], { type: "image/x-exr" });
}
