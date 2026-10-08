// The weather's vertical cut at a place (PLAN-METEO W2b): the ground, the haze and the fog lying on it,
// the cloud layers between their bases and tops (puffs as many as their cover, the report's word and base
// beside them), the rain falling from the lowest deck, Mars's dust; on the right the wind's barbs up the
// height (the mean wind of weather.ts, its shear). Drawn on a 2D canvas, the panel's.

import { meanWind } from "../wind";
import { coverWord, type WeatherState } from "../weather";

const INK = "rgba(205, 220, 240, 0.85)";
const DIM = "rgba(205, 220, 240, 0.5)";
const GRID = "rgba(160, 210, 255, 0.10)";

/** A barb as the charts draw it: the staff towards where the wind comes from, a pennant for 25 m/s
 *  (≈ 50 kt), a long feather for 5 m/s (≈ 10 kt), a short one for 2.5 — seen from above, north up. */
function barb(g: CanvasRenderingContext2D, x: number, y: number, from: number, speed: number, len = 22) {
  const a = (from * Math.PI) / 180;
  // (screen: north up, east right — the staff points to where it blows from)
  const dx = Math.sin(a),
    dy = -Math.cos(a);
  g.beginPath();
  g.arc(x, y, 2.2, 0, 2 * Math.PI);
  g.fill();
  if (speed < 1.25) return;
  const ex = x + dx * len,
    ey = y + dy * len;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(ex, ey);
  g.stroke();
  // the feathers on the staff's far end, on its clockwise side
  const px = -dy,
    py = dx;
  let v = speed,
    o = 0;
  const step = 4.5;
  while (v >= 25) {
    const bx = ex - dx * o,
      by = ey - dy * o;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + px * 9 - dx * step * 0.5, by + py * 9 - dy * step * 0.5);
    g.lineTo(bx - dx * step, by - dy * step);
    g.fill();
    v -= 25;
    o += step + 1.5;
  }
  while (v >= 5) {
    const bx = ex - dx * o,
      by = ey - dy * o;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + px * 9 + dx * 3, by + py * 9 + dy * 3);
    g.stroke();
    v -= 5;
    o += step;
  }
  if (v >= 2.5) {
    const bx = ex - dx * (o || step),
      by = ey - dy * (o || step);
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + px * 5 + dx * 1.5, by + py * 5 + dy * 1.5);
    g.stroke();
  }
}

/** A cloud's band: puffs across its width, as many as its cover, their sizes from its depth. */
function deck(g: CanvasRenderingContext2D, x0: number, x1: number, yTop: number, yBase: number, cover: number, seed: number) {
  const depth = Math.max(yBase - yTop, 3);
  const n = Math.max(1, Math.round(cover * 14));
  let r = seed;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  g.fillStyle = "rgba(225, 232, 242, 0.82)";
  for (let i = 0; i < n; i++) {
    // (overcast: the band whole; else puffs spread over it)
    const cx = cover >= 0.95 ? x0 + ((i + 0.5) / n) * (x1 - x0) : x0 + rnd() * (x1 - x0);
    const w = cover >= 0.95 ? (x1 - x0) / n / 1.6 + 6 : 10 + rnd() * 18;
    const h = depth * (0.55 + 0.45 * rnd());
    g.beginPath();
    g.ellipse(cx, yBase - h / 2, w, h / 2, 0, 0, 2 * Math.PI);
    g.fill();
  }
  if (cover >= 0.95) g.fillRect(x0, yTop + depth * 0.25, x1 - x0, depth * 0.75);
}

export interface SectionPlace {
  /** where the wind blows from [°] at this place */
  from: number;
  /** the body (Mars: its dust's colour) */
  body: string;
}

