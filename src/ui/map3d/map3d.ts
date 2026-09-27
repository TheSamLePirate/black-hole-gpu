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
import { solarState } from "../../system/solar";
import { nodeDvHome, ourApsides, ourClosest, type OurPath } from "../../system/our-predict";
import { bodyCentre, BODY_NAMES, starCentre, type Body } from "../../targeting";
import type { Target } from "../../settings";
import { FONT, fmtDur, fmtDv, fmtLen, fmtShort, marker, MONO, niceStep, RED } from "../hudkit";
import { MapCamera, add, cross, dot, len, norm, planeBasis, scale, sub, type V3 } from "./camera";
import { dateOf, lineage, ourScene, theirScene, type MapBody, type MapScene, type Universe } from "./scene";
import type { Info } from "../flighthud";

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
}

type PlaneMode = "system" | "equator" | "orbit" | "target";
type Proj = { x: number; y: number; z: number; k: number; ok: boolean };

const PLANES: { id: PlaneMode; label: string; short: string; title: string }[] = [
  { id: "system", label: "System", short: "Sys", title: "The system's plane: the ecliptic (the solar system), the hole's equator (Gargantua's)" },
  { id: "equator", label: "Equator", short: "Eq", title: "The focus body's equator" },
  { id: "orbit", label: "Orbit", short: "Orb", title: "The ship's orbital plane (around its primary)" },
  { id: "target", label: "Target", short: "Tgt", title: "The target's orbital plane (around its primary)" },
];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const KM = 1.476625e8; // km per M

/** A length in the map's units for a card: km, AU (ours) — M and km (theirs). */
function fmtDist(d: number, ours: boolean, s: Settings) {
  if (!ours) return fmtLen(d, s);
  const k = d * KM;
  if (k >= 1e7) return `${(k / 1.495978707e8).toFixed(k >= 1.5e9 ? 1 : 3)} AU`;
  return `${Math.round(k).toLocaleString("en-US")} km`;
}

