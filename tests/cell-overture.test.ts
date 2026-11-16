import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readHeader } from "../src/system/building-cells";
import { BDTOPO_BOX, inBdtopoBox, overtureCell } from "../src/system/cell-overture";
import { ORTHO_BOX } from "../src/system/earth-tiles";
import { OVERTURE_LIST, overtureUrl, tileId } from "../src/system/pmtiles";

// PLAN-J8 J8-7 — the cell worker's source (src/system/cell-overture.ts): the IGN's box (a copy of earth-tiles.ts ORTHO_BOX, held equal
// here), and Overture's cell read from its archive by ranges — a fake bucket serving Tarifa's z 14 tile (tests/fixtures/overture) —,
// the four cells of a tile prepared once: the next cell of the same tile asks no tile's bytes again.

// (an archive written the spec's way — tests/pmtiles.test.ts's —: one tile, its directory gzip'd)
const varints = (vs: number[]) => {
  const out: number[] = [];
  for (let v of vs) {
    while (v >= 128) {
      out.push((v % 128) | 128);
      v = Math.floor(v / 128);
    }
    out.push(v);
  }
  return out;
};
function archive(id: number, tile: Uint8Array) {
  const g = Bun.gzipSync(tile as Uint8Array<ArrayBuffer>);
  const root = Bun.gzipSync(new Uint8Array(varints([1, id, 1, g.length, 1])));
  const head = new Uint8Array(127);
  head.set(
    [..."PMTiles"].map((c) => c.charCodeAt(0)),
    0,
  );
  head[7] = 3;
  const dv = new DataView(head.buffer);
  const set = (i: number, v: number) => dv.setBigUint64(i, BigInt(v), true);
  set(8, 127);
  set(16, root.length);
  set(40, 127 + root.length);
  set(56, 127 + root.length);
  head[97] = 2;
  head[98] = 2;
  head[100] = 0;
  head[101] = 14;
  const all = new Uint8Array(127 + root.length + g.length);
  all.set(head, 0);
  all.set(root, 127);
  all.set(g, 127 + root.length);
  return all;
}

test("the IGN's box: earth-tiles.ts ORTHO_BOX's own", () => {
  expect(BDTOPO_BOX).toEqual(ORTHO_BOX);
});

test("which cells ask the BD TOPO first: Toulon and Brussels (in the box), not Tarifa nor London", () => {
  const cell = (lat: number, lon: number) => {
    const n = 2 ** 15,
      D = Math.PI / 180;
    return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n)] as const;
  };
  expect(inBdtopoBox(...cell(43.124, 5.93))).toBe(true);
  expect(inBdtopoBox(...cell(50.8467, 4.3525))).toBe(true);
  expect(inBdtopoBox(...cell(36.0143, -5.6044))).toBe(false);
  expect(inBdtopoBox(...cell(51.507, -0.128))).toBe(false);
});

test("Overture's cell: read from the archive by ranges, the tile's four prepared once", async () => {
  const tile = new Uint8Array(readFileSync(new URL("./fixtures/overture/2026-10-21.0-14-7936-6432.mvt", import.meta.url)));
  const pm = archive(tileId(14, 7936, 6432), tile);
  const url = overtureUrl("2026-10-21.0");
  const asked: string[] = [];
  const fetcher = async (u: string, i?: RequestInit) => {
    if (u === OVERTURE_LIST)
      return new Response("<ListBucketResult><CommonPrefixes><Prefix>tiles/2026-10-21.0/</Prefix></CommonPrefixes></ListBucketResult>");
    if (u !== url) return new Response(null, { status: 404 });
    const [a, b] = String(new Headers(i?.headers).get("range")).replace("bytes=", "").split("-").map(Number);
    asked.push(`${a}-${b}`);
    return new Response(pm.slice(a, b! + 1), {
      status: 206,
      headers: { "content-length": String(b! - a! + 1), "content-range": `bytes ${a}-${b}/${pm.length}` },
    });
  };
  const ne = await overtureCell(15873, 12864, fetcher);
  const h = readHeader(ne.buf);
  expect([h?.x, h?.y, h?.generation]).toEqual([15873, 12864, 20261021]);
  expect(ne.records.length).toBeGreaterThan(100);
  const reads = asked.length;
  // (its sibling in the same z 14 tile: from memory, no range asked)
  const se = await overtureCell(15873, 12865, fetcher);
  expect(readHeader(se.buf)?.y).toBe(12865);
  expect(asked.length).toBe(reads);
});
