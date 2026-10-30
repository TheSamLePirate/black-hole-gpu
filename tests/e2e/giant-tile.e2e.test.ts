import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import trace from "../../src/shaders/trace.wgsl" with { type: "text" };
import { wgslFunction } from "../../src/system/warp-grid";
import { App, E2E, stopServer } from "./lib/app";
import { overrideConsts } from "./lib/wgsl-slice";

// PLAN-PLANETES-AAA P9 G8 (the giants' turbulence tile, system/giant-tile.ts): baked twice with the same seed, the same tile
// to the bit, under 50 ms of GPU; its flow map keeps areas (a streamfunction's flow: no divergence); the noises it shares
// the texture with read as before, to the texel (their z wrapped by hand, the guards — trace.wgsl dnoise, cloudNoise); and
// the tracer's reading of it (giantTurb, with the zonal flow's two phases) without a jump at any phase's end — the time
// loop seamless —, held still when the clock runs fast. No GPU error.
// Duration: ~2 min on kerr-mini.
// Done when: the slices compared and the bakes read back.

/** a compute slice run in the page: its `out` filled by `check`, one invocation a case */
const runSlice = (app: App, shader: string, cases: number, perCase: number, extra = "") =>
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
      const entries=[{binding:0,resource:{buffer:out}}${extra}];
      const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries});
      const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(${cases});pass.end();
      enc.copyBufferToBuffer(out,0,read,0,bytes);device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
      const values=[...new Float32Array(read.getMappedRange())];read.unmap();
      const error=await device.popErrorScope();if(error)throw new Error(error.message);return values;
    }finally{out.destroy();read.destroy();}
  })()`);

describe.skipIf(!E2E)("P9 G8: the giants' turbulence tile", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 640, height: 400 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("baked twice, the same tile to the bit, in under 50 ms of GPU; its flow map keeps areas", async () => {
    const r = await app.js<{ same: boolean; gpuMs: number[]; rms: number[]; jac: number[]; div: number[] }>(`(async () => {
      const r = __bh.renderer, ms = [];
      await r.bakeGiantTile(); ms.push(r.giantTile.gpuMs);
      const a = await r.readGiantTile();
      await r.bakeGiantTile(); ms.push(r.giantTile.gpuMs);
      const b = await r.readGiantTile();
      let same = a.data.length === b.data.length;
      for (let i = 0; same && i < a.data.length; i++) if (!(a.data[i] === b.data[i])) same = false;
      // (frames 4, 32, 64, 96 — the readback's guard first —: the displacement's rms [tile periods]; its divergence over
      // its curl — D ≈ u τ early in the window: a streamfunction's flow has none —; the flow map x − D's Jacobian's mean
      // departure from 1 — early, before the map folds under the grid)
      const N = a.size, rms = [], jac = [], div = [];
      for (const f of [5, 33, 65, 97]) {
        const at = (x, y, c) => a.data[((f * N + ((y + N) % N)) * N + ((x + N) % N)) * 4 + c];
        let s = 0, j = 0, dv = 0, cu = 0;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          s += at(x, y, 0) ** 2 + at(x, y, 1) ** 2;
          const dxx = (at(x + 1, y, 0) - at(x - 1, y, 0)) * N / 2, dxy = (at(x, y + 1, 0) - at(x, y - 1, 0)) * N / 2;
          const dyx = (at(x + 1, y, 1) - at(x - 1, y, 1)) * N / 2, dyy = (at(x, y + 1, 1) - at(x, y - 1, 1)) * N / 2;
          j += Math.abs((1 - dxx) * (1 - dyy) - dxy * dyx - 1);
          dv += (dxx + dyy) ** 2; cu += (dyx - dxy) ** 2;
        }
        rms.push(Math.sqrt(s / (N * N))); jac.push(j / (N * N)); div.push(Math.sqrt(dv / cu));
      }
      return { same, gpuMs: ms, rms, jac, div };
    })()`);
    console.log(
      `  bakes: GPU ${r.gpuMs.map((m) => m.toFixed(1)).join(", ")} ms; displacement rms ${r.rms.map((v) => v.toFixed(4)).join(", ")} periods; |div| / |curl| ${r.div.map((v) => v.toFixed(3)).join(", ")}; |J − 1| ${r.jac.map((v) => v.toFixed(3)).join(", ")}`,
    );
    expect(r.same).toBe(true);
    for (const m of r.gpuMs) if (Number.isFinite(m)) expect(m).toBeLessThan(50);
    // (it moves, more as the window goes on)
    expect(r.rms[1]!).toBeGreaterThan(0.005);
    expect(r.rms[3]!).toBeGreaterThan(r.rms[1]!);
    // (early in the window, D ≈ u τ: no divergence to speak of; areas kept. Later the map folds under the 128² grid — its
    // finite differences no longer a Jacobian —, the semi-Lagrangian's smoothing too: logged, not held)
    expect(r.div[0]!).toBeLessThan(0.1);
    expect(r.jac[0]!).toBeLessThan(0.05);
    expect(await app.js<number>(`(() => __bh.renderer.gpuErrors)()`)).toBe(0);
  }, 300_000);

  test("the noises read as before, to the texel: the guards wrap z as the sampler's repeat did", async () => {
    // (at texel centres in x, y; z anywhere — across the wrap too —: the new read against the old repeat's trilinear, built
    // from the slices loaded by hand: noise slice k in texture slice k + 1)
    const n = 64;
    const shader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@group(0) @binding(24) var noiseTex: texture_3d<f32>;
@group(0) @binding(25) var noiseSamp: sampler;
const NOISE_DZ = ${trace.match(/^const NOISE_DZ = ([\d.]+);/m)![1]};
${wgslFunction(trace, "cloudNoise")}
@compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x;
  let xy = vec2u((k * 37u) % 128u, (k * 91u) % 128u);
  let zt = f32(k) * 2.03 - 0.6;
  let p = vec3f((vec2f(xy) + 0.5) / 128.0 * 32.0, zt / 128.0 * 32.0);
  let a = cloudNoise(p);
  let w = fract(zt / 128.0) * 128.0 - 0.5;
  let i0 = (i32(floor(w)) + 128) % 128;
  let f = w - floor(w);
  let b = mix(textureLoad(noiseTex, vec3i(vec2i(xy), i0 + 1), 0), textureLoad(noiseTex, vec3i(vec2i(xy), (i0 + 1) % 128 + 1), 0), f);
  out[k] = max(max(abs(a.x - b.x), abs(a.y - b.y)), max(abs(a.z - b.z), abs(a.w - b.w)));
}`;
    await app.js(
      `(() => { window.__noiseView = __bh.renderer.noiseTexture.createView({ dimension: "3d" }); window.__noiseSamp = __bh.renderer.device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" }); return 1; })()`,
    );
    const v = await runSlice(app, shader, n, 1, `,{binding:24,resource:window.__noiseView},{binding:25,resource:window.__noiseSamp}`);
    const worst = Math.max(...v);
    console.log(`  the noises: worst departure ${worst.toExponential(2)} over ${n} reads (z across the wrap)`);
    // (the filter's weights quantised to 1/256 either way: the reads agree to that, a hundredth at most)
    expect(worst).toBeLessThan(0.01);
  }, 300_000);

  test("the tracer's reading: no jump at any phase's end, the eddies held when the clock runs fast", async () => {
    // (giantTurb as the tracer has it, the tile stubbed — a value per cycle, growing with its window's time as the real
    // displacement does —, summed over the zonal flow's two phases as giantAlbedo does)
    const cycle = Number(trace.match(/^const GIANT_CYCLE = ([\d.]+);/m)![1]);
    const T = [cycle, cycle / 4, cycle / 16];
    // (a time an f32 holds to the hundredth of a second)
    const t0 = 2.0e5;
    const times: number[] = [];
    // (each scale's ends: its two phases' — every half period — a hair before and after; then a quarter period on)
    for (const P of T) {
      const b = Math.ceil(t0 / (P / 2)) * (P / 2);
      times.push(b - 0.25, b + 0.25, b + P / 4);
    }
    // (the fast clock: a period apart, the same)
    times.push(t0, t0 + 777.0);
    const shader = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@group(0) @binding(24) var noiseTex: texture_3d<f32>;
@group(0) @binding(25) var noiseSamp: sampler;
const NOISE_DZ = ${trace.match(/^const NOISE_DZ = ([\d.]+);/m)![1]};
struct PP { envX: vec4f };
var<private> P: PP;
const PI = 3.14159265358979;
const TAU = 6.28318530717959;
const GIANT_CYCLE = ${cycle};
${wgslFunction(trace, "pcg")}
fn giantTileAt(ll: vec2f, m3: vec3f, L: f32, tn: f32, salt: u32, warp: vec2f) -> vec4f {
  let h = f32(pcg(salt) & 1023u) / 1023.0;
  return vec4f((h - 0.5) * tn, (0.3 - h) * tn, sin(6.0 * h) * tn, 100.0);
}
${wgslFunction(trace, "giantTurb")}
@compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) {
  let T = array<f32, ${times.length}>(${times.map((t) => t.toFixed(3)).join(", ")});
  let fast = id.x >= ${times.length - 2}u;
  P.envX = vec4f(0.0, 0.0, 0.0, select(1.0, 1e5, fast));
  let tS = T[id.x];
  let ph = fract(tS / GIANT_CYCLE);
  var r = vec3f(0.0);
  for (var j = 0u; j < 2u; j++) {
    let w = select(1.0 - abs(2.0 * ph - 1.0), abs(2.0 * ph - 1.0), j == 1u);
    r += w * giantTurb(vec2f(0.4, -0.3), tS, j, 1e-3, 1e-9, 100.0);
  }
  out[id.x * 3u] = r.x;
  out[id.x * 3u + 1u] = r.y;
  out[id.x * 3u + 2u] = r.z;
}`;
    const v = await runSlice(
      app,
      shader,
      times.length,
      3,
      `,{binding:24,resource:__bh.renderer.noiseTexture.createView({dimension:"3d"})},{binding:25,resource:__bh.renderer.device.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"repeat",addressModeV:"repeat",addressModeW:"repeat"})}`,
    );
    const at = (k: number) => v.slice(3 * k, 3 * k + 3);
    const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]!));
    for (let s = 0; s < 3; s++) {
      const jump = dist(at(3 * s), at(3 * s + 1));
      const move = dist(at(3 * s + 1), at(3 * s + 2));
      console.log(
        `  scale ${s} (period ${T[s]} s): across a phase's end ${jump.toExponential(2)}, a quarter period on ${move.toExponential(2)}`,
      );
      expect(v.every(Number.isFinite)).toBe(true);
      expect(jump).toBeLessThan(0.02 * move);
    }
    const still = dist(at(times.length - 2), at(times.length - 1));
    console.log(`  the fast clock: ${still.toExponential(2)} apart`);
    expect(still).toBeLessThan(1e-6);
  }, 300_000);
});
