import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

// The source specialisation changes no pixel (docs/PLAN-LEAN-TRACER-KERNELS.md P1b): each scene rendered offline — the same
// samples, the same seeds — by a page whose tracer pipelines come from the whole module (globalThis.__kernelSpecialise =
// false) and by one whose come from modules specialised as source (the default), the two images compared. The Metal
// compiler may round a few results differently on code it optimises differently: a pixel or two off by a level or so, not
// more.
// Duration: ~1–2 min a scene on kerr-mini
// Done when: every scene's two renders are compared.

const SCENES = (
  process.env.SCENES ??
  "Kerr a=0.94, near edge-on|Interstellar: wormhole to Gargantua|Wormhole: strong lensing (W = 0.43 ρ)|Moon: an afternoon on the plains|Earth: full Moon rising over the Andes|Saturn: backlit"
).split("|");
const OPTIONS = `{ width: 192, height: 120, spp: 4, tolerance: 1e-3, eps: 0.1, maxSteps: 4000, noiseThreshold: 0, minSpp: 4, shutter: 0, budgetMs: 40 }`;

/** the scene rendered offline at the clock T, its tracer's pipelines from the whole module or specialised as source (the
 *  page's compiled variants dropped first: each render compiles its own) */
async function render(app: App, T: number, specialise: boolean) {
  // (the scene's own refining kernel compiled for this render, and drawing it — not the general one, which may be in: the
  // offline pass takes the key's kernel first)
  await app.js(`(async () => {
    const r = __bh.renderer;
    r.sourceSpecialise = ${specialise};
    r.variants.clear();
    const k = r.featureKey;
    const t0 = performance.now();
    while (!r.variants.get(k)?.q && performance.now() - t0 < 240000) {
      r.traceVariant("q", k);
      await new Promise((q) => setTimeout(q, 200));
    }
    if (!r.variants.get(k)?.q) throw new Error("the scene's refining kernel did not compile");
    r.startOffline(__bh.settings, ${T}, ${OPTIONS});
    return 1;
  })()`);
  await app.waitFor("__bh.renderer.offlineState?.done || __bh.renderer.offlineState?.error", 600_000);
  const err = await app.js<string | null>("__bh.renderer.offlineState.error ?? null");
  if (err) throw new Error(err);
  const b64 = await app.js<string>(`(async () => {
    const blob = await __bh.renderer.exportPNG(__bh.settings);
    const u = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
    return btoa(s);
  })()`);
  return readPng(new Uint8Array(Buffer.from(b64, "base64")));
}

describe.skipIf(!E2E)("the tracer's pipelines specialised as source draw the same image", () => {
  afterAll(() => stopServer());
  for (const scene of SCENES)
    test(scene, async () => {
      const app = await App.boot({ hash: `scene=${encodeURIComponent(scene)}`, width: 640, height: 400 });
      let a: Awaited<ReturnType<typeof render>>;
      let b: Awaited<ReturnType<typeof render>>;
      try {
        // (one clock for both: the scene held)
        const T = await app.js<number>("(__bh.freeze(true), __bh.time())");
        a = await render(app, T, false);
        // (KE_AA=1: both renders from the whole module — the test's own noise floor)
        const before = await app.js<number>("__bh.renderer.specialisedModules.size");
        b = await render(app, T, process.env.KE_AA !== "1");
        // (the second render's pipelines did come from specialised modules)
        if (process.env.KE_AA !== "1") expect(await app.js<number>("__bh.renderer.specialisedModules.size")).toBeGreaterThan(before);
      } finally {
        app.close();
      }
      expect(b.width).toBe(a.width);
      expect(b.height).toBe(a.height);
      let off = 0;
      let worst = 0;
      let sum = 0;
      for (let i = 0; i < a.data.length; i++) {
        const d = Math.abs(a.data[i]! - b.data[i]!);
        if (d > 1) off++;
        worst = Math.max(worst, d);
        sum += a.data[i]!;
      }
      console.log(
        `  ${scene}: ${off} values off by more than 1 of ${a.data.length}, the worst ${worst}; mean level ${(sum / a.data.length).toFixed(1)}`,
      );
      // (not a blank image: something drawn)
      expect(sum / a.data.length).toBeGreaterThan(1);
      expect(off / a.data.length).toBeLessThan(0.002);
    }, 1_500_000);
});
