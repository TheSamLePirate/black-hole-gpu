import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J8 J8-1 — the buildings between the scene's edge and the far silhouettes, measured: the IGN's overground (its surface less its
// ground, I6) is drawn up to z 13, past the z 14 window (±7 km in « very far »); within, the scene's own buildings, capped. Tried on
// 16 Nov 2026 and set aside: the overground at z 14 masked by the scene's square (no visible gain — the full scene's square reaches
// ~10 km, its buildings stop at the cap's 32 000 well before). Three views over the Var, the free camera, no craft, the world frozen:
// J0's start (500 m over the sea off Hyères, west), Toulon from 12 km east (400 m) and from 5 km east (300 m — the band the overground
// fills). Each: the place's data in (on their progress), the tracer settled, 3 s frozen — its GPU time (median) and a shot. Run on
// both sides of an A/B (scripts/ab-commit.ts: the commit before, this one) for the before/after; J8S_SIL=0: the silhouettes off.
// The band probe: along the view's heading, every km from 1 to 12, 21 points across ±1 km — the share whose drawn height
// (earthTiles.heightAt drawn) stands over the bare ground by 3 m or more: the overground seen; with the drawn scene's square
// (scenery.drawnBox) and each ring's place to it — within, none expected (J8-1's mask). Its controls: past 7 km the z ≤ 13 overground
// on both sides of the A/B (positive), J8S_SIL=0 none anywhere (negative).
// Not a pass/fail on the image: j8-silhouettes.json and the shots; it fails on a GPU error or a view refused.
// Duration: ~4 min on kerr-mini.
// Done when: the three views shot and j8-silhouettes.json written.
afterAll(stopServer);
const SIDE = process.env.AB_SIDE ? `-${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = process.env.J8S_OUT ?? `remote-results/j8-silhouettes${SIDE}`;
const VIEWS = [
  { name: "1-depart-j0", label: "le départ de J0, au large de Hyères", lat: 43.06, lon: 6.32, altM: 500, heading: 270, pitch: -3 },
  { name: "2-toulon-12km", label: "Toulon à 12 km, depuis l'est", lat: 43.11, lon: 6.08, altM: 400, heading: 272, pitch: -3 },
  { name: "3-toulon-5km", label: "Toulon à 5 km, depuis l'est", lat: 43.125, lon: 5.99, altM: 300, heading: 268, pitch: -4 },
] as const;
test.skipIf(!E2E)(
  "J8-1: the overground between the scene and the far silhouettes — three views over the Var, their GPU time and shots",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), views: {} };
    try {
      const sil = process.env.J8S_SIL !== "0";
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}, { ship: false, earthClouds: 0, weather: "fair", dof: false, motionBlur: 0,
        earthPipeline: "raster", earthIgnSilhouettes: ${sil} }); __bh.renderer.debugSkipShip = true; __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
      for (const v of VIEWS) {
        await app.scenario(v.label);
        await app.js(`(() => { __bh.freeze(false); return 1; })()`);
        const why = await app.js<string | null>(
          `__bh.viewAt(${v.lat}, ${v.lon}, { altM: ${v.altM}, heading: ${v.heading}, pitch: ${v.pitch}, fov: 50 }) ?? null`,
        );
        if (why) throw new Error(`viewAt ${v.name}: ${why}`);
        // (the view taken at the next images, its tiles asked then: a wait begun at once saw nothing pending yet and passed — the first
        // A/B, 16 Nov 2026)
        await app.js(`(async () => { for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
        await app
          .dataSettled(v.label, { maxMs: 150_000 })
          .catch((e) => console.log(`  (${v.name} not settled: ${String(e).slice(0, 200)})`));
        await app.js(`(() => { __bh.freeze(true); __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        // (frozen, everything in: the tiles, the orthophotos, the scenery's whole scene — on their progress, said if not)
        await app
          .waitProgress(
            `(() => { const r = __bh.renderer, t = r.earthTiles, sc = r.earthScenery.stats(); __bh.touch();
              return t.pending === 0 && t.orthoPending === 0 && sc.status === "ready" && !sc.quick; })()`,
            `${v.name}: the place whole`,
            { stallMs: 60_000, maxMs: 180_000 },
          )
          .catch((e) => console.log(`  (${v.name} not whole: ${String(e).slice(0, 200)})`));
        await app.settled(60_000);
        const m = await app.js<{ gpuP50: number; images: number; pipe: string; tiles: number; sceneryBuildings: number }>(`(async () => {
          const R = __bh.renderer, g = []; let done = R.completedFrames; const t0 = performance.now();
          while (performance.now() - t0 < 3000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
            if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
          g.sort((a, b) => a - b);
          return { gpuP50: +(g[g.length >> 1] ?? 0).toFixed(2), images: g.length, pipe: R.earthPipelineNow(__bh.settings),
            tiles: R.earthTiles.pending, sceneryBuildings: R.earthScenery.stats().buildings }; })()`);
        const band = await app.js<{ box: unknown; rewrites: number; rings: { km: number; share: number; inScene: boolean }[] }>(`(() => {
          const T = __bh.renderer.earthTiles, sc = __bh.renderer.earthScenery, D = Math.PI / 180, b = sc.drawnBox?.() ?? null;
          const q = (lat, lon) => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
          const h = ${v.heading} * D, ex = Math.sin(h), ny = Math.cos(h), m = 111320, cl = Math.cos(${v.lat} * D);
          const rings = [];
          for (let km = 1; km <= 12; km++) {
            let over = 0, n = 0, inScene = false;
            for (let i = -10; i <= 10; i++) {
              const e = km * 1000 * ex + i * 100 * ny, nn = km * 1000 * ny - i * 100 * ex;
              const lat = ${v.lat} + nn / m, lon = ${v.lon} + e / (m * cl);
              const p = q(lat, lon), dr = T.heightAt(p, 4, true), bare = T.heightAt(p, 4, false);
              if (dr.rem > 0.5) continue;
              n++; if (dr.h - bare.h >= 3) over++;
              if (b && Math.max(Math.abs(lon - b.lon) * m * Math.cos(b.lat * D), Math.abs(lat - b.lat) * m) < b.half) inScene = true;
            }
            rings.push({ km, share: n ? +(over / n).toFixed(2) : -1, inScene });
          }
          return { box: b && { lat: +b.lat.toFixed(4), lon: +b.lon.toFixed(4), half: Math.round(b.half) }, rewrites: T.overRewrites ?? -1, rings }; })()`);
        console.log(`  ${v.name} band: ${JSON.stringify(band)}`);
        (out.views as Record<string, unknown>)[v.name] = { ...v, ...m, silhouettes: sil, band };
        console.log(`  ${v.name}: ${JSON.stringify(m)}`);
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        await app.shot(`${OUT}/${v.name}.png`);
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-silhouettes.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
