import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The quick entry into Jupiter (PLAN-PLANETES-AAA P11 D6): the Ranger on Galileo's path — 46.4 km/s through the air,
// 8.6° down at 450 km over the 1 bar level (an orbit of periapsis −565 km, apoapsis 5 million km, 6.5° to the equator,
// the turning air taken off: tests/aero-giants.test.ts flies Galileo's own probe through the same air) —, its nose held
// prograde, at the real time's pace. Damage off first: the whole entry — the peak load, the heat flux, the speed left at
// 1 bar, its time, the AIR panel once in the clouds, the frames' pace through it (no page held: the haze, the decks and
// the plasma at 46 km/s), the pilot's G-LOC —, the cockpit and chase shots at the peak heating, in the ammonia, at 1 bar. Damage on then: the Ranger has no
// ablative shield — it fails in the heating, high above the clouds: the craft-lost screen says so (P11 D1c).
// Duration: ~4 min on this Mac
// Done when: the craft-lost screen read.

const OUT = "remote-results/giant-entry";
afterAll(stopServer);

/** Galileo's path for the Ranger (scratch peri.ts: 46.47 km/s relative, −8.60° at 450 km) */
const GALILEO = `{ peKm: -564.6, apKm: 5e6, inc: 6.5, nu: -13.74 }`;

type Row = { t: number; h: number; v: number; g: number; q: number; aoa: number; shield: number; dt: number };
type Leg = { rows: Row[]; end: Row | null; failure: string | null; panel: string | null; frames: number[]; gloc: Row | null };

