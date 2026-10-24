// A PMTiles (v3) archive read by byte ranges (docs/PLAN-BATIMENTS-AAA.md B7: Overture Maps' buildings): its 127-byte
// header, its root directory, its leaf directories, a tile's bytes — each a range of the one file, fetched as asked and
// kept (the directories here, the bytes by the Service Worker under a key of their own: sw.ts rangeKey). Pure but for the
// fetch it is given; the scenery's worker reads the buildings with it, the Service Worker resolves a zone's tiles with it.
//   https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md

/** a range of an archive: `url`'s bytes [offset, offset + length) */
export type RangeFetch = (url: string, offset: number, length: number) => Promise<Uint8Array>;

// ---- Overture Maps' buildings (PMTiles, z 5–14; CORS open; a release a month, the last three kept)
export const OVERTURE_BUCKET = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/";
/** the bucket's releases (S3's listing: `tiles/<release>/`) */
export const OVERTURE_LIST = `${OVERTURE_BUCKET}?list-type=2&prefix=tiles/&delimiter=/`;
export const overtureUrl = (release: string) => `${OVERTURE_BUCKET}tiles/${release}/buildings.pmtiles`;
/** the releases a listing names, the latest first */
export function overtureReleases(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<Prefix>tiles\/([0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+)\/<\/Prefix>/g)) out.push(m[1]!);
  return out.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
