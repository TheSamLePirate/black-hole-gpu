import { expect, test } from "bun:test";
import { composeTracer, FULL_TRACER_LIMITS } from "../src/system/tracer-source";
import { parseFunctions, stripComments } from "../src/system/wgsl-specialise";

// PLAN-J3 J3-7 — the refraction in its reach: which of the tracer's readers take the Sun lifted by the air's refraction (the incident
// one, R3 — `incidentSun`, the Earth raster's row TABLE_SUN + 5) and which the geometric one, as the contract C-J3-1 names them
// (docs/PLAN-J3-LUMIERE-COCKPIT.md §5, §10 J3-7). The incident Sun lights the ground, its water, its clouds' shadows and the craft —
// the light that arrives —; the geometric one stays for the air's own scattering (the sky, its light on the ground), the disc and the
// eclipses, and the far Earth's traced ground (earthGround: no seam seen at the rings' edge at sunset, J3-7, 13 Nov 2026). A reader
// moved from one to the other without the contract changing fails here.

const trace = await Bun.file(`${import.meta.dir}/../src/shaders/trace.wgsl`).text();
const forest = await Bun.file(`${import.meta.dir}/../src/shaders/forest.wgsl`).text();
const fns = parseFunctions(stripComments(composeTracer(trace, forest, FULL_TRACER_LIMITS)));
const calls = (fn: string, callee: string) => new RegExp(`\\b${callee}\\s*\\(`).test(fns.get(fn)!.body);

test("the incident Sun's readers: the raster's ground and its light, its water, the clouds' shadows, the craft's key light", () => {
  const incident = [...fns.values()]
    .filter((f) => calls(f.name, "incidentSun"))
    .map((f) => f.name)
    .sort();
  expect(incident).toEqual(["cloudShadow", "keyLight", "shadeLite", "shadeLiteLight", "shadeWater"]);
});

test("the geometric Sun's: the sky's light on the ground (its height mu0g), the air, the disc and the eclipses, the far traced ground", () => {
  for (const f of ["liteSky", "skySeen", "sunSeen", "earthGround", "skyFlat", "nightFloor"]) {
    expect(fns.has(f), f).toBe(true);
    expect(calls(f, "incidentSun"), `${f} reads the incident Sun`).toBe(false);
  }
  // (the ground's light: the sky by the geometric height — Lp's, mu0g —, the direct Sun by the incident one — Li's, mu0)
  const lite = fns.get("liteLight")!.body;
  expect(lite).toMatch(/let mu0 = dot\(gq, Li\)/);
  expect(lite).toMatch(/let mu0g = dot\(gq, Lp\)/);
  expect(lite).toMatch(/liteSky\(q, hG, E, Ls, mu0g\)/);
});
