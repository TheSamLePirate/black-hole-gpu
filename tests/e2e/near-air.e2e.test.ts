import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { GARGANTUA_SYSTEM } from "../../src/system/bodies";

// Gargantua's worlds' air (Miller, Mann, Edmunds) as the tracer draws it: the real nearAir and earthAir
// run on the GPU (only the light stubbed: the sun overhead, unit irradiance) for a camera 2 m over the
// ground — their zenith's transmittance against the exponential air's column, their sky lit. A field of
// the air's spec once left at zero (its z scale) flattened that air onto the ground: no sky at all. And
// the Moon's eclipses (P.eclipse, on the Earth's axes) leave their sky alone: one set before their sun
// once dimmed it.

const trace = await Bun.file(new URL("../../src/shaders/trace.wgsl", import.meta.url)).text();
function shaderFunction(name: string) {
  const start = trace.indexOf(`fn ${name}(`);
  if (start < 0) throw new Error(`Missing WGSL helper ${name}`);
  let end = trace.indexOf("{", start),
    depth = 1;
  while (depth && ++end < trace.length) {
    if (trace[end] === "{") depth++;
    if (trace[end] === "}") depth--;
  }
  return trace.slice(start, end + 1);
}
function shaderStruct(name: string) {
  const start = trace.indexOf(`struct ${name} {`);
  if (start < 0) throw new Error(`Missing WGSL struct ${name}`);
  return trace.slice(start, trace.indexOf("};", start) + 2);
}
const vec = (v: number[]) => `vec${v.length}f(${v.join(",")})`;
afterAll(stopServer);

const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6],
  MIE = 2.33e-5;

test.skipIf(!E2E)(
  "the Gargantua worlds' air stands over their ground: its zenith column, its lit sky",
  async () => {
    const worlds = GARGANTUA_SYSTEM.bodies.filter((b) => b.universe === "gargantua" && b.surface?.atmosphere);
    expect(worlds.map((b) => b.id).sort()).toEqual(["edmunds", "mann", "miller"]);
    const cases = worlds.map((b) => {
      const atm = b.surface!.atmosphere!;
      // (as the renderer sets them: metres per radius, the scale height, the density, the top)
      const mR = b.radius * 1476.625 * GARGANTUA_SYSTEM.massSolar;
      const rho = atm.rho0 / 1.225;
      // the zenith's optical depth: the molecules' column ρH, the aerosols' at 0.15 H
      const tau = RAYLEIGH.map((br) => (br * atm.H + MIE * 0.15 * atm.H) * rho);
      return { near0: [0, 0, -(1 + 2 / mR)], near4: [0, 0, 1, mR], near5: [atm.H, rho, 1 + (12 * atm.H) / mR, 0], tau };
    });
    const helpers = [
      "nearAir",
      "earthAir",
      "airTop",
      "airK",
      "airHR",
      "airHM",
      "phaseM",
      "chUp",
      "airColumn",
      "sunThrough",
      "airPhysicalDirection",
      "airPhysicalNormal",
      "airRayScale",
      "airHeight",
      "eclipsePhysical",
      "sunSeenPhysical",
      "discShare",
      "airShade",
      "sunSeen",
      "skySeen",
    ]
      .map(shaderFunction)
      .join("\n");
    const init = cases
      .map((c, i) => `case ${i}u: { P.near0=${vec([...c.near0, 1])}; P.near4=${vec(c.near4)}; P.near5=${vec(c.near5)}; }`)
      .join("\n");
    const shader = `
    const PI=3.14159265358979; const EARTH_RM=6378137.0; const EARTH_MOON=vec3f(0.07,0.085,0.11);
    struct Params {near0:vec4f,near4:vec4f,near5:vec4f,earth3:vec4f,eclipse:vec4f,earth4:vec4f,wx:array<vec4f,5>,shade:array<vec4f,9>}; var<private> P:Params; var<private> AIR_K:u32=0u;
    // (the Earth's weather — W3 — out: earthAir's terms of it compiled away, as in fair weather)
    const HAS_WX=false; var<private> WX_W:f32=0.0; var<private> AIR_DUST:f32=0.0;
    fn wxFog(ro:vec3f,rd:vec3f)->vec2f{return vec2f(0.0);} fn wxNear(q:vec3f)->f32{return 0.0;}
    fn wxVeil(h:f32,w:f32,s:u32)->vec2f{return vec2f(1.0);} fn wxHaze(h:f32,w:f32)->f32{return 0.0;}
    fn hgPhase(g:f32,ct:f32)->f32{return 0.0;}
    ${shaderStruct("AirSpec")} var<private> AIR:AirSpec;
    ${shaderStruct("Air")} ${shaderStruct("EarthAir")}
    struct NearLight {dir:vec3f,e:vec3f};
    fn nearLight(k:u32)->NearLight{return NearLight(P.near4.xyz,vec3f(1.0));}
    ${helpers}
    @group(0) @binding(0) var<storage,read_write> out:array<f32>;
    @compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id:vec3u){
      switch id.x {${init} default:{return;}}
      let a=nearAir(vec3f(0.0,0.0,1.0),1e30,0u);
      let i=id.x*12u;
      out[i]=a.T.r; out[i+1u]=a.T.g; out[i+2u]=a.T.b; out[i+3u]=a.L.r; out[i+4u]=a.L.g; out[i+5u]=a.L.b;
      out[i+6u]=airTop();
      // (the Moon, as P.eclipse gives it, right before this world's sun: the Earth's eclipse, not theirs)
      P.eclipse=vec4f(-P.near0.xyz+10.0*P.near4.xyz,1.0); P.earth4.y=0.0047;
      let e=nearAir(vec3f(0.0,0.0,1.0),1e30,0u);
      out[i+7u]=e.L.r; out[i+8u]=e.L.g; out[i+9u]=e.L.b;
    }`;
    const bytes = cases.length * 12 * 4;
    const app = await App.boot({ width: 320, height: 240 });
    try {
      const values = await app.js<number[]>(`(async()=>{
      const device=__bh.renderer.device;device.pushErrorScope("validation");
      const pipeline=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code:${JSON.stringify(shader)}}),entryPoint:"check"}});
      const out=device.createBuffer({size:${bytes},usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=device.createBuffer({size:${bytes},usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      try{
        const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]});
        const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(${cases.length});pass.end();
        enc.copyBufferToBuffer(out,0,read,0,${bytes});device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
        const values=[...new Float32Array(read.getMappedRange())];read.unmap();
        const error=await device.popErrorScope();if(error)throw new Error(error.message);return values;
      }finally{out.destroy();read.destroy();}
    })()`);
      cases.forEach((c, k) => {
        const v = values.slice(k * 12, k * 12 + 10);
        expect(v.every(Number.isFinite)).toBe(true);
        // (the top 12 scale heights up: the whole column below it)
        expect(v[6]).toBeCloseTo(c.near5[2]!, 6);
        // the zenith's transmittance: the column's, to the march's 32 samples (a few per cent of τ)
        for (let j = 0; j < 3; j++) expect(Math.abs(-Math.log(v[j]!) / c.tau[j]! - 1)).toBeLessThan(0.03);
        // the sky lit, bluer than red
        expect(v[3]).toBeGreaterThan(0);
        expect(v[5]).toBeGreaterThan(v[3]!);
        for (let j = 0; j < 3; j++) expect(v[7 + j]! / v[3 + j]!).toBeCloseTo(1, 6);
      });
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);
