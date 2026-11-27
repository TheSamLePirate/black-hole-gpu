import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Production traffic lamp renderer on the real WebGPU adapter: visible source, source behind an opaque depth plane,
// and a halo crossing a foreground edge. No network traffic required.
// Duration: ~1 min (browser boot, shader and three 64px renders).
// Done when: the visible control lights pixels, a hidden source lights none, the foreground clips every halo pixel.
let app: App;
describe.skipIf(!E2E)("traffic lamps respect the aircraft/scene depth", () => {
  beforeAll(async () => {
    app = await App.boot({ entry: "crew", telemetry: false });
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("centre occlusion suppresses the entire halo; visible sources retain a clipped halo", async () => {
    const build = await Bun.build({
      entrypoints: ["src/traffic/light-renderer.ts"],
      target: "browser",
      format: "esm",
      loader: { ".wgsl": "text" },
    });
    expect(build.success).toBe(true);
    const code = await build.outputs[0]!.text();
    const result = await app.js<any>(`(async()=>{
      const {TrafficLightRenderer}=await import(URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:"text/javascript"})));
      const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error("no GPU adapter");const device=await adapter.requestDevice();
      const errors=[];device.addEventListener("uncapturederror",e=>errors.push(e.error.message));
      const renderer=new TrafficLightRenderer(device),W=64,H=64;
      async function render(mode){
        const texture=device.createTexture({size:[W,H],mipLevelCount:3,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
        const depths=new Float32Array(W*H).fill(1000);
        for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mode==="hidden"||(mode==="edge"&&x>=34))depths[y*W+x]=5;
        const depth=device.createBuffer({size:depths.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(depth,0,depths);
        const enc=device.createCommandEncoder();const clear=enc.beginRenderPass({colorAttachments:[{view:texture.createView({baseMipLevel:0,mipLevelCount:1}),loadOp:"clear",storeOp:"store",clearValue:[0,0,0,0]}]});clear.end();
        renderer.encode(enc,texture,depth,[{at:[0,0,10],colour:[3,0,0],size:1}],60,1,1);
        const buffer=device.createBuffer({size:W*H*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        enc.copyTextureToBuffer({texture},{buffer,bytesPerRow:W*8},[W,H]);device.queue.submit([enc.finish()]);await buffer.mapAsync(GPUMapMode.READ);
        const data=new Uint16Array(buffer.getMappedRange().slice(0));buffer.unmap();
        let lit=0,right=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(data[(y*W+x)*4]>0){lit++;if(x>=34)right++;}
        buffer.destroy();texture.destroy();depth.destroy();return {lit,right};
      }
      const visible=await render("visible"),hidden=await render("hidden"),edge=await render("edge");await device.queue.onSubmittedWorkDone();device.destroy();return {visible,hidden,edge,errors};
    })()`);
    console.log(JSON.stringify(result));
    expect(result.errors).toEqual([]);
    expect(result.visible.lit).toBeGreaterThan(0);
    expect(result.hidden.lit).toBe(0);
    expect(result.edge.lit).toBeGreaterThan(0);
    expect(result.edge.right).toBe(0);
  }, 60_000);
});
