import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const trace = await Bun.file(new URL("../../src/shaders/trace.wgsl", import.meta.url)).text();
// Run the real shader's footprint helpers on the GPU, rather than copying their arithmetic into TS.
const lodCode = trace.slice(trace.indexOf("var<private> mapLodV:"), trace.indexOf("fn ringOuter("));

afterAll(stopServer);
for (const fallback of [false, true]) {
  test.skipIf(!E2E)(
    `Jupiter close-up loads ${fallback ? "the 4K fallback without a KTX worker" : "native 8K compressed mips"}`,
    async () => {
      const app = await App.boot({
        hash: `scene=${encodeURIComponent("Jupiter: from orbit")}`,
        width: 320,
        height: 240,
        initScript: fallback
          ? `(() => { const Original = Worker; window.Worker = class extends Original {
              constructor(url, options) { if(String(url).includes("ktx-worker")) throw new Error("test: KTX unavailable"); super(url, options); }
            }; })()`
          : undefined,
      });
      try {
        await app.js(`(() => {
          __bh.freeze(true);
          __bh.presets["Jupiter HD test"] = {...__bh.presets["Jupiter: from orbit"], ship:false,
            pose:{tilt:0,body:"jupiter",altKm:20000,phase:30,look:"jupiter"}};
          __bh.preset("Jupiter HD test"); return true;
        })()`);
        await app.waitFor('__bh.renderer.hdMap.name === "jupiter" && !__bh.renderer.hdLoading', 90_000);
        const map = await app.js(`({width:__bh.renderer.hdMap.color.width, height:__bh.renderer.hdMap.color.height,
          format:__bh.renderer.hdMap.color.format, mips:__bh.renderer.hdMap.color.mipLevelCount,
          hasRelief:__bh.renderer.hdMap.hasRelief, errors:__bh.renderer.gpuErrors,
          compressed:__bh.renderer.device.features.has("texture-compression-bc") || __bh.renderer.device.features.has("texture-compression-astc")})`);
        const native = !fallback && map.compressed;
        expect(map.width).toBe(native ? 8192 : 4096);
        expect(map.height).toBe(map.width / 2);
        expect(map.mips).toBe(native ? 14 : 13);
        if (native) expect(["bc7-rgba-unorm-srgb", "astc-4x4-unorm-srgb"]).toContain(map.format);
        expect(map.hasRelief).toBe(false);
        expect(map.errors).toBe(0);
        expect(app.cdp.errors).toEqual([]);
      } finally {
        app.close();
      }
    },
    300_000,
  );
}
test.skipIf(!E2E)(
  "planet HD mip selection preserves 6K close-up detail and distant filtering",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Kerr a=0.94, near edge-on")}`, width: 320, height: 240 });
    try {
      const shader = `const TAU: f32 = 6.283185307179586; const BV: u32 = 4u;
      var<private> bodies: array<vec4f, 4>;
      ${lodCode}
      @group(0) @binding(0) var<storage, read_write> out: array<f32>;
      @compute @workgroup_size(1) fn check(@builtin(global_invocation_id) id: vec3u) {
        let fp = array<f32, 5>(0.125, 0.25, 0.5, 1.0, 4.0)[id.x] * TAU / 2048.0;
        bodies[3].w = 1.0;
        setMapLod(fp, fp, 0u);
        out[id.x * 2u] = hdMapLod(6000.0);
        out[id.x * 2u + 1u] = mapLod();
      }`;
      const result = await app.js<number[]>(`(async () => {
      const device = __bh.renderer.device;
      device.pushErrorScope("validation");
      const module = device.createShaderModule({code:${JSON.stringify(shader)}});
      const pipeline = await device.createComputePipelineAsync({layout:"auto", compute:{module,entryPoint:"check"}});
      const out = device.createBuffer({size:40, usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
      const read = device.createBuffer({size:40, usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      try {
        const bind = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:out}}]});
        const enc = device.createCommandEncoder(); const pass = enc.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.dispatchWorkgroups(5); pass.end();
        enc.copyBufferToBuffer(out,0,read,0,40); device.queue.submit([enc.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const values = [...new Float32Array(read.getMappedRange())]; read.unmap();
        const error = await device.popErrorScope(); if(error) throw new Error(error.message);
        return values;
      } finally {out.destroy(); read.destroy();}
    })()`);
      // Near: mip 0 is reachable; transition: level 0.55; distant: level 3.55.
      expect(result[0]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[4]).toBeCloseTo(Math.log2(6000 / 4096), 5);
      expect(result[6]).toBeCloseTo(Math.log2(6000 / 2048), 5);
      expect(result[8]).toBeCloseTo(Math.log2((4 * 6000) / 2048), 5);
      expect(result.filter((_, i) => i % 2 === 1)).toEqual([0, 0, 0, 0, 2]);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);
