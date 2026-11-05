import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tOf } from "../src/eclipse/core";
import { moonLightShare } from "../src/eclipse/shadows-gpu";
import { addEphemeris } from "../src/system/de440";
import { setRefractionTable } from "../src/system/refraction";
import { gpuTableData } from "../src/system/refraction-gpu";
import { BENNETT_AIR } from "../src/system/refraction-layered";
import { solarBody, solarState } from "../src/system/solar";

// PLAN-REFRACTION-HORIZONS R2/Q6 — the Danjon control: the totally eclipsed Moon's magnitude the game's light share gives
// (moonLightShare, the layered air's table in), against one measured: the 15–16 May 2022 total eclipse, −0.8 ± 0.3 at
// mid-totality (Sky & Telescope's observers — no published Danjon L for 7 September 2025). A control, not a tuning: the model
// is 1.4 magnitudes brighter (×3.6) — its limb's air clear to the ground (no cloud on the terminator, which cuts the low
// tangent rays), the stratosphere without 2022's volcanic aerosols (Hunga Tonga). This pins the model's figure, so that a
// change to the ring's light shows here, and records the gap.

beforeAll(() => {
  for (const f of ["de440.bin", "jup365.bin"]) {
    const b = readFileSync(`assets/ephemeris/${f}`);
    addEphemeris(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
});

test("the 16 May 2022 eclipse's Moon at mid-totality: the model's magnitude, against the measured −0.8 ± 0.3", () => {
  const t = tOf(Date.parse("2022-05-16T04:11:28Z"));
  const E = solarState("earth", t).pos,
    M = solarState("moon", t).pos,
    S = solarState("sun", t).pos;
  const RE = solarBody("earth")!.radius;
  setRefractionTable(gpuTableData(BENNETT_AIR));
  let share: number;
  try {
    share = moonLightShare(E, M, S, RE * 0.99834 * (1 + 1 / 85), solarBody("moon")!.radius, solarBody("sun")!.radius);
  } finally {
    setRefractionTable(null);
  }
  const km = Math.hypot(M[0] - E[0], M[1] - E[1], M[2] - E[2]) / (RE / 6371);
  // (the full Moon's −12.73 at its mean distance, by its distance that night)
  const m = -12.73 + 5 * Math.log10(km / 384400) - 2.5 * Math.log10(share);
  // (the model's −2.19 when written; the measure −0.8 ± 0.3: the gap recorded, 1.1–1.7 mag)
  expect(m).toBeGreaterThan(-2.5);
  expect(m).toBeLessThan(-1.9);
  expect(-0.8 - m).toBeGreaterThan(1.0);
});
