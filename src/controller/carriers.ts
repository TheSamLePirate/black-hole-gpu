// The CameraController — the carriers at sea (docs/PLAN-AVIATION-AAA.md, M2; game/carrier.ts their course, motion
// and deck): set off ahead of the craft, steaming into the wind (or where a scene, a mission, the room says), on
// the clock alone — the same on every page of a room —; drawn (their real models, to size), their wakes on the
// sea, on the radar (friendly), labelled; their decks moving platforms the gear meets (system/our-surface.ts) —
// the craft lands on them, rests on them carried along, takes off from them —; a craft set down on one (a scene's
// start, a test's, TARS's).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { shipLights, shipMotion } from "../game/shiptypes";
import { azAltAt } from "../eclipse/earth-moon";
import { J2000_MS } from "../system/timescale";
import {
  CARRIER,
  LANDING,
  type CarrierId,
  type CarrierPose,
  type CarrierSpawn,
  type DeckMap,
  carrierPose,
  deckHeight,
  deckUnder,
  fromDeck,
  readDeck,
  toDeck,
} from "../game/carrier";
import { VL_SPOT } from "../game/deckland";
import type { RadarObject } from "../game/radar";
import { daysOf, bodyAxes, solarBody, utcOf, M_METRES } from "../system/solar";
import { fromBodyFixed, groundVelocity, type Platform, setPlatforms } from "../system/our-surface";
import { setHomePose } from "../camera";
import { GEAR } from "../landing";
import { C_MPS } from "../units";
import { weatherAt } from "../weather";
import { windFrom } from "../wind";
import { earthView } from "./netcraft";
import type { TrafficMark } from "./traffic";
import { cross as cross3, type Vec3 } from "../math/vec3";
import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import type { CameraController } from "../controls";
import fordDeckUrl from "../../assets/carriers/ford.deck.bin";
import kievDeckUrl from "../../assets/carriers/kiev.deck.bin";
import implacableDeckUrl from "../../assets/carriers/implacable.deck.bin";

declare module "../controls" {
  interface CameraController {
    carrierSpawn: typeof carrierSpawn;
    carrierNow: typeof carrierNow;
    carrierStep: typeof carrierStep;
    carrierShips: typeof carrierShips;
    carrierWakes: typeof carrierWakes;
    carrierOverlay: typeof carrierOverlay;
    carrierLand: typeof carrierLand;
    carrierClear: typeof carrierClear;
    carrierFinal: typeof carrierFinal;
    /** the carriers at sea (their start: their course a function of the clock) */
    carriers?: CarrierSpawn[];
  }
}

const DECK_URLS: Record<CarrierId, string> = { ford: fordDeckUrl, kiev: kievDeckUrl, implacable: implacableDeckUrl };
/** the decks' maps, loaded with their first carrier (a test's own getter) */
const decks = new Map<CarrierId, DeckMap>();
const loading = new Set<CarrierId>();
export let deckGetter: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url).then((r) => r.arrayBuffer());
export function setDeckGetter(g: (url: string) => Promise<ArrayBuffer>) {
  deckGetter = g;
}
/** A carrier's deck map, asked for once (null until it lands). */
export function deckOf(kind: CarrierId): DeckMap | null {
  const D = decks.get(kind);
  if (D || loading.has(kind)) return D ?? null;
  loading.add(kind);
  deckGetter(DECK_URLS[kind]).then(
    (b) => decks.set(kind, readDeck(b)),
    (e) => {
      loading.delete(kind);
      console.error(`deck ${kind}:`, e);
    },
  );
  return null;
}
/** (tests: a deck map given) */
export function putDeck(kind: CarrierId, D: DeckMap) {
  decks.set(kind, D);
}

/** The scene's time [M] → the clock the carriers steam on [s since 1970]. */
const secOf = (t: number) => utcOf(t) / 1000;

