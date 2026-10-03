// The map, in 3D: where the bodies and the ship really are, their orbits and the planned paths, seen
// from a camera that orbits a chosen focus (a body, the ship) with its angles measured in a chosen
// reference plane — the system's (the ecliptic; the hole's equator), the focus body's equator, the
// ship's orbit, the target's. Canvas 2D over a pinhole projection (float64), drawn back to front:
// the plane's grid, the orbits (dimmed where a body hides them), the bodies as lit spheres (Saturn's
// rings in front and behind), the paths, their apsides, crossings of the plane (AN / DN), closest
// approaches and nodes (with their handles, as before), stems down to the plane, labels kept apart.
//
// Gestures: drag turns the view, right-drag / ⇧-drag pans, the wheel zooms towards the pointer, a
// click targets a body (or adds a node on the path), a double click centres a body (on nothing: back
// to the automatic view). The bar: the focus (breadcrumb and list), the plane, the view (top, 3D,
// edge-on), log scale, fit, the frame (theirs), the full-screen map.

import type { Settings } from "../../settings";
import { solarBody, solarState } from "../../system/solar";
import { nodeDvHome, ourApsides, ourClosest, type OurPath } from "../../system/our-predict";
import { bodyCentre, BODY_NAMES, starCentre, type Body } from "../../targeting";
import type { Target } from "../../settings";
import { FONT, fmtDist, fmtDur, fmtDv, fmtLen, fmtShort, marker, MONO, niceStep, RED } from "../hudkit";
import { MapCamera, add, cross, dot, len, norm, planeBasis, scale, sub, type V3 } from "./camera";
import { bodyPosAt, dateOf, lineage, ourPos, ourScene, ourTrack, theirScene, type MapBody, type MapScene, type Universe } from "./scene";
import type { Info } from "../flighthud";
import { extensionHorizon, type Extension } from "../../system/our-extend";
import { extendTheirs } from "../../system/their-extend";
import { plan as planJob } from "../../system/plan-client";
import { Paint } from "./paint";
import { BodyKind, MapGpu, type GpuBody, type MapTextures } from "./gpu";
import { bodyAxes, MAPS_HI, MAPS_LO } from "../../system/solar";
import { store } from "../../util/storage";
import { el as h } from "../kit";
import { t, tf, tr } from "../../i18n";
import { longPress, Pinch, reach } from "../pinch";

export interface MapHost {
  readonly s: Settings;
  act: {
    select(id: string): void;
    addNodeAt(t: number): void;
    nudge(k: number, dv: V3, dt: number): void;
    deleteNode(k: number): void;
  };
  /** the selected node (shared with the planner's rows) */
  sel: number;
  /** the ship's recent track (theirs) */
  trail(): { X: V3; t: number }[];
  closestApproach(i: Info, t0: number): { d: number; t: number } | null;
  /** the map over the whole screen */
  mapView(): boolean;
  toggleMapView(): void;
  /** the panels over the map's edges (full screen) [CSS px]: what it is centred and framed without */
  insets?(): { l: number; r: number; t: number; b: number };
  /** the tracer's GPU and maps (the bodies drawn textured on it), when there is one */
  gpu?(): { device: GPUDevice; textures(): MapTextures | null } | null;
}

type PlaneMode = "system" | "equator" | "orbit" | "target";
/** An event on the timeline: its time (scene time), what it is, its name. */
/**
 * A label on the map: where it goes first (x, y: its baseline's left end [px]); what it names (the anchor
 * — a body's centre, a path's apsis — and how far round it the label keeps: then it may move round it,
 * to the other side, above, below, when the first place is taken); its colour (an "r, g, b"), its
 * priority (≥ 4 always drawn, the others only where they fit), its size [CSS px] and weight.
 */
interface MapLabel {
  text: string;
  x: number;
  y: number;
  col: string;
  prio: number;
  size: number;
  weight: number;
  ax?: number;
  ay?: number;
  ar?: number;
}

interface Mark {
  t: number;
  kind: "node" | "ca" | "soi" | "pe" | "ap" | "arrive" | "impact" | "cand";
  label: string;
}
const MARK_COL: Record<Mark["kind"], string> = {
  node: "#5ad8ff",
  ca: "#ff8a5c",
  soi: "#c88cff",
  pe: "#9fe3ff",
  ap: "#9fe3ff",
  arrive: "#ffaa50",
  impact: "#ff5a46",
  cand: "#c48cff",
};
type Proj = { x: number; y: number; z: number; k: number; ok: boolean };

const PLANES: { id: PlaneMode; label: string; short: string; title: string }[] = [
  {
    id: "system",
    label: t("System"),
    short: t("Sys"),
    title: t("The system's plane: the ecliptic (the solar system), the hole's equator (Gargantua's)"),
  },
  { id: "equator", label: t("Equator"), short: t("Eq"), title: t("The focus body's equator") },
  { id: "orbit", label: t("Orbit"), short: t("Orb"), title: t("The ship's orbital plane (around its primary)") },
  { id: "target", label: t("Target"), short: t("Tgt"), title: t("The target's orbital plane (around its primary)") },
];

/** a body's kind, as the focus menu says it */
const KIND_NOTE: Record<MapBody["kind"], string> = {
  star: t("star"),
  planet: t("planet"),
  moon: t("moon"),
  hole: t("hole"),
  mouth: t("mouth"),
};

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** the flight computer's preview (rgb) */
const CAND = "196, 140, 255";

