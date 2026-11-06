import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// New York's skyline at sunset, from the water (Sam, 6 Nov 2026: « une vue paysage de New York City skyline avec le coucher de
// soleil, l'océan. Stunning view »): the camera alone, no craft — over the Upper Bay facing Lower Manhattan lit by the setting
// Sun, over the East River with the Sun going down behind the towers, high over the harbour towards the Narrows and the ocean —
// with the USA's data (Mapterhorn's 3DEP relief, the National Map's imagery), Overture's and OSM's buildings, the detail's reach
// at its farthest; the world in (60 s at most, what is missing said), frozen at the instant, the exposure settled.
//   NYC_ONLY: the views whose name holds it; NYC_NIGHT=1: the same views at night (20:30 in New York, the Sun 30° down — the
//   city's lights, Sam: « fais la même de nuit »), named <view>-night; NYC_REFS=1: the two photographs' views instead
//   (docs/progress/usa/refs, Sam: « trouve une image référence »); NYC_CITY=paris: Paris at night (three views); NYC_SKIP=bit,…: each view again with that renderer.liteSkip.
// Output: remote-results/nyc-sunset/<view>.png, views.json.
// Done when: each view shot with the scenery ready and the source "usa", no console error.
// Duration: ~1 min a view here.
const OUT = process.env.NYC_OUT ?? "remote-results/nyc-sunset";
afterAll(stopServer);

const D = Math.PI / 180;
const bearing = (a: number, b: number, c: number, d: number) => {
  const y = Math.sin((d - b) * D) * Math.cos(c * D);
  const x = Math.cos(a * D) * Math.sin(c * D) - Math.sin(a * D) * Math.cos(c * D) * Math.cos((d - b) * D);
  return (Math.atan2(y, x) / D + 360) % 360;
};
// (One World Trade Center: the skyline's aim)
const WTC = [40.7127, -74.0134] as const;
// (the Sun 2–4° over the horizon on 6 Nov — sunset at 21:47 UTC —, in the south-west: the towers' faces lit gold from the bay, the
// East River's view into it)
const VIEWS = [
  { name: "bay", lat: 40.6905, lon: -74.0335, over: 70, pitch: 4, fov: 42, utc: "2026-11-06T21:32:00Z" },
  { name: "east-river", lat: 40.7205, lon: -73.9705, over: 45, pitch: 3, fov: 40, utc: "2026-11-06T21:38:00Z", aimDelta: -6 },
  { name: "harbour-high", lat: 40.6745, lon: -74.0525, over: 380, pitch: -7, fov: 55, utc: "2026-11-06T21:30:00Z", aimDelta: 8 },
];
// (NYC_CITY=paris: Paris at night instead — 7 Nov 2026 19:30 UTC, 20:30 in Paris, the Sun 25° down —, each view aimed at its
// landmark: from the Seine by the Pont Alexandre III towards the Eiffel Tower, over the Trocadéro, high over the Seine east of
// the Île de la Cité towards Notre-Dame and the Louvre — Sam: « fais une vue de nuit Paris »)
const PARIS = [
  { name: "paris-seine", lat: 48.8636, lon: 2.3135, over: 12, pitch: 4, fov: 42, utc: "2026-11-07T19:30:00Z", aim: [48.8584, 2.2945] },
  { name: "paris-trocadero", lat: 48.8625, lon: 2.2868, over: 60, pitch: -3, fov: 50, utc: "2026-11-07T19:30:00Z", aim: [48.8584, 2.2945] },
  { name: "paris-cite", lat: 48.8488, lon: 2.3655, over: 220, pitch: -9, fov: 52, utc: "2026-11-07T19:30:00Z", aim: [48.853, 2.3499] },
];
// (NYC_REFS=1: the two photographs of reference — docs/progress/usa/refs — their places, hours and fields, from the water)
const REFS = [
  // (aboard the East River Ferry by Wallabout Bay, 4 Sep 2020 19:31 EDT — its EXIF: an iPhone 6s Plus at 29 mm equivalent, 63.7°
  // across; its GPS 40.70772, −73.97658, a ferry's deck ~4 m up —: the Brooklyn Bridge's middle at x 0.28 sets its bearing,
  // 278°; its horizon at mid-height)
  { name: "ref-sunset", lat: 40.70772, lon: -73.97658, over: 4, pitch: -1.3, hfov: 63.7, hdg: 278.3, utc: "2020-09-04T23:31:19Z" },
  // (Brooklyn, 27 May 2016 22:10:51 EDT — its EXIF: a Canon EOS Rebel T6i at 18 mm, APS-C, 63.6° across, 20 s at f/22; no GPS —:
  // placed from the photograph — the Battery's towers at x 0.13, One World Trade Center's spire at x 0.69, 38° apart at that
  // field: Brooklyn Bridge Park's Pier 1, facing 298°; the far shore's waterline 17 % under the middle: pitched 7.8° up)
  { name: "ref-night", lat: 40.702, lon: -73.9985, over: 3, pitch: 7.8, hfov: 63.6, hdg: 297.9, utc: "2016-05-28T02:10:51Z" },
] as { name: string; lat: number; lon: number; over: number; pitch: number; hfov: number; hdg: number; utc: string }[];

