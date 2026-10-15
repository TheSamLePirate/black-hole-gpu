import { expect, test } from "bun:test";
import { AIR_MISSIONS } from "../src/game/airmissions";
import { CombatWorld, LOADOUTS, type V3 } from "../src/game/combat";
import { checkMission, debrief, type MissionSpec, type MissionWorld, missionStep, newRun, type Out } from "../src/game/mission";

// PLAN-AVIATION-AAA P1: a mission as data — checked, its objectives judged frame by frame (identify, escort, destroy,
// protect, land, reach), its triggers fired (said, spawned, turned, the transponder off), its end and its debrief;
// and the renegade flown headless: the airliner set in the fight's world where the mission says (no real flight heard),
// turned away, intercepted, identified, then flown to Lyon on our wing — the mission won.

const D = Math.PI / 180;
const R = 6_371_008.8;
const seeded =
  (s = 1) =>
  () =>
    (s = (s * 16807) % 2147483647) / 2147483647;

const base = (o: Partial<MissionSpec> = {}): MissionSpec => ({
  v: 1,
  id: "t",
  title: "Test",
  brief: "",
  start: { lat: 45, lon: 6, alt: 3000, hdg: 0, speed: 200 },
  units: [{ id: "a", kind: "airliner", at: { lat: 45.1, lon: 6, alt: 5000 }, hdg: 90 }],
  objectives: [{ id: "i", kind: "identify", unit: "a", within: 1000, text: "identify" }],
  ...o,
});

/** A world by hand: ours where set, the units' as given. */
const world = (
  own: { lat: number; lon: number; alt?: number },
  units: Record<string, { lat: number; lon: number; alt: number; alive: boolean }>,
  o: Partial<MissionWorld> = {},
): MissionWorld => ({
  own: { alt: 3000, landed: false, lost: false, ...own },
  unit: (id) => units[id] ?? null,
  onCarrier: null,
  ...o,
});

test("the missions given check, and what is wrong in one is said", () => {
  for (const m of AIR_MISSIONS) {
    const r = checkMission(m.make());
    expect(r.errors).toEqual([]);
    expect(r.spec?.objectives.length).toBeGreaterThan(0);
  }
  const bad = checkMission({
    ...base(),
    objectives: [
      { id: "x", kind: "destroy", units: ["nope"], text: "x" },
      { id: "y", kind: "identify", unit: "a", within: 1, after: "z", text: "y" },
    ],
    triggers: [{ id: "t", when: { time: 1 }, do: [{ spawn: "ghost" }] }],
  });
  expect(bad.spec).toBeNull();
  expect(bad.errors).toEqual(["objective x: no unit nope", "objective y: no objective z", "trigger t: no unit ghost"]);
  expect(checkMission({ title: "", units: [], objectives: [] }).errors).toContain("a start");
  // (JSON through and back: the same mission)
  expect(checkMission(JSON.parse(JSON.stringify(AIR_MISSIONS[0]!.make()))).spec?.id).toBe("renegade");
});

test("an objective after another waits for it; the triggers fire once; the end when the needed are done", () => {
  const spec = base({
    objectives: [
      { id: "i", kind: "identify", unit: "a", within: 1000, text: "identify" },
      { id: "r", kind: "reach", at: { lat: 45.5, lon: 6, radius: 2000 }, after: "i", text: "reach" },
      { id: "b", kind: "destroy", units: ["a"], optional: true, text: "bonus" },
    ],
    triggers: [
      { id: "t1", when: { time: 5 }, do: [{ say: "five" }, { squawk: { unit: "a", off: true } }] },
      { id: "t2", when: { done: "i" }, do: [{ course: { unit: "a", hdg: 180 } }] },
    ],
  });
  const R0 = newRun(spec);
  const A = { a: { lat: 45.1, lon: 6, alt: 5000, alive: true } };
  expect(R0.state).toEqual({ i: "active", r: "waiting", b: "active" });
  missionStep(R0, world({ lat: 45, lon: 6 }, A), 0);
  expect(R0.state.r).toBe("waiting");
  let out: Out[] = [];
  for (let k = 0; k < 6; k++) out.push(...missionStep(R0, world({ lat: 45, lon: 6 }, A), 1));
  expect(out).toEqual([{ say: "five" }, { squawk: { unit: "a", off: true } }]);
  expect(R0.log[0]!.text).toBe("five");
  // (identified: within 1 km, heights counted)
  out = missionStep(R0, world({ lat: 45.1, lon: 6.005, alt: 5000 }, A), 1);
  expect(out).toEqual([{ done: "i" }, { course: { unit: "a", hdg: 180 } }]);
  expect(R0.state.r).toBe("active");
  out = missionStep(R0, world({ lat: 45.3, lon: 6 }, A), 1);
  expect(out).toEqual([]);
  // (reached: won, the optional one left)
  out = missionStep(R0, world({ lat: 45.505, lon: 6 }, A), 1);
  expect(out).toEqual([{ done: "r" }, { win: true }]);
  expect(R0.status).toBe("won");
  const B = debrief(R0);
  expect(B.lines.map((l) => l.state)).toEqual(["done", "done", "active"]);
  expect(B.score).toBe(200);
  expect(B.letter).toBe("A");
});

