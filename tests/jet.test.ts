import { describe, expect, test } from "bun:test";
import { Autothrottle, JET, altHoldGamma, hdgHoldBank, jetAnnunciators, jetCommands, noJetModes, wrapPi } from "../src/game/jet";

const D = Math.PI / 180;

describe("the altitude hold", () => {
  test("on its altitude: level", () => {
    expect(altHoldGamma(3000, 3000, 250)).toBeCloseTo(0, 9);
  });
  test("below: climbs, above: descends, at most the climb angle", () => {
    expect(altHoldGamma(2900, 3000, 250)).toBeGreaterThan(0);
    expect(altHoldGamma(3100, 3000, 250)).toBeLessThan(0);
    expect(altHoldGamma(0, 10000, 250)).toBeLessThanOrEqual(JET.gammaMax + 1e-12);
    expect(altHoldGamma(10000, 0, 80)).toBeGreaterThanOrEqual(-JET.gammaMax - 1e-12);
  });
  test("closed loop: a point mass on the commanded path settles on the altitude without overshoot", () => {
    let h = 1000;
    const V = 200;
    let peak = h;
    for (let k = 0; k < 6000; k++) {
      h += V * Math.sin(altHoldGamma(h, 2000, V)) * 0.02;
      peak = Math.max(peak, h);
    }
    expect(h).toBeCloseTo(2000, 0);
    expect(peak).toBeLessThan(2000.5);
  });
});

describe("the heading hold", () => {
  test("banks towards the heading, the short way round, at most 30°", () => {
    expect(hdgHoldBank(90 * D, 100 * D)).toBeGreaterThan(0);
    expect(hdgHoldBank(100 * D, 90 * D)).toBeLessThan(0);
    // (350° → 10°: right, through north)
    expect(hdgHoldBank(350 * D, 10 * D)).toBeGreaterThan(0);
    expect(Math.abs(hdgHoldBank(0, 179 * D))).toBeCloseTo(JET.bankMax, 9);
  });
  test("wrapPi", () => {
    expect(wrapPi((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapPi((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe("the autothrottle", () => {
  // (a jet: drag ∝ V², thrust aFull at full throttle — its speed settles where they balance)
  const fly = (V0: number, VT: number, aFull: number, secs: number) => {
    const at = new Autothrottle();
    let V = V0,
      thr = 0.5,
      lo = V0,
      hi = V0;
    const dt = 1 / 60;
    for (let k = 0; k < secs / dt; k++) {
      thr = at.step(thr, V, VT, aFull, dt);
      V += (thr * aFull - 9.81 * 0.06 * (V / 200) ** 2) * dt;
      lo = Math.min(lo, V);
      hi = Math.max(hi, V);
    }
    return { V, thr, lo, hi };
  };
  test("accelerates to its speed and holds it", () => {
    const r = fly(180, 240, 12, 90);
    expect(r.V).toBeCloseTo(240, 0);
    expect(r.hi).toBeLessThan(243);
  });
  test("slows to its speed", () => {
    const r = fly(260, 200, 12, 90);
    expect(r.V).toBeCloseTo(200, 0);
    expect(r.lo).toBeGreaterThan(197);
  });
  test("a powerful engine (a rocket's 30 m/s²): still steady", () => {
    const r = fly(150, 220, 30, 90);
    expect(r.V).toBeCloseTo(220, 0);
    expect(r.thr).toBeGreaterThan(0);
    expect(r.thr).toBeLessThan(1);
  });
});

describe("the commands and the annunciators", () => {
  test("off: nothing asked", () => {
    expect(jetCommands(noJetModes(), { h: 1000, hdg: 0, V: 200 })).toEqual({ gamma: null, bank: null });
  });
  test("engaged: the flight path and the bank asked", () => {
    const c = jetCommands({ alt: 1500, hdg: 90 * D, spd: null, ab: false }, { h: 1000, hdg: 80 * D, V: 200 });
    expect(c.gamma!).toBeGreaterThan(0);
    expect(c.bank!).toBeGreaterThan(0);
  });
  test("the HUD's line", () => {
    const u = { alt: (m: number) => `${Math.round(m)}`, spd: (v: number) => `${Math.round(v)}` };
    expect(jetAnnunciators({ alt: 1500, hdg: 270 * D, spd: 240, ab: true }, u)).toEqual(["ALT 1500", "HDG 270", "A/T 240", "AB"]);
    expect(jetAnnunciators({ alt: null, hdg: 0, spd: null, ab: false }, u)).toEqual(["HDG 000"]);
  });
});
