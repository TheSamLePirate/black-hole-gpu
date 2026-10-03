// Flight HUD of the Ranger — laid out like a game's: the centre of the screen stays clear, the
// instruments live on its edges.
//
//  mission bar (top)        modes (SAS / hold / autopilot), time warp, the ship's clock τ against the
//                           distant clock t and their ratio, the tools menu
//  tapes (left / right)     speed (relative to the ZAMO, autopilot target bug) and altitude on a log
//                           scale (horizon, photon orbit, ISCO, periapsis / apoapsis, the star's orbit)
//                           with a vertical-speed bar
//  view markers             the nose, prograde / retrograde, burn, velocity relative to the target
//  target (top left)        distance, range rate, closest approach
//  telemetry (top right)    the last minute of speed, altitude, clock rate and thrust
//  orbit (bottom left)      the effective potential of the ship's orbit (Kerr, with L and Carter's Q):
//                           the energy line, the turning points, the region it can reach
//  cockpit (bottom centre)  the attitude ball inside throttle and g-load arcs, holds and autopilots
//  map (bottom right)       the real motions (centre-of-mass frame), attach points of the camera
//
// N cycles the density: full · minimal (tapes, cockpit, mission bar) · clean (markers only).

import { isMobile } from "./mobile";
import type { Settings, Target } from "../settings";
import type { CameraController } from "../controls";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "../pilot";
import { MOUNT_KEYS, MOUNTS, type Mount } from "../mounts";
import { VESSEL_IDS, VESSELS, type VesselId } from "../vessels";
import { fleet } from "../fleet";
import { bodyCentre, BODY_NAMES, starOrbitRadius } from "../targeting";
import { EARTH_IRRADIANCE, type PlanetProbe } from "../system/planet-probe";
import { solarState } from "../system/solar";
import type { Arrival } from "../system/our-plan";
import type { RangerStatus } from "../game/status";
import { fmtS } from "./gametools";
import { cpuProf } from "../perf";
import { drawSymbology } from "./hud/symbology";
import { Map3D } from "./map3d/map3d";
import { GroundTrack } from "./groundtrack";
import { AMBER, COL, CYAN, FONT, fmtDist, fmtDur, fmtShort, marker, MONO, OUR_COLOURS, RED } from "./hudkit";
import { AU_M, C_MPS, G0, M_METRES, M_SECONDS } from "../units";
import { sub } from "../math/vec3";
import { store } from "../util/storage";
import { onEscape } from "./keys";

