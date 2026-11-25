// PROBLEMES « Le trafic réel … ses ombres au sol étirées et floues » (25 Nov 2026): at SFO's gates, the aircraft, jet bridges and
// their shadows photographed in the NAIP orthophoto were drawn flat on the apron and stretched at grazing angles — an aerodrome's
// apron was a paved polygon like a pedestrian square, the photograph whole over it. Its own colour now (scenery-geometry.ts
// APRON_COLOUR), told by the material (trace.wgsl SC_APRON): its paving kept near, the photograph a quarter of it, as a surveyed
// carriageway's. A square's, a runway's, a taxiway's paving unchanged. The image is the e2e's (traffic-cost, the parked moments).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APRON_COLOUR, PAVED_COLOUR, pavedAreaColour } from "../src/system/scenery-geometry";

const wgsl = readFileSync(new URL("../src/shaders/trace.wgsl", import.meta.url), "utf8");

test("an aerodrome's apron has its own colour; a square's, a runway's and a taxiway's stay the paved one", () => {
  expect(pavedAreaColour("aeroway", "apron")).toEqual([...APRON_COLOUR]);
  for (const [layer, cls] of [
    ["transportation", "pedestrian"],
    ["transportation", "path"],
    ["aeroway", "runway"],
    ["aeroway", "taxiway"],
    ["aeroway", "helipad"],
  ])
    expect(pavedAreaColour(layer!, cls!)).toEqual([...PAVED_COLOUR]);
  // (told apart by the material within 1e-3 a channel: far apart)
  expect(Math.max(...APRON_COLOUR.map((c, i) => Math.abs(c - PAVED_COLOUR[i]!)))).toBeGreaterThan(0.05);
});

test("the material's apron colour is the worker's", () => {
  const m = wgsl.match(/const SC_APRON_COLOUR = vec3f\(([0-9.]+), ([0-9.]+), ([0-9.]+)\);/);
  expect(m).not.toBeNull();
  const c = m!.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) expect(Math.abs(c[i]! - APRON_COLOUR[i]!)).toBeLessThan(1e-6);
});

test("the apron told by its paved polygon's colour, its photograph a quarter near, whole again by 2.5 km and 2 m a pixel", () => {
  expect(wgsl).toContain("SC_APRON=!isLine && kind==5.0 && all(abs(color-SC_APRON_COLOUR)<vec3f(1e-3));");
  // (reset with the survey's flag, in the walk and before it)
  expect(wgsl).toContain("SC_SURVEY_ROAD=false;SC_APRON=false;");
  expect(wgsl).toContain("  SC_SURVEY_ROAD = false;\n  SC_APRON = false;\n");
  const at = wgsl.indexOf("var photoSurface = img.o * select(1.0, 0.25, SC_SURVEY_ROAD && tM < 2500.0 && fpM < 2.0);");
  expect(at).toBeGreaterThan(0);
  const apron = wgsl.indexOf(
    "if (SC_APRON) { photoSurface = img.o * mix(0.25, 1.0, max(smoothstep(1800.0, 2500.0, tM), smoothstep(1.4, 2.0, fpM))); }",
  );
  expect(apron).toBeGreaterThan(at);
  // (before the paving's mix reads it)
  expect(
    wgsl.indexOf("A = mix(A, sv.color, select(sv.cover, 0.0, sv.kind == 3.0 || sv.kind == 4.0) * (1.0 - photoSurface));"),
  ).toBeGreaterThan(apron);
});
