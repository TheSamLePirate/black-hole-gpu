import { TABLE_SUN } from "../../../src/gpu-tables";
import { withSunShadow } from "../../../src/system/terrain-raster-hint";

// Execute the production reader against a real depth texture, with deterministic receivers and table rows.
// The second source is the old reader: a positive control proving the regression assertions see the defect.
const source = withSunShadow(
  `@group(0) @binding(0) var<storage, read> bodies: array<vec4f>;
   @group(0) @binding(1) var<storage, read> receiver: array<vec4f>;
   @group(0) @binding(2) var<storage, read_write> result: array<vec4f>;
   var<private> SUN_N: vec3f = vec3f(0.0);
   // BEGIN_SUN_SHADOW
   // END_SUN_SHADOW
   @compute @workgroup_size(1) fn main() { result[0] = sunShadowFarAt(receiver[0].xyz, receiver[0].w); }`,
  true,
);
const legacy = source.replace("if (abs(along) >= L.w) { continue; }", "").replace(" && abs(along1) < L.w", "");

export const shadowDepthCases = [
  { name: "earth-empty", rel: [0, 0, 0, 0], depth: 1, expected: 1 },
  { name: "earth-far", rel: [0, 0, -150, 0], depth: 1, expected: -1 },
  { name: "earth-near", rel: [0, 0, 150, 0], depth: 0, expected: -1 },
  { name: "far-plane", rel: [0, 0, -100, 0], depth: 1, expected: -1 },
  { name: "near-plane", rel: [0, 0, 100, 0], depth: 0, expected: -1 },
  { name: "earth-blocker", rel: [0, 0, -50, 0], depth: 0.1, expected: 0 },
  { name: "next-cascade", rel: [0, 0, -50, 0], depth: 0.1, offset0: 300, expected: 0 },
  { name: "invalid-blend", rel: [9, 0, 0, 0], depth: 0.8, offset1: -200, expected: 1 },
  { name: "valid-blend", rel: [9, 0, -50, 0], depth: 0.1, offset1: 100, expected: 0.5 },
  { name: "moon-empty", rel: [0, 0, 0, 32], depth: 1, moon: true, expected: 1 },
  { name: "moon-far", rel: [0, 0, -150, 32], depth: 1, moon: true, expected: -1 },
  { name: "moon-near", rel: [0, 0, 150, 32], depth: 0, moon: true, expected: -1 },
  { name: "moon-blocker", rel: [0, 0, -50, 32], depth: 0.1, moon: true, expected: 0 },
];

export const shadowDepthProbeJs = `(async () => {
  const dev = __bh.renderer.device;
  dev.pushErrorScope('validation');
  const buffers = [], textures = [];
  const buffer = (size, usage) => { const b=dev.createBuffer({size,usage}); buffers.push(b); return b; };
  try {
    const table = buffer((${TABLE_SUN}+8)*16, GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const input = buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const output = buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
    const read = buffer(16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    const tex = dev.createTexture({size:[8,4],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    textures.push(tex);
    const rows = new Float32Array([1,0,0,10, 0,1,0,10, 0,0,1,100, 1,0,100,0, 0,1,0,0, 0,0,0,0, 0,0,10,0, 0,0,100,0]);
    const cases = ${JSON.stringify(shadowDepthCases)};
    const results = {};
    for (const [tag, code] of ${JSON.stringify([
      ["fixed", source],
      ["repeat", source],
      ["legacy", legacy],
    ])}) {
      const module=dev.createShaderModule({code});
      const pipe=await dev.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
      const bg=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:table}},{binding:1,resource:{buffer:input}},
        {binding:2,resource:{buffer:output}},{binding:37,resource:tex.createView()}]});
      results[tag]=[];
      for(const c of cases){
        rows[27]=c.offset0??0; rows[30]=c.moon?0:100; rows[31]=c.offset1??0;
        dev.queue.writeBuffer(table,${TABLE_SUN}*16,rows);
        dev.queue.writeBuffer(input,0,new Float32Array(c.rel));
        const enc=dev.createCommandEncoder();
        enc.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:tex.createView(),depthClearValue:c.depth,depthLoadOp:'clear',depthStoreOp:'store'}}).end();
        const pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,bg);pass.dispatchWorkgroups(1);pass.end();
        enc.copyBufferToBuffer(output,0,read,0,16);dev.queue.submit([enc.finish()]);
        await read.mapAsync(GPUMapMode.READ);const value=Array.from(new Float32Array(read.getMappedRange()));read.unmap();
        results[tag].push({name:c.name,value});
      }
    }
    return results;
  } finally {
    for(const b of buffers)b.destroy();for(const t of textures)t.destroy();
    const error=await dev.popErrorScope();if(error)throw new Error(error.message);
  }
})()`;
