// The weather's vertical cut at a place (PLAN-METEO W2b): a small living picture of the air above it —
// the sky's colour as the weather has it, the ground and its runway with a windsock leaning downwind,
// the haze and the fog lying, the cloud decks drawn soft and shaded (stratus sheets, cumulus, a storm's
// tower and anvil) drifting with the wind, the rain falling from the lowest base and the lightning now and
// then, Mars's dust blowing; where the craft is on the height's scale; on the right the wind's profile
// up the height (the mean wind and its gusts' band), its direction at each level.
//
// A square-root height scale (the fog and a low ceiling given room under a 12 km storm). The decks are
// painted once into an offscreen canvas (their shape is the weather's, not the frame's) and slid; the
// rain, the lightning and the dust are the frame's.

import { tr } from "../i18n";
import { meanWind } from "../wind";
import { coverWord, type WeatherState } from "../weather";

const FONT_LABEL = "700 10px Rajdhani, 'Barlow Condensed', system-ui, sans-serif";
const FONT_VALUE = "500 10.5px 'JetBrains Mono', ui-monospace, monospace";
const TEXT = "rgba(222, 232, 246, 0.94)";
const DIM = "rgba(176, 196, 222, 0.66)";
const CYAN = "#6fd2ff";

/** A barb as the charts draw it (the map's symbols): the staff towards where the wind comes from, a pennant
 *  for 25 m/s, a long feather for 5, a short one for 2.5 — seen from above, north up. */
