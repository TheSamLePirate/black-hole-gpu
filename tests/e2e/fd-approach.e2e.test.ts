import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { MONITOR_INIT, MONITOR_STEP, type Monitor, monitorProblems } from "./lib/held";

// The flight director flown by hand (docs/PLAN-APPROCHES.md AP7b — controller/ils.ts flightDirector): an approach to Roissy's
// 27R joined from off its axis, below its glideslope, the autopilot let go — the stick only, moved as the director asks (a scripted
// hand: the bank and the flight path's angle still to take, closed as a pilot closes a cue or the bars; the clock frozen, fixed
// steps: E2E-VOLS §3.2) — and established on the localizer and the glideslope. The F-35: the HUD's guidance cue (the flight path
// asked, off the track by the bank still to take); the A320: its FMGC's FD bars — its approach no longer engaging the
// autopilot again once the pilot lets it go. The crew's PFD shows the same bars (crew-approach.e2e.test.ts carries the crew).
//
// Done when: for each craft, the autopilot off for the whole flight, the director flown by the scripted hand alone: the localizer
// and the glideslope within half a dot for 10 s on end, inside 12 km; the director's gaps small then (under 2° of bank, under
// 0.5° of path); the captures taken (the HUD's cue, the A320's PFD).
// Duration: about 2 min (two boots; two flights of 2–3 min of sim time in fixed steps).

const D = Math.PI / 180;

/** The scripted hand: each step, the stick moved as the director asks; the flight stepped; the needles watched. */
const handFly = (maxS: number, k: { bank: number; path: number; max: number }) => `(() => {
  const c = __bh.camera, T = c.touchInput, cl = (x) => Math.max(-${k.max}, Math.min(${k.max}, x));
  let t = 0, held = 0, est = null, apOn = 0, trace = [], last = [], worst = { dB: 0, dG: 0 };
  ${MONITOR_INIT}
  for (let i = 0; i < 30 * ${maxS}; i++) {
    const F = c.flightDirector();
    if (F) { T.roll = cl(F.dBank / (${k.bank} * ${D})); T.pitch = cl(F.dGamma / (${k.path} * ${D})); } else { T.roll = T.pitch = 0; }
    // (a pilot's restraint — rule 13: no pull past 80 % of the stall's incidence; the F-35's full stick at 92 m/s took it to 33° of
    // pitch and 122 % of it, kerr-mini 16 Nov 2026)
    const A = c.airInfo ? c.airInfo() : null;
    if (A && A.stallA && A.alpha > 0.8 * A.stallA) T.pitch = Math.min(T.pitch, 0);
    __bh.step(1 / 30); t += 1 / 30;
    ${MONITOR_STEP}
    const I = c.ilsInfo();
    if (c.a320Fmgc?.ap || (c.jetModes && (c.jetModes.alt !== null || c.jetModes.hdg !== null)) || (c.ilsRun && !c.ilsRun.manual)) apOn++;
    if (i % 300 === 0) trace.push(t.toFixed(0) + " s " + (I ? I.phase + " loc " + (I.loc ?? NaN).toFixed(2) + " gs " + (I.gs ?? NaN).toFixed(2) + " dme " + I.dme.toFixed(1) : "no ils") + (F ? " fd dB " + (F.dBank / ${D}).toFixed(1) + " dG " + (F.dGamma / ${D}).toFixed(2) : " no fd") + " stick " + T.pitch.toFixed(2) + "/" + T.roll.toFixed(2) + " pitch " + ((c.attitudeNow().pitch ?? NaN) / ${D}).toFixed(1) + " fpa " + (c.a320FmgcIn?.fpa ?? NaN).toFixed(1) + " in " + (c.a320FmgcIn ? c.a320FmgcIn.stick.map((x) => x.toFixed(2)).join("/") : "-") + " ias " + (c.a320FmgcIn?.ias ?? NaN).toFixed(0) + (c.a320Fmgc ? " thr " + c.a320Fmgc.thrust + " n1 " + c.a320FmgcIn.n1.now.toFixed(0) + " tgt " + c.a320Fmgc.targetSpeed(c.a320FmgcIn).toFixed(0) + " flap " + c.a320FmgcIn.flapLever + " det " + c.a320FmgcIn.detent + " athr " + c.a320Fmgc.athr + "/" + c.a320Fmgc.athrActive : ""));
    const ok = I && I.loc !== null && I.gs !== null && Math.abs(I.loc) < 0.5 && Math.abs(I.gs) < 0.5 && I.dme < 12;
    held = ok ? held + 1 / 30 : 0;
    // (the director's gaps over the last second: flown onto it, they are small)
    last.push(F ? [Math.abs(F.dBank) / ${D}, Math.abs(F.dGamma) / ${D}] : [99, 99]); if (last.length > 30) last.shift();
    if (held >= 9 && i % 6 === 0) trace.push("  " + t.toFixed(1) + " s dB " + last.at(-1)[0].toFixed(1) + " dG " + last.at(-1)[1].toFixed(2));
    if (held >= 10) { est = { dme: I.dme, loc: I.loc, gs: I.gs, phase: I.phase, ias: c.a320FmgcIn?.ias ?? c.geoNow().gs * 1.944 };
      worst = { dB: Math.max(...last.map((x) => x[0])), dG: Math.max(...last.map((x) => x[1])) }; break; }
  }
  T.roll = T.pitch = 0;
  return { est, t, apOn, trace, worst, mon: window.__mon };
})()`;

