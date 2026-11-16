import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { CRUISE, expectFlight, flightState, placeJetFrozen } from "./lib/flight-state";
import { J0_FIXED } from "./lib/j0-scene";
import { readPng } from "./lib/png";
// PLAN-J6 J6-6 — the journey « rebuild the GPU » (strategy §19.13), solo, in the main profile: the F-35 at 300 m over the Maures' hills
// under its autopilot, the GPU device lost (__bh.gpu.lose()), the stick held 1.2 s during the recovery (the real key: no blind piloting —
// the flight's time held, the input must not fly the craft). Sampled every 25 ms: the scene's time, the GPU's generation, its image drawn,
// the contact ground under the craft (earthTiles.contactAt against contactLevel). Asserted: the time held from the loss to the new
// generation's first image (gpu-recovery-hold's bound), running again after; at the first sample where the time runs again, the contact
// ground at its level under the craft; the craft's height and holds as before the loss; within 15 s of the new image, the relief published
// again (earthTiles.finest ≥ 14), the cockpit's display uploaded (ship.displayAges().jet under 1 s), the image not black (the screen's mean
// luminance at least half the one before); no GPU error after the new device. Not here (a second lot): the loss in a network room.
// Rule 13 (E2E-VOLS): placed frozen while the data load, its holds engaged; before the loss and after the recovery the craft as flown —
// autopilot, autothrottle, thrust applied, airspeed, attitude (lib/flight-state.ts).
// Duration: ~4 min on kerr-mini.
// Done when: the new generation judged, parcours-gpu.json written.
afterAll(stopServer);
const OUT = process.env.PG_OUT ?? "remote-results/parcours-gpu";
const AT = [43.22, 6.33, 300, 90, 140] as const;
const meanLum = async (f: string) => {
  const p = readPng(new Uint8Array(await Bun.file(f).arrayBuffer()));
  let s = 0;
  for (let i = 0; i < p.width * p.height; i += 7) {
    const k = i * p.channels;
    s += 0.2126 * p.data[k]! + 0.7152 * p.data[k + 1]! + 0.0722 * p.data[k + 2]!;
  }
  return s / Math.ceil((p.width * p.height) / 7);
};
type Sample = { w: number; t: number; gen: number; drawn: boolean; z: number; want: number; alt: number };
test.skipIf(!E2E)(
  "J6-6: the GPU lost in flight — the time held, no blind piloting, the ground, the relief, the displays and the image back",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), at: AT };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = `(() => { __bh.game.setDate("2026-07-10T13:30:00Z"); __bh.game.flyAt(${AT.join(", ")}); for (let i = 0; i < 10; i++) __bh.step(1 / 30); __bh.settings.shipMount = "cockpit";
        __bh.refresh(); __bh.camera.viewReset(); return 1; })()`;
      // (rule 13 of E2E-VOLS: frozen while the data load — no glide at idle —, placed again, its holds engaged, then let go)
      const placed = await placeJetFrozen(app, place, { hdgDeg: AT[3], spd: AT[4] }, async () => {
        await app.dataSettled("the Maures", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
        await app.settled(90_000);
      });
      expectFlight(placed, "placed", { ap: true, athr: true, speedMin: 90, pitchMax: 20, bankMax: 20 });
      await Bun.sleep(4000);
      await app.scenario("en vol sur les Maures, avant la perte");
      await app.shot(`${OUT}/1-avant-la-perte.png`);
      const lumBefore = await meanLum(`${OUT}/1-avant-la-perte.png`);
      const state = `(() => { const c = __bh.camera, g = c.geoNow(), m = c.jetModes, a = c.attitudeNow();
        return { alt: Math.round(g.alt), pitch: +((a.pitch ?? 0) * 180 / Math.PI).toFixed(1), holds: [m.alt && Math.round(m.alt), m.hdg && Math.round(m.hdg * 180 / Math.PI), m.spd] }; })()`;
      const before = await app.js<{ alt: number; pitch: number; holds: unknown }>(state);
      const flownBefore = await flightState(app);
      const gen0 = await app.js<number>("__bh.gpu.generation()");
      await app.js(`(() => {
        window.__rec = [];
        const s = () => { const c = __bh.camera, g = c.geoNow(), t = __bh.renderer?.earthTiles, k = g && t?.contactAt?.(g.lat, g.lon);
          window.__rec.push({ w: performance.now(), t: __bh.time(), gen: __bh.gpu.generation(), drawn: __bh.gpu.frames().firstFrameDoneAt > 0 && !__bh.gpu.lost(),
            z: k ? (k.contactZ ?? k.z) : -1, want: g && t?.contactLevel ? t.contactLevel(g.lat, g.lon) : -1, alt: g ? Math.round(g.alt) : -1 }); };
        window.__recT = setInterval(s, 25); s(); return 1; })()`);
      await Bun.sleep(500);
      await app.scenario("perte du GPU, manche tenu");
      await app.js("(__bh.gpu.lose(), true)");
      // (the stick held during the recovery: nothing flown blind)
      await app.hold("KeyS", 1200);
      await app.waitFor(`__bh.gpu.generation() === ${gen0 + 1} && __bh.gpu.frames().completedFrames > 10`, 90_000);
      const t0 = Date.now();
      // (the new generation's world: the relief published, the cockpit's display uploaded — 15 s at most, said)
      const back = await app.js<{
        finest: number;
        age: number | null;
        s: number;
      }>(`(async () => { const R = __bh.renderer, t0 = performance.now();
        while (performance.now() - t0 < 15000) { const age = R.ship?.displayAges?.(performance.now()).jet ?? null;
          if ((R.earthTiles?.finest ?? 0) >= 14 && age !== null && age < 1000) break; await new Promise((q) => requestAnimationFrame(q)); }
        return { finest: R.earthTiles?.finest ?? 0, age: R.ship?.displayAges?.(performance.now()).jet ?? null, s: +((performance.now() - t0) / 1000).toFixed(1) }; })()`);
      console.log(`  the new generation's world: ${JSON.stringify(back)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      await Bun.sleep(1500);
      const rec = await app.js<Sample[]>(`(clearInterval(window.__recT), window.__rec)`);
      const after = await app.js<{ alt: number; pitch: number; holds: unknown }>(state);
      const flownAfter = await flightState(app);
      console.log(`  flown before the loss ${JSON.stringify(flownBefore)}; after ${JSON.stringify(flownAfter)}`);
      await app.js(`(async () => { await new Promise((q) => setTimeout(q, 2000)); return 1; })()`);
      await app.scenario("après la reprise du GPU");
      await app.shot(`${OUT}/2-apres-la-reprise.png`);
      const lumAfter = await meanLum(`${OUT}/2-apres-la-reprise.png`);
      // (the window: from the first sample of the loss — 500 ms after the start — to the new generation's first drawn image)
      const lostAt = rec.findIndex((r) => r.w >= rec[0]!.w + 500);
      const backAt = rec.findIndex((r) => r.gen === gen0 + 1 && r.drawn);
      const a = rec[lostAt]!,
        b = rec[backAt]!;
      const pre = rec.slice(0, lostAt);
      const rate = (pre.at(-1)!.t - pre[0]!.t) / ((pre.at(-1)!.w - pre[0]!.w) / 1000);
      // (the first sample where the time runs again: its contact ground)
      const runs = rec.findIndex((r, i) => i > backAt && r.t > rec[i - 1]!.t);
      const first = rec[runs] ?? null;
      out.recovery = {
        windowS: +((b.w - a.w) / 1000).toFixed(2),
        timeAcross: b.t - a.t,
        rateBefore: rate,
        firstRunning: first,
        newWorld: back,
        before,
        after,
        lum: [+lumBefore.toFixed(1), +lumAfter.toFixed(1)],
      };
      console.log(`  recovery: ${JSON.stringify(out.recovery)}`);
      expect(backAt).toBeGreaterThan(lostAt);
      expect(b.t - a.t).toBeLessThan(rate * 0.1 + 1e-9);
      expect(first).not.toBeNull();
      expect(first!.z).toBeGreaterThanOrEqual(first!.want);
      expect(Math.abs(after.alt - before.alt)).toBeLessThan(60);
      expect(after.holds).toEqual(before.holds);
      // (rule 13: before the loss and after the recovery, the craft flown — its holds, its engine, its airspeed, its attitude)
      expectFlight(flownBefore, "before the loss", { ...CRUISE, gear: undefined, aglMin: 100 });
      expectFlight(flownAfter, "after the recovery", { ...CRUISE, gear: undefined, aglMin: 100 });
      expect(back.finest).toBeGreaterThanOrEqual(14);
      expect(back.age ?? 9e9).toBeLessThan(1000);
      expect(lumAfter).toBeGreaterThan(lumBefore * 0.5);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/parcours-gpu.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
