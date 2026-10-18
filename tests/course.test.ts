import { afterEach, expect, test } from "bun:test";
import { COURSE, type CourseFix, courseOf, courseStep, deviations, newCourse, targetsOf } from "../src/game/course";
import { CHANNELS, instrStep, newInstr } from "../src/game/instructor";
import { LESSONS } from "../src/game/lessons";
import { setGroundHeights } from "../src/system/our-surface";
import { gcasForget } from "../src/controller/gcas";
import { fleet } from "../src/fleet";
import { resetFlights } from "./helpers/flight";
import { cruise } from "./helpers/envelope";
import { flight } from "./helpers/flight";
import { RUNWAY_LENGTH, SITES } from "../src/game/sites";
import { fromRunway, onRunway } from "../src/game/ils";
import { ourGroundPose } from "../src/game/place";
import { add, cross, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";

// PLAN-AVIATION-AAA I3: the guided lessons — TARS's steps then the pilot's, each done when its targets are held, its
// time is up or its event seen, at most so long; a demonstration TARS's alone, a try the pilot's alone; the deviations
// (the bank while the turn is still to be made, the heading after). Flown headless: the first flight — TARS levels,
// turns 90° right and climbs 500 m on the holds, hands over; a steady pilot then holds, turns back, descends and slows,
// the instructor watching — debriefed high; the formation — TARS rejoins LEAD to the echelon right, hands over in the
// slot; the guns — TARS into the drone's six, the pilot's bursts, the kill.

afterEach(() => {
  resetFlights();
  setGroundHeights("earth", null);
  gcasForget();
});

const fix = (o: Partial<CourseFix> = {}): CourseFix => ({ alt: 2500, hdg: 90, spd: 200, bank: 0, events: new Set(), ...o });

test("a course's steps: TARS's then the pilot's, held, timed, by event, at most; a demonstration, a try", () => {
  const R = newCourse("first", "guided", 2500, 90);
  expect(R.steps.length).toBe(7);
  const said: string[] = [];
  const run = (secs: number, f: CourseFix) => {
    for (let i = 0; i < secs * 10; i++) {
      const o = courseStep(R, f, 0.1);
      if (o.begin) said.push(o.begin.name);
      if (o.end) said.push("end");
    }
  };
  // (level flight: 8 s)
  run(9, fix());
  expect(said).toEqual(["A level turn"]);
  // (the turn: not held off its heading; held 2 s on it)
  run(5, fix({ hdg: 150 }));
  expect(R.i).toBe(1);
  run(2.5, fix({ hdg: 179 }));
  expect(said).toEqual(["A level turn", "A climb"]);
  // (its targets: 500 m up, 180°)
  expect(targetsOf(R, R.steps[R.i]!)).toEqual({ alt: 3000, hdg: 180, spd: 200, bank: undefined });
  run(4, fix({ alt: 3000 - COURSE.alt + 5, hdg: 180 }));
  expect(R.steps[R.i]!.who).toBe("you");
  // (the pilot's turn back: the bank counted while the turn is to be made, the heading after)
  run(10.5, fix({ alt: 3000, hdg: 180 }));
  expect(R.steps[R.i]!.name).toBe("Turn back left");
  expect(deviations(R, fix({ alt: 3020, hdg: 140, bank: -40 }))).toEqual({ alt: 20, hdg: Number.NaN, spd: 0, bank: -10 });
  expect(deviations(R, fix({ alt: 3000, hdg: 95, bank: -10 })).hdg).toBe(5);
  // (not done: at most 90 s, then on)
  run(91, fix({ alt: 3400, hdg: 140 }));
  expect(R.steps[R.i]!.name).toBe("Descend");
  run(6, fix({ alt: 2500, hdg: 90 }));
  run(6, fix({ alt: 2500, hdg: 90, spd: 160 }));
  expect(said[said.length - 1]).toBe("end");
  expect(R.done).toBe(true);
  // (a demonstration: TARS's three; a try: the pilot's four, the first letting the holds go)
  expect(newCourse("first", "demo", 0, 0).steps.map((s) => s.who)).toEqual(["tars", "tars", "tars", "tars", "tars", "tars", "tars"]);
  const T = newCourse("guns", "try", 0, 0);
  expect(T.steps.map((s) => s.who)).toEqual(["you"]);
  expect(T.steps[0]!.act).toEqual(["free"]);
  // (an event's step: held as long as asked)
  const F = newCourse("formation", "guided", 5000, 90);
  for (let i = 0; i < 30; i++) courseStep(F, fix({ events: new Set(["slot"]) }), 0.1);
  expect(F.i).toBe(0);
  for (let i = 0; i < 12; i++) courseStep(F, fix({ events: new Set(["slot"]) }), 0.1);
  expect(F.i).toBe(1);
  // (every lesson's course: a step of TARS's, then the pilot's, its kind's channels)
  for (const L of LESSONS) {
    const C = courseOf(L.id);
    const first = C.steps.findIndex((s) => s.who === "you");
    expect(first).toBeGreaterThan(0);
    expect(C.steps.slice(first).every((s) => s.who === "you")).toBe(true);
    expect(CHANNELS[C.kind].length).toBeGreaterThan(1);
  }
});

test("the first flight flown headless: TARS levels, turns right, climbs; a steady pilot then — the instructor's debrief high", () => {
  const a = cruise(2500, 200, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  const said: string[] = [];
  const debriefs: number[] = [];
  c.onCourseSay = (s) => said.push(s);
  c.onInstrDebrief = (L) => debriefs.push(L.debrief.score);
  c.courseStart("first", "guided");
  const hdg0 = () => c.course!.run!.hdg0;
  a.fly(1);
  expect(c.course?.run?.i).toBe(0);
  const h0 = hdg0();
  // (TARS's three steps on the holds)
  a.fly(200, () => c.course?.run?.steps[c.course.run.i]?.who === "you");
  const R = c.course!.run!;
  console.log(
    `  TARS handed over at ${R.t.toFixed(0)} s, heading ${((c.jetFigures()!.hdg * 180) / Math.PI).toFixed(0)}° (from ${h0.toFixed(0)}°)`,
  );
  expect(R.i).toBe(3);
  expect((((c.jetFigures()!.hdg * 180) / Math.PI - h0 - 90 + 540) % 360) - 180).toBeLessThan(6);
  expect(c.jetFigures()!.h - R.alt0).toBeGreaterThan(450);
  expect(c.jetModes.alt).toBe(null);
  // (a steady pilot: each of his steps flown as asked — the holds standing for his hands)
  let at = -1;
  a.fly(400, () => {
    const S = c.course?.run;
    if (!S) return true;
    if (S.i !== at) {
      at = S.i;
      const T = targetsOf(S, S.steps[S.i]!);
      if (T) {
        c.jetModes.alt = T.alt!;
        c.jetModes.hdg = (T.hdg! * Math.PI) / 180;
        c.jetModes.spd = T.spd!;
        c.jetModes.bankMax = T.bank ? (Math.abs(T.bank) * Math.PI) / 180 : undefined;
      }
    }
    return false;
  });
  a.fly(1);
  console.log(`  ${said.length} said — "${said[3]}" … "${said[said.length - 1]}"; debrief ${debriefs.join(", ")}/20`);
  expect(c.course).toBe(null);
  expect(said[said.length - 1]).toBe("That was your first flight. The debrief is on screen.");
  expect(debriefs.length).toBe(1);
  expect(debriefs[0]).toBeGreaterThan(14);
  expect(c.instrLast!.run.id).toBe("first");
  expect(c.instrLast!.debrief.phases.map((p) => p.phase)).toEqual(["Your controls: level", "Turn back left", "Descend", "Slow down"]);
}, 300_000);

test("formation: TARS rejoins LEAD to the echelon right, hands over in the slot — the instructor's deviations small", () => {
  const a = cruise(5000, 180, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  c.courseStart("formation", "guided");
  a.fly(2);
  expect(c.course?.target).toBeDefined();
  a.fly(300, () => c.course?.run?.steps[c.course.run.i]?.who === "you");
  const R = c.course!.run!;
  expect(R.t).toBeLessThan(170);
  const s = c.courseSample();
  console.log(
    `  in the slot at ${R.t.toFixed(0)} s: ${JSON.stringify(Object.fromEntries(Object.entries(s!.v).map(([k, v]) => [k, Math.round(v * 10) / 10])))}`,
  );
  expect(R.steps[R.i]!.who).toBe("you");
  expect(c.icpt).toBe(null);
  expect(Math.abs(s!.v.fwd!)).toBeLessThan(15);
  expect(Math.abs(s!.v.right!)).toBeLessThan(15);
  expect(Math.abs(s!.v.up!)).toBeLessThan(10);
  // (handed over trimmed: 10 s hands off, still level by it — the leader not taken for a collision)
  a.fly(10);
  const s2 = c.courseSample()!;
  console.log(`  10 s hands off: ${Math.round(s2.v.fwd!)} m fore and aft, ${Math.round(s2.v.up!)} m up`);
  expect(Math.abs(s2.v.up!)).toBeLessThan(15);
}, 300_000);

test("guns: TARS into the drone's six; the pilot's bursts, the kill — the lesson ends", () => {
  const a = cruise(4000, 200, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  const said: string[] = [];
  c.onCourseSay = (x) => said.push(x);
  c.courseStart("guns", "guided");
  a.fly(2);
  a.fly(300, () => c.course?.run?.steps[c.course.run.i]?.who === "you");
  const R = c.course!.run!;
  const s0 = c.courseSample()!;
  console.log(`  in its six at ${R.t.toFixed(0)} s: ${Math.round(s0.v.rng! + 450)} m, ${s0.v.az!.toFixed(1)}° across`);
  expect(R.t).toBeLessThan(140);
  expect(R.steps[R.i]!.name).toBe("Your controls: guns");
  // (the pilot: back on its tail as the intercept would fly it, firing within 600 m)
  const name = c.radarObjects.find((o) => o.id === `cmb:${c.course!.target}`)!.name;
  c.icptOn(name);
  a.fly(120, () => {
    const s = c.courseSample();
    c.gunTrigger = !!s && s.v.rng! < 150 && Math.abs(s.v.az!) < 15;
    return !c.course;
  });
  console.log(`  ${said.join(" · ")}`);
  expect(c.course).toBe(null);
  expect(said[said.length - 1]).toBe("Splash. The debrief is on screen.");
}, 300_000);

test("an intercept: TARS on the collision course to 25 km, hands over; the pilot's conversion to its tail ends it", () => {
  const a = cruise(6000, 250, 0.75);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  const said: string[] = [];
  c.onCourseSay = (x) => said.push(x);
  c.courseStart("intercept", "guided");
  a.fly(2);
  const o0 = c.radarObjects.find((o) => o.id === `cmb:${c.course!.target}`)!;
  expect(o0.name).toBe("UNKNOWN");
  expect(Math.hypot(...o0.r)).toBeGreaterThan(40_000);
  a.fly(300, () => c.course?.run?.steps[c.course.run.i]?.who === "you");
  const R = c.course!.run!;
  const s = c.courseSample()!;
  const d = Math.hypot(...c.radarObjects.find((o) => o.id === `cmb:${c.course!.target}`)!.r);
  console.log(
    `  handed over at ${R.t.toFixed(0)} s, ${(d / 1000).toFixed(1)} km: ${s.v.hdg!.toFixed(1)}° off the course, ${Math.round(s.v.alt!)} m off its height`,
  );
  expect(d).toBeLessThan(25_000);
  expect(Math.abs(s.v.hdg!)).toBeLessThan(8);
  // (the pilot: the intercept as he would fly it — to its tail)
  c.icptOn("UNKNOWN");
  a.fly(400, () => !c.course);
  console.log(`  ${said[said.length - 1]} at ${R.t.toFixed(0)} s`);
  expect(said[said.length - 1]).toBe("On its tail: intercepted. The debrief is on screen.");
}, 300_000);

test("the circuit: TARS flies the downwind at Edwards — 300 m up, 1.8 km abeam — and hands over at the base point", () => {
  const K = SITES.find((x) => x.icao === "KEDW")!;
  const W = { name: K.name, icao: "KEDW", lat: K.lat, lon: K.lon, hdg: K.rwy!, elev: K.elev!, len: RUNWAY_LENGTH };
  setGroundHeights("earth", () => W.elev);
  gcasForget();
  const D = Math.PI / 180;
  const p = fromRunway(W, 1500, 1800);
  const g = ourGroundPose("earth", p.lat, p.lon, 0);
  const north = cross(g.up, g.fwd);
  const hd = (W.hdg + 180) * D;
  const fwd = add(scale(north, Math.cos(hd)), scale(g.fwd, Math.sin(hd)));
  const X = add(g.X, scale(g.up, 300 / M_METRES));
  const a = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, 100 / C_MPS)), landed: undefined }, false, "f35");
  const c = a.c;
  c.s.flightMode = "plane";
  c.pilot.throttle = c.pilot.engineNow = 0.5;
  fleet.fuel.f35 = 3000;
  a.fly(0.5);
  c.courseStart("circuit", "guided", { rwy: W });
  let worst = { h: 0, off: 0 };
  a.fly(200, () => {
    const G = c.geoNow();
    if (G && c.course?.run && c.course.run.t > 20) {
      const r = onRunway(W, G);
      worst = { h: Math.max(worst.h, Math.abs(r.h - 300)), off: Math.max(worst.off, Math.abs(Math.abs(r.across) - 1800)) };
    }
    return c.course?.run?.steps[c.course.run.i]?.who === "you";
  });
  const r = onRunway(W, c.geoNow()!);
  console.log(
    `  handed over at ${c.course!.run!.t.toFixed(0)} s: ${Math.round(r.along)} m along, ${Math.round(r.across)} m across, ${Math.round(r.h)} m up — worst ${Math.round(worst.h)} m, ${Math.round(worst.off)} m`,
  );
  expect(c.course!.run!.steps[c.course!.run!.i]!.name).toBe("Base turn");
  expect(r.along).toBeLessThan(-3000);
  expect(worst.h).toBeLessThan(40);
  expect(worst.off).toBeLessThan(250);
  expect(c.gearDown).toBe(true);
  // (the pilot's base: the instructor samples the circuit's channels)
  a.fly(2);
  const s = c.courseSample()!;
  expect(s.kind).toBe("circuit");
  expect(s.v.alt).toBeCloseTo(r.h - 200, -1);
}, 300_000);

