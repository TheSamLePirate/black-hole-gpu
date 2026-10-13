import type { SceneryContact } from "../system/scenery-contact";
import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { D, wrapLon } from "../system/scenery-data";
import { t } from "../i18n";
export interface LocalPlace {
  body: string;
  lat: number;
  lon: number;
  contact: SceneryContact | null;
  radiusM?: number;
  surface?: HTMLCanvasElement | null;
  surfaceStatus?: "ready" | "loading" | "unavailable";
  vessel?: { lat: number; lon: number } | null;
}
export const metresPerMapPixel = (lat: number, zoom: number, radiusM = WGS84_A) =>
  (((2 * Math.PI * radiusM) / 256) * Math.max(0.01, Math.cos(lat * D))) / 2 ** zoom;

/** A contact's 512² ground raster and its box in the contact's local frame: built once, shared by every map that
 *  shows it (the on-foot HUD's minimap and the flight HUD's ground track hold one each), dropped with the contact. */
const RASTERS = new WeakMap<SceneryContact, { raster: HTMLCanvasElement; box: number[] }>();
function rasterOf(c: SceneryContact): { raster: HTMLCanvasElement; box: number[] } {
  const had = RASTERS.get(c);
  if (had) return had;
  const { f, u, reply } = c;
  const N = 512,
    at = f[2]! * 4;
  const image = new ImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const px = u[at + i]!;
    image.data[i * 4] = px & 255;
    image.data[i * 4 + 1] = (px >>> 8) & 255;
    image.data[i * 4 + 2] = (px >>> 16) & 255;
    image.data[i * 4 + 3] = 255;
  }
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  cv.getContext("2d")!.putImageData(image, 0, 0);
  const b = reply.bounds!;
  const west = c.local(geodeticToCart(WGS84_A, WGS84_F, b[1] * D, b[0] * D, 0));
  const east = c.local(geodeticToCart(WGS84_A, WGS84_F, b[3] * D, b[2] * D, 0));
  const out = { raster: cv, box: [west[0], west[1], east[0] - west[0], east[1] - west[1]] };
  RASTERS.set(c, out);
  return out;
}

