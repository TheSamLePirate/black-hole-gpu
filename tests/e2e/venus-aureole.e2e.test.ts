import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// R5 — Venus's own air bending its limb seen from afar (system/refraction-planets.ts; trace.wgsl planetBend; renderer.prefrOn):
// the free camera 600 000 km from Venus (within 300 of its radii: the near body — farther, the Sun's ratio wins), nearly behind it
// from the Sun (the preset's pose, VA_PHASE 179.25°: the Sun 0.75° off its centre, its edge behind the limb — a transit's
// geometry, the light bent by a few ′ in the transparent air over the clouds: the aureole), a 2.4° field, the Sun partly hidden.
// Shots with the bending, without, with again, the exposure locked at the first; the light in a ring just outside the disc
// (1.0–1.12 of its radius) and the sky further out (1.6–2.0) in each, and the bent shots' difference from the straight one there.
// VA_OUT: the shots (remote-results/venus-aureole); VA_KM the distance [km]; VA_PHASE.
// Duration: ~3 min on this Mac.
// Done when: both shots taken, the ring's light against the sky's logged for each, no GPU error.
const OUT = process.env.VA_OUT ?? "remote-results/venus-aureole";
const KM = Number(process.env.VA_KM ?? 6e5);
// (the camera's phase about Venus from the Sun [°]: 180 the antisolar axis; 179.25 the Sun 0.75° off Venus's centre — its edge
// just behind the limb, as in a transit: the bending of the transparent air over the clouds, a few ′, enough)
const PHASE = Number(process.env.VA_PHASE ?? 179.25);
const FOV = 2.4;
afterAll(stopServer);
test.skipIf(!E2E)(
  "R5: the Sun's light bent round Venus's limb, seen from behind it",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: `scene=${encodeURIComponent("Venus: above the clouds")}` });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.presets.va = { ...__bh.presets["Venus: above the clouds"], fov: ${FOV}, ship: false, pose: { body: "venus", altKm: ${KM}, phase: ${PHASE}, look: "venus" } }; __bh.game.preset("va"); Object.assign(__bh.settings, { animate: false, refraction: true, bloom: 0, lensFlare: 0, dof: false, motionBlur: 0, dynamicResolution: false, lookProfile: "neutral" }); document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.waitFor(`(__bh.touch(), __bh.renderer.prefrNow === "venus")`, 60_000);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await app.settled(180_000);
      await frames(120);
      let locked = false;
      for (const [k, on] of [
        ["bent", true],
        ["straight", false],
        ["bent2", true],
      ] as const) {
        await app.js(`(() => { __bh.renderer.prefrOn = ${on}; __bh.touch(); return 1; })()`);
        await app.waitFor(
          on ? `(__bh.touch(), __bh.renderer.prefrNow === "venus")` : `(__bh.touch(), __bh.renderer.prefrNow === "")`,
          30_000,
        );
        // (VA_BOOST: the bending multiplied — the table's second vec4's w — a probe that the path runs)
        if (on && process.env.VA_BOOST)
          await app.js(
            `(() => { const r = __bh.renderer; r.device.queue.writeBuffer(r.bodyBuf, (2639557 + 1) * 16, new Float32Array([-0.004, 0.009, 512, ${Number(process.env.VA_BOOST)}])); __bh.touch(); return 1; })()`,
          );
        await app.settled(120_000);
        await frames(90);
        if (!locked) {
          await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
          await frames(30);
          locked = true;
        }
        const file = `${OUT}/${k}.png`;
        await app.shot(file);
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        const { width: W, height: H, channels: C, data } = img;
        // (the disc's radius in pixels: its angular radius over the vertical field)
        const rDisc = (Math.asin(6051.8 / (6051.8 + KM)) / ((FOV * Math.PI) / 180)) * H;
        const ring = (a: number, b: number) => {
          let s = 0;
          let n = 0;
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
              const r = Math.hypot(x - W / 2, y - H / 2) / rDisc;
              if (r < a || r >= b) continue;
              const o = (y * W + x) * C;
              s += (0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!) / 255;
              n++;
            }
          return s / Math.max(n, 1);
        };
        const m = {
          rDisc: +rDisc.toFixed(1),
          disc: +ring(0, 0.9).toFixed(4),
          ring: +ring(1.0, 1.12).toFixed(4),
          sky: +ring(1.6, 2.0).toFixed(4),
        };
        out[k] = m;
        console.log(`  ${k}: the disc ${m.disc}, the ring at its limb ${m.ring}, the sky beyond ${m.sky} (disc radius ${m.rDisc} px)`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      await app.js(`(() => { __bh.renderer.prefrOn = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
    } finally {
      await Bun.write(`${OUT}/aureole.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