export class Map3D {
  readonly canvas = h("canvas", "fl-map");
  readonly bar = h("div", "fl-mapbar m3-bar");
  readonly stage = h("div", "m3-stage");
  private crumbs = h("div", "m3-crumbs");
  private menu = h("div", "m3-menu");
  private menuList = h("div", "m3-list");
  private menuSearch = h("input", "m3-search") as HTMLInputElement;
  private focusBtn = h("button", "m3-focus") as HTMLButtonElement;
  private btns: Record<string, HTMLButtonElement> = {};
  private cam = new MapCamera();
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
  private gizmo: { k: number; c: number; sign: number; dir: [number, number]; x0: number; y0: number; x: number; y: number; at: number } | null = null;
  private nodeDrag: { k: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private lastInfo: Info | null = null;
  /** per predicted path (they are replaced a few times a second): its points relative to the frame's body, its apsides and closest approaches */
  private relCache = new WeakMap<OurPath, { frame: string; pts: V3[] }>();
  private pathMemo = new WeakMap<OurPath, Map<string, unknown>>();
  // the warp of the log scale: its centre (the camera's focus) and its scale length
  private log = false;
  private W: V3 = [0, 0, 0];
  private r0 = 1;

  constructor(private host: MapHost) {
    this.stage.append(this.canvas, this.crumbs, this.menu);
    this.buildBar();
    this.buildMenu();
    this.bindPointer();
    this.cam.resize(300, 250);
  }

  /** The camera still moves (the HUD then draws the map at the display's rate). */
  get animating() {
    return this.moving || !!this.gizmo;
  }

  // ------------------------------------------------------------------------------------ the bar
  private buildBar() {
    const b = (id: string, label: string, title: string, fn: () => void, cls = "") => {
      const e = h("button", cls, label) as HTMLButtonElement;
      e.title = title;
      e.onclick = (ev) => {
        ev.stopPropagation();
        fn();
      };
      this.btns[id] = e;
      return e;
    };
    this.focusBtn.title = "The body at the centre (double-click a body on the map; a click targets it)";
    this.focusBtn.onclick = (e) => {
      e.stopPropagation();
      this.openMenu(!this.menu.classList.contains("open"));
    };
    const planes = h("div", "m3-seg");
    for (const p of PLANES) {
      const e = b(`plane:${p.id}`, "", `Reference plane: ${p.title}`, () => this.setPlane(p.id));
      e.append(h("span", "m3-long", p.label), h("span", "m3-short", p.short));
      planes.append(e);
    }
    const views = h("div", "m3-seg");
    views.append(
      b("view:top", "⊤", "Seen from above the reference plane", () => this.setView(Math.PI / 2 - 1e-3)),
      b("view:3d", "◿", "Seen at 30° above the plane", () => this.setView(0.52)),
      b("view:edge", "⟂", "Seen edge-on: in the reference plane", () => this.setView(0.004)),
    );
    this.bar.append(
      h("span", "fl-label", "Map"),
      this.focusBtn,
      planes,
      views,
      b("log", "Log", "Multi-scale: the distance from the focus as ln(1 + r/r₀), directions kept — the whole system and a low orbit on one map", () => {
        if (this.universe === "ours") this.logOurs = !this.logOurs;
        else this.logTheirs = !this.isLog();
        this.autoDist = true;
      }),
      b("fit", "Fit", "Frame the focus and the ship's paths again (double-click on empty space)", () => this.fit()),
      b("cm", "CoM", "Inertial frame of the centre of mass: Gargantua moves too", () => (this.frame = "cm")),
      b("holeF", "Hole", "Gargantua's frame (fixed at the centre)", () => (this.frame = "hole")),
      b("full", "⛶", "The map over the whole screen [M]", () => this.host.toggleMapView(), "m3-full"),
    );
  }

  private buildMenu() {
    this.menuSearch.placeholder = "Find a body…";
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
    if (!q || "ship ranger".includes(q)) item("ship", "The ship", 0, "follow the Ranger", "124, 214, 255");
    if (this.lastInfo && sc.byId.has(this.lastInfo.target) && (!q || "target".includes(q))) {
      const t = sc.byId.get(this.lastInfo.target)!;
      item(t.id, `Target · ${t.name}`, 0, "", t.col);
    }
    // the tree: each body under its primary
    const walk = (parent: string | null, depth: number) => {
      for (const b of sc.bodies) {
        if (b.parent !== parent) continue;
        const kids = sc.bodies.some((c) => c.parent === b.id);
        const match = !q || b.name.toLowerCase().includes(q) || b.id.includes(q);
        if (match) item(b.id, b.name, q ? 0 : depth, b.kind === "moon" ? "moon" : b.kind, b.col);
        if (kids) walk(b.id, depth + 1);
      }
    };
    walk(null, 0);
    if (!this.menuList.children.length) this.menuList.append(h("p", "m3-none", "No body by that name"));
  }

  private renderCrumbs(sc: MapScene, fid: string) {
    const key = `${sc.universe}:${fid}`;
    if (this.crumbs.dataset.key === key) return;
    this.crumbs.dataset.key = key;
    this.crumbs.replaceChildren();
    const chain = fid === "ship" ? [] : lineage(sc, fid);
    chain.forEach((b, j) => {
      if (j) this.crumbs.append(h("span", "m3-sep", "›"));
      const e = h("button", j === chain.length - 1 ? "on" : "", b.name) as HTMLButtonElement;
      e.onclick = (ev) => {
        ev.stopPropagation();
        this.setFocus(b.id);
      };
      this.crumbs.append(e);
    });
    if (fid === "ship") this.crumbs.append(h("button", "on", "The ship"));
  }

  // ------------------------------------------------------------------------------------ view commands
  private currentFocus(): string {
    return this.focus ?? this.homeFocus();
  }

  private homeFocus(): string {
    const i = this.lastInfo;
    const sc = this.scene;
    if (!sc || !i) return "hole";
    if (sc.universe === "gargantua") return "hole";
    const ref = i.ref ? sc.byId.get(i.ref) : null;
    if (!ref || ref.id === "sun") return "sun";
    return ref.kind === "moon" && ref.parent ? ref.parent : ref.id;
  }

  setFocus(id: string | null) {
    this.focus = id;
    this.autoDist = true;
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
  }

  private isLog() {
    return this.universe === "ours" ? this.logOurs : this.logTheirs ?? this.host.s.system !== "none";
  }

  private syncBar(sc: MapScene, fid: string) {
    const s = this.host.s;
    const name = fid === "ship" ? "The ship" : sc.byId.get(fid)?.name ?? fid;
    const col = fid === "ship" ? "124, 214, 255" : sc.byId.get(fid)?.col ?? "220, 220, 220";
    const key = `${name}|${this.focus === null}`;
    if (this.focusBtn.dataset.key !== key) {
      this.focusBtn.dataset.key = key;
      this.focusBtn.replaceChildren();
      const d = h("i");
      d.style.background = `rgb(${col})`;
      this.focusBtn.append(d, h("span", "", name), h("b", "", this.focus === null ? "auto ▾" : "▾"));
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
  }

  // ------------------------------------------------------------------------------------ pointer
  private bindPointer() {
    const c = this.canvas;
    const at = (e: PointerEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio] as const;
    };
    let drag: { x: number; y: number; moved: boolean; pan: boolean } | null = null;
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const [x, y] = at(e);
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this.cam.zoom(Math.exp(e.deltaY * k * 0.0016), x, y);
      this.autoDist = false;
    }, { passive: false });
    c.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      const [x, y] = at(e);
      const near = (q: { x: number; y: number }, r: number) => Math.hypot(q.x - x, q.y - y) < r * devicePixelRatio;
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
        c.style.cursor = this.bodyAt(x, y) || this.nodeHits.some((q) => Math.hypot(q.x - x, q.y - y) < 10 * devicePixelRatio) ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      c.style.cursor = "grabbing";
      if (drag.pan) {
        this.cam.pan(dx * devicePixelRatio, dy * devicePixelRatio);
        this.autoDist = false;
      } else this.cam.orbit(dx, dy);
      this.moving = true;
    });
    c.addEventListener("pointerleave", () => (this.hover = null));
    c.addEventListener("pointerup", (e) => {
      if (this.gizmo || this.nodeDrag) {
        this.gizmo = null;
        this.nodeDrag = null;
        return;
      }
      if (drag && !drag.moved && e.button === 0) {
        const [x, y] = at(e);
        const id = this.bodyAt(x, y);
        if (id) this.host.act.select(id);
        else {
          // on a path: a new node there
          let p: { t: number; d: number } | null = null;
          for (const q of this.pathHits) {
            const d = Math.hypot(q.x - x, q.y - y);
            if (!p || d < p.d) p = { t: q.t, d };
          }
          if (p && p.d < 9 * devicePixelRatio) {
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

  /** The body under a point (device pixels): its disc, or within 16 px of its centre. */
  private bodyAt(x: number, y: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const q of this.bodyHits) {
      const d = Math.hypot(q.x - x, q.y - y);
      const reach = Math.max(q.r, 16 * devicePixelRatio);
      if (d < reach && d - q.r < bd) (bd = d - q.r), (best = q.id);
    }
    return best;
  }

  // ------------------------------------------------------------------------------------ drawing
  draw(i: Info, t0: number) {
    const c = this.canvas;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 260) * dpr);
    const ch = Math.round((c.clientHeight || 250) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    this.cam.resize(cw, ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    this.lastInfo = i;
    this.bodyHits = [];
    this.pathHits = [];
    const s = this.host.s;
    const ours = !!(i.ref && i.X);
    if (!ours && (i.region !== "hole" || !i.X)) {
      ctx.fillStyle = "rgba(220, 225, 235, 0.8)";
      ctx.font = `${10 * dpr}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(`In the wormhole · ℓ = ${i.ell.toFixed(2)} M`, cw / 2, ch / 2);
      this.moving = false;
      return;
    }
    const universe: Universe = ours ? "ours" : "gargantua";
    const cm = !ours && s.sun && s.sunMass > 0 && this.frame === "cm";
    const sc = (this.scene = ours ? ourScene(t0) : theirScene(s, t0, cm));
    const fresh = this.universe !== universe;
    if (fresh) {
      this.universe = universe;
      this.focus = null;
      this.plane = "system";
      this.autoDist = true;
      this.cam.goal.pitch = 0.62;
      this.cam.goal.yaw = -0.5;
    }
    // the ship now, its velocity relative to its primary (map frame)
    const ship: V3 = ours ? [...i.X!] : sub(i.X!, sc.origin(t0));
    const refState = ours && i.ref ? solarState(i.ref, t0) : null;
    const shipVel: V3 = ours ? sub(i.V!, refState!.vel) : (i.V ? [...i.V] : [0, 0, 0]);
    const refPos: V3 = ours ? refState!.pos : sc.byId.get("hole")!.pos;

    // ---- the focus, the plane, the scale
    let fid = this.currentFocus();
    if (fid !== "ship" && !sc.byId.has(fid)) fid = this.homeFocus();
    const fb = fid === "ship" ? null : sc.byId.get(fid)!;
    const F: V3 = fb ? fb.pos : ship;
    this.cam.goal.focus = F;
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
    const now = performance.now();
    const dt = Math.min((now - this.lastWall) / 1000, 0.1);
    this.lastWall = now;
    this.moving = this.cam.update(dt);
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

    // a polyline (its points offset by off), depth-cued, broken behind the camera, faint where a body hides it
    const line = (pts: V3[], col: string, a: number, w: number, dash: number[] = [], occl = true, off?: V3) => {
      if (pts.length < 2) return;
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
          const alpha = a * depthA(p.z) * (hid ? 0.22 : 1);
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
    const labels: { text: string; x: number; y: number; col: string; prio: number; size: number; weight: number; below?: boolean }[] = [];

    // ---- the reference plane's grid (around the focus)
    this.drawGrid(ctx, cw, ch, dpr, pe1, pn, g, ours);

    // ---- the hole (theirs): the disk, its rings, the horizon
    if (sc.hole) {
      const H = sc.byId.get("hole")!.pos;
      const hl = sc.hole;
      if (hl.disk) {
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
      line(circle3(H, hl.isco, [0, 0, 1]), "120, 230, 150", 0.6, 1.1, [4, 3], false);
      line(circle3(H, hl.photon, [0, 0, 1]), "255, 220, 120", 0.5, 1.1, [1.5, 2.5], false);
      line(circle3(H, 2, [0, 0, 1]), "150, 170, 255", 0.35, 1, [3, 3], false);
    }

    // ---- orbits
    const tgt = i.target;
    for (const b of sc.bodies) {
      if (!b.orbit) continue;
      const par = b.parent ? sc.byId.get(b.parent) : null;
      // (a moon's orbit only once it spreads on the screen)
      if (par) {
        const pp = P(par.pos), pb = P(add(b.orbit[0]!, b.orbitOff));
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
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, 2 * Math.PI);
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.strokeStyle = `rgba(${b.col}, ${mine ? 0.55 : 0.22})`;
      ctx.lineWidth = (mine ? 1.3 : 1) * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
      // (a faint fill: the sphere reads as a volume)
      const gr = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, R);
      gr.addColorStop(0, `rgba(${b.col}, 0)`);
      gr.addColorStop(1, `rgba(${b.col}, ${mine ? 0.06 : 0.03})`);
      ctx.fillStyle = gr;
      ctx.fill();
    }

    // ---- bodies, back to front
    const list = sc.bodies.map((b) => ({ b, p: P(b.pos) })).filter((q) => q.p.ok).sort((a, b) => b.p.z - a.p.z);
    for (const { b, p } of list) {
      const moon = b.kind === "moon";
      if (moon) {
        // (a moon hidden in its planet's dot until the two spread apart)
        const pp = b.parent ? P(sc.byId.get(b.parent)!.pos) : null;
        if (pp && pp.ok && Math.hypot(pp.x - p.x, pp.y - p.y) < 6 * dpr && b.id !== tgt && b.id !== fid) continue;
      }
      if (p.x < -60 * dpr || p.y < -60 * dpr || p.x > cw + 60 * dpr || p.y > ch + 60 * dpr) continue;
      const r = rw(b.pos, b.radius) * p.k;
      this.drawBody(ctx, sc, b, p, r, dpr, pw, rw);
      const shown = Math.max(r, b.kind === "star" ? 5 * dpr : moon ? 2 * dpr : 3.2 * dpr);
      this.bodyHits.push({ id: b.id, x: p.x, y: p.y, r: shown });
      if (b.id === tgt) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, shown + 5 * dpr, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(255, 138, 92, 0.95)";
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      }
      const prio = b.id === fid ? 5 : b.id === tgt ? 4 : b.id === i.ref ? 3 : b.kind === "moon" ? 1 : 2;
      labels.push({ text: b.name, x: p.x + shown + 4 * dpr, y: p.y - 3 * dpr, col: b.col, prio, size: moon ? 8.5 : 9.5, weight: moon ? 500 : 600 });
    }

    // ---- stems: the ship and the target down to the reference plane (above: solid; below: dashed)
    const stem = (X: V3, col: string) => {
      const Xw = pw(X);
      const hgt = dot(sub(Xw, this.W), pn);
      const foot = sub(Xw, scale(pn, hgt));
      const a = cam.project(Xw), b = cam.project(foot);
      if (a.z <= near || b.z <= near || Math.hypot(a.x - b.x, a.y - b.y) < 4 * dpr) return;
      ctx.strokeStyle = `rgba(${col}, 0.45)`;
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash(hgt < 0 ? [2 * dpr, 3 * dpr] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // (its foot: a small ellipse in the plane)
      const ring = circle3(foot, cam.cur.dist * 0.012, pn, 24).map((q) => cam.project(q));
      if (ring.every((q) => q.z > near)) {
        ctx.beginPath();
        ring.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.strokeStyle = `rgba(${col}, 0.5)`;
        ctx.stroke();
      }
    };
    if (Math.abs(this.cam.cur.pitch) < 1.45) {
      stem(ship, "124, 214, 255");
      const tb = sc.byId.get(tgt);
      if (tb && tb.id !== fid) stem(tb.pos, "255, 138, 92");
    }

    // ---- paths
    if (ours) this.drawOurPaths(ctx, i, sc, t0, fid, fb, dpr, P, line, labels, pn);
    else this.drawTheirPaths(ctx, i, sc, t0, dpr, P, line, labels, pn, cm);

    // ---- the ship
    this.drawShip(ctx, i, ship, shipVel, P, dpr, ours);

    // ---- labels, kept apart (the focus and the target first)
    labels.sort((a, b) => b.prio - a.prio);
    const boxes: [number, number, number, number][] = [];
    ctx.textAlign = "left";
    for (const l of labels) {
      ctx.font = `${l.weight} ${l.size * dpr}px ${FONT}`;
      const w = ctx.measureText(l.text).width;
      const box: [number, number, number, number] = [l.x - 2 * dpr, l.y - l.size * dpr, w + 4 * dpr, (l.size + 3) * dpr];
      if (l.prio < 4 && boxes.some((q) => box[0] < q[0] + q[2] && q[0] < box[0] + box[2] && box[1] < q[1] + q[3] && q[1] < box[1] + box[3])) continue;
      boxes.push(box);
      ctx.fillStyle = "rgba(4, 8, 14, 0.55)";
      ctx.fillText(l.text, l.x + 0.8 * dpr, l.y + 0.8 * dpr);
      ctx.fillStyle = `rgba(${l.col}, ${l.prio >= 3 ? 0.95 : 0.8})`;
      ctx.fillText(l.text, l.x, l.y);
    }

    // ---- the card of the body under the pointer
    if (this.hover && !this.gizmo && !this.nodeDrag) {
      const id = this.bodyAt(this.hover.x, this.hover.y);
      const b = id ? sc.byId.get(id) : null;
      if (b) this.drawCard(ctx, b, sc, ship, i, ours, cw, ch, dpr);
    }

    // ---- the footer: date, focus, plane, scale bar at the focus's depth
    this.drawFooter(ctx, t0, cw, ch, dpr, ours);
    this.renderCrumbs(sc, fid);
    this.syncBar(sc, fid);
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
      let r = Math.max(dist(ship), 6);
      const hl = sc.hole;
      if (hl?.disk && fid === "hole") r = Math.max(r, hl.diskOuter);
      if (fid !== "hole" && fb) r = Math.min(Math.max(r, fb.radius * 30), Math.max(fb.soi * 2, dist(ship) * 1.3, fb.radius * 30));
      if (i.path) for (let j = 0; j < i.path.pts.length; j += 4) r = Math.max(r, dist(sub(i.path.pts[j]!, sc.origin(t0 + (j + 1) * i.path.dt))));
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
      for (const p of [i.ourFree, i.ourPlan]) {
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
    let r = shipNear ? Math.max(fb.radius * 8, dist(ship) * 1.2) : Math.max(fb.radius * 12, moons.length ? Math.min(Math.max(...moons.map((m) => dist(m.pos))) * 1.15, fb.radius * 30) : 0);
    for (const p of [i.ourFree, i.ourPlan]) {
      if (!p) continue;
      for (let j = 0; j < p.pts.length; j += 4) {
        const q = solarState(fb.id, p.times[j]!).pos;
        const d = len(sub(p.pts[j]!, q));
        if (d < cap && shipNear) r = Math.max(r, d * 1.1);
      }
    }
    return r;
  }

  private drawGrid(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number, e1: V3, n: V3, g: (R: number) => number, ours: boolean) {
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
    for (const { r, R } of radii) {
      ctx.beginPath();
      let open = false;
      for (let j = 0; j <= 96; j++) {
        const a = (j / 96) * 2 * Math.PI;
        const X = add(W, add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a))));
        const p = cam.project(X);
        if (p.z <= near) {
          open = false;
          continue;
        }
        if (open) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        open = true;
      }
      const fade = clamp(1.6 - r / (D * 1.6), 0, 1);
      ctx.strokeStyle = `rgba(124, 214, 255, ${(baseA * fade).toFixed(3)})`;
      ctx.stroke();
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
      const p0 = cam.project(add(W, scale(d, Rmax * 0.04))), p1 = cam.project(add(W, scale(d, Rmax)));
      if (p0.z <= near || p1.z <= near) continue;
      const gr = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      const a0 = j === 0 ? 0.28 : 0.1 * (0.4 + edge);
      gr.addColorStop(0, `rgba(124, 214, 255, ${a0})`);
      gr.addColorStop(1, "rgba(124, 214, 255, 0)");
      ctx.strokeStyle = gr;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      if (j === 0 && p1.x > 0 && p1.x < cw && p1.y > 0 && p1.y < ch) {
        ctx.fillStyle = "rgba(124, 214, 255, 0.4)";
        ctx.font = `${9 * dpr}px ${FONT}`;
        ctx.fillText(ours ? "♈" : "+x", p1.x + 3 * dpr, p1.y);
      }
    }
  }

  /** A body: a lit sphere (a dot when too small), a star's glow, the hole, rings in front and behind. */
  private drawBody(ctx: CanvasRenderingContext2D, sc: MapScene, b: MapBody, p: Proj, r: number, dpr: number, pw: (X: V3) => V3, rw: (X: V3, R: number) => number) {
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
        if ((z < cz) !== front) continue;
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
      const lx = dot(L, cam.right), ly = -dot(L, cam.up), lz = -dot(L, cam.fwd);
      const cx = p.x + lx * r * 0.55, cy = p.y + ly * r * 0.55;
      const gs = ctx.createRadialGradient(cx, cy, r * 0.05, p.x - lx * r * 0.3, p.y - ly * r * 0.3, r * 1.35);
      const lit = 0.55 + 0.45 * Math.max(lz, 0);
      gs.addColorStop(0, `rgba(${b.col}, 1)`);
      gs.addColorStop(0.45, `rgba(${b.col.split(",").map((v) => Math.round(+v * lit * 0.8)).join(",")}, 1)`);
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
    const r1 = b.rings!.inner * b.radius * k, r2 = b.rings!.outer * b.radius * k;
    const n = 48;
    const out: V3[][] = [];
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * 2 * Math.PI, a1 = ((j + 1) / n) * 2 * Math.PI;
      const at = (r: number, a: number) => add(C, add(scale(e1, r * Math.cos(a)), scale(e2, r * Math.sin(a))));
      out.push([at(r1, a0), at(r2, a0), at(r2, a1), at(r1, a1)]);
    }
    return out;
  }

  private drawShip(ctx: CanvasRenderingContext2D, i: Info, ship: V3, vel: V3, P: (X: V3) => Proj, dpr: number, ours: boolean) {
    const p = P(ship);
    if (!p.ok) return;
    // (a heading: the velocity on screen; theirs, the nose if any)
    const dir = ours ? vel : (i.nose as V3 | null) ?? vel;
    let a = 0;
    const dl = len(dir);
    if (dl > 0) {
      const q = P(add(ship, scale(dir, (this.cam.cur.dist * 0.05) / dl)));
      if (q.ok && Math.hypot(q.x - p.x, q.y - p.y) > 0.5) a = Math.atan2(q.y - p.y, q.x - p.x);
    }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (9 + 4 * pulse) * dpr, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(124, 214, 255, ${0.25 + 0.2 * (1 - pulse)})`;
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(9 * dpr, 0);
    ctx.lineTo(-5 * dpr, 5.5 * dpr);
    ctx.lineTo(-2.5 * dpr, 0);
    ctx.lineTo(-5 * dpr, -5.5 * dpr);
    ctx.closePath();
    ctx.fillStyle = "#ffc85a";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1 * dpr;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // its velocity (a short tick)
    if (dl > 0 && ours) {
      const q = P(add(ship, scale(vel, (this.cam.cur.dist * 0.06) / dl)));
      if (q.ok) {
        const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + ((q.x - p.x) / l) * 20 * dpr, p.y + ((q.y - p.y) / l) * 20 * dpr);
        ctx.strokeStyle = "rgba(124, 214, 255, 0.9)";
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
      }
    }
  }

  /** Where a path crosses the reference plane (through the focus): AN going up, DN going down. */
  private crossings(ctx: CanvasRenderingContext2D, pts: V3[], P: (X: V3) => Proj, n: V3, dpr: number, from = 0) {
    if (this.plane === "orbit") return;
    const h0 = (X: V3) => dot(sub(X, this.W), n);
    let marks = 0;
    for (let j = from + 1; j < pts.length && marks < 4; j++) {
      const a = h0(pts[j - 1]!), b = h0(pts[j]!);
      if (a === 0 || Math.sign(a) === Math.sign(b)) continue;
      const f = a / (a - b);
      const X = add(pts[j - 1]!, scale(sub(pts[j]!, pts[j - 1]!), f));
      const p = P(X);
      if (!p.ok) continue;
      const up = b > a;
      marks++;
      ctx.fillStyle = up ? "rgba(111, 227, 161, 0.95)" : "rgba(255, 179, 92, 0.95)";
      ctx.beginPath();
      const r = 4.5 * dpr;
      if (up) {
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y + r * 0.7);
        ctx.lineTo(p.x - r, p.y + r * 0.7);
      } else {
        ctx.moveTo(p.x, p.y + r);
        ctx.lineTo(p.x + r, p.y - r * 0.7);
        ctx.lineTo(p.x - r, p.y - r * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.font = `700 ${8.5 * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(up ? "AN" : "DN", p.x + 6 * dpr, p.y + 3 * dpr);
    }
  }

  private drawOurPaths(
    ctx: CanvasRenderingContext2D, i: Info, sc: MapScene, t0: number, fid: string, fb: MapBody | null, dpr: number,
    P: (X: V3) => Proj, line: (pts: V3[], col: string, a: number, w: number, dash?: number[], occl?: boolean, off?: V3) => void,
    labels: { text: string; x: number; y: number; col: string; prio: number; size: number; weight: number }[], pn: V3,
  ) {
    const s = this.host.s;
    // (the paths in the frame of the focus body — or of the ship's primary when the ship is the focus:
    // where it is when the ship is there, drawn relative to where it is now)
    const frameId = fid === "ship" ? i.ref ?? "sun" : fb?.id === "wormhole" ? "sun" : fid;
    const F0 = solarState(frameId, t0).pos;
    const FA = (X: V3, t: number): V3 => {
      const q = solarState(frameId, t).pos;
      return [X[0] - q[0] + F0[0], X[1] - q[1] + F0[1], X[2] - q[2] + F0[2]];
    };
    // (a path relative to the frame's body, computed once per path — they change a few times a second)
    const rel = (p: OurPath): V3[] => {
      let c = this.relCache.get(p);
      if (!c || c.frame !== frameId) {
        c = { frame: frameId, pts: p.pts.map((X, j) => sub(X, solarState(frameId, p.times[j]!).pos)) };
        this.relCache.set(p, c);
      }
      return c.pts;
    };
    const tag = (X: V3, text: string, col: string, below = false) => {
      const p = P(X);
      if (!p.ok) return;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6 * dpr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = `600 ${9 * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(text, p.x + 5 * dpr, p.y + (below ? 11 : -5) * dpr);
    };
    const km = (d: number) => fmtDist(d, true, s);
    const apsides = (p: OurPath, from: number, label: string) => {
      const body = p.refs[from];
      if (!body || (body === "sun" && frameId !== "sun")) return;
      const key = `aps:${from}`;
      let memo = this.pathMemo.get(p);
      if (!memo) this.pathMemo.set(p, (memo = new Map()));
      if (!memo.has(key)) {
        const tail: OurPath = { ...p, pts: p.pts.slice(from), vels: p.vels.slice(from), times: p.times.slice(from), refs: p.refs.slice(from), nodeAt: [] };
        memo.set(key, ourApsides(tail, body));
      }
      const a = memo.get(key) as ReturnType<typeof ourApsides>;
      if (a.pe) tag(FA(p.pts[from + a.pe.i]!, p.times[from + a.pe.i]!), `${label}Pe ${km(a.pe.alt)}`, "#9fe3ff", true);
      if (a.ap) tag(FA(p.pts[from + a.ap.i]!, p.times[from + a.ap.i]!), `${label}Ap ${km(a.ap.alt)}`, "#9fe3ff");
    };
    const free = i.ourFree, plan = i.ourPlan;
    const hits = (p: OurPath) => {
      const r = rel(p);
      for (let j = 0; j < p.pts.length; j += Math.max(1, Math.floor(p.pts.length / 400))) {
        const q = P(add(r[j]!, F0));
        if (q.ok) this.pathHits.push({ x: q.x, y: q.y, t: p.times[j]! });
      }
    };
    const inFrame = (p: OurPath, a = 0, b = p.pts.length - 1) => rel(p).slice(a, b + 1).map((X) => add(X, F0));
    if (free && free.pts.length > 1) {
      const pts = inFrame(free);
      const cut = plan && plan.nodeAt.length ? Math.min(plan.nodeAt[0]!, free.pts.length - 1) : free.pts.length - 1;
      line(pts, "90, 220, 255", plan ? 0.35 : 0.95, 1.7);
      if (plan) line(pts.slice(0, cut + 1), "90, 220, 255", 0.95, 1.7);
      this.crossings(ctx, pts, P, pn, dpr);
      apsides(free, 0, "");
      hits(free);
      if (free.fate === "impact") {
        const q = P(pts[pts.length - 1]!);
        if (q.ok) {
          ctx.strokeStyle = RED;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(q.x - 5 * dpr, q.y - 5 * dpr); ctx.lineTo(q.x + 5 * dpr, q.y + 5 * dpr);
          ctx.moveTo(q.x + 5 * dpr, q.y - 5 * dpr); ctx.lineTo(q.x - 5 * dpr, q.y + 5 * dpr);
          ctx.stroke();
          ctx.fillStyle = RED;
          ctx.font = `600 ${9 * dpr}px ${FONT}`;
          ctx.fillText(`IMPACT ${BODY_NAMES[free.hit as Target] ?? free.hit}`, q.x + 7 * dpr, q.y + 4 * dpr);
        }
      }
    }
    if (plan && plan.nodeAt.length) {
      const k0 = plan.nodeAt[0]!;
      line(inFrame(plan, k0), "255, 170, 80", 0.95, 1.8, [5, 3]);
      apsides(plan, plan.nodeAt[plan.nodeAt.length - 1]!, "▸ ");
      hits(plan);
    }
    // closest approach to the target, on the plan or the free path
    const tp = plan ?? free;
    if (tp && sc.byId.has(i.target) && i.target !== i.ref && i.target !== "wormhole") {
      let memo = this.pathMemo.get(tp);
      if (!memo) this.pathMemo.set(tp, (memo = new Map()));
      const key = `ca:${i.target}:${plan?.nodeAt[0] ?? 0}`;
      const ca = (memo.has(key) ? memo.get(key) : (memo.set(key, ourClosest(tp, i.target, plan?.nodeAt[0] ?? 0)), memo.get(key))) as ReturnType<typeof ourClosest>;
      if (ca) {
        const t = tp.times[ca.i]!;
        const a = P(FA(tp.pts[ca.i]!, t)), b = P(FA(solarState(i.target, t).pos, t));
        if (a.ok && b.ok) {
          ctx.strokeStyle = "rgba(255, 138, 92, 0.8)";
          ctx.lineWidth = 1 * dpr;
          ctx.setLineDash([2 * dpr, 2 * dpr]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(b.x, b.y, 5 * dpr, 0, 2 * Math.PI);
          ctx.stroke();
          const R = sc.byId.get(i.target)!.radius;
          ctx.fillStyle = "#ff8a5c";
          ctx.font = `600 ${9 * dpr}px ${FONT}`;
          ctx.textAlign = "left";
          ctx.fillText(`CA ${km(Math.max(ca.d - R, 0))} · T−${fmtDur(t - t0, s)}`, (a.x + b.x) / 2 + 6 * dpr, (a.y + b.y) / 2);
        }
      }
    }
    // the target where the plan meets it
    if (i.ourArrive && i.ourArrive.body !== "wormhole" && plan) {
      const q = P(FA(solarState(i.ourArrive.body, i.ourArrive.t).pos, i.ourArrive.t));
      if (q.ok) {
        ctx.strokeStyle = "rgba(255, 170, 80, 0.9)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6 * dpr, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        labels.push({ text: `${BODY_NAMES[i.ourArrive.body as Target] ?? i.ourArrive.body} · T−${fmtDur(i.ourArrive.t - t0, s)}`, x: q.x + 8 * dpr, y: q.y + 3 * dpr, col: "255, 170, 80", prio: 4, size: 8.5, weight: 600 });
      }
    }
    // the nodes and the selected one's handles
    if (plan && i.plan) {
      this.drawNodes(ctx, i, i.plan.nodes.map((n, k) => {
        const j = plan.nodeAt[k];
        if (j === undefined) return null;
        const X = plan.pts[j]!, V = plan.vels[j - 1] ?? plan.vels[j]!, t = plan.times[j]!;
        const base = P(FA(X, t));
        if (!base.ok) return null;
        const dirOf = (cmp: V3) => {
          const d = nodeDvHome(X, V, t, cmp);
          const e = this.cam.cur.dist * 0.02 / Math.max(len(d), 1e-30);
          const q = P(FA(add(X, scale(d, e)), t));
          const l = Math.hypot(q.x - base.x, q.y - base.y) || 1;
          return [(q.x - base.x) / l, (q.y - base.y) / l] as [number, number];
        };
        return { x: base.x, y: base.y, t: n.t, dirs: [dirOf([1, 0, 0]), dirOf([0, 1, 0]), dirOf([0, 0, 1])] };
      }), t0, dpr);
    } else {
      this.nodeHits = [];
      this.handleHits = [];
    }
  }

  private drawTheirPaths(
    ctx: CanvasRenderingContext2D, i: Info, sc: MapScene, t0: number, dpr: number,
    P: (X: V3) => Proj, line: (pts: V3[], col: string, a: number, w: number, dash?: number[], occl?: boolean, off?: V3) => void,
    labels: { text: string; x: number; y: number; col: string; prio: number; size: number; weight: number }[], pn: V3, cm: boolean,
  ) {
    const s = this.host.s;
    const at = (X: V3, t: number): V3 => sub(X, sc.origin(t));
    const path = i.path;
    const T = path ? Math.max(path.pts.length * path.dt, 50) : 200;
    const tick = niceStep(T / 6);
    const tickTimes = Array.from({ length: Math.floor(T / tick) }, (_, j) => t0 + (j + 1) * tick);
    const dotAt = (X: V3, r: number, col: string) => {
      const p = P(X);
      if (!p.ok) return;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * dpr, 0, 2 * Math.PI);
      ctx.fill();
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
      const span = (a: number, b: number, n = 90) => Array.from({ length: n + 1 }, (_, j) => {
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
      this.crossings(ctx, fut, P, pn, dpr);
      ctx.font = `${9.5 * dpr}px ${FONT}`;
      tickTimes.forEach((tt, j) => {
        const idx = (tt - t0) / path.dt - 1;
        if (idx < 0 || idx >= path.pts.length - 1) return;
        const a = path.pts[Math.floor(idx)]!, b = path.pts[Math.floor(idx) + 1]!;
        const f = idx - Math.floor(idx);
        const p = P(at([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tt));
        if (!p.ok) return;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        if (j % 2 === 1) ctx.fillText(`+${fmtShort((j + 1) * tick)}`, p.x + 4 * dpr, p.y - 3 * dpr);
      });
      let iMin = -1, iMax = -1, rMin = Infinity, rMax = -Infinity;
      path.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (r < rMin) (rMin = r), (iMin = j);
        if (r > rMax) (rMax = r), (iMax = j);
      });
      const lbl = (j: number, txt: string) => {
        if (j <= 0 || j >= path.pts.length - 1) return;
        const p = P(at(path.pts[j]!, t0 + (j + 1) * path.dt));
        if (p.ok) labels.push({ text: txt, x: p.x + 5 * dpr, y: p.y + 11 * dpr, col: "124, 214, 255", prio: 4, size: 10, weight: 600 });
      };
      lbl(iMin, "Pe");
      if (path.fate === "continues") lbl(iMax, "Ap");
      if (bad) {
        const p = P(fut[fut.length - 1]!);
        if (p.ok) {
          ctx.strokeStyle = RED;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(p.x - 4 * dpr, p.y - 4 * dpr); ctx.lineTo(p.x + 4 * dpr, p.y + 4 * dpr);
          ctx.moveTo(p.x + 4 * dpr, p.y - 4 * dpr); ctx.lineTo(p.x - 4 * dpr, p.y + 4 * dpr);
          ctx.stroke();
        }
      }
      const ca = this.host.closestApproach(i, t0);
      if (ca && ca.t > 0) {
        const j = Math.max(0, Math.round(ca.t / path.dt) - 1);
        const q = path.pts[Math.min(j, path.pts.length - 1)]!;
        const tt = t0 + ca.t;
        const a = P(at(q, tt)), b = P(at(bodyCentre(s, i.target as Body, tt), tt));
        {
          if (a.ok && b.ok) {
            ctx.strokeStyle = "rgba(255, 138, 92, 0.9)";
            ctx.lineWidth = 1.2 * dpr;
            ctx.setLineDash([2 * dpr, 2 * dpr]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#ff8a5c";
            ctx.textAlign = "left";
            ctx.fillText(`CA ${fmtLen(ca.d, s)}`, (a.x + b.x) / 2 + 5 * dpr, (a.y + b.y) / 2);
          }
        }
      }
      for (let j = 0; j < path.pts.length; j += Math.max(1, Math.floor(path.pts.length / 300))) {
        const t = t0 + (j + 1) * path.dt;
        const p = P(at(path.pts[j]!, t));
        if (p.ok) this.pathHits.push({ x: p.x, y: p.y, t });
      }
    }
    // the flight plan: its path through the nodes, the nodes
    if (i.plan?.path && i.plan.path.pts.length > 1) {
      const pp = i.plan.path;
      line([at(i.X!, t0), ...pp.pts.map((q, j) => at(q, pp.times[j]!))], "255, 170, 80", 0.95, 1.8, [5, 3]);
      for (let j = 0; j < pp.pts.length; j += Math.max(1, Math.floor(pp.pts.length / 300))) {
        const p = P(at(pp.pts[j]!, pp.times[j]!));
        if (p.ok) this.pathHits.push({ x: p.x, y: p.y, t: pp.times[j]! });
      }
      this.drawNodes(ctx, i, i.plan.nodes.map((n) => {
        let j = pp.times.findIndex((tt) => tt >= n.t);
        if (j < 0) j = pp.pts.length - 1;
        const X = pp.pts[j]!;
        const A = pp.pts[Math.max(j - 1, 0)]!, B = pp.pts[Math.min(j + 1, pp.pts.length - 1)]!;
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
      }), t0, dpr);
      const lastNode = i.plan.nodes[i.plan.nodes.length - 1];
      if ((lastNode?.then === "approach" || lastNode?.then === "orbit") && s.sun) {
        const p = P(at(starCentre(s, lastNode.t), lastNode.t));
        if (p.ok) {
          ctx.strokeStyle = "rgba(255, 211, 107, 0.9)";
          ctx.lineWidth = 1.5 * dpr;
          ctx.setLineDash([2 * dpr, 2 * dpr]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7 * dpr, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.setLineDash([]);
          labels.push({ text: "RDV", x: p.x + 9 * dpr, y: p.y + 4 * dpr, col: "255, 211, 107", prio: 4, size: 9.5, weight: 600 });
        }
      } else if (pp.fate === "horizon" || pp.fate === "star" || pp.fate === "wormhole") {
        const p = P(at(pp.pts[pp.pts.length - 1]!, pp.times[pp.times.length - 1]!));
        if (p.ok) {
          ctx.strokeStyle = pp.fate === "wormhole" ? "#c88cff" : RED;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5 * dpr, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    } else {
      this.nodeHits = [];
      this.handleHits = [];
    }
  }

  /**
   * The nodes (either side): diamonds; the selected one's six handles — prograde / retrograde
   * (green), normal / anti-normal (magenta), radial out / in (cyan) — to drag (the longer the pull,
   * the faster its Δv grows), its Δv, burn time and countdown. places: each node's screen place and
   * its P, N, R directions on screen.
   */
  private drawNodes(ctx: CanvasRenderingContext2D, i: Info, places: ({ x: number; y: number; t: number; dirs: [number, number][] } | null)[], t0: number, dpr: number) {
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
      ctx.fillStyle = sel ? "#5ad8ff" : "#2fa4d0";
      ctx.strokeStyle = "#04121a";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(pl.x, pl.y - r);
      ctx.lineTo(pl.x + r, pl.y);
      ctx.lineTo(pl.x, pl.y + r);
      ctx.lineTo(pl.x - r, pl.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#dff6ff";
      ctx.textAlign = "left";
      ctx.font = `700 ${9.5 * dpr}px ${FONT}`;
      ctx.fillText(`${k + 1}`, pl.x + 8 * dpr, pl.y - 6 * dpr);
      if (!sel) return;
      for (let c = 0; c < 3; c++) {
        let d = pl.dirs[c]!;
        if (!(Math.hypot(d[0], d[1]) > 0.2)) d = c === 1 ? [0, -1] : [1, 0];
        for (const sign of [1, -1]) {
          const hx = pl.x + sign * d[0] * 36 * dpr, hy = pl.y + sign * d[1] * 36 * dpr;
          ctx.strokeStyle = "rgba(220, 235, 255, 0.25)";
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.moveTo(pl.x + sign * d[0] * 10 * dpr, pl.y + sign * d[1] * 10 * dpr);
          ctx.lineTo(hx, hy);
          ctx.stroke();
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
        `NODE ${k + 1} · T−${fmtDur(n.t - t0, this.host.s)}`,
        `Δv ${kms >= 1000 ? `${dvl.toFixed(4)} c` : `${kms >= 10 ? kms.toFixed(1) : (kms * 1000).toFixed(0) + " m/s"}${kms >= 10 ? " km/s" : ""}`}  ·  burn ${fmtDur(burn, this.host.s)}`,
        `P ${fmtDv(n.dv[0])}  N ${fmtDv(n.dv[1])}  R ${fmtDv(n.dv[2])}`,
      ];
      ctx.font = `600 ${9.5 * dpr}px ${FONT}`;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12 * dpr;
      const bx = pl.x + 44 * dpr, by = pl.y + 16 * dpr;
      ctx.fillStyle = "rgba(4, 10, 18, 0.82)";
      ctx.fillRect(bx, by, w, 44 * dpr);
      ctx.strokeStyle = "rgba(90, 216, 255, 0.5)";
      ctx.strokeRect(bx, by, w, 44 * dpr);
      ctx.fillStyle = "#dff6ff";
      lines.forEach((l, j) => ctx.fillText(l, bx + 6 * dpr, by + (13 + 13 * j) * dpr));
    });
  }

  /** The card of a body under the pointer: its kind, distance from the ship, size, orbit. */
  private drawCard(ctx: CanvasRenderingContext2D, b: MapBody, sc: MapScene, ship: V3, i: Info, ours: boolean, cw: number, ch: number, dpr: number) {
    const s = this.host.s;
    const d = len(sub(b.pos, ship)) - (b.kind === "mouth" ? 0 : b.radius);
    const rows: [string, string][] = [];
    rows.push(["From the ship", fmtDist(Math.max(d, 0), ours, s)]);
    if (b.radius > 0 && b.kind !== "mouth") rows.push(["Radius", b.kind === "hole" ? fmtLen(b.radius, s) : fmtDist(b.radius, ours, s)]);
    const par = b.parent ? sc.byId.get(b.parent) : null;
    if (par) rows.push([`From ${par.name}`, fmtDist(len(sub(b.pos, par.pos)), ours, s)]);
    if (b.period) rows.push(["Period", fmtDur(b.period, s)]);
    if (b.soi > 0 && Number.isFinite(b.soi)) rows.push(["Sphere of influence", fmtDist(b.soi, ours, s)]);
    const hint = b.id === i.target ? "the target · double-click: centre it" : "click: target · double-click: centre";
    const title = b.name;
    ctx.font = `700 ${11 * dpr}px ${FONT}`;
    let w = ctx.measureText(title).width;
    ctx.font = `${9.5 * dpr}px ${FONT}`;
    for (const [k, v] of rows) w = Math.max(w, ctx.measureText(`${k}  ${v}`).width + 16 * dpr);
    w = Math.max(w, ctx.measureText(hint).width) + 20 * dpr;
    const hgt = (30 + rows.length * 14 + 16) * dpr;
    let x = this.hover!.x + 16 * dpr, y = this.hover!.y + 12 * dpr;
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
    ctx.font = `700 ${11 * dpr}px ${FONT}`;
    ctx.fillText(title, x + 22 * dpr, y + 19 * dpr);
    ctx.font = `${9.5 * dpr}px ${FONT}`;
    rows.forEach(([k, v], j) => {
      const yy = y + (36 + j * 14) * dpr;
      ctx.fillStyle = "rgba(200, 210, 225, 0.65)";
      ctx.textAlign = "left";
      ctx.fillText(k, x + 10 * dpr, yy);
      ctx.fillStyle = "#eef3fa";
      ctx.textAlign = "right";
      ctx.font = `${9.5 * dpr}px ${MONO}`;
      ctx.fillText(v, x + w - 10 * dpr, yy);
      ctx.font = `${9.5 * dpr}px ${FONT}`;
    });
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(124, 214, 255, 0.75)";
    ctx.font = `${8.5 * dpr}px ${FONT}`;
    ctx.fillText(hint, x + 10 * dpr, y + hgt - 8 * dpr);
  }

  private drawFooter(ctx: CanvasRenderingContext2D, t0: number, cw: number, ch: number, dpr: number, ours: boolean) {
    const s = this.host.s;
    // a scale bar at the focus's depth (true scale only)
    if (!this.log) {
      const k = this.cam.focal / this.cam.cur.dist;
      const bar = niceStep((cw * 0.22) / k);
      ctx.strokeStyle = "rgba(230, 235, 245, 0.75)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      const x0 = cw - 10 * dpr - bar * k;
      ctx.moveTo(x0, ch - 10 * dpr);
      ctx.lineTo(cw - 10 * dpr, ch - 10 * dpr);
      ctx.moveTo(x0, ch - 13 * dpr);
      ctx.lineTo(x0, ch - 7 * dpr);
      ctx.moveTo(cw - 10 * dpr, ch - 13 * dpr);
      ctx.lineTo(cw - 10 * dpr, ch - 7 * dpr);
      ctx.stroke();
      ctx.fillStyle = "rgba(230, 235, 245, 0.85)";
      ctx.font = `${9 * dpr}px ${MONO}`;
      ctx.textAlign = "right";
      ctx.fillText(fmtDist(bar, ours, s), cw - 10 * dpr, ch - 16 * dpr);
    }
    const plane = PLANES.find((p) => p.id === this.plane)!.label.toLowerCase();
    ctx.fillStyle = "rgba(220, 225, 235, 0.55)";
    ctx.textAlign = "left";
    ctx.font = `${9 * dpr}px ${FONT}`;
    const date = ours ? `${dateOf(t0).toISOString().slice(0, 10)} · ` : "";
    ctx.fillText(`${date}${plane} plane · ${this.log ? "log scale" : "true scale"}`, 8 * dpr, ch - 8 * dpr);
  }
}
