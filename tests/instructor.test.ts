import { afterEach, expect, test } from "bun:test";
import { CHANNELS, INSTR, instrDebrief, instrStep, newInstr } from "../src/game/instructor";
import { LESSONS, stepAt } from "../src/game/lessons";
import { RUNWAY_LENGTH, SITES } from "../src/game/sites";
import { fromRunway, ILS } from "../src/game/ils";
import { ourGroundPose } from "../src/game/place";
import { add, cross, scale } from "../src/math/vec3";
import { setGroundHeights } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { gcasForget } from "../src/controller/gcas";
import { fleet } from "../src/fleet";
import { flight, resetFlights } from "./helpers/flight";

// PLAN-AVIATION-AAA A4: the instructor — a deviation called once held past its limit for a second, the worst first,
// not the same again for 5 s, nothing within 2 s of another; its debrief (the time within tolerance, the worst, each
// phase's mark, the score, the tips for the worst); the flight school's lessons whole (their paths, their steps
// along them); and an ILS flown headless with the instructor watching: the autopilot's clean approach debriefed high,
// one flown with a speed held 12 m/s fast called "Fast" and marked down.

afterEach(() => {
  resetFlights();
  setGroundHeights("earth", null);
  gcasForget();
});

const D = Math.PI / 180;

test("a deviation called once held past its limit; the worst first; then less and less often; the debrief's marks and tips", () => {
  const R = newInstr("ils", "ils", "ILS");
  const calls: string[] = [];
  const run = (secs: number, v: Record<string, number>, phase = "Final") => {
    for (let i = 0; i < secs * 30; i++) {
      const c = instrStep(R, -5000 + R.t * 80, phase, v, 1 / 30);
      if (c) calls.push(`${R.t.toFixed(1)} ${c.text}`);
    }
  };
  run(3, { gs: 0.1, loc: 0, spd: 1 });
  expect(calls).toEqual([]);
  // (low by 1.2 dots and 10 m/s fast: the glideslope first — its weight —, the speed 2.2 s later)
  run(4, { gs: 1.2, loc: 0, spd: 10 });
  expect(calls.map((c) => c.split(" ").slice(1).join(" "))).toEqual(["Low — below the glideslope", "Fast"]);
  expect(Number(calls[0]!.split(" ")[0])).toBeCloseTo(3 + INSTR.hold, 0);
  expect(Number(calls[1]!.split(" ")[0]) - Number(calls[0]!.split(" ")[0])).toBeGreaterThanOrEqual(INSTR.gap - 0.05);
  run(3, { gs: 1.2, loc: 0, spd: 0 });
  // (the glideslope not again so soon: its second call waits 10 s — a deviation kept is not nagged)
  expect(calls.length).toBe(2);
  run(5, { gs: 1.2, loc: 0, spd: 0 });
  expect(calls.length).toBe(3);
  run(5, { gs: 0, loc: 0, spd: 0 }, "Flare");
  const B = instrDebrief(R);
  console.log(`  ${calls.join(" · ")} — ${B.score}/20; ${B.channels.map((c) => `${c.label} ${Math.round(c.inTol * 100)}%`).join(", ")}`);
  expect(B.channels.find((c) => c.key === "loc")!.inTol).toBe(1);
  expect(B.channels.find((c) => c.key === "gs")!.worst).toBeCloseTo(1.2, 5);
  expect(B.phases.map((p) => p.phase)).toEqual(["Final", "Flare"]);
  expect(B.phases[1]!.mark).toBe(1);
  expect(B.tips[0]!.text).toBe("Low — below the glideslope");
  expect(B.score).toBeLessThan(18);
  expect(B.score).toBeGreaterThan(8);
});

test("the flight school's lessons: each a path, its steps along it in order, the step found where we are", () => {
  expect(LESSONS.length).toBe(12);
  for (const L of LESSONS) {
    expect(L.path.length).toBeGreaterThan(5);
    expect(L.steps.length).toBeGreaterThan(1);
    const at = L.steps.map((s) => s.at);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(Math.max(...at)).toBeLessThan(L.path.length);
    expect(CHANNELS[L.kind].length).toBeGreaterThan(1);
  }
  const ils = LESSONS.find((L) => L.id === "ils")!;
  // (8 km out on the glideslope: past the final fix's step, before minimums)
  const s = stepAt(ils, [-8000, (ILS.gpi + 8000) * Math.tan(ILS.glide * D)]);
  expect(ils.steps[s]!.name).toBe("Final fix");
  const loop = LESSONS.find((L) => L.id === "loop")!;
  const top = loop.path.reduce((a, p) => Math.max(a, p[1]), 0);
  expect(top).toBeGreaterThan(2500);
});

/** The F-35B 12 km out on Edwards's runway 22's glideslope, the gear down. */
function onFinal() {
  const K = SITES.find((x) => x.icao === "KEDW")!;
  const W = { name: K.name, icao: "KEDW", lat: K.lat, lon: K.lon, hdg: K.rwy!, elev: K.elev!, len: RUNWAY_LENGTH };
  setGroundHeights("earth", () => W.elev);
  gcasForget();
  const p = fromRunway(W, -12_000, 0);
  const g = ourGroundPose("earth", p.lat, p.lon, 0);
  const north = cross(g.up, g.fwd);
  const fwd = add(scale(north, Math.cos(W.hdg * D)), scale(g.fwd, Math.sin(W.hdg * D)));
  const h = (ILS.gpi + 12_000) * Math.tan(ILS.glide * D);
  const X = add(g.X, scale(g.up, h / M_METRES));
  const run = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, 90 / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.pilot.throttle = run.c.pilot.engineNow = 0.5;
  run.c.gearDown = true;
  fleet.fuel.f35 = 3000;
  run.fly(0.5);
  return run;
}

test("an ILS watched: the autopilot's debriefed high; flown 12 m/s fast, 'Fast' called and marked down", () => {
  const a = onFinal();
  const debriefs: number[] = [];
  a.c.onInstrDebrief = (L) => debriefs.push(L.debrief.score);
  a.c.ilsStart("KEDW");
  a.fly(300, () => !a.c.ilsRun);
  a.fly(1);
  console.log(
    `  the autopilot's: ${debriefs.join(", ")}/20 — ${a.c.instrLast?.debrief.phases.map((p) => `${p.phase} ${Math.round(p.mark * 100)}%`).join(", ")}`,
  );
  expect(debriefs.length).toBe(1);
  expect(debriefs[0]).toBeGreaterThan(16);
  resetFlights();
  // (fast: the ILS's speed asked 12 m/s over the approach's — its run's guidance nudged)
  const b = onFinal();
  const calls: string[] = [];
  b.c.onInstrCall = (text) => calls.push(text);
  b.c.ilsStart("KEDW");
  const step = b.c.ilsJet.bind(b.c);
  b.c.ilsJet = (inp) => {
    const o = step(inp);
    return o ? { ...o, spd: o.spd > 0 ? o.spd + 12 : o.spd } : o;
  };
  b.fly(300, () => !b.c.ilsRun);
  b.fly(1);
  const B = b.c.instrLast?.debrief;
  console.log(`  12 m/s fast: ${calls.join(" · ")} — ${B?.score}/20; tips: ${B?.tips.map((t) => t.text).join(", ")}`);
  expect(calls).toContain("Fast");
  expect(B!.score).toBeLessThan(debriefs[0]! - 2);
  expect(B!.tips.map((t) => t.text)).toContain("Fast");
}, 300_000);