/** (with the target planet's light probe, from the renderer: see system/planet-probe.ts) */
export type Info = ReturnType<CameraController["flightInfo"]> & { probe?: PlanetProbe | null; status?: RangerStatus | null };
type V3 = [number, number, number];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** The HUD's line icons (24 × 24, stroked with the text's colour). */
const ICONS: Record<string, string> = {
  path: '<path d="M3 19c4-1 5-6 9-7s6-6 9-8" /><circle cx="3" cy="19" r="1.4" class="f" /><circle cx="21" cy="4" r="1.4" class="f" />',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" class="f" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" class="f" /><path d="M16 9.5l5 5M21 9.5l-5 5" />',
  tools: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.6 2.6-2.8-.6-.6-2.8z" />',
  density: '<rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9h17M8 9v10.5" />',
  more: '<circle cx="5" cy="12" r="1.6" class="f" /><circle cx="12" cy="12" r="1.6" class="f" /><circle cx="19" cy="12" r="1.6" class="f" />',
  camera: '<path d="M3.5 8.5h3l2-2.5h7l2 2.5h3v10h-17z" /><circle cx="12" cy="13" r="3.4" />',
  plan: '<circle cx="6" cy="17" r="2" /><circle cx="18" cy="7" r="2" /><path d="M7.6 15.6C10 9 14 13 16.4 8.4" stroke-dasharray="2 2.2" />',
  chevron: '<path d="M7 10l5 5 5-5" />',
  ship: '<path d="M12 3.5l2.2 6.5 6.3 3.2-6.3 1.6L12 20.5l-2.2-5.7-6.3-1.6 6.3-3.2z" /><circle cx="12" cy="12" r="1.3" class="f" />',
};
const icon = (name: string, cls = "fl-ic") => {
  const e = document.createElement("span");
  e.className = cls;
  e.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] ?? ""}</svg>`;
  return e;
};
/** A panel's collapsed state, remembered (the header's chevron, or a click on it). */
const COLLAPSED_KEY = "kerr.hud-collapsed";
function collapsedSet(): Set<string> {
  return new Set(store.getJSON<string[]>(COLLAPSED_KEY, []));
}
/** A panel's header: its title (a span, rewritable) and a chevron that folds the panel. */
function panelHead(panel: HTMLElement, key: string, title: string) {
  const head = h("div", "fl-title fl-head");
  const t = h("span", "fl-htext", title);
  const fold = icon("chevron", "fl-fold");
  head.append(t, fold);
  head.title = "Fold / unfold";
  if (collapsedSet().has(key)) panel.classList.add("collapsed");
  head.onclick = (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    panel.classList.toggle("collapsed");
    const set = collapsedSet();
    if (panel.classList.contains("collapsed")) set.add(key);
    else set.delete(key);
    store.setJSON(COLLAPSED_KEY, [...set]);
  };
  return { head, text: t };
}

/** What each figure of the panels means (their tooltips). */
const ROW_TIPS: Record<string, string> = {
  dist: "Distance to the target, centre to centre",
  rate: "How fast the distance changes — negative: closing in",
  ca: "The closest the path comes to the target, and when",
  light: "The light falling on the target's surface, and its equilibrium temperature",
  alt: "Height above the ground under the ship",
  vv: "Speed up or down, relative to the ground",
  vh: "Speed along the ground",
  twr: "The engine's full thrust over the local weight — above 1, it can lift off",
  soi: "The body whose gravity dominates: the orbit is reckoned around it",
  pe: "The orbit's lowest point: its height above the surface",
  ap: "The orbit's highest point",
  inc: "The orbit's tilt to the body's equator",
  ecc: "0: circular · below 1: an ellipse · 1 and above: escaping",
  tpe: "Time until the next periapsis",
  palt: "Height above its surface",
  spd: "Orbital speed, and the vertical speed under it",
  pa: "Periapsis · apoapsis heights: the orbit's lowest and highest points",
  ie: "Inclination to the body's equator · eccentricity (0: circular)",
  per: "The time one orbit takes",
  next: "The next event on the path: a sphere change, an impact, a node",
  tgt: "The selected target and its distance",
};

const HOLD_KEYS: [Hold, string, string][] = [
  ["prograde", "PRO", "1"],
  ["retrograde", "RETRO", "2"],
  ["radialOut", "RAD+", "3"],
  ["radialIn", "RAD−", "4"],
  ["normal", "NRM+", "5"],
  ["antinormal", "NRM−", "6"],
  ["target", "TGT", "7"],
  ["antiTarget", "ANTI", ""],
  ["maneuver", "NODE", ""],
];
const AUTO_KEYS: [Auto, string, string][] = [
  ["hover", "HOLD POS", "8"],
  ["circularize", "CIRC", "9"],
  ["approach", "APPROACH", "0"],
  ["land", "LAND", "G"],
  ["takeoff", "TAKE OFF", "U"],
  ["entry", "ENTRY", "⇧G"],
];

const GLYPH: Record<string, string> = {
  prograde: "prograde",
  retrograde: "retrograde",
  radialOut: "prograde",
  radialIn: "retrograde",
  normal: "prograde",
  antinormal: "retrograde",
  target: "target",
  burn: "burn",
  tgtPrograde: "prograde",
  tgtRetrograde: "retrograde",
  antiTarget: "retrograde",
  maneuver: "burn",
};

export interface FlightHudActions {
  /** the game tools' window */
  tools(): void;
  /** the future path in the view, on / off */
  pathInView(): void;
  /** the sound, on / off */
  sound(): void;
  plan(goal: "orbit" | "star" | "wormhole", r2: number, orbitStar: boolean): void;
  /** our universe: an orbit around the reference body, a transfer to the target or the mouth */
  planOur(kind: "orbit" | "target" | "wormhole", arrival: Arrival, altKm: number, retKm: number): void;
  align(goal: "orbit" | "star" | "wormhole"): void;
  addNode(): void;
  nudge(i: number, dv: V3, dt: number): void;
  deleteNode(i: number): void;
  clearPlan(): void;
  execute(): void;
  hold(h: Hold): void;
  auto(a: Auto): void;
  sas(): void;
  roll(): void;
  warp(dir: 1 | -1): void;
  /** the app's camera panel (its views, the look, the lens, the target) — else the HUD's own menu */
  camera?(): void;
  mount(m: Mount): void;
  /** fly another craft of the fleet */
  vessel(id: VesselId): void;
  lookAhead(): void;
  throttle(t: number): void;
  /** lets go of the space station */
  undock(): void;
  /** a body clicked on the map: make it the target */
  select(body: string): void;
  /** a manoeuvre node at a time of the path (scene time) */
  addNodeAt(t: number): void;
  /** the navball's speed: orbit ↔ target */
  speedMode(): void;
}

/** (si: our universe or a planet's frame — speed in m/s, altitude in km — else c and M) */
interface Sample {
  w: number;
  /** the scene's time [s], the speed as the tape shows it [c] */
  ts: number;
  v: number;
  speed: number;
  r: number;
  dtau: number;
  g: number;
  si: boolean;
}

export class FlightHud {
  private root = h("div", "fl-root");
  private hud: HTMLCanvasElement;
  private warn = h("div", "fl-warn");
  /** the air data (in the air): the flight law, the flow, the load, the skin, the configuration */
  private airData = h("div", "fl-airdata");
  private airKey = "";
  private mission = h("div", "fl-mission fl-panel");
  /** the docking aid: the station's nearest port and the ship's ring against it */
  private dock = h("div", "fl-dock fl-panel");
  private dockKey = "";
  private missionEls: Record<string, HTMLElement> = {};
  /** where the app's transport bar goes while flying (ui/transport.ts) */
  readonly transportSlot = h("div", "fl-transport");
  private target = h("div", "fl-target fl-panel");
  private targetEls: Record<string, HTMLElement> = {};
  private tel = h("div", "fl-tel fl-panel");
  private telCanvas = h("canvas", "fl-telc");
  /** the Ranger's status (sphere of influence, what it does, orbit, target) */
  private stBox = h("div", "fl-status");
  private stBadge = h("div", "fl-badge");
  private stEls: Record<string, HTMLElement> = {};
  private orbitHead: HTMLElement | null = null;
  /** when each instrument was last drawn (performance.now) */
  private drawnAt: Record<string, number> = {};
  private orbit = h("div", "fl-orbit fl-panel");
  private sel = 0;
  /** the tracer's GPU and its maps, for the map's textured bodies (main.ts) */
  /** The future as the eye sees it, at the times asked [s ahead] (controls.ts futureView): the HUD's
   *  path, its places to come, the impact. */
  future: ((at: number[]) => import("../controls").FutureView | null) | null = null;
  /** The runway in reach as the eye sees it (controls.ts runwayView). */
  runway: (() => import("../controls").RunwayView | null) | null = null;
  /** The hole's orbit (radii [M]: the periapsis, the apoapsis on the geodesic) — the strip's Pe and Ap. */
  kerrApsides: (() => { rp: number; ra: number; fate: string } | null) | null = null;
  mapGpu: { device: GPUDevice; textures(): import("./map3d/gpu").MapTextures | null } | null = null;

  /** Why an autopilot cannot be engaged now (the hub's own reason), "" when it can. */
  autoWhy(a: Auto): string {
    return this.buttons.get(a)?.dataset.why ?? "";
  }
  /** the planner's button and key: the flight computer's MISSION tab over the map (main.ts) */
  onPlanner: (() => void) | null = null;
  private veff = h("canvas", "fl-veff");
  private orbitEls: Record<string, HTMLElement> = {};
  private cockpit = h("div", "fl-cockpit");
  /** the hub's card, beside the ring: the autopilot flying, its phase, figures, prediction */
  private hubCard = h("div", "fl-panel fl-hubcard");
  private hubSig = "";
  private ball = h("canvas", "fl-ball");
  private right = h("div", "fl-right fl-panel");
  /** full screen: the flight's essentials in a strip under the map (the HUD's instruments hidden) */
  private strip = h("div", "fl-mapstrip");
  private stripEls: Record<string, HTMLElement> = {};
  private stripBtns = new Map<Auto, HTMLButtonElement>();
  /** the map (3D): the minimap in the right panel, over the whole screen with M */
  private map3d!: Map3D;
  /** the ground track (a globe, a planisphere) of the world the ship orbits; the tab shown and its buttons */
  private ground!: GroundTrack;
  private mapTab: "orbit" | "globe" | "map" = "orbit";
  private tabBtns: Record<string, HTMLButtonElement> = {};
  private mapBody: HTMLElement | null = null;
  private buttons = new Map<string, HTMLButtonElement>();
  private viewMenu: HTMLElement | null = null;
  private craftMenu: HTMLElement | null = null;
  /** the target's and the Ranger's instruments (canvases), and their tooltips' regions (CSS px) */
  private tgtCanvas = h("canvas", "fl-instr fl-tgtc");
  private stCanvas = h("canvas", "fl-instr fl-stc");
  private regions = new Map<HTMLCanvasElement, { x: number; y: number; w: number; h: number; label: string; tip: string }[]>();
  /** the readout above the ball: throttle, g-load, the engine and its tank */
  private ballRead: { thr: HTMLElement; g: HTMLElement; eng: HTMLElement } | null = null;
  private trail: { X: V3; t: number }[] = [];
  private samples: Sample[] = [];
  private ballImg: ImageData | null = null;
  private throttleDrag = false;
  private start: { t: number; tau: number } | null = null;
  private lastInfo: Info | null = null;

  /** the map over the whole screen (M) */
  mapView = false;
  /** Another layer over the HUD (the flight computer's), shown with it. */
  attach(el: HTMLElement) {
    this.root.append(el);
  }
  private unEscapeMap?: () => void;
  toggleMapView() {
    this.mapView = !this.mapView;
    this.unEscapeMap?.();
    this.unEscapeMap = this.mapView ? onEscape(() => this.mapView && this.toggleMapView()) : undefined;
    this.root.classList.toggle("mapview", this.mapView);
    this.hud.classList.toggle("mapview", this.mapView);
    document.body.classList.toggle("map-open", this.mapView);
    this.insetAt = -1e9;
    this.drawnAt.map = -1e9;
  }

  /**
   * Full screen: the strip of the flight's essentials under the map — where it is (the state, the body),
   * its height and speed, its apsides — and the autopilots, the hub's own buttons (the same actions).
   */
  private buildStrip(svg: Record<string, string>, tips: Record<string, string>) {
    const S = this.strip;
    const cell = (k: string, label: string) => {
      const c = h("div", "fl-ms-cell");
      const v = h("b", "", "—");
      c.append(h("small", "", label), v);
      this.stripEls[k] = v;
      return c;
    };
    const state = h("div", "fl-ms-state");
    this.stripEls.state = state;
    const read = h("div", "fl-ms-read");
    read.append(cell("alt", "ALTITUDE"), cell("spd", "SPEED"), cell("pe", "PERIAPSIS"), cell("ap", "APOAPSIS"));
    const autos = h("div", "fl-ms-autos");
    for (const [a, label, key] of AUTO_KEYS) {
      const b = h("button", "fl-ms-auto") as HTMLButtonElement;
      b.innerHTML = `<svg viewBox="-12 -12 24 24">${svg[a] ?? ""}</svg><span>${label}</span>`;
      b.dataset.label = label;
      b.dataset.tip = `${tips[a] ?? ""}${key ? ` (${key})` : ""}`;
      b.onclick = () => this.act.auto(a);
      this.stripBtns.set(a, b);
      autos.append(b);
    }
    S.append(state, read, autos);
  }

  /** The hub's card: shown while an autopilot flies — what it does, its figures, what it predicts. */
  private drawHubCard(i: Info) {
    const H = i.hub;
    const C = this.hubCard;
    if (!H) {
      if (!C.hidden) (C.hidden = true), (this.hubSig = "");
      return;
    }
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    const sig = JSON.stringify(H);
    if (sig === this.hubSig && !C.hidden) return;
    this.hubSig = sig;
    C.hidden = false;
    C.innerHTML =
      `<div class="fl-title">${esc(H.title)}<i>AUTOPILOT</i></div>` +
      `<div class="fl-hub-phase">${esc(H.phase)}</div>` +
      (H.bar !== null ? `<div class="fl-hub-bar"><b style="width:${Math.round(H.bar * 100)}%"></b></div>` : "") +
      (H.rows.length ? `<div class="fl-stgrid">${H.rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join("")}</div>` : "") +
      (H.next ? `<div class="fl-hub-next">${esc(H.next)}</div>` : "");
  }

  private drawStrip(i: Info) {
    const E = this.stripEls;
    const st = i.status;
    const km = (x: number) =>
      !Number.isFinite(x)
        ? "∞"
        : Math.abs(x) >= 1e7
          ? `${(x / 1.495978707e8).toFixed(2)} AU`
          : Math.abs(x) >= 1e4
            ? `${Math.round(x).toLocaleString("en")} km`
            : `${x.toFixed(1)} km`;
    const ms = (v: number) => (!Number.isFinite(v) ? "—" : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(2)} km/s` : `${v.toFixed(1)} m/s`);
    const set = (k: string, t: string) => E[k] && E[k]!.textContent !== t && (E[k]!.textContent = t);
    set("state", st ? `${st.label} · ${st.soiName}` : "—");
    set("alt", st ? (st.kerr ? `r ${st.kerr.r.toFixed(2)} M` : km(st.altKm)) : "—");
    set("spd", st ? ms(st.speed) : "—");
    const ko = st?.kerr ? this.kerrApsides?.() : null;
    const r = (x: number) => (Number.isFinite(x) ? `${x.toFixed(2)} M` : "∞");
    set("pe", ko ? (ko.fate === "horizon" ? "horizon" : r(ko.rp)) : st?.orbit ? km(st.orbit.peKm) : "—");
    set("ap", ko ? (ko.fate === "bound" ? r(ko.ra) : "escape") : st?.orbit ? km(st.orbit.apKm) : "—");
    for (const [a, b] of this.stripBtns) {
      b.classList.toggle("on", i.auto === a || i.hub?.mode === a);
      const why = this.buttons.get(a)?.dataset.why;
      b.classList.toggle("off", !!why);
      if (why) b.dataset.why = why;
      else delete b.dataset.why;
    }
  }

  /** The panels over the full-screen map's edges [CSS px], measured a few times a second. */
  private insetAt = -1e9;
  private insetVal = { l: 0, r: 0, t: 0, b: 0 };
  private mapInsets() {
    const now = performance.now();
    if (now - this.insetAt < 250) return this.insetVal;
    this.insetAt = now;
    const stage = this.right.getBoundingClientRect();
    const vis = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" ? r : null;
    };
    const ops = vis(this.root.querySelector(".fc-ops:not([hidden])"));
    const info = vis(this.root.querySelector(".fc-info:not([hidden])"));
    const strip = vis(this.strip);
    const time = this.mapTab === "orbit" ? vis(this.right.querySelector(".m3-time")) : null;
    const tops = [this.right.querySelector(".fl-mapbar"), this.right.querySelector(".fl-maptabs"), this.right.querySelector(".m3-crumbs")]
      .map(vis)
      .filter((r): r is DOMRect => !!r);
    const pad = 12;
    this.insetVal = {
      l: ops ? Math.max(ops.right - stage.left + pad, 0) : pad,
      r: info ? Math.max(stage.right - info.left + pad, 0) : pad,
      t: tops.length ? Math.max(...tops.map((r) => r.bottom - stage.top)) + pad : pad,
      b: Math.max(...[strip, time].filter((r): r is DOMRect => !!r).map((r) => stage.bottom - r.top), 0) + pad,
    };
    return this.insetVal;
  }
  /** The map's tab: the 3D system, or the ground track (a globe, a planisphere). */
  setMapTab(t: "orbit" | "globe" | "map") {
    this.mapTab = t;
    if (t !== "orbit") this.ground.mode = t;
    store.set("kerr.map-tab", t);
    this.syncMapTab();
    this.drawnAt.map = -1e9;
  }
  /** What the map shows: the ground track needs a world under the ship — else the 3D map, the tab kept. */
  private syncMapTab() {
    const i = this.lastInfo;
    const world = i ? this.ground.worldOf(i) : null;
    const ground = this.mapTab !== "orbit" && !!world;
    this.mapBody?.classList.toggle("ground", ground);
    for (const [id, b] of Object.entries(this.tabBtns)) {
      b.classList.toggle("on", id === (ground ? this.mapTab : "orbit"));
      const off = id !== "orbit" && !world;
      b.classList.toggle("off", off);
      b.dataset.why = off ? "Near a planet or a moon: in its sphere of influence" : "";
    }
    return ground;
  }
  /** 0 full · 1 minimal · 2 clean */
  density = 0;
  visible = false;
  /** the planner open */
  planning = false;

  constructor(
    private s: Settings,
    private act: FlightHudActions,
  ) {
    this.hud = h("canvas", "fl-hud");
    // (a phone: the minimal HUD — the full one's panels cover the small screen and the touch controls —
    // until the pilot picks another)
    const small =
      typeof matchMedia !== "undefined" &&
      matchMedia("(pointer: coarse) and (max-height: 560px), (pointer: coarse) and (max-width: 560px)").matches;
    this.density = small ? 1 : 0;
    const saved = store.get("kerr.hud-density");
    if (saved !== null) this.density = Math.min(2, Math.max(0, Number(saved) || 0));

    // ---- mission bar
    // (the modes' lights: a click turns off what is engaged — SAS toggles)
    const chip = (key: string, label: string, tip: string, click: () => void) => {
      const c = h("button", "fl-chip") as HTMLButtonElement;
      c.append(h("i"), h("span", "", label));
      c.dataset.label = label;
      c.dataset.tip = tip;
      c.onclick = click;
      this.missionEls[key] = c;
      return c;
    };
    const clock = (key: string, label: string, title: string) => {
      const c = h("div", "fl-clock");
      c.title = title;
      const v = h("b");
      c.append(h("span", "", label), v);
      this.missionEls[key] = v;
      return c;
    };
    // (the time: the app's transport bar — run / pause, warp, real time, takes — mounted here while flying)
    const warpBox = this.transportSlot;
    const iconBtn = (name: string, title: string, fn: () => void, cls = "") => {
      const b = h("button", `fl-tools ${cls}`) as HTMLButtonElement;
      b.append(icon(name));
      b.title = title;
      b.onclick = fn;
      return b;
    };
    const tools = iconBtn("more", "The app's toolbar", () => document.body.classList.toggle("show-tools"));
    const planBtn = h("button", "fl-tools fl-planbtn") as HTMLButtonElement;
    planBtn.append(icon("plan"), h("span", "", "Plan"));
    planBtn.title = "Flight planner: transfers, rendezvous, manoeuvre nodes";
    planBtn.onclick = () => this.onPlanner?.();
    this.missionEls.planBtn = planBtn;
    const pathBtn = iconBtn("path", "Future path in the view (the cyan tube)", () => act.pathInView(), "fl-pathbtn");
    this.missionEls.pathBtn = pathBtn;
    const soundBtn = iconBtn("sound", "Sound on / off (Settings › Game › Sound: the mix)", () => act.sound(), "fl-soundbtn");
    this.missionEls.soundBtn = soundBtn;
    const toolsBtn = iconBtn("tools", "Game tools: status, place, target, time, saves, audit, journal", () => act.tools());
    const dens = iconBtn("density", "HUD density: full · minimal · clean", () => this.cycleDensity());
    // the camera's view on the Ranger: a menu (its attach points, outside: around it, free)
    const viewBox = h("div", "fl-viewbox");
    const viewBtn = h("button", "fl-tools fl-viewbtn") as HTMLButtonElement;
    const viewName = h("span", "fl-viewname", "");
    viewBtn.append(icon("camera"), viewName, icon("chevron", "fl-ic fl-caret"));
    viewBtn.title = "The camera's view";
    this.missionEls.viewName = viewName;
    const viewMenu = h("div", "fl-menu");
    viewMenu.hidden = true;
    const groups: [string, Mount[]][] = [
      ["On the ship", MOUNT_KEYS.filter((m) => !(MOUNTS[m] as { outside?: string }).outside)],
      ["Outside", MOUNT_KEYS.filter((m) => !!(MOUNTS[m] as { outside?: string }).outside)],
    ];
    for (const [g, list] of groups) {
      viewMenu.append(h("div", "fl-menu-h", g));
      for (const m of list) {
        const b = h("button", "fl-menu-i") as HTMLButtonElement;
        b.append(h("b", "", MOUNTS[m].short), h("span", "", MOUNTS[m].label));
        b.onclick = () => {
          act.mount(m);
          viewMenu.hidden = true;
        };
        this.buttons.set(`mount:${m}`, b);
        viewMenu.append(b);
      }
    }
    const ahead = h("button", "fl-menu-i fl-ahead") as HTMLButtonElement;
    ahead.append(h("b", "", "↺"), h("span", "", "Reset the camera — on the hull, looking ahead (⇧R)"));
    ahead.onclick = () => {
      act.lookAhead();
      viewMenu.hidden = true;
    };
    this.buttons.set("ahead", ahead);
    viewMenu.append(ahead);
    // (the menu lives in the HUD's root: the mission bar's cut-away ends would clip it)
    viewBtn.onclick = () => {
      if (act.camera) return act.camera();
      viewMenu.hidden = !viewMenu.hidden;
      if (viewMenu.hidden) return;
      const r = viewBtn.getBoundingClientRect();
      viewMenu.style.top = `${r.bottom + 8}px`;
      viewMenu.style.left = `${Math.max(8, Math.min(innerWidth - 268, r.left))}px`;
    };
    addEventListener("pointerdown", (e) => {
      if (!viewMenu.hidden && !viewBox.contains(e.target as Node) && !viewMenu.contains(e.target as Node)) viewMenu.hidden = true;
    });
    viewBox.append(viewBtn);
    this.viewMenu = viewMenu;
    // the craft flown: a menu of the fleet — each craft, what it is doing (flown, docked, how far), [ ]
    const craftBox = h("div", "fl-viewbox");
    const craftBtn = h("button", "fl-tools fl-viewbtn fl-craftbtn") as HTMLButtonElement;
    const craftName = h("span", "fl-viewname", "");
    craftBtn.append(icon("ship"), craftName, icon("chevron", "fl-ic fl-caret"));
    craftBtn.title = "The craft flown ([ ]): the Ranger, the Lander, the Endurance";
    this.missionEls.craftName = craftName;
    const craftMenu = h("div", "fl-menu fl-craftmenu");
    craftMenu.hidden = true;
    const fillCraft = () => {
      craftMenu.replaceChildren(h("div", "fl-menu-h", "Fly · [ ] in turn"));
      const t = this.lastTime;
      const me = fleet.activePose?.();
      for (const id of VESSEL_IDS) {
        const V = VESSELS[id];
        const b = h("button", "fl-menu-i") as HTMLButtonElement;
        // (what it does now: flown, docked to the flown one, docked elsewhere, coasting — how far)
        const mine = fleet.flownAssembly();
        const p = Number.isFinite(t) ? fleet.pose(id, t) : null;
        const far = p && me ? Math.hypot(p.X[0] - me.X[0], p.X[1] - me.X[1], p.X[2] - me.X[2]) * M_METRES : NaN;
        const dist = !Number.isFinite(far)
          ? ""
          : far < 1000
            ? `${far.toFixed(0)} m`
            : `${(far / 1000).toLocaleString("en-US", { maximumFractionDigits: far < 1e5 ? 1 : 0 })} km`;
        const docked = fleet.links
          .filter((l) => l.a === id || l.b === id)
          .map((l) => (l.a === id ? l.b : l.a))
          .map((o) => (o === "iss" ? "ISS" : VESSELS[o as VesselId].name));
        const state =
          id === fleet.active
            ? "flown"
            : mine.includes(id)
              ? "docked to it"
              : docked.length
                ? `docked to the ${docked.join(", ")}${dist ? ` · ${dist}` : ""}`
                : `coasting${dist ? ` · ${dist}` : ""}`;
        b.append(h("b", "", V.name), h("span", "", `${Math.round(V.mass / 1e3)} t · ${state}`));
        b.classList.toggle("on", id === fleet.active);
        b.onclick = () => {
          act.vessel(id);
          craftMenu.hidden = true;
        };
        craftMenu.append(b);
      }
    };
    craftBtn.onclick = () => {
      craftMenu.hidden = !craftMenu.hidden;
      if (craftMenu.hidden) return;
      fillCraft();
      const r = craftBtn.getBoundingClientRect();
      craftMenu.style.top = `${r.bottom + 8}px`;
      craftMenu.style.left = `${Math.max(8, Math.min(innerWidth - 268, r.left))}px`;
    };
    addEventListener("pointerdown", (e) => {
      if (!craftMenu.hidden && !craftBox.contains(e.target as Node) && !craftMenu.contains(e.target as Node)) craftMenu.hidden = true;
    });
    craftBox.append(craftBtn);
    this.craftMenu = craftMenu;
    const group = (cls: string, ...els: HTMLElement[]) => {
      const g = h("div", `fl-mgroup ${cls}`);
      g.append(...els);
      return g;
    };
    this.mission.append(
      group(
        "fl-mg-modes",
        chip("sas", "Stability assist", "Holds the attitude, damps any rotation — click to toggle", () => act.sas()),
        chip("hold", "Attitude hold", "The direction the nose is held along — click to release it", () => {
          const hd = this.lastInfo?.hold;
          if (hd && hd !== "none") act.hold(hd);
        }),
        chip("auto", "Autopilot", "What the autopilot flies — click to hand the controls back", () => {
          const a = this.lastInfo?.auto;
          if (a && a !== "none") act.auto(a);
        }),
      ),
      group("fl-mg-warp", warpBox),
      group(
        "fl-mg-clocks",
        clock("tau", "Ship τ", "Proper time on the ship since you took the controls"),
        clock("t", "Far t", "Coordinate time: the clocks of distant observers"),
        clock("ratio", "τ / t", "Time dilation: how fast the ship's clock runs"),
        clock(
          "lost",
          "Earth +",
          "Time gained by the far-away clocks — the Earth's, through the wormhole — over the ship's since you took the controls: t − τ (the two mouths assumed in step)",
        ),
      ),
      group("fl-mg-acts", craftBox, planBtn, viewBox, pathBtn, soundBtn, toolsBtn, dens, tools),
    );

    // ---- target: its name (the ball's target mark) and range; the rest as tiles
    this.target.append(panelHead(this.target, "target", "Target").head);
    const tile = (box: HTMLElement, els: Record<string, HTMLElement>, k: string, label: string, wide = false) => {
      const t = h("div", `fl-tile${wide ? " wide" : ""}`);
      t.append(h("span", "", label));
      const v = h("b");
      t.append(v);
      if (ROW_TIPS[k]) (t.dataset.tip = ROW_TIPS[k]), (t.dataset.label = label);
      els[k] = v;
      box.append(t);
    };
    {
      const nameRow = h("div", "fl-tname");
      const mark = glyphSvg("target", COL.target!);
      const nm = h("b");
      const range = h("em", "fl-trange");
      range.dataset.tip = ROW_TIPS.dist!;
      range.dataset.label = "Range";
      nameRow.append(mark, nm, range);
      this.targetEls.name = nm;
      this.targetEls.dist = range;
      this.target.append(nameRow);
      const tiles = h("div", "fl-tiles");
      tile(tiles, this.targetEls, "rate", "Range rate");
      tile(tiles, this.targetEls, "ca", "Closest");
      tile(tiles, this.targetEls, "alt", "Radar alt.", true);
      tile(tiles, this.targetEls, "vv", "Vertical");
      tile(tiles, this.targetEls, "vh", "Ground");
      tile(tiles, this.targetEls, "twr", "Thrust / weight", true);
      tile(tiles, this.targetEls, "light", "Light received", true);
      this.target.append(tiles, this.tgtCanvas);
      nameRow.classList.add("fl-legacy");
      tiles.classList.add("fl-legacy");
    }

    // ---- the Ranger: its status and sphere, its orbit as tiles
    {
      const stHead = h("div", "fl-sthead");
      const soi = h("span", "fl-stsoi");
      soi.dataset.tip = ROW_TIPS.soi!;
      soi.dataset.label = "Sphere of influence";
      stHead.append(this.stBadge, soi);
      this.stEls.soi = soi;
      const tiles = h("div", "fl-tiles");
      tile(tiles, this.stEls, "palt", "Altitude");
      tile(tiles, this.stEls, "spd", "Speed");
      tile(tiles, this.stEls, "pe", "Periapsis");
      tile(tiles, this.stEls, "ap", "Apoapsis");
      tile(tiles, this.stEls, "inc", "Inclination");
      tile(tiles, this.stEls, "ecc", "Eccentricity");
      tile(tiles, this.stEls, "per", "Period");
      tile(tiles, this.stEls, "tpe", "To periapsis");
      tile(tiles, this.stEls, "next", "Next", true);
      this.stBox.append(stHead, tiles, this.stCanvas);
      tiles.classList.add("fl-legacy");
    }
    const telBody = h("div", "fl-body");
    telBody.append(this.stBox, h("div", "fl-sub", "Telemetry · the last minute"), this.telCanvas);
    const telHead = panelHead(this.tel, "tel", "Ranger").head;
    this.telTitle = telHead.querySelector(".fl-htext");
    this.tel.append(telHead, telBody);

    // ---- orbit: effective potential + figures
    const oh = panelHead(this.orbit, "orbit", "Orbit · effective potential");
    const orbitHead = oh.head;
    this.orbitHead = oh.text;
    const grid = h("div", "fl-grid");
    for (const [k, label] of [
      ["course", "Course"],
      ["pe", "Periapsis"],
      ["ap", "Apoapsis"],
      ["el", "E · L"],
    ] as const) {
      const c = h("div", "fl-cell");
      const v = h("b");
      c.append(h("span", "", label), v);
      this.orbitEls[k] = v;
      grid.append(c);
    }
    // (the figures are drawn in the canvas: its corners — the panel is the plot alone)
    void orbitHead;
    void grid;
    this.orbit.append(this.veff);

    // ---- cockpit: the attitude ball, its controls on a ring around it — the attitude holds on the left
    // arc, the stability assist, the autopilots and the speed mode on the right (names on hover)
    const RING = 118,
      BALL = 88; // (the ring's radius, the ball's, CSS px)
    // (under the ball: its readout — throttle, g-load, the engine)
    const CW = 2 * RING + 44,
      CH = BALL + RING + 70,
      CX = CW / 2,
      CY = CH - BALL - 40;
    this.cockpit.style.width = `${CW}px`;
    this.cockpit.style.height = `${CH}px`;
    this.hubCard.hidden = true;
    this.cockpit.append(this.hubCard);
    const ringBtn = (id: string, label: string, title: string, fn: () => void, deg: number, svgBody: string, col?: string) => {
      const b = h("button", "fl-rb") as HTMLButtonElement;
      const a = (deg * Math.PI) / 180;
      b.style.left = `${CX + RING * Math.cos(a)}px`;
      b.style.top = `${CY - RING * Math.sin(a)}px`;
      b.dataset.label = label;
      b.dataset.tip = title;
      b.setAttribute("aria-label", label);
      b.dataset.side = Math.cos(a) < 0 ? "l" : "r";
      b.innerHTML = `<svg viewBox="-12 -12 24 24" style="${col ? `--c:${col}` : ""}">${svgBody}</svg>`;
      b.onclick = fn;
      this.buttons.set(id, b);
      this.cockpit.append(b);
      return b;
    };
    const HOLD_SVG: Record<string, string> = {
      prograde: '<circle r="5"/><path d="M0-5V-10M-5 0H-10M5 0H10"/>',
      retrograde: '<circle r="5"/><path d="M-3.5-3.5L3.5 3.5M3.5-3.5L-3.5 3.5M0 5V10"/>',
      radialOut: '<circle r="4.5"/><path d="M3.3-3.3L7-7M-3.3-3.3L-7-7M3.3 3.3L7 7M-3.3 3.3L-7 7"/>',
      radialIn: '<circle r="7.5"/><path d="M-5.3-5.3L-2-2M5.3-5.3L2-2M-5.3 5.3L-2 2M5.3 5.3L2 2"/>',
      normal: '<path d="M0-7L6.5 5H-6.5Z"/><circle r="1" class="f"/>',
      antinormal: '<path d="M0 7L6.5-5H-6.5Z"/><path d="M0-5V-9M-6.5-5L-9-8M6.5-5L9-8"/>',
      target: '<circle r="5"/><path d="M0-5V-9M0 5V9M-5 0H-9M5 0H9"/>',
      antiTarget: '<circle r="5"/><path d="M-3.5-3.5L3.5 3.5M3.5-3.5L-3.5 3.5M0-5V-9M0 5V9M-5 0H-9M5 0H9"/>',
      maneuver: '<path d="M0-7L7 0L0 7L-7 0Z"/><circle r="1.6" class="f"/>',
    };
    const HOLD_TIPS: Record<string, string> = {
      prograde: "Nose along the motion — burn to speed up, raise the far side of the orbit",
      retrograde: "Nose against the motion — burn to slow down, lower the far side",
      radialOut: "Nose away from the body, across the motion — turns the orbit about the ship",
      radialIn: "Nose towards the body, across the motion",
      normal: "Nose along the orbit's normal — burn to tilt the orbit",
      antinormal: "Nose against the orbit's normal — tilts it the other way",
      target: "Nose at the target",
      antiTarget: "Nose away from the target",
      maneuver: "Nose along the next planned burn",
    };
    HOLD_KEYS.forEach(([hold], j) => {
      ringBtn(
        hold,
        HOLD_NAMES[hold],
        HOLD_TIPS[hold] ?? `Points the nose ${HOLD_NAMES[hold]} and holds it there`,
        () => act.hold(hold),
        108 + j * 14.5,
        HOLD_SVG[hold] ?? "",
        COL[hold],
      );
    });
    const AUTO_SVG: Record<string, string> = {
      sas: '<circle r="6.5"/><path d="M-10 0H10M0-3V3"/>',
      roll: '<path d="M-6.5 3A7 7 0 1 1 6.5 3"/><path d="M6.5 3L8.8-.5M6.5 3L2.8 1.8"/>',
      hover: '<path d="M0-9V-3.5M0 3.5V9M-9 0H-3.5M3.5 0H9"/><circle r="1.7" class="f"/>',
      circularize: '<circle r="7"/><circle cx="7" r="1.8" class="f"/>',
      approach: '<path d="M-9 0H2.5M-.5-3.5L3 0L-.5 3.5"/><circle cx="7.5" r="2" class="f"/>',
      land: '<path d="M0-8V3M-3.5-.5L0 3L3.5-.5M-8 7.5H8"/>',
      takeoff: '<path d="M0 5V-7M-3.5-3.5L0-7L3.5-3.5M-8 8H8"/>',
      entry: '<path d="M-8-7Q-2-6 1 0T4 8M-8 8H8"/><circle cx="1" cy="0" r="2.2" class="f"/>',
      speedMode: '<path d="M-8 4A8 8 0 0 1 8 4"/><path d="M0 4L4.5-2.5"/><circle cy="4" r="1.4" class="f"/>',
    };
    const AUTO_TIPS: Record<string, string> = {
      hover: "Kills the speed relative to the body and holds the place — the flight computer's Hold position",
      circularize:
        "Makes the orbit circular — the cheapest way: a burn at the next apsis above the air (planned, the time sped up to it), then trimmed; after a capture, where the ship is",
      approach: "Flies to the target and stops beside it — the flight computer's Approach the target",
      land: "Descends, kills the horizontal speed, touches down — the flight computer's Land here",
      takeoff: "Lifts off and climbs to orbit — the height and inclination the flight computer's LAUNCH sets (its ORBIT tab)",
      entry:
        "From orbit: the deorbit burn, the guided entry (the angle of attack held, the bank flown to the site), the glide and the landing — at the chosen site, or the nearest",
    };
    this.buildStrip(AUTO_SVG, AUTO_TIPS);
    const rightIds: [string, string, string, () => void][] = [
      ["sas", "Stability assist", "Holds the attitude, damps any rotation", () => act.sas()],
      ["roll", "Roll alignment", "While the nose is held, the wings stay in the orbital plane", () => act.roll()],
      ...AUTO_KEYS.map(
        ([a2]) =>
          [a2, AUTO_NAMES[a2], AUTO_TIPS[a2] ?? `Autopilot: ${AUTO_NAMES[a2]}`, () => act.auto(a2)] as [string, string, string, () => void],
      ),
      [
        "speedMode",
        "Speed: orbit",
        "The ball's speed and prograde — in orbit, or relative to the target (docking, rendezvous)",
        () => act.speedMode(),
      ],
    ];
    rightIds.forEach(([id, label, title, fn], j) => ringBtn(id, label, title, fn, 72 - j * 15, AUTO_SVG[id] ?? ""));
    {
      const NS = "http://www.w3.org/2000/svg";
      const bez = document.createElementNS(NS, "svg");
      bez.setAttribute("class", "fl-bezel");
      bez.setAttribute("width", String(CW));
      bez.setAttribute("height", String(CH));
      const pt = (deg: number, r: number) => [CX + r * Math.cos((deg * Math.PI) / 180), CY - r * Math.sin((deg * Math.PI) / 180)];
      const arc = (d0: number, d1: number, r: number) => {
        const [x0, y0] = pt(d0, r),
          [x1, y1] = pt(d1, r);
        const sweep = d1 < d0 ? 1 : 0;
        return `M${x0} ${y0}A${r} ${r} 0 0 ${sweep} ${x1} ${y1}`;
      };
      // the two sections' bands, then their names: each path runs clockwise (up the left side, down the
      // right one), so the letters stand on the ring, their tops outwards
      bez.innerHTML = `
        <defs>
          <path id="fl-bz-l" d="${arc(222, 112, RING + 23)}"/>
          <path id="fl-bz-r" d="${arc(68, -30, RING + 23)}"/>
        </defs>
        <path class="band" d="${arc(232, 100, RING)}"/>
        <path class="band" d="${arc(80, -44, RING)}"/>
        <path class="edge" d="${arc(232, 100, RING + 17)}"/>
        <path class="edge" d="${arc(80, -44, RING + 17)}"/>
        <path class="edge" d="${arc(232, 100, RING - 17)}"/>
        <path class="edge" d="${arc(80, -44, RING - 17)}"/>
        <text><textPath href="#fl-bz-l" startOffset="50%" text-anchor="middle">ATTITUDE</textPath></text>
        <text><textPath href="#fl-bz-r" startOffset="50%" text-anchor="middle">AUTOPILOT</textPath></text>`;
      this.cockpit.append(bez);
    }
    const ballBox = h("div", "fl-ballbox");
    ballBox.style.left = `${CX - BALL}px`;
    ballBox.style.top = `${CY - BALL}px`;
    ballBox.append(this.ball);
    this.cockpit.prepend(ballBox);
    const read = h("div", "fl-bread");
    read.style.left = `${CX}px`;
    read.style.top = `${CY + BALL + 4}px`;
    const thr = h("b", "fl-thr"),
      g = h("b", "fl-g"),
      eng = h("span", "fl-eng");
    const row = h("div");
    row.append(h("i", "", "THR"), thr, g);
    read.append(row, eng);
    this.ballRead = { thr, g, eng };
    this.cockpit.append(read);
    this.ball.title =
      "Attitude: sky (away from the hole) and ground, markers around the nose. Left arc: throttle (drag it) · right arc: g-load";
    this.ball.addEventListener("pointerdown", (e) => this.onBall(e, true));
    this.ball.addEventListener("pointermove", (e) => this.onBall(e, false));
    this.ball.addEventListener("pointerup", () => (this.throttleDrag = false));

    // ---- the map (the camera's view: the mission bar's menu)
    const hud = this;
    this.map3d = new Map3D({
      s: this.s,
      act: this.act,
      get sel() {
        return hud.sel;
      },
      set sel(v: number) {
        hud.sel = v;
      },
      trail: () => this.trail,
      closestApproach: (i, t) => this.closestApproach(i, t),
      mapView: () => this.mapView,
      toggleMapView: () => this.toggleMapView(),
      insets: () => this.mapInsets(),
      gpu: () => this.mapGpu,
    });
    addEventListener("keydown", (e: KeyboardEvent) => {
      // Delete / Backspace: the selected node (map view or planner open)
      if ((e.key === "Delete" || e.key === "Backspace") && this.mapView && this.lastInfo?.plan?.nodes.length) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        this.act.deleteNode(Math.min(this.sel, this.lastInfo.plan.nodes.length - 1));
      }
    });
    const mapHead = panelHead(this.right, "map", "Map");
    const mapBody = h("div", "fl-body fl-mapbody");
    // (the map's tabs: the system in 3D, the globe and the planisphere of the world the ship orbits)
    const t = store.get("kerr.map-tab");
    if (t === "globe" || t === "map") this.mapTab = t;
    this.ground = new GroundTrack(this.s);
    const tabs = h("div", "fl-maptabs");
    for (const [id, label, tip] of [
      ["orbit", "3D", "The system in 3D: the orbits, the paths, the nodes"],
      [
        "globe",
        "Globe",
        "The world the ship orbits, as a globe: where it is over the ground, the track left and ahead (drag: turn it, double click: follow the ship)",
      ],
      ["map", "Planisphere", "The world the ship orbits, flat: the ground track, the day and the night"],
    ] as const) {
      const b = h("button", "", label) as HTMLButtonElement;
      b.dataset.tip = tip;
      b.onclick = () => this.setMapTab(id);
      this.tabBtns[id] = b;
      tabs.append(b);
    }
    mapBody.append(tabs, this.map3d.bar, this.map3d.stage, this.ground.stage);
    this.mapBody = mapBody;
    this.right.append(mapHead.head, mapBody);
    this.setMapTab(this.mapTab);

    this.root.append(
      this.warn,
      this.airData,
      this.mission,
      this.dock,
      this.target,
      this.tel,
      this.orbit,
      this.cockpit,
      this.right,
      this.strip,
      this.viewMenu!,
      this.craftMenu!,
    );
    this.ground.insets = () => this.mapInsets();
    this.ground.gpuSource = () => this.mapGpu;
    this.dock.hidden = true;
    document.body.append(this.hud, this.root);
    this.initTips();
    this.show(false);
  }

  /**
   * The HUD's tooltips: a name and what it does, shown by whatever the pointer rests on (data-tip, or a
   * title — taken over, so the browser's own does not show too). No keys: the help lists them.
   */
  private initTips() {
    const tip = h("div", "fl-tip");
    tip.hidden = true;
    document.body.append(tip);
    let at: HTMLElement | null = null;
    let timer = 0;
    const show = (el: HTMLElement, rect?: DOMRect) => {
      if (el.title) {
        const t = el.title;
        el.removeAttribute("title");
        const k = t.indexOf(": ");
        if (!el.dataset.label && k > 0 && k < 32) (el.dataset.label = t.slice(0, k)), (el.dataset.tip = t.slice(k + 2));
        else el.dataset.tip = t;
      }
      const label = el.dataset.label ?? "";
      const text = el.dataset.tip ?? "";
      tip.replaceChildren();
      if (label) tip.append(h("b", "", label));
      if (text) tip.append(h("span", "", text));
      if (el.dataset.why) tip.append(h("em", "", el.dataset.why));
      tip.hidden = false;
      const r = rect ?? el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const below = r.top < 140;
      tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
      tip.style.top = `${below ? r.bottom + 10 : r.top - t.height - 10}px`;
      tip.classList.add("show");
    };
    const hide = () => {
      clearTimeout(timer);
      at = null;
      tip.classList.remove("show");
      tip.hidden = true;
    };
    const within = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip],[title]") as HTMLElement | null;
      if (el?.classList.contains("fl-instr")) return null; // (its regions: below)
      return el && (this.root.contains(el) || this.viewMenu?.contains(el) || this.craftMenu?.contains(el)) ? el : null;
    };
    // the instruments (canvases): a tooltip per region under the pointer
    for (const c of [this.tgtCanvas, this.stCanvas]) {
      let cur = "";
      c.addEventListener("pointermove", (e) => {
        const r = c.getBoundingClientRect();
        const x = e.clientX - r.left,
          y = e.clientY - r.top;
        const reg = (this.regions.get(c) ?? []).find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
        const key = reg ? reg.label : "";
        if (key === cur) return;
        cur = key;
        hide();
        if (!reg) return;
        c.dataset.label = reg.label;
        c.dataset.tip = reg.tip;
        timer = window.setTimeout(() => cur === key && show(c, new DOMRect(r.left + reg.x, r.top + reg.y, reg.w, reg.h)), 250);
      });
      c.addEventListener("pointerleave", () => ((cur = ""), hide()));
    }
    addEventListener("pointerover", (e) => {
      const el = within(e);
      if (el === at) return;
      hide();
      if (!el) return;
      at = el;
      timer = window.setTimeout(() => at === el && show(el), 280);
    });
    addEventListener("pointerdown", hide);
    addEventListener("scroll", hide, true);
  }

  show(on: boolean) {
    this.visible = on;
    if (on) this.drawn = false;
    this.root.hidden = !on;
    this.hud.hidden = !on;
    document.body.classList.toggle("piloting", on);
    document.body.classList.remove("show-tools");
    this.applyDensity();
    if (!on) (this.trail = []), (this.samples = []), (this.start = null);
  }

  /**
   * The orbit around the body of the sphere of influence, to scale: scale rings, the orbit glowing —
   * bright ahead of the ship, fading behind —, a direction arrow and a tick every twelfth of the period,
   * the body a shaded sphere in its colour, the apsides flagged with their heights, the ship a gold
   * chevron along its motion; a suborbital path: the impact marked where it meets the ground.
   */
  private drawKepler(ctx: CanvasRenderingContext2D, cw: number, ch: number, st: RangerStatus) {
    const o = st.orbit!;
    const dpr = devicePixelRatio;
    const S = (v: number) => v * dpr;
    const R = o.aKm * (1 - o.ecc) - o.peKm; // the body's radius [km]
    const e = o.ecc;
    const bound = e < 1 && Number.isFinite(o.apKm);
    const a = Math.abs(o.aKm);
    const rp = a * Math.abs(1 - e);
    const reach = bound ? a * (1 + e) : Math.max(4 * rp, 3 * R);
    const width = bound ? 2 * a : reach + rp;
    const k = Math.min((cw - S(36)) / width, (ch - S(20)) / (2 * (bound ? a * Math.sqrt(1 - e * e) : reach)), (ch / 2 - S(10)) / R);
    const cx = bound ? cw / 2 + a * e * k : cw / 2 + ((reach - rp) / 2) * k,
      cy = ch / 2;
    // (degenerate elements — resting on the ground, a radial fall —: nothing to draw)
    if (!(Number.isFinite(k) && k > 0 && Number.isFinite(cx) && R > 0)) return;
    const col = OUR_COLOURS[st.soi] ?? "124, 214, 255";
    const p = a * Math.abs(1 - e * e);
    const at = (nu: number) => {
      const r = p / (1 + e * Math.cos(nu));
      return [cx + r * Math.cos(nu) * k, cy - r * Math.sin(nu) * k, r] as const;
    };
    // scale rings round the body (its radius × 2, × 4 … while they fit)
    ctx.strokeStyle = "rgba(124, 214, 255, 0.07)";
    ctx.lineWidth = S(1);
    for (let m = 2; R * m * k < Math.max(cw, ch); m *= 2) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * m * k, 0, 2 * Math.PI);
      ctx.stroke();
    }
    // the ship's true anomaly (from the time to periapsis: the mean anomaly)
    const nuMax = bound ? Math.PI : Math.acos(Math.max(-1, Math.min(1, (p / reach - 1) / e)));
    let nuShip = NaN;
    if (bound && Number.isFinite(o.period)) {
      const M = 2 * Math.PI * (1 - o.tPe / o.period);
      let E = M;
      for (let j = 0; j < 12; j++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      nuShip = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    } else if (!bound && Number.isFinite(o.tPe)) nuShip = o.tPe > 0 ? -0.6 * nuMax : 0.6 * nuMax;
    const hot = st.status === "suborbital";
    const tone = st.status === "orbit" ? "111, 227, 161" : hot ? "255, 179, 92" : "124, 214, 255";
    // the orbit: segments whose brightness falls off behind the ship (ahead: bright)
    const N = 240;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // (its glow: the whole path once, wide and faint, under the segments)
    ctx.strokeStyle = `rgba(${tone}, 0.12)`;
    ctx.lineWidth = S(6);
    ctx.beginPath();
    let pen = false;
    for (let j = 0; j <= N; j++) {
      const [x, y, r] = at(-nuMax + (2 * nuMax * j) / N);
      if (!(r > 0) || r > 1.01 * reach) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y), (pen = true);
    }
    ctx.stroke();
    for (let j = 0; j < N; j++) {
      const n0 = -nuMax + (2 * nuMax * j) / N,
        n1 = -nuMax + (2 * nuMax * (j + 1)) / N;
      const [x0, y0, r0] = at(n0),
        [x1, y1] = at(n1);
      if (!(r0 > 0) || r0 > 1.01 * reach) continue;
      let ahead = 1;
      if (Number.isFinite(nuShip)) {
        const d = bound ? (((n0 - nuShip) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : n0 - nuShip;
        ahead = bound ? 1 - 0.75 * (d / (2 * Math.PI)) : d >= 0 ? 1 : 0.3;
      }
      ctx.strokeStyle = `rgba(${tone}, ${(0.25 + 0.75 * ahead).toFixed(3)})`;
      ctx.lineWidth = S(1 + 1.2 * ahead);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    // a tick every twelfth of the period (equal times, crowding at apoapsis)
    if (bound) {
      ctx.fillStyle = `rgba(${tone}, 0.8)`;
      for (let j = 0; j < 12; j++) {
        const M = (2 * Math.PI * j) / 12;
        let E = M;
        for (let q = 0; q < 10; q++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        const [x, y] = at(nu);
        ctx.beginPath();
        ctx.arc(x, y, S(1.3), 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    // the body: a shaded sphere in its colour, its glow
    const Rb = Math.max(R * k, S(3));
    const glow = ctx.createRadialGradient(cx, cy, Rb * 0.9, cx, cy, Rb * 1.5);
    glow.addColorStop(0, `rgba(${col}, 0.28)`);
    glow.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, Rb * 1.5, 0, 2 * Math.PI);
    ctx.fill();
    const shade = ctx.createRadialGradient(cx - Rb * 0.35, cy - Rb * 0.35, Rb * 0.1, cx, cy, Rb);
    shade.addColorStop(0, `rgba(${col}, 0.95)`);
    shade.addColorStop(0.7, `rgba(${col}, 0.45)`);
    shade.addColorStop(1, "rgba(10, 16, 28, 0.9)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, Rb, 0, 2 * Math.PI);
    ctx.fill();
    // the impact: where the path meets the ground (the ground holds |ν| < νᵢ round the periapsis: moving
    // on, the ship meets it at −νᵢ)
    if (o.peKm < 0 && e > 0) {
      const nuI = Math.acos(Math.max(-1, Math.min(1, (p / R - 1) / e)));
      const [x, y] = at(-nuI);
      ctx.strokeStyle = "#ff5a46";
      ctx.lineWidth = S(2);
      ctx.beginPath();
      ctx.moveTo(x - S(4), y - S(4));
      ctx.lineTo(x + S(4), y + S(4));
      ctx.moveTo(x + S(4), y - S(4));
      ctx.lineTo(x - S(4), y + S(4));
      ctx.stroke();
    }
    // the apsides: flags with their heights
    const km = (x: number) => (Math.abs(x) >= 1e5 ? `${Math.round(x / 1e3).toLocaleString("en")}k` : Math.round(x).toLocaleString("en"));
    const flag = (x: number, y: number, txt: string, left: boolean) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x, y - S(3));
      ctx.lineTo(x + S(3), y);
      ctx.lineTo(x, y + S(3));
      ctx.lineTo(x - S(3), y);
      ctx.fill();
      ctx.font = `700 ${S(10)}px ${FONT}`;
      ctx.textAlign = left ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(230, 238, 249, 0.85)";
      ctx.fillText(txt, x + (left ? -S(6) : S(6)), y - S(8));
      ctx.textBaseline = "alphabetic";
    };
    if (o.peKm >= 0) flag(...(at(0).slice(0, 2) as [number, number]), `Pe ${km(o.peKm)}`, false);
    if (bound) flag(...(at(Math.PI).slice(0, 2) as [number, number]), `Ap ${km(o.apKm)}`, true);
    // the ship: a gold chevron along its motion, a direction arrow a little ahead
    if (Number.isFinite(nuShip)) {
      const [x, y] = at(nuShip),
        [x2, y2] = at(nuShip + 0.02);
      const ang = Math.atan2(y2 - y, x2 - x);
      halo(ctx, x, y, S(11), "255, 200, 90", 0.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = "#ffc85a";
      ctx.beginPath();
      ctx.moveTo(S(6), 0);
      ctx.lineTo(S(-4), S(-4.5));
      ctx.lineTo(S(-1.5), 0);
      ctx.lineTo(S(-4), S(4.5));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const [xa, ya] = at(nuShip + (bound ? 0.9 : 0.25)),
        [xb, yb] = at(nuShip + (bound ? 0.92 : 0.26));
      const aa = Math.atan2(yb - ya, xb - xa);
      ctx.save();
      ctx.translate(xa, ya);
      ctx.rotate(aa);
      ctx.strokeStyle = `rgba(${tone}, 0.95)`;
      ctx.lineWidth = S(1.6);
      ctx.beginPath();
      ctx.moveTo(S(-3), S(-3.5));
      ctx.lineTo(S(2), 0);
      ctx.lineTo(S(-3), S(3.5));
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The Ranger's status block (telemetry panel). */
  private drawStatus(st: RangerStatus | null) {
    this.stBox.hidden = !st || !this.s.rangerStatus;
    if (!st || this.stBox.hidden) return;
    const km = (x: number) =>
      !Number.isFinite(x)
        ? "∞"
        : Math.abs(x) >= 1e7
          ? `${(x / 1.495978707e8).toFixed(3)} AU`
          : Math.abs(x) >= 1e4
            ? `${Math.round(x).toLocaleString("en")} km`
            : `${x.toFixed(1)} km`;
    const ms = (v: number) => (!Number.isFinite(v) ? "—" : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(2)} km/s` : `${v.toFixed(1)} m/s`);
    this.stBadge.textContent = st.label;
    this.stBadge.dataset.status = st.status;
    const E = this.stEls,
      o = st.orbit;
    E.soi!.textContent = `around ${st.soiName}`;
    E.palt!.textContent = st.kerr ? `r ${st.kerr.r.toFixed(3)} M` : km(st.altKm);
    E.spd!.textContent = ms(st.speed);
    E.spd!.parentElement!.dataset.sub = `${st.vVert >= 0 ? "▲" : "▼"} ${ms(Math.abs(st.vVert))}`;
    E.spd!.parentElement!.dataset.own = "1";
    E.pe!.textContent = o ? km(o.peKm) : st.kerr ? `E ${st.kerr.E.toFixed(4)}` : "—";
    E.ap!.textContent = o ? km(o.apKm) : "—";
    E.inc!.textContent = o ? `${o.incDeg.toFixed(1)}°` : "—";
    E.ecc!.textContent = o ? o.ecc.toFixed(3) : "—";
    E.per!.textContent = o && Number.isFinite(o.period) ? fmtS(o.period) : "—";
    E.tpe!.textContent = o && Number.isFinite(o.tPe) ? fmtS(o.tPe) : "—";
    const n = st.next;
    E.next!.textContent = n
      ? `${n.kind === "exit" ? `exits ${n.name}` : n.kind === "enter" ? `enters ${n.name}` : n.kind === "impact" ? `IMPACT ${n.name}` : "mouth"} · ${fmtS(n.inS)}`
      : "—";
    E.next!.className = n?.kind === "impact" ? "closing" : "";
  }

  /** 0 full · 1 minimal · 2 clean (not remembered: for an automation) */
  setDensity(d: number) {
    this.density = Math.min(2, Math.max(0, Math.round(d)));
    this.applyDensity();
  }

  cycleDensity() {
    this.density = (this.density + 1) % 3;
    store.set("kerr.hud-density", String(this.density));
    this.applyDensity();
    return ["Full HUD", "Minimal HUD", "Clean view"][this.density]!;
  }

  private applyDensity() {
    this.root.dataset.density = String(this.density);
  }

  /** Called every frame while piloting. */
  /** drawn at least once since shown */
  drawn = false;
  /** the scene time of the last update (the craft menu's distances) */
  private lastTime = NaN;
  update(info: Info, time: number) {
    this.drawn = true;
    this.lastTime = time;
    if (!this.start) this.start = { t: time, tau: info.properTime };
    this.record(info, time);
    this.ground.observe(info, time);
    this.lastInfo = info;
    const now = performance.now();
    // (the markers follow the view every frame; the instruments at their own pace — the map 20 times
    // a second, the ball 20, the plots 10: a full HUD redrawn 60 times a second cost ~6 ms a frame —,
    // one of them a frame, the most overdue: never all on the same frame, every 100 ms)
    // (full screen: the map, the strip under it — the instruments hidden, not drawn)
    const full = this.mapView;
    if (!full) cpuProf.time("HUD: markers & tapes", () => this.drawHud(info));
    this.drawAirData(info);
    this.drawDock(info);
    const tasks: [string, number, () => void][] = [];
    if (this.density < 2 && !full) tasks.push(["ball", 20, () => cpuProf.time("HUD: attitude ball", () => this.drawBall(info))]);
    if (full) tasks.push(["strip", 8, () => this.drawStrip(info)]);
    if (this.density === 0 || full) {
      if (!full) {
        tasks.push([
          "instr",
          15,
          () => cpuProf.time("HUD: target & Ranger", () => (this.drawTargetInstr(info), this.drawRangerInstr(info))),
        ]);
        tasks.push(["tel", 10, () => cpuProf.time("HUD: telemetry", () => this.drawTelemetry())]);
        tasks.push(["orbit", 10, () => cpuProf.time("HUD: orbit panel", () => this.drawPotential(info))]);
      }
      // (the full-screen map, or its animation, every frame; the ground track: the globe dragged)
      if (this.syncMapTab()) {
        if (this.ground.animating) cpuProf.time("HUD: ground track", () => this.ground.draw(info, time));
        else tasks.push(["map", this.mapView ? 30 : 15, () => cpuProf.time("HUD: ground track", () => this.ground.draw(info, time))]);
      } else if (this.mapView || this.map3d.animating) cpuProf.time("HUD: map", () => this.map3d.draw(info, time));
      else tasks.push(["map", 20, () => cpuProf.time("HUD: map", () => this.map3d.draw(info, time))]);
    }
    tasks.push(["text", 10, () => cpuProf.time("HUD: text panels", () => (this.drawText(info, time), this.tidyRows()))]);
    let pick: (typeof tasks)[number] | null = null,
      late = 1;
    for (const t of tasks) {
      const r = ((now - (this.drawnAt[t[0]] ?? -1e9)) * t[1]) / 1000; // (how many periods since it was drawn)
      if (r >= late) (late = r), (pick = t);
    }
    if (pick) {
      this.drawnAt[pick[0]] = now;
      pick[2]();
    }
  }

  private onBall(e: PointerEvent, down: boolean) {
    const r = this.ball.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width,
      y = (e.clientY - r.top) / r.height;
    if (down) {
      this.throttleDrag = x < 0.3;
      if (this.throttleDrag) this.ball.setPointerCapture(e.pointerId);
    }
    if (!this.throttleDrag) return;
    this.act.throttle(Math.min(1, Math.max(0, (0.93 - y) / 0.86)));
  }

  /** The ship's trail (black hole's frame, with times) and the telemetry (wall clock). */
  private record(i: Info, t: number) {
    const w = performance.now() / 1000;
    const lastS = this.samples[this.samples.length - 1];
    if (!lastS || w - lastS.w >= 0.1) {
      const gUnit = 2.99792458e8 ** 2 / (1476.625 * this.s.massSolar) / G0;
      const st = i.status;
      const si = !!st && Number.isFinite(st.altKm) && !st.kerr;
      if (this.samples.length && this.samples[this.samples.length - 1]!.si !== si) this.samples.length = 0; // (new units)
      this.samples.push({
        w,
        ts: t * M_SECONDS,
        v: i.speed,
        speed: si ? st!.speed : i.speed,
        r: si ? st!.altKm : i.region === "hole" ? i.r : NaN,
        dtau: i.dtau,
        g: i.accel * gUnit,
        si,
      });
      while (this.samples.length && w - this.samples[0]!.w > 60) this.samples.shift();
    }
    if (!i.X) return;
    const last = this.trail[this.trail.length - 1];
    if (last && (t < last.t || Math.hypot(i.X[0] - last.X[0], i.X[1] - last.X[1], i.X[2] - last.X[2]) > 30)) this.trail = [];
    const step = Math.max(0.2, (2 * Math.PI * i.r ** 1.5) / 400);
    const prev = this.trail[this.trail.length - 1];
    if (!prev || t - prev.t >= step) this.trail.push({ X: [...i.X] as V3, t });
    if (this.trail.length > 500) this.trail.shift();
  }

  // ------------------------------------------------------------------------------------ text panels
  /** The panels' rows with nothing to say, hidden (no "—" taking room). */
  private tidyRows() {
    const empty = (t: string | null) => !t || t === "—" || t === "–";
    for (const box of this.root.querySelectorAll<HTMLElement>(".fl-tiles")) {
      const tiles = [...box.querySelectorAll<HTMLElement>(".fl-tile")];
      for (const t of tiles) {
        const b = t.querySelector("b")!;
        t.hidden = empty(b.textContent);
        // (a figure with a second part — a time, a rate —: the second part under it, in small)
        const txt = b.textContent ?? "";
        const k = txt.indexOf(" · ");
        if (!t.classList.contains("wide") && k > 0 && t.dataset.split !== "no") {
          b.textContent = txt.slice(0, k);
          t.dataset.sub = txt.slice(k + 3);
        } else if (t.dataset.split !== "keep" && k < 0 && t.dataset.sub && !t.dataset.own) delete t.dataset.sub;
      }
      // (a tile left alone on its row spans it)
      const shown = tiles.filter((t) => !t.hidden);
      let col = 0;
      shown.forEach((t, j) => {
        t.classList.remove("solo");
        if (t.classList.contains("wide")) return void (col = 0);
        if (col === 0) {
          const next = shown[j + 1];
          if (!next || next.classList.contains("wide")) t.classList.add("solo");
          else col = 1;
        } else col = 0;
      });
    }
  }

  private drawText(i: Info, time: number) {
    const s = this.s;
    const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    // mission bar
    const M = this.missionEls;
    const setChip = (k: string, on: boolean, text: string) => {
      M[k]!.classList.toggle("on", on);
      (M[k]!.lastChild as HTMLElement).textContent = text;
    };
    setChip("sas", i.sas, "SAS");
    M.pathBtn!.classList.toggle("off", !s.pathInView);
    M.soundBtn!.classList.toggle("off", !s.sound);
    if (M.soundBtn!.dataset.on !== String(s.sound)) {
      M.soundBtn!.dataset.on = String(s.sound);
      M.soundBtn!.replaceChildren(icon(s.sound ? "sound" : "mute"));
    }
    M.viewName!.textContent = MOUNTS[s.shipMount as Mount]?.short ?? "";
    const cn = VESSELS[i.vessel].name;
    if (M.craftName!.textContent !== cn) M.craftName!.textContent = cn;
    this.drawStatus(i.status ?? null);
    setChip("hold", i.hold !== "none", i.hold === "none" ? "HOLD" : HOLD_NAMES[i.hold].toUpperCase());
    let auto = "AUTO";
    if (i.auto === "node" && i.plan?.nodes.length) {
      const n = i.plan.nodes[0]!;
      // (CIRC's own burn: named so)
      const nm = i.hub?.mode === "circularize" ? "CIRC" : "NODE 1";
      // (our side in seconds and m/s — the scene's M and c only near the hole)
      auto = i.plan.burning
        ? `${nm} · BURN Δv ${fmtDvC(Math.max(0, Math.hypot(...n.dv) - i.plan.done))}`
        : `${nm} · T−${i.ref ? fmtDur(Math.max(0, n.t - time), s) : fmtShort(Math.max(0, Math.round(n.t - time)))}`;
    } else if (i.auto !== "none") {
      const phase = i.auto === "dock" && i.dockPhase ? i.dockPhase : i.dirs.burn ? (i.throttle > 0.02 ? "BURN" : "ALIGN") : "RCS";
      auto = `${AUTO_NAMES[i.auto].toUpperCase()} · ${phase}${Number.isFinite(i.dv) ? ` Δv ${fmtDvC(i.dv)}` : ""}`;
    }
    setChip("auto", i.auto !== "none", auto);
    const st = this.start ?? { t: time, tau: i.properTime };
    const dt = time - st.t,
      dtau = i.properTime - st.tau;
    M.tau!.textContent = fmtClock(dtau, s);
    M.t!.textContent = fmtClock(dt, s);
    M.ratio!.textContent = f(i.dtau, 4);
    M.lost!.textContent = fmtClock(dt - dtau, s);
    // target
    const T = this.targetEls;
    const hasTarget = Number.isFinite(i.targetDist) && i.target !== "hole";
    this.target.classList.toggle("empty", !hasTarget);
    T.name!.textContent = `${BODY_NAMES[i.target]}`;
    // (our side in km and AU — M only near the hole)
    T.dist!.textContent = Number.isFinite(i.targetDist) ? fmtDist(i.targetDist, !!i.ref, this.s) : "—";
    // (our universe: solar-system speeds, in km/s)
    const kms = (v: number) =>
      Math.abs(v) * 299792.458 >= 100 ? (Math.abs(v) * 299792.458).toFixed(0) : (Math.abs(v) * 299792.458).toFixed(2);
    T.rate!.textContent = !Number.isFinite(i.targetRate)
      ? "—"
      : i.ref
        ? `${i.targetRate >= 0 ? "▲ +" : "▼ −"}${kms(i.targetRate)} km/s`
        : `${i.targetRate >= 0 ? "▲ +" : "▼ −"}${Math.abs(i.targetRate).toFixed(3)} c`;
    T.rate!.className = i.targetRate < 0 ? "closing" : "";
    const ca = i.ref ? i.ourCa : this.closestApproach(i, time);
    // (a closest approach below the surface: an impact — or, the wormhole, a way into its throat)
    const caTxt = ca && ca.d < 0 ? (i.target === "wormhole" ? "into the mouth" : "impact") : ca ? fmtDist(ca.d, !!i.ref, this.s) : "";
    T.ca!.textContent = ca ? `${caTxt} · ${ca.t > 0 ? `T−${i.ref ? fmtDur(ca.t, this.s) : fmtShort(Math.round(ca.t))}` : "now"}` : "—";
    // the habitability guard: irradiance (bolometric, along the strongest direction) and equilibrium
    // temperature, from the planet's light probe
    const pr = i.ref ? null : i.probe;
    // in a planet's frame: the landing figures (ground-relative)
    const sf = i.surface;
    for (const k of ["alt", "vv", "vh", "twr"]) T[k]!.parentElement!.hidden = !sf;
    // our universe: the altitude above the body of the sphere of influence, and the radial speed
    if (i.ref && Number.isFinite(i.ourAlt) && !sf) {
      T.alt!.parentElement!.hidden = false;
      T.vv!.parentElement!.hidden = false;
      const km = i.ourAlt * 1.476625e8;
      T.alt!.textContent = `${km >= 1e6 ? `${(km / 1.495978707e8).toFixed(3)} AU` : `${km.toFixed(km >= 1e4 ? 0 : 1)} km`} · ${BODY_NAMES[i.ref as Target] ?? i.ref}`;
      T.vv!.textContent = `${i.ourVr >= 0 ? "▲" : "▼"} ${kms(i.ourVr)} km/s`;
      T.vv!.className = "";
    }
    if (sf) {
      const m = (x: number) =>
        Math.abs(x) >= 1e4 ? `${(x / 1000).toFixed(Math.abs(x) >= 1e5 ? 0 : 1)} km` : `${x.toFixed(Math.abs(x) >= 100 ? 0 : 1)} m`;
      T.alt!.textContent = sf.landed
        ? `landed on ${BODY_NAMES[sf.body]}`
        : `${m(sf.alt)}${sf.air > 1e-6 ? ` · air ${sf.air < 0.01 ? sf.air.toExponential(1) : sf.air.toFixed(2)} kg/m³` : ""}`;
      T.vv!.textContent = `${sf.vVert >= 0 ? "▲" : "▼"} ${m(Math.abs(sf.vVert))}/s`;
      T.vv!.className = sf.vVert < -12 && sf.alt < 2000 ? "closing" : "";
      T.vh!.textContent = `${m(sf.vHor)}/s`;
      T.twr!.textContent = `${sf.twr.toFixed(2)} · local ${sf.gLocal.toFixed(2)} g`;
      T.twr!.className = sf.twr < 1 ? "closing" : "";
    }
    T.light!.parentElement!.hidden = !pr && !i.ref;
    // our universe: the Sun's light where the ship is (T_eq of an Earth-like planet, albedo 0.3)
    if (i.ref && i.X) {
      const S = solarState("sun", time).pos;
      const au = (Math.hypot(i.X[0] - S[0], i.X[1] - S[1], i.X[2] - S[2]) * M_METRES) / AU_M;
      const e = EARTH_IRRADIANCE / (au * au);
      const txt = e >= 1e3 ? `${(e / 1e3).toFixed(1)} kW/m²` : `${e.toFixed(e >= 10 ? 0 : 1)} W/m²`;
      const teq = 254.6 / Math.sqrt(au);
      T.light!.textContent = `${txt} (${(1 / (au * au)).toPrecision(2)} ⊕) · T_eq ${Math.round(teq)} K`;
      T.light!.className = teq > 330 || teq < 200 ? "closing" : "";
    }
    if (pr) {
      const e = pr.eBol;
      const txt = e >= 1e6 ? `${(e / 1e6).toFixed(1)} MW/m²` : e >= 1e3 ? `${(e / 1e3).toFixed(1)} kW/m²` : `${e.toFixed(0)} W/m²`;
      T.light!.textContent = `${txt} (${(e / EARTH_IRRADIANCE).toPrecision(2)} ⊕) · T_eq ${Math.round(pr.teq)} K`;
      T.light!.className = pr.teq > 330 || pr.teq < 200 ? "closing" : "";
    }
    // orbit figures
    const O = this.orbitEls;
    const p = i.path;
    let peri = NaN,
      apo = NaN,
      tPe = NaN,
      tAp = NaN;
    if (p && p.pts.length > 2) {
      p.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (!(r >= peri)) (peri = r), (tPe = (j + 1) * p.dt);
        if (!(r <= apo)) (apo = r), (tAp = (j + 1) * p.dt);
      });
      if (i.r < peri) (peri = i.r), (tPe = 0);
      if (i.r > apo) (apo = i.r), (tAp = 0);
    }
    let course = "—",
      hot = false;
    if (p) {
      const t = p.pts.length * p.dt;
      if (p.fate === "horizon") (course = `HORIZON T−${fmtShort(Math.round(t))}`), (hot = true);
      else if (p.fate === "star")
        (course = `${p.hit && p.hit !== "star" ? BODY_NAMES[p.hit].toUpperCase() : "STAR"} T−${fmtShort(Math.round(t))}`), (hot = true);
      else if (p.fate === "wormhole") course = `WORMHOLE T−${fmtShort(Math.round(t))}`;
      else if (p.fate === "escape") course = i.E >= 1 ? "ESCAPE" : "LEAVING";
      else course = i.E < 1 ? "BOUND ORBIT" : "COASTING";
    }
    O.course!.textContent = course;
    O.course!.classList.toggle("hot", hot);
    O.pe!.textContent = Number.isFinite(peri) ? `${f(peri, 1)} M${tPe > 0 ? ` · T−${fmtShort(Math.round(tPe))}` : ""}` : "—";
    O.ap!.textContent =
      p?.fate === "escape"
        ? "∞"
        : Number.isFinite(apo) && p?.fate === "continues"
          ? `${f(apo, 1)} M${tAp > 0 ? ` · T−${fmtShort(Math.round(tAp))}` : ""}`
          : "—";
    O.el!.textContent = i.region === "hole" ? `${f(i.E, 4)} · ${f(i.L, 2)}` : "—";
    // around a body (ours, or a planet's frame): the Kepler figures
    const ks = i.status;
    const kepler = !!ks && !ks.kerr && ks.side !== "throat";
    if (this.orbitHead) this.orbitHead.textContent = kepler ? `Orbit · ${ks!.soiName}` : "Effective potential";
    if (ks && kepler) {
      const km = (x: number) =>
        !Number.isFinite(x)
          ? "∞"
          : Math.abs(x) >= 1e7
            ? `${(x / 1.495978707e8).toFixed(2)} AU`
            : `${Math.round(x).toLocaleString("en")} km`;
      O.course!.textContent = `${ks.label} · ${ks.soiName.toUpperCase()}`;
      O.course!.classList.toggle("hot", ks.status === "suborbital" && !!ks.next && ks.next.kind === "impact");
      O.pe!.textContent = ks.orbit ? `${km(ks.orbit.peKm)}${ks.orbit.tPe > 0 ? ` · T−${fmtS(ks.orbit.tPe)}` : ""}` : "—";
      O.ap!.textContent =
        ks.orbit && Number.isFinite(ks.orbit.apKm) ? `${km(ks.orbit.apKm)} · T−${fmtS(ks.orbit.tAp)}` : ks.orbit ? "∞" : "—";
      O.el!.textContent = ks.orbit ? `i ${ks.orbit.incDeg.toFixed(1)}° · e ${ks.orbit.ecc.toFixed(3)}` : "—";
    }
    // warnings
    const w: string[] = [];
    if (p?.fate === "horizon") w.push(`⚠ COLLISION COURSE — HORIZON IN ${fmtM(p.pts.length * p.dt, s).toUpperCase()}`);
    // (not while an autopilot flies around that body: it keeps the ship off it)
    const hit = p?.hit ?? "star";
    const nm = (b: keyof typeof BODY_NAMES) => (b === "star" ? "THE STAR" : BODY_NAMES[b].toUpperCase());
    // (not on the ground either: that is where the path ends)
    const onGround = i.landed || i.surface?.landed;
    // (in a planet's frame the Kerr path ignores the planet's own pull: its status knows better)
    const orbiting =
      i.status?.soi === hit && (i.status.status === "orbit" || i.status.status === "escape" || i.status.status === "hyperbolic");
    if (
      p?.fate === "star" &&
      !onGround &&
      !orbiting &&
      !((i.auto === "approach" || i.auto === "orbit" || i.auto === "land" || i.auto === "takeoff") && i.target === hit)
    )
      w.push(`⚠ COLLISION COURSE — ${nm(hit)}`);
    // the air's limits: the shield, the hull, the load
    const air = i.air;
    if (air && (air.inAir || air.margins.shield > 0.6 || air.margins.hull > 0.6)) {
      const pc = (x: number) => `${Math.round(x * 100)} %`;
      if (air.failure) w.push(`⚠ ${air.failure.toUpperCase()}`);
      if (air.margins.shield > 0.85) w.push(`⚠ HEAT SHIELD ${Math.round(air.shield)} K · ${pc(air.margins.shield)}`);
      if (air.margins.hull > 0.8) w.push(`⚠ HULL ${Math.round(air.hull)} K · ${pc(air.margins.hull)}`);
      if (air.margins.g > 0.75) w.push(`⚠ LOAD ${air.g.toFixed(1)} g · ${pc(air.margins.g)}`);
      if (air.stalled && air.mach < 3) w.push("⚠ STALL");
      if (air.heat > 5e4) w.push(`PLASMA · ${(air.heat / 1e4).toFixed(0)} W/cm² · MACH ${air.mach.toFixed(1)}`);
    }
    if (i.surface?.rolling) w.push(`ON THE WHEELS · ${nm(i.surface.body)} · ${Math.round(i.surface.vHor)} M/S`);
    else if (i.surface?.landed) w.push(`LANDED ON ${nm(i.surface.body)}`);
    else if (i.landed && !i.surface) w.push(`LANDED ON ${nm(i.landedOn ?? "star")}`);
    if (i.ergo) w.push("ERGOSPHERE · NO STATIC OBSERVER · FRAME DRAGGING");
    else if (i.region === "hole" && i.r < i.photon) w.push("INSIDE THE PHOTON ORBIT");
    else if (i.region === "hole" && i.r < i.isco) w.push("BELOW THE ISCO · NO STABLE ORBIT");
    if (!s.animate) w.push("TIME PAUSED · SPACE TO FLY");
    this.warn.innerHTML = w.map((x) => `<div class="${x.startsWith("⚠") ? "hot" : ""}">${x}</div>`).join("");
    // buttons
    this.buttons.get("sas")!.classList.toggle("on", i.sas);
    this.buttons.get("roll")!.classList.toggle("on", i.rollAlign);
    for (const [hold] of HOLD_KEYS) this.buttons.get(hold)!.classList.toggle("on", i.hold === hold);
    // (CIRC lit while its own burn is flown as a node)
    const lit = (a: string) => i.auto === a || i.hub?.mode === a;
    for (const [a] of AUTO_KEYS) this.buttons.get(a)!.classList.toggle("on", lit(a));
    this.drawHubCard(i);
    // what cannot apply now, dimmed (its tooltip says why)
    {
      const nearGround = !!i.surface || (!!i.status && !i.status.kerr && Number.isFinite(i.status.altKm) && i.status.altKm < 300);
      const why: Record<string, string> = {};
      if (!i.dirs.target) why.target = why.antiTarget = why.approach = why.speedMode = "No target";
      if (!i.dirs.maneuver && !i.plan?.nodes.length) why.maneuver = "No planned burn";
      if (!i.dirs.prograde)
        for (const k of ["prograde", "retrograde", "radialOut", "radialIn", "normal", "antinormal"])
          why[k] = i.landed ? "On the ground" : "No orbit here";
      if (i.landed) why.hover = why.circularize = why.land = "On the ground";
      else {
        why.takeoff = "Not on the ground";
        if (!nearGround) why.land = "No ground near";
      }
      for (const [id, b] of this.buttons) {
        if (!b.classList.contains("fl-rb")) continue;
        const r = why[id];
        b.classList.toggle("off", !!r && !b.classList.contains("on"));
        b.setAttribute("aria-pressed", String(b.classList.contains("on")));
        if (r) b.dataset.why = r;
        else delete b.dataset.why;
      }
    }
    {
      const b = this.buttons.get("speedMode")!;
      b.classList.toggle("on", i.speedMode === "target");
      b.dataset.label = i.speedMode === "target" ? "Speed: target" : "Speed: orbit";
      b.setAttribute("aria-label", b.dataset.label);
      b.setAttribute("aria-pressed", String(i.speedMode === "target"));
    }
    for (const m of MOUNT_KEYS) this.buttons.get(`mount:${m}`)!.classList.toggle("on", i.mount === m);
    this.buttons.get("ahead")!.classList.toggle("on", s.shipLookYaw !== 0 || s.shipLookPitch !== 0);
  }

  /** Closest approach to the target along the predicted path (both moving; black hole's frame). */
  private closestApproach(i: Info, t0: number) {
    const p = i.path;
    if (!p || !i.X || i.target === "hole" || i.target === "barycentre") return null;
    const s = this.s;
    if (i.target === "star" && !s.sun) return null;
    if (i.target === "wormhole" && !s.wormhole) return null;
    const target = i.target;
    const at = (t: number): V3 => bodyCentre(s, target, t) as V3;
    let best = { d: Math.hypot(...sub(i.X, at(t0))), t: 0 };
    p.pts.forEach((q, j) => {
      const d = Math.hypot(...sub(q, at(t0 + (j + 1) * p.dt)));
      if (d < best.d) best = { d, t: (j + 1) * p.dt };
    });
    return best;
  }

  // ------------------------------------------------------------------------------------ full-screen HUD: tapes, markers
  private drawHud(i: Info) {
    const c = this.hud;
    const dpr = devicePixelRatio;
    const W = Math.round(innerWidth * dpr),
      H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const tanH = Math.tan((this.s.fov * Math.PI) / 360);
    const asp = W / H;
    const proj = (d: V3 | null) => {
      if (!d || d[2] <= 0.02) return null;
      const x = d[0] / (d[2] * tanH * asp),
        y = d[1] / (d[2] * tanH);
      if (Math.abs(x) > 1.05 || Math.abs(y) > 1.05) return null;
      return [((x + 1) / 2) * W, ((1 - y) / 2) * H] as const;
    };
    // the conformal symbology first, under the rest: horizon, pitch ladder, heading, bank, the markers
    // (the future: +10, +30, +60 s and a quarter of the orbit, when there is one)
    const T = i.status?.orbit?.period;
    const quarter = T && Number.isFinite(T) && T / 4 > 90 ? T / 4 : undefined;
    const fut = this.future?.([10, 30, 60, ...(quarter ? [quarter] : [])]) ?? null;
    drawSymbology({
      ctx,
      W,
      H,
      dpr,
      fov: this.s.fov,
      s: this.s,
      i,
      density: this.density,
      simS: this.lastTime * M_SECONDS,
      future: fut,
      quarter,
      runway: this.runway?.() ?? null,
      outside: ["around", "free", "flyby", "station"].includes(String(i.mount)),
      top: Math.max(this.mission.getBoundingClientRect().bottom, 0) * dpr,
    });
    const r = 11 * dpr;
    // (each mark twice: a dark outline under it for the bright sky, then its colour)
    const UNDER = "rgba(0, 0, 0, 0.4)";
    const nose = proj([i.S[0][2], i.S[1][2], i.S[2][2]]);
    if (nose)
      for (const [lw, col] of [
        [4.5, UNDER],
        [2, "rgba(255, 200, 90, 0.95)"],
      ] as const) {
        ctx.lineWidth = lw * dpr;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(nose[0] - 2.2 * r, nose[1]);
        ctx.lineTo(nose[0] - r, nose[1]);
        ctx.lineTo(nose[0] - 0.5 * r, nose[1] + 0.6 * r);
        ctx.lineTo(nose[0], nose[1]);
        ctx.lineTo(nose[0] + 0.5 * r, nose[1] + 0.6 * r);
        ctx.lineTo(nose[0] + r, nose[1]);
        ctx.lineTo(nose[0] + 2.2 * r, nose[1]);
        ctx.stroke();
      }
    // in the air: the flight path vector — where the craft goes through the air
    const A = i.air;
    if (A && A.u && A.q > 20) {
      const S = i.S;
      const fp = proj([
        S[0][0] * A.u[0] + S[0][1] * A.u[1] + S[0][2] * A.u[2],
        S[1][0] * A.u[0] + S[1][1] * A.u[1] + S[1][2] * A.u[2],
        S[2][0] * A.u[0] + S[2][1] * A.u[1] + S[2][2] * A.u[2],
      ]);
      if (fp)
        for (const [lw, col] of [
          [4.5, UNDER],
          [2, A.stalled ? "rgba(255, 90, 70, 0.95)" : "rgba(120, 255, 170, 0.95)"],
        ] as const) {
          ctx.lineWidth = lw * dpr;
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.arc(fp[0], fp[1], 0.62 * r, 0, 2 * Math.PI);
          ctx.moveTo(fp[0] - 0.62 * r, fp[1]);
          ctx.lineTo(fp[0] - 1.7 * r, fp[1]);
          ctx.moveTo(fp[0] + 0.62 * r, fp[1]);
          ctx.lineTo(fp[0] + 1.7 * r, fp[1]);
          ctx.moveTo(fp[0], fp[1] - 0.62 * r);
          ctx.lineTo(fp[0], fp[1] - 1.3 * r);
          ctx.stroke();
        }
    }
    for (const k of ["prograde", "retrograde", "burn", "maneuver", "tgtPrograde", "tgtRetrograde", "dock"] as const) {
      if (k === "maneuver" && i.dirs.burn) continue;
      const p = proj(i.dirs[k]);
      if (!p) continue;
      ctx.lineWidth = 4.5 * dpr;
      marker(ctx, GLYPH[k]!, p[0], p[1], r, UNDER);
      ctx.lineWidth = 2 * dpr;
      marker(ctx, GLYPH[k]!, p[0], p[1], r, COL[k]!);
    }
    if (this.density < 2) {
      // each tape in the free band between the panels above and below it on its side (a phone: between
      // the mission bar and the touch controls, smaller)
      const phone = isMobile();
      const u = phone ? 0.8 * dpr : dpr;
      // (shown: laid out — offsetParent is null for the fixed ones, the touch controls)
      const shown = (e: HTMLElement | null): e is HTMLElement =>
        !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none";
      const band = (above: (HTMLElement | null)[], below: (HTMLElement | null)[]) => {
        const top = Math.max(phone ? 0 : 60, ...above.filter(shown).map((e) => e.getBoundingClientRect().bottom)) + (phone ? 30 : 40);
        const bottom =
          Math.min(phone ? innerHeight - 20 : innerHeight - 210, ...below.filter(shown).map((e) => e.getBoundingClientRect().top)) -
          (phone ? 30 : 34);
        if (bottom - top < (phone ? 90 : 110)) return null; // no room (a tall planner): no tape
        const hgt = Math.min(bottom - top, phone ? 250 : 330);
        return { cy: ((top + bottom) / 2) * dpr, h: hgt * dpr };
      };
      const q = (sel: string) => document.querySelector<HTMLElement>(sel);
      // (upright, the attitude ball stands above the touch controls: the tapes end above it)
      const ball = phone && innerHeight > innerWidth ? this.cockpitEl() : null;
      const L = phone ? band([this.mission, this.target], [q(".tf-stick"), ball]) : band([this.target], [this.orbit]);
      const x = (phone ? 16 : 30) * dpr;
      if (L) this.speedTape(ctx, i, x, L.cy, L.h, u);
      const R = phone ? band([this.mission, this.right], [q(".tf-right"), ball]) : band([this.tel], [this.right]);
      // (near a body — ours, or one of Gargantua's —: the height above its ground; else r near the hole)
      const st = i.status;
      if (R && (i.surface || (st && !st.kerr && Number.isFinite(st.altKm)))) this.bodyAltTape(ctx, i, W - x, R.cy, R.h, u);
      else if (R && i.region === "hole") this.altTape(ctx, i, W - x, R.cy, R.h, u);
    }
  }

  /**
   * The air data, in the air (or with the sci-fi computer on): the flight law and its commands, Mach,
   * the dynamic pressure, α, β, the climb angle, the load, the skin's temperatures against their limits,
   * the flaps, gear and brake.
   */
  private drawAirData(i: Info) {
    const A = i.air;
    const show = !!A && (A.inAir || A.mode === "sf" || A.margins.shield > 0.4 || A.margins.hull > 0.4) && this.density < 2;
    this.airData.hidden = !show;
    if (!show || !A) return;
    const d = 180 / Math.PI;
    const mode = A.mode === "sf" ? `FLIGHT COMPUTER${A.antigrav ? " · ANTIGRAVITY" : ""}` : A.mode.toUpperCase();
    const q = A.q >= 1000 ? `${(A.q / 1000).toFixed(1)} kPa` : `${A.q.toFixed(0)} Pa`;
    const bar = (x: number) =>
      `<i class="fl-ad-bar${x > 0.85 ? " hot" : x > 0.6 ? " warm" : ""}"><b style="width:${Math.min(x, 1) * 100}%"></b></i>`;
    const flaps = A.flaps === 1 ? "FULL" : A.flaps === 0.5 ? "½" : "UP";
    const cmd = A.sf
      ? `<span>CMD <b>${A.sf.speed.toFixed(0)} m/s</b> γ <b>${(A.sf.gamma * d).toFixed(0)}°</b> HDG <b>${((((A.sf.heading * d) % 360) + 360) % 360) | 0}°</b></span>`
      : "";
    const html =
      `<div class="fl-ad-row"><span class="fl-ad-mode">${mode}</span>${cmd}<span>M <b>${A.mach.toFixed(2)}</b></span><span>q <b>${q}</b></span>` +
      `<span>α <b>${(A.alpha * d).toFixed(1)}°</b></span><span>β <b>${(A.beta * d).toFixed(1)}°</b></span><span><b>${A.g.toFixed(2)}</b> g</span></div>` +
      `<div class="fl-ad-row">${A.shieldMax ? `<span>SHIELD <b>${Math.round(A.shield)} K</b>${bar(A.margins.shield)}</span>` : ""}<span>HULL <b>${Math.round(A.hull)} K</b>${bar(A.margins.hull)}</span>` +
      `<span>LOAD${bar(A.margins.g)}</span><span class="${A.flaps ? "on" : ""}">FLAPS ${flaps}</span><span class="${A.gear ? "on" : ""}">GEAR</span><span class="${A.brake ? "on" : ""}">BRAKE</span></div>`;
    if (html === this.airKey) return;
    this.airKey = html;
    this.airData.innerHTML = html;
  }

  /**
   * The docking aid (the space station within 5 km): the port, the rings' distance, the closing rate,
   * the offset and drift across the port's axis, the nose against it — each green within the capture
   * (30 cm, 10°, under 0.5 m/s); docked, the port and UNDOCK.
   */
  private drawDock(i: Info) {
    const d = i.dock;
    const links = i.links ?? [];
    this.dock.hidden = !d && !links.length;
    if (!d && !links.length) return;
    const f = (v: number, n = 1) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(n)} m`);
    const ok = (b: boolean) => (b ? "ok" : "");
    const key = [
      links.map((l) => l.title + l.port).join(),
      d
        ? [
            d.target,
            d.port,
            d.range.toFixed(1),
            d.closing.toFixed(2),
            d.lateral.toFixed(2),
            d.lateralRate.toFixed(2),
            d.angle.toFixed(0),
            i.dockPhase,
          ].join()
        : "",
    ].join("|");
    if (key === this.dockKey) return;
    this.dockKey = key;
    this.dock.replaceChildren();
    const row = (label: string, value: string, cls = "") => {
      const r = h("div", "fl-dock-row");
      r.append(h("span", "", label), h("b", cls, value));
      this.dock.append(r);
    };
    // docked: to what, by which port; UNDOCK lets the flown craft go
    if (links.length) {
      this.dock.append(h("div", "fl-title", `Docked · ${links.map((l) => l.title).join(" · ")}`));
      for (const l of links) this.dock.append(h("div", "fl-dock-port", `${l.title} · ${l.port}`));
      const b = h("button", "fl-go", "UNDOCK") as HTMLButtonElement;
      b.onclick = () => this.act.undock();
      this.dock.append(b);
    }
    if (!d) return;
    this.dock.append(h("div", "fl-title", `Docking · ${d.title}`), h("div", "fl-dock-port", d.name));
    row("Range", f(d.range, d.range < 100 ? 2 : 1));
    row("Closing", `${d.closing.toFixed(2)} m/s`, ok(d.closing > 0 && d.closing < 0.5));
    row("Offset", `${f(d.lateral, 2)} · ${d.lateralRate.toFixed(2)} m/s`, ok(d.lateral < 0.3));
    row("Ports' axes", `${d.angle.toFixed(1)}°`, ok(d.angle < 10));
    // the docking autopilot: what it does; the button that engages or stops it (B)
    if (i.dockPhase) row("Autopilot", i.dockPhase, "ok");
    const b = h("button", "fl-go", i.dockPhase ? "STOP AUTO-DOCK" : "AUTO-DOCK · B") as HTMLButtonElement;
    b.title = "The docking autopilot: on the thrusters, to the port's axis, then in along it to the capture";
    b.onclick = () => this.act.auto("dock");
    this.dock.append(b);
  }

  /** the attitude ball's box (the cockpit's drawn ball, not its wide frame) */
  private cockpitEl() {
    return this.root.querySelector<HTMLElement>(".fl-ballbox");
  }

  /** the speed tape's full scale [c], eased towards its goal (a round number over the speed) */
  private tapeMax = 0;
  private tapeGoal = 0;

  /**
   * Speed tape (left): a gauge from 0 at the bottom to a round full scale above the speed (and the
   * autopilot's goal) — in m/s, km/s, or c when relativistic, up to the light barrier — rescaled
   * smoothly when the speed outgrows it or falls well under it; the column filled to the speed, the
   * value box beside it, the autopilot's target bug, the trend.
   */
  private speedTape(ctx: CanvasRenderingContext2D, i: Info, x0: number, cy: number, hgt: number, dpr: number) {
    const wdt = 58 * dpr;
    const C = C_MPS;
    const want = Number.isFinite(i.wantSpeed) ? i.wantSpeed : 0;
    const need = Math.max(i.speed, want, 1e-9);
    // a round number (1, 2, 2.5, 5 × 10ⁿ) at or above x
    const nice = (x: number) => {
      const e = 10 ** Math.floor(Math.log10(x));
      const m = x / e;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
    };
    // the unit: c when relativistic (above 1 % of c), km/s above 2 km/s, else m/s (10 m/s at least)
    const rel = need * 1.15 > 0.01;
    const unitK = rel ? 1 : need * C * 1.15 >= 2000 ? C / 1000 : C; // (c → the unit)
    const unit = rel ? "c" : unitK === C ? "m/s" : "km/s";
    const goal = Math.min(rel ? 1 : Infinity, nice(Math.max(need * 1.15 * unitK, rel ? 0.02 : unitK === C ? 10 : 2)) / unitK);
    // (a new scale when the speed nears its top, or falls under a third of it)
    if (!(this.tapeGoal > 0) || need > this.tapeGoal * 0.9 || need < this.tapeGoal * 0.3 || Math.abs(Math.log(goal / this.tapeGoal)) > 3)
      this.tapeGoal = goal;
    this.tapeMax =
      this.tapeMax > 0 ? Math.exp(Math.log(this.tapeMax) + (Math.log(this.tapeGoal) - Math.log(this.tapeMax)) * 0.18) : this.tapeGoal;
    const vmax = this.tapeMax;
    const top = cy - hgt / 2,
      bot = cy + hgt / 2;
    const y = (v: number) => bot - Math.min(Math.max(v / vmax, 0), 1.02) * hgt;
    panelBg(ctx, x0, top, wdt, hgt, dpr);
    // the column filled to the speed
    const g = ctx.createLinearGradient(0, bot, 0, top);
    g.addColorStop(0, "rgba(214, 245, 91, 0.05)");
    g.addColorStop(1, "rgba(214, 245, 91, 0.32)");
    ctx.fillStyle = g;
    ctx.fillRect(x0 + wdt - 7 * dpr, y(i.speed), 5 * dpr, bot - y(i.speed));
    // the scale: 5 labelled steps, a tick between each
    const step = nice((vmax * unitK) / 5) / unitK;
    ctx.strokeStyle = "rgba(230, 236, 245, 0.55)";
    ctx.fillStyle = "rgba(230, 236, 245, 0.78)";
    ctx.lineWidth = 1 * dpr;
    ctx.font = `${10 * dpr}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const fmt = (v: number) => {
      const u = v * unitK;
      return rel ? u.toFixed(u < 0.1 ? 3 : 2) : u >= 100 || Number.isInteger(u) ? u.toFixed(0) : u.toFixed(1);
    };
    for (let v = 0; v <= vmax * 1.0001; v += step / 2) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const yy = y(v);
      ctx.beginPath();
      ctx.moveTo(x0 + wdt, yy);
      ctx.lineTo(x0 + wdt - (major ? 12 : 6) * dpr, yy);
      ctx.stroke();
      if (major) ctx.fillText(fmt(v), x0 + wdt - 15 * dpr, yy);
    }
    // the light barrier, the autopilot's target speed
    if (rel && vmax > 0.9) {
      ctx.fillStyle = "rgba(255, 90, 70, 0.25)";
      ctx.fillRect(x0, y(1), wdt, y(0.95) - y(1));
    }
    if (want > 0) {
      const yy = y(want);
      ctx.fillStyle = CYAN;
      ctx.beginPath();
      ctx.moveTo(x0 + wdt, yy);
      ctx.lineTo(x0 + wdt - 8 * dpr, yy - 5 * dpr);
      ctx.lineTo(x0 + wdt - 8 * dpr, yy + 5 * dpr);
      ctx.fill();
    }
    const yv = y(i.speed);
    // the trend: where the speed will be in 10 s of the scene's time (Airbus's), its rate taken over the
    // last second of samples — the same units as the tape, the warp and a pause taken into account
    const last = this.samples[this.samples.length - 1];
    const s1 = last && this.samples.find((q) => q.w >= last.w - 1);
    if (s1 && last && last.ts - s1.ts > 1e-6) {
      const d = (((last.v - s1.v) / (last.ts - s1.ts)) * 10 * hgt) / vmax;
      if (Math.abs(d) > 2 * dpr) {
        ctx.strokeStyle = "#d6f55b";
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(x0 + wdt + 3 * dpr, yv);
        ctx.lineTo(x0 + wdt + 3 * dpr, Math.max(top, Math.min(bot, yv - d)));
        ctx.stroke();
      }
    }
    const relTo =
      i.speedMode === "target"
        ? `rel. ${BODY_NAMES[i.target as Target]} (target)`
        : i.ref
          ? `rel. ${BODY_NAMES[i.ref as Target] ?? i.ref}`
          : "rel. ZAMO";
    label(ctx, x0, top - 16 * dpr, `SPEED · ${unit}`, relTo, dpr);
    // the value, beside the pointer
    const v = i.speed * unitK;
    const main = rel ? i.speed.toFixed(4) : v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
    valueBox(
      ctx,
      x0 + wdt + 8 * dpr,
      Math.max(top + 12 * dpr, Math.min(bot - 12 * dpr, yv)),
      main,
      unit,
      rel ? `γ ${i.gamma.toFixed(3)}` : `${i.speed.toExponential(2)} c`,
      "left",
      dpr,
    );
  }

  // ------------------------------------------------------------------------------------ target & Ranger instruments
  /** A canvas sized to its CSS box (device pixels), cleared; its tooltips' regions reset. */
  private instr(c: HTMLCanvasElement, cssH: number) {
    const dpr = devicePixelRatio;
    const w = c.clientWidth || 228;
    const cw = Math.round(w * dpr),
      ch = Math.round(cssH * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch), (c.style.height = `${cssH}px`);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    const regs: { x: number; y: number; w: number; h: number; label: string; tip: string }[] = [];
    this.regions.set(c, regs);
    return {
      ctx,
      dpr,
      W: w,
      H: cssH,
      reg: (x: number, y: number, ww: number, hh: number, label: string, tip: string) => regs.push({ x, y, w: ww, h: hh, label, tip }),
    };
  }

  /**
   * The target: a bearing scope (the target's angle off the nose — dead ahead at the centre, astern
   * at the rim; hollow when behind), its name and range, the range rate as a two-way bar (closing:
   * left, red; receding: right), the closest approach and when; the light it receives; near the
   * ground, the landing figures.
   */
  private drawTargetInstr(i: Info) {
    const T = this.targetEls;
    const hasGround = !!T.alt?.textContent && T.alt.textContent !== "—";
    const { ctx, dpr, W, reg } = this.instr(this.tgtCanvas, hasGround ? 156 : 126);
    const txt = (k: string) => T[k]?.textContent ?? "";
    const S = (v: number) => v * dpr;
    ctx.textBaseline = "alphabetic";
    // the scope
    const R = 42,
      cx = R + 2,
      cy = R + 4;
    ctx.save();
    ctx.translate(S(cx), S(cy));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S(R));
    g.addColorStop(0, "rgba(111, 210, 255, 0.10)");
    g.addColorStop(1, "rgba(111, 210, 255, 0.02)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, S(R), 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(111, 210, 255, 0.35)";
    ctx.lineWidth = S(1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(111, 210, 255, 0.16)";
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.arc(0, 0, S(R * f), 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(S(-R), 0);
    ctx.lineTo(S(R), 0);
    ctx.moveTo(0, S(-R));
    ctx.lineTo(0, S(R));
    ctx.stroke();
    // (ticks round the rim every 30°)
    ctx.strokeStyle = "rgba(111, 210, 255, 0.5)";
    for (let a = 0; a < 360; a += 30) {
      const c = Math.cos((a * Math.PI) / 180),
        s2 = Math.sin((a * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(S(c * R), S(s2 * R));
      ctx.lineTo(S(c * (R - 4)), S(s2 * (R - 4)));
      ctx.stroke();
    }
    // the nose at the centre
    ctx.strokeStyle = "#ffc85a";
    ctx.lineWidth = S(1.5);
    ctx.beginPath();
    ctx.moveTo(S(-6), 0);
    ctx.lineTo(S(-2.5), 0);
    ctx.lineTo(0, S(2.5));
    ctx.lineTo(S(2.5), 0);
    ctx.lineTo(S(6), 0);
    ctx.stroke();
    const d = i.dirs.target;
    if (d) {
      const Sm = i.S;
      const b: V3 = [
        Sm[0][0] * d[0] + Sm[1][0] * d[1] + Sm[2][0] * d[2],
        Sm[0][1] * d[0] + Sm[1][1] * d[1] + Sm[2][1] * d[2],
        Sm[0][2] * d[0] + Sm[1][2] * d[1] + Sm[2][2] * d[2],
      ];
      const ang = Math.acos(Math.max(-1, Math.min(1, b[2])));
      const rr = (ang / Math.PI) * R;
      const dir = Math.atan2(b[1], -b[0]);
      const x = Math.cos(dir) * rr,
        y = -Math.sin(dir) * rr;
      ctx.setLineDash([S(2), S(3)]);
      ctx.strokeStyle = "rgba(255, 148, 102, 0.55)";
      ctx.lineWidth = S(1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(S(x), S(y));
      ctx.stroke();
      ctx.setLineDash([]);
      halo(ctx, S(x), S(y), S(12), "255, 138, 92", 0.45);
      ctx.beginPath();
      ctx.arc(S(x), S(y), S(4), 0, 2 * Math.PI);
      if (b[2] >= 0) {
        ctx.fillStyle = "#ff9466";
        ctx.fill();
      } else {
        ctx.strokeStyle = "#ff9466";
        ctx.lineWidth = S(1.8);
        ctx.stroke();
      }
      ctx.font = `700 ${S(9.5)}px ${FONT}`;
      ctx.fillStyle = "rgba(255, 148, 102, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round((ang * 180) / Math.PI)}°`, 0, S(R - 8));
    }
    ctx.restore();
    reg(
      cx - R,
      cy - R,
      2 * R,
      2 * R,
      "Bearing",
      "Where the target lies from the nose: dead ahead at the centre, astern at the rim (hollow: behind)",
    );
    // the name, the range
    const x0 = 2 * R + 14,
      cw = W - x0 - 2;
    ctx.textAlign = "left";
    ctx.font = `700 ${S(10)}px ${FONT}`;
    ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
    ctx.fillText("TARGET", S(x0), S(13));
    ctx.font = `700 ${S(18)}px ${FONT}`;
    ctx.fillStyle = "#ff9466";
    ctx.fillText(txt("name").toUpperCase(), S(x0), S(30), S(cw));
    ctx.font = `600 ${S(16)}px ${MONO}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(txt("dist"), S(x0), S(50), S(cw));
    reg(x0, 0, cw, 54, "Range", "Distance to the target, centre to centre");
    // the range rate: a two-way bar round a centre line
    const rate = i.targetRate;
    const yb = 74;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(S(x0), S(yb), S(cw), S(4));
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillRect(S(x0 + cw / 2 - 0.5), S(yb - 3), S(1), S(10));
    if (Number.isFinite(rate) && rate !== 0) {
      const ms = Math.abs(rate) * (i.ref ? 1e3 : C_MPS);
      const f = Math.min(1, Math.log10(1 + ms) / 4.5) * (cw / 2);
      ctx.fillStyle = rate < 0 ? "#ff7a5c" : "#6fd2ff";
      ctx.fillRect(S(rate < 0 ? x0 + cw / 2 - f : x0 + cw / 2), S(yb), S(f), S(4));
    }
    ctx.font = `600 ${S(9.5)}px ${FONT}`;
    ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
    ctx.fillText("CLOSING", S(x0), S(yb + 15));
    ctx.textAlign = "right";
    ctx.fillText("RECEDING", S(x0 + cw), S(yb + 15));
    ctx.textAlign = "center";
    ctx.font = `500 ${S(11)}px ${MONO}`;
    ctx.fillStyle = rate < 0 ? "#ffb0a0" : "#d9efff";
    ctx.fillText(txt("rate").replace(/^[▲▼]\s*/, ""), S(x0 + cw / 2), S(yb - 5));
    reg(x0, yb - 16, cw, 34, "Range rate", "How fast the distance changes — the bar grows left when closing in, right when drawing away");
    // the closest approach
    const ca = txt("ca");
    if (ca && ca !== "—") {
      const k = ca.indexOf(" · ");
      const [cv, ct] = k > 0 ? [ca.slice(0, k), ca.slice(k + 3)] : [ca, ""];
      const yc = 116;
      ctx.textAlign = "left";
      ctx.font = `700 ${S(9.5)}px ${FONT}`;
      ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
      ctx.fillText("CLOSEST", S(x0), S(yc - 12));
      ctx.font = `500 ${S(12)}px ${MONO}`;
      ctx.fillStyle = "#eef4fb";
      ctx.fillText(cv, S(x0), S(yc + 2));
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffc85a";
      ctx.fillText(ct, S(x0 + cw), S(yc + 2));
      reg(x0, yc - 22, cw, 28, "Closest approach", "The closest the path comes to the target, and in how long");
    }
    // near the ground: the landing figures, one line
    if (hasGround) {
      const yg = 146;
      const items: [string, string][] = [
        ["ALT", txt("alt").split(" · ")[0]!],
        ["V/S", txt("vv")],
        ["GND", txt("vh")],
        ["T/W", txt("twr").split(" · ")[0]!],
      ];
      const colW = W / items.length;
      items.forEach(([l, v], j) => {
        ctx.textAlign = "left";
        ctx.font = `700 ${S(9)}px ${FONT}`;
        ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
        ctx.fillText(l, S(j * colW + 2), S(yg - 11));
        ctx.font = `500 ${S(10.5)}px ${MONO}`;
        ctx.fillStyle = l === "V/S" && T.vv?.classList.contains("closing") ? "#ffb0a0" : "#eef4fb";
        ctx.fillText(v || "—", S(j * colW + 2), S(yg + 2), S(colW - 4));
      });
      reg(0, yg - 22, W, 28, "Landing", "Radar altitude · vertical speed · ground speed · thrust over the local weight");
    }
  }

  /**
   * The Ranger: its height and speed in large; the apsis bar — the orbit's lowest to highest point,
   * the ship on it (a periapsis under the ground: the ground and IMPACT; open orbits: ∞) —; three
   * dials: the inclination (the orbit's tilt drawn), the eccentricity (the ellipse's true shape), the
   * period (the ring of one orbit, the part flown since periapsis); the next event.
   */
  /** the craft panel's title: the craft flown (and those docked to it, the assembly's mass) */
  private telTitle: HTMLElement | null = null;
  private drawRangerInstr(i: Info) {
    if (this.telTitle) {
      const others = i.assembly.filter((v) => v !== i.vessel);
      const t = `${VESSELS[i.vessel].name}${others.length ? ` + ${others.map((v) => VESSELS[v].name).join(" + ")} · ${Math.round(i.mass / 1e3)} t` : ""}`;
      if (this.telTitle.textContent !== t) this.telTitle.textContent = t;
    }
    const st = i.status;
    if (!st) return;
    const o = st.orbit;
    const { ctx, dpr, W, reg } = this.instr(this.stCanvas, o ? (st.next ? 192 : 174) : 70);
    const S = (v: number) => v * dpr;
    const km = (x: number) =>
      !Number.isFinite(x)
        ? "∞"
        : Math.abs(x) >= 1e7
          ? `${(x / 1.495978707e8).toFixed(2)} AU`
          : Math.abs(x) >= 1e4
            ? `${Math.round(x).toLocaleString("en")} km`
            : `${x.toFixed(1)} km`;
    const ms = (v: number) => (!Number.isFinite(v) ? "—" : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(2)} km/s` : `${v.toFixed(1)} m/s`);
    const small = (t: string, x: number, y: number, align: CanvasTextAlign = "left") => {
      ctx.textAlign = align;
      ctx.font = `700 ${S(9.5)}px ${FONT}`;
      ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
      ctx.fillText(t, S(x), S(y));
    };
    const big = (t: string, x: number, y: number, col = "#ffffff", size = 15) => {
      ctx.textAlign = "left";
      ctx.font = `600 ${S(size)}px ${MONO}`;
      ctx.fillStyle = col;
      ctx.fillText(t, S(x), S(y), S(W / 2 - 6));
    };
    // height and speed
    small("ALTITUDE", 2, 11);
    big(st.kerr ? `r ${st.kerr.r.toFixed(2)} M` : km(st.altKm), 2, 29);
    small("SPEED", W / 2 + 4, 11);
    big(ms(st.speed), W / 2 + 4, 29);
    ctx.font = `500 ${S(10)}px ${MONO}`;
    ctx.fillStyle = st.vVert < 0 ? "#ffb0a0" : "#9fe3ff";
    ctx.textAlign = "left";
    if (Number.isFinite(st.vVert)) ctx.fillText(`${st.vVert >= 0 ? "▲" : "▼"} ${ms(Math.abs(st.vVert))}`, S(W / 2 + 4), S(42));
    reg(0, 0, W / 2, 44, "Altitude", "Height above the surface of the body whose gravity dominates");
    reg(W / 2, 0, W / 2, 46, "Speed", "Speed relative to that body, and the vertical speed under it");
    if (!o) {
      if (st.kerr) {
        small("E", 2, 58);
        big(st.kerr.E.toFixed(4), 14, 60, "#d9efff", 12);
        small("L", W / 2 + 4, 58);
        big(st.kerr.L.toFixed(3), W / 2 + 16, 60, "#d9efff", 12);
      }
      return;
    }
    // the apsis bar
    const pe = o.peKm,
      ap = o.apKm,
      alt = st.altKm;
    const yb = 62,
      xa = 10,
      xb = W - 10;
    // (the bar spans the orbit's heights, a margin round them — the ground too when it is within)
    const span = Math.max((Number.isFinite(ap) ? ap - pe : pe) * 0.12, Math.abs(alt) * 0.02, 1);
    const lo = Math.min(pe < 0 ? pe : pe - span, alt),
      hi = Number.isFinite(ap) ? Math.max(ap + span, alt) : Math.max(alt * 2, pe * 2, 1);
    const X = (h: number) => xa + ((h - lo) / Math.max(hi - lo, 1e-9)) * (xb - xa);
    // (the rail, faint, then the orbit's span on it)
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx.fillRect(S(xa), S(yb - 1), S(xb - xa), S(2));
    const grd = ctx.createLinearGradient(S(xa), 0, S(xb), 0);
    grd.addColorStop(0, "rgba(111, 210, 255, 0.55)");
    grd.addColorStop(1, Number.isFinite(ap) ? "rgba(111, 210, 255, 0.55)" : "rgba(111, 210, 255, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(S(X(Math.max(pe, lo))), S(yb - 1), S(X(Number.isFinite(ap) ? ap : hi) - X(Math.max(pe, lo))), S(2));
    const tick = (h: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(S(X(h) - 0.75), S(yb - 6), S(1.5), S(12));
    };
    if (pe < 0) {
      // the ground inside the orbit: it hits
      ctx.fillStyle = "rgba(255, 90, 70, 0.25)";
      ctx.fillRect(S(X(lo)), S(yb - 5), S(X(0) - X(lo)), S(10));
      tick(0, "#ff5a46");
    } else tick(pe, "#6fd2ff");
    if (Number.isFinite(ap)) tick(ap, "#6fd2ff");
    else {
      ctx.fillStyle = "#6fd2ff";
      ctx.beginPath();
      ctx.moveTo(S(xb + 4), S(yb));
      ctx.lineTo(S(xb - 3), S(yb - 4));
      ctx.lineTo(S(xb - 3), S(yb + 4));
      ctx.fill();
    }
    // the ship on it
    halo(ctx, S(X(alt)), S(yb), S(11), "255, 200, 90", 0.45);
    ctx.save();
    ctx.translate(S(X(alt)), S(yb));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#ffc85a";
    ctx.fillRect(S(-3.5), S(-3.5), S(7), S(7));
    ctx.restore();
    small(pe < 0 ? "IMPACT" : `PE ${o.tPe > 0 && Number.isFinite(o.tPe) ? `· ${fmtS(o.tPe)}` : ""}`, xa - 8, yb + 17);
    ctx.font = `500 ${S(11)}px ${MONO}`;
    ctx.fillStyle = pe < 0 ? "#ff8a70" : "#eef4fb";
    ctx.textAlign = "left";
    ctx.fillText(pe < 0 ? "below ground" : km(pe), S(xa - 8), S(yb + 30));
    small(Number.isFinite(ap) ? `AP ${Number.isFinite(o.tAp) ? `· ${fmtS(o.tAp)}` : ""}` : "ESCAPE", xb + 8, yb + 17, "right");
    ctx.font = `500 ${S(11)}px ${MONO}`;
    ctx.fillStyle = "#eef4fb";
    ctx.textAlign = "right";
    ctx.fillText(Number.isFinite(ap) ? km(ap) : "∞", S(xb + 8), S(yb + 30));
    reg(0, yb - 12, W, 46, "Apsides", "The orbit from its lowest point (periapsis) to its highest (apoapsis), and the ship on it");
    // the dials
    const yd = 124,
      rd = 15;
    const dial = (cx: number, label: string, value: string, draw: () => void, tipL: string, tip: string) => {
      ctx.save();
      ctx.translate(S(cx), S(yd));
      ctx.strokeStyle = "rgba(111, 210, 255, 0.22)";
      ctx.lineWidth = S(1);
      ctx.beginPath();
      ctx.arc(0, 0, S(rd), 0, 2 * Math.PI);
      ctx.stroke();
      draw();
      ctx.restore();
      small(label, cx, yd + rd + 11, "center");
      ctx.font = `500 ${S(10.5)}px ${MONO}`;
      ctx.fillStyle = "#eef4fb";
      ctx.textAlign = "center";
      ctx.fillText(value, S(cx), S(yd + rd + 23));
      reg(cx - W / 6, yd - rd - 4, W / 3, 2 * rd + 32, tipL, tip);
    };
    const inc = (o.incDeg * Math.PI) / 180;
    dial(
      W / 6,
      "INCL.",
      `${o.incDeg.toFixed(1)}°`,
      () => {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.beginPath();
        ctx.moveTo(S(-rd), 0);
        ctx.lineTo(S(rd), 0);
        ctx.stroke();
        ctx.strokeStyle = "#e07bff";
        ctx.lineWidth = S(2);
        ctx.beginPath();
        ctx.moveTo(S(-Math.cos(inc) * rd), S(Math.sin(inc) * rd));
        ctx.lineTo(S(Math.cos(inc) * rd), S(-Math.sin(inc) * rd));
        ctx.stroke();
      },
      "Inclination",
      "The orbit's tilt to the body's equator (the white line): 0° equatorial, 90° polar",
    );
    dial(
      W / 2,
      "ECC.",
      o.ecc.toFixed(3),
      () => {
        ctx.strokeStyle = "#6fe3a1";
        ctx.lineWidth = S(1.8);
        ctx.beginPath();
        if (o.ecc < 1) {
          const a = rd - 3,
            b = a * Math.sqrt(1 - o.ecc * o.ecc);
          ctx.ellipse(0, 0, S(a), S(b), 0, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.fillStyle = "#6fd2ff";
          ctx.beginPath();
          ctx.arc(S(a * o.ecc), 0, S(2), 0, 2 * Math.PI);
          ctx.fill();
        } else {
          for (let t = -1.2; t <= 1.2; t += 0.05) {
            const x = rd - 4 - (Math.cosh(t) - 1) * 6,
              y = Math.sinh(t) * 6;
            if (t === -1.2) ctx.moveTo(S(x), S(y));
            else ctx.lineTo(S(x), S(y));
          }
          ctx.stroke();
        }
      },
      "Eccentricity",
      "The orbit's shape: 0 a circle, under 1 an ellipse (drawn true), 1 and above an open, escaping path",
    );
    const frac = Number.isFinite(o.period) && o.period > 0 && Number.isFinite(o.tPe) ? 1 - o.tPe / o.period : NaN;
    dial(
      (5 * W) / 6,
      "PERIOD",
      Number.isFinite(o.period) ? fmtS(o.period) : "—",
      () => {
        if (!Number.isFinite(frac)) return;
        ctx.strokeStyle = "#ffc85a";
        ctx.lineWidth = S(2.5);
        ctx.beginPath();
        ctx.arc(0, 0, S(rd), -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI);
        ctx.stroke();
        const a = -Math.PI / 2 + frac * 2 * Math.PI;
        ctx.fillStyle = "#ffc85a";
        ctx.beginPath();
        ctx.arc(S(Math.cos(a) * rd), S(Math.sin(a) * rd), S(3), 0, 2 * Math.PI);
        ctx.fill();
        ctx.font = `700 ${S(8.5)}px ${FONT}`;
        ctx.fillStyle = "rgba(255, 200, 90, 0.9)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.round(frac * 100)}%`, 0, 0);
        ctx.textBaseline = "alphabetic";
      },
      "Period",
      "The time one orbit takes; the ring: the part flown since the last periapsis",
    );
    // the next event
    if (st.next) {
      const n = st.next;
      const hot = n.kind === "impact";
      const txt = `${n.kind === "exit" ? `Leaves ${n.name}` : n.kind === "enter" ? `Enters ${n.name}` : n.kind === "impact" ? `IMPACT · ${n.name}` : "The mouth"} in ${fmtS(n.inS)}`;
      ctx.font = `700 ${S(11)}px ${FONT}`;
      ctx.fillStyle = hot ? "#ff7a5c" : "#ffc85a";
      ctx.textAlign = "left";
      ctx.fillText(`▸ ${txt.toUpperCase()}`, S(2), S(188));
      reg(0, 176, W, 16, "Next", "The next event on the free-fall path");
    }
  }

  /** the altitude tape's full scale [m], eased towards its goal */
  private altMax = 0;
  private altGoal = 0;

  /**
   * Altitude tape near a body (right): a gauge from its ground at the bottom to a round full scale
   * over the height (and the apoapsis, when near) — m, or km —, rescaled smoothly; the periapsis and
   * apoapsis marked (a periapsis under the ground: IMPACT), the column filled to the height, the
   * vertical speed as a bar beside it.
   */
  private bodyAltTape(ctx: CanvasRenderingContext2D, i: Info, x1: number, cy: number, hgt: number, dpr: number) {
    const wdt = 58 * dpr;
    const x0 = x1 - wdt;
    const st = i.status;
    const sf = i.surface;
    // the height [m] and the vertical speed [m/s]: the ground's figures near it, else the orbit's
    const near = !!sf && (!st || st.kerr || !Number.isFinite(st.altKm) || st.altKm < 50);
    const alt = Math.max(0, near ? sf!.alt : st!.altKm * 1e3);
    const vv = near ? sf!.vVert : (st?.vVert ?? 0);
    const o = st?.orbit;
    const pe = o ? o.peKm * 1e3 : NaN,
      ap = o && Number.isFinite(o.apKm) ? o.apKm * 1e3 : NaN;
    const nice = (x: number) => {
      const e = 10 ** Math.floor(Math.log10(x));
      const m = x / e;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
    };
    const need = Math.max(alt, Number.isFinite(ap) && ap < 3 * Math.max(alt, 1) ? ap : 0, 10);
    const goal = nice(need * 1.15);
    if (!(this.altGoal > 0) || need > this.altGoal * 0.9 || need < this.altGoal * 0.3) this.altGoal = goal;
    this.altMax =
      this.altMax > 0 ? Math.exp(Math.log(this.altMax) + (Math.log(this.altGoal) - Math.log(this.altMax)) * 0.18) : this.altGoal;
    const hmax = this.altMax;
    const km = hmax >= 2000;
    const unit = km ? "km" : "m";
    const top = cy - hgt / 2,
      bot = cy + hgt / 2;
    const y = (h: number) => bot - Math.min(Math.max(h / hmax, 0), 1.02) * hgt;
    panelBg(ctx, x0, top, wdt, hgt, dpr);
    // the ground
    ctx.fillStyle = "rgba(150, 105, 60, 0.35)";
    ctx.fillRect(x0, bot - 3 * dpr, wdt, 3 * dpr);
    // the column filled to the height
    const g = ctx.createLinearGradient(0, bot, 0, top);
    g.addColorStop(0, "rgba(111, 210, 255, 0.05)");
    g.addColorStop(1, "rgba(111, 210, 255, 0.32)");
    ctx.fillStyle = g;
    ctx.fillRect(x0 + 2 * dpr, y(alt), 5 * dpr, bot - y(alt));
    // the scale
    const step = nice(hmax / 5);
    ctx.strokeStyle = "rgba(230, 236, 245, 0.55)";
    ctx.fillStyle = "rgba(230, 236, 245, 0.78)";
    ctx.lineWidth = 1 * dpr;
    ctx.font = `${10 * dpr}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fmt = (h: number) => {
      const u = km ? h / 1e3 : h;
      return u >= 100 || Number.isInteger(u) ? Math.round(u).toLocaleString("en") : u.toFixed(1);
    };
    for (let h = 0; h <= hmax * 1.0001; h += step / 2) {
      const major = Math.abs(h / step - Math.round(h / step)) < 1e-6;
      const yy = y(h);
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + (major ? 12 : 6) * dpr, yy);
      ctx.stroke();
      if (major) ctx.fillText(fmt(h), x0 + 15 * dpr, yy);
    }
    // periapsis, apoapsis (a periapsis under the ground: the impact)
    const mark = (h: number, col: string, txt: string) => {
      if (!Number.isFinite(h) || h > hmax * 1.02) return;
      const yy = y(h);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x0 + wdt - 16 * dpr, yy);
      ctx.lineTo(x0 + wdt, yy);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = "right";
      ctx.font = `700 ${10.4 * dpr}px ${FONT}`;
      ctx.fillText(txt, x0 + wdt - 18 * dpr, yy - 6 * dpr);
      ctx.font = `${10 * dpr}px ${MONO}`;
    };
    // (a near-circular orbit: one mark for both)
    const same = Number.isFinite(pe) && Number.isFinite(ap) && pe >= 0 && Math.abs(ap - pe) < hmax * 0.03;
    // (on the ground the orbit's periapsis is deep under it — no impact to warn of, nothing to mark)
    if (Number.isFinite(pe) && !(i.landed || i.surface?.landed))
      mark(Math.max(pe, 0), pe < 0 ? RED : CYAN, pe < 0 ? "IMPACT" : same ? "Pe·Ap" : "Pe");
    if (Number.isFinite(ap) && !same) mark(ap, CYAN, "Ap");
    // the vertical speed: a bar beside the tape, its length on a log scale (±10 km/s at the ends)
    if (Number.isFinite(vv)) {
      const k = Math.sign(vv) * Math.min(1, Math.log10(1 + Math.abs(vv)) / 4);
      const vy = k * (hgt / 2);
      ctx.fillStyle = vv < 0 ? "rgba(255, 150, 90, 0.9)" : "rgba(124, 214, 255, 0.9)";
      ctx.fillRect(x0 - 7 * dpr, Math.min(cy, cy - vy), 3 * dpr, Math.abs(vy));
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.fillRect(x0 - 9 * dpr, cy, 7 * dpr, 1 * dpr);
    }
    const body = near ? (BODY_NAMES[sf!.body as Target] ?? sf!.body) : (st?.soiName ?? "");
    label(ctx, x0, top - 16 * dpr, `ALTITUDE · ${unit}`, near && sf!.landed ? `landed · ${body}` : `above ${body}`, dpr);
    const u = km ? alt / 1e3 : alt;
    const main = u >= 1000 ? Math.round(u).toLocaleString("en") : u >= 100 ? u.toFixed(0) : u.toFixed(1);
    const vtxt = `${vv >= 0 ? "▲" : "▼"} ${Math.abs(vv) >= 1e3 ? `${(Math.abs(vv) / 1e3).toFixed(2)} km/s` : `${Math.abs(vv).toFixed(1)} m/s`}`;
    valueBox(ctx, x0 - 12 * dpr, Math.max(top + 12 * dpr, Math.min(bot - 12 * dpr, y(alt))), main, unit, vtxt, "right", dpr);
  }

  /** Altitude tape (right): r on a log scale with the orbit's landmarks and a vertical-speed bar. */
  private altTape(ctx: CanvasRenderingContext2D, i: Info, x1: number, cy: number, hgt: number, dpr: number) {
    const wdt = 58 * dpr;
    const x0 = x1 - wdt;
    const perDecade = hgt * 0.75;
    const L = Math.log10(i.r);
    const y = (r: number) => cy - (Math.log10(r) - L) * perDecade;
    panelBg(ctx, x0, cy - hgt / 2, wdt, hgt, dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, cy - hgt / 2, wdt, hgt);
    ctx.clip();
    // the horizon: everything below is black
    const yH = y(i.rH);
    if (yH < cy + hgt / 2) {
      ctx.fillStyle = "rgba(255, 60, 40, 0.28)";
      ctx.fillRect(x0, yH, wdt, cy + hgt / 2 - yH);
    }
    ctx.strokeStyle = "rgba(230, 236, 245, 0.55)";
    ctx.fillStyle = "rgba(230, 236, 245, 0.75)";
    ctx.lineWidth = 1 * dpr;
    ctx.font = `${10 * dpr}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const lo = L - hgt / 2 / perDecade,
      hi = L + hgt / 2 / perDecade;
    for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
      for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const rr = m * 10 ** e;
        const yy = y(rr);
        if (yy < cy - hgt / 2 - 5 || yy > cy + hgt / 2 + 5) continue;
        const major = m === 1 || m === 2 || m === 5;
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x0 + (major ? 12 : 6) * dpr, yy);
        ctx.stroke();
        if (major) ctx.fillText(`${rr}`, x0 + 15 * dpr, yy);
      }
    }
    // landmarks
    const mark = (rr: number, col: string, txt: string) => {
      const yy = y(rr);
      if (!Number.isFinite(yy) || yy < cy - hgt / 2 || yy > cy + hgt / 2) return;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x0 + wdt - 16 * dpr, yy);
      ctx.lineTo(x0 + wdt, yy);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = "right";
      ctx.font = `600 ${10.4 * dpr}px ${FONT}`;
      ctx.fillText(txt, x0 + wdt - 18 * dpr, yy - 6 * dpr);
      ctx.textAlign = "left";
      ctx.font = `${10 * dpr}px ${MONO}`;
    };
    mark(i.rH, RED, "HORIZON");
    mark(i.photon, "#ffdc78", "PHOTON");
    mark(i.isco, "#78e696", "ISCO");
    if (this.s.sun) mark(starOrbitRadius(this.s), "#ffd36b", "STAR");
    const p = i.path;
    if (p && p.pts.length > 2) {
      const rs = p.pts.map((q) => Math.hypot(...q));
      mark(Math.min(...rs, i.r), CYAN, "Pe");
      if (p.fate === "continues") mark(Math.max(...rs, i.r), CYAN, "Ap");
    }
    ctx.restore();
    // vertical speed (radial 3-velocity), ±0.1 c over half the tape
    if (Number.isFinite(i.vr)) {
      const vy = Math.max(-1, Math.min(1, i.vr / 0.1)) * (hgt / 2);
      ctx.fillStyle = i.vr < 0 ? "rgba(255, 150, 90, 0.9)" : "rgba(124, 214, 255, 0.9)";
      ctx.fillRect(x0 - 7 * dpr, Math.min(cy, cy - vy), 3 * dpr, Math.abs(vy));
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.fillRect(x0 - 7 * dpr, cy - hgt / 2, 3 * dpr, 1 * dpr);
      ctx.fillRect(x0 - 7 * dpr, cy + hgt / 2, 3 * dpr, 1 * dpr);
    }
    valueBox(ctx, x0 - 12 * dpr, cy, `${i.r.toFixed(2)}`, "M", `v_r ${i.vr >= 0 ? "+" : "−"}${Math.abs(i.vr).toFixed(3)} c`, "right", dpr);
    label(ctx, x0, cy - hgt / 2 - 16 * dpr, "ALTITUDE · M", "r · log", dpr);
  }

  // ------------------------------------------------------------------------------------ telemetry sparklines
  private drawTelemetry() {
    const c = this.telCanvas;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 250) * dpr),
      ch = Math.round((c.clientHeight || 150) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    const S = this.samples;
    if (S.length < 2) return;
    const w1 = S[S.length - 1]!.w;
    const si = S[S.length - 1]!.si;
    const rows: [keyof Sample, string, string, (v: number) => string][] = [
      [
        "speed",
        "SPEED",
        "#d6f55b",
        (v) => (si ? (v >= 1e4 ? `${(v / 1e3).toFixed(2)} km/s` : `${v.toFixed(1)} m/s`) : `${v.toFixed(3)} c`),
      ],
      [
        "r",
        "ALT",
        CYAN,
        (v) => (si ? (Math.abs(v) >= 1e4 ? `${Math.round(v).toLocaleString("en")} km` : `${v.toFixed(1)} km`) : `${v.toFixed(1)} M`),
      ],
      ["dtau", "dτ/dt", "#e07bff", (v) => v.toFixed(4)],
      ["g", "THRUST", AMBER, (v) => fmtG(v)],
    ];
    const rh = ch / rows.length;
    rows.forEach(([key, name, col, fmt], j) => {
      const y0 = j * rh;
      const vals = S.map((q) => q[key] as number).filter(Number.isFinite);
      if (!vals.length) return;
      let lo = Math.min(...vals),
        hi = Math.max(...vals);
      if (hi - lo < 1e-9) (lo -= 0.5 * Math.abs(lo) * 0.01 + 1e-6), (hi += 0.5 * Math.abs(hi) * 0.01 + 1e-6);
      const pad = (hi - lo) * 0.15;
      lo -= pad;
      hi += pad;
      const X = (w: number) => 56 * dpr + ((w - (w1 - 60)) / 60) * (cw - 62 * dpr);
      const Y = (v: number) => y0 + rh - 5 * dpr - ((v - lo) / (hi - lo)) * (rh - 12 * dpr);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(56 * dpr, y0 + rh - 1 * dpr);
      ctx.lineTo(cw, y0 + rh - 1 * dpr);
      ctx.stroke();
      // area + line
      const g = ctx.createLinearGradient(0, y0, 0, y0 + rh);
      g.addColorStop(0, hexA(col, 0.28));
      g.addColorStop(1, hexA(col, 0));
      ctx.beginPath();
      let started = false;
      for (const q of S) {
        const v = q[key] as number;
        if (!Number.isFinite(v)) continue;
        if (!started) ctx.moveTo(X(q.w), Y(v)), (started = true);
        else ctx.lineTo(X(q.w), Y(v));
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.lineTo(X(w1), y0 + rh - 1 * dpr);
      ctx.lineTo(X(S[0]!.w), y0 + rh - 1 * dpr);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = "rgba(200, 208, 222, 0.6)";
      ctx.font = `600 ${10.4 * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(name, 2 * dpr, y0 + 4 * dpr);
      ctx.fillStyle = "#fff";
      ctx.font = `500 ${10 * dpr}px ${MONO}`;
      ctx.fillText(fmt(vals[vals.length - 1]!), 2 * dpr, y0 + 16 * dpr);
    });
  }

  // ------------------------------------------------------------------------------------ effective potential
  /**
   * Kerr geodesic, radial equation: (Σ dr/dτ)² = R(r) = [E(r² + a²) − aL]² − Δ[r² + (L − aE)² + Q].
   * V(r): the energy at which r is a turning point (R = 0, future branch) for the ship's L and Q;
   * the ship moves where E ≥ V(r).
   */
  private drawPotential(i: Info) {
    const c = this.veff;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 290) * dpr),
      ch = Math.round((c.clientHeight || 120) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    // (the plot inset from the figures written in its corners)
    const pad = { t: 30 * dpr, b: 30 * dpr };
    ctx.save();
    ctx.translate(0, pad.t);
    const chP = ch - pad.t - pad.b;
    if (i.status?.orbit && !i.status.kerr) this.drawKepler(ctx, cw, chP, i.status);
    else if (i.region === "hole" && Number.isFinite(i.E)) this.drawWell(ctx, cw, chP, i);
    ctx.restore();
    this.drawOrbitText(ctx, cw, ch);
  }

  /** The orbit's figures in the plot's corners: what it is, the course; periapsis, apoapsis; the rest. */
  private drawOrbitText(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
    const dpr = devicePixelRatio;
    const S = (v: number) => v * dpr;
    const O = this.orbitEls;
    const txt = (k: string) => O[k]?.textContent ?? "";
    const m = S(8);
    // (a soft vignette under the corners' text)
    const vg = ctx.createLinearGradient(0, 0, 0, ch);
    vg.addColorStop(0, "rgba(6, 10, 18, 0.55)");
    vg.addColorStop(0.2, "rgba(6, 10, 18, 0)");
    vg.addColorStop(0.8, "rgba(6, 10, 18, 0)");
    vg.addColorStop(1, "rgba(6, 10, 18, 0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.textBaseline = "top";
    // the title: what it shows; its inclination and eccentricity (or E and L) under it
    const head = (this.orbitHead?.textContent ?? "Orbit").toUpperCase();
    const k = head.indexOf(" · ");
    ctx.textAlign = "left";
    ctx.font = `700 ${S(9.5)}px ${FONT}`;
    ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
    ctx.fillText(k > 0 ? head.slice(0, k) : head, m, m);
    if (k > 0) {
      ctx.font = `700 ${S(13)}px ${FONT}`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(head.slice(k + 3), m, m + S(11));
    }
    ctx.font = `500 ${S(10)}px ${MONO}`;
    ctx.fillStyle = "rgba(214, 226, 242, 0.7)";
    ctx.fillText(txt("el"), m, m + S(k > 0 ? 27 : 12));
    // the course: a badge in its colour
    const course = txt("course").toUpperCase();
    const hot = O.course?.classList.contains("hot");
    const inOrbit = /ORBIT|BOUND/.test(course);
    const c = hot ? "255, 90, 70" : inOrbit ? "111, 227, 161" : "255, 179, 92";
    ctx.font = `700 ${S(10.5)}px ${FONT}`;
    const tw = ctx.measureText(course).width;
    const bx = cw - m - tw - S(12),
      by = m - S(1);
    ctx.fillStyle = `rgba(${c}, 0.18)`;
    ctx.fillRect(bx, by, tw + S(12), S(16));
    ctx.fillStyle = `rgb(${c})`;
    ctx.fillRect(bx, by, S(2), S(16));
    ctx.textAlign = "right";
    ctx.fillText(course, cw - m - S(4), m + S(2));
    // periapsis and apoapsis: the height in figures, when in small
    const split = (t: string): [string, string] => {
      const j = t.indexOf(" · ");
      return j < 0 ? [t, ""] : [t.slice(0, j), t.slice(j + 3)];
    };
    const [pe, peT] = split(txt("pe")),
      [ap, apT] = split(txt("ap"));
    ctx.textBaseline = "bottom";
    const corner = (lbl: string, t: string, v: string, x: number, align: CanvasTextAlign) => {
      ctx.textAlign = align;
      ctx.font = `700 ${S(9.5)}px ${FONT}`;
      ctx.fillStyle = "rgba(176, 196, 222, 0.6)";
      ctx.fillText(t ? `${lbl} · ${t.toUpperCase()}` : lbl, x, ch - m - S(14));
      ctx.font = `500 ${S(11.5)}px ${MONO}`;
      ctx.fillStyle = "#eef4fb";
      ctx.fillText(v, x, ch - m);
    };
    corner("PE", peT, pe, m, "left");
    corner("AP", apT, ap, cw - m, "right");
  }

  /** The effective potential of the ship's Kerr orbit (L, Q): the well, the energy line, the ship. */
  private drawWell(ctx: CanvasRenderingContext2D, cw: number, ch: number, i: Info) {
    const dpr = devicePixelRatio;
    const a = i.spin,
      L = i.L,
      Q = i.Q,
      E = i.E;
    const V = (r: number) => {
      const r2 = r * r,
        a2 = a * a;
      const del = r2 - 2 * r + a2;
      const A = (r2 + a2) ** 2 - del * a2;
      const B = -4 * a * L * r;
      const C = a2 * L * L - del * (r2 + Q + L * L);
      const disc = B * B - 4 * A * C;
      return disc < 0 ? NaN : (-B + Math.sqrt(disc)) / (2 * A);
    };
    const r0 = i.rH * 1.02;
    const rMax = Math.max(i.r * 2.5, 40);
    const lx0 = Math.log(r0),
      lx1 = Math.log(rMax);
    const X = (r: number) => 30 * dpr + ((Math.log(r) - lx0) / (lx1 - lx0)) * (cw - 36 * dpr);
    const n = 160;
    const pts: [number, number][] = [];
    for (let j = 0; j <= n; j++) {
      const r = Math.exp(lx0 + ((lx1 - lx0) * j) / n);
      pts.push([r, V(r)]);
    }
    // the well: from the potential's minimum (outside the photon orbit) to the escape line and E
    const outer = pts.filter(([r, v]) => r > i.photon * 1.05 && Number.isFinite(v)).map((p) => p[1]);
    const vmin = outer.length ? Math.min(...outer) : E - 0.05;
    let lo = Math.min(vmin, E),
      hi = Math.max(E, 1);
    const span = Math.min(Math.max(hi - lo, 0.02), 0.35);
    lo -= span * 0.25;
    hi = lo + span * 1.5;
    const Y = (v: number) => ch - 16 * dpr - ((v - lo) / (hi - lo)) * (ch - 24 * dpr);
    const yc = (v: number) => Y(Math.min(Math.max(v, lo - span), hi + span));
    // the allowed region (V ≤ E): between the curve and the energy line, where the ship can move
    const g = ctx.createLinearGradient(0, Y(E), 0, Y(lo));
    g.addColorStop(0, "rgba(124, 214, 255, 0.28)");
    g.addColorStop(1, "rgba(124, 214, 255, 0.02)");
    ctx.fillStyle = g;
    let open = false;
    ctx.beginPath();
    for (const [r, v] of pts) {
      const xx = X(r);
      if (Number.isFinite(v) && v < E) {
        if (!open) ctx.moveTo(xx, Y(E)), (open = true);
        ctx.lineTo(xx, yc(v));
      } else if (open) {
        ctx.lineTo(xx, Y(E));
        ctx.closePath();
        open = false;
      }
    }
    if (open) ctx.lineTo(X(rMax), Y(E)), ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    let pen = false;
    for (const [r, v] of pts) {
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const yy = yc(v);
      if (!pen) ctx.moveTo(X(r), yy), (pen = true);
      else ctx.lineTo(X(r), yy);
    }
    // (its glow: the same path wide and faint first)
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(200, 225, 255, 0.12)";
    ctx.lineWidth = 6 * dpr;
    ctx.stroke();
    ctx.strokeStyle = "rgba(230, 236, 245, 0.9)";
    ctx.lineWidth = 1.6 * dpr;
    ctx.stroke();
    if (1 > lo && 1 < hi) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(X(r0), Y(1));
      ctx.lineTo(X(rMax), Y(1));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = `600 ${10.4 * dpr}px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText("E = 1 · escape", cw - 4 * dpr, Y(1) - 8 * dpr);
    }
    ctx.beginPath();
    ctx.moveTo(X(r0), Y(E));
    ctx.lineTo(X(rMax), Y(E));
    ctx.strokeStyle = "rgba(124, 214, 255, 0.16)";
    ctx.lineWidth = 7 * dpr;
    ctx.stroke();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.8 * dpr;
    ctx.stroke();
    // landmarks on the axis, the ship
    ctx.font = `600 ${9.8 * dpr}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const [rr, txt, col] of [
      [i.photon, "γ", "#ffdc78"],
      [i.isco, "ISCO", "#78e696"],
    ] as const) {
      ctx.fillStyle = col;
      ctx.fillRect(X(rr) - 0.5 * dpr, ch - 26 * dpr, 1 * dpr, 5 * dpr);
      ctx.fillText(txt, X(rr), ch - 20 * dpr);
    }
    const sx = X(i.r),
      sy = Y(E);
    halo(ctx, sx, sy, 13 * dpr, "255, 200, 90", 0.5);
    ctx.fillStyle = "#ffc85a";
    ctx.beginPath();
    ctx.arc(sx, sy, 4 * dpr, 0, 2 * Math.PI);
    ctx.fill();
    // which way it moves along r
    if (Number.isFinite(i.vr) && Math.abs(i.vr) > 1e-4) {
      ctx.strokeStyle = "#ffc85a";
      ctx.lineWidth = 1.6 * dpr;
      const d = Math.sign(i.vr) * 12 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx + Math.sign(d) * 6 * dpr, sy);
      ctx.lineTo(sx + d + Math.sign(d) * 6 * dpr, sy);
      ctx.lineTo(sx + d + Math.sign(d) * 2 * dpr, sy - 3 * dpr);
      ctx.moveTo(sx + d + Math.sign(d) * 6 * dpr, sy);
      ctx.lineTo(sx + d + Math.sign(d) * 2 * dpr, sy + 3 * dpr);
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------------------------ attitude ball + arcs
  private drawBall(i: Info) {
    const c = this.ball;
    // (per-pixel sky/ground in JS: capped at 1.5× CSS resolution, redrawn 20 times a second)
    const dpr = Math.min(devicePixelRatio, 1.5);
    const size = Math.round(176 * dpr);
    if (c.width !== size) (c.width = size), (c.height = size);
    const ctx = c.getContext("2d")!;
    const C0 = size / 2;
    const R0 = size / 2 - 16 * dpr;
    const S = i.S;
    const body = (d: V3): V3 => [
      S[0][0] * d[0] + S[1][0] * d[1] + S[2][0] * d[2],
      S[0][1] * d[0] + S[1][1] * d[1] + S[2][1] * d[2],
      S[0][2] * d[0] + S[1][2] * d[1] + S[2][2] * d[2],
    ];
    if (!this.ballImg || this.ballImg.width !== size) this.ballImg = ctx.createImageData(size, size);
    const img = this.ballImg;
    const up = i.dirs.radialOut ? body(i.dirs.radialOut) : null;
    const px = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5 - C0) / R0,
          v = (C0 - y - 0.5) / R0;
        const q = u * u + v * v;
        const o = (y * size + x) * 4;
        if (q > 1) {
          px[o + 3] = 0;
          continue;
        }
        const d: V3 = [-u, v, Math.sqrt(1 - q)];
        let col: [number, number, number] = [28, 34, 44];
        if (up) {
          const e = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
          col = e > 0 ? [34, 88, 150] : [92, 60, 34];
          const lat = Math.asin(Math.max(-1, Math.min(1, e))) / (Math.PI / 6);
          if (Math.abs(lat - Math.round(lat)) < 0.035 / Math.max(Math.sqrt(1 - q), 0.2))
            col = Math.round(lat) === 0 ? [255, 255, 255] : [200, 206, 218];
        }
        const shade = 0.45 + 0.55 * Math.sqrt(1 - q);
        px[o] = col[0] * shade;
        px[o + 1] = col[1] * shade;
        px[o + 2] = col[2] * shade;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const Ra = R0 + 9 * dpr;
    const arcGauge = (a0: number, a1: number, t: number, c0: string, c1: string, ccw: boolean) => {
      ctx.lineCap = "butt";
      ctx.lineWidth = 6 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.beginPath();
      ctx.arc(C0, C0, Ra, Math.min(a0, a1), Math.max(a0, a1));
      ctx.stroke();
      // ticks every 10 %
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      for (let j = 0; j <= 10; j++) {
        const a = a0 + ((a1 - a0) * j) / 10;
        const r1 = Ra + (j % 5 === 0 ? 6 : 4) * dpr;
        ctx.beginPath();
        ctx.moveTo(C0 + Math.cos(a) * (Ra + 3 * dpr), C0 + Math.sin(a) * (Ra + 3 * dpr));
        ctx.lineTo(C0 + Math.cos(a) * r1, C0 + Math.sin(a) * r1);
        ctx.stroke();
      }
      if (t > 0.001) {
        const g = ctx.createLinearGradient(0, size, 0, 0);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ctx.strokeStyle = g;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.arc(C0, C0, Ra, a0, a0 + (a1 - a0) * t, ccw);
        ctx.stroke();
      }
    };
    // left: throttle (bottom → top), right: g-load relative to the engine's full thrust
    const t = Math.max(0, Math.min(1, i.throttle));
    arcGauge(Math.PI * 0.64, Math.PI * 1.36, t, "#ff6a2c", "#ffd27a", false);
    const gl = Math.max(0, Math.min(1, i.accel / Math.max(i.engine.max, 1e-12)));
    arcGauge(Math.PI * 0.36, -Math.PI * 0.36, gl, "#3b8cff", "#9fe3ff", true);
    // (the throttle, the g-load, the engine and the tank: the readout above the ball)
    const gUnit = 2.99792458e8 ** 2 / (1476.625 * this.s.massSolar) / G0;
    const fu = i.engine.fuel;
    const R = this.ballRead;
    if (R) {
      R.thr.textContent = `${Math.round(t * 100)}%${i.precision ? " FINE" : ""}`;
      R.g.textContent = i.accel > 0 ? fmtG(i.accel * gUnit) : "0 g";
      R.eng.textContent = `${i.engine.kind === "crew" ? "CREW" : "CINEMA"} ${fmtG(i.engine.max * gUnit)}${fu ? ` · ${fu.empty ? "TANK EMPTY" : `PROP ${Math.round(fu.fraction * 100)}%`}` : ""}`;
      R.eng.classList.toggle("hot", !!fu && (fu.empty || fu.fraction < 0.15));
    }
    // rotation rates: short bars (pitch right side, yaw bottom)
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(255, 200, 90, 0.9)";
    const w = i.omega;
    const bar = (mid: number, v: number) => {
      const k = Math.max(-1, Math.min(1, v / 0.75)) * 0.4;
      if (Math.abs(k) < 0.01) return;
      ctx.beginPath();
      ctx.arc(C0, C0, R0 - 3 * dpr, Math.min(mid, mid + k), Math.max(mid, mid + k));
      ctx.stroke();
    };
    bar(0, w[0]);
    bar(Math.PI / 2, -w[1]);
    // orbital markers
    const r = 8 * dpr;
    ctx.lineWidth = 1.8 * dpr;
    for (const k of [
      "prograde",
      "retrograde",
      "radialOut",
      "radialIn",
      "normal",
      "antinormal",
      "target",
      "burn",
      "maneuver",
      "tgtPrograde",
    ] as const) {
      if (k === "maneuver" && i.dirs.burn) continue;
      const dd = i.dirs[k];
      if (!dd) continue;
      const b = body(dd);
      let x = -b[0],
        y = b[1];
      let alpha = 1;
      if (b[2] < 0) {
        const l = Math.hypot(x, y) || 1;
        (x /= l), (y /= l), (alpha = 0.4);
      }
      ctx.globalAlpha = alpha;
      marker(ctx, GLYPH[k]!, C0 + x * (R0 - r), C0 - y * (R0 - r), r, COL[k]!);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffc85a";
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(C0 - 18 * dpr, C0);
    ctx.lineTo(C0 - 7 * dpr, C0);
    ctx.lineTo(C0, C0 + 6 * dpr);
    ctx.lineTo(C0 + 7 * dpr, C0);
    ctx.lineTo(C0 + 18 * dpr, C0);
    ctx.stroke();
  }

  // ------------------------------------------------------------------------------------ map
}

// ------------------------------------------------------------------------------------ drawing helpers

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * A glow round a point: a radial gradient (rgb "r, g, b"). Never the canvas's shadowBlur — a
 * Gaussian blur the GPU runs per draw, every frame, beside the tracer (240 of them halved the frame rate).
 */
function halo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb}, ${a})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

/** A tape's background: a vertical gradient that fades at both ends, corner brackets. */
function panelBg(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dpr: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(8, 12, 20, 0)");
  g.addColorStop(0.18, "rgba(8, 12, 20, 0.5)");
  g.addColorStop(0.82, "rgba(8, 12, 20, 0.5)");
  g.addColorStop(1, "rgba(8, 12, 20, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(124, 214, 255, 0.35)";
  ctx.lineWidth = 1 * dpr;
  const c = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, y + c);
  ctx.lineTo(x, y);
  ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - c);
  ctx.stroke();
}

/** The current value of a tape: a pointer box with a big number, its unit and a sub-line. */
/** A Δv given in c, as a pilot reads it: m/s, km/s — c only when relativistic. */
function fmtDvC(c: number) {
  const ms = c * C_MPS;
  if (c >= 0.01) return `${c.toFixed(3)} c`;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} km/s` : `${ms.toFixed(ms < 10 ? 1 : 0)} m/s`;
}

function valueBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  value: string,
  unit: string,
  sub2: string,
  side: "left" | "right",
  dpr: number,
) {
  // (as wide as the figures and the unit, side by side: they overlapped when the unit was km/s)
  ctx.font = `600 ${12.2 * dpr}px ${FONT}`;
  const uw = ctx.measureText(unit).width;
  ctx.font = `600 ${17 * dpr}px ${MONO}`;
  const w = ctx.measureText(value).width + uw + 22 * dpr;
  const hgt = 24 * dpr;
  const x0 = side === "left" ? x : x - w;
  const tip = side === "left" ? x0 - 7 * dpr : x0 + w + 7 * dpr;
  ctx.fillStyle = "rgba(6, 10, 18, 0.82)";
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.4 * dpr;
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(tip, cy);
    ctx.lineTo(x0, cy - hgt / 2);
    ctx.lineTo(x0 + w, cy - hgt / 2);
    ctx.lineTo(x0 + w, cy + hgt / 2);
    ctx.lineTo(x0, cy + hgt / 2);
  } else {
    ctx.moveTo(tip, cy);
    ctx.lineTo(x0 + w, cy - hgt / 2);
    ctx.lineTo(x0, cy - hgt / 2);
    ctx.lineTo(x0, cy + hgt / 2);
    ctx.lineTo(x0 + w, cy + hgt / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x0 + 8 * dpr, cy + 1 * dpr);
  ctx.fillStyle = AMBER;
  ctx.font = `600 ${12.2 * dpr}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(unit, x0 + w - 7 * dpr, cy + 1 * dpr);
  ctx.fillStyle = "rgba(220, 228, 240, 0.75)";
  ctx.font = `${10 * dpr}px ${MONO}`;
  ctx.textAlign = side === "left" ? "left" : "right";
  ctx.fillText(sub2, side === "left" ? x0 : x0 + w, cy + hgt / 2 + 10 * dpr);
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, sub2: string, dpr: number) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = AMBER;
  ctx.font = `700 ${11.6 * dpr}px ${FONT}`;
  ctx.fillText(title, x, y - 10 * dpr);
  ctx.fillStyle = "rgba(200, 208, 222, 0.55)";
  ctx.font = `600 ${10.4 * dpr}px ${FONT}`;
  ctx.fillText(sub2, x, y);
}

/** The marker's glyph as a small SVG, for the buttons. */
function glyphSvg(kind: string, col: string) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-12 -12 24 24");
  svg.setAttribute("class", "fl-glyph");
  const d =
    kind === "prograde"
      ? "M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M0 -5V-10M-5 0H-10M5 0H10"
      : kind === "retrograde"
        ? "M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5"
        : kind === "target"
          ? "M-6 -6H6V6H-6Z"
          : "M-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M-4 0H4M0 -4V4";
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", col);
  p.setAttribute("stroke-width", "2");
  svg.append(p);
  return svg;
}

function fmtG(g: number) {
  return g >= 1e4 ? `${g.toExponential(1)} g` : g >= 100 ? `${g.toFixed(0)} g` : `${g.toPrecision(3)} g`;
}

/** A coordinate time in M, with its duration for the chosen mass. */
function fmtM(t: number, s: Settings) {
  const sec = t * 4.925490947e-6 * s.massSolar;
  const d =
    sec < 120
      ? `${sec.toFixed(0)} s`
      : sec < 7200
        ? `${(sec / 60).toFixed(0)} min`
        : sec < 172800
          ? `${(sec / 3600).toFixed(1)} h`
          : `${(sec / 86400).toFixed(1)} d`;
  return `${t.toFixed(0)} M (${d})`;
}

/** A clock: elapsed time for the chosen mass, as d hh:mm:ss. */
function fmtClock(tM: number, s: Settings) {
  const sec = Math.max(0, tM * 4.925490947e-6 * s.massSolar);
  // (years for long flights: Julian years)
  if (sec >= 365.25 * 86400) {
    const y = Math.floor(sec / (365.25 * 86400));
    return `${y}y ${Math.floor((sec - y * 365.25 * 86400) / 86400)}d`;
  }
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = Math.floor(sec % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${p(hh)}:${p(mm)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
}
