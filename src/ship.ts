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
import { thinGlass } from "./f35/glass-shell";
import { nozzleExit, parseF35, partMatrices, restPose, type F35Mesh, type F35Pose } from "./f35/model";
import a320Bin from "../assets/a320/a320.bin";
import a320Albedo1 from "../assets/a320/a320-albedo-1.ktx2";
import a320Albedo2 from "../assets/a320/a320-albedo-2.ktx2";
import a320Normal0 from "../assets/a320/a320-normal-0.ktx2";
import a320Normal1 from "../assets/a320/a320-normal-1.ktx2";
import a320Normal2 from "../assets/a320/a320-normal-2.ktx2";
import liveryKerr from "../assets/a320/a320-livery-kerr.ktx2";
import liveryKerrEng from "../assets/a320/a320-livery-kerr-engine.ktx2";
import liveryWhite from "../assets/a320/a320-livery-white.ktx2";
import liveryWhiteEng from "../assets/a320/a320-livery-white-engine.ktx2";
import liverySwr from "../assets/a320/a320-livery-SWR.ktx2";
import liverySwrEng from "../assets/a320/a320-livery-SWR-engine.ktx2";
import liveryAua from "../assets/a320/a320-livery-AUA.ktx2";
import liveryAuaEng from "../assets/a320/a320-livery-AUA-engine.ktx2";
import liveryDal from "../assets/a320/a320-livery-DAL.ktx2";
import liveryDalEng from "../assets/a320/a320-livery-DAL-engine.ktx2";
import liveryAal from "../assets/a320/a320-livery-AAL.ktx2";
import liveryAalEng from "../assets/a320/a320-livery-AAL-engine.ktx2";
import { parseA320, partCount, rigMatrices, type A320Mesh, type Props } from "./a320/rig";
import a320DeckBin from "../assets/a320/a320-cockpit.bin";
import a320Deck0 from "../assets/a320/a320-cockpit-0.ktx2";
import a320Deck1 from "../assets/a320/a320-cockpit-1.ktx2";
import a320Deck2 from "../assets/a320/a320-cockpit-2.ktx2";
import a320Deck3 from "../assets/a320/a320-cockpit-3.ktx2";
import { parseDeck, type DeckMesh } from "./a320/deck";
import { restA320 } from "./a320/pose";

/** the A320 at rest (gear down, everything neutral): the others' without their own pose */
const A320_REST = restA320();
import { PCD_H, PCD_W } from "./f35/pcd-size";
import type { PcdRect } from "./f35/pcd";
import { MipGen } from "./mipgen";
import { ktxLevels, ktxTarget, writeLevels } from "./system/ktx2";

import { shipToCamera, type M3, type Mount, type MountPose } from "./mounts";
import { controlMesh, MAX_CONTROLS, POSE_VEC4, poseData } from "./cockpit/controls";
import { placardLevels } from "./cockpit/placards";
import { cabinUniform, screenLights, type ScreenLight } from "./cockpit/lights";
import {
  F35_LAMPS,
  type Glare,
  lampLevels,
  lampUniform,
  MAX_GLARES,
  MAX_LAMPS,
  placeLamps,
  RANGER_LAMPS,
  type PlacedLamp,
} from "./ship-lights";
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
import mrttUrl from "../assets/traffic/mrtt.bin";
import drogueUrl from "../assets/traffic/drogue.bin";
import probeUrl from "../assets/traffic/probe.bin";
import lampRedUrl from "../assets/traffic/lamp-red.bin";
import gsTugUrl from "../assets/traffic/gs-tug.bin";
import gsStairsUrl from "../assets/traffic/gs-stairs.bin";
import gsGpuUrl from "../assets/traffic/gs-gpu.bin";
import gsFuelUrl from "../assets/traffic/gs-fuel.bin";
import gsCateringUrl from "../assets/traffic/gs-catering.bin";
import gsCateringBoxUrl from "../assets/traffic/gs-catering-box.bin";
import gsChockNoseUrl from "../assets/traffic/gs-chock-nose.bin";
import gsChockLeftUrl from "../assets/traffic/gs-chock-left.bin";
import gsChockRightUrl from "../assets/traffic/gs-chock-right.bin";
import gsDeiceUrl from "../assets/traffic/gs-deice.bin";
import gsBeltUrl from "../assets/traffic/gs-belt.bin";
import lampAmberUrl from "../assets/traffic/lamp-amber.bin";
import lampGreenUrl from "../assets/traffic/lamp-green.bin";
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
export type AirlinerId = "a320t" | "crj900";
export type ShipTypeId = "cargo" | "tanker" | "ferry" | "trawler" | "sailboat" | "frigate";
/** The carriers (scripts/build-carriers.ts, docs/PLAN-AVIATION-AAA.md M2). */
export type CarrierId = "ford" | "kiev" | "implacable";
/** The air refuelling's (scripts/build-tanker.ts, game/aar.ts): the tanker, its hose and drogue, the F-35's probe, the
 *  pods' lights. */
export type AarMeshId = "mrtt" | "drogue" | "probe" | "lamp-red" | "lamp-amber" | "lamp-green";
/** The A320's ground vehicles (scripts/build-a320-services.py — FlightGear's Models/Services): the pushback tug, the
 *  stairs, the external power box, the fuel truck, the catering loader and its box, the chocks, the de-icing
 *  truck, the baggage belt — coloured per vertex (material 90, as the carriers' flat parts). */
export type GroundMeshId =
  | "gs-tug"
  | "gs-stairs"
  | "gs-gpu"
  | "gs-fuel"
  | "gs-catering"
  | "gs-catering-box"
  | "gs-chock-nose"
  | "gs-chock-left"
  | "gs-chock-right"
  | "gs-deice"
  | "gs-belt";