/**
 * A carrier set off: `at` its place [°] (else 4 km ahead of the craft over the sea), its heading [°] (else into the
 * wind there — the weather's, the climate's), its speed [m/s] (else its own into the wind); what to say.
 */
function carrierSpawn(
  this: CameraController,
  kind: CarrierId,
  o: { lat?: number; lon?: number; heading?: number; speed?: number; seed?: number } = {},
): string {
  const g = this.geoNow();
  if (!g && (o.lat === undefined || o.lon === undefined)) return "carrier: over the Earth only";
  const D2R = Math.PI / 180;
  const ahead = 4000;
  const lat = o.lat ?? g!.lat + (ahead * Math.cos(g!.track)) / 111_195;
  const lon = o.lon ?? g!.lon + (ahead * Math.sin(g!.track)) / (111_195 * Math.cos(g!.lat * D2R));
  const t = this.nowTime();
  // (into the wind: the way the wind comes from)
  const wx = weatherAt(this.s, { body: "earth", lat, lon }, daysOf(t), this.weatherReal).wind;
  const from = wx.from === null ? windFrom(lat, lon, daysOf(t)) : wx.from * D2R;
  const heading = o.heading !== undefined ? o.heading * D2R : from;
  const sp: CarrierSpawn = {
    kind,
    lat,
    lon,
    heading: ((heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
    speed: o.speed ?? CARRIER[kind].speed,
    t0: secOf(t),
    seed: o.seed ?? Math.floor(Math.random() * 1e6),
  };
  this.carriers = [...(this.carriers ?? []).filter((c) => c.kind !== kind), sp];
  deckOf(kind);
  return `${CARRIER[kind].name}: ${lat.toFixed(3)}°, ${lon.toFixed(3)}°, heading ${Math.round((sp.heading * 180) / Math.PI)}°, ${Math.round(sp.speed * 1.943844)} kt`;
}

function carrierClear(this: CameraController) {
  this.carriers = [];
  setPlatforms("earth", []);
}

/** The carriers now: their poses at the scene's time, in the sea's height about us. */
function carrierNow(this: CameraController, t = this.nowTime()): { sp: CarrierSpawn; P: CarrierPose }[] {
  const hs = this.seaHs ?? 1;
  return (this.carriers ?? []).map((sp) => ({ sp, P: carrierPose(sp, secOf(t), hs) }));
}

/** A carrier's deck as a moving platform (system/our-surface.ts): its pose at the asked time, cached a step. */
function platformOf(sp: CarrierSpawn, D: DeckMap, hs: () => number): Platform {
  let cache: { t: number; P: CarrierPose } | null = null;
  const pose = (t: number) => {
    if (cache?.t !== t) cache = { t, P: carrierPose(sp, secOf(t), hs()) };
    return cache.P;
  };
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return {
    key: sp.kind,
    under: (q, t) => deckUnder(pose(t), D, q),
    toLocal: (q, t) => toDeck(pose(t), q),
    toFixed: (l, t) => fromDeck(pose(t), l),
    dirToLocal: (d, t) => {
      const P = pose(t);
      return [dot(d, P.port), dot(d, P.up), dot(d, P.bow)];
    },
    dirToFixed: (l, t) => {
      const P = pose(t);
      return [0, 1, 2].map((i) => P.port[i]! * l[0] + P.up[i]! * l[1] + P.bow[i]! * l[2]) as Vec3;
    },
  };
}

/** A carrier's escort: two frigates on its course — one off its port quarter, one off its starboard bow — level
 *  on the sea, each its own motion. */
const ESCORT = [
  { x: 1500, z: -1200 },
  { x: -1800, z: 1500 },
];
export function escortsOf(sp: CarrierSpawn, P: CarrierPose, t: number, hs: number): { p: Vec3; port: Vec3; up: Vec3; bow: Vec3 }[] {
  const r = Math.hypot(...P.p);
  const U = P.p.map((x) => x / r) as Vec3;
  const flat = (v: readonly number[]) => {
    const f = v.map((x, i) => x - U[i]! * dot3(v, U));
    const l = Math.hypot(...f) || 1;
    return f.map((x) => x / l) as Vec3;
  };
  const bow = flat(P.bow),
    port = flat(P.port);
  return ESCORT.map((o, k) => {
    const p0 = [0, 1, 2].map((i) => P.p[i]! + port[i]! * o.x + bow[i]! * o.z);
    const l = Math.hypot(...p0);
    const m = shipMotion(135, 17, hs, t, sp.seed + 17 * (k + 1));
    const p = p0.map((x) => (x / l) * (r + m.heave)) as Vec3;
    const cp = Math.cos(m.pitch),
      spp = Math.sin(m.pitch),
      cr = Math.cos(m.roll),
      sr = Math.sin(m.roll);
    const b1 = [0, 1, 2].map((i) => bow[i]! * cp + U[i]! * spp);
    const u1 = [0, 1, 2].map((i) => U[i]! * cp - bow[i]! * spp);
    const stb = port.map((x) => -x);
    const right = [0, 1, 2].map((i) => stb[i]! * cr - u1[i]! * sr);
    const up = [0, 1, 2].map((i) => u1[i]! * cr + stb[i]! * sr);
    return { p, port: right.map((x) => -x) as Vec3, up: up as Vec3, bow: b1 as Vec3 };
  });
}

/** A frame of the carriers: their decks the gear's platforms; their radar source (friendly: their own). */
function carrierStep(this: CameraController) {
  const list = this.carriers ?? [];
  const pls: Platform[] = [];
  for (const sp of list) {
    const D = deckOf(sp.kind);
    if (D) pls.push(platformOf(sp, D, () => this.seaHs ?? 1));
  }
  setPlatforms("earth", pls);
  if (!list.length) {
    this.radarSources.delete("cv");
    return;
  }
  if (this.radarSources.has("cv")) return;
  this.radarSources.set("cv", (fix) =>
    this.carrierNow().flatMap(({ sp, P }): RadarObject[] => [
      {
        id: `cv:${sp.kind}`,
        r: fix.toLocal(P.p),
        v: [dot3(P.v, fix.E), dot3(P.v, fix.N), dot3(P.v, fix.U)],
        rcs: 0.4 * CARRIER[sp.kind].len ** 2,
        kind: "sea",
        iff: "friend",
        name: CARRIER[sp.kind].name,
        squawk: true,
      },
      ...escortsOf(sp, P, secOf(this.nowTime()), this.seaHs ?? 1).map(
        (e, k): RadarObject => ({
          id: `cv:${sp.kind}:esc${k}`,
          r: fix.toLocal(e.p),
          v: [dot3(P.v, fix.E), dot3(P.v, fix.N), dot3(P.v, fix.U)],
          rcs: 0.4 * 135 ** 2,
          kind: "sea",
          iff: "friend",
          name: `${CARRIER[sp.kind].name.split(" (")[0]} — escort ${k + 1}`,
          squawk: true,
        }),
      ),
    ]),
  );
}
const dot3 = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** A fight's ships (S1: a hostile frigate) fixed to the Earth: their place, axes (port, up, bow), velocity; a sunk
 *  one settling, gone after a minute. */
function fightShips(c: CameraController): { p: Vec3; port: Vec3; up: Vec3; bow: Vec3; v: Vec3; speed: number }[] {
  const C = c.combat;
  if (!C) return [];
  const A = C.def.anchor;
  const D = Math.PI / 180;
  const RE = 6_371_008.8;
  return C.world.targets
    .filter((q) => q.kind === "ship" && (q.alive || C.world.t - q.diedAt < 60))
    .map((q) => {
      const lat = A.lat + q.p[1] / (D * RE),
        lon = A.lon + q.p[0] / (D * RE * Math.cos(A.lat * D));
      const la = lat * D,
        lo = lon * D;
      const E = [-Math.sin(lo), Math.cos(lo), 0];
      const N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
      const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)] as Vec3;
      const f = q.fwd;
      const bow = [0, 1, 2].map((i) => E[i]! * f[0] + N[i]! * f[1]) as Vec3;
      const stb = [0, 1, 2].map((i) => E[i]! * f[1] - N[i]! * f[0]);
      const sink = q.alive ? 0 : q.p[2] - C.world.groundZ(q.p[0], q.p[1]);
      const p = geodeticToCart(WGS84_A, WGS84_F, la, lo, sink) as Vec3;
      const speed = q.alive ? Math.hypot(q.v[0], q.v[1]) : 0;
      return { p, port: stb.map((x) => -x) as Vec3, up: U, bow, v: bow.map((x) => x * speed) as Vec3, speed };
    });
}

