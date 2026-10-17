// The console's displays on one canvas: each view drawn by its module (draw/), the dashboard several at once.
// Drawn on demand — new data, a gesture, the easing of the 4 Hz figures —; only the radar's sweep and a blinking alert
// keep it running, at 30 frames a second at most.
import { relative, type CrewModel } from "./model";
import type { InstrumentKey } from "../net/instruments";
import { unitsOf, type UnitSys } from "../ui/unitsys";
import { C, clamp, Pen, type Point, type Rect } from "./draw/kit";
import { Smoother, targets, type Scene } from "./draw/scene";
import { drawPfd } from "./draw/pfd";
import { drawNd } from "./draw/nd";
import { drawGeo } from "./draw/geo";
import { mercX, mercY, Tiles, unMercX, unMercY } from "./draw/tiles";
import { drawRadar } from "./draw/radar";
import { drawSystems, systemsHeight } from "./draw/systems";
import { drawPlan, planHeight } from "./draw/plan";
import { drawChart } from "./draw/chart";

export type CrewView = "dash" | "pfd" | "nd" | "map" | "globe" | "radar" | "schematic" | "plan" | "telemetry";
export const VIEW_NAMES: Record<CrewView, string> = {
  dash: "Tableau",
  pfd: "Vol",
  nd: "Navigation",
  map: "Carte",
  globe: "Globe",
  radar: "Radar",
  schematic: "Systèmes",
  plan: "Plan de vol",
  telemetry: "Télémétrie",
};
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
type Pick = { point: Point; slot?: number; contact?: string; view?: CrewView; r?: Rect };

