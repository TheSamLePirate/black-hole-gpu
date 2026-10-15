import { afterEach, describe, expect, test } from "bun:test";
import { airframeOf, rcsOf } from "../src/game/airtypes";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import type { Plane, TrafficFeed } from "../src/traffic/feed";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The real traffic in the sky (docs/PLAN-AVIATION-AAA.md, T2; controller/traffic.ts, game/airtypes.ts): each type its
// mesh and size; live, an aircraft carried on from its last report — along its turn —, placed on the WGS84 Earth at
// its altitude; delayed, flown between its reports 15 s apart — its turn as it was, no jump —; on the radar,
// neutral; in formation with an airliner reporting every 5 s, held.

afterEach(resetFlights);

const D = Math.PI / 180;

describe("the types", () => {
  test("an A320, a 777, a CRJ-900, a Falcon 7X, a Cessna 172, a helicopter, an unknown heavy", () => {
    expect(airframeOf("A320")).toMatchObject({ mesh: "a320", len: 37.6 });
    expect(airframeOf("B77W").len).toBe(73.9);
    expect(airframeOf("CRJ9")).toMatchObject({ mesh: "crj900", len: 36.2 });
    expect(airframeOf("FA7X").mesh).toBe("crj900");
    expect(airframeOf("C172").len).toBeLessThan(9);
    expect(airframeOf("EC35").mesh).toBeNull();
    expect(airframeOf("", "A7").mesh).toBeNull();
    expect(airframeOf("ZZZZ", "A5").len).toBe(64);
    expect(airframeOf("A388").span).toBeGreaterThan(60);
    expect(rcsOf(37.6)).toBeCloseTo(42, 0);
  });
});

/** A plane's report at time t: over Paris at 3 000 m, 150 m/s, its track turning at `rate` [°/s] since t0. */
function report(t: number, t0: number, rate: number, base = { lat: 48.9, lon: 2.4 }): Plane {
  const trk0 = 90;
  const dt = t - t0;
  const r = rate * D;
  const gs = 150;
  const psi = trk0 * D;
  const e = Math.abs(r) > 1e-9 ? (gs / r) * (Math.cos(psi) - Math.cos(psi + r * dt)) : gs * Math.sin(psi) * dt;
  const n = Math.abs(r) > 1e-9 ? (gs / r) * (Math.sin(psi + r * dt) - Math.sin(psi)) : gs * Math.cos(psi) * dt;
  return {
    id: "3949ed",
    cs: "AFR357E",
    reg: "F-GSPN",
    type: "A320",
    cat: "A3",
    lat: base.lat + n / (D * 6_378_137),
    lon: base.lon + e / (D * 6_378_137 * Math.cos(base.lat * D)),
    alt: 3000,
    gs,
    trk: trk0 + rate * dt,
    hdg: null,
    vs: 0,
    roll: null,
    gnd: false,
    t,
    src: "adsb.lol",
  };
}

type Tracked = { p: Plane; prev: Plane | null; hist: Plane[]; heard: number };

/** A feed stub: the plane's reports every `every` s as the clock runs, its history kept. */
function feedOf(rate: number, t0: number, every = 5, make = (t: number) => report(t, t0, rate)) {
  const planes = new Map<string, Tracked>();
  const F = { planes, ships: new Map(), status: "live", credit: {}, attribution: [] } as unknown as TrafficFeed;
  let last = Number.NaN;
  const at = (now: number) => {
    const t = t0 + Math.floor((now - t0) / every) * every;
    if (t !== last) {
      const T = planes.get("3949ed");
      const p = make(t);
      planes.set("3949ed", { p, prev: T?.p ?? null, hist: [...(T?.hist ?? []), p], heard: now });
      last = t;
    }
  };
  return { F, at };
}

