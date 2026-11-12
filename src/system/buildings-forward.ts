// The buildings shaded forward (docs/PLAN-J1-OPAQUE-FORWARD.md J1-5): the scenery raster's building triangles drawn a second time,
// after the visibility pass, against its kept depth (depth equal, not written: the visible triangle's fragment alone, the hidden
// ones turned away before any shading), their fragment shading the pixel — liteBuildingG in trace.wgsl: shadeLite's building, its
// material Q3, its light, the point on the triangle's own plane, its geometric normal and footprint from the hardware's derivatives —
// into liteOut (G, tM) and a mask; a marking pass then marks those pixels RASTER_SPLIT (moments.x — not the fragment: a write to
// memory there turns the depth test late on Metal, every hidden fragment shaded): shadeLite leaves them, shadeLiteFinish puts the
// air and the clouds on as it does for its own. The pipeline: the vertex stage the scenery raster's own module and entry (meshVs: the visibility's very vertices,
// group 0 its own), the fragment the tracer's closure of liteBuildingG from the source specialised for the scene's key, its groups
// shifted by one (1 the tracer's group 0, 2 its group 1).

import { LITE_OUT_FORMAT } from "./tracer-source";
import { wgslClosure, wgslLibraryModule } from "./wgsl-library";

/** the fragment's entry (its inputs the scenery raster's MV, all of them: the vertex stage's interface whole) */
function fragmentEntry(dbg: number): string {
  return `
struct BuildingIn {
  @builtin(position) clip: vec4f,
  @location(0) p: vec3f,
  @location(1) @interpolate(flat) bridge: f32,
  @location(2) @interpolate(flat) leaf: f32,
  @location(3) pyl: vec4f,
  @location(4) mot: vec3f,
};
struct BuildingOut { @location(0) surface: vec4f, @location(1) mask: f32 };
@fragment fn buildingFs(v: BuildingIn) -> BuildingOut {
  // (the triangle's plane: the hardware's derivatives of its point, taken first — in uniform control flow)
  let nV = cross(dpdxFine(v.p), dpdyFine(v.p));
  // (no discard and no write to memory: the depth test stays early — the hidden fragments never shaded. A pixel not taken writes
  // its mask 0 and a blank surface into liteOut, which shadeLite writes over for every pixel it finishes)
  var o = BuildingOut(vec4f(0.0), 0.0);
  // (a building's own triangle — not a bridge's part, a turbine, a pylon, a car, a lamp: those stay shadeLite's)
  if (v.bridge < 0.5 && v.leaf > 0.5) {
    let g = liteBuildingG(v.clip.xy, v.p, nV, u32(round(v.leaf)), ${dbg}u);
    if (g.a > 0.0) { o = BuildingOut(g, 1.0); }
  }
  return o;
}`;
}

/** The fragment's module for a specialised tracer source: the closure of liteBuildingG, its resources one group up. */
export function buildingsForwardShader(trace: string, dbg = 0): string {
  const lib = wgslLibraryModule(trace, ["liteBuildingG"], "");
  return `${lib.replace(/^@group\((\d+)\)/gm, (_, g: string) => `@group(${Number(g) + 1})`)}
// ---- PLAN-J1 J1-5: the buildings' forward fragment (system/buildings-forward.ts)
${fragmentEntry(dbg)}`;
}

/** the mask's format (1 where the fragment shaded the pixel this frame; cleared each pass) */
export const BUILDINGS_FORWARD_MASK: GPUTextureFormat = "r8unorm";
/** moments.x of a pixel left to shadeLiteFinish (trace.wgsl RASTER_SPLIT) */
const RASTER_SPLIT = -9.5;
/** The marking pass: a pixel the fragment shaded (its mask) marked RASTER_SPLIT — its distance kept (shadeLiteFinish writes its
 *  own) —; under the cockpit's mask (moments.x −1) left as it is: the cabin there. */
export const BUILDINGS_FORWARD_MARK_WGSL = `
@group(0) @binding(0) var mask: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> moments: array<vec2f>;
@compute @workgroup_size(8, 8)
fn markForward(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(mask);
  if (g.x >= d.x || g.y >= d.y) { return; }
  if (textureLoad(mask, vec2i(g.xy), 0).r < 0.5) { return; }
  let i = g.y * d.x + g.x;
  let m = moments[i];
  if (m.x < -0.5 && m.x > -1.5) { return; }
  moments[i] = vec2f(${RASTER_SPLIT}, m.y);
}
`;

/** the tracer's bindings the fragment reads, by the tracer's group (0, 1) */
export function buildingsForwardBindings(trace: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const line of wgslClosure(trace, ["liteBuildingG"]).resources.values()) {
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

/** The buildings' forward pipeline for one tracer key (renderer.buildingsForward). */
export class BuildingsForward {
  pipe: GPURenderPipeline | null = null;
  /** the marking pass (its layout its own: "auto") */
  mark: GPUComputePipeline | null = null;
  /** the tracer key and debug view it was built for (-1 none), the one being built */
  key = "";
  private building = "";
  failed: string | null = null;
  /** the tracer's bindings it reads, by the tracer's group */
  used = new Map<number, number[]>();
  /** the last build's cold times [ms]: the source's closure, the pipeline */
  compileMs = { source: 0, pipeline: 0 };
  /** its fragment's source size [kB] */
  codeKB = 0;
  constructor(private device: GPUDevice) {}
  ready(key: string): boolean {
    return this.key === key && !!this.pipe && !!this.mark;
  }
  /** Builds it for `key` from that key's specialised source (once; a newer key replaces an older build). */
  async build(key: string, trace: Promise<string>, vertex: GPUShaderModule, constants: Record<string, number>, dbg: number): Promise<void> {
    if (this.building === key || this.key === key) return;
    this.building = key;
    try {
      const t0 = performance.now();
      const src = await trace;
      const code = buildingsForwardShader(src, dbg);
      const used = buildingsForwardBindings(src);
      // (the key's constants — the specialised source keeps its overrides, their values given at the pipeline's creation —,
      // those the module declares)
      const names = new Set([...code.matchAll(/^override\s+(\w+)/gm)].map((m) => m[1]!));
      const own = Object.fromEntries(Object.entries(constants).filter(([k]) => names.has(k)));
      const t1 = performance.now();
      const module = this.device.createShaderModule({ code, label: "buildings forward" });
      const pipe = await this.device.createRenderPipelineAsync({
        label: "buildings forward",
        layout: "auto",
        // (the visibility's own vertex stage — its module, its entry: the same positions, bit for bit, as the depth it kept)
        vertex: { module: vertex, entryPoint: "meshVs" },
        fragment: {
          module,
          entryPoint: "buildingFs",
          targets: [{ format: LITE_OUT_FORMAT }, { format: BUILDINGS_FORWARD_MASK }],
          constants: own,
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "equal" },
      });
      this.mark ??= await this.device.createComputePipelineAsync({
        label: "buildings forward: marking",
        layout: "auto",
        compute: {
          module: this.device.createShaderModule({ code: BUILDINGS_FORWARD_MARK_WGSL, label: "buildings forward: marking" }),
          entryPoint: "markForward",
        },
      });
      if (this.building !== key) return;
      this.compileMs = { source: t1 - t0, pipeline: performance.now() - t1 };
      this.codeKB = code.length / 1024;
      this.pipe = pipe;
      this.used = used;
      this.key = key;
      this.failed = null;
    } catch (e) {
      this.failed = String((e as Error)?.message ?? e).slice(0, 500);
      console.warn("buildings forward: not built —", this.failed);
    } finally {
      if (this.building === key) this.building = "";
    }
  }
}
