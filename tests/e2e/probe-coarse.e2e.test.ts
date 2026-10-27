import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The light probe coarse (docs/PLAN-LEAN-TRACER-KERNELS.md P5: the near ground's sub-pixel detail out of env — NEAR_DETAIL
// off —, the Sun's light on the craft through the sky's part of earthLook alone): the craft's light — the probe's spherical
// harmonics, read back — with the whole probe (renderer.coarseProbe = false) and the coarse one, against the probe's own
// noise between two reads of the whole one. Scenes: the F-35 low over Tarifa (the raster), the Ranger in low orbit, the
// Ranger approaching Gargantua.
// Duration: ~3–6 min on kerr-mini.
// Done when: every scene's three reads are compared.

const SCENES: { name: string; boot: string; set: string }[] = [
  {
    name: "f35-tarifa",
    boot: "scene=game:artemis",
    set: `Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true });
      __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
      __bh.settings.shipMount = "chase"; __bh.game.flyAt(36.08, -5.6, 700, 20, 240); __bh.settings.earthPipeline = "raster";`,
  },
  { name: "ranger-orbit", boot: `scene=${encodeURIComponent("Earth: low orbit over the Amazon")}`, set: "" },
  { name: "ranger-gargantua", boot: `scene=${encodeURIComponent("Ranger: approaching Gargantua")}`, set: "" },
];

describe.skipIf(!E2E)("the coarse light probe lights the craft as the whole one", () => {
  afterAll(() => stopServer());
  for (const sc of SCENES)
    test(sc.name, async () => {
      const app = await App.boot({ width: 960, height: 600, hash: sc.boot, tiles: true });
      try {
        // (the view touched every frame: frames keep coming — a converged still view submits none —, the probe refreshed)
        await app.js(
          `(() => { ${sc.set} __bh.freeze(true); window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`,
        );
        const read = async (coarse: boolean) => {
          await app.js(`(() => { __bh.renderer.coarseProbe = ${coarse}; __bh.renderer.variants.clear(); __bh.touch(); return 1; })()`);
          await app.waitFor("__bh.renderer.variantReady && __bh.renderer.compilesPending === 0", 600_000);
          const w = await app.js<number>("__bh.renderer.completedFrames");
          await app.waitFor(`__bh.renderer.completedFrames >= ${w + 90}`, 180_000);
          return app.js<number[]>(`(async () => {
            const r = __bh.renderer, d = r.device, st = d.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            const e = d.createCommandEncoder(); e.copyBufferToBuffer(r.ship.shBuf, 0, st, 0, 256); d.queue.submit([e.finish()]);
            await st.mapAsync(GPUMapMode.READ); const f = Array.from(new Float32Array(st.getMappedRange().slice(0))); st.unmap(); st.destroy();
            return f.slice(0, 36); })()`);
        };
        const whole = await read(false);
        const coarse = await read(true);
        const whole2 = await read(false);
        // (the harmonics' distance, relative to the light's size: L0's luminance and the whole vector)
        const norm = (a: number[]) => Math.hypot(...a) || 1;
        const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]!)) / Math.max(norm(a), norm(b));
        const noise = dist(whole, whole2);
        const d = Math.min(dist(coarse, whole), dist(coarse, whole2));
        console.log(
          `  ${sc.name}: coarse vs whole ${(100 * d).toFixed(2)} %, whole vs whole ${(100 * noise).toFixed(2)} %, |L| ${norm(whole).toExponential(2)}`,
        );
        expect(norm(whole)).toBeGreaterThan(0);
        // (within the probe's own noise, or a few per cent of the light)
        expect(d).toBeLessThan(Math.max(2 * noise, 0.03));
      } finally {
        app.close();
      }
    }, 1_500_000);
});