/** 27R's axis: a place `km` out, `across` m to the right of it (looking down the final). */
const onAxis = (
  km: number,
  across: number,
) => `(async () => { const l = await __bh.sys.approaches("LFPG"), a = l.find((x) => x.id === "I27R");
  const R = 6371000, back = (a.crs + 180) * ${D}, la = a.thr.lat * ${D}, lo = a.thr.lon * ${D};
  const go = (la, lo, b, d) => { const lat = Math.asin(Math.sin(la) * Math.cos(d / R) + Math.cos(la) * Math.sin(d / R) * Math.cos(b));
    return [lat, lo + Math.atan2(Math.sin(b) * Math.sin(d / R) * Math.cos(la), Math.cos(d / R) - Math.sin(la) * Math.sin(lat))]; };
  const [p1, q1] = go(la, lo, back, ${km * 1000});
  const [p2, q2] = go(p1, q1, (a.crs + 90) * ${D}, ${across});
  return { lat: p2 / ${D}, lon: q2 / ${D}, crs: a.crs, elev: a.thr.alt ?? 0 }; })()`;

for (const craft of ["f35", "a320"] as const) {
  describe.skipIf(!E2E)(`the flight director flown by hand: ${craft}`, () => {
    let app: App;
    const shots = process.env.E2E_SHOTS;
    beforeAll(async () => {
      app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
      await app.js(
        `(() => { Object.assign(__bh.settings, { vessel: "${craft}", traffic: false, damage: false, weather: "fair", wind: 0 }); __bh.game.setDate("2026-07-10T11:00:00Z"); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "${craft}"`, 30_000);
      await app.js(`__bh.sys.approaches("LFPG").then((l) => l.length)`);
    }, 300_000);
    afterAll(() => {
      app?.close();
      stopServer();
    });

    test("off the axis, under the glideslope, the autopilot let go: established on the director alone", async () => {
      // (14 km out, 900 m to the right, 30° in, some 600 m over the ground — under the slope's 730 m there)
      const p = await app.js<{ lat: number; lon: number; crs: number }>(onAxis(14, 900));
      const spd = craft === "f35" ? 92 : 82;
      await app.js(`(() => { __bh.freeze(false); __bh.game.flyAt(${p.lat}, ${p.lon}, 600, ${p.crs - 30}, ${spd});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); __bh.freeze(true); return 1; })()`);
      for (let i = 0; i < 5; i++) await app.js(`(__bh.step(1 / 30), 1)`);
      if (craft === "f35") await app.js(`(() => { __bh.fleet.fuel.f35 = 3000; return 1; })()`);
      else await app.js(`(() => { __bh.camera.pilot.throttle = 0.62; __bh.camera.gearDown = false; return 1; })()`);
      const said = await app.js<string>(`__bh.camera.ilsStart("LFPG", { runway: "27R" })`);
      console.log(`  ${said}`);
      // the autopilot let go: the F-35's approach taken by the stick (its holds off, its autothrottle on at the approach's
      // speed); the A320's AP1 off (its FD on), its autothrust kept
      if (craft === "f35") {
        await app.js(`(() => { const c = __bh.camera; c.ilsRun.manual = true; const m = c.jetModes;
          if (m.alt !== null || m.hdg !== null) c.jetToggle("ap"); if (m.spd === null) c.jetToggle("athr"); m.spd = 85; return 1; })()`);
      } else {
        // (the approach engages AP1 itself — 5 s after a lift-off, flyAt's placing counted as one —; then let go by its key)
        await app.js(`(() => { for (let i = 0; i < 30 * 7; i++) __bh.step(1 / 30); return 1; })()`);
        const off = await app.js<string>(
          `(() => { const c = __bh.camera; return c.a320Fmgc.ap ? c.jetToggle("ap") : "AP already off"; })()`,
        );
        // (the levers in the CL detent: the autothrust holds the speed — out of it, its thrust the levers', the A320 ran to 257 kt)
        console.log(`  ${off}`);
      }
      const r = await app.js<{
        est: { dme: number; loc: number; gs: number; phase: string; ias: number } | null;
        t: number;
        apOn: number;
        trace: string[];
        worst: { dB: number; dG: number };
        mon: Monitor;
      }>(handFly(240, craft === "f35" ? { bank: 15, path: 4, max: 0.5 } : { bank: 25, path: 8, max: 0.5 }));
      console.log(`  the flight, every 10 s:\n    ${r.trace.join("\n    ")}`);
      console.log(
        `  ${r.est ? `established ${r.est.dme.toFixed(1)} km out after ${r.t.toFixed(0)} s (${r.est.phase}, loc ${r.est.loc.toFixed(2)}, gs ${r.est.gs.toFixed(2)}, ${r.est.ias.toFixed(0)} kt)` : "never established"}; autopilot on ${r.apOn} steps; the director's largest gaps over its last second: bank ${r.worst.dB.toFixed(1)}°, path ${r.worst.dG.toFixed(2)}°`,
      );
      if (shots) {
        await Bun.$`mkdir -p ${shots}`;
        await app.js(
          `(async () => { __bh.freeze(false); const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 20; i++) await f(); __bh.freeze(true); return 1; })()`,
        );
        await app.shot(`${shots}/fd-${craft}.png`);
      }
      expect(r.apOn).toBe(0);
      expect(r.est).not.toBeNull();
      expect(r.worst.dB).toBeLessThan(2);
      expect(r.worst.dG).toBeLessThan(0.5);
      // (rule 13: flown by hand on the director — the autopilot off by design, the autothrottle held, never at idle with nobody on the
      // throttle, never near the stall)
      const prob = monitorProblems(r.mon, { ap: false });
      console.log(`  rule 13: ${JSON.stringify(r.mon)}${prob.length ? ` — ${prob.join("; ")}` : " — conforms"}`);
      expect(prob).toEqual([]);
    }, 240_000);
  });
}
