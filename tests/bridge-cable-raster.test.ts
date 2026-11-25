// PLAN-PONT-ROUTES-AAA (25 Nov 2026; PROBLEMES « Ponts et routes, campagne e2e 2 »: the Golden Gate's main cable a flat wide ribbon
// from the deck). A static check on the raster's real WGSL (scenery-raster.ts sceneryRasterShader — not a copy of it): a notable
// bridge's cable is opened across its own line and the view (a billboard about the cable, whatever the eye — the old way opened a main
// cable along the frame's up: seen from under it, edge-on or flat), and its distance in the visibility is a cylinder's front across it
// (the normal rebuilt from it round) where it spans its whole coverage. Each check fails on the code before (24 Nov 2026). The image
// itself is the e2e's (bridges-notable: golden-gate-deck-low).
import { expect, test } from "bun:test";
import { sceneryRasterShader } from "../src/system/scenery-raster";

const wgsl = sceneryRasterShader("");
const cableBranch = (() => {
  const a = wgsl.indexOf("if (fam == 0xfff20000u) {");
  return wgsl.slice(a, wgsl.indexOf("\n  }\n", a));
})();
const shade = wgsl.slice(wgsl.indexOf("fn meshShade(v: MV) -> vec4f {"), wgsl.indexOf("// The buildings without triangles"));

test("a cable opened across its line and the view (its line from its triangle's two distinct points), not along the frame's up", () => {
  expect(cableBranch.length).toBeGreaterThan(200);
  expect(cableBranch).toContain("let ac = cross(line, toEye);");
  expect(cableBranch).toContain("v = view(wp + normalize(ac) * (side * half));");
  // (its side −1 … 1 and its diameter handed to the fragment)
  expect(cableBranch).toContain("o.pyl = vec4f(w / (2.0 * half), sc.misc.x, side, w);");
});

test("its distance a cylinder's front where it covers its pixels whole; its coverage alone under that", () => {
  expect(shade).toContain("if (v.bridge > 4.5 && v.pyl.x > 0.999) {");
  expect(shade).toContain("dist = d - 0.5 * v.pyl.w * sqrt(max(1.0 - a * a, 0.0));");
  expect(shade).toContain("return vec4f(dist, v.leaf, dist, code");
  // (the coverage's discard, the conductors' — no shimmer at a distance — kept for it)
  expect(shade).toContain("if (h > v.pyl.x) { discard; }");
});

test("the profile it writes is a cylinder's: the normal rebuilt from two neighbours' distances turns from the eye to the side", () => {
  // (the bulge's numbers: a 0.92 m cable at 20 m, 30 pixels across — the slope of the distance across it, the rebuilt normal's tilt)
  const r = 0.46,
    d = 20,
    n = 30;
  const dist = (a: number) => d - r * Math.sqrt(Math.max(1 - a * a, 0));
  const tilt = (a: number) => {
    const da = 2 / n;
    const slope = (dist(Math.min(1, a + da)) - dist(a)) / ((2 * r) / n);
    return (Math.atan(Math.abs(slope)) * 180) / Math.PI;
  };
  expect(tilt(0)).toBeLessThan(5);
  expect(tilt(0.7)).toBeGreaterThan(40);
  expect(tilt(0.95)).toBeGreaterThan(70);
});
