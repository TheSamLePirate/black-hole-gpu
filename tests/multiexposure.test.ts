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
  expect(plan.frames.at(-1)!.blend).toBe("base");
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

// PLAN-CIEL C9: an eclipse's sequence
import { readFileSync } from "node:fs";
import { addEphemeris } from "../src/system/de440";
import { discSeen, placeInset } from "../src/photo/multiexposure";
import { eclipseHere, eclipseMoments, eclipsePlan, placeFrames } from "../src/photo/plans";

const de = readFileSync("assets/ephemeris/de440.bin");
addEphemeris(de.buffer.slice(de.byteOffset, de.byteOffset + de.byteLength));
const BURGOS = { lat: 42.34, lon: -3.7 };

test("the 2026 total eclipse from Burgos: 5 phases before, the totality, those after above the horizon, the shares rising then falling", () => {
  const e = eclipseHere("solar", Date.UTC(2026, 7, 12), BURGOS.lat, BURGOS.lon)!;
  expect(e.type).toBe("total");
  expect(e.contacts.map((c) => c.name)).toEqual(["C1", "C2", "C3", "C4"]);
  const m = eclipseMoments(e, BURGOS.lat, BURGOS.lon, 5, 5);
  // (C4 is under the horizon, the last phase before it still just over it)
  expect(m.length).toBe(11);
  const c = m.findIndex((x) => x.central);
  expect(c).toBe(5);
  expect(m[c]!.hidden).toBe(1);
  expect(new Date(m[c]!.ms).toISOString().slice(11, 16)).toBe("18:29");
  for (let i = 1; i <= c; i++) expect(m[i]!.hidden).toBeGreaterThan(m[i - 1]!.hidden);
  for (let i = c + 1; i < m.length; i++) expect(m[i]!.hidden).toBeLessThan(m[i - 1]!.hidden);
  for (const x of m) expect(x.alt).toBeGreaterThan(-0.5);
  expect(eclipseHere("solar", Date.UTC(2026, 7, 12), -40, 140)).toBeNull();
});

test("the sequence's frames: the totality as the base (last), each phase a close frame laid at its disc", () => {
  const plan = eclipsePlan({
    kind: "solar",
    date: Date.UTC(2026, 7, 12),
    ...BURGOS,
    before: 5,
    after: 5,
    base: "central",
    framing: "landscape",
    aspect: 16 / 9,
    template: {} as Preset,
    phaseEV: 9,
    centralComp: 0,
  })!;
  expect(plan.frames.length).toBe(11);
  const base = plan.frames.at(-1)!;
  expect(base.blend).toBe("base");
  expect(base.exposure).toBe("auto");
  const phases = plan.frames.slice(0, -1);
  expect(phases.every((f) => f.inset && f.blend === "lighten" && f.exposure === 9)).toBe(true);
  // (the close frames: a field of a degree or so, on the disc as seen)
  expect(phases[0]!.preset.fov!).toBeLessThan(1.2);
  const marks = analemmaMarks([], plan.view, 1920, 1080);
  expect(marks).toEqual([]);
  const placed = placeFrames(plan.frames, [{ x: 100, y: 50, r: 8, ms: phases[0]!.ms!, az: 0, alt: 0 }]);
  expect(placed[0]!.inset).toMatchObject({ x: 100, y: 50, r: 8 });
  const lunar = eclipsePlan({
    ...BURGOS,
    lat: 35,
    lon: -100,
    kind: "lunar",
    date: Date.UTC(2026, 2, 3),
    before: 5,
    after: 5,
    base: "central",
    framing: "sky",
    aspect: 16 / 9,
    template: {} as Preset,
    phaseEV: 0,
    centralComp: 0,
  })!;
  expect(lunar.eclipse.type).toBe("total");
  // (the night's landscape five stops under the meter, the red Moon laid over it)
  expect(lunar.frames.at(-1)).toMatchObject({ blend: "base", exposure: "auto", comp: -5 });
  expect(lunar.frames.filter((f) => f.inset).every((f) => f.exposure === "auto")).toBe(true);
});

test("a close frame laid at its place, its disc's mean; a disc behind the ground not laid", () => {
  const N = 64;
  const disc = (inside: number, sky: number) => {
    const px = new Uint8Array(N * N * 4);
    for (let v = 0; v < N; v++)
      for (let u = 0; u < N; u++) {
        const d = Math.hypot(u + 0.5 - N / 2, v + 0.5 - N / 2);
        px.fill(d < 16 ? inside : sky, (v * N + u) * 4, (v * N + u) * 4 + 3);
        px[(v * N + u) * 4 + 3] = 255;
      }
    return px;
  };
  // (the field: its disc of 16 px — DISC_DEG over a field twice its 1.6 radii)
  const fov = (2 * Math.atan((32 / 16) * Math.tan((0.266 * Math.PI) / 180)) * 180) / Math.PI;
  expect(discSeen(disc(200, 20), N, 16)).toBe(true);
  expect(discSeen(disc(22, 20), N, 16)).toBe(false);
  const out = new Uint8ClampedArray(40 * 40 * 4);
  expect(placeInset(out, disc(200, 0), 40, 40, N, { x: 20, y: 20, r: 4, k: 1.12, fov })).toBe(true);
  expect(out[(20 * 40 + 20) * 4]).toBe(200);
  expect(out[(20 * 40 + 30) * 4]).toBe(0);
  expect(placeInset(out, disc(22, 20), 40, 40, N, { x: 5, y: 5, r: 4, k: 1.12, fov })).toBe(false);
  expect(out[(5 * 40 + 5) * 4]).toBe(0);
});
