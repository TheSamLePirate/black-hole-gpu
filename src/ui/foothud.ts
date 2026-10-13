// The on-foot HUD (PLAN-MODES-AAA M5), on every solid world, in the third person's language:
// - the compass: a heading tape under the top bar — where the view looks, the cardinal points, every 5°; the
//   landed craft (gold, its distance), the Sun, the Moon, the target marked at their azimuths;
// - the place, bottom left: the world, the latitude and the longitude, the height above the datum and above the
//   ground, the speed, the heading, the craft's distance and direction;
// - the minimap, bottom right: a disc of the local ground (the Earth's scenery, the other worlds' planispheres —
//   ui/local-ground-map.ts) turned with the view (the way one looks is up), the north on its rim, the craft on
//   it; the wheel and its + and − zoom it, a click opens the full map.
// Drawn ten times a second at most; the map's picture redrawn only when the walker moves on it or it zooms (its
// turning is the browser's).

import { compassPoint, fmtLatLon, greatCircle, POINTS } from "../game/geo";
import { t } from "../i18n";
import { el as h } from "./kit";
import { LocalGroundMap, type LocalPlace } from "./local-ground-map";

/** A mark on the compass: a name, its azimuth [°], its colour; above the horizon or not. */
export interface CompassMark {
  id: string;
  label: string;
  az: number;
  col: string;
  /** below the horizon: drawn hollow */
  below?: boolean;
  /** a figure beside it (the craft's distance) */
  note?: string;
}

/** The ticks of a heading tape `span` degrees wide about `heading`: each 5°, labelled every 15° (the cardinal and
 *  intercardinal points named), x in −0.5 … 0.5 of the tape. Pure (tests/foothud.test.ts). */
export function compassTicks(heading: number, span: number): { deg: number; x: number; label: string | null; major: boolean }[] {
  const out: { deg: number; x: number; label: string | null; major: boolean }[] = [];
  const names: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  for (let d = Math.ceil((heading - span / 2) / 5) * 5; d <= heading + span / 2; d += 5) {
    const deg = ((d % 360) + 360) % 360;
    const major = deg % 15 === 0;
    out.push({ deg, x: (d - heading) / span, label: names[deg] ?? (major ? String(deg).padStart(3, "0") : null), major });
  }
  return out;
}

/** Where a mark's azimuth falls on the tape (−0.5 … 0.5), or its side when off it (±0.5, pinned). */
export function onTape(heading: number, az: number, span: number): { x: number; off: boolean } {
  const d = ((((az - heading) % 360) + 540) % 360) - 180;
  const x = d / span;
  return Math.abs(x) <= 0.5 ? { x, off: false } : { x: Math.sign(x) * 0.5, off: true };
}

/** A distance on the ground: 42 m, 1.24 km, 1 240 km. */
export function groundDist(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
  return `${Math.round(m / 1000)
    .toLocaleString("en-US")
    .replace(/,/g, " ")} km`;
}

export interface FootHudDeps {
  /** where the walker stands (controller/character.ts place()); null: not walking */
  place(): {
    body: string;
    lat: number;
    lon: number;
    altM: number;
    aglM: number;
    radiusM: number;
    viewDeg: number;
    speedMs: number;
  } | null;
  /** the landed craft on the same world, or null */
  craft(): { lat: number; lon: number } | null;
  /** the sky's marks (the Sun, the Moon, the target) */
  marks(): CompassMark[];
  /** the minimap's ground (the local map's place, with its planisphere) */
  local(): LocalPlace | null;
  /** a world's name */
  bodyName(id: string): string;
  /** the full map */
  openMap(): void;
}

const SPAN = 120;

export class FootHud {
  readonly root = h("div", "fh");
  private compass = h("canvas", "fh-compass") as HTMLCanvasElement;
  private card = h("div", "fh-card");
  private cardRows: Record<string, HTMLElement> = {};
  private mini = h("div", "fh-mini");
  private spin = h("div", "fh-spin");
  private map = new LocalGroundMap();
  private north = h("b", "fh-north", "N");
  private zoomLabel = h("span", "fh-zoom");
  private at = 0;
  private mapAt = 0;
  private mapKey = "";
  shown = false;

