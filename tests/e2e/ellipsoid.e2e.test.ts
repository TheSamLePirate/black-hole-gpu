import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { figureDiskShare, geodeticNormal, geodeticToCart, squashedHeight, WGS84_A as A, WGS84_F as F } from "../../src/system/ellipsoid";
import { EARTH_RUNWAYS, runwayWeight } from "../../src/game/sites";
import type { Vec3 } from "../../src/math/vec3";

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
const vec = (v: number[]) => `vec${v.length}f(${v.join(",")})`;
afterAll(stopServer);

test.skipIf(!E2E)(
  "GPU geometry, moonlight and optical lengths keep their contracts without Earth maps",
  async () => {
    const cases = [-80, -45, 0, 42.34, 45, 80, 90].flatMap((lat) =>
      [0, 10e3].flatMap((h) =>
        [0, 1].map((maps) => {
          const physical = geodeticToCart(A, F, (lat * Math.PI) / 180, 0.3, h);
          const march = [physical[0] / A, physical[1] / A, physical[2] / (A * (1 - F))];
          const q = march.map((v) => v / Math.hypot(...march));
          const normal = [q[0]!, q[1]!, q[2]! / (1 - F)];
          const moon = normal.map((v) => v / Math.hypot(...normal));
          return { maps, march, q, moon, height: squashedHeight(physical, A, F).h };
        }),
      ),
    );
    const sourceCases: { ro: Vec3; light: Vec3; rs: number; ab: number; share: number }[] = [];
    const b = 1 - F,
      d = b + 400e3 / A,
      limb = Math.atan(1 / Math.sqrt(d * d - b * b));
    for (const ab of [1 / b, 1])
      for (const offset of [-2, -0.5, 0, 0.5, 2]) {
        const angle = limb + offset * 0.0047;
        const ro: Vec3 = [0, 0, d],
          light: Vec3 = [Math.sin(angle), 0, -Math.cos(angle)];
        sourceCases.push({ ro, light, rs: 0.0047, ab, share: figureDiskShare(ro, light, 0.0047, 1, 1 - 1 / ab) });
      }
    const runwayCases = EARTH_RUNWAYS.flatMap((r) =>
      [
        [1000, 0],
        [-2500, 40],
        [1000, 90],
        [4650, 0],
        [1000, 200],
      ].map(([along, across]) => {
        const q = geodeticNormal(A, F, r.origin.map((v, i) => v + along! * r.along[i]! + across! * r.across[i]!) as Vec3);
        return { r, q, expected: runwayWeight(q) };
      }),
    );
    const helpers = [
      "squashed",
      "earthOn",
      "isEarth",
      "squashOf",
      "hasAir",
      "airOf",
      "airPhysicalDirection",
      "airPhysicalNormal",
      "airRayScale",
      "airHeight",
      "earthMoonlight",
      "figureSunShare",
      "earthSurface",
      "rwyCount",
      "runwayGrade",
    ]
      .map(shaderFunction)
      .join("\n");
    const init = cases
      .map((c, i) => `case ${i}u: { P.earth.x=${c.maps}; p=${vec(c.march)}; q=${vec(c.q)}; P.earth3=${vec([...c.moon, 1])}; }`)
      .join("\n");
    const initSource = sourceCases
      .map((c, i) => `case ${cases.length + i}u: { ro=${vec(c.ro)}; light=${vec(c.light)}; ab=${c.ab}; rs=${c.rs}; }`)
      .join("\n");
    const initRunway = runwayCases
      .map(
        (c, i) =>
          `case ${cases.length + sourceCases.length + i}u: {q=${vec(c.q)}; P.runways[0].x=1.0;P.runways[1]=${vec([...c.r.p, 4500])};P.runways[2]=${vec([...c.r.along, 30])};P.runways[3]=${vec([...c.r.across, 0])};}`,
      )
      .join("\n");
    const count = cases.length + sourceCases.length + runwayCases.length,
      bytes = count * 8 * 4;
    const shader = `
    const PI=3.141592653589793; const EARTH_AB=1.0033640898209764; const EARTH_SURF=4u; const BV=7u;
    const EARTH_MOON=vec3f(0.07,0.085,0.11); const EARTH_RM=6378137.0; const HAS_RWY=true; const RWY_MAX=4u;
    struct Params {earth:vec4f,earth3:vec4f,runways:array<vec4f,17>}; var<private> P:Params;
    struct AirSpec {ab:f32,rm:f32}; var<private> AIR:AirSpec;
    var<private> bodies:array<vec4f,7>;
    fn bodyKind(k:u32)->u32{return u32(bodies[BV*k+1u].z);}
    fn sunThrough(h:f32,mu:f32)->vec3f{return vec3f(1.0);}
    ${helpers}
    @group(0) @binding(0) var<storage,read_write> out:array<f32>;
    @compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id:vec3u){
      if(id.x>=${count}u){return;}
      bodies[1].z=1.0; bodies[2].z=4.0;
      var p:vec3f; var q:vec3f; var ro:vec3f; var light:vec3f; var ab:f32; var rs:f32;
      switch id.x {${init} ${initSource} ${initRunway} default:{return;}}
      let i=id.x*8u;
      if(id.x<${cases.length}u){
        AIR.ab=squashOf(0u); AIR.rm=${A}.0;
        out[i]=AIR.ab; out[i+1u]=airHeight(p); out[i+2u]=airRayScale(vec3f(0,0,1));
        let moon=earthMoonlight(q,q,0.0,-1.0);
        out[i+3u]=moon.r; out[i+4u]=moon.g; out[i+5u]=moon.b;
        out[i+6u]=select(0.0,1.0,hasAir(0u));
        bodies[2].z=5.0; out[i+7u]=squashOf(0u);
      }else if(id.x<${cases.length + sourceCases.length}u){out[i]=figureSunShare(ro,light,rs,ab);}else{out[i]=runwayGrade(q);}
    }`;
    const app = await App.boot({ width: 320, height: 240 });
    try {
      const values = await app.js<number[]>(`(async()=>{
      const device=__bh.renderer.device;device.pushErrorScope("validation");
      const pipeline=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code:${JSON.stringify(shader)}}),entryPoint:"check"}});
      const out=device.createBuffer({size:${bytes},usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=device.createBuffer({size:${bytes},usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      try{
        const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]});
        const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(${count});pass.end();
        enc.copyBufferToBuffer(out,0,read,0,${bytes});device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
        const values=[...new Float32Array(read.getMappedRange())];read.unmap();
        const error=await device.popErrorScope();if(error)throw new Error(error.message);return values;
      }finally{out.destroy();read.destroy();}
    })()`);
      for (let k = 0; k < cases.length; k++) {
        const i = k * 8;
        expect(values[i]).toBeCloseTo(1 / (1 - F), 6);
        expect(Math.abs(values[i + 1]! - cases[k]!.height)).toBeLessThan(1.5); // f32 Earth radii: metre precision
        expect(values[i + 2]).toBeCloseTo(1 - F, 6);
        expect(values.slice(i + 3, i + 6)).toEqual([expect.closeTo(0.07, 6), expect.closeTo(0.085, 6), expect.closeTo(0.11, 6)]);
        expect(values[i + 6]).toBe(1);
        expect(values[i + 7]).toBe(1); // Moon remains a sphere
        if (k % 2) expect(values.slice(i, i + 8)).toEqual(values.slice(i - 8, i));
      }
      for (let k = 0; k < sourceCases.length; k++) expect(values[(cases.length + k) * 8]).toBeCloseTo(sourceCases[k]!.share, 4);
      for (let k = 0; k < runwayCases.length; k++)
        expect(Math.abs(values[(cases.length + sourceCases.length + k) * 8]! - runwayCases[k]!.expected)).toBeLessThan(0.025);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);

test.skipIf(!E2E)(
  "the live polar renderer keeps WGS84 geometry and altitude when Earth textures are unavailable",
  async () => {
    const base = "Earth: total eclipse over Burgos, 12 Aug 2026";
    const app = await App.boot({ hash: `scene=${encodeURIComponent(base)}`, width: 320, height: 240 });
    try {
      await app.js(`(()=>{__bh.freeze(true);__bh.renderer.requestEarthMaps=()=>{};__bh.renderer.releaseEarthMaps();})()`);
      for (const height of [0, 40, 400]) {
        await app.js(
          `(()=>{__bh.presets["WGS84 polar audit"]={...__bh.presets[${JSON.stringify(base)}],animate:false,pose:{body:"earth",at:[90,0],altKm:${height},look:"earth"},earthClouds:0};__bh.preset("WGS84 polar audit");__bh.touch();})()`,
        );
        await app.waitFor(`__bh.renderer.lastNear && new Float32Array(__bh.renderer.params)[58*4]===0`);
        await Bun.sleep(500);
        const state = await app.js<{ physical: number[]; march: number[]; maps: number; gpuErrors: number; volume: number }>(`(()=>{
        const r=__bh.renderer,n=r.lastNear,p=new Float32Array(r.params);
        return {physical:n.axes.map(a=>-a.reduce((v,x,i)=>v+x*n.centre[i],0)),march:[...p.slice(67*4,67*4+3)],maps:p[58*4],gpuErrors:r.gpuErrors,volume:p[61*4+3]};
      })()`);
        expect(state.maps).toBe(0);
        expect(state.gpuErrors).toBe(0);
        expect(state.march[2]! / state.physical[2]!).toBeCloseTo(1 / (1 - F), 5);
        expect(Math.hypot(...state.march)).toBeCloseTo(1 + (height * 1000) / (A * (1 - F)), 5);
        if (height >= 40) expect(state.volume).toBe(0);
      }
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);
