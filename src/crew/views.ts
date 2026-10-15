import coastlines from "./coastlines.json";
import { clamp, D, METRICS, relative, valueText, wrap, type CrewCraft, type CrewModel } from "./model";
import type { InstrumentKey } from "../net/instruments";

export type CrewView = "map" | "globe" | "radar" | "schematic" | "telemetry";
export const VIEW_NAMES: Record<CrewView, string> = {
  map: "Carte",
  globe: "Globe",
  radar: "Radar",
  schematic: "Schéma",
  telemetry: "Télémétrie",
};
type Point = [number, number];
const CYAN = "#89dce5",
  DIM = "#75929d",
  GRID = "#233a45",
  WHITE = "#edf4ef",
  AMBER = "#f1c47c";

export class CrewViews {
  view: CrewView = "map";
  zoom = 1;
  follow = true;
  lat = 20;
  lon = 0;
  range = 50_000;
  north = true;
  sensor = false;
  channel: InstrumentKey = "alt";
  window = 60;
  paused = false;
  private pausedAt = 0;
  inspect = 1;
  readout = "";
  selectedContact: string | null = null;
  private W = 1;
  private H = 1;
  private picks: { point: Point; slot?: number; contact?: string }[] = [];
  private pointers = new Map<number, Point>();
  private moved = 0;
  private pinch = 0;
  private raf = 0;
  private ctx: CanvasRenderingContext2D;
  private resize: ResizeObserver;
  onSelect: (slot: number) => void = () => {};
  onInspect: () => void = () => {};
  onContact: (id: string) => void = () => {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly model: CrewModel,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.resize = new ResizeObserver(() => this.request());
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
      else if (this.view === "map" || this.view === "globe") {
        this.follow = false;
        const scale = this.view === "map" ? (this.W / 360) * this.zoom : (Math.min(this.W, this.H) / 180) * this.zoom;
        this.lon = wrap(this.lon - dx / scale);
        this.lat = clamp(this.lat + dy / scale, -85, 85);
        this.request();
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (this.pointers.size === 1 && this.moved < 8 && this.view !== "telemetry") {
        const r = canvas.getBoundingClientRect();
        const candidates = this.picks.filter((p) => Math.hypot(p.point[0] - e.clientX + r.left, p.point[1] - e.clientY + r.top) < 24);
        const picked = candidates[0];
        if (picked?.contact) this.onContact(picked.contact);
        else if (picked?.slot !== undefined) this.onSelect(picked.slot);
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
        this.zoomBy(Math.exp(-e.deltaY * 0.002));
      },
      { passive: false },
    );
  }
  private spread() {
    const ps = [...this.pointers.values()];
    return ps.length < 2 ? 0 : Math.hypot(ps[0]![0] - ps[1]![0], ps[0]![1] - ps[1]![1]);
  }
  private scrub(x: number) {
    this.inspect = clamp((x - this.canvas.getBoundingClientRect().left - 58) / Math.max(1, this.W - 86), 0, 1);
    this.request();
    this.onInspect();
  }
  setView(view: CrewView) {
    this.view = view;
    this.reset();
  }
  reset() {
    this.zoom = 1;
    this.follow = true;
    this.inspect = 1;
    this.request();
  }
  pan(east: number, north: number) {
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
    if (this.view === "radar" || this.view === "schematic") this.range = clamp(this.range / k, 100, 2e7);
    else if (this.view === "telemetry") this.window = clamp(this.window / k, 10, 3600);
    else this.zoom = clamp(this.zoom * k, 0.7, this.view === "globe" ? 4 : 48);
    this.request();
  }
  request() {
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.draw();
      });
  }
  private text(text: string, x: number, y: number, col = DIM, align: CanvasTextAlign = "left") {
    this.ctx.fillStyle = col;
    this.ctx.textAlign = align;
    this.ctx.fillText(text, x, y);
  }
  private line(points: (Point | null)[], colour: string, dashed = false) {
    const c = this.ctx;
    c.strokeStyle = colour;
    c.lineWidth = 1;
    c.setLineDash(dashed ? [5, 6] : []);
    c.beginPath();
    let previous: Point | null = null;
    for (const p of points) {
      if (!p) {
        previous = null;
        continue;
      }
      if (previous && Math.abs(p[0] - previous[0]) < this.W * 0.65) c.lineTo(...p);
      else c.moveTo(...p);
      previous = p;
    }
    c.stroke();
    c.setLineDash([]);
  }
  draw() {
    const c = this.ctx,
      cv = this.canvas;
    this.W = Math.max(1, cv.clientWidth);
    this.H = Math.max(1, cv.clientHeight);
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(this.W * dpr),
      h = Math.round(this.H * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#0a151c";
    c.fillRect(0, 0, this.W, this.H);
    c.font = "12px ui-monospace, monospace";
    this.picks = [];
    const crafts = this.model.crafts(),
      own = this.model.own(crafts);
    if (this.view === "telemetry") this.chart(own);
    else if (this.view === "radar" || this.view === "schematic") this.radar(crafts, own);
    else this.geographic(crafts, own);
    if (!own) this.text("En attente d’un pilote connecté…", this.W / 2, this.H / 2, WHITE, "center");
  }
  private geographic(crafts: CrewCraft[], own: CrewCraft | null) {
    const c = this.ctx,
      W = this.W,
      H = this.H;
    const globe = this.view === "globe",
      R = Math.min(W, H) * 0.41 * this.zoom;
    if (this.follow && own?.geo) {
      this.lat = own.geo.lat;
      this.lon = own.geo.lon;
    }
    const lat0 = this.lat * D,
      lon0 = this.lon * D;
    const project = (lat: number, lon: number): Point | null => {
      if (!globe) return [W / 2 + (wrap(lon - this.lon) / 360) * W * this.zoom, H / 2 - ((lat - this.lat) / 360) * W * this.zoom];
      const p = lat * D,
        l = lon * D - lon0;
      const z = Math.sin(lat0) * Math.sin(p) + Math.cos(lat0) * Math.cos(p) * Math.cos(l);
      if (z < 0) return null;
      return [
        W / 2 + R * Math.cos(p) * Math.sin(l),
        H / 2 - R * (Math.cos(lat0) * Math.sin(p) - Math.sin(lat0) * Math.cos(p) * Math.cos(l)),
      ];
    };
    c.save();
    if (globe) {
      c.beginPath();
      c.arc(W / 2, H / 2, R, 0, Math.PI * 2);
      c.fillStyle = "#102530";
      c.fill();
      c.strokeStyle = "#385764";
      c.stroke();
      c.clip();
    }
    const step = !globe && this.zoom > 8 ? 5 : 30;
    for (let lat = -90; lat <= 90; lat += step)
      this.line(
        Array.from({ length: 181 }, (_, i) => project(lat, i * 2 - 180)),
        GRID,
      );
    for (let lon = -180; lon < 180; lon += step)
      this.line(
        Array.from({ length: 91 }, (_, i) => project(i * 2 - 90, lon)),
        GRID,
      );
    if (!own || own.body === "earth")
      for (const line of coastlines)
        this.line(
          line.map((p) => project(p[1]!, p[0]!)),
          "#547985",
        );
    const history = this.model.history.get(this.model.selected ?? -1) ?? [];
    this.line(
      history.slice(-400).map((p) => (p.geo && p.body === own?.body ? project(p.geo.lat, p.geo.lon) : null)),
      "#6a969b",
    );
    if (own?.snapshot) {
      this.line(
        own.snapshot.ahead.map((p) => project(p.lat, p.lon)),
        AMBER,
        true,
      );
      this.line(
        own.snapshot.route.map((p) => project(p.lat, p.lon)),
        "#d8abd9",
        true,
      );
      for (const p of own.snapshot.route) {
        const q = project(p.lat, p.lon);
        if (q) this.text(p.name, q[0] + 5, q[1] - 5, "#d8abd9");
      }
    }
    for (const craft of crafts) {
      if (!craft.geo || (own && craft.body !== own.body)) continue;
      const p = project(craft.geo.lat, craft.geo.lon);
      if (p) this.marker(craft, p, craft.geo.heading);
    }
    c.restore();
    this.text(`${(own?.body ?? "earth").toUpperCase()} · ${globe ? "ORTHOGRAPHIQUE" : "PLANISPHÈRE"}`, 18, 25);
    this.text(`${this.lat.toFixed(2)}° / ${this.lon.toFixed(2)}° · ${this.follow ? "SUIVI" : "LIBRE"}`, 18, H - 18);
    if (own && !own.geo) this.text("Position géographique indisponible dans ce repère", W / 2, H - 44, AMBER, "center");
  }
  private marker(craft: CrewCraft, p: Point, heading: number) {
    const c = this.ctx,
      selected = craft.member.slot === this.model.selected;
    c.save();
    c.translate(...p);
    c.rotate(heading);
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6, 7);
    c.lineTo(0, 4);
    c.lineTo(-6, 7);
    c.closePath();
    c.fillStyle = craft.age > 3 ? DIM : craft.member.colour;
    c.fill();
    if (selected) {
      c.beginPath();
      c.arc(0, 0, 16, 0, Math.PI * 2);
      c.strokeStyle = CYAN;
      c.stroke();
    }
    c.restore();
    this.text(craft.member.name, p[0] + 21, p[1] + 4, selected ? WHITE : DIM);
    this.picks.push({ point: p, slot: craft.member.slot });
  }
  private radar(crafts: CrewCraft[], own: CrewCraft | null) {
    const c = this.ctx,
      W = this.W,
      H = this.H,
      R = Math.min(W, H) * 0.38;
    const heading = this.north ? 0 : (own?.geo?.heading ?? 0);
    const project = (e: number, n: number): Point => [
      W / 2 + ((e * Math.cos(heading) - n * Math.sin(heading)) / this.range) * R,
      H / 2 - ((e * Math.sin(heading) + n * Math.cos(heading)) / this.range) * R,
    ];
    if (this.view === "radar")
      for (let j = 1; j <= 4; j++) {
        c.beginPath();
        c.arc(W / 2, H / 2, (R * j) / 4, 0, Math.PI * 2);
        c.strokeStyle = GRID;
        c.stroke();
        this.text(`${valueText((this.range * j) / 4 / 1000)} km`, W / 2 + 6, H / 2 - (R * j) / 4 + 15);
      }
    this.line(
      [
        [W / 2 - R, H / 2],
        [W / 2 + R, H / 2],
      ],
      GRID,
    );
    this.line(
      [
        [W / 2, H / 2 - R],
        [W / 2, H / 2 + R],
      ],
      GRID,
    );
    this.text(this.north ? "N" : "CAP", W / 2, H / 2 - R - 12, CYAN, "center");
    if (own) {
      this.marker(own, [W / 2, H / 2], (own.geo?.heading ?? 0) - heading);
      if (this.sensor && this.view === "radar") {
        const radar = own.snapshot?.radar;
        if (!radar) this.text("Radar du pilote indisponible", 18, 50, AMBER);
        for (const contact of radar?.contacts ?? []) {
          if (Math.hypot(contact.e, contact.n) > this.range) continue;
          const p = project(contact.e, contact.n);
          c.strokeStyle = contact.iff === "hostile" ? "#f2a092" : CYAN;
          c.strokeRect(p[0] - 5, p[1] - 5, 10, 10);
          if (contact.locked) c.strokeRect(p[0] - 9, p[1] - 9, 18, 18);
          if (contact.id === this.selectedContact) {
            c.strokeStyle = AMBER;
            c.strokeRect(p[0] - 14, p[1] - 14, 28, 28);
          }
          this.picks.push({ point: p, contact: contact.id });
          this.text(contact.name, p[0] + 12, p[1] + 4, WHITE);
        }
      } else
        for (const craft of crafts) {
          if (craft === own) continue;
          const r = relative(own, craft);
          if (!r || Math.hypot(r.e, r.n) > this.range) continue;
          const p = project(r.e, r.n);
          if (this.view === "schematic") this.line([[W / 2, H / 2], p], GRID, true);
          this.marker(craft, p, (craft.geo?.heading ?? 0) - heading);
          this.text(`${valueText(r.distance / 1000)} km · Δh ${valueText(r.dz)} m`, p[0] + 21, p[1] + 21);
        }
    }
    this.text(
      this.sensor && this.view === "radar" ? `CAPTEUR PILOTE · ${own?.snapshot?.radar?.mode ?? "—"}` : "POSITION DES JOUEURS · MÊME REPÈRE",
      18,
      25,
    );
    this.text(`Portée ${valueText(this.range / 1000)} km`, 18, H - 18);
    if (own?.sample.frame === 2) this.text("Repère Gargantua · distances locales indisponibles", W / 2, H - 44, AMBER, "center");
  }
  fit() {
    const crafts = this.model.crafts(),
      own = this.model.own(crafts);
    if (own) this.range = Math.max(1000, ...crafts.map((c) => relative(own, c)?.distance ?? 0)) * 1.25;
    this.request();
  }
  private chart(own: CrewCraft | null) {
    const W = this.W,
      H = this.H;
    const metric = METRICS.find((m) => m.key === this.channel)!;
    const history = this.model.history.get(own?.member.slot ?? -1) ?? [];
    const end = this.paused ? this.pausedAt : (history.at(-1)?.t ?? 0),
      start = end - this.window;
    const points = history.filter((p) => p.t >= start && p.t <= end);
    const values = points.flatMap((p) => (p.metrics[this.channel] === undefined ? [] : [p.metrics[this.channel]! * metric.k]));
    this.text(`${metric.name.toUpperCase()} · ${metric.unit} · ${this.paused ? "CONSULTATION FIGÉE" : "DIRECT"}`, 18, 25, WHITE);
    if (values.length < 2) {
      this.text("Les mesures reçues apparaîtront ici", W / 2, H / 2, DIM, "center");
      this.readout = "—";
      return;
    }
    const min = Math.min(...values),
      max = Math.max(...values),
      pad = Math.max((max - min) * 0.12, 1);
    const lo = min - pad,
      hi = max + pad,
      x0 = 58,
      y0 = 65,
      width = W - 86,
      height = H - 115;
    const x = (t: number) => x0 + ((t - start) / this.window) * width;
    const y = (v: number) => y0 + ((hi - v) / (hi - lo)) * height;
    for (let j = 0; j <= 4; j++) {
      const v = lo + ((hi - lo) * j) / 4;
      this.line(
        [
          [x0, y(v)],
          [W - 28, y(v)],
        ],
        GRID,
      );
      this.text(valueText(v), x0 - 8, y(v) + 4, DIM, "right");
      this.text(`−${Math.round(this.window * (1 - j / 4))} s`, x0 + (width * j) / 4, H - 24, DIM, "center");
    }
    this.line(
      points.map((p) => (p.metrics[this.channel] === undefined ? null : [x(p.t), y(p.metrics[this.channel]! * metric.k)])),
      CYAN,
    );
    const at = start + this.window * this.inspect;
    const nearest = points.reduce((a, b) => (Math.abs(a.t - at) < Math.abs(b.t - at) ? a : b));
    const px = x(nearest.t);
    this.line(
      [
        [px, y0],
        [px, H - 50],
      ],
      AMBER,
      true,
    );
    this.readout = `${valueText(nearest.metrics[this.channel], metric.k)} ${metric.unit} · t ${valueText(nearest.t)} s`;
    this.text(this.readout, W - 20, 48, AMBER, "right");
  }
}