/** The carriers for the renderer: within 40 km, their place and axes on the camera's (their meshes to size). */
function carrierShips(this: CameraController): {
  id: CarrierId | "frigate";
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  hidden: boolean;
  far: boolean;
  big: boolean;
  mirror: boolean;
}[] {
  const list = this.carrierNow();
  const hostile = fightShips(this);
  if (!list.length && !hostile.length) return [];
  const E = earthView(this);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const t = secOf(this.nowTime());
  return list
    .flatMap(({ sp, P }) => [
      {
        id: sp.kind as CarrierId | "frigate",
        P: P as { p: readonly number[]; port: readonly number[]; up: readonly number[]; bow: readonly number[] },
      },
      ...escortsOf(sp, P, t, this.seaHs ?? 1).map((e) => ({ id: "frigate" as const, P: e })),
    ])
    .concat(hostile.map((h) => ({ id: "frigate" as const, P: h })))
    .map(({ id, P }) => ({ id, P, rel: cam([0, 1, 2].map((k) => P.p[k]! - E.p0[k]!)) }))
    .filter((x) => Math.hypot(...x.rel) < 40_000)
    .map(({ id, P, rel }) => ({
      id,
      rel,
      axes: [unit(cam(P.port)), unit(cam(P.up)), unit(cam(P.bow))] as [Vec3, Vec3, Vec3],
      hidden: false,
      far: true,
      // (the carrier — not its escorts — in the shadow map's second half; all of them mirrored in the sea)
      big: id !== "frigate",
      mirror: true,
    }));
}

