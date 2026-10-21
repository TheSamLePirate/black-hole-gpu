import { drawSym, PAL, type SymKind, type SymSide, type SymState } from "../../radar/symbols";
import { wgs84Inverse } from "../../system/ellipsoid";
import { L, locale } from "../lang";

// The crew console's drawing kit: the avionics palette, a rectangle, and a pen over a 2D context with the few
// strokes every display shares. Glows are wide translucent strokes under the line, never shadowBlur (slow on phones).

export const C = {
  bg: "#05090e",
  panel: "#0a1219",
  panel2: "#0e1922",
  grid: "#16303c",
  grid2: "#1f4250",
  dim: "#6f8c99",
  text: "#e9f3f5",
  cyan: "#3fd8ff",
  green: "#4cf29a",
  magenta: "#ff5ce1",
  amber: "#ffb43c",
  red: "#ff4d4d",
  white: "#f6fbff",
  sky: "#1b62c4",
  sky2: "#0b2a5c",
  ground: "#7b4a22",
  ground2: "#2e1c0d",
  coast: "#3fa9c4",
  land: "#0f2a2e",
};
export const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const D = Math.PI / 180;
export const TAU = Math.PI * 2;
export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const deg360 = (a: number) => (((a / D) % 360) + 360) % 360;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Point = [number, number];

export interface TextOpts {
  col?: string;
  size?: number;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  weight?: number;
  font?: string;
  bg?: string;
}

export class Pen {
  constructor(readonly c: CanvasRenderingContext2D) {}
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const c = this.c;
    c.font = `${o.weight ?? 500} ${o.size ?? 12}px ${o.font ?? MONO}`;
    c.textAlign = o.align ?? "left";
    c.textBaseline = o.base ?? "alphabetic";
    if (o.bg) {
      const w = c.measureText(s).width,
        s2 = o.size ?? 12;
      const x0 = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
      const y0 = o.base === "middle" ? y - s2 * 0.65 : o.base === "top" ? y - 2 : y - s2 * 0.95;
      c.fillStyle = o.bg;
      this.round(x0 - 4, y0, w + 8, s2 * 1.3, 3);
      c.fill();
    }
    c.fillStyle = o.col ?? C.text;
    c.fillText(s, x, y);
  }
  width(s: string, size = 12, weight = 500, font = MONO) {
    this.c.font = `${weight} ${size}px ${font}`;
    return this.c.measureText(s).width;
  }
  round(x: number, y: number, w: number, h: number, r: number) {
    const c = this.c;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }
  stroke(col: string, width = 1, dash: number[] = []) {
    const c = this.c;
    c.strokeStyle = col;
    c.lineWidth = width;
    c.setLineDash(dash);
    c.stroke();
    c.setLineDash([]);
  }
  /** the current path stroked with a soft halo under it */
  glow(col: string, width = 1.5, halo = 0.18) {
    const c = this.c;
    c.globalAlpha = halo;
    this.stroke(col, width * 4);
    c.globalAlpha = 1;
    this.stroke(col, width);
  }
  fill(col: string | CanvasGradient) {
    this.c.fillStyle = col;
    this.c.fill();
  }
  /** a polyline; null breaks it, as do jumps wider than `jump` (the map's antimeridian) */
  path(points: (Point | null)[], jump = Infinity) {
    const c = this.c;
    c.beginPath();
    let prev: Point | null = null;
    for (const p of points) {
      if (!p) {
        prev = null;
        continue;
      }
      if (prev && Math.abs(p[0] - prev[0]) < jump) c.lineTo(p[0], p[1]);
      else c.moveTo(p[0], p[1]);
      prev = p;
    }
  }
  seg(x0: number, y0: number, x1: number, y1: number, col: string, width = 1, dash: number[] = []) {
    const c = this.c;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    this.stroke(col, width, dash);
  }
  circle(x: number, y: number, r: number) {
    this.c.beginPath();
    this.c.arc(x, y, r, 0, TAU);
  }
  /** a framed panel: its glassy face, its border, its title */
  panel(r: Rect, title?: string, size = 11) {
    const c = this.c;
    const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, "#0c1720");
    g.addColorStop(1, "#070d13");
    this.round(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10);
    this.fill(g);
    this.stroke("#1b3442", 1);
    if (title) this.text(title, r.x + 12, r.y + 18, { col: C.dim, size, weight: 600 });
  }
  clip(r: Rect, radius = 10) {
    this.round(r.x, r.y, r.w, r.h, radius);
    this.c.clip();
  }
  /** an aircraft's symbol pointing up, at the origin */
  aircraft(size: number, col: string, outline = "#03070a") {
    const c = this.c,
      s = size / 10;
    c.beginPath();
    c.moveTo(0, -10 * s);
    c.lineTo(1.6 * s, -4 * s);
    c.lineTo(9 * s, 1.5 * s);
    c.lineTo(9 * s, 3.4 * s);
    c.lineTo(1.6 * s, 1.2 * s);
    c.lineTo(1.2 * s, 6.5 * s);
    c.lineTo(4 * s, 8.6 * s);
    c.lineTo(4 * s, 10 * s);
    c.lineTo(0, 9 * s);
    c.lineTo(-4 * s, 10 * s);
    c.lineTo(-4 * s, 8.6 * s);
    c.lineTo(-1.2 * s, 6.5 * s);
    c.lineTo(-1.6 * s, 1.2 * s);
    c.lineTo(-9 * s, 3.4 * s);
    c.lineTo(-9 * s, 1.5 * s);
    c.lineTo(-1.6 * s, -4 * s);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = outline;
    c.lineWidth = 1;
    c.stroke();
  }
  /** a waypoint's star (the plan's magenta four-pointed one) */
  star(x: number, y: number, r: number, col: string, filled = false) {
    const c = this.c;
    c.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const rr = k % 2 ? r * 0.32 : r;
      c.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr);
    }
    c.closePath();
    if (filled) this.fill(col);
    this.stroke(col, 1.4);
  }
  /** a value's box (the tapes' readouts) */
  box(x: number, y: number, w: number, h: number, col = C.white, bg = "#02060a") {
    this.round(x, y, w, h, 4);
    this.fill(bg);
    this.stroke(col, 1.4);
  }
}

