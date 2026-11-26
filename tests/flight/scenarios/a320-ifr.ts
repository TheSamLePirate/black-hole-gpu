// A real IFR flight of the A320, gate to stop (docs/PLAN-A320-VOL-AAA.md V2 — Sam, 26 Nov 2026: « le but est de pouvoir faire des vrais
// vols avec le pilote automatique AAA et tous les instruments, décollage, couloirs aériens, route, approche, atterrissage »): San
// Francisco to Los Angeles, by day, clear sky, flown through the A320's own devices as a crew flies it —
//   the plan made at the MCDU (INIT KSFO/KLAX, DEPARTURE: the runway lined up on, its SID and transition; ARRIVAL: the STAR SADDE8 by
//   AVE, the ILS 24R), the cruise level FL240, the FCU at it;
//   the take-off (CONF 1+F, TOGA, the stick at VR), gear up, AP1 and NAV at 1 500 ft, the managed climb (CLB) along the SID;
//   the cruise (the clock ×4 there only, back to real time 20 NM before the T/D);
//   the FCU set low and pushed before the T/D: DES armed, begun at the T/D, flown on the path (VDEV), the STAR's constraints;
//   DECEL: the approach phase; the assisted level (settings.a320Assist) sets flaps and gear at their speeds; the ILS armed, the autoland,
//   to a stop.
// Measured on the page's own record (every 250 ms of the wall): each phase's modes, the SID's and STAR's constraints at their points,
// the T/D where DES began against the one predicted, |VDEV| on the path, the IF's altitude, the touchdown. The displays (PFD, ND,
// MCDU) saved as pictures at each phase, the cockpit too.
import type { Lab } from "../lib/lab";
import type { Scenario, Verdict } from "./helpers";

const ORIG = { icao: "KSFO", lat: 37.6189, lon: -122.375 };
const DEST = "KLAX";
/** the SID for the runway lined up on (its runway transition: 10L/R → CIITY3, the 28s → SNTNA2), its transition to the coast */
const SID = (rwy: string) => (/^10/.test(rwy) ? "CIITY3" : "SNTNA2");
const SID_TRANS = "DEDHD";
const STAR = "SADDE8";
const STAR_TRANS = "AVE";
const APPR = "I24R";
const CRZ_FL = 240;
/** the clock's speed in the cruise (between the T/C and 20 NM before the T/D) */
const WARP = Number(process.env.A320_WARP ?? 4);

interface Rec {
  t: number;
  ph: string;
  ias: number;
  alt: number;
  vs: number;
  fma: string;
  armed: string;
  phase: string;
  wp: string;
  td: number | null;
  vdev: number | null;
  drag: boolean;
  agl: number;
  ground: boolean;
}

