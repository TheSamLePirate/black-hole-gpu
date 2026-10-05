import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { addEphemeris } from "../../src/system/de440";
import { bodyAxes, diskShare, EPOCH_DATE, M_SECONDS, seenFrom, solarBody, solarState } from "../../src/system/solar";
import { bodyFixedOf, fromBodyFixed } from "../../src/system/our-surface";
import { WGS84_F } from "../../src/system/ellipsoid";
import type { Vec3 } from "../../src/math/vec3";

const trace = await Bun.file(new URL("../../src/shaders/trace.wgsl", import.meta.url)).text();
const helpers = trace.slice(trace.indexOf("fn eclipsePhysical("), trace.indexOf("// The air along ro + t rd"));
afterAll(stopServer);

test.skipIf(!E2E)(
  "Burgos atmospheric eclipse uses physical axes through WGS84 and spherical march spaces",
  async () => {
    addEphemeris(await Bun.file(new URL("../../assets/ephemeris/de440.bin", import.meta.url)).arrayBuffer());
    const cases: { p: number[]; ls: number[]; eclipse: number[]; rs: number; ab: number; expected: number }[] = [];
    const R = solarBody("earth")!.radius;
    const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));
    const cross = (a: number[], b: number[]) => [
      a[1]! * b[2]! - a[2]! * b[1]!,
      a[2]! * b[0]! - a[0]! * b[2]!,
      a[0]! * b[1]! - a[1]! * b[0]!,
    ];
    for (const time of ["2026-08-12T18:27:00Z", "2026-08-12T18:29:01Z", "2026-08-12T16:00:00Z"]) {
      const t = (Date.parse(time) - EPOCH_DATE) / 1000 / M_SECONDS;
      const obs = fromBodyFixed("earth", bodyFixedOf("earth", 42.34, -3.7, 900), t);
      const E = solarState("earth", t).pos;
      const axes = bodyAxes(solarBody("earth")!, t);
      const local = (v: Vec3) => axes.map((a) => a.reduce((sum, x, i) => sum + x * (v[i]! - E[i]!), 0) / R);
      const p = local(obs),
        moon = local(seenFrom("moon", t, obs).pos),
        sun = local(seenFrom("sun", t, obs).pos);
      const ls = unit(sun),
        m = moon.map((x, i) => x - p[i]!);
      const rs = Math.asin(solarBody("sun")!.radius / (Math.hypot(...sun) * R));
      const rm = Math.asin(solarBody("moon")!.radius / (Math.hypot(...m) * R));
      const expected = diskShare(rs, rm, Math.asin(Math.min(Math.hypot(...cross(unit(m), ls)), 1)));
      for (const ab of [1 / (1 - WGS84_F), 1]) {
        cases.push({
          p: [p[0]!, p[1]!, p[2]! * ab],
          ls: unit([ls[0]!, ls[1]!, ls[2]! * ab]),
          eclipse: [...moon, solarBody("moon")!.radius / R],
          rs,
          ab,
          expected,
        });
      }
    }
    // No eclipse metadata must leave the atmosphere fully illuminated in either march space.
    for (const c of cases.slice(2, 4)) cases.push({ ...c, eclipse: [0, 0, 0, 0], expected: 1 });
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Kerr a=0.94, near edge-on")}`, width: 320, height: 240 });
    try {
      const vec = (v: number[]) => `vec${v.length}f(${v.map((x) => `${x}`).join(",")})`;
      const init = cases
        .map((c, i) => `case ${i}u: { p=${vec(c.p)}; ls=${vec(c.ls)}; P.eclipse=${vec(c.eclipse)}; P.earth4.y=${c.rs}; AIR.ab=${c.ab}; }`)
        .join("\n");
      const shader = `const PI: f32 = 3.141592653589793; const EARTH_RM: f32 = 6378137.0;
      struct Params { eclipse: vec4f, earth4: vec4f }; var<private> P: Params;
      struct AirSpec { ab: f32 }; var<private> AIR: AirSpec;
      ${helpers}
      @group(0) @binding(0) var<storage,read_write> out: array<f32>;
      @compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) {
        var p: vec3f; var ls: vec3f;
        switch id.x { ${init} default: {return;} }
        out[id.x*2u]=sunSeen(p,ls); out[id.x*2u+1u]=skySeen(p,ls);
      }`;
      const bytes = cases.length * 8;
      const values = await app.js<number[]>(`(async () => {
      const device=__bh.renderer.device; device.pushErrorScope("validation");
      const module=device.createShaderModule({code:${JSON.stringify(shader)}});
      const pipeline=await device.createComputePipelineAsync({layout:"auto",compute:{module,entryPoint:"check"}});
      const out=device.createBuffer({size:${bytes},usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read=device.createBuffer({size:${bytes},usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      try {
        const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]});
        const enc=device.createCommandEncoder(),pass=enc.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.dispatchWorkgroups(${cases.length}); pass.end();
        enc.copyBufferToBuffer(out,0,read,0,${bytes});device.queue.submit([enc.finish()]);
        await read.mapAsync(GPUMapMode.READ); const values=[...new Float32Array(read.getMappedRange())];read.unmap();
        const error=await device.popErrorScope();if(error)throw new Error(error.message);return values;
      } finally {out.destroy();read.destroy();}
    })()`);
      for (let i = 0; i < cases.length; i++) expect(values[2 * i]).toBeCloseTo(cases[i]!.expected, 5);
      expect(values[4]).toBe(0); // actual totality at Burgos, formerly ~9.4% sunlight
      expect(values[5]).toBeLessThan(0.1); // the sky's scattered light still includes the lit horizon
      for (let i = 0; i < cases.length; i += 2) expect(values[2 * i + 1]).toBeCloseTo(values[2 * (i + 1) + 1]!, 5);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);