export type TrafficMeshId = AirlinerId | ShipTypeId | CarrierId | AarMeshId | GroundMeshId;
/** A mesh the craft's pass draws: a craft's, an airliner's, a ship's. */
export type ShipMeshId = VesselId | TrafficMeshId;
const TRAFFIC_MESHES: Record<TrafficMeshId, string> = {
  a320t: a320Url,
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
  mrtt: mrttUrl,
  drogue: drogueUrl,
  probe: probeUrl,
  "lamp-red": lampRedUrl,
  "lamp-amber": lampAmberUrl,
  "lamp-green": lampGreenUrl,
  "gs-tug": gsTugUrl,
  "gs-stairs": gsStairsUrl,
  "gs-gpu": gsGpuUrl,
  "gs-fuel": gsFuelUrl,
  "gs-catering": gsCateringUrl,
  "gs-catering-box": gsCateringBoxUrl,
  "gs-chock-nose": gsChockNoseUrl,
  "gs-chock-left": gsChockLeftUrl,
  "gs-chock-right": gsChockRightUrl,
  "gs-deice": gsDeiceUrl,
  "gs-belt": gsBeltUrl,
};
/** The traffic's colour maps, a layer each (ship.wgsl: the materials 40, 41, 44–46); the carriers' after them
 *  (80–86), added with the first carrier drawn. */
const TRAFFIC_MAPS = [a320MapUrl, crj900MapUrl, cargoHullUrl, cargoBridgeUrl, cargoBoxesUrl];
const CARRIER_MAPS = [ford0Url, ford1Url, ford2Url, kiev0Url, kiev1Url, implacable0Url, implacable1Url];
/** The A320's liveries (assets/a320/liveries.json — scripts/build-a320-maps.py): its fuselage's paint (layer 0) and its
 *  engines' (layer 2's first cell). */
export const A320_LIVERIES: Record<string, [string, string]> = {
  kerr: [liveryKerr, liveryKerrEng],
  white: [liveryWhite, liveryWhiteEng],
  SWR: [liverySwr, liverySwrEng],
  AUA: [liveryAua, liveryAuaEng],
  DAL: [liveryDal, liveryDalEng],
  AAL: [liveryAal, liveryAalEng],
};
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
  /** an A320's rig's properties and spins (src/a320/pose.ts — another player's); none: at rest */
  a320?: { props: Props; spins: Props };
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
  /** the flown craft's own opaque parts drawn alone too, for the next frame's cockpit mask (renderer encodeCockpitMask) */
  ownMask?: boolean;
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
  /** glares out in the scene, drawn as the lamps' (a fight's flares — PLAN-RADAR-AAA RD8a): on the camera's axes */
  glares?: Glare[];
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
  /** the flown A320's: its rig's properties and spins (src/a320/pose.ts) */
  a320?: { props: Props; spins: Props } | null;
  /** its flight deck's rig's properties (src/a320/deck.ts — drawn from inside) */
  a320Deck?: Props | null;
  /** the F-35's panoramic display's look (ship.wgsl pcdLight): its brightness (0…1), its style (0 realistic, 1
   *  cinematic), the last touch (u, v on the display; its age [s]), the last page changed (its part, u0 v0 u1 v1;
   *  its age [s]) */
  pcd?: PcdLook | null;
  /** the A320's windshield seen from its flight deck (src/a320/glass.ts): the rain on it, a clock [s], the airspeed
   *  [m/s], the frost 0…1, each wiper's place on its sweep and rate [travel / s]; none: dry, the wipers at rest */
  a320Glass?: { rain: number; clock: number; airspeed: number; frost: number; wipers: [number, number]; rates: [number, number] } | null;
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

/** The F-35's panoramic display's look (ShipView.pcd). */
export interface PcdLook {
  level: number;
  style: number;
  touch: { u: number; v: number; age: number } | null;
  change: { rect: [number, number, number, number]; age: number } | null;
}

const MAX_JETS = 40;
/** the craft drawn at once, at most */
const MAX_INST = 24;
/** ship.wgsl's Ship: up to the gear's hinges 512 bytes, then the cabin's light (S.cab, S.scr: 1 + 8 × 3 vec4s) */
/** where the lamps start in it (S.lampN) */
const LAMPS_AT = 512 + 16 + 8 * 3 * 16;
/** after them: the carrier's shadow sphere, the sea's plane and state (S.bound2, S.sea, S.seaK) */
const SEA_AT = LAMPS_AT + 16 + (MAX_LAMPS + MAX_GLARES) * 3 * 16;
/** then the F-35's panoramic display's look (S.pcd0–2) */
const PCD_AT = SEA_AT + 3 * 16;
/** then the A320's windshield (S.wg0, S.wg1 — src/a320/glass.ts) */
const GLASS_AT = PCD_AT + 3 * 16;
const SHIP_UNIFORM_BYTES = GLASS_AT + 2 * 16;
const INST_FLOATS = 20;
/** the posed aircraft's parts at most (the F-35's 119 — src/f35/model.ts —, the A320's 172 — src/a320/rig.ts), and how
 *  many aircraft drawn with their parts posed */
const MAX_PARTS = 192;
/** the A320's flight deck's parts at most (its rig's 1 194 nodes — src/a320/deck.ts —): their records after the
 *  aircraft's slots */
const DECK_PARTS = 1280;
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
  jetGlassPipe?: GPURenderPipeline;
  /** the station's depth bound (group 1), and which texture it holds */
  occBind?: { tex: GPUTexture; g: GPUBindGroup };
  /** the images in the sea's (pipes.mirror's own layouts): its bind groups, as the shading's */
  mirrorBind?: GPUBindGroup;
  mirrorGen?: number;
  mirrorMoments?: GPUBuffer;
  mirrorHdr?: GPUTexture;
  mirrorOcc?: { tex: GPUTexture; g: GPUBindGroup };
  /** the flown craft's own opaque parts alone (r8: 1 covered), its box in the image, the head and the lens then;
   *  valid: drawn the last frame */
  own?: { tex: GPUTexture; w: number; h: number; rect: [number, number, number, number]; pose: number[]; valid: boolean };
}

/**
 * The head's pose an own mask was drawn for (encodeShip's ownMask; renderer encodeCockpitMask compares the next
 * frame's): the free look's yaw and pitch, the lens, and the mount's eye, line of sight and up on the craft — a
 * named mount none (zeros): its pose the camera's own then.
 */
