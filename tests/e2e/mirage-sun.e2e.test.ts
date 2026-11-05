import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// R6a-ciel — the mirages drawn (trace.wgsl mirageTrue, airBend, earthNear, shadeWater: a sky pixel looks where its ray truly
// goes; the raster's sea leaves the escaping rays' pixels to the tracer). Off Biarritz, 21 June 2026, the F-35 at 10 m over the
// Atlantic facing the setting Sun, at the minute its centre is ~0.35° under the geometric horizon; the telescope on the Sun
// (its centre where the plain air shows it), a 2° field; frozen, the exposure locked at the plain air's. A shot under
// the layered model's air (renderer.mirageProfile "off"), a warm sea (the Sun's Etruscan vase), an inversion (a duct).
// MS_OUT: the shots (remote-results/mirage-sun).
// Duration: ~3 min on this Mac.
// Done when: the three shots taken, each profile's tables published, no GPU error.
const OUT = process.env.MS_OUT ?? "remote-results/mirage-sun";
afterAll(stopServer);
test.skipIf(!E2E)(
  "R6a-ciel: the setting Sun over a warm sea and an inversion, through the mirages' tables",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", lensFlare: 0, bloom: 0.05 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (the minute the Sun's centre is ~0.35° under the geometric horizon)
      const at = await app.js<{ iso: string; az: number; alt: number }>(`(() => {
        let ms = Date.parse("2026-06-21T19:40:00Z"), best = null;
        __bh.game.flyAt(43.5, -1.75, 10, 300, 100);
        for (let i = 0; i < 60; i++, ms += 60000) {
          __bh.game.setDate(new Date(ms).toISOString());
          const s = __bh.camera.skyInfo().sun;
          if (!best || Math.abs(s.altDeg + 0.35) < Math.abs(best.alt + 0.35)) best = { iso: new Date(ms).toISOString(), az: s.azDeg, alt: s.altDeg };
        }
        return best; })()`);
      console.log(`  the Sun at ${at.alt.toFixed(3)}° true, azimuth ${at.az.toFixed(1)}°, at ${at.iso}`);
      out.sun = at;
      await app.js(
        `(() => { __bh.game.setDate("${at.iso}"); __bh.game.flyAt(43.5, -1.75, 10, ${at.az}, 100); __bh.settings.shipMount = "cockpit"; __bh.settings.target = "sun"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await Bun.sleep(1500);
      // (the telescope on the Sun — its centre where the plain air shows it —, a 2° field)
      if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
      await Bun.sleep(800);
      await app.press("KeyY");
      await app.js(`(__bh.camera.setFov(2), 1)`);
      await app.waitFor(`Math.abs(__bh.settings.fov - 2) < 0.01`, 30_000);
      await app.js(`(() => { __bh.game.setDate("${at.iso}"); __bh.freeze(true); return 1; })()`);
      let locked = false;
      for (const k of ["off", "warmSea", "inversion"] as const) {
        await app.js(`(() => { __bh.renderer.mirageProfile = "${k}"; __bh.touch(); return 1; })()`);
        if (k !== "off") await app.waitFor(`__bh.renderer.mirageNow.startsWith("${k}@")`, 30_000);
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        if (!locked) {
          await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          locked = true;
        }
        await app.shot(`${OUT}/${k}.png`);
        out[k] = await app.js(`__bh.renderer.mirageNow`);
        console.log(`  ${k}: shot (tables ${out[k] || "none"})`);
      }
      await app.js(
        `(() => { __bh.renderer.mirageProfile = "off"; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/mirage.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
