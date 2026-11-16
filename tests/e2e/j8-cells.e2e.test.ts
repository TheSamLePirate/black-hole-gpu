import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { HITCH_PROBE } from "./lib/hitch-probe";

// PLAN-J8 J8-3 — the building cells prepared in the game (src/system/cell-pool.ts, cell-workers.ts, cell-worker.ts — `__bh.sys.cells`):
// the F-35 frozen at J0's start (500 m over the Rade d'Hyères, heading 270°), the z 15 cells within 6 km wanted — in view and near
// first (0), then in view (1), behind (2), the rest (3) —, the workers' preparation (each tile fetched through the Service Worker,
// decoded into 48-byte records, put in the prepared cache); the hitch probe of J7-0 watching the page meanwhile: no image over 100 ms.
// Then the page loaded again (a new pool, the same browser): the same cells all from the prepared cache — no decoding.
// Done when: every cell wanted handed, none over 100 ms of an image while they were prepared, all from the cache after the reload.
// Duration: ~2 min (one boot, one reload; ~150 tiles, most of them the sea's — the IGN's tiles: one heavy load at a time).

const [LAT, LON] = [43.06, 6.32];
const RADIUS_KM = 6;
const HEADING = 270;

/** the cells within RADIUS_KM, their priority and distance — the page's side (building-cells.ts cellOf's arithmetic) */
const WANTS = `(() => {
  const D = Math.PI / 180, n = 2 ** 15, out = [];
  const x0 = Math.floor(((${LON} + 180) / 360) * n), y0 = Math.floor(((1 - Math.asinh(Math.tan(${LAT} * D)) / Math.PI) / 2) * n);
  const span = Math.ceil(${RADIUS_KM} / 0.85) + 1;
  for (let x = x0 - span; x <= x0 + span; x++)
    for (let y = y0 - span; y <= y0 + span; y++) {
      const lon = ((x + 0.5) / n) * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / D;
      const e = (lon - ${LON}) * 111.32 * Math.cos(${LAT} * D), no = (lat - ${LAT}) * 110.574, km = Math.hypot(e, no);
      if (km > ${RADIUS_KM}) continue;
      const brg = ((Math.atan2(e, no) / D) + 360) % 360, off = Math.abs(((brg - ${HEADING} + 540) % 360) - 180);
      const view = off <= 50 || km < 0.6;
      out.push({ x, y, priority: view ? (km < 3 ? 0 : 1) : km < 3 ? 2 : 3, d: Math.round(km * 1000) });
    }
  return out; })()`;

describe.skipIf(!E2E)("PLAN-J8 J8-3: the building cells prepared in the game", () => {
  let app: App;
  let wants: { x: number; y: number; priority: number; d: number }[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const place = () =>
    app.js(
      `(() => { __bh.freeze(true); __bh.game.flyAt(${LAT}, ${LON}, 500, ${HEADING}, 140); __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );

  /** the cells wanted, handed in full: the times, the bytes, the cache's share; the probe's images over 100 ms meanwhile */
  const prepare = async (label: string) => {
    await app.js(HITCH_PROBE);
    const h0 = await app.js<{ over100: number; max: number }>(`({ over100: window.__hitch.over100, max: window.__hitch.max })`);
    await app.js(`(() => { __bh.sys.cells.clear(); window.__hitch.max = 0; return 1; })()`);
    const t0 = Date.now();
    await app.js(`(() => { __bh.sys.cells.want(${JSON.stringify(wants)}); return 1; })()`);
    let last = "";
    for (;;) {
      const s = await app.js<{ got: number; queued: number; running: number; failed: number }>(
        `(() => { const s = __bh.sys.cells.stats(); return { got: __bh.sys.cells.got().length, queued: s.queued, running: s.running, failed: s.failed }; })()`,
      );
      const said = `${s.got}/${wants.length}`;
      if (said !== last) (last = said), console.log(`  … ${label}: ${said} cells after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (s.got + s.failed >= wants.length || (s.queued === 0 && s.running === 0)) break;
      if (Date.now() - t0 > 120_000) throw new Error(`${label}: ${said} cells in 120 s (queued ${s.queued}, running ${s.running})`);
      await Bun.sleep(250);
    }
    const wall = (Date.now() - t0) / 1000;
    const got = await app.js<{ key: string; bytes: number; cached: boolean; ms: number }[]>(`__bh.sys.cells.got()`);
    const stats = await app.js<Record<string, number>>(`__bh.sys.cells.stats()`);
    const h1 = await app.js<{ over100: number; max: number }>(`({ over100: window.__hitch.over100, max: window.__hitch.max })`);
    const ms = got
      .filter((c) => !c.cached)
      .map((c) => c.ms)
      .sort((a, b) => a - b);
    const records = got.reduce((a, c) => a + Math.max(0, (c.bytes - 64) / 48), 0);
    const r = {
      wall,
      cells: got.length,
      cached: got.filter((c) => c.cached).length,
      records,
      bytes: got.reduce((a, c) => a + c.bytes, 0),
      msMedian: ms[ms.length >> 1] ?? 0,
      msWorst: ms.at(-1) ?? 0,
      over100: h1.over100 - h0.over100,
      maxGap: Math.round(h1.max),
      stats,
    };
    console.log(`  ${label}: ${JSON.stringify(r)}`);
    return r;
  };

  test("at J0's start: the cells within 6 km, prepared by the workers, no image over 100 ms", async () => {
    await app.scenario("J0 start · the cells prepared (cold)");
    await place();
    await app.settled(90_000).catch(() => {});
    wants = await app.js(WANTS);
    console.log(
      `  ${wants.length} cells wanted: ${[0, 1, 2, 3].map((p) => `${p}:${wants.filter((w) => w.priority === p).length}`).join(" ")}`,
    );
    const r = await prepare("cold");
    expect(r.cells).toBe(wants.length);
    expect(r.stats.failed).toBe(0);
    expect(r.over100).toBe(0);
  }, 300_000);

  test("the page loaded again: the same cells all from the prepared cache, no decoding", async () => {
    await app.scenario("J0 start · the cells again after a reload (warm)");
    await app.load("scene=game:artemis");
    await app.js(`(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false }); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await place();
    await app.settled(90_000).catch(() => {});
    const r = await prepare("warm");
    expect(r.cells).toBe(wants.length);
    expect(r.cached).toBe(wants.length);
    expect(r.over100).toBe(0);
  }, 300_000);
});
