// J9: the near trees as real geometry — shared source triangles (12 models × 2 LODs, tree-assets.ts format 2: quantised,
// GPU-ready), instances selected on the GPU (system/scenery-raster.ts cull).
//
// Review of 24 Nov 2026 (docs/PLAN-J9-ARBRES-PROCHES.md):
// - one state per tree (a byte in a 64 × 64 torus over the world grid, nearState): its hand-over target with a fixed ±5 %
//   hysteresis band (not the camera's direction of travel), its LOD with its own band, and a fade progress — the geometry and
//   its crown's proxy crossfaded by a per-pixel, per-frame dither over ~0.3 s (the TAA integrates it), no pop at 80 m;
// - the same state decides the shadow casters: the drawn LOD, the drawn reach and hand-over (past half the fade), the same wind;
// - while the geometry is not in (its asset or pipelines on their way, or failed: retried 1, 2, 4 … 60 s later), or with
//   nearTreeGeometryOn off, the near trees are their proxies cut to their crowns (nearProxyFs): the whole envelope written
//   hid the trees and buildings behind it — the "ring of bare ground" round each crown; the rays' kernel no longer stands in;
// - one pipeline for the view, one for the shadows, one for the cut proxies (an instance's model is read from its tree, its list
//   from the instance buffer's offset — not 36 pipelines differing by an override). WebGPU has no indirect count nor
//   multi-draw: the 24 view and 24 shadow draws stay encoded, an empty one an instance count of 0.
import { TERRAIN_RASTER_FORMAT, TERRAIN_RASTER_ID_FORMAT, TERRAIN_RASTER_MOTION_FORMAT } from "../system/terrain-raster";
import { forgetTreeAssets, type LoadedTreeAssets, loadTreeAssets } from "./tree-asset-load";
import { TREE_VERTEX_BYTES } from "./tree-assets";
import { TREE_LEAF_WGSL } from "./tree-leaf";
import { TREE_ASPECTS, TREE_MODEL_KINDS } from "./tree-model";