export class CrewViews {
  view: CrewView = "dash";
  zoom = 1;
  follow = true;
  lat = 20;
  lon = 0;
  range = 50_000;
  north = false;
  sensor = false;
  channel: InstrumentKey | "multi" = "alt";
  window = 60;
  paused = false;
  private pausedAt = 0;
  inspect = 1;
  readout = "";
  selectedContact: string | null = null;
  units: UnitSys = "metric";
  scroll = 0;
  private W = 1;
  private H = 1;
  private picks: Pick[] = [];
  private pointers = new Map<number, Point>();
  private moved = 0;
  private pinch = 0;
  private raf = 0;
  private lastFrame = 0;
  private smooth = new Smoother();
  /** the map's tiles (OpenStreetMap, CARTO's night style): fetched only while a map is drawn */
  private tiles = new Tiles();
  private dpr = 1;
  private ctx: CanvasRenderingContext2D;
  private pen: Pen;
  private resize: ResizeObserver;
  onSelect: (slot: number) => void = () => {};
  onInspect: () => void = () => {};
  onContact: (id: string) => void = () => {};
  onOpen: (view: CrewView) => void = () => {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly model: CrewModel,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.pen = new Pen(this.ctx);
    this.resize = new ResizeObserver(() => this.request());
    this.tiles.onLoad = () => this.request();
    this.resize.observe(canvas);
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      this.moved = 0;
      this.pinch = this.spread();
      if (this.view === "telemetry") this.scrub(e.clientX);
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p[0],
        dy = e.clientY - p[1];
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size > 1) {
        const d = this.spread();
        if (this.pinch > 0 && d > 0) this.zoomBy(d / this.pinch);
        this.pinch = d;
      } else if (this.view === "telemetry") this.scrub(e.clientX);
      else if (this.view === "schematic" || this.view === "plan") this.scrollBy(-dy);
      else if (this.view === "map") this.panPx(dx, dy);
      else if (this.view === "globe") {
        this.follow = false;
        const k = (Math.min(this.W, this.H) * 0.42 * this.zoom * Math.PI) / 180;
        this.lon = wrap(this.lon - dx / k);
        this.lat = clamp(this.lat + dy / k, -85, 85);
        this.request();
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (this.pointers.size === 1 && this.moved < 8 && this.view !== "telemetry") {
        const b = canvas.getBoundingClientRect();
        const x = e.clientX - b.left,
          y = e.clientY - b.top;
        const near = this.picks
          .filter((p) => !p.view && Math.hypot(p.point[0] - x, p.point[1] - y) < 26)
          .sort((a, b2) => Math.hypot(a.point[0] - x, a.point[1] - y) - Math.hypot(b2.point[0] - x, b2.point[1] - y))[0];
        const panel = this.picks.find((p) => p.view && p.r && x >= p.r.x && x <= p.r.x + p.r.w && y >= p.r.y && y <= p.r.y + p.r.h);
        if (near?.slot !== undefined) this.onSelect(near.slot);
        else if (near?.contact) this.onContact(near.contact);
        else if (panel?.view) this.onOpen(panel.view);
      }
      this.pointers.delete(e.pointerId);
      this.pinch = this.spread();
    });
    for (const ev of ["pointercancel", "lostpointercapture"] as const)
      canvas.addEventListener(ev, (e) => {
        this.pointers.delete(e.pointerId);
        this.pinch = this.spread();
      });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.view === "schematic" || this.view === "plan") this.scrollBy(e.deltaY);
        else this.zoomBy(Math.exp(-e.deltaY * 0.002));
      },
      { passive: false },
    );
  }
  /** the map moved under the finger by pixels (Web Mercator) */
  private panPx(dx: number, dy: number) {
    this.follow = false;
    const S = 256 * 2 ** this.zoom;
    this.lon = wrap(unMercX(mercX(this.lon) - dx / S));
    this.lat = clamp(unMercY(clamp(mercY(this.lat) - dy / S, 0, 1)), -85, 85);
    this.request();
  }
  private spread() {
    const ps = [...this.pointers.values()];
    return ps.length < 2 ? 0 : Math.hypot(ps[0]![0] - ps[1]![0], ps[0]![1] - ps[1]![1]);
  }
  private scrub(x: number) {
    const left = this.canvas.getBoundingClientRect().left;
    this.inspect = clamp((x - left - 70) / Math.max(1, this.W - 100), 0, 1);
    this.request();
    this.onInspect();
  }
  private contentHeight() {
    if (this.view === "schematic") return Math.max(this.H, systemsHeight(this.W - 16) + 16);
    if (this.view === "plan") return planHeight(this.scene(false), this.W - 16, this.H - 16) + 16;
    return this.H;
  }
  scrollBy(d: number) {
    this.scroll = clamp(this.scroll + d, 0, Math.max(0, this.contentHeight() - this.H));
    this.request();
  }
  setView(view: CrewView) {
    this.view = view;
    this.scroll = 0;
    this.reset();
  }
  reset() {
    this.zoom = this.view === "map" ? 9 : this.view === "globe" ? 1.4 : 1;
    this.follow = true;
    this.inspect = 1;
    this.request();
  }
  pan(east: number, north: number) {
    if (this.view === "map") return this.panPx(-east * this.W * 0.25, north * this.H * 0.25);
    this.follow = false;
    this.lon = wrap(this.lon + (east * 15) / this.zoom);
    this.lat = clamp(this.lat + (north * 15) / this.zoom, -85, 85);
    this.request();
  }
  togglePause() {
    this.paused = !this.paused;
    this.pausedAt = this.model.history.get(this.model.selected ?? -1)?.at(-1)?.t ?? 0;
    this.request();
  }
  zoomBy(k: number) {
    if (this.view === "radar" || this.view === "nd" || this.view === "dash") this.range = clamp(this.range / k, 500, 2e7);
    else if (this.view === "telemetry") this.window = clamp(this.window / k, 10, 3600);
    else if (this.view === "map") this.zoom = clamp(this.zoom + Math.log2(k), 2, 18);
    else if (this.view === "globe") this.zoom = clamp(this.zoom * k, 0.7, 40);
    else if (this.view === "schematic" || this.view === "plan") this.scrollBy(k > 1 ? -120 : 120);
    this.request();
  }
  request() {
    if (!this.raf)
      this.raf = requestAnimationFrame((t) => {
        this.raf = 0;
        this.frame(t);
      });
  }
  private frame(t: number) {
    const animate = this.draw();
    if (!animate || document.hidden) return;
    // (the continuous ones at 30 Hz at most)
    if (t - this.lastFrame < 30 && this.lastFrame) {
      this.raf = requestAnimationFrame((t2) => {
        this.raf = 0;
        this.frame(t2);
      });
      return;
    }
    this.lastFrame = t;
    this.request();
  }
  fit() {
    const crafts = this.model.crafts(),
      own = this.model.own(crafts);
    if (own) this.range = Math.max(1000, ...crafts.map((c) => relative(own, c)?.distance ?? 0)) * 1.25;
    this.request();
  }
  private scene(step = true): Scene {
    const crafts = this.model.crafts(),
      own = this.model.own(crafts);
    if (step) this.easing = this.smooth.step(targets(own), own?.snapshot?.t, performance.now());
    return {
      own,
      crafts,
      snap: own?.snapshot ?? null,
      s: this.smooth.v,
      u: unitsOf(this.units),
      history: this.model.history.get(own?.member.slot ?? -1) ?? [],
      contacts: this.model.contacts(),
      zones: this.model.zones(),
      now: performance.now() / 1000,
      stale: !own || own.age > 3,
    };
  }
  private easing = false;
  /** a frame; true: draw the next one too (an easing, a sweep, a blink) */
  draw(): boolean {
    const c = this.ctx,
      cv = this.canvas;
    this.W = Math.max(1, cv.clientWidth);
    this.H = Math.max(1, cv.clientHeight);
    // (the backing store: sharp on a phone's screen, bounded on a large one)
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4.2e6 / (this.W * this.H)));
    this.dpr = dpr;
    const w = Math.round(this.W * dpr),
      h = Math.round(this.H * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = C.bg;
    c.fillRect(0, 0, this.W, this.H);
    this.picks = [];
    const sc = this.scene();
    const r: Rect = { x: 8, y: 8, w: this.W - 16, h: this.H - 16 };
    const pick = (point: Point, what: { slot?: number; contact?: string }) => this.picks.push({ point, ...what });
    if (this.follow && sc.own?.geo) {
      this.lat = sc.own.geo.lat;
      this.lon = sc.own.geo.lon;
    }
    let animate = this.easing;
    const p = this.pen;
    const blink = !!sc.snap?.warn?.length;
    switch (this.view) {
      case "dash":
        this.dash(r, sc);
        break;
      case "pfd":
        p.panel(r);
        drawPfd(p, r, sc);
        break;
      case "nd":
        drawNd(p, r, sc, { range: this.range, north: this.north, arc: r.h > 300 && !this.north, sensor: this.sensor, pick });
        break;
      case "map":
      case "globe":
        drawGeo(p, r, sc, {
          globe: this.view === "globe",
          lat: this.lat,
          lon: this.lon,
          zoom: this.zoom,
          tiles: this.tiles,
          dpr: this.dpr,
          pick,
        });
        break;
      case "radar":
        drawRadar(p, r, sc, { range: this.range, north: this.north, sensor: this.sensor, selected: this.selectedContact, pick });
        animate = true;
        break;
      case "schematic": {
        this.scroll = clamp(this.scroll, 0, Math.max(0, this.contentHeight() - this.H));
        c.save();
        c.translate(0, -this.scroll);
        drawSystems(p, { ...r, h: this.contentHeight() - 16 }, sc);
        c.restore();
        animate ||= blink;
        break;
      }
      case "plan":
        this.scroll = clamp(this.scroll, 0, Math.max(0, this.contentHeight() - this.H));
        c.save();
        p.clip(r);
        drawPlan(p, r, sc, this.scroll);
        c.restore();
        break;
      case "telemetry": {
        const end = this.paused ? this.pausedAt : (sc.history.at(-1)?.t ?? 0);
        this.readout = drawChart(p, r, sc.history, this.channel, this.window, end, this.inspect).readout;
        break;
      }
    }
    if (this.contentHeight() > this.H && (this.view === "schematic" || this.view === "plan")) {
      const ch = this.contentHeight(),
        th = Math.max(30, (this.H * this.H) / ch);
      p.round(this.W - 5, (this.scroll / (ch - this.H)) * (this.H - th), 3, th, 2);
      p.fill("#3fd8ff55");
    }
    if (!sc.own) {
      c.fillStyle = "#05090ecc";
      c.fillRect(0, this.H / 2 - 34, this.W, 68);
      p.text("En attente d’un pilote connecté…", this.W / 2, this.H / 2 - 4, { col: C.white, size: 15, align: "center", weight: 700 });
      p.text("Les instruments s’afficheront dès qu’un pilote vole dans la salle.", this.W / 2, this.H / 2 + 18, {
        col: C.dim,
        size: 11,
        align: "center",
      });
    }
    return animate || (this.view === "dash" && blink);
  }
  /** the dashboard: the PFD and the ND always, the systems, the plan, the map as the room allows */
  private dash(r: Rect, sc: Scene) {
    const p = this.pen,
      g = 8;
    const panels: [CrewView, Rect][] = [];
    const wide = r.w > r.h * 1.25;
    if (wide && r.w > 1100) {
      const c1 = r.w * 0.36,
        c2 = r.w * 0.34,
        c3 = r.w - c1 - c2 - g * 2;
      panels.push(["pfd", { x: r.x, y: r.y, w: c1, h: r.h }]);
      panels.push(["nd", { x: r.x + c1 + g, y: r.y, w: c2, h: r.h }]);
      const h1 = r.h * 0.5;
      panels.push(["map", { x: r.x + c1 + c2 + g * 2, y: r.y, w: c3, h: h1 - g / 2 }]);
      panels.push(["plan", { x: r.x + c1 + c2 + g * 2, y: r.y + h1 + g / 2, w: c3, h: r.h - h1 - g / 2 }]);
    } else if (wide) {
      const c1 = (r.w - g) / 2;
      panels.push(["pfd", { x: r.x, y: r.y, w: c1, h: r.h }]);
      panels.push(["nd", { x: r.x + c1 + g, y: r.y, w: r.w - c1 - g, h: r.h }]);
    } else if (r.h > 900 && r.w > 700) {
      const h1 = (r.h - g) * 0.5,
        c1 = (r.w - g) / 2;
      panels.push(["pfd", { x: r.x, y: r.y, w: c1, h: h1 }]);
      panels.push(["nd", { x: r.x + c1 + g, y: r.y, w: r.w - c1 - g, h: h1 }]);
      panels.push(["map", { x: r.x, y: r.y + h1 + g, w: c1, h: r.h - h1 - g }]);
      panels.push(["plan", { x: r.x + c1 + g, y: r.y + h1 + g, w: r.w - c1 - g, h: r.h - h1 - g }]);
    } else {
      const h1 = (r.h - g) * 0.52;
      panels.push(["pfd", { x: r.x, y: r.y, w: r.w, h: h1 }]);
      panels.push(["nd", { x: r.x, y: r.y + h1 + g, w: r.w, h: r.h - h1 - g }]);
    }
    for (const [view, q] of panels) {
      this.ctx.save();
      p.clip(q);
      if (view === "pfd") {
        p.panel(q);
        drawPfd(p, q, sc);
      } else if (view === "nd") drawNd(p, q, sc, { range: this.range, north: false, arc: q.h > 260, sensor: this.sensor });
      else if (view === "map") drawGeo(p, q, sc, { globe: false, lat: this.lat, lon: this.lon, zoom: 8, tiles: this.tiles, dpr: this.dpr });
      else if (view === "plan") drawPlan(p, q, sc);
      this.ctx.restore();
      p.round(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 10);
      p.stroke("#1f3c4b", 1);
      this.picks.push({ point: [q.x, q.y], view, r: q });
    }
  }
}
