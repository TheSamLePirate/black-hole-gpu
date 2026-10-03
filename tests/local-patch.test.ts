import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { seenFrom } from "../src/system/local-patch";

// The local patch places a nearby body where the camera sees it (src/system/local-patch.ts).

const len = (v: Vec3) => Math.hypot(...v);

test("a body at rest with the camera is seen at its place (lengths along the motion × γ)", () => {
  const x: Vec3 = [3, 4, 0];
  expect(seenFrom(x, [0, 0, 0], [0, 0, 0])).toEqual(x);
  // co-moving at 0.6 c along x: its rest-frame offset is the ZAMO offset stretched by γ = 1.25 along x
  const s = seenFrom(x, [0.6, 0, 0], [0.6, 0, 0]);
  expect(s[0]).toBeCloseTo(3.75, 12);
  expect(s[1]).toBeCloseTo(4, 12);
});

test("a body sweeping past a camera at rest: seen where it was when the light left it", () => {
  // at x = (0, 10, 0) now, moving at 0.5 c along x: the light that arrives now left it τ earlier,
  // with (0.5 τ)² + 10² = τ² → τ = 10/√0.75
  const s = seenFrom([0, 10, 0], [0.5, 0, 0], [0, 0, 0]);
  const tau = 10 / Math.sqrt(0.75);
  expect(s[0]).toBeCloseTo(-0.5 * tau, 10);
  expect(s[1]).toBeCloseTo(10, 10);
  expect(len(s)).toBeCloseTo(tau, 10);
});

test("the same event seen from a moving camera: aberration (the light's direction boosted)", () => {
  // body at rest in the ZAMO frame at (0, 10, 0); camera moving at β = 0.5 x̂: the light arriving now
  // comes, in the camera frame, from a direction tilted forwards — cos θ' = (cos θ + β)/(1 + β cos θ)
  // with θ = 90° in the ZAMO frame (the light that reaches the camera left the body earlier, so in
  // the ZAMO frame it comes from where the camera was — the textbook figure uses the arrival event)
  const b = 0.5;
  const s = seenFrom([0, 10, 0], [0, 0, 0], [b, 0, 0]);
  // body at rest in ZAMO → moves at −β in the camera frame; its light arrives from angle θ' with
  // tan θ' = y/x of the retarded place
  const cos = s[0] / len(s);
  // the retarded place of a body moving at −β seen at the camera's time 0 — solved directly:
  // γ-stretched offset x' = (0, 10, 0), t' = 0; x_r = x' + β τ x̂ with (β τ)² + 100 = τ²
  const tau = 10 / Math.sqrt(1 - b * b);
  expect(s[0]).toBeCloseTo(b * tau, 10);
  expect(cos).toBeCloseTo(b, 10); // cos θ' = β: the classic aberration of a source at 90°
});

import { buildBlackbodyLUT, blackbodyLogY } from "../src/physics";
import { PROBE_H, PROBE_W, probeCamera, reduceProbe } from "../src/system/planet-probe";

test("planet probe: a sky of uniform blackbody radiance gives E = π L and T_eq = T (albedo 0)", () => {
  // a sky entirely at the radiance of a 5 000 K blackbody (tracer units relative to log Y_ref)
  const T = 5000;
  const logYref = blackbodyLogY(4600);
  const lut = buildBlackbodyLUT();
  const i = Math.round(((Math.log10(T) - 2) / 7) * 1023);
  const rgb = [lut[4 * i]!, lut[4 * i + 1]!, lut[4 * i + 2]!].map((c) => c * 10 ** (blackbodyLogY(T) - logYref));
  const data = new Float32Array(PROBE_W * PROBE_H * 4);
  for (let k = 0; k < PROBE_W * PROBE_H; k++) data.set([rgb[0]!, rgb[1]!, rgb[2]!, 1], 4 * k);
  const cam = probeCamera([10, 0, 0], [0, 0.3, 0], 0.998);
  const p = reduceProbe(data, cam, logYref, 0);
  const sigma = 5.670374419e-8;
  // mean bolometric radiance σT⁴/π (colour temperature found within the LUT's step), a blackbody's
  // own temperature back for a black planet bathed in it
  expect(p.meanBol / ((sigma * T ** 4) / Math.PI)).toBeCloseTo(1, 1);
  expect(p.teq / T).toBeCloseTo(1, 1);
  expect(Math.abs(p.tColour - T) / T).toBeLessThan(0.05);
  // a uniform sky: irradiance on any side = π L (the hemisphere's cosine-weighted solid angle)
  const lum = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  expect(p.eMax / (Math.PI * lum)).toBeCloseTo(1, 2);
});

import { holeBending, LOCAL_BEND } from "../src/system/local-patch";

test("the hole's bending of a straight way: a planet's patch kept, a star behind the hole left to the traced rays", () => {
  // the companion star (R = 2.5 M) 70 M out, the camera 30 M out on the other side: the straight way
  // passes 5.4 M from the hole — no local patch (the rays fall in: the shadow stays dark)
  expect(holeBending([-29.66, 2.8, 0], [69.03, 11.6, 0])).toBeGreaterThan(0.5);
  // Miller (R ≈ 5.6e-5 M, 10 M out) seen from 300 radii, across or along the radial direction
  const R = 5.61e-5;
  for (const X of [
    [10 + 300 * R, 0, 0],
    [10, 300 * R, 0],
    [10 - 300 * R, 0, 0],
  ] as [number, number, number][])
    expect(holeBending(X, [10, 0, 0])).toBeLessThan(LOCAL_BEND);
  // radial: no transverse pull (no cancellation to NaN or Infinity)
  expect(holeBending([20, 0, 0], [10, 0, 0])).toBe(0);
  // the weak-field limit through the whole line: 4M/b
  expect(holeBending([-1e7, 50, 0], [1e7, 50, 0])).toBeCloseTo(4 / 50, 6);
});
