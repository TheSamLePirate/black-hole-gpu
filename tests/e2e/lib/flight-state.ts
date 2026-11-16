// An aircraft's state as an e2e asserts it (docs/E2E-VOLS.md, rule 13 — Sam, 16 Nov 2026: « les tests e2e en avion doivent être
// parfaits — autopilot, gear, autothrust »): what is really applied, not what was asked — the autopilot and the autothrottle engaged
// (the F-35's holds, its ILS flying, its NAV; the A320's FMGC), the thrust the engines give (pilot.engineNow, not the lever), the gear
// down and locked or up, the speed against the stall, a plausible attitude.
//   - `flightState(app)` reads it in the page;
//   - `placeJetFrozen` places a jet frozen, waits for the data, places it again and engages its holds (no glide at idle meanwhile);
//   - `expectFlight(state, label, check)` asserts explicit bounds (`CRUISE` the cruise's) — the render session's parcours-*;
//   - `flightProblems(state, phase)` / `expectFlightPhase(app, phase)` judge a phase (cruise, approach, final, flare, ground, lineup,
//     roll) — pure, tested without a browser (tests/e2e-flight-state.test.ts);
//   - on the runway (Sam, 16 Nov 2026: « un A320 pas bien aligné au décollage »): the axis — the heading's and the track's error to
//     the runway's, the distance across its centreline — in the state (`axis`), judged at the line-up and through the take-off roll
//     (`AXIS_LIMITS`), watched each tenth of a second during a roll (`AXIS_WATCH_START` / `AXIS_WATCH_READ`, `axisWatchProblems`).
import { expect } from "bun:test";
import type { App } from "./app";

export interface FlightState {
  craft: string;
  /** in the air (the airframe's own judgement), on the wheels (rolling or landed) */
  inAir: boolean;
  onGround: boolean;
  /** an autopilot flying it: the F-35's altitude/heading holds, its ILS approach not taken by the stick, its NAV; the A320's AP1 */
  ap: boolean;
  /** the autothrottle: the F-35's speed hold (or its ILS, which sets its own speed); the A320's A/THR engaged */
  athr: boolean;
  /** the thrust the engines give now 0…1 (spooled), the lever asked */
  engine: number;
  lever: number;
  /** the gear lever down, its extension 0…1 (1: down and locked) */
  gearDown: boolean;
  gearExt: number;
  /** the airspeed [m/s], the ground speed, the vertical speed [m/s], the height over the ground [m] */
  speed: number;
  gs: number;
  vs: number;
  agl: number;
  /** the incidence and the wing's stall incidence [rad] (null: no wing); stalled */
  alpha: number;
  stallA: number | null;
  stalled: boolean;
  /** the attitude [°] */
  pitch: number;
  bank: number;
  /** the simulation frozen (__bh.freeze) */
  frozen: boolean;
  /** on the wheels with a runway in reach (runwayView): its end, the heading's and the track's error to its heading [°] (the track
   *  null below 3 m/s), the distance across its centreline [m, > 0 right] and along from its threshold [m]; null otherwise */
  axis: RunwayAxis | null;
  /** the autothrottle's speed target [m/s] where it is known (the F-35's holds: jetModes.spd); null otherwise (an ILS, the A320's) */
  spdTarget: number | null;
}

export interface RunwayAxis {
  des: string;
  hdgErr: number;
  trkErr: number | null;
  across: number;
  along: number;
}

/** A craft on a runway as a pilot keeps it: at the line-up, its nose on the axis (≤ 1°) and on the centreline (≤ 3 m); through the
 *  roll to the rotation, within 3° and 6 m (the A320's main gear 7.6 m apart on a 45 m runway: a pilot keeps the nose wheel on the
 *  centreline's lights). */
export const AXIS_LIMITS = { lineup: { hdg: 1, across: 3 }, roll: { hdg: 3, across: 6 } };

