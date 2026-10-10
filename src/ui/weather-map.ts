// The weather on the planisphere (PLAN-METEO W2b): what the weather model gives, drawn the way a weather
// service draws it —
//   · the rain as a radar shows it: a continuous intensity (a draw's moisture and instability) in the
//     radar's colours, teal to green, yellow, orange, red, a storm's core magenta; the fog a pale veil;
//   · the wind as particles drifting with it (a few hundred, their trails fading), their colour its force;
//   · each landing site as a station marker (HTML: crisp at any scale): its flight category's dot, its
//     name, the category and the visibility; on hover, its report in full (wind, gusts, visibility,
//     ceiling and decks, precipitation);
//   · a legend: the radar's scale, the categories, the wind's;
//   · the real weather (PLAN-CIEL C2): the satellites' mosaic of the day under it all — the day's clouds as
//     they were —, each station its own real weather (Open-Meteo at its place), no wind field invented.
// The radar is computed once a day into a small image laid over smoothed; the particles run on their own
// canvas while the layer is shown; the markers are placed at each draw of the map.

import "./weather-map.css";
import { tr } from "../i18n";
import type { Settings } from "../settings";
import { ceilingOf, coverWord, flightCategory, rainIntensity, type WeatherState, weatherAt, weatherFields, windFromAt } from "../weather";
import { el as h } from "./kit";

export interface WxRect {
  x0: number;
  y0: number;
  mw: number;
  mh: number;
}

/** The radar's colour ramp: intensity → rgba. */
const RAMP: [number, [number, number, number, number]][] = [
  [0.0, [62, 224, 201, 0]],
  [0.15, [62, 224, 201, 0.2]],
  [0.4, [61, 220, 132, 0.36]],
  [0.65, [255, 211, 74, 0.46]],
  [0.85, [255, 138, 58, 0.55]],
  [1.0, [255, 59, 59, 0.62]],
  [1.3, [224, 75, 255, 0.72]],
];
function ramp(x: number): [number, number, number, number] {
  if (x <= RAMP[0]![0]) return RAMP[0]![1];
  for (let i = 1; i < RAMP.length; i++) {
    const [a, ca] = RAMP[i - 1]!,
      [b, cb] = RAMP[i]!;
    if (x <= b) {
      const t = (x - a) / (b - a);
      return [0, 1, 2, 3].map((k) => ca[k]! + (cb[k]! - ca[k]!) * t) as [number, number, number, number];
    }
  }
  return RAMP[RAMP.length - 1]![1];
}

const CATS = ["VFR", "MVFR", "IFR", "LIFR"] as const;

export class WeatherMapLayer {
  /** the wind's particles' canvas, the markers' layer, the legend — over the map's stage */
  private pcv = h("canvas", "wxm-particles") as HTMLCanvasElement;
  private marks = h("div", "wxm-marks");
  private legend = h("div", "wxm-legend");
  private radar: { key: string; c: HTMLCanvasElement } | null = null;
  private wind: { key: string; u: Float32Array; v: Float32Array } | null = null;
  private parts: { lat: number; lon: number; age: number }[] = [];
  private rect: WxRect | null = null;
  private dpr = 1;
  private raf = 0;
  private shown = true;
  private last = 0;
  private legendKey = "";
  private markEls = new Map<string, HTMLElement>();

  constructor(private stage: HTMLElement) {
    this.pcv.setAttribute("aria-hidden", "true");
    this.marks.dataset.testid = "weather-marks";
    this.legend.dataset.testid = "weather-legend";
    stage.append(this.pcv, this.marks, this.legend);
    this.hide();
  }

