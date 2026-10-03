// The ground track: where the Ranger is over the world it orbits — a globe (orthographic, the world's
// map lit by the Sun, turning under the ship) or a planisphere (equirectangular, the day and the night)
// — with the track it left, the one ahead (the free-fall path predicted, the planned one through the
// nodes), the periapsis and apoapsis on it, the ship and the horizon it sees, the point under the Sun.
// Our worlds (their maps); Gargantua's (Miller, Mann, Edmunds: a graticule globe, no map).
//
// Globe: drag turns it (the ship no longer centred), the wheel zooms, a double click follows the ship
// again. The raster (the map lit, per pixel) is redrawn only when the view or the light moved; the
// tracks and marks over it each time.

import type { Info } from "./flighthud";
import type { OurPath } from "../system/our-predict";
import { M_METRES, solarBody, solarState, type MapName } from "../system/solar";
import { toBodyFixed } from "../system/our-surface";
import { issOrbit, issTrack } from "../system/iss";
import { M_SECONDS } from "../system/solar";
import { planetMapUrl } from "../system/planet-maps";
import { BODY_NAMES, type Body } from "../targeting";
import { AMBER, CYAN, FONT, OUR_COLOURS } from "./hudkit";
import { fleet } from "../fleet";
import { keplerProp } from "../system/our-plan";
import { VESSELS } from "../vessels";
import { siteDir, sitesOf } from "../game/sites";
import { BodyKind, MapGpu, type GpuBody, type MapTextures } from "./map3d/gpu";
import { Paint } from "./map3d/paint";
import { MAPS_HI, MAPS_LO } from "../system/solar";
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

import { planetFrame, toLocal } from "../landing";
import type { Settings } from "../settings";
import { cross, dot, sub as sub3 } from "../math/vec3";

type V3 = [number, number, number];
export type GroundMode = "globe" | "map";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const D = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** a unit vector's latitude, east longitude [rad] (the maps' convention: x at longitude 0, z north) */
const latLon = (q: V3): [number, number] => [Math.asin(clamp(q[2], -1, 1)), Math.atan2(q[1], q[0])];
const fromLatLon = (lat: number, lon: number): V3 => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
const fmtLat = (r: number) => `${Math.abs(r / D).toFixed(2)}° ${r >= 0 ? "N" : "S"}`;
const fmtLon = (r: number) => `${Math.abs(r / D).toFixed(2)}° ${r >= 0 ? "E" : "W"}`;
const fmtKm = (km: number) => (!Number.isFinite(km) ? "—" : Math.abs(km) >= 1e4 ? `${Math.round(km).toLocaleString("en-US")} km` : `${km.toFixed(km < 100 ? 1 : 0)} km`);

/** Gargantua's worlds (their frame's ξ: x away from the hole, z its pole): their tints. */
const THEIRS: Record<string, [number, number, number]> = { miller: [70, 150, 170], mann: [215, 225, 238], edmunds: [196, 150, 104] };

/** A world's map, read back once to sample on the CPU (≤ 1024 × 512). */
interface Tex { w: number; h: number; px: Uint32Array; img: HTMLCanvasElement }

/** What the view shows: the world, the ship on it, its tracks. */
interface Scene {
  id: string;
  name: string;
  /** mean radius [km] */
  Rkm: number;
  ours: boolean;
  /** the ship: unit direction on the world's own axes (none: a world alone — the picker), its height [km] */
  ship: V3 | null;
  altKm: number;
  /** towards the Sun (our worlds), on the world's axes */
  sun: V3 | null;
  ahead: V3[];
  plan: V3[];
  /** the space station over the Earth: where it is, its ground track an orbit ahead (unit directions on its axes) */
  iss?: { q: V3; track: V3[]; target: boolean } | null;
  /** the fleet's craft not flown: where they are, their ground track an orbit ahead (Kepler) */
  crafts?: { id: string; name: string; col: string; q: V3; track: V3[]; target: boolean }[];
  /** the flight computer's preview over the ground */
  cand?: V3[];
  /** the world's landing sites (unit, on its axes), the entry's predicted fall */
  sites?: { name: string; q: V3; runway: boolean; chosen: boolean }[];
  entry?: V3[];
  /** the periapsis / apoapsis on the path ahead, with their heights [km] */
  pe: { q: V3; km: number } | null;
  ap: { q: V3; km: number } | null;
}

export class GroundTrack {
  readonly stage = h("div", "gt-stage");
  private canvas = h("canvas", "gt-canvas");
  /** the marks and the graticule: on the GPU when there is one, else on the canvas */
  private pen = new Paint(this.canvas.getContext("2d")!);
  private read = h("div", "gt-read");
  private tag = h("div", "gt-tag");
  mode: GroundMode = "globe";
  private tex = new Map<string, Tex | "loading" | "none">();
  /** the track left: directions on the world's axes, their times; per world */
  private past: { id: string; pts: { q: V3; t: number }[] } = { id: "", pts: [] };
  /** the globe's centre (lat, lon [rad]) and zoom; following the ship until dragged */
  private view = { lat: 0, lon: 0, zoom: 1, follow: true };
  private raster = { c: document.createElement("canvas"), key: "" };
  private night = { c: document.createElement("canvas"), key: "" };
  private cache = new WeakMap<OurPath, { id: string; pts: V3[]; times: number[]; pe: Scene["pe"]; ap: Scene["ap"] }>();
  private drag: { x: number; y: number; lat: number; lon: number } | null = null;
  /** draws again as last drawn (a map just loaded, the wheel, a drag) */
  private redraw: (() => void) | null = null;
  /** a drag or the zoom moved the globe: the HUD draws it at the display's rate */
  animating = false;
  /** the picker: a click on the world gives a place (a unit direction on its axes); the place chosen */
  onPick: ((q: V3) => void) | null = null;
  pick: V3 | null = null;
  /** where the world was drawn last (device px), to read a click back */
  private hit: { globe: true; cx: number; cy: number; R: number; C: V3; E: V3; N: V3 } | { globe: false; x0: number; y0: number; mw: number; mh: number } | null = null;

