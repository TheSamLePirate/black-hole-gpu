// The airfields drawn on a map or a radar (docs/PLAN-RADAR-AAA.md RD11): one way for every screen — the tactical
// map, the TSD, the HUD's scope, the mission map, the crew's map, radar and ND. Far: a dot (its size the airfield's
// kind, its colour its best surface); nearer: each runway a line between its thresholds, as wide as it is when that
// shows; close: its outline, its ends' numbers; the codes beside, as room allows. The flight plan's field magenta.
// Pure (a 2D context in): the crew's bundle takes it.

import { type Airfield, SURFACE_COLOUR } from "./runways";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FieldDrawOpts {
  /** a place on the screen [px] (null: off it) */
  at: (lat: number, lon: number) => [number, number] | null;
  /** metres a pixel */
  mpp: number;
  /** the screen's scale for lines and text (device px per CSS px, or a display's own) */
  k?: number;
  /** labels drawn (the codes) */
  labels?: boolean;
  /** the codes to show magenta (the flight plan's fields) */
  marked?: Set<string>;
  /** a field drawn: where (for a click) */
  hit?: (f: Airfield, x: number, y: number) => void;
  /** the screen's box (beyond it, nothing drawn) */
  box?: { x: number; y: number; w: number; h: number };
}

const RANK: Record<string, number> = { paved: 0, water: 1, grass: 2, dirt: 3, snow: 4, unknown: 5 };

/** An airfield's best surface (its colour far off). */
export function bestSurface(f: Airfield) {
  return f.runways.reduce((b, w) => (RANK[w.surface]! < RANK[b]! ? w.surface : b), f.runways[0]?.surface ?? ("unknown" as const));
}

/** The airfields drawn (the order given: the nearest or the biggest first — a label never covers an earlier one). */
export function drawFields(g: Ctx, fields: Airfield[], o: FieldDrawOpts) {
  const k = o.k ?? 1;
  const taken: [number, number, number, number][] = [];
  g.save();
  g.lineCap = "butt";
  for (const f of fields) {
    const p = o.at(f.lat, f.lon);
    if (!p) continue;
    if (
      o.box &&
      (p[0] < o.box.x - 40 * k || p[0] > o.box.x + o.box.w + 40 * k || p[1] < o.box.y - 40 * k || p[1] > o.box.y + o.box.h + 40 * k)
    )
      continue;
    const marked = !!o.marked && (o.marked.has(f.icao) || o.marked.has(f.ident));
    const col = marked ? "#ff5ce1" : SURFACE_COLOUR[bestSurface(f)];
    const longest = f.runways.reduce((m, w) => Math.max(m, w.len), 0);
    const lenPx = longest / o.mpp;
    if (!f.runways.length || lenPx < 4 * k) {
      // (far: a dot — a ring for a large airport —, an H for a heliport)
      g.fillStyle = col;
      g.strokeStyle = col;
      if (f.kind === "heliport") {
        g.font = `700 ${9 * k}px Rajdhani, sans-serif`;
        g.textAlign = "center";
        g.fillText("H", p[0], p[1] + 3 * k);
      } else if (f.kind === "large") {
        g.lineWidth = 2 * k;
        g.beginPath();
        g.arc(p[0], p[1], 4 * k, 0, 2 * Math.PI);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(p[0], p[1], (f.kind === "medium" ? 2.6 : 1.8) * k, 0, 2 * Math.PI);
        g.fill();
      }
    } else
      for (const w of f.runways) {
        const a = o.at(w.lat1, w.lon1),
          b = o.at(w.lat2, w.lon2);
        if (!a || !b) continue;
        const wc = marked ? "#ff5ce1" : SURFACE_COLOUR[w.surface];
        const wpx = w.wid / o.mpp;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (wpx > 3 * k && L > 40 * k) {
          // (close: its outline at its width, its centreline, its ends' numbers)
          const ux = (b[0] - a[0]) / L,
            uy = (b[1] - a[1]) / L;
          const nx = -uy * (wpx / 2),
            ny = ux * (wpx / 2);
          g.fillStyle = `${wc}33`;
          g.strokeStyle = wc;
          g.lineWidth = 1.5 * k;
          g.beginPath();
          g.moveTo(a[0] + nx, a[1] + ny);
          g.lineTo(b[0] + nx, b[1] + ny);
          g.lineTo(b[0] - nx, b[1] - ny);
          g.lineTo(a[0] - nx, a[1] - ny);
          g.closePath();
          g.fill();
          g.stroke();
          g.setLineDash([6 * k, 6 * k]);
          g.lineWidth = 1 * k;
          g.beginPath();
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
          g.stroke();
          g.setLineDash([]);
          if (o.labels !== false) {
            g.fillStyle = wc;
            g.font = `700 ${10 * k}px Rajdhani, sans-serif`;
            g.textAlign = "center";
            g.fillText(w.le, a[0] - ux * 12 * k, a[1] - uy * 12 * k + 3 * k);
            g.fillText(w.he, b[0] + ux * 12 * k, b[1] + uy * 12 * k + 3 * k);
          }
        } else {
          g.strokeStyle = wc;
          g.lineWidth = Math.max(1.6 * k, Math.min(wpx, 6 * k));
          if (w.approx) g.setLineDash([4 * k, 3 * k]);
          g.beginPath();
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
          g.stroke();
          g.setLineDash([]);
        }
      }
    o.hit?.(f, p[0], p[1]);
    // (its code, where it covers no other)
    if (o.labels !== false && (f.kind === "large" || f.kind === "medium" || lenPx > 12 * k || marked)) {
      const s = f.icao || f.ident;
      g.font = `600 ${10 * k}px Rajdhani, sans-serif`;
      const tw = g.measureText(s).width;
      const x = p[0] + 6 * k,
        y = p[1] - 6 * k;
      const r: [number, number, number, number] = [x - 2, y - 10 * k, x + tw + 2, y + 2];
      if (!taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) {
        taken.push(r);
        g.fillStyle = marked ? "#ff5ce1" : "rgba(170, 225, 255, 0.9)";
        g.textAlign = "left";
        g.fillText(s, x, y);
      }
    }
  }
  g.restore();
}