/** Nearby planisphere from the streamed source geometry. No extra map service, draw only when visible. */
export class LocalGroundMap {
  readonly root = document.createElement("div");
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private label = document.createElement("div");
  zoom = 18;
  /** a minimap's (the on-foot HUD's): no scale bar, the body change keeps the zoom it was given */
  minimal = false;
  private cpuMs = 0;
  private pan = [0, 0];
  private body = "";
  private place: LocalPlace | null = null;
  private source: SceneryContact | null = null;
  private raster: HTMLCanvasElement | null = null;
  private rasterBox: number[] = [];
  constructor() {
    this.root.className = "local-ground-map";
    this.root.dataset.testid = "local-ground-map";
    this.canvas.style.touchAction = "none";
    this.root.append(this.canvas, this.label);
    const controls = document.createElement("div");
    controls.className = "local-map-controls";
    for (const [text, action] of [
      ["−", () => this.setZoom(this.zoom - 1)],
      ["+", () => this.setZoom(this.zoom + 1)],
      [
        t("Centre"),
        () => {
          this.pan = [0, 0];
          this.draw();
        },
      ],
    ] as const) {
      const b = document.createElement("button");
      b.textContent = text;
      b.type = "button";
      b.onclick = action;
      controls.append(b);
    }
    this.root.append(controls);
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom - e.deltaY * 0.005);
      },
      { passive: false },
    );
    let down: { id: number; x: number; y: number } | null = null;
    this.canvas.onpointerdown = (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    this.canvas.onpointermove = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const mpp = metresPerMapPixel(this.place?.lat ?? 0, this.zoom, this.place?.radiusM);
      this.pan[0]! -= (e.clientX - down.x) * mpp;
      this.pan[1]! += (e.clientY - down.y) * mpp;
      down.x = e.clientX;
      down.y = e.clientY;
      this.draw();
    };
    this.canvas.onpointerup = this.canvas.onpointercancel = () => {
      down = null;
    };
    this.canvas.ondblclick = () => {
      this.pan = [0, 0];
      this.draw();
    };
  }
  setZoom(value: number) {
    this.zoom = Math.max(0, Math.min(21, value));
    this.draw();
    return this.zoom;
  }
  /** the metres a CSS pixel covers now */
  metresPerPixel() {
    return metresPerMapPixel(this.place?.lat ?? 0, this.zoom, this.place?.radiusM);
  }
  state() {
    return {
      active: !this.root.hidden && this.root.getClientRects().length > 0,
      cpuMs: this.cpuMs,
      body: this.place?.body,
      lat: this.place?.lat,
      lon: this.place?.lon,
      zoom: this.zoom,
      sourceReady: !!this.source || !!this.place?.surface,
      sourceStatus: this.source ? "ready" : (this.place?.surfaceStatus ?? "unavailable"),
      radiusM: this.place?.radiusM ?? WGS84_A,
      panM: [...this.pan],
    };
  }
  update(place: LocalPlace) {
    if (place.body !== this.body) {
      this.body = place.body;
      if (!this.minimal) this.zoom = 18;
      this.pan = [0, 0];
    }
    this.place = place;
    this.root.hidden = false;
    this.draw();
  }
  private prepareSource(c: SceneryContact | null) {
    if (c === this.source) return;
    this.source = c;
    this.raster = null;
    if (!c) return;
    const r = rasterOf(c);
    this.raster = r.raster;
    this.rasterBox = r.box;
  }
  /** Crop the existing global atlas; wrap longitude and clip at the poles. No network tile service. */
  private drawPlanet(p: LocalPlace, W: number, H: number, mpp: number) {
    const ctx = this.ctx;
    const degreeM = (p.radiusM ?? WGS84_A) * D;
    const dx = (degreeM * Math.max(0.01, Math.cos(p.lat * D))) / mpp,
      dy = degreeM / mpp;
    const lat = Math.max(-90, Math.min(90, p.lat + this.pan[1]! / degreeM));
    const lon = wrapLon(p.lon + this.pan[0]! / (degreeM * Math.max(0.01, Math.cos(p.lat * D))));
    this.pan[1] = (lat - p.lat) * degreeM;
    this.pan[0] = wrapLon(lon - p.lon) * degreeM * Math.max(0.01, Math.cos(p.lat * D));
    const top = H / 2 - (90 - lat) * dy,
      bottom = H / 2 + (lat + 90) * dy;
    const tint: Record<string, string> = { mann: "#d7e1ee", edmunds: "#c49668", miller: "#4696aa" };
    ctx.fillStyle = tint[p.body] ?? "#41434a";
    ctx.fillRect(0, Math.max(0, top), W, Math.max(0, Math.min(H, bottom) - Math.max(0, top)));
    const atlas = p.surface;
    const worldW = 360 * dx,
      left = W / 2 - (lon + 180) * dx;
    if (atlas) {
      const y0 = Math.max(0, top),
        y1 = Math.min(H, bottom);
      for (let k = Math.floor(-left / worldW); k * worldW + left < W; k++) {
        const x = left + k * worldW,
          x0 = Math.max(0, x),
          x1 = Math.min(W, x + worldW);
        if (x1 <= x0 || y1 <= y0) continue;
        ctx.drawImage(
          atlas,
          ((x0 - x) / worldW) * atlas.width,
          ((y0 - top) / (180 * dy)) * atlas.height,
          ((x1 - x0) / worldW) * atlas.width,
          ((y1 - y0) / (180 * dy)) * atlas.height,
          x0,
          y0,
          x1 - x0,
          y1 - y0,
        );
      }
    }
    // An angular graticule remains meaningful even on fictional worlds without an atlas.
    const raw = 100 / Math.min(dx, dy),
      base = 10 ** Math.floor(Math.log10(raw));
    const spacing = Math.min(90, (raw / base <= 2 ? 2 : raw / base <= 5 ? 5 : 10) * base);
    ctx.strokeStyle = p.body === "mann" ? "rgba(20,40,60,.28)" : "rgba(230,245,255,.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let a = Math.ceil((lon - W / 2 / dx) / spacing) * spacing; a <= lon + W / 2 / dx; a += spacing) {
      const x = W / 2 + (a - lon) * dx;
      ctx.moveTo(x, Math.max(0, top));
      ctx.lineTo(x, Math.min(H, bottom));
    }
    for (let a = Math.ceil(Math.max(-90, lat - H / 2 / dy) / spacing) * spacing; a <= Math.min(90, lat + H / 2 / dy); a += spacing) {
      const y = H / 2 - (a - lat) * dy;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }
  private draw() {
    const p = this.place;
    if (!p || this.root.hidden) return;
    const began = performance.now();
    const dpr = Math.min(devicePixelRatio, 2),
      W = Math.max(1, this.root.clientWidth),
      H = Math.max(1, this.root.clientHeight);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx,
      mpp = metresPerMapPixel(p.lat, this.zoom, p.radiusM);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#182b2a";
    ctx.fillRect(0, 0, W, H);
    this.prepareSource(p.body === "earth" ? p.contact : null);
    if (!this.source) this.drawPlanet(p, W, H, mpp);
    const c = this.source,
      origin = c ? c.local(geodeticToCart(WGS84_A, WGS84_F, p.lat * D, p.lon * D, 0)) : [0, 0, 0];
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1 / mpp, -1 / mpp);
    ctx.translate(-origin[0]! - this.pan[0]!, -origin[1]! - this.pan[1]!);
    if (this.raster) {
      const [x, y, w, h] = this.rasterBox as [number, number, number, number];
      ctx.save();
      ctx.translate(x, y + h);
      ctx.scale(1, -1);
      ctx.drawImage(this.raster, 0, 0, w, h);
      ctx.restore();
    }
    if (c) {
      const f = c.f;
      const paint = (start: number, count: number, geom: number, surface: boolean) => {
        for (let i = 0; i < count; i++) {
          const n = start + i * 8;
          if (
            f[n + 4]! < origin[0]! + this.pan[0]! - (W * mpp) / 2 ||
            f[n]! > origin[0]! + this.pan[0]! + (W * mpp) / 2 ||
            f[n + 5]! < origin[1]! + this.pan[1]! - (H * mpp) / 2 ||
            f[n + 1]! > origin[1]! + this.pan[1]! + (H * mpp) / 2
          ) {
            i = f[n + 3]! - 1;
            continue;
          }
          if (f[n + 7]! < 0) continue;
          const b = (geom + f[n + 7]!) * 4;
          if (!surface && f[b + 3]! < 0.5) continue;
          const kind = surface && f[b + 11]! < 0.5 ? f[b + 5]! : f[b + 3]!;
          ctx.strokeStyle = kind === 3 || kind === 4 ? "#70b9d9" : kind === 2 ? "#858992" : "#e3d6b8";
          ctx.fillStyle = surface ? (kind === 4 ? "#3888ac" : "#b2ac8f") : "#a6a19b";
          ctx.beginPath();
          if (surface && f[b + 11]! < 0.5) {
            ctx.moveTo(f[b]!, f[b + 1]!);
            ctx.lineTo(f[b + 2]!, f[b + 3]!);
            ctx.lineWidth = Math.max(mpp, 2 * f[b + 4]!);
            ctx.stroke();
          } else {
            const edges = f[b + 2]!;
            for (let k = 0; k < edges; k++) {
              const e = b + 12 + 4 * k;
              if (k === 0 || f[e] !== f[e - 2] || f[e + 1] !== f[e - 1]) ctx.moveTo(f[e]!, f[e + 1]!);
              ctx.lineTo(f[e + 2]!, f[e + 3]!);
            }
            ctx.fill("evenodd");
            ctx.lineWidth = mpp;
            ctx.stroke();
          }
        }
      };
      paint(f[4]! * 4, f[5]!, f[6]!, true);
      paint(16, f[0]!, f[1]!, false);
    }
    ctx.restore();
    const mark = (lat: number, lon: number, color: string) => {
      const east = wrapLon(lon - p.lon) * (p.radiusM ?? WGS84_A) * D * Math.max(0.01, Math.cos(p.lat * D)),
        north = (lat - p.lat) * (p.radiusM ?? WGS84_A) * D;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#07131b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2 + (east - this.pan[0]!) / mpp, H / 2 - (north - this.pan[1]!) / mpp, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    if (p.vessel) mark(p.vessel.lat, p.vessel.lon, "#e6b66b");
    mark(p.lat, p.lon, "#63dce8");
    const scale = 10 ** Math.floor(Math.log10(100 * mpp));
    if (!this.minimal) {
      ctx.fillStyle = "rgba(8,21,27,.85)";
      ctx.fillRect(12, H - 46, Math.max(155, scale / mpp + 16), 32);
      ctx.fillStyle = "white";
      ctx.font = "12px monospace";
      ctx.fillText(`N ↑   ${scale >= 1000 ? `${scale / 1000} km` : `${scale} m`}`, 20, H - 30);
      ctx.fillRect(20, H - 20, scale / mpp, 2);
    }
    this.root.dataset.body = p.body;
    this.root.dataset.source = c || p.surface ? "ready" : (p.surfaceStatus ?? "unavailable");
    this.root.dataset.zoom = String(this.zoom);
    this.cpuMs = performance.now() - began;
    this.label.textContent = `${p.body} · ${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}° · z${this.zoom.toFixed(1)} · ${c ? "© ESA WorldCover / Copernicus · OpenStreetMap / OpenFreeMap" : p.surface ? t("Planetary atlas") : p.surfaceStatus === "loading" ? t("Loading planetary atlas…") : t("Reference grid — imagery unavailable")}`;
  }
}