/** The cut, on a canvas W × H CSS px at dpr. */
export function drawSection(cv: HTMLCanvasElement, w: WeatherState, place: SectionPlace) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(cv.clientWidth, 280),
    H = Math.max(cv.clientHeight, 180);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // (the height shown: the highest top and a margin, 3 km at least, 12 km at most)
  const topAlt = Math.min(12e3, Math.max(3000, ...w.layers.map((l) => l.top + 800)));
  const axisW = 40,
    barbW = 92,
    groundH = 14;
  const x0 = axisW,
    x1 = W - barbW;
  const y0 = H - groundH;
  // (a square-root scale: the lowest hundreds of metres — the fog, a low ceiling, the rain under it — given
  // room; linear, a 120 m fog under a 12 km storm was 4 px)
  const sy = (h: number) => y0 - Math.sqrt(Math.max(h, 0) / topAlt) * (y0 - 8);
  g.font = "500 10.5px Inter, system-ui, sans-serif";
  g.textBaseline = "middle";
  // the heights' grid (on the square-root scale: the ticks closer down)
  g.strokeStyle = GRID;
  g.fillStyle = DIM;
  g.textAlign = "right";
  g.lineWidth = 1;
  for (const h of [0, 100, 300, 1000, 2000, 4000, 6000, 9000, 12000].filter((x) => x <= topAlt)) {
    const y = sy(h);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(W - 4, y);
    g.stroke();
    g.fillText(h >= 1000 ? `${h / 1000} km` : `${h} m`, x0 - 5, y);
  }
  // the dust (Mars): the low air orange, thicker down
  if (w.dust > 0) {
    const gr = g.createLinearGradient(0, sy(3000), 0, y0);
    gr.addColorStop(0, "rgba(210, 120, 60, 0)");
    gr.addColorStop(1, `rgba(210, 120, 60, ${0.55 * w.dust})`);
    g.fillStyle = gr;
    g.fillRect(x0, sy(3000), x1 - x0, y0 - sy(3000));
  }
  // the haze: as dense as the visibility is short (40 km: none to speak of)
  const haze = Math.min(0.45, 1200 / Math.max(w.visibility, 300) / 10);
  if (haze > 0.01) {
    const gr = g.createLinearGradient(0, sy(1500), 0, y0);
    gr.addColorStop(0, "rgba(190, 200, 215, 0)");
    gr.addColorStop(1, `rgba(190, 200, 215, ${haze})`);
    g.fillStyle = gr;
    g.fillRect(x0, sy(1500), x1 - x0, y0 - sy(1500));
  }
  // the fog lying
  if (w.fogTop > 0) {
    g.fillStyle = "rgba(200, 208, 220, 0.6)";
    g.fillRect(x0, Math.min(sy(w.fogTop), y0 - 4), x1 - x0, y0 - Math.min(sy(w.fogTop), y0 - 4));
  }
  // the decks, their word and base on the left inside
  w.layers.forEach((l, i) => {
    const yT = sy(Math.min(l.top, topAlt)),
      yB = sy(l.base);
    deck(g, x0 + 4, x1 - 4, yT, yB, l.cover, 17 + i * 31);
    g.fillStyle = "rgba(4, 8, 14, 0.72)";
    const label = `${coverWord(l.cover)} ${l.base >= 1000 ? `${(l.base / 1000).toFixed(1)} km` : `${l.base} m`}`;
    const tw = g.measureText(label).width;
    g.fillRect(x0 + 6, yB - 16, tw + 8, 13);
    g.fillStyle = INK;
    g.textAlign = "left";
    g.fillText(label, x0 + 10, yB - 9.5);
  });
  // the rain: from the lowest deck to the ground, slanted downwind
  const low = w.layers[0];
  if (w.rain > 0 && low) {
    g.strokeStyle = `rgba(140, 190, 255, ${0.35 + 0.4 * w.rain})`;
    g.lineWidth = 1;
    const slant = Math.sin(((place.from + 180) * Math.PI) / 180) * 0.25;
    const n = Math.round(10 + 40 * w.rain);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) / n) * (x1 - x0);
      const yA = sy(low.base) + ((i * 37) % 23);
      g.beginPath();
      g.moveTo(x, yA);
      g.lineTo(x + slant * (y0 - yA), y0);
      g.stroke();
    }
  }
  // the ground
  g.fillStyle = place.body === "mars" ? "rgba(150, 80, 45, 0.9)" : "rgba(70, 82, 64, 0.95)";
  g.fillRect(x0, y0, x1 - x0, groundH);
  // the wind up the height: its barbs and speeds, right
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 1.3;
  const levels = [10, 300, 1000, 3000, 6000, 10000].filter((h) => h <= topAlt);
  let lastY = Number.POSITIVE_INFINITY;
  for (const h of levels) {
    const v = meanWind(w.wind.u10, h) + w.wind.shear * Math.min(h / 300, 1);
    const y = Math.max(sy(h), 12);
    // (one too close to the one below left out: their barbs and figures would overlap)
    if (lastY - y < 20) continue;
    lastY = y;
    const bx = x1 + 22;
    barb(g, bx, y, place.from, v);
    g.textAlign = "left";
    g.fillText(`${v.toFixed(0)} m/s`, bx + 26, y);
  }
}
