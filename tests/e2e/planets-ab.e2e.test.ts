import { afterAll, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { SPOTS } from "./lib/planet-views";

// Two builds A/B on the planets' views (PLAN-PLANETES-AAA, tests/e2e/lib/planet-views.ts), in one Chrome: rounds A B B A
// (AB_ROUNDS pairs), each side's page loaded and every view measured on it — the GPU's own time a frame at a fixed quality
// (the tracer's blocks 4 × 4, the raster's one pixel in 2 × 2; the game's governors trade sharpness for time), the profiler
// off, the median of 90 frames. The views on foot left out (their sunlit place is chosen by the image), Gargantua's by their
// first place. Run by scripts/ab-commit.ts (AB_CMD): AB_A_URL, AB_B_URL, AB_OUT; ONLY=bodies, VIEWS=orbit,low,cine.
// Duration: ~1 min a view a side once compiled.
// Done when: every view measured on both sides, ab.json written.

const SIDES = [
  ["A", process.env.AB_A_URL],
  ["B", process.env.AB_B_URL],
].filter((s): s is [string, string] => !!s[1]);
const ROUNDS = Number(process.env.AB_ROUNDS ?? 1);
const OUT = process.env.AB_OUT ?? "remote-results/planets-ab";
const ONLY = process.env.ONLY?.split(",");
const VIEWS = process.env.VIEWS?.split(",") ?? ["orbit", "low", "cine"];
const LIST = SPOTS.filter((s) => s.view !== "foot" && (!ONLY || ONLY.includes(s.body)) && VIEWS.includes(s.view));

afterAll(stopServer);

test.skipIf(!E2E || SIDES.length < 2)(
  "the planets' views, two builds A B B A",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Kerr a=0.94, near edge-on")}` });
    const out: Record<string, { A: number[]; B: number[] }> = {};
    // (A B B A, ROUNDS times: each side twice a round, in both orders — the machine's warming even out)
    const order = Array.from({ length: ROUNDS }, () => ["A", "B", "B", "A"]).flat();
    for (const [n, s] of order.entries()) {
      const round = n >> 2;
      (app as unknown as { url: string }).url = SIDES.find(([x]) => x === s)![1];
      await app.load(`scene=${encodeURIComponent("Earth: the Blue Marble")}`);
      for (const v of LIST) {
        const set = Array.isArray(v.set) ? v.set[0]! : v.set;
        const ms = await app.js<number>(`(async () => {
              const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
              ${set}
              Object.assign(__bh.settings, { dynamicResolution: false, fpsCap: 0, animate: false, realtimeSubsampling: 4, earthRasterShading: "quarter" });
              const t0 = performance.now();
              for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
              while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0) && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
              while (r.earthTiles.pending > 0 && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
              ${["miller", "mann"].includes(v.body) ? `while (!r.planetProbes.has("${v.body}") && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }` : ""}
              for (let i = 0; i < 40; i++) { __bh.touch(); await frame(); }
              const g = []; let done = r.completedFrames; const t1 = performance.now();
              while (g.length < 90 && performance.now() - t1 < 40000) { __bh.touch(); await frame();
                if (r.completedFrames !== done) { done = r.completedFrames; g.push(r.completedDurations[r.completedDurations.length - 1]); } }
              g.sort((a, b) => a - b); return g[g.length >> 1] ?? 0; })()`);
        const k = `${v.body}-${v.view}`;
        ((out[k] ??= { A: [], B: [] })[s as "A" | "B"] as number[]).push(ms);
        console.log(`  ${s}${round} ${k}: ${ms.toFixed(1)} ms`);
      }
      writeFileSync(`${OUT}/ab.json`, JSON.stringify(out, null, 1));
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
    console.log(
      `\nA/B (ms, medians)\n${Object.entries(out)
        .map(
          ([k, v]) =>
            `${k.padEnd(16)} A ${med(v.A).toFixed(1).padStart(6)}  B ${med(v.B).toFixed(1).padStart(6)}  Δ ${(((med(v.B) - med(v.A)) / Math.max(med(v.A), 1e-6)) * 100).toFixed(0).padStart(4)} %`,
        )
        .join("\n")}`,
    );
    app.close();
  },
  3_600_000,
);