export function barb(g: CanvasRenderingContext2D, x: number, y: number, from: number, speed: number, len = 22) {
  const a = (from * Math.PI) / 180;
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

export interface SectionPlace {
  /** where the wind blows from [°] at this place */
  from: number;
  /** the body (Mars: its ground's and dust's colours) */
  body: string;
  /** the craft's height above the ground [m] (null: none) */
  craftH: number | null;
}

/** A seeded random (the decks' shapes the same each frame). */
function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The sky's colours (top, horizon) as the weather has them. */
function skyOf(w: WeatherState, body: string): [string, string] {
  if (body === "mars") return w.dust > 0 ? ["#3c1c0e", "#b8693a"] : ["#2a1a14", "#9a6a4c"];
  const cover = Math.max(0, ...w.layers.map((l) => l.cover));
  if (w.kind === "storm") return ["#0c1119", "#38424f"];
  if (w.fogTop > 0) return ["#4d5866", "#a3adb8"];
  if (w.rain > 0 || cover >= 0.95) return ["#1f2833", "#69778a"];
  if (cover >= 0.6) return ["#1c3150", "#6a8bb0"];
  return ["#0b2a55", "#5d95d0"];
}

/** A soft, shaded puff: lit from above, its underside greyer. */
function puff(g: CanvasRenderingContext2D, x: number, y: number, r: number, light: number, shade: number) {
  const gr = g.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.1, x, y, r);
  gr.addColorStop(0, `rgba(${light}, ${light}, ${Math.min(255, light + 8)}, 0.96)`);
  gr.addColorStop(0.65, `rgba(${shade + 20}, ${shade + 26}, ${shade + 36}, 0.9)`);
  gr.addColorStop(1, `rgba(${shade}, ${shade + 6}, ${shade + 16}, 0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, 2 * Math.PI);
  g.fill();
}

/**
 * The decks painted into a canvas as wide as the plot, seamless across its edges (each puff drawn again a
 * width either side: the picture slides and wraps): a stratus sheet (overcast, or thin) — a lumpy, soft top
 * over a body greying down —, cumulus cells as many as the cover, a storm's towers and anvil over its
 * deck; every deck blurred a little (its puffs one mass), its base cut flat as real bases are, its
 * underside shaded.
 */
function paintDecks(w: WeatherState, W: number, H: number, sy: (h: number) => number, dark: boolean, dpr: number): HTMLCanvasElement {
  // (three widths: the blur fades a canvas's edges — the middle width, whole, is the one shown)
  const mk = () => {
    const k = document.createElement("canvas");
    k.width = Math.round(3 * W * dpr);
    k.height = Math.round(H * dpr);
    return k;
  };
  const c = mk();
  const out = c.getContext("2d")!;
  const light = dark ? 214 : 250,
    shade = dark ? 96 : 156;
  // (each deck on its own canvas, then laid on: its base's cut must not bite the deck under it — a
  // storm's anvil was cut by the cirrus deck above it)
  const lc = mk();
  const g = lc.getContext("2d")!;
  g.scale(dpr, dpr);
  const wrapPuff = (x: number, y: number, r: number, l = light, sh = shade) => {
    for (const dx of [0, W, 2 * W]) puff(g, x + dx, y, r, l, sh);
  };
  w.layers.forEach((l, li) => {
    g.clearRect(0, 0, 3 * W, H);
    const r = rnd(97 + li * 131 + Math.round(l.base));
    const yT = sy(l.top),
      yB = sy(l.base);
    const depth = Math.max(yB - yT, 4);
    const storm = l.top - l.base > 6000;
    const sheet = !storm && (l.cover >= 0.95 || depth < 14);
    g.save();
    // (soft: the puffs merged into one mass — where the canvas has filters)
    g.filter = `blur(${Math.min(3, 1 + depth * 0.03).toFixed(1)}px)`;
    if (storm) {
      // the deck under the towers, whole and dark
      for (let x = 0; x < W; x += 16) wrapPuff(x + r() * 8, yB - 10 - r() * 6, 18 + r() * 12, light - 40, shade - 30);
      // cumulonimbus: towers rising to the anvil, the anvil spread flat and wide at the top
      const n = 3;
      for (let k = 0; k < n; k++) {
        const cx = ((k + 0.25 + 0.5 * r()) / n) * W;
        const tw = 30 + 22 * r();
        for (let y = yB - 6; y > yT + depth * 0.16; y -= tw * 0.3) {
          const widen = 1 - (yB - y) / depth;
          for (let p = 0; p < 3; p++) wrapPuff(cx + (r() - 0.5) * tw * (0.9 + 0.4 * widen), y - r() * 6, tw * (0.45 + 0.3 * r()));
        }
        for (let s = -1; s <= 1; s += 0.14)
          wrapPuff(cx + s * tw * 3.4 + (r() - 0.5) * 8, yT + depth * 0.08 + r() * 6, tw * (0.32 + 0.12 * r()), light, shade + 12);
      }
    } else if (sheet) {
      // a stratus sheet: its body greying down, its top a row of soft lumps
      const gr = g.createLinearGradient(0, yT, 0, yB);
      gr.addColorStop(0, `rgba(${light}, ${light}, ${light + 4}, 0.94)`);
      gr.addColorStop(1, `rgba(${shade}, ${shade + 6}, ${shade + 16}, 0.96)`);
      g.fillStyle = gr;
      g.fillRect(0, yT + depth * 0.3, 3 * W, yB - yT - depth * 0.3);
      // (its lumps a deck's texture, not balls: 5 to 14 px whatever its depth)
      const lump = Math.min(14, Math.max(5, depth * 0.3));
      for (let x = 0; x < W; x += lump * 0.8)
        wrapPuff(x + r() * lump * 0.4, yT + depth * 0.35 + r() * depth * 0.1, lump * (0.75 + 0.4 * r()));
      // (a broken sheet's gaps)
      if (l.cover < 0.95) {
        g.globalCompositeOperation = "destination-out";
        const gaps = Math.round((1 - l.cover) * 12);
        for (let k = 0; k < gaps; k++) {
          const gx = r() * W,
            gw = 18 + 30 * r();
          for (const dx of [0, W, 2 * W]) {
            const gg = g.createRadialGradient(gx + dx, (yT + yB) / 2, 2, gx + dx, (yT + yB) / 2, gw);
            gg.addColorStop(0, "rgba(0,0,0,1)");
            gg.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = gg;
            g.fillRect(gx + dx - gw, yT - 10, 2 * gw, depth + 20);
          }
        }
        g.globalCompositeOperation = "source-over";
      }
    } else {
      // cumulus: cells as many as the cover, each a cluster of puffs heaped from its base
      const cells = Math.max(1, Math.round(l.cover * 11));
      for (let k = 0; k < cells; k++) {
        const cx = ((k + 0.2 + 0.6 * r()) / cells) * W;
        const cw = Math.min(W / cells, 90) * (0.55 + 0.45 * r());
        const ch = depth * (0.5 + 0.5 * r());
        const m = 10 + Math.round(8 * r());
        for (let p = 0; p < m; p++) {
          const u = r();
          // (higher puffs nearer the cell's middle: a dome)
          const px = cx + (u - 0.5) * cw;
          const rise = (1 - Math.abs(u - 0.5) * 2) * ch;
          const pr = Math.max(3, Math.min(cw * 0.22, ch * 0.4) * (0.6 + 0.6 * r()));
          wrapPuff(px, yB - pr * 0.6 - r() * rise * 0.8, pr);
        }
      }
    }
    g.filter = "none";
    // (the base cut flat, softly; the underside shaded)
    g.globalCompositeOperation = "destination-out";
    const cut = g.createLinearGradient(0, yB - 1, 0, yB + 4);
    cut.addColorStop(0, "rgba(0,0,0,0)");
    cut.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = cut;
    g.fillRect(0, yB - 1, 3 * W, Math.min(40, H - yB + 1));
    g.restore();
    out.drawImage(lc, 0, 0);
  });
  return c;
}

/** A cut kept between frames: its decks' picture, its rain, its lightning. */
export class Section {
  private decks: { key: string; c: HTMLCanvasElement } | null = null;
  private drops: { x: number; y: number; v: number }[] = [];
  private dust: { x: number; y: number; v: number }[] = [];
  private flash = { at: -1e9, x: 0 };
  private last = 0;

  constructor(private cv: HTMLCanvasElement) {}

  /** One frame of the cut (now: performance.now() ms). */
  draw(w: WeatherState, place: SectionPlace, now: number) {
    const cv = this.cv;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(cv.clientWidth, 320),
      H = Math.max(cv.clientHeight, 220);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      this.decks = null;
    }
    const g = cv.getContext("2d");
    if (!g) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const topAlt = Math.min(12e3, Math.max(3000, ...w.layers.map((l) => l.top + 900)));
    const axisW = 46,
      prof = Math.min(170, W * 0.24),
      groundH = 26;
    const x0 = axisW,
      x1 = W - prof;
    const PW = x1 - x0;
    const y0 = H - groundH;
    const yTop = 10;
    const sy = (h: number) => y0 - Math.sqrt(Math.max(h, 0) / topAlt) * (y0 - yTop);
    const mars = place.body === "mars";
    // ---- the sky
    const [skyT, skyH] = skyOf(w, place.body);
    const sk = g.createLinearGradient(0, yTop, 0, y0);
    sk.addColorStop(0, skyT);
    sk.addColorStop(1, skyH);
    g.fillStyle = sk;
    g.fillRect(x0, 0, PW, y0);
    // ---- the heights' grid and scale
    g.font = FONT_VALUE;
    g.textBaseline = "middle";
    for (const h of [0, 100, 300, 1000, 2000, 4000, 6000, 9000, 12000].filter((x) => x <= topAlt)) {
      const y = sy(h);
      g.strokeStyle = "rgba(255, 255, 255, 0.07)";
      g.lineWidth = 1;
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = DIM;
      g.textAlign = "right";
      g.fillText(h >= 1000 ? `${h / 1000} km` : `${h} m`, x0 - 7, y);
    }
    // ---- the haze, the dust low down
    const haze = Math.min(0.55, 3000 / Math.max(w.visibility, 300) / 10);
    if (haze > 0.01) {
      const gr = g.createLinearGradient(0, sy(2500), 0, y0);
      gr.addColorStop(0, "rgba(200, 210, 222, 0)");
      gr.addColorStop(1, `rgba(200, 210, 222, ${haze})`);
      g.fillStyle = gr;
      g.fillRect(x0, sy(2500), PW, y0 - sy(2500));
    }
    if (w.dust > 0) {
      const gr = g.createLinearGradient(0, sy(4000), 0, y0);
      gr.addColorStop(0, "rgba(205, 120, 60, 0)");
      gr.addColorStop(1, `rgba(205, 120, 60, ${0.7 * w.dust})`);
      g.fillStyle = gr;
      g.fillRect(x0, sy(4000), PW, y0 - sy(4000));
    }
    // ---- the decks, sliding with the wind (its east-west part, across the cut)
    const key = `${W}x${H}|${dpr}|${JSON.stringify(w.layers)}|${w.kind}`;
    if (!this.decks || this.decks.key !== key) this.decks = { key, c: paintDecks(w, PW, H, sy, w.rain > 0 || w.kind === "storm", dpr) };
    const drift = -Math.sin((place.from * Math.PI) / 180) * (4 + w.wind.u10 * 0.6);
    const off = ((((now / 1000) * drift) % PW) + PW) % PW;
    g.save();
    g.beginPath();
    g.rect(x0, 0, PW, y0);
    g.clip();
    // (the picture's middle width, seamless: drawn twice, end to end, on whole device pixels)
    const dc = this.decks.c;
    const sw = dc.width / 3;
    const xa = Math.round((x0 - off) * dpr) / dpr;
    g.drawImage(dc, sw, 0, sw, dc.height, xa, 0, PW, H);
    g.drawImage(dc, sw, 0, sw, dc.height, xa + PW, 0, PW, H);
    // ---- the rain, from the lowest base down, slanted downwind
    const low = w.layers[0];
    const slant = -Math.sin((place.from * Math.PI) / 180) * (0.15 + w.wind.u10 * 0.012);
    const nDrops = low && w.rain > 0 ? Math.round(60 + 220 * w.rain) : 0;
    while (this.drops.length < nDrops) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.8 + 0.4 * Math.random() });
    this.drops.length = nDrops;
    if (low && nDrops) {
      const yb = sy(low.base);
      g.strokeStyle = `rgba(170, 200, 240, ${0.25 + 0.3 * w.rain})`;
      g.lineWidth = 1;
      g.beginPath();
      for (const d of this.drops) {
        d.y += dt * d.v * 0.9;
        if (d.y > 1) {
          d.y -= 1;
          d.x = Math.random();
        }
        const y = yb + d.y * (y0 - yb);
        const x = x0 + d.x * PW + slant * (y - yb);
        const len = 6 + 6 * w.rain;
        g.moveTo(x, y);
        g.lineTo(x + slant * len, y + len);
      }
      g.stroke();
    }
    // ---- the lightning: a storm's, now and then
    if (w.kind === "storm" && low) {
      if (now - this.flash.at > 3500 && Math.random() < dt * 0.6) this.flash = { at: now, x: x0 + (0.15 + 0.7 * Math.random()) * PW };
      const age = now - this.flash.at;
      if (age < 220) {
        const a = 1 - age / 220;
        g.fillStyle = `rgba(220, 230, 255, ${0.18 * a})`;
        g.fillRect(x0, 0, PW, y0);
        const r = rnd(Math.round(this.flash.at));
        g.strokeStyle = `rgba(245, 248, 255, ${a})`;
        g.lineWidth = 2;
        g.shadowColor = "rgba(190, 210, 255, 0.9)";
        g.shadowBlur = 10;
        g.beginPath();
        let x = this.flash.x,
          y = sy(low.base);
        g.moveTo(x, y);
        while (y < y0) {
          y += 8 + 10 * r();
          x += (r() - 0.5) * 18;
          g.lineTo(x, Math.min(y, y0));
        }
        g.stroke();
        g.shadowBlur = 0;
      }
    }
    // ---- Mars's dust blowing low
    const nDust = w.dust > 0 ? Math.round(120 * w.dust) : 0;
    while (this.dust.length < nDust) this.dust.push({ x: Math.random(), y: Math.random(), v: 0.6 + 0.8 * Math.random() });
    this.dust.length = nDust;
    if (nDust) {
      g.fillStyle = "rgba(235, 160, 100, 0.55)";
      const dir = drift >= 0 ? 1 : -1;
      for (const p of this.dust) {
        p.x += dir * dt * p.v * 0.12;
        p.x -= Math.floor(p.x);
        const y = y0 - p.y ** 2.5 * (y0 - sy(1500));
        g.fillRect(x0 + p.x * PW, y, 2, 1);
      }
    }
    // ---- the fog lying: a white veil thinning upwards
    if (w.fogTop > 0) {
      const ft = sy(w.fogTop * 1.8);
      const gr = g.createLinearGradient(0, ft, 0, y0);
      gr.addColorStop(0, "rgba(225, 230, 236, 0)");
      gr.addColorStop(0.55, "rgba(225, 230, 236, 0.55)");
      gr.addColorStop(1, "rgba(232, 236, 240, 0.88)");
      g.fillStyle = gr;
      g.fillRect(x0, ft, PW, y0 - ft);
    }
    g.restore();
    // ---- the ground: hills, the runway, the windsock leaning downwind
    const ground = g.createLinearGradient(0, y0 - 8, 0, H);
    ground.addColorStop(0, mars ? "#8a4a2a" : "#2f4632");
    ground.addColorStop(1, mars ? "#4a2414" : "#16231a");
    g.fillStyle = ground;
    g.beginPath();
    g.moveTo(x0, H);
    const hill = rnd(7);
    for (let x = 0; x <= PW; x += 10) {
      const t = x / PW;
      const bump = t > 0.12 && t < 0.52 ? 0 : 5 + 4 * Math.sin(t * 13) + 3 * hill();
      g.lineTo(x0 + x, y0 - bump);
    }
    g.lineTo(x1, H);
    g.closePath();
    g.fill();
    // (the runway: its pavement, its centreline, its threshold's green and its end's red lights)
    const rx0 = x0 + PW * 0.14,
      rx1 = x0 + PW * 0.5;
    g.fillStyle = "rgba(70, 76, 84, 0.95)";
    g.fillRect(rx0, y0 - 2, rx1 - rx0, 4);
    g.fillStyle = "rgba(255, 255, 255, 0.75)";
    for (let x = rx0 + 6; x < rx1 - 6; x += 14) g.fillRect(x, y0 - 0.5, 7, 1);
    g.fillStyle = "rgba(120, 255, 150, 0.95)";
    g.fillRect(rx0 - 2, y0 - 2, 2, 4);
    g.fillStyle = "rgba(255, 80, 70, 0.95)";
    g.fillRect(rx1, y0 - 2, 2, 4);
    // (the windsock: its cone towards where the wind blows — across the cut —, limp in a calm, straight
    // out from ~8 m/s)
    {
      const px = rx1 + 22,
        py = y0 - 2;
      g.strokeStyle = "rgba(220, 225, 232, 0.9)";
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px, py - 18);
      g.stroke();
      const lean = Math.min(w.wind.u10 / 8, 1);
      const side = -Math.sin((place.from * Math.PI) / 180) >= 0 ? 1 : -1;
      const L = 14;
      const ang = (Math.PI / 2) * (1 - lean);
      const ex = px + side * L * Math.cos(ang),
        ey = py - 18 + L * Math.sin(ang);
      g.lineWidth = 3.5;
      g.lineCap = "round";
      const sock = g.createLinearGradient(px, py - 18, ex, ey);
      sock.addColorStop(0, "#ff7a2e");
      sock.addColorStop(0.5, "#ffffff");
      sock.addColorStop(1, "#ff7a2e");
      g.strokeStyle = sock;
      g.beginPath();
      g.moveTo(px, py - 18);
      g.lineTo(ex, ey);
      g.stroke();
      g.lineCap = "butt";
    }
    // ---- the decks' reports, at their bases, right
    g.font = FONT_VALUE;
    for (const l of w.layers) {
      const yB = sy(l.base);
      const label = `${coverWord(l.cover)}  ${l.base >= 1000 ? `${(l.base / 1000).toFixed(1)} km` : `${l.base} m`}`;
      const tw = g.measureText(label).width;
      const bx = x1 - tw - 18,
        by = Math.min(yB + 2, y0 - 16);
      g.fillStyle = "rgba(5, 9, 16, 0.78)";
      g.fillRect(bx, by, tw + 12, 15);
      g.fillStyle = TEXT;
      g.textAlign = "left";
      g.fillText(label, bx + 6, by + 8);
    }
    // ---- where the craft is: a marker on the scale (above the cut: at its top, its height written)
    if (place.craftH !== null && Number.isFinite(place.craftH)) {
      const above = place.craftH > topAlt;
      const y = above ? yTop + 6 : Math.max(sy(place.craftH), yTop + 6);
      g.fillStyle = "#ffb35c";
      g.beginPath();
      g.moveTo(x0 + 1, y);
      g.lineTo(x0 + 9, y - 5);
      g.lineTo(x0 + 9, y + 5);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(255, 179, 92, 0.45)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x0 + 10, y);
      g.lineTo(x1, y);
      g.stroke();
      g.setLineDash([]);
      const hTxt =
        place.craftH >= 1e5
          ? `${Math.round(place.craftH / 1000)} km`
          : place.craftH >= 1000
            ? `${(place.craftH / 1000).toFixed(1)} km`
            : `${Math.round(place.craftH)} m`;
      const label = `${above ? "▲ " : ""}${hTxt}`;
      g.font = FONT_VALUE;
      const tw = g.measureText(label).width;
      g.fillStyle = "rgba(5, 9, 16, 0.8)";
      g.fillRect(x0 + 12, y - 8, tw + 10, 15);
      g.fillStyle = "#ffb35c";
      g.textAlign = "left";
      g.fillText(label, x0 + 17, y);
    }
    // ---- the wind's profile, right: its speed up the height, its gusts' band, its direction
    const px0 = x1 + 14,
      px1 = W - 10;
    g.fillStyle = "rgba(255, 255, 255, 0.025)";
    g.fillRect(x1, 0, W - x1, H);
    g.strokeStyle = "rgba(160, 210, 255, 0.12)";
    g.beginPath();
    g.moveTo(x1 + 0.5, 0);
    g.lineTo(x1 + 0.5, H);
    g.stroke();
    const speedAt = (h: number) => meanWind(w.wind.u10, h) + w.wind.shear * Math.min(h / 300, 1);
    const hs: number[] = [];
    for (let k = 0; k <= 40; k++) hs.push(topAlt * (k / 40) ** 2);
    const vMax = Math.max(5, ...hs.map((h) => speedAt(h) + w.wind.gust));
    const sx = (v: number) => px0 + (v / vMax) * (px1 - px0 - 46);
    // (the gusts' band)
    g.fillStyle = "rgba(111, 210, 255, 0.14)";
    g.beginPath();
    hs.forEach((h, k) => {
      if (k) g.lineTo(sx(speedAt(h) + w.wind.gust), sy(h));
      else g.moveTo(sx(speedAt(h) + w.wind.gust), sy(h));
    });
    for (let k = hs.length - 1; k >= 0; k--) g.lineTo(sx(speedAt(hs[k]!)), sy(hs[k]!));
    g.closePath();
    g.fill();
    // (the mean wind)
    g.strokeStyle = CYAN;
    g.lineWidth = 2;
    g.beginPath();
    hs.forEach((h, k) => {
      if (k) g.lineTo(sx(speedAt(h)), sy(h));
      else g.moveTo(sx(speedAt(h)), sy(h));
    });
    g.stroke();
    // (its figures and direction at a few levels, spaced)
    g.font = FONT_VALUE;
    let lastY = Number.POSITIVE_INFINITY;
    for (const h of [10, 300, 1000, 3000, 6000, 10000].filter((x) => x <= topAlt)) {
      const y = sy(h);
      if (lastY - y < 22) continue;
      lastY = y;
      const v = speedAt(h);
      g.fillStyle = CYAN;
      g.beginPath();
      g.arc(sx(v), y, 2.5, 0, 2 * Math.PI);
      g.fill();
      // a plan-view arrow: where it blows to (north up)
      g.save();
      g.translate(W - 20, y);
      g.rotate(((place.from + 180) * Math.PI) / 180);
      g.fillStyle = TEXT;
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(4, 5);
      g.lineTo(0, 2.5);
      g.lineTo(-4, 5);
      g.closePath();
      g.fill();
      g.restore();
      g.fillStyle = TEXT;
      g.textAlign = "right";
      g.fillText(`${v.toFixed(0)}`, W - 30, y);
    }
    g.font = FONT_LABEL;
    g.fillStyle = DIM;
    g.textAlign = "left";
    g.fillText(tr({ fr: "VENT · m/s", en: "WIND · m/s" }), px0, H - 10);
  }
}
