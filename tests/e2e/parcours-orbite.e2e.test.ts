import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
// PLAN-J6 J6-8 — the journey « go to orbit and observe » (strategy §19.13): the Ranger on the Cape's pad (28.573° N, 80.649° W, tiles and the
// IGN blocked), its orbital take-off by the real key U; the clock stepped by slices of 10 s of flight (300 steps of 1/30 s, the world
// frozen between), a few images drawn between slices. At every step the craft's altitude over the sea (game.status().altKm) and the time:
// no jump of the datum or the origin (each step's change of height within what its climb rate covers in a step, and 20 m); at every slice
// the exposure the image is drawn with (renderer.ev) and a shot at 0, 30, 80 km and in orbit. Asserted: in orbit within 15 min of flight, no
// height jump, the time forward, no GPU error. Recorded: the exposure along the climb (its largest change between two slices).
// Duration: ~4 min on kerr-mini.
// Done when: in orbit (or 15 min of flight), parcours-orbite.json written.
afterAll(stopServer);
const OUT = process.env.PO_OUT ?? "remote-results/parcours-orbite";
type Slice = { t: number; altKm: number; status: string; speed: number; jumps: number; jumpMaxM: number; back: number };
test.skipIf(!E2E)(
  "J6-8: from the Cape's pad to orbit — no datum or origin jump, the exposure along the climb",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: false });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
    try {
      await app.cdp.send("Network.setBlockedURLs", {
        urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
      });
      await app.waitFor("__bh.camera.piloting", 60_000);
      await app.js(`(() => { Object.assign(__bh.settings, { vessel: "ranger", damage: false, dof: false, motionBlur: 0 }); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "ranger"`, 30_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.land("earth", 28.573, -80.649); __bh.settings.shipMount = "cockpit";
        __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.settled(90_000);
      await app.shot(`${OUT}/0-pad.png`);
      await app.press("KeyU", "u");
      await Bun.sleep(500);
      const slices: (Slice & { ev: number })[] = [];
      const shotsAt = [30, 80];
      let orbit = false;
      for (let k = 0; k < 90 && !orbit; k++) {
        const s = await app.js<Slice>(`(() => {
          __bh.freeze(true); const st0 = __bh.game.status(); let alt = st0.altKm, t = __bh.time(), jumps = 0, jumpMaxM = 0, back = 0, vz = 0;
          for (let i = 0; i < 300; i++) {
            __bh.step(1 / 30);
            const st = __bh.game.status(), tt = __bh.time();
            if (tt < t) back++;
            const dM = Math.abs(st.altKm - alt) * 1000;
            // (a step's change of height over its climb rate's — the last step's, 1.5 × — and over 20 m: a jump)
            // (the slice's first step: its climb rate not yet known — none judged)
            if (i > 0 && dM > Math.max(1.5 * Math.abs(vz) / 30 + 1, 20)) { jumps++; jumpMaxM = Math.max(jumpMaxM, dM); }
            vz = (st.altKm - alt) * 1000 * 30; alt = st.altKm; t = tt;
          }
          const st = __bh.game.status(); __bh.freeze(false);
          return { t: +(__bh.time() * 492.5490947).toFixed(1), altKm: +st.altKm.toFixed(2), status: st.status, speed: Math.round(st.speed), jumps, jumpMaxM: Math.round(jumpMaxM), back }; })()`);
        // (a few images drawn: the exposure they are drawn with)
        const ev = await app.js<number>(`(async () => { for (let i = 0; i < 8; i++) await new Promise((q) => requestAnimationFrame(q));
          return +(__bh.renderer.ev(__bh.settings) ?? 0).toFixed(2); })()`);
        slices.push({ ...s, ev });
        console.log(`  slice ${k}: ${JSON.stringify({ ...s, ev })}`);
        if (shotsAt.length && s.altKm >= shotsAt[0]!) await app.shot(`${OUT}/1-${shotsAt.shift()}km.png`);
        orbit = s.status === "orbit";
      }
      await app.shot(`${OUT}/2-orbit.png`);
      let evStep = 0;
      for (let i = 1; i < slices.length; i++) evStep = Math.max(evStep, Math.abs(slices[i]!.ev - slices[i - 1]!.ev));
      out.slices = slices;
      out.summary = {
        orbit,
        slices: slices.length,
        jumps: slices.reduce((a, s) => a + s.jumps, 0),
        jumpMaxM: Math.max(...slices.map((s) => s.jumpMaxM)),
        back: slices.reduce((a, s) => a + s.back, 0),
        evStepMax: +evStep.toFixed(2),
        evRange: [Math.min(...slices.map((s) => s.ev)), Math.max(...slices.map((s) => s.ev))],
      };
      console.log(`  summary: ${JSON.stringify(out.summary)}`);
      expect(orbit).toBe(true);
      expect((out.summary as { jumps: number }).jumps).toBe(0);
      expect((out.summary as { back: number }).back).toBe(0);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/parcours-orbite.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
