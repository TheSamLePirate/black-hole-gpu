// Validates every WGSL shader with the browser's own WebGPU compiler (headless Chrome over the DevTools
// protocol): getCompilationInfo on each module — an error here is a black screen for a player. The
// shaders that include a module at load (the tracer and the near field: the forests, src/forest-shader.ts)
// are checked alone (their stubs) and composed, as the app builds them — the tracer also as the smaller
// devices build it (no world scenery, no surface textures).
//
//   bun scripts/check-wgsl.ts        (CHROME=/path/to/chrome to choose the browser)
//
// Exit 1 on a compile error. Without a WebGPU adapter (a machine with neither GPU nor SwiftShader) it
// says so and exits 0: nothing could be checked, nothing is known to be broken.
import { Glob } from "bun";
import { withForest } from "../src/forest-shader";
import { surfaceShader } from "../src/system/earth-surface";
import { aerialShader } from "../src/system/aerial";
import { sceneryShader } from "../src/system/scenery";
import { warpShader } from "../src/system/warp-grid";
import { terrainCacheShader, withTerrainCache } from "../src/system/terrain-cache";
import { terrainRasterShader } from "../src/system/terrain-raster";
import { forestModuleOf, sceneryRasterShader } from "../src/system/scenery-raster";
import { withSunShadow, withTerrainRaster } from "../src/system/terrain-raster-hint";
import { CHROME, withGpuPage } from "./lib/headless-gpu";

const shaders: Record<string, string> = {};
for await (const f of new Glob("src/shaders/*.wgsl").scan(".")) shaders[f.split("/").pop()!] = await Bun.file(f).text();
for (const host of ["trace.wgsl", "character.wgsl"]) shaders[`${host} + forest.wgsl`] = withForest(shaders[host]!, shaders["forest.wgsl"]!);
// (the tracer as smaller devices build it: no world scenery — 8 storage buffers —, no surface textures)
const traced = withTerrainCache(shaders["trace.wgsl + forest.wgsl"]!);
shaders["trace.wgsl + forest + terrain cache"] = traced;
shaders["terrain height cache bake (system/terrain-cache.ts)"] = terrainCacheShader(traced);
shaders["terrain raster pilot (system/terrain-raster.ts)"] = terrainRasterShader(traced);
shaders["scenery raster instances (system/scenery-raster.ts)"] = sceneryRasterShader(forestModuleOf(traced));
// (the tracer as the full device builds it: the raster patch's distances read by the ground march)
shaders["trace.wgsl with the raster hint"] = withTerrainRaster(traced, true);
shaders["trace.wgsl with the raster hint and the relief's shadow map"] = withSunShadow(withTerrainRaster(traced, true), true);
shaders["trace.wgsl without scenery"] = sceneryShader(surfaceShader(traced, true), false);
shaders["trace.wgsl without surface textures"] = sceneryShader(surfaceShader(traced, false), true);
shaders["trace.wgsl without the aerial table"] = aerialShader(traced, false);
shaders["trace.wgsl without the aerial table, surface textures, scenery"] = aerialShader(
  sceneryShader(surfaceShader(traced, false), false),
  false,
);
// (the mountains' warp's grid pass: the tracer's noise taken from its source)
shaders["the warp grid's pass (system/warp-grid.ts)"] = warpShader(shaders["trace.wgsl"]!);

try {
  const v = await withGpuPage((evaluate) =>
    evaluate<{ adapter: string | null; out?: Record<string, string[]> }>(`(async () => {
      const shaders = ${JSON.stringify(shaders)};
      if (!navigator.gpu) return { adapter: null };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { adapter: null };
      const device = await adapter.requestDevice();
      const out = {};
      for (const [name, code] of Object.entries(shaders)) {
        const info = await device.createShaderModule({ code }).getCompilationInfo();
        out[name] = info.messages.filter((m) => m.type === "error").map((m) => m.lineNum + ":" + m.linePos + " " + m.message);
      }
      return { adapter: adapter.info?.description || adapter.info?.vendor || "an adapter", out };
    })()`),
  );
  if (!v?.adapter) {
    console.warn(`check-wgsl: no WebGPU adapter in this browser (${CHROME}) — nothing checked`);
    process.exit(0);
  }
  let bad = 0;
  for (const [name, errs] of Object.entries(v.out!)) {
    if (errs.length) {
      bad++;
      console.error(`✗ ${name}\n  ${errs.join("\n  ")}`);
    } else console.log(`✓ ${name}`);
  }
  console.log(`${Object.keys(v.out!).length - bad} / ${Object.keys(v.out!).length} shaders compile (${v.adapter})`);
  process.exit(bad ? 1 : 0);
} catch (e) {
  console.error("check-wgsl:", (e as Error).message);
  process.exit(1);
}