export class Map3D {
  readonly canvas = h("canvas", "fl-map");
  /** the marks: on the GPU when the map has its layer, else on the canvas */
  private paint = new Paint(this.canvas.getContext("2d")!);
  /** the bodies on the GPU, under the canvas (null: none — the canvas draws them) */
  private gpu: MapGpu | null = null;
  private gpuTried = false;
  readonly bar = h("div", "fl-mapbar m3-bar");
  readonly stage = h("div", "m3-stage");
  private crumbs = h("div", "m3-crumbs");
  private menu = h("div", "m3-menu");
  private menuList = h("div", "m3-list");
  private menuSearch = h("input", "m3-search") as HTMLInputElement;
  private focusBtn = h("button", "m3-focus") as HTMLButtonElement;
  private btns: Record<string, HTMLButtonElement> = {};
  private cam = new MapCamera();
  /** the view moved off its focus by a pan or a zoom towards the pointer (kept: the focus is set again
   * every frame) — back to 0 with a new focus or a fit */
  private panOff: V3 = [0, 0, 0];
  /** A gesture that moves the focus (a pan, a zoom about the pointer): its shift kept in panOff. */
  private shifting(f: () => void) {
    const before = this.cam.goal.focus;
    f();
    this.panOff = add(this.panOff, sub(this.cam.goal.focus, before));
  }
  /** where the view is going (its distance, its angles): what the gestures set */
  get view() {
    const g = this.cam.goal;
    return { dist: g.dist, yaw: g.yaw, pitch: g.pitch, focus: [...g.focus] };
  }
  private scene: MapScene | null = null;
  private universe: Universe | null = null;
  /** the focus: a body's id, "ship", or null (automatic: the ship's primary) */
  private focus: string | null = null;
  private plane: PlaneMode = "system";
  private logOurs = false;
  private logTheirs: boolean | null = null;
  private frame: "cm" | "hole" = "cm";
  /** the camera's distance follows the content until the user zooms */
  private autoDist = true;
  private lastWall = performance.now();
  private moving = false;
  // hits (device pixels): bodies, the paths' points, the nodes, the selected node's handles
  private bodyHits: { id: string; x: number; y: number; r: number }[] = [];
  private pathHits: { x: number; y: number; t: number }[] = [];
  private nodeHits: { k: number; x: number; y: number }[] = [];
  private handleHits: { k: number; c: number; sign: number; x: number; y: number; dir: [number, number] }[] = [];
  private gizmo: {
    k: number;
    c: number;
    sign: number;
    dir: [number, number];
    x0: number;
    y0: number;
    x: number;
    y: number;
    at: number;
  } | null = null;
  private nodeDrag: { k: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private lastInfo: Info | null = null;
  /** per predicted path (they are replaced a few times a second): its points relative to the frame's body, its apsides and closest approaches */
  private relCache = new WeakMap<OurPath, { frame: string; pts: V3[] }>();
  private pathMemo = new WeakMap<OurPath, Map<string, unknown>>();
  // the timeline: the preview's offset from now and the span shown [M of scene time] (span 0:
  // automatic — the predicted paths' reach), playing it, its elements
  private preview = 0;
  private span = 0;
  private playing = false;
  private tl!: {
    root: HTMLElement;
    play: HTMLButtonElement;
    track: HTMLElement;
    fill: HTMLElement;
    handle: HTMLElement;
    marks: HTMLElement;
    label: HTMLElement;
    now: HTMLButtonElement;
  };
  private tlKey = "";
  private tlMarks: Mark[] = [];
  private tlSpan = 1;
  private tlT0 = 0;
  // beyond the predicted path (our side): patched conics computed in the planner's worker — the
  // latest one, the path it continues, a request in flight
  private ext: Extension | null = null;
  private extSrc: OurPath | null = null;
  private extBusy = false;
  /** Gargantua's side: the conics (computed here — a few analytic orbits), where the path they continue ended, when */
  private theirExt: { ext: Extension; end: number; X: V3; at: number } | null = null;
  // the warp of the log scale: its centre (the camera's focus) and its scale length
  private log = false;
  private W: V3 = [0, 0, 0];
  private r0 = 1;

  constructor(private host: MapHost) {
    this.legend.hidden = true;
    this.legend.hidden = store.get("kerr.map-legend") !== "1";
    this.legend.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.stage.append(this.canvas, this.crumbs, this.menu, this.legend);
    this.buildTimeline();
    this.buildBar();
    this.buildMenu();
    this.bindPointer();
    this.cam.resize(300, 250);
  }

  /** The camera still moves (the HUD then draws the map at the display's rate). */
  get animating() {
    return this.moving || !!this.gizmo || this.playing;
  }
  /** when the pointer last moved the view (a drag, the wheel) [performance.now] */
  private handledAt = -1e9;
  /**
   * Easing a move the pointer made (or a gizmo, the timeline playing) — not the camera's own following
   * of the ship and the paths, which never quite rests: the mini-map, drawn on its own schedule
   * otherwise, is drawn every frame only then.
   */
  get eased() {
    return (this.moving && performance.now() - this.handledAt < 2000) || !!this.gizmo || this.playing;
  }

  // ------------------------------------------------------------------------------------ the timeline
  private buildTimeline() {
    const root = h("div", "m3-time");
    const play = h("button", "m3-play", "▶") as HTMLButtonElement;
    play.title = t("Play the preview: the bodies and the ship move on along their paths");
    play.onclick = () => {
      if (this.preview >= this.tlSpan * 0.999) this.preview = 0;
      this.playing = !this.playing;
    };
    const track = h("div", "m3-track");
    const fill = h("i", "m3-fill");
    const marks = h("div", "m3-marks");
    const handle = h("b", "m3-handle");
    track.append(fill, marks, handle);
    track.title = t("Drag: the positions at that time · wheel: a longer or shorter span · a mark: jump to it");
    const label = h("span", "m3-tlabel", t("Now"));
    const now = h("button", "m3-now", t("Now")) as HTMLButtonElement;
    now.title = t("Back to the present");
    now.onclick = () => {
      this.preview = 0;
      this.playing = false;
    };
    root.append(play, track, label, now);
    this.tl = { root, play, track, fill, handle, marks, label, now };
    this.stage.append(root);
    let dragging = false;
    const setFrom = (clientX: number) => {
      const r = track.getBoundingClientRect();
      const f = clamp((clientX - r.left) / Math.max(r.width, 1), 0, 1);
      let dt = f * this.tlSpan;
      // (a mark within 6 px: onto it)
      for (const m of this.tlMarks) {
        const x = ((m.t - this.tlT0) / this.tlSpan) * r.width;
        if (Math.abs(x - (clientX - r.left)) < 6) dt = m.t - this.tlT0;
      }
      this.preview = dt;
      this.playing = false;
    };
    track.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      track.setPointerCapture(e.pointerId);
      dragging = true;
      setFrom(e.clientX);
    });
    track.addEventListener("pointermove", (e) => dragging && setFrom(e.clientX));
    track.addEventListener("pointerup", () => (dragging = false));
    track.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        // (the span, ×/÷ with the wheel; the preview keeps its time)
        this.span = clamp(this.tlSpan * Math.exp(e.deltaY * 0.002), 0.5, 1e8);
      },
      { passive: false },
    );
    for (const ev of ["pointerdown", "dblclick", "contextmenu"]) root.addEventListener(ev, (e) => e.stopPropagation());
  }

  /** The path the preview continues: the plan once it has nodes, else the free fall. */
  private extSource(i: Info): OurPath | null {
    return i.ourPlan && i.ourPlan.nodeAt.length ? i.ourPlan : i.ourFree;
  }

  /**
   * The conics beyond the predicted path (asked of the worker when the path changes; the last answer
   * meanwhile, while it still starts where the path ends).
   */
  private extension(i: Info): Extension | null {
    const src = this.extSource(i);
    if (!src || src.fate !== "continues" || src.pts.length < 2) return null;
    const n = src.pts.length - 1;
    if (src !== this.extSrc && !this.extBusy) {
      this.extBusy = true;
      const ref = src.refs[n] ?? "sun";
      planJob<Extension>({ kind: "extend", X: src.pts[n]!, V: src.vels[n]!, t: src.times[n]!, ref, horizon: extensionHorizon(ref) })
        .then((e) => {
          this.ext = e && (e as unknown as { error?: string }).error ? null : e;
          this.extSrc = src;
        })
        .finally(() => (this.extBusy = false));
    }
    const e = this.ext;
    if (!e || !e.times.length) return null;
    const end = src.times[n]!;
    return this.extSrc === src || Math.abs(e.times[0]! - end) < 0.02 * Math.max(end - src.times[0]!, 1e-9) + 1e-6 ? e : null;
  }

  /**
   * The closest approach to a body along the conics (memoized per extension) — null for a body of the
   * other universe (the frame the ship goes through the wormhole: the target, the scene and the paths
   * are not all on the same side yet).
   */
  private extClosest(e: Extension, id: string, ours = this.universe === "ours"): { i: number; d: number } | null {
    if (ours !== (!!solarBody(id) || id === "iss" || id === "ranger" || id === "lander" || id === "endurance")) return null;
    let m = this.pathMemo.get(e);
    if (!m) this.pathMemo.set(e, (m = new Map()));
    const key = `ca:${ours ? "o" : "g"}:${id}`;
    if (!m.has(key)) {
      // (our side: the home frame; Gargantua's: the hole's flat map)
      const track = ours ? ourTrack(id, e.times) : e.times.map((t) => bodyCentre(this.host.s, id as Body, t) as V3);
      let best: { i: number; d: number } | null = null;
      for (let j = 0; j < e.pts.length; j++) {
        const d = len(sub(e.pts[j]!, track[j]!));
        if (!best || d < best.d) best = { i: j, d };
      }
      // (not at its very start: an approach, not where the path left it)
      m.set(key, best && best.i > 1 ? best : null);
    }
    return m.get(key) as { i: number; d: number } | null;
  }

  /**
   * Gargantua's side: the conics beyond the prediction (the plan's path once it has nodes, else the
   * free fall) — computed again when that path's end has moved, at most twice a second, at once when it
   * has jumped (a node pulled).
   */
  private theirExtension(i: Info, t0: number): Extension | null {
    const pp = i.plan?.path;
    let pts: V3[], times: number[], fate: string;
    if (pp && pp.pts.length > 1 && i.plan!.nodes.length) (pts = pp.pts), (times = pp.times), (fate = pp.fate);
    else if (i.path && i.path.pts.length > 1) {
      const p = i.path;
      (pts = p.pts), (times = p.pts.map((_, j) => t0 + (j + 1) * p.dt)), (fate = p.fate);
    } else return null;
    if (fate !== "continues" && fate !== "escape") return null;
    const n = pts.length - 1;
    const end = times[n]!,
      X = pts[n]!;
    const V = scale(sub(X, pts[n - 1]!), 1 / Math.max(end - times[n - 1]!, 1e-9));
    const cur = this.theirExt;
    const now = performance.now();
    const jumped = !cur || len(sub(cur.X, X)) > 0.02 * Math.max(len(X), 1) || Math.abs(cur.end - end) > 0.05 * Math.max(end - t0, 1);
    if (jumped || (now - cur!.at > 500 && cur!.end !== end)) {
      this.theirExt = { ext: extendTheirs(this.host.s, X, V, end, end - t0), end, X, at: now };
    }
    return this.theirExt!.ext;
  }

  /** The conics beyond the prediction, either side. */
  private extFor(i: Info, t0: number, ours: boolean): Extension | null {
    return ours ? this.extension(i) : this.theirExtension(i, t0);
  }

  /** The timeline's automatic span: how far the predicted paths reach (at least an hour). */
  private autoSpan(i: Info, t0: number, ours: boolean) {
    let end = t0;
    if (ours) {
      for (const p of [i.ourFree, i.ourPlan]) if (p?.times.length) end = Math.max(end, p.times[p.times.length - 1]!);
    } else {
      if (i.path) end = Math.max(end, t0 + i.path.pts.length * i.path.dt);
      const pp = i.plan?.path;
      if (pp?.times.length) end = Math.max(end, pp.times[pp.times.length - 1]!);
    }
    for (const n of i.plan?.nodes ?? []) end = Math.max(end, n.t);
    // (the preview: to its last burn and its arrival, a little after)
    const c = i.cand;
    if (c) {
      for (const n of c.nodes) end = Math.max(end, n.t);
      if (c.arrive) end = Math.max(end, c.arrive.t + 0.08 * (c.arrive.t - t0));
    }
    // (beyond: up to the encounter with the target along the conics, when there is one)
    const e = this.extFor(i, t0, ours);
    const sc = this.scene;
    if (e && sc?.byId.has(i.target) && i.target !== i.ref && i.target !== "hole") {
      const ca = this.extClosest(e, i.target, ours);
      const tb = sc.byId.get(i.target)!;
      if (ca && (ca.d < 3 * tb.soi || e.refs.includes(i.target))) end = Math.max(end, e.times[ca.i]! + 0.15 * (e.times[ca.i]! - t0));
    }
    const hour = 3600 / (4.925490947e-6 * this.host.s.massSolar);
    return Math.max(end - t0, ours ? hour : 50);
  }

  /** The events ahead on the paths: nodes, closest approach, spheres of influence, apsides, arrival, impact. */
  private marks(i: Info, t0: number, ours: boolean, sc: MapScene): Mark[] {
    const out: Mark[] = [];
    (i.plan?.nodes ?? []).forEach((n, k) => out.push({ t: n.t, kind: "node", label: tf("Node {0}", k + 1) }));
    // (the preview's burns, and its arrival)
    (i.cand?.nodes ?? []).forEach((n, k) => out.push({ t: n.t, kind: "cand", label: tf("Preview · burn {0} · {1}", k + 1, i.cand!.note) }));
    if (i.cand?.arrive) out.push({ t: i.cand.arrive.t, kind: "cand", label: t("Preview · arrival") });
    if (ours) {
      const free = i.ourFree,
        plan = i.ourPlan;
      const memo = (p: OurPath) => {
        let m = this.pathMemo.get(p);
        if (!m) this.pathMemo.set(p, (m = new Map()));
        return m;
      };
      for (const p of [plan, free]) {
        if (!p) continue;
        const m = memo(p);
        if (!m.has("soi")) {
          const ch: Mark[] = [];
          for (let j = 1; j < p.refs.length; j++) {
            if (p.refs[j] !== p.refs[j - 1]) {
              const name = sc.byId.get(p.refs[j]!)?.name ?? p.refs[j];
              ch.push({ t: p.times[j]!, kind: "soi", label: tf("{0}'s sphere of influence", name ?? "") });
            }
          }
          m.set("soi", ch);
        }
        out.push(...(m.get("soi") as Mark[]));
        if (p === plan) break;
      }
      if (free && free.refs[0]) {
        const m = memo(free);
        if (!m.has("aps:0")) m.set("aps:0", ourApsides(free, free.refs[0]!));
        const a = m.get("aps:0") as ReturnType<typeof ourApsides>;
        if (a.pe) out.push({ t: free.times[a.pe.i]!, kind: "pe", label: t("Periapsis") });
        if (a.ap) out.push({ t: free.times[a.ap.i]!, kind: "ap", label: t("Apoapsis") });
        if (free.fate === "impact") out.push({ t: free.times[free.times.length - 1]!, kind: "impact", label: t("Impact") });
      }
      const tp = plan ?? free;
      if (tp && sc.byId.has(i.target) && solarBody(i.target) && i.target !== i.ref && i.target !== "wormhole") {
        const m = memo(tp);
        const key = `ca:${i.target}:${plan?.nodeAt[0] ?? 0}`;
        if (!m.has(key)) m.set(key, ourClosest(tp, i.target, plan?.nodeAt[0] ?? 0));
        const ca = m.get(key) as ReturnType<typeof ourClosest>;
        if (ca) out.push({ t: tp.times[ca.i]!, kind: "ca", label: tf("Closest approach · {0}", sc.byId.get(i.target)!.name) });
      }
      const e = this.extension(i);
      if (e) {
        for (let j = 1; j < e.refs.length; j++) {
          if (e.refs[j] !== e.refs[j - 1])
            out.push({
              t: e.times[j]!,
              kind: "soi",
              label: tf("{0}'s sphere of influence (conics)", sc.byId.get(e.refs[j]!)?.name ?? e.refs[j]!),
            });
        }
        for (const a of e.apsides)
          out.push({ t: e.times[a.i]!, kind: "pe", label: tf("Periapsis at {0} (conics)", sc.byId.get(a.body)?.name ?? a.body) });
        if (sc.byId.has(i.target) && i.target !== i.ref && i.target !== "wormhole") {
          const ca = this.extClosest(e, i.target, true);
          if (ca) out.push({ t: e.times[ca.i]!, kind: "ca", label: tf("Closest approach · {0} (conics)", sc.byId.get(i.target)!.name) });
        }
        if (e.fate === "impact")
          out.push({
            t: e.times[e.times.length - 1]!,
            kind: "impact",
            label: tf("Impact · {0} (conics)", sc.byId.get(e.hit ?? "")?.name ?? e.hit ?? ""),
          });
      }
      if (i.ourArrive)
        out.push({
          t: i.ourArrive.t,
          kind: "arrive",
          label: tf("Arrival · {0}", BODY_NAMES[i.ourArrive.body as Target] ?? i.ourArrive.body),
        });
    } else {
      const ca = this.host.closestApproach(i, t0);
      if (ca && ca.t > 0)
        out.push({ t: t0 + ca.t, kind: "ca", label: tf("Closest approach · {0}", BODY_NAMES[i.target as Target] ?? i.target) });
      const p = i.path;
      if (p && (p.fate === "horizon" || p.fate === "star"))
        out.push({ t: t0 + p.pts.length * p.dt, kind: "impact", label: p.fate === "horizon" ? t("The horizon") : t("Into the star") });
      const e = this.theirExtension(i, t0);
      if (e) {
        const name = (id: string) => sc.byId.get(id)?.name ?? BODY_NAMES[id as Target] ?? id;
        for (let j = 1; j < e.refs.length; j++) {
          if (e.refs[j] !== e.refs[j - 1])
            out.push({
              t: e.times[j]!,
              kind: "soi",
              label:
                e.refs[j] === "hole"
                  ? tf("Out of {0}'s Hill sphere (conics)", name(e.refs[j - 1]!))
                  : tf("{0}'s Hill sphere (conics)", name(e.refs[j]!)),
            });
        }
        for (const a of e.apsides)
          out.push({
            t: e.times[a.i]!,
            kind: "pe",
            label: a.body === "hole" ? t("Periapsis (conics)") : tf("Periapsis at {0} (conics)", name(a.body)),
          });
        if (sc.byId.has(i.target) && i.target !== "hole") {
          const ca = this.extClosest(e, i.target, false);
          if (ca) out.push({ t: e.times[ca.i]!, kind: "ca", label: tf("Closest approach · {0} (conics)", name(i.target)) });
        }
        if (e.fate === "impact")
          out.push({
            t: e.times[e.times.length - 1]!,
            kind: "impact",
            label: e.hit === "hole" ? t("The horizon (conics)") : tf("Impact · {0} (conics)", name(e.hit ?? "")),
          });
      }
    }
    return out.filter((m) => m.t > t0);
  }

  private syncTimeline(t0: number, span: number, marks: Mark[], ours: boolean, note: string) {
    const tl = this.tl;
    this.tlSpan = span;
    this.tlT0 = t0;
    this.tlMarks = marks.filter((m) => m.t - t0 <= span);
    const f = clamp(this.preview / span, 0, 1);
    tl.fill.style.transform = `scaleX(${f.toFixed(4)})`;
    tl.handle.style.left = `${(f * 100).toFixed(3)}%`;
    tl.play.textContent = this.playing ? "❚❚" : "▶";
    tl.root.classList.toggle("on", this.preview > 0);
    const key = `${span.toPrecision(4)}|${this.tlMarks.map((m) => `${m.kind}${Math.round(((m.t - t0) / span) * 400)}`).join(",")}`;
    if (key !== this.tlKey) {
      this.tlKey = key;
      tl.marks.replaceChildren();
      for (const m of this.tlMarks) {
        const e = h("button", `m3-mark m3-${m.kind}`) as HTMLButtonElement;
        e.style.left = `${(((m.t - t0) / span) * 100).toFixed(3)}%`;
        e.style.setProperty("--c", MARK_COL[m.kind]);
        const when = fmtDur(m.t - t0, this.host.s);
        e.title = `${m.label} · T+${when}`;
        e.onpointerdown = (ev) => {
          ev.stopPropagation();
          this.preview = m.t - this.tlT0;
          this.playing = false;
        };
        tl.marks.append(e);
      }
    }
    const s = this.host.s;
    const tp = t0 + this.preview;
    const text =
      this.preview <= 0
        ? tf("Now · {0} ahead", fmtDur(span, s))
        : `${ours ? `${dateOf(tp).toISOString().slice(5, 16).replace("T", " ")} · ` : ""}T+${fmtDur(this.preview, s)}${note ? ` · ${note}` : ""}`;
    if (tl.label.textContent !== text) tl.label.textContent = text;
  }

  /** The ship at a later time along its predicted path (the plan's once past its first node), map frame. */
  private shipAt(
    i: Info,
    tp: number,
    t0: number,
    ours: boolean,
    sc: MapScene,
  ): { X: V3; V: V3; ref: string | null; beyond: boolean; conics?: boolean } | null {
    const lerp = (a: V3, b: V3, f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    const find = (times: number[]) => {
      let lo = 0,
        hi = times.length - 1;
      if (tp >= times[hi]!) return { j: hi, f: 0, beyond: tp > times[hi]! };
      if (tp <= times[0]!) return { j: 0, f: 0, beyond: false };
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid]! <= tp) lo = mid;
        else hi = mid;
      }
      return { j: lo, f: (tp - times[lo]!) / Math.max(times[lo + 1]! - times[lo]!, 1e-30), beyond: false };
    };
    if (ours) {
      const plan = i.ourPlan,
        free = i.ourFree;
      const usePlan = !!plan && plan.nodeAt.length > 0 && tp >= plan.times[plan.nodeAt[0]!]!;
      let p: OurPath | null = usePlan ? plan! : free;
      if (!p || p.times.length < 2) return null;
      // (past the prediction: along the conics)
      const e = this.extension(i);
      const onConics = !!e && e.times.length > 1 && tp > p.times[p.times.length - 1]! && this.extSource(i) === p;
      if (onConics) p = e!;
      const { j, f, beyond } = find(p.times);
      const k = Math.min(j + 1, p.pts.length - 1);
      const X = lerp(p.pts[j]!, p.pts[k]!, f);
      const V = lerp(p.vels[j]!, p.vels[k]!, f);
      const ref = p.refs[j] ?? null;
      return { X, V: ref ? sub(V, solarState(ref, tp).vel) : V, ref, beyond, conics: onConics };
    }
    const pp = i.plan?.path;
    let pts: V3[], times: number[];
    if (pp && pp.times.length > 1 && tp >= pp.times[0]!) (pts = pp.pts), (times = pp.times);
    else if (i.path && i.path.pts.length) {
      pts = [i.X!, ...i.path.pts];
      times = pts.map((_, j) => t0 + j * i.path!.dt);
    } else return null;
    // (past the prediction: along the conics)
    const e = this.theirExtension(i, t0);
    const onConics = !!e && e.times.length > 1 && tp > times[times.length - 1]!;
    if (onConics) (pts = e!.pts), (times = e!.times);
    const { j, f, beyond } = find(times);
    const k = Math.min(j + 1, pts.length - 1);
    const X = lerp(pts[j]!, pts[k]!, f);
    const dT = Math.max(times[k]! - times[j]!, 1e-9);
    const V = onConics ? lerp(e!.vels[j]!, e!.vels[k]!, f) : scale(sub(pts[k]!, pts[j]!), 1 / dT);
    return { X: sub(X, sc.origin(tp)), V, ref: null, beyond, conics: onConics };
  }

  // ------------------------------------------------------------------------------------ the bar
  private buildBar() {
    const svg = (body: string) => `<svg viewBox="0 0 24 24">${body}</svg>`;
    const ICON: Record<string, string> = {
      top: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.8" class="f"/>',
      "3d": '<ellipse cx="12" cy="12" rx="9" ry="4.4"/><circle cx="12" cy="12" r="1.8" class="f"/>',
      edge: '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.8" class="f"/>',
      log: '<path d="M4 4v16h16"/><path d="M6 17c2.5-7 5.5-10 13-11"/>',
      fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.4"/>',
      full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
      plane: '<path d="M3 16l5-6h13l-5 6z"/>',
      key: '<path d="M3 7h5M3 12h5M3 17h5"/><path d="M11 7h10M11 12h10M11 17h10" stroke-dasharray="2.2 2"/>',
    };
    /** a button: an icon (or a short text), its name and what it does for the tooltip */
    const b = (id: string, icon: string, label: string, tip: string, fn: () => void, cls = "") => {
      const e = h("button", cls) as HTMLButtonElement;
      if (ICON[icon]) e.innerHTML = svg(ICON[icon]!);
      else if (icon) e.textContent = icon;
      e.dataset.label = label;
      e.dataset.tip = tip;
      e.setAttribute("aria-label", label);
      e.onclick = (ev) => {
        ev.stopPropagation();
        fn();
      };
      this.btns[id] = e;
      return e;
    };
    // ("Focus" is the settings' camera focus too: a pair, not the dictionary)
    this.focusBtn.dataset.label = tr({ fr: "Centre", en: "Focus" });
    this.focusBtn.dataset.tip = t("The body at the centre — double-click a body on the map; a click targets it");
    this.focusBtn.onclick = (e) => {
      e.stopPropagation();
      this.openMenu(!this.menu.classList.contains("open"));
    };
    const planes = h("div", "m3-seg");
    for (const p of PLANES) {
      const e = b(`plane:${p.id}`, "", tf("Plane: {0}", p.label), p.title, () => this.setPlane(p.id));
      e.append(h("span", "m3-long", p.label), h("span", "m3-short", p.short));
      planes.append(e);
    }
    const views = h("div", "m3-seg");
    views.append(
      b("view:top", "top", t("From above"), t("Seen from above the reference plane"), () => this.setView(Math.PI / 2 - 1e-3)),
      b("view:3d", "3d", t("Oblique"), t("Seen at 30° above the plane"), () => this.setView(0.52)),
      b("view:edge", "edge", t("Edge-on"), t("Seen in the reference plane"), () => this.setView(0.004)),
    );
    // (the minimap's rail: the plane and the view each one button, cycling)
    const cyclePlane = b(
      "cycle:plane",
      "",
      t("Reference plane"),
      t("Click for the next one: the system's, the equator, the ship's orbit, the target's"),
      () => {
        const list = PLANES.filter((p) => !this.btns[`plane:${p.id}`]!.disabled);
        const i = list.findIndex((p) => p.id === this.plane);
        this.setPlane(list[(i + 1) % list.length]!.id);
      },
      "m3-cycle",
    );
    const cycleView = b(
      "cycle:view",
      "3d",
      t("View"),
      t("Click for the next one: from above, oblique, edge-on"),
      () => {
        const pitch = this.cam.goal.pitch;
        this.setView(pitch > 1.5 ? 0.52 : Math.abs(pitch - 0.52) < 0.01 ? 0.004 : Math.PI / 2 - 1e-3);
      },
      "m3-cycle",
    );
    this.bar.append(
      h("span", "fl-label", t("Map")),
      this.focusBtn,
      planes,
      views,
      cyclePlane,
      cycleView,
      b(
        "log",
        "log",
        t("Multi-scale"),
        t("The distance from the focus as ln(1 + r/r₀), directions kept — the whole system and a low orbit on one map"),
        () => {
          if (this.universe === "ours") this.logOurs = !this.logOurs;
          else this.logTheirs = !this.isLog();
          this.autoDist = true;
          this.panOff = [0, 0, 0];
        },
      ),
      b("legend", "key", t("Legend"), t("What the map's lines and marks are"), () => this.showLegend(this.legend.hidden)),
      b("fit", "fit", t("Frame"), t("Frame the focus and the ship's paths again (or double-click on empty space)"), () => this.fit()),
      b("cm", t("CoM"), t("Centre of mass"), t("The inertial frame of the centre of mass: Gargantua moves too"), () => (this.frame = "cm")),
      b("holeF", t("Hole"), t("Gargantua's frame"), t("Gargantua fixed at the centre"), () => (this.frame = "hole")),
      b("full", "full", t("Full screen"), t("The map over the whole screen"), () => this.host.toggleMapView(), "m3-full"),
    );
    this.planeIcon = svg(ICON.plane!);
    this.viewIcons = { top: svg(ICON.top!), "3d": svg(ICON["3d"]!), edge: svg(ICON.edge!) };
  }
  private planeIcon = "";
  private viewIcons: Record<string, string> = {};

  private buildMenu() {
    this.menuSearch.placeholder = t("Find a body…");
    this.menuSearch.spellcheck = false;
    this.menuSearch.oninput = () => this.renderMenu();
    this.menuSearch.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.openMenu(false);
      if (e.key === "Enter") this.menuList.querySelector<HTMLButtonElement>("button")?.click();
    };
    this.menu.append(this.menuSearch, this.menuList);
    this.menu.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.menu.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    addEventListener("pointerdown", (e) => {
      if (this.menu.classList.contains("open") && !this.menu.contains(e.target as Node) && e.target !== this.focusBtn) this.openMenu(false);
    });
  }

  private openMenu(open: boolean) {
    this.menu.classList.toggle("open", open);
    if (open) {
      this.menuSearch.value = "";
      this.renderMenu();
      requestAnimationFrame(() => this.menuSearch.focus());
    }
  }

  private renderMenu() {
    const sc = this.scene;
    this.menuList.replaceChildren();
    if (!sc) return;
    const q = this.menuSearch.value.trim().toLowerCase();
    const item = (id: string, name: string, depth: number, note: string, col?: string) => {
      const e = h("button", `m3-item${this.currentFocus() === id ? " on" : ""}`) as HTMLButtonElement;
      e.style.paddingLeft = `${10 + depth * 14}px`;
      const dot = h("i");
      if (col) dot.style.background = `rgb(${col})`;
      e.append(dot, h("span", "", name), h("small", "", note));
      e.onclick = () => {
        this.setFocus(id);
        this.openMenu(false);
      };
      this.menuList.append(e);
    };
    if (!q || "ship ranger".includes(q)) item("ship", t("The ship"), 0, t("follow the Ranger"), "124, 214, 255");
    if (this.lastInfo && sc.byId.has(this.lastInfo.target) && (!q || "target".includes(q))) {
      const tb = sc.byId.get(this.lastInfo.target)!;
      item(tb.id, tf("Target · {0}", tb.name), 0, "", tb.col);
    }
    // the tree: each body under its primary
    const walk = (parent: string | null, depth: number) => {
      for (const b of sc.bodies) {
        if (b.parent !== parent) continue;
        const kids = sc.bodies.some((c) => c.parent === b.id);
        const match = !q || b.name.toLowerCase().includes(q) || b.id.includes(q);
        if (match) item(b.id, b.name, q ? 0 : depth, KIND_NOTE[b.kind], b.col);
        if (kids) walk(b.id, depth + 1);
      }
    };
    walk(null, 0);
    if (!this.menuList.children.length) this.menuList.append(h("p", "m3-none", t("No body by that name")));
  }

  private renderCrumbs(sc: MapScene, fid: string) {
    const key = `${sc.universe}:${fid}`;
    if (this.crumbs.dataset.key === key) return;
    this.crumbs.dataset.key = key;
    this.crumbs.replaceChildren();
    const chain = fid === "ship" ? [] : lineage(sc, fid);
    chain.forEach((b, j) => {
      if (j) {
        const sep = h("span", "m3-sep", "›");
        sep.setAttribute("aria-hidden", "true");
        this.crumbs.append(sep);
      }
      const e = h("button", j === chain.length - 1 ? "on" : "", b.name) as HTMLButtonElement;
      e.onclick = (ev) => {
        ev.stopPropagation();
        this.setFocus(b.id);
      };
      this.crumbs.append(e);
    });
    if (fid === "ship") this.crumbs.append(h("button", "on", t("The ship")));
  }

  // ------------------------------------------------------------------------------------ view commands
  private currentFocus(): string {
    return this.focus ?? this.homeFocus();
  }

  private homeFocus(): string {
    const i = this.lastInfo;
    const sc = this.scene;
    if (!sc || !i) return "hole";
    // (Gargantua's side: the world whose frame the ship flies in — else the hole)
    if (sc.universe === "gargantua") {
      const w = i.status?.soi;
      return w && w !== "gargantua" && w !== "hole" && sc.byId.has(w) ? w : "hole";
    }
    const ref = i.ref ? sc.byId.get(i.ref) : null;
    if (!ref || ref.id === "sun") return "sun";
    // (a preview or a plan out to the Sun's sphere — a mission to another planet —: the whole of it)
    for (const p of [i.cand?.kind === "ours" ? i.cand.ours : null, i.ourPlan]) if (p && p.refs.includes("sun")) return "sun";
    return ref.kind === "moon" && ref.parent ? ref.parent : ref.id;
  }

  setFocus(id: string | null) {
    this.focus = id;
    this.autoDist = true;
    this.panOff = [0, 0, 0];
    this.renderMenu();
  }

  private setPlane(p: PlaneMode) {
    this.plane = p;
  }

  private setView(pitch: number) {
    this.cam.goal.pitch = pitch;
  }

  private fit() {
    this.focus = null;
    this.autoDist = true;
    this.panOff = [0, 0, 0];
  }

  private isLog() {
    return this.universe === "ours" ? this.logOurs : (this.logTheirs ?? this.host.s.system !== "none");
  }

  private syncBar(sc: MapScene, fid: string) {
    const s = this.host.s;
    const name = fid === "ship" ? t("The ship") : (sc.byId.get(fid)?.name ?? fid);
    const col = fid === "ship" ? "124, 214, 255" : (sc.byId.get(fid)?.col ?? "220, 220, 220");
    const key = `${name}|${this.focus === null}`;
    if (this.focusBtn.dataset.key !== key) {
      this.focusBtn.dataset.key = key;
      this.focusBtn.replaceChildren();
      const d = h("i");
      d.style.background = `rgb(${col})`;
      this.focusBtn.append(d, h("span", "", name), h("b", "", this.focus === null ? `${t("auto")} ▾` : "▾"));
    }
    for (const p of PLANES) this.btns[`plane:${p.id}`]!.classList.toggle("on", this.plane === p.id);
    const pitch = this.cam.goal.pitch;
    this.btns["view:top"]!.classList.toggle("on", pitch > 1.5);
    this.btns["view:edge"]!.classList.toggle("on", Math.abs(pitch) < 0.02);
    this.btns["view:3d"]!.classList.toggle("on", Math.abs(pitch - 0.52) < 0.01);
    this.btns.log!.classList.toggle("on", this.isLog());
    this.btns.fit!.classList.toggle("on", this.focus === null && this.autoDist);
    const massive = sc.universe === "gargantua" && s.sun && s.sunMass > 0;
    this.btns.cm!.hidden = this.btns.holeF!.hidden = !massive;
    this.btns.cm!.classList.toggle("on", this.frame === "cm");
    this.btns.holeF!.classList.toggle("on", this.frame === "hole");
    this.btns.full!.classList.toggle("on", this.host.mapView());
    this.btns["plane:target"]!.disabled = !this.lastInfo || !sc.byId.get(this.lastInfo.target)?.orbit;
    if (this.btns["plane:target"]!.disabled) this.btns["plane:target"]!.dataset.why = t("The target has no orbit to take the plane of");
    else delete this.btns["plane:target"]!.dataset.why;
    // the rail's cycling buttons: the current plane (its short name), the current view (its icon)
    const pc = this.btns["cycle:plane"]!,
      vc = this.btns["cycle:view"]!;
    const pShort = PLANES.find((p) => p.id === this.plane)?.short ?? "";
    if (pc.dataset.cur !== pShort) (pc.dataset.cur = pShort), (pc.innerHTML = `${this.planeIcon}<small>${pShort}</small>`);
    const vk = pitch > 1.5 ? "top" : Math.abs(pitch) < 0.02 ? "edge" : "3d";
    if (vc.dataset.cur !== vk) (vc.dataset.cur = vk), (vc.innerHTML = this.viewIcons[vk] ?? "");
  }

  // ------------------------------------------------------------------------------------ pointer
  private bindPointer() {
    const c = this.canvas;
    const at = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio] as const;
    };
    let drag: { x: number; y: number; moved: boolean; pan: boolean } | null = null;
    // (two fingers: zoom and pan; a second finger cancels the one-finger gesture under way)
    const pinch = new Pinch(c, {
      start: () => {
        drag = null;
        this.gizmo = null;
        this.nodeDrag = null;
      },
      zoom: (k, cx, cy) => {
        const r = c.getBoundingClientRect();
        this.shifting(() => this.cam.zoom(1 / k, (cx - r.left) * devicePixelRatio, (cy - r.top) * devicePixelRatio));
        this.autoDist = false;
        this.handledAt = performance.now();
      },
      pan: (dx, dy) => {
        this.shifting(() => this.cam.pan(dx * devicePixelRatio, dy * devicePixelRatio));
        this.autoDist = false;
        this.moving = true;
        this.handledAt = performance.now();
      },
    });
    // (a long press on a node deletes it: the touch's right click)
    const pressed = longPress(c, (e) => {
      if (pinch.active || drag?.moved) return;
      const [x, y] = at(e);
      const nd = this.nodeHits.find((q) => Math.hypot(q.x - x, q.y - y) < reach(e, 10) * devicePixelRatio);
      if (!nd) return;
      drag = null;
      this.nodeDrag = null;
      this.host.act.deleteNode(nd.k);
      navigator.vibrate?.(15);
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const [x, y] = at(e);
        const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        this.shifting(() => this.cam.zoom(Math.exp(e.deltaY * k * 0.0016), x, y));
        this.autoDist = false;
        this.handledAt = performance.now();
      },
      { passive: false },
    );
    c.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.handledAt = performance.now();
      if (pinch.active) return;
      c.setPointerCapture(e.pointerId);
      const [x, y] = at(e);
      // (under a finger, a 44 px zone)
      const near = (q: { x: number; y: number }, r: number) => Math.hypot(q.x - x, q.y - y) < reach(e, r) * devicePixelRatio;
      if (e.button === 0) {
        // a node's handle (pull it), a node (select it; drag it along the path), else the view
        const hnd = this.handleHits.find((q) => near(q, 11));
        if (hnd) {
          this.gizmo = { k: hnd.k, c: hnd.c, sign: hnd.sign, dir: hnd.dir, x0: x, y0: y, x, y, at: performance.now() };
          return;
        }
        const nd = this.nodeHits.find((q) => near(q, 10));
        if (nd) {
          this.host.sel = nd.k;
          this.nodeDrag = { k: nd.k };
          return;
        }
      }
      drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button !== 0 || e.shiftKey };
    });
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // (a touch: its long press says it — a phone's own context menu would delete twice)
      if ((e as PointerEvent).pointerType === "touch" || pressed()) return;
      // right-click on a node: delete it
      const [x, y] = at(e);
      const nd = this.nodeHits.find((q) => Math.hypot(q.x - x, q.y - y) < 10 * devicePixelRatio);
      if (nd && !drag?.moved) this.host.act.deleteNode(nd.k);
    });
    c.addEventListener("pointermove", (e) => {
      const [x, y] = at(e);
      this.hover = { x, y };
      if (this.gizmo) {
        this.gizmo.x = x;
        this.gizmo.y = y;
        return;
      }
      if (pinch.active) return;
      if (this.nodeDrag) {
        // along the path: the nearest of its points
        let best: { t: number; d: number } | null = null;
        for (const q of this.pathHits) {
          const d = Math.hypot(q.x - x, q.y - y);
          if (!best || d < best.d) best = { t: q.t, d };
        }
        const n = this.lastInfo?.plan?.nodes[this.nodeDrag.k];
        if (best && n && best.d < 40 * devicePixelRatio) this.host.act.nudge(this.nodeDrag.k, [0, 0, 0], best.t - n.t);
        return;
      }
      if (!drag) {
        c.style.cursor =
          this.bodyAt(x, y) || this.nodeHits.some((q) => Math.hypot(q.x - x, q.y - y) < 10 * devicePixelRatio) ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      c.style.cursor = "grabbing";
      if (drag.pan) {
        this.shifting(() => this.cam.pan(dx * devicePixelRatio, dy * devicePixelRatio));
        this.autoDist = false;
      } else this.cam.orbit(dx, dy);
      this.moving = true;
    });
    c.addEventListener("pointerleave", () => (this.hover = null));
    c.addEventListener("pointerup", (e) => {
      if (pinch.active || pressed()) {
        drag = null;
        this.gizmo = null;
        this.nodeDrag = null;
        return;
      }
      if (this.gizmo || this.nodeDrag) {
        this.gizmo = null;
        this.nodeDrag = null;
        return;
      }
      if (drag && !drag.moved && e.button === 0) {
        const [x, y] = at(e);
        const id = this.bodyAt(x, y, reach(e, 16));
        if (id) this.host.act.select(id);
        else {
          // on a path: a new node there
          let p: { t: number; d: number } | null = null;
          for (const q of this.pathHits) {
            const d = Math.hypot(q.x - x, q.y - y);
            if (!p || d < p.d) p = { t: q.t, d };
          }
          if (p && p.d < reach(e, 9) * devicePixelRatio) {
            this.host.act.addNodeAt(p.t);
            this.host.sel = this.lastInfo?.plan ? this.lastInfo.plan.nodes.filter((n) => n.t < p.t).length : 0;
          }
        }
      }
      drag = null;
      c.style.cursor = "grab";
    });
    c.addEventListener("dblclick", (e) => {
      const [x, y] = at(e);
      const id = this.bodyAt(x, y);
      if (id) this.setFocus(id);
      else this.fit();
    });
  }

  /** The body under a point (device pixels): its disc, or within `near` CSS px of its centre (16; a finger 22). */
  private bodyAt(x: number, y: number, near = 16): string | null {
    let best: string | null = null,
      bd = Infinity;
    for (const q of this.bodyHits) {
      const d = Math.hypot(q.x - x, q.y - y);
      const r = Math.max(q.r, near * devicePixelRatio);
      if (d < r && d - q.r < bd) (bd = d - q.r), (best = q.id);
    }
    return best;
  }

  /** The GPU's layer, made the first time the host has one (the stage's under-layer). */
  private gpuLayer(): MapGpu | null {
    if (!this.gpu && !this.gpuTried) {
      const src = this.host.gpu?.();
      if (!src) return null;
      this.gpuTried = true;
      try {
        this.gpu = new MapGpu(src.device, src.textures);
      } catch (e) {
        console.warn("The map's GPU layer: none —", e);
        this.gpu = null;
      }
    }
    // (its pipelines still building, or refused: the canvas draws alone)
    const G = this.gpu;
    if (!G || G.status !== "ok") return null;
    if (!G.canvas.parentNode) {
      this.stage.insertBefore(G.canvas, this.canvas);
      this.stage.classList.add("gpu");
    }
    return G;
  }

  /** A body for the GPU: its place and size in view space, its light, its axes, what it is drawn as. */
  private gpuBody(
    G: MapGpu,
    sc: MapScene,
    b: MapBody,
    t: number,
    dpr: number,
    pw: (X: V3) => V3,
    rw: (X: V3, R: number) => number,
  ): boolean {
    const cam = this.cam;
    const view = (v: V3): V3 => [dot(v, cam.right), dot(v, cam.up), dot(v, cam.fwd)];
    const c = view(sub(pw(b.pos), cam.eye));
    const lin = (x: number) => (x / 255) ** 2.2;
    const col = b.col.split(",").map((x) => lin(+x)) as V3;
    const src = b.light ? sc.byId.get(b.light)?.pos : null;
    const L = view(src ? norm(sub(src, b.pos)) : scale(cam.fwd, -1));
    const sb = sc.universe === "ours" ? solarBody(b.id) : null;
    // (the body's axes: ours, its own — its map turned as the world turns —; Gargantua's worlds, their
    // frames' — x away from the hole, z their pole)
    let ax: [V3, V3, V3];
    if (sb) ax = bodyAxes(sb, t) as [V3, V3, V3];
    else {
      const z = b.kind === "hole" ? ([0, 0, 1] as V3) : norm(b.pole);
      const H = sc.byId.get("hole")?.pos ?? [0, 0, 0];
      let x = b.kind === "hole" ? ([1, 0, 0] as V3) : sub(b.pos, H);
      x = norm(sub(x, scale(z, dot(x, z))));
      ax = [x, cross(z, x), z];
    }
    const axV = ax.map(view) as [V3, V3, V3];
    const R = rw(b.pos, b.radius);
    const AIR: Record<string, V3> = {
      earth: [0.3, 0.55, 1],
      mars: [0.85, 0.5, 0.32],
      venus: [1, 0.85, 0.55],
      titan: [0.95, 0.6, 0.22],
      miller: [0.55, 0.75, 1],
      mann: [0.75, 0.85, 1],
      edmunds: [0.95, 0.75, 0.5],
    };
    const air = b.air ? { col: AIR[b.id] ?? col, k: 0.9 } : undefined;
    const base = { c, R, L, ax: axV, col, air, minPx: (b.kind === "moon" ? 2 : 3.2) * dpr } as GpuBody;
    if (b.kind === "star") return G.body({ ...base, kind: BodyKind.Star, minPx: 5 * dpr }), true;
    if (b.kind === "mouth") return G.body({ ...base, kind: BodyKind.Mouth, minPx: 4 * dpr }), true;
    if (b.kind === "hole") {
      const hl = sc.hole;
      const Rh = rw(b.pos, hl?.rH ?? b.radius);
      const rings: [number, number] | undefined = hl?.disk ? [rw(b.pos, hl.isco) / Rh, rw(b.pos, hl.diskOuter) / Rh] : undefined;
      return G.body({ ...base, R: Rh, kind: BodyKind.Hole, rings, minPx: 3 * dpr }), true;
    }
    const rings: [number, number] | undefined = b.rings
      ? [rw(b.pos, b.rings.inner * b.radius) / R, rw(b.pos, b.rings.outer * b.radius) / R]
      : undefined;
    if (sb?.map) {
      if (b.id === "earth") return G.body({ ...base, kind: BodyKind.Earth, rings }), true;
      const hi = MAPS_HI.indexOf(sb.map),
        lo = MAPS_LO.indexOf(sb.map);
      if (hi >= 0 || lo >= 0) return G.body({ ...base, kind: BodyKind.Map, layer: hi >= 0 ? hi : -(lo + 1), rings }), true;
    }
    const proc = { miller: 0, mann: 1, edmunds: 2 }[b.id as "miller"];
    if (proc !== undefined) return G.body({ ...base, kind: BodyKind.Proc, proc }), true;
    return G.body({ ...base, kind: BodyKind.Plain, rings }), true;
  }

  // ------------------------------------------------------------------------------------ drawing
  draw(i: Info, t0: number) {
    const G = this.gpuLayer();
    G?.begin();
    try {
      this.draw2d(i, t0, G);
    } finally {
      if (G) {
        const [vx, vy, vw, vh] = this.cam.view;
        const near = this.cam.cur.dist * 1e-3;
        G.render(
          this.canvas.width,
          this.canvas.height,
          this.cam.focal,
          vx + vw / 2,
          vy + vh / 2,
          [this.cam.right, this.cam.up, this.cam.fwd],
          performance.now() / 1000,
          { near, far: near * 1e12 },
        );
      }
    }
  }

  private draw2d(i: Info, t0: number, G: MapGpu | null) {
    const c = this.canvas;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 260) * dpr);
    const ch = Math.round((c.clientHeight || 250) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    this.cam.resize(cw, ch);
    const ins = this.host.mapView() ? this.host.insets?.() : null;
    this.cam.inset((ins?.l ?? 0) * dpr, (ins?.r ?? 0) * dpr, (ins?.t ?? 0) * dpr, (ins?.b ?? 0) * dpr);
    this.syncLegend(!!(i.ref && i.X), ins ?? null);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    const pt = this.paint;
    pt.G = G;
    this.lastInfo = i;
    this.bodyHits = [];
    this.pathHits = [];
    const s = this.host.s;
    const ours = !!(i.ref && i.X);
    if (!ours && (i.region !== "hole" || !i.X)) {
      ctx.fillStyle = "rgba(220, 225, 235, 0.8)";
      ctx.font = `600 ${12.2 * dpr}px ${FONT}`;
      ctx.textAlign = "center";
      const [vx, vy, vw, vh] = this.cam.view;
      ctx.fillText(tf("In the wormhole · ℓ = {0} M", i.ell.toFixed(2)), vx + vw / 2, vy + vh / 2);
      this.moving = false;
      return;
    }
    const universe: Universe = ours ? "ours" : "gargantua";
    const cm = !ours && s.sun && s.sunMass > 0 && this.frame === "cm";
    // ---- the timeline: the preview's time (the positions shown), played on at 1/8 of the span a second
    const nowWall = performance.now();
    const dtWall = Math.min((nowWall - this.lastWall) / 1000, 0.1);
    const span = this.span > 0 ? this.span : this.autoSpan(i, t0, ours);
    if (this.playing) {
      this.preview += (span / 8) * dtWall;
      if (this.preview >= span) (this.preview = span), (this.playing = false);
    }
    this.preview = clamp(this.preview, 0, span);
    const tp = t0 + this.preview;
    const previewing = this.preview > 0;
    const sc = (this.scene = ours ? ourScene(tp) : theirScene(s, tp, cm));
    const fresh = this.universe !== universe;
    if (fresh) {
      this.universe = universe;
      this.focus = null;
      this.plane = "system";
      this.autoDist = true;
      this.panOff = [0, 0, 0];
      this.cam.goal.pitch = 0.62;
      this.cam.goal.yaw = -0.5;
    }
    // the ship (now, or where its path takes it at the preview's time), its velocity relative to its primary (map frame)
    const shipNow: V3 = ours ? [...i.X!] : sub(i.X!, sc.origin(t0));
    const later = previewing ? this.shipAt(i, tp, t0, ours, sc) : null;
    // (the frame the ship goes through the wormhole, its primary may still be of the other side)
    const refState = ours && i.ref && solarBody(i.ref) ? solarState(i.ref, t0) : null;
    const ship: V3 = later ? later.X : shipNow;
    const shipVel: V3 = later ? later.V : ours ? (refState ? sub(i.V!, refState.vel) : [...i.V!]) : i.V ? [...i.V] : [0, 0, 0];
    const refId = later?.ref ?? i.ref;
    const refPos: V3 = ours ? solarState(refId ?? "sun", tp).pos : sc.byId.get("hole")!.pos;
    const marks = this.marks(i, t0, ours, sc);

    // ---- the focus, the plane, the scale
    let fid = this.currentFocus();
    if (fid !== "ship" && !sc.byId.has(fid)) fid = this.homeFocus();
    const fb = fid === "ship" ? null : sc.byId.get(fid)!;
    const F: V3 = fb ? fb.pos : ship;
    this.cam.goal.focus = add(F, this.panOff);
    const [pe1, pe2, pn] = this.planeAxes(sc, i, fb, ship, shipVel, refPos);
    this.cam.setPlane(pe1, pe2, pn);
    this.log = this.isLog();
    this.r0 = ours ? 5 * (fb?.radius ?? sc.byId.get(i.ref!)?.radius ?? 1e-4) : 1;
    const g = (R: number) => (this.log ? this.r0 * Math.log1p(R / this.r0) : R);
    const reach = this.reach(sc, i, fid, fb, F, ship, ours, t0);
    this.cam.minDist = Math.max(g((fb?.radius ?? 1e-7) * 1.6), 1e-9);
    this.cam.maxDist = g(ours ? 400 : 4e5) * 3;
    if (this.autoDist) this.cam.goal.dist = clamp((g(reach) / Math.tan(this.cam.fov / 2)) * 1.08, this.cam.minDist, this.cam.maxDist);
    if (fresh) this.cam.snap();
    this.lastWall = nowWall;
    this.moving = this.cam.update(dtWall);
    this.W = [...this.cam.cur.focus];

    // ---- projection (the log scale's warp about the camera's focus)
    const cam = this.cam;
    const near = cam.cur.dist * 1e-3;
    const pw = (X: V3): V3 => {
      if (!this.log) return X;
      const d = sub(X, this.W);
      const R = len(d);
      return R < 1e-30 ? X : add(this.W, scale(d, g(R) / R));
    };
    const P = (X: V3): Proj => {
      const p = cam.project(pw(X));
      return { ...p, ok: p.z > near };
    };
    // (a sphere's radius in the warped space: its radial extent g(d + R) − g(d))
    const rw = (X: V3, R: number) => {
      if (!this.log) return R;
      const d = len(sub(X, this.W));
      return g(d + R) - g(d);
    };
    // (dimmer beyond the focus: depth)
    const depthA = (z: number) => clamp(1.25 - (0.45 * (z - cam.cur.dist)) / cam.cur.dist, 0.3, 1);
    // the spheres that hide what passes behind them: their discs on the screen and their depth (a
    // point inside a disc and deeper than the sphere's centre is behind it)
    const occluders: { x: number; y: number; r: number; z: number }[] = [];
    for (const b of sc.bodies) {
      if (b.kind === "mouth") continue;
      const p = P(b.pos);
      if (!p.ok) continue;
      const r = rw(b.pos, b.radius) * p.k;
      if (r > 3 * dpr) occluders.push({ x: p.x, y: p.y, r, z: p.z });
    }
    const hidden = (x: number, y: number, z: number) => {
      for (const o of occluders) if (z > o.z && (x - o.x) ** 2 + (y - o.y) ** 2 < o.r * o.r) return true;
      return false;
    };
    // (the GPU's bodies are solid: what they hide is not drawn, the grid cut round them)
    const hideK = 0.22;

    // ---- the reference plane's grid (around the focus; on the GPU, hidden behind the bodies by depth)
    this.drawGrid(ctx, cw, ch, dpr, pe1, pn, g, ours);

    // a polyline (its points offset by off), depth-cued, broken behind the camera, faint where a body hides it
    // — on the GPU: anti-aliased, hidden pixel by pixel where a body stands in front of it
    const line = (pts: V3[], col: string, a: number, w: number, dash: number[] = [], occl = true, off?: V3) => {
      if (pts.length < 2) return;
      if (G) {
        G.line(
          col,
          w * dpr,
          dash.map((d) => d * dpr),
        );
        const q: V3 = [0, 0, 0];
        for (const X of pts) {
          if (off) (q[0] = X[0] + off[0]), (q[1] = X[1] + off[1]), (q[2] = X[2] + off[2]);
          const p = P(off ? q : X);
          if (p.ok) G.to(p.x, p.y, p.z, a * depthA(p.z));
          else G.gap();
        }
        G.gap();
        return;
      }
      ctx.lineWidth = w * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      let prev: Proj | null = null;
      let state = -1;
      let open = false;
      const flush = () => {
        if (open) ctx.stroke();
        open = false;
      };
      const q: V3 = [0, 0, 0];
      for (let j = 0; j < pts.length; j++) {
        const X = pts[j]!;
        if (off) (q[0] = X[0] + off[0]), (q[1] = X[1] + off[1]), (q[2] = X[2] + off[2]);
        const p = P(off ? q : X);
        if (!p.ok) {
          flush();
          prev = null;
          continue;
        }
        if (prev) {
          const hid = occl && occluders.length > 0 && hidden((p.x + prev.x) / 2, (p.y + prev.y) / 2, (p.z + prev.z) / 2);
          const alpha = a * depthA(p.z) * (hid ? hideK : 1);
          const st = Math.round(alpha * 20);
          if (st !== state || !open) {
            flush();
            state = st;
            ctx.strokeStyle = `rgba(${col}, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            open = true;
          }
          ctx.lineTo(p.x, p.y);
        }
        prev = p;
      }
      flush();
      ctx.setLineDash([]);
    };
    const circle3 = (C: V3, R: number, n: V3, steps = 96): V3[] => {
      const [e1, e2] = planeBasis(n);
      return Array.from({ length: steps + 1 }, (_, j) => {
        const a = (j / steps) * 2 * Math.PI;
        return add(C, add(scale(e1, R * Math.cos(a)), scale(e2, R * Math.sin(a))));
      });
    };
    const labels: MapLabel[] = [];

    // ---- the hole (theirs): the disk, its rings, the horizon
    if (sc.hole) {
      const H = sc.byId.get("hole")!.pos;
      const hl = sc.hole;
      if (hl.disk && !G) {
        const outer = circle3(H, hl.diskOuter, [0, 0, 1], 120).map((X) => P(X));
        const inner = circle3(H, hl.isco, [0, 0, 1], 72).map((X) => P(X));
        if (outer.every((p) => p.ok)) {
          ctx.beginPath();
          outer.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          for (let j = inner.length - 1; j >= 0; j--) ctx.lineTo(inner[j]!.x, inner[j]!.y);
          ctx.closePath();
          const pc = P(H);
          const gr = ctx.createRadialGradient(pc.x, pc.y, 0, pc.x, pc.y, Math.max(8, rw(H, hl.diskOuter) * pc.k));
          gr.addColorStop(0, "rgba(255, 190, 110, 0.32)");
          gr.addColorStop(1, "rgba(255, 120, 50, 0.06)");
          ctx.fillStyle = gr;
          ctx.fill("evenodd");
        }
      }
      // (the GPU draws the disk and the photon ring: the ISCO's circle alone, hidden behind the horizon)
      line(circle3(H, hl.isco, [0, 0, 1]), "120, 230, 150", 0.6, 1.1, [4, 3], !!G);
      if (!G) {
        line(circle3(H, hl.photon, [0, 0, 1]), "255, 220, 120", 0.5, 1.1, [1.5, 2.5], false);
        line(circle3(H, 2, [0, 0, 1]), "150, 170, 255", 0.35, 1, [3, 3], false);
      }
    }

    // ---- orbits
    const tgt = i.target;
    for (const b of sc.bodies) {
      if (!b.orbit) continue;
      const par = b.parent ? sc.byId.get(b.parent) : null;
      // (a moon's orbit only once it spreads on the screen)
      if (par) {
        const pp = P(par.pos),
          pb = P(add(b.orbit[0]!, b.orbitOff));
        if (pp.ok && pb.ok && Math.hypot(pp.x - pb.x, pp.y - pb.y) < 9 * dpr && b.id !== tgt && b.id !== fid) continue;
      }
      const hi = b.id === tgt ? 0.75 : b.id === fid || b.id === i.ref ? 0.55 : b.kind === "moon" ? 0.22 : 0.32;
      line(b.orbit, b.id === tgt ? "255, 150, 100" : b.col, hi, b.id === tgt ? 1.5 : 1.1, [], true, b.orbitOff);
    }

    // ---- spheres of influence (the ship's own, the focus's, the target's; all with the setting)
    for (const b of sc.bodies) {
      if (!(b.soi > 0) || !Number.isFinite(b.soi)) continue;
      const mine = b.id === i.ref;
      if (!(s.soiRings || mine || b.id === fid || b.id === tgt)) continue;
      const p = P(b.pos);
      if (!p.ok) continue;
      const R = rw(b.pos, b.soi) * p.k;
      if (R < 6 * dpr || R > 6 * Math.max(cw, ch)) continue;
      // (a faint fill: the sphere reads as a volume; its rim dashed)
      pt.soft(p.x, p.y, R * 0.6, R, b.col, mine ? 0.06 : 0.03);
      pt.disc(p.x, p.y, R, null, `rgba(${b.col}, ${mine ? 0.55 : 0.22})`, (mine ? 1.3 : 1) * dpr, [3 * dpr, 4 * dpr]);
    }

    // ---- bodies, back to front
    const list = sc.bodies
      .map((b) => ({ b, p: P(b.pos) }))
      .filter((q) => q.p.ok)
      .sort((a, b) => b.p.z - a.p.z);
    for (const { b, p } of list) {
      const moon = b.kind === "moon";
      if (moon) {
        // (a moon hidden in its planet's dot until the two spread apart)
        const pp = b.parent ? P(sc.byId.get(b.parent)!.pos) : null;
        if (pp && pp.ok && Math.hypot(pp.x - p.x, pp.y - p.y) < 6 * dpr && b.id !== tgt && b.id !== fid) continue;
      }
      if (p.x < -60 * dpr || p.y < -60 * dpr || p.x > cw + 60 * dpr || p.y > ch + 60 * dpr) continue;
      const r = rw(b.pos, b.radius) * p.k;
      // (on the GPU: textured, lit — the station and the craft stay the canvas's dots)
      const craft = ["iss", "ranger", "lander", "endurance"].includes(b.id);
      if (G && craft) pt.disc(p.x, p.y, Math.max(r, 3.2 * dpr), `rgba(${b.col}, 0.95)`, "rgba(0, 0, 0, 0.5)", 1 * dpr);
      else if (!G || !this.gpuBody(G, sc, b, tp, dpr, pw, rw)) this.drawBody(ctx, sc, b, p, r, dpr, pw, rw);
      const shown = Math.max(r, b.kind === "star" ? 5 * dpr : moon ? 2 * dpr : 3.2 * dpr);
      this.bodyHits.push({ id: b.id, x: p.x, y: p.y, r: shown });
      if (b.id === tgt) pt.disc(p.x, p.y, shown + 5 * dpr, null, "rgba(255, 138, 92, 0.95)", 1.4 * dpr);
      const prio = b.id === fid ? 5 : b.id === tgt ? 4 : b.id === i.ref ? 3 : b.kind === "moon" ? 1 : 2;
      labels.push({
        text: b.name,
        x: p.x + shown + 4 * dpr,
        y: p.y - 3 * dpr,
        col: b.col,
        prio,
        size: moon ? 8.5 : 9.5,
        weight: moon ? 500 : 600,
        ax: p.x,
        ay: p.y,
        ar: shown + 3 * dpr,
      });
    }

    // ---- stems: the ship and the target down to the reference plane (above: solid; below: dashed)
    const stem = (X: V3, col: string) => {
      const Xw = pw(X);
      const hgt = dot(sub(Xw, this.W), pn);
      const foot = sub(Xw, scale(pn, hgt));
      const a = cam.project(Xw),
        b = cam.project(foot);
      if (a.z <= near || b.z <= near || Math.hypot(a.x - b.x, a.y - b.y) < 4 * dpr) return;
      pt.path(
        [
          [a.x, a.y],
          [b.x, b.y],
        ],
        `rgba(${col}, 0.45)`,
        1 * dpr,
        hgt < 0 ? [2 * dpr, 3 * dpr] : undefined,
      );
      // (its foot: a small ellipse in the plane)
      const ring = circle3(foot, cam.cur.dist * 0.012, pn, 24).map((q) => cam.project(q));
      if (ring.every((q) => q.z > near))
        pt.path(
          ring.map((q) => [q.x, q.y] as const),
          `rgba(${col}, 0.5)`,
          1 * dpr,
        );
    };
    if (Math.abs(this.cam.cur.pitch) < 1.45) {
      stem(ship, "124, 214, 255");
      const tb = sc.byId.get(tgt);
      if (tb && tb.id !== fid) stem(tb.pos, "255, 138, 92");
    }

    // ---- paths
    if (ours) this.drawOurPaths(ctx, i, sc, t0, tp, fid, fb, dpr, P, line, labels, pn);
    else this.drawTheirPaths(ctx, i, sc, t0, dpr, P, line, labels, pn, cm);

    // ---- the preview: where things are now (faint rings), the trails the bodies follow until then
    if (previewing) this.drawGhosts(ctx, sc, i, fid, t0, tp, shipNow, P, dpr, G);

    // ---- the ship
    this.drawShip(ctx, i, ship, shipVel, P, dpr, ours);
    if (previewing) {
      const q = P(ship);
      const how = later?.beyond
        ? later.conics
          ? ` · ${t("end of the conics")}`
          : ` · ${t("end of the prediction")}`
        : later?.conics
          ? ` · ${t("conics")}`
          : later
            ? ""
            : ` · ${t("no prediction")}`;
      if (q.ok)
        labels.push({
          text: `T+${fmtDur(this.preview, s)}${how}`,
          x: q.x + 14 * dpr,
          y: q.y + 14 * dpr,
          col: "255, 200, 90",
          prio: 5,
          size: 9,
          weight: 700,
          ax: q.x,
          ay: q.y,
          ar: 5 * dpr,
        });
    }

    // ---- labels, kept apart (the focus and the target first)
    this.placeLabels(ctx, labels, dpr, P(ship));

    // ---- the card of the body under the pointer
    if (this.hover && !this.gizmo && !this.nodeDrag) {
      const id = this.bodyAt(this.hover.x, this.hover.y);
      const b = id ? sc.byId.get(id) : null;
      if (b) this.drawCard(ctx, b, sc, ship, i, ours, cw, ch, dpr);
    }

    // ---- the footer: date, focus, plane, scale bar at the focus's depth
    this.drawFooter(ctx, tp, cw, ch, dpr, ours);
    this.renderCrumbs(sc, fid);
    this.syncBar(sc, fid);
    this.syncTimeline(
      t0,
      span,
      marks,
      ours,
      later?.beyond ? (later.conics ? t("end of the conics") : t("beyond the prediction")) : later?.conics ? t("conics (Kepler)") : "",
    );
  }

  /** The reference plane's axes (e1 towards a fixed direction, n its normal). */
  private planeAxes(sc: MapScene, i: Info, fb: MapBody | null, ship: V3, shipVel: V3, refPos: V3): [V3, V3, V3] {
    let n = sc.systemPole;
    if (this.plane === "equator") {
      const b = fb ?? (i.ref ? sc.byId.get(i.ref) : null);
      if (b) n = b.pole;
    } else if (this.plane === "orbit") {
      const hv = cross(sub(ship, refPos), shipVel);
      if (len(hv) > 0) n = norm(hv);
    } else if (this.plane === "target") {
      const b = sc.byId.get(i.target);
      if (b?.orbit && b.orbit.length > 3) {
        const par = b.parent ? sc.byId.get(b.parent) : null;
        const c = par?.pos ?? [0, 0, 0];
        const hv = cross(sub(add(b.orbit[0]!, b.orbitOff), c), sub(add(b.orbit[Math.floor(b.orbit.length / 8)]!, b.orbitOff), c));
        if (len(hv) > 0) n = norm(hv);
      }
    }
    // (x: the system's reference direction, projected into the plane — the view keeps its bearing)
    return planeBasis(n, sc.systemX);
  }

  /** How far from the focus the content worth framing reaches [M]. */
  private reach(sc: MapScene, i: Info, fid: string, fb: MapBody | null, F: V3, ship: V3, ours: boolean, t0: number) {
    const dist = (X: V3) => len(sub(X, F));
    if (!ours) {
      // (a world, the ship about it: the world, the ship's orbit, the preview — not its whole Hill sphere)
      if (fid !== "hole" && fb && dist(ship) < (Number.isFinite(fb.soi) ? fb.soi : fb.radius * 60)) {
        let rw = Math.max(fb.radius * 2.4, dist(ship) * 1.25);
        if (i.path?.fate === "local")
          for (let j = 0; j < i.path.pts.length; j += 3) rw = Math.max(rw, dist(sub(i.path.pts[j]!, sc.origin(t0))) * 1.1);
        const cl = i.cand?.local;
        if (cl && cl.world === fb.id) for (let j = 0; j < cl.pts.length; j += 3) rw = Math.max(rw, len(cl.pts[j]!) * 1.1);
        return rw;
      }
      let r = Math.max(dist(ship), 6);
      const hl = sc.hole;
      if (hl?.disk && fid === "hole") r = Math.max(r, hl.diskOuter);
      if (fid !== "hole" && fb) r = Math.min(Math.max(r, fb.radius * 30), Math.max(fb.soi * 2, dist(ship) * 1.3, fb.radius * 30));
      if (i.path && fid === "hole")
        for (let j = 0; j < i.path.pts.length; j += 4) r = Math.max(r, dist(sub(i.path.pts[j]!, sc.origin(t0 + (j + 1) * i.path.dt))));
      // (the preview's path, wherever it goes)
      const cp = i.cand?.kerr ?? i.cand?.local;
      if (cp) for (let j = 0; j < cp.pts.length; j += 4) r = Math.max(r, dist(sub(cp.pts[j]!, sc.origin(cp.times[j]!))));
      const tb = sc.byId.get(i.target);
      if (tb && fid === "hole") r = Math.max(r, dist(tb.pos));
      return r * 1.1;
    }
    if (fid === "ship") {
      const ref = i.ref ? sc.byId.get(i.ref) : null;
      return ref ? Math.max(dist(ref.pos) * 1.3, ref.radius * 4) : 0.1;
    }
    if (!fb) return 1;
    if (fb.id === "sun") {
      if (this.focus === "sun") return 31 * 1.0131;
      let rr = dist(ship);
      for (const p of [i.ourFree, i.ourPlan, i.cand?.ours]) {
        if (!p) continue;
        for (let j = 0; j < p.pts.length; j += 4) rr = Math.max(rr, len(sub(p.pts[j]!, solarState("sun", p.times[j]!).pos)));
      }
      const tb = sc.byId.get(i.target);
      if (tb && tb.id !== "sun") rr = Math.max(rr, dist(tb.pos));
      return Math.min(31 * 1.0131, Math.max(rr * 1.1, 0.5));
    }
    const cap = Number.isFinite(fb.soi) ? fb.soi * 3 : 50;
    // (the ship within reach: it and its paths; far away: the body and its moons)
    const moons = sc.bodies.filter((b) => b.parent === fb.id);
    const shipNear = dist(ship) < cap;
    let r = shipNear
      ? Math.max(fb.radius * 2.4, dist(ship) * 1.25)
      : Math.max(fb.radius * 12, moons.length ? Math.min(Math.max(...moons.map((m) => dist(m.pos))) * 1.15, fb.radius * 30) : 0);
    for (const p of solarBody(fb.id) ? [i.ourFree, i.ourPlan, i.cand?.ours] : []) {
      if (!p) continue;
      for (let j = 0; j < p.pts.length; j += 4) {
        const q = solarState(fb.id, p.times[j]!).pos;
        const d = len(sub(p.pts[j]!, q));
        if (d < cap && shipNear) r = Math.max(r, d * 1.1);
      }
    }
    return r;
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number,
    dpr: number,
    e1: V3,
    n: V3,
    g: (R: number) => number,
    ours: boolean,
  ) {
    const cam = this.cam;
    const W = this.W;
    const e2 = cross(n, e1);
    const D = cam.cur.dist;
    // rings: nice steps of the true distance (their radius warped with the log scale)
    const radii: { r: number; R: number }[] = [];
    if (this.log) {
      for (let j = 0; j <= 7; j++) {
        const R = this.r0 * 10 ** j;
        if (g(R) < D * 3) radii.push({ r: g(R), R });
      }
    } else {
      const step = niceStep(D * 0.35);
      for (let j = 1; j <= 8; j++) radii.push({ r: step * j, R: step * j });
    }
    const near = D * 1e-3;
    const edge = Math.abs(Math.sin(cam.cur.pitch));
    const baseA = 0.05 + 0.08 * edge;
    ctx.lineWidth = 1 * dpr;
    const G = this.paint.G;
    for (const { r, R } of radii) {
      const fade = clamp(1.6 - r / (D * 1.6), 0, 1);
      ctx.beginPath();
      G?.line("124, 214, 255", 1 * dpr);
      let open = false;
      for (let j = 0; j <= 96; j++) {
        const a = (j / 96) * 2 * Math.PI;
        const X = add(W, add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a))));
        const p = cam.project(X);
        if (p.z <= near) {
          open = false;
          G?.gap();
          continue;
        }
        if (G) G.to(p.x, p.y, p.z, baseA * fade);
        else if (open) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        open = true;
      }
      G?.gap();
      if (!G) {
        ctx.strokeStyle = `rgba(124, 214, 255, ${(baseA * fade).toFixed(3)})`;
        ctx.stroke();
      }
      // its radius, along the reference direction
      const lp = cam.project(add(W, scale(e1, r)));
      if (lp.z > near && fade > 0.2 && lp.x > 0 && lp.x < cw && lp.y > 0 && lp.y < ch) {
        ctx.fillStyle = `rgba(124, 214, 255, ${(0.35 * fade).toFixed(3)})`;
        ctx.font = `${8 * dpr}px ${MONO}`;
        ctx.textAlign = "left";
        ctx.fillText(fmtDist(R, ours, this.host.s), lp.x + 3 * dpr, lp.y - 3 * dpr);
      }
    }
    // spokes every 30°, the reference direction brighter (the vernal equinox ♈ / the map's +x)
    const Rmax = radii.length ? radii[radii.length - 1]!.r : D;
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * 2 * Math.PI;
      const d = add(scale(e1, Math.cos(a)), scale(e2, Math.sin(a)));
      const p0 = cam.project(add(W, scale(d, Rmax * 0.04))),
        p1 = cam.project(add(W, scale(d, Rmax)));
      if (p0.z <= near || p1.z <= near) continue;
      const a0 = j === 0 ? 0.28 : 0.1 * (0.4 + edge);
      if (G) {
        // (fading out along: a few points, the depth right along it)
        G.line("124, 214, 255", 1 * dpr);
        for (let k = 0; k <= 8; k++) {
          const q = cam.project(add(W, scale(d, Rmax * (0.04 + 0.96 * (k / 8)))));
          if (q.z > near) G.to(q.x, q.y, q.z, a0 * (1 - k / 8));
        }
        G.gap();
      } else {
        const gr = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
        gr.addColorStop(0, `rgba(124, 214, 255, ${a0})`);
        gr.addColorStop(1, "rgba(124, 214, 255, 0)");
        ctx.strokeStyle = gr;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      if (j === 0 && p1.x > 0 && p1.x < cw && p1.y > 0 && p1.y < ch) {
        ctx.fillStyle = "rgba(124, 214, 255, 0.4)";
        ctx.font = `600 ${11 * dpr}px ${FONT}`;
        ctx.fillText(ours ? "♈" : "+x", p1.x + 3 * dpr, p1.y);
      }
    }
  }

  /** A body: a lit sphere (a dot when too small), a star's glow, the hole, rings in front and behind. */
  private drawBody(
    ctx: CanvasRenderingContext2D,
    sc: MapScene,
    b: MapBody,
    p: Proj,
    r: number,
    dpr: number,
    pw: (X: V3) => V3,
    rw: (X: V3, R: number) => number,
  ) {
    const cam = this.cam;
    if (b.kind === "hole") {
      const R = Math.max(r, 3 * dpr);
      const gl = ctx.createRadialGradient(p.x, p.y, R, p.x, p.y, R * 3.2);
      gl.addColorStop(0, "rgba(255, 170, 90, 0.35)");
      gl.addColorStop(1, "rgba(255, 170, 90, 0)");
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 3.2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, 2 * Math.PI);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 225, 190, 0.9)";
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
      return;
    }
    if (b.kind === "mouth") {
      const R = Math.max(r, 4 * dpr);
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, 2 * Math.PI);
      const gm = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      gm.addColorStop(0, "rgba(30, 10, 60, 0.9)");
      gm.addColorStop(1, "rgba(200, 140, 255, 0.35)");
      ctx.fillStyle = gm;
      ctx.fill();
      ctx.strokeStyle = "rgba(200, 140, 255, 0.95)";
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
      return;
    }
    if (b.kind === "star") {
      const R = Math.max(r, 5 * dpr);
      const gl = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, R * 4);
      gl.addColorStop(0, `rgba(${b.col}, 0.55)`);
      gl.addColorStop(1, `rgba(${b.col}, 0)`);
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * 4, 0, 2 * Math.PI);
      ctx.fill();
      const gd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      gd.addColorStop(0, "rgba(255, 255, 245, 1)");
      gd.addColorStop(1, `rgba(${b.col}, 1)`);
      ctx.fillStyle = gd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, 2 * Math.PI);
      ctx.fill();
      return;
    }
    // the rings behind the planet
    const ringParts = b.rings && r > 2.5 * dpr ? this.ringQuads(b, pw, rw) : null;
    const drawRings = (front: boolean) => {
      if (!ringParts) return;
      const cz = cam.project(pw(b.pos)).z;
      ctx.fillStyle = "rgba(225, 205, 160, 0.38)";
      for (const q of ringParts) {
        const pts = q.map((X) => cam.project(X));
        if (pts.some((x) => x.z <= 0)) continue;
        const z = (pts[0]!.z + pts[2]!.z) / 2;
        if (z < cz !== front) continue;
        ctx.beginPath();
        pts.forEach((x, j) => (j ? ctx.lineTo(x.x, x.y) : ctx.moveTo(x.x, x.y)));
        ctx.closePath();
        ctx.fill();
      }
    };
    drawRings(false);
    const minR = b.kind === "moon" ? 2 * dpr : 3.2 * dpr;
    if (r < minR) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, minR, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(${b.col}, 0.95)`;
      ctx.fill();
    } else {
      // lit from its star: the light's direction on screen, the night side dark
      const src = b.light ? sc.byId.get(b.light)?.pos : null;
      const L = src ? norm(sub(src, b.pos)) : norm(scale(cam.fwd, -1));
      const lx = dot(L, cam.right),
        ly = -dot(L, cam.up),
        lz = -dot(L, cam.fwd);
      const cx = p.x + lx * r * 0.55,
        cy = p.y + ly * r * 0.55;
      const gs = ctx.createRadialGradient(cx, cy, r * 0.05, p.x - lx * r * 0.3, p.y - ly * r * 0.3, r * 1.35);
      const lit = 0.55 + 0.45 * Math.max(lz, 0);
      gs.addColorStop(0, `rgba(${b.col}, 1)`);
      gs.addColorStop(
        0.45,
        `rgba(${b.col
          .split(",")
          .map((v) => Math.round(+v * lit * 0.8))
          .join(",")}, 1)`,
      );
      gs.addColorStop(1, "rgba(6, 8, 12, 1)");
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = gs;
      ctx.fill();
      if (b.air) {
        const ga = ctx.createRadialGradient(p.x, p.y, r * 0.92, p.x, p.y, r * 1.12);
        ga.addColorStop(0, `rgba(${b.col}, 0)`);
        ga.addColorStop(0.5, `rgba(${b.col}, 0.35)`);
        ga.addColorStop(1, `rgba(${b.col}, 0)`);
        ctx.fillStyle = ga;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.12, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    drawRings(true);
  }

  /** Saturn's rings as quads in its equator (warped space). */
  private ringQuads(b: MapBody, pw: (X: V3) => V3, rw: (X: V3, R: number) => number): V3[][] {
    const [e1, e2] = planeBasis(b.pole);
    const C = pw(b.pos);
    const k = rw(b.pos, b.radius) / b.radius;
    const r1 = b.rings!.inner * b.radius * k,
      r2 = b.rings!.outer * b.radius * k;
    const n = 48;
    const out: V3[][] = [];
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * 2 * Math.PI,
        a1 = ((j + 1) / n) * 2 * Math.PI;
      const at = (r: number, a: number) => add(C, add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a))));
      out.push([at(r1, a0), at(r2, a0), at(r2, a1), at(r1, a1)]);
    }
    return out;
  }

  /** The legend: what each line and mark of the map is, for the universe shown. */
  private legend = h("div", "m3-legend");
  private legendKey = "";
  private showLegend(on: boolean) {
    this.legend.hidden = !on;
    this.btns.legend?.classList.toggle("on", on);
    store.set("kerr.map-legend", on ? "1" : "0");
  }
  private syncLegend(ours: boolean, ins: { r: number; t: number } | null) {
    this.btns.legend?.classList.toggle("on", !this.legend.hidden);
    if (this.legend.hidden) return;
    const st = this.legend.style;
    const r = `${(ins?.r ?? 0) + 8}px`,
      top = `${(ins?.t ?? 0) + 8}px`;
    if (st.right !== r) st.right = r;
    if (st.top !== top) st.top = top;
    const key = ours ? "ours" : "theirs";
    if (key === this.legendKey) return;
    this.legendKey = key;
    // (a line: its colour, its dashes; a mark: a small drawing)
    const ln = (col: string, dash = "", w = 1.8) =>
      `<svg viewBox="0 0 28 8"><path d="M1 4h26" stroke="rgb(${col})" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="round"/></svg>`;
    const mk = (body: string) => `<svg viewBox="0 0 28 12">${body}</svg>`;
    const rows: [string, string][] = ours
      ? [
          [ln("90, 220, 255"), t("The ship's path — predicted, every body's pull")],
          [ln("255, 170, 80", "5 3"), t("The plan — after its burns")],
          [ln(CAND, "8 4", 2.2), t("Preview — a plan not yet adopted")],
          [ln("170, 205, 255", "2 4", 1.3), t("Beyond: patched conics")],
          [ln("255, 154, 74", "7 4", 2.2), t("Entry — the fall to the site")],
          [ln("255, 150, 100"), t("The target's orbit")],
          [ln("150, 170, 200", "3 4", 1.2), t("Sphere of influence")],
        ]
      : [
          [ln("124, 214, 255", "", 1.4), t("The ship's wake")],
          [ln("255, 190, 80", "5 3"), t("Its geodesic ahead — red: into the horizon")],
          [ln("255, 170, 80", "5 3"), t("The plan — after its burns")],
          [ln(CAND, "8 4", 2.2), t("Preview — a plan not yet adopted")],
          [ln("170, 205, 255", "2 4", 1.3), t("Beyond: conics")],
          [ln("120, 230, 150", "4 3", 1.1), t("ISCO — the last stable circle")],
          [ln("255, 211, 107", "4 3", 1.5), t("The companion star ahead")],
        ];
    const marks: [string, string][] = [
      [
        mk('<path d="M8 2l5 8H3z" fill="rgb(111,227,161)"/><path d="M20 10l5-8H15z" fill="rgb(255,179,92)"/>'),
        t("Ascending · descending node"),
      ],
      [
        mk('<circle cx="8" cy="6" r="2.6" fill="rgb(159,227,255)"/><circle cx="20" cy="6" r="2.6" fill="rgb(184,212,255)"/>'),
        t("Periapsis, apoapsis"),
      ],
      [
        mk('<path d="M14 0.5l5.5 5.5-5.5 5.5-5.5-5.5z" fill="#2fa4d0" stroke="#04121a" stroke-width="1.2"/>'),
        t("A burn — drag its handles"),
      ],
      [
        mk(
          '<path d="M3 6h22" stroke="rgb(255,138,92)" stroke-width="1.2" stroke-dasharray="2 2"/><circle cx="24" cy="6" r="3.4" fill="none" stroke="rgb(255,138,92)" stroke-width="1.2"/>',
        ),
        t("Closest approach (CA)"),
      ],
      [mk('<path d="M14 1l5 9H9z" fill="#ffc85a" stroke="rgba(0,0,0,.6)"/>'), t("The ship")],
    ];
    const row = ([a, b]: [string, string]) => `<div class="m3-lg-row">${a}<span>${b}</span></div>`;
    this.legend.innerHTML = `<div class="m3-lg-head">${t("Legend")}</div>${rows.map(row).join("")}<div class="m3-lg-sep"></div>${marks.map(row).join("")}<div class="m3-lg-hint">${t("Hover a body: its card · click: target · double-click: focus")}</div>`;
  }

  /**
   * The labels, kept apart: the most important first; each tried where it was asked, then round its
   * anchor (right, left, above, below, the corners), away from the labels already drawn, the bodies'
   * discs, the ship's mark and the view's edges (the panels'). A label that fits nowhere: left out — unless it matters
   * (priority ≥ 4: drawn where it overlaps least). Each on a dark halo (read over a lit planet).
   */
  private placeLabels(ctx: CanvasRenderingContext2D, labels: MapLabel[], dpr: number, ship: Proj) {
    type Box = [number, number, number, number];
    // (the view: the free middle between the panels, full screen)
    const [vx, vy, vw, vh] = this.cam.view;
    labels.sort((a, b) => b.prio - a.prio);
    const boxes: Box[] = [];
    const seen: { val: string; x: number; y: number }[] = [];
    const discs = this.bodyHits.filter((q) => q.r > 3 * dpr).map((q) => ({ x: q.x, y: q.y, r: q.r + 1.5 * dpr }));
    if (ship.ok) discs.push({ x: ship.x, y: ship.y, r: 10 * dpr });
    const over = (a: Box, b: Box) =>
      Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
      Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    const onDisc = (b: Box, d: { x: number; y: number; r: number }) => {
      const nx = Math.min(Math.max(d.x, b[0]), b[0] + b[2]),
        ny = Math.min(Math.max(d.y, b[1]), b[1] + b[3]);
      return Math.hypot(nx - d.x, ny - d.y) < d.r;
    };
    ctx.textAlign = "left";
    ctx.lineJoin = "round";
    for (const l of labels) {
      ctx.font = `${Math.max(Number(l.weight) || 600, 600)} ${l.size * 1.2 * dpr}px ${FONT}`;
      const w = ctx.measureText(l.text).width;
      const hgt = l.size * 1.2 * dpr;
      const at = (x: number, y: number): Box => [x - 2 * dpr, y - hgt * 0.82, w + 4 * dpr, hgt * 1.05];
      // (where it may go: as asked, then round its anchor; or nudged up and down)
      const spots: [number, number][] = [[l.x, l.y]];
      if (l.ax !== undefined && l.ay !== undefined) {
        const g = (l.ar ?? 4 * dpr) + 2 * dpr,
          mid = l.ay + hgt * 0.32,
          d = g * 0.72;
        spots.push(
          [l.ax + g, mid],
          [l.ax - g - w, mid],
          [l.ax - w / 2, l.ay - g],
          [l.ax - w / 2, l.ay + g + hgt * 0.7],
          [l.ax + d, l.ay - d],
          [l.ax - d - w, l.ay - d],
          [l.ax + d, l.ay + d + hgt * 0.7],
          [l.ax - d - w, l.ay + d + hgt * 0.7],
        );
      } else spots.push([l.x, l.y - hgt * 1.1], [l.x, l.y + hgt * 1.1]);
      // (the same apsis named twice — the prediction's and the conics' —: once)
      const val = /\b(Pe|Ap) [^·]+$/.exec(l.text)?.[0];
      if (val && l.ax !== undefined && seen.some((q) => q.val === val && Math.hypot(q.x - l.ax!, q.y - l.ay!) < 40 * dpr)) continue;
      let best: { x: number; y: number; cost: number; hard: number } | null = null;
      for (const [x, y] of spots) {
        const b = at(x, y);
        let lab = 0;
        for (const q of boxes) lab += over(b, q);
        const disc = discs.some((d) => onDisc(b, d)) ? 1 : 0;
        const out = b[0] < vx || b[1] < vy || b[0] + b[2] > vx + vw || b[1] + b[3] > vy + vh ? 1 : 0;
        // (an overlap or the edge: hard; a body's disc under it: only if nowhere else — a planet filling
        // the view keeps its low orbit's labels)
        const hard = lab + out * b[2] * b[3];
        const cost = hard * 4 + disc;
        if (!best || cost < best.cost) best = { x, y, cost, hard };
        if (cost === 0) break;
      }
      if (!best || (best.hard > 0 && l.prio < 4)) continue;
      boxes.push(at(best.x, best.y));
      if (val && l.ax !== undefined) seen.push({ val, x: l.ax, y: l.ay! });
      ctx.strokeStyle = "rgba(3, 6, 12, 0.7)";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeText(l.text, best.x, best.y);
      ctx.fillStyle = `rgba(${l.col}, ${l.prio >= 3 ? 0.97 : 0.82})`;
      ctx.fillText(l.text, best.x, best.y);
    }
  }

  /** An ✕: an impact. */
  private cross(x: number, y: number, r: number, col: string, lw: number) {
    this.paint.path(
      [
        [x - r, y - r],
        [x + r, y + r],
      ],
      col,
      lw,
    );
    this.paint.path(
      [
        [x + r, y - r],
        [x - r, y + r],
      ],
      col,
      lw,
    );
  }

  private drawShip(ctx: CanvasRenderingContext2D, i: Info, ship: V3, vel: V3, P: (X: V3) => Proj, dpr: number, ours: boolean) {
    const p = P(ship);
    if (!p.ok) return;
    // (a heading: the velocity on screen; theirs, the nose if any)
    const dir = ours ? vel : ((i.nose as V3 | null) ?? vel);
    let a = 0;
    const dl = len(dir);
    if (dl > 0) {
      const q = P(add(ship, scale(dir, (this.cam.cur.dist * 0.05) / dl)));
      if (q.ok && Math.hypot(q.x - p.x, q.y - p.y) > 0.5) a = Math.atan2(q.y - p.y, q.x - p.x);
    }
    const pt = this.paint;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    pt.disc(p.x, p.y, (9 + 4 * pulse) * dpr, null, `rgba(124, 214, 255, ${(0.25 + 0.2 * (1 - pulse)).toFixed(3)})`, 1 * dpr);
    // its velocity (a short tick, under the chevron)
    if (dl > 0 && ours) {
      const q = P(add(ship, scale(vel, (this.cam.cur.dist * 0.06) / dl)));
      if (q.ok) {
        const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        pt.path(
          [
            [p.x, p.y],
            [p.x + ((q.x - p.x) / l) * 20 * dpr, p.y + ((q.y - p.y) / l) * 20 * dpr],
          ],
          "rgba(124, 214, 255, 0.9)",
          1.4 * dpr,
        );
      }
    }
    // the chevron, turned to the heading
    const ca = Math.cos(a),
      sa = Math.sin(a);
    const turn = (x: number, y: number) => [(x * ca - y * sa) * dpr, (x * sa + y * ca) * dpr] as const;
    pt.poly(p.x, p.y, [turn(9, 0), turn(-5, 5.5), turn(-2.5, 0), turn(-5, -5.5)], "#ffc85a", "rgba(0, 0, 0, 0.6)", 1 * dpr);
  }

  /**
   * The preview's ghosts: the ship where it is now (a faint ring), and for the bodies that matter here
   * (the target, the ship's primary, the focus and its moons) where they are now and the arc they follow
   * until the preview's time.
   */
  private drawGhosts(
    ctx: CanvasRenderingContext2D,
    sc: MapScene,
    i: Info,
    fid: string,
    t0: number,
    tp: number,
    shipNow: V3,
    P: (X: V3) => Proj,
    dpr: number,
    G: MapGpu | null,
  ) {
    const s = this.host.s;
    const ring = (X: V3, col: string, r: number) => {
      const p = P(X);
      if (!p.ok) return null;
      this.paint.disc(p.x, p.y, r * dpr, null, `rgba(${col}, 0.55)`, 1 * dpr, [2 * dpr, 2 * dpr]);
      return p;
    };
    const sp = ring(shipNow, "124, 214, 255", 5);
    if (sp) {
      ctx.fillStyle = "rgba(124, 214, 255, 0.6)";
      ctx.font = `600 ${9.8 * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(t("now"), sp.x + 7 * dpr, sp.y + 3 * dpr);
    }
    const ids = new Set<string>([i.target, i.ref ?? "", fid]);
    for (const b of sc.bodies) if (b.parent === fid) ids.add(b.id);
    let n = 0;
    for (const id of ids) {
      const b = sc.byId.get(id);
      if (!b || b.kind === "hole" || n >= 8) continue;
      const now = bodyPosAt(sc, s, id, t0);
      if (!now) continue;
      const a = P(now),
        z = P(b.pos);
      if (!a.ok || !z.ok || Math.hypot(a.x - z.x, a.y - z.y) < 6 * dpr) continue;
      n++;
      // (its arc: up to a turn of its orbit)
      const T = Math.min(tp - t0, b.period ?? tp - t0);
      const steps = 32;
      ctx.beginPath();
      G?.line(b.col, 1.6 * dpr);
      let open = false;
      for (let j = 0; j <= steps; j++) {
        const t = tp - T + (T * j) / steps;
        const X = bodyPosAt(sc, s, id, t);
        const q = X ? P(X) : null;
        if (!q || !q.ok) {
          open = false;
          G?.gap();
          continue;
        }
        if (G) G.to(q.x, q.y, q.z, 0.55);
        else if (open) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
        open = true;
      }
      G?.gap();
      if (!G) {
        ctx.strokeStyle = `rgba(${b.col}, 0.55)`;
        ctx.lineWidth = 1.6 * dpr;
        ctx.stroke();
      }
      if (T >= tp - t0) ring(now, b.col, 3.5);
    }
  }

  /** Where a path crosses the reference plane (through the focus): AN going up, DN going down. */
  private crossings(ctx: CanvasRenderingContext2D, pts: V3[], P: (X: V3) => Proj, n: V3, dpr: number, labels: MapLabel[], from = 0) {
    if (this.plane === "orbit") return;
    const h0 = (X: V3) => dot(sub(X, this.W), n);
    let marks = 0;
    for (let j = from + 1; j < pts.length && marks < 4; j++) {
      const a = h0(pts[j - 1]!),
        b = h0(pts[j]!);
      if (a === 0 || Math.sign(a) === Math.sign(b)) continue;
      const f = a / (a - b);
      const X = add(pts[j - 1]!, scale(sub(pts[j]!, pts[j - 1]!), f));
      const p = P(X);
      if (!p.ok) continue;
      const up = b > a;
      marks++;
      const r = 4.5 * dpr;
      this.paint.poly(
        p.x,
        p.y,
        up
          ? [
              [0, -r],
              [r, r * 0.7],
              [-r, r * 0.7],
            ]
          : [
              [0, r],
              [r, -r * 0.7],
              [-r, -r * 0.7],
            ],
        up ? "rgba(111, 227, 161, 0.95)" : "rgba(255, 179, 92, 0.95)",
      );
      labels.push({
        text: up ? t("AN") : t("DN"),
        x: p.x + 6 * dpr,
        y: p.y + 3 * dpr,
        col: up ? "111, 227, 161" : "255, 179, 92",
        prio: 2,
        size: 8.5,
        weight: 700,
        ax: p.x,
        ay: p.y,
        ar: 5 * dpr,
      });
    }
  }

  private drawOurPaths(
    ctx: CanvasRenderingContext2D,
    i: Info,
    sc: MapScene,
    t0: number,
    tView: number,
    fid: string,
    fb: MapBody | null,
    dpr: number,
    P: (X: V3) => Proj,
    line: (pts: V3[], col: string, a: number, w: number, dash?: number[], occl?: boolean, off?: V3) => void,
    labels: MapLabel[],
    pn: V3,
  ) {
    const s = this.host.s;
    // (the paths in the frame of the focus body — or of the ship's primary when the ship is the focus:
    // where it is when the ship is there, drawn relative to where it is now)
    const f0 = fid === "ship" ? (i.ref ?? "sun") : fb?.id === "wormhole" ? "sun" : fid;
    const frameId = solarBody(f0) ? f0 : "sun";
    const F0 = solarState(frameId, tView).pos;
    const FA = (X: V3, t: number): V3 => {
      const q = solarState(frameId, t).pos;
      return [X[0] - q[0] + F0[0], X[1] - q[1] + F0[1], X[2] - q[2] + F0[2]];
    };
    // (a path relative to the frame's body, computed once per path — they change a few times a second)
    const rel = (p: OurPath): V3[] => {
      let c = this.relCache.get(p);
      if (!c || c.frame !== frameId) {
        const track = ourTrack(frameId, p.times);
        c = { frame: frameId, pts: p.pts.map((X, j) => sub(X, track[j]!)) };
        this.relCache.set(p, c);
      }
      return c.pts;
    };
    const tag = (X: V3, text: string, col: string, below = false, prio = 3) => {
      const p = P(X);
      if (!p.ok) return;
      this.paint.disc(p.x, p.y, 2.6 * dpr, `rgb(${col})`);
      labels.push({
        text,
        x: p.x + 5 * dpr,
        y: p.y + (below ? 12 : -5) * dpr,
        col,
        prio,
        size: 9,
        weight: 600,
        ax: p.x,
        ay: p.y,
        ar: 4 * dpr,
      });
    };
    const km = (d: number) => fmtDist(d, true, s);
    // the entry: the guidance's predicted fall and the site it flies to (relative to their body)
    const E = (i as { entry?: { body: string; path: V3[] | null; site: { name: string; X: V3 } | null; ours: boolean } | null }).entry;
    if (E && E.ours && solarBody(E.body)) {
      const Bp = solarState(E.body, tView).pos;
      const at = (x: V3): V3 => FA([Bp[0] + x[0], Bp[1] + x[1], Bp[2] + x[2]], tView);
      if (E.path && E.path.length > 1) line(E.path.map(at), "255, 154, 74", 0.95, 2.2, [7, 4]);
      if (E.site) tag(at(E.site.X), `◎ ${E.site.name}`, "255, 210, 122", true, 4);
    }
    // (an apsis a few pixels from its body's centre — an orbit too small on the screen: its label unread)
    const apart = (body: string, X: V3, t: number) => {
      if (!solarBody(body)) return true;
      const q = P(FA(X, t)),
        c = P(FA(solarState(body, t).pos, t));
      return !c.ok || !q.ok || Math.hypot(q.x - c.x, q.y - c.y) > 14 * dpr;
    };
    const apsides = (p: OurPath, from: number, label: string) => {
      const body = p.refs[from];
      if (!body || (body === "sun" && frameId !== "sun")) return;
      const key = `aps:${from}`;
      let memo = this.pathMemo.get(p);
      if (!memo) this.pathMemo.set(p, (memo = new Map()));
      if (!memo.has(key)) {
        const tail: OurPath = {
          ...p,
          pts: p.pts.slice(from),
          vels: p.vels.slice(from),
          times: p.times.slice(from),
          refs: p.refs.slice(from),
          nodeAt: [],
        };
        memo.set(key, ourApsides(tail, body));
      }
      const a = memo.get(key) as ReturnType<typeof ourApsides>;
      // (an orbit a few pixels across: its apsides unread, their labels left out)
      const far = (j: number) => apart(body, p.pts[from + j]!, p.times[from + j]!);
      if (a.pe && far(a.pe.i)) tag(FA(p.pts[from + a.pe.i]!, p.times[from + a.pe.i]!), `${label}Pe ${km(a.pe.alt)}`, "159, 227, 255", true);
      if (a.ap && far(a.ap.i)) tag(FA(p.pts[from + a.ap.i]!, p.times[from + a.ap.i]!), `${label}Ap ${km(a.ap.alt)}`, "159, 227, 255");
    };
    const free = i.ourFree,
      plan = i.ourPlan;
    const hits = (p: OurPath) => {
      const r = rel(p);
      for (let j = 0; j < p.pts.length; j += Math.max(1, Math.floor(p.pts.length / 400))) {
        const q = P(add(r[j]!, F0));
        if (q.ok) this.pathHits.push({ x: q.x, y: q.y, t: p.times[j]! });
      }
    };
    const inFrame = (p: OurPath, a = 0, b = p.pts.length - 1) =>
      rel(p)
        .slice(a, b + 1)
        .map((X) => add(X, F0));
    if (free && free.pts.length > 1) {
      const pts = inFrame(free);
      const cut = plan && plan.nodeAt.length ? Math.min(plan.nodeAt[0]!, free.pts.length - 1) : free.pts.length - 1;
      line(pts, "90, 220, 255", plan ? 0.35 : 0.95, 1.7);
      if (plan) line(pts.slice(0, cut + 1), "90, 220, 255", 0.95, 1.7);
      this.crossings(ctx, pts, P, pn, dpr, labels);
      apsides(free, 0, "");
      hits(free);
      // (landed, the free path's "impact" is the ground the craft stands on: nothing to warn of)
      if (free.fate === "impact" && !i.landed && !i.surface?.landed) {
        const q = P(pts[pts.length - 1]!);
        if (q.ok) {
          this.cross(q.x, q.y, 5 * dpr, RED, 2 * dpr);
          labels.push({
            text: tf("IMPACT {0}", BODY_NAMES[free.hit as Target] ?? free.hit ?? ""),
            x: q.x + 7 * dpr,
            y: q.y + 4 * dpr,
            col: "255, 90, 90",
            prio: 5,
            size: 9.5,
            weight: 700,
            ax: q.x,
            ay: q.y,
            ar: 6 * dpr,
          });
        }
      }
    }
    if (plan && plan.nodeAt.length) {
      const k0 = plan.nodeAt[0]!;
      line(inFrame(plan, k0), "255, 170, 80", 0.95, 1.8, [5, 3]);
      apsides(plan, plan.nodeAt[plan.nodeAt.length - 1]!, "▸ ");
      hits(plan);
    }
    // the flight computer's preview: the path its operation would fly, before it is executed
    const cand = i.cand;
    if (cand && cand.kind === "ours") {
      const cp = cand.ours;
      if (cp && cp.pts.length > 1) {
        const k0 = cp.nodeAt[0] ?? 0;
        const W = inFrame(cp, k0);
        line(W, CAND, 0.95, 2.3, [9, 5]);
        apsides(cp, cp.nodeAt[cp.nodeAt.length - 1] ?? 0, "◇ ");
        this.candMarks(
          ctx,
          cp.nodeAt.map((j) => P(FA(cp.pts[j]!, cp.times[j]!))),
          cand.note,
          labels,
          dpr,
        );
        if (cand.arrive && (solarBody(cand.arrive.body) || cand.arrive.body === "iss")) {
          const q = P(FA(ourPos(cand.arrive.body, cand.arrive.t), cand.arrive.t));
          if (q.ok) {
            this.paint.disc(q.x, q.y, 7 * dpr, null, `rgba(${CAND}, 0.95)`, 1.4 * dpr, [3 * dpr, 2 * dpr]);
            labels.push({
              text: tf("{0} · arrival T−{1}", BODY_NAMES[cand.arrive.body as Target] ?? cand.arrive.body, fmtDur(cand.arrive.t - t0, s)),
              x: q.x + 9 * dpr,
              y: q.y + 3 * dpr,
              col: CAND,
              prio: 5,
              size: 9,
              weight: 700,
              ax: q.x,
              ay: q.y,
              ar: 5 * dpr,
            });
          }
        }
      } else if (cand.busy) {
        const q = P(FA(i.X!, t0));
        if (q.ok)
          labels.push({
            text: t("◇ PREVIEW · computing the path…"),
            x: q.x + 12 * dpr,
            y: q.y + 18 * dpr,
            col: CAND,
            prio: 5,
            size: 9,
            weight: 700,
            ax: q.x,
            ay: q.y,
            ar: 5 * dpr,
          });
      }
    }
    // beyond the prediction: the patched conics (faint, dotted), their lowest points, an impact
    const ext = this.extension(i);
    if (ext && ext.pts.length > 1) {
      line(inFrame(ext), "170, 205, 255", 0.6, 1.3, [2, 4]);
      hits(ext);
      for (const a of ext.apsides) {
        const name = sc.byId.get(a.body)?.name ?? a.body;
        if (apart(a.body, ext.pts[a.i]!, ext.times[a.i]!))
          tag(FA(ext.pts[a.i]!, ext.times[a.i]!), `${name} Pe ${km(a.alt)}`, "184, 212, 255", true, 2);
      }
      if (ext.fate === "impact") {
        const q = P(FA(ext.pts[ext.pts.length - 1]!, ext.times[ext.times.length - 1]!));
        if (q.ok) this.cross(q.x, q.y, 4 * dpr, RED, 1.6 * dpr);
      }
      const q0 = P(FA(ext.pts[0]!, ext.times[0]!));
      if (q0.ok)
        labels.push({
          text: `${t("conics")} ▸`,
          x: q0.x + 6 * dpr,
          y: q0.y - 6 * dpr,
          col: "170, 205, 255",
          prio: 1,
          size: 8,
          weight: 600,
          ax: q0.x,
          ay: q0.y,
          ar: 5 * dpr,
        });
    }
    // closest approach to the target, on the plan or the free path (or, closer, along the conics)
    const tp = plan ?? free;
    if (tp && sc.byId.has(i.target) && solarBody(i.target) && i.target !== i.ref && i.target !== "wormhole") {
      let memo = this.pathMemo.get(tp);
      if (!memo) this.pathMemo.set(tp, (memo = new Map()));
      const key = `ca:${i.target}:${plan?.nodeAt[0] ?? 0}`;
      const caPred = (
        memo.has(key) ? memo.get(key) : (memo.set(key, ourClosest(tp, i.target, plan?.nodeAt[0] ?? 0)), memo.get(key))
      ) as ReturnType<typeof ourClosest>;
      const caExt = ext ? this.extClosest(ext, i.target, true) : null;
      const useExt = !!caExt && (!caPred || caExt.d < caPred.d);
      const ca = useExt ? caExt : caPred;
      const cp = useExt ? ext! : tp;
      if (ca) {
        const t = cp.times[ca.i]!;
        const a = P(FA(cp.pts[ca.i]!, t)),
          b = P(FA(ourPos(i.target, t), t));
        if (a.ok && b.ok) {
          this.paint.path(
            [
              [a.x, a.y],
              [b.x, b.y],
            ],
            "rgba(255, 138, 92, 0.8)",
            1 * dpr,
            [2 * dpr, 2 * dpr],
          );
          this.paint.disc(b.x, b.y, 5 * dpr, null, "rgba(255, 138, 92, 0.8)", 1 * dpr);
          const R = sc.byId.get(i.target)!.radius;
          const mx = (a.x + b.x) / 2,
            my = (a.y + b.y) / 2;
          labels.push({
            text: `CA ${km(Math.max(ca.d - R, 0))} · T−${fmtDur(t - t0, s)}`,
            x: mx + 6 * dpr,
            y: my,
            col: "255, 138, 92",
            prio: 4,
            size: 9,
            weight: 600,
            ax: mx,
            ay: my,
            ar: 4 * dpr,
          });
        }
      }
    }
    // the target where the plan meets it
    if (
      i.ourArrive &&
      i.ourArrive.body !== "wormhole" &&
      (solarBody(i.ourArrive.body) || ["iss", "ranger", "lander", "endurance"].includes(i.ourArrive.body)) &&
      plan
    ) {
      const q = P(FA(ourPos(i.ourArrive.body, i.ourArrive.t), i.ourArrive.t));
      if (q.ok) {
        this.paint.disc(q.x, q.y, 6 * dpr, null, "rgba(255, 170, 80, 0.9)", 1.2 * dpr, [2 * dpr, 2 * dpr]);
        labels.push({
          text: `${BODY_NAMES[i.ourArrive.body as Target] ?? i.ourArrive.body} · T−${fmtDur(i.ourArrive.t - t0, s)}`,
          x: q.x + 8 * dpr,
          y: q.y + 3 * dpr,
          col: "255, 170, 80",
          prio: 4,
          size: 8.5,
          weight: 600,
          ax: q.x,
          ay: q.y,
          ar: 5 * dpr,
        });
      }
    }
    // the nodes and the selected one's handles
    if (plan && i.plan) {
      this.drawNodes(
        ctx,
        i,
        i.plan.nodes.map((n, k) => {
          const j = plan.nodeAt[k];
          if (j === undefined) return null;
          const X = plan.pts[j]!,
            V = plan.vels[j - 1] ?? plan.vels[j]!,
            t = plan.times[j]!;
          const base = P(FA(X, t));
          if (!base.ok) return null;
          const dirOf = (cmp: V3) => {
            const d = nodeDvHome(X, V, t, cmp);
            const e = (this.cam.cur.dist * 0.02) / Math.max(len(d), 1e-30);
            const q = P(FA(add(X, scale(d, e)), t));
            const l = Math.hypot(q.x - base.x, q.y - base.y) || 1;
            return [(q.x - base.x) / l, (q.y - base.y) / l] as [number, number];
          };
          return { x: base.x, y: base.y, t: n.t, dirs: [dirOf([1, 0, 0]), dirOf([0, 1, 0]), dirOf([0, 0, 1])] };
        }),
        t0,
        dpr,
      );
    } else {
      this.nodeHits = [];
      this.handleHits = [];
    }
  }

  private drawTheirPaths(
    ctx: CanvasRenderingContext2D,
    i: Info,
    sc: MapScene,
    t0: number,
    dpr: number,
    P: (X: V3) => Proj,
    line: (pts: V3[], col: string, a: number, w: number, dash?: number[], occl?: boolean, off?: V3) => void,
    labels: MapLabel[],
    pn: V3,
    cm: boolean,
  ) {
    const s = this.host.s;
    const at = (X: V3, t: number): V3 => sub(X, sc.origin(t));
    const path = i.path;
    const T = path ? Math.max(path.pts.length * path.dt, 50) : 200;
    const tick = niceStep(T / 6);
    const tickTimes = Array.from({ length: Math.floor(T / tick) }, (_, j) => t0 + (j + 1) * tick);
    const dotAt = (X: V3, r: number, col: string) => {
      const p = P(X);
      if (p.ok) this.paint.disc(p.x, p.y, r * dpr, col);
    };
    // the hole's own motion (the centre of mass's frame)
    if (cm) {
      const span = (a: number, b: number) => Array.from({ length: 61 }, (_, j) => at([0, 0, 0], a + ((b - a) * j) / 60));
      line(span(t0 - T * 0.5, t0), "255, 255, 255", 0.25, 1.2, [], false);
      line(span(t0, t0 + T), "255, 255, 255", 0.55, 1.2, [3, 3], false);
      for (const tt of tickTimes) dotAt(at([0, 0, 0], tt), 1.5, "rgba(255, 255, 255, 0.75)");
    }
    // the companion star: its arc from now, the ticks
    if (s.sun) {
      const star = sc.byId.get("star")!;
      const period = star.period ?? 1e3;
      const span = (a: number, b: number, n = 90) =>
        Array.from({ length: n + 1 }, (_, j) => {
          const t = a + ((b - a) * j) / n;
          return at(starCentre(s, t), t);
        });
      line(span(t0 - Math.min(T * 0.5, period * 0.3), t0), "255, 211, 107", 0.35, 1.5, [], false);
      line(span(t0, t0 + Math.min(T, period)), "255, 211, 107", 0.85, 1.5, [4, 3], false);
      for (const tt of tickTimes) dotAt(at(starCentre(s, tt), tt), 2, "rgba(255, 211, 107, 0.95)");
    }
    // the ship's track
    line([...this.host.trail().map((q) => at(q.X, q.t)), at(i.X!, t0)], "124, 214, 255", 0.5, 1.4, [], false);
    // its free fall
    if (path && path.pts.length > 1) {
      const fut = [at(i.X!, t0), ...path.pts.map((q, j) => at(q, t0 + (j + 1) * path.dt))];
      const bad = path.fate === "horizon" || path.fate === "star";
      line(fut, bad ? "255, 90, 70" : "255, 190, 80", 0.95, 1.7, [5, 3]);
      this.crossings(ctx, fut, P, pn, dpr, labels);
      ctx.font = `600 ${11.6 * dpr}px ${FONT}`;
      tickTimes.forEach((tt, j) => {
        const idx = (tt - t0) / path.dt - 1;
        if (idx < 0 || idx >= path.pts.length - 1) return;
        const a = path.pts[Math.floor(idx)]!,
          b = path.pts[Math.floor(idx) + 1]!;
        const f = idx - Math.floor(idx);
        const p = P(at([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tt));
        if (!p.ok) return;
        this.paint.disc(p.x, p.y, 2.2 * dpr, "#fff");
        if (j % 2 === 1)
          labels.push({
            text: `+${fmtShort((j + 1) * tick)}`,
            x: p.x + 4 * dpr,
            y: p.y - 3 * dpr,
            col: "255, 255, 255",
            prio: 1,
            size: 8.5,
            weight: 600,
            ax: p.x,
            ay: p.y,
            ar: 3 * dpr,
          });
      });
      let iMin = -1,
        iMax = -1,
        rMin = Infinity,
        rMax = -Infinity;
      path.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (r < rMin) (rMin = r), (iMin = j);
        if (r > rMax) (rMax = r), (iMax = j);
      });
      const lbl = (j: number, txt: string) => {
        if (j <= 0 || j >= path.pts.length - 1) return;
        const p = P(at(path.pts[j]!, t0 + (j + 1) * path.dt));
        if (p.ok)
          labels.push({
            text: txt,
            x: p.x + 5 * dpr,
            y: p.y + 11 * dpr,
            col: "124, 214, 255",
            prio: 4,
            size: 9.5,
            weight: 600,
            ax: p.x,
            ay: p.y,
            ar: 5 * dpr,
          });
      };
      // (a circle's apsides: nowhere in particular — not marked)
      if (rMax - rMin > 0.01 * rMax) {
        lbl(iMin, `Pe ${rMin.toFixed(2)} M`);
        if (path.fate === "continues") lbl(iMax, `Ap ${rMax.toFixed(2)} M`);
      }
      if (bad) {
        const p = P(fut[fut.length - 1]!);
        if (p.ok) this.cross(p.x, p.y, 4 * dpr, RED, 2 * dpr);
      }
      const ca = this.host.closestApproach(i, t0);
      if (ca && ca.t > 0) {
        const j = Math.max(0, Math.round(ca.t / path.dt) - 1);
        const q = path.pts[Math.min(j, path.pts.length - 1)]!;
        const tt = t0 + ca.t;
        const a = P(at(q, tt)),
          b = P(at(bodyCentre(s, i.target as Body, tt), tt));
        if (a.ok && b.ok) {
          this.paint.path(
            [
              [a.x, a.y],
              [b.x, b.y],
            ],
            "rgba(255, 138, 92, 0.9)",
            1.2 * dpr,
            [2 * dpr, 2 * dpr],
          );
          const mx = (a.x + b.x) / 2,
            my = (a.y + b.y) / 2;
          labels.push({
            text: `CA ${fmtLen(ca.d, s)}`,
            x: mx + 5 * dpr,
            y: my,
            col: "255, 138, 92",
            prio: 4,
            size: 9,
            weight: 600,
            ax: mx,
            ay: my,
            ar: 4 * dpr,
          });
        }
      }
      for (let j = 0; j < path.pts.length; j += Math.max(1, Math.floor(path.pts.length / 300))) {
        const t = t0 + (j + 1) * path.dt;
        const p = P(at(path.pts[j]!, t));
        if (p.ok) this.pathHits.push({ x: p.x, y: p.y, t });
      }
    }
    // beyond the prediction: the conics (faint, dotted), their periapsides, the horizon or a body hit
    const ext = this.theirExtension(i, t0);
    if (ext && ext.pts.length > 1) {
      const pts = ext.pts.map((q, j) => at(q, ext.times[j]!));
      line(pts, "170, 205, 255", 0.6, 1.3, [2, 4]);
      for (let j = 0; j < pts.length; j += Math.max(1, Math.floor(pts.length / 300))) {
        const p = P(pts[j]!);
        if (p.ok) this.pathHits.push({ x: p.x, y: p.y, t: ext.times[j]! });
      }
      for (const a of ext.apsides) {
        const p = P(pts[a.i]!);
        if (!p.ok) continue;
        const who = a.body === "hole" ? "" : `${sc.byId.get(a.body)?.name ?? a.body} `;
        labels.push({
          text: `${who}Pe ${fmtLen(a.alt + (a.body === "hole" ? (sc.hole?.rH ?? 0) : 0), s)}${a.body === "hole" ? " (r)" : ""}`,
          x: p.x + 5 * dpr,
          y: p.y + 11 * dpr,
          col: "184, 212, 255",
          prio: 3,
          size: 9,
          weight: 600,
          ax: p.x,
          ay: p.y,
          ar: 5 * dpr,
        });
        this.paint.disc(p.x, p.y, 2.4 * dpr, "#b8d4ff");
      }
      if (ext.fate === "impact") {
        const p = P(pts[pts.length - 1]!);
        if (p.ok) this.cross(p.x, p.y, 4 * dpr, RED, 1.6 * dpr);
      }
      const q0 = P(pts[0]!);
      if (q0.ok)
        labels.push({
          text: `${t("conics")} ▸`,
          x: q0.x + 6 * dpr,
          y: q0.y - 6 * dpr,
          col: "170, 205, 255",
          prio: 1,
          size: 8,
          weight: 600,
          ax: q0.x,
          ay: q0.y,
          ar: 5 * dpr,
        });
    }
    // the flight plan: its path through the nodes, the nodes
    if (i.plan?.path && i.plan.path.pts.length > 1) {
      const pp = i.plan.path;
      line([at(i.X!, t0), ...pp.pts.map((q, j) => at(q, pp.times[j]!))], "255, 170, 80", 0.95, 1.8, [5, 3]);
      for (let j = 0; j < pp.pts.length; j += Math.max(1, Math.floor(pp.pts.length / 300))) {
        const p = P(at(pp.pts[j]!, pp.times[j]!));
        if (p.ok) this.pathHits.push({ x: p.x, y: p.y, t: pp.times[j]! });
      }
      this.drawNodes(
        ctx,
        i,
        i.plan.nodes.map((n) => {
          let j = pp.times.findIndex((tt) => tt >= n.t);
          if (j < 0) j = pp.pts.length - 1;
          const X = pp.pts[j]!;
          const A = pp.pts[Math.max(j - 1, 0)]!,
            B = pp.pts[Math.min(j + 1, pp.pts.length - 1)]!;
          const v = norm(sub(B, A));
          const rh = norm(X);
          const Nn = norm(cross(rh, v));
          const Rr = cross(Nn, v);
          const base = P(at(X, n.t));
          if (!base.ok) return null;
          const e = 0.02 * Math.hypot(...X);
          const dirOf = (d: V3) => {
            const q = P(at(add(X, scale(d, e)), n.t));
            const l = Math.hypot(q.x - base.x, q.y - base.y) || 1;
            return [(q.x - base.x) / l, (q.y - base.y) / l] as [number, number];
          };
          return { x: base.x, y: base.y, t: n.t, dirs: [dirOf(v), dirOf(Nn), dirOf(Rr)] };
        }),
        t0,
        dpr,
      );
      const lastNode = i.plan.nodes[i.plan.nodes.length - 1];
      if ((lastNode?.then === "approach" || lastNode?.then === "orbit") && s.sun) {
        const p = P(at(starCentre(s, lastNode.t), lastNode.t));
        if (p.ok) {
          this.paint.disc(p.x, p.y, 7 * dpr, null, "rgba(255, 211, 107, 0.9)", 1.5 * dpr, [2 * dpr, 2 * dpr]);
          labels.push({
            text: "RDV",
            x: p.x + 9 * dpr,
            y: p.y + 4 * dpr,
            col: "255, 211, 107",
            prio: 4,
            size: 9.5,
            weight: 600,
            ax: p.x,
            ay: p.y,
            ar: 5 * dpr,
          });
        }
      } else if (pp.fate === "horizon" || pp.fate === "star" || pp.fate === "wormhole") {
        const p = P(at(pp.pts[pp.pts.length - 1]!, pp.times[pp.times.length - 1]!));
        if (p.ok) this.paint.disc(p.x, p.y, 5 * dpr, null, pp.fate === "wormhole" ? "#c88cff" : RED, 2 * dpr);
      }
    } else {
      this.nodeHits = [];
      this.handleHits = [];
    }
    // the flight computer's planned burns about a world (its two bodies), relative to it
    const lp = i.localPlan;
    if (lp && lp.pts.length > 1) {
      const wp = sc.byId.get(lp.world)?.pos;
      if (wp) {
        const W = lp.pts.map((q) => add(q, wp));
        line(W, "255, 170, 80", 0.95, 1.9, [5, 3]);
        for (const j of lp.nodeAt) {
          const q = P(W[j]!);
          if (q.ok) marker(ctx, "burn", q.x, q.y, 5 * dpr, "rgba(255, 170, 80, 1)");
        }
      }
    }
    // the flight computer's preview (the hole's geodesics, or a world's two bodies carried on the map)
    const cand = i.cand;
    const cp = cand?.kind === "hole" ? cand.kerr : cand?.kind === "local" ? cand.local : null;
    if (cand && cp && cp.pts.length > 1) {
      // (about a world: relative to it, put where it is now on the map)
      const wp = cand.kind === "local" && cand.local ? (sc.byId.get(cand.local.world)?.pos ?? null) : null;
      const W = cp.pts.map((q, j) => (wp ? add(q, wp) : at(q, cp.times[j]!)));
      line(cand.kind === "hole" ? [at(i.X!, t0), ...W] : W, CAND, 0.95, 2.3, [9, 5]);
      const idx = cand.nodes.map((n) => {
        const j = cp.times.findIndex((tt) => tt >= n.t);
        return j < 0 ? cp.pts.length - 1 : j;
      });
      this.candMarks(
        ctx,
        idx.map((j) => P(W[j]!)),
        cand.note,
        labels,
        dpr,
      );
      // (the orbit after about the hole: its near and far points)
      const k1 = idx[idx.length - 1] ?? 0;
      if (cand.kind === "hole") {
        let lo = -1,
          hi = -1;
        for (let j = k1; j < cp.pts.length; j++) {
          const r = len(cp.pts[j]!);
          if (lo < 0 || r < len(cp.pts[lo]!)) lo = j;
          if (hi < 0 || r > len(cp.pts[hi]!)) hi = j;
        }
        for (const [j, name] of [
          [lo, "Pe"],
          [hi, "Ap"],
        ] as [number, string][]) {
          const q = P(W[j]!);
          if (q.ok && j > k1 && j < cp.pts.length - 1)
            labels.push({
              text: `◇ ${name} ${len(cp.pts[j]!).toFixed(2)} M`,
              x: q.x + 6 * dpr,
              y: q.y - 6 * dpr,
              col: CAND,
              prio: 4,
              size: 8.5,
              weight: 600,
              ax: q.x,
              ay: q.y,
              ar: 5 * dpr,
            });
        }
      }
    }
  }

  /** The preview's burns: hollow diamonds, numbered, the operation named at the first. */
  private candMarks(ctx: CanvasRenderingContext2D, places: Proj[], note: string, labels: MapLabel[], dpr: number) {
    places.forEach((q, k) => {
      if (!q.ok) return;
      const r = 6.5 * dpr;
      this.paint.poly(
        q.x,
        q.y,
        [
          [0, -r],
          [r, 0],
          [0, r],
          [-r, 0],
        ],
        "rgba(20, 10, 40, 0.75)",
        `rgba(${CAND}, 1)`,
        1.8 * dpr,
      );
      ctx.fillStyle = `rgba(${CAND}, 1)`;
      ctx.font = `700 ${8.5 * dpr}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(`${k + 1}`, q.x, q.y + 3 * dpr);
      if (k === 0) {
        // (the operation's name, short — the card has the rest)
        const head = note.split(" · ")[0]!;
        labels.push({
          text: tf("◇ PREVIEW · {0}", head.length > 46 ? `${head.slice(0, 44)}…` : head),
          x: q.x + 10 * dpr,
          y: q.y - 10 * dpr,
          col: CAND,
          prio: 6,
          size: 9.5,
          weight: 700,
          ax: q.x,
          ay: q.y,
          ar: 5 * dpr,
        });
      }
    });
  }

  /**
   * The nodes (either side): diamonds; the selected one's six handles — prograde / retrograde
   * (green), normal / anti-normal (magenta), radial out / in (cyan) — to drag (the longer the pull,
   * the faster its Δv grows), its Δv, burn time and countdown. places: each node's screen place and
   * its P, N, R directions on screen.
   */
  private drawNodes(
    ctx: CanvasRenderingContext2D,
    i: Info,
    places: ({ x: number; y: number; t: number; dirs: [number, number][] } | null)[],
    t0: number,
    dpr: number,
  ) {
    this.nodeHits = [];
    this.handleHits = [];
    const nodes = i.plan?.nodes ?? [];
    if (this.host.sel >= nodes.length) this.host.sel = Math.max(0, nodes.length - 1);
    // a handle being pulled: its Δv grows (quadratic in the pull, from the orbital speed's scale)
    if (this.gizmo && nodes[this.gizmo.k]) {
      const g = this.gizmo;
      const now = performance.now();
      const dt = Math.min((now - g.at) / 1000, 0.1);
      g.at = now;
      const pull = Math.max(((g.x - g.x0) * g.dir[0] + (g.y - g.y0) * g.dir[1]) / dpr, 0);
      const k = Math.max(i.speed, 1e-6) * 0.05;
      const rate = k * (pull / 50) ** 2;
      if (rate > 0) {
        const dv: V3 = [0, 0, 0];
        dv[g.c] = g.sign * rate * dt;
        this.host.act.nudge(g.k, dv, 0);
      }
    }
    const COLS = ["#d6f55b", "#e07bff", "#5fd3ff"];
    places.forEach((pl, k) => {
      if (!pl) return;
      const sel = k === this.host.sel;
      this.nodeHits.push({ k, x: pl.x, y: pl.y });
      const r = (sel ? 7.5 : 6) * dpr;
      this.paint.poly(
        pl.x,
        pl.y,
        [
          [0, -r],
          [r, 0],
          [0, r],
          [-r, 0],
        ],
        sel ? "#5ad8ff" : "#2fa4d0",
        "#04121a",
        1.5 * dpr,
      );
      ctx.fillStyle = "#dff6ff";
      ctx.textAlign = "left";
      ctx.font = `700 ${11.6 * dpr}px ${FONT}`;
      ctx.fillText(`${k + 1}`, pl.x + 8 * dpr, pl.y - 6 * dpr);
      if (!sel) return;
      for (let c = 0; c < 3; c++) {
        let d = pl.dirs[c]!;
        if (!(Math.hypot(d[0], d[1]) > 0.2)) d = c === 1 ? [0, -1] : [1, 0];
        for (const sign of [1, -1]) {
          const hx = pl.x + sign * d[0] * 36 * dpr,
            hy = pl.y + sign * d[1] * 36 * dpr;
          this.paint.path(
            [
              [pl.x + sign * d[0] * 10 * dpr, pl.y + sign * d[1] * 10 * dpr],
              [hx, hy],
            ],
            "rgba(220, 235, 255, 0.25)",
            1 * dpr,
          );
          const on = this.gizmo && this.gizmo.k === k && this.gizmo.c === c && this.gizmo.sign === sign;
          marker(ctx, sign > 0 ? "prograde" : "retrograde", hx, hy, (on ? 9 : 7) * dpr, COLS[c]!);
          this.handleHits.push({ k, c, sign, x: hx, y: hy, dir: [sign * d[0], sign * d[1]] });
        }
      }
      const n = nodes[k]!;
      const dvl = Math.hypot(...n.dv);
      const kms = dvl * 299792.458;
      const burn = dvl / Math.max(i.engine.max, 1e-30);
      const lines = [
        tf("NODE {0} · T−{1}", k + 1, fmtDur(n.t - t0, this.host.s)),
        `Δv ${kms >= 1000 ? `${dvl.toFixed(4)} c` : `${kms >= 10 ? kms.toFixed(1) : (kms * 1000).toFixed(0) + " m/s"}${kms >= 10 ? " km/s" : ""}`}  ·  ${t("burn")} ${fmtDur(burn, this.host.s)}`,
        `P ${fmtDv(n.dv[0])}  N ${fmtDv(n.dv[1])}  R ${fmtDv(n.dv[2])}`,
      ];
      ctx.font = `600 ${11.6 * dpr}px ${FONT}`;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12 * dpr;
      const bx = pl.x + 44 * dpr,
        by = pl.y + 16 * dpr;
      ctx.fillStyle = "rgba(4, 10, 18, 0.82)";
      ctx.fillRect(bx, by, w, 44 * dpr);
      ctx.strokeStyle = "rgba(90, 216, 255, 0.5)";
      ctx.strokeRect(bx, by, w, 44 * dpr);
      ctx.fillStyle = "#dff6ff";
      lines.forEach((l, j) => ctx.fillText(l, bx + 6 * dpr, by + (13 + 13 * j) * dpr));
    });
  }

  /** The card of a body under the pointer: its kind, distance from the ship, size, orbit. */
  private drawCard(
    ctx: CanvasRenderingContext2D,
    b: MapBody,
    sc: MapScene,
    ship: V3,
    i: Info,
    ours: boolean,
    cw: number,
    ch: number,
    dpr: number,
  ) {
    const s = this.host.s;
    const d = len(sub(b.pos, ship)) - (b.kind === "mouth" ? 0 : b.radius);
    const rows: [string, string][] = [];
    rows.push([t("From the ship"), fmtDist(Math.max(d, 0), ours, s)]);
    if (b.radius > 0 && b.kind !== "mouth") rows.push([t("Radius"), b.kind === "hole" ? fmtLen(b.radius, s) : fmtDist(b.radius, ours, s)]);
    const par = b.parent ? sc.byId.get(b.parent) : null;
    if (par) rows.push([tf("From {0}", par.name), fmtDist(len(sub(b.pos, par.pos)), ours, s)]);
    if (b.period) rows.push([t("Period"), fmtDur(b.period, s)]);
    if (b.soi > 0 && Number.isFinite(b.soi)) rows.push([t("Sphere of influence"), fmtDist(b.soi, ours, s)]);
    const hint = b.id === i.target ? t("the target · double-click: centre it") : t("click: target · double-click: centre");
    const title = b.name;
    ctx.font = `700 ${13.4 * dpr}px ${FONT}`;
    let w = ctx.measureText(title).width;
    ctx.font = `600 ${11.6 * dpr}px ${FONT}`;
    for (const [k, v] of rows) w = Math.max(w, ctx.measureText(`${k}  ${v}`).width + 16 * dpr);
    w = Math.max(w, ctx.measureText(hint).width) + 20 * dpr;
    const hgt = (30 + rows.length * 14 + 16) * dpr;
    let x = this.hover!.x + 16 * dpr,
      y = this.hover!.y + 12 * dpr;
    if (x + w > cw - 6 * dpr) x = this.hover!.x - w - 16 * dpr;
    if (y + hgt > ch - 6 * dpr) y = ch - hgt - 6 * dpr;
    ctx.fillStyle = "rgba(6, 10, 18, 0.9)";
    ctx.strokeStyle = `rgba(${b.col}, 0.55)`;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.roundRect(x, y, w, hgt, 8 * dpr);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgb(${b.col})`;
    ctx.beginPath();
    ctx.arc(x + 12 * dpr, y + 15 * dpr, 4 * dpr, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#eef3fa";
    ctx.textAlign = "left";
    ctx.font = `700 ${13.4 * dpr}px ${FONT}`;
    ctx.fillText(title, x + 22 * dpr, y + 19 * dpr);
    ctx.font = `600 ${11.6 * dpr}px ${FONT}`;
    rows.forEach(([k, v], j) => {
      const yy = y + (36 + j * 14) * dpr;
      ctx.fillStyle = "rgba(200, 210, 225, 0.65)";
      ctx.textAlign = "left";
      ctx.fillText(k, x + 10 * dpr, yy);
      ctx.fillStyle = "#eef3fa";
      ctx.textAlign = "right";
      ctx.font = `${9.5 * dpr}px ${MONO}`;
      ctx.fillText(v, x + w - 10 * dpr, yy);
      ctx.font = `600 ${11.6 * dpr}px ${FONT}`;
    });
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(124, 214, 255, 0.75)";
    ctx.font = `600 ${10.4 * dpr}px ${FONT}`;
    ctx.fillText(hint, x + 10 * dpr, y + hgt - 8 * dpr);
  }

  private drawFooter(ctx: CanvasRenderingContext2D, t0: number, cw: number, ch: number, dpr: number, ours: boolean) {
    const s = this.host.s;
    // (above the timeline in the minimap; full screen, the free part's bottom corners)
    const [vx, vy, vw, vh] = this.cam.view;
    const by = this.host.mapView() ? vy + vh : ch - 30 * dpr;
    const xr = this.host.mapView() ? vx + vw : cw;
    const xl = this.host.mapView() ? vx : 0;
    // a scale bar at the focus's depth (true scale only)
    if (!this.log) {
      const k = this.cam.focal / this.cam.cur.dist;
      const bar = niceStep((vw * 0.22) / k);
      ctx.strokeStyle = "rgba(230, 235, 245, 0.75)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      const x0 = xr - 10 * dpr - bar * k;
      ctx.moveTo(x0, by - 10 * dpr);
      ctx.lineTo(xr - 10 * dpr, by - 10 * dpr);
      ctx.moveTo(x0, by - 13 * dpr);
      ctx.lineTo(x0, by - 7 * dpr);
      ctx.moveTo(xr - 10 * dpr, by - 13 * dpr);
      ctx.lineTo(xr - 10 * dpr, by - 7 * dpr);
      ctx.stroke();
      ctx.fillStyle = "rgba(230, 235, 245, 0.85)";
      ctx.font = `${9 * dpr}px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(fmtDist(bar, ours, s), xr - 10 * dpr, by - 16 * dpr);
    }
    const plane = PLANES.find((p) => p.id === this.plane)!.label.toLowerCase();
    ctx.fillStyle = "rgba(220, 225, 235, 0.55)";
    ctx.textAlign = "left";
    ctx.font = `600 ${11 * dpr}px ${FONT}`;
    const date = ours ? `${dateOf(t0).toISOString().slice(0, 10)} · ` : "";
    ctx.fillText(
      `${date}${this.preview > 0 ? `${t("preview")} · ` : ""}${tf("{0} plane", plane)} · ${this.log ? t("log scale") : t("true scale")}`,
      xl + 8 * dpr,
      by - 8 * dpr,
    );
  }
}