  constructor(private s: Settings) {
    this.stage.append(this.canvas, this.tag, this.read);
    this.bindPointer();
  }

  /** The world the ship is over (in its sphere of influence, not the Sun, not Gargantua), or null. */
  worldOf(i: Info): string | null {
    const st = i.status;
    if (!st) return null;
    if (st.side === "ours") {
      const b = solarBody(st.soi);
      return b && b.kind === "planet" && i.X ? st.soi : null;
    }
    if (st.side === "gargantua") return THEIRS[st.soi] && i.X ? st.soi : null;
    return null;
  }

  /** Where the ship is over one of Gargantua's worlds: its frame's ξ (the flight's own near it, else from the map place). */
  private theirXi(i: Info, id: string, t: number): V3 {
    const sf = i.surface as { xi?: V3; body?: string } | null;
    if (sf?.xi && sf.body === id) return sf.xi;
    const F = planetFrame(id as "miller" | "mann" | "edmunds", t, this.s.spin, this.s.massSolar);
    return toLocal(F, i.X as V3, [0, 0, 0]).xi;
  }

  /** Each frame, whatever the map shows: the track left keeps being recorded. */
  observe(i: Info, t: number) {
    const id = this.worldOf(i);
    if (!id) return;
    const q = unit(i.status!.side === "gargantua" ? this.theirXi(i, id, t) : toBodyFixed(id, i.X as V3, t));
    this.record(id, q, t);
  }

  draw(i: Info, t: number) {
    this.redraw = () => this.draw(i, t);
    const sc = this.scene(i, t);
    if (!this.paint(sc) || !sc?.ship) {
      this.tag.textContent = "";
      this.read.textContent = "Near a planet or a moon — in its sphere of influence";
      return;
    }
    const [la, lo] = latLon(sc.ship);
    const orb = i.status?.orbit;
    this.tag.textContent = `${sc.name}${this.mode === "globe" && !this.view.follow ? " · double-click: follow" : ""}`;
    this.read.textContent = [
      `${fmtLat(la)}  ${fmtLon(lo)}`,
      `alt ${fmtKm(sc.altKm)}`,
      orb && Number.isFinite(orb.apKm) ? `Pe ${fmtKm(orb.peKm)} · Ap ${fmtKm(orb.apKm)} · i ${orb.incDeg.toFixed(1)}°` : "",
    ].filter(Boolean).join("   ");
  }

  /**
   * A world alone at time t — the picker: its map lit by the Sun, the place picked (a click picks
   * another), the ship if it is over that world (`ship`).
   */
  drawWorld(id: string, t: number, ship: V3 | null = null) {
    this.redraw = () => this.drawWorld(id, t, ship);
    const ours = !THEIRS[id];
    const b = ours ? solarBody(id) : null;
    const F = ours ? null : planetFrame(id as "miller" | "mann" | "edmunds", t, this.s.spin, this.s.massSolar);
    const sc: Scene = {
      id, name: BODY_NAMES[id as Body] ?? id, Rkm: b ? (b.radius * M_METRES) / 1e3 : F ? (F.R * F.mPerM) / 1e3 : NaN, ours, ship, altKm: NaN,
      sun: b ? unit(toBodyFixed(id, solarState("sun", t).pos as V3, t)) : null, ahead: [], plan: [], pe: null, ap: null,
    };
    this.view.follow = false;
    this.paint(sc);
    this.tag.textContent = sc.name;
    if (this.pick) {
      const [la, lo] = latLon(this.pick);
      this.read.textContent = `${fmtLat(la)}  ${fmtLon(lo)}`;
    } else this.read.textContent = "Click: a place";
  }

  /** Centres the globe on a place (the picker: on the place picked). */
  centre(q: V3) {
    [this.view.lat, this.view.lon] = latLon(q);
  }

