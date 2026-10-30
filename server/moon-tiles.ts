// The worlds' fine relief, made once on the server and served (PLAN-PLANETES-AAA P6, P7; docs/PLAN-SERVICES-SERVEUR-AAA.md: a
// work done once for all): a global model on AWS — the USGS's GeoTIFFs, one strip a row, not tiled, so not readable
// piecewise from a page — read a band of rows at a time (one HTTP range each, 47–64 MB), cut into the tiles of
// src/system/lola-codec.ts (z 0: 360 × 180 of 1°, 256 pixels a degree), then their coarser levels (z 1 … 3) from them;
// resumable (a tile written is not made again).
//   the Moon: LRO LOLA's 118 m model (256 pixels a degree already; half-metres over the 1 737.4 km sphere)
//   Mars: the HRSC and MOLA blend, 200 m (296.37 pixels a degree, resampled bilinearly; metres over the areoid)
// Served at /svc/v1/{moon/lola | mars/dem}/{z}/{row}/{col}.bin — gzipped, CORS open, immutable — and …/status (the build's
// progress).

import { mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { LOLA_LEVELS, LOLA_TILE, lolaCols, lolaDecode, lolaEncode, lolaParent, lolaRows } from "../src/system/lola-codec";

/** A global model's GeoTIFF: one little-endian int16 strip a row, rows contiguous from the north, columns east from 180° W. */
export interface DemSource {
  url: string;
  /** the first row's offset [bytes] */
  data0: number;
  /** its pixels round the body, from pole to pole */
  width: number;
  height: number;
  /** its pixels a degree */
  ppd: number;
  /** its samples' metres (the Moon's 0.5), and the tiles' unit code (lola-codec LOLA_UNITS: 0 half-metres, 1 metres) */
  scale: number;
  unit: number;
  /** its no-data value (none: undefined) */
  nodata?: number;
}

export const LOLA_SRC = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif";
export const DEM_SOURCES: Record<string, DemSource> = {
  // (their layouts, read from their headers)
  moon: { url: LOLA_SRC, data0: 738233, width: 92160, height: 46080, ppd: 256, scale: 0.5, unit: 0 },
  mars: {
    url: "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif",
    data0: 854272,
    width: 106694,
    height: 53347,
    ppd: 1 / 0.003374120830641,
    scale: 1,
    unit: 1,
    nodata: -32768,
  },
};
/** the services: the path under /svc/v1/ and the body's model */
export const DEM_PATHS: Record<string, string> = { moon: "moon/lola", mars: "mars/dem" };

const tilePath = (dir: string, z: number, y: number, x: number) => `${dir}/${z}/${y}/${x}.bin`;

export interface LolaStatus {
  /** z 0's tile rows done, of all */
  rows: number;
  of: number;
  /** the coarser levels done */
  levels: number;
  done: boolean;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

/**
 * Builds a body's tiles into dir — all, or the box of z 0 tiles rows [r0, r1) × cols [c0, c1) (a local test: the coarser
 * levels then only where all their children are).
 */
export async function buildLola(
  dir: string,
  o: { rows?: [number, number]; cols?: [number, number]; log?: (m: string) => void; src?: string; body?: DemSource } = {},
) {
  const log = o.log ?? ((m) => console.log(m));
  const S = { ...(o.body ?? DEM_SOURCES.moon!), ...(o.src ? { url: o.src } : {}) };
  const [r0, r1] = o.rows ?? [0, lolaRows(0)];
  const [c0, c1] = o.cols ?? [0, lolaCols(0)];
  const status: LolaStatus = { rows: 0, of: r1 - r0, levels: 0, done: false, startedAt: new Date().toISOString(), updatedAt: "" };
  const save = () => {
    status.updatedAt = new Date().toISOString();
    return Bun.write(`${dir}/status.json`, JSON.stringify(status));
  };
  mkdirSync(dir, { recursive: true });
  await save();
  try {
    for (let ty = r0; ty < r1; ty++) {
      const missing: number[] = [];
      for (let tx = c0; tx < c1; tx++) if (!(await Bun.file(tilePath(dir, 0, ty, tx)).exists())) missing.push(tx);
      if (missing.length) {
        const band = await tileRow(S, ty, log);
        mkdirSync(`${dir}/0/${ty}`, { recursive: true });
        for (const tx of missing) {
          const h = new Int16Array(LOLA_TILE * LOLA_TILE);
          for (let y = 0; y < LOLA_TILE; y++) h.set(band.subarray(y * 360 * LOLA_TILE + tx * LOLA_TILE, y * 360 * LOLA_TILE + (tx + 1) * LOLA_TILE), y * LOLA_TILE);
          await Bun.write(tilePath(dir, 0, ty, tx), gzipSync(lolaEncode(h, 0, S.unit), { level: 9 }));
        }
      }
      status.rows = ty - r0 + 1;
      if (missing.length) log(`dem: z 0 row ${ty} (${missing.length} tiles)`);
      await save();
    }
    // the coarser levels, from their children (a child past the south pole: none — lolaParent holds the pole's rows)
    for (let z = 1; z < LOLA_LEVELS; z++) {
      const read = async (y: number, x: number) => {
        if (y >= lolaRows(z - 1)) return null;
        const f = Bun.file(tilePath(dir, z - 1, y, x));
        return (await f.exists()) ? lolaDecode(gunzipSync(new Uint8Array(await f.arrayBuffer()))) : undefined;
      };
      let made = 0;
      for (let ty = Math.floor(r0 / 2 ** z); ty < Math.ceil(r1 / 2 ** z) && ty < lolaRows(z); ty++)
        for (let tx = Math.floor(c0 / 2 ** z); tx < Math.ceil(c1 / 2 ** z); tx++) {
          if (await Bun.file(tilePath(dir, z, ty, tx)).exists()) continue;
          const [nw, ne, sw, se] = await Promise.all([read(2 * ty, 2 * tx), read(2 * ty, 2 * tx + 1), read(2 * ty + 1, 2 * tx), read(2 * ty + 1, 2 * tx + 1)]);
          // (a child not made — a local box's edge —: no parent)
          if (!nw || !ne || sw === undefined || se === undefined) continue;
          mkdirSync(`${dir}/${z}/${ty}`, { recursive: true });
          await Bun.write(tilePath(dir, z, ty, tx), gzipSync(lolaEncode(lolaParent(nw, ne, sw, se), z, S.unit), { level: 9 }));
          made++;
        }
      status.levels = z;
      log(`dem: z ${z} (${made} tiles)`);
      await save();
    }
    status.done = true;
    await save();
  } catch (e) {
    status.error = String(e);
    await save();
    throw e;
  }
}

/**
 * z 0's tile row ty — 256 rows round the body at 256 pixels a degree, in the tiles' unit — from the model: its rows read
 * as they are (256 a degree already) or resampled bilinearly (its no-data left out of the weights; none at all: 0).
 */
export async function tileRow(S: DemSource, ty: number, log: (m: string) => void = () => {}): Promise<Int16Array> {
  const N = 360 * LOLA_TILE;
  const k = S.ppd / LOLA_TILE;
  const toUnit = S.scale / (S.unit === 1 ? 1 : 0.5);
  if (k === 1 && S.width === N && toUnit === 1 && S.nodata === undefined) return fetchRows(S, ty * LOLA_TILE, LOLA_TILE, log);
  // (the source rows the 256 output rows fall between)
  const ys = (j: number) => (j + 0.5) * k - 0.5;
  const y0 = Math.max(Math.floor(ys(ty * LOLA_TILE)), 0);
  const y1 = Math.min(Math.floor(ys((ty + 1) * LOLA_TILE - 1)) + 1, S.height - 1);
  const src = await fetchRows(S, y0, y1 - y0 + 1, log);
  const out = new Int16Array(LOLA_TILE * N);
  const nd = S.nodata ?? 1e9;
  // (each output column's two source columns and weight: the same on every row)
  const ca = new Int32Array(N),
    cb = new Int32Array(N),
    cf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * k - 0.5;
    const xa = Math.floor(x);
    ca[i] = ((xa % S.width) + S.width) % S.width;
    cb[i] = (ca[i]! + 1) % S.width;
    cf[i] = x - xa;
  }
  for (let jj = 0; jj < LOLA_TILE; jj++) {
    const y = Math.min(Math.max(ys(ty * LOLA_TILE + jj), y0), y1);
    const ya = Math.min(Math.floor(y), Math.max(y1 - 1, y0)),
      fy = Math.min(Math.max(y - ya, 0), 1);
    const ra = (ya - y0) * S.width,
      rb = (Math.min(ya + 1, y1) - y0) * S.width;
    for (let i = 0; i < N; i++) {
      const a = ca[i]!,
        b = cb[i]!,
        fx = cf[i]!;
      const v0 = src[ra + a]!,
        v1 = src[ra + b]!,
        v2 = src[rb + a]!,
        v3 = src[rb + b]!;
      let s = 0,
        ws = 0;
      if (v0 !== nd) {
        const w = (1 - fx) * (1 - fy);
        s += v0 * w;
        ws += w;
      }
      if (v1 !== nd) {
        const w = fx * (1 - fy);
        s += v1 * w;
        ws += w;
      }
      if (v2 !== nd) {
        const w = (1 - fx) * fy;
        s += v2 * w;
        ws += w;
      }
      if (v3 !== nd) {
        const w = fx * fy;
        s += v3 * w;
        ws += w;
      }
      out[jj * N + i] = ws > 0 ? Math.max(-32768, Math.min(32767, Math.round((s / ws) * toUnit))) : 0;
    }
  }
  return out;
}

/** n rows of the model from row y0 (one range request; five tries) */
async function fetchRows(S: DemSource, y0: number, n: number, log: (m: string) => void): Promise<Int16Array> {
  const row = 2 * S.width;
  const a = S.data0 + y0 * row,
    b = a + n * row - 1;
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(S.url, { headers: { range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(600_000) });
      if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== n * row) throw new Error(`short band: ${buf.byteLength}`);
      return new Int16Array(buf);
    } catch (e) {
      if (k >= 4) throw e;
      log(`dem: rows ${y0}+${n} failed (${e}), again`);
      await Bun.sleep(5000 * (k + 1));
    }
  }
}

