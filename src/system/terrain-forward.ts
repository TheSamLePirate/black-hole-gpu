// The forward ground (docs/PLAN-J1-OPAQUE-FORWARD.md J1-4): the relief's patch drawn a second time, its depth equal to the
// visibility pass's kept one, its fragment shading the surface — liteForwardG in trace.wgsl, shadeLite's prologue and
// liteSurface — into a colour target; a finishing pass then puts the air and the clouds before it (liteFinish) and shadeLite
// leaves those pixels. Here: the module, built from the terrain raster's (its vertex stage, its relief library at group 1) and
// the tracer's closure of liteForwardG (wgsl-library.ts), both from the same specialised tracer source.
//
// Groups: 0 the terrain raster's own (its uniform, the table); 1 the tracer's group 0 at its own bindings — the relief library
// declares four of them there already (P, bgSamp, earthElev, earthTiles: the same numbers); 2 the tracer's group 1.

import { terrainRasterShader } from "./terrain-raster";
import { wgslClosure, wgslFunctions, wgslLibraryModule } from "./wgsl-library";

/** the names a module declares at module scope (functions, values, structures, resources) */
function declared(src: string): Set<string> {
  const out = new Set<string>(wgslFunctions(src).keys());
  for (const m of src.matchAll(/^(?:const|override|var(?:<[^>]*>)?|struct|alias)\s+(\w+)\b/gm)) out.add(m[1]!);
  for (const m of src.matchAll(/^@group\(\d+\)\s*@binding\(\d+\)\s*var(?:<[^>]*>)?\s+(\w+)\s*:/gm)) out.add(m[1]!);
  return out;
}

/** The forward ground's module for a specialised tracer source (its constants folded, every function kept). */
export function terrainForwardShader(trace: string, debug = false): string {
  const base = terrainRasterShader(trace);
  const have = declared(base);
  const c = wgslClosure(trace, ["liteForwardG"]);
  const add: string[] = [];
  for (const [name, s] of c.structs) if (!have.has(name)) add.push(s);
  for (const [name, d] of c.declarations) if (!have.has(name)) add.push(d);
  for (const [name, r] of c.resources) {
    if (have.has(name)) continue;
    add.push(r.replace(/@group\((\d+)\)/, (_, g: string) => `@group(${Number(g) + 1})`));
  }
  for (const [name, f] of c.functions) if (!have.has(name)) add.push(f);
  return `${base}
// ---- PLAN-J1 J1-4: the forward ground's fragment (system/terrain-forward.ts) — the tracer's closure of liteForwardG
${add.join("\n")}
// (the visible ground's fragment alone — its distance the visibility's at the pixel: no depth kept nor tested, the triangles
// behind it rejected before any shading —, its surface where liteForwardG takes it: else nothing, the pixel shadeLite's)
@fragment fn forwardFs(v: Vertex) -> @location(0) vec4f {
  let px = v.clip.xy;
  let r = terrainRasterHint(floor(px) + 0.5);
  let d = length(v.p);
  if (r <= 0.0 || abs(d - r) > 0.002 * r + 0.05) { ${debug ? "return vec4f(select(6.0, 7.0, r <= 0.0), d, r, 0.25);" : "discard;"} }
  let g = liteForwardG(px);
  if (g.a < 0.5) { ${debug ? "return vec4f(g.r, d, r, 0.25);" : "discard;"} }
  return g;
}
`;
}

/** the forward colour's format (the surface's radiance G, a: 1 where the fragment shaded it) */
export const TERRAIN_FORWARD_FORMAT: GPUTextureFormat = "rgba16float";
/** the forward colour's binding in the finishing pass: group 1's 2 — the far field's LUT there in the tracer, which liteFinish
 *  does not read: the pass takes the tracer's own pipeline layout, no texture more than the device was asked for */
export const FORWARD_FINISH_TEX = 2;

