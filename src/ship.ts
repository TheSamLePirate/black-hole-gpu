// The spacecraft (vessels.ts: Interstellar's Ranger, its Lander, the Endurance): the one the camera is
// mounted on, at one of several attach points — rigid in the camera's rest frame —, and the others near it,
// where they are seen from the camera; all drawn in one pass (their depths shared: docked, they hide each
// other), with the tracer's own pinhole projection, and composited over the traced image (before bloom:
// the disk's glare spills over their silhouettes). They are lit by a light probe traced around the camera
// (lensed disk, Gargantua, sky) — see ship.wgsl.
import { inflated } from "./util/inflate";
import rangerUrl from "../assets/ranger/ranger.bin";
import landerUrl from "../assets/lander/lander.bin";
import landerAlbedoUrl from "../assets/lander/lander-albedo.webp";
import landerNormalUrl from "../assets/lander/lander-normal.webp";
import landerLightsUrl from "../assets/lander/lander-lights.webp";
import enduranceUrl from "../assets/endurance/endurance.bin";
import cockpitUrl from "../assets/ranger/cockpit.bin";
import f35Url from "../assets/f35/f35.bin";
import f35Albedo0 from "../assets/f35/f35-albedo-0.ktx2";
import f35Albedo1 from "../assets/f35/f35-albedo-1.ktx2";
import f35Normal0 from "../assets/f35/f35-normal-0.ktx2";
import f35Normal1 from "../assets/f35/f35-normal-1.ktx2";
import f35Mr0 from "../assets/f35/f35-mr-0.ktx2";
import f35Mr1 from "../assets/f35/f35-mr-1.ktx2";
import { nozzleExit, parseF35, partMatrices, restPose, type F35Mesh, type F35Pose } from "./f35/model";
import { PCD_H, PCD_W } from "./f35/pcd-size";
import { ktxLevels, ktxTarget, writeLevels } from "./system/ktx2";

import { shipToCamera, type M3, type Mount, type MountPose } from "./mounts";
import { controlMesh, MAX_CONTROLS, POSE_VEC4, poseData } from "./cockpit/controls";
import { placardLevels } from "./cockpit/placards";
import { cabinUniform, screenLights, type ScreenLight } from "./cockpit/lights";
import { F35_LAMPS, lampLevels, lampUniform, MAX_LAMPS, placeLamps, RANGER_LAMPS, type PlacedLamp } from "./ship-lights";
import { GEAR_HINGES, gearMesh } from "./gear-mesh";
import type { GpuProfiler } from "./gpuprof";
import { cockpitHull, samplePoints, TriBVH, vesselHulls } from "./system/collide";
import { cabinHitOf } from "./cockpit/pick";
import { MAX_SEGMENTS, SEG_FLOATS } from "./contrails";
import { VESSELS, type JetDef, type VesselId } from "./vessels";
import a320Url from "../assets/traffic/a320.bin";
import a320MapUrl from "../assets/traffic/a320.jpg";
import crj900Url from "../assets/traffic/crj900.bin";
import crj900MapUrl from "../assets/traffic/crj900.jpg";
import cargoUrl from "../assets/traffic/cargo.bin";
import tankerUrl from "../assets/traffic/tanker.bin";
import ferryUrl from "../assets/traffic/ferry.bin";
import trawlerUrl from "../assets/traffic/trawler.bin";
import sailboatUrl from "../assets/traffic/sailboat.bin";
import frigateUrl from "../assets/traffic/frigate.bin";
import cargoHullUrl from "../assets/traffic/cargo-hull.jpg";
import cargoBridgeUrl from "../assets/traffic/cargo-bridge.jpg";
import cargoBoxesUrl from "../assets/traffic/cargo-boxes.jpg";
import fordUrl from "../assets/carriers/ford.bin";
import kievUrl from "../assets/carriers/kiev.bin";
import implacableUrl from "../assets/carriers/implacable.bin";
import ford0Url from "../assets/carriers/ford-0.jpg";
import ford1Url from "../assets/carriers/ford-1.jpg";
import ford2Url from "../assets/carriers/ford-2.jpg";
import kiev0Url from "../assets/carriers/kiev-0.jpg";
import kiev1Url from "../assets/carriers/kiev-1.jpg";
import implacable0Url from "../assets/carriers/implacable-0.jpg";
import implacable1Url from "../assets/carriers/implacable-1.jpg";

/** The real traffic's airliners (scripts/build-airliners.ts, docs/PLAN-AVIATION-AAA.md T2) and ships
 *  (scripts/build-ships.ts, T3): drawn as the craft are. */
export type AirlinerId = "a320" | "crj900";
export type ShipTypeId = "cargo" | "tanker" | "ferry" | "trawler" | "sailboat" | "frigate";
/** The carriers (scripts/build-carriers.ts, docs/PLAN-AVIATION-AAA.md M2). */
export type CarrierId = "ford" | "kiev" | "implacable";
export type TrafficMeshId = AirlinerId | ShipTypeId | CarrierId;
/** A mesh the craft's pass draws: a craft's, an airliner's, a ship's. */
export type ShipMeshId = VesselId | TrafficMeshId;
const TRAFFIC_MESHES: Record<TrafficMeshId, string> = {
  a320: a320Url,
  crj900: crj900Url,
  cargo: cargoUrl,
  tanker: tankerUrl,
  ferry: ferryUrl,
  trawler: trawlerUrl,
  sailboat: sailboatUrl,
  frigate: frigateUrl,
  ford: fordUrl,
  kiev: kievUrl,
  implacable: implacableUrl,
};
/** The traffic's colour maps, a layer each (ship.wgsl: the materials 40, 41, 44–46); the carriers' after them
 *  (80–86), added with the first carrier drawn. */
const TRAFFIC_MAPS = [a320MapUrl, crj900MapUrl, cargoHullUrl, cargoBridgeUrl, cargoBoxesUrl];
const CARRIER_MAPS = [ford0Url, ford1Url, ford2Url, kiev0Url, kiev1Url, implacable0Url, implacable1Url];
const isCarrier = (id: ShipMeshId): id is CarrierId => id === "ford" || id === "kiev" || id === "implacable";
const isTraffic = (id: ShipMeshId): id is TrafficMeshId => id in TRAFFIC_MESHES;
import { jetLevel } from "./jets";
import { cross, dot, sub } from "./math/vec3";

type V3 = [number, number, number];

/** Another craft in view: its axes' images in the camera frame (rows: the camera's axes on the craft's,
 *  as shipToCamera's S) and its origin there [m]; whether it is in the shadow map (near the flown one). */
export interface ShipInstance {
  id: ShipMeshId;
  S: M3;
  t: V3;
  shadow: boolean;
  /** an F-35's own pose (its gear, its surfaces — an aggressor's: docs/PLAN-F35.md F10); none: at rest */
  jet?: F35Pose;
  /** hidden where the traced image holds something nearer (default: yes) */
  far?: boolean;
  /** a carrier (docs/PLAN-AVIATION-AAA.md M2): the nearest one has the shadow map's second half — its shadow on
   *  its deck, on the craft there, on the sea —, the craft's shadows falling on it */
  big?: boolean;
  /** mirrored in the sea (a ship: always; else the view's sea.flown) */
  mirror?: boolean;
  /** another's engines (docs/PLAN-RESEAU.md R1): its main jets drawn as the flown craft's are — throttle 0–1,
   *  the afterburner's factor (1: dry), the air about it 0–1 */
  thrust?: { throttle: number; boost: number; air: number };
}

export interface ShipView {
  /** Camera translation near a walking observer needs a fresh map each frame. */
  forceShadow?: boolean;
  /** the sea about the camera, the craft mirrored in it: its plane (camera axes: n·p = d, n up — the ellipsoid's
   *  h = 0 —), its significant height [m], a clock [s], the flown craft (and the aircraft near it) over the sea */
  sea?: { n: V3; d: number; hs: number; t: number; flown: boolean } | null;
  /** the craft flown (its mesh, its thrusters) */
  vessel?: VesselId;
  /** the other craft in view */
  others?: ShipInstance[];
  /** metres per M (the traced image's depths: the other craft hidden behind what it holds) */
  mPerM?: number;
  /** the camera in the Ranger's cabin: the cockpit drawn instead of its hull */
  inside?: boolean;
  /** the cockpit's dashboard: the local up and the motion in the ship's frame, the speed [km/s], the
   *  height [km], the clock [s] */
  dash?: { up: V3; fwd: V3; speed: number; alt: number; time: number };
  /** the Ranger's landing gear: out (0…1; 0: not drawn), each leg's oleo compression [m] (nose, left, right) */
  gear?: { ext: number; comp: number[] };
  /** the cockpit's controls: their moving parts' poses (cockpit/controls.ts poseData) */
  controls?: Float32Array<ArrayBuffer>;
  /** the cabin's light (PLAN-COCKPIT K6): the ceiling lamps' level and red, the displays' mean colours
   *  (cockpit/lights.ts) */
  cabin?: { level: number; red: number; colours: Float32Array | null };
  /** the Ranger's lamps switched on (the cockpit's switches — ship-lights.ts), a clock for the strobes [s] */
  lamps?: { navLights: boolean; strobeLights: boolean; landingLights: boolean; t: number };
  mount: Mount | MountPose;
  /** the flown ship placed in the view directly (a spectator's): its axes in the camera's, its origin
   *  there [m] — instead of the mount's */
  place?: { S: M3; t: V3 };
  look: [number, number]; // free look on the mount: yaw, pitch [deg]
  fov: number; // vertical, degrees
  aspect: number;
  albedo: number;
  metal: number;
  rough: number;
  light: number;
  coat: number;
  /** pre-exposure of the HDR target (renderer.ts: preExposure) */
  pre?: number;
  /** re-entry glow: the air's flow direction (camera frame), level 0…1 */
  plasma?: [number, number, number, number];
  /** the re-entry's plasma and heat (the flown craft): see Reentry */
  reentry?: Reentry | null;
  /** the condensation trails: segments in the ship's frame (contrails.ts) */
  contrails?: { data: Float32Array<ArrayBuffer>; n: number } | null;
  /** the camera's axes (x right, y up, z forward) in the light probe's axes (default: the same) */
  probeAxes?: [V3, V3, V3];
  /** the thrusters: see Thrust */
  thrust?: Thrust | null;
  /** the flown F-35's moving parts (src/f35/model.ts) */
  jet?: F35Pose | null;
  /** display-referred emission scale: pre-exposure / 2^EV (a flame as bright whatever the exposure) */
  glow?: number;
}

/**
 * What the thrusters do (ship frame: x left, y up, z nose): the main engine's throttle, the RCS
 * translation command (a push, |f| ≤ 1) and the attitude effort (angular acceleration per axis,
 * −1…1), the air's density relative to sea level, a clock [s].
 */
export interface Thrust {
  throttle: number;
  force: V3;
  torque: V3;
  air: number;
  time: number;
  /** the afterburner's thrust factor (1 or none: dry) — the main flame longer and brighter */
  boost?: number;
}

/**
 * The flown craft in the air, for the re-entry's look (ship frame: x left, y up, z nose): its motion
 * through the air (unit), the stagnation heat flux [W/m²], the shield's and hull's temperatures [K],
 * Mach, the air's density [kg/m³], the gas's glow (linear rgb), a clock [s].
 */
export interface Reentry {
  u: V3;
  heat: number;
  shield: number;
  hull: number;
  mach: number;
  rho: number;
  glow: V3;
  time: number;
}

const MAX_JETS = 40;
/** the craft drawn at once, at most */
const MAX_INST = 24;
/** ship.wgsl's Ship: up to the gear's hinges 512 bytes, then the cabin's light (S.cab, S.scr: 1 + 8 × 3 vec4s) */
/** where the lamps start in it (S.lampN) */
const LAMPS_AT = 512 + 16 + 8 * 3 * 16;
/** after them: the carrier's shadow sphere, the sea's plane and state (S.bound2, S.sea, S.seaK) */
const SEA_AT = LAMPS_AT + 16 + MAX_LAMPS * 3 * 16;
const SHIP_UNIFORM_BYTES = SEA_AT + 3 * 16;
const INST_FLOATS = 20;
/** the F-35's parts (src/f35/model.ts) at most, and how many F-35s drawn with their parts posed */
const MAX_PARTS = 160;
const JET_SLOTS = 8;
const JET_FLOATS = 16;

const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export const ENV_W = 256;
export const ENV_H = 128;
const RAW_MIPS = 9; // box-filtered probe 256×128 … 1×1: the source of the GGX filtering
const SPEC_MIPS = 6; // GGX pre-filtered, roughness = level / 5
const GGX_SAMPLES = [0, 48, 64, 96, 128, 128];
const SHADOW = 2048;
const STRIDE = 10 * 4; // position, normal, material, ambient occlusion, UV