/** Their wakes (the sea's shader: renderer.seaWakes). */
function carrierWakes(this: CameraController): { p: Vec3; fwd: Vec3; U: number; len: number; beam: number }[] {
  const t = secOf(this.nowTime());
  return this.carrierNow()
    .flatMap(({ sp, P }) => {
      const up = P.p.map((x) => x / Math.hypot(...P.p));
      const f = P.bow.map((x, i) => x - up[i]! * dot3(P.bow, up));
      const l = Math.hypot(...f) || 1;
      const fwd = f.map((x) => x / l) as Vec3;
      return [
        { p: P.p as Vec3, fwd, U: sp.speed, len: CARRIER[sp.kind].len, beam: CARRIER[sp.kind].beam },
        ...escortsOf(sp, P, t, this.seaHs ?? 1).map((e) => ({ p: e.p, fwd, U: sp.speed, len: 135, beam: 17 })),
      ];
    })
    .concat(
      fightShips(this)
        .filter((h) => h.speed > 0)
        .map((h) => ({ p: h.p, fwd: h.bow, U: h.speed, len: 135, beam: 17 })),
    );
}

/**
 * The meatball (the IFLOLS: game/carrier.ts LANDING) as the craft sees it: its angle over the hook's aim, its error
 * from the glide path [°] — the ball a cell (a quarter of a degree) up for each quarter high —, whether it is in
 * the lens's view (astern, within 30° of the landing axis, 4 km); null: no lens.
 */
