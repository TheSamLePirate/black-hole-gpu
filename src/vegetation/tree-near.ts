// J9-2/J9-3/J9-4: shared source triangles (12 models × 2 LODs), GPU-selected instances with projected-error LOD and hysteresis.
import url from "./tree-asset-url";
import { decodeTreeAssets, TREE_VERTEX_FLOATS } from "./tree-assets";
import { TREE_ASPECTS, TREE_MODEL_KINDS } from "./tree-model";
import { TREE_LEAF_WGSL } from "./tree-leaf";
import { inflated } from "../util/inflate";
import { TERRAIN_RASTER_FORMAT, TERRAIN_RASTER_ID_FORMAT, TERRAIN_RASTER_MOTION_FORMAT } from "../system/terrain-raster";
export const NEAR_TREE_CAP = 4096;
export const NEAR_TREE_MODELS = 12;
export const NEAR_TREE_LODS = 2;
export const NEAR_TREE_DRAWS = NEAR_TREE_MODELS * NEAR_TREE_LODS;
export const NEAR_TREE_SHADOW_DRAWS = NEAR_TREE_MODELS;
export const NEAR_TREE_SLOTS = NEAR_TREE_DRAWS + NEAR_TREE_SHADOW_DRAWS;
const aspects = TREE_MODEL_KINDS.flatMap((k) => TREE_ASPECTS[k]!);
export const NEAR_TREE_WGSL = /* wgsl */ `
struct NearDraw { count:u32, instances:atomic<u32>, first:u32, vertex:i32, base:u32 };
struct NearDraws { items:array<NearDraw,${NEAR_TREE_SLOTS}>, overflow:atomic<u32>, pad0:u32, pad1:u32, pad2:u32, anchor:vec4f };
@group(1) @binding(27) var<uniform> nearU:vec4f;
@group(1) @binding(28) var<storage,read_write> nearDraws:NearDraws;
@group(1) @binding(29) var<storage,read_write> nearOut:array<u32>;
@group(1) @binding(30) var<storage,read> nearIn:array<u32>;
const NEAR_ASPECT=array<f32,12>(${aspects.map((a) => a.toFixed(3)).join(",")});
fn nearShadowKeep(k:u32,t:Tree,hd:ForestHead)->bool {
  if(nearU.x<.5){return false;}
  let id=k+1u;
  if((nearU.w>0.0 && id==u32(nearU.w)) || (nearU.w<0.0 && id!=u32(-nearU.w))){return true;}
  let dNow=length(t.foot-sc.cam.xyz);
  if(dNow>nearU.y*1.05){return false;}
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));
  let b=(t.kind-1u)*2u;let ratio=r/t.height;
  let model=b+select(0u,1u,abs(log(ratio/NEAR_ASPECT[b+1u]))<abs(log(ratio/NEAR_ASPECT[b])));
  let slot=${NEAR_TREE_DRAWS}u+model;
  let at=atomicAdd(&nearDraws.items[slot].instances,1u);
  if(at>=u32(nearU.z)){atomicAdd(&nearDraws.overflow,1u);return false;}
  nearOut[slot*${NEAR_TREE_CAP}u+at]=k;return true;
}
fn nearKeep(k:u32,t:Tree,hd:ForestHead)->bool {
  if(nearU.x<.5){return false;}
  let dNow=length(t.foot-sc.cam.xyz);
  let anch=select(sc.cam.xyz,nearDraws.anchor.xyz,nearDraws.anchor.w>.5);
  let dPrev=length(t.foot-anch);
  let hyst=1.0+clamp((dNow-dPrev)*.08,-0.05,0.05);
  let jit=1.0+0.08*(t.seed-0.5);
  let lim=nearU.y*hyst*jit;
  if(dNow>lim){return false;}
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));
  let b=(t.kind-1u)*2u;let ratio=r/t.height;
  let model=b+select(0u,1u,abs(log(ratio/NEAR_ASPECT[b+1u]))<abs(log(ratio/NEAR_ASPECT[b])));
  let pxPerM=(0.5*u.image.y)/(max(dNow,1.0)*max(u.up.w,0.1));
  let errPx=0.025*max(t.height,2.0*r)*pxPerM*hyst*jit;
  let lod=select(0u,1u,dNow>0.52*lim || errPx<3.2);
  let draw=model+lod*12u;
  let at=atomicAdd(&nearDraws.items[draw].instances,1u);
  if(at>=u32(nearU.z)){atomicAdd(&nearDraws.overflow,1u);return false;}
  nearOut[draw*${NEAR_TREE_CAP}u+at]=k;return true;
}
${TREE_LEAF_WGSL}
override NEAR_MODEL:u32=0u;
struct NearV { @builtin(position) clip:vec4f,@location(0) p:vec3f,@location(1) n:vec3f,@location(2) a:vec4f,
  @location(3) @interpolate(flat) id:u32,@location(4) @interpolate(flat) kind:u32,
  @location(5) @interpolate(flat) bare:f32,@location(6) mot:vec3f };
@vertex fn nearTreeVs(@location(0) pos:vec3f,@location(1) nrm:vec3f,@location(2) attr:vec4f,@builtin(instance_index) instance:u32)->NearV {
  let k=nearIn[NEAR_MODEL*${NEAR_TREE_CAP}u+instance];let hd=forestHead(u32(forestData(2u).x));let t=treeOf(k,hd);
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));let sx=.8*r/NEAR_ASPECT[NEAR_MODEL%12u];
  let ang=6.2831853*t.seed;let ca=cos(ang);let sa=sin(ang);
  let dz=select(0.0,(attr.y-.5)*.055-(attr.x-.5)*.025,t.cone && attr.z>.5);
  let hz=select(1.0,.86,t.kind==5u)*t.height;
  let pr=vec3f(pos.x*ca-pos.y*sa,pos.x*sa+pos.y*ca,pos.z+dz);
  let nr=vec3f(nrm.x*ca-nrm.y*sa,nrm.x*sa+nrm.y*ca,nrm.z);
  let base=t.foot+pr*vec3f(sx,sx,hz);
  let weight=clamp(pos.z*pos.z,0.0,1.0);
  let sw=forestSway(t.foot,t.height,t.seed)*weight;
  let p=base+vec3f(sw,0.0);let v=view(p);
  var o:NearV;o.clip=vec4f(v.x/u.right.w+u.output.z*v.z,v.y/u.up.w+u.output.w*v.z,u.forward.w,v.z);
  let nCard=normalize(nr/vec3f(sx,sx,hz));
  let q=base-t.c;
  let uCr=q/max(t.r,vec3f(0.1));
  let nCone=normalize(vec3f(q.xy,(t.r.x/max(t.r.y,0.1))*length(q.xy)+1e-4));
  let nEll=normalize(vec3f(uCr.xy,uCr.z*0.75+0.1));
  let nCrown=select(nEll,nCone,t.cone);
  let nOut=normalize(nCard-nCrown*min(0.0,dot(nCard,nCrown))+nCrown*1e-4);
  let crDepth=select(clamp(length(uCr),0.45,1.0),0.75+0.25*clamp(pos.z,0.0,1.0),t.cone);
  o.p=v;o.n=select(nCard,normalize(mix(nCrown,nOut,0.28)),attr.z>.5);
  o.a=vec4f(attr.xyz,attr.w*select(1.0,crDepth*(0.82+0.18*attr.y),attr.z>.5));
  o.id=k+1u;o.kind=t.kind;
  o.bare=forestData(hd.F+10u+4u*t.kind).w*forestData(hd.F+7u).z;o.mot=vec3f(0.0);
  if(any(sw!=vec2f(0.0)) && sc.pf.w>.5 && v.z>.1){let old=base+vec3f(forestSwayAt(t.foot,t.height,t.seed,forestWind(),sc.pcam.xyz,sc.pcam.w)*weight,0.0);
    let vp=viewPrev(old);if(vp.z>.1){o.mot=vec3f((v.xy/(vec2f(u.right.w,u.up.w)*v.z)-vp.xy/(vec2f(sc.pr.w,sc.pu.w)*vp.z))*.5*vec2f(u.image.x,-u.image.y),1.0);}}
  return o;
}
@fragment fn nearTreeFs(v:NearV,@builtin(front_facing) front:bool)->MO {
  // Diagnostic isolation after selection: never put a hidden tree back into the proxy lists.
  if((nearU.w>0.0 && v.id==u32(nearU.w)) || (nearU.w<0.0 && v.id!=u32(-nearU.w))){discard;}
  let leaf=v.a.z>.5;if(leaf && (v.bare>.5 || !leafMask(v.a.xy,f32(v.kind)))){discard;}
  var n=normalize(v.n);if(!leaf && !front){n=-n;}
  var o:MO;o.vis=vec4f(0.0,f32(v.id),length(v.p),f32(nearTreePack(n,leaf,v.a.w)));
  o.mot=vec4f(v.mot,0.0);o.id=surfaceId(f32(v.id));return o;
}
struct NearShadowV { @builtin(position) clip:vec4f,@location(0) a:vec3f,@location(1) @interpolate(flat) id:u32,
  @location(2) @interpolate(flat) kind:u32,@location(3) @interpolate(flat) bare:f32 };
@vertex fn nearTreeShadowVs(@location(0) pos:vec3f,@location(1) nrm:vec3f,@location(2) attr:vec4f,@builtin(instance_index) instance:u32)->NearShadowV {
  let k=nearIn[NEAR_MODEL*${NEAR_TREE_CAP}u+instance];let hd=forestHead(u32(forestData(2u).x));let t=treeOf(k,hd);
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));let sx=.8*r/NEAR_ASPECT[NEAR_MODEL%12u];
  let ang=6.2831853*t.seed;let ca=cos(ang);let sa=sin(ang);
  let dz=select(0.0,(attr.y-.5)*.055-(attr.x-.5)*.025,t.cone && attr.z>.5);
  let hz=select(1.0,.86,t.kind==5u)*t.height;
  let pr=vec3f(pos.x*ca-pos.y*sa,pos.x*sa+pos.y*ca,pos.z+dz);
  let nr=vec3f(nrm.x*ca-nrm.y*sa,nrm.x*sa+nrm.y*ca,nrm.z);
  let bare=forestData(hd.F+10u+4u*t.kind).w*forestData(hd.F+7u).z;
  let pad=select(0.0,0.12,attr.z<.5 && pos.z<.35);
  let base=t.foot+pr*vec3f(sx,sx,hz)+nr*pad;
  var o:NearShadowV;o.clip=sunClip(base);o.a=attr.xyz;o.id=k+1u;o.kind=t.kind;
  o.bare=bare;return o;
}
@fragment fn nearTreeShadowFs(v:NearShadowV) {
  if((nearU.w>0.0 && v.id==u32(nearU.w)) || (nearU.w<0.0 && v.id!=u32(-nearU.w))){discard;}
  if(v.a.z>.5 && (v.bare>.5 || !leafMask(v.a.xy,f32(v.kind)))){discard;}
}
`;
export class NearTreeGeometry {
  on = false;
  reachM = 80;
  /** A lower capacity is only a witness for the overflow/fallback contract. */
  capacity = NEAR_TREE_CAP;
  /** Surface witness only: >0 hides this local tree id; <0 draws only its opposite. Zero draws all. */
  debugTreeId = 0;
  ready = false;
  error: string | null = null;
  private loading: Promise<void> | null = null;
  readonly cullLayout: GPUBindGroupLayout;
  readonly drawLayout: GPUBindGroupLayout;
  readonly cullBind: GPUBindGroup;
  readonly drawBind: GPUBindGroup;
  private u: GPUBuffer;
  private lists: GPUBuffer;
  private draws: GPUBuffer;
  private reset = new Uint32Array(NEAR_TREE_SLOTS * 5 + 1);
  private vBuf: GPUBuffer | null = null;
  private iBuf: GPUBuffer | null = null;
  private pipes: GPURenderPipeline[] = [];
  private shadowPipes: GPURenderPipeline[] = [];
  private disposed = false;
  private params = new Float32Array(4);
  constructor(
    private d: GPUDevice,
    private module: GPUShaderModule,
    private mainLayout: GPUBindGroupLayout,
  ) {
    this.u = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lists = d.createBuffer({ size: NEAR_TREE_CAP * NEAR_TREE_SLOTS * 4, usage: GPUBufferUsage.STORAGE });
    this.draws = d.createBuffer({
      size: this.reset.byteLength + 28,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const C = GPUShaderStage.COMPUTE,
      V = GPUShaderStage.VERTEX;
    this.cullLayout = d.createBindGroupLayout({
      entries: [
        { binding: 27, visibility: C, buffer: { type: "uniform" } },
        { binding: 28, visibility: C, buffer: { type: "storage" } },
        { binding: 29, visibility: C, buffer: { type: "storage" } },
      ],
    });
    this.drawLayout = d.createBindGroupLayout({
      entries: [
        { binding: 27, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 30, visibility: V, buffer: { type: "read-only-storage" } },
      ],
    });
    this.cullBind = d.createBindGroup({
      layout: this.cullLayout,
      entries: [
        { binding: 27, resource: { buffer: this.u } },
        { binding: 28, resource: { buffer: this.draws } },
        { binding: 29, resource: { buffer: this.lists } },
      ],
    });
    this.drawBind = d.createBindGroup({
      layout: this.drawLayout,
      entries: [
        { binding: 27, resource: { buffer: this.u } },
        { binding: 30, resource: { buffer: this.lists } },
      ],
    });
  }
  private async load() {
    const response = await fetch(url);
    if (!response.ok) throw Error(`tree geometry: ${response.status}`);
    const models = decodeTreeAssets(await inflated(response));
    if (this.disposed) return;
    if (
      models.length !== NEAR_TREE_DRAWS ||
      models.some(
        (m, i) =>
          m.lod !== Math.floor(i / NEAR_TREE_MODELS) ||
          m.kind !== Math.floor((i % NEAR_TREE_MODELS) / 2) + 1 ||
          Math.abs(m.aspect - aspects[i % NEAR_TREE_MODELS]!) > 1e-6,
      )
    )
      throw Error("Unexpected tree models");
    const layout = this.d.createPipelineLayout({ bindGroupLayouts: [this.mainLayout, this.drawLayout] });
    const totalVFloats = models.reduce((s, m) => s + m.vertices.length, 0);
    const totalIndices = models.reduce((s, m) => s + m.indices.length, 0);
    const allV = new Float32Array(totalVFloats);
    const allI = new Uint32Array(totalIndices);
    let vOff = 0,
      iOff = 0;
    for (const [index, m] of models.entries()) {
      allV.set(m.vertices, vOff * TREE_VERTEX_FLOATS);
      allI.set(m.indices, iOff);
      this.reset[index * 5] = m.indices.length;
      this.reset[index * 5 + 2] = iOff;
      this.reset[index * 5 + 3] = vOff;
      vOff += m.vertices.length / TREE_VERTEX_FLOATS;
      iOff += m.indices.length;
    }
    for (let m = 0; m < NEAR_TREE_MODELS; m++) {
      const src = (NEAR_TREE_MODELS + m) * 5;
      const dst = (NEAR_TREE_DRAWS + m) * 5;
      this.reset[dst] = this.reset[src]!;
      this.reset[dst + 2] = this.reset[src + 2]!;
      this.reset[dst + 3] = this.reset[src + 3]!;
    }
    this.vBuf = this.d.createBuffer({ size: allV.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.iBuf = this.d.createBuffer({ size: allI.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.d.queue.writeBuffer(this.vBuf, 0, allV);
    this.d.queue.writeBuffer(this.iBuf, 0, allI);
    const vBufferLayout: GPUVertexBufferLayout = {
      arrayStride: TREE_VERTEX_FLOATS * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x4" },
      ],
    };
    const [pipes, shadowPipes] = await Promise.all([
      Promise.all(
        models.map((_, index) =>
          this.d.createRenderPipelineAsync({
            label: "near tree geometry",
            layout,
            vertex: {
              module: this.module,
              entryPoint: "nearTreeVs",
              constants: { NEAR_MODEL: index },
              buffers: [vBufferLayout],
            },
            fragment: {
              module: this.module,
              entryPoint: "nearTreeFs",
              targets: [
                { format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.GREEN | GPUColorWrite.BLUE | GPUColorWrite.ALPHA },
                { format: TERRAIN_RASTER_MOTION_FORMAT },
                { format: TERRAIN_RASTER_ID_FORMAT },
              ],
            },
            primitive: { cullMode: "none" },
            depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
          }),
        ),
      ),
      Promise.all(
        Array.from({ length: NEAR_TREE_SHADOW_DRAWS }, (_, m) =>
          this.d.createRenderPipelineAsync({
            label: "near tree shadow",
            layout,
            vertex: {
              module: this.module,
              entryPoint: "nearTreeShadowVs",
              constants: { NEAR_MODEL: NEAR_TREE_DRAWS + m },
              buffers: [vBufferLayout],
            },
            fragment: {
              module: this.module,
              entryPoint: "nearTreeShadowFs",
              targets: [],
            },
            primitive: { cullMode: "none" },
            depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
          }),
        ),
      ),
    ]);
    this.pipes = pipes;
    this.shadowPipes = shadowPipes;
    if (!this.disposed) this.ready = true;
  }
  prepare(sunOn = true) {
    if (this.on && !this.loading)
      this.loading = this.load().catch((e) => {
        this.error = String(e);
      });
    const cap = Number.isFinite(this.capacity) ? Math.max(1, Math.min(NEAR_TREE_CAP, Math.floor(this.capacity))) : NEAR_TREE_CAP;
    this.params.set([
      this.on && this.ready ? 1 : 0,
      Number.isFinite(this.reachM) ? Math.max(0, this.reachM) : 0,
      cap,
      Number.isFinite(this.debugTreeId) ? Math.trunc(this.debugTreeId) : 0,
    ]);
    this.d.queue.writeBuffer(this.u, 0, this.params);
    if (sunOn) {
      this.d.queue.writeBuffer(this.draws, 0, this.reset);
    } else {
      this.d.queue.writeBuffer(this.draws, 0, this.reset, 0, NEAR_TREE_DRAWS * 5);
      this.d.queue.writeBuffer(this.draws, NEAR_TREE_SLOTS * 20, this.reset, NEAR_TREE_SLOTS * 5, 1);
    }
  }
  draw(pass: GPURenderPassEncoder, main: GPUBindGroup) {
    if (!this.on || !this.ready || !this.vBuf || !this.iBuf) return;
    pass.setBindGroup(0, main);
    pass.setBindGroup(1, this.drawBind);
    pass.setVertexBuffer(0, this.vBuf);
    pass.setIndexBuffer(this.iBuf, "uint32");
    for (let i = 0; i < NEAR_TREE_DRAWS; i++) {
      pass.setPipeline(this.pipes[i]!);
      pass.drawIndexedIndirect(this.draws, i * 20);
    }
  }
  drawShadow(pass: GPURenderPassEncoder, main: GPUBindGroup) {
    if (!this.on || !this.ready || !this.vBuf || !this.iBuf || !this.shadowPipes.length) return;
    pass.setBindGroup(0, main);
    pass.setBindGroup(1, this.drawBind);
    pass.setVertexBuffer(0, this.vBuf);
    pass.setIndexBuffer(this.iBuf, "uint32");
    for (let m = 0; m < NEAR_TREE_SHADOW_DRAWS; m++) {
      pass.setPipeline(this.shadowPipes[m]!);
      pass.drawIndexedIndirect(this.draws, (NEAR_TREE_DRAWS + m) * 20);
    }
  }
  async readCounts() {
    const b = this.d.createBuffer({ size: this.reset.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const enc = this.d.createCommandEncoder();
      enc.copyBufferToBuffer(this.draws, 0, b, 0, b.size);
      this.d.queue.submit([enc.finish()]);
      await b.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(b.getMappedRange());
      const lod0 = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => words[i * 5 + 1]!);
      const lod1 = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => words[(NEAR_TREE_MODELS + i) * 5 + 1]!);
      const shadow = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => words[(NEAR_TREE_DRAWS + i) * 5 + 1]!);
      const instances = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => lod0[i]! + lod1[i]!);
      return { instances, lod0, lod1, shadow, overflow: words[NEAR_TREE_SLOTS * 5]! };
    } finally {
      b.destroy();
    }
  }
  dispose() {
    this.disposed = true;
    this.ready = false;
    for (const b of [this.u, this.lists, this.draws, ...(this.vBuf ? [this.vBuf] : []), ...(this.iBuf ? [this.iBuf] : [])]) b.destroy();
  }
}