/** whether the cockpit's t-th triangle (in idx) is glass */
const isGlassTri = (idx: Uint32Array, verts: Float32Array, t: number) => Math.round(verts[10 * idx[3 * t]! + 6]!) === 71;

interface Mesh {
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  count: number;
  /** the opaque triangles' indices, first; the glass's after them (the F-35's canopy) — none: all opaque */
  solid?: number;
  /** its box's centre and half-diagonal, its box (ship frame) [m] */
  bound: { c: V3; r: number; lo: V3; hi: V3 };
}

interface ShipTargetRes {
  w: number;
  h: number;
  /** the ship over the whole image (premultiplied), only its box written: the display reads that box */
  resolved: GPUTexture;
  /** the MSAA targets and their resolve, the size of the ship's box (rounded up by 128 px) */
  box: { w: number; h: number; color: GPUTexture; depth: GPUTexture; small: GPUTexture } | null;
  /** where the box was drawn in the image [x, y, w, h] */
  rect: [number, number, number, number];
  /** the thrusters' flames over the whole image at half resolution (the display adds them); something drawn in it */
  plume: GPUTexture;
  plumeDepth: GPUTexture;
  plumeDirty: boolean;
  /** the hull's distance at the plumes' resolution (where the plasma's march ends), its bind group */
  hullDist: GPUTexture;
  sheathBind?: GPUBindGroup;
  /** the trails' bind group, with this target's traced depths */
  trailBind?: GPUBindGroup;
  trailMoments?: GPUBuffer;
  /** the lamps' glare's bind group, with this target's traced depths */
  lampBind?: GPUBindGroup;
  lampMoments?: GPUBuffer;
  /** the shading's bind group, with this target's traced image and depths (and the bindings' generation) */
  bind?: GPUBindGroup;
  bindGen?: number;
  bindMoments?: GPUBuffer;
  /** the F-35's glass pass's bind group (with this target's traced image) */
  jetGlassBind?: GPUBindGroup;
  jetGlassGen?: number;
  jetGlassHdr?: GPUTexture;
  /** the station's depth bound (group 1), and which texture it holds */
  occBind?: { tex: GPUTexture; g: GPUBindGroup };
  /** the images in the sea's (pipes.mirror's own layouts): its bind groups, as the shading's */
  mirrorBind?: GPUBindGroup;
  mirrorGen?: number;
  mirrorMoments?: GPUBuffer;
  mirrorHdr?: GPUTexture;
  mirrorOcc?: { tex: GPUTexture; g: GPUBindGroup };
}

export class ShipRenderer {
  ready = false;
  /** the ship's module (read back at start-up for its compilation messages) */
  readonly module: GPUShaderModule;
  /** Light probe written by the tracer's `env` kernel (camera rest frame, equirectangular). */
  readonly envBuf: GPUBuffer;
  private envRaw: GPUTexture;
  private envSpec: GPUTexture;
  private ggxBufs: GPUBuffer[] = [];
  /** spherical harmonics of the probe (9 × rgb, then the dominant direction), camera axes */
  readonly shBuf: GPUBuffer;
  private uniform: GPUBuffer;
  private jetBuf: GPUBuffer;
  private jetData = new Float32Array(MAX_JETS * JET_FLOATS);
  /** the condensation trails' segments (contrails.ts), how many this frame */
  private trailBuf!: GPUBuffer;
  private trailCount = 0;
  private jetCount = 0;
  private plumeBinds: {
    plume: GPUBindGroup;
    plumeIn: GPUBindGroup;
    hullDepth: GPUBindGroup;
    glow: GPUBindGroup;
    dist: GPUBindGroup;
  } | null = null;
  /** this frame's re-entry: the hull glowing, the plasma (or the vapour) drawn */
  private reOn = { glow: false, sheath: false };
  /** which jets have the camera inside their plume (drawn by their back faces) */
  private jetInside: boolean[] = [];
  /** the camera in the ship's frame */
  private camShip: V3 = [0, 0, 0];
  /** the last frame's camera: its axes in the ship's frame (rows) and the projection's half-extents */
  private lastCam: { R: M3; tanX: number; tanY: number } | null = null;
  /** the craft's meshes (loaded when first seen) */
  private meshes: Partial<Record<ShipMeshId, Mesh>> = {};
  private loadingMesh = new Set<ShipMeshId>();
  /** the traffic's colour maps (a layer each — TRAFFIC_MAPS), loaded with the first of its meshes */
  private trafficMaps: GPUTexture | null = null;
  private trafficMapsLayers = 0;
  /** the instances' transforms and flags (the flown craft first) */
  private instBuf: GPUBuffer;
  private instData = new Float32Array((MAX_INST + JET_SLOTS * MAX_PARTS) * INST_FLOATS);
  /** the F-35's mesh as built (its parts, their tracks), its maps (two layers each; 1 × 1 until loaded) */
  private jetMesh: F35Mesh | null = null;
  private jetMaps: { albedo: GPUTexture; normal: GPUTexture; mr: GPUTexture } | null = null;
  private jetMapsLoading = false;
  /** What a pixel (ndc) of the F-35's cockpit view meets on its mesh (as built — the parts at rest): the
   *  distance, the material, the part, on its panoramic display the point (u, v). Null: nothing. */
  jetPick(
    nx: number,
    ny: number,
  ): { t: number; mat: number; part: number; p: V3; uv: [number, number]; screen?: { u: number; v: number } } | null {
    const ray = this.cabinRay(nx, ny);
    const bvh = vesselHulls.f35.bvh,
      verts = this.jetMesh?.verts;
    if (!ray || !bvh || !verts) return null;
    const h = cabinHitOf(ray.o, ray.d, bvh, verts, 4);
    if (!h) return null;
    const ia = bvh.tri[3 * (bvh.segment(ray.o, [ray.o[0] + ray.d[0] * 4, ray.o[1] + ray.d[1] * 4, ray.o[2] + ray.d[2] * 4])?.tri ?? 0)]!;
    return {
      t: h.t,
      mat: h.mat,
      part: Math.floor(verts[10 * ia + 7]!),
      p: h.p,
      uv: [verts[10 * ia + 8]!, verts[10 * ia + 9]!],
      screen: h.screen && h.mat === 36 ? { u: h.screen.u, v: h.screen.v } : undefined,
    };
  }

  /** The F-35's vertices as built (10 floats each: ship.wgsl's layout) — its cockpit's picking. */
  get jetVerts(): Float32Array | null {
    return this.jetMesh?.verts ?? null;
  }
  /** the flown F-35's exhaust now (ship frame): its exit, its way, its radius [m], how strongly it shimmers */
  private haze: { p: V3; d: V3; r: number; k: number } | null = null;