test("an escort fails 30 s after drifting off; a protect lasts its time; the aircraft lost fails it all", () => {
  const spec = base({
    objectives: [{ id: "e", kind: "escort", unit: "a", until: { lat: 46, lon: 6, radius: 5000 }, within: 3000, text: "escort" }],
  });
  const R1 = newRun(spec);
  const A = { a: { lat: 45.1, lon: 6, alt: 5000, alive: true } };
  for (let k = 0; k < 30; k++) missionStep(R1, world({ lat: 45.0, lon: 6, alt: 5000 }, A), 1);
  expect(R1.status).toBe("flying");
  missionStep(R1, world({ lat: 45.0, lon: 6, alt: 5000 }, A), 1.5);
  expect(R1.status).toBe("failed");
  expect(R1.why).toBe("escort: too far from the escorted aircraft");
  expect(debrief(R1).letter).toBe("F");
  // (back in time: the clock of the drift reset)
  const R2 = newRun(spec);
  for (let k = 0; k < 25; k++) missionStep(R2, world({ lat: 45.0, lon: 6, alt: 5000 }, A), 1);
  missionStep(R2, world({ lat: 45.1, lon: 6.01, alt: 5000 }, A), 1);
  for (let k = 0; k < 25; k++) missionStep(R2, world({ lat: 45.0, lon: 6, alt: 5000 }, A), 1);
  expect(R2.status).toBe("flying");
  missionStep(R2, world({ lat: 45.0, lon: 6, alt: 5000 }, { a: { lat: 45.99, lon: 6, alt: 5000, alive: true } }), 1);
  expect(R2.status).toBe("won");
  // protect
  const R3 = newRun(base({ objectives: [{ id: "p", kind: "protect", unit: "a", seconds: 60, text: "protect" }] }));
  for (let k = 0; k < 59; k++) missionStep(R3, world({ lat: 45, lon: 6 }, A), 1);
  expect(R3.status).toBe("flying");
  missionStep(R3, world({ lat: 45, lon: 6 }, A), 1);
  expect(R3.status).toBe("won");
  const R4 = newRun(base({ objectives: [{ id: "p", kind: "protect", unit: "a", seconds: 60, text: "protect" }] }));
  missionStep(R4, world({ lat: 45, lon: 6 }, { a: { ...A.a, alive: false } }), 1);
  expect(R4.why).toBe("protect: the protected unit lost");
  // lost
  const R5 = newRun(base());
  missionStep(R5, world({ lat: 45, lon: 6, lost: true } as never, A, { own: { lat: 45, lon: 6, alt: 0, landed: false, lost: true } }), 1);
  expect(R5.status).toBe("failed");
  // out of time
  const R6 = newRun(base({ limit: 10 }));
  for (let k = 0; k < 11; k++) missionStep(R6, world({ lat: 45, lon: 6 }, A), 1);
  expect(R6.why).toBe("out of time");
});

test("destroy, then land aboard the carrier named; a trigger's spawn and win", () => {
  const spec = base({
    units: [
      { id: "cv", kind: "carrier", carrier: "ford" },
      { id: "s", kind: "sam", at: { lat: 45.2, lon: 6 } },
      { id: "f", kind: "fighter", at: { lat: 45.3, lon: 6, alt: 6000 }, later: true },
    ],
    objectives: [
      { id: "s", kind: "destroy", units: ["s"], text: "sam" },
      { id: "home", kind: "land", carrier: "cv", after: "s", text: "home" },
    ],
    triggers: [{ id: "z", when: { enter: { lat: 45.2, lon: 6, radius: 20_000 } }, do: [{ spawn: "f" }] }],
  });
  const R1 = newRun(spec);
  let out = missionStep(R1, world({ lat: 45.15, lon: 6 }, { s: { lat: 45.2, lon: 6, alt: 0, alive: true } }), 1);
  expect(out).toEqual([{ spawn: "f" }]);
  out = missionStep(R1, world({ lat: 45.15, lon: 6 }, { s: { lat: 45.2, lon: 6, alt: 0, alive: false } }), 1);
  expect(out).toEqual([{ done: "s" }]);
  // (landed elsewhere: not it)
  missionStep(
    R1,
    world({ lat: 45, lon: 6, landed: true } as never, {}, { own: { lat: 45, lon: 6, alt: 0, landed: true, lost: false } }),
    1,
  );
  expect(R1.status).toBe("flying");
  missionStep(R1, world({ lat: 45, lon: 6 }, {}, { own: { lat: 45, lon: 6, alt: 20, landed: true, lost: false }, onCarrier: "cv" }), 1);
  expect(R1.status).toBe("won");
  // a trigger's win
  const R2 = newRun(base({ triggers: [{ id: "w", when: { time: 2 }, do: [{ say: "go home" }, { win: true }] }] }));
  missionStep(R2, world({ lat: 45, lon: 6 }, {}), 1);
  expect(missionStep(R2, world({ lat: 45, lon: 6 }, {}), 1)).toEqual([{ say: "go home" }, { win: true }]);
  expect(R2.status).toBe("won");
});

