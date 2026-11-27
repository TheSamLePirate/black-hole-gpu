import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Production hullDepthVs + trailVs/trailFs: an instanced airframe must occlude its trail before scene-depth composition.
// Duration: ~30 s. Done when: positive control lights pixels, hidden trail lights none, a foreground edge clips the ribbon.
let app: App;
describe.skipIf(!E2E)("traffic airframes occlude trails", () => {
  beforeAll(async () => {
    app = await App.boot({ entry: "crew", telemetry: false });
  }, 120000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("instanced hull depth masks the whole ribbon, with unpublished scene depth", async () => {
    const source = await Bun.file("src/shaders/ship.wgsl").text();
    const hull = source.slice(
      source.indexOf("@vertex\nfn hullDepthVs"),
      source.indexOf("// the flown craft's own opaque parts alone", source.indexOf("fn hullDepthVs")),
    );
    const prepass = source.slice(source.indexOf("struct DOut {"), source.indexOf("@vertex\nfn vs("));
    const trails = source.slice(
      source.indexOf("struct Seg {"),
      source.indexOf("// ------------------------------------------------------------------------------------ the lamps' glare"),
    );
    const shader = `
      const PI=3.14159265;
      struct U { model:mat4x4f, proj:vec4f, img:vec4f, light:vec4f };
      @group(0) @binding(0) var<uniform> S:U;
      struct I {model:mat4x4f,flags:vec4f};
      @group(0) @binding(12) var<storage,read> inst:array<I>;
      @group(0) @binding(11) var<storage,read> sceneDepth:array<f32>;
      @group(0) @binding(1) var<storage,read> sh:array<vec4f>;
      struct VIn {@location(0) pos:vec3f,@location(2) mat:f32};
      fn shipPos(v:VIn,ii:u32)->vec3f {return v.pos;}
      fn flownPos(v:VIn)->vec3f {return v.pos;}
      fn projectFull(p:vec3f)->vec4f {let n=S.proj.z;let f=S.proj.w;return vec4f(p.x/S.proj.x,p.y/S.proj.y,(p.z-n)*f/(f-n),p.z);}
      fn irradiance(v:vec3f)->vec3f {return vec3f(1.0);}
      fn fromProbe(v:vec3f)->vec3f {return v;}
      fn vnoise(v:vec3f)->f32 {return 0.5;}
      fn shipAir(p:vec3f,c:vec4f)->vec4f {return c;}
      fn project(p:vec3f)->vec4f {return projectFull(p);}
      ${hull}\n${prepass}\n${trails}`;
    const r = await app.js<any>(`(async()=>{
      const adapter=await navigator.gpu.requestAdapter(),d=await adapter.requestDevice(),errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
      const module=d.createShaderModule({code:${JSON.stringify(shader)}});
      const messages=await module.getCompilationInfo();if(messages.messages.some(m=>m.type==='error'))throw Error(messages.messages.map(m=>m.message).join('; '));
      const depthPipe=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'hullDepthVs',buffers:[{arrayStride:16,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:2,offset:12,format:'float32'}]}]},fragment:{module,entryPoint:'hullDepthFs',targets:[{format:'rgba16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
      const cutPipe=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'depthVs',buffers:[{arrayStride:16,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:2,offset:12,format:'float32'}]}]},fragment:{module,entryPoint:'hullDepthFs',targets:[{format:'rgba16float',writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
      const trailPipe=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'trailVs'},fragment:{module,entryPoint:'trailFs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
      const buffer=(a,usage)=>{const b=d.createBuffer({size:a.byteLength,usage:usage|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(b,0,a);return b;};
      const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
      const u=buffer(new Float32Array([...identity,1,1,.1,100,64,64,1,1,1,0,0,0]),GPUBufferUsage.UNIFORM);
      const instances=buffer(new Float32Array([...identity,0,0,0,0,...identity,0,0,0,0]),GPUBufferUsage.STORAGE);
      const seg=buffer(new Float32Array([-4,0,10,1,4,0,10,1,1,1,0,8,3,0,0,0]),GPUBufferUsage.STORAGE);
      const scene=buffer(new Float32Array(4096),GPUBufferUsage.STORAGE);
      const light=new Float32Array(48);light[38]=1;
      const sh=buffer(light,GPUBufferUsage.STORAGE);
      const bind=(p,entries)=>d.createBindGroup({layout:p.getBindGroupLayout(0),entries:entries.map(([binding,b])=>({binding,resource:{buffer:b}}))});
      const db=bind(depthPipe,[[0,u],[12,instances]]),cb=bind(cutPipe,[[0,u],[12,instances]]),tb=bind(trailPipe,[[0,u],[1,sh],[11,scene],[19,seg]]);
      async function draw(mode){
        const t=d.createTexture({size:[64,64],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),z=d.createTexture({size:[64,64],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
        const x=mode==='edge'?0:-5;
        const verts=buffer(new Float32Array([x,-5,5,105,5,-5,5,105,x,5,5,105,x,5,5,105,5,-5,5,105,5,5,5,105]),GPUBufferUsage.VERTEX);
        const enc=d.createCommandEncoder(),p=enc.beginRenderPass({colorAttachments:[{view:t.createView(),clearValue:[0,0,0,0],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:z.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
        if(mode!=='visible'){p.setPipeline(mode==='cutout'?cutPipe:depthPipe);p.setBindGroup(0,mode==='cutout'?cb:db);p.setVertexBuffer(0,verts);p.draw(6,1,0,1);}
        p.setPipeline(trailPipe);p.setBindGroup(0,tb);p.draw(6);p.end();
        const out=d.createBuffer({size:32768,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});enc.copyTextureToBuffer({texture:t},{buffer:out,bytesPerRow:512},[64,64]);d.queue.submit([enc.finish()]);await out.mapAsync(GPUMapMode.READ);const a=new Uint16Array(out.getMappedRange());let lit=0,right=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(a[(y*64+x)*4]){lit++;if(x>=32)right++;}out.unmap();out.destroy();t.destroy();z.destroy();verts.destroy();return {lit,right};
      }
      const visible=await draw('visible'),again=await draw('visible'),hidden=await draw('hidden'),edge=await draw('edge'),cutout=await draw('cutout');await d.queue.onSubmittedWorkDone();d.destroy();return {visible,again,hidden,edge,cutout,errors};
    })()`);
    console.log(JSON.stringify(r));
    expect(r.errors).toEqual([]);
    expect(r.again).toEqual(r.visible);
    expect(r.cutout).toEqual(r.visible);
    expect(r.visible.lit).toBeGreaterThan(0);
    expect(r.hidden.lit).toBe(0);
    expect(r.edge.lit).toBeGreaterThan(0);
    expect(r.edge.right).toBe(0);
  }, 60000);
});
