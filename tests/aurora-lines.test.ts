import { expect, test } from "bun:test";
import { AURORA_LINES, arcKR, cdPerKR, lineColumn, lineProfile, lineRGB, lineTint, luma } from "../src/system/aurora-lines";

// The auroras' lines (src/system/aurora-lines.ts — PLAN-AURORES-MAGNETOSPHERES AM2, § 7.3): their luminance per kR from the
// photon's energy and V(λ), their colour from CIE 1931, the shader's constants the module's.

test("cd/m² per kR: 557.7 nm 1.9·10⁻⁴, 630 nm 4.5·10⁻⁵ (Alex's, within 3 %); 427.8 nm 2.4·10⁻⁶ (V = 0.0097)", () => {
  expect(Math.abs(cdPerKR(557.7) / 1.9e-4 - 1)).toBeLessThan(0.03);
  expect(Math.abs(cdPerKR(630) / 4.5e-5 - 1)).toBeLessThan(0.03);
  expect(Math.abs(cdPerKR(427.8) / 2.45e-6 - 1)).toBeLessThan(0.03);
});

test("the tints: luminance 1, none negative; the green line green over red, no blue; the red line red; N₂⁺ violet", () => {
  for (const L of Object.values(AURORA_LINES)) {
    const t = lineTint(L.nm);
    expect(Math.abs(luma(t) - 1)).toBeLessThan(1e-9);
    for (const c of t) expect(c).toBeGreaterThanOrEqual(0);
  }
  const g = lineTint(557.7);
  expect(g[1]).toBeGreaterThan(2.5 * g[0]);
  expect(g[2]).toBeLessThan(0.01);
  const r = lineTint(630);
  expect(r[0]).toBeGreaterThan(10 * r[2]);
  const b = lineTint(427.8);
  expect(b[2]).toBeGreaterThan(3 * b[0]);
});

test("the profiles: 1 at the peak, none under the floor, a column of 0.886σ + H km", () => {
  const G = AURORA_LINES.green;
  expect(lineProfile(G, 110)).toBe(1);
  expect(lineProfile(G, 79)).toBe(0);
  let sum = 0;
  for (let h = 80; h < 600; h += 0.01) sum += lineProfile(G, h) * 0.01;
  expect(Math.abs(sum / lineColumn(G) - 1)).toBeLessThan(0.02);
});

test("the arcs' brightness: a few kR quiet, IBC II (10 kR) at Kp 3, IBC III (~100 kR) at Kp 7", () => {
  expect(arcKR(0)).toBeCloseTo(2, 6);
  expect(arcKR(3)).toBeGreaterThan(8);
  expect(arcKR(3)).toBeLessThan(13);
  expect(arcKR(7)).toBeGreaterThan(70);
  expect(arcKR(7)).toBeLessThan(130);
});

test("trace.wgsl's AUR_GREEN, AUR_RED, AUR_BLUE, AUR_PINK are lineRGB's within 0.5 %; its profiles the table's", async () => {
  const src = await Bun.file("src/shaders/trace.wgsl").text();
  for (const [name, key] of [
    ["AUR_GREEN", "green"],
    ["AUR_RED", "red"],
    ["AUR_BLUE", "blue"],
    ["AUR_PINK", "pink"],
  ] as const) {
    const m = src.match(new RegExp(`const ${name} = vec3f\\(([-\\d.e]+), ([-\\d.e]+), ([-\\d.e]+)\\)`));
    expect(m).not.toBeNull();
    const want = lineRGB(AURORA_LINES[key].nm);
    for (let i = 0; i < 3; i++) expect(Math.abs(Number(m![i + 1]) - want[i]!)).toBeLessThanOrEqual(0.005 * Math.max(...want));
    const L = AURORA_LINES[key];
    expect(src).toContain(`aurProf(hk, ${L.peak.toFixed(1)}, ${L.sigma.toFixed(1)}, ${L.H.toFixed(1)}, ${L.floor.toFixed(1)})`);
  }
});
