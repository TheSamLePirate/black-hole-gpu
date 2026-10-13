// The procedural forests' WGSL (shaders/forest.wgsl) set into the shaders that trace them: the tracer and
// the near field's (grass shade, the astronaut's shadow). Each host keeps a stub between its
// BEGIN_FOREST_MODULE / END_FOREST_MODULE lines — it compiles alone (scripts/check-wgsl.ts checks both) —
// and gives the module its buffer through forestData(i).
import forestWGSL from "./shaders/forest.wgsl" with { type: "text" };

const HOST_BLOCK = /\/\/ BEGIN_FOREST_MODULE[^\n]*\n[\s\S]*?\/\/ END_FOREST_MODULE[^\n]*\n/;
const STANDALONE = /\/\/ BEGIN_FOREST_STANDALONE[^\n]*\n[\s\S]*?\/\/ END_FOREST_STANDALONE[^\n]*\n/;

/** the module's text (a URL in builds that load shaders apart: fetched) */
export const forestSource = forestWGSL;

/** A host shader with the forests in place of its stub. */
export function withForest(host: string, module: string = forestWGSL): string {
  if (!HOST_BLOCK.test(host)) throw new Error("forest-shader: the host has no BEGIN_FOREST_MODULE … END_FOREST_MODULE block");
  if (!STANDALONE.test(module)) throw new Error("forest-shader: the module has no standalone block to remove");
  const body = module.replace(STANDALONE, "");
  return host.replace(HOST_BLOCK, () => `// ---- forest.wgsl\n${body}\n// ---- end of forest.wgsl\n`);
}