test.skipIf(!E2E)(
  "Galileo's entry flown by the Ranger: the load, the heat, the clouds at 46 km/s — then, damage on, its shield lost",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}` });
    try {
      // (the flight: each frame its height over 1 bar, speed through the air, load, nose heat flux, angle of attack, shield
      // temperature, the frame's interval — until a height, a failure or a time)
      await app.js(`(() => { window.__fly = async (untilKm, maxS) => {
        const A = __bh.camera.airFlight, rows = [], frames = []; const t0 = performance.now(); let last = t0, panel = null, gloc = null;
        while (performance.now() - t0 < maxS * 1000) {
          __bh.touch(); await new Promise((q) => requestAnimationFrame(q));
          const now = performance.now(); frames.push(now - last); last = now;
          const L = A.last; if (!L) continue;
          const r = { t: (now - window.__t0) / 1000, h: L.h / 1e3, v: L.speed / 1e3, g: A.g, q: (L.out.heat ?? 0) / 1e7, aoa: (L.out.alpha ?? 0) * 57.2958,
            shield: A.skin.shield, dt: frames[frames.length - 1] };
          rows.push(r);
          const fi = __bh.camera.flightInfo?.(), p = fi?.craftPanel;
          if (p && p.title === "AIR") panel = p.title + " " + p.rows.map((x) => x.label + " " + x.value).join(" · ");
          if (fi?.body?.gloc && gloc === null) gloc = r;
          if (A.failure || L.h / 1e3 < untilKm) break;
        }
        return { rows, end: rows[rows.length - 1] ?? null, failure: A.failure, panel, frames, gloc }; }; return 1; })()`);
      const start = async (damage: boolean) => {
        const note =
          await app.js<string>(`(() => { Object.assign(__bh.settings, { animate: true, damage: ${damage}, crashSpeed: 1e9, showFps: true, dynamicResolution: true, gVignette: false });
          const n = __bh.game.orbit("jupiter", ${GALILEO}); __bh.settings.shipMount = "cockpit"; __bh.camera.viewReset();
          const P = __bh.camera.pilot; P.sas = true; P.hold = "none"; P.setHold("prograde"); window.__t0 = performance.now(); return n + " · hold " + P.hold; })()`);
        console.log(`  ${note}${damage ? " · damage on" : " · damage off"}`);
      };
      const fly = (untilKm: number, maxS: number) => app.js<Leg>(`window.__fly(${untilKm}, ${maxS})`);
      const line = (r: Row | null) =>
        r
          ? `${r.t.toFixed(1)} s · ${r.h.toFixed(1)} km · ${r.v.toFixed(2)} km/s · ${r.g.toFixed(0)} g · ${r.q.toFixed(1)} kW/cm² · α ${r.aoa.toFixed(1)}° · shield ${r.shield.toFixed(0)} K`
          : "—";

      // ── damage off: the whole entry ──
      await start(false);
      await app.settled();
      const legs: Leg[] = [];
      // (the view from behind, 1.5 s (the camera travels from the cockpit there): the cockpit's back after it — each a view chosen, its look reset (main.ts setMount):
      // the scene's look turned onto the planet kept the craft out of the chase view)
      const chase = async (file: string) => {
        await app.js(
          `(async () => { __bh.settings.shipMount = "chase"; __bh.camera.viewReset(); for (let i = 0; i < 90; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
        );
        await app.shot(file);
        await app.js(`(() => { __bh.settings.shipMount = "cockpit"; __bh.camera.viewReset(); return 1; })()`);
      };
      // (down to 75 km, near the heating's peak: the cockpit in the plasma, then the chase view)
      legs.push(await fly(75, 150));
      console.log(`  at the heating's peak: ${line(legs[0]!.end)}`);
      await app.shot(`${OUT}/plasma-75km.png`);
      await chase(`${OUT}/plasma-75km-chase.png`);
      // (into the ammonia's deck, ~15 km over 1 bar, still at ~12 km/s: the chase view — no trail of the history)
      legs.push(await fly(15, 150));
      console.log(`  in the ammonia: ${line(legs[1]!.end)}`);
      await chase(`${OUT}/ammonia-15km-chase.png`);
      // (the 1 bar level: in the clouds)
      legs.push(await fly(0, 150));
      console.log(`  at 1 bar: ${line(legs[2]!.end)}`);
      await app.shot(`${OUT}/clouds-1bar.png`);
      const rows = legs.flatMap((l) => l.rows);
      const frames = legs.flatMap((l) => l.frames).slice(5);
      for (const r of rows.filter((_, i) => i % 60 === 0)) console.log(`    ${line(r)}`);
      const peak = rows.reduce((a, b) => (b.g > a.g ? b : a));
      const hot = rows.reduce((a, b) => (b.q > a.q ? b : a));
      const at1 = legs[2]!.end!;
      const sorted = [...frames].sort((a, b) => a - b);
      const p50 = sorted[sorted.length >> 1]!,
        p99 = sorted[Math.floor(0.99 * (sorted.length - 1))]!,
        worst = sorted[sorted.length - 1]!;
      console.log(`  peak load ${line(peak)}`);
      console.log(`  peak heat ${line(hot)}`);
      console.log(`  frames: ${frames.length}, median ${p50.toFixed(1)} ms, p99 ${p99.toFixed(1)}, worst ${worst.toFixed(0)}`);
      console.log(`  panel in the clouds: ${legs[2]!.panel}`);
      // (the path: in the air from 450 km, the 1 bar level reached in about a minute and a half, slowed to a few km/s)
      expect(rows[0]!.h).toBeGreaterThan(300);
      expect(rows[0]!.v).toBeGreaterThan(46);
      expect(at1.h).toBeLessThan(0.5);
      expect(at1.t).toBeGreaterThan(60);
      expect(at1.t).toBeLessThan(160);
      expect(at1.v).toBeLessThan(6);
      // (the peak load: the Ranger, far heavier for its area than Galileo's probe, slows deeper down — ~370 g at ~30 km over
      // 1 bar against the probe's 228 high in the stratosphere: a ballistic entry's peak goes as V² sin γ / H, and the air's
      // scale height is shorter there, colder; its lift at its ~9° of attack steepens it too)
      expect(peak.g).toBeGreaterThan(200);
      expect(peak.g).toBeLessThan(600);
      expect(peak.h).toBeGreaterThan(15);
      expect(peak.h).toBeLessThan(120);
      // (the heat: far over Galileo's 30 kW/cm², the radiation of the shock layer at 40+ km/s; past before the peak load)
      expect(hot.q).toBeGreaterThan(300);
      expect(hot.v).toBeGreaterThan(35);
      expect(hot.t).toBeLessThan(peak.t);
      // (the pilot out cold past the peak load — G-LOC, its black-out drawn over the view unless gVignette is off, as here for
      // the shots —: the load at the eyes, game/gstrain.ts)
      const gl = legs.map((l) => l.gloc).find((x) => x);
      console.log(`  G-LOC: ${line(gl ?? null)}`);
      expect(gl).toBeTruthy();
      // (in the clouds: the AIR panel)
      expect(legs[2]!.panel).toContain("AIR");
      // (no page held through the entry)
      expect(p50).toBeLessThan(100);
      expect(worst).toBeLessThan(2000);
      for (const l of legs) expect(l.failure).toBeNull();

      // ── damage on: the shield lost in the heating ──
      await start(true);
      const lost = await fly(-50, 150);
      console.log(`  lost: ${lost.failure} · ${line(lost.end)}`);
      expect(lost.failure).toMatch(/heat shield failed|hull burnt through/);
      expect(lost.end!.h).toBeGreaterThan(30);
      const why = await app.js<string | null>(
        `new Promise((r) => setTimeout(() => r(document.querySelector(".craft-lost .cl-why")?.textContent ?? null), 1500))`,
      );
      console.log(`  craft lost: ${why}`);
      expect(why).toMatch(/heat shield failed|hull burnt through/);
      await app.shot(`${OUT}/lost.png`);
    } finally {
      app.close();
    }
  },
  900_000,
);