  /** Clears the canvas and draws the scene (none: false). */
  private paint(sc: Scene | null) {
    const cv = this.canvas;
    const dpr = devicePixelRatio || 1;
    const W = Math.max(1, Math.round(this.stage.clientWidth * dpr)), H = Math.max(1, Math.round(this.stage.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) (cv.width = W), (cv.height = H);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    this.hit = null;
    if (!sc) return false;
    const tex = this.texture(sc.id);
    if (this.mode === "globe") this.drawGlobe(ctx, W, H, dpr, sc, tex);
    else this.drawMap(ctx, W, H, dpr, sc, tex);
    return true;
  }

  /** A world's landing sites (unit, on its own axes), the entry's chosen one marked. */
  private sitesOf(id: string, i: Info) {
    const chosen = i.entry?.site?.name ?? null;
    return sitesOf(id).map((st) => ({ name: st.name, q: siteDir(st) as V3, runway: !!st.runway, chosen: st.name === chosen }));
  }

  // ---------------------------------------------------------------------------------- the scene
  private scene(i: Info, t: number): Scene | null {
    const id = this.worldOf(i);
    if (!id) return null;
    const name = BODY_NAMES[id as Body] ?? id;
    if (i.status!.side === "gargantua") {
      const xi = this.theirXi(i, id, t);
      const F = planetFrame(id as "miller" | "mann" | "edmunds", t, this.s.spin, this.s.massSolar);
      const lg = i.localGround;
      return { id, name, Rkm: (F.R * F.mPerM) / 1e3, ours: false, ship: unit(xi), altKm: i.status!.altKm, sun: null, ahead: lg?.ahead ?? [], plan: lg?.plan ?? [], cand: lg?.cand ?? [], sites: this.sitesOf(id, i), entry: [], pe: null, ap: null };
    }
    const b = solarBody(id)!;
    const q = toBodyFixed(id, i.X as V3, t);
    const Rkm = (b.radius * M_METRES) / 1e3;
    const ahead = this.track(i.ourFree as OurPath | null, id, t, b.radius);
    const plan = this.track(i.ourPlan as OurPath | null, id, t, b.radius);
    const cand = this.track((i.cand?.kind === "ours" ? i.cand.ours : null) as OurPath | null, id, t, b.radius);
    // (the entry's predicted fall: body-centred home axes → the ground's, as the world stands now)
    const E = i.entry;
    const entry = E && E.ours && E.body === id && E.path ? E.path.map((x) => unit(toBodyFixed(id, add3(solarState(id, t).pos as V3, x as V3), t))) : [];
    return {
      cand: cand?.pts ?? [], sites: this.sitesOf(id, i), entry,
      id, name, Rkm, ours: true, ship: unit(q), altKm: (Math.hypot(...q) - b.radius) * M_METRES / 1e3,
      sun: unit(toBodyFixed(id, solarState("sun", t).pos as V3, t)),
      ahead: ahead?.pts ?? [], plan: plan?.pts ?? [], pe: ahead?.pe ?? null, ap: ahead?.ap ?? null,
      iss: id === "earth" && this.s.iss ? this.issTrack(t) : null,
      crafts: id === "earth" ? this.craftTracks(t) : [],
    };
  }

  /** The space station's ground track (an orbit ahead, SGP4: the Earth turning under it), redone every
   *  30 s of the scene's time; where it is now. */
  private issCache: { t: number; track: V3[] } | null = null;
  private issTrack(t: number) {
    const now = issTrack.peek(t);
    if (!now) return null;
    const P = 92.9 * 60 / M_SECONDS;
    if (!this.issCache || Math.abs(t - this.issCache.t) > 30 / M_SECONDS) {
      const track: V3[] = [];
      for (let k = 0; k <= 120; k++) {
        const tk = t + (P * k) / 120;
        const o = issOrbit(tk);
        if (o) track.push(unit(toBodyFixed("earth", o.X as V3, tk)));
      }
      this.issCache = { t, track };
    }
    return { q: unit(toBodyFixed("earth", now.X as V3, t)), track: this.issCache.track, target: this.s.target === "iss" };
  }

  /** The fleet's craft not flown, near the Earth: their ground tracks (Kepler, an orbit ahead — redone every
   *  30 s of the scene's time) and where they are. */
  private craftCache = new Map<string, { t: number; track: V3[] }>();
  private craftTracks(t: number) {
    const out: NonNullable<Scene["crafts"]> = [];
    const mu = solarBody("earth")!.mass;
    for (const id of ["ranger", "lander", "endurance"] as const) {
      if (fleet.activePose?.() && fleet.flownAssembly().includes(id)) continue;
      const p = fleet.pose(id, t);
      if (!p) continue;
      const E = solarState("earth", t);
      const r0 = sub3(p.X as V3, E.pos as V3), v0 = sub3(p.V as V3, E.vel as V3);
      const r = Math.hypot(...r0);
      if (r * M_METRES > 1e8) continue;
      const eps = (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) / 2 - mu / r;
      if (!(eps < 0)) continue;
      const P = 2 * Math.PI * Math.sqrt((-mu / (2 * eps)) ** 3 / mu);
      let c = this.craftCache.get(id);
      if (!c || Math.abs(t - c.t) > 30 / M_SECONDS) {
        const track: V3[] = [];
        for (let k = 0; k <= 120; k++) {
          const tk = t + (P * k) / 120;
          const q = keplerProp(mu, r0, v0, tk - t).r as V3;
          const Ek = solarState("earth", tk).pos as V3;
          track.push(unit(toBodyFixed("earth", [Ek[0] + q[0], Ek[1] + q[1], Ek[2] + q[2]], tk)));
        }
        this.craftCache.set(id, (c = { t, track }));
      }
      out.push({ id, name: VESSELS[id].name, col: OUR_COLOURS[id] ?? "255, 255, 255", q: unit(toBodyFixed("earth", p.X as V3, t)), track: c.track, target: this.s.target === id });
    }
    return out;
  }

  /**
   * A predicted path's points over the world (on its axes, at their times) while in its sphere, from
   * now — converted once per path (it lives for seconds: the points it had ahead fall behind the ship).
   */
  private track(p: OurPath | null, id: string, t: number, R: number) {
    if (!p || !p.pts.length) return null;
    let c = this.cache.get(p);
    if (!c || c.id !== id) {
      const pts: V3[] = [], times: number[] = [];
      let lo = { r: Infinity, q: null as V3 | null }, hi = { r: -Infinity, q: null as V3 | null };
      for (let k = 0; k < p.pts.length; k++) {
        if (p.refs[k] !== id) {
          if (pts.length) break;
          continue;
        }
        const q = toBodyFixed(id, p.pts[k] as V3, p.times[k]!);
        const r = Math.hypot(...q);
        const u = unit(q);
        pts.push(u);
        times.push(p.times[k]!);
        if (r < lo.r) lo = { r, q: u };
        if (r > hi.r) hi = { r, q: u };
      }
      const km = (r: number) => ((r - R) * M_METRES) / 1e3;
      // (apsides only on an orbit that swings: more than 2 km between them)
      const swing = hi.q && lo.q && km(hi.r) - km(lo.r) > 2;
      c = { id, pts, times, pe: swing && lo.q ? { q: lo.q, km: km(lo.r) } : null, ap: swing && hi.q && p.fate !== "impact" ? { q: hi.q, km: km(hi.r) } : null };
      this.cache.set(p, c);
    }
    let k = 0;
    while (k < c.times.length && c.times[k]! < t) k++;
    return { pts: c.pts.slice(k), pe: c.pe, ap: c.ap };
  }

  /** The track left: a point whenever the ship moved a little over the ground; a new world starts it afresh. */
  private record(id: string, q: V3, t: number) {
    const P = this.past;
    if (P.id !== id || (P.pts.length && t < P.pts.at(-1)!.t)) (P.id = id), (P.pts = []);
    const last = P.pts.at(-1);
    if (!last || Math.acos(clamp(dot(last.q, q), -1, 1)) > 0.15 * D) P.pts.push({ q, t });
    if (P.pts.length > 4000) P.pts.splice(0, P.pts.length - 4000);
  }

  // ---------------------------------------------------------------------------------- the maps
  private texture(id: string): Tex | null {
    const m = solarBody(id)?.map as MapName | undefined;
    const have = this.tex.get(id);
    if (have === "loading" || have === "none") return null;
    if (have) return have;
    if (!m) {
      this.tex.set(id, "none");
      return null;
    }
    this.tex.set(id, "loading");
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const w = Math.min(1024, img.naturalWidth), hh = Math.round(w / 2);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = hh;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(img, 0, 0, w, hh);
      this.tex.set(id, { w, h: hh, px: new Uint32Array(x.getImageData(0, 0, w, hh).data.buffer), img: c });
      this.raster.key = "";
      this.redraw?.();
    };
    img.onerror = () => this.tex.set(id, "none");
    img.src = planetMapUrl(m);
    return null;
  }

