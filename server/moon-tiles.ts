// The Moon's fine relief, made once on the server and served (PLAN-PLANETES-AAA P6, docs/PLAN-SERVICES-SERVEUR-AAA.md:
// a work done once for all): LRO LOLA's global 118 m model — the USGS's GeoTIFF on AWS, 8.5 GB, one strip a row, not
// tiled, so not readable piecewise from a page — read a band of 256 rows at a time (one HTTP range each, 47 MB), cut into
// the tiles of src/system/lola-codec.ts (z 0: 360 × 180 of 1°), then their coarser levels (z 1 … 3) from them; resumable
// (a tile written is not made again). Served at /svc/v1/moon/lola/{z}/{row}/{col}.bin — gzipped, CORS open, immutable —
// and /svc/v1/moon/lola/status (the build's progress).

import { mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { LOLA_LEVELS, LOLA_TILE, lolaCols, lolaDecode, lolaEncode, lolaParent, lolaRows } from "../src/system/lola-codec";

export const LOLA_SRC = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif";
// (its layout, read from its header: the first row's offset, little-endian signed 16-bit samples, rows contiguous)
const DATA0 = 738233;
const W = 92160;
const ROW = 2 * W;

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
 * Builds the tiles into dir — all, or the box of z 0 tiles rows [r0, r1) × cols [c0, c1) (a local test: the coarser
 * levels then only where all their children are).
 */
export async function buildLola(
  dir: string,
  o: { rows?: [number, number]; cols?: [number, number]; log?: (m: string) => void; src?: string } = {},
) {
  const log = o.log ?? ((m) => console.log(m));
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
        const band = await fetchBand(o.src ?? LOLA_SRC, ty * LOLA_TILE, log);
        mkdirSync(`${dir}/0/${ty}`, { recursive: true });
        for (const tx of missing) {
          const h = new Int16Array(LOLA_TILE * LOLA_TILE);
          for (let y = 0; y < LOLA_TILE; y++) h.set(band.subarray(y * W + tx * LOLA_TILE, y * W + (tx + 1) * LOLA_TILE), y * LOLA_TILE);
          await Bun.write(tilePath(dir, 0, ty, tx), gzipSync(lolaEncode(h, 0), { level: 9 }));
        }
      }
      status.rows = ty - r0 + 1;
      if (missing.length) log(`lola: z 0 row ${ty} (${missing.length} tiles)`);
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
          await Bun.write(tilePath(dir, z, ty, tx), gzipSync(lolaEncode(lolaParent(nw, ne, sw, se), z), { level: 9 }));
          made++;
        }
      status.levels = z;
      log(`lola: z ${z} (${made} tiles)`);
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

/** 256 rows of the model from row y0 (one range request; five tries) */
async function fetchBand(src: string, y0: number, log: (m: string) => void): Promise<Int16Array> {
  const a = DATA0 + y0 * ROW,
    b = a + LOLA_TILE * ROW - 1;
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(src, { headers: { range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(600_000) });
      if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      if (buf.byteLength !== LOLA_TILE * ROW) throw new Error(`short band: ${buf.byteLength}`);
      return new Int16Array(buf);
    } catch (e) {
      if (k >= 4) throw e;
      log(`lola: band ${y0} failed (${e}), again`);
      await Bun.sleep(5000 * (k + 1));
    }
  }
}

const CORS = { "access-control-allow-origin": "*" };

/** The tiles' service over dir: a Response for /svc/v1/moon/lola/…, or null (not its path). */
export function createMoonTiles(dir: string) {
  return {
    async handle(url: URL): Promise<Response | null> {
      const m = /^\/svc\/v1\/moon\/lola\/(?:(status)|(\d)\/(\d+)\/(\d+)\.bin)$/.exec(url.pathname);
      if (!m) return url.pathname.startsWith("/svc/v1/moon/") ? new Response(null, { status: 404, headers: CORS }) : null;
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