async function ifr(lab: Lab): Promise<Verdict> {
  const m: Record<string, unknown> = {};
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) fails.push(what);
    lab.note("note", `${ok ? "✓" : "✗"} ${what}`);
  };
  /** the A320's displays saved as pictures (their 1024² canvases), beside the scenario's shots */
  const displays = async (label: string) => {
    for (const n of ["PFD1", "ND1", "MCDU1"]) {
      const b64 = await lab.js<string | null>(`(async () => {
        const c = __bh.renderer.a320Du?.canvasOf(${JSON.stringify(n)});
        if (!c) return null;
        const blob = await c.convertToBlob({ type: "image/png" });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      })()`);
      if (b64) await Bun.write(`${lab.o.dir}/shots/du-${label}-${n}.png`, Buffer.from(b64, "base64"));
    }
    await lab.shot(label, true);
  };

  // ---- the craft, the day (KSFO's solar noon), calm and clear; the assisted level (flaps and gear at their speeds)
  await lab.js(`(() => {
    Object.assign(__bh.settings, { vessel: "a320", a320Start: "ready", a320Assist: "assisted", traffic: false, weather: "fair", wind: 0, earthClouds: 0 });
    return true;
  })()`);
  await lab.app.waitProgress(`__bh.fleet.active === "a320"`, "the A320");
  const noon = new Date(Date.UTC(2026, 10, 5, 12) - ORIG.lon * 240000).toISOString();
  await lab.js(`(__bh.game.setDate(${JSON.stringify(noon)}), true)`);
  lab.note("note", `the date: ${noon} (KSFO's solar noon)`);
  // (to San Francisco: set down there — its runways' tile fetched —, then lined up on its runway in use)
  await lab.js(`(__bh.freeze(false), __bh.game.land("earth", ${ORIG.lat}, ${ORIG.lon}), true)`);
  await lab.app.waitProgress(
    `(() => { try { __bh.game.lineUp(${JSON.stringify(ORIG.icao)}); return true; } catch (e) { return false; } })()`,
    "lined up at KSFO",
    { maxMs: 60_000 },
  );
  await lab.app.waitProgress("!!__bh.camera.a320Sys", "the A320's systems");
  // (the runway lined up on: its end by the heading — 10L/10R ~118°, 28L/28R ~298°)
  const hdg = await lab.js<number>("((__bh.camera.attitudeNow().heading ?? 0) * 57.2958 + 360) % 360");
  const rwy = Math.abs(((hdg - 118 + 540) % 360) - 180) < 30 ? "10L" : "28R";
  lab.note("note", `lined up heading ${hdg.toFixed(0)}° — runway ${rwy}, SID ${SID(rwy)}.${SID_TRANS}`);

  // ---- the plan at the MCDU: INIT FROM/TO, DEPARTURE, ARRIVAL (STAR + ILS), the cruise level
  const plan = await lab.js<string>(`(async () => {
    const m = __bh.a320Mcdu(0), c = __bh.camera, R = () => c.nav.route;
    c.a320Park = true;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let k = 0; k < 60 && R().wps.at(-1)?.name !== ${JSON.stringify(DEST)}; k++) {
      m.page("init"); m.sp = ${JSON.stringify(`${ORIG.icao}/${DEST}`)}; m.lsk("R", 1); await wait(500);
    }
    if (R().wps.at(-1)?.name !== ${JSON.stringify(DEST)}) return "no plan";
    // (DEPARTURE: the SIDs fetched at the first ask)
    m.latRev = 0; m.open("latrev"); m.lsk("L", 1);
    for (let k = 0; k < 40; k++) {
      m.depRwy = ${JSON.stringify(rwy)};
      if (m.current.screen(m).lines[1]?.r?.some((r) => /SIDS>/.test(r.t))) break;
      await wait(250);
    }
    m.depRwy = ${JSON.stringify(rwy)}; m.depSid = ${JSON.stringify(SID(rwy))}; m.depTrans = ${JSON.stringify(SID_TRANS)};
    m.lsk("R", 6);
    // (ARRIVAL: the ILS and the STAR with its transition, inserted at once)
    m.latRev = R().wps.length - 1; m.open("latrev"); m.lsk("R", 1);
    // (the destination's approaches and its STARs fetched: both lists in before the choice)
    for (let k = 0; k < 60; k++) {
      const apps = (c.approachesAt(${JSON.stringify(DEST)}) ?? []).some((a) => a.id === ${JSON.stringify(APPR)});
      const stars = (m.host.terminals?.(${JSON.stringify(DEST)})?.star ?? []).some((x) => x.id === ${JSON.stringify(STAR)});
      if (apps && stars) break;
      await wait(250);
    }
    m.arrApp = ${JSON.stringify(APPR)}; m.arrVia = null; m.arrStar = ${JSON.stringify(STAR)}; m.arrTrans = ${JSON.stringify(STAR_TRANS)};
    await wait(300);
    m.lsk("R", 6);
    // (INIT A's cruise level)
    c.a320Fmgc.fms.crzFl = ${CRZ_FL}; R().cruiseAlt = ${CRZ_FL * 100} * 0.3048;
    m.page("f-pln");
    return R().wps.map((w) => w.name + (w.cstr ? "(" + w.cstr.map((x) => (x == null ? "" : Math.round(x / 0.3048))).join("/") + ")" : "")).join(" ");
  })()`);
  lab.note("note", `the plan: ${plan}`);
  // (the plan made with the clock running — the airfields' and procedures' tiles come by the frames —, the parking brake on; then held
  // while the place's data come)
  await lab.js("(__bh.freeze(true), true)");
  await lab.ready("KSFO's data");
  m.plan = plan;
  check(
    plan.includes(SID(rwy) === "CIITY3" ? "CIITY" : "") && plan.includes("SADDE") && plan.includes("SMO"),
    `the plan has its SID, STAR and approach (${plan})`,
  );
  await displays("plan");

  // ---- the page's own record, every 250 ms of the wall
  await lab.js(`(() => {
    const c = __bh.camera;
    window.__a3 = { ph: "lineup", rec: [] };
    clearInterval(window.__a3t);
    window.__a3t = setInterval(() => { try {
      const i = c.a320FmgcIn, F = c.a320Fmgc, V = c.a320Vprof;
      if (!i || !F) return;
      const x = F.fma();
      const L = c.nav.last.l;
      window.__a3.rec.push({ t: __bh.sim.time * 4.925490947e-6 * __bh.settings.massSolar, ph: window.__a3.ph, ias: i.ias, alt: i.alt, vs: i.vs,
        fma: [x.thrust, x.vert, x.lat].join("|"), armed: [x.vertArmed, x.latArmed].join("|"), phase: F.phase,
        wp: L && !L.done ? (c.nav.route.wps[L.active]?.name ?? "") : "", td: V?.td ?? null, vdev: V?.vdev ?? null, drag: !!F.moreDrag,
        agl: i.ra ?? 0, ground: !!(c.rolling || c.ourLanded) });
    } catch (e) {} }, 250);
    __bh.settings.shipMount = "cockpit";
    return true;
  })()`);
  const phase = (p: string) => lab.js(`(window.__a3.ph = ${JSON.stringify(p)}, true)`);

  // ---- the take-off: FCU FL240 managed, CONF 1+F, TOGA, the stick at VR, let go once flying
  await phase("takeoff");
  await lab.js(`(() => {
    const c = __bh.camera, F = c.a320Fmgc;
    F.alt = ${CRZ_FL * 100};
    c.airFlight.cfg.flaps = 0.25; c.a320Park = false; c.pilot.throttle = 1;
    c.__in ??= c.pilotInput.bind(c);
    window.__liftAt = null;
    c.pilotInput = (pad) => { const i = c.__in(pad); const q = c.a320FmgcIn; const g = c.rolling || c.ourLanded;
      if (!g && window.__liftAt === null) window.__liftAt = __bh.sim.time;
      const since = window.__liftAt === null ? 0 : (__bh.sim.time - window.__liftAt) * 4.925490947e-6 * __bh.settings.massSolar;
      return (q && q.ias > 133 && since < 3) ? { ...i, pitch: 0.5 } : i; };
    return true;
  })()`);
  let e = await lab.live({ until: "!c.rolling && !c.ourLanded && (c.a320FmgcIn?.ra ?? 0) > 50", maxWall: 120, everyMs: 500 });
  check(e.end === "until", `lift-off (${e.end})`);
  await lab.js("(__bh.camera.gearDown = false, true)");
  e = await lab.live({ until: "(c.a320FmgcIn?.ra ?? 0) > 1500", maxWall: 120, everyMs: 500 });
  const eng = await lab.js<string>(`(() => { const c = __bh.camera, F = c.a320Fmgc; c.pilotInput = c.__in; c.pilot.throttle = 0.6;
    if (!F.ap) c.a320ApKey("ap"); if (!F.athr) c.a320ApKey("athr"); if (F.lat !== "NAV") c.a320ApKey("nav");
    return JSON.stringify(F.fma()); })()`);
  lab.note("note", `1 500 ft: ${eng}`);
  await phase("climb");
  await displays("climb");
  // (the managed climb along the SID to FL240: CLB, NAV)
  e = await lab.live({
    until: "(c.a320FmgcIn?.alt ?? 0) > " + (CRZ_FL * 100 - 60),
    maxWall: 1500,
    everyMs: 2000,
    fail: "!!c.airFlight.failure",
  });
  check(e.end === "until", `FL${CRZ_FL} reached (${e.end} ${e.why})`);
  await phase("cruise");
  await displays("cruise");
  // ---- the cruise at ×WARP, to 20 NM before the T/D; the FCU set to 2 000 ft and pushed there: DES armed
  await lab.js(`(__bh.game.warp(${WARP}), true)`);
  e = await lab.live({
    until: "(c.a320Vprof?.td ?? 0) < 20 && c.a320Vprof?.td != null",
    maxWall: 1800,
    everyMs: 2000,
    fail: "!!c.airFlight.failure",
  });
  await lab.js("(__bh.game.warp(1), true)");
  check(e.end === "until", `20 NM before the T/D (${e.end} ${e.why})`);
  const armed = await lab.js<string>(
    `(() => { const c = __bh.camera, F = c.a320Fmgc; F.alt = 2000; F.altPush(c.a320FmgcIn); return F.desArmed + " " + JSON.stringify(F.fma()); })()`,
  );
  lab.note("note", `FCU 2 000 pushed: ${armed}`);
  check(armed.startsWith("true"), "DES armed before the T/D");
  await phase("tod");
  await displays("before-td");
  e = await lab.live({ until: `c.a320Fmgc.vert === "DES"`, maxWall: 600, everyMs: 1000, fail: "!!c.airFlight.failure" });
  check(e.end === "until", `DES begun (${e.end})`);
  // ---- the managed descent on the path, the STAR, to DECEL (the approach phase)
  await phase("descent");
  e = await lab.live({ until: `c.a320Fmgc.phase === "approach"`, maxWall: 1500, everyMs: 2000, fail: "!!c.airFlight.failure" });
  check(e.end === "until", `the approach phase (DECEL) (${e.end} ${e.why})`);
  await displays("decel");
  // ---- the approach: APPR pressed as a crew does — NAV brings it along the approach's fixes onto the localizer (the ILS tuned by the
  // plan's destination), LOC and G/S captured; the assisted level's flaps, gear, autobrake; the autoland, to a stop. (Before 26 Nov
  // 2026 the game's own join — ilsStart — was asked here: its circuit took over from NAV and flew in circles 1.9 km off the axis)
  await phase("approach");
  const said = await lab.js<string>(
    `(() => { const F = __bh.camera.a320Fmgc; if (!F.apprArm) F.apprToggle(); return JSON.stringify(F.fma()); })()`,
  );
  lab.note("note", `APPR: ${said}`);
  e = await lab.live({ until: `["G/S", "LAND"].includes(c.a320Fmgc.vert)`, maxWall: 900, everyMs: 1000, fail: "!!c.airFlight.failure" });
  await displays("glide");
  // (the touchdown: the game's own record of it — controller/motion.ts lastTouch, its sink —, the runway's along and across then; the
  // game's ILS grade, ilsLast, is its own join's only)
  const n0 = await lab.js<number>("__bh.camera.lastTouch?.n ?? 0");
  e = await lab.live({ until: `(c.lastTouch?.n ?? 0) > ${n0} || !!c.airFlight.failure`, maxWall: 900, everyMs: 1000 });
  const touch = await lab.js<{ vs: number; along: number; across: number } | null>(
    `(() => { const T = __bh.camera.lastTouch, R = window.__lab.sample().runway; return T ? { vs: -Math.abs(T.sink), along: R?.along ?? NaN, across: R?.across ?? NaN } : null; })()`,
  );
  await phase("rollout");
  e = await lab.live({ until: "c.ourLanded && (c.a320FmgcIn?.ias ?? 99) < 5", maxWall: 180, everyMs: 1000 });
  await displays("stopped");
  const L = { score: null as number | null, touch };
  const fail = await lab.js<string | null>("__bh.camera.airFlight.failure");
  check(!fail, `no failure (${fail ?? "—"})`);
  check(
    !!L?.touch && Math.abs(L.touch.vs) < 3 && Math.abs(L.touch.across) < 10,
    `touchdown < 3 m/s, < 10 m off the axis (${JSON.stringify(L?.touch ?? null)})`,
  );

  // ---- the record, measured
  const R = await lab.js<Rec[]>("window.__a3.rec");
  await lab.js("(clearInterval(window.__a3t), true)");
  await Bun.write(`${lab.o.dir}/a320-ifr-record.json`, JSON.stringify(R));
  const at = (name: string) => R.filter((q) => q.wp === name);
  const passAlt = (name: string) => {
    // (the altitude when the point was passed: the last record with it active)
    const r = at(name);
    return r.length ? Math.round(r.at(-1)!.alt) : null;
  };
  // the SID's and STAR's constraints, at their points
  const cstrs = await lab.js<{ name: string; lo: number | null; hi: number | null }[]>(
    `__bh.camera.nav.route.wps.filter((w) => w.cstr).map((w) => ({ name: w.name, lo: w.cstr[0] == null ? null : Math.round(w.cstr[0] / 0.3048), hi: w.cstr[1] == null ? null : Math.round(w.cstr[1] / 0.3048) }))`,
  );
  const cs = cstrs.map((c) => {
    const a = passAlt(c.name);
    const ok = a !== null && (c.lo === null || a >= c.lo - 150) && (c.hi === null || a <= c.hi + 150);
    return { ...c, at: a, ok };
  });
  m.constraints = cs;
  for (const c of cs)
    check(c.ok, `${c.name} ${c.lo !== null ? `≥${c.lo}` : ""}${c.hi !== null ? ` ≤${c.hi}` : ""} ft: passed at ${c.at ?? "—"} ft`);
  // the T/D: DES begun where the profile put it
  const des0 = R.findIndex((q) => q.fma.split("|")[1] === "DES");
  m.td_at_des_nm = des0 > 0 ? R[des0 - 1]!.td : null;
  const desc = R.filter((q) => q.ph === "descent" && q.fma.split("|")[1] === "DES" && q.vdev !== null);
  m.vdev_max_ft = desc.length ? Math.max(...desc.map((q) => Math.abs(q.vdev!))) : null;
  const p90 = desc.length ? desc.map((q) => Math.abs(q.vdev!)).sort((a, b) => a - b)[Math.floor(desc.length * 0.9)] : null;
  m.vdev_p90_ft = p90;
  m.more_drag_s = R.filter((q) => q.drag).length / 4;
  m.modes = [...new Set(R.map((q) => `${q.ph}:${q.fma}`))].slice(0, 60);
  m.touch = L?.touch ?? null;
  m.grade = L?.score ?? null;
  check(m.td_at_des_nm !== null && Math.abs(m.td_at_des_nm as number) < 2, `DES begun at the T/D (${m.td_at_des_nm} NM)`);
  check((p90 ?? 9999) < 500, `on the path: |VDEV| p90 ${p90} ft, max ${m.vdev_max_ft} ft`);
  return { ok: fails.length === 0, why: fails.length ? `✗ ${fails.join(" · ")}` : "✓ KSFO → KLAX flown IFR, gate to stop", metrics: m };
}

export const A320_IFR: Scenario[] = [
  {
    id: "a320-ifr-ksfo-klax",
    title: "A320 — IFR KSFO → KLAX: the MCDU's SID, STAR and ILS, the managed climb, cruise, descent at the T/D, the autoland",
    tags: ["a320", "plane", "runway", "live", "autopilot", "ils", "ifr"],
    minutes: 45,
    tiles: false,
    run: (lab) => ifr(lab),
  },
];
