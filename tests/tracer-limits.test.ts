import { expect, test } from "bun:test";
import { composeTracer, FULL_TRACER_LIMITS } from "../src/system/tracer-source";
import { stripComments } from "../src/system/wgsl-specialise";

// The tracer composed for smaller devices (system/tracer-source.ts): each optional part whose binding the device cannot take is cut out —
// its declaration and every reader. A reader left behind names a binding that is no longer declared, and the whole tracer fails to compile
// on that device: the game does not start (audit, 14 Nov 2026 — the sea's mirrored sky, seaSkyRadiance, read the FFT's texture array outside
// the cut region: "unresolved value 'seaFft'" at 16–18 sampled textures, WebGPU's default 16 among them). The browser's compile of these
// variants: scripts/check-wgsl.ts.

const trace = await Bun.file(`${import.meta.dir}/../src/shaders/trace.wgsl`).text();
const forest = await Bun.file(`${import.meta.dir}/../src/shaders/forest.wgsl`).text();
const bindings = (code: string) =>
  new Map([...stripComments(code).matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var(?:<[^>]*>)?\s+(\w+)/g)].map((m) => [m[2]!, +m[1]!]));

test("at every device's limits, no cut binding is still read", () => {
  const full = bindings(composeTracer(trace, forest, FULL_TRACER_LIMITS));
  expect(full.size).toBeGreaterThan(30);
  for (const tex of [16, 17, 18, 19, 20, 24, 27, 29, 32, 48])
    for (const sto of [8, 9, 10, 16]) {
      const code = composeTracer(trace, forest, { maxSampledTexturesPerShaderStage: tex, maxStorageBuffersPerShaderStage: sto });
      const here = bindings(code);
      const body = stripComments(code);
      // (a name read, not a struct's member of the same name — P.scenery, its field `scenery:`)
      const left = [...full.keys()].filter((name) => !here.has(name) && new RegExp(`(?<![.\\w])${name}\\b(?!\\s*:)`).test(body));
      expect(left, `${tex} sampled textures, ${sto} storage buffers`).toEqual([]);
    }
  // (40 compositions of the 1 MB tracer: ~8 s here)
}, 60_000);

test("WebGPU's default limits (16 textures, 8 storage buffers) cut the sea's FFT — and its mirrored sky with it", () => {
  const code = stripComments(composeTracer(trace, forest, { maxSampledTexturesPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8 }));
  expect(code).toContain("fn seaSkyRadiance(");
  expect(/\bseaFft\b/.test(code)).toBe(false);
  expect(/\bseaSamp\b/.test(code)).toBe(false);
});
