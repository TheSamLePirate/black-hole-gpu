import { expect, test } from "bun:test";
import { tracerSource } from "../scripts/lib/kernel-profiles";
import { wgslClosure, wgslLibraryModule, wgslStruct } from "../src/system/wgsl-library";

// PLAN-J1 J1-3 — the tracer's WGSL as the ground's library (system/wgsl-library.ts): a closure takes the functions a root
// reaches, the values and structures they read, and lists the tracer's resources they need (check-wgsl compiles each family
// alone in the browser).

const src = tracerSource();

test("the sky's family: its functions, the parameters and the bodies' table alone", () => {
  const c = wgslClosure(src, ["liteSky"]);
  for (const f of ["liteSky", "skyFlat", "skySeen", "nightFloor"]) expect(c.functions.has(f)).toBeTrue();
  expect([...c.resources.keys()].sort()).toEqual(["P", "bodies"]);
  expect(c.functions.has("cost")).toBeFalse();
});

test("the sun's family names its shadows' maps; the imagery's its textures", () => {
  const sun = [...wgslClosure(src, ["liteSun"]).resources.keys()];
  for (const r of ["csmTex", "sunShadowMap", "tsmTex", "shipShadowMap", "scenery"]) expect(sun).toContain(r);
  const img = [...wgslClosure(src, ["earthImageryAniso"]).resources.keys()];
  for (const r of ["orthoTex", "orthoSamp", "imgTex2k"]) expect(img).toContain(r);
});

test("a module: Params first, its entry last; a missing root throws", () => {
  const m = wgslLibraryModule(src, ["liteSky"], "// tail");
  expect(m.startsWith(wgslStruct(src, "Params")!)).toBeTrue();
  expect(m.endsWith("// tail")).toBeTrue();
  expect(() => wgslClosure(src, ["noSuchFunction"])).toThrow();
});