  /** The room kept free above and below the world [device px]: the labels; full screen, the cockpit. */
  /** the tracer's GPU and maps (the globe drawn on it — the planet's own map, its day and night, its air) */
  gpuSource: (() => { device: GPUDevice; textures(): MapTextures | null } | null) | null = null;
  private gpu: MapGpu | null = null;
  private gpuTried = false;
  private gpuLayer(): MapGpu | null {
    if (!this.gpu && !this.gpuTried) {
      const src = this.gpuSource?.();
      if (!src) return null;
      this.gpuTried = true;
      try {
        this.gpu = new MapGpu(src.device, src.textures);
      } catch (e) {
        console.warn("The globe's GPU layer: none —", e);
        this.gpu = null;
      }
    }
    // (its pipelines still building, or refused: the canvas draws alone)
    const G = this.gpu;
    if (!G || G.status !== "ok") return null;
    if (!G.canvas.parentNode) {
      this.stage.insertBefore(G.canvas, this.canvas);
    }
    return G;
  }

  /** full screen: the panels over the stage's edges [CSS px] (the host's measure) */
  insets: (() => { l: number; r: number; t: number; b: number }) | null = null;
  private margins(dpr: number) {
    const full = !!this.stage.closest(".mapview");
    const i = full ? this.insets?.() : null;
    if (i) return { top: (i.t + 8) * dpr, bottom: (i.b + 8) * dpr, left: i.l * dpr, right: i.r * dpr };
    return { top: (full ? 40 : 16) * dpr, bottom: (full ? 200 : 22) * dpr, left: 0, right: 0 };
  }

  // ---------------------------------------------------------------------------------- the globe
  /** The globe's axes: its centre, east and north there (the world's axes). */
  private axes(): { C: V3; E: V3; N: V3 } {
    const { lat, lon } = this.view;
    return {
      C: fromLatLon(lat, lon),
      E: [-Math.sin(lon), Math.cos(lon), 0],
      N: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    };
  }

  /** The world for the GPU: its map (or the Earth's, or its procedural surface), its air, lit from L —
   *  at c (view space, radius 1), on its axes, its night side at least so lit. */
  private worldBody(sc: Scene, c: V3, L: V3, ax: [V3, V3, V3], night: number): GpuBody {
    const lin = (x: number) => Math.pow(x / 255, 2.2);
    const t = THEIRS[sc.id] ?? [150, 150, 150];
    const col = t.map(lin) as V3;
    const sb = solarBody(sc.id);
    const AIR: Record<string, V3> = { earth: [0.3, 0.55, 1], mars: [0.85, 0.5, 0.32], venus: [1, 0.85, 0.55], titan: [0.95, 0.6, 0.22], miller: [0.55, 0.75, 1], mann: [0.75, 0.85, 1], edmunds: [0.95, 0.75, 0.5] };
    const proc = { miller: 0, mann: 1, edmunds: 2 }[sc.id as "miller"];
    const hi = sb?.map ? MAPS_HI.indexOf(sb.map) : -1, lo = sb?.map ? MAPS_LO.indexOf(sb.map) : -1;
    const kind = sc.id === "earth" ? BodyKind.Earth : proc !== undefined ? BodyKind.Proc : hi >= 0 || lo >= 0 ? BodyKind.Map : BodyKind.Plain;
    return {
      c, R: 1, kind, layer: hi >= 0 ? hi : -(lo + 1), proc, L, col, ax,
      air: AIR[sc.id] ? { col: AIR[sc.id]!, k: 0.9 } : undefined, minPx: 1, night,
    };
  }