/** The axis read in the page (an expression; null off the runway) — `c`, `g`, `att`, `D` in scope as in FLIGHT_STATE_JS. */
const AXIS_EXPR = `(() => { if (!(c.rolling || c.ourLanded)) return null; const rv = c.runwayView ? c.runwayView() : null; if (!rv) return null;
    const w = (x) => ((((x + 540) % 360) + 360) % 360) - 180;
    return { des: String(rv.des ?? Math.round(rv.rwy / 10)), hdgErr: w((att.heading ?? 0) * D - rv.rwy),
      trkErr: g && g.gs > 3 ? w(g.track * D - rv.rwy) : null, across: rv.across, along: rv.along }; })()`;

/** The page's script that reads the state (one expression). */
export const FLIGHT_STATE_JS = `(() => {
  const c = __bh.camera, F = __bh.fleet, S = __bh.sys, M = c.jetModes, G = c.a320Fmgc, air = c.airInfo ? c.airInfo() : {};
  const g = c.geoNow(), att = c.attitudeNow(), D = 180 / Math.PI;
  const a320 = F.active === "a320";
  const ilsFlying = !!c.ilsRun && !c.ilsRun.manual;
  const pose = F.pose(F.active, __bh.sim.time);
  return {
    craft: F.active,
    inAir: !!air.inAir,
    onGround: !!(c.rolling || c.ourLanded),
    ap: a320 ? !!G?.ap : ilsFlying || (M ? M.alt !== null || M.hdg !== null : false) || !!c.nav?.on?.l,
    athr: a320 ? !!G?.athr : ilsFlying || (M ? M.spd !== null : false) || !!c.nav?.on?.v,
    engine: c.pilot.engineNow ?? 0,
    lever: c.pilot.throttle ?? 0,
    gearDown: !!c.gearDown,
    gearExt: c.gearExt ?? (c.gearDown ? 1 : 0),
    speed: air.speed ?? 0,
    gs: g?.gs ?? 0,
    vs: g?.vs ?? 0,
    agl: S.heightOverGround("earth", pose.X, __bh.sim.time),
    alpha: air.alpha ?? 0,
    stallA: air.stallA ?? null,
    stalled: !!air.stalled,
    pitch: (att.pitch ?? 0) * D,
    bank: (att.bank ?? 0) * D,
    frozen: __bh.held?.() === "frozen",
    spdTarget: !a320 && M && M.spd !== null ? M.spd : null,
    axis: ${AXIS_EXPR},
  };
})()`;

export function flightState(app: App): Promise<FlightState> {
  return app.js<FlightState>(FLIGHT_STATE_JS);
}

/** A flight's phase as the test sees it: cruise (gear up, AP/ATHR as asked), approach (gear as asked), final (under 300 m on the
 *  final: gear down and locked), flare (the last metres: the thrust may be idle), ground (on the wheels). */
export type FlightPhase = "cruise" | "approach" | "final" | "flare" | "ground" | "lineup" | "roll";

export interface FlightWant {
  /** an autopilot and an autothrottle expected engaged (default: true in cruise and approach) */
  ap?: boolean;
  athr?: boolean;
  /** the gear expected down (default: up in cruise, down in final and flare, either in approach) */
  gear?: boolean;
}

/** Idle thrust a pilot would leave: an autothrottle engaged — slowing to its target, settling just after it was engaged, a descent
 *  at idle on the slope: its own decision (one stuck at idle shows as the speed lost and the stall's edge, judged apart). Without an
 *  autothrottle, idle is a glide. (16 Nov 2026: « over its target by 3 m/s » first — the render session's ILS at 139 m/s —, then
 *  approach-audio's F-35 placed at 85 m/s, its ATHR at idle for its first second: a pilot's.) */
export function idleAllowed(s: FlightState): boolean {
  return s.athr;
}

