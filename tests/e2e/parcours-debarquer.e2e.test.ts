import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
// PLAN-J6 J6-3 — the journey « land then disembark » (strategy §19.13), in the main profile (raster, the cockpit): the F-35 over the sea
// off Hyères (J0's start), the afternoon; then 9 km out on the final of the end the ILS picks (camera.ilsRunways), the ILS engaged on it (camera.ilsStart), flown to its touchdown and its rollout to a
// stop; at every image from the touchdown, whether the craft is on the ground (camera.rolling / ourLanded — a bounce: back in the air). At
// rest: the contact ground under the craft read under two graphics settings (detailReach normal then veryFar, earthScenery balanced then
// full — earthTiles.contactAt: its height and its level must not change, the contact the world's, not the graphics', §19.4); then out on
// foot (Shift+K, the real key), a walk of 2 s ahead and 2 s back (character.move), grounded all along; back aboard (Shift+K); then the
// automatic take-off (U, the real key): control taken again.
// Asserted: the ILS lands and stops, no bounce, the contact the same under both settings, out on foot and grounded, back aboard, airborne
// again within 30 s of U, no GPU error, the page never frozen over 1 s. Recorded: the touchdown's grade, the walk's distance, how far the craft
// moves at rest in 10 s after the rollout (the brakes).
// Duration: ~5 min on kerr-mini.
// Done when: airborne again after U, parcours-debarquer.json written.
afterAll(stopServer);
const OUT = process.env.PD_OUT ?? "remote-results/parcours-debarquer";
test.skipIf(!E2E)(
  "J6-3: land at Toulon-Hyères by the ILS, stop, walk out and back, board, take off — the contact the world's, no bounce",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
    let gapMax = 0;
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = `(() => { __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${J0_SCENE.start.join(", ")});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`;
      await app.js(place);
      await app.dataSettled("off Hyères", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
      await app.js(place);
      await app.settled(90_000);
      // (a direct final — not the planned join: from J0's start the built approach to the 31 went around and never landed in 300 s,
      // PROBLEMES — : 9 km out on the axis of the end the ILS picks, 470 m over the ground, 85 m/s; then the ILS on that end)
      const fin = await app.js<{ id: string; lat: number; lon: number; hdg: number } | null>(`(() => {
        const r = __bh.camera.ilsRunways("LFTH"); if (!r) return null; const e = r.ends.find((x) => x.id === r.auto) ?? r.ends[0];
        const D = Math.PI / 180, k = 9000 / 111320;
        return { id: e.id, hdg: e.rwy.hdg, lat: e.rwy.lat - k * Math.cos(e.rwy.hdg * D), lon: e.rwy.lon - (k * Math.sin(e.rwy.hdg * D)) / Math.cos(e.rwy.lat * D) }; })()`);
      if (!fin) throw new Error("no ILS runway at LFTH");
      out.final = fin;
      await app.js(`(() => { __bh.game.flyAt(${fin.lat}, ${fin.lon}, 470, ${fin.hdg}, 85); __bh.settings.shipMount = "cockpit"; __bh.refresh();
        __bh.camera.viewReset(); return 1; })()`);
      out.ilsStart = await app.js<string>(`String(__bh.camera.ilsStart("LFTH", { runway: ${JSON.stringify(fin.id)} }))`);
      console.log(`  ilsStart: ${out.ilsStart}`);
      // (the approach to its stop: 10 s chunks, said each; from the touchdown each image's contact — a bounce, the air again)
      const said0 = await app.js<number>(`__bh.game.log.events.length`);
      let touched = false,
        stopped = false,
        bounces = 0;
      for (let k = 0; k < 30 && !stopped; k++) {
        const r: { gap: number; touched: boolean; bounces: number; stopped: boolean; at: unknown } = await app.js<{
          gap: number;
          touched: boolean;
          bounces: number;
          stopped: boolean;
          at: unknown;
        }>(`(async () => {
          const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
          let touched = ${touched}, bounces = 0, gap = 0, last = performance.now(), was = null; const t0 = performance.now();
          while (performance.now() - t0 < 10000) {
            const now = await f(); gap = Math.max(gap, now - last); last = now;
            const ground = !!(c.rolling || c.ourLanded);
            if (ground) touched = true;
            if (touched && was === true && !ground) bounces++;
            was = ground;
            if (touched && !c.ilsRun && (c.geoNow()?.gs ?? 9) < 1) break;
          }
          const g = c.geoNow();
          return { gap: +gap.toFixed(1), touched, bounces, stopped: touched && !c.ilsRun && (c.geoNow()?.gs ?? 9) < 1,
            at: g && { lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), alt: Math.round(g.alt), gs: Math.round(g.gs ?? 0), ils: !!c.ilsRun,
              phase: c.ilsRun?.phase ?? null, landed: !!c.ourLanded, rolling: !!c.rolling, brake: c.airInfo?.()?.brake ?? null, thr: +(c.pilot?.throttle ?? -1).toFixed(2), paused: document.body.classList.contains("paused") } }; })()`);
        gapMax = Math.max(gapMax, r.gap);
        touched = r.touched;
        bounces += r.bounces;
        stopped = r.stopped;
        console.log(`  approach ${k}: ${JSON.stringify(r)}`);
        if ((r.at as { paused?: boolean } | null)?.paused) throw new Error(`paused — ${JSON.stringify(r.at)}`);
        if (k === 29) throw new Error(`not stopped after 300 s — ${JSON.stringify(r.at)}`);
      }
      const said = await app.js<string[]>(`__bh.game.log.events.slice(${said0}).map((e) => e.text)`);
      out.landing = { bounces, grade: said.filter((m) => /ILS .*\/20/.test(m)), ilsLast: await app.js(`__bh.camera.ilsLast ?? null`) };
      console.log(`  landed: ${JSON.stringify(out.landing)}`);
      await app.shot(`${OUT}/1-stopped.png`);
      // (at rest after the rollout, nothing touched: how far the craft moves in 10 s — the brakes held or not)
      const rest = await app.js<{ movedM: number; brake: unknown; thr: number }>(`(async () => { const c = __bh.camera, g0 = c.geoNow();
        const h0 = (c.attitudeNow().heading ?? 0) * 180 / Math.PI;
        const t0 = performance.now(); while (performance.now() - t0 < 10000) await new Promise((q) => requestAnimationFrame(q));
        const g = c.geoNow(); return { movedM: +Math.hypot((g.lat - g0.lat) * 111320, (g.lon - g0.lon) * 111320 * Math.cos(g.lat * Math.PI / 180)).toFixed(2),
          brake: c.airInfo?.()?.brake ?? null, thr: +(c.pilot?.throttle ?? -1).toFixed(2),
          turnDeg: +((((c.attitudeNow().heading ?? 0) * 180 / Math.PI - h0) + 540) % 360 - 180).toFixed(2),
          northM: +((g.lat - g0.lat) * 111320).toFixed(2), eastM: +((g.lon - g0.lon) * 111320 * Math.cos(g.lat * Math.PI / 180)).toFixed(2),
          hdg: +((c.attitudeNow().heading ?? 0) * 180 / Math.PI).toFixed(1), gear: c.gearLast?.contact ?? null, wind: c.windNow }; })()`);
      out.rest = rest;
      console.log(`  at rest, 10 s: ${JSON.stringify(rest)}`);
      // (the contact ground under the craft, under two graphics settings: the same height and level)
      const contact = (set: string) =>
        app.js<{ h: number; z: number; src: string }>(`(async () => { ${set}
          for (let i = 0; i < 60; i++) await new Promise((q) => requestAnimationFrame(q));
          const g = __bh.camera.geoNow(), c = __bh.renderer.earthTiles.contactAt(g.lat, g.lon);
          return { h: +c.h.toFixed(3), z: c.contactZ ?? c.z, src: c.src }; })()`);
      const a = await contact(`Object.assign(__bh.settings, { detailReach: "normal", earthScenery: "balanced" });`);
      const b = await contact(`Object.assign(__bh.settings, { detailReach: "veryFar", earthScenery: "full" });`);
      out.contact = { normal: a, veryFar: b };
      console.log(`  the contact ground under two settings: ${JSON.stringify(out.contact)}`);
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      // (out on foot — the real key —, a walk ahead and back, grounded all along)
      const said1 = await app.js<number>(`__bh.game.log.events.length`);
      await app.press("KeyK", "K", { shift: true });
      await Bun.sleep(1500);
      if (!(await app.js<boolean>(`__bh.camera.character.active`))) {
        // (refused: what the game said, and the craft's state — PROBLEMES « Après le roulage de l'ILS, l'appareil ne s'arrête pas »)
        const why = await app.js<unknown>(`(() => { const c = __bh.camera, a = c.airInfo();
          return { said: __bh.game.log.events.slice(${said1}).map((e) => e.text), rolling: !!c.rolling, landed: !!c.ourLanded, speed: +a.speed.toFixed(3),
            brake: a.brake }; })()`);
        out.disembark = why;
        throw new Error(`not out on foot after Shift+K — ${JSON.stringify(why)}`);
      }
      const walk = await app.js<{ out: number; back: number; groundedAll: boolean }>(`(async () => {
        const ch = __bh.camera.character, f = () => new Promise((q) => requestAnimationFrame(q)); let groundedAll = true;
        const q0 = [...ch.q]; const d = (q) => Math.hypot(q[0] - q0[0], q[1] - q0[1], q[2] - q0[2]) * 6378137;
        for (let i = 0; i < 30; i++) await f();
        ch.move(1, 0, 2); const t0 = performance.now();
        while (performance.now() - t0 < 2600) { await f(); groundedAll = groundedAll && ch.grounded; }
        const out = d(ch.q);
        ch.move(-1, 0, 2); const t1 = performance.now();
        while (performance.now() - t1 < 2600) { await f(); groundedAll = groundedAll && ch.grounded; }
        return { out: +out.toFixed(2), back: +d(ch.q).toFixed(2), groundedAll }; })()`);
      out.walk = walk;
      console.log(`  on foot: ${JSON.stringify(walk)}`);
      await app.shot(`${OUT}/2-on-foot.png`);
      await app.press("KeyK", "K", { shift: true });
      await app.waitFor(`!__bh.camera.character.active`, 10_000);
      await app.js(`(async () => { __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
        for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      // (control taken again: the automatic take-off, the real key)
      await app.press("KeyU", "u");
      const off = await app.js<{
        off: number | null;
        gap: number;
      }>(`(async () => { const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let off = null, gap = 0, last = t0;
        while (performance.now() - t0 < 30000) { const now = await f(); gap = Math.max(gap, now - last); last = now;
          if (off === null && !c.rolling && !c.ourLanded) { off = (now - t0) / 1000; } if (off !== null && now - t0 > off * 1000 + 4000) break; }
        return { off, gap: +gap.toFixed(1) }; })()`);
      gapMax = Math.max(gapMax, off.gap);
      out.takeoff = off;
      console.log(`  off again: ${JSON.stringify(off)}`);
      await app.shot(`${OUT}/3-off-again.png`);
      out.summary = { bounces, gapMax, walk, contactSame: a.h === b.h && a.z === b.z };
      expect(touched).toBe(true);
      expect(stopped).toBe(true);
      expect(bounces).toBe(0);
      expect(b.h).toBe(a.h);
      expect(b.z).toBe(a.z);
      expect(walk.out).toBeGreaterThan(1);
      expect(walk.groundedAll).toBe(true);
      expect(off.off ?? 99).toBeLessThan(30);
      expect(gapMax).toBeLessThan(1000);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/parcours-debarquer.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
