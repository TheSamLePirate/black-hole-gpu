import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { j8aTrack } from "../../src/system/j8a-tracks";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-9 — a probe of the far layer along J8-A's track (system/j8a-tracks.ts, J8_TRACK — `paris` by default): offline over Paris
// (j8-zone-paris, kerr-mini, 17 Nov 2026) points 2–6 stayed « far layer: N wanted cells not resident » with the world frozen — the
// reserve refusing (72 MiB) or the layer still filling (the render session's two readings). The camera set at each point at its height,
// the world frozen, the place's data settled; then the far layer watched up to 60 s until nothing is missing or nothing has moved for
// 15 s: its cells wanted, missing, resident, refused, its blocks free of all, its budget — and the cells' pool (queued, past its bound).
// No zone, no Service Worker: the e2e's Earth data on disk (a miss fetched and kept). A shot at each point.
// Done when: each point's far-layer figures and the pool's written, a shot each.
// Duration: ~4 min.

afterAll(stopServer);
const TRACK = process.env.J8_TRACK ?? "paris";
const OUT = "remote-results/j8-far-track";

type Far = {
  wanted: number;
  missing: number;
  cells: number;
  refused: number;
  freeBlocks: number;
  blocks: number;
  budgetBytes: number;
  records: number;
} | null;

describe.skipIf(!E2E)(`PLAN-J8 J8-9: the far layer along J8-A's track « ${TRACK} »`, () => {
  test("each point: the far layer's cells wanted, missing, refused, its blocks free — reserve or filling", async () => {
    mkdirSync(OUT, { recursive: true });
    const track = j8aTrack(TRACK);
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, traffic: false, earthClouds: 0, weather: "fair", earthPipeline: "raster",
        earthOrtho: true, earthIgnRelief: true }); __bh.renderer.debugSkipShip = true; return 1; })()`);
      const rows: Record<string, unknown>[] = [];
      for (let k = 0; k < track.points.length; k++) {
        const [lat, lon, alt] = track.points[k]!;
        await app.scenario(`${TRACK} · point ${k + 1} of ${track.points.length}: the far layer`);
        const why = await app.js<string | null>(
          `(() => { __bh.freeze(true); return __bh.viewAt(${lat}, ${lon}, { altM: ${alt} + __bh.sys.geoid(${lat}, ${lon}), pitch: -8, fov: 50 }) ?? null; })()`,
        );
        if (why) throw new Error(`viewAt point ${k + 1}: ${why}`);
        await app
          .dataSettled(`point ${k + 1}`, { maxMs: 120_000 })
          .catch((e) => console.log(`  (point ${k + 1} not settled: ${String(e).slice(0, 160)})`));
        // (the far layer watched: nothing missing, or nothing moved for 15 s, or 60 s)
        const read = () =>
          app.js<{ far: Far; pool: Record<string, number> }>(
            `(async () => { const f = await __bh.renderer.farBuildings(); return { far: f?.layer ?? null, pool: __bh.sys.cells.stats() }; })()`,
          );
        const t0 = Date.now();
        let r = await read(),
          last = JSON.stringify(r.far),
          still = Date.now();
        while (r.far?.missing && Date.now() - t0 < 60_000 && Date.now() - still < 15_000) {
          await Bun.sleep(2_000);
          r = await read();
          const now = JSON.stringify(r.far);
          if (now !== last) (last = now), (still = Date.now());
        }
        const f = r.far;
        const row = {
          point: k + 1,
          waitedS: Math.round((Date.now() - t0) / 1000),
          wanted: f?.wanted,
          missing: f?.missing,
          cells: f?.cells,
          refused: f?.refused,
          freeBlocks: f?.freeBlocks,
          blocks: f?.blocks,
          budgetMiB: f ? Math.round(f.budgetBytes / 2 ** 20) : null,
          records: f?.records,
          poolQueued: r.pool.queued,
          poolBeyond: r.pool.beyond,
          poolFailed: r.pool.failed,
        };
        rows.push(row);
        console.log(`  point ${k + 1}: ${JSON.stringify(row)}`);
        await app.shot(`${OUT}/${TRACK}-point${k + 1}.png`);
      }
      // (the reading: a point still missing with no block free and cells refused — the reserve; with blocks free and nothing refused —
      // the layer still filling or its wanted set moving)
      for (const r of rows)
        console.log(
          `  point ${r.point}: ${
            !r.missing
              ? "all resident"
              : (r.refused as number) > 0 && !(r.freeBlocks as number)
                ? "the reserve refusing"
                : "filling or moving"
          }`,
        );
      expect(rows.length).toBe(track.points.length);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 900_000);
});
