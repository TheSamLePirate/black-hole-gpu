import { describe, expect, test } from "bun:test";
import { CamShake } from "../src/camshake";
import { bendAt, DROOP, PER_G, tipFor, WingFlex } from "../src/a320/flex";
import { mountKeys, mountPose, setMountVessel } from "../src/mounts";

// The A320's structure and cameras (docs/PLAN-A320.md, A13 — src/a320/flex.ts, camshake.ts, mounts.ts): the wings'
// tip drooping at rest, as built in level flight, up 60 cm a g more; the bend's square along the span, none on the
// fuselage; the spring following the load and ringing after a jolt; the runway's slabs thumped at the speed's pace;
// the A320's own views (the window, the gear, the fin) its own only.

describe("A320 wing flex", () => {
  test("the tip by the load, the bend along the span", () => {
    expect(tipFor(0)).toBeCloseTo(-DROOP, 6);
    expect(tipFor(1)).toBeCloseTo(0, 6);
    expect(tipFor(2.5)).toBeCloseTo(1.5 * PER_G, 6);
    expect(tipFor(0.5)).toBeCloseTo(-DROOP / 2, 6);
    expect(bendAt(1.5, 1)).toBe(0);
    expect(bendAt(-1.9, 1)).toBe(0);
    expect(bendAt(17, 0.9)).toBeCloseTo(0.9, 6);
    expect(bendAt(-9.5, 1)).toBeCloseTo(0.25, 6);
  });

  test("the spring: settled on the load, a jolt rings a few times then dies", () => {
    const W = new WingFlex(() => 0.5);
    W.step(1 / 60, 1);
    for (let k = 0; k < 600; k++) W.step(1 / 60, 2.5);
    expect(W.tip).toBeCloseTo(0.9, 2);
    // (a touchdown: the lift gone at once — the tip swings down past its droop, then back, several times)
    let min = Infinity,
      crossings = 0,
      last = W.tip - tipFor(0);
    for (let k = 0; k < 300; k++) {
      W.step(1 / 60, 0);
      min = Math.min(min, W.tip);
      const d = W.tip - tipFor(0);
      if (Math.sign(d) !== Math.sign(last)) crossings++;
      last = d;
    }
    console.log(`  after 2.5 g, landed: the tip down to ${min.toFixed(2)} m, ${crossings} crossings in 5 s`);
    expect(min).toBeLessThan(tipFor(0) - 0.3);
    expect(crossings).toBeGreaterThanOrEqual(4);
    for (let k = 0; k < 900; k++) W.step(1 / 60, 0);
    expect(W.tip).toBeCloseTo(-DROOP, 2);
    // (any frame rate: the same)
    const A = new WingFlex(() => 0.5),
      B = new WingFlex(() => 0.5);
    A.step(0.01, 1);
    B.step(0.01, 1);
    for (let k = 0; k < 120; k++) A.step(1 / 120, 2);
    for (let k = 0; k < 4; k++) B.step(1 / 4, 2);
    expect(Math.abs(A.tip - B.tip)).toBeLessThan(0.02);
  });
});

describe("A320 shakes", () => {
  test("the runway's slabs: a thump each 5 m, their pace the speed's", () => {
    const thumps = (v: number) => {
      const S = new CamShake();
      let n = 0,
        prev = 0;
      for (let k = 0; k < 120; k++) {
        const p = S.step({ dt: 1 / 60, roll: v, buffet: 0, transonic: 0, ab: 0, engine: 0, jolt: 0, joints: 5, soft: 0 }).pitch;
        if (p < -0.0008 && prev >= -0.0008) n++;
        prev = p;
      }
      return n;
    };
    // (2 s at 10 m/s: 4 slabs; at 40 m/s: 16)
    expect(thumps(10)).toBeGreaterThanOrEqual(3);
    expect(thumps(10)).toBeLessThanOrEqual(5);
    expect(thumps(40)).toBeGreaterThan(thumps(10) * 2.5);
  });
});

describe("A320 cameras", () => {
  test("its own views, its own only", () => {
    setMountVessel("a320");
    const own = mountKeys();
    for (const m of ["passenger", "gear", "tail", "wing", "cockpit"] as const) expect(own).toContain(m);
    // (the window: at FlightGear's Left Mid View, looking out over the left wing)
    const p = mountPose("passenger");
    expect(p.eye[0]).toBeGreaterThan(2);
    expect(p.aim[0]).toBeGreaterThan(p.eye[0] + 10);
    setMountVessel("ranger");
    expect(mountKeys()).not.toContain("passenger");
    // (kept from the A320: the chase instead)
    expect(mountPose("passenger")).toEqual(mountPose("chase"));
  });
});
