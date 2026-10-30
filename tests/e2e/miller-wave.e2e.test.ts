import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PLANETES-AAA P3: Miller's giant wave, felt and seen. The Ranger afloat on Miller's sea ("Miller: Gargantua over the
// sea"), the clock moved on until the tallest wave is 90 s away (__bh.game.waveIn), the look turned to it; the scene's clock
// then run (×4) — the craft lifted by the wave's back… no: its face first, the water rising under it —, then the lip breaking
// over it: the craft lost, swept away (landing.ts stepLocal, controller/motion.ts). Shots of the wall coming, from far to
// over the craft.
// Duration: ~3 min.
// Done when: the wave found, the craft risen with the water, then lost to it.

const OUT = process.env.OUT ?? "remote-results/miller-wave";
afterAll(stopServer);

test.skipIf(!E2E)(
  "Miller's giant wave: it comes, lifts the craft, and breaks over it",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Miller: Gargantua over the sea")}` });
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, { showFps: true, animate: false, dynamicResolution: false${process.env.NO_DAMAGE ? ", damage: false" : ""} }); return 1; })()`,
      );
      await app.settled();
      console.log(
        `  at load: ${JSON.stringify(await app.js(`({ lost: document.querySelector(".craft-lost")?.textContent ?? "", failure: __bh.camera.airFlight?.failure ?? null, landed: __bh.camera.landed, local: !!__bh.camera.local, landedL: __bh.camera.local?.L?.landed ?? null })`))}`,
      );
      const w = process.env.SKIP_WAVE
        ? { crestM: 1000, awayM: 0, bearing: 0, movedKm: 0 }
        : await app.js<{ crestM: number; awayM: number; bearing: number; movedKm: number }>(`__bh.game.waveIn(90)`);
      console.log(`  the wave: ${JSON.stringify(w)}`);
      expect(w.crestM).toBeGreaterThan(600);
      // (the look turned towards it: the bearing from the north, the craft's heading off it — status.headingDeg)
      const st0 = await app.js<{ altKm: number; headingDeg?: number }>(`__bh.game.status()`);
      const yaw = ((w.bearing - (st0.headingDeg ?? 0) + 540) % 360) - 180;
      await app.js(`(() => { __bh.settings.shipLookYaw = ${yaw}; __bh.settings.shipLookPitch = 6; __bh.touch(); return 1; })()`);
      const settle = () =>
        app.js(`(async () => { const r = __bh.renderer; const t0 = performance.now();
          for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          while ((!r.kernelsSettled || r.compilesPending > 0) && performance.now() - t0 < 300000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
          for (let i = 0; i < 40; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
      await settle();
      await app.shot(`${OUT}/0-coming.png`);
      // (the clock run ×4: a shot every ~4 s of the scene's, the craft's height above the mean sea)
      const alts: number[] = [];
      let lost = "";
      await app.js(`(() => { __bh.settings.animate = true; __bh.game.warp(4); return 1; })()`);
      for (let k = 1; k <= 30 && !lost; k++) {
        await Bun.sleep(1000);
        const st = await app.js<{ altKm: number }>(`__bh.game.status()`);
        alts.push(Math.round(st.altKm * 1000));
        lost = await app.js<string>(`document.querySelector(".craft-lost")?.textContent ?? ""`);
        if (k % 3 === 0 || lost) await app.shot(`${OUT}/${String(k).padStart(2, "0")}${lost ? "-lost" : ""}.png`);
        // (and three-quarters on: the wall side-lit, not against Gargantua's light — the interface hidden)
        if (k % 6 === 0 && !lost)
          for (const dy of [70, -70]) {
            await app.js(
              `(() => { document.body.classList.add("hide-ui"); __bh.settings.shipLookYaw = ${yaw + dy}; __bh.touch(); return 1; })()`,
            );
            await Bun.sleep(400);
            await app.shot(`${OUT}/${String(k).padStart(2, "0")}-side${dy > 0 ? "R" : "L"}.png`);
            await app.js(
              `(() => { document.body.classList.remove("hide-ui"); __bh.settings.shipLookYaw = ${yaw}; __bh.touch(); return 1; })()`,
            );
          }
      }
      console.log(`  the craft's height [m]: ${alts.join(" ")}`);
      console.log(`  lost: ${lost.slice(0, 120)}`);
      // (felt: the water rose under it before the lip took it)
      expect(Math.max(...alts) - alts[0]!).toBeGreaterThan(100);
      expect(lost).toContain("giant wave");
    } finally {
      app.close();
    }
  },
  900_000,
);
