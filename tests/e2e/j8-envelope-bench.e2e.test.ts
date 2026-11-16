import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J8 J8-0 (c) — what the far buildings' layer (J8-4) will cost, measured before it is built: synthetic envelopes (oriented boxes,
// solid, a real building's material — renderer.envelopeBench, SceneryRaster's bench) injected over Toulon on the ring 2–15 km round
// its centre, culled by the GPU (the field of view, a pixel at least), drawn into the visibility and all into the buildings' shadow
// map. The view: Toulon from 12 km east, 400 m up, west, the free camera, no craft, the world frozen, everything in. Counts 0, 32 k,
// 64 k, 128 k, 256 k, 512 k, then 0 again (the A/A: the same as the first), then 512 k with each part left out in turn (the culling,
// the visibility, the shadow — what each costs); each 5 s: the GPU time (median, p95), the envelopes in view, the passes. The machine's
// thermal state before and after (scripts/thermal.ts). Not a pass/fail on the times: j8-envelope-bench.json; it fails on a GPU error,
// the A/A apart by more than 15 %, or 512 k unseen (its GPU time not over the 0's — the positive control).
// Duration: ~6 min on kerr-mini.
// Done when: every count measured, the A/A and the parts, j8-envelope-bench.json written.
afterAll(stopServer);
const MACHINE = process.env.J8B_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J8B_OUT ?? `remote-results/j8-envelope-bench/${MACHINE}`;
const TOULON = { lat: 43.124, lon: 5.928 };
const VIEW = { lat: 43.11, lon: 6.08, altM: 400, heading: 272, pitch: -3 };
const thermal = async () => (await $`bun scripts/thermal.ts --json`.quiet().nothrow()).stdout.toString().trim().slice(0, 400) || null;
test.skipIf(!E2E)(
  "J8-0 (c): the far envelopes' GPU cost over Toulon — 0 to 512 k, the A/A, each part",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, view: VIEW, toulon: TOULON, runs: [] };
    try {
      out.thermalBefore = await thermal();
      await app.scenario("la vue sur Toulon, tout chargé");
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { ship: false, earthClouds: 0, weather: "fair", dof: false, motionBlur: 0,
        earthPipeline: "raster" }); __bh.renderer.debugSkipShip = true; __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
      const why = await app.js<string | null>(
        `__bh.viewAt(${VIEW.lat}, ${VIEW.lon}, { altM: ${VIEW.altM}, heading: ${VIEW.heading}, pitch: ${VIEW.pitch}, fov: 50 }) ?? null`,
      );
      if (why) throw new Error(`viewAt: ${why}`);
      await app.js(`(async () => { for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      await app.dataSettled("Toulon", { maxMs: 150_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 200)})`));
      await app.js(`(() => { __bh.freeze(true); __bh.touch(); return 1; })()`);
      await app
        .waitProgress(
          `(() => { const r = __bh.renderer, t = r.earthTiles, sc = r.earthScenery.stats(); __bh.touch();
            return t.pending === 0 && t.orthoPending === 0 && sc.status === "ready" && !sc.quick && r.earthScenery.buildingLeaf >= 0; })()`,
          "Toulon whole",
          { stallMs: 60_000, maxMs: 180_000 },
        )
        .catch((e) => console.log(`  (not whole: ${String(e).slice(0, 200)})`));
      await app.settled(60_000);
      await app.shot(`${OUT}/0-sans.png`);
      const measure = async (label: string, n: number, skip: number) => {
        await app.scenario(`${label}`);
        const why = await app.js<string | null>(`(async () => { __bh.renderer.benchSkip = ${skip};
          return await __bh.renderer.envelopeBench({ lat: ${TOULON.lat}, lon: ${TOULON.lon}, n: ${n}, rMin: 2000, rMax: 15000, seed: 7 }); })()`);
        if (why) throw new Error(`envelopeBench ${n}: ${why}`);
        await app.settled(30_000);
        const m = await app.js<{ p50: number; p95: number; images: number; inView: number; passes: [string, number][] }>(`(async () => {
          const R = __bh.renderer; R.prof.enabled = true; R.prof.every = 1; R.prof.reset?.();
          for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
          const g = []; let done = R.completedFrames; const t0 = performance.now();
          while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
            if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
          g.sort((a, b) => a - b);
          const passes = R.prof.table().map((p) => [p.label, +(p.ms ?? 0).toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
          return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), p95: +(g[Math.floor(g.length * 0.95)] ?? 0).toFixed(2), images: g.length,
            inView: await R.benchInView(), passes }; })()`);
        const row = { label, n, skip, ...m };
        (out.runs as unknown[]).push(row);
        console.log(`  ${label}: ${JSON.stringify({ ...row, passes: row.passes.slice(0, 4) })}`);
        return row;
      };
      const zero = await measure("0 enveloppe", 0, 0);
      const rows = [];
      for (const n of [32_000, 64_000, 128_000, 256_000, 512_000]) rows.push(await measure(`${n / 1000} k enveloppes`, n, 0));
      await app.shot(`${OUT}/512k.png`);
      const zero2 = await measure("0 enveloppe (A/A)", 0, 0);
      const parts = [];
      for (const [skip, what] of [
        [1, "sans le tri"],
        [2, "sans la visibilité"],
        [4, "sans l'ombre"],
      ] as const)
        parts.push(await measure(`512 k ${what}`, 512_000, skip));
      await app.js(
        `(async () => { __bh.renderer.benchSkip = 0; await __bh.renderer.envelopeBench({ lat: 0, lon: 0, n: 0 }); return 1; })()`,
      );
      out.thermalAfter = await thermal();
      out.summary = {
        zeroP50: zero.p50,
        aaP50: zero2.p50,
        added: rows.map((r) => ({ n: r.n, inView: r.inView, addedP50: +(r.p50 - zero.p50).toFixed(2) })),
        parts: parts.map((r) => ({ label: r.label, p50: r.p50 })),
      };
      console.log(`  summary: ${JSON.stringify(out.summary)}`);
      expect(Math.abs(zero2.p50 - zero.p50)).toBeLessThan(0.15 * zero.p50);
      expect(rows.at(-1)!.p50).toBeGreaterThan(zero.p50);
      expect(rows.at(-1)!.inView).toBeGreaterThan(0);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-envelope-bench.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  1_200_000,
);
