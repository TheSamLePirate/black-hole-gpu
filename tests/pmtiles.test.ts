import { describe, expect, test } from "bun:test";
import { classify, tileKind } from "../src/pwa/rules";
import {
  fetchRange,
  OVERTURE_LIST,
  overtureReleases,
  overtureUrl,
  overtureZoneUrl,
  parseDirectory,
  parseOvertureZoneUrl,
  parseRange,
  PmTiles,
  rangeKey,
  tileId,
} from "../src/system/pmtiles";
import { overtureRoofMaterial, overtureShape, overtureWallMaterial, RoofMaterial, WallMaterial } from "../src/system/roofs";

// (an archive written the spec's way: a directory's varints, gzip'd)
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
const directory = (e: { id: number; runLength: number; offset: number; length: number }[]) => {
  let last = 0;
  return new Uint8Array(
    varints([
      e.length,
      ...e.map((x) => {
        const d = x.id - last;
        last = x.id;
        return d;
      }),
      ...e.map((x) => x.runLength),
      ...e.map((x) => x.length),
      ...e.map((x) => x.offset + 1),
    ]),
  );
};
function archive(tiles: Map<number, Uint8Array>) {
  const entries: { id: number; runLength: number; offset: number; length: number }[] = [];
  const data: number[] = [];
  for (const [id, b] of [...tiles].sort((a, b) => a[0] - b[0])) {
    const g = Bun.gzipSync(b as Uint8Array<ArrayBuffer>);
    entries.push({ id, runLength: 1, offset: data.length, length: g.length });
    data.push(...g);
  }
  const root = Bun.gzipSync(directory(entries));
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
  const all = new Uint8Array(127 + root.length + data.length);
  all.set(head, 0);
  all.set(root, 127);
  all.set(data, 127 + root.length);
  return all;
}

describe("PMTiles", () => {
  test("a tile's id: the levels above it, then its Hilbert place", () => {
    expect(tileId(0, 0, 0)).toBe(0);
    expect(tileId(1, 0, 0)).toBe(1);
    expect(tileId(1, 0, 1)).toBe(2);
    expect(tileId(1, 1, 1)).toBe(3);
    expect(tileId(1, 1, 0)).toBe(4);
    expect(tileId(2, 0, 0)).toBe(5);
  });
  test("a directory's varints read back", () => {
    const e = [
      { id: 5, runLength: 1, offset: 0, length: 300 },
      { id: 9, runLength: 0, offset: 300, length: 70000 },
    ];
    expect(parseDirectory(directory(e))).toEqual(e);
  });
  test("an archive read by ranges: a tile found, its bytes gunzipped; a missing one null; each range asked as given", async () => {
    const z14 = tileId(14, 8504, 5833);
    const file = archive(new Map([[z14, new TextEncoder().encode("a building")]]));
    const asked: [number, number][] = [];
    const pm = new PmTiles("mem://a", async (_u, offset, length) => {
      asked.push([offset, length]);
      return file.slice(offset, offset + length);
    });
    expect(new TextDecoder().decode((await pm.tile(14, 8504, 5833))!)).toBe("a building");
    expect(await pm.tile(14, 8505, 5833)).toBeNull();
    expect(asked[0]).toEqual([0, 127]);
    // (the header and the root directory asked once, kept)
    expect(asked.filter(([o]) => o === 0).length).toBe(1);
  });
  test("a server that ignores the range is refused before its body is read", async () => {
    const huge = fetchRange(async () => new Response("x".repeat(1000), { status: 200, headers: { "content-length": "1000" } }));
    await expect(huge("https://x/a", 0, 127)).rejects.toThrow("HTTP 200");
    const ok = fetchRange(async () => new Response(new Uint8Array(127), { status: 206, headers: { "content-length": "127" } }));
    expect((await ok("https://x/a", 0, 127)).byteLength).toBe(127);
  });
});

describe("Overture", () => {
  test("its releases from the bucket's listing, the latest first", () => {
    const xml =
      "<ListBucketResult><CommonPrefixes><Prefix>tiles/2026-09-23.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-10-21.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>tiles/2026-09-23.1/</Prefix></CommonPrefixes></ListBucketResult>";
    expect(overtureReleases(xml)).toEqual(["2026-10-21.0", "2026-09-23.1", "2026-09-23.0"]);
    expect(overtureUrl("2026-10-21.0")).toEndWith("tiles/2026-10-21.0/buildings.pmtiles");
  });
  test("its ranges kept under keys of their own, its zone pseudo-URLs", () => {
    expect(parseRange("bytes=10-136")).toEqual({ offset: 10, length: 127 });
    expect(parseRange("bytes=10-")).toBeNull();
    expect(rangeKey("https://h/a.pmtiles", 10, 127)).toBe("https://h/a.pmtiles?kerr-range=10-136");
    expect(parseOvertureZoneUrl(overtureZoneUrl(8504, 5833))).toEqual({ z: 14, x: 8504, y: 5833 });
    expect(classify(overtureUrl("2026-10-21.0"), "https://kerr.example/")).toBe("tile");
    expect(classify(OVERTURE_LIST, "https://kerr.example/")).toBe("tile");
    expect(tileKind(rangeKey(overtureUrl("2026-10-21.0"), 0, 127))).toBe("overture");
  });
  test("its roofs' and facades' names as ours", () => {
    expect(overtureShape("skillion")).toBe("shed");
    expect(overtureShape("gambrel")).toBe("mansard");
    expect(overtureShape("dome")).toBe("hipped");
    expect(overtureShape("weird")).toBeUndefined();
    expect(overtureRoofMaterial("roof_tiles")).toBe(RoofMaterial.Tiles);
    expect(overtureRoofMaterial("tar_paper")).toBe(RoofMaterial.Concrete);
    expect(overtureWallMaterial("glass")).toBe(WallMaterial.Glass);
    expect(overtureWallMaterial("plaster")).toBe(WallMaterial.Render);
  });
});