export function meatball(kind: CarrierId, l: readonly number[]): { angle: number; error: number; seen: boolean; d: number } | null {
  const L = LANDING[kind];
  if (!L) return null;
  const a = (L.angle * Math.PI) / 180;
  const ax = [Math.sin(a), Math.cos(a)];
  const dx = l[0]! - L.aim[0],
    dz = l[2]! - L.aim[1];
  // (astern along the axis: its distance; across it)
  const d = -(dx * ax[0]! + dz * ax[1]!),
    across = dx * ax[1]! - dz * ax[0]!;
  const h = l[1]! - CARRIER[kind].deck;
  const angle = (Math.atan2(h, d) * 180) / Math.PI;
  return { angle, error: angle - L.glide, seen: d > 50 && d < 4000 && Math.abs(across) < d * Math.tan((30 * Math.PI) / 180), d };
}

/**
 * Their labels within 60 km (name · speed in the units chosen); the Ford's IFLOLS seen from astern — its green datum
 * bars, its amber ball off them by the glide path's error (red very low); by night their decks' lights — the landing
 * area's edges and centreline, the drop lights under its ramp —, their navigation lights.
 */
function carrierOverlay(this: CameraController, fmtSpd: (ms: number) => string): TrafficMark[] {
  const list = this.carrierNow();
  if (!list.length) return [];
  const E = earthView(this);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const g = this.geoNow();
  const ms = J2000_MS + daysOf(this.nowTime()) * 86400e3;
  const night = g ? azAltAt("sun", (g.lat * Math.PI) / 180, (g.lon * Math.PI) / 180, 0, ms).alt < -1 : false;
  const white = "rgba(255, 250, 235, 1)",
    amber = "rgba(255, 170, 40, 1)",
    red = "rgba(255, 40, 30, 1)",
    green = "rgba(60, 255, 120, 1)";
  const out: TrafficMark[] = [];
  for (const { sp, P } of list) {
    const rel = cam([0, 1, 2].map((k) => P.p[k]! - E.p0[k]!));
    const dist = Math.hypot(...rel);
    if (dist > 60_000) continue;
    const at = (l: readonly number[]): Vec3 => cam(fromDeck(P, l).map((x, k) => x - E.p0[k]!));
    const lights: TrafficMark["lights"] = [];
    const spec = CARRIER[sp.kind];
    const L = LANDING[sp.kind];
    if (L) {
      // the IFLOLS, from astern
      const mb = meatball(sp.kind, toDeck(P, E.p0));
      if (mb?.seen && L.iflols) {
        const [x, y, z] = L.iflols;
        for (const k of [-4, -3, -2, 2, 3, 4]) lights.push({ at: at([x + k * 0.9, y, z]), colour: green, on: true, size: 0.9 });
        const cell = Math.max(-6, Math.min(6, mb.error / 0.25));
        lights.push({ at: at([x, y + cell * 0.18, z]), colour: cell <= -4 ? red : amber, on: true, size: 1.3 });
      }
      if (night) {
        const a = (L.angle * Math.PI) / 180;
        const ax = [Math.sin(a), Math.cos(a)],
          across = [Math.cos(a), -Math.sin(a)];
        for (let s0 = 0; s0 <= 210; s0 += 15) {
          const cx = L.ramp[0] + ax[0]! * s0,
            cz = L.ramp[1] + ax[1]! * s0;
          lights.push({ at: at([cx, spec.deck + 0.05, cz]), colour: white, on: true, size: 0.7 });
          for (const e of [-1, 1])
            lights.push({
              at: at([cx + across[0]! * L.half * e, spec.deck + 0.05, cz + across[1]! * L.half * e]),
              colour: white,
              on: true,
              size: 0.7,
            });
        }
        for (let k = 1; k <= 5; k++)
          lights.push({ at: at([L.ramp[0], spec.deck - k * 1.2, L.ramp[1] - 0.6]), colour: amber, on: true, size: 0.8 });
      }
    }
    // (the F-35B's recovery flown: its landing spot ringed on the deck — amber, green once cleared to land)
    const R = this.deckRun;
    if (R && R.kind === sp.kind) {
      const [sx, sz] = VL_SPOT[sp.kind];
      const lit = R.phase === "descend" ? green : amber;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI;
        lights.push({ at: at([sx + 5 * Math.cos(a), spec.deck + 0.1, sz + 5 * Math.sin(a)]), colour: lit, on: true, size: 0.5 });
      }
    }
    if (night)
      for (const l of shipLights("cargo", spec.len, spec.beam))
        lights.push({ at: at(l.at), colour: l.colour === "white" ? white : l.colour === "red" ? red : green, on: true, size: l.size });
    out.push({ id: `cv:${sp.kind}`, at: rel, dist, label: `${spec.name} · ${fmtSpd(sp.speed)}`, lights });
  }
  return out;
}