/** What is wrong with a state for a phase (empty: none). */
export function flightProblems(s: FlightState, phase: FlightPhase, want: FlightWant = {}): string[] {
  const out: string[] = [];
  const onRunway = phase === "lineup" || phase === "roll";
  const airborne = phase !== "ground" && !onRunway;
  if (onRunway) {
    const L = AXIS_LIMITS[phase];
    if (!s.onGround) out.push("not on the ground");
    if (!s.axis) out.push("no runway under it (runwayView)");
    else {
      if (Math.abs(s.axis.hdgErr) > L.hdg) out.push(`heading ${s.axis.hdgErr.toFixed(1)}° off runway ${s.axis.des}'s axis`);
      if (Math.abs(s.axis.across) > L.across)
        out.push(`${Math.abs(s.axis.across).toFixed(1)} m ${s.axis.across > 0 ? "right" : "left"} of runway ${s.axis.des}'s centreline`);
    }
  }
  if (airborne) {
    if (s.onGround) out.push("on the ground in flight");
    // (frozen is no fault: a stepped flight — __bh.step, the clock held — is read frozen; the wait at idle is the guard's to catch)
    const ap = want.ap ?? (phase === "cruise" || phase === "approach");
    const athr = want.athr ?? (phase === "cruise" || phase === "approach");
    if (ap && !s.ap) out.push("no autopilot engaged");
    if (athr && !s.athr) out.push("no autothrottle engaged");
    // (the thrust applied: never a glide at idle with the lever at 0 outside the flare — idle under an autothrottle slowing to its
    // target is a pilot's, the render session's ILS engaged at 139 m/s, 16 Nov 2026: `idleAllowed`)
    if (phase !== "flare" && s.engine < 0.05 && !idleAllowed(s))
      out.push(`no thrust (engine ${s.engine.toFixed(2)}, lever ${s.lever.toFixed(2)})`);
    if (s.stalled) out.push("stalled");
    if (s.stallA !== null && s.alpha > 0.92 * s.stallA)
      out.push(`incidence ${((s.alpha * 180) / Math.PI).toFixed(1)}° at the stall's edge (${((s.stallA * 180) / Math.PI).toFixed(1)}°)`);
    if (s.speed < 40) out.push(`airspeed ${s.speed.toFixed(0)} m/s`);
    if (Math.abs(s.bank) > 60) out.push(`bank ${s.bank.toFixed(0)}°`);
    if (s.pitch > 30 || s.pitch < -25) out.push(`pitch ${s.pitch.toFixed(0)}°`);
    if (s.agl < 30 && phase !== "flare" && phase !== "final") out.push(`${s.agl.toFixed(0)} m over the ground`);
  }
  const gear = want.gear ?? (phase === "cruise" ? false : phase === "approach" ? undefined : true);
  if (gear === true && !(s.gearDown && s.gearExt >= 0.99))
    out.push(`gear not down and locked (lever ${s.gearDown}, ${(s.gearExt * 100).toFixed(0)} %)`);
  if (gear === false && (s.gearDown || s.gearExt > 0.01)) out.push(`gear not up (lever ${s.gearDown}, ${(s.gearExt * 100).toFixed(0)} %)`);
  return out;
}

/** Explicit bounds for `expectFlight`: the holds, the thrust, the airspeed, the attitude, the height over the ground, the gear. */
export interface FlightCheck {
  ap?: boolean;
  athr?: boolean;
  engineMin?: number;
  speedMin?: number;
  pitchMax?: number;
  bankMax?: number;
  aglMin?: number;
  /** the gear down and locked (true) or up (false); absent: not checked */
  gear?: boolean;
}

/** A cruise flown as a pilot would leave it: its holds engaged, its engine giving thrust, flying fast enough, level-ish, gear up. */
export const CRUISE: FlightCheck = { ap: true, athr: true, engineMin: 0.05, speedMin: 60, pitchMax: 25, bankMax: 35, gear: false };

