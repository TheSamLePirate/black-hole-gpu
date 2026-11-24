import { afterEach, describe, expect, test } from "bun:test";
import { runwayFrame, setWorldRunways, type RunwayFrame } from "../src/game/sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { setGroundHeights } from "../src/system/our-surface";
import type { Plane, TrafficFeed } from "../src/traffic/feed";
import { LANDING, withLanding } from "../src/traffic/landing";
import { trafficRig } from "../src/controller/traffic";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// A real aircraft's landing through the gap in its reports (traffic/landing.ts): lost on short final, heard again —
// if at all — off the runway, taxiing; its landing made up on the runway its last report lined up with — down its
// axis, its touchdown, its rollout braking —, not across the grass; a go-around left as heard.

afterEach(() => {
  setWorldRunways([]);
  resetFlights();
});

const D = Math.PI / 180;
/** a runway 3 km long landing east (090), its threshold at 46° N, 4° E, its ground 120 m over the ellipsoid */
const R: RunwayFrame = runwayFrame({ body: "earth", name: "Test", lat: 46, lon: 4, runway: true, rwy: 90, elev: 0 }, 3000, 30, 0);
const GROUND = 120,
  WHEELS = 3.9;
const rest = () => GROUND + WHEELS;
const kE = 1 / (D * 6_378_137 * Math.cos(46 * D)),
  kN = 1 / (D * 6_378_137);

/** Its reports on a 3° final east every 15 s from 120 s before the threshold, `off` m north of the axis, its height
 *  `bias` m off; the last at `lastH` m over its wheels' rest. */
function final(off: number, lastH: number, bias = 0): Plane[] {
  const out: Plane[] = [];
  const gs = 70,
    vs = -gs * Math.tan(3 * D);
  for (let s = -120; ; s += 15) {
    const h = -vs * -s - 300 * Math.tan(3 * D);
    if (h < lastH) break;
    out.push({
      id: "abc123",
      cs: "TST1",
      reg: "F-TEST",
      type: "A320",
      cat: "A3",
      lat: 46 + off * kN,
      lon: 4 + gs * s * kE,
      alt: GROUND + WHEELS + h + bias,
      gs,
      trk: 90,
      hdg: 90,
      vs,
      roll: null,
      gnd: false,
      t: 1_800_000_000 + s,
      src: "adsb.lol",
    });
  }
  return out;
}

/** a point's distance past the threshold and off the axis [m] */
function onWay(lat: number, lon: number) {
  const q = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0);
  const v = [q[0]! - R.origin[0], q[1]! - R.origin[1], q[2]! - R.origin[2]];
  return {
    a: v[0]! * R.along[0] + v[1]! * R.along[1] + v[2]! * R.along[2],
    c: v[0]! * R.across[0] + v[1]! * R.across[1] + v[2]! * R.across[2],
  };
}

