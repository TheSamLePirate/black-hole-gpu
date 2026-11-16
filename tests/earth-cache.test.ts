import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchKeep, keptUrl, keyFiles, readKept, ttlOf, wantsNetwork } from "./e2e/lib/earth-cache";

// PLAN-J8 J8-T — the e2e's Earth data on disk (tests/e2e/lib/earth-cache.ts), its pure parts: what is kept (the PWA's tiles — the BD TOPO's
// buildings, OpenFreeMap's, Overture's ranges, WorldCover's COGs —, never the live data nor OpenStreetMap's map tiles), how long, under
// which key (a byte range its own), written whole and read back (a 206 with its Content-Range, a 404 kept), the header that keeps the
// network.

const dir = mkdtempSync(join(tmpdir(), "kerr-earth-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("what is kept: the tiles and the buildings; never the live data, never OpenStreetMap's map tiles", () => {
  expect(keptUrl("https://data.geopf.fr/tms/1.0.0/BDTOPO/15/16941/12025.pbf")).toBe(true);
  expect(keptUrl("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&LAYER=ORTHO")).toBe(true);
  expect(keptUrl("https://tiles.openfreemap.org/planet/20251015_001001_pt/14/8500/5900.pbf")).toBe(true);
  expect(keptUrl("https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/2025-10-22/buildings.pmtiles")).toBe(true);
  expect(keptUrl("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42E003_Map.tif")).toBe(
    true,
  );
  expect(keptUrl("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2100/1490.png")).toBe(true);
  // (OpenStreetMap's own: its policy — Sam's decision, 16 Nov 2026)
  expect(keptUrl("https://tile.openstreetmap.org/12/2100/1490.png")).toBe(false);
  // (the live data: the weather, the METARs, the traffic, the solar wind)
  expect(keptUrl("https://api.open-meteo.com/v1/forecast?latitude=43&longitude=6")).toBe(false);
  expect(keptUrl("https://aviationweather.gov/api/data/metar?ids=LFTH")).toBe(false);
  expect(keptUrl("https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json")).toBe(false);
  expect(keptUrl("https://overpass-api.de/api/interpreter")).toBe(false);
});

test("how long: OpenFreeMap's latest and Overture's releases 30 days, a versioned tile for good", () => {
  expect(ttlOf("https://tiles.openfreemap.org/planet")).toBe(30 * 864e5);
  expect(ttlOf("https://tiles.openfreemap.org/planet/20251015_001001_pt/14/8500/5900.pbf")).toBe(Number.POSITIVE_INFINITY);
  expect(ttlOf("https://data.geopf.fr/tms/1.0.0/BDTOPO/15/1/2.pbf")).toBe(Number.POSITIVE_INFINITY);
});

test("the key: per host, a byte range its own answer", () => {
  const u = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/x.pmtiles";
  const a = keyFiles(dir, u, "bytes=0-16383"),
    b = keyFiles(dir, u, "bytes=16384-32767"),
    c = keyFiles(dir, u, null);
  expect(a.bin).not.toBe(b.bin);
  expect(a.bin).not.toBe(c.bin);
  expect(a.bin.startsWith(join(dir, "overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com"))).toBe(true);
});

test("fetched once, kept whole, read back: a 200, a 206 with its range, a 404 kept, a 500 not", async () => {
  const body = new Uint8Array(4096).map((_, i) => i % 251);
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/none") return new Response("no tile", { status: 404 });
      if (p === "/err") return new Response("busy", { status: 500 });
      const r = req.headers.get("range");
      if (r) {
        const [s, e] = r.replace("bytes=", "").split("-").map(Number);
        return new Response(body.slice(s, e! + 1), { status: 206, headers: { "content-range": `bytes ${s}-${e}/4096` } });
      }
      return new Response(body, { headers: { "content-type": "application/x-protobuf" } });
    },
  });
  const base = `http://localhost:${srv.port}`;
  try {
    const whole = await fetchKeep(dir, `${base}/tile`, null);
    expect(whole.meta.status).toBe(200);
    const back = readKept(dir, `${base}/tile`, null)!;
    expect(back.meta.type).toBe("application/x-protobuf");
    expect(Buffer.compare(Buffer.from(back.body), Buffer.from(body))).toBe(0);
    const part = await fetchKeep(dir, `${base}/tile`, "bytes=100-199");
    expect(part.meta.status).toBe(206);
    const pb = readKept(dir, `${base}/tile`, "bytes=100-199")!;
    expect(pb.meta.contentRange).toBe("bytes 100-199/4096");
    expect(Buffer.compare(Buffer.from(pb.body), Buffer.from(body.slice(100, 200)))).toBe(0);
    await fetchKeep(dir, `${base}/none`, null);
    expect(readKept(dir, `${base}/none`, null)?.meta.status).toBe(404);
    await fetchKeep(dir, `${base}/err`, null);
    expect(readKept(dir, `${base}/err`, null)).toBeNull();
    // (written whole: no temporary file left behind)
    const host = readdirSync(dir).find((d) => d.startsWith("localhost"))!;
    expect(readdirSync(join(dir, host)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(existsSync(keyFiles(dir, `${base}/tile`, null).bin)).toBe(true);
  } finally {
    srv.stop(true);
  }
});

test("the header that keeps the network: `// Earth data: network` in the file's first comments", () => {
  expect(
    wantsNetwork(`import { x } from "y";\n// What it proves.\n// Earth data: network (it measures)\n// Duration: ~1 min.\ntest();`),
  ).toBe(true);
  expect(wantsNetwork(`// What it proves.\n// Duration: ~1 min.\ntest();\n// Earth data: network`)).toBe(false);
});