/** A state asserted against explicit bounds (bun's expect, its label in each message). */
export function expectFlight(s: FlightState, label: string, c: FlightCheck): void {
  const at = (what: string) => `${label}: ${what} — ${JSON.stringify(s)}`;
  if (c.ap !== undefined) expect(s.ap, at("autopilot")).toBe(c.ap);
  if (c.athr !== undefined) expect(s.athr, at("autothrottle")).toBe(c.athr);
  if (c.engineMin !== undefined && !idleAllowed(s)) expect(s.engine, at("thrust applied (engineNow)")).toBeGreaterThanOrEqual(c.engineMin);
  if (c.speedMin !== undefined) expect(s.speed, at("airspeed")).toBeGreaterThanOrEqual(c.speedMin);
  if (c.pitchMax !== undefined) expect(Math.abs(s.pitch), at("pitch")).toBeLessThanOrEqual(c.pitchMax);
  if (c.bankMax !== undefined) expect(Math.abs(s.bank), at("bank")).toBeLessThanOrEqual(c.bankMax);
  if (c.aglMin !== undefined) expect(s.agl, at("height over the ground")).toBeGreaterThanOrEqual(c.aglMin);
  if (c.gear !== undefined) expect(s.gearDown && s.gearExt >= 0.99, at(c.gear ? "gear down and locked" : "gear up")).toBe(c.gear);
  expect(s.stalled, at("stalled")).toBe(false);
}

/**
 * A jet placed frozen (rule 13: never a glide at idle while the data load): frozen, placed (`placeJs`), `wait()` for its data, placed
 * again on the relief now in, its holds engaged — the altitude it is at, `hdgDeg`, `spd` [m/s] —, let go and flown 2 s; its state.
 */
export async function placeJetFrozen(
  app: App,
  placeJs: string,
  o: { hdgDeg: number; spd: number },
  wait: () => Promise<void>,
): Promise<FlightState> {
  await app.js("(() => { __bh.freeze(true); return 1; })()");
  await app.js(placeJs);
  await wait();
  await app.js(placeJs);
  // (a few steps flown before the holds: just placed, the jet is not « in the air » for its systems — apSet refused, « placed:
  // autopilot false », the render session's parcours-camera and -gpu, 16 Nov 2026; E2E-VOLS §5.3 —; the F-35's engine at the lever)
  await app.js(`(() => { const c = __bh.camera; c.pilot.throttle = Math.max(c.pilot.throttle, 0.62);
    if (__bh.fleet.active !== "a320") c.pilot.engineNow = c.pilot.throttle;
    for (let i = 0; i < 10; i++) __bh.step(1 / 30); return 1; })()`);
  await app.js(`(() => { const c = __bh.camera, g = c.geoNow();
    c.apSet({ ap: true, athr: true, alt: Math.round(g.alt), hdg: ${o.hdgDeg} * Math.PI / 180, spd: ${o.spd} });
    __bh.freeze(false); return 1; })()`);
  await Bun.sleep(2000);
  return flightState(app);
}

/** The state read and judged for a phase (flightProblems): a failure says what is wrong and the whole state. Returns the state. */
export async function expectFlightPhase(app: App, phase: FlightPhase, want: FlightWant = {}, what = ""): Promise<FlightState> {
  const s = await flightState(app);
  const p = flightProblems(s, phase, want);
  const ax = s.axis
    ? ` — runway ${s.axis.des}: heading ${s.axis.hdgErr.toFixed(2)}°, track ${s.axis.trkErr?.toFixed(2) ?? "-"}°, across ${s.axis.across.toFixed(1)} m, ${s.axis.along.toFixed(0)} m along`
    : "";
  const line = `${what ? `${what}: ` : ""}${phase} — ${s.craft} AP ${s.ap} ATHR ${s.athr} engine ${s.engine.toFixed(2)} gear ${s.gearDown}/${(s.gearExt * 100).toFixed(0)} % ${s.speed.toFixed(0)} m/s pitch ${s.pitch.toFixed(0)}° bank ${s.bank.toFixed(0)}° agl ${s.agl.toFixed(0)} m${ax}`;
  console.log(`  [flight] ${line}${p.length ? ` — ${p.join("; ")}` : ""}`);
  if (p.length) throw new Error(`rule 13 (E2E-VOLS): ${p.join("; ")} — ${line}`);
  return s;
}

/**
 * The take-off roll watched (rule 13: « held through the roll to the rotation »): `AXIS_WATCH_START` (a page expression) samples the
 * axis each tenth of a second while the craft is on its wheels — real time, or each `__bh.step` when `window.__axStep()` is called in a
 * stepped loop —; `AXIS_WATCH_READ` stops it and returns the watch: the samples (t [s], ground speed, heading and track errors, across,
 * along, engine) and the worst heading error and distance across once rolling (ground speed > 3 m/s).
 */
