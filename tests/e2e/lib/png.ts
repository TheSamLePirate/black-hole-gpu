// A minimal PNG reader for the e2e captures (8-bit, non-interlaced, RGB or RGBA): the pixels of a capture, to measure
// what a diagnostic view shows rather than to look at it.
import { deflateSync, inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

export function readPng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    depth = 0,
    colour = 0,
    interlace = 0;
  const parts: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6))
    throw new Error(`png: unsupported (${depth}-bit, colour ${colour}, interlace ${interlace})`);
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels]! : 0;
      const b = y ? data[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y ? data[(y - 1) * stride + x - channels]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data };
}

/** An RGB image (3 bytes a pixel, rows top first) as a PNG file's bytes — filter 0, zlib — for the e2e's computed plates. */
export function writePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + 3 * width));
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * 3 * width, (y + 1) * 3 * width), y * (1 + 3 * width) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}
