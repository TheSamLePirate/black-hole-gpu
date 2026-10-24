import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The buildings (docs/PLAN-BATIMENTS-AAA.md): three towns held in the raster pipeline, the F-35 over each — Paris's
// Haussmann blocks round the Étoile (the BD TOPO: eaves, zinc, party walls), Saint-Lô's reconstruction (the BD TOPO's
// ridges, slate and concrete), Munich's old town (OpenStreetMap alone) —; for each, the scene's buildings counted, the
// view from the chase camera above the roofs and a lower one, and the kernel shade's GPU time on the held view
// (the clock stopped, the view marked changed every frame: the same rays each frame — raster-shade-ablation's way).
//   BLD_SITES=paris,stlo,munich (default all), BLD_MEASURE=0 to skip the timing, BLD_NIGHT=1 the low view at night too.
// E2E_SHOTS=<dir>: buildings-<site>-high.png / -low.png; remote-results/buildings-<label>.json (BLD_LABEL, default "run" —
// under scripts/ab-e2e.ts the side and the run, A1, B2…).
// Duration: ~3 min a site on kerr-mini.
// Done when: each town's scene ready with its buildings, both views drawn in the raster pipeline, no error.

const SITES: Record<string, { lat: number; lon: number; heading: number; name: string }> = {
  // (south-east of the Étoile, heading for it over the 8th's blocks)
  paris: { lat: 48.8695, lon: 2.3045, heading: 300, name: "Paris, l'Étoile" },
  // (south-east of the old town on its rock, over the 1950s' rebuilt blocks)
  stlo: { lat: 49.1115, lon: -1.0835, heading: 310, name: "Saint-Lô" },
  // (south-east of the Marienplatz)
  munich: { lat: 48.1325, lon: 11.5835, heading: 315, name: "Munich, Altstadt" },
};
const CHOSEN = (process.env.BLD_SITES ?? "paris,stlo,munich").split(",").filter((s) => SITES[s]);
const LABEL = process.env.BLD_LABEL ?? (process.env.AB_SIDE ? `${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "run");

describe.skipIf(!E2E)("the buildings", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const rows: Record<string, unknown>[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, f35AutoProtect: false, f35Invulnerable: true,
        weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true,
        earthScenery: "high", earthSceneryShadows: true }); __bh.renderer.variantCacheMax = 64; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (a summer morning: the Sun from the south-east, the roofs' slopes lit unequally)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T08:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
  }, 300_000);
  afterAll(async () => {
    if (rows.length) await Bun.write(`remote-results/buildings-${LABEL}.json`, JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  const loaded = `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats();
    return t.pending === 0 && t.orthoPending === 0 && !s.pending && s.status === "ready" && s.buildings > 0; })()`;
  const state = () =>
    app.js<string>(
      `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return JSON.stringify({ tiles: t.pending, ortho: t.orthoPending, scenery: s.status, pending: s.pending, buildings: s.buildings, error: s.lastError }); })()`,
    );
  // (the craft placed `back` metres short of the site, `alt` over the ground, frozen there: the tiles and the scene stream in)
  const arrive = async (site: (typeof SITES)[string], back: number, alt: number) => {
    const h = (site.heading * Math.PI) / 180;
    const lat = site.lat - (Math.cos(h) * back) / 111320,
      lon = site.lon - (Math.sin(h) * back) / (111320 * Math.cos((site.lat * Math.PI) / 180));
    await app.js(
      `(() => { __bh.freeze(false); __bh.game.flyAt(${lat}, ${lon}, ${alt}, ${site.heading}, 140); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await app.waitFor(loaded, 180_000).catch(async () => console.log(`  (still loading after 180 s — ${await state()})`));
  };
  // (the held view, every pixel shaded at the full scale — the raster armed again: a small GPU's governor may give it up)
  const hold = async () => {
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
    expect(pipe).toBe("raster");
  };
  // (the kernel shade's GPU time on the held view: 40 frames after 30 to settle, the view touched every frame)
  const shadeMs = () =>
    app.js<number | string>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      // (the realtime frames, never accumulated: a held view otherwise refines in the tracer, not in shade)
      // (raster-shade-ablation's way: the clock stopped rather than the view frozen — a frozen view refines in the tracer)
      const spp = __bh.settings.targetSpp; __bh.settings.targetSpp = 0; __bh.game.quality("realtime"); __bh.freeze(false); __bh.settings.animate = false; r.rasterFellBack = false;
      window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      for (let i = 0; i < 30; i++) { await frame(); r.rasterFellBack = false; }
      r.prof.reset(); let done = 0, last = r.lastDoneAt, sum = 0, n = 0;
      while (done < 40) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++;
        const s = r.prof.table().find((p) => p.label === "earth shade (raster)"); if (s) { sum += s.last; n++; } } }
      window.__t = false; __bh.settings.targetSpp = spp; __bh.settings.animate = true; __bh.freeze(true);
      return n >= 30 ? +(sum / n).toFixed(2) : JSON.stringify({ done, n, fellBack: r.rasterFellBack, pipe: r.earthPipelineNow(__bh.settings), supported: r.prof.supported, labels: r.prof.table().map((p) => p.label) }); })()`);

  for (const key of CHOSEN) {
    test(`${SITES[key]!.name}: the scene's buildings, seen from above the roofs and lower`, async () => {
      const site = SITES[key]!;
      await arrive(site, 700, 260);
      const stats = await app.js<Record<string, unknown>>(`(() => { const s = __bh.renderer.earthScenery.stats();
          return { buildings: s.buildings, bdtopo: s.bdtopoBuildings, vertices: s.vertices, gpuBytes: s.gpuBytes, workerMs: s.workerMs, roofs: s.roofShapes, meshed: s.meshedBuildings, lidarRoofs: s.lidarRoofs, meshBytes: s.meshBytes, bytes: s.bytes, limited: s.budgetLimited, error: s.lastError ?? null }; })()`);
      console.log(`  ${site.name}: ${JSON.stringify(stats)}`);
      expect(stats.buildings as number).toBeGreaterThan(500);
      // (the chase camera looking down on the roofs ahead)
      await app.js(`(__bh.camera.setLook(0, -22), 1)`);
      await hold();
      if (shots) {
        await Bun.$`mkdir -p ${shots}`;
        await app.shot(`${shots}/buildings-${key}-high.png`);
      }
      const high = process.env.BLD_MEASURE === "0" ? null : await shadeMs();
      // (lower and nearer: the walls, the eaves, the gables)
      await arrive(site, 320, 90);
      await app.js(`(__bh.camera.setLook(0, -12), 1)`);
      await hold();
      if (shots) await app.shot(`${shots}/buildings-${key}-low.png`);
      if (shots && process.env.BLD_NIGHT === "1") {
        // (the same view at night: the windows lit; then the morning again — the date set alone, its tick apart)
        await app.js(`(() => { __bh.game.setDate("2026-07-10T21:45:00Z"); return 1; })()`);
        await Bun.sleep(1500);
        await hold();
        await app.shot(`${shots}/buildings-${key}-night.png`);
        await app.js(`(() => { __bh.game.setDate("2026-07-10T08:30:00Z"); return 1; })()`);
        await Bun.sleep(1500);
        await hold();
      }
      const low = process.env.BLD_MEASURE === "0" ? null : await shadeMs();
      console.log(`  ${site.name}: shade ${high} ms high, ${low} ms low`);
      rows.push({ site: key, ...stats, shadeHigh: high, shadeLow: low });
      await app.js(
        `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); __bh.camera.setLook(0, 0); return 1; })()`,
      );
      expect(app.cdp.errors).toEqual([]);
    }, 600_000);
  }
});