const CORS = { "access-control-allow-origin": "*" };

/** A body's tiles' service over dir (path: DEM_PATHS'): a Response for /svc/v1/{path}/…, or null (not its path). */
export function createMoonTiles(dir: string, path = "moon/lola") {
  const re = new RegExp(`^/svc/v1/${path}/(?:(status)|(\\d)/(\\d+)/(\\d+)\\.bin)$`);
  return {
    async handle(url: URL): Promise<Response | null> {
      const m = re.exec(url.pathname);
      if (!m) return url.pathname.startsWith(`/svc/v1/${path}/`) ? new Response(null, { status: 404, headers: CORS }) : null;
      if (m[1]) {
        const f = Bun.file(`${dir}/status.json`);
        return (await f.exists())
          ? new Response(f, { headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } })
          : Response.json({ rows: 0, done: false }, { headers: { ...CORS, "cache-control": "no-store" } });
      }
      const f = Bun.file(tilePath(dir, Number(m[2]), Number(m[3]), Number(m[4])));
      if (!(await f.exists())) return new Response(null, { status: 404, headers: { ...CORS, "cache-control": "no-store" } });
      return new Response(f, {
        headers: {
          ...CORS,
          "content-type": "application/octet-stream",
          "content-encoding": "gzip",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    },
  };
}
