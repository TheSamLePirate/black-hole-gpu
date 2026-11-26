// The A320 flown as a line crew flies it (Sam, 26 Nov 2026: « fais des tests de vol A320 — des vrais vols, décollage, manœuvres,
// avec autopilotes, approches, atterrissages — et vérifie la physique du vol de l'A320 afin qu'il vole bien (PID, oscillations) »).
// Lined up on a runway, ready (engines running), CONF 1+F, TOGA; the side stick pulled at VR as a pilot would (half back, let go once
// flying: the normal law holds the path); gear up; CL at 1 500 ft over the field (the A/THR, armed at the take-off, becomes active);
// AP1 5 s after the lift-off; then the FCU as a crew turns and pulls it — an altitude, a speed, a heading 90° off and back, a V/S
// descent to a lower level —; then the ILS asked of the game (camera.ilsStart: the FMGC flies the join, LOC, G/S, LAND, FLARE,
// ROLL OUT), to a stop. Each phase measured on the page's own record (every 250 ms of the wall: the FMGC's inputs — IAS, altitude,
// V/S, heading —, the attitude, the FMA): the captures' overshoots, the swings of pitch, bank and speed in the holds, the bank's peak
// in the turns, the touchdown. A flight flown live in the page's frame loop, as a player sees it.
import { readFileSync } from "node:fs";
import type { Lab } from "../lib/lab";
import type { Scenario, Verdict } from "./helpers";

/** a field the A320 lines up on (game/sites.ts lineUp by name) and its ILS's airfield (camera.ilsStart) */
interface Field {
  id: string;
  site: string;
  icao: string;
  /** its longitude [°E]: the flight flown at the field's own noon (Sam, 26 Nov 2026: « les prochains vols, fais-les en journée ») */
  lon: number;
}
const FIELDS: Field[] = [{ id: "lfpb", site: "Paris – Le Bourget", icao: "LFPB", lon: 2.44 }];

/** one record of the page's sampler */
interface Rec {
  t: number;
  ph: string;
  ias: number;
  alt: number;
  vs: number;
  hdg: number;
  pitch: number;
  bank: number;
  fma: string;
  ap: boolean;
  athr: boolean;
  agl: number;
  ground: boolean;
  thr: number;
}

/** Reversals of a series by more than `min` (each swing's turn), and its peak-to-peak. */
function swings(v: number[], min: number) {
  let n = 0,
    dir = 0,
    ext = v[0] ?? 0;
  for (const x of v) {
    const d = x - ext;
    if (dir >= 0 && d < -min) {
      if (dir > 0) n++;
      dir = -1;
      ext = x;
    } else if (dir <= 0 && d > min) {
      if (dir < 0) n++;
      dir = 1;
      ext = x;
    } else if ((dir > 0 && x > ext) || (dir < 0 && x < ext)) ext = x;
  }
  return { n, pp: v.length ? Math.max(...v) - Math.min(...v) : 0 };
}
const r1 = (x: number) => Math.round(x * 10) / 10;