test("the renegade, flown headless: turned away, intercepted, identified, then escorted to Lyon — won", () => {
  const spec = checkMission(AIR_MISSIONS.find((m) => m.id === "renegade")!.make()).spec!;
  const A = { lat: spec.start.lat, lon: spec.start.lon };
  const toEn = (p: { lat: number; lon: number }): [number, number] => [
    (p.lon - A.lon) * D * R * Math.cos(A.lat * D),
    (p.lat - A.lat) * D * R,
  ];
  const toLl = (e: number, n: number) => ({ lat: A.lat + n / (D * R), lon: A.lon + e / (D * R * Math.cos(A.lat * D)) });
  const W = new CombatWorld([], LOADOUTS.aa, () => 0, seeded());
  // (as controller/mission.ts: no real flight heard — the unit where the mission says)
  const u = spec.units[0]!;
  const [ue, un] = toEn(u.at!);
  const id = W.addTarget({ kind: "airliner", at: [ue, un, u.at!.alt!], hdg: u.hdg, speed: u.speed, name: u.name });
  const q = W.targets.find((x) => x.id === id)!;
  q.neutral = true;
  // ours: a point flown at 300 m/s straight at it, then on its wing (300 m to its right, 50 m behind)
  const own = { p: [0, 0, spec.start.alt!] as V3, v: [0, 0, 0] as V3 };
  const run = newRun(spec);
  const said: string[] = [];
  let identAt = -1;
  for (let k = 0; k < 60 * 1800 && run.status === "flying"; k++) {
    const dt = 1 / 60;
    const d = [q.p[0] - own.p[0], q.p[1] - own.p[1], q.p[2] - own.p[2]];
    const L = Math.hypot(...d);
    if (L > 800) own.v = d.map((x) => (x / L) * 300) as V3;
    else {
      const f = Math.hypot(q.v[0], q.v[1]) || 1;
      const slot: V3 = [q.p[0] + (q.v[1] / f) * 300 - (q.v[0] / f) * 50, q.p[1] - (q.v[0] / f) * 300 - (q.v[1] / f) * 50, q.p[2]];
      own.v = [...q.v] as V3;
      own.p = [own.p[0] + (slot[0] - own.p[0]) * 0.05, own.p[1] + (slot[1] - own.p[1]) * 0.05, own.p[2] + (slot[2] - own.p[2]) * 0.05];
    }
    own.p = [own.p[0] + own.v[0] * dt, own.p[1] + own.v[1] * dt, own.p[2] + own.v[2] * dt];
    W.step(dt, { p: own.p, v: own.v, fwd: [0, 1, 0], up: [0, 0, 1] });
    const ll = toLl(own.p[0], own.p[1]);
    const out = missionStep(
      run,
      {
        own: { ...ll, alt: own.p[2], landed: false, lost: false },
        unit: (x) => (x === "renegade" ? { ...toLl(q.p[0], q.p[1]), alt: q.p[2], alive: q.alive } : null),
        onCarrier: null,
      },
      dt,
    );
    for (const o of out) {
      if ("say" in o) said.push(o.say);
      if ("squawk" in o) q.squawkOff = o.squawk.off;
      if ("done" in o && o.done === "ident") identAt = run.t;
      if ("course" in o) {
        const c = o.course;
        const to = c.to ? toEn(c.to) : null;
        W.setCourse(id, { hdg: c.hdg, alt: c.alt, speed: c.speed, to: to ? [to[0], to[1], c.to!.alt ?? q.p[2]] : undefined });
      }
    }
    // (turned south at 3 s: its heading)
    if (Math.abs(run.t - 60) < dt / 2) expect((Math.atan2(q.v[0], q.v[1]) / D + 360) % 360).toBeCloseTo(165, -1);
  }
  const B = debrief(run);
  console.log(`  renegade: identified at ${identAt.toFixed(0)} s, ${run.status} at ${run.t.toFixed(0)} s, ${B.twenty}/20 ${B.letter}`);
  expect(said.length).toBe(2);
  expect(q.squawkOff).toBe(false);
  expect(identAt).toBeGreaterThan(30);
  expect(identAt).toBeLessThan(400);
  expect(run.status).toBe("won");
  expect(run.state).toEqual({ ident: "done", escort: "done", land: "active" });
  expect(B.letter).toMatch(/[AB]/);
});