/** The finishing pass's module: the tracer's closure of liteForwardFinish at its own groups (0, 1), the forward colour in group 1. */
export function terrainForwardFinishShader(trace: string): string {
  return wgslLibraryModule(
    trace,
    ["liteForwardFinish"],
    `@group(1) @binding(${FORWARD_FINISH_TEX}) var forwardTex: texture_2d<f32>;
@compute @workgroup_size(8, 8)
fn forwardFinish(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u32(P.res.x) || gid.y >= u32(P.res.y)) { return; }
  let g = textureLoad(forwardTex, vec2i(gid.xy), 0);
  if (g.a < 0.5) { return; }
  liteForwardFinish(gid.xy, g.rgb);
}`,
  );
}

/** a module's resources an entry set reads, by group: binding numbers */
export function usedBindings(module: string, entries: string[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  // (entry points written on one line — `@vertex fn terrainVs(` —: their attributes off for the search)
  const plain = module.replace(/^@(?:vertex|fragment)\s+fn /gm, "fn ");
  for (const line of wgslClosure(plain, entries).resources.values()) {
    const m = /@group\((\d+)\)\s*@binding\((\d+)\)/.exec(line);
    if (!m) continue;
    const g = Number(m[1]);
    out.set(
      g,
      [...(out.get(g) ?? []), Number(m[2])].sort((a, b) => a - b),
    );
  }
  return out;
}

/**
 * The forward ground's pipelines for one tracer key (PLAN-J1 J1-4, renderer.forwardGround): built from that key's specialised
 * source — the forward fragment's render pipeline (its layout its own: "auto"; the bindings it reads, `used`) and the finishing
 * compute pipeline (the tracer's own pipeline layout, the forward colour in its group 1).
 */
export class TerrainForward {
  forward: GPURenderPipeline | null = null;
  finish: GPUComputePipeline | null = null;
  /** the tracer key they were built for (-1 none) and the one being built */
  key = -1;
  private building = -1;
  failed: string | null = null;
  /** the forward module's bindings read, by group (1: the tracer's group 0, 2: its group 1) */
  used = new Map<number, number[]>();
  /** the last builds' cold compile times [ms] */
  compileMs = { forward: 0, finish: 0 };
  constructor(
    private device: GPUDevice,
    private traceLayout: GPUBindGroupLayout,
    readonly lutReadLayout: GPUBindGroupLayout,
  ) {}
  ready(key: number): boolean {
    return this.key === key && !!this.forward && !!this.finish;
  }
  /** Builds them for `key` from its specialised source (once; a newer key replaces an older build). */
  async build(key: number, trace: string, vertex: GPUShaderModule, debug = false): Promise<void> {
    if (this.building === key || this.key === key) return;
    this.building = key;
    try {
      const fwdCode = terrainForwardShader(trace, debug);
      const finCode = terrainForwardFinishShader(trace);
      const used = usedBindings(fwdCode, ["terrainVs", "forwardFs"]);
      const d = this.device;
      const fm = d.createShaderModule({ code: fwdCode, label: "forward ground" });
      const xm = d.createShaderModule({ code: finCode, label: "forward ground: finishing" });
      const t0 = performance.now();
      const forward = await d.createRenderPipelineAsync({
        label: "forward ground",
        layout: "auto",
        // (the visibility pass's own vertex stage — its module: the same vertices, bit for bit, as the distances it wrote)
        vertex: {
          module: vertex,
          entryPoint: "terrainVs",
          buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
        },
        fragment: { module: fm, entryPoint: "forwardFs", targets: [{ format: TERRAIN_FORWARD_FORMAT }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      const t1 = performance.now();
      const finish = await d.createComputePipelineAsync({
        label: "forward ground: finishing",
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.traceLayout, this.lutReadLayout] }),
        compute: { module: xm, entryPoint: "forwardFinish" },
      });
      this.compileMs = { forward: t1 - t0, finish: performance.now() - t1 };
      if (this.building !== key) return;
      this.forward = forward;
      this.finish = finish;
      this.used = used;
      this.key = key;
      this.failed = null;
    } catch (e) {
      this.failed = String((e as Error)?.message ?? e).slice(0, 500);
      console.warn("forward ground: not built —", this.failed);
    } finally {
      if (this.building === key) this.building = -1;
    }
  }
}