export const NEAR_TREE_CAP = 4096;
export const NEAR_TREE_MODELS = 12;
export const NEAR_TREE_LODS = 2;
export const NEAR_TREE_DRAWS = NEAR_TREE_MODELS * NEAR_TREE_LODS;
/** the shadow casters' draws: one per model and LOD, as drawn in view */
export const NEAR_TREE_SHADOW_DRAWS = NEAR_TREE_DRAWS;
/** the cut proxies' draws: a round crown's, a cone's (their meshes the scenery raster's near proxies) */
export const NEAR_TREE_PROXY_DRAWS = 2;
export const NEAR_TREE_SLOTS = NEAR_TREE_DRAWS + NEAR_TREE_SHADOW_DRAWS + NEAR_TREE_PROXY_DRAWS;
const SHADOW0 = NEAR_TREE_DRAWS;
const PROXY0 = NEAR_TREE_DRAWS + NEAR_TREE_SHADOW_DRAWS;
/** the hand-over's crossfade [s]: the geometry and the proxy dithered against each other, the TAA averaging them */
export const NEAR_TREE_FADE_S = 0.3;
/** the per-tree state's torus: 64 × 64 cells of the world grid (7 m: 448 m round — twice the reach and more), a byte each */
const STATE_WORDS = (64 * 64) / 4;
const aspects = TREE_MODEL_KINDS.flatMap((k) => TREE_ASPECTS[k]!);
export const NEAR_TREE_WGSL = /* wgsl */ `
struct NearDraw { count:u32, instances:atomic<u32>, first:u32, vertex:i32, base:u32 };
struct NearDraws { items:array<NearDraw,${NEAR_TREE_SLOTS}>, overflow:atomic<u32> };
// a: geometry on (asset and pipelines in), reach [m], capacity, debug tree; b: fade step a cull, cut proxies drawn;
// lo, ext: the asset's quantisation box
struct NearU { a:vec4f, b:vec4f, lo:vec4f, ext:vec4f };
@group(1) @binding(27) var<uniform> nearU:NearU;
@group(1) @binding(28) var<storage,read_write> nearDraws:NearDraws;
@group(1) @binding(29) var<storage,read_write> nearOut:array<u32>;
@group(1) @binding(31) var<storage,read_write> nearState:array<atomic<u32>,${STATE_WORDS}>;
const NEAR_ASPECT=array<f32,12>(${aspects.map((a) => a.toFixed(3)).join(",")});
// (an entry of the near lists: the tree's cell in 25 bits, its fade progress — 0…63, the geometry's share — above)
const NEAR_K=0x1ffffffu;
// (the hand-over's band about the tree's own limit: in under 95 %, out past 105 %; the state kept a little beyond)
const NEAR_LO=0.95;
const NEAR_HI=1.05;
fn nearHidden(id:u32)->bool { return (nearU.a.w>0.0 && id==u32(nearU.a.w)) || (nearU.a.w<0.0 && id!=u32(-nearU.a.w)); }
// the tree's model (its kind's two proportions, the nearer to its crown's) and its crown's radius [m]
fn nearModelOf(k:u32,t:Tree,hd:ForestHead)->vec2f {
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let r=hd.cell*(.3+.17*forestUnit(forestHash(gi,gj,3u)));
  let b=(t.kind-1u)*2u;let ratio=r/t.height;
  return vec2f(f32(b+select(0u,1u,abs(log(ratio/NEAR_ASPECT[b+1u]))<abs(log(ratio/NEAR_ASPECT[b])))),r);
}
// a per-pixel, per-frame dither in [0, 1) (interleaved gradient noise, its phase the frame's): the crossfade's
fn nearDither(px:vec2f)->f32 {
  let q=floor(px)+5.588238*f32(u32(sc.misc.x)%64u);
  return fract(52.9829189*fract(dot(q,vec2f(.06711056,.00583715))));
}
struct NearSel { near:bool, prog:u32, lod:u32, model:u32 };
// The tree's state advanced once a cull (before the view's test: the shadows' casters out of view are the same trees):
// its target — geometry within 95 % of its limit, proxy past 105 %, kept between: the same whichever way the camera goes —,
// its LOD — by its projected error, kept between 2.9 and 3.5 px —, its fade towards its target
fn nearSelect(k:u32,t:Tree,hd:ForestHead)->NearSel {
  var o:NearSel;o.near=false;o.prog=0u;o.lod=1u;o.model=0u;
  if(nearU.a.y<=0.0){return o;}
  let d=length(t.foot-sc.cam.xyz);
  // (the tree's own limit: ±4 % by its seed, the hand-over spread over the stand — not one ring at once)
  let lim=nearU.a.y*(1.0+0.08*(t.seed-0.5));
  if(d>lim*NEAR_HI+8.0){return o;}
  o.near=true;
  let mr=nearModelOf(k,t,hd);o.model=u32(mr.x);
  let ci=i32(k)%hd.w;let cj=i32(k)/hd.w;
  let gi=u32(((hd.i0+ci)%hd.columns+hd.columns)%hd.columns);let gj=bitcast<u32>(hd.j0+cj);
  let cell=(gi&63u)+(gj&63u)*64u;let w=cell>>2u;let sh=(cell&3u)*8u;
  let s=(atomicLoad(&nearState[w])>>sh)&255u;
  var tgt=s>>7u;var lod=(s>>6u)&1u;var prog=s&63u;
  let on=nearU.a.x>.5;
  if(!on){tgt=0u;}else if(d<lim*NEAR_LO){tgt=1u;}else if(d>lim*NEAR_HI){tgt=0u;}
  let pxPerM=(0.5*u.image.y)/(max(d,1.0)*max(u.up.w,0.1));
  let errPx=0.025*max(t.height,2.0*mr.y)*pxPerM;
  if(errPx>3.5 && d<0.5*lim){lod=0u;}else if(errPx<2.9 || d>0.56*lim){lod=1u;}
  let step=u32(nearU.b.x);
  if(tgt==1u){prog=min(prog+step,63u);}else{prog=u32(max(i32(prog)-i32(step),0));}
  if(!on){prog=0u;}
  let ns=(tgt<<7u)|(lod<<6u)|prog;
  if(ns!=s){atomicAnd(&nearState[w],~(255u<<sh));atomicOr(&nearState[w],ns<<sh);}
  o.prog=prog;o.lod=lod;
  return o;
}
fn nearPush(slot:u32,e:u32)->bool {
  let at=atomicAdd(&nearDraws.items[slot].instances,1u);
  if(at>=u32(nearU.a.z)){atomicAdd(&nearDraws.overflow,1u);return false;}
  nearOut[slot*${NEAR_TREE_CAP}u+at]=e;return true;
}
// the Sun's view: the tree's geometry once past half its fade in (its drawn LOD), else its proxy's (false)
fn nearShadowKeep(k:u32,ns:NearSel)->bool {
  if(nearU.a.x<.5){return false;}
  if(nearHidden(k+1u)){return true;}
  if(!ns.near || ns.prog<32u){return false;}
  return nearPush(${SHADOW0}u+ns.model+ns.lod*12u,k);
}
// the camera's view: the geometry (fading in or out, or whole) and, while it is not whole, its crown's proxy cut to the
// crown, dithered against it; false: the plain proxy lists (overflow, or the cut proxies not compiled yet)
fn nearKeep(k:u32,t:Tree,ns:NearSel)->bool {
  if(!ns.near){return false;}
  let e=k|(ns.prog<<25u);
  var geo=false;
  if(ns.prog>0u){geo=nearPush(ns.model+ns.lod*12u,e);}
  let cutOn=nearU.b.y>.5;
  if(geo && (ns.prog==63u || !cutOn)){return true;}
  if(!cutOn){return false;}
  if(nearPush(${PROXY0}u+select(0u,1u,t.cone),select(k,e,geo))){return true;}
  return geo;
}
${TREE_LEAF_WGSL}
fn nearOct(e:vec2f)->vec3f {
  var n=vec3f(e,1.0-abs(e.x)-abs(e.y));
  let f=max(-n.z,0.0);
  n.x+=select(f,-f,n.x>=0.0);n.y+=select(f,-f,n.y>=0.0);
  return normalize(n);
}
// a model's vertex placed on its tree: rotated by its seed, scaled to its crown and height, swayed by the wind (the view's and
// the shadows' the same)
struct NearPlaced { t:Tree, base:vec3f, nr:vec3f, sx:f32, hz:f32, sw:vec2f, weight:f32, bare:f32, k:u32, pz:f32 };
fn nearPlace(e:u32,q:vec4f,oe:vec2f,attr:vec4f)->NearPlaced {
  var o:NearPlaced;
  let k=e&NEAR_K;o.k=k;
  let hd=forestHead(u32(forestData(2u).x));let t=treeOf(k,hd);o.t=t;
  let mr=nearModelOf(k,t,hd);
  o.sx=.8*mr.y/NEAR_ASPECT[u32(mr.x)];
  let pos=nearU.lo.xyz+nearU.ext.xyz*q.xyz;let nrm=nearOct(oe);o.pz=pos.z;
  let ang=6.2831853*t.seed;let ca=cos(ang);let sa=sin(ang);
  let dz=select(0.0,(attr.y-.5)*.055-(attr.x-.5)*.025,t.cone && attr.z>.5);
  o.hz=select(1.0,.86,t.kind==5u)*t.height;
  let pr=vec3f(pos.x*ca-pos.y*sa,pos.x*sa+pos.y*ca,pos.z+dz);
  o.nr=vec3f(nrm.x*ca-nrm.y*sa,nrm.x*sa+nrm.y*ca,nrm.z);
  o.base=t.foot+pr*vec3f(o.sx,o.sx,o.hz);
  o.weight=clamp(pos.z*pos.z,0.0,1.0);
  o.sw=forestSway(t.foot,t.height,t.seed)*o.weight;
  o.bare=forestData(hd.F+10u+4u*t.kind).w*forestData(hd.F+7u).z;
  return o;
}
struct NearV { @builtin(position) clip:vec4f,@location(0) p:vec3f,@location(1) n:vec3f,@location(2) a:vec4f,
  @location(3) @interpolate(flat) id:u32,@location(4) @interpolate(flat) kind:u32,
  @location(5) @interpolate(flat) bare:f32,@location(6) mot:vec3f,@location(7) @interpolate(flat) fade:f32 };
@vertex fn nearTreeVs(@location(0) q:vec4f,@location(1) oe:vec2f,@location(2) attr:vec4f,@location(3) e:u32)->NearV {
  let pl=nearPlace(e,q,oe,attr);let t=pl.t;let base=pl.base;
  let p=base+vec3f(pl.sw,0.0);let v=view(p);
  var o:NearV;o.clip=vec4f(v.x/u.right.w+u.output.z*v.z,v.y/u.up.w+u.output.w*v.z,u.forward.w,v.z);
  let nCard=normalize(pl.nr/vec3f(pl.sx,pl.sx,pl.hz));
  let qc=base-t.c;
  let uCr=qc/max(t.r,vec3f(0.1));
  let nCone=normalize(vec3f(qc.xy,(t.r.x/max(t.r.y,0.1))*length(qc.xy)+1e-4));
  let nEll=normalize(vec3f(uCr.xy,uCr.z*0.75+0.1));
  let nCrown=select(nEll,nCone,t.cone);
  let nOut=normalize(nCard-nCrown*min(0.0,dot(nCard,nCrown))+nCrown*1e-4);
  let crDepth=select(clamp(length(uCr),0.45,1.0),0.75+0.25*clamp(pl.pz,0.0,1.0),t.cone);
  o.p=v;o.n=select(nCard,normalize(mix(nCrown,nOut,0.28)),attr.z>.5);
  o.a=vec4f(attr.xyz,attr.w*select(1.0,crDepth*(0.82+0.18*attr.y),attr.z>.5));
  o.id=pl.k+1u;o.kind=t.kind;o.bare=pl.bare;o.mot=vec3f(0.0);o.fade=f32(e>>25u)/63.0;
  if(any(pl.sw!=vec2f(0.0)) && sc.pf.w>.5 && v.z>.1){let old=base+vec3f(forestSwayAt(t.foot,t.height,t.seed,forestWind(),sc.pcam.xyz,sc.pcam.w)*pl.weight,0.0);
    let vp=viewPrev(old);if(vp.z>.1){o.mot=vec3f((v.xy/(vec2f(u.right.w,u.up.w)*v.z)-vp.xy/(vec2f(sc.pr.w,sc.pu.w)*vp.z))*.5*vec2f(u.image.x,-u.image.y),1.0);}}
  return o;
}
@fragment fn nearTreeFs(v:NearV,@builtin(front_facing) front:bool)->MO {
  // Diagnostic isolation after selection: never put a hidden tree back into the proxy lists.
  if(nearHidden(v.id)){discard;}
  // (the hand-over: the geometry's share of the pixels — its proxy the rest, nearProxyFs)
  if(v.fade<1.0 && nearDither(v.clip.xy)>=v.fade){discard;}
  let leaf=v.a.z>.5;if(leaf && (v.bare>.5 || !leafMask(v.a.xy,f32(v.kind)))){discard;}
  var n=normalize(v.n);if(!leaf && !front){n=-n;}
  var o:MO;o.vis=vec4f(0.0,f32(v.id),length(v.p),f32(nearTreePack(n,leaf,v.a.w)));
  o.mot=vec4f(v.mot,0.0);o.id=surfaceId(f32(v.id));return o;
}
struct NearShadowV { @builtin(position) clip:vec4f,@location(0) a:vec3f,@location(1) @interpolate(flat) id:u32,
  @location(2) @interpolate(flat) kind:u32,@location(3) @interpolate(flat) bare:f32 };
@vertex fn nearTreeShadowVs(@location(0) q:vec4f,@location(1) oe:vec2f,@location(2) attr:vec4f,@location(3) e:u32)->NearShadowV {
  let pl=nearPlace(e,q,oe,attr);
  // (the bark's foot thickened a little: its shadow a texel wide; the crown swayed as drawn — the map redrawn as the wind moves
  // it, renderer treeShadowFrame's key)
  let pad=select(0.0,0.12,attr.z<.5 && pl.pz<.35);
  var o:NearShadowV;o.clip=sunClip(pl.base+pl.nr*pad+vec3f(pl.sw,0.0));o.a=attr.xyz;o.id=pl.k+1u;o.kind=pl.t.kind;
  o.bare=pl.bare;return o;
}
@fragment fn nearTreeShadowFs(v:NearShadowV) {
  if(nearHidden(v.id)){discard;}
  if(v.a.z>.5 && (v.bare>.5 || !leafMask(v.a.xy,f32(v.kind)))){discard;}
}
// The crown's proxy cut to the crown: the camera's line through the fragment in the crown's unit frame (its sway taken out)
// tested against the unit sphere or cone (shadowFs's tests); what it misses left to what stands behind
struct NearProxyV { @builtin(position) clip:vec4f,@location(0) @interpolate(flat) id:f32,@location(1) p:vec3f,@location(2) mot:vec3f,
  @location(3) q:vec3f,@location(4) @interpolate(flat) eye:vec3f,@location(5) @interpolate(flat) part:u32,
  @location(6) @interpolate(flat) fade:f32 };
@vertex fn nearProxyVs(@location(0) m:vec4f,@location(1) e:u32)->NearProxyV {
  let k=e&NEAR_K;let hd=forestHead(u32(forestData(2u).x));let t=treeOf(k,hd);
  let pv=proxyOut(m,k,t);
  var o:NearProxyV;o.clip=pv.clip;o.id=pv.id;o.p=pv.p;o.mot=pv.mot;
  let part=u32(m.w);o.part=part;o.q=m.xyz;o.fade=f32(e>>25u)/63.0;
  let sw=select(vec2f(0.0),forestSway(t.foot,t.height,t.seed),part<2u);
  let s=select(t.r,vec3f(t.r.x,t.r.x,t.r.y),part==1u);
  o.eye=(sc.cam.xyz-(t.c+vec3f(sw,0.0)))/max(s,vec3f(1e-3));
  return o;
}
@fragment fn nearProxyFs(v:NearProxyV)->MO {
  if(nearHidden(u32(v.id))){discard;}
  if(v.fade>0.0 && nearDither(v.clip.xy)<v.fade){discard;}
  if(v.part<2u){
    let L=normalize(v.q-v.eye);
    if(!select(unitSphereLine(v.q,L),unitConeLine(v.q,L),v.part==1u)){discard;}
  }
  var o:MO;o.vis=vec4f(0.0,v.id,length(v.p),0.0);o.mot=vec4f(v.mot,0.0);o.id=surfaceId(v.id);return o;
}
`;
const RASTER_TARGETS = (treeAlpha: boolean): GPUColorTargetState[] => [
  {
    format: TERRAIN_RASTER_FORMAT,
    writeMask: GPUColorWrite.GREEN | GPUColorWrite.BLUE | (treeAlpha ? GPUColorWrite.ALPHA : 0),
  },
  { format: TERRAIN_RASTER_MOTION_FORMAT },
  { format: TERRAIN_RASTER_ID_FORMAT },
];
/** the list entry an instance reads: its own slot's range of the lists buffer, bound at that offset */
const INSTANCE: GPUVertexBufferLayout = {
  arrayStride: 4,
  stepMode: "instance",
  attributes: [{ shaderLocation: 3, offset: 0, format: "uint32" }],
};
const MODEL: GPUVertexBufferLayout = {
  arrayStride: TREE_VERTEX_BYTES,
  attributes: [
    { shaderLocation: 0, offset: 0, format: "unorm16x4" },
    { shaderLocation: 1, offset: 8, format: "snorm16x2" },
    { shaderLocation: 2, offset: 12, format: "unorm8x4" },
  ],
};
export class NearTreeGeometry {
  on = false;
  reachM = 80;
  /** A lower capacity is only a witness for the overflow/fallback contract. */
  capacity = NEAR_TREE_CAP;
  /** Surface witness only: >0 hides this local tree id; <0 draws only its opposite. Zero draws all. */
  debugTreeId = 0;
  /** the geometry drawn: its asset uploaded and its pipelines compiled */
  ready = false;
  /** the last failure (kept until a later ask succeeds: the asset is asked again, 1, 2, 4 … 60 s apart) */
  error: string | null = null;
  /** the asset's decoding (the worker's fetch + inflate + check, or the page's) and the upload [ms], for the record */
  timings: { decodedIn: string; decodeMs: number; uploadMs: number } | null = null;
  readonly cullLayout: GPUBindGroupLayout;
  readonly drawLayout: GPUBindGroupLayout;
  readonly cullBind: GPUBindGroup;
  readonly drawBind: GPUBindGroup;
  private loading: Promise<void> | null = null;
  private failures = 0;
  private retryAt = 0;
  private u: GPUBuffer;
  private lists: GPUBuffer;
  private draws: GPUBuffer;
  private state: GPUBuffer;
  private reset = new Uint32Array(NEAR_TREE_SLOTS * 5 + 1);
  private vBuf: GPUBuffer | null = null;
  private iBuf: GPUBuffer | null = null;
  private pipe: GPURenderPipeline | null = null;
  private shadowPipe: GPURenderPipeline | null = null;
  private proxyPipe: GPURenderPipeline | null = null;
  private pipes: Promise<void>;
  private proxyMeshes: GPUBuffer[] = [];
  private disposed = false;
  private params = new Float32Array(16);
  private lastPrepare = 0;
  constructor(
    private d: GPUDevice,
    module: GPUShaderModule,
    mainLayout: GPUBindGroupLayout,
  ) {
    this.u = d.createBuffer({ size: this.params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lists = d.createBuffer({ size: NEAR_TREE_CAP * NEAR_TREE_SLOTS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX });
    this.draws = d.createBuffer({
      size: Math.ceil(this.reset.byteLength / 16) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.state = d.createBuffer({ size: STATE_WORDS * 4, usage: GPUBufferUsage.STORAGE });
    const C = GPUShaderStage.COMPUTE,
      V = GPUShaderStage.VERTEX,
      F = GPUShaderStage.FRAGMENT;
    this.cullLayout = d.createBindGroupLayout({
      entries: [
        { binding: 27, visibility: C, buffer: { type: "uniform" } },
        { binding: 28, visibility: C, buffer: { type: "storage" } },
        { binding: 29, visibility: C, buffer: { type: "storage" } },
        { binding: 31, visibility: C, buffer: { type: "storage" } },
      ],
    });
    this.drawLayout = d.createBindGroupLayout({ entries: [{ binding: 27, visibility: V | F, buffer: { type: "uniform" } }] });
    this.cullBind = d.createBindGroup({
      layout: this.cullLayout,
      entries: [
        { binding: 27, resource: { buffer: this.u } },
        { binding: 28, resource: { buffer: this.draws } },
        { binding: 29, resource: { buffer: this.lists } },
        { binding: 31, resource: { buffer: this.state } },
      ],
    });
    this.drawBind = d.createBindGroup({ layout: this.drawLayout, entries: [{ binding: 27, resource: { buffer: this.u } }] });
    // (the three pipelines asked at once — the scenery raster's first frame, during the entry's veil —, the asset alongside)
    const layout = d.createPipelineLayout({ bindGroupLayouts: [mainLayout, this.drawLayout] });
    const depth = (cmp: GPUCompareFunction): GPUDepthStencilState => ({
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: cmp,
    });
    this.pipes = Promise.all([
      d.createRenderPipelineAsync({
        label: "near tree geometry",
        layout,
        vertex: { module, entryPoint: "nearTreeVs", buffers: [MODEL, INSTANCE] },
        fragment: { module, entryPoint: "nearTreeFs", targets: RASTER_TARGETS(true) },
        primitive: { cullMode: "none" },
        depthStencil: depth("greater"),
      }),
      d.createRenderPipelineAsync({
        label: "near tree shadow",
        layout,
        vertex: { module, entryPoint: "nearTreeShadowVs", buffers: [MODEL, INSTANCE] },
        fragment: { module, entryPoint: "nearTreeShadowFs", targets: [] },
        primitive: { cullMode: "none" },
        depthStencil: depth("less"),
      }),
      d.createRenderPipelineAsync({
        label: "near tree cut proxy",
        layout,
        vertex: {
          module,
          entryPoint: "nearProxyVs",
          buffers: [
            { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
            { ...INSTANCE, attributes: [{ shaderLocation: 1, offset: 0, format: "uint32" }] },
          ],
        },
        fragment: { module, entryPoint: "nearProxyFs", targets: RASTER_TARGETS(false) },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depth("greater"),
      }),
    ]).then(([pipe, shadowPipe, proxyPipe]) => {
      if (this.disposed) return;
      this.pipe = pipe;
      this.shadowPipe = shadowPipe;
      this.proxyPipe = proxyPipe;
    });
    this.pipes.catch((e) => {
      // (a pipeline refused is the shader's own fault: not asked again)
      this.error = `near tree pipelines: ${e}`;
    });
  }
  /** the scenery raster's near proxies (lists 0 and 1: a round crown's with its trunk, a cone's) and their vertex counts */
  setProxyMeshes(meshes: GPUBuffer[], counts: number[]) {
    this.proxyMeshes = meshes.slice(0, NEAR_TREE_PROXY_DRAWS);
    for (let l = 0; l < NEAR_TREE_PROXY_DRAWS; l++) {
      const s = (PROXY0 + l) * 5;
      this.reset[s] = counts[l] ?? 0;
      this.reset[s + 2] = 0;
      this.reset[s + 3] = 0;
      this.reset[s + 4] = 0;
    }
  }
  private async load() {
    const a: LoadedTreeAssets = await loadTreeAssets();
    if (this.disposed) return;
    const models = a.models;
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
    const t0 = performance.now();
    // (format 2: the blobs as the GPU reads them — views of the decoded buffer, uploaded as they are)
    const vBuf = this.d.createBuffer({ size: a.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const iBuf = this.d.createBuffer({ size: a.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.d.queue.writeBuffer(vBuf, 0, a.vertices);
    this.d.queue.writeBuffer(iBuf, 0, a.indices);
    for (const [index, m] of models.entries())
      for (const slot of [index, SHADOW0 + index]) {
        this.reset[slot * 5] = m.indexCount;
        this.reset[slot * 5 + 2] = m.firstIndex;
        this.reset[slot * 5 + 3] = m.baseVertex;
        this.reset[slot * 5 + 4] = 0;
      }
    this.params.set([...a.lo, 0], 8);
    this.params.set([...a.ext, 0], 12);
    // (a retry's — after its pipelines failed — buffers replaced, not kept beside)
    this.vBuf?.destroy();
    this.iBuf?.destroy();
    this.vBuf = vBuf;
    this.iBuf = iBuf;
    this.timings = { decodedIn: a.decodedIn, decodeMs: a.decodeMs, uploadMs: performance.now() - t0 };
    await this.pipes;
    if (this.disposed || !this.pipe || !this.shadowPipe) return;
    this.ready = true;
    this.error = null;
    forgetTreeAssets();
  }
  /** the asset asked (again, past its back-off after a failure) while the geometry is wanted and not in */
  private ask(now: number) {
    if (this.loading || this.ready || this.disposed || now < this.retryAt) return;
    this.loading = this.load()
      .catch((e) => {
        this.error = String(e);
        this.failures++;
        this.retryAt = performance.now() + Math.min(60_000, 1000 * 2 ** (this.failures - 1));
      })
      .finally(() => {
        this.loading = null;
      });
  }
  prepare(_sunOn = true) {
    const now = performance.now();
    if (this.on) this.ask(now);
    // (the fade's step this cull: its share of NEAR_TREE_FADE_S since the last — a long frame finishing it sooner)
    const dt = this.lastPrepare ? Math.min(Math.max(now - this.lastPrepare, 0), 250) : 16;
    this.lastPrepare = now;
    const step = Math.min(63, Math.max(1, Math.round((63 * dt) / (NEAR_TREE_FADE_S * 1000))));
    const cap = Number.isFinite(this.capacity) ? Math.max(1, Math.min(NEAR_TREE_CAP, Math.floor(this.capacity))) : NEAR_TREE_CAP;
    const cut = !!this.proxyPipe && this.proxyMeshes.length === NEAR_TREE_PROXY_DRAWS;
    this.params.set(
      [
        this.on && this.ready ? 1 : 0,
        Number.isFinite(this.reachM) ? Math.max(0, this.reachM) : 0,
        cap,
        Number.isFinite(this.debugTreeId) ? Math.trunc(this.debugTreeId) : 0,
        step,
        cut ? 1 : 0,
        0,
        0,
      ],
      0,
    );
    this.d.queue.writeBuffer(this.u, 0, this.params);
    this.d.queue.writeBuffer(this.draws, 0, this.reset);
  }
  draw(pass: GPURenderPassEncoder, main: GPUBindGroup) {
    const geo = this.on && this.ready && !!this.vBuf && !!this.iBuf && !!this.pipe;
    const cut = !!this.proxyPipe && this.proxyMeshes.length === NEAR_TREE_PROXY_DRAWS;
    if (!geo && !cut) return;
    pass.setBindGroup(0, main);
    pass.setBindGroup(1, this.drawBind);
    if (geo) {
      pass.setPipeline(this.pipe!);
      pass.setVertexBuffer(0, this.vBuf!);
      pass.setIndexBuffer(this.iBuf!, "uint16");
      for (let i = 0; i < NEAR_TREE_DRAWS; i++) {
        pass.setVertexBuffer(1, this.lists, i * NEAR_TREE_CAP * 4, NEAR_TREE_CAP * 4);
        pass.drawIndexedIndirect(this.draws, i * 20);
      }
    }
    if (cut) {
      pass.setPipeline(this.proxyPipe!);
      for (let l = 0; l < NEAR_TREE_PROXY_DRAWS; l++) {
        pass.setVertexBuffer(0, this.proxyMeshes[l]!);
        pass.setVertexBuffer(1, this.lists, (PROXY0 + l) * NEAR_TREE_CAP * 4, NEAR_TREE_CAP * 4);
        pass.drawIndirect(this.draws, (PROXY0 + l) * 20);
      }
    }
  }
  drawShadow(pass: GPURenderPassEncoder, main: GPUBindGroup) {
    if (!this.on || !this.ready || !this.vBuf || !this.iBuf || !this.shadowPipe) return;
    pass.setBindGroup(0, main);
    pass.setBindGroup(1, this.drawBind);
    pass.setPipeline(this.shadowPipe);
    pass.setVertexBuffer(0, this.vBuf);
    pass.setIndexBuffer(this.iBuf, "uint16");
    for (let m = 0; m < NEAR_TREE_SHADOW_DRAWS; m++) {
      pass.setVertexBuffer(1, this.lists, (SHADOW0 + m) * NEAR_TREE_CAP * 4, NEAR_TREE_CAP * 4);
      pass.drawIndexedIndirect(this.draws, (SHADOW0 + m) * 20);
    }
  }
  async readCounts() {
    const b = this.d.createBuffer({ size: this.draws.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const enc = this.d.createCommandEncoder();
      enc.copyBufferToBuffer(this.draws, 0, b, 0, b.size);
      this.d.queue.submit([enc.finish()]);
      await b.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(b.getMappedRange());
      const at = (slot: number) => words[slot * 5 + 1]!;
      const lod0 = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => at(i));
      const lod1 = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => at(NEAR_TREE_MODELS + i));
      const shadowLod0 = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => at(SHADOW0 + i));
      const shadowLod1 = Array.from({ length: NEAR_TREE_MODELS }, (_, i) => at(SHADOW0 + NEAR_TREE_MODELS + i));
      const shadow = shadowLod0.map((n, i) => n + shadowLod1[i]!);
      const proxies = [at(PROXY0), at(PROXY0 + 1)];
      const instances = lod0.map((n, i) => n + lod1[i]!);
      return { instances, lod0, lod1, shadow, shadowLod0, shadowLod1, proxies, overflow: words[NEAR_TREE_SLOTS * 5]! };
    } finally {
      b.destroy();
    }
  }
  gpuBytes() {
    const v = this.vBuf ? this.vBuf.size : 0;
    const i = this.iBuf ? this.iBuf.size : 0;
    const l = this.lists.size;
    const d = this.draws.size;
    const u = this.u.size;
    const s = this.state.size;
    return {
      vertices: v,
      indices: i,
      lists: l,
      draws: d,
      uniforms: u,
      state: s,
      total: v + i + l + d + u + s,
      capacity: this.capacity,
      slots: NEAR_TREE_SLOTS,
      ready: this.ready,
      timings: this.timings,
    };
  }
  dispose() {
    this.disposed = true;
    this.ready = false;
    for (const b of [this.u, this.lists, this.draws, this.state, ...(this.vBuf ? [this.vBuf] : []), ...(this.iBuf ? [this.iBuf] : [])])
      b.destroy();
  }
}
