import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { placeLow } from "./lib/place";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q3 B4 — the map's roads on the raster's ground (Q6l: in La Mancha the traced ground showed a road the raster's did not — the
// traced ground paints OpenStreetMap's surfaces over the imagery where no national photograph is, earthGround; shadeLite now the
// same, sceneryGround, liteSkip 134217728 off): La Mancha at noon, the F-35 placed level at 40 m heading east (as ghost's mancha),
// the scenery in; shots with the roads off, on, off (the drift both sides), and the GPU's passes over 3 s in each (the shading
// passes' cost: the surfaces' walk now on every ground pixel, not the night's alone).
// RR_AT=lat,lon,height,heading: another place. Output: remote-results/raster-roads/{off,on,off2}.png, roads.json (RR_OUT).
// Done when: the three shots and their passes' times taken, no GPU error (their texts said). Duration: ~3 min.
const OUT = process.env.RR_OUT ?? "remote-results/raster-roads";
afterAll(stopServer);

test.skipIf(!E2E)(
  "Q3 B4: OpenStreetMap's roads on the raster's ground, and their cost",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.setDate("2026-07-10T11:30:00Z"); __bh.game.set("weather", "fair"); document.body.classList.add("hide-ui"); return 1; })()`,
      );
      // (RR_AT: another place — lat,lon,height,heading —, e.g. Paris under the IGN's photograph)
      const at = (process.env.RR_AT ?? "39.42,-3.05,40,90").split(",").map(Number) as [number, number, number, number];
      out.placed = await placeLow(app, [at[0], at[1], at[2], at[3], 140], -8);
      out.world = await app
        .waitFor(
          `(() => { const r = __bh.renderer, sc = r.earthScenery.stats(); return r.earthTiles.pending === 0 && r.earthTiles.orthoPending === 0 && sc.status === "ready" && !sc.pending; })()`,
          60_000,
        )
        .then(
          () => "all in",
          () => "not all in after 60 s",
        );
      await app.settled(60_000);
      await app.exposureSettled();
      await app.js(
        `(() => { const r = __bh.renderer; window.__ev = r.autoExposureEV; const f = () => { if (window.__ev == null) return; r.autoExposureEV = window.__ev; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`,
      );
      for (const [tag, skip] of [
        ["off", 134217728],
        ["on", 0],
        ["off2", 134217728],
      ] as const) {
        await app.js(`(() => { __bh.renderer.liteSkip = ${skip}; __bh.touch(); return 1; })()`);
        await app.js(
          `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 60) requestAnimationFrame(f); else q(1); }; f(); })`,
        );
        await app.shot(`${OUT}/${tag}.png`);
        out[tag] = await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
          const rows = r.prof.table().filter((p) => /shade|lite|water/i.test(p.label)).map((p) => [p.label, +(p.ms ?? p.mean ?? 0).toFixed(3)]);
          const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false; return { total, rows }; })()`);
        console.log(`  ${tag}: ${JSON.stringify(out[tag])}`);
      }
      await app.js(`(() => { window.__ev = null; __bh.renderer.liteSkip = 0; return 1; })()`);
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.scenery = await app.js<unknown>(
        `(() => { const s = __bh.renderer.earthScenery.stats(); return { status: s.status, pending: s.pending, error: s.error ?? s.errors?.[0] ?? null, bytes: s.bytes }; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/roads.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