  constructor(private d: FootHudDeps) {
    this.root.dataset.testid = "foot-hud";
    this.root.hidden = true;
    // the place
    for (const [k, label] of [
      ["world", ""],
      ["alt", t("ALT")],
      ["agl", t("GROUND")],
      ["speed", t("SPEED")],
      ["hdg", t("HEADING")],
      ["craft", t("CRAFT")],
    ] as const) {
      const row = h("div", `fh-row fh-${k}`);
      const v = h("b");
      if (label) row.append(h("span", "", label));
      row.append(v);
      this.cardRows[k] = v;
      this.card.append(row);
    }
    this.card.dataset.testid = "foot-place";
    // the minimap: the map turned with the view inside a disc, the north on its rim, the walker at its centre
    this.map.minimal = true;
    this.map.zoom = 16;
    this.spin.append(this.map.root, this.north);
    const me = h("i", "fh-me");
    const zoom = h("div", "fh-zoombtns");
    for (const [txt, dz, tip] of [
      ["+", 1, t("Zoom in")],
      ["−", -1, t("Zoom out")],
    ] as const) {
      const b = h("button", "fh-zb", txt) as HTMLButtonElement;
      b.type = "button";
      b.title = tip;
      b.onclick = (e) => {
        e.stopPropagation();
        this.zoom(dz);
      };
      zoom.append(b);
    }
    this.mini.append(this.spin, me, zoom, this.zoomLabel);
    this.mini.dataset.testid = "foot-minimap";
    this.mini.title = t("The ground around you, the way you look upward — wheel: zoom · click: the full map (M)");
    this.mini.onclick = () => d.openMap();
    this.mini.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom(-Math.sign(e.deltaY) * 0.5);
      },
      { passive: false },
    );
    this.compass.dataset.testid = "foot-compass";
    this.root.append(this.compass, this.card, this.mini);
    document.body.append(this.root);
  }

  /** The minimap's zoom changed by `dz` (8 … 20). */
  zoom(dz: number) {
    this.map.setZoom(Math.max(8, Math.min(20, this.map.zoom + dz)));
    this.mapKey = "";
    this.zoomLabel.textContent = `z${this.map.zoom.toFixed(1)}`;
  }

  /** Shown or hidden (walking, the full map closed, the interface shown). */
  show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.root.hidden = !on;
    this.mapKey = "";
  }

  /** Each frame: drawn ten times a second at most. */
  update(now = performance.now()) {
    if (!this.shown || now - this.at < 100) return;
    this.at = now;
    const p = this.d.place();
    if (!p) return;
    const craft = this.d.craft();
    const g = craft ? greatCircle(p.lat, p.lon, craft.lat, craft.lon, p.radiusM) : null;
    const marks = this.d.marks();
    if (g) marks.unshift({ id: "craft", label: t("CRAFT"), az: g.bearingDeg, col: "#ffc85a", note: groundDist(g.dist) });
    this.drawCompass(p.viewDeg, marks);
    // (the place)
    const R = this.cardRows;
    const set = (k: string, v: string) => R[k]!.textContent !== v && (R[k]!.textContent = v);
    set("world", `${this.d.bodyName(p.body).toUpperCase()} · ${fmtLatLon(p.lat, p.lon, 5, [t("N"), t("S"), t("E"), t("W")])}`);
    set("alt", `${Math.round(p.altM).toLocaleString("en-US").replace(/,/g, " ")} m`);
    set("agl", `${p.aglM < 10 ? p.aglM.toFixed(1) : Math.round(p.aglM)} m`);
    set("speed", `${p.speedMs.toFixed(1)} m/s · ${(p.speedMs * 3.6).toFixed(1)} km/h`);
    const pts = POINTS.map((x) => t(x));
    set("hdg", `${String(Math.round(p.viewDeg) % 360).padStart(3, "0")}° ${compassPoint(p.viewDeg, pts)}`);
    set(
      "craft",
      g ? `${groundDist(g.dist)} · ${String(Math.round(g.bearingDeg) % 360).padStart(3, "0")}° ${compassPoint(g.bearingDeg, pts)}` : "—",
    );
    R.craft!.parentElement!.hidden = !g;
    // (the minimap: turned with the view; its picture again when the walker moved a few pixels on it)
    this.spin.style.transform = `rotate(${-p.viewDeg}deg)`;
    this.north.style.transform = `translate(-50%, -50%) rotate(${p.viewDeg}deg)`;
    const local = this.d.local();
    if (local) {
      const mpp = this.map.metresPerPixel();
      const key = `${local.body}:${Math.round((p.lat * 111_000) / (4 * mpp))}:${Math.round((p.lon * 111_000) / (4 * mpp))}:${this.map.zoom}:${local.surfaceStatus}:${!!local.contact}`;
      if (key !== this.mapKey || now - this.mapAt > 2000) {
        this.mapKey = key;
        this.mapAt = now;
        this.map.update(local);
      }
    }
    if (!this.zoomLabel.textContent) this.zoomLabel.textContent = `z${this.map.zoom.toFixed(1)}`;
  }

  /** The heading tape: the ticks, the cardinal points, the marks, the view's heading boxed. */
  private drawCompass(heading: number, marks: CompassMark[]) {
    const cv = this.compass;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(1, cv.clientWidth),
      H = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // (the tape fades at its ends)
    const fade = ctx.createLinearGradient(0, 0, W, 0);
    fade.addColorStop(0, "rgba(6, 11, 20, 0)");
    fade.addColorStop(0.15, "rgba(6, 11, 20, 0.62)");
    fade.addColorStop(0.85, "rgba(6, 11, 20, 0.62)");
    fade.addColorStop(1, "rgba(6, 11, 20, 0)");
    ctx.fillStyle = fade;
    // (rows: the heading boxed on top, the labels, the ticks up from `base`, the marks under it, their names)
    const base = H - 22;
    ctx.fillRect(0, 0, W, base + 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const k of compassTicks(heading, SPAN)) {
      const x = W / 2 + k.x * W;
      const a = 1 - Math.abs(k.x) * 1.4;
      ctx.strokeStyle = `rgba(214, 236, 255, ${0.35 + 0.5 * a})`;
      ctx.lineWidth = k.major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - (k.major ? 9 : 5));
      ctx.stroke();
      // (no label under the heading's box)
      if (k.label && Math.abs(k.x * W) > 30) {
        const cardinal = /^[NESW]{1,2}$/.test(k.label);
        ctx.font = `${cardinal ? 700 : 600} ${cardinal ? 13 : 10.5}px Rajdhani, Inter, sans-serif`;
        ctx.fillStyle = k.label === "N" ? `rgba(255, 120, 100, ${0.5 + 0.5 * a})` : `rgba(230, 240, 252, ${0.4 + 0.6 * a})`;
        ctx.fillText(k.label, x, base - 13);
      }
    }
    // the marks: a triangle under the tape at their azimuth (pinned at its end when off it, an arrow)
    for (const m of marks) {
      const p = onTape(heading, m.az, SPAN);
      const x = W / 2 + p.x * (W - 24);
      ctx.fillStyle = m.col;
      ctx.strokeStyle = m.col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (p.off) {
        const s = Math.sign(p.x);
        ctx.moveTo(x + s * 7, base + 6);
        ctx.lineTo(x - s * 3, base + 1);
        ctx.lineTo(x - s * 3, base + 11);
      } else {
        ctx.moveTo(x, base + 1);
        ctx.lineTo(x - 5, base + 10);
        ctx.lineTo(x + 5, base + 10);
      }
      ctx.closePath();
      if (m.below) ctx.stroke();
      else ctx.fill();
      if (!p.off) {
        ctx.font = "600 10px Rajdhani, Inter, sans-serif";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(m.note ? `${m.label} ${m.note}` : m.label, x, H - 1);
      }
    }
    // the view's heading, boxed at the centre
    const txt = String(Math.round(heading) % 360).padStart(3, "0");
    ctx.font = "700 13px 'JetBrains Mono', ui-monospace, monospace";
    const w = ctx.measureText(txt).width + 12;
    ctx.fillStyle = "rgba(6, 11, 20, 0.92)";
    ctx.fillRect(W / 2 - w / 2, 0, w, 17);
    ctx.strokeStyle = "rgba(255, 179, 92, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(W / 2 - w / 2 + 0.5, 0.5, w - 1, 16);
    ctx.fillStyle = "#ffb35c";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, W / 2, 9);
    ctx.beginPath();
    ctx.moveTo(W / 2, base + 2);
    ctx.lineTo(W / 2, base - 10);
    ctx.stroke();
  }
}
