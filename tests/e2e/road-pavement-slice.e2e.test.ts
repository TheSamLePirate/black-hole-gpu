import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import trace from "../../src/shaders/trace.wgsl" with { type: "text" };
import { wgslFunction } from "../../src/system/warp-grid";
import { App, E2E, stopServer } from "./lib/app";
import { overrideConsts } from "./lib/wgsl-slice";

// PLAN-PONT-ROUTES-AAA B1 (24 Nov 2026), review A10: the road's surface material — trace.wgsl roadPavement itself, sliced and run on the
// page's GPU (no TypeScript copy of the shader) — fades each detail into its mean as the pixel outgrows it (the asphalt's aggregate,
// the concrete's joints, the setts: their mean over a fine footprint is the coarse footprint's value — no shimmer), darkens the
// concrete's joints, keeps water in the gravel's ruts more than beside them, and its numbers stay finite.
// Duration: ~1 min on kerr-mini.
// Done when: the four materials' slices compared.

/** a compute slice run in the page: its `out` filled by `check`, one invocation a case */
const runSlice = (app: App, shader: string, cases: number, perCase: number) =>
  app.js<number[]>(`(async()=>{
    const device=__bh.renderer.device;device.pushErrorScope("validation");
    const module=device.createShaderModule({code:${JSON.stringify(`${overrideConsts(trace, shader)}\n${shader}`)}});
    const errs=(await module.getCompilationInfo()).messages.filter((m)=>m.type==="error");
    if(errs.length) throw new Error("WGSL: "+errs.map((m)=>m.lineNum+":"+m.linePos+" "+m.message).join(" | "));
    const pipeline=await device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:"check"}});
    const bytes=${cases * perCase * 4};
    const out=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const read=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    try{
      const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]});
      const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(${cases});pass.end();
      enc.copyBufferToBuffer(out,0,read,0,bytes);device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
      const values=[...new Float32Array(read.getMappedRange())];read.unmap();
      const error=await device.popErrorScope();if(error)throw new Error(error.message);return values;
    }finally{out.destroy();read.destroy();}
  })()`);

/** the cases: [material, footprint [m]] — each run over a 2 m × 2 m patch of the road (40 × 40 samples), its mean and spread */
const CASES: [number, number][] = [
  [0, 0.01],
  [0, 1.2],
  [1, 0.01],
  [1, 2.5],
  [2, 0.01],
  [2, 0.6],
  [3, 0.01],
];

describe.skipIf(!E2E)("B1: the road's surface material on the GPU (roadPavement sliced)", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 640, height: 400 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("each material's detail fades into its mean; the joints dark near; the ruts hold the water", async () => {
    await app.scenario("roadPavement: asphalt, concrete, setts, gravel at fine and coarse footprints");
    const shader = `@group(0) @binding(0) var<storage, read_write> out: array<f32>;
${["pcg", "hash3u", "u2f", "hash31", "vnoise", "paveCover"].map((n) => wgslFunction(trace, n)).join("\n")}
${trace.match(/^struct Pavement \{[^}]*\};/m)![0]}
${wgslFunction(trace, "roadPavement")}
@compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) {
  let C = array<vec2f, ${CASES.length}>(${CASES.map(([m, f]) => `vec2f(${m}.0, ${f})`).join(", ")});
  let c = C[id.x];
  // (a two-way road of two lanes 7 m wide — its word: dashed centre, no lane lines — its patch 1–3 m off its axis, 100–102 m along)
  var sum = 0.0; var sum2 = 0.0; var track = 0.0; var nTrack = 0.0; var off = 0.0; var nOff = 0.0; var joint = 0.0; var mid = 0.0;
  for (var j = 0u; j < 40u; j++) {
    for (var i = 0u; i < 40u; i++) {
      let d = 1.0 + f32(i) * 0.05; let s = 100.0 + f32(j) * 0.05;
      let p = roadPavement(u32(c.x), vec4f(d, 3.5, s, 2.0), vec2f(1.0, 0.0), vec2f(s, d), c.y);
      let t = p.tint.x;
      sum += t; sum2 += t * t;
      // (the wheel path: 0.8 m from the lane's centre — 1.75 m —: 0.95 m from the axis)
      if (abs(d - 0.95) < 0.15) { track += p.puddle; nTrack += 1.0; } else if (abs(d - 2.2) < 0.2) { off += p.puddle; nOff += 1.0; }
      // (a concrete joint every 4.5 m: 99 m and 103.5 m — s 100.0 is 1 m past one; the middle of a slab 101.25 m)
      if (abs(fract(s / 4.5 + 0.5) - 0.5) * 4.5 < 0.01) { joint += t; }
      if (abs(s - 101.25) < 0.03) { mid += t; }
    }
  }
  let n = 1600.0;
  out[id.x * 6u] = sum / n;
  out[id.x * 6u + 1u] = sqrt(max(sum2 / n - (sum / n) * (sum / n), 0.0));
  out[id.x * 6u + 2u] = track / max(nTrack, 1.0);
  out[id.x * 6u + 3u] = off / max(nOff, 1.0);
  out[id.x * 6u + 4u] = joint;
  out[id.x * 6u + 5u] = mid;
}`;
    const v = await runSlice(app, shader, CASES.length, 6);
    const at = (k: number) => ({
      mean: v[6 * k]!,
      sd: v[6 * k + 1]!,
      track: v[6 * k + 2]!,
      off: v[6 * k + 3]!,
    });
    CASES.forEach(([m, f], k) => console.log(`  material ${m} footprint ${f} m: ${JSON.stringify(at(k))}`));
    expect(v.every(Number.isFinite)).toBe(true);
    // (asphalt: the aggregate seen near, gone into its mean far — the fine mean within 4 % of the coarse value, its spread larger)
    expect(Math.abs(at(0).mean - at(1).mean) / at(1).mean).toBeLessThan(0.04);
    expect(at(0).sd).toBeGreaterThan(2 * at(1).sd);
    // (concrete: its slabs' joints dark near; far, their thin share of the patch's mean — within 3 %)
    expect(Math.abs(at(2).mean - at(3).mean) / at(3).mean).toBeLessThan(0.05);
    // (setts: their stones and joints near, their mean beyond a quarter metre — within 6 %)
    expect(at(4).sd).toBeGreaterThan(at(5).sd);
    expect(Math.abs(at(4).mean - at(5).mean) / at(5).mean).toBeLessThan(0.08);
    // (gravel: the water held in the ruts more than beside them)
    expect(at(6).track).toBeGreaterThan(at(6).off);
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);
});