async function line(lab: Lab, f: Field): Promise<Verdict> {
  const m: Record<string, unknown> = {};
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) fails.push(what);
    lab.note("note", `${ok ? "✓" : "✗"} ${what}`);
  };
  // the craft, the day, calm air
  await lab.js(`(() => {
    Object.assign(__bh.settings, { vessel: "a320", a320Start: "ready", traffic: false, weather: "fair", wind: 0, earthClouds: 0 });
    // (the field's solar noon: daylight the whole flight)
    __bh.setDate(Date.UTC(2026, 10, 5, 12) - ${f.lon} * 240000);
    return true;
  })()`);
  await lab.app.waitProgress(`__bh.fleet.active === "a320"`, "the A320");
  // (its systems are made by its first frames: the sim running until they are, then held while the place's data come)
  await lab.js(`(__bh.freeze(false), __bh.game.lineUp(${JSON.stringify(f.site)}), true)`);
  await lab.app.waitProgress("!!__bh.camera.a320Sys", "the A320's systems");
  await lab.js("(__bh.freeze(true), true)");
  await lab.ready(`${f.site}'s data`);
  // (the page's own record, every 250 ms of the wall: what a crew reads)
  await lab.js(`(() => {
    const c = __bh.camera;
    window.__a3 = { ph: "lineup", rec: [] };
    clearInterval(window.__a3t);
    window.__a3t = setInterval(() => { try {
      const i = c.a320FmgcIn, F = c.a320Fmgc, a = c.attitudeNow();
      if (!i || !F) return;
      const x = F.fma();
      window.__a3.rec.push({ t: __bh.sim.time * 4.925490947e-6 * __bh.settings.massSolar, ph: window.__a3.ph, ias: i.ias, alt: i.alt, vs: i.vs,
        hdg: i.hdg, pitch: (a.pitch ?? 0) * 57.2958, bank: (a.bank ?? 0) * 57.2958,
        fma: [x.thr, x.vert, x.lat].map((q) => (Array.isArray(q) ? q[0] : q?.text ?? q ?? "")).join("|"),
        ap: !!F.ap, athr: !!F.athr, agl: i.ra ?? 0, ground: !!(c.rolling || c.ourLanded), thr: c.pilot.throttle });
    } catch (e) {} }, 250);
    __bh.settings.shipMount = "cockpit";
    return true;
  })()`);
  const phase = (p: string) => lab.js(`(window.__a3.ph = ${JSON.stringify(p)}, true)`);
  const rec = () => lab.js<Rec[]>("window.__a3.rec");

  // 1 — the take-off: CONF 1+F, TOGA, the stick half back at VR (~135 kt), let go 3 s after the lift-off
  await phase("takeoff");
  await lab.js(`(() => {
    const c = __bh.camera;
    c.airFlight.cfg.flaps = 0.25; c.a320Park = false; c.pilot.throttle = 1;
    c.__in ??= c.pilotInput.bind(c);
    window.__liftAt = null;
    c.pilotInput = (pad) => { const i = c.__in(pad); const F = c.a320FmgcIn; const g = c.rolling || c.ourLanded;
      if (!g && window.__liftAt === null) window.__liftAt = __bh.sim.time;
      const since = window.__liftAt === null ? 0 : (__bh.sim.time - window.__liftAt) * 4.925490947e-6 * __bh.settings.massSolar;
      return (F && F.ias > 133 && since < 3) ? { ...i, pitch: 0.5 } : i; };
    return true;
  })()`);
  let e = await lab.live({ until: "!c.rolling && !c.ourLanded && (c.a320FmgcIn?.ra ?? 0) > 50", maxWall: 120, everyMs: 500 });
  check(e.why !== "fail" && e.why !== "cap", `lift-off (${e.why})`);
  // 2 — gear up; CL at 1 500 ft over the field; AP1 5 s after the lift-off
  await lab.js(`(__bh.camera.gearDown = false, true)`);
  e = await lab.live({ until: "(c.a320FmgcIn?.ra ?? 0) > 1500", maxWall: 120, everyMs: 500 });
  await lab.js(`(() => { const c = __bh.camera; c.pilotInput = c.__in; c.pilot.throttle = 0.6;
    const said = c.a320ApKey("ap"); if (!c.a320Fmgc.athr) c.a320ApKey("athr"); return said; })()`);
  await phase("climb");
  const ap = await lab.js<{ ap: boolean; athr: boolean; fma: unknown }>(
    `(() => { const F = __bh.camera.a320Fmgc; return { ap: F.ap, athr: F.athr, fma: F.fma() }; })()`,
  );
  check(ap.ap && ap.athr, `AP1 and A/THR engaged at 1 500 ft (${JSON.stringify(ap.fma)})`);
  // (the flaps up as the speed builds: S then F — the crew's own steps)
  e = await lab.live({ until: "(c.a320FmgcIn?.ias ?? 0) > 185", maxWall: 120, everyMs: 500 });
  await lab.js(`(__bh.camera.airFlight.cfg.flaps = 0, true)`);
  // 3 — the FCU: 7 000 ft, 250 kt, pulled (selected: OP CLB, SPEED)
  const fcu = (js: string) =>
    lab.js<string>(`(() => { const c = __bh.camera, F = c.a320Fmgc, i = c.a320FmgcIn; ${js}; return JSON.stringify(F.fma()); })()`);
  lab.note("note", `FCU ALT 7000 SPD 250: ${await fcu("F.alt = 7000; F.altPull(i); F.spd = 250; F.spdPull(i); F.spd = 250")}`);
  await phase("climb7000");
  e = await lab.live({ until: "(c.a320FmgcIn?.alt ?? 0) > 6950", maxWall: 300, everyMs: 1000 });
  check(e.why === "until", `7 000 ft reached (${e.why})`);
  await phase("hold7000");
  const t0 = await lab.js<number>("window.__lab.sample().t");
  e = await lab.live({ until: `T.t > ${t0 + 60}`, maxWall: 120, everyMs: 1000 });
  // 4 — a turn 90° right, then back
  const hdg0 = await lab.js<number>("Math.round(__bh.camera.a320FmgcIn.hdg)");
  const right = (hdg0 + 90) % 360 || 360;
  lab.note("note", `HDG ${right}: ${await fcu(`F.hdgPull(i); F.hdg = ${right}`)}`);
  await phase("turnR");
  e = await lab.live({
    until: `Math.abs(((c.a320FmgcIn.hdg - ${right} + 540) % 360) - 180) < 2 && Math.abs(c.attitudeNow().bank * 57.3) < 2`,
    maxWall: 180,
    everyMs: 500,
  });
  check(e.why === "until", `heading ${right}° captured (${e.why})`);
  await phase("holdR");
  let t1 = await lab.js<number>("window.__lab.sample().t");
  e = await lab.live({ until: `T.t > ${t1 + 30}`, maxWall: 60, everyMs: 1000 });
  lab.note("note", `HDG ${hdg0}: ${await fcu(`F.hdg = ${hdg0}`)}`);
  await phase("turnL");
  e = await lab.live({
    until: `Math.abs(((c.a320FmgcIn.hdg - ${hdg0} + 540) % 360) - 180) < 2 && Math.abs(c.attitudeNow().bank * 57.3) < 2`,
    maxWall: 180,
    everyMs: 500,
  });
  check(e.why === "until", `heading ${hdg0}° captured (${e.why})`);
  // 5 — V/S −1 500 ft/min to 4 000 ft, 220 kt
  lab.note("note", `ALT 4000 V/S -1500 SPD 220: ${await fcu("F.alt = 4000; F.vsPull(i); F.vs = -1500; F.spd = 220")}`);
  await phase("descent");
  e = await lab.live({ until: "(c.a320FmgcIn?.alt ?? 1e9) < 4050", maxWall: 300, everyMs: 1000 });
  check(e.why === "until", `4 000 ft reached (${e.why})`);
  await phase("hold4000");
  t1 = await lab.js<number>("window.__lab.sample().t");
  e = await lab.live({ until: `T.t > ${t1 + 45}`, maxWall: 90, everyMs: 1000 });
  // 6 — the ILS asked of the game: the FMGC's approach, to a stop
  const said = await lab.js<string>(`__bh.camera.ilsStart(${JSON.stringify(f.icao)})`);
  lab.note("note", `ilsStart: ${said}`);
  await phase("approach");
  e = await lab.live({ until: "!!c.ilsLast || !!c.airFlight.failure", maxWall: 1200, everyMs: 1000 });
  await phase("rollout");
  e = await lab.live({ until: "c.ourLanded && (c.a320FmgcIn?.ias ?? 99) < 5", maxWall: 120, everyMs: 1000 });
  const L = await lab.js<{ score: number; notes: string[]; touch: { along: number; across: number; vs: number } | null } | null>(
    "__bh.camera.ilsLast",
  );
  const fail = await lab.js<string | null>("__bh.camera.airFlight.failure");
  check(!fail, `no failure (${fail ?? "—"})`);
  check(!!L?.touch, `touchdown on the runway (${JSON.stringify(L?.touch ?? null)}, grade ${L?.score ?? "—"})`);

  // the phases measured
  const R = await rec();
  await lab.js("(clearInterval(window.__a3t), true)");
  const of = (p: string) => R.filter((q) => q.ph === p);
  const climb = of("climb7000");
  const hold7 = of("hold7000");
  const hold4 = of("hold4000");
  const tR = of("turnR"),
    tL = of("turnL");
  const altOver7 = hold7.length ? Math.max(...hold7.map((q) => q.alt)) - 7000 : null;
  const altUnder4 = hold4.length ? 4000 - Math.min(...hold4.map((q) => q.alt)) : null;
  const hdgErr = (q: Rec, h: number) => ((q.hdg - h + 540) % 360) - 180;
  m.alt_over_7000_ft = altOver7 === null ? null : r1(altOver7);
  m.alt_under_4000_ft = altUnder4 === null ? null : r1(altUnder4);
  m.hold7000_pitch = swings(
    hold7.map((q) => q.pitch),
    0.5,
  );
  m.hold7000_ias = swings(
    hold7.map((q) => q.ias),
    2,
  );
  m.hold7000_alt_pp_ft = r1(
    swings(
      hold7.map((q) => q.alt),
      20,
    ).pp,
  );
  m.hold4000_ias = swings(
    hold4.map((q) => q.ias),
    2,
  );
  m.hold4000_alt_pp_ft = r1(
    swings(
      hold4.map((q) => q.alt),
      20,
    ).pp,
  );
  m.climb_pitch = swings(
    climb.map((q) => q.pitch),
    1,
  );
  m.climb_ias = swings(
    climb.map((q) => q.ias),
    3,
  );
  m.turnR_bank_max = r1(Math.max(0, ...tR.map((q) => Math.abs(q.bank))));
  m.turnR_hdg_over = r1(Math.max(0, ...tR.map((q) => hdgErr(q, right))));
  m.turnL_bank_max = r1(Math.max(0, ...tL.map((q) => Math.abs(q.bank))));
  m.turnL_hdg_over = r1(Math.max(0, ...tL.map((q) => -hdgErr(q, hdg0))));
  m.turn_bank_swings = swings(
    [...tR, ...tL].map((q) => q.bank),
    3,
  ).n;
  m.touch = L?.touch ?? null;
  m.grade = L?.score ?? null;
  m.fmas = [...new Set(R.map((q) => `${q.ph}:${q.fma}`))].slice(0, 80);
  // (the record whole, for the analysis)
  await Bun.write(`${lab.o.dir}/a320-record.json`, JSON.stringify(R));
  // the judgement: what a crew would call flying well
  check((altOver7 ?? 999) < 150, `7 000 ft captured within 150 ft (${m.alt_over_7000_ft} ft over)`);
  check((altUnder4 ?? 999) < 150, `4 000 ft captured within 150 ft (${m.alt_under_4000_ft} ft under)`);
  check((m.hold7000_pitch as { n: number }).n <= 2, `pitch calm at 7 000 ft (${JSON.stringify(m.hold7000_pitch)} reversals > 0.5°)`);
  check((m.hold7000_ias as { n: number }).n <= 2, `speed calm at 7 000 ft (${JSON.stringify(m.hold7000_ias)} reversals > 2 kt)`);
  check(
    (m.turnR_bank_max as number) <= 30 && (m.turnL_bank_max as number) <= 30,
    `bank ≤ 30° in the turns (${m.turnR_bank_max}°, ${m.turnL_bank_max}°)`,
  );
  check(
    (m.turnR_hdg_over as number) < 5 && (m.turnL_hdg_over as number) < 5,
    `headings captured within 5° (${m.turnR_hdg_over}°, ${m.turnL_hdg_over}°)`,
  );
  check((m.turn_bank_swings as number) <= 4, `no bank swinging in the turns (${m.turn_bank_swings} reversals > 3°)`);
  check(!!L?.touch && Math.abs(L.touch.vs) < 3 && Math.abs(L.touch.across) < 10, `touchdown < 3 m/s, < 10 m off the axis`);
  void readFileSync;
  return { ok: fails.length === 0, why: fails.length ? `✗ ${fails.join(" · ")}` : "✓ the line flight flown well", metrics: m };
}

export const A320: Scenario[] = FIELDS.map((f) => ({
  id: `a320-line-${f.id}`,
  title: `A320 — a line flight from ${f.site}: TOGA, AP1, FCU levels, turns, V/S, the ILS, the autoland, to a stop`,
  tags: ["a320", "plane", "runway", "live", "autopilot", "ils"],
  minutes: 22,
  tiles: false,
  run: (lab) => line(lab, f),
}));
