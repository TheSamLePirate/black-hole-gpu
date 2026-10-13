import { expect, test } from "bun:test";
import { AeroJudge, CHALLENGES, courseMedal, gateCrossing, landingMarks, marksMedal, verticalMarks, type GateAbs } from "../src/game/challenges";

const D = Math.PI / 180;
const M = 1 / 111_195; // degrees of latitude per metre

test("a gate: its plane crossed forwards, inside its frame or beside it; backwards, not at all", () => {
  const g: GateAbs = { lat: 50, lon: 0, agl: 100, alt: 400, hdg: 0, w: 200, h: 100 };
  const at = (n: number, e: number, alt: number) => ({ lat: 50 + n * M, lon: (e * M) / Math.cos(50 * D), alt });
  const x = gateCrossing(g, at(-50, 30, 410), at(50, 30, 410))!;
  expect(x.inside).toBe(true);
  expect(x.across).toBeCloseTo(30, 0);
  expect(x.up).toBeCloseTo(10, 0);
  expect(gateCrossing(g, at(-50, 130, 410), at(50, 130, 410))!.inside).toBe(false);
  expect(gateCrossing(g, at(-50, 0, 470), at(50, 0, 470))!.inside).toBe(false);
  expect(gateCrossing(g, at(50, 0, 400), at(-50, 0, 400))).toBeNull();
  expect(gateCrossing(g, at(-80, 0, 400), at(-40, 0, 400))).toBeNull();
});

test("the courses: every gate turned the way it is flown, the start before the first", () => {
  for (const c of CHALLENGES.filter((q) => q.kind === "gates")) {
    const G = c.gates!;
    expect(G.length).toBeGreaterThan(3);
    for (let i = 1; i < G.length; i++) {
      // (the next gate lies ahead of the previous one's heading — within 100°)
      const a = G[i - 1]!,
        b = G[i]!;
      const brg = Math.atan2((b.lon - a.lon) * Math.cos(a.lat * D), b.lat - a.lat) / D;
      const off = Math.abs(((brg - a.hdg + 540) % 360) - 180);
      expect(off, `${c.id} gate ${i}`).toBeLessThan(100);
    }
  }
});

test("a landing marked: a perfect one, a hard one, a long one, off the line", () => {
  expect(landingMarks({ sink: 0.9, past: 310, off: 1, dv: 1 }).marks).toBe(100);
  expect(landingMarks({ sink: 3.5, past: 310, off: 1, dv: 1 }).marks).toBe(70);
  expect(landingMarks({ sink: 0.9, past: 1200, off: 1, dv: 1 }).marks).toBe(70);
  expect(landingMarks({ sink: 0.9, past: -50, off: 1, dv: 1 }).marks).toBe(70);
  expect(landingMarks({ sink: 0.9, past: 310, off: 30, dv: 1 }).marks).toBe(80);
  expect(verticalMarks({ dist: 2, sink: 0.6, drift: 0.2 }).marks).toBe(100);
  expect(verticalMarks({ dist: 40, sink: 0.6, drift: 0.2 }).marks).toBe(55);
});

test("medals: a course's time against its par, marks against theirs", () => {
  expect(courseMedal(100, 100)).toBe("gold");
  expect(courseMedal(112, 100)).toBe("silver");
  expect(courseMedal(130, 100)).toBe("bronze");
  expect(courseMedal(140, 100)).toBeNull();
  expect(marksMedal(86, 85)).toBe("gold");
  expect(marksMedal(60, 85)).toBe("bronze");
});

test("aerobatics: a clean roll and a round loop recognised and marked high; a sloppy roll lower", () => {
  const J = new AeroJudge(["roll", "loop"]);
  let t = 0;
  const base = { heading: 90 * D, gamma: 0, alt: 3000, lat: 35, lon: -117 };
  // level a second, then a roll at 180°/s
  for (let k = 0; k < 10; k++) J.step({ ...base, t: (t += 0.1), bank: 0 });
  let r = null;
  for (let k = 1; k <= 25 && !r; k++) r = J.step({ ...base, t: (t += 0.1), bank: Math.atan2(Math.sin(k * 18 * D), Math.cos(k * 18 * D)) });
  expect(r?.figure).toBe("roll");
  expect(r!.marks).toBeGreaterThan(9);
  // a loop: radius 1500 m at 220 m/s, in the vertical plane heading east
  const R = 1500,
    V = 220;
  for (let k = 0; k < 10; k++) J.step({ ...base, t: (t += 0.1), bank: 0 });
  let lp = null;
  for (let s = 0; s <= 2 * Math.PI * R + 400 && !lp; s += V * 0.1) {
    const th = s / R; // the path's angle
    const g = Math.atan2(Math.sin(th), Math.abs(Math.cos(th)));
    const heading = Math.cos(th) >= 0 ? 90 * D : 270 * D;
    const east = R * Math.sin(th);
    lp = J.step({ t: (t += 0.1), bank: Math.cos(th) >= 0 ? 0 : Math.PI, heading, gamma: th > 2 * Math.PI ? 0 : g, alt: 3000 + R * (1 - Math.cos(th)), lat: 35, lon: -117 + east / (111_195 * Math.cos(35 * D)) });
  }
  expect(lp?.figure).toBe("loop");
  expect(lp!.marks).toBeGreaterThan(9);
  expect(J.done).toBe(true);
  expect(J.total()).toBeGreaterThan(90);
  // a roll that loses 150 m and 20° of heading
  const S = new AeroJudge(["roll"]);
  t = 0;
  for (let k = 0; k < 5; k++) S.step({ ...base, t: (t += 0.1), bank: 0 });
  let q = null;
  for (let k = 1; k <= 25 && !q; k++)
    q = S.step({ ...base, t: (t += 0.1), heading: (90 + k * 0.8) * D, alt: 3000 - k * 6, bank: Math.atan2(Math.sin(k * 18 * D), Math.cos(k * 18 * D)) });
  expect(q!.marks).toBeLessThan(5);
});
