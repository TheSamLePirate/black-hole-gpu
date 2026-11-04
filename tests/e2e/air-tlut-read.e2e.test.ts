import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Q5 C1 — the transmittance table read on the GPU (trace.wgsl tlutTau, sliced, on the renderer's own table once published)
// against its CPU twin (system/earth-air.ts lutThrough), six heights and directions from the ground to 200 km: the same
// numbers — and the multiple scattering's Ψ_ms (msLut / msThrough). (Its first run found the header's top radius read from z — the grid's height, 64 — instead of w: the sky orange.)
// Duration: ~1 min. Done when: the six read and compared, to 1e-4.
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5 C1: the GPU reads the transmittance table as the CPU does",
  async () => {
    const trace = await Bun.file(new URL("../../src/shaders/trace.wgsl", import.meta.url)).text();
    const fnSrc = trace.slice(trace.indexOf("const TLUT_OFF"), trace.indexOf("// The solid ground's shadow"));
    const { lutThrough, msThrough, transmittanceLut } = await import("../../src/system/earth-air");
    const f = transmittanceLut();
    const cases = [
      [0, 0.0698],
      [1500, 0.0698],
      [5000, 0.1736],
      [20000, 0.0698],
      [60000, 0.5],
      [200000, 0.02],
    ];
    const app = await App.boot({ width: 320, height: 240, hash: "scene=game:artemis", tiles: true });
    try {
      await app.waitFor(`__bh.renderer.tlutPublished`, 60_000);
      const shader = `struct AirSpec { rm: f32 }; var<private> AIR: AirSpec;
      @group(0) @binding(0) var<storage, read> bodies: array<vec4f>;
      @group(0) @binding(1) var<storage, read_write> out: array<vec4f>;
      ${fnSrc}
      @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) {
        AIR.rm = 6378137.0;
        var c = array<vec2f, ${cases.length}>(${cases.map(([h, m]) => `vec2f(${h}.0, ${m})`).join(",")});
        let v = c[id.x]; out[2u * id.x] = vec4f(exp(-tlutTau(v.x, v.y)), bodies[TLUT_OFF].w);
        out[2u * id.x + 1u] = vec4f(msLut(v.x, v.y), 0.0);
      }`;
      const vals = await app.js<number[]>(`(async () => { const r = __bh.renderer, device = r.device;
      const module = device.createShaderModule({ code: ${JSON.stringify(shader)} });
      const errs = (await module.getCompilationInfo()).messages.filter((m) => m.type === "error"); if (errs.length) throw new Error(errs.map((m) => m.lineNum + ": " + m.message).join(" | "));
      const p = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      const out = device.createBuffer({ size: ${cases.length * 32}, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const rd = device.createBuffer({ size: ${cases.length * 32}, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: r.bodyBuf } }, { binding: 1, resource: { buffer: out } }] });
      const enc = device.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(p); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(${cases.length}); pass.end();
      enc.copyBufferToBuffer(out, 0, rd, 0, ${cases.length * 32}); device.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ); const v = [...new Float32Array(rd.getMappedRange())]; rd.unmap(); return v; })()`);
      cases.forEach(([h, m], i) => {
        const cpu = lutThrough(f, h!, m!);
        for (let c = 0; c < 3; c++) expect(vals[8 * i + c]!).toBeCloseTo(cpu[c]!, 4);
        // (the multiple scattering's Ψ_ms: within 0.1 % of the CPU's read)
        const ms = msThrough(f, h!, m!);
        for (let c = 0; c < 3; c++) expect(Math.abs(vals[8 * i + 4 + c]! / ms[c]! - 1)).toBeLessThan(1e-3);
      });
      cases.forEach(([h, m], i) =>
        console.log(
          `  h ${h} mu ${m}: GPU ${vals
            .slice(8 * i, 8 * i + 3)
            .map((x) => x.toFixed(4))
            .join(
              ",",
            )} (rt ${vals[8 * i + 3]!.toFixed(5)}) Ψ ${vals[8 * i + 5]!.toExponential(3)} / ${msThrough(f, h!, m!)[1]!.toExponential(3)}  CPU ${lutThrough(
            f,
            h!,
            m!,
          )
            .map((x) => x.toFixed(4))
            .join(",")}`,
        ),
      );
    } finally {
      await app.close();
    }
  },
  180_000,
);
