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
  // (not done: at most 60 s, then on)
  run(61, fix({ alt: 3400, hdg: 140 }));
  expect(R.steps[R.i]!.name).toBe("Descend");
  run(6, fix({ alt: 2500, hdg: 90 }));
  run(6, fix({ alt: 2500, hdg: 90, spd: 160 }));
  expect(said[said.length - 1]).toBe("end");
  expect(R.done).toBe(true);
  // (a demonstration: TARS's three; a try: the pilot's four, the first letting the holds go)
  expect(newCourse("first", "demo", 0, 0).steps.map((s) => s.who)).toEqual(["tars", "tars", "tars"]);
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
