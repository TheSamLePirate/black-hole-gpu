import { describe, expect, test } from "bun:test";
import {
  buildSynchrotronLUT,
  captureTolerance,
  criticalImpact,
  powerLawRGB,
  traceBackward,
  traceBackwardAdaptive,
  type State,
} from "../src/physics";
import { encodeEXR, toHalf } from "../src/exporters";
import { halfToFloat, interleaveOrder } from "../src/renderer";

function equatorialRay(b: number, a: number, r0 = 2000): State {
  const del = r0 * r0 - 2 * r0 + a * a;
  const W = r0 * r0 + a * a - a * b;
  return { x: [r0, Math.PI / 2, 0, 0], p: [Math.sqrt(Math.max(0, (W * W) / del - (b - a) ** 2) / del), 0] };
}

describe("error-controlled RK4 (quality integrator)", () => {
  for (const a of [0, 0.9, 0.998]) {
    const { pro, retro } = criticalImpact(a);
    test(`a=${a}: resolves the critical curve to ±0.001 M`, () => {
      const opts = { tol: 1e-9, epsMax: 0.5, maxSteps: 200000, rEscape: 3000, captureTol: captureTolerance(a) };
      const d = 0.001;
      const fate = (b: number) => traceBackwardAdaptive(equatorialRay(b, a), b, a, opts).fate;
      expect(fate(pro - d)).toBe("horizon");
      expect(fate(pro + d)).toBe("escape");
      expect(fate(-retro + d)).toBe("horizon");
      expect(fate(-retro - d)).toBe("escape");
    });
  }

  test("keeps the null constraint far better than fixed-step RK4 at equal cost", () => {
    const a = 0.9;
    const b = criticalImpact(a).pro + 0.05; // strongly bent, near-critical ray
    const st = equatorialRay(b, a, 60);
    const adaptive = traceBackwardAdaptive(st, b, a, { tol: 1e-8, epsMax: 0.5, maxSteps: 100000, rEscape: 200, captureTol: captureTolerance(a) });
    // fixed-step run with the same number of RK4 stages
    const eps = 0.05;
    const fixed = traceBackward(st, b, a, { eps, maxSteps: 100000, rEscape: 200, captureTol: captureTolerance(a) });
    expect(adaptive.fate).toBe("escape");
    expect(adaptive.maxDH).toBeLessThan(1e-8);
    expect(adaptive.maxDH).toBeLessThan(fixed.maxDH);
  });
});

describe("spectral colorimetry", () => {
  test("power laws redden with the spectral index", () => {
    const [r0, , b0] = powerLawRGB(-1); // blue spectrum
    const [r1, , b1] = powerLawRGB(2); // red spectrum
    expect(b0 / r0).toBeGreaterThan(1);
    expect(r1 / b1).toBeGreaterThan(1);
  });
  test("synchrotron LUT: brighter and bluer as the cutoff moves up", () => {
    const lut = buildSynchrotronLUT();
    const n = lut.length / 4;
    const at = (i: number) => [lut[i * 4]!, lut[i * 4 + 1]!, lut[i * 4 + 2]!];
    const lo = at(Math.floor(n * 0.35));
    const hi = at(n - 1);
    expect(hi[1]!).toBeGreaterThan(lo[1]!);
    expect(hi[2]! / hi[0]!).toBeGreaterThan(lo[2]! / lo[0]!);
  });
});

describe("export encoders", () => {
  test("float → half round trip", () => {
    for (const v of [0, 1, -2, 0.5, 65504, 1e-5, 3.14159, 1234.5]) {
      const back = halfToFloat(toHalf(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(Math.abs(v) * 1e-3, 6e-8));
    }
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(1e9)).toBe(0x7c00);
  });
  test("EXR layout: magic, header and scanline offsets", async () => {
    const w = 3, h = 2;
    const rgba = new Float32Array(w * h * 4).map((_, i) => i * 0.25);
    const buf = new Uint8Array(await encodeEXR(rgba, w, h).arrayBuffer());
    expect([...buf.slice(0, 4)]).toEqual([0x76, 0x2f, 0x31, 0x01]);
    const text = new TextDecoder("latin1").decode(buf);
    for (const attr of ["channels", "compression", "dataWindow", "displayWindow", "lineOrder"]) expect(text).toContain(attr);
    const dv = new DataView(buf.buffer);
    const tableAt = text.indexOf("screenWindowWidth") + "screenWindowWidth\0float\0".length + 4 + 4 + 1;
    const first = Number(dv.getBigUint64(tableAt, true));
    expect(dv.getInt32(first, true)).toBe(0); // y of the first scanline
    expect(dv.getInt32(first + 4, true)).toBe(w * 3 * 2);
  });
});

describe("realtime interleaving", () => {
  test("visits every offset of the tile exactly once", () => {
    for (const b of [2, 3, 4, 6, 8]) {
      const o = interleaveOrder(b);
      expect(o.length).toBe(b * b);
      expect(new Set(o.map(([x, y]) => `${x},${y}`)).size).toBe(b * b);
    }
  });
});
