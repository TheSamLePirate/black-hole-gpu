import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The ice giants' auroras (PLAN-AURORES-MAGNETOSPHERES AM4): Uranus's — two sheets, ±3° — and Neptune's ovals from their tilted,
// offset fields (Q3, O8), the same code as Jupiter's (AM3, trace.wgsl auroraGiant; Saturn's too, from Cassini 11, but its
// shadow's dark-adapted view is left out — docs/PROBLEMES-A-REGLER.md). Each seen from one radius over its antisolar point
// (sys.subsolar), in its shadow, the eye adapted to the dark, at activity 6. AG_OUT. AG_ONLY=saturn: Saturn alone. AG_GRAIN=1: Saturn's
// disc's grain measured (fixed or changing, frozen and converged).
// Output: remote-results/aurora-giants/*.png, stats.json. Done when: each view shot, the camera in the shadow (eyeIncident
// < 1e-3), no GPU error. Duration: ~4 min warm; the giants' near kernels compile for minutes cold (docs/PROBLEMES-A-REGLER.md).
const OUT = process.env.AG_OUT ?? "remote-results/aurora-giants";
afterAll(stopServer);

test.skipIf(!E2E)(
  "Uranus's and Neptune's auroras from their shadows",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    // (over its antisolar point — Uranus's axis tilted 98°: its subsolar point near a pole —, in its shadow)
    const view = async (name: string, body: string, altR: number, R: number, heading: number, pitch: number) => {
      const why = await app.js<
        string | null
      >(`(() => { Object.assign(__bh.settings, { aurora: 6, auroraLive: false, magnetosphere: false });
        const ss = __bh.sys.subsolar("${body}");
        return __bh.viewAt(-ss[0], ss[1] + 180, { body: "${body}", altM: ${altR * R}, heading: ${heading}, pitch: ${pitch}, fov: 70 }); })()`);
      expect(why).toBeNull();
      await Bun.sleep(3000);
      for (let k = 0; k < 72 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 6 === 0) console.log(`    compiling ${k * 5} s: ${JSON.stringify(await app.js(`__bh.renderer.compilingNow`))}`);
        await Bun.sleep(5000);
      }
      await Bun.sleep(4000);
      await app.shot(`${OUT}/${name}.png`);
      stats[name] = await app.js(
        `({ eye: __bh.renderer.eyeIncident, key: __bh.renderer.featureKey & 16384, gpuMs: __bh.game.perf({ gpu: true }).gpuFrameMs })`,
      );
      console.log(`  ${name}: ${JSON.stringify(stats[name])}`);
      expect((stats[name] as { eye: number }).eye).toBeLessThan(1e-3);
      // (AG_GRAIN=1: the disc's grain — a fixed texture, or noise that changes frame to frame? The world frozen, the scene's colour read
      // twice 1.5 s apart, then after 8 s more (converged): over the upper half of the disc (the rings' faint light) and the lower (lit
      // by them), the mean luminance, its spatial spread (coefficient of variation) and the mean change between the two reads)
      if (process.env.AG_GRAIN && name === "saturn-night") {
        await app.js(`(() => { __bh.freeze(true); return 1; })()`);
        await Bun.sleep(1000);
        const read = () =>
          app.js<
            number[][]
          >(`(async () => { const c = await __bh.renderer.sceneColor(__bh.settings); const W = c.width, H = c.height, out = [];
            for (const [y0, y1] of [[0.25, 0.5], [0.62, 0.78]]) { const v = [];
              for (let y = Math.floor(y0 * H); y < y1 * H; y += 2) for (let x = Math.floor(0.38 * W); x < 0.62 * W; x += 2) {
                const i = 4 * (y * W + x); v.push(0.2126 * c.data[i] + 0.7152 * c.data[i + 1] + 0.0722 * c.data[i + 2]); }
              out.push(v); }
            return out; })()`);
        const a = await read();
        await Bun.sleep(1500);
        const b = await read();
        await Bun.sleep(8000);
        const c = await read();
        const desc = (u: number[], w: number[]) => {
          const m = u.reduce((x, y) => x + y, 0) / u.length;
          const sd = Math.sqrt(u.reduce((x, y) => x + (y - m) ** 2, 0) / u.length);
          const d = u.reduce((x, y, i) => x + Math.abs(y - w[i]!), 0) / u.length;
          return { mean: +m.toPrecision(3), cv: +(sd / Math.max(m, 1e-30)).toFixed(3), change: +(d / Math.max(m, 1e-30)).toFixed(3) };
        };
        const g = {
          upper: { firstPair: desc(a[0]!, b[0]!), converged: desc(c[0]!, b[0]!) },
          lower: { firstPair: desc(a[1]!, b[1]!), converged: desc(c[1]!, b[1]!) },
        };
        stats[`${name}-grain`] = g;
        console.log(
          `  ${name} grain (cv: spatial spread over the mean; change: mean |Δ| between reads over the mean): ${JSON.stringify(g)}`,
        );
        await app.shot(`${OUT}/${name}-frozen.png`);
        await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      }
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.game.setDate("2026-12-21T07:00:00Z"); return 1; })()`);
      // (Saturn since 13 Nov 2026: its shadow's dark-adapted view showed the tracer's faint wrong light — PROBLEMES —, looked at again)
      await view("saturn-night", "saturn", 1, 60_268e3, 0, -89);
      if (process.env.AG_ONLY !== "saturn") {
        await view("uranus-night", "uranus", 1, 25_559e3, 0, -89);
        await view("neptune-night", "neptune", 1, 24_764e3, 0, -89);
      }
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  30 * 60_000,
);