describe("its landing made up through the gap", () => {
  test("lost 80 m up, 150 m off the axis: down the axis onto the runway, braked to a stop on it", () => {
    const hist = final(150, 80);
    const A = hist.at(-1)!;
    const L = withLanding(hist, [R], rest);
    expect(L.key).toContain("Test>");
    const made = L.hist.slice(hist.length);
    const td = made.find((m) => m.gnd)!;
    const end = made.at(-1)!;
    const w0 = onWay(td.lat, td.lon),
      w1 = onWay(end.lat, end.lon);
    console.log(
      `  lost ${(A.alt - rest()).toFixed(0)} m up, ${onWay(A.lat, A.lon).c.toFixed(0)} m off: ${made.length} made up — touchdown ${w0.a.toFixed(0)} m past the threshold, ${w0.c.toFixed(1)} m off, ${(td.t - A.t).toFixed(1)} s on; stopped ${w1.a.toFixed(0)} m down, at ${end.gs.toFixed(1)} m/s`,
    );
    expect(Math.abs(w0.c)).toBeLessThan(1);
    expect(w0.a).toBeGreaterThan(LANDING.touch - 1);
    expect(w0.a).toBeLessThan(900);
    expect(w1.a).toBeLessThan(3000);
    expect(end.gs).toBeLessThan(0.01);
    // (its descent along its own slope: 3°, its height gone where the runway starts)
    for (const m of made) expect(m.alt).toBeLessThanOrEqual(A.alt + 0.01);
  });

  test("heard again 100 s on, taxiing off the runway 120 m north: down it, rolled out to its turn-off, then to where heard", () => {
    const hist = final(40, 60);
    const A = hist.at(-1)!;
    // (its first report on the ground: 2 200 m down the runway, 120 m north of it, at 9 m/s)
    const G: Plane = { ...A, lat: 46 + 120 * kN, lon: 4 + 2200 * kE, alt: 0, gs: 9, vs: 0, gnd: true, t: A.t + 100, trk: 0 };
    const L = withLanding([...hist, G], [R], rest);
    const made = L.hist.slice(hist.length, -1);
    expect(L.hist.at(-1)).toBe(G);
    let offMax = 0;
    for (const m of made.filter((x) => x.gnd)) offMax = Math.max(offMax, Math.abs(onWay(m.lat, m.lon).c));
    const out = made.at(-1)!;
    console.log(
      `  ${made.length} made up between its report on final and its first on the ground; on the runway within ${offMax.toFixed(1)} m of its axis; turned off ${onWay(out.lat, out.lon).a.toFixed(0)} m down at ${(out.t - A.t).toFixed(0)} s (heard at ${(G.t - A.t).toFixed(0)} s)`,
    );
    expect(offMax).toBeLessThan(1);
    expect(Math.abs(onWay(out.lat, out.lon).a - 2200)).toBeLessThan(5);
    expect(out.t).toBeLessThan(G.t);
    // (in time's order)
    for (let i = 1; i < L.hist.length; i++) expect(L.hist[i]!.t).toBeGreaterThan(L.hist[i - 1]!.t);
  });

  test("a go-around (climbing on after its low report), a report heard soon after, one not lined up: none made", () => {
    const hist = final(40, 60);
    const A = hist.at(-1)!;
    expect(withLanding([...hist, { ...A, alt: A.alt + 60, vs: 6, t: A.t + 15 }], [R], rest).key).toBe("");
    expect(withLanding([...hist, { ...A, gnd: true, t: A.t + 4, lon: A.lon + 280 * kE }], [R], rest).key).toBe("");
    expect(withLanding(final(900, 60), [R], rest).key).toBe("");
    expect(
      withLanding(
        final(40, 60).map((p) => ({ ...p, trk: 140 })),
        [R],
        rest,
      ).key,
    ).toBe("");
  });

  test("drawn a minute behind: lost 80 m up and 150 m off — on the runway's axis from touchdown, stopped on it, never under it", () => {
    setGroundHeights("earth", () => GROUND);
    setWorldRunways([R]);
    const { c } = cruise(3000, 200, 0.6);
    c.s.trafficDelay = 60;
    const hist = final(150, 80);
    const A = hist.at(-1)!;
    const planes = new Map([["abc123", { p: A, prev: hist.at(-2)!, hist, heard: 1e12 }]]);
    c.traffic = { planes, ships: new Map(), status: "live", credit: {}, attribution: [] } as unknown as TrafficFeed;
    let now = A.t + 60 - 30;
    c.trafficClock = () => now;
    let low = 1e9,
      offGnd = 0,
      offLow = 0,
      grass = 0,
      vTd = -1,
      sinkTd = 0,
      hPrev: number | null = null,
      pitchTd = Number.NaN,
      derotMax = 0,
      pitchPrev: number | null = null,
      pitchEnd = 0,
      rig: { gearFinal: number; flapsFinal: number; revRoll: number; splRoll: number; revSlow: number } = {
        gearFinal: 0,
        flapsFinal: 0,
        revRoll: 0,
        splRoll: 0,
        revSlow: 1,
      },
      jerk = 0,
      vPrev: number | null = null,
      end = { a: 0, v: 0 };
    for (; now < A.t + 60 + 90; now += 0.1) {
      const k = c.trafficNow()[0]!;
      const g = cartToGeodetic(WGS84_A, WGS84_F, k.p as [number, number, number]);
      const w = onWay(g.lat / D, g.lon / D);
      low = Math.min(low, g.h - GROUND);
      // (rolling: on its axis; the last 15 m down: over the runway's width)
      const v = Math.hypot(k.v[0]!, k.v[1]!, k.v[2]!);
      // (its sink in the last metre over the runway: flared, not flown into it)
      const hh = g.h - GROUND;
      if (hPrev !== null && !k.gnd && hh < WHEELS + 1) sinkTd = Math.max(sinkTd, (hPrev - hh) / 0.1);
      hPrev = hh;
      // (its speed: at touchdown its approach's still; never a step from frame to frame)
      if (k.gnd && vTd < 0) {
        vTd = v;
        pitchTd = k.pitch / D;
      }
      // (its nose lowered after the mains: never faster than 4°/s)
      if (pitchPrev !== null && k.gnd) derotMax = Math.max(derotMax, (pitchPrev - k.pitch / D) / 0.1);
      pitchPrev = k.pitch / D;
      pitchEnd = k.pitch / D;
      // (its rig: the gear and the flaps out on final; the reversers and the ground spoilers rolling fast, stowed slow)
      const R = trafficRig(k, now).props;
      const num = (x: unknown) => Number(x ?? 0);
      if (!k.gnd && k.over < 300) {
        rig.gearFinal = Math.max(rig.gearFinal, num(R["gear/gear[1]/position-norm"]));
        rig.flapsFinal = Math.max(rig.flapsFinal, num(R["sim/multiplay/generic/float[12]"]) * 40);
      }
      if (k.gnd && v > 45) {
        rig.revRoll = Math.max(rig.revRoll, num(R["engines/engine[0]/reverser-pos-norm"]));
        rig.splRoll = Math.max(rig.splRoll, num(R["systems/fcs/spoiler-l1/final-deg"]));
      }
      if (k.gnd && v < 15) rig.revSlow = num(R["engines/engine[0]/reverser-pos-norm"]);
      if (vPrev !== null) jerk = Math.max(jerk, Math.abs(v - vPrev) / 0.1);
      vPrev = v;
      if (k.gnd) {
        offGnd = Math.max(offGnd, Math.abs(w.c));
        if (w.a < 0 || w.a > 3000) grass++;
      }
      if (g.h - GROUND < WHEELS + 15) offLow = Math.max(offLow, Math.abs(w.c));
      end = { a: w.a, v: Math.hypot(k.v[0]!, k.v[1]!, k.v[2]!) };
    }
    console.log(
      `  drawn: its origin ${low.toFixed(2)} m over the ground at lowest; within ${offGnd.toFixed(1)} m of the axis rolling, ${offLow.toFixed(1)} m the last 15 m down, ${grass} frames off the runway's ends; ${vTd.toFixed(0)} m/s at touchdown sinking ${sinkTd.toFixed(2)} m/s, its nose ${pitchTd.toFixed(1)}° up then lowered at ${derotMax.toFixed(1)}°/s at most (${pitchEnd.toFixed(1)}° at the end); its rig ${JSON.stringify(rig)}; its speed's change ${jerk.toFixed(1)} m/s² at most; at the end ${end.a.toFixed(0)} m down, ${end.v.toFixed(2)} m/s`,
    );
    expect(low).toBeGreaterThan(WHEELS - 0.05);
    expect(offGnd).toBeLessThan(3);
    expect(offLow).toBeLessThan(R.halfWidth);
    expect(grass).toBe(0);
    expect(vTd).toBeGreaterThan(55);
    expect(sinkTd).toBeLessThan(1.5);
    expect(pitchTd).toBeGreaterThan(2);
    expect(derotMax).toBeLessThan(4);
    expect(Math.abs(pitchEnd)).toBeLessThan(0.3);
    expect(rig.gearFinal).toBeGreaterThan(0.99);
    expect(rig.flapsFinal).toBeGreaterThan(30);
    expect(rig.revRoll).toBeGreaterThan(0.9);
    expect(rig.splRoll).toBeGreaterThan(20);
    expect(rig.revSlow).toBeLessThan(0.05);
    expect(jerk).toBeLessThan(5);
    expect(end.v).toBeLessThan(0.1);
    expect(end.a).toBeLessThan(3000);
  });
});
