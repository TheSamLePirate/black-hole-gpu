import { expect, test } from "bun:test";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };

// (25 Nov 2026, PROBLEMES « Ponts et routes, campagne e2e 2 »: thin light lines curving across the shaded streets of Paris.) The raster
// material's sun (trace.wgsl liteSun) gated the relief's cascades, the contact shadows, the scenery's shadow map and the craft's shadow
// on the normal it was given — for the ground the depth image's (rasterNormal: its neighbours' distances). Across a survey's relief
// steps (its metre cells' edges, in contour lines) that normal turns from the Sun: the shadows were skipped there while the smooth
// normal lit the ground — a lit line through every shadow, along the steps. The ground's shadows are now gated on the vertical, a
// mesh's (a building's, a runway's) on its own normal.

const sun = trace.slice(trace.indexOf("fn liteSun("), trace.indexOf("// (TUNE_LITE 8192"));

test("liteSun: the ground's shadows gated on the vertical, a mesh's on its own normal", () => {
  expect(sun).toContain("let nS = select(gq, n, mesh);");
  expect(sun).toContain("dot(nS, Lp) > -0.05");
  expect(sun).toContain("P.scenery[2].w > 0.5 && dot(nS, Lp) > 0.0");
  expect(sun).toContain("dot(nS, Lp) > 0.0) { Eg *= shipShadow(");
  expect(sun).toContain("let lift = select(nS * 0.35, n * 1.2 + Lp * 1.5, mesh);");
  // (no gate left on the depth image's normal)
  expect(sun).not.toMatch(/dot\(n, Lp\) > /);
});

test("the gate's model: a relief step's face turned from the Sun — the old gate skipped its shadows, the new one keeps them", () => {
  // (a Sun 50° high to the south-west; a step's face — 1 m high over a 0.3 m cell edge — facing north-east)
  const D = Math.PI / 180;
  const L = [Math.cos(50 * D) * -Math.SQRT1_2, Math.cos(50 * D) * -Math.SQRT1_2, Math.sin(50 * D)];
  const up = [0, 0, 1];
  const len = Math.hypot(1, 1, 0.3);
  const step = [1 / len, 1 / len, 0.3 / len];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const oldGate = dot(step, L) > 0;
  const newGate = dot(up, L) > 0;
  expect(oldGate).toBe(false);
  expect(newGate).toBe(true);
});

test("liteMaterial: a step's face in the mesh reads the photograph through a metre at least — no columns smeared down it", () => {
  const mat = trace.slice(trace.indexOf("fn liteMaterial("), trace.indexOf("fn liteLight("));
  expect(mat).toContain("let stepFace = !isTree && upF > 0.62 && dot(ngF, gq) < 0.5;");
  expect(mat).toContain("max(length(fx), 1.0 / EARTH_RM), stepFace)");
  expect(mat).toContain("select(normalize(fx + vec3f(1e-12)) * fs, fxI, i == 0)");
  // (one depth-image normal read, shared with the light's)
  expect(mat).toContain("var ng = ngF;");
});