test("the instructor's guided channels call their deviations", () => {
  const R = newInstr("formation", "formation", "Formation");
  let call = null as null | { text: string };
  for (let i = 0; i < 60 && !call; i++) call = instrStep(R, i, "x", { fwd: -25, right: 0, up: 0 }, 0.1);
  expect(call!.text).toBe("Falling behind");
});

// The demonstrations whole: TARS flies the pilot's part too (the user's report — "the landing never lands"); each step
// ended by its own condition, not its time at most (courseLast.late empty), never stalled.

/** The F-35B over Edwards (a flat plain at the runway's level): `along`, `across` its runway's frame, `h` over it, `hdg`, `v`. */
function overEdwards(along: number, across: number, h: number, hdg: number, v: number) {
  const K = SITES.find((x) => x.icao === "KEDW")!;
  const W = { name: K.name, icao: "KEDW", lat: K.lat, lon: K.lon, hdg: K.rwy!, elev: K.elev!, len: RUNWAY_LENGTH };
  setGroundHeights("earth", () => W.elev);
  gcasForget();
  const D = Math.PI / 180;
  const p = fromRunway(W, along, across);
  const g = ourGroundPose("earth", p.lat, p.lon, 0);
  const north = cross(g.up, g.fwd);
  const fwd = add(scale(north, Math.cos(hdg * D)), scale(g.fwd, Math.sin(hdg * D)));
  const X = add(g.X, scale(g.up, h / M_METRES));
  const a = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, v / C_MPS)), landed: undefined }, false, "f35");
  a.c.s.flightMode = "plane";
  a.c.pilot.throttle = a.c.pilot.engineNow = 0.5;
  fleet.fuel.f35 = 3000;
  a.fly(0.5);
  return { a, c: a.c, W };
}