describe("an aircraft between its reports", () => {
  test("live: placed at its geometric altitude over the WGS84 ellipsoid; carried along its turn", () => {
    const { c } = cruise(3000, 200, 0.6);
    c.s.trafficDelay = 0;
    const t0 = 1_800_000_000;
    let now = t0;
    const { F, at } = feedOf(1.5, t0);
    c.traffic = F;
    c.trafficClock = () => now;
    at(now);
    // (a second report 5 s on: its turn known)
    now += 5;
    at(now);
    const c0 = c.trafficNow()[0]!;
    const g0 = cartToGeodetic(WGS84_A, WGS84_F, c0.p as [number, number, number]);
    expect(g0.h).toBeCloseTo(3000, 0);
    // (carried 4 s on: where the next report will say)
    now += 4;
    const c1 = c.trafficNow()[0]!;
    const truth = report(now, t0, 1.5);
    const g1 = cartToGeodetic(WGS84_A, WGS84_F, c1.p as [number, number, number]);
    const miss = Math.hypot((g1.lat / D - truth.lat) * 111_000, (g1.lon / D - truth.lon) * 111_000 * Math.cos(48.9 * D));
    console.log(`  carried 4 s along its 1.5°/s turn: ${miss.toFixed(1)} m from its next report; banked ${(c1.bank / D).toFixed(0)}°`);
    expect(miss).toBeLessThan(3);
    expect(c1.bank / D).toBeGreaterThan(15);
    expect(c1.mesh).toBe("a320");
  });

  test("a minute behind: flown on its path through reports 8 s apart, noisy — its turn as it was, its bank, no jump from frame to frame", () => {
    const { c } = cruise(3000, 200, 0.6);
    c.s.trafficDelay = 60;
    const t0 = 1_800_000_000;
    // (the truth flown every 10 ms: 150 m/s east, a 2°/s right turn rolled into from 100 s and out from 140 s, 5 s
    // each)
    const dt = 0.01,
      tab: { e: number; n: number; trk: number; w: number }[] = [];
    let e = 0,
      n = 0,
      psi = Math.PI / 2;
    const ramp = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
    for (let i = 0; i <= 260 / dt; i++) {
      const w = 2 * D * (ramp(i * dt, 100, 105) - ramp(i * dt, 140, 145));
      tab.push({ e, n, trk: psi, w });
      e += 150 * Math.sin(psi) * dt;
      n += 150 * Math.cos(psi) * dt;
      psi += w * dt;
    }
    const at0 = (t: number) => tab[Math.max(0, Math.min(tab.length - 1, Math.round((t - t0) / dt)))]!;
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const base = report(t0, t0, 0);
    const where = (t: number) => {
      const T = at0(t);
      return { lat: base.lat + T.n / (D * 6_378_137), lon: base.lon + T.e / (D * 6_378_137 * Math.cos(base.lat * D)), trk: T.trk };
    };
    const { F, at } = feedOf(0, t0, 8, (t) => {
      const W = where(t);
      return { ...base, t, lat: W.lat + (r() * 12) / 111_195, lon: W.lon + (r() * 12) / 73_000, trk: (W.trk / D + r() * 0.2) % 360 };
    });
    c.traffic = F;
    let now = t0;
    c.trafficClock = () => now;
    let worst = 0,
      jerk = 0,
      bankMid = 0,
      prev: number[] | null = null,
      vPrev: number[] | null = null;
    for (; now < t0 + 250; now += 0.1) {
      at(now);
      const cs = c.trafficNow();
      if (now - t0 < 75) continue;
      const k = cs[0]!;
      const want = where(now - 60);
      const g = cartToGeodetic(WGS84_A, WGS84_F, k.p as [number, number, number]);
      worst = Math.max(worst, Math.hypot((g.lat / D - want.lat) * 111_195, (g.lon / D - want.lon) * 111_195 * Math.cos(48.9 * D)));
      if (prev && vPrev) jerk = Math.max(jerk, Math.hypot(...[0, 1, 2].map((i) => k.p[i]! - prev![i]! - vPrev![i]! * 0.1)));
      prev = k.p;
      vPrev = k.v;
      if (Math.abs(now - 60 - (t0 + 125)) < 0.05) bankMid = k.bank / D;
    }
    const want = Math.atan2(150 * 2 * D, 9.80665) / D;
    console.log(
      `  a minute behind, reports 8 s apart ±12 m: within ${worst.toFixed(1)} m of where it was; mid-turn banked ${bankMid.toFixed(1)}° (its turn's ${want.toFixed(1)}°); a frame's step off its velocity ${(jerk * 100).toFixed(0)} cm at worst`,
    );
    expect(worst).toBeLessThan(20);
    expect(Math.abs(bankMid - want)).toBeLessThan(3);
    expect(jerk).toBeLessThan(0.3);
  });
});

describe("in formation with an airliner", () => {
  test("AFR357E, an A320 reporting every 5 s: on the radar neutral; formation on the lock, held", () => {
    // (our F-35 3 km behind it, east, at its height — over the Atlantic)
    const run = cruise(3000, 160, 0.6);
    const { c, fly } = run;
    c.s.wind = 0;
    c.jetToggle("ap");
    c.jetToggle("athr");
    const g = c.geoNow()!;
    const t0 = 1_800_000_000;
    let now = t0;
    // (it drawn a minute behind its reports: their base 3 km and a minute's flight ahead of us; its last two minutes'
    // reports already heard)
    const base = { lat: g.lat, lon: g.lon + (3000 + 60 * 150) / (D * 6_378_137 * Math.cos(g.lat * D)) };
    const { F, at } = feedOf(0, t0, 5, (t) => ({ ...report(t, t0, 0, base), alt: g.alt }));
    const feed = () => at(now);
    c.traffic = F;
    c.trafficClock = () => now;
    for (now = t0 - 120; now < t0; now += 1) feed();
    now = t0;
    feed();
    const step = (s: number, each?: () => void) => {
      for (let i = 0; i < s * 30; i++) {
        now += 1 / 30;
        feed();
        fly(1 / 30);
        each?.();
      }
    };
    step(3);
    const T = c.radar.tracks.get("trf:3949ed");
    expect(T?.iff).toBe("neutral");
    expect(T?.name).toBe("AFR357E");
    c.radar.lockOn("trf:3949ed");
    const said = c.trafficForm();
    console.log(`  ${said}`);
    expect(said).toContain("AFR357E");
    expect(said).toContain("F-GSPN");
    let reached = Number.NaN,
      k = 0;
    step(180, () => {
      k++;
      if (Number.isNaN(reached) && (c.form?.last?.dist ?? Infinity) < 10) reached = k / 30;
    });
    let worst = 0;
    step(60, () => (worst = Math.max(worst, c.form?.last?.dist ?? Infinity)));
    console.log(
      `  on its wing within 10 m at ${reached.toFixed(0)} s; then held within ${worst.toFixed(1)} m over a minute (its reports 5 s apart)`,
    );
    expect(reached).toBeLessThan(180);
    expect(worst).toBeLessThan(6);
  }, 120_000);
});
