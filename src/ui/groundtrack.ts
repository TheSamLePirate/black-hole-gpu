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
import { planetMapUrl } from "../system/planet-maps";
import { BODY_NAMES, type Body } from "../targeting";
import { AMBER, CYAN, FONT } from "./hudkit";
import { planetFrame, toLocal } from "../landing";
import type { Settings } from "../settings";

type V3 = [number, number, number];
export type GroundMode = "globe" | "map";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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
  /** the periapsis / apoapsis on the path ahead, with their heights [km] */
  pe: { q: V3; km: number } | null;
  ap: { q: V3; km: number } | null;
}

export class GroundTrack {
  readonly stage = h("div", "gt-stage");
  private canvas = h("canvas", "gt-canvas");
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

  // ---------------------------------------------------------------------------------- the scene
  private scene(i: Info, t: number): Scene | null {
    const id = this.worldOf(i);
    if (!id) return null;
    const name = BODY_NAMES[id as Body] ?? id;
    if (i.status!.side === "gargantua") {
      const xi = this.theirXi(i, id, t);
      const F = planetFrame(id as "miller" | "mann" | "edmunds", t, this.s.spin, this.s.massSolar);
      return { id, name, Rkm: (F.R * F.mPerM) / 1e3, ours: false, ship: unit(xi), altKm: i.status!.altKm, sun: null, ahead: [], plan: [], pe: null, ap: null };
    }
    const b = solarBody(id)!;
    const q = toBodyFixed(id, i.X as V3, t);
    const Rkm = (b.radius * M_METRES) / 1e3;
    const ahead = this.track(i.ourFree as OurPath | null, id, t, b.radius);
    const plan = this.track(i.ourPlan as OurPath | null, id, t, b.radius);
    return {
      id, name, Rkm, ours: true, ship: unit(q), altKm: (Math.hypot(...q) - b.radius) * M_METRES / 1e3,
      sun: unit(toBodyFixed(id, solarState("sun", t).pos as V3, t)),
      ahead: ahead?.pts ?? [], plan: plan?.pts ?? [], pe: ahead?.pe ?? null, ap: ahead?.ap ?? null,
    };
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
  private margins(dpr: number) {
    const full = !!this.stage.closest(".mapview");
    return { top: (full ? 40 : 16) * dpr, bottom: (full ? 200 : 22) * dpr };
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
    const { top, bottom } = this.margins(dpr);
    const R = (Math.min(W, H - top - bottom) / 2 - 6 * dpr) * v.zoom;
    const cx = W / 2, cy = top + (H - top - bottom) / 2;
    const proj = (q: V3) => ({ x: cx + dot(q, E) * R, y: cy - dot(q, N) * R, vis: dot(q, C) > 0 });
    this.hit = { globe: true, cx, cy, R, C, E, N };

    // the atmosphere's rim, the lit disc (the raster: at most 420 px across, scaled up)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.08);
    halo.addColorStop(0, sc.id === "earth" ? "rgba(120, 180, 255, 0.35)" : "rgba(200, 210, 230, 0.12)");
    halo.addColorStop(1, "rgba(120, 180, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.08, 0, 2 * Math.PI);
    ctx.fill();
    const n = Math.max(8, Math.min(420, Math.round(2 * R)));
    const sun = sc.sun;
    const key = [sc.id, n, v.lat.toFixed(4), v.lon.toFixed(4), sun ? sun.map((x) => x.toFixed(3)).join() : "", tex ? tex.w : 0].join("|");
    if (key !== this.raster.key) {
      this.raster.key = key;
      this.renderGlobe(n, sc, tex, C, E, N);
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.raster.c, cx - R, cy - R, 2 * R, 2 * R);

    // the graticule: every 30° (the equator and the prime meridian brighter)
    ctx.lineWidth = 1 * dpr;
    const line = (pts: V3[], col: string) => {
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
    }, 0);
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
    const { top, bottom } = this.margins(dpr);
    const aw = W - 8 * dpr, ah = H - top - bottom;
    const mw = Math.min(aw, 2 * ah), mh = mw / 2;
    const x0 = (W - mw) / 2, y0 = top + (ah - mh) / 2;
    const at = (q: V3): [number, number] => {
      const [la, lo] = latLon(q);
      return [x0 + (0.5 + lo / (2 * Math.PI)) * mw, y0 + (0.5 - la / Math.PI) * mh];
    };
    this.hit = { globe: false, x0, y0, mw, mh };
    if (tex) ctx.drawImage(tex.img, x0, y0, mw, mh);
    else {
      const t = THEIRS[sc.id] ?? [120, 120, 120];
      ctx.fillStyle = `rgb(${t.join(",")})`;
      ctx.fillRect(x0, y0, mw, mh);
    }
    // the night: a mask computed on a 360 × 180 grid, laid over smoothed
    if (sc.sun) {
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
    // the graticule
    ctx.lineWidth = 1 * dpr;
    for (let k = 0; k <= 12; k++) {
      const x = x0 + (k / 12) * mw;
      ctx.strokeStyle = k === 6 ? "rgba(200, 230, 255, 0.3)" : "rgba(200, 230, 255, 0.12)";
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + mh);
      ctx.stroke();
    }
    for (let k = 1; k < 6; k++) {
      const y = y0 + (k / 6) * mh;
      ctx.strokeStyle = k === 3 ? "rgba(200, 230, 255, 0.3)" : "rgba(200, 230, 255, 0.12)";
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + mw, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(160, 210, 255, 0.35)";
    ctx.strokeRect(x0, y0, mw, mh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, mw, mh);
    ctx.clip();
    this.overlays(ctx, dpr, sc, at, mw);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------- over the world
  /**
   * The tracks, the horizon seen from the ship, the point under the Sun, the apsides, the ship. `at`:
   * a direction's place on the canvas (null: hidden); `wrap`: the planisphere's width (a line across
   * its edge is broken there), 0 on the globe.
   */
  private overlays(ctx: CanvasRenderingContext2D, dpr: number, sc: Scene, at: (q: V3) => [number, number] | null, wrap: number) {
    const path = (pts: V3[], col: string, width: number, dash: number[] = [], alpha?: (k: number) => number) => {
      if (pts.length < 2) return;
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
    // the point under the Sun
    if (sc.sun) {
      const p = at(sc.sun);
      if (p) {
        ctx.fillStyle = "rgba(255, 220, 120, 0.95)";
        ctx.strokeStyle = "rgba(255, 220, 120, 0.7)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3.2 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * 2 * Math.PI;
          ctx.beginPath();
          ctx.moveTo(p[0] + Math.cos(a) * 5 * dpr, p[1] + Math.sin(a) * 5 * dpr);
          ctx.lineTo(p[0] + Math.cos(a) * 7.5 * dpr, p[1] + Math.sin(a) * 7.5 * dpr);
          ctx.stroke();
        }
      }
    }
    ctx.font = `600 ${10 * dpr}px ${FONT}`;
    ctx.textBaseline = "middle";
    for (const [m, lab] of [[sc.pe, "Pe"], [sc.ap, "Ap"]] as const) {
      const p = m && at(m.q);
      if (!m || !p) continue;
      ctx.fillStyle = "#9fe3ff";
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - 4 * dpr);
      ctx.lineTo(p[0] + 4 * dpr, p[1]);
      ctx.lineTo(p[0], p[1] + 4 * dpr);
      ctx.lineTo(p[0] - 4 * dpr, p[1]);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillText(`${lab} ${fmtKm(m.km)}`, p[0] + 7 * dpr, p[1]);
    }
    // the place picked: a sight
    const pk = this.pick && at(this.pick);
    if (pk) {
      const r = 6 * dpr;
      for (const [lw, col] of [[3.5, "rgba(0, 0, 0, 0.6)"], [1.6, "#6fe3a1"]] as const) {
        ctx.lineWidth = lw * dpr;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(pk[0], pk[1], r, 0, 2 * Math.PI);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.moveTo(pk[0] + dx * r * 0.45, pk[1] + dy * r * 0.45);
          ctx.lineTo(pk[0] + dx * r * 1.8, pk[1] + dy * r * 1.8);
        }
        ctx.stroke();
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
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(ang);
      const r = 7 * dpr;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-0.7 * r, 0.65 * r);
      ctx.lineTo(-0.35 * r, 0);
      ctx.lineTo(-0.7 * r, -0.65 * r);
      ctx.closePath();
      ctx.fillStyle = AMBER;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
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
