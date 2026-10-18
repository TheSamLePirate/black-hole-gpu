import { describe, expect, test } from "bun:test";
import { cartToGeodetic, geodeticNormal, geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { crashView, FALL_CAP, fallStep, startFall, WRECK_VT } from "../src/game/wreckfall";

// A player shot down in a room (ui/netmatch.ts): his craft out of control to the ground as the fight's wrecks fall —
// on the WGS84 ellipsoid (the Earth's coordinates [m]), a flat ground 700 m over it here (Rogers Dry Lake's).

type V = [number, number, number];
const D = Math.PI / 180;
const normal = (p: V) => geodeticNormal(WGS84_A, WGS84_F, p);
const GROUND = 700;
const height = (p: V) => cartToGeodetic(WGS84_A, WGS84_F, p).h - GROUND;
/** a craft over Edwards, `h` over the ellipsoid, flying east at `speed` [m/s], wings level */
const craft = (h: number, speed: number) => {
  const lat = 34.9 * D,
    lon = -117.8 * D;
  const p = geodeticToCart(WGS84_A, WGS84_F, lat, lon, h) as V;
  const U = normal(p);
  const E: V = [-Math.sin(lon), Math.cos(lon), 0];
  return { p, v: E.map((x) => x * speed) as V, fwd: E, up: U };
};
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("a wreck's fall", () => {
  test("from 5 000 m over the ground at 250 m/s: to the ground in 20–45 s, its nose dropping to where it goes, rolling", () => {
    const F = startFall(craft(GROUND + 5000, 250), () => 0.3);
    expect(Math.abs(F.spin)).toBeGreaterThan(1);
    let ended = false;
    let maxDown = 0;
    let rollSeen = 0;
    const up0 = F.up;
    for (let i = 0; i < 60 * 60 && !ended; i++) {
      ended = fallStep(F, 1 / 60, normal, height);
      const U = normal(F.p);
      maxDown = Math.max(maxDown, -dot(F.v, U));
      rollSeen = Math.max(rollSeen, 1 - dot(F.up, up0));
    }
    expect(ended).toBe(true);
    expect(F.broke).toBe(false);
    console.log(`  down in ${F.t.toFixed(1)} s, at most ${maxDown.toFixed(0)} m/s down`);
    expect(F.t).toBeGreaterThan(20);
    expect(F.t).toBeLessThan(45);
    // (under the terminal speed's 240 m/s: not a free fall's)
    expect(maxDown).toBeLessThan(WRECK_VT);
    expect(maxDown).toBeGreaterThan(150);
    // (on the ground — the ellipsoid's height and its relief —, within a centimetre)
    expect(Math.abs(height(F.end!))).toBeLessThan(0.01);
    // (its nose down along its way at the end, its roll seen)
    expect(dot(F.fwd, normal(F.p))).toBeLessThan(-0.5);
    expect(rollSeen).toBeGreaterThan(1);
  });

  test("a frame's hitch does not carry it through the ground (stepped in pieces)", () => {
    const F = startFall(craft(GROUND + 300, 200), () => 0.7);
    let ended = false;
    for (let i = 0; i < 40 && !ended; i++) ended = fallStep(F, 0.5, normal, height);
    expect(ended).toBe(true);
    expect(Math.abs(height(F.end!))).toBeLessThan(0.01);
  });

  test("a high fall: broken up in the air at the cap", () => {
    const F = startFall(craft(GROUND + 15_000, 250));
    let ended = false;
    for (let i = 0; i < 60 * 60 && !ended; i++) ended = fallStep(F, 1 / 30, normal, height);
    expect(ended).toBe(true);
    expect(F.broke).toBe(true);
    expect(F.t).toBeCloseTo(FALL_CAP, 1);
    expect(height(F.end!)).toBeGreaterThan(1000);
  });

  test("the crash watched from back along its way, above, the nose on it", () => {
    const F = startFall(craft(GROUND + 2000, 250), () => 0.2);
    while (!fallStep(F, 1 / 30, normal, height));
    const v = crashView(F, normal, height);
    const d: V = [F.end![0] - v.p[0], F.end![1] - v.p[1], F.end![2] - v.p[2]];
    const r = Math.hypot(...d);
    expect(r).toBeGreaterThan(600);
    expect(r).toBeLessThan(900);
    // (the nose on it, the eye some 260 m over it, its top up)
    expect(dot(v.fwd, d.map((x) => x / r) as V)).toBeCloseTo(1, 6);
    expect(height(v.p)).toBeGreaterThan(200);
    expect(dot(v.up, normal(v.p))).toBeGreaterThan(0.9);
  });
});