/**
 * The flown craft set down on a carrier's deck — at a spot of its frame (x its port, z its bow [m]; else amidships
 * on its centreline aft of its island), facing `facing` [° from its bow, clockwise] —, carried along with it; what
 * to say; `drop` [m]: held that high over it, moving with it, let go. Its deck map must be there (deckOf).
 */
function carrierLand(
  this: CameraController,
  kind: CarrierId,
  spot: { x?: number; z?: number; facing?: number; drop?: number } = {},
): string {
  const sp = (this.carriers ?? []).find((c) => c.kind === kind);
  const D = deckOf(kind);
  if (!sp || !D) return "carrier: not at sea yet (or its deck still loading)";
  const t = this.nowTime();
  const P = carrierPose(sp, secOf(t), this.seaHs ?? 1);
  const x = spot.x ?? 0,
    z = spot.z ?? -0.25 * CARRIER[kind].len;
  const top = deckHeight(D, x, z);
  if (!Number.isFinite(top)) return "carrier: no deck there";
  // (its reference point the gear's height over the deck)
  const l: Vec3 = [x, top + GEAR + (spot.drop ?? 0), z];
  const a = ((spot.facing ?? 0) * Math.PI) / 180;
  const fwdL: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const upL: Vec3 = [0, 1, 0];
  const qm = fromDeck(P, l);
  const q: Vec3 = [qm[0] / M_METRES, qm[1] / M_METRES, qm[2] / M_METRES];
  const X = fromBodyFixed("earth", q, t);
  const A = bodyAxes(solarBody("earth")!, t);
  const home = (v: readonly number[]): Vec3 => [0, 1, 2].map((i) => v[0]! * A[0]![i]! + v[1]! * A[1]![i]! + v[2]! * A[2]![i]!) as Vec3;
  const dirF = (v: Vec3) => [0, 1, 2].map((i) => P.port[i]! * v[0] + P.up[i]! * v[1] + P.bow[i]! * v[2]);
  const u = deckUnder(P, D, qm);
  const V = [0, 1, 2].map((i) => groundVelocity("earth", X, t)[i]! + home(u?.v ?? [0, 0, 0])[i]! / C_MPS) as Vec3;
  // (the view on it now, not swung round from the flight's heading — the rig's damped frame let go, as a placing's)
  this.viewCarry = null;
  this.camFollow.reset();
  this.setCinematic(null);
  this.setPilot(true);
  this.newFlight();
  // (once the views are set on it: the craft's attitude through them)
  shipPose(this, X, home(dirF(fwdL)), home(dirF(upL)), V);
  // (dropped from over it: in the air, moving with the deck — its gear to meet it; else resting on it)
  this.setOurLanded(spot.drop ? null : { body: "earth", q, deck: { pl: platformOf(sp, D, () => this.seaHs ?? 1), l } });
  this.gearInit = true;
  this.gearDown = true;
  this.gearExt = 1;
  // (on the deck: the flight's holds off, the engine at idle)
  if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
  this.pilot.auto = "none";
  this.jetModes = { ...this.jetModes, alt: null, hdg: null, spd: null, ab: false };
  this.pilot.throttle = 0;
  this.sync();
  return `On ${CARRIER[kind].name}'s deck`;
}