test("demonstrations: TARS flies every step — the pilot's too, but a figure's second time", () => {
  const D = newCourse("first", "demo", 0, 0);
  expect(D.steps.length).toBe(7);
  expect(D.steps.every((s) => s.who === "tars")).toBe(true);
  expect(D.steps[3]!.act).toEqual(["holds"]);
  expect(newCourse("landing", "demo", 0, 0).steps.map((s) => s.act)).toEqual([["ils-auto"], ["ils-auto"]]);
  expect(newCourse("guns", "demo", 0, 0).steps[1]!.act).toEqual(["icpt", "guns-auto"]);
  expect(newCourse("loop", "demo", 0, 0).steps.length).toBe(1);
  // (every lesson's pilot step but a figure's has TARS's way to fly it)
  for (const L of LESSONS) {
    const C = courseOf(L.id);
    if (C.kind === "figure") continue;
    expect(newCourse(L.id, "demo", 0, 0).steps.length).toBe(C.steps.length);
  }
});

test("the first flight demonstrated whole: TARS's seven steps, back to the start's height and heading, slowed", () => {
  const a = cruise(2500, 200, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  const said: string[] = [];
  c.onCourseSay = (s) => said.push(s);
  c.courseStart("first", "demo");
  a.fly(1);
  const R = c.course!.run!;
  const h0 = R.alt0;
  const t = a.fly(500, () => !c.course);
  const f = c.jetFigures()!;
  console.log(`  demonstrated in ${t.toFixed(0)} s: ${Math.round(f.h - h0)} m from the start's height, ${Math.round(f.V)} m/s`);
  expect(c.course).toBe(null);
  expect(said.length).toBe(8);
  expect(said[said.length - 1]).toMatch(/demonstration/);
  expect(Math.abs(f.h - h0)).toBeLessThan(60);
  expect(Math.abs(f.V - 160)).toBeLessThan(10);
}, 300_000);

test("the landing demonstrated whole: TARS flies the final, the flare, down and stopped on the runway", () => {
  const { a, c, W } = overEdwards(-6000, 0, 6300 * Math.tan((3 * Math.PI) / 180), SITES.find((x) => x.icao === "KEDW")!.rwy!, 85);
  c.gearDown = true;
  c.ilsStart("KEDW");
  c.courseStart("landing", "demo");
  const t = a.fly(300, () => !!c.ilsLast && !c.ilsRun);
  const L = c.ilsLast;
  console.log(
    `  down and stopped in ${t.toFixed(0)} s: ${L?.score}/20, ${Math.round(L?.touch?.along ?? 0)} m in, ${L?.touch?.across.toFixed(1)} m off`,
  );
  expect(L).toBeTruthy();
  expect(L!.touch!.along).toBeGreaterThan(100);
  expect(L!.touch!.along).toBeLessThan(W.len / 2);
  expect(c.course).toBe(null);
}, 300_000);

test("the circuit demonstrated whole: the downwind, the base round onto the centreline, the final, down and stopped", () => {
  const K = SITES.find((x) => x.icao === "KEDW")!;
  const { a, c, W } = overEdwards(1500, 1800, 300, (K.rwy! + 180) % 360, 100);
  c.gearDown = true;
  const said: string[] = [];
  c.onCourseSay = (s) => said.push(s);
  c.courseStart("circuit", "demo", { rwy: W });
  let worst = 0;
  let axisAt = 0;
  const t = a.fly(500, () => {
    const G = c.geoNow();
    const st = c.course?.run?.steps[c.course.run.i];
    if (process.env.TRACE && G && Math.round((c.course?.run?.t ?? 0) * 30) % 150 === 0) {
      const r = onRunway(W, G);
      console.log(
        st?.name,
        c.ilsRun?.phase,
        Math.round(r.along),
        Math.round(r.across),
        Math.round(r.h),
        Math.round(c.jetFigures()?.V ?? 0),
        Math.round(((c.jetFigures()?.hdg ?? 0) * 180) / Math.PI),
      );
    }
    if (G && st?.name === "Final and landing") {
      if (!axisAt) axisAt = onRunway(W, G).along;
      const r = onRunway(W, G);
      if (r.along < -300) worst = Math.max(worst, Math.abs(r.across));
    }
    return !!c.ilsLast && !c.ilsRun;
  });
  const L = c.ilsLast;
  console.log(
    `  down and stopped in ${t.toFixed(0)} s: lined up ${Math.round(-axisAt)} m out, worst ${Math.round(worst)} m off on the final; ${L?.score}/20, ${Math.round(L?.touch?.along ?? 0)} m in, ${L?.touch?.across.toFixed(1)} m off`,
  );
  expect(L).toBeTruthy();
  expect(-axisAt).toBeGreaterThan(1500);
  expect(-axisAt).toBeLessThan(7000);
  expect(Math.abs(L!.touch!.across)).toBeLessThan(8);
  expect(L!.touch!.along).toBeGreaterThan(50);
  expect(said.length).toBe(4);
}, 300_000);

test("guns demonstrated whole: TARS into the drone's six, his own bursts, the kill", () => {
  const a = cruise(4000, 200, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  const said: string[] = [];
  c.onCourseSay = (x) => said.push(x);
  c.courseStart("guns", "demo");
  a.fly(2);
  const t = a.fly(400, () => !c.course);
  console.log(`  ${said.join(" · ")} — ${t.toFixed(0)} s`);
  expect(c.course).toBe(null);
  expect(said.length).toBe(3);
  expect(c.combat!.world.targets.some((x) => x.name === "BQM-7" && !x.alive)).toBe(true);
  expect(c.gunTrigger).toBe(false);
}, 300_000);

test("formation demonstrated whole: the rejoin, a minute in the slot — none of its steps late", () => {
  const a = cruise(5000, 180, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  c.courseStart("formation", "demo");
  a.fly(2);
  let worst = 0;
  const t = a.fly(400, () => {
    const s = c.course?.run?.steps[c.course.run.i];
    if (s?.name === "Holding the slot") worst = Math.max(worst, c.icpt?.last?.dist ?? 0);
    return !c.course;
  });
  console.log(`  ${t.toFixed(0)} s, the slot held within ${worst.toFixed(1)} m; ${JSON.stringify(c.courseLast)}`);
  expect(c.courseLast?.late).toEqual([]);
  expect(c.courseLast?.failed).toBeUndefined();
  expect(worst).toBeLessThan(15);
}, 300_000);

test("the intercept demonstrated whole: the collision course, the conversion to its tail — none of its steps late", () => {
  const a = cruise(6000, 250, 0.75);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  c.courseStart("intercept", "demo");
  a.fly(2);
  const t = a.fly(700, () => !c.course);
  console.log(`  ${t.toFixed(0)} s; ${JSON.stringify(c.courseLast)}`);
  expect(c.course).toBe(null);
  expect(c.courseLast?.late).toEqual([]);
  expect(c.courseLast?.failed).toBeUndefined();
}, 300_000);

test("the ILS demonstrated whole from 12 km: down and stopped — none of its steps late", () => {
  const { a, c, W } = overEdwards(-12_000, 0, 12_300 * Math.tan((3 * Math.PI) / 180), SITES.find((x) => x.icao === "KEDW")!.rwy!, 95);
  c.gearDown = true;
  c.ilsStart("KEDW");
  c.courseStart("ils", "demo");
  const t = a.fly(400, () => !!c.ilsLast && !c.ilsRun && !c.course);
  console.log(
    `  ${t.toFixed(0)} s: ${c.ilsLast?.score}/20, ${Math.round(c.ilsLast?.touch?.along ?? 0)} m in; ${JSON.stringify(c.courseLast)}`,
  );
  expect(c.ilsLast?.touch?.along).toBeLessThan(W.len / 2);
  expect(c.courseLast?.late).toEqual([]);
}, 300_000);

test("a demonstration that goes nowhere is given up, said — the stall watch", () => {
  const a = cruise(5000, 180, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  const said: string[] = [];
  c.onCourseSay = (x) => said.push(x);
  c.courseStart("formation", "demo");
  a.fly(2);
  // (the leader made unreachable: carried 40 m further north every frame)
  const q = c.combat!.world.target(c.course!.target!)!;
  a.fly(200, () => {
    q.p[1] += 40;
    return !c.course;
  });
  console.log(`  ${said[said.length - 1]} — ${JSON.stringify(c.courseLast)}`);
  expect(c.courseLast?.failed).toBe("The rejoin");
  expect(said[said.length - 1]).toMatch(/stopped/);
}, 300_000);
