// J9-3 prototype: shared source triangles, GPU-selected instances. Off until explicitly measured.
import url from "./tree-asset-url";
import { decodeTreeAssets, TREE_VERTEX_FLOATS } from "./tree-assets";
import { TREE_ASPECTS, TREE_MODEL_KINDS } from "./tree-model";
import { TREE_LEAF_WGSL } from "./tree-leaf";
import { inflated } from "../util/inflate";
import { TERRAIN_RASTER_FORMAT, TERRAIN_RASTER_ID_FORMAT, TERRAIN_RASTER_MOTION_FORMAT } from "../system/terrain-raster";
export const NEAR_TREE_CAP = 4096;
export const NEAR_TREE_MODELS = 12;
const aspects = TREE_MODEL_KINDS.flatMap((k) => TREE_ASPECTS[k]!);
export const NEAR_TREE_WGSL = /* wgsl */ `
struct NearDraw { count:u32, instances:atomic<u32>, first:u32, vertex:i32, base:u32 };
struct NearDraws { items:array<NearDraw,12>, overflow:atomic<u32> };
@group(1) @binding(27) var<uniform> nearU:vec4f;
@group(1) @binding(28) var<storage,read_write> nearDraws:NearDraws;
@group(1) @binding(29) var<storage,read_write> nearOut:array<u32>;
@group(1) @binding(30) var<storage,read> nearIn:array<u32>;
const NEAR_ASPECT=array<f32,12>(${aspects.map((a) => a.toFixed(3)).join(",")});
fn nearKeep(k:u32,t:Tree,hd:ForestHead)->bool {
  if(nearU.x<.5 || length(t.foot-sc.cam.xyz)>nearU.y){return false;}
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));
  let b=(t.kind-1u)*2u;let ratio=r/t.height;
  let model=b+select(0u,1u,abs(log(ratio/NEAR_ASPECT[b+1u]))<abs(log(ratio/NEAR_ASPECT[b])));
  let at=atomicAdd(&nearDraws.items[model].instances,1u);
  if(at>=u32(nearU.z)){atomicAdd(&nearDraws.overflow,1u);return false;}
  nearOut[model*${NEAR_TREE_CAP}u+at]=k;return true;
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
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));let sx=r/NEAR_ASPECT[NEAR_MODEL];
  let base=t.foot+pos*vec3f(sx,sx,t.height);
  let weight=clamp(pos.z*pos.z,0.0,1.0);
  let p=base+vec3f(forestSway(t.foot,t.height,t.seed)*weight,0.0);let v=view(p);
  var o:NearV;o.clip=vec4f(v.x/u.right.w+u.output.z*v.z,v.y/u.up.w+u.output.w*v.z,u.forward.w,v.z);
  o.p=v;o.n=normalize(nrm/vec3f(sx,sx,t.height));o.a=attr;o.id=k+1u;o.kind=t.kind;
  o.bare=forestData(hd.F+10u+4u*t.kind).w*forestData(hd.F+7u).z;o.mot=vec3f(0.0);
  if(sc.pf.w>.5 && v.z>.1){let old=base+vec3f(forestSwayAt(t.foot,t.height,t.seed,forestWind(),sc.pcam.xyz,sc.pcam.w)*weight,0.0);
    let vp=viewPrev(old);if(vp.z>.1){o.mot=vec3f((v.xy/(vec2f(u.right.w,u.up.w)*v.z)-vp.xy/(vec2f(sc.pr.w,sc.pu.w)*vp.z))*.5*vec2f(u.image.x,-u.image.y),1.0);}}
  return o;
}
@fragment fn nearTreeFs(v:NearV,@builtin(front_facing) front:bool)->MO {
  let leaf=v.a.z>.5;if(leaf && (v.bare>.5 || !leafMask(v.a.xy,f32(v.kind)))){discard;}
  var n=normalize(v.n);if(!leaf && !front){n=-n;}
  var o:MO;o.vis=vec4f(0.0,f32(v.id),length(v.p),f32(nearTreePack(n,leaf,v.a.w)));
  o.mot=vec4f(v.mot,0.0);o.id=surfaceId(f32(v.id));return o;
}
`;
export class NearTreeGeometry {
  on = false;
  reachM = 80;
  /** A lower capacity is only a witness for the overflow/fallback contract. */
  capacity = NEAR_TREE_CAP;
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
  private reset = new Uint32Array(NEAR_TREE_MODELS * 5 + 1);
  private meshes: { v: GPUBuffer; i: GPUBuffer }[] = [];
  private pipes: GPURenderPipeline[] = [];
  private disposed = false;
  private params = new Float32Array(4);
  constructor(
    private d: GPUDevice,
    private module: GPUShaderModule,
    private mainLayout: GPUBindGroupLayout,
  ) {
    this.u = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lists = d.createBuffer({ size: NEAR_TREE_CAP * NEAR_TREE_MODELS * 4, usage: GPUBufferUsage.STORAGE });
    this.draws = d.createBuffer({
      size: this.reset.byteLength,
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
    this.drawLayout = d.createBindGroupLayout({ entries: [{ binding: 30, visibility: V, buffer: { type: "read-only-storage" } }] });
    this.cullBind = d.createBindGroup({
      layout: this.cullLayout,
      entries: [
        { binding: 27, resource: { buffer: this.u } },
        { binding: 28, resource: { buffer: this.draws } },
        { binding: 29, resource: { buffer: this.lists } },
      ],
    });
    this.drawBind = d.createBindGroup({ layout: this.drawLayout, entries: [{ binding: 30, resource: { buffer: this.lists } }] });
  }
  private async load() {
    const response = await fetch(url);
    if (!response.ok) throw Error(`tree geometry: ${response.status}`);
    const models = decodeTreeAssets(await inflated(response));
    if (this.disposed) return;
    if (
      models.length !== NEAR_TREE_MODELS ||
      models.some((m, i) => m.lod !== 0 || m.kind !== Math.floor(i / 2) + 1 || Math.abs(m.aspect - aspects[i]!) > 1e-6)
    )
      throw Error("Unexpected tree models");
    const layout = this.d.createPipelineLayout({ bindGroupLayouts: [this.mainLayout, this.drawLayout] });
    for (const [index, m] of models.entries()) {
      const v = this.d.createBuffer({ size: m.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      const i = this.d.createBuffer({ size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.meshes.push({ v, i });
      this.d.queue.writeBuffer(v, 0, m.vertices);
      this.d.queue.writeBuffer(i, 0, m.indices);
      this.reset[index * 5] = m.indices.length;
    }
    this.pipes = await Promise.all(
      models.map((_, index) =>
        this.d.createRenderPipelineAsync({
          label: "near tree geometry",
          layout,
          vertex: {
            module: this.module,
            entryPoint: "nearTreeVs",
            constants: { NEAR_MODEL: index },
            buffers: [
              {
                arrayStride: TREE_VERTEX_FLOATS * 4,
                attributes: [
                  { shaderLocation: 0, offset: 0, format: "float32x3" },
                  { shaderLocation: 1, offset: 12, format: "float32x3" },
                  { shaderLocation: 2, offset: 24, format: "float32x4" },
                ],
              },
            ],
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
    );
    if (!this.disposed) this.ready = true;
  }
  prepare() {
    if (this.on && !this.loading)
      this.loading = this.load().catch((e) => {
        this.error = String(e);
      });
    const cap = Number.isFinite(this.capacity) ? Math.max(1, Math.min(NEAR_TREE_CAP, Math.floor(this.capacity))) : NEAR_TREE_CAP;
    this.params.set([this.on && this.ready ? 1 : 0, Number.isFinite(this.reachM) ? Math.max(0, this.reachM) : 0, cap, 0]);
    this.d.queue.writeBuffer(this.u, 0, this.params);
    this.d.queue.writeBuffer(this.draws, 0, this.reset);
  }
  draw(pass: GPURenderPassEncoder, main: GPUBindGroup) {
    if (!this.on || !this.ready) return;
    for (const [i, m] of this.meshes.entries()) {
      pass.setPipeline(this.pipes[i]!);
      pass.setBindGroup(0, main);
      pass.setBindGroup(1, this.drawBind);
      pass.setVertexBuffer(0, m.v);
      pass.setIndexBuffer(m.i, "uint32");
      pass.drawIndexedIndirect(this.draws, i * 20);
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
      return { instances: Array.from({ length: NEAR_TREE_MODELS }, (_, i) => words[i * 5 + 1]!), overflow: words[NEAR_TREE_MODELS * 5]! };
    } finally {
      b.destroy();
    }
  }
  dispose() {
    this.disposed = true;
    this.ready = false;
    for (const b of [this.u, this.lists, this.draws, ...this.meshes.flatMap((m) => [m.v, m.i])]) b.destroy();
  }
}