  private drawGlobe(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, sc: Scene, tex: Tex | null) {
    const v = this.view;
    if (v.follow && sc.ship) {
      // (the ship at the centre, the globe turning under it — eased, a jump taken at once)
      const [la, lo] = latLon(sc.ship);
      const dl = Math.atan2(Math.sin(lo - v.lon), Math.cos(lo - v.lon));
      const far = Math.abs(dl) > 0.6 || Math.abs(la - v.lat) > 0.6;
      v.lon += far ? dl : dl * 0.35;
      v.lat += far ? la - v.lat : (la - v.lat) * 0.35;
    }
    const { C, E, N } = this.axes();
    const { top, bottom, left, right } = this.margins(dpr);
    const R = (Math.min(W - left - right, H - top - bottom) / 2 - 6 * dpr) * v.zoom;
    const cx = left + (W - left - right) / 2, cy = top + (H - top - bottom) / 2;
    const proj = (q: V3) => ({ x: cx + dot(q, E) * R, y: cy - dot(q, N) * R, vis: dot(q, C) > 0 });
    this.hit = { globe: true, cx, cy, R, C, E, N };

    // on the GPU: the world's own map at the screen's resolution, lit, its air — the canvas over it
    const G = this.gpuLayer();
    this.pen.G = G;
    // (the globe seen from 100 radii: a sphere of radius 1 there)
    const far = 100;
    if (G) {
      G.canvas.style.display = "";
      const view = (v: V3): V3 => [dot(v, E), dot(v, N), -dot(v, C)];
      // (the light: the Sun's, ours; Gargantua's worlds, over the viewer's shoulder)
      G.begin();
      G.body(this.worldBody(sc, [0, 0, far], sc.sun ? view(sc.sun) : [0.35, 0.45, -0.82], [view([1, 0, 0]), view([0, 1, 0]), view([0, 0, 1])], 0.035));
    }
    // the atmosphere's rim, the lit disc (the raster: at most 420 px across, scaled up)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.08);
    halo.addColorStop(0, sc.id === "earth" ? "rgba(120, 180, 255, 0.35)" : "rgba(200, 210, 230, 0.12)");
    halo.addColorStop(1, "rgba(120, 180, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    if (!G) ctx.arc(cx, cy, R * 1.08, 0, 2 * Math.PI);
    ctx.fill();
    const n = Math.max(8, Math.min(420, Math.round(2 * R)));
    const sun = sc.sun;
    const key = [sc.id, n, v.lat.toFixed(4), v.lon.toFixed(4), sun ? sun.map((x) => x.toFixed(3)).join() : "", tex ? tex.w : 0].join("|");
    if (key !== this.raster.key && !G) {
      this.raster.key = key;
      this.renderGlobe(n, sc, tex, C, E, N);
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    if (!G) ctx.drawImage(this.raster.c, cx - R, cy - R, 2 * R, 2 * R);

    // the graticule: every 30° (the equator and the prime meridian brighter)
    ctx.lineWidth = 1 * dpr;
    const line = (pts: V3[], col: string) => {
      // (on the GPU: anti-aliased, the far side left out)
      if (G) {
        G.line(col, 1 * dpr);
        for (const q of pts) {
          const p = proj(q);
          if (p.vis) G.to(p.x, p.y, 0, 1);
          else G.gap();
        }
        G.gap();
        return;
      }
      ctx.strokeStyle = col;
      ctx.beginPath();
      let on = false;
      for (const q of pts) {
        const p = proj(q);
        if (!p.vis) {
          on = false;
          continue;
        }
        if (on) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        on = true;
      }
      ctx.stroke();
    };
    for (let la = -60; la <= 60; la += 30) line(Array.from({ length: 73 }, (_, k) => fromLatLon(la * D, k * 5 * D)), la === 0 ? "rgba(200, 230, 255, 0.32)" : "rgba(200, 230, 255, 0.14)");
    for (let lo = -180; lo < 180; lo += 30) line(Array.from({ length: 37 }, (_, k) => fromLatLon((-90 + k * 5) * D, lo * D)), lo === 0 ? "rgba(200, 230, 255, 0.32)" : "rgba(200, 230, 255, 0.14)");
    ctx.restore();

    this.overlays(ctx, dpr, sc, (q) => {
      const p = proj(q);
      return p.vis ? [p.x, p.y] : null;
    }, 0, G);
    if (G) G.render(W, H, R * Math.sqrt(far * far - 1), cx, cy, [E, N, [-C[0], -C[1], -C[2]]], performance.now() / 1000);
    // (the rim)
    ctx.strokeStyle = "rgba(160, 210, 255, 0.35)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.stroke();
  }

  /** The lit globe, n × n pixels: the map sampled per pixel, the day and the night, the limb. */
  private renderGlobe(n: number, sc: Scene, tex: Tex | null, C: V3, E: V3, N: V3) {
    const c = this.raster.c;
    if (c.width !== n) (c.width = n), (c.height = n);
    const x = c.getContext("2d")!;
    const img = x.createImageData(n, n);
    const out = new Uint32Array(img.data.buffer);
    const tint = THEIRS[sc.id] ?? [150, 150, 150];
    const sun = sc.sun;
    for (let j = 0; j < n; j++) {
      const py = 1 - ((j + 0.5) / n) * 2;
      for (let i = 0; i < n; i++) {
        const px = ((i + 0.5) / n) * 2 - 1;
        const rr = px * px + py * py;
        if (rr >= 1) continue;
        const pz = Math.sqrt(1 - rr);
        const q0 = px * E[0] + py * N[0] + pz * C[0], q1 = px * E[1] + py * N[1] + pz * C[1], q2 = px * E[2] + py * N[2] + pz * C[2];
        let r: number, g: number, b: number;
        if (tex) {
          const u = 0.5 + Math.atan2(q1, q0) / (2 * Math.PI), vv = 0.5 - Math.asin(q2 < -1 ? -1 : q2 > 1 ? 1 : q2) / Math.PI;
          const s = tex.px[Math.min(tex.h - 1, (vv * tex.h) | 0) * tex.w + Math.min(tex.w - 1, (u * tex.w) | 0)]!;
          (r = s & 255), (g = (s >> 8) & 255), (b = (s >> 16) & 255);
        } else {
          // (no map: the world's tint, banded by latitude)
          const k = 0.85 + 0.15 * Math.cos(q2 * 9);
          (r = tint[0] * k), (g = tint[1] * k), (b = tint[2] * k);
        }
        // the day and the night (a soft terminator), the limb darkened
        let L = 0.55 + 0.45 * pz;
        if (sun) {
          const d = q0 * sun[0] + q1 * sun[1] + q2 * sun[2];
          const day = smooth(-0.06, 0.1, d);
          L *= 0.16 + 0.84 * day * (0.45 + 0.55 * Math.sqrt(Math.max(d, 0)));
          // (the night a little blue)
          b += (1 - day) * 18;
        }
        out[j * n + i] = (255 << 24) | (Math.min(255, b * L) << 16) | (Math.min(255, g * L) << 8) | Math.min(255, r * L);
      }
    }
    x.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------------------------- the planisphere
  private drawMap(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, sc: Scene, tex: Tex | null) {
    const { top, bottom, left, right } = this.margins(dpr);
    const aw = W - left - right - 8 * dpr, ah = H - top - bottom;
    const mw = Math.min(aw, 2 * ah), mh = mw / 2;
    const x0 = left + (W - left - right - mw) / 2, y0 = top + (ah - mh) / 2;
    const at = (q: V3): [number, number] => {
      const [la, lo] = latLon(q);
      return [x0 + (0.5 + lo / (2 * Math.PI)) * mw, y0 + (0.5 - la / Math.PI) * mh];
    };
    this.hit = { globe: false, x0, y0, mw, mh };
    // on the GPU: the world's surface pixel by pixel — the map at the screen's resolution, lit by the Sun
    // (the terminator, the Earth's city lights at night), the tracks over it
    const G = this.gpuLayer();
    this.pen.G = G;
    if (G) {
      G.canvas.style.display = "";
      G.begin();
      G.body(this.worldBody(sc, [0, 0, 1], sc.sun ?? [0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], sc.sun ? 0.06 : 0.92));
      G.planisphere([x0, y0, mw, mh]);
    } else if (tex) ctx.drawImage(tex.img, x0, y0, mw, mh);
    else {
      const t = THEIRS[sc.id] ?? [120, 120, 120];
      ctx.fillStyle = `rgb(${t.join(",")})`;
      ctx.fillRect(x0, y0, mw, mh);
    }
    // the night: a mask computed on a 360 × 180 grid, laid over smoothed (the GPU lights its own)
    if (sc.sun && !G) {
      const key = sc.sun.map((x) => x.toFixed(3)).join();
      const c = this.night.c;
      if (this.night.key !== key) {
        this.night.key = key;
        const w = 360, hh = 180;
        if (c.width !== w) (c.width = w), (c.height = hh);
        const x = c.getContext("2d")!;
        const img = x.createImageData(w, hh);
        const out = new Uint32Array(img.data.buffer);
        for (let j = 0; j < hh; j++) {
          const la = (0.5 - (j + 0.5) / hh) * Math.PI;
          for (let i = 0; i < w; i++) {
            const q = fromLatLon(la, ((i + 0.5) / w - 0.5) * 2 * Math.PI);
            const d = dot(q, sc.sun);
            const a = (1 - smooth(-0.06, 0.1, d)) * 0.72 + (d > 0 ? (1 - Math.sqrt(d)) * 0.25 : 0);
            out[j * w + i] = ((a * 255) << 24) | (22 << 16) | (8 << 8) | 2;
          }
        }
        x.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c, x0, y0, mw, mh);
    }
    // the graticule, the frame
    const pt = this.pen;
    for (let k = 0; k <= 12; k++) {
      const x = x0 + (k / 12) * mw;
      pt.path([[x, y0], [x, y0 + mh]], k === 6 ? "rgba(200, 230, 255, 0.3)" : "rgba(200, 230, 255, 0.12)", 1 * dpr);
    }
    for (let k = 1; k < 6; k++) {
      const y = y0 + (k / 6) * mh;
      pt.path([[x0, y], [x0 + mw, y]], k === 3 ? "rgba(200, 230, 255, 0.3)" : "rgba(200, 230, 255, 0.12)", 1 * dpr);
    }
    pt.path([[x0, y0], [x0 + mw, y0], [x0 + mw, y0 + mh], [x0, y0 + mh], [x0, y0]], "rgba(160, 210, 255, 0.35)", 1 * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, mw, mh);
    ctx.clip();
    this.overlays(ctx, dpr, sc, at, mw, G);
    ctx.restore();
    if (G) G.render(W, H, 1, 0, 0, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], performance.now() / 1000, { sky: false });
  }

  // ---------------------------------------------------------------------------------- over the world
  /**
   * The tracks, the horizon seen from the ship, the point under the Sun, the apsides, the ship. `at`:
   * a direction's place on the canvas (null: hidden); `wrap`: the planisphere's width (a line across
   * its edge is broken there), 0 on the globe.
   */
  private overlays(ctx: CanvasRenderingContext2D, dpr: number, sc: Scene, at: (q: V3) => [number, number] | null, wrap: number, G: MapGpu | null = null) {
    const pt = this.pen;
    const path = (pts: V3[], col: string, width: number, dash: number[] = [], alpha?: (k: number) => number) => {
      if (pts.length < 2) return;
      // (on the GPU: anti-aliased, faded along, broken where hidden or across the planisphere's edge)
      if (G) {
        G.line(col, width * dpr, dash.map((d) => d * dpr));
        let prev: [number, number] | null = null;
        pts.forEach((q, k) => {
          const p = at(q);
          if (!p || (prev && wrap && Math.abs(p[0] - prev[0]) > wrap / 2)) G.gap();
          if (p) G.to(p[0], p[1], 0, alpha ? alpha(k / (pts.length - 1)) : 1);
          prev = p;
        });
        G.gap();
        return;
      }
      ctx.lineWidth = width * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.lineCap = "round";
      let prev: [number, number] | null = null;
      if (alpha) {
        // (fading: a segment at a time)
        for (let k = 1; k < pts.length; k++) {
          const a = at(pts[k - 1]!), b = at(pts[k]!);
          if (!a || !b || (wrap && Math.abs(b[0] - a[0]) > wrap / 2)) continue;
          ctx.globalAlpha = alpha(k / (pts.length - 1));
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (const q of pts) {
          const p = at(q);
          if (!p) {
            prev = null;
            continue;
          }
          if (prev && !(wrap && Math.abs(p[0] - prev[0]) > wrap / 2)) ctx.lineTo(p[0], p[1]);
          else ctx.moveTo(p[0], p[1]);
          prev = p;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    // the horizon the ship sees: a circle of angular radius acos(R / (R + h)) about the point under it
    const ship = sc.ship;
    if (ship && Number.isFinite(sc.Rkm) && sc.altKm > 0) {
      const rho = Math.acos(sc.Rkm / (sc.Rkm + sc.altKm));
      const s = ship;
      const u = unit(cross(Math.abs(s[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], s));
      const w = cross(s, u);
      const ring = Array.from({ length: 97 }, (_, k) => {
        const a = (k / 96) * 2 * Math.PI;
        return unit([0, 1, 2].map((m) => s[m]! * Math.cos(rho) + (u[m]! * Math.cos(a) + w[m]! * Math.sin(a)) * Math.sin(rho)) as V3);
      });
      path(ring, "rgba(124, 214, 255, 0.45)", 1, [3, 3]);
    }
    // the track left (fading into the past), the one ahead, the planned one
    if (ship && this.past.id === sc.id) path(this.past.pts.map((p) => p.q).concat([ship]), "rgba(255, 196, 120, 0.9)", 1.6, [], (k) => 0.12 + 0.8 * k);
    if (ship) path([ship, ...sc.ahead], CYAN, 1.6, [5, 4]);
    path(sc.plan, AMBER, 1.6, [2, 3]);
    // the flight computer's preview, the entry's predicted fall
    if (sc.cand?.length) path(sc.cand, "rgb(196, 140, 255)", 2.2, [7, 4]);
    if (sc.entry?.length) path(sc.entry, "rgb(255, 154, 74)", 2, [6, 3]);
    // the world's landing sites: a ring (a runway: a bar), the chosen one bright
    for (const st of sc.sites ?? []) {
      const p = at(st.q);
      if (!p) continue;
      const col = st.chosen ? "rgb(255, 210, 122)" : "rgba(255, 210, 122, 0.6)";
      pt.disc(p[0], p[1], (st.chosen ? 5 : 3.5) * dpr, null, col, (st.chosen ? 2 : 1.2) * dpr);
      if (st.runway) pt.poly(p[0], p[1], [[-5 * dpr, -0.8 * dpr], [5 * dpr, -0.8 * dpr], [5 * dpr, 0.8 * dpr], [-5 * dpr, 0.8 * dpr]], col);
      ctx.fillStyle = col;
      ctx.font = `${st.chosen ? 700 : 600} ${(st.chosen ? 10.5 : 9) * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(st.name.split(",")[0]!, p[0] + 7 * dpr, p[1]);
    }
    // the space station: its ground track an orbit ahead, where it is (brighter when it is the target)
    if (sc.iss) {
      const tc = sc.iss.target ? "rgba(95, 255, 208, 0.85)" : "rgba(95, 255, 208, 0.4)";
      path(sc.iss.track, tc, sc.iss.target ? 1.4 : 1, [4, 3]);
      const p = at(sc.iss.q);
      if (p) {
        // (a station: a body and its wings)
        const box = (w: number, hh: number) => [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([u, v]) => [u! * dpr, v! * dpr] as const);
        pt.poly(p[0], p[1], box(8, 1), "rgb(95, 255, 208)");
        pt.poly(p[0], p[1], box(2.5, 2.5), "rgb(95, 255, 208)");
        ctx.fillStyle = "rgb(95, 255, 208)";
        ctx.font = `700 ${10 * dpr}px ${FONT}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("ISS", p[0] + 10 * dpr, p[1] - 6 * dpr);
      }
    }
    // the fleet's craft: their tracks, where they are (a diamond)
    for (const c of sc.crafts ?? []) {
      path(c.track, `rgba(${c.col}, ${c.target ? 0.85 : 0.35})`, c.target ? 1.4 : 1, [4, 3]);
      const p = at(c.q);
      if (!p) continue;
      pt.poly(p[0], p[1], [[0, -4 * dpr], [4 * dpr, 0], [0, 4 * dpr], [-4 * dpr, 0]], `rgb(${c.col})`);
      ctx.fillStyle = `rgb(${c.col})`;
      ctx.font = `700 ${10 * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(c.name, p[0] + 7 * dpr, p[1] - 6 * dpr);
    }
    // the point under the Sun
    if (sc.sun) {
      const p = at(sc.sun);
      if (p) {
        pt.disc(p[0], p[1], 3.2 * dpr, "rgba(255, 220, 120, 0.95)");
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * 2 * Math.PI;
          pt.path([[p[0] + Math.cos(a) * 5 * dpr, p[1] + Math.sin(a) * 5 * dpr], [p[0] + Math.cos(a) * 7.5 * dpr, p[1] + Math.sin(a) * 7.5 * dpr]], "rgba(255, 220, 120, 0.7)", 1.2 * dpr);
        }
      }
    }
    ctx.font = `600 ${10 * dpr}px ${FONT}`;
    ctx.textBaseline = "middle";
    for (const [m, lab] of [[sc.pe, "Pe"], [sc.ap, "Ap"]] as const) {
      const p = m && at(m.q);
      if (!m || !p) continue;
      pt.poly(p[0], p[1], [[0, -4 * dpr], [4 * dpr, 0], [0, 4 * dpr], [-4 * dpr, 0]], "#9fe3ff");
      ctx.fillStyle = "#9fe3ff";
      ctx.textAlign = "left";
      ctx.fillText(`${lab} ${fmtKm(m.km)}`, p[0] + 7 * dpr, p[1]);
    }
    // the place picked: a sight
    const pk = this.pick && at(this.pick);
    if (pk) {
      const r = 6 * dpr;
      for (const [lw, col] of [[3.5, "rgba(0, 0, 0, 0.6)"], [1.6, "#6fe3a1"]] as const) {
        pt.disc(pk[0], pk[1], r, null, col, lw * dpr);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) pt.path([[pk[0] + dx * r * 0.45, pk[1] + dy * r * 0.45], [pk[0] + dx * r * 1.8, pk[1] + dy * r * 1.8]], col, lw * dpr);
      }
    }
    // the ship: a chevron along its track
    const p = ship && at(ship);
    if (ship && p) {
      const nxt = sc.ahead.find((q) => Math.acos(clamp(dot(q, ship), -1, 1)) > 0.05 * D);
      const prv = this.past.pts.at(-2)?.q;
      const qa = nxt ?? ship, qb = nxt ? ship : (prv ?? ship);
      const a = at(qa), b = at(qb);
      let ang = -Math.PI / 2;
      if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.1 && !(wrap && Math.abs(a[0] - b[0]) > wrap / 2)) ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
      const r = 7 * dpr, ca = Math.cos(ang), sa = Math.sin(ang);
      const turn = (x: number, y: number) => [x * ca - y * sa, x * sa + y * ca] as const;
      pt.poly(p[0], p[1], [turn(r, 0), turn(-0.7 * r, 0.65 * r), turn(-0.35 * r, 0), turn(-0.7 * r, -0.65 * r)], AMBER, "rgba(0, 0, 0, 0.7)", 1.5 * dpr);
    }
  }

  // ---------------------------------------------------------------------------------- gestures
  private bindPointer() {
    const cv = this.canvas;
    let down: { x: number; y: number; moved: boolean } | null = null;
    cv.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      if (this.mode !== "globe") return;
      cv.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, lat: this.view.lat, lon: this.view.lon };
      this.animating = true;
    });
    // (a click that did not drag: the place under it, for the picker)
    cv.addEventListener("click", (e) => {
      if (!this.onPick || !down || down.moved) return;
      const q = this.placeAt(e);
      if (!q) return;
      this.pick = q;
      this.onPick(q);
      this.redraw?.();
    });
    cv.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      const R = Math.max(40, Math.min(this.stage.clientWidth, this.stage.clientHeight) / 2) * this.view.zoom;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 3) return;
      if (down) down.moved = true;
      this.view.follow = false;
      this.view.lon = d.lon - (e.clientX - d.x) / R;
      this.view.lat = clamp(d.lat + (e.clientY - d.y) / R, -Math.PI / 2, Math.PI / 2);
      if (this.onPick) this.redraw?.();
    });
    const end = () => {
      this.drag = null;
      this.animating = false;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", () => {
      this.view.follow = true;
      this.view.zoom = 1;
    });
    cv.addEventListener("wheel", (e) => {
      if (this.mode !== "globe") return;
      e.preventDefault();
      this.view.zoom = clamp(this.view.zoom * Math.exp(-e.deltaY * 0.0015), 1, 8);
      this.redraw?.();
    }, { passive: false });
  }

  /** The place under a pointer event (a unit direction on the world's axes), or null (off the world). */
  private placeAt(e: MouseEvent): V3 | null {
    const H = this.hit;
    if (!H) return null;
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / Math.max(r.width, 1);
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    if (H.globe) {
      const px = (x - H.cx) / H.R, py = -(y - H.cy) / H.R;
      const rr = px * px + py * py;
      if (rr >= 1) return null;
      const pz = Math.sqrt(1 - rr);
      return unit([0, 1, 2].map((i) => px * H.E[i]! + py * H.N[i]! + pz * H.C[i]!) as V3);
    }
    const u = (x - H.x0) / H.mw, v = (y - H.y0) / H.mh;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return fromLatLon((0.5 - v) * Math.PI, (u - 0.5) * 2 * Math.PI);
  }
}