/** The flown craft — not the camera: the views' camera set about it (piloting.ts shipMatrix) — at X, its nose and
 *  top along fwd and up (home axes), moving at V. */
function shipPose(c: CameraController, X: Vec3, fwd: Vec3, up: Vec3, V: Vec3) {
  // (the craft's axes: x its left, y its top, z its nose; the camera's, rows of S on them)
  const ax = [cross3(up, fwd), up, fwd];
  const S = c.shipMatrix();
  const camAx = (k: number) => [0, 1, 2].map((i) => S[k]![0]! * ax[0]![i]! + S[k]![1]! * ax[1]![i]! + S[k]![2]! * ax[2]![i]!) as Vec3;
  setHomePose(c.s, X, camAx(2), camAx(1), V);
  c.s.motion = "geodesic";
}

/**
 * The flown craft on a carrier's final (its landing area's: game/carrier.ts LANDING): `d` [m] astern of the hook's
 * aim on its axis, on its glide path, flying along it at `speed` [m/s] over the deck (its own speed added); what to
 * say.
 */
function carrierFinal(this: CameraController, kind: CarrierId, d = 1500, speed = 70): string {
  const sp = (this.carriers ?? []).find((c) => c.kind === kind);
  const L = LANDING[kind];
  if (!sp || !L) return "carrier: none at sea with a landing area";
  const t = this.nowTime();
  const P = carrierPose(sp, secOf(t), this.seaHs ?? 1);
  const a = (L.angle * Math.PI) / 180;
  const ax = [Math.sin(a), Math.cos(a)];
  const h = d * Math.tan((L.glide * Math.PI) / 180);
  const l: Vec3 = [L.aim[0] - ax[0]! * d, CARRIER[kind].deck + h, L.aim[1] - ax[1]! * d];
  const qm = fromDeck(P, l);
  const q: Vec3 = [qm[0] / M_METRES, qm[1] / M_METRES, qm[2] / M_METRES];
  const X = fromBodyFixed("earth", q, t);
  const A = bodyAxes(solarBody("earth")!, t);
  const home = (v: readonly number[]): Vec3 => [0, 1, 2].map((i) => v[0]! * A[0]![i]! + v[1]! * A[1]![i]! + v[2]! * A[2]![i]!) as Vec3;
  // (along the axis, level — the carrier's pitch and roll its own —, down its glide path)
  const r = Math.hypot(...P.p);
  const U = P.p.map((x) => x / r);
  const flat = (v: readonly number[]) => {
    const f = v.map((x, i) => x - U[i]! * dot3(v, U));
    const n = Math.hypot(...f) || 1;
    return f.map((x) => x / n);
  };
  const bow = flat(P.bow),
    port = flat(P.port);
  const along = [0, 1, 2].map((i) => port[i]! * ax[0]! + bow[i]! * ax[1]!);
  const g = (L.glide * Math.PI) / 180;
  const vdir = along.map((x, i) => x * Math.cos(g) - U[i]! * Math.sin(g));
  const vel = [0, 1, 2].map((i) => P.v[i]! + vdir[i]! * speed);
  const V = [0, 1, 2].map((i) => groundVelocity("earth", X, t)[i]! + home(vel)[i]! / C_MPS) as Vec3;
  this.viewCarry = null;
  this.camFollow.reset();
  this.setCinematic(null);
  this.setPilot(true);
  this.newFlight();
  shipPose(this, X, home(along) as Vec3, home(U) as Vec3, V);
  this.setOurLanded(null);
  this.sync();
  return `${CARRIER[kind].name}: on the final, ${Math.round(d)} m out, ${Math.round(h)} m over its deck`;
}

export function installCarriers(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    carrierSpawn,
    carrierNow,
    carrierStep,
    carrierShips,
    carrierWakes,
    carrierOverlay,
    carrierLand,
    carrierClear,
    carrierFinal,
  });
}
