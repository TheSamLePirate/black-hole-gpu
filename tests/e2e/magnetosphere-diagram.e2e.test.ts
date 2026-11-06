import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The magnetospheres' diagram (PLAN-AURORES-MAGNETOSPHERES AM7): the near body's field lines on L-shells traced in its real
// field (AM0), its magnetopause and bow shock about the Sun, drawn as lines in space behind what hides them (chartoverlay.ts's
// depth mode against the traced depth) and its boundaries and belts as glowing layers (overlay.wgsl fsMagVol). The Earth from
// 60 000 km over its dusk side (the setting off, then on) and from 400 000 km (a future date: the typical wind; now: NOAA's real
// one — solar-wind.ts), Jupiter from 1.5 and 18 million km. MD_OUT.
// Output: remote-results/magnetosphere-diagram/*.png, stats.json. Done when: each view shot, the lines' pixels differ from the
// view without them, no GPU error. Duration: ~2 min warm (Jupiter's near kernel: ~200 s cold — docs/PROBLEMES-A-REGLER.md).
const OUT = process.env.MD_OUT ?? "remote-results/magnetosphere-diagram";
afterAll(stopServer);

test.skipIf(!E2E)(
  "the magnetosphere diagram: the Earth's and Jupiter's field lines, magnetopause and bow shock",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    const settle = async () => {
      await Bun.sleep(3000);
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 6 === 0) console.log(`    compiling ${k * 5} s: ${JSON.stringify(await app.js(`__bh.renderer.compilingNow`))}`);
        await Bun.sleep(5000);
      }
      await Bun.sleep(3000);
    };
    const view = async (name: string, on: boolean, body: string, lat: number, dLon: number, altM: number) => {
      const why = await app.js<string | null>(`(() => { __bh.settings.magnetosphere = ${on};
        const ss = __bh.sys.subsolar("${body}");
        return __bh.viewAt(${lat}, ss[1] + ${dLon}, { body: "${body}", altM: ${altM}, heading: 0, pitch: -89, fov: 60 }); })()`);
      expect(why).toBeNull();
      await settle();
      await app.shot(`${OUT}/${name}.png`);
      stats[name] = await app.js(`({ fps: __bh.game.perf({ gpu: true }).renderFps, gpuMs: __bh.game.perf({ gpu: true }).gpuFrameMs })`);
      console.log(`  ${name}: ${JSON.stringify(stats[name])}`);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.game.setDate("2026-12-21T12:00:00Z"); return 1; })()`);
      // (over the dusk side — the Sun 90° to the west —: the dayside's compressed shells on one side, the night's on the other)
      await view("earth-off", false, "earth", 20, 90, 60_000_000);
      await view("earth-on", true, "earth", 20, 90, 60_000_000);
      // (from 400 000 km — 63 radii — over the dusk side: the magnetopause's nose towards the Sun, the shock ahead, the tail)
      await view("earth-far", true, "earth", 20, 90, 400_000_000);
      // (the scene now: the real solar wind — NOAA's, propagated — places the magnetopause and the shock (Shue et al. 1998);
      // the wind's state logged, its figures on the "Solar wind" label)
      await app.js(`(() => { __bh.game.setDate(new Date().toISOString()); return 1; })()`);
      await view("earth-far-live", true, "earth", 20, 90, 400_000_000);
      const wind = await app.js<{ source: string; r0: number } | null>(`__bh.renderer.magnetoWind`);
      console.log(`  wind: ${JSON.stringify(wind)}`);
      stats.wind = wind;
      expect(wind && ["live", "stale", "typical"].includes(wind.source)).toBe(true);
      await app.js(`(() => { __bh.game.setDate("2026-12-21T12:00:00Z"); return 1; })()`);
      await view("jupiter-on", true, "jupiter", 15, 90, 1_500_000_000);
      // (from 18 million km — 250 R_J, outside its bow shock —: Jupiter's magnetopause at 63 R_J, Io's torus)
      await view("jupiter-far", true, "jupiter", 15, 90, 18_000_000_000);
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  12 * 60_000,
);
