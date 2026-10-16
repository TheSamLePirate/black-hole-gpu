import { expect, test } from "bun:test";
import { altitudeAt, sunHidden } from "../src/eclipse/earth-moon";
import { checkMission, type MissionWorld, missionStep, newRun } from "../src/game/mission";
import { VIEWS, viewSpec, whenAltitude } from "../src/game/views";

// PLAN-AVIATION-AAA S2: the views of exception — every one a mission that checks (or a challenge given); the eclipse
// of 12 August 2026 met on its central line near Iceland at its real date, totality reached there two minutes after
// the start; the full Moon just risen ahead of the formation; the auroras' night truly dark; the
// carrier's sunset with the Sun 2° up; a route's gates flown in order and low, an eclipse's seconds in totality
// counted, a formation's minute held.

const D = Math.PI / 180;
const NOW = Date.UTC(2026, 9, 16, 12);

test("the views: thirteen, each a mission that checks or a challenge given", () => {
  expect(VIEWS.length).toBe(13);
  for (const v of VIEWS) {
    if (v.challengeId) {
      expect(["machloop", "rainbow"]).toContain(v.challengeId);
      continue;
    }
    const s = viewSpec(v.id, NOW)!;
    expect(checkMission(s).errors).toEqual([]);
    expect(s.time).toBeDefined();
  }
});

test("the eclipse of 12 August 2026: its central line near Iceland, totality there two minutes after the start", () => {
  const s = viewSpec("view-eclipse", NOW)!;
  const t0 = Date.parse(s.time!.utc!);
  console.log(`  the start: ${s.start.lat.toFixed(2)}°, ${s.start.lon.toFixed(2)}° at ${s.time!.utc}, heading ${s.start.hdg.toFixed(0)}°`);
  expect(new Date(t0).toISOString().slice(0, 10)).toBe("2026-08-12");
  expect(s.start.lat).toBeGreaterThan(60);
  expect(s.start.lat).toBeLessThan(70);
  expect(s.start.lon).toBeGreaterThan(-35);
  expect(s.start.lon).toBeLessThan(-15);
  // (not yet total at the start; total where it starts 75 s on)
  expect(sunHidden(s.start.lat * D, s.start.lon * D, 15_000, t0)).toBeLessThan(0.999);
  expect(sunHidden(s.start.lat * D, s.start.lon * D, 15_000, t0 + 120_000)).toBeGreaterThan(0.999);
});

test("the Moon just risen ahead; the auroras' night dark; the carrier's Sun 2° up", () => {
  const m = viewSpec("view-moonrise", NOW)!;
  const tm = Date.parse(m.time!.utc!);
  const alt = altitudeAt("moon", 48.636 * D, -1.511 * D, 0, tm);
  console.log(`  the Moon at ${m.time!.utc}: ${alt.toFixed(1)}° up, its heading ${m.start.hdg.toFixed(0)}°`);
  expect(alt).toBeGreaterThan(0);
  expect(alt).toBeLessThan(6);
  const a = viewSpec("view-aurora", NOW)!;
  expect(altitudeAt("sun", 68.3 * D, 14.3 * D, 0, Date.parse(a.time!.utc!))).toBeLessThan(-14);
  expect(a.weather?.aurora).toBe(4);
  const c = viewSpec("view-sunset-carrier", NOW)!;
  const sun = altitudeAt("sun", 42.6 * D, 7.4 * D, 0, Date.parse(c.time!.utc!));
  expect(sun).toBeGreaterThan(2);
  expect(sun).toBeLessThan(4);
  // (a setting found, then none in a polar day's span)
  expect(whenAltitude("sun", 42.6, 7.4, 2, NOW, false)).not.toBeNull();
});

const world = (own: Partial<MissionWorld["own"]> & { lat: number; lon: number }, o: Partial<MissionWorld> = {}): MissionWorld => ({
  own: { alt: 300, landed: false, lost: false, ...own },
  unit: () => null,
  onCarrier: null,
  ...o,
});

test("a route's gates in order and low; an eclipse's seconds in totality; a formation's minute", () => {
  const s = viewSpec("view-monument-valley", NOW)!;
  const R = newRun(s);
  const o = s.objectives[0]!;
  if (o.kind !== "route") throw new Error("a route");
  // (the second gate first: not counted; the first too high: not counted)
  missionStep(R, world({ lat: o.gates[1]!.lat, lon: o.gates[1]!.lon, agl: 100 }), 1);
  missionStep(R, world({ lat: o.gates[0]!.lat, lon: o.gates[0]!.lon, agl: 400 }), 1);
  expect(R.apart.route ?? 0).toBe(0);
  for (const g of o.gates) missionStep(R, world({ lat: g.lat, lon: g.lon, agl: 120 }), 1);
  expect(R.status).toBe("won");
  const e = newRun(viewSpec("view-eclipse", NOW)!);
  for (let i = 0; i < 100; i++) missionStep(e, world({ lat: 65, lon: -25 }, { sunHidden: 0.98 }), 1);
  expect(e.status).toBe("flying");
  for (let i = 0; i < 181; i++) missionStep(e, world({ lat: 65, lon: -25 }, { sunHidden: 1 }), 1);
  expect(e.status).toBe("won");
  const f = newRun(viewSpec("view-moonrise", NOW)!);
  for (let i = 0; i < 50; i++) missionStep(f, world({ lat: 48.6, lon: -1.6 }, { wingmenInPlace: 2 }), 1);
  missionStep(f, world({ lat: 48.6, lon: -1.6 }, { wingmenInPlace: 1 }), 1);
  for (let i = 0; i < 50; i++) missionStep(f, world({ lat: 48.6, lon: -1.6 }, { wingmenInPlace: 2 }), 1);
  expect(f.status).toBe("flying");
  for (let i = 0; i < 11; i++) missionStep(f, world({ lat: 48.6, lon: -1.6 }, { wingmenInPlace: 2 }), 1);
  expect(f.status).toBe("won");
});
