// The weather on the planisphere (PLAN-METEO W2b): over the world flat, what the weather model gives —
// where it varies (a draw: per place and day; the real one), its zones tinted (cloud, rain, storm, fog,
// dust); the wind as arrows on a grid (where to it blows, its force); each landing site as a station's
// symbol (a circle filled as its sky is covered, its edge the flight category's colour, the category and
// the visibility written beside it — never the colour alone —, the wind's barb); a legend.

import type { Settings } from "../settings";
import { ceilingOf, flightCategory, type WeatherPreset, type WeatherState, weatherAt, windFromAt } from "../weather";
import { barb } from "./weather-section";
import { tr } from "../i18n";

export interface WxRect {
  x0: number;
  y0: number;
  mw: number;
  mh: number;
}

/** The flight categories' colours, as the charts have them (and their names written beside them). */
export const CAT_INK = {
  VFR: "rgb(61, 220, 132)",
  MVFR: "rgb(74, 168, 255)",
  IFR: "rgb(255, 90, 70)",
  LIFR: "rgb(216, 107, 255)",
} as const;

/** A zone's tint by the weather's kind (none: fair, windy). */
const ZONE: Partial<Record<Exclude<WeatherPreset, "random" | "real">, string>> = {
  cloudy: "rgba(235, 240, 248, 0.10)",
  overcast: "rgba(235, 240, 248, 0.22)",
  rain: "rgba(90, 150, 255, 0.26)",
  storm: "rgba(170, 90, 255, 0.32)",
  fog: "rgba(200, 205, 215, 0.30)",
  dust: "rgba(215, 130, 60, 0.30)",
};
const ZONE_NAME: { k: keyof typeof ZONE; fr: string; en: string }[] = [
  { k: "overcast", fr: "couvert", en: "overcast" },
  { k: "rain", fr: "pluie", en: "rain" },
  { k: "storm", fr: "orage", en: "storm" },
  { k: "fog", fr: "brouillard", en: "fog" },
  { k: "dust", fr: "poussière", en: "dust" },
];

/** The zones' image of a world for a day (90 × 45: a pixel each 4°), the last few kept. */
const zoneCache = new Map<string, HTMLCanvasElement>();
function zoneImage(body: string, day: number, at: (lat: number, lon: number) => WeatherState): HTMLCanvasElement {
  const key = `${body}|${day}`;
  const hit = zoneCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 90;
  c.height = 45;
  const g = c.getContext("2d")!;
  for (let j = 0; j < 45; j++)
    for (let i = 0; i < 90; i++) {
      const z = ZONE[at(88 - j * 4, -178 + i * 4).kind];
      if (!z) continue;
      g.fillStyle = z;
      g.fillRect(i, j, 1, 1);
    }
  if (zoneCache.size >= 4) zoneCache.delete(zoneCache.keys().next().value as string);
  zoneCache.set(key, c);
  return c;
}

/** The sky's cover at a place for its symbol: the fog whole, else the most covering layer's. */
const skyCover = (w: WeatherState) => (w.fogTop > 0 && w.visibility < 1000 ? 1 : Math.max(0, ...w.layers.map((l) => l.cover)));