/** the level its buildings are read at */
export const OVERTURE_Z = 14;
/** a zone's pseudo-URL for an Overture tile (sw.ts zoneFetch resolves it: its directories' and its bytes' ranges kept) */
export const overtureZoneUrl = (x: number, y: number) => `kerr-overture:${OVERTURE_Z}/${x}/${y}`;
export function parseOvertureZoneUrl(url: string): { z: number; x: number; y: number } | null {
  const m = /^kerr-overture:(\d+)\/(\d+)\/(\d+)$/.exec(url);
  return m ? { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
}
/** the Service Worker's key for a range of a URL (the Cache API keeps no partial response: each range a whole one of its
 *  own) — never fetched as such */
export const rangeKey = (url: string, offset: number, length: number) =>
  `${url}${url.includes("?") ? "&" : "?"}kerr-range=${offset}-${offset + length - 1}`;
/** a Range header's bytes ("bytes=a-b"), null for any other */
export function parseRange(h: string | null): { offset: number; length: number } | null {
  const m = h && /^bytes=(\d+)-(\d+)$/.exec(h.trim());
  return m ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : null;
}

// ---- the format

/** a level, column, row's tile id: the tiles of the levels above it, then its place along the level's Hilbert curve */
export function tileId(z: number, x: number, y: number): number {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0,
    xx = x,
    yy = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (xx & s) > 0 ? 1 : 0,
      ry = (yy & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        xx = s - 1 - xx;
        yy = s - 1 - yy;
      }
      [xx, yy] = [yy, xx];
    }
  }
  return acc + d;
}
export interface Entry {
  id: number;
  /** tiles from id on with the same bytes; 0: a leaf directory */
  runLength: number;
  offset: number;
  length: number;
}
/** a directory's entries (decompressed): their count, then their ids' deltas, run lengths, lengths, offsets (varints) */
export function parseDirectory(b: Uint8Array): Entry[] {
  let p = 0;
  const v = () => {
    let r = 0,
      s = 1,
      c: number;
    do {
      c = b[p++]!;
      r += (c & 127) * s;
      s *= 128;
    } while (c & 128);
    return r;
  };
  const n = v();
  const e: Entry[] = Array.from({ length: n }, () => ({ id: 0, runLength: 0, offset: 0, length: 0 }));
  let last = 0;
  for (const x of e) {
    last += v();
    x.id = last;
  }
  for (const x of e) x.runLength = v();
  for (const x of e) x.length = v();
  for (let i = 0; i < n; i++) {
    const o = v();
    // (0: right after the entry before)
    e[i]!.offset = o === 0 && i > 0 ? e[i - 1]!.offset + e[i - 1]!.length : o - 1;
  }
  return e;
}
export interface Header {
  rootOffset: number;
  rootLength: number;
  leafOffset: number;
  dataOffset: number;
  /** 1 none, 2 gzip (the directories', the tiles') */
  internalCompression: number;
  tileCompression: number;
  minZoom: number;
  maxZoom: number;
}
export function parseHeader(h: Uint8Array): Header {
  if (h.length < 127 || String.fromCharCode(...h.subarray(0, 7)) !== "PMTiles" || h[7] !== 3) throw new Error("not a PMTiles v3 archive");
  const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  const q = (i: number) => Number(dv.getBigUint64(i, true));
  return {
    rootOffset: q(8),
    rootLength: q(16),
    leafOffset: q(40),
    dataOffset: q(56),
    internalCompression: h[97]!,
    tileCompression: h[98]!,
    minZoom: h[100]!,
    maxZoom: h[101]!,
  };
}
export async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** the entry holding an id: the last at or before it (null: none) */
function findEntry(e: Entry[], id: number): Entry | null {
  let lo = 0,
    hi = e.length - 1,
    f = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (e[m]!.id <= id) {
      f = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return f < 0 ? null : e[f]!;
}

/** An archive read by ranges: its header and directories kept (a few leaves, most recently used), its tiles asked each time. */
export class PmTiles {
  private head: Promise<Header> | null = null;
  private dirs = new Map<string, Promise<Entry[]>>();
  constructor(
    readonly url: string,
    private range: RangeFetch,
    private keepDirs = 64,
  ) {}
  header(): Promise<Header> {
    this.head ??= this.range(this.url, 0, 127).then(parseHeader);
    this.head.catch(() => (this.head = null));
    return this.head;
  }
  private async decompress(b: Uint8Array, kind: number) {
    return kind === 2 ? gunzip(b) : b;
  }
  private dir(offset: number, length: number, h: Header): Promise<Entry[]> {
    const k = `${offset}/${length}`;
    let d = this.dirs.get(k);
    if (!d) {
      d = this.range(this.url, offset, length).then(async (b) => parseDirectory(await this.decompress(b, h.internalCompression)));
      d.catch(() => this.dirs.delete(k));
      this.dirs.set(k, d);
      if (this.dirs.size > this.keepDirs) this.dirs.delete(this.dirs.keys().next().value!);
    }
    return d;
  }
  /** a tile's range in the archive (null: none there) — the ranges read to find it asked through `range` */
  async locate(z: number, x: number, y: number): Promise<{ offset: number; length: number } | null> {
    const h = await this.header();
    if (z < h.minZoom || z > h.maxZoom) return null;
    const id = tileId(z, x, y);
    let d = await this.dir(h.rootOffset, h.rootLength, h);
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(d, id);
      if (!e) return null;
      if (e.runLength > 0) return id < e.id + e.runLength ? { offset: h.dataOffset + e.offset, length: e.length } : null;
      d = await this.dir(h.leafOffset + e.offset, e.length, h);
    }
    return null;
  }
  /** a tile's bytes, decompressed (null: none there) */
  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const at = await this.locate(z, x, y);
    if (!at) return null;
    const h = await this.header();
    return this.decompress(await this.range(this.url, at.offset, at.length), h.tileCompression);
  }
}

/** a fetch of a range with a Range header (the Service Worker keeps it under rangeKey), its bytes checked */
export const fetchRange =
  (fetcher: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): RangeFetch =>
  async (url, offset, length) => {
    const r = await fetcher(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    // (a server ignoring the range answers 200 and the whole file — 181 GB for Overture's —: its body never read)
    const declared = Number(r.headers.get("content-length") ?? Number.NaN);
    if (r.status !== 206 || (Number.isFinite(declared) && declared !== length)) {
      void r.body?.cancel();
      throw new Error(`HTTP ${r.status} (${declared} bytes): ${url} ${offset}+${length}`);
    }
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.byteLength !== length) throw new Error(`range ${offset}+${length}: ${b.byteLength} bytes`);
    return b;
  };
