import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q6n's open end — the relief's cascades drawn again at every bake of the heights (renderer.sunBakesEvery 0, since Q6n) while the
// tiles arrive (unmeasured there: a bake possible at nearly every frame): the F-35 put at 40 m over La Mancha with nothing loaded
// (the page loaded again for each run), flown at once 150 frames stepped 1/30 s (5 s); each frame awaited to its end, its bakes
// (the relief cache's builds), whether the cascades were drawn again, and the GPU's time of their pass ("terrain from the Sun")
// — the craft held level by the autopilot (height and heading), the autothrottle and the gear down, its pitch and height logged
// that frame. Runs: sunBakesEvery 0, 500, 0 (the tiles' own cache — the service worker's — faster the later runs: bracketed).
// Output: remote-results/bakes-loading/bakes.json (BL_OUT) — per run: bakes, redraws, frames with a redraw, the pass's sum, mean,
// worst frame and the frames over 1 ms. Done when: the three runs taken, no GPU error. Duration: ~4 min.
const OUT = process.env.BL_OUT ?? "remote-results/bakes-loading";
afterAll(stopServer);
const RUNS = [0, 500, 0];

test.skipIf(!E2E)(
  "Q6n: the cascades' redraws and their cost while the tiles arrive, every bake followed or one a half-second",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown>[] = [];
    try {
      for (const every of RUNS) {
        await app.load("scene=game:artemis");
        await app.js(
          `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0 }); return 1; })()`,
        );
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.settled(120_000);
        const r = await app.js<Record<string, unknown>>(`(async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          r.sunBakesEvery = ${every};
          __bh.game.setDate("2026-07-10T11:30:00Z"); __bh.game.set("weather", "fair");
          __bh.game.flyAt(39.42, -3.05, 40, 90, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui");
          // (held level: the autopilot on the height and heading it has, the autothrottle on its speed, the gear down — Sam: flown
          // bare, the craft pitched up over the 150 frames)
          // (its systems in the air after a few steps — toggled at once after flyAt, the holds were refused)
          const c = __bh.camera; __bh.freeze(true);
          for (let i = 0; i < 3; i++) { __bh.step(1 / 30); __bh.touch(); await frame(); }
          c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          const said = [c.jetModes.alt === null ? c.jetToggle("ap") : "ap on", c.jetModes.spd === null ? c.jetToggle("athr") : "athr on"];
          r.prof.enabled = true; r.prof.reset();
          const F = __bh.fleet, att = () => { const a = c.attitudeNow(), t = __bh.sim.time;
            return [(a.pitch ?? 0) * 180 / Math.PI, __bh.sys.heightOverGround("earth", F.pose(F.active, t).X, t)]; };
          let pMin = 99, pMax = -99, hMin = 1e9, hMax = -1e9;
          const builds = () => r.terrainSurfaceCache?.stats().builds ?? 0, b0 = builds();
          let redraws = 0, framesRedrawn = 0, sum = 0, worst = 0, over1 = 0; const per = [];
          for (let i = 0; i < 150; i++) {
            const last = r.lastDoneAt; __bh.step(1 / 30); __bh.touch(); let k = 0;
            while (r.lastDoneAt === last && k++ < 120) await frame();
            const drew = !!r.terrainRaster?.sunDrewNow;
            const p = r.prof.table().find((t) => /from the Sun/i.test(t.label));
            const ms = drew && p ? p.last : 0;
            if (drew) { redraws++; framesRedrawn++; sum += ms; worst = Math.max(worst, ms); if (ms > 1) over1++; }
            per.push(+ms.toFixed(3));
            const [pd, h] = att(); pMin = Math.min(pMin, pd); pMax = Math.max(pMax, pd); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
          }
          r.prof.enabled = false; __bh.freeze(false);
          return { sunBakesEvery: ${every}, bakes: builds() - b0, redraws, framesRedrawn, sumMs: +sum.toFixed(2),
            meanMs: +(sum / Math.max(redraws, 1)).toFixed(3), worstMs: +worst.toFixed(3), over1ms: over1,
            pending: r.earthTiles.pending, pitchDeg: [+pMin.toFixed(1), +pMax.toFixed(1)], agl: [+hMin.toFixed(1), +hMax.toFixed(1)],
            ap: { alt: c.jetModes.alt, spd: c.jetModes.spd, said }, per }; })()`);
        out.push(r);
        // (a craft not held level is a flight not measured — said, the run kept for what it shows)
        const pitch = r.pitchDeg as number[],
          agl = r.agl as number[];
        // (level: the holds on, the pitch within ±10° — 136 m/s gear down holds ~7° —, 15–70 m over a relief that arrives under it)
        if (Math.abs(pitch[0]!) > 10 || Math.abs(pitch[1]!) > 10 || agl[0]! < 15 || agl[1]! > 70 || (r.ap as { alt: unknown }).alt === null)
          console.log(`  every ${every}: NOT LEVEL — pitch ${pitch}, agl ${agl}`);
        const { per: _per, ...brief } = r;
        console.log(`  every ${every}: ${JSON.stringify(brief)}`);
      }
      expect(await app.js<number>(`__bh.renderer.gpuErrors`)).toBe(0);
    } finally {
      await Bun.write(`${OUT}/bakes.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
  },
  10 * 60_000,
);
