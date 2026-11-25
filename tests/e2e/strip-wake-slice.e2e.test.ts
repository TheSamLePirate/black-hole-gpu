import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import trace from "../../src/shaders/trace.wgsl" with { type: "text" };
import { wgslFunction } from "../../src/system/warp-grid";
import { App, E2E, stopServer } from "./lib/app";
import { kelvinSlope, sceneryStrip } from "./lib/strip-wake-models";
import { overrideConsts } from "./lib/wgsl-slice";

// (25 Nov 2026) trace.wgsl's sceneryStrip — a surface line's strip: round-capped for a road's piece, square-ended for a junction's paint
// (kind 5: the crossing drawn as a striped pill before) — and kelvinSlope — a ship's Kelvin waves (the wake's concentric rings before) —
// sliced and run on the page's GPU, against their CPU models (tests/e2e/lib/strip-wake-models.ts, which tests/scenery-strip-wake.test.ts
// holds to their properties): the shader computes what the unit tests checked.
// Steps: 1 boot · 2 the slices run, their numbers against the models.
// Duration: ~1 min (~30 s with the boot here, 25 Nov 2026).
// Done when: every case within 2e-4 of its model.

/** a compute slice run in the page (road-pavement-slice.e2e.test.ts's): its `out` filled by `check`, one invocation a case */
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

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/** [x, y, square] about a 10 m strip (0,0)–(10,0), 2 m half-width, aa 0.12: inside, past its ends, at its corners, beside it */
const STRIP: [number, number, number][] = [
  [5, 0, 1],
  [5, 1.9, 1],
  [10.05, 1.0, 1],
  [10.3, 1.0, 1],
  [11.2, 1.0, 1],
  [11.2, 1.0, 0],
  [-1.0, 0.5, 0],
  [-1.0, 0.5, 1],
  [9.9, 1.95, 1],
  [3.3, -2.5, 0],
];
/** [x, ay, U, L, footM, jit, axis] — a fishing boat, a coaster, a big ship: inside the wedge, on its cusp, outside, on the axis; a
 *  coarse pixel (its short waves in the variance) */
const KELVIN: [number, number, number, number, number, number, number][] = [
  [40, 4, 2, 20, 0.05, 0.3, 0],
  [40, 13.5, 2, 20, 0.05, -0.6, 0],
  [40, 17, 2, 20, 0.05, 0.1, 0],
  [40, 13.5, 2, 20, 0.4, 0.5, 0],
  [60, 20, 2, 20, 0.3, -0.7, 0],
  [300, 100, 6, 60, 0.1, 0.8, 0],
  [300, 2, 6, 60, 0.1, -0.2, 1],
  [300, 2, 6, 60, 0.1, -0.2, 0],
  [900, 200, 10, 200, 0.4, 0.5, 0],
  [900, 310, 10, 200, 0.4, -0.9, 0],
];

describe.skipIf(!E2E)("sceneryStrip and kelvinSlope on the GPU (trace.wgsl sliced)", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 640, height: 400 });
    app.steps(["the slices run, their numbers against the models"]);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the strip's cover and the Kelvin waves' slopes: the shader's are the models'", async () => {
    await app.step("the slices run, their numbers against the models");
    const n = Math.max(STRIP.length, KELVIN.length);
    const shader = `@group(0) @binding(0) var<storage, read_write> out: array<f32>;
const TAU = 6.28318530717959;
${["sceneryStrip", "kelvinSlope"].map((name) => wgslFunction(trace, name)).join("\n")}
@compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) {
  let S = array<vec3f, ${STRIP.length}>(${STRIP.map(([x, y, q]) => `vec3f(${f(x)}, ${f(y)}, ${f(q)})`).join(", ")});
  let K = array<array<f32, 7>, ${KELVIN.length}>(${KELVIN.map((k) => `array<f32, 7>(${k.map(f).join(", ")})`).join(", ")});
  let i = id.x;
  if (i < ${STRIP.length}u) {
    let s = S[i];
    let r = sceneryStrip(s.xy, vec2f(0.0), vec2f(10.0, 0.0), 2.0, 0.12, s.z > 0.5);
    out[i * 6u] = r.x; out[i * 6u + 1u] = r.y; out[i * 6u + 2u] = r.z;
  }
  if (i < ${KELVIN.length}u) {
    let k = K[i];
    let g = kelvinSlope(k[0], k[1], k[2], k[3], 40.0 * k[3] + 2500.0, k[4], k[5], k[6]);
    out[i * 6u + 3u] = g.x; out[i * 6u + 4u] = g.y; out[i * 6u + 5u] = g.z;
  }
}`;
    const v = await runSlice(app, shader, n, 6);
    expect(v.every(Number.isFinite)).toBe(true);
    let worst = 0;
    STRIP.forEach(([x, y, q], k) => {
      const m = sceneryStrip([x, y], [0, 0], [10, 0], 2, 0.12, q > 0.5);
      const g = [v[6 * k]!, v[6 * k + 1]!, v[6 * k + 2]!];
      console.log(
        `  strip (${x}, ${y}) ${q ? "square" : "round"}: GPU ${g.map((e) => e.toFixed(4))} · model ${m.map((e) => e.toFixed(4))}`,
      );
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(g[c]! - m[c]!));
    });
    KELVIN.forEach(([x, ay, U, L, foot, jit, axis], k) => {
      const m = kelvinSlope(x, ay, U, L, 40 * L + 2500, foot, jit, axis);
      const g = [v[6 * k + 3]!, v[6 * k + 4]!, v[6 * k + 5]!];
      console.log(`  kelvin x ${x} ay ${ay} U ${U} L ${L}: GPU ${g.map((e) => e.toFixed(6))} · model ${m.map((e) => e.toFixed(6))}`);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(g[c]! - m[c]!));
    });
    await app.stepDone(`écart maximal GPU / modèle ${worst.toExponential(2)}`, worst < 2e-4);
    expect(worst).toBeLessThan(2e-4);
    // (past a crossing's end nothing; a road's piece's cap there)
    expect(v[6 * 4 + 2]).toBe(0);
    expect(v[6 * 5 + 2]).toBeGreaterThan(0.99);
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);
});