export function ownPose(look: [number, number], fov: number, mount: Mount | MountPose): number[] {
  if (typeof mount === "string") return [look[0], look[1], fov, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const d = [mount.aim[0] - mount.eye[0], mount.aim[1] - mount.eye[1], mount.aim[2] - mount.eye[2]];
  const dl = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
  const u = mount.up ?? [0, 1, 0];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  return [look[0], look[1], fov, ...mount.eye, d[0]! / dl, d[1]! / dl, d[2]! / dl, u[0] / ul, u[1] / ul, u[2] / ul];
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
  private instData = new Float32Array((MAX_INST + JET_SLOTS * MAX_PARTS + DECK_PARTS) * INST_FLOATS);
  /** the F-35's mesh as built (its parts, their tracks), its maps (two layers each; 1 × 1 until loaded) */
  private jetMesh: F35Mesh | null = null;
  private jetMaps: { albedo: GPUTexture; normal: GPUTexture; mr: GPUTexture } | null = null;
  private jetMapsLoading = false;
  /** the A320's mesh as built (its rig), its maps (three layers each: the livery's fuselage, the static elements,
   *  the atlas — scripts/build-a320-maps.py), the livery painted on them and the one asked */
  private a320Mesh: A320Mesh | null = null;
  private a320Maps: { albedo: GPUTexture; normal: GPUTexture } | null = null;
  private a320MapsLoading = false;
  private a320Livery = "";
  private a320LiveryWant = "kerr";
  /** the flown A320's rig maps and properties this frame (its lamps ride its parts) */
  private a320Now: { mats: Float32Array; props: Props } | null = null;
  /** the A320's flight deck (src/a320/deck.ts): loaded with its first look from inside; its maps' layers added then */
  private a320Deck: DeckMesh | null = null;
  private deckMesh: Mesh | null = null;
  private deckLoading = false;
  private deckLayers = false;
  /** the objects of the deck under the pointer (their indices: DeckMesh.objects) — lit over (main.ts); their runs */
  deckHover: number[] | null = null;
  private deckRuns: Map<number, [number, number][]> | null = null;
  private hoverBind: { g: GPUBindGroup; gen: number; hdr: GPUTexture } | null = null;
  /** the deck drawn this frame (the hull's glass then left out), its parts' maps (the pointer's picks: deckpick.ts) */
  private deckDrawn = false;
  private deckMatsNow: Float32Array<ArrayBuffer> | null = null;
  /** The A320's flight deck drawn last frame: its parts' maps (rows of 3 × 4); null: not drawn. */
  get deckMats(): Float32Array | null {
    return this.deckDrawn ? this.deckMatsNow : null;
  }
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
  /** the flown F-35's exhaust now (ship frame): its exit, its way, its radius [m], how strongly it shimmers — the
   *  A320's two CFM56s' (A13) */
  private haze: { p: V3; d: V3; r: number; k: number }[] = [];

  /**
   * The heat haze behind the F-35's nozzle in the last frame's view (display.wgsl haze): the exhaust's
   * column from its exit to some 18 m downstream, in the image's uv, its radii there [uv of the height], its
   * strength (0: none). The hot gas bends the light behind it: the background seen through it shimmers.
   */
  hazeView(k = 0): [number, number, number, number, number, number, number] | null {
    const H = this.haze[k],
      C = this.lastCam;
    if (!H || !C || H.k <= 0.01) return null;
    const len = 18;
    const view = (p: V3) => {
      const k = this.cabinOffset;
      const q: V3 = [p[0] + k[0] - this.camShip[0], p[1] + k[1] - this.camShip[1], p[2] + k[2] - this.camShip[2]];
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
    ownMask: GPURenderPipeline;
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
    const glassPipe = (mode: number, a320 = mode === 3) =>
      d.createRenderPipeline({
        layout: "auto",
        vertex,
        fragment: {
          module,
          entryPoint: "fsJetGlass",
          constants: { GLASS_MODE: mode, GLASS_A320: a320 ? 1 : 0 },
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
      // the flown craft's own opaque parts alone, covered or not (the next frame's cockpit mask)
      ownMask: d.createRenderPipeline({
        layout: "auto",
        vertex: { ...vertex, entryPoint: "depthVs" },
        fragment: { module, entryPoint: "ownMaskFs", targets: [{ format: "r8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      }),
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
    if (id === "a320") return this.loadA320();
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
    // (the glass — the canopy 32, the visor 34 — last: drawn by its own pass, out of the shadow map; one surface of each —
    // f35/glass-shell.ts: the model's four layers blended were the craft's whole cost)
    const partOf = (t: number) => Math.round(verts[10 * m.idx[3 * t]! + 6]!);
    const solidIdx: number[] = [];
    const glassIdx: Record<number, number[]> = { 32: [], 34: [] };
    for (let t = 0; t < m.idx.length / 3; t++) {
      const k = partOf(t);
      const into = k === 32 || k === 34 ? glassIdx[k]! : solidIdx;
      into.push(m.idx[3 * t]!, m.idx[3 * t + 1]!, m.idx[3 * t + 2]!);
    }
    // (the pilot's head: the visor's centre — within the canopy's shell)
    const head: V3 = [0, 0, 0];
    for (const i of glassIdx[34]!) for (let j = 0; j < 3; j++) head[j] = head[j]! + verts[10 * i + j]! / glassIdx[34]!.length;
    const inside: V3 = glassIdx[34]!.length ? head : [0, 1.95, 4.56];
    const thin = [32, 34].map((k) => thinGlass(new Uint32Array(glassIdx[k]!), verts, 10, inside));
    const idx = new Uint32Array(solidIdx.length + thin[0]!.length + thin[1]!.length);
    idx.set(solidIdx);
    idx.set(thin[0]!, solidIdx.length);
    idx.set(thin[1]!, solidIdx.length + thin[0]!.length);
    const solid = solidIdx.length;
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

  /**
   * The A320 (assets/a320/a320.bin: scripts/build-a320.py): its vertices as built (everything at rest: the vertex
   * shader poses each part by its rig node's map), its glass's and lenses' triangles last; its hull; its maps.
   */
  private async loadA320() {
    const d = this.device;
    const m = (this.a320Mesh = parseA320(await this.getter(a320Bin).then(inflated)));
    const { verts, lo, hi } = m;
    const nv = verts.length / 10;
    // (the windshield 106, the lenses 107–109, the fan's blur disc 115: drawn by the glass pass)
    const glass = (t: number) => {
      const k = Math.round(verts[10 * m.idx[3 * t]! + 6]!);
      return (k >= 106 && k <= 109) || k === 115;
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
    const H = vesselHulls.a320;
    H.points = samplePoints(verts, 10, nv, 0.6);
    H.bvh = new TriBVH(pos, idx.slice(0, solid));
    H.radius = r + Math.hypot(...c);
    H.lo = lo;
    H.hi = hi;
    const vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, verts);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, idx);
    this.meshes.a320 = { vbuf, ibuf, count: idx.length, solid, bound: { c, r, lo, hi } };
    void this.loadA320Maps();
  }

  /** The flown A320's lamps now (src/a320/rig.ts lamps — FlightGear's light models): each on the part it rides,
   *  its beam turned with it; the wingtip's those of the fences or of the sharklets fitted. */
  private a320Lamps(): PlacedLamp[] {
    const m = this.a320Mesh!;
    const now = this.a320Now;
    const sharklets = Number(now?.props["sim/multiplay/generic/int[12]"] ?? 0) > 0.5;
    const COL: Record<string, V3> = { red: [3, 0.18, 0.09], green: [0.24, 3, 0.9], white: [2.4, 2.3, 2] };
    const out: PlacedLamp[] = [];
    m.lamps.forEach((L, k) => {
      if (L.wingtip && (L.wingtip === "sharklet") !== sharklets) return;
      const M = now && L.node !== undefined && L.node >= 0 ? now.mats.subarray((L.node + 1) * 12, (L.node + 2) * 12) : null;
      const ap = (q: V3, w: number): V3 =>
        M ? ([0, 1, 2].map((r) => M[r * 4]! * q[0] + M[r * 4 + 1]! * q[1] + M[r * 4 + 2]! * q[2] + w * M[r * 4 + 3]!) as V3) : q;
      const side = L.p[0] >= 0 ? 1 : -1;
      const beam: V3 | undefined =
        L.kind === "landing"
          ? norm([0, -0.1, 1])
          : L.kind === "taxi"
            ? norm([0, -0.22, 1])
            : L.kind === "turnoff"
              ? norm([side * 0.7, -0.12, 0.7])
              : undefined;
      const colour: V3 =
        L.kind === "strobe"
          ? [4, 4, 4.4]
          : L.kind === "beacon"
            ? [4, 0.25, 0.12]
            : L.kind === "landing"
              ? [7, 6.8, 6.2]
              : L.kind === "taxi" || L.kind === "turnoff"
                ? [5, 4.9, 4.5]
                : COL[L.colour]!;
      out.push({
        id: `${L.kind}${k}`,
        kind: L.kind,
        at: L.p,
        out: [0, 1, 0],
        colour,
        beam: beam && norm(ap(beam, 0)),
        cone: beam ? Math.cos(((L.kind === "landing" ? 12 : L.kind === "taxi" ? 18 : 25) * Math.PI) / 180) : undefined,
        p: ap(L.p, 1),
        n: [0, 1, 0],
      });
    });
    return out;
  }

  /** The A320's flight deck (assets/a320/a320-cockpit.bin: scripts/build-a320-cockpit.py): its vertices as built, its
   *  glass last; its four layers of maps added to the A320's (layers 3–6). */
  private async loadA320Deck() {
    if (this.deckLoading) return;
    this.deckLoading = true;
    const d = this.device;
    const m = (this.a320Deck = parseDeck(await this.getter(a320DeckBin).then(inflated)));
    const { verts, lo, hi } = m;
    const glass = (t: number) => {
      const k = Math.round(verts[10 * m.idx[3 * t]! + 6]!);
      return k >= 127 && k <= 129;
    };
    const idx = new Uint32Array(m.idx.length);
    let o = 0,
      solid = 0;
    // (each object's runs of triangles as drawn — the pointer's highlight draws them again: deckHover)
    const runs = new Map<number, [number, number][]>();
    for (const g of [false, true])
      for (let t = 0; t < m.idx.length / 3; t++)
        if (glass(t) === g) {
          const ob = m.triObj[t]!;
          const list = runs.get(ob) ?? [];
          const last = list[list.length - 1];
          if (last && last[0] + last[1] === 3 * o) last[1] += 3;
          else list.push([3 * o, 3]);
          runs.set(ob, list);
          idx.set(m.idx.subarray(3 * t, 3 * t + 3), 3 * o++);
          if (!g) solid = 3 * o;
        }
    this.deckRuns = runs;
    const c: V3 = [0, 1, 2].map((j) => (lo[j]! + hi[j]!) / 2) as V3;
    const r = Math.hypot(...sub(hi, lo)) / 2;
    const vbuf = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbuf, 0, verts);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibuf, 0, idx);
    this.deckMesh = { vbuf, ibuf, count: idx.length, solid, bound: { c, r, lo, hi } };
    void this.loadDeckLayers();
    this.onLoaded?.();
  }

  /** The deck's maps: the A320's colour array made again with seven layers — its three, the deck's four. */
  private async loadDeckLayers() {
    if (this.deckLayers || !this.a320Maps) return;
    this.deckLayers = true;
    const d = this.device;
    const target = ktxTarget(d);
    try {
      const imgs = await Promise.all([a320Deck0, a320Deck1, a320Deck2, a320Deck3].map((u) => ktxLevels(u, target)));
      const old = this.a320Maps.albedo;
      const tex = d.createTexture({
        size: [old.width, old.height, 7],
        format: old.format,
        mipLevelCount: old.mipLevelCount,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      const enc = d.createCommandEncoder();
      for (let l = 0; l < old.mipLevelCount; l++) {
        const w = Math.max(1, old.width >> l),
          h = Math.max(1, old.height >> l);
        const bw = target === "rgba" ? w : Math.ceil(w / 4) * 4,
          bh = target === "rgba" ? h : Math.ceil(h / 4) * 4;
        enc.copyTextureToTexture({ texture: old, mipLevel: l }, { texture: tex, mipLevel: l }, [bw, bh, 3]);
      }
      d.queue.submit([enc.finish()]);
      imgs.forEach((im, k) => writeLevels(d, tex, im.levels, im.width, im.height, target, 3 + k));
      this.a320Maps = { ...this.a320Maps, albedo: tex };
      // (a livery written meanwhile went to the old array: painted again on the new one — paintA320 sees it)
      this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
      this.bind();
      this.onLoaded?.();
    } catch (e) {
      console.error("A320 deck maps:", e);
      this.deckLayers = false;
    }
  }

  /** The A320's flight deck as built (its rig, its controls, its objects) — null: not loaded. */
  get a320DeckMesh(): DeckMesh | null {
    return this.a320Deck;
  }

  /** The A320's mesh as built (its rig, its lamps) — null: not loaded. */
  get a320(): A320Mesh | null {
    return this.a320Mesh;
  }

  /** The A320's maps: the static layers, then the livery asked; drawn white until then. */
  private async loadA320Maps() {
    if (this.a320MapsLoading) return;
    this.a320MapsLoading = true;
    const d = this.device;
    const target = ktxTarget(d);
    const fmt = (srgb: boolean): GPUTextureFormat =>
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
    try {
      const [a1, a2, n0, n1, n2] = await Promise.all(
        [a320Albedo1, a320Albedo2, a320Normal0, a320Normal1, a320Normal2].map((u) => ktxLevels(u, target)),
      );
      const make = (srgb: boolean, w: number, h: number, mips: number) =>
        d.createTexture({
          size: [w, h, 3],
          format: fmt(srgb),
          mipLevelCount: mips,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        });
      const albedo = make(true, a1!.width, a1!.height, a1!.levels.length);
      const normal = make(false, n0!.width, n0!.height, n0!.levels.length);
      writeLevels(d, albedo, a1!.levels, a1!.width, a1!.height, target, 1);
      writeLevels(d, albedo, a2!.levels, a2!.width, a2!.height, target, 2);
      [n0, n1, n2].forEach((im, k) => writeLevels(d, normal, im!.levels, im!.width, im!.height, target, k));
      this.a320Maps = { albedo, normal };
      this.a320Livery = "";
      await this.paintA320();
      this.bind();
      this.onLoaded?.();
      // (the deck seen first — from the seat, at once —: its layers waited for these)
      if (this.a320Deck) void this.loadDeckLayers();
    } catch (e) {
      console.error("A320 maps:", e);
    }
  }

  /** The A320's livery (A320_LIVERIES — the house's "kerr" by default): painted when its maps are there. */
  setA320Livery(id: string) {
    this.a320LiveryWant = A320_LIVERIES[id] ? id : "kerr";
    if (this.a320Maps) void this.paintA320();
  }
  private painting = false;
  private async paintA320() {
    const want = this.a320LiveryWant;
    if (!this.a320Maps || this.painting || this.a320Livery === want) return;
    this.painting = true;
    try {
      const target = ktxTarget(this.device);
      const [fu, en] = A320_LIVERIES[want]!;
      const [F, E] = await Promise.all([ktxLevels(fu, target), ktxLevels(en, target)]);
      const tex = this.a320Maps.albedo;
      writeLevels(this.device, tex, F.levels, F.width, F.height, target, 0);
      writeLevels(this.device, tex, E.levels, E.width, E.height, target, 2, [0, 0]);
      // (the array made again meanwhile — the deck's layers added —: painted again)
      this.a320Livery = tex === this.a320Maps.albedo ? want : "";
      this.onLoaded?.();
    } catch (e) {
      console.error("A320 livery:", e);
    } finally {
      this.painting = false;
    }
    // (asked for another while this one was painted)
    if (this.a320LiveryWant !== this.a320Livery) void this.paintA320();
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
    // (in the cabin's own frame: another craft's cabin is offset — X6b–c)
    const k = this.cabinOffset;
    return { o: [this.camShip[0] - k[0], this.camShip[1] - k[1], this.camShip[2] - k[2]], d: [d[0] / l, d[1] / l, d[2] / l] };
  }
  /** the cabin's place in the flown craft's frame (another craft's than the Ranger's: its offset) [m] */
  private cabinOffset: V3 = [0, 0, 0];

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
    const dummyArray = (px: number[], format: GPUTextureFormat, layers = 2) => {
      const t = d.createTexture({ size: [1, 1, layers], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      d.queue.writeTexture(
        { texture: t },
        new Uint8Array(Array.from({ length: layers }, () => px).flat()),
        { bytesPerRow: 4, rowsPerImage: 1 },
        [1, 1, layers],
      );
      return t;
    };
    // (the A320's: white paint, flat, until they load)
    const am = this.a320Maps ?? {
      albedo: dummyArray([232, 233, 235, 255], "rgba8unorm-srgb", 3),
      normal: dummyArray([128, 128, 255, 255], "rgba8unorm", 3),
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
      { binding: 25, resource: this.screenBinding().createView() },
      // (the airliners' paint: a light grey until it loads)
      {
        binding: 26,
        resource: (this.trafficMaps ?? dummyArray([200, 202, 206, 255], "rgba8unorm-srgb")).createView({ dimension: "2d-array" }),
      },
      { binding: 27, resource: am.albedo.createView({ dimension: "2d-array" }) },
      { binding: 28, resource: am.normal.createView({ dimension: "2d-array" }) },
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
  private glassPipe?: (mode: number, a320?: boolean) => GPURenderPipeline;
  /** the glass's pipeline with the A320's code (GLASS_A320): made when one is first drawn */
  private a320GlassPipe?: GPURenderPipeline;
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
    const haze: ShipRenderer["haze"] = [];
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
        const jet = J.main && (this.vessel === "f35" || this.vessel === "a320");
        // (the F-35B's nozzle swivelled: the plume from its exit, along it)
        const ex = jet && this.vessel === "f35" ? this.jetExit : null;
        if (ex) J = { ...J, p: ex.p, d: ex.d };
        const ab = jet ? Math.min(Math.max(((th.boost ?? 1) - 1) / 0.5, 0), 1) : 0;
        // (the A320's: each CFM56's, its hot core within the bypass's cooler flow — a wider, gentler column)
        if (jet)
          haze.push(
            this.vessel === "a320"
              ? { p: J.p, d: J.d, r: J.half[0] * 1.6, k: air * Math.min(0.2 + 0.85 * level, 1.05) }
              : { p: J.p, d: J.d, r: J.half[0], k: air * Math.min(0.35 + 0.65 * level + 0.8 * ab, 1.4) },
          );
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
        const jet = r.id === "f35" || r.id === "a320";
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
      const a320 = this.vessel === "a320" && this.a320Mesh ? this.a320Lamps() : null;
      const defs = a320 ?? (this.vessel === "ranger" ? RANGER_LAMPS : this.vessel === "f35" ? F35_LAMPS : null);
      const H = defs ? vesselHulls[this.vessel as "ranger" | "f35" | "a320"].bvh : null;
      if (defs && H && !a320 && !this.lampsPlaced[this.vessel]) this.lampsPlaced[this.vessel] = placeLamps(H, defs);
      const placed = a320 ?? this.lampsPlaced[this.vessel] ?? null;
      const on = this.flown && !!defs && !!v.lamps && !!placed;
      // (each hidden by the hull from where the eye is — a ray against its triangles, not its depth drawn
      // again: that cost 1.3 ms a frame —, stopped 60 cm short: the lips round a lamp, a wingtip's own skin seen from above, do not hide it)
      const levels = on ? lampLevels(defs!, v.lamps!, v.lamps!.t) : [];
      // (the F-35's landing light rides its nose gear: lit only with the gear down)
      if (on && this.vessel === "f35") defs!.forEach((L, i) => L.kind === "landing" && (v.jet?.gear ?? 1) < 0.97 && (levels[i] = 0));
      // (the A320's: its landing lights shine extended, its taxi and turn-off lights with its nose gear down)
      if (on && a320) {
        const P = this.a320Now?.props ?? {};
        const gear = Number(P["gear/gear[0]/position-norm"] ?? 1);
        const ext = Number(P["controls/lighting/landing-light-pos-l"] ?? 0);
        // (and the deck's switches: the taxi, turn-off and wing lights off — main.ts deck/…, 1 when never set)
        const sw = (k: string) => Number(P[`deck/${k}`] ?? 1) > 0.5;
        defs!.forEach((L, i) => {
          if ((L.kind === "taxi" || L.kind === "turnoff") && gear < 0.97) levels[i] = 0;
          if (L.kind === "landing" && ext < 0.9) levels[i] = 0;
          if ((L.kind === "taxi" || L.kind === "turnoff" || L.kind === "wing") && !sw(L.kind)) levels[i] = 0;
        });
      }
      if (on && H)
        placed!.forEach((L, i) => {
          if (!levels[i]) return;
          const e = this.camShip;
          const d = Math.hypot(L.p[0] - e[0], L.p[1] - e[1], L.p[2] - e[2]);
          const k = Math.max(d - 0.6, 0) / d;
          if (H.segment(e, [e[0] + (L.p[0] - e[0]) * k, e[1] + (L.p[1] - e[1]) * k, e[2] + (L.p[2] - e[2]) * k])) levels[i] = 0;
        });
      const u = lampUniform(on ? placed! : [], levels, v.glares ?? []);
      this.lampCount = u[0]! + u[1]!;
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
      a320: 21,
      a320t: 4,
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
      mrtt: 15,
      drogue: 16,
      probe: 17,
      "lamp-red": 18,
      "lamp-amber": 19,
      "lamp-green": 20,
      "gs-tug": 22,
      "gs-stairs": 22,
      "gs-gpu": 22,
      "gs-fuel": 22,
      "gs-catering": 22,
      "gs-catering-box": 22,
      "gs-chock-nose": 22,
      "gs-chock-left": 22,
      "gs-chock-right": 22,
      "gs-deice": 22,
      "gs-belt": 22,
    } as const;
    let jetSlot = 0;
    // (inside the Ranger: its cabin instead of its hull — the Lander's and the Endurance's the same cabin placed at their
    // cockpit's: PLAN-VAISSEAUX X6b–c)
    const hasCabin = this.vessel === "ranger" || !!VESSELS[this.vessel as VesselId]?.cabin;
    if (v.inside && this.flown && hasCabin) this.loadCockpit();
    const inCabin = !!(v.inside && this.flown && hasCabin && this.cockpit);
    this.inCabin = inCabin;
    this.cabinOffset = inCabin ? (VESSELS[this.vessel as VesselId]?.cabin?.offset ?? [0, 0, 0]) : [0, 0, 0];
    const sea = v.sea ?? null;
    const list: {
      id: ShipMeshId;
      R: M3;
      t: V3;
      shadow: boolean;
      far: boolean;
      jet?: F35Pose;
      a320?: ShipInstance["a320"];
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
          a320: o.a320,
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
      // (the cabin in another craft: moved by its offset on the craft's axes)
      const o = i === 0 && inCabin ? this.cabinOffset : null;
      const tt: V3 = o ? ([0, 1, 2].map((r) => it.t[r]! + it.R[r]![0]! * o[0] + it.R[r]![1]! * o[1] + it.R[r]![2]! * o[2]) as V3) : it.t;
      model(it.R, tt, this.instData, i * INST_FLOATS);
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
      } else if (it.id === "a320" && this.a320Mesh && jetSlot < JET_SLOTS && partCount(this.a320Mesh) <= MAX_PARTS) {
        // (an A320: its rig's maps — the flown one's, another's as it sent them, else at rest)
        parts = MAX_INST + jetSlot++ * MAX_PARTS;
        const R = i === 0 && this.flown ? v.a320 : it.a320;
        const mats = rigMatrices(this.a320Mesh, R?.props ?? A320_REST.props, R?.spins ?? {});
        this.writeParts(mats, parts);
        // (its wings' bend: the tip's rise in its first part's record — ship.wgsl a320Flex, src/a320/flex.ts)
        this.instData[parts * INST_FLOATS + 16] = Number(R?.props?.["sim/wing-flex"] ?? 0) || 0;
        if (i === 0 && this.flown) this.a320Now = { mats, props: R?.props ?? A320_REST.props };
        if (i > 0 && it.thrust) lit.push({ id: "a320", R: it.R, t: it.t, thrust: it.thrust, exit: null });
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
    // (inside the flown A320: its flight deck — its own instance after the others', its rig's maps after the jets')
    let nInst = list.length;
    this.deckDrawn = false;
    if (this.vessel === "a320" && this.flown && v.inside) {
      void this.loadA320Deck();
      const dm = this.deckMesh,
        deck = this.a320Deck;
      if (dm && deck && nInst < MAX_INST && partCount(deck) <= DECK_PARTS) {
        const at = MAX_INST + JET_SLOTS * MAX_PARTS;
        model(R, t, this.instData, nInst * INST_FLOATS);
        const mats = rigMatrices(deck, v.a320Deck ?? {}, {}, this.deckMatsNow ?? undefined);
        this.deckMatsNow = mats;
        this.writeParts(mats, at, DECK_PARTS);
        this.instData.set([kind.a320, 1, v.place ? 1 : 0, at], nInst * INST_FLOATS + 16);
        this.draws.push({ mesh: dm, shadow: true, inst: nInst++ });
        this.deckDrawn = true;
        this.device.queue.writeBuffer(this.instBuf, at * INST_FLOATS * 4, this.instData, at * INST_FLOATS, partCount(deck) * INST_FLOATS);
      }
    }
    this.device.queue.writeBuffer(this.instBuf, 0, this.instData, 0, nInst * INST_FLOATS);
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
    const P = v.pcd;
    this.device.queue.writeBuffer(
      this.uniform,
      PCD_AT,
      new Float32Array([
        ...(P?.touch ? [P.touch.u, P.touch.v, P.touch.age] : [0, 0, -1]),
        P?.style ?? 0,
        P?.level ?? 1,
        P?.change ? P.change.age : -1,
        0,
        0,
        ...(P?.change ? P.change.rect : [0, 0, 0, 0]),
      ]),
    );
    const G = v.a320Glass;
    this.device.queue.writeBuffer(
      this.uniform,
      GLASS_AT,
      new Float32Array(G ? [G.rain, G.clock, G.airspeed, G.frost, ...G.wipers, ...G.rates] : [0, 0, 0, 0, 0, 0, 0, 0]),
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
  private writeParts(m: Float32Array, base: number, max = MAX_PARTS) {
    const n = Math.min(m.length / 12, max);
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
  /** The A320's displays' atlas (src/a320/du: 4096², each display a cell — deck.ts screens), mip-mapped: made with
   *  the first picture; bound in the F-35's display's place while the A320 is flown. */
  private duTex: GPUTexture | null = null;
  private screenBound: "jet" | "du" = "jet";
  private screenBinding(): GPUTexture {
    this.screenBound = this.vessel === "a320" && this.duTex ? "du" : "jet";
    return this.screenBound === "du" ? this.duTex! : this.jetScreenTexture();
  }
  /** The A320's displays' new pictures: each canvas into its cell [px], then the atlas's mips. */
  updateDu(parts: { src: OffscreenCanvas | HTMLCanvasElement; x: number; y: number; w: number; h: number }[]) {
    if (!parts.length) return;
    const fresh = !this.duTex;
    const tex = (this.duTex ??= this.device.createTexture({
      size: [4096, 4096],
      format: "rgba8unorm-srgb",
      mipLevelCount: 9,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    for (const p of parts)
      this.device.queue.copyExternalImageToTexture({ source: p.src }, { texture: tex, mipLevel: 0, origin: { x: p.x, y: p.y } }, [
        p.w,
        p.h,
      ]);
    // (the cells redrawn alone: their mips — the whole atlas's at its first picture)
    this.mips().run(tex, undefined, fresh ? undefined : parts.map((p) => [p.x, p.y, p.w, p.h] as [number, number, number, number]));
    if (fresh) this.bind();
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
  /** the canvases' mips, made on the GPU */
  private mipGen: MipGen | null = null;
  private mips() {
    return (this.mipGen ??= new MipGen(this.device));
  }
  /** The panoramic display's new picture: the parts of its canvas drawn (all of it: null) copied, then its mips. */
  updateJetScreen(src: OffscreenCanvas | HTMLCanvasElement, parts: PcdRect[] | null = null) {
    const tex = this.jetScreenTexture();
    for (const r of parts ?? [{ x: 0, y: 0, w: PCD_W, h: PCD_H }])
      this.device.queue.copyExternalImageToTexture(
        { source: src, origin: { x: r.x, y: r.y } },
        { texture: tex, mipLevel: 0, origin: { x: r.x, y: r.y } },
        [r.w, r.h],
      );
    this.mips().run(tex);
  }
  /** Readies the panoramic display's texture, the canvas's copy and its mips' pipeline (the F-35 chosen: no stall at
   *  the first look) — its (black) canvas uploaded once the pipeline is compiled. */
  warmJetScreen(src: OffscreenCanvas | HTMLCanvasElement) {
    const tex = this.jetScreenTexture();
    void this.mips()
      .warm(tex.format)
      .then(() => this.updateJetScreen(src));
  }

  /** The screens' new picture: a 2048 × 1024 canvas, then its mips. */
  updateScreens(src: HTMLCanvasElement | OffscreenCanvas) {
    const tex = this.screenTexture();
    this.device.queue.copyExternalImageToTexture({ source: src }, { texture: tex, mipLevel: 0 }, [2048, 1024]);
    this.mips().run(tex);
  }
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
    this.ownDrawn = false;
    if (!this.ready) return;
    // (none flown: only the others — the Ranger's mesh, always there, for the plumes' unused range)
    this.flown = !!v.vessel;
    this.vessel = v.vessel ?? "ranger";
    // (the displays' texture bound: the A320's atlas while it is flown, else the F-35's)
    if ((this.vessel === "a320" && this.duTex ? "du" : "jet") !== this.screenBound) this.bind();
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
      if (dr.cabin || this.debugSkip.has("hull") || (dr.mesh === this.deckMesh && this.debugSkip.has("deck"))) return;
      if (dr.inst === 0 && this.deckDrawn && this.debugSkip.has("a320-hull")) return;
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
    // (inside the A320: its hull's glass too — its windshield's water and frost only, ship.wgsl a320Glass: tinted, it
    // would hide the view)
    const glassy = this.draws.filter((dr) => !dr.cabin && dr.mesh.solid !== undefined && dr.mesh.solid < dr.mesh.count);
    if (glassy.length && !this.debugSkip.has("glass")) {
      // (an A320 among them: the pipeline with its glass's code — GLASS_A320)
      const a320 = glassy.some((dr) => dr.mesh === this.meshes.a320);
      const main = a320 ? (this.a320GlassPipe ??= this.glassPipe!(0, true)) : this.pipes.jetGlass;
      if (!res.jetGlassBind || res.jetGlassGen !== this.bindGen || res.jetGlassHdr !== hdr || res.jetGlassPipe !== main) {
        const keep = [0, 1, 2, 3, 12, 16, 22, 27];
        res.jetGlassBind = this.device.createBindGroup({
          layout: main.getBindGroupLayout(0),
          entries: [...this.shipEntries!.filter((e) => keep.includes(e.binding)), { binding: 10, resource: hdr.createView() }],
        });
        res.jetGlassGen = this.bindGen;
        res.jetGlassHdr = hdr;
        res.jetGlassPipe = main;
      }
      const gm = this.debugSkip.has("glass-flat") ? 2 : this.debugSkip.has("glass-sr") ? 1 : 0;
      if (gm && !this.glassModes[gm]) this.glassModes[gm] = this.glassPipe!(gm);
      const gp = gm ? this.glassModes[gm]! : main;
      rp.setPipeline(gp);
      rp.setBindGroup(
        0,
        gm
          ? this.device.createBindGroup({
              layout: gp.getBindGroupLayout(0),
              entries: [
                ...this.shipEntries!.filter((e) => [0, 1, 2, 3, 12, 16, 22, 27].includes(e.binding)),
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
    // the deck's control under the pointer: its triangles again, lit (FlightGear's highlight — GLASS_MODE 3)
    const hov = this.deckDrawn && this.deckHover?.length && this.deckRuns && this.deckMesh ? this.deckHover : null;
    const deckDraw = hov ? this.draws.find((dr) => dr.mesh === this.deckMesh) : null;
    if (hov && deckDraw) {
      this.glassModes[3] ??= this.glassPipe!(3);
      const gp = this.glassModes[3]!;
      if (!this.hoverBind || this.hoverBind.gen !== this.bindGen || this.hoverBind.hdr !== hdr)
        this.hoverBind = {
          g: this.device.createBindGroup({
            layout: gp.getBindGroupLayout(0),
            entries: [
              ...this.shipEntries!.filter((e) => [0, 1, 2, 3, 12, 16, 22, 27].includes(e.binding)),
              { binding: 10, resource: hdr.createView() },
            ],
          }),
          gen: this.bindGen,
          hdr,
        };
      rp.setPipeline(gp);
      rp.setBindGroup(0, this.hoverBind.g);
      rp.setVertexBuffer(0, this.deckMesh!.vbuf);
      rp.setIndexBuffer(this.deckMesh!.ibuf, "uint32");
      for (const ob of hov) for (const [first, n] of this.deckRuns!.get(ob) ?? []) rp.drawIndexed(n, 1, first, 0, deckDraw.inst);
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
    // (the flown craft's own opaque parts alone — from the cockpit: the next frame's rays they hide not traced)
    if (v.ownMask && this.flown && this.draws.some((dr) => dr.inst === 0)) {
      if (!res.own || res.own.w !== bw || res.own.h !== bh) {
        const old = res.own?.tex;
        if (old) this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
        res.own = {
          tex: this.device.createTexture({
            size: [bw, bh],
            format: "r8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
          }),
          w: bw,
          h: bh,
          rect: [x0, y0, bw, bh],
          pose: [],
          valid: false,
        };
      }
      this.ownBind ??= this.device.createBindGroup({
        layout: this.pipes.ownMask.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 12, resource: { buffer: this.instBuf } },
        ],
      });
      const mp = enc.beginRenderPass(
        this.pass("ship: own mask", {
          colorAttachments: [{ view: res.own.tex.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        }),
      );
      mp.setPipeline(this.pipes.ownMask);
      mp.setBindGroup(0, this.ownBind);
      // (the A320's flight deck too: its own instance)
      for (const dr of this.draws) {
        if (dr.inst !== 0 && dr.mesh !== this.deckMesh) continue;
        mp.setVertexBuffer(0, dr.mesh.vbuf);
        mp.setIndexBuffer(dr.mesh.ibuf, "uint32");
        mp.drawIndexed(dr.cabin ? this.cockpit!.solid : (dr.mesh.solid ?? dr.mesh.count), 1, 0, 0, dr.inst);
      }
      mp.end();
      res.own.rect = [x0, y0, bw, bh];
      res.own.pose = ownPose(v.look, v.fov, v.mount);
      res.own.valid = true;
      this.ownDrawn = true;
    } else if (res.own) res.own.valid = false;
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

  /** the flown craft's own opaque parts drawn by the last encodeShip (its early returns: not) */
  ownDrawn = false;
  /** The flown craft's own opaque parts as the last frame drew them for this image (encodeShip's ownMask), or null. */
  ownMaskOf(hdr: GPUTexture) {
    const o = this.targets.get(hdr)?.own;
    return o?.valid ? o : null;
  }
  private ownDummy?: GPUTexture;
  /** a 1 × 1 empty mask (bound while none is drawn) */
  ownMaskDummy() {
    return (this.ownDummy ??= this.device.createTexture({ size: [1, 1], format: "r8unorm", usage: GPUTextureUsage.TEXTURE_BINDING }));
  }
  private ownBind?: GPUBindGroup;

  /** Frees the per-target buffers of a destroyed HDR texture. */
  forget(hdr: GPUTexture) {
    const r = this.targets.get(hdr);
    if (!r) return;
    r.resolved.destroy();
    r.plume.destroy();
    r.plumeDepth.destroy();
    r.hullDist.destroy();
    if (r.box) [r.box.color, r.box.depth, r.box.small].forEach((t) => t.destroy());
    r.own?.tex.destroy();
    this.targets.delete(hdr);
  }
}
