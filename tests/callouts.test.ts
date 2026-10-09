import { expect, test } from "bun:test";
import { Callouts, type CalloutInput, sinkLimit } from "../src/game/callouts";

// PLAN-TARS T2: the landing's callouts — the radio heights going down, once each; minimums on a final;
// "sink rate" past the steep glide's envelope (never on the autopilot's own descent, measured); "pull up";
// the HUD's warnings said once as they come.

const base: CalloutInput = { inAir: true, agl: 2000, vz: -20, final: true, dh: 60, alerts: [] };

/** A descent from `from` to the ground, its sink rate a function of the height: the lines said, in order. */
function descend(c: Callouts, sink: (h: number) => number, o: Partial<CalloutInput> = {}, from = 700) {
  const said: string[] = [];
  let h = from;
  while (h > 0) {
    const vz = -sink(h);
    for (const l of c.update({ ...base, ...o, agl: h, hp: h, vz })) said.push(l.id!);
    h += vz / 30;
  }
  return said;
}

// (the entry autopilot's landings at Edwards, measured — the greatest sink in each band of height: 52 m/s
// from 700 to 300 m, 38 at 200–300, 26 at 100–150, 19 at 70–100, 10 at 50–70, under 4 below)
const NOMINAL: [number, number][] = [
  [0, 3.2],
  [10, 3.2],
  [30, 3.7],
  [50, 3.7],
  [70, 9.6],
  [100, 18.7],
  [150, 26.1],
  [200, 31.1],
  [300, 37.6],
  [500, 51.2],
  [700, 51.7],
];
const nominal = (h: number) => {
  for (let i = 1; i < NOMINAL.length; i++) {
    const [h1, v1] = NOMINAL[i]!;
    const [h0, v0] = NOMINAL[i - 1]!;
    if (h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return 51.7;
};

test("a nominal landing: 300 … 10, minimums between 100 and 50 — never sink rate, never pull up", () => {
  const said = descend(new Callouts(), nominal);
  expect(said).toEqual(["h-300", "h-100", "minimums", "h-50", "h-40", "h-30", "h-20", "h-10"]);
});

test("a descent too steep: sink rate; the ground seconds away: pull up — once each while it lasts", () => {
  const said = descend(new Callouts(), (h) => (h < 260 ? 60 : 45));
  expect(said).toContain("sink-rate");
  expect(said).toContain("pull-up");
  expect(said.filter((x) => x === "pull-up").length).toBe(1);
  expect(said.indexOf("sink-rate")).toBeLessThan(said.indexOf("pull-up"));
  // (the envelope: the measured glide well inside it)
  for (const h of [600, 300, 200, 100, 50, 30, 10]) expect(nominal(h)).toBeLessThan(sinkLimit(h) / 1.35);
  expect(sinkLimit(1000)).toBe(Infinity);
  // (the short approach from 1.2 km measured at 8.6 m/s at 40 m, 14 at the ground: sink rate)
  expect(8.6).toBeGreaterThan(sinkLimit(40));
});

test("off a runway's final: no minimums; landed then off again: the heights armed again; a go-around re-arms", () => {
  const c = new Callouts();
  expect(descend(c, nominal, { final: false })).not.toContain("minimums");
  c.update({ ...base, inAir: false, agl: 0, vz: 0 });
  expect(descend(c, nominal, { final: false })[0]).toBe("h-300");
  // (a go-around from 40 m: climbing past 120 m and 60 m, the 100 and 50 said again on the next try)
  const g = new Callouts();
  descend(g, nominal, {}, 700);
  for (let h = 40; h < 200; h += 2) g.update({ ...base, agl: h, hp: h, vz: 8 });
  const again: string[] = [];
  for (let h = 200; h > 45; h -= 0.2) for (const l of g.update({ ...base, agl: h, hp: h, vz: -nominal(h) })) again.push(l.id!);
  expect(again).toEqual(["h-100", "minimums", "h-50"]);
});

test("the HUD's warnings: said as they come, once while they last, the shown-only ones never", () => {
  const c = new Callouts();
  const at = (alerts: { id: string; level: string }[]) =>
    c.update({ ...base, agl: 3000, vz: -5, alerts }).map((l) => [l.id, l.priority, l.text]);
  expect(at([{ id: "gear", level: "warning" }])).toEqual([["alert-gear", 0, "Too low, gear!"]]);
  expect(at([{ id: "gear", level: "warning" }])).toEqual([]);
  expect(
    at([
      { id: "gear", level: "warning" },
      { id: "wheels", level: "caution" },
      { id: "stall", level: "warning" },
    ]),
  ).toEqual([["alert-stall", 0, "Stall! Stall!"]]);
  expect(at([])).toEqual([]);
  expect(at([{ id: "gear", level: "warning" }]).length).toBe(1);
  // (the entry autopilot's glide past the stall, on purpose: not cried; by hand, it is)
  expect(new Callouts().update({ ...base, agl: 30_000, vz: -50, auto: "entry", alerts: [{ id: "stall", level: "warning" }] })).toEqual([]);
  expect(new Callouts().update({ ...base, agl: 30_000, vz: -50, auto: "none", alerts: [{ id: "stall", level: "warning" }] }).length).toBe(
    1,
  );
  // (one that flickers — gone, back within 30 s —: said once)
  const w = new Callouts();
  const sayAt = (now: number, on: boolean) =>
    w.update({ ...base, agl: 3000, vz: -5, now, alerts: on ? [{ id: "shield", level: "warning" }] : [] }).length;
  expect([sayAt(0, true), sayAt(5000, false), sayAt(9000, true), sayAt(20000, false), sayAt(45000, true)]).toEqual([1, 0, 0, 0, 1]);
});
