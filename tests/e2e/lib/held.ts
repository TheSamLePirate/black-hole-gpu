// An aircraft placed as a pilot would leave it (docs/E2E-VOLS.md, rule 13): `flyAt` keeps the throttle and the holds as they were — at the
// boot, 0 and none —, so a test that then waits lets it glide at idle. `HELD_JS` (pasted right after a `flyAt` in the same page script, or
// run after it) sets a cruise thrust — the lever and the engine spooled — and engages the autopilot and the autothrottle at the altitude,
// track and speed it was placed at (the F-35's holds; the A320's FCU — its AP1 accepted 5 s after a placing, its A/THR at once). An ILS,
// a scripted hand or a test's own gesture then takes it from there.

// (the holds asked after a few steps of the simulation, frozen: just placed, the jet is not « in the air » yet for its systems — apSet
// refused them, « The autopilot's holds: in the air » — until a step has flown it; the F-35's engine set to the lever at once (its
// engineNow is the pilot's, as main.ts's demos and a save's reload set it), so the place the test chose is kept (a tenth of a second:
// ~10 m — 6 s stepped before moved it 600 m and off the slope a final had placed it on: crew-approach no longer established). The
// A320's thrust is its engines' (engineNow read from them, spooling over seconds) and its AP1 refused 5 s after a placing: 6 s
// stepped for it. The simulation then given back as it was, frozen or running.)
const HELD_BODY = `const c = __bh.camera, wasFrozen = __bh.held?.() === "frozen", a320 = __bh.fleet.active === "a320";
  c.pilot.throttle = 0.62;
  if (!a320) c.pilot.engineNow = 0.62;
  __bh.freeze(true); for (let i = 0, n = a320 ? 180 : 3; i < n; i++) __bh.step(1 / 30);
  const g = c.geoNow();
  if (g) c.apSet({ ap: true, athr: true, alt: Math.round(g.alt), hdg: g.track, spd: Math.round(g.gs) });
  if (!wasFrozen) __bh.freeze(false);`;

/** One expression: the cruise thrust and the holds where the craft is. */
export const HELD_JS = `(() => { ${HELD_BODY} return 1; })()`;

/** The same, as statements to paste inside a page script after its flyAt. */
export const HELD = `{ ${HELD_BODY} }`;

/**
 * A flight watched step by step (rule 13 « at each phase »): paste `MONITOR_INIT` before a page's step loop and `MONITOR_STEP` inside it
 * (it reads `__bh.camera`; the watch kept on `window.__mon` across a test's page calls); return `window.__mon`. Out of the flare and the rollout, in the air: the least thrust applied (engineNow), the
 * incidence nearest the stall (alpha / stallA), the steepest bank and pitch, the least airspeed, whether an autopilot and an
 * autothrottle held throughout, the steps at idle with nobody on the throttle (no autothrottle: a glide — idle under an autothrottle is
 * a managed descent, a pilot's); at the first touch of the wheels, the gear (down and locked?).
 */
export const MONITOR_INIT = `window.__mon = { n: 0, minEngine: 9, maxAlpha: 0, maxBank: 0, maxPitch: -90, minPitch: 90, minSpeed: 1e9, apOff: 0, athrOff: 0, idleUnheld: 0, touchGear: null };`;
export const MONITOR_STEP = `{ const __mon = window.__mon, c = __bh.camera, a = c.airInfo ? c.airInfo() : null, R = c.ilsRun, A = c.a320App, G = c.a320Fmgc, M = c.jetModes;
  const late = R ? /flare|rollout|done/.test(R.phase) : !!(G && /FLARE|ROLL/.test(G.vert));
  const wheels = !!(c.rolling || c.ourLanded);
  if (wheels && __mon.touchGear === null) __mon.touchGear = { down: !!c.gearDown, ext: c.gearExt ?? 0 };
  if (a && a.inAir && !wheels && !late) {
    const att = c.attitudeNow(), D = 180 / Math.PI;
    __mon.n++;
    __mon.minEngine = Math.min(__mon.minEngine, c.pilot.engineNow ?? 0);
    if (a.stallA) __mon.maxAlpha = Math.max(__mon.maxAlpha, a.alpha / a.stallA);
    __mon.maxBank = Math.max(__mon.maxBank, Math.abs((att.bank ?? 0) * D));
    __mon.maxPitch = Math.max(__mon.maxPitch, (att.pitch ?? 0) * D);
    __mon.minPitch = Math.min(__mon.minPitch, (att.pitch ?? 0) * D);
    __mon.minSpeed = Math.min(__mon.minSpeed, a.speed ?? 0);
    const ap = G ? !!G.ap : (!!R && !R.manual) || (M && (M.alt !== null || M.hdg !== null));
    const athr = G ? !!G.athr : (!!R && !R.manual) || (M && M.spd !== null) || !!c.nav?.on?.v;
    if (!ap) __mon.apOff++;
    if (!athr) __mon.athrOff++;
    // (idle with nobody on the throttle: the glide rule 13 forbids — idle under an autothrottle, a managed descent, is a pilot's)
    if ((c.pilot.engineNow ?? 0) < 0.05 && !athr) __mon.idleUnheld++;
  } }`;

export interface Monitor {
  n: number;
  minEngine: number;
  maxAlpha: number;
  maxBank: number;
  maxPitch: number;
  minPitch: number;
  minSpeed: number;
  apOff: number;
  athrOff: number;
  /** steps at idle with no autothrottle */
  idleUnheld: number;
  touchGear: { down: boolean; ext: number } | null;
}

/** What a watched flight did wrong (empty: none). `ap`/`athr`: expected held throughout (default true); `landed`: the touch asserted. */
export function monitorProblems(m: Monitor, o: { ap?: boolean; athr?: boolean; landed?: boolean; bankMax?: number } = {}): string[] {
  const out: string[] = [];
  if (!m.n) return ["no step watched in the air"];
  if (m.idleUnheld > 0) out.push(`a glide at idle with no autothrottle (${m.idleUnheld} steps)`);
  if (m.maxAlpha > 0.92) out.push(`the stall's edge (incidence ${(m.maxAlpha * 100).toFixed(0)} % of the stall's)`);
  if (m.maxBank > (o.bankMax ?? 60)) out.push(`bank ${m.maxBank.toFixed(0)}°`);
  if (m.maxPitch > 30 || m.minPitch < -25) out.push(`pitch ${m.minPitch.toFixed(0)}…${m.maxPitch.toFixed(0)}°`);
  if (m.minSpeed < 40) out.push(`airspeed down to ${m.minSpeed.toFixed(0)} m/s`);
  if ((o.ap ?? true) && m.apOff > 0) out.push(`no autopilot on ${m.apOff} of ${m.n} steps`);
  if ((o.athr ?? true) && m.athrOff > 0) out.push(`no autothrottle on ${m.athrOff} of ${m.n} steps`);
  if (o.landed && !(m.touchGear?.down && (m.touchGear.ext ?? 0) >= 0.99))
    out.push(`gear not down and locked at the touch (${JSON.stringify(m.touchGear)})`);
  return out;
}