test.skipIf(!E2E)(
  "New York's skyline at sunset from the water",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, ${EARTH_SETTINGS}, { ship: false, earthClouds: 0.35, motionBlur: 0, dof: false, detailReach: "veryFar", earthScenery: "high", earthOrtho: true, earthIgnRelief: true, earthOverture: true }); __bh.renderer.debugSkipShip = true; return 1; })()`,
      );
      await app.settled(120_000);
      const night = !!process.env.NYC_NIGHT;
      const paris = process.env.NYC_CITY === "paris";
      const views = (paris ? PARIS : process.env.NYC_REFS ? REFS : VIEWS).map((v) =>
        night && !paris ? { ...v, name: `${v.name}-night`, utc: "2026-11-07T01:30:00Z" } : v,
      );
      for (const v of views.filter((q) => !process.env.NYC_ONLY || q.name.includes(process.env.NYC_ONLY))) {
        const r = v as Partial<(typeof REFS)[number]> & (typeof VIEWS)[number];
        const aim = (v as { aim?: number[] }).aim ?? WTC;
        const heading = r.hdg ?? bearing(v.lat, v.lon, aim[0]!, aim[1]!) + (r.aimDelta ?? 0);
        // (a photograph's field across → ours up, the window 1600 × 900)
        const fov = r.hfov ? (2 * Math.atan(Math.tan((r.hfov * D) / 2) * (900 / 1600))) / D : r.fov;
        await app.js(
          `(() => { __bh.freeze(true); __bh.game.setDate(${JSON.stringify(v.utc)}); __bh.game.set("weather", "fair"); document.body.classList.add("hide-ui"); __bh.settings.ship = false; __bh.renderer.debugSkipShip = true; return 1; })()`,
        );
        // (over the ground or the water under it — the ellipsoid's heights: the ground's, or the sea's at the geoid, the higher —:
        // the Seine runs 26 m over the sea in Paris, the Trocadéro stands at 60 m; read again once the fine relief is in)
        const place = () =>
          app.js<string | null>(
            `(() => { const S = __bh.sys, g = Math.max(S.groundAt(${v.lat}, ${v.lon}), S.geoid(${v.lat}, ${v.lon})); const why = __bh.viewAt(${v.lat}, ${v.lon}, { altM: g + ${v.over}, heading: ${heading.toFixed(2)}, pitch: ${v.pitch}, fov: ${fov.toFixed(2)} }); __bh.settings.fov = ${fov.toFixed(2)}; __bh.touch(); return why; })()`,
          );
        const waitWorld = () =>
          app.js<string>(`(async () => { const r = __bh.renderer, t0 = performance.now(), frame = () => new Promise((q) => requestAnimationFrame(q));
          const missing = () => { const sc = r.earthScenery.stats(), m = [];
            if (r.earthTiles.pending) m.push(r.earthTiles.pending + " relief tiles"); if (r.earthTiles.orthoPending) m.push(r.earthTiles.orthoPending + " imagery tiles");
            if (sc.status !== "ready" || sc.pending) m.push("scenery " + sc.status); return m; };
          while (performance.now() - t0 < 60000 && missing().length) { __bh.touch(); await frame(); }
          const m = missing(); return m.length ? "missing after 60 s: " + m.join(", ") : "all in"; })()`);
        const why = await place();
        await waitWorld();
        await place();
        const world = await waitWorld();
        await app.js(
          `(() => { __bh.freeze(true); __bh.game.setDate(${JSON.stringify(v.utc)}); Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1 }); __bh.touch(); return 1; })()`,
        );
        await app.settled(60_000);
        await app.exposureSettled();
        await app.js(
          `(() => { for (const s of ["[data-testid=jetmap]", "#overlay"]) { const e = document.querySelector(s); if (e) e.style.visibility = "hidden"; } return 1; })()`,
        );
        await app.js(
          `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
        );
        await app.shot(`${OUT}/${v.name}.png`);
        // (NYC_SKIP=bit,bit…: the same view with each of those parts of the raster's shading cut — renderer.liteSkip —, to find
        // what draws a defect)
        // (NYC_SET=<json>: the same view again with those settings — a comparison)
        if (process.env.NYC_SET) {
          await app.js(`(() => { Object.assign(__bh.settings, ${process.env.NYC_SET}); __bh.touch(); return 1; })()`);
          await app.settled(60_000);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${v.name}-set.png`);
        }
        for (const bit of (process.env.NYC_SKIP ?? "").split(",").filter(Boolean)) {
          await app.js(`(() => { __bh.renderer.liteSkip = ${bit}; __bh.touch(); return 1; })()`);
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 40) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${v.name}-skip${bit}.png`);
          await app.js(`(() => { __bh.renderer.liteSkip = 0; return 1; })()`);
        }
        const info = await app.js<Record<string, unknown>>(`(() => { const sc = __bh.renderer.earthScenery.stats();
          return { national: __bh.renderer.earthTiles.nationalAt, ortho: __bh.renderer.earthTiles.orthoFinest, scenery: sc.status, buildings: sc.buildings ?? null, pipeline: __bh.renderer.earthPipelineNow(__bh.settings) }; })()`);
        out[v.name] = { heading: +heading.toFixed(1), why, world, ...info };
        console.log(`  ${v.name}: heading ${heading.toFixed(1)}°, ${world}, ${JSON.stringify(info)}`);
        expect(why).toBeNull();
        expect(info.national).toBe(paris ? "ign" : "usa");
      }
      await Bun.write(`${OUT}/views.json`, JSON.stringify(out, null, 1));
      expect(app.cdp.errors).toEqual([]);
    } finally {
      await app.close();
    }
  },
  10 * 60_000,
);