export function drawWeatherLayer(
  ctx: CanvasRenderingContext2D,
  R: WxRect,
  dpr: number,
  body: string,
  s: Settings,
  days: number,
  real: WeatherState | null,
  sites: { name: string; lat: number; lon: number }[],
) {
  const xy = (lat: number, lon: number): [number, number] => [R.x0 + (0.5 + lon / 360) * R.mw, R.y0 + (0.5 - lat / 180) * R.mh];
  const at = (lat: number, lon: number) => weatherAt(s, { body, lat, lon }, days, real);
  const varying = s.weather === "random";
  ctx.save();
  ctx.beginPath();
  ctx.rect(R.x0, R.y0, R.mw, R.mh);
  ctx.clip();
  // the zones (a draw: per place and day): computed once a day on a 4° grid into a small image, laid
  // over smoothed — soft-edged systems, not cells (and not ~4 000 draws a frame)
  if (varying) {
    const img = zoneImage(body, Math.floor(days), at);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, R.x0, R.y0, R.mw, R.mh);
  }
  // the wind: arrows every 20°, as long as it is strong, towards where it blows
  ctx.strokeStyle = "rgba(220, 232, 246, 0.6)";
  ctx.fillStyle = "rgba(220, 232, 246, 0.6)";
  ctx.lineWidth = 1.1 * dpr;
  for (let lat = -70; lat <= 70; lat += 20)
    for (let lon = -170; lon <= 170; lon += 20) {
      const w = at(lat, lon);
      if (w.wind.u10 < 0.5) continue;
      const to = ((windFromAt(w, { lat, lon }, days) + 180) * Math.PI) / 180;
      const L = (5 + w.wind.u10 * 1.3) * dpr;
      const [x, y] = xy(lat, lon);
      const dx = Math.sin(to),
        dy = -Math.cos(to);
      const ex = x + (dx * L) / 2,
        ey = y + (dy * L) / 2;
      ctx.beginPath();
      ctx.moveTo(x - (dx * L) / 2, y - (dy * L) / 2);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - dx * 4 * dpr + dy * 2.5 * dpr, ey - dy * 4 * dpr - dx * 2.5 * dpr);
      ctx.lineTo(ex - dx * 4 * dpr - dy * 2.5 * dpr, ey - dy * 4 * dpr + dx * 2.5 * dpr);
      ctx.fill();
    }
  ctx.restore();
  // the sites: a station's symbol each
  for (const st of sites) {
    const w = at(st.lat, st.lon);
    const cat = flightCategory(w);
    const ink = CAT_INK[cat];
    const [x, y] = xy(st.lat, st.lon);
    const r = 5.5 * dpr;
    // the barb first, under the circle
    ctx.strokeStyle = "rgba(235, 242, 250, 0.9)";
    ctx.fillStyle = "rgba(235, 242, 250, 0.9)";
    ctx.lineWidth = 1.2 * dpr;
    barb(ctx, x, y, windFromAt(w, st, days), w.wind.u10, 18 * dpr);
    // (the sky's cover: the circle filled by quarters, as a station's)
    const cov = skyCover(w);
    ctx.fillStyle = "rgba(6, 10, 18, 0.9)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (cov > 0.05) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, Math.round(cov * 4) / 4 || 0.25));
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
    // (its category, the visibility, the ceiling: written)
    const ceil = ceilingOf(w);
    const vis =
      w.visibility >= 10e3
        ? `${Math.round(w.visibility / 1000)}km`
        : w.visibility >= 1000
          ? `${(w.visibility / 1000).toFixed(1)}km`
          : `${w.visibility}m`;
    const label = `${cat} ${vis}${ceil === null ? "" : ` ${ceil}m`}`;
    ctx.font = `600 ${9 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(4, 8, 14, 0.72)";
    ctx.fillRect(x + r + 3 * dpr, y + 5 * dpr, tw + 6 * dpr, 12 * dpr);
    ctx.fillStyle = ink;
    ctx.fillText(label, x + r + 6 * dpr, y + 11 * dpr);
  }
  // the legend, bottom left: the categories (and, a draw, the zones)
  const items: [string, string][] = (["VFR", "MVFR", "IFR", "LIFR"] as const).map((c) => [CAT_INK[c], c]);
  if (varying) for (const z of ZONE_NAME) items.push([ZONE[z.k]!.replace(/[\d.]+\)$/, "0.85)"), tr(z)]);
  else items.push(["", tr({ fr: "le même temps partout", en: "the same weather everywhere" })]);
  ctx.font = `600 ${9 * dpr}px Inter, system-ui, sans-serif`;
  const pad = 5 * dpr,
    lh = 12 * dpr;
  const lw = Math.max(...items.map(([, n]) => ctx.measureText(n).width)) + 22 * dpr;
  const lx = R.x0 + 6 * dpr,
    ly = R.y0 + R.mh - pad * 2 - lh * items.length - 4 * dpr;
  ctx.fillStyle = "rgba(4, 8, 14, 0.78)";
  ctx.fillRect(lx, ly, lw, pad * 2 + lh * items.length);
  items.forEach(([col, name], i) => {
    const yy = ly + pad + lh * (i + 0.5);
    if (col) {
      ctx.fillStyle = col;
      ctx.fillRect(lx + pad, yy - 3.5 * dpr, 9 * dpr, 7 * dpr);
    }
    ctx.fillStyle = "rgba(220, 232, 246, 0.9)";
    ctx.textAlign = "left";
    ctx.fillText(name, lx + pad + (col ? 14 * dpr : 0), yy);
  });
}
