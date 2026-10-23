import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The far silhouettes' cost where the far ground is most of the view (docs/ANALYSE-IGN-LIDAR.md I6): low over the Marne's
// valley 20 km east of the Tour Montparnasse, heading west over the woods of the Île-de-France — where the overground once
// cost the raster's shading 12 ms (+10 %): the surface cache's 9.5 and 38 m rings read, at their nodes' footprint, the far
// levels and their overground, where the pixels see the bare ground of the windows z 14 and finer — the hint a forest's
// height over the ground drawn, its bracket missed, the whole march redone. Now baked over the survey on the tiles as the
// pixels read them (terrain-cache.ts SURVEY_RES): +0.2 / +1.2 ms. The GPU's passes with the silhouettes and without, on / off / on / off — their medians, at
// one pixel in two and in four shaded —, the same pixels, in the cockpit, held, in the raster pipeline; a held view of each.
// (E2E_SHOTS=<dir>: hlod-marne-on / -off.)
// Duration: ~12 min on kerr-mini.
// Done when: the earth's passes with the silhouettes within 5 % of without, at both rates.

const D = Math.PI / 180;
// (the eye: 20 km from the Tour Montparnasse on a bearing of 90°, heading 270° back at it, 80 m over the ground)
const EYE = { lat: 48.8421, lon: 2.3219 + (20 / (111.2 * Math.cos(48.8421 * D))) * Math.sin(90 * D) };

describe.skipIf(!E2E)("the far silhouettes' cost", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, earthIgnSilhouettes: true, f35AutoProtect: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const loaded = (what: string) =>
    app
      .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.pending === 0 && t.orthoPending === 0; })()`, 180_000)
      .catch(async () =>
        console.log(
          `  (${what}: still loading after 180 s — ${await app.js<string>(`JSON.stringify({ tiles: __bh.renderer.earthTiles.pending, ortho: __bh.renderer.earthTiles.orthoPending })`)})`,
        ),
      );
  // (the GPU's passes over 40 frames drawn, the view held and the pixels pinned: the scale, the shading's rate; the surface
  // cache baked again first — its rings on the tiles now in)
  const PINNED = `{ dynamicResolution: false, earthRasterShading: "half", earthRasterScale: 0.75, motionBlur: 0.5 }`;
  const passes = async (what: string, rate: "half" | "quarter") => {
    await app.js(
      `(() => { Object.assign(__bh.settings, ${PINNED}, { earthRasterShading: "${rate}" }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    const r = await app.js<{ n: number; trace: number; shade: number; vis: number; pipe: string }>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      for (let i = 0; i < 20; i++) await frame();
      r.prof.reset();
      let done = 0, last = r.lastDoneAt, n = 0; const runs = { trace: [], shade: [], vis: [] };
      while (done < 40) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++;
        const tb = r.prof.table(), get = (l) => tb.find((p) => p.label === l)?.last ?? 0;
        if (!tb.length) continue;
        n++; runs.trace.push(get("trace")); runs.shade.push(get("earth shade (raster)")); runs.vis.push(get("terrain raster visibility")); } }
      const med = (v) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : 0);
      return { n, trace: med(runs.trace), shade: med(runs.shade), vis: med(runs.vis), pipe: r.earthPipelineNow(__bh.settings) };
    })()`);
    console.log(
      `  ${what} (${rate}): trace ${r.trace.toFixed(2)} ms, raster shading ${r.shade.toFixed(2)} ms, visibility ${r.vis.toFixed(2)} ms (${r.n} frames, ${r.pipe})`,
    );
    expect(r.pipe).toBe("raster");
    expect(r.n).toBeGreaterThanOrEqual(20);
    return r;
  };
  const both = async (what: string) => [await passes(what, "half"), await passes(what, "quarter")];
  const shot = async (name: string) => {
    if (!shots) return;
    await app.js(
      `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
    );
    await app.settled();
    await Bun.sleep(3000);
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/hlod-marne-${name}.png`);
    await app.js(`(() => { Object.assign(__bh.settings, ${PINNED}); return 1; })()`);
  };
  const toggle = async (on: boolean) => {
    await app.js(`(() => { __bh.settings.earthIgnSilhouettes = ${on}; return 1; })()`);
    await Bun.sleep(1500);
    await loaded(on ? "with the silhouettes" : "without");
  };

  test("low over the Marne, the woods to the horizon: the silhouettes' cost within 5 %", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    await app.js(`(() => { __bh.game.flyAt(${EYE.lat}, ${EYE.lon}, 80, 270, 120); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(__bh.freeze(true), 1)`);
    await loaded("with the silhouettes");
    // (level, the horizon in the view: no fly-up — the Auto-GCAS off)
    const pitch = await app.js<number>(`((__bh.camera.attitudeNow().pitch ?? 0) * 180) / Math.PI`);
    console.log(
      `  view: ${await app.js<string>(`__bh.settings.shipMount`)} at ${EYE.lat.toFixed(4)}, ${EYE.lon.toFixed(4)}, pitch ${pitch.toFixed(1)}°`,
    );
    expect(Math.abs(pitch)).toBeLessThan(10);
    const a = await both("with the silhouettes");
    await shot("on");
    await toggle(false);
    const b = await both("without");
    await shot("off");
    await toggle(true);
    const c = await both("with them again");
    await toggle(false);
    const d = await both("without again");
    await app.js(`(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true }); return 1; })()`);
    type Passes = Awaited<ReturnType<typeof passes>>;
    const earth = (r: Passes) => r.trace + r.shade + r.vis;
    for (const k of [0, 1]) {
      const on = (earth(a[k]!) + earth(c[k]!)) / 2,
        off = (earth(b[k]!) + earth(d[k]!)) / 2;
      console.log(
        `  the silhouettes' cost at ${k ? "one in four" : "one in two"}: ${(on - off).toFixed(2)} ms on the earth's passes, ${((100 * (on - off)) / off).toFixed(1)} % (on ${earth(a[k]!).toFixed(2)} / ${earth(c[k]!).toFixed(2)}, off ${earth(b[k]!).toFixed(2)} / ${earth(d[k]!).toFixed(2)})`,
      );
      expect(on - off).toBeLessThan(0.05 * off);
    }
    expect(app.cdp.errors).toEqual([]);
  }, 900_000);
});
