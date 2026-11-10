// The compile cost of the forward ground's module against today's shadeLite (docs/PLAN-J1-OPAQUE-FORWARD.md J1-4's first risk):
// the J0 profile's shadeLite kernel as the renderer builds it (the tracer specialised for that entry), and the same entry's
// closure through wgsl-library.ts with the air and clouds before the surface (liteFinish) and the water (liteWater) left out — the
// surface alone, as the forward fragment would carry it. Each compiled cold (its entry renamed each round) in the browser's WebGPU,
// alternated, n rounds; createComputePipelineAsync's time [ms].
//
//   bun scripts/ground-compile-cost.ts [rounds=3]
import { tracerEntryPoint } from "../src/system/tracer-kernels";
import { wgslLibraryModule, wgslStruct } from "../src/system/wgsl-library";
import { withGpuPage } from "./lib/headless-gpu";
import { PROFILES, profileConstants, tracerSource } from "./lib/kernel-profiles";
import { specialiseWgsl } from "./lib/wgsl-inline";

const rounds = Number(process.argv[2] ?? 3);
const profile = PROFILES.find((p) => p.id === "earth-raster-wx")!;
const entry = tracerEntryPoint("shadeLite");
const spec = specialiseWgsl(tracerSource(), profileConstants(profile, "shadeLite"), entry);
// (the surface alone: the two left out made empty — their signatures kept)
const stubbed = spec
  .replace(/fn liteFinish\(([^)]*)\) \{[\s\S]*?\n\}/, "fn liteFinish($1) {}")
  .replace(/fn liteWater\(([^)]*)\) -> vec4f \{[\s\S]*?\n\}/, "fn liteWater($1) -> vec4f { return vec4f(0.0); }");
if (stubbed === spec) throw new Error("ground-compile-cost: liteFinish/liteWater not found");
const surface = wgslLibraryModule(stubbed, [entry], "").replace(`fn ${entry}(`, `@compute @workgroup_size(8, 8)\nfn ${entry}(`);
if (!wgslStruct(surface, "Params")) throw new Error("ground-compile-cost: no Params");
const modules = { "shadeLite (today's kernel)": spec, "the surface alone (forward's closure)": surface };
const sizes = Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, v.length]));
const out = await withGpuPage((evaluate) =>
  evaluate<Record<string, number[]> | { error: string }>(`(async () => {
    const modules = ${JSON.stringify(modules)};
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return { error: "no adapter" };
    const lim = {};
    for (const k of ["maxStorageBuffersPerShaderStage", "maxSampledTexturesPerShaderStage", "maxBindingsPerBindGroup", "maxStorageTexturesPerShaderStage"]) lim[k] = adapter.limits[k];
    const device = await adapter.requestDevice({ requiredLimits: lim });
    const res = {};
    for (let r = 0; r < ${rounds}; r++)
      for (const [name, code] of Object.entries(modules)) {
        // (the entry renamed each round: a fresh pipeline for the driver's cache — a comment alone is stripped before it)
        const ep = "${entry}_" + Math.floor(Math.random() * 1e9);
        // (and a live branch on a nonce: a different program, not only a different name)
        const nonce = Math.floor(Math.random() * 1e9);
        const at = code.indexOf("fn ${entry}("), open = code.indexOf("{", at);
        const src = code.slice(0, at) + "fn " + ep + code.slice(at + ${3 + entry.length}, open + 1) + " if (gid.x == " + nonce + "u) { return; }" + code.slice(open + 1);
        const m = device.createShaderModule({ code: src });
        if (!m) return { error: "no module" };
        const errs = (await m.getCompilationInfo()).messages.filter((x) => x.type === "error");
        if (errs.length) return { error: name + ": " + errs.slice(0, 3).map((e) => e.lineNum + " " + e.message).join(" | ") };
        const t0 = performance.now();
        await device.createComputePipelineAsync({ layout: "auto", compute: { module: m, entryPoint: ep } });
        (res[name] ??= []).push(+(performance.now() - t0).toFixed(0));
      }
    return res;
  })()`),
);
console.log(JSON.stringify({ sizes, ms: out }, null, 1));