  /** The layer not drawn this time (another view, or the layer off): its pieces hidden, its particles stopped. */
  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.pcv.hidden = this.marks.hidden = this.legend.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Drawn with the map (its canvas, its rectangle in device pixels): the radar under the tracks; the
   * particles' field and the markers updated.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    R: WxRect,
    dpr: number,
    body: string,
    s: Settings,
    days: number,
    real: WeatherState | null,
    sites: { name: string; lat: number; lon: number }[],
    live: {
      /** the satellites' mosaic of the day (the real weather's clouds), or null */
      mosaic?: { img: ImageBitmap; date: string; layer: string } | null;
      /** the real weather at a place (its own, the model's), or null: not in yet */
      at?: (lat: number, lon: number) => WeatherState | null;
    } = {},
  ) {
    this.rect = R;
    this.dpr = dpr;
    const varying = s.weather === "random";
    const realHere = s.weather === "real" && body === "earth";
    const at = (lat: number, lon: number) => (realHere ? live.at?.(lat, lon) : null) ?? weatherAt(s, { body, lat, lon }, days, real);
    // ---- the satellites' mosaic of the day (the real weather)
    const mosaic = realHere ? (live.mosaic ?? null) : null;
    if (mosaic) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(R.x0, R.y0, R.mw, R.mh);
      ctx.clip();
      ctx.globalAlpha = 0.92;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(mosaic.img, R.x0, R.y0, R.mw, R.mh);
      ctx.restore();
    }
    // ---- the radar (a draw)
    if (varying) {
      const key = `${body}|${Math.floor(days)}`;
      if (!this.radar || this.radar.key !== key) this.radar = { key, c: this.paintRadar(body, days, at) };
      ctx.save();
      ctx.beginPath();
      ctx.rect(R.x0, R.y0, R.mw, R.mh);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.radar.c, R.x0, R.y0, R.mw, R.mh);
      ctx.restore();
    }
    // ---- the wind's field (a 10° grid, a day's), for the particles
    const wkey = `${body}|${s.weather}|${s.wind}|${Math.floor(days)}`;
    if (realHere) this.wind = { key: wkey, u: new Float32Array(37 * 19), v: new Float32Array(37 * 19) };
    else if (!this.wind || this.wind.key !== wkey) {
      const u = new Float32Array(37 * 19),
        v = new Float32Array(37 * 19);
      for (let j = 0; j < 19; j++)
        for (let i = 0; i < 37; i++) {
          const lat = -90 + j * 10,
            lon = -180 + i * 10;
          const w = at(lat, lon);
          const to = ((windFromAt(w, { lat, lon }, days) + 180) * Math.PI) / 180;
          u[j * 37 + i] = w.wind.u10 * Math.sin(to);
          v[j * 37 + i] = w.wind.u10 * Math.cos(to);
        }
      this.wind = { key: wkey, u, v };
    }
    // ---- the markers
    const seen = new Set<string>();
    for (const st of sites) {
      seen.add(st.name);
      const w = at(st.lat, st.lon);
      let m = this.markEls.get(st.name);
      if (!m) {
        m = h("div", "wxm-mark");
        m.tabIndex = 0;
        this.markEls.set(st.name, m);
        this.marks.append(m);
      }
      const cat = flightCategory(w);
      const ceil = ceilingOf(w);
      const vis =
        w.visibility >= 10e3
          ? `${Math.round(w.visibility / 1000)} km`
          : w.visibility >= 1000
            ? `${(w.visibility / 1000).toFixed(1)} km`
            : `${w.visibility} m`;
      const from = windFromAt(w, st, days);
      const short = st.name.split(/[,–(]/)[0]!.trim();
      const sig = `${cat}|${vis}|${ceil}|${Math.round(from)}|${w.wind.u10}|${w.rain}`;
      if (m.dataset.sig !== sig) {
        m.dataset.sig = sig;
        m.className = `wxm-mark ${cat.toLowerCase()}`;
        m.dataset.category = cat;
        const decks = w.layers.length
          ? w.layers.map((l) => `${coverWord(l.cover)} ${l.base >= 1000 ? `${(l.base / 1000).toFixed(1)} km` : `${l.base} m`}`).join(" · ")
          : tr({ fr: "ciel clair", en: "sky clear" });
        const precip =
          w.dust > 0
            ? tr({ fr: "poussière", en: "dust" })
            : w.rain <= 0
              ? "—"
              : tr(
                  w.rain >= 0.9
                    ? { fr: "forte pluie", en: "heavy rain" }
                    : w.rain >= 0.5
                      ? { fr: "pluie", en: "rain" }
                      : { fr: "bruine", en: "drizzle" },
                );
        m.innerHTML = `<i class="dot"></i><svg class="arr" viewBox="-6 -6 12 12" style="transform:rotate(${(from + 180).toFixed(0)}deg)"><path d="M0 -5 L3.4 3.6 L0 1.6 L-3.4 3.6 Z"/></svg><b>${short}</b><span class="cat">${cat}</span><span class="vis">${vis}</span>
          <div class="tip"><div class="th"><b>${st.name}</b><span class="cat">${cat}</span></div>
          <dl><dt>${tr({ fr: "Vent", en: "Wind" })}</dt><dd>${String(Math.round(from)).padStart(3, "0")}° · ${w.wind.u10.toFixed(0)} m/s${w.wind.gust > 0 ? ` · ${tr({ fr: "rafales", en: "gusts" })} ${(w.wind.u10 + w.wind.gust).toFixed(0)}` : ""}</dd>
          <dt>${tr({ fr: "Visibilité", en: "Visibility" })}</dt><dd>${vis}</dd>
          <dt>${tr({ fr: "Plafond", en: "Ceiling" })}</dt><dd>${ceil === null ? tr({ fr: "aucun", en: "none" }) : `${ceil} m`}</dd>
          <dt>${tr({ fr: "Nuages", en: "Clouds" })}</dt><dd>${decks}</dd>
          <dt>${tr({ fr: "Précip.", en: "Precip." })}</dt><dd>${precip}</dd></dl></div>`;
      }
      // (placed: device pixels to CSS pixels)
      const x = (R.x0 + (0.5 + st.lon / 360) * R.mw) / dpr,
        y = (R.y0 + (0.5 - st.lat / 180) * R.mh) / dpr;
      m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    for (const [name, el] of this.markEls)
      if (!seen.has(name)) {
        el.remove();
        this.markEls.delete(name);
      }
    this.declutter(R, dpr);
    // ---- the legend
    const lkey = `${varying}|${s.weather}|${mosaic?.date ?? ""}`;
    if (this.legendKey !== lkey) {
      this.legendKey = lkey;
      const rampCss = RAMP.slice(1)
        .map(([x, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.min(1, c[3] + 0.2)}) ${((x / 1.3) * 100).toFixed(0)}%`)
        .join(", ");
      this.legend.innerHTML =
        (mosaic
          ? `<div class="lg-row"><span class="lg-k">${tr({ fr: "Nuages du jour", en: "The day's clouds" })}</span><span class="lg-ends"><i>${mosaic.date} · ${mosaic.layer.split("_").slice(0, 2).join(" ")} · NASA GIBS</i></span></div>`
          : realHere
            ? `<div class="lg-row"><span class="lg-k">${tr({ fr: "Météo réelle", en: "Real weather" })}</span><span class="lg-ends"><i>${tr({ fr: "pas d'image satellite ce jour-là", en: "no satellite image that day" })}</i></span></div>`
            : "") +
        (varying
          ? `<div class="lg-row"><span class="lg-k">${tr({ fr: "Précipitations", en: "Precipitation" })}</span><span class="lg-ramp" style="background:linear-gradient(90deg, ${rampCss})"></span><span class="lg-ends"><i>${tr({ fr: "faibles", en: "light" })}</i><i>${tr({ fr: "fortes", en: "heavy" })}</i><i>${tr({ fr: "orage", en: "storm" })}</i></span></div>`
          : realHere
            ? ""
            : `<div class="lg-row"><span class="lg-k">${tr({ fr: "Le même temps partout", en: "The same weather everywhere" })}</span></div>`) +
        `<div class="lg-row lg-cats">${CATS.map((c) => `<span class="lg-cat ${c.toLowerCase()}"><i></i>${c}</span>`).join("")}</div>` +
        `<div class="lg-row"><span class="lg-k">${tr({ fr: "Vent", en: "Wind" })}</span><span class="lg-wind"></span><span class="lg-ends"><i>0</i><i>10</i><i>20 m/s</i></span></div>`;
    }
    // (the legend at the map's own bottom-left corner — the stage's is under the HUD's bars in the map's view)
    this.legend.style.left = `${(R.x0 / dpr + 8).toFixed(0)}px`;
    this.legend.style.bottom = `${(this.stage.clientHeight - (R.y0 + R.mh) / dpr + 8).toFixed(0)}px`;
    // ---- shown: the particles' canvas sized, its loop started
    if (!this.shown) {
      this.shown = true;
      this.pcv.hidden = this.marks.hidden = this.legend.hidden = false;
      this.parts = [];
      this.last = 0;
    }
    const W = this.stage.clientWidth,
      H = this.stage.clientHeight;
    if (this.pcv.width !== Math.round(W * dpr) || this.pcv.height !== Math.round(H * dpr)) {
      this.pcv.width = Math.round(W * dpr);
      this.pcv.height = Math.round(H * dpr);
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * The markers' labels kept apart: each, top to bottom, its label to the right of its dot — or to the left
   * when it would leave the map or meet one already placed; else nudged down a line.
   */
  private declutter(R: WxRect, dpr: number) {
    const right = (R.x0 + R.mw) / dpr;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const els = [...this.markEls.values()].map((el) => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
      return { el, x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0), w: el.offsetWidth, hh: el.offsetHeight || 18 };
    });
    els.sort((a, b) => a.y - b.y);
    const hit = (b: { x0: number; x1: number; y0: number; y1: number }) =>
      placed.some((p) => b.x0 < p.x1 && p.x0 < b.x1 && b.y0 < p.y1 && p.y0 < b.y1);
    for (const m of els) {
      const box = (left: boolean, dy: number) => (left ? { x0: m.x - m.w + 9, x1: m.x + 9 } : { x0: m.x - 9, x1: m.x - 9 + m.w });
      let left = false,
        dy = 0;
      const tryAt = (l: boolean, d: number) => {
        const b = { ...box(l, d), y0: m.y - 9 + d, y1: m.y - 9 + d + m.hh };
        return b.x1 <= right + 2 && !hit(b) ? b : null;
      };
      let b = tryAt(false, 0) ?? tryAt(true, 0);
      if (!b) {
        for (dy = m.hh; dy <= 3 * m.hh && !b; dy += m.hh) b = tryAt(false, dy) ?? tryAt(true, dy);
        if (b) dy -= m.hh;
      }
      if (b) left = b.x1 <= m.x + 9 && b.x0 < m.x - 9;
      m.el.classList.toggle("left", left);
      m.el.style.setProperty("--dy", `${b ? b.y0 - (m.y - 9) : 0}px`);
      placed.push(b ?? { x0: m.x - 9, x1: m.x - 9 + m.w, y0: m.y - 9, y1: m.y - 9 + m.hh });
    }
  }

  /** The radar's image of a draw's day: 180 × 90 (2° a pixel), the rain's intensity in its colours, the fog pale. */
  private paintRadar(body: string, days: number, at: (lat: number, lon: number) => WeatherState): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 180;
    c.height = 90;
    const g = c.getContext("2d")!;
    const img = g.createImageData(180, 90);
    for (let j = 0; j < 90; j++)
      for (let i = 0; i < 180; i++) {
        const lat = 89 - j * 2,
          lon = -179 + i * 2;
        const f = weatherFields(body, lat, lon, days);
        let col: [number, number, number, number];
        if (body === "mars") col = f.moist > 0.6 ? [215, 130, 60, Math.min(0.75, (f.moist - 0.6) * 4)] : [0, 0, 0, 0];
        else {
          // (a radar's picture: most rain light, the red and the magenta the cores)
          const r = rainIntensity(f, lat) ** 1.4;
          col = r > 0.04 ? ramp(r) : [0, 0, 0, 0];
          if (col[3] < 0.05 && at(lat, lon).kind === "fog") col = [225, 230, 236, 0.38];
        }
        const o = (j * 180 + i) * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = Math.round(col[3] * 255);
      }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** The wind at a place from the day's grid [m/s east, north] (bilinear). */
  private windAt(lat: number, lon: number): [number, number] {
    const W = this.wind!;
    const x = (lon + 180) / 10,
      y = (lat + 90) / 10;
    const i = Math.min(Math.max(Math.floor(x), 0), 35),
      j = Math.min(Math.max(Math.floor(y), 0), 17);
    const fx = x - i,
      fy = y - j;
    const k = (ii: number, jj: number) => jj * 37 + ii;
    const mix = (a: Float32Array) =>
      (a[k(i, j)]! * (1 - fx) + a[k(i + 1, j)]! * fx) * (1 - fy) + (a[k(i, j + 1)]! * (1 - fx) + a[k(i + 1, j + 1)]! * fx) * fy;
    return [mix(W.u), mix(W.v)];
  }

  /** The particles' frame: each drifts with the wind (sped up: visible, not literal), its trail fading. */
  private tick = (now: number) => {
    this.raf = 0;
    if (!this.shown || !this.rect || !this.wind) return;
    // (the map's stage no longer shown — the 3D tab, the HUD hidden —: stopped until it is drawn again)
    if (this.stage.offsetWidth === 0) return this.hide();
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 0.016;
    this.last = now;
    const g = this.pcv.getContext("2d");
    if (!g) return;
    const R = this.rect,
      dpr = this.dpr;
    // (the trails fade: what was drawn dimmed each frame)
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = "rgba(0, 0, 0, 0.9)";
    g.fillRect(0, 0, this.pcv.width, this.pcv.height);
    g.globalCompositeOperation = "source-over";
    const N = Math.round(Math.min(900, (R.mw * R.mh) / (dpr * dpr) / 260));
    while (this.parts.length < N)
      this.parts.push({ lat: -80 + 160 * Math.random(), lon: -180 + 360 * Math.random(), age: Math.random() * 120 });
    this.parts.length = N;
    g.lineWidth = 1.2 * dpr;
    g.lineCap = "round";
    // (degrees a second per m/s: a 10 m/s wind crosses ~5° a second)
    const k = 0.55;
    for (const p of this.parts) {
      const [u, v] = this.windAt(p.lat, p.lon);
      const sp = Math.hypot(u, v);
      const x0 = R.x0 + (0.5 + p.lon / 360) * R.mw,
        y0 = R.y0 + (0.5 - p.lat / 180) * R.mh;
      p.lon += (u * k * dt) / Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
      p.lat += v * k * dt;
      p.age += dt * 60;
      if (p.age > 140 || p.lat > 85 || p.lat < -85 || sp < 0.3) {
        p.lat = -80 + 160 * Math.random();
        p.lon = -180 + 360 * Math.random();
        p.age = 0;
        continue;
      }
      if (p.lon > 180) p.lon -= 360;
      if (p.lon < -180) p.lon += 360;
      const x1 = R.x0 + (0.5 + p.lon / 360) * R.mw,
        y1 = R.y0 + (0.5 - p.lat / 180) * R.mh;
      if (Math.abs(x1 - x0) > R.mw / 2) continue;
      // (its colour its force: pale blue light, cyan, amber strong)
      const t = Math.min(sp / 20, 1);
      g.strokeStyle =
        t < 0.5
          ? `rgba(${Math.round(210 - 100 * t * 2)}, ${Math.round(228 - 18 * t * 2)}, 255, 0.82)`
          : `rgba(${Math.round(110 + 145 * (t - 0.5) * 2)}, ${Math.round(210 - 30 * (t - 0.5) * 2)}, ${Math.round(255 - 165 * (t - 0.5) * 2)}, 0.88)`;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  };
}
