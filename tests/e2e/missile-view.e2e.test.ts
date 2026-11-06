import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The missile view (Sam, 6 Nov 2026: « vue missile — les missiles du F-35 en objets 3D, ailerons et gouvernes qui
// fonctionnent, AAA graphisme + perf »): over Edwards, the drone hunt started from its card, the radar's lock on Tab, the
// AIM-120 on =, fired on Enter, the view put on the missile (mounts.ts "missile"); every MV_EVERY ms a shot and the missile's
// figures — its distance, its fins' deflections, its motor —, the frame rate and the GPU's time. Then an AIM-9X the same way.
//   MV_EVERY (400) · MV_FOR (9 s) · MV_OUT
// Output: remote-results/missile-view/{aim120,aim9x}-NN.jpg, series.json. Done when: each missile drawn (its instance in the
// renderer's list) with its fins moving, no GPU error. Duration: ~2 min.
const OUT = process.env.MV_OUT ?? "remote-results/missile-view";
const EVERY = Number(process.env.MV_EVERY ?? 400);
const FOR = Number(process.env.MV_FOR ?? 9) * 1000;
afterAll(stopServer);

const SAMPLE = `(() => {
  const W = __bh.camera.combat?.world;
  const m = W?.missiles.filter((x) => x.owner === "blue").sort((a, b) => b.id - a.id)[0];
  const o = __bh.renderer.combatOthers.find((x) => String(x.id).startsWith("msl-"));
  const p = __bh.game.perf({ gpu: true });
  return {
    t: m ? +m.t.toFixed(2) : null, alive: m?.alive ?? null, kind: m?.kind ?? null,
    speed: m ? Math.round(Math.hypot(...m.v)) : null,
    fins: m?.fin ? m.fin.map((f) => +((f * 180) / Math.PI).toFixed(1)) : null,
    drawn: !!o, motor: o?.motor?.level ?? 0, dist: o ? Math.round(Math.hypot(...o.rel)) : null,
    fps: p.renderFps, gpuMs: p.gpuFrameMs, mount: __bh.settings.shipMount,
    // (the camera's ride: the missile as the view has it — its distance from the craft —, the eye's, a blend running)
    msQ: (() => { const q = __bh.camera.missileShip?.()?.q; return q ? Math.round(Math.hypot(...q)) : null; })(),
    eye: (() => { const e = __bh.camera.mountEff?.eye ?? __bh.camera.mountTarget?.().eye; return e ? Math.round(Math.hypot(...e)) : null; })(),
    anim: !!__bh.camera.mountAnim,
  };
})()`;

test.skipIf(!E2E)(
  "the missile view: an AIM-120 and an AIM-9X drawn, their fins working, the camera riding them",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    const series: Record<string, unknown>[] = [];
    let gpuErrors = -1;
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("2026-11-06T19:00:00Z"); __bh.settings.vessel = "f35";
        Object.assign(__bh.settings, { lookProfile: "neutral", motionBlur: 0, dof: false });
        for (let i = 0; i < 5; i++) __bh.step(1 / 30); __bh.game.lineUp("Edwards"); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
      await app.dataSettled("Edwards");
      for (const weapon of ["aim120", "aim9x"] as const) {
        await app.js(
          `(() => { __bh.camera.combatEnd?.(); __bh.settings.shipMount = "cockpit"; __bh.flight.challenges.open(); return 1; })()`,
        );
        await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
        await app.click(`[data-testid="chp-fight-drones"]`);
        // (the radar given its time to track — a lock asked each half second, frozen, up to 20 s —, the weapon chosen, fired:
        // the game's own actions, as the keys' — Tab, =, Enter — and TARS's)
        const armed = await app.js<{ lock: number | null; weapon: string; said: string | null }>(
          `(() => { const c = __bh.camera; for (let i = 0; i < 10; i++) __bh.step(1 / 30); c.jetToggle("ap"); c.jetToggle("athr");
            const W = c.combat.world; let said = null;
            for (let k = 0; k < 40 && W.lock == null; k++) { for (let i = 0; i < 15; i++) __bh.step(1 / 30); said = c.combatTrigger("lock"); }
            c.combat.weapon = ${JSON.stringify(weapon)};
            return { lock: W.lock, weapon: c.combat.weapon, said }; })()`,
        );
        console.log(`  ${weapon}: ${JSON.stringify(armed)}`);
        await app.js(`(() => { const c = __bh.camera; const said = c.combatTrigger("fire"); __bh.freeze(false); return said; })()`);
        await app.js(`(() => { __bh.settings.shipMount = "missile"; return 1; })()`);
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < FOR; i++) {
          const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
          await Bun.write(`${OUT}/${weapon}-${String(i).padStart(2, "0")}.jpg`, Buffer.from(a.data, "base64"));
          const s = await app.js<Record<string, unknown>>(SAMPLE);
          series.push({ weapon, i, wall: +((Date.now() - t0) / 1000).toFixed(1), ...s });
          console.log(`  ${weapon} ${i}: ${JSON.stringify(s)}`);
          await Bun.sleep(EVERY);
        }
      }
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/series.json`, JSON.stringify(series, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
    for (const weapon of ["aim120", "aim9x"]) {
      const s = series.filter((x) => x.weapon === weapon);
      expect(s.some((x) => x.drawn)).toBe(true);
      // (its fins moving: their deflections differ between samples while it flies)
      const f = s.filter((x) => x.fins && x.alive).map((x) => JSON.stringify(x.fins));
      expect(new Set(f).size).toBeGreaterThan(1);
    }
  },
  5 * 60_000,
);
