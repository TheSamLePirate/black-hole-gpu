// PLAN-CIEL C8: the multiple exposure's plan (the analemma's moments, the view framing them, the Suns placed
// in the image for their labels) and its blend.
import { expect, test } from "bun:test";
import { type MxHost, runExposures } from "../src/photo/multiexposure";
import { analemmaMarks, analemmaPlan, analemmaSuns, frame, projectSky } from "../src/photo/plans";
import type { Preset, Settings } from "../src/settings";

const PARIS = { lat: 48.86, lon: 2.35, minutesUtc: 12 * 60, start: Date.UTC(2026, 0, 1), cadence: 7 };

test("the analemma's Suns: a year at noon UTC from Paris, south, between the solstices' heights", () => {
  const s = analemmaSuns(PARIS);
  expect(s.length).toBe(53);
  const alts = s.map((x) => x.alt);
  // (90 − 48.86 ± 23.44, the equation of time shifting the clock's noon a little)
  expect(Math.max(...alts)).toBeGreaterThan(63.5);
  expect(Math.max(...alts)).toBeLessThan(64.7);
  expect(Math.min(...alts)).toBeGreaterThan(17.5);
  expect(Math.min(...alts)).toBeLessThan(18.5);
  for (const x of s) expect(Math.abs(x.az - 180)).toBeLessThan(10);
});

test("a view framing points holds them all, the horizon under them", () => {
  const plan = analemmaPlan({ ...PARIS, base: "dusk", aspect: 0.75, template: {} as Preset, sunEV: 9 });
  const v = plan.view;
  expect(Math.abs(v.az - 182)).toBeLessThan(4);
  for (const m of analemmaMarks(plan.suns, v, 1200, 1600)) {
    expect(m.x).toBeGreaterThan(0);
    expect(m.x).toBeLessThan(1200);
    expect(m.y).toBeGreaterThan(0);
    expect(m.y).toBeLessThan(1600);
  }
  const horizon = projectSky(v, v.az, 0, 1200, 1600)!;
  expect(horizon[1]).toBeLessThan(1600);
  expect(plan.frames[0]!.blend).toBe("base");
  expect(plan.frames.length).toBe(54);
  expect(
    frame(
      [
        { az: 350, alt: 10 },
        { az: 10, alt: 10 },
      ],
      1,
    ).az % 360,
  ).toBeCloseTo(0, 6);
});

test("the pinhole projection: the centre at the middle, the field's top at the top, behind the camera null", () => {
  const v = { az: 180, alt: 30, fov: 40 };
  const [x, y] = projectSky(v, 180, 30, 800, 600)!;
  expect(x).toBeCloseTo(400, 6);
  expect(y).toBeCloseTo(300, 6);
  expect(projectSky(v, 180, 50, 800, 600)![1]).toBeCloseTo(0, 6);
  // (east of south is to the left facing south)
  expect(projectSky(v, 170, 30, 800, 600)![0]).toBeLessThan(400);
  expect(projectSky(v, 0, 0, 800, 600)).toBeNull();
});

test("the labels' Suns stand raised by the refraction, their place written as seen", () => {
  const plan = analemmaPlan({ ...PARIS, base: "none", aspect: 0.75, template: {} as Preset, sunEV: 9 });
  const marks = analemmaMarks(plan.suns, plan.view, 1200, 1600);
  const low = plan.suns.reduce((a, b) => (b.alt < a.alt ? b : a));
  const m = marks.find((x) => x.ms === low.ms)!;
  // (≈ 3′ at 18°)
  expect((m.alt - low.alt) * 60).toBeGreaterThan(2);
  expect((m.alt - low.alt) * 60).toBeLessThan(4);
  expect(m.az).toBe(low.az);
});

test("the blend: the base as it is, the others laid by lighten, the game restored", async () => {
  const shots = [
    [10, 10, 10],
    [200, 0, 0],
    [0, 50, 0],
  ];
  let i = 0,
    restored = false;
  const host: MxHost = {
    settings: {} as Settings,
    apply: () => {},
    settle: async () => {},
    render: async () => Uint8Array.from([...shots[i]!, 255, ...shots[i++]!, 255]),
    snapshot: () => "before",
    restore: (s) => (restored = s === "before"),
    active: () => {},
  };
  const frames = shots.map((_, k) => ({
    preset: {} as Preset,
    exposure: k ? 9 : ("auto" as const),
    blend: k ? ("lighten" as const) : ("base" as const),
    label: "",
  }));
  const r = await runExposures(host, frames, { width: 2, height: 1, spp: 1 }, () => {}, { stop: false });
  expect([...r.data]).toEqual([200, 50, 10, 255, 200, 50, 10, 255]);
  expect(r.rendered).toBe(3);
  expect(restored).toBe(true);
});
