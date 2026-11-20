// J9 source-geometry inspection, outside the game's frame. No production renderer or new automation API.
import { TREE_LEAF_WGSL } from "../../../src/vegetation/tree-leaf";
import type { TreeMesh } from "../../../src/vegetation/tree-model";

const SHADER = /* wgsl */ `
struct U { right:vec4f, up:vec4f, toward:vec4f, centre:vec4f, leaf:vec4f };
@group(0) @binding(0) var<uniform> u:U;
struct V { @builtin(position) clip:vec4f, @location(0) n:vec3f, @location(1) a:vec4f };
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) a:vec4f)->V {
  let q=p-u.centre.xyz;
  var v:V; v.clip=vec4f(dot(q,u.right.xyz)/u.centre.w,dot(q,u.up.xyz)/u.centre.w,.5-dot(q,u.toward.xyz)*.25,1.0);
  v.n=n;v.a=a;return v;
}
${TREE_LEAF_WGSL}
@fragment fn fs(v:V,@builtin(front_facing) front:bool)->@location(0) vec4f {
  let leaf=v.a.z>.5;
  if(leaf && (u.leaf.y<.5 || !leafMask(v.a.xy,u.leaf.x))){discard;}
  var n=normalize(v.n);if(!leaf && !front){n=-n;}
  let L=normalize(vec3f(.55,-.45,.7));
  let base=select(vec3f(.22,.15,.10),vec3f(.09,.20,.05),leaf);
  let lit=base*(.25+.95*max(dot(n,L),0.0))*v.a.w*2.2;
  return vec4f(pow(lit,vec3f(1.0/2.2)),1.0);
}`;

/** Executes in the existing page. Returns a 3-view source-geometry board as PNG; releases every temporary GPU resource. */
export function treePreviewExpression(mesh: TreeMesh, kind: number, leaves = true): string {
  return `(async () => {
    const d=__bh.renderer.device;
    const pos=new Float32Array(${JSON.stringify([...mesh.pos])});
    const nrm=new Float32Array(${JSON.stringify([...mesh.nrm])});
    const attr=new Float32Array(${JSON.stringify([...mesh.attr])});
    const indices=new Uint32Array(${JSON.stringify([...mesh.index])});
    const resources=[];
    const upload=(a,usage)=>{const b=d.createBuffer({size:a.byteLength,usage:usage|GPUBufferUsage.COPY_DST});
      resources.push(b);d.queue.writeBuffer(b,0,a);return b;};
    let tex,depth,read;
    try {
      const module=d.createShaderModule({code:${JSON.stringify(SHADER)},label:"J9 model inspection"});
      const pipe=await d.createRenderPipelineAsync({layout:"auto",vertex:{module,entryPoint:"vs",buffers:[
        {arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},
        {arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:"float32x3"}]},
        {arrayStride:16,attributes:[{shaderLocation:2,offset:0,format:"float32x4"}]}]},
        fragment:{module,entryPoint:"fs",targets:[{format:"rgba8unorm"}]},primitive:{cullMode:"none"},
        depthStencil:{format:"depth24plus",depthWriteEnabled:true,depthCompare:"less"}});
      const vp=upload(pos,GPUBufferUsage.VERTEX),vn=upload(nrm,GPUBufferUsage.VERTEX),va=upload(attr,GPUBufferUsage.VERTEX),ib=upload(indices,GPUBufferUsage.INDEX);
      const side=512,width=side*3;
      tex=d.createTexture({size:[width,side],format:"rgba8unorm",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      depth=d.createTexture({size:[width,side],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});
      const dirs=[[.3,-1,.1],[.3,-1,-.65],[.5,-.7,1.2]];
      const norm=a=>{const n=Math.hypot(...a);return a.map(x=>x/n);};
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const enc=d.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{view:tex.createView(),loadOp:"clear",storeOp:"store",clearValue:[.025,.035,.05,1]}],
        depthStencilAttachment:{view:depth.createView(),depthLoadOp:"clear",depthStoreOp:"discard",depthClearValue:1}});
      pass.setPipeline(pipe);pass.setVertexBuffer(0,vp);pass.setVertexBuffer(1,vn);pass.setVertexBuffer(2,va);pass.setIndexBuffer(ib,"uint32");
      for(let i=0;i<dirs.length;i++){
        const toward=norm(dirs[i]),right=norm(cross([0,0,1],toward)),up=cross(toward,right);
        const half=Math.max(.6,${mesh.radius}*1.15);
        const uni=upload(new Float32Array([...right,0,...up,0,...toward,0,0,0,.5,half,${kind},${leaves ? 1 : 0},0,0]),GPUBufferUsage.UNIFORM);
        pass.setBindGroup(0,d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uni}}]}));
        pass.setViewport(i*side,0,side,side,0,1);pass.setScissorRect(i*side,0,side,side);pass.drawIndexed(indices.length);
      }
      pass.end();
      read=d.createBuffer({size:width*side*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      enc.copyTextureToBuffer({texture:tex},{buffer:read,bytesPerRow:width*4},[width,side]);
      d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);
      const bytes=new Uint8ClampedArray(read.getMappedRange().slice(0));read.unmap();
      const canvas=document.createElement("canvas");canvas.width=width;canvas.height=side;
      canvas.getContext("2d").putImageData(new ImageData(bytes,width,side),0,0);return canvas.toDataURL("image/png");
    } finally { for(const b of resources)b.destroy();tex?.destroy();depth?.destroy();read?.destroy(); }
  })()`;
}
