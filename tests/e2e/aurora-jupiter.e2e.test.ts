import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Jupiter's auroras (PLAN-AURORES-MAGNETOSPHERES AM3): the main oval from JRM33 + CON2020 (tabulated about its own centre), the
// polar emissions inside it, Io's footprint and its tail; H-α and H₂'s violet at 245 km over the 1 bar level; then the scene
// "Jupiter: the auroras from its shadow" (the first view as a gallery scene: scene.png, no interface). Seen from Jupiter's
// shadow — the camera at its midnight (sys.subsolar), the eye adapted to the dark —: from 7 000 km over 45° N looking north
// across the oval (activity 5, then 8; Jupiter turned so that the oval's low side faces midnight), from 14 000 km over 50° S
// looking south, from 36 000 km over 30° S (the oval foreshortened at the limb). AJ_OUT.
// Output: remote-results/aurora-jupiter/*.png, stats.json. Done when: the aurora kernel in (featureKey 16384), each view shot,
// the camera in the shadow (renderer eyeIncident < 1e-3), no GPU error. Duration: ~5 min cold (the near-Jupiter kernel's
// compile, ~200 s), ~2 min warm.
const OUT = process.env.AJ_OUT ?? "remote-results/aurora-jupiter";
const RJ = 71_492e3;
afterAll(stopServer);

test.skipIf(!E2E)(
  "Jupiter's auroras from its shadow: the main ovals north and south, Io's footprint",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    const view = async (name: string, act: number, lat: number, lon: number | null, alt: number, heading: number, pitch: number) => {
      const why = await app.js<string | null>(`(() => { Object.assign(__bh.settings, { aurora: ${act}, auroraLive: false });
        const ss = __bh.sys.subsolar("jupiter");
        return __bh.viewAt(${lat}, ${lon ?? "ss[1] + 180"}, { body: "jupiter", altM: ${alt}, heading: ${heading}, pitch: ${pitch}, fov: 70 }); })()`);
      expect(why).toBeNull();
      await app.waitFor(`(__bh.renderer.featureKey & 16384) === 16384`, 60_000);
      // (the near-Jupiter kernel compiles in ~200 s cold on the M1 Max, with or without the auroras — measured 6 Nov 2026: 203 s
      // without, 219 s with —; its progress said every 30 s, 5 min at most)
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 6 === 0) console.log(`    compiling ${k * 5} s: ${JSON.stringify(await app.js(`__bh.renderer.compilingNow`))}`);
        await Bun.sleep(5000);
      }
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 30_000);
      await Bun.sleep(2500);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 90_000);
      await Bun.sleep(3000);
      await app.shot(`${OUT}/${name}.png`);
      stats[name] = await app.js(
        `({ eye: __bh.renderer.eyeIncident, fps: __bh.game.perf({ gpu: true }).renderFps, gpuMs: __bh.game.perf({ gpu: true }).gpuFrameMs })`,
      );
      console.log(`  ${name}: ${JSON.stringify(stats[name])}`);
      expect((stats[name] as { eye: number }).eye).toBeLessThan(1e-3);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      // (the north oval reaches down to 54° N near −165° E — its centre is off the pole towards 180°: Jupiter turned until
      // that longitude faces midnight, 870.5° a day)
      await app.js(`(() => { __bh.game.setDate("2026-12-21T07:00:00Z"); return 1; })()`);
      const ss = await app.js<[number, number]>(`__bh.sys.subsolar("jupiter")`);
      const dLon = ((((-165 - (ss[1] + 180)) % 360) + 540) % 360) - 180;
      const at = new Date(Date.parse("2026-12-21T07:00:00Z") + (-dLon / 870.5) * 86400e3).toISOString();
      await app.js(`(() => { __bh.game.setDate(${JSON.stringify(at)}); return 1; })()`);
      // (7 000 km over 45° N at midnight, in the shadow, looking north: the oval 10–20° of arc ahead; its horizon 25° down)
      await view("north-act5", 5, 45, null, 0.1 * RJ, 0, -22);
      await view("north-act8", 8, 45, null, 0.1 * RJ, 0, -22);
      // (14 000 km over 50° S, looking south: the south oval at ~68° S, 18° ahead; its horizon 34° down)
      await view("south-act5", 5, -50, null, 0.2 * RJ, 180, -30);
      // (from 36 000 km over 30° S: the oval foreshortened at the limb)
      await view("south-far-act5", 5, -30, null, 0.5 * RJ, 180, -55);
      // (the scene that shows them — "Jupiter: the auroras from its shadow", settings.ts —: the first view, its date and place
      // its own; the kernel warm from the views; shot without the interface: the gallery's picture)
      await app.js(`(() => { __bh.game.preset("Jupiter: the auroras from its shadow"); return 1; })()`);
      await app.waitFor(`(__bh.renderer.featureKey & 16384) === 16384`, 60_000);
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) await Bun.sleep(5000);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 30_000);
      await Bun.sleep(5000);
      await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
      await app.shot(`${OUT}/scene.png`);
      await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
      stats.scene = await app.js(
        `({ eye: __bh.renderer.eyeIncident, aurora: __bh.settings.aurora, ship: __bh.settings.ship, date: __bh.game.date?.(), fps: __bh.game.perf({ gpu: true }).renderFps })`,
      );
      console.log(`  scene: ${JSON.stringify(stats.scene)}`);
      expect((stats.scene as { eye: number }).eye).toBeLessThan(1e-3);
      expect((stats.scene as { aurora: number }).aurora).toBe(5);
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  12 * 60_000,
);