  /**
   * The heat haze behind the F-35's nozzle in the last frame's view (display.wgsl haze): the exhaust's
   * column from its exit to some 18 m downstream, in the image's uv, its radii there [uv of the height], its
   * strength (0: none). The hot gas bends the light behind it: the background seen through it shimmers.
   */
  hazeView(): [number, number, number, number, number, number, number] | null {
    const H = this.haze,
      C = this.lastCam;
    if (!H || !C || H.k <= 0.01) return null;
    const len = 18;
    const view = (p: V3) => {
      const q: V3 = [p[0] - this.camShip[0], p[1] - this.camShip[1], p[2] - this.camShip[2]];
      return C.R.map((r) => r[0]! * q[0] + r[1]! * q[1] + r[2]! * q[2]) as V3;
    };
    let a = view(H.p),
      b = view([H.p[0] + H.d[0] * len, H.p[1] + H.d[1] * len, H.p[2] + H.d[2] * len]);
    // (the column clipped at the near plane: the camera beside or inside it)
    const near = 0.3;
    if (a[2] < near && b[2] < near) return null;
    if (a[2] < near || b[2] < near) {
      const t = (near - a[2]) / (b[2] - a[2]);
      const m: V3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near];
      if (a[2] < near) a = m;
      else b = m;
    }
    const uv = (c: V3) => [0.5 + (0.5 * c[0]) / (c[2] * C.tanX), 0.5 - (0.5 * c[1]) / (c[2] * C.tanY)];
    const r = (c: V3, k: number) => Math.min((H.r * k) / (c[2] * C.tanY * 2), 0.5);
    return [...uv(a), ...uv(b), r(a, 1.1), r(b, 3.2), H.k] as [number, number, number, number, number, number, number];
  }

  /** the flown F-35's nozzle exit now (ship frame): where its plume starts, which way */
  private jetExit: { p: V3; d: V3 } | null = null;
  /** this frame's draws: mesh, and whether in the shadow map */
  private draws: { mesh: Mesh; shadow: boolean; cabin?: boolean; inst: number; mirror?: boolean }[] = [];
  /** the Ranger's landing gear (gear-mesh.ts), made at its first draw */
  private gearMeshBuf: Mesh | null = null;
  /** the cockpit (the Ranger's cabin): its mesh, its sticks' pivots; loading */
  private cockpit: { mesh: Mesh; pivots: V3[]; solid: number; controls: Mesh } | null = null;
  /** the cabin's screens as lights (cockpit/lights.ts), from its mesh */
  private screenLights: ScreenLight[] = [];
  /** the craft's lamps set on its hull (ship-lights.ts: the Ranger's, the F-35's), how many lit now */
  private lampsPlaced: Partial<Record<VesselId, PlacedLamp[]>> = {};
  private lampCount = 0;
  /** the controls' poses (cockpit/controls.ts: ship.wgsl Controls) */
  private ctlBuf: GPUBuffer | null = null;
  private cockpitLoading = false;
  /** the sticks' deflections, eased (forward, right, twist) [rad], and when last eased */
  private stick: V3 = [0, 0, 0];
  private stickAt = NaN;
  /** the Lander's maps (1×1 until loaded) */
  private maps: { albedo: GPUTexture; normal: GPUTexture; lights: GPUTexture } | null = null;
  private mapSamp: GPUSampler;
  /** the flown craft's mesh bound (the plumes' depth range), and its thrusters */
  private bound = { c: [0, 0, 0] as V3, r: 1, lo: [-1, -1, -1] as V3, hi: [1, 1, 1] as V3 };
  private vessel: VesselId = "ranger";
  /** a craft flown this frame (else only the others are drawn) */
  private flown = true;
  /** the occlusion depth bound into the per-target groups (a stand-in when none) */
  private momentsBuf: GPUBuffer | null = null;
  private shadowTex: GPUTexture;
  private pipes!: {
    copy: GPUComputePipeline;
    down: GPUComputePipeline;
    ggx: GPUComputePipeline;
    sh: GPUComputePipeline;
    ship: GPURenderPipeline;
    shadow: GPURenderPipeline;
    mirror: GPURenderPipeline;
    comp: GPURenderPipeline;
    plume: GPURenderPipeline;
    plumeIn: GPURenderPipeline;
    hullDepth: GPURenderPipeline;
    glow: GPURenderPipeline;
    sheath: GPURenderPipeline;
    trail: GPURenderPipeline;
    lamp: GPURenderPipeline;
    dist: GPURenderPipeline;
    glass: GPURenderPipeline;
    jetGlass: GPURenderPipeline;
    cabin: GPURenderPipeline;
    depthPre: GPURenderPipeline;
    ctl: GPURenderPipeline;
  };
  private envBinds: { copy: GPUBindGroup[]; down: GPUBindGroup[]; ggx: GPUBindGroup[]; sh: GPUBindGroup } | null = null;
  /** the shading's bindings but the traced image (one bind group per target: shipBindFor) */
  private shipEntries: GPUBindGroupEntry[] | null = null;
  private shadowBind: GPUBindGroup | null = null;
  private targets = new WeakMap<GPUTexture, ShipTargetRes>();

  /** the ship's bounding sphere in the camera frame and the projection's half-extents (the scissor) */
  private onScreen: { c: V3; r: number; tx: number; ty: number; corners: V3[] } | null = null;
  /** the probe's GGX pre-filtered radiance (mip = roughness · (specMips − 1)): the walking astronaut's reflections */
  get envSpecView() {
    return this.envSpec.createView();
  }
  readonly specMips = SPEC_MIPS;
  /** the shadow map's view (the tracer shadows the ground with it) */
  get shadowView() {
    return this.shadowTex.createView();
  }
  /** the ship's bounding sphere in the camera's axes (x right, y up, z forward) [m], as last drawn */
  get shadowBound(): { c: V3; r: number } | null {
    return this.onScreen ? { c: this.onScreen.c, r: this.onScreen.r } : null;
  }
  /** the nearest carrier's sphere (the map's second half), as last drawn; null: none */
  get shadowBound2(): { c: V3; r: number } | null {
    return this.bound2;
  }
  private bound2: { c: V3; r: number } | null = null;

  /** The pixels the ship can cover on a w × h target: [x, y, w, h] (the whole target when the camera is inside its sphere). */
  private scissor(w: number, h: number): [number, number, number, number] {
    const o = this.onScreen;
    // (the mesh's box projected: a corner at or behind the near plane — the camera in or at the
    // ship — the whole image)
    if (!o || o.corners.some((q) => q[2] < 0.06)) return [0, 0, w, h];
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const q of o.corners) {
      const nx = q[0] / (q[2] * o.tx),
        ny = q[1] / (q[2] * o.ty);
      (x0 = Math.min(x0, nx)), (x1 = Math.max(x1, nx)), (y0 = Math.min(y0, ny)), (y1 = Math.max(y1, ny));
    }
    // (a pixel of margin for the MSAA footprint)
    const mx = 4 / w,
      my = 4 / h;
    (x0 -= mx), (x1 += mx), (y0 -= my), (y1 += my);
    const px = (n: number) => Math.min(w, Math.max(0, Math.floor(((n + 1) / 2) * w)));
    const py = (n: number) => Math.min(h, Math.max(0, Math.floor(((1 - n) / 2) * h)));
    const X0 = px(Math.min(x0, x1)),
      X1 = Math.min(w, px(Math.max(x0, x1)) + 2);
    const Y0 = py(Math.max(y0, y1)),
      Y1 = Math.min(h, py(Math.min(y0, y1)) + 2);
    return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1 - X0, Y1 - Y0] : [0, 0, 1, 1];
  }

  private shadowTick = 0;
  /** the renderer's GPU profiler (timestamps per pass) */
  prof: GpuProfiler | null = null;
  private occDummy: GPUTexture | null = null;
  private pass<T extends GPUComputePassDescriptor | GPURenderPassDescriptor>(label: string, d?: T): T {
    return this.prof ? this.prof.pass(label, d) : ((d ?? {}) as T);
  }

  constructor(
    private device: GPUDevice,
    shipWGSL: string,
  ) {
    const d = device;
    // (the probe's texels, then its key light: trace.wgsl env)
    this.envBuf = d.createBuffer({
      size: (ENV_W * ENV_H + 2) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const envUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    this.envRaw = d.createTexture({ size: [ENV_W, ENV_H], format: "rgba16float", mipLevelCount: RAW_MIPS, usage: envUsage });
    this.envSpec = d.createTexture({ size: [ENV_W, ENV_H], format: "rgba16float", mipLevelCount: SPEC_MIPS, usage: envUsage });
    for (let l = 0; l < SPEC_MIPS; l++) {
      const b = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(b, 0, new Float32Array([Math.max(l / (SPEC_MIPS - 1), 0.02), RAW_MIPS, GGX_SAMPLES[l]!, 0]));
      this.ggxBufs.push(b);
    }
    this.shBuf = d.createBuffer({ size: 16 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.uniform = d.createBuffer({ size: SHIP_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.jetBuf = d.createBuffer({ size: this.jetData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.trailBuf = d.createBuffer({ size: MAX_SEGMENTS * SEG_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.instBuf = d.createBuffer({ size: this.instData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.mapSamp = d.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
      maxAnisotropy: 8,
    });
    // (two maps side by side: the flown craft's, the nearest carrier's — ship.wgsl lightClipB)
    this.shadowTex = d.createTexture({
      size: [2 * SHADOW, SHADOW],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const module = (this.module = d.createShaderModule({ code: shipWGSL, label: "ship" }));
    const cp = (entryPoint: string) => d.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
    const vertex: GPUVertexState = {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32" },
            { shaderLocation: 3, offset: 28, format: "float32" },
            { shaderLocation: 4, offset: 32, format: "float32x2" },
          ],
        },
      ],
    };
    // (the F-35's canopy and visor: after the opaque draws, blended (premultiplied), the depth tested not written —
    // its mode the e2e's A/B: ship.wgsl GLASS_MODE)
    const glassPipe = (mode: number) =>
      d.createRenderPipeline({
        layout: "auto",
        vertex,
        fragment: {
          module,
          entryPoint: "fsJetGlass",
          constants: { GLASS_MODE: mode },
          targets: [
            {
              format: "rgba16float",
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater-equal" },
        multisample: { count: 4 },
      });
    this.glassPipe = glassPipe;
    this.pipes = {
      copy: cp("envCopy"),
      down: cp("envDown"),
      ggx: cp("envGGX"),
      sh: cp("envSH"),
      ship: d.createRenderPipeline({
        layout: "auto",
        vertex,
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
        // (back faces culled: the mesh's inward-wound triangles are its hidden inner faces — none of its
        // pixels goes missing from 288 viewpoints around it — and the pass is ~20 % faster)
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        // (reversed depth in float: a hatch at a metre and a craft tens of kilometres off, both exact;
        // after the depth pre-pass: the nearest surface only)
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater-equal" },
        multisample: { count: 4 },
      }),
      // the craft's images in the sea: under it, mirrored (their winding reversed), after the craft — nearer than
      // them nothing is drawn —, their depth their own
      mirror: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "mirrorVs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }], constants: { MIRROR: 1 } },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "cw" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
        multisample: { count: 4 },
      }),
      shadow: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "shadowVs" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
      }),
      // the plumes: emission added over the sky (and the hull: the display adds them), in a pass of
      // their own at half resolution — soft, they need no more — hidden by the hull's depth drawn first
      // there; by their front faces, or by their back faces without the depth test for a plume the
      // camera is in (rare: then the hull does not hide it)
      ...(() => {
        const blend: GPUBlendState = {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
        };
        const plume = (inside: boolean) =>
          d.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "plumeVs" },
            fragment: { module, entryPoint: "plumeFs", targets: [{ format: "rgba16float", blend }] },
            primitive: { topology: "triangle-list", cullMode: inside ? "front" : "back" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: inside ? "always" : "less" },
          });
        return {
          plume: plume(false),
          plumeIn: plume(true),
          // the re-entry: the hull glowing (its visible faces: the depth equal to the pre-pass's), the
          // plasma marched through (back faces, wherever the camera is), the hull's distance for it
          glow: d.createRenderPipeline({
            layout: "auto",
            vertex: { ...vertex, entryPoint: "glowVs" },
            fragment: { module, entryPoint: "glowFs", targets: [{ format: "rgba16float", blend }] },
            primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
          }),
          sheath: d.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "sheathVs" },
            fragment: { module, entryPoint: "sheathFs", targets: [{ format: "rgba16float", blend }] },
            primitive: { topology: "triangle-list", cullMode: "front" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
          }),
          // the condensation trails: their scattered light added, their coverage summed in alpha (the
          // display dims what is behind by it); hidden by the hull's depth
          trail: d.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "trailVs" },
            fragment: {
              module,
              entryPoint: "trailFs",
              targets: [
                {
                  format: "rgba16float",
                  blend: {
                    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
                  },
                },
              ],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" },
          }),
          // the Ranger's lamps' glare: added, hidden by the hull's depth (ship-lights.ts — K6)
          lamp: d.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "lampVs" },
            fragment: {
              module,
              entryPoint: "lampFs",
              targets: [
                {
                  format: "rgba16float",
                  blend: {
                    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                    alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
                  },
                },
              ],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
          }),
          dist: d.createRenderPipeline({
            layout: "auto",
            vertex: { ...vertex, entryPoint: "distVs" },
            fragment: { module, entryPoint: "distFs", targets: [{ format: "r16float" }] },
            primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
          }),
          hullDepth: d.createRenderPipeline({
            layout: "auto",
            vertex: { ...vertex, entryPoint: "hullDepthVs" },
            fragment: { module, entryPoint: "hullDepthFs", targets: [{ format: "rgba16float", writeMask: 0 }] },
            primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
            depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
          }),
        };
      })(),
      // the cabin (fsCabin: its own lean shader) and its glass — over what the opaque draws left,
      // premultiplied, its depth not written, both faces
      cabin: d.createRenderPipeline({
        layout: "auto",
        vertex,
        fragment: { module, entryPoint: "fsCabin", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater-equal" },
        multisample: { count: 4 },
      }),
      ctl: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "ctlVs" },
        fragment: { module, entryPoint: "fsCabin", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater-equal" },
        multisample: { count: 4 },
      }),
      glass: d.createRenderPipeline({
        layout: "auto",
        vertex,
        fragment: {
          module,
          entryPoint: "fsCabinGlass",
          targets: [
            {
              format: "rgba16float",
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater-equal" },
        multisample: { count: 4 },
      }),
      jetGlass: glassPipe(0),
      // the depth alone, first: the shading then runs once a pixel
      depthPre: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "depthVs" },
        fragment: { module, entryPoint: "hullDepthFs", targets: [{ format: "rgba16float", writeMask: 0 }] },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
        multisample: { count: 4 },
      }),
      comp: d.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "compVs" },
        fragment: {
          module,
          entryPoint: "compFs",
          targets: [
            {
              format: "rgba16float",
              // premultiplied over; the alpha channel (the pixel's variance estimate) is kept
              blend: {
                color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      }),
    };
  }

  /** Downloads the Ranger's mesh (1 MB); the other craft's when first drawn (loadVessel). */
  async load(get: (url: string) => Promise<Response> = fetch) {
    this.getter = get;
    await this.loadVessel("ranger");
    this.bind();
    this.ready = true;
  }
  private getter: (url: string) => Promise<Response> = fetch;

  /** Whether a craft's mesh is there (starting its download if not). */
  has(id: ShipMeshId) {
    if (this.meshes[id]) return true;
    if (!this.loadingMesh.has(id) && this.ready) {
      this.loadingMesh.add(id);
      (isTraffic(id) ? this.loadTraffic(id) : this.loadVessel(id)).then(
        () => this.onLoaded?.(),
        (e) => console.error(`${isTraffic(id) ? id : VESSELS[id].name}:`, e),
      );
    }
    return false;
  }

  /**
   * A traffic's mesh — an airliner's, a ship's (assets/traffic/*.bin, "TRFC": the common layout already —
   * position, normal, material, AO, UV) —, its bounds; the colour maps' array with the first.
   */
  private async loadTraffic(id: TrafficMeshId) {
    const d = this.device;
    const buf = await this.getter(TRAFFIC_MESHES[id]).then((r) => r.arrayBuffer());
    if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "TRFC") throw new Error(`bad mesh for ${id}`);
    const u32 = new Uint32Array(buf, 0, 4);
    const nv = u32[2]!,
      ni = u32[3]!;
    const b = new Float32Array(buf, 16, 6);
    const lo: V3 = [b[0]!, b[1]!, b[2]!],
      hi: V3 = [b[3]!, b[4]!, b[5]!];
    const verts = new Float32Array(buf, 40, nv * 10);
    const idx = new Uint32Array(buf, 40 + nv * 40, ni);
    const vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, verts);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, idx);
    const c: V3 = [0, 1, 2].map((j) => (lo[j]! + hi[j]!) / 2) as V3;
    this.meshes[id] = { vbuf, ibuf, count: ni, bound: { c, r: Math.hypot(...sub(hi, lo)) / 2, lo, hi } };
    // (the maps: the traffic's with its first mesh; again with the carriers' with the first carrier)
    const want = isCarrier(id) ? TRAFFIC_MAPS.length + CARRIER_MAPS.length : TRAFFIC_MAPS.length;
    if (want > this.trafficMapsLayers) {
      this.trafficMapsLayers = want;
      await this.loadTrafficMaps(want);
    }
  }

  /** The traffic's colour maps: one array, a layer each, its mipmaps made from the image. */
  private async loadTrafficMaps(layers: number) {
    const d = this.device;
    const urls = [...TRAFFIC_MAPS, ...CARRIER_MAPS].slice(0, layers);
    const imgs = await Promise.all(urls.map(async (url) => createImageBitmap(await this.getter(url).then((r) => r.blob()))));
    // (a later, larger array asked meanwhile: this one dropped)
    if (layers < this.trafficMapsLayers) return;
    const size = 2048;
    const levels = Math.floor(Math.log2(size)) + 1;
    const t = d.createTexture({
      size: [size, size, urls.length],
      format: "rgba8unorm-srgb",
      mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (let i = 0; i < urls.length; i++)
      for (let l = 0; l < levels; l++) {
        const w = Math.max(1, size >> l);
        const bm = await createImageBitmap(imgs[i]!, { resizeWidth: w, resizeHeight: w, resizeQuality: "high" });
        d.queue.copyExternalImageToTexture({ source: bm }, { texture: t, mipLevel: l, origin: [0, 0, i] }, [w, w]);
      }
    this.trafficMaps?.destroy();
    this.trafficMaps = t;
    this.bind();
  }
  /** (a mesh arrived: the renderer redraws) */
  onLoaded?: () => void;

  /**
   * A craft's mesh, into the common vertex layout (position, normal, material, AO, UV): the Ranger's and
   * the Endurance's (8 floats: no UV; the Endurance's at its 64 m and its materials from 20 on), the
   * Lander's as built (its maps with it). Its hull for contacts, too.
   */
  private async loadVessel(id: VesselId) {
    if (id === "f35") return this.loadJet();
    const d = this.device;
    const url = id === "ranger" ? rangerUrl : id === "lander" ? landerUrl : enduranceUrl;
    const buf = await this.getter(url).then(inflated);
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
    const u32 = new Uint32Array(buf, 0, 4);
    const nv = u32[2]!,
      ni = u32[3]!;
    const inStride = magic === "LNDR" ? 10 : 8;
    if (!["RNGR", "ENDR", "LNDR"].includes(magic)) throw new Error(`bad mesh for ${id}`);
    const src = new Float32Array(buf, 40, nv * inStride);
    const idx = new Uint32Array(buf, 40 + nv * inStride * 4, ni);
    // (the Endurance's model: a ring of diameter 1)
    const k = id === "endurance" ? 64 : 1;
    const matOff = id === "endurance" ? 20 : 0;
    const verts = new Float32Array(nv * 10);
    const lo: V3 = [Infinity, Infinity, Infinity],
      hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nv; i++) {
      const o = 10 * i,
        q = inStride * i;
      for (let c = 0; c < 3; c++) {
        const x = src[q + c]! * k;
        verts[o + c] = x;
        lo[c] = Math.min(lo[c]!, x);
        hi[c] = Math.max(hi[c]!, x);
        verts[o + 3 + c] = src[q + 3 + c]!;
      }
      verts[o + 6] = src[q + 6]! + matOff;
      verts[o + 7] = src[q + 7]!;
      if (inStride === 10) (verts[o + 8] = src[q + 8]!), (verts[o + 9] = src[q + 9]!);
    }
    // (its hull for contacts: points a half metre apart — two on the Endurance —, its triangles)
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) pos.set(verts.subarray(10 * i, 10 * i + 3), 3 * i);
    const c: V3 = [0, 1, 2].map((j) => (lo[j]! + hi[j]!) / 2) as V3;
    const r = Math.hypot(...sub(hi, lo)) / 2;
    const H = vesselHulls[id];
    H.points = samplePoints(verts, 10, nv, id === "endurance" ? 2 : 0.5);
    H.bvh = new TriBVH(pos, new Uint32Array(idx));
    H.radius = r + Math.hypot(...c);
    H.lo = lo;
    H.hi = hi;
    const vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, verts);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, idx);
    if (id === "lander") await this.loadMaps();
    this.meshes[id] = { vbuf, ibuf, count: ni, bound: { c, r, lo, hi } };
  }

  /**
   * The F-35 (assets/f35/f35.bin: scripts/build-f35.py): its vertices as built (the gear out, the surfaces at
   * rest; the vertex shader poses each part), its glass's triangles last; its hull for contacts; its maps.
   */
  private async loadJet() {
    const d = this.device;
    const m = (this.jetMesh = parseF35(await this.getter(f35Url).then(inflated)));
    const { verts, lo, hi } = m;
    const nv = verts.length / 10;
    // (the glass — the canopy 32, the visor 34 — last: drawn by its own pass, out of the shadow map)
    const glass = (t: number) => {
      const k = Math.round(verts[10 * m.idx[3 * t]! + 6]!);
      return k === 32 || k === 34;
    };
    const idx = new Uint32Array(m.idx.length);
    let o = 0,
      solid = 0;
    for (const g of [false, true])
      for (let t = 0; t < m.idx.length / 3; t++)
        if (glass(t) === g) {
          idx.set(m.idx.subarray(3 * t, 3 * t + 3), 3 * o++);
          if (!g) solid = 3 * o;
        }
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) pos.set(verts.subarray(10 * i, 10 * i + 3), 3 * i);
    const c: V3 = [0, 1, 2].map((j) => (lo[j]! + hi[j]!) / 2) as V3;
    const r = Math.hypot(...sub(hi, lo)) / 2;
    const H = vesselHulls.f35;
    H.points = samplePoints(verts, 10, nv, 0.5);
    H.bvh = new TriBVH(pos, idx.slice(0, solid));
    H.radius = r + Math.hypot(...c);
    H.lo = lo;
    H.hi = hi;
    const vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, verts);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, idx);
    this.meshes.f35 = { vbuf, ibuf, count: idx.length, solid, bound: { c, r, lo, hi } };
    void this.loadJetMaps();
  }

  /** The F-35's maps: KTX2 transcoded for this GPU (BC7 / ASTC), two layers a map; drawn grey until then. */
  private async loadJetMaps() {
    if (this.jetMapsLoading) return;
    this.jetMapsLoading = true;
    const d = this.device;
    const target = ktxTarget(d);
    const make = async (urls: string[], srgb: boolean) => {
      const imgs = await Promise.all(urls.map((u) => ktxLevels(u, target)));
      const { width, height } = imgs[0]!;
      const format: GPUTextureFormat =
        target === "bc7"
          ? srgb
            ? "bc7-rgba-unorm-srgb"
            : "bc7-rgba-unorm"
          : target === "astc"
            ? srgb
              ? "astc-4x4-unorm-srgb"
              : "astc-4x4-unorm"
            : srgb
              ? "rgba8unorm-srgb"
              : "rgba8unorm";
      const tex = d.createTexture({
        size: [width, height, urls.length],
        format,
        mipLevelCount: imgs[0]!.levels.length,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      imgs.forEach((im, layer) => writeLevels(d, tex, im.levels, im.width, im.height, target, layer));
      return tex;
    };
    try {
      const [albedo, normal, mr] = await Promise.all([
        make([f35Albedo0, f35Albedo1], true),
        make([f35Normal0, f35Normal1], false),
        make([f35Mr0, f35Mr1], false),
      ]);
      this.jetMaps = { albedo, normal, mr };
      this.bind();
      this.onLoaded?.();
    } catch (e) {
      console.error("F-35 maps:", e);
    }
  }

  /** The vessel's box in its own frame (x left, y up, z nose) [m]: its mesh's, the Ranger's gear out with it — the
   *  walking astronaut keeps out of it; null: its mesh not loaded. */
  hullBound(id: VesselId): { lo: V3; hi: V3 } | null {
    const m = this.meshes[id];
    if (!m) return null;
    const lo: V3 = [...m.bound.lo],
      hi: V3 = [...m.bound.hi];
    if (id === "ranger") {
      const g = this.gearMesh().bound;
      for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, g.lo[k]!)), (hi[k] = Math.max(hi[k]!, g.hi[k]!));
    }
    return { lo, hi };
  }

  /** The Ranger's landing gear's mesh (gear-mesh.ts), made once. */
  private gearMesh(): Mesh {
    if (this.gearMeshBuf) return this.gearMeshBuf;
    const g = gearMesh();
    const d = this.device;
    const vbuf = d.createBuffer({ size: g.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, g.verts);
    const ibuf = d.createBuffer({ size: g.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, g.idx);
    const c: V3 = [0, 1, 2].map((j) => (g.lo[j]! + g.hi[j]!) / 2) as V3;
    return (this.gearMeshBuf = {
      vbuf,
      ibuf,
      count: g.idx.length,
      bound: { c, r: Math.hypot(...sub(g.hi, g.lo)) / 2, lo: g.lo, hi: g.hi },
    });
  }

  /** A pixel's ray in the ship's frame (the last frame's camera; ndc: −1…1, y up): from the eye, unit. */
  cabinRay(ndcX: number, ndcY: number): { o: V3; d: V3 } | null {
    const C = this.lastCam;
    if (!C) return null;
    const c: V3 = [ndcX * C.tanX, ndcY * C.tanY, 1];
    const d: V3 = [0, 1, 2].map((k) => c[0] * C.R[0]![k]! + c[1] * C.R[1]![k]! + c[2] * C.R[2]![k]!) as V3;
    const l = Math.hypot(...d);
    return { o: [...this.camShip] as V3, d: [d[0] / l, d[1] / l, d[2] / l] };
  }

  /** A point of the ship's frame in the last frame's view: its ndc (y up), or null behind the eye. */
  cabinProject(p: V3): [number, number] | null {
    const C = this.lastCam;
    if (!C) return null;
    const q: V3 = [p[0] - this.camShip[0], p[1] - this.camShip[1], p[2] - this.camShip[2]];
    const c = C.R.map((r) => r[0]! * q[0] + r[1]! * q[1] + r[2]! * q[2]) as V3;
    return c[2] > 1e-3 ? [c[0] / (c[2] * C.tanX), c[1] / (c[2] * C.tanY)] : null;
  }

  /** The Ranger's cockpit (assets/ranger/cockpit.bin, gzip: scripts/build-cockpit.ts), when first needed. */
  private loadCockpit() {
    if (this.cockpitLoading) return;
    this.cockpitLoading = true;
    const d = this.device;
    this.getter(cockpitUrl)
      .then(async (r) => {
        // (served compressed: inflated here)
        const buf = await inflated(r);
        if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "CKPT") throw new Error("bad cockpit.bin");
        const [ver, nv, ni] = new Uint32Array(buf, 4, 3) as unknown as [number, number, number];
        const bb = new Float32Array(buf, 16, 6);
        const lo: V3 = [bb[0]!, bb[1]!, bb[2]!],
          hi: V3 = [bb[3]!, bb[4]!, bb[5]!];
        let off = 40;
        const pivots: V3[] = [];
        if (ver >= 2) {
          const n = new Uint32Array(buf, 40, 1)[0]!;
          for (let i = 0; i < n; i++) {
            const p = new Float32Array(buf, 44 + 16 * i, 3);
            pivots.push([p[0]!, p[1]!, p[2]!]);
          }
          off = 44 + 16 * n;
        }
        const verts = new Float32Array(buf.slice(off, off + nv * STRIDE));
        const idx0 = new Uint32Array(buf.slice(off + nv * STRIDE, off + nv * STRIDE + ni * 4));
        this.screenLights = screenLights(verts, idx0);
        // (the glass's triangles last: its pass draws them alone)
        const isGlass = (t: number) => Math.round(verts[10 * idx0[3 * t]! + 6]!) === 71;
        const idx = new Uint32Array(ni);
        let o = 0;
        for (const glassPass of [false, true])
          for (let t = 0; t < ni / 3; t++) if (isGlass(t) === glassPass) idx.set(idx0.subarray(3 * t, 3 * t + 3), o++ * 3);
        let firstGlass = 0;
        while (firstGlass < ni / 3 && !isGlassTri(idx, verts, firstGlass)) firstGlass++;
        const vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(vbuf, 0, verts);
        const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(ibuf, 0, idx);
        const c: V3 = [0, 1, 2].map((j) => (lo[j]! + hi[j]!) / 2) as V3;
        const bound = { c, r: Math.hypot(...sub(hi, lo)) / 2, lo, hi };
        // (its controls: generated — cockpit/controls.ts —, drawn after it, their moving parts posed)
        const cm = controlMesh();
        const cv = d.createBuffer({ size: cm.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(cv, 0, cm.verts);
        const ci = d.createBuffer({ size: cm.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(ci, 0, cm.idx);
        this.ctlBuf ??= d.createBuffer({ size: MAX_CONTROLS * POSE_VEC4 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(this.ctlBuf, 0, poseData({}));
        this.cockpit = {
          mesh: { vbuf, ibuf, count: ni, bound },
          pivots,
          solid: firstGlass * 3,
          controls: { vbuf: cv, ibuf: ci, count: cm.idx.length, bound },
        };
        // (its walls for the camera moving about it: the triangles in a hierarchy)
        const pos = new Float32Array(nv * 3);
        for (let i = 0; i < nv; i++) pos.set(verts.subarray(10 * i, 10 * i + 3), 3 * i);
        cockpitHull.bvh = new TriBVH(pos, idx);
        cockpitHull.verts = verts;
        cockpitHull.lo = lo;
        cockpitHull.hi = hi;
        this.onLoaded?.();
      })
      .catch((e) => console.error("cockpit:", e));
  }

  /** The Lander's maps: colour (sRGB), normals, the lights' emission (sRGB); mip-mapped here. */
  private async loadMaps() {
    const d = this.device;
    const tex = async (url: string, format: GPUTextureFormat) => {
      const img = await createImageBitmap(await this.getter(url).then((r) => r.blob()));
      const levels = Math.floor(Math.log2(Math.max(img.width, img.height))) + 1;
      const t = d.createTexture({
        size: [img.width, img.height],
        format,
        mipLevelCount: levels,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      for (let l = 0; l < levels; l++) {
        const w = Math.max(1, img.width >> l),
          h = Math.max(1, img.height >> l);
        const b = l === 0 ? img : await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
        d.queue.copyExternalImageToTexture({ source: b }, { texture: t, mipLevel: l }, [w, h]);
      }
      return t;
    };
    const [albedo, normal, lights] = await Promise.all([
      tex(landerAlbedoUrl, "rgba8unorm-srgb"),
      tex(landerNormalUrl, "rgba8unorm"),
      tex(landerLightsUrl, "rgba8unorm-srgb"),
    ]);
    this.maps = { albedo, normal, lights };
    // (the shading's bind groups hold the maps: made again)
    this.bind();
  }

  private bindGen = 0;
  private bind() {
    const d = this.device;
    const raw = (l: number) => this.envRaw.createView({ baseMipLevel: l, mipLevelCount: 1 });
    const spec = (l: number) => this.envSpec.createView({ baseMipLevel: l, mipLevelCount: 1 });
    const envSamp = d.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat" });
    this.envBinds = {
      copy: [raw(0), spec(0)].map((view) =>
        d.createBindGroup({
          layout: this.pipes.copy.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.envBuf } },
            { binding: 1, resource: view },
          ],
        }),
      ),
      down: Array.from({ length: RAW_MIPS - 1 }, (_, i) =>
        d.createBindGroup({
          layout: this.pipes.down.getBindGroupLayout(0),
          entries: [
            { binding: 1, resource: raw(i + 1) },
            { binding: 2, resource: raw(i) },
          ],
        }),
      ),
      ggx: Array.from({ length: SPEC_MIPS - 1 }, (_, i) =>
        d.createBindGroup({
          layout: this.pipes.ggx.getBindGroupLayout(0),
          entries: [
            { binding: 1, resource: spec(i + 1) },
            { binding: 2, resource: this.envRaw.createView() },
            { binding: 4, resource: envSamp },
            { binding: 5, resource: { buffer: this.ggxBufs[i + 1]! } },
          ],
        }),
      ),
      sh: d.createBindGroup({
        layout: this.pipes.sh.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.envBuf } },
          { binding: 3, resource: { buffer: this.shBuf } },
        ],
      }),
    };
    const samp = d.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
      maxAnisotropy: 8,
    });
    const cmp = d.createSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" });
    const dummy = (format: GPUTextureFormat) => d.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING });
    const maps = this.maps ?? { albedo: dummy("rgba8unorm-srgb"), normal: dummy("rgba8unorm"), lights: dummy("rgba8unorm-srgb") };
    // (the F-35's: grey, flat, mid-rough until they load)
    const dummyArray = (px: number[], format: GPUTextureFormat) => {
      const t = d.createTexture({ size: [1, 1, 2], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      d.queue.writeTexture({ texture: t }, new Uint8Array([...px, ...px]), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, 2]);
      return t;
    };
    const jm = this.jetMaps ?? {
      albedo: dummyArray([110, 112, 116, 255], "rgba8unorm-srgb"),
      normal: dummyArray([128, 128, 255, 255], "rgba8unorm"),
      mr: dummyArray([255, 110, 40, 255], "rgba8unorm"),
    };
    this.shipEntries = [
      { binding: 0, resource: { buffer: this.uniform } },
      { binding: 1, resource: { buffer: this.shBuf } },
      { binding: 2, resource: this.envSpec.createView() },
      { binding: 3, resource: samp },
      { binding: 7, resource: this.shadowTex.createView() },
      { binding: 8, resource: cmp },
      { binding: 9, resource: { buffer: this.jetBuf } },
      { binding: 12, resource: { buffer: this.instBuf } },
      { binding: 13, resource: maps.albedo.createView() },
      { binding: 14, resource: maps.normal.createView() },
      { binding: 15, resource: maps.lights.createView() },
      { binding: 16, resource: this.mapSamp },
      { binding: 22, resource: jm.albedo.createView({ dimension: "2d-array" }) },
      { binding: 23, resource: jm.normal.createView({ dimension: "2d-array" }) },
      { binding: 24, resource: jm.mr.createView({ dimension: "2d-array" }) },
      { binding: 25, resource: this.jetScreenTexture().createView() },
      // (the airliners' paint: a light grey until it loads)
      {
        binding: 26,
        resource: (this.trafficMaps ?? dummyArray([200, 202, 206, 255], "rgba8unorm-srgb")).createView({ dimension: "2d-array" }),
      },
    ];
    this.bindGen++;

    // (the hull's passes read the instances: the F-35's parts posed)
    const pb = (p: GPURenderPipeline, jets = true) =>
      d.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          ...(jets ? [{ binding: 9, resource: { buffer: this.jetBuf } }] : [{ binding: 12, resource: { buffer: this.instBuf } }]),
        ],
      });
    this.plumeBinds = {
      plume: pb(this.pipes.plume),
      plumeIn: pb(this.pipes.plumeIn),
      hullDepth: pb(this.pipes.hullDepth, false),
      glow: pb(this.pipes.glow, false),
      dist: pb(this.pipes.dist, false),
    };
    this.shadowBind = d.createBindGroup({
      layout: this.pipes.shadow.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.shBuf } },
        { binding: 12, resource: { buffer: this.instBuf } },
      ],
    });
  }

  /** Parts of the raster left out, to measure what each costs (the e2e's A/B): "shadow", "pre" (the depth
   *  pre-pass), "hull" (the craft's solid triangles), "glass" (the F-35's canopy and visor; "glass-sr" without the
   *  traced image's reflection, "glass-flat" a flat tint), "plume" (the flames, trails, lamps). */
  debugSkip = new Set<string>();
  private glassPipe?: (mode: number) => GPURenderPipeline;
  private glassModes: GPURenderPipeline[] = [];

  /** Probe → box mips, GGX pre-filtered mips, spherical harmonics (after the tracer's env pass). */
  encodeEnv(enc: GPUCommandEncoder) {
    if (!this.envBinds) return;
    const groups = (l: number) => [Math.ceil(Math.max(1, ENV_W >> l) / 8), Math.ceil(Math.max(1, ENV_H >> l) / 8)] as const;
    let pass = enc.beginComputePass(this.pass("ship probe: mips"));
    pass.setPipeline(this.pipes.copy);
    for (const g of this.envBinds.copy) {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(ENV_W / 8, ENV_H / 8);
    }
    pass.setPipeline(this.pipes.down);
    this.envBinds.down.forEach((g, i) => {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(...groups(i + 1));
    });
    pass.end();
    pass = enc.beginComputePass(this.pass("ship probe: GGX"));
    pass.setPipeline(this.pipes.ggx);
    this.envBinds.ggx.forEach((g, i) => {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(...groups(i + 1));
    });
    pass.end();
    pass = enc.beginComputePass(this.pass("ship probe: SH"));
    pass.setPipeline(this.pipes.sh);
    pass.setBindGroup(0, this.envBinds.sh);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  /**
   * The thrusters firing now → the jets' buffer: both main engines at the throttle; each attitude
   * thruster by how much its push helps the translation asked and its torque the rotation asked,
   * pulsed (as real RCS valves are) when that is little.
   */
  private writeJets(th: Thrust | null | undefined) {
    const out = this.jetData;
    let n = 0;
    let haze: ShipRenderer["haze"] = null;
    if (th) {
      const air = Math.min(Math.max(th.air, 0), 1);
      const V = VESSELS[this.vessel];
      const defs: JetDef[] = V.jets;
      for (let i = 0; i < defs.length && n < MAX_JETS; i++) {
        let J = defs[i]!;
        // (which fire, how hard: jets.ts — the sound's the same)
        const level = jetLevel(V, J, i, th);
        if (level <= 0) continue;
        // (an air-breathing engine's — the F-35's: kind 2 — its afterburner's share in u.w: the flame is the
        // afterburner's, a few metres; dry, the exhaust is clear)
        const jet = J.main && this.vessel === "f35";
        // (the F-35B's nozzle swivelled: the plume from its exit, along it)
        const ex = jet ? this.jetExit : null;
        if (ex) J = { ...J, p: ex.p, d: ex.d };
        const ab = jet ? Math.min(Math.max(((th.boost ?? 1) - 1) / 0.5, 0), 1) : 0;
        if (jet) haze = { p: J.p, d: J.d, r: J.half[0], k: air * Math.min(0.35 + 0.65 * level + 0.8 * ab, 1.4) };
        const len = jet ? 2.5 + 8 * ab : J.main ? (4 + 20 * level) * (1 - 0.45 * air) * V.flame : 1.2 + 1.6 * level;
        out.set([...J.p, level, ...J.d, jet ? 2 : J.main ? 0 : 1, J.half[0], J.half[1], len, (i * 0.618) % 1, ...J.u, ab], n * JET_FLOATS);
        // (the camera inside its proxy — the shader's frustum, a margin for the near plane)
        const spread = J.main ? 0.16 * (1 - air) + 0.03 * air : 0.45;
        const o = sub(this.camShip, J.p);
        const sAx = dot(o, J.d);
        const rad = (h: number) => (h + Math.max(sAx, 0) * spread) * 1.45 + 0.05 + 0.3;
        this.jetInside[n] =
          sAx > -0.45 &&
          sAx < 0.85 * len + 0.3 &&
          Math.abs(dot(o, J.u)) < rad(J.half[0]) &&
          Math.abs(dot(o, cross(J.d, J.u))) < rad(J.half[1]);
        n++;
      }
    }
    this.jetCount = n;
    this.haze = haze;
    if (n) this.device.queue.writeBuffer(this.jetBuf, 0, out, 0, n * JET_FLOATS);
  }

  /**
   * The others' main jets (docs/PLAN-RESEAU.md R1), after the flown craft's in the same buffer: each brought
   * from its craft's frame into the flown craft's (the jets' pass draws them there) — an F-35's from its
   * nozzle's exit as its pose has it, its afterburner's flame with its boost.
   */
  private appendJets(
    lit: { id: VesselId; R: M3; t: V3; thrust: NonNullable<ShipInstance["thrust"]>; exit: { p: V3; d: V3 } | null }[],
    R0: M3,
    t0: V3,
    time: number,
  ) {
    const out = this.jetData;
    let n = this.jetCount;
    const first = n;
    // (a camera-frame point and vector → the flown craft's frame: R0ᵀ (x − t0))
    const back = (w: V3): V3 => [0, 1, 2].map((j) => R0[0]![j]! * w[0] + R0[1]![j]! * w[1] + R0[2]![j]! * w[2]) as V3;
    for (const r of lit) {
      const V = VESSELS[r.id];
      const air = Math.min(Math.max(r.thrust.air, 0), 1);
      V.jets.forEach((J0, i) => {
        if (!J0.main || n >= MAX_JETS) return;
        const level = jetLevel(V, J0, i, {
          throttle: r.thrust.throttle,
          boost: r.thrust.boost,
          force: [0, 0, 0],
          torque: [0, 0, 0],
          time,
          air,
        });
        if (level <= 0) return;
        const jet = r.id === "f35";
        const J = jet && r.exit ? { ...J0, p: r.exit.p, d: r.exit.d } : J0;
        const ab = jet ? Math.min(Math.max((r.thrust.boost - 1) / 0.5, 0), 1) : 0;
        const len = jet ? 2.5 + 8 * ab : (4 + 20 * level) * (1 - 0.45 * air) * V.flame;
        const toCam = (q: V3): V3 => [dot(r.R[0]!, q), dot(r.R[1]!, q), dot(r.R[2]!, q)];
        const pc = toCam(J.p);
        const p = back([pc[0] + r.t[0] - t0[0], pc[1] + r.t[1] - t0[1], pc[2] + r.t[2] - t0[2]]);
        const d = back(toCam(J.d));
        const u = back(toCam(J.u));
        out.set([...p, level, ...d, jet ? 2 : 0, J.half[0], J.half[1], len, (i * 0.618 + n * 0.37) % 1, ...u, ab], n * JET_FLOATS);
        const spread = 0.16 * (1 - air) + 0.03 * air;
        const o = sub(this.camShip, p);
        const sAx = dot(o, d);
        const rad = (h: number) => (h + Math.max(sAx, 0) * spread) * 1.45 + 0.35;
        this.jetInside[n] =
          sAx > -0.45 && sAx < 0.85 * len + 0.3 && Math.abs(dot(o, u)) < rad(J.half[0]) && Math.abs(dot(o, cross(d, u))) < rad(J.half[1]);
        n++;
      });
    }
    if (n > first) this.device.queue.writeBuffer(this.jetBuf, first * JET_FLOATS * 4, out, first * JET_FLOATS, (n - first) * JET_FLOATS);
    this.jetCount = n;
  }

  private writeUniform(v: ShipView, mesh: Mesh) {
    this.bound = mesh.bound;
    const { S: R, t } = v.place ?? shipToCamera(v.mount, v.look[0], v.look[1]);
    // (the camera in the ship's frame: −Rᵀ t)
    this.camShip = [0, 1, 2].map((k) => -(R[0]![k]! * t[0] + R[1]![k]! * t[1] + R[2]![k]! * t[2])) as V3;
    this.writeJets(this.flown ? v.thrust : null);
    // column-major mat4: columns = images of the ship's x, y, z axes, then the translation
    const m = new Float32Array(56);
    const model = (R: M3, t: V3, out: Float32Array, o: number) => {
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[o + c * 4 + r] = R[r]![c]!;
      out.set([...t, 1], o + 12);
    };
    model(R, t, m, 0);
    const tanH = Math.tan((v.fov * Math.PI) / 360);
    this.lastCam = { R, tanX: tanH * v.aspect, tanY: tanH };
    // (the landing gear: out, its oleos' compression — ship.wgsl S.gear)
    const gc = v.gear?.comp ?? [];
    this.device.queue.writeBuffer(
      this.uniform,
      448,
      new Float32Array([v.gear?.ext ?? 0, gc[0] ?? 0, gc[1] ?? 0, gc[2] ?? 0, ...GEAR_HINGES.flatMap((h) => [...h.at, h.door])]),
    );
    if (v.controls && this.ctlBuf) this.device.queue.writeBuffer(this.ctlBuf, 0, v.controls);
    // (the flown craft's lamps, those lit — ship.wgsl S.lampN, S.lamp: the Ranger's, the F-35's)
    {
      const defs = this.vessel === "ranger" ? RANGER_LAMPS : this.vessel === "f35" ? F35_LAMPS : null;
      const H = defs ? vesselHulls[this.vessel as "ranger" | "f35"].bvh : null;
      if (defs && H && !this.lampsPlaced[this.vessel]) this.lampsPlaced[this.vessel] = placeLamps(H, defs);
      const placed = this.lampsPlaced[this.vessel] ?? null;
      const on = this.flown && !!defs && !!v.lamps && !!placed;
      // (each hidden by the hull from where the eye is — a ray against its triangles, not its depth drawn
      // again: that cost 1.3 ms a frame —, stopped 60 cm short: the lips round a lamp, a wingtip's own skin seen from above, do not hide it)
      const levels = on ? lampLevels(defs!, v.lamps!, v.lamps!.t) : [];
      // (the F-35's landing light rides its nose gear: lit only with the gear down)
      if (on && this.vessel === "f35") defs!.forEach((L, i) => L.kind === "landing" && (v.jet?.gear ?? 1) < 0.97 && (levels[i] = 0));
      if (on && H)
        placed!.forEach((L, i) => {
          if (!levels[i]) return;
          const e = this.camShip;
          const d = Math.hypot(L.p[0] - e[0], L.p[1] - e[1], L.p[2] - e[2]);
          const k = Math.max(d - 0.6, 0) / d;
          if (H.segment(e, [e[0] + (L.p[0] - e[0]) * k, e[1] + (L.p[1] - e[1]) * k, e[2] + (L.p[2] - e[2]) * k])) levels[i] = 0;
        });
      const u = on ? lampUniform(placed!, levels) : new Float32Array(4);
      this.lampCount = u[0]!;
      this.device.queue.writeBuffer(this.uniform, LAMPS_AT, u);
    }
    // (the cabin's light: the lamps, the screens — ship.wgsl S.cab, S.scr)
    if (v.inside)
      this.device.queue.writeBuffer(
        this.uniform,
        512,
        cabinUniform(v.cabin ?? { level: 1, red: 0 }, this.screenLights, v.cabin?.colours ?? null),
      );
    const c = R.map((r) => dot(r, this.bound.c) + 0) as V3;
    // near and far planes about the ship where it is (the outside views: up to tens of km — not a fixed
    // 80 m, beyond which it vanished), its plumes (a few hundred metres) within them
    const dist = Math.hypot(c[0] + t[0], c[1] + t[1], c[2] + t[2]);
    const reach = this.bound.r * 1.2 + 400;
    // (the others in view — an aggressor kilometres off —: the far plane out to them)
    const farOthers = Math.max(0, ...(v.others ?? []).map((o) => Math.hypot(...o.t) + 60));
    m.set([tanH * v.aspect, tanH, Math.max(0.05, Math.min(dist - reach, 0.5 * dist)), Math.max(80, dist + reach, farOthers)], 16);
    m.set([v.albedo, v.metal, v.rough, SPEC_MIPS], 20);
    // the instances: the flown craft, then the others in view whose mesh is there — their transforms,
    // their kind, whether they are in the shadow map and hidden by what the traced image holds nearer
    const kind = {
      ranger: 0,
      lander: 1,
      endurance: 2,
      f35: 3,
      a320: 4,
      crj900: 5,
      cargo: 6,
      tanker: 7,
      ferry: 8,
      trawler: 9,
      sailboat: 10,
      ford: 11,
      kiev: 12,
      implacable: 13,
      frigate: 14,
    } as const;
    let jetSlot = 0;
    // (inside the Ranger: its cabin instead of its hull)
    if (v.inside && this.flown && this.vessel === "ranger") this.loadCockpit();
    const inCabin = !!(v.inside && this.flown && this.vessel === "ranger" && this.cockpit);
    this.inCabin = inCabin;
    const sea = v.sea ?? null;
    const list: {
      id: ShipMeshId;
      R: M3;
      t: V3;
      shadow: boolean;
      far: boolean;
      jet?: F35Pose;
      thrust?: ShipInstance["thrust"];
      big?: boolean;
      mirror: boolean;
    }[] = this.flown ? [{ id: this.vessel, R, t, shadow: true, far: !!v.place, mirror: !!sea?.flown }] : [];
    for (const o of v.others ?? [])
      if (list.length < MAX_INST && this.meshes[o.id])
        list.push({
          id: o.id,
          R: o.S,
          t: o.t,
          shadow: o.shadow,
          far: o.far ?? true,
          jet: o.jet,
          thrust: o.thrust,
          big: o.big,
          mirror: !!sea && (o.mirror ?? sea.flown),
        });
    // (the nearest carrier within 20 km: the map's second half)
    let big = -1;
    list.forEach((it, i) => {
      if (it.big && Math.hypot(...it.t) < 20_000 && (big < 0 || Math.hypot(...it.t) < Math.hypot(...list[big]!.t))) big = i;
    });
    // (the others' engines firing: their jets after the flown craft's — appendJets)
    const lit: { id: VesselId; R: M3; t: V3; thrust: NonNullable<ShipInstance["thrust"]>; exit: { p: V3; d: V3 } | null }[] = [];
    this.draws = [];
    this.bound2 = null;
    const corners: V3[] = [];
    // (the shadow map's sphere: about the flown craft and those near it)
    let sc: V3 | null = null,
      sr = 0;
    list.forEach((it, i) => {
      const me = i === 0 && inCabin ? this.cockpit!.mesh : this.meshes[it.id]!;
      model(it.R, it.t, this.instData, i * INST_FLOATS);
      // (an F-35: its parts' maps after the instances — the flown one's pose, the others' at rest)
      let parts = 0;
      if (it.id === "f35" && this.jetMesh && jetSlot < JET_SLOTS) {
        parts = MAX_INST + jetSlot++ * MAX_PARTS;
        let pose = i === 0 && this.flown ? (v.jet ?? restPose()) : (it.jet ?? restPose());
        if (i === 0 && v.inside) pose = { ...pose, pilot: false };
        const mats = partMatrices(this.jetMesh, pose);
        this.writeParts(mats, parts);
        if (i === 0) this.jetExit = nozzleExit(this.jetMesh, mats);
        else if (it.thrust) lit.push({ id: "f35", R: it.R, t: it.t, thrust: it.thrust, exit: nozzleExit(this.jetMesh, mats) });
      } else if (i > 0 && it.thrust && !isTraffic(it.id)) lit.push({ id: it.id, R: it.R, t: it.t, thrust: it.thrust, exit: null });
      // (in the shadow maps: the first half's — 1 —, the second's — 2 —; hidden behind the traced image — bit 0 —,
      // mirrored in the sea — bit 1)
      const second = i === big;
      this.instData.set([kind[it.id], it.shadow ? 1 : second ? 2 : 0, (it.far ? 1 : 0) + (it.mirror ? 2 : 0), parts], i * INST_FLOATS + 16);
      this.draws.push({
        mesh: me,
        shadow: it.shadow || second,
        cabin: i === 0 && inCabin,
        inst: i,
        mirror: it.mirror && !(i === 0 && inCabin),
      });
      // (the Ranger's landing gear, out: drawn with it — its own mesh, the craft's instance)
      const gear = it.id === "ranger" && !(i === 0 && inCabin) && (v.gear?.ext ?? 0) > 0 ? this.gearMesh() : null;
      if (gear) this.draws.push({ mesh: gear, shadow: it.shadow, inst: i });
      for (const b of gear ? [me.bound, gear.bound] : [me.bound])
        for (let k = 0; k < 8; k++) {
          const q: V3 = [k & 1 ? b.hi[0] : b.lo[0], k & 2 ? b.hi[1] : b.lo[1], k & 4 ? b.hi[2] : b.lo[2]];
          const c: V3 = [dot(it.R[0]!, q) + it.t[0], dot(it.R[1]!, q) + it.t[1], dot(it.R[2]!, q) + it.t[2]];
          corners.push(c);
          // (its image in the sea: on the screen too)
          if (it.mirror && sea) {
            const h = dot(sea.n, c) - sea.d;
            if (h > 0) corners.push([c[0] - 2 * h * sea.n[0], c[1] - 2 * h * sea.n[1], c[2] - 2 * h * sea.n[2]]);
          }
        }
      const b = me.bound;
      if (second)
        this.bound2 = { c: [dot(it.R[0]!, b.c) + it.t[0], dot(it.R[1]!, b.c) + it.t[1], dot(it.R[2]!, b.c) + it.t[2]], r: b.r * 1.02 };
      if (!it.shadow) return;
      const cc: V3 = [dot(it.R[0]!, b.c) + it.t[0], dot(it.R[1]!, b.c) + it.t[1], dot(it.R[2]!, b.c) + it.t[2]];
      if (!sc) (sc = cc), (sr = b.r);
      else {
        // (the smallest sphere holding both)
        const d = Math.hypot(...sub(cc, sc));
        if (d + b.r > sr) {
          if (d + sr <= b.r) (sc = cc), (sr = b.r);
          else {
            const R2 = (d + sr + b.r) / 2;
            const k2 = (R2 - sr) / Math.max(d, 1e-9);
            sc = [sc[0] + (cc[0] - sc[0]) * k2, sc[1] + (cc[1] - sc[1]) * k2, sc[2] + (cc[2] - sc[2]) * k2];
            sr = R2;
          }
        }
      }
    });
    this.device.queue.writeBuffer(this.instBuf, 0, this.instData, 0, list.length * INST_FLOATS);
    if (jetSlot)
      this.device.queue.writeBuffer(
        this.instBuf,
        MAX_INST * INST_FLOATS * 4,
        this.instData,
        MAX_INST * INST_FLOATS,
        jetSlot * MAX_PARTS * INST_FLOATS,
      );
    // (none in the shadow map: its sphere about the first, unused)
    if (!sc) (sc = list[0]!.t), (sr = this.meshes[list[0]!.id]!.bound.r);
    m.set([sc[0], sc[1], sc[2], sr * 1.02], 24);
    this.onScreen = { c: sc, r: sr * 1.02, tx: tanH * v.aspect, ty: tanH, corners };
    m.set([v.light * (v.pre ?? 1), v.coat, v.pre ?? 1, 0], 28);
    m.set(v.plasma ?? [0, 0, 1, 0], 32);
    const ax = v.probeAxes ?? [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    ax.forEach((a, i) => m.set([...a, 0], 36 + 4 * i));
    m.set([0, 0, 1, 1], 48); // (the whole image: encodeShip narrows it to the ship's box)
    if (lit.length && this.flown) this.appendJets(lit, R, t, v.thrust?.time ?? 0);
    m.set([this.jetCount, v.glow ?? 1, v.thrust?.time ?? 0, v.thrust?.air ?? 0], 52);
    this.device.queue.writeBuffer(this.uniform, 0, m);
    const b2 = this.bound2 as { c: V3; r: number } | null;
    this.device.queue.writeBuffer(
      this.uniform,
      SEA_AT,
      new Float32Array([
        ...(b2 ? [...b2.c, b2.r] : [0, 0, 0, 0]),
        ...(sea ? [...sea.n, sea.d] : [0, 1, 0, -1e9]),
        sea?.hs ?? 0,
        sea?.t ?? 0,
        0,
        0,
      ]),
    );
    this.writeReentry(v.reentry, mesh);
    const tr = this.flown ? v.contrails : null;
    this.trailCount = tr ? Math.min(tr.n, MAX_SEGMENTS) : 0;
    if (this.trailCount) this.device.queue.writeBuffer(this.trailBuf, 0, tr!.data, 0, this.trailCount * SEG_FLOATS);
    // the cockpit: the sticks following the attitude commands (the effort the wheels give: the pilot's
    // and the autopilots'), eased over a tenth of a second; the dashboard's figures
    if (inCabin) {
      const th = v.thrust;
      const tq = th?.torque ?? [0, 0, 0];
      const want: V3 = [-tq[0] * 0.26, -tq[2] * 0.26, -tq[1] * 0.2];
      const now = th?.time ?? 0;
      const k = Number.isFinite(this.stickAt) ? 1 - Math.exp(-Math.max(now - this.stickAt, 0) / 0.1) : 1;
      this.stickAt = now;
      this.stick = this.stick.map((a, j) => a + (want[j]! - a) * k) as V3;
      const P = this.cockpit!.pivots;
      const D = v.dash ?? { up: [0, 1, 0], fwd: [0, 0, 1], speed: 0, alt: 0, time: now };
      this.device.queue.writeBuffer(
        this.uniform,
        256,
        new Float32Array([
          ...this.stick,
          th?.throttle ?? 0,
          ...(P[0] ?? [1.2, 1.2, 2.9]),
          0,
          ...(P[1] ?? [-1.2, 1.2, 2.9]),
          0,
          ...D.up,
          D.speed,
          ...D.fwd,
          D.alt,
          D.time,
          0,
          0,
          th?.throttle ?? 0,
        ]),
      );
    }
  }
  /** The F-35's parts' maps (rows of 3 × 4, partMatrices) into the instance records from `base`: each a mat4,
   *  column-major (ship.wgsl jetMap). */
  private writeParts(m: Float32Array, base: number) {
    const n = Math.min(m.length / 12, MAX_PARTS);
    for (let k = 0; k < n; k++) {
      const o = (base + k) * INST_FLOATS,
        r = 12 * k;
      for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) this.instData[o + c * 4 + row] = m[r + row * 4 + c]!;
      this.instData[o + 3] = this.instData[o + 7] = this.instData[o + 11] = 0;
      this.instData[o + 12] = m[r + 3]!;
      this.instData[o + 13] = m[r + 7]!;
      this.instData[o + 14] = m[r + 11]!;
      this.instData[o + 15] = 1;
    }
  }

  /**
   * The re-entry's uniforms: the flow (ship frame) and the plasma's level from the heat flux (from
   * 40 kW/m², full by 2 MW/m²), the skin's temperatures, Mach and the air's density, the gas's glow; the
   * body along the flow — its front and back from its centre, its radius across the flow (from its box's
   * projected area), the wake's length.
   */
  private writeReentry(re: Reentry | null | undefined, mesh: Mesh) {
    const blk = new Float32Array(24);
    this.reOn = { glow: false, sheath: false };
    if (re && this.flown) {
      const lev = Math.min(Math.max((Math.log10(Math.max(re.heat, 1)) - 4.6) / 1.7, 0), 1);
      const { lo, hi } = mesh.bound;
      const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const L: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const u = norm(re.u);
      let front = -Infinity,
        back = Infinity;
      for (let k = 0; k < 8; k++) {
        const q: V3 = [(k & 1 ? hi[0] : lo[0]) - c[0], (k & 2 ? hi[1] : lo[1]) - c[1], (k & 4 ? hi[2] : lo[2]) - c[2]];
        const d = dot(q, u);
        front = Math.max(front, d);
        back = Math.min(back, d);
      }
      const area = 0.75 * (Math.abs(u[0]) * L[1] * L[2] + Math.abs(u[1]) * L[0] * L[2] + Math.abs(u[2]) * L[0] * L[1]);
      const Rp = Math.sqrt(area / Math.PI);
      const vapour = re.mach > 0.85 && re.mach < 1.15 && re.rho > 0.25;
      this.reOn = { glow: Math.max(re.shield, re.hull) > 720, sheath: lev > 0 || vapour };
      blk.set([
        ...u,
        lev,
        re.shield,
        re.hull,
        re.mach,
        re.rho / 1.225,
        ...re.glow,
        0,
        0,
        0,
        0,
        0,
        front,
        back,
        Rp,
        Rp * (4 + 14 * lev),
        ...c,
        re.time,
      ]);
    }
    this.device.queue.writeBuffer(this.uniform, 352, blk);
  }

  /** the cabin drawn this frame (its glass then) */
  private inCabin = false;
  private cabinBinds: { gen: number; cabin: GPUBindGroup; glass: GPUBindGroup; ctl: GPUBindGroup } | null = null;
  /** the cockpit's screens: the telemetry drawn (ui/cockpitscreens.ts), 4 × 2 slots, mip-mapped */
  private screens: GPUTexture | null = null;
  /** The controls' placards (cockpit/placards.ts), drawn once. */
  private placardTexture() {
    if (this.placards) return this.placards;
    const lv = placardLevels();
    const tex = this.device.createTexture({
      size: [lv[0]!.width, lv[0]!.height],
      format: "rgba8unorm",
      mipLevelCount: lv.length,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    lv.forEach((c, l) => this.device.queue.copyExternalImageToTexture({ source: c }, { texture: tex, mipLevel: l }, [c.width, c.height]));
    return (this.placards = tex);
  }
  private placards: GPUTexture | null = null;

  private screenTexture() {
    return (this.screens ??= this.device.createTexture({
      size: [2048, 1024],
      format: "rgba8unorm-srgb",
      mipLevelCount: 11,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
  }
  /** The F-35's panoramic display's picture (src/f35/pcd.ts), mip-mapped: made at its first use. */
  private jetScreen: GPUTexture | null = null;
  private jetScreenTexture() {
    return (this.jetScreen ??= this.device.createTexture({
      size: [PCD_W, PCD_H],
      format: "rgba8unorm-srgb",
      mipLevelCount: 8,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
  }
  private jetMipCanvases: OffscreenCanvas[] = [];
  /** The panoramic display's new picture: its canvas, then its mips (halved on canvases). */
  updateJetScreen(src: OffscreenCanvas | HTMLCanvasElement) {
    const tex = this.jetScreenTexture();
    let level: HTMLCanvasElement | OffscreenCanvas = src;
    for (let l = 0; l < tex.mipLevelCount; l++) {
      const w = Math.max(1, PCD_W >> l),
        h = Math.max(1, PCD_H >> l);
      if (l > 0) {
        const c = (this.jetMipCanvases[l] ??= new OffscreenCanvas(w, h));
        const g = c.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.clearRect(0, 0, w, h);
        g.drawImage(level, 0, 0, w, h);
        level = c;
      }
      this.device.queue.copyExternalImageToTexture({ source: level }, { texture: tex, mipLevel: l }, [w, h]);
    }
  }

  /** The screens' new picture: a 2048 × 1024 canvas, then its mips (halved on canvases). */
  updateScreens(src: HTMLCanvasElement | OffscreenCanvas) {
    const tex = this.screenTexture();
    let level: HTMLCanvasElement | OffscreenCanvas = src;
    for (let l = 0; l < tex.mipLevelCount; l++) {
      const w = Math.max(1, 2048 >> l),
        h = Math.max(1, 1024 >> l);
      if (l > 0) {
        const c = (this.mipCanvases[l] ??= new OffscreenCanvas(w, h));
        const g = c.getContext("2d")!;
        g.imageSmoothingQuality = "high";
        g.clearRect(0, 0, w, h);
        g.drawImage(level, 0, 0, w, h);
        level = c;
      }
      this.device.queue.copyExternalImageToTexture({ source: level }, { texture: tex, mipLevel: l }, [w, h]);
    }
  }
  private mipCanvases: OffscreenCanvas[] = [];
  /** Whether the cabin is drawn (its screens are worth drawing). */
  get cabinShown() {
    return this.inCabin;
  }
  private depthBind: GPUBindGroup | null = null;

  /** The ship's own images for an HDR target (its size): created on first use. */
  target(hdr: GPUTexture): ShipTargetRes {
    let res = this.targets.get(hdr);
    if (!res || res.w !== hdr.width || res.h !== hdr.height) {
      if (res) this.forget(hdr);
      const resolved = this.device.createTexture({
        size: [hdr.width, hdr.height],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const plume = this.device.createTexture({
        size: [Math.ceil(hdr.width / 2), Math.ceil(hdr.height / 2)],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const plumeDepth = this.device.createTexture({
        size: [plume.width, plume.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const hullDist = this.device.createTexture({
        size: [plume.width, plume.height],
        format: "r16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      res = { w: hdr.width, h: hdr.height, resolved, box: null, rect: [0, 0, 0, 0], plume, plumeDepth, plumeDirty: true, hullDist };
      this.targets.set(hdr, res);
    }
    return res;
  }

  /** Where the ship was drawn last in this target's image: [x, y, w, h] (for the display). */
  rectFor(hdr: GPUTexture): [number, number, number, number] {
    return this.targets.get(hdr)?.rect ?? [0, 0, 0, 0];
  }

  /**
   * Draws the ship for an HDR target: the shadow map; the shading with 4× MSAA in targets the size of
   * its box on screen (its bounding sphere's, rounded up by 128 px: a chase view's ship covers a
   * fraction of the image — the whole-screen MSAA clear and resolve cost as much as the drawing),
   * resolved and copied into its image, which the display composites over the traced one.
   */
  encodeShip(
    enc: GPUCommandEncoder,
    hdr: GPUTexture,
    v: ShipView,
    occluder?: { depth: GPUTexture; rect: [number, number, number, number] },
    sceneDepth?: GPUBuffer,
  ) {
    if (!this.ready) return;
    // (none flown: only the others — the Ranger's mesh, always there, for the plumes' unused range)
    this.flown = !!v.vessel;
    this.vessel = v.vessel ?? "ranger";
    const mesh = this.meshes[this.vessel];
    if (!this.has(this.vessel) || !mesh) return;
    for (const o of v.others ?? []) this.has(o.id);
    if (!this.flown && !(v.others ?? []).some((o) => this.meshes[o.id])) return;
    const res = this.target(hdr);
    this.writeUniform(v, mesh);
    // (the image's size and the metres per M: the other craft's depths against the traced image's)
    this.device.queue.writeBuffer(this.uniform, 240, new Float32Array([hdr.width, hdr.height, v.mPerM ?? 1, sceneDepth ? 1 : 0]));
    // the box: the sphere's screen box within the image, its size rounded up (few re-allocations)
    const W = hdr.width,
      H = hdr.height;
    const sc = this.scissor(W, H);
    const up = (x: number, max: number) => Math.min(max, Math.max(128, Math.ceil(x / 128) * 128));
    const bw = up(sc[2], W),
      bh = up(sc[3], H);
    const x0 = Math.min(Math.max(sc[0], 0), W - bw),
      y0 = Math.min(Math.max(sc[1], 0), H - bh);
    if (!res.box || res.box.w !== bw || res.box.h !== bh) {
      const old = res.box;
      if (old) this.device.queue.onSubmittedWorkDone().then(() => [old.color, old.depth, old.small].forEach((t) => t.destroy()));
      const d = this.device,
        size = [bw, bh];
      res.box = {
        w: bw,
        h: bh,
        color: d.createTexture({ size, format: "rgba16float", sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
        depth: d.createTexture({
          size,
          format: "depth32float",
          sampleCount: 4,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        }),
        small: d.createTexture({ size, format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
      };
    }
    // (the box's ndc: centre and scale of the full image's ndc; y up, pixels down)
    this.device.queue.writeBuffer(this.uniform, 192, new Float32Array([(2 * x0 + bw) / W - 1, 1 - (2 * y0 + bh) / H, W / bw, H / bh]));
    // (the station's box and depth: it hides the hull where it stands before it)
    const occ = occluder && occluder.rect[2] > 0 ? occluder : null;
    this.device.queue.writeBuffer(this.uniform, 224, new Float32Array(occ ? occ.rect : [0, 0, 0, 0]));
    const occTex =
      occ?.depth ??
      (this.occDummy ??= this.device.createTexture({ size: [1, 1], format: "rg16float", usage: GPUTextureUsage.TEXTURE_BINDING }));
    if (res.occBind?.tex !== occTex) {
      res.occBind = {
        tex: occTex,
        g: this.device.createBindGroup({
          layout: this.pipes!.ship.getBindGroupLayout(1),
          entries: [{ binding: 0, resource: occTex.createView() }],
        }),
      };
    }
    res.rect = [x0, y0, bw, bh];
    // (the self-shadowing, every other frame: the light turns slowly against the ship)
    // (a carrier in the map: each frame — it moves across the view, its shadow with it)
    if (!this.debugSkip.has("shadow") && (v.forceShadow || this.bound2 || this.shadowTick++ % 2 === 0)) {
      const sp = enc.beginRenderPass(
        this.pass("ship: shadow map", {
          colorAttachments: [],
          depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
        }),
      );
      sp.setPipeline(this.pipes.shadow);
      sp.setBindGroup(0, this.shadowBind!);
      this.draws.forEach((dr) => {
        if (!dr.shadow) return;
        sp.setVertexBuffer(0, dr.mesh.vbuf);
        sp.setIndexBuffer(dr.mesh.ibuf, "uint32");
        sp.drawIndexed(dr.cabin ? this.cockpit!.solid : (dr.mesh.solid ?? dr.mesh.count), 1, 0, 0, dr.inst);
      });
      sp.end();
    }
    const b = res.box;
    const jets = this.jetCount > 0;
    const rp = enc.beginRenderPass(
      this.pass("ship: shading (MSAA)", {
        colorAttachments: [
          {
            view: b.color.createView(),
            resolveTarget: b.small.createView(),
            loadOp: "clear",
            storeOp: "discard",
            clearValue: [0, 0, 0, 0],
          },
        ],
        depthStencilAttachment: { view: b.depth.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
      }),
    );
    // the depth pre-pass (its bindings: the uniform, the instances)
    this.depthBind ??= this.device.createBindGroup({
      layout: this.pipes.depthPre.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 12, resource: { buffer: this.instBuf } },
      ],
    });
    rp.setPipeline(this.pipes.depthPre);
    rp.setBindGroup(0, this.depthBind);
    if (!this.debugSkip.has("pre"))
      this.draws.forEach((dr) => {
        rp.setVertexBuffer(0, dr.mesh.vbuf);
        rp.setIndexBuffer(dr.mesh.ibuf, "uint32");
        rp.drawIndexed(dr.cabin ? this.cockpit!.solid : (dr.mesh.solid ?? dr.mesh.count), 1, 0, 0, dr.inst);
      });
    rp.setPipeline(this.pipes.ship);
    // (the traced image the craft are drawn over: its sharp reflections — ship.wgsl screenRefl —, its
    // depths: what hides the other craft)
    const mb = sceneDepth ?? (this.momentsBuf ??= this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }));
    if (!res.bind || res.bindGen !== this.bindGen || res.bindMoments !== mb) {
      res.bind = this.device.createBindGroup({
        layout: this.pipes!.ship.getBindGroupLayout(0),
        entries: [...this.shipEntries!, { binding: 10, resource: hdr.createView() }, { binding: 11, resource: { buffer: mb } }],
      });
      res.bindGen = this.bindGen;
      res.bindMoments = mb;
    }
    rp.setBindGroup(0, res.bind);
    rp.setBindGroup(1, res.occBind!.g);
    this.draws.forEach((dr) => {
      if (dr.cabin || this.debugSkip.has("hull")) return;
      rp.setVertexBuffer(0, dr.mesh.vbuf);
      rp.setIndexBuffer(dr.mesh.ibuf, "uint32");
      rp.drawIndexed(dr.mesh.solid ?? dr.mesh.count, 1, 0, 0, dr.inst);
    });
    // the craft's images in the sea, where nothing else is drawn
    const mirrored = v.sea ? this.draws.filter((dr) => dr.mirror) : [];
    if (mirrored.length) {
      if (!res.mirrorBind || res.mirrorGen !== this.bindGen || res.mirrorMoments !== mb || res.mirrorHdr !== hdr) {
        res.mirrorBind = this.device.createBindGroup({
          layout: this.pipes.mirror.getBindGroupLayout(0),
          entries: [...this.shipEntries!, { binding: 10, resource: hdr.createView() }, { binding: 11, resource: { buffer: mb } }],
        });
        res.mirrorGen = this.bindGen;
        res.mirrorMoments = mb;
        res.mirrorHdr = hdr;
      }
      if (res.mirrorOcc?.tex !== occTex)
        res.mirrorOcc = {
          tex: occTex,
          g: this.device.createBindGroup({
            layout: this.pipes.mirror.getBindGroupLayout(1),
            entries: [{ binding: 0, resource: occTex.createView() }],
          }),
        };
      rp.setPipeline(this.pipes.mirror);
      rp.setBindGroup(0, res.mirrorBind);
      rp.setBindGroup(1, res.mirrorOcc.g);
      for (const dr of mirrored) {
        rp.setVertexBuffer(0, dr.mesh.vbuf);
        rp.setIndexBuffer(dr.mesh.ibuf, "uint32");
        rp.drawIndexed(dr.mesh.solid ?? dr.mesh.count, 1, 0, 0, dr.inst);
      }
    }
    // the F-35's glass, over all that (its canopy, the helmet's visor)
    const glassy = this.draws.filter((dr) => !dr.cabin && dr.mesh.solid !== undefined && dr.mesh.solid < dr.mesh.count);
    if (glassy.length && !this.debugSkip.has("glass")) {
      if (!res.jetGlassBind || res.jetGlassGen !== this.bindGen || res.jetGlassHdr !== hdr) {
        const keep = [0, 1, 2, 3, 12, 16, 22];
        res.jetGlassBind = this.device.createBindGroup({
          layout: this.pipes.jetGlass.getBindGroupLayout(0),
          entries: [...this.shipEntries!.filter((e) => keep.includes(e.binding)), { binding: 10, resource: hdr.createView() }],
        });
        res.jetGlassGen = this.bindGen;
        res.jetGlassHdr = hdr;
      }
      const gm = this.debugSkip.has("glass-flat") ? 2 : this.debugSkip.has("glass-sr") ? 1 : 0;
      if (gm && !this.glassModes[gm]) this.glassModes[gm] = this.glassPipe!(gm);
      const gp = gm ? this.glassModes[gm]! : this.pipes.jetGlass;
      rp.setPipeline(gp);
      rp.setBindGroup(
        0,
        gm
          ? this.device.createBindGroup({
              layout: gp.getBindGroupLayout(0),
              entries: [
                ...this.shipEntries!.filter((e) => [0, 1, 2, 3, 12, 16, 22].includes(e.binding)),
                { binding: 10, resource: hdr.createView() },
              ],
            })
          : res.jetGlassBind,
      );
      for (const dr of glassy) {
        rp.setVertexBuffer(0, dr.mesh.vbuf);
        rp.setIndexBuffer(dr.mesh.ibuf, "uint32");
        rp.drawIndexed(dr.mesh.count - dr.mesh.solid!, 1, dr.mesh.solid!, 0, dr.inst);
      }
    }
    // the cabin (its own shader), then its glass, over the cabin and the view
    if (this.inCabin && this.cockpit) {
      if (!this.cabinBinds || this.cabinBinds.gen !== this.bindGen) {
        const make = (layout: GPUBindGroupLayout) =>
          this.device.createBindGroup({
            layout,
            entries: [
              ...this.shipEntries!.filter((e) => [0, 1, 2, 3, 7, 8, 12].includes(e.binding)),
              { binding: 17, resource: this.screenTexture().createView() },
              { binding: 20, resource: { buffer: this.ctlBuf! } },
              { binding: 21, resource: this.placardTexture().createView() },
            ],
          });
        this.cabinBinds = {
          gen: this.bindGen,
          cabin: make(this.pipes.cabin.getBindGroupLayout(0)),
          glass: make(this.pipes.glass.getBindGroupLayout(0)),
          ctl: make(this.pipes.ctl.getBindGroupLayout(0)),
        };
      }
      rp.setVertexBuffer(0, this.cockpit.mesh.vbuf);
      rp.setIndexBuffer(this.cockpit.mesh.ibuf, "uint32");
      // (the solid triangles, then the glass's — the last of the indices)
      const ck = this.cockpit;
      rp.setPipeline(this.pipes.cabin);
      rp.setBindGroup(0, this.cabinBinds.cabin);
      rp.drawIndexed(ck.solid, 1, 0, 0, 0);
      // (its controls, their moving parts posed — before the glass, which blends over all)
      rp.setPipeline(this.pipes.ctl);
      rp.setBindGroup(0, this.cabinBinds.ctl);
      rp.setVertexBuffer(0, ck.controls.vbuf);
      rp.setIndexBuffer(ck.controls.ibuf, "uint32");
      rp.drawIndexed(ck.controls.count, 1, 0, 0, 0);
      rp.setVertexBuffer(0, ck.mesh.vbuf);
      rp.setIndexBuffer(ck.mesh.ibuf, "uint32");
      rp.setPipeline(this.pipes.glass);
      rp.setBindGroup(0, this.cabinBinds.glass);
      rp.drawIndexed(ck.mesh.count - ck.solid, 1, ck.solid, 0, 0);
    }
    rp.end();
    const re = this.reOn;
    const trails = this.trailCount > 0;
    // (from the cabin, its walls hide them: not drawn)
    const lamps = this.lampCount > 0 && !this.inCabin;
    if ((jets || re.glow || re.sheath || trails || lamps) && !this.debugSkip.has("plume")) {
      const B = this.plumeBinds!;
      // (what hides the flames and the plasma: the hull — from inside, the cabin's walls, not its glass)
      const occl =
        this.inCabin && this.cockpit ? { m: this.cockpit.mesh, n: this.cockpit.solid } : { m: mesh, n: mesh.solid ?? mesh.count };
      if (re.sheath) {
        const dp = enc.beginRenderPass(
          this.pass("ship: hull distance", {
            colorAttachments: [{ view: res.hullDist.createView(), loadOp: "clear", storeOp: "store", clearValue: [60000, 0, 0, 0] }],
            depthStencilAttachment: {
              view: res.plumeDepth.createView(),
              depthClearValue: 1,
              depthLoadOp: "clear",
              depthStoreOp: "discard",
            },
          }),
        );
        dp.setPipeline(this.pipes.dist);
        dp.setBindGroup(0, B.dist);
        dp.setVertexBuffer(0, occl.m.vbuf);
        dp.setIndexBuffer(occl.m.ibuf, "uint32");
        dp.drawIndexed(occl.n);
        dp.end();
      }
      const pp = enc.beginRenderPass(
        this.pass("ship: thrusters and plasma", {
          colorAttachments: [{ view: res.plume.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
          depthStencilAttachment: { view: res.plumeDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
        }),
      );
      // (the lamps alone: hidden by rays — writeUniform —, the hull's depth not needed)
      if (jets || re.glow || re.sheath || trails) {
        pp.setPipeline(this.pipes.hullDepth);
        pp.setBindGroup(0, B.hullDepth);
        pp.setVertexBuffer(0, occl.m.vbuf);
        pp.setIndexBuffer(occl.m.ibuf, "uint32");
        pp.drawIndexed(occl.n);
      }
      for (const inside of [false, true]) {
        pp.setPipeline(inside ? this.pipes.plumeIn : this.pipes.plume);
        pp.setBindGroup(0, inside ? B.plumeIn : B.plume);
        for (let i = 0; i < this.jetCount; i++) if (this.jetInside[i] === inside) pp.draw(36, 1, 0, i);
      }
      if (trails) {
        if (!res.trailBind || res.trailMoments !== mb) {
          res.trailBind = this.device.createBindGroup({
            layout: this.pipes.trail.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.uniform } },
              { binding: 1, resource: { buffer: this.shBuf } },
              { binding: 11, resource: { buffer: mb } },
              { binding: 19, resource: { buffer: this.trailBuf } },
            ],
          });
          res.trailMoments = mb;
        }
        pp.setPipeline(this.pipes.trail);
        pp.setBindGroup(0, res.trailBind);
        pp.draw(6, this.trailCount);
      }
      if (lamps) {
        if (!res.lampBind || res.lampMoments !== mb) {
          res.lampBind = this.device.createBindGroup({
            layout: this.pipes.lamp.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.uniform } },
              { binding: 11, resource: { buffer: mb } },
            ],
          });
          res.lampMoments = mb;
        }
        pp.setPipeline(this.pipes.lamp);
        pp.setBindGroup(0, res.lampBind);
        pp.draw(6, this.lampCount);
      }
      if (re.glow && !this.inCabin) {
        pp.setPipeline(this.pipes.glow);
        pp.setBindGroup(0, B.glow);
        pp.setVertexBuffer(0, mesh.vbuf);
        pp.setIndexBuffer(mesh.ibuf, "uint32");
        pp.drawIndexed(mesh.count);
      }
      if (re.sheath) {
        res.sheathBind ??= this.device.createBindGroup({
          layout: this.pipes.sheath.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 18, resource: res.hullDist.createView() },
          ],
        });
        pp.setPipeline(this.pipes.sheath);
        pp.setBindGroup(0, res.sheathBind);
        pp.draw(36);
      }
      pp.end();
      res.plumeDirty = true;
    } else if (res.plumeDirty) {
      // (the flames out: their image cleared once)
      enc
        .beginRenderPass({
          colorAttachments: [{ view: res.plume.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        })
        .end();
      res.plumeDirty = false;
    }
    enc.copyTextureToTexture({ texture: b.small }, { texture: res.resolved, origin: [x0, y0] }, [bw, bh]);
  }

  /** Frees the per-target buffers of a destroyed HDR texture. */
  forget(hdr: GPUTexture) {
    const r = this.targets.get(hdr);
    if (!r) return;
    r.resolved.destroy();
    r.plume.destroy();
    r.plumeDepth.destroy();
    r.hullDist.destroy();
    if (r.box) [r.box.color, r.box.depth, r.box.small].forEach((t) => t.destroy());
    this.targets.delete(hdr);
  }
}