export const AXIS_WATCH_START = `(() => {
  if (window.__axT) clearInterval(window.__axT);
  const t0 = performance.now(), W = (window.__axW = { rows: [], worstHdg: 0, worstTrk: 0, worstAcross: 0, rolled: 0, des: null });
  window.__axStep = () => {
    const c = __bh.camera, g = c.geoNow(), att = c.attitudeNow(), D = 180 / Math.PI;
    const a = ${AXIS_EXPR};
    if (!a || !g) return;
    W.des = a.des;
    W.rows.push([+((performance.now() - t0) / 1000).toFixed(1), +g.gs.toFixed(1), +a.hdgErr.toFixed(2), a.trkErr === null ? null : +a.trkErr.toFixed(2), +a.across.toFixed(1), Math.round(a.along), +(c.pilot.engineNow ?? 0).toFixed(2)]);
    if (g.gs > 3) {
      W.rolled++;
      W.worstHdg = Math.max(W.worstHdg, Math.abs(a.hdgErr));
      if (a.trkErr !== null) W.worstTrk = Math.max(W.worstTrk, Math.abs(a.trkErr));
      W.worstAcross = Math.max(W.worstAcross, Math.abs(a.across));
    }
  };
  window.__axT = setInterval(() => window.__axStep(), 100);
  return 1; })()`;
export const AXIS_WATCH_READ = `(() => { clearInterval(window.__axT); window.__axT = 0; return window.__axW; })()`;

export interface AxisWatch {
  rows: [number, number, number, number | null, number, number, number][];
  worstHdg: number;
  worstTrk: number;
  worstAcross: number;
  rolled: number;
  des: string | null;
}

/** What a watched roll did wrong (empty: none): never rolled, or off the axis beyond `AXIS_LIMITS.roll`. */
export function axisWatchProblems(w: AxisWatch): string[] {
  const out: string[] = [];
  const L = AXIS_LIMITS.roll;
  if (!w.rolled) return ["no roll watched on a runway"];
  if (w.worstHdg > L.hdg) out.push(`heading up to ${w.worstHdg.toFixed(1)}° off runway ${w.des}'s axis in the roll`);
  if (w.worstAcross > L.across) out.push(`up to ${w.worstAcross.toFixed(1)} m off runway ${w.des}'s centreline in the roll`);
  return out;
}

/**
 * A pilot's feet on the take-off roll (rule 13: « flown as a pilot flies it »): the rudder pedals — the nose wheel's steering on the
 * ground — keeping the nose on the runway's axis and the wheels on its centreline, as long as the craft rolls (the yaw a pilot would
 * give: against the heading's error, 0.6 per degree, and the distance across, 0.08 per metre). Without it, in a crosswind, an A320
 * weathervanes into the wind: 8 m/s from the right at Le Bourget's 25 took its nose 5.9° right and its wheels 12.9 m off by 45 m/s
 * (a320-effects, kerr-mini, 16 Nov 2026). `AXIS_PILOT_ON` wraps the camera's pilotInput (once); `AXIS_PILOT_OFF` gives it back.
 */
export const AXIS_PILOT_ON = `(() => { const c = __bh.camera; if (c.__axIn) return 1;
  c.__axIn = c.pilotInput.bind(c);
  c.pilotInput = (pad) => {
    const i = c.__axIn(pad);
    if (!c.rolling) return i;
    const rv = c.runwayView ? c.runwayView() : null;
    if (!rv) return i;
    const D = 180 / Math.PI, h = ((((c.attitudeNow().heading * D - rv.rwy + 540) % 360) + 360) % 360) - 180;
    return { ...i, yaw: Math.max(-1, Math.min(1, -(0.6 * h + 0.08 * rv.across))) };
  };
  return 1; })()`;
export const AXIS_PILOT_OFF = `(() => { const c = __bh.camera; if (c.__axIn) { c.pilotInput = c.__axIn; c.__axIn = null; } return 1; })()`;