/** a soft colour ramp (the trail's height): t 0…1 → cyan → green → amber → magenta */
export function ramp(t: number): string {
  const k = clamp(t, 0, 1);
  const stops: [number, number, number][] = [
    [63, 216, 255],
    [76, 242, 154],
    [255, 180, 60],
    [255, 92, 225],
  ];
  const f = k * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(f)),
    u = f - i;
  const a = stops[i]!,
    b = stops[i + 1]!;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

/** the console language's grouping (1 234,5 · 1,234.5), a fixed number of decimals; "—" when unknown */
export function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** a duration: 45 s, 12 min 05, 2 h 14 */
export function dur(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(Math.floor(s % 60)).padStart(2, "0")}`;
  if (s < 86400 * 3) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${fmt(s / 86400, 1)} ${L("j", "d")}`;
}

/** the distance [m] and initial bearing [rad] from a to b over the WGS84 ellipsoid */
export function polar(lat0: number, lon0: number, lat: number, lon: number): { d: number; b: number } {
  const q = wgs84Inverse(lat0, lon0, lat, lon);
  return { d: q.d, b: q.az };
}

/** the symbol of a unit about — the common symbology (radar/symbols.ts — PLAN-RADAR-AAA RD3), the pilot's screens' own:
 *  an aircraft's NATO shape (the traffic's TCAS diamond), a ship's or a ground unit's whole one, a missile a dart, a
 *  flare a star, chaff a cloud of dots; `hdg` its way [rad from north], `rot` the screen's up [rad from north] */
export function unitSymbol(
  p: Pen,
  x: number,
  y: number,
  kind: string,
  side: string,
  hdg: number | null,
  rot: number,
  k = 7,
  o: { state?: SymState; locked?: boolean; selected?: boolean; age?: number } = {},
) {
  const sk: SymKind =
    kind === "decoy"
      ? side === "chaff"
        ? "chaff"
        : "flare"
      : kind === "missile"
        ? "missile"
        : kind === "sea"
          ? "sea"
          : kind === "ground"
            ? "ground"
            : "air";
  const ss: SymSide = kind === "decoy" ? "friend" : side in PAL ? (side as SymSide) : "unknown";
  drawSym(p.c, x, y, { kind: sk, side: ss, trk: hdg === null || kind === "ground" ? null : hdg - rot, ...o }, k, 1.6);
}
/** each side's colour — the common palette's (radar/symbols.ts PAL) */
export const SIDE: Record<string, string> = { ...PAL };

/** the labels placed this frame: one is drawn only where it does not cover another */
export class Labels {
  private boxes: [number, number, number, number][] = [];
  constructor(private p: Pen) {}
  /** a text left-aligned at (x, y); false (not drawn) when it would overlap one already placed */
  put(s: string, x: number, y: number, o: TextOpts = {}, force = false): boolean {
    const size = o.size ?? 12;
    const w = this.p.width(s, size, o.weight ?? 500) + 6;
    const b: [number, number, number, number] = [x - 3, y - size, x + w, y + 3];
    if (!force && this.boxes.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) return false;
    this.boxes.push(b);
    this.p.text(s, x, y, o);
    return true;
  }
  /** the first of several places where the text fits (else the first, drawn anyway when forced) */
  putAny(s: string, at: [number, number][], o: TextOpts = {}, force = false): [number, number] | null {
    for (const [x, y] of at) if (this.put(s, x, y, o)) return [x, y];
    if (force && at[0]) {
      this.put(s, at[0][0], at[0][1], o, true);
      return at[0];
    }
    return null;
  }
  /** a rectangle kept clear */
  keepRect(x: number, y: number, w: number, h: number) {
    this.boxes.push([x, y, x + w, y + h]);
  }
  /** an area kept clear (a symbol) */
  keep(x: number, y: number, r: number) {
    this.boxes.push([x - r, y - r, x + r, y + r]);
  }
}
