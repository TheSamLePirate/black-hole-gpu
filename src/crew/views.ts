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
import { wgs84Direct } from "../system/ellipsoid";
import { mercX, mercY, Tiles, unMercX, unMercY } from "./draw/tiles";
import { EarthGlobe } from "./draw/earth";
import { drawRadar } from "./draw/radar";
import { drawSystems, systemsHeight } from "./draw/systems";
import { drawPlan, planHeight } from "./draw/plan";
import { drawChart } from "./draw/chart";
import { drawOrbit } from "./draw/orbit";
import { drawAirStatus, drawSpaceStatus } from "./draw/spacestat";
import type { CrewView } from "./profile";

export type { CrewView } from "./profile";
export const VIEW_NAMES: Record<CrewView, string> = {
  air: "Mission aérienne",
  sdash: "Tableau",
  orbit: "Orbite",
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
type Pick = { point: Point; slot?: number; contact?: string; wp?: number; view?: CrewView; r?: Rect };
type Where = { lat: number; lon: number };

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
  /** the globe's photographed Earth: its imagery and its renderer (WebGPU, else the processor), made when first shown */
  readonly earth = new EarthGlobe(() => this.request());
  private dpr = 1;
  private ctx: CanvasRenderingContext2D;
  private pen: Pen;
  private resize: ResizeObserver;
  onSelect: (slot: number) => void = () => {};
  onInspect: () => void = () => {};
  onContact: (id: string, x?: number, y?: number) => void = () => {};
  onOpen: (view: CrewView) => void = () => {};
  /** the flight plan touched (PLAN-CREW-ACTIONS A2): a waypoint (its index, where on the screen), the ground (where
   *  on the Earth, where on the screen), a waypoint dragged to a new place */
  onWp: (i: number, x: number, y: number) => void = () => {};
  onGround: (at: Where, x: number, y: number) => void = () => {};
  onMoveWp: (i: number, at: Where) => void = () => {};
  /** the screen's point back to the Earth's (the map's, the ND's this frame); null: none */
  private unproject: ((x: number, y: number) => Where | null) | null = null;
  /** where a menu was opened on the map or the ND (its crosshair while it is open) */
  marker: Point | null = null;
  /** a waypoint touched: its index, the finger's place, when; dragged once held 250 ms still (armed), else the map */
  private drag: { i: number; x: number; y: number; moved: boolean; at: number; armed: boolean } | null = null;

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
      // (a waypoint under the finger on the map or the ND: dragged, not the map)
      if (this.pointers.size === 1 && (this.view === "map" || this.view === "nd")) {
        const [x, y] = this.local(e);
        const wp = this.nearest(x, y, 22, (p) => p.wp !== undefined && !p.r);
        this.drag = wp ? { i: wp.wp!, x, y, moved: false, at: performance.now(), armed: false } : null;
        // (held still: the waypoint taken — its ghost shows it)
        if (this.drag) {
          const d = this.drag;
          setTimeout(() => {
            if (this.drag === d && this.moved < 8) {
              d.armed = true;
              navigator.vibrate?.(15);
              this.request();
            }
          }, 250);
        }
      } else this.drag = null;
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p[0],
        dy = e.clientY - p[1];
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      // (a second finger: a pinch, never a waypoint's drag)
      if (this.pointers.size > 1) this.drag = null;
      if (this.drag && this.pointers.size === 1 && (this.drag.armed || this.moved < 8)) {
        [this.drag.x, this.drag.y] = this.local(e);
        this.drag.moved ||= this.moved > 8;
        if (this.drag.armed) {
          this.request();
          return;
        }
      }
      // (moved before it was held: the map, not the waypoint)
      if (this.drag && !this.drag.armed && this.moved >= 8) this.drag = null;
      if (this.drag) return;
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
      const [x, y] = this.local(e);
      const drag = this.drag;
      this.drag = null;
      if (drag && this.pointers.size === 1) {
        // (a waypoint dropped somewhere new, or touched where it was)
        const at = drag.moved ? this.unproject?.(x, y) : null;
        if (at) this.onMoveWp(drag.i, at);
        else if (!drag.moved) this.onWp(drag.i, x, y);
        this.request();
      } else if (this.pointers.size === 1 && this.moved < 8 && this.view !== "telemetry") {
        const row = this.picks.find(
          (p) => p.wp !== undefined && p.r && x >= p.r.x && x <= p.r.x + p.r.w && y >= p.r.y && y <= p.r.y + p.r.h,
        );
        const near = this.nearest(x, y, 26, (p) => !p.view && !p.r);
        const panel = this.picks.find((p) => p.view && p.r && x >= p.r.x && x <= p.r.x + p.r.w && y >= p.r.y && y <= p.r.y + p.r.h);
        if (row) this.onWp(row.wp!, x, y);
        else if (near?.slot !== undefined) this.onSelect(near.slot);
        else if (near?.contact) this.onContact(near.contact, x, y);
        else if (near?.wp !== undefined) this.onWp(near.wp, x, y);
        else if (panel?.view) this.onOpen(panel.view);
        else if (this.view === "map" || this.view === "nd") {
          const at = this.unproject?.(x, y);
          if (at) this.onGround(at, x, y);
        }
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
  /** a pointer's place on the canvas */
  private local(e: PointerEvent): Point {
    const b = this.canvas.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }
  /** the pick nearest a point, within a radius, among those a test keeps */
  private nearest(x: number, y: number, r: number, keep: (p: Pick) => boolean) {
    let best: Pick | null = null,
      bd = r;
    for (const p of this.picks) {
      if (!keep(p)) continue;
      const d = Math.hypot(p.point[0] - x, p.point[1] - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
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
    if (this.view === "radar" || this.view === "nd" || this.view === "dash" || this.view === "air")
      this.range = clamp(this.range / k, 500, 2e7);
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
    const pick = (point: Point, what: { slot?: number; contact?: string; wp?: number }) => this.picks.push({ point, ...what });
    this.unproject = null;
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
      case "sdash":
        this.sdash(r, sc);
        break;
      case "air":
        this.air(r, sc);
        animate = true;
        break;
      case "orbit":
        drawOrbit(p, r, sc);
        break;
      case "pfd":
        p.panel(r);
        drawPfd(p, r, sc);
        break;
      case "nd": {
        const g = drawNd(p, r, sc, { range: this.range, north: this.north, arc: r.h > 300 && !this.north, sensor: this.sensor, pick });
        const geo = sc.own?.geo;
        // (a point of the ND: its bearing and distance from the craft, on the WGS84 ellipsoid)
        if (geo)
          this.unproject = (x, y) => {
            const dx = x - g.cx,
              dy = y - g.cy;
            return wgs84Direct(geo.lat, geo.lon, Math.atan2(dx, -dy) + g.up, Math.hypot(dx, dy) / g.k);
          };
        break;
      }
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
          ...(this.view === "globe" ? { earth: this.earth, sun: sc.snap?.sun ?? null } : {}),
        });
        if (this.view === "globe") this.earth.start();
        if (this.view === "map") {
          // (the map's point: Web Mercator undone about its centre)
          const S = 256 * 2 ** this.zoom,
            cx = r.x + r.w / 2,
            cy = r.y + r.h / 2,
            mx = mercX(this.lon) * S,
            my = mercY(this.lat) * S;
          this.unproject = (x, y) => ({
            lat: unMercY(clamp((my + y - cy) / S, 0, 1)),
            lon: wrap(unMercX((mx + x - cx) / S)),
          });
        }
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
        drawPlan(p, r, sc, this.scroll, (q, i) => this.picks.push({ point: [q.x, q.y], r: q, wp: i }));
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
    // the place a menu was opened for
    if (this.marker && (this.view === "map" || this.view === "nd")) {
      const [x, y] = this.marker;
      p.circle(x, y, 11);
      p.stroke(C.magenta, 2);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        p.seg(x + dx * 6, y + dy * 6, x + dx * 17, y + dy * 17, C.magenta, 2);
    }
    // the waypoint being dragged: its ghost under the finger, the name it carries
    if (this.drag?.armed) {
      const d = this.drag;
      const name = sc.snap?.route[d.i]?.name ?? `point ${d.i + 1}`;
      p.circle(d.x, d.y, 20);
      p.fill("#ff5ce122");
      p.stroke(C.magenta, 1.5, [4, 4]);
      p.star(d.x, d.y, 9, C.magenta, true);
      p.text(`${name} → ici`, d.x + 22, d.y - 14, { col: C.white, size: 12, weight: 700, bg: "#050a0ee0" });
      animate = true;
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
    return animate || ((this.view === "dash" || this.view === "sdash") && blink);
  }
  /** a dashboard's panel: drawn clipped, framed, touched to open its view */
  private panelOf(view: CrewView, q: Rect, draw: () => void) {
    const p = this.pen;
    // (too small to draw: a phone's landscape strip)
    if (q.w < 90 || q.h < 60) return;
    this.ctx.save();
    p.clip(q);
    draw();
    this.ctx.restore();
    p.round(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 10);
    p.stroke("#1f3c4b", 1);
    this.picks.push({ point: [q.x, q.y], view, r: q });
  }
  /** the spacecraft's dashboard (PLAN-VAISSEAUX K2): the orbit large, the attitude, the flight computer's column */
  private sdash(r: Rect, sc: Scene) {
    const p = this.pen,
      g = 8;
    const wide = r.w > r.h * 1.1;
    if (wide) {
      const c3 = Math.min(360, r.w * 0.3),
        c1 = r.w - c3 - g;
      const h1 = r.h * (r.w > 1100 ? 0.62 : 0.58);
      this.panelOf("orbit", { x: r.x, y: r.y, w: c1, h: h1 }, () => drawOrbit(p, { x: r.x, y: r.y, w: c1, h: h1 }, sc));
      const q = { x: r.x, y: r.y + h1 + g, w: c1, h: r.h - h1 - g };
      this.panelOf("pfd", q, () => {
        p.panel(q);
        drawPfd(p, q, sc);
      });
      const s = { x: r.x + c1 + g, y: r.y, w: c3, h: r.h };
      this.panelOf("sdash", s, () => drawSpaceStatus(p, s, sc));
    } else {
      const h1 = (r.h - g) * 0.45;
      const o = { x: r.x, y: r.y, w: r.w, h: h1 };
      this.panelOf("orbit", o, () => drawOrbit(p, o, sc, true));
      const s = { x: r.x, y: r.y + h1 + g, w: r.w, h: r.h - h1 - g };
      this.panelOf("sdash", s, () => drawSpaceStatus(p, s, sc));
    }
  }
  /** the F-35's tactical console (PLAN-VAISSEAUX K2): the radar and the map side by side, the mission's strip */
  private air(r: Rect, sc: Scene) {
    const p = this.pen,
      g = 8;
    const sh = r.h < 360 ? 0 : Math.min(84, r.h * 0.2);
    const top = { x: r.x, y: r.y, w: r.w, h: r.h - (sh ? sh + g : 0) };
    const wide = top.w >= top.h;
    const a = wide ? { ...top, w: (top.w - g) / 2 } : { ...top, h: (top.h - g) / 2 };
    const b = wide ? { ...top, x: top.x + a.w + g, w: top.w - a.w - g } : { ...top, y: top.y + a.h + g, h: top.h - a.h - g };
    this.panelOf("radar", a, () =>
      drawRadar(p, a, sc, { range: this.range, north: this.north, sensor: this.sensor, selected: this.selectedContact }),
    );
    this.panelOf("map", b, () =>
      drawGeo(p, b, sc, { globe: false, lat: this.lat, lon: this.lon, zoom: 8, tiles: this.tiles, dpr: this.dpr }),
    );
    if (!sh) return;
    const m = { x: r.x, y: r.y + r.h - sh, w: r.w, h: sh };
    this.panelOf("air", m, () => drawAirStatus(p, m, sc));
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
