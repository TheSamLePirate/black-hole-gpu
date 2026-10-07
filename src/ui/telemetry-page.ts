// The tablet's TELEMETRY page (PLAN-HUB HB4): the flight's recorded figures (game/recorder.ts) as curves
// against the scene's time — up to three chosen, stacked on one time axis; the window from a minute to
// the whole flight; each curve's last value, its least and its most; the record exported as CSV.

import { tr } from "../i18n";
import { CHANNELS, type RecKey, recorder, type RecSample } from "../game/recorder";
import { store } from "../util/storage";
import { button, el, h } from "./kit";

const WINDOWS: [number, string][] = [
  [60, "1 min"],
  [600, "10 min"],
  [3600, "1 h"],
  [Number.POSITIVE_INFINITY, "∞"],
];

const NAMES: Record<RecKey, { fr: string; en: string }> = {
  alt: { fr: "Altitude", en: "Altitude" },
  // (the HUD's own: the air's or the ground's near a world — not the orbit's speed of the map's strip)
  speed: { fr: "Vitesse (HUD)", en: "Speed (HUD)" },
  vz: { fr: "Vitesse verticale", en: "Vertical speed" },
  g: { fr: "Facteur de charge", en: "Load" },
  q: { fr: "Pression dynamique", en: "Dynamic pressure" },
  mach: { fr: "Mach", en: "Mach" },
  heat: { fr: "Flux thermique", en: "Heat flux" },
  throttle: { fr: "Gaz", en: "Throttle" },
  dv: { fr: "Δv dépensé", en: "Δv spent" },
  fuel: { fr: "Propergol", en: "Propellant" },
};

/** The curves' colours, in their order on the page. */
const INK = ["#7cd6ff", "#ffc85a", "#78ffaa"];

/** A duration as the time axis writes it. */
function ago(s: number) {
  const a = Math.abs(s);
  if (a < 120) return `−${a.toFixed(0)} s`;
  if (a < 7200) return `−${(a / 60).toFixed(a < 600 ? 1 : 0)} min`;
  if (a < 172800) return `−${(a / 3600).toFixed(1)} h`;
  return `−${(a / 86400).toFixed(1)} d`;
}

/** A value as a curve's labels write it. */
function fmt(v: number, unit: string) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const n = a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return unit ? `${Number(n).toLocaleString("en")} ${unit}` : Number(n).toLocaleString("en");
}

export class TelemetryPage {
  readonly el = h("div", { class: "tm-page", "data-testid": "telemetry-page" });
  private cv = h("canvas", { class: "tm-cv" }) as HTMLCanvasElement;
  private chosen: RecKey[];
  private win: number;
  private chips = new Map<RecKey, HTMLButtonElement>();
  private wins = new Map<number, HTMLButtonElement>();
  private drawnAt = -1e9;

  constructor() {
    const saved = (store.get("kerr.telemetry.ch") ?? "alt,speed,g").split(",").filter((k) => CHANNELS.some((c) => c.key === k));
    this.chosen = (saved.length ? saved : ["alt", "speed", "g"]) as RecKey[];
    this.win = Number(store.get("kerr.telemetry.win") ?? "600") || 600;
    const chipRow = el("div", "tm-chips");
    for (const c of CHANNELS) {
      const b = button({ label: tr(NAMES[c.key]), testid: `telemetry-${c.key}` });
      b.addEventListener("click", () => this.toggle(c.key));
      this.chips.set(c.key, b);
      chipRow.append(b);
    }
    const winRow = el("div", "tm-wins");
    for (const [s, label] of WINDOWS) {
      const b = button({ label: s === Number.POSITIVE_INFINITY ? tr({ fr: "Tout", en: "All" }) : label });
      b.addEventListener("click", () => {
        this.win = s;
        store.set("kerr.telemetry.win", String(s));
        this.sync();
      });
      this.wins.set(s, b);
      winRow.append(b);
    }
    const csv = button({ label: tr({ fr: "Exporter CSV", en: "Export CSV" }), testid: "telemetry-csv" });
    csv.addEventListener("click", () => this.download());
    winRow.append(csv);
    this.el.append(chipRow, winRow, this.cv);
    this.sync();
  }

  /** A curve chosen or let go: three at most (the oldest chosen let go for a fourth). */
  private toggle(k: RecKey) {
    if (this.chosen.includes(k)) this.chosen = this.chosen.filter((x) => x !== k);
    else this.chosen = [...this.chosen, k].slice(-3);
    store.set("kerr.telemetry.ch", this.chosen.join(","));
    this.sync();
  }

  private sync() {
    for (const [k, b] of this.chips) {
      const i = this.chosen.indexOf(k);
      b.classList.toggle("on", i >= 0);
      b.style.setProperty("--tm-ink", i >= 0 ? INK[i]! : "transparent");
    }
    for (const [s, b] of this.wins) b.classList.toggle("on", s === this.win);
    this.drawnAt = -1e9;
    this.draw(performance.now());
  }

  /** The record as a file. */
  private download() {
    const blob = new Blob([recorder.csv()], { type: "text/csv" });
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    a.href = URL.createObjectURL(blob);
    a.download = `kerr-telemetry-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /** The curves, a few times a second while shown. */
  draw(now: number) {
    if (now - this.drawnAt < 250) return;
    this.drawnAt = now;
    const cv = this.cv;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(cv.clientWidth, 200),
      H = Math.max(cv.clientHeight, 120);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const S = recorder.window(this.win);
    g.font = "500 11px Inter, system-ui, sans-serif";
    g.textBaseline = "middle";
    if (S.length < 2 || !this.chosen.length) {
      g.fillStyle = "rgba(205, 220, 240, 0.7)";
      g.textAlign = "center";
      g.fillText(
        this.chosen.length
          ? tr({ fr: "Le vol s'enregistre — piloter un engin", en: "The flight records — fly a craft" })
          : tr({ fr: "Choisir une courbe", en: "Choose a curve" }),
        W / 2,
        H / 2,
      );
      return;
    }
    // (a record shorter than the window: the curves across the whole width, from its start)
    const t1 = S[S.length - 1]!.t,
      t0 = Number.isFinite(this.win) ? Math.max(t1 - this.win, S[0]!.t) : S[0]!.t;
    const axisH = 16,
      gap = 6;
    const n = this.chosen.length;
    const bandH = (H - axisH - gap * (n - 1)) / n;
    const x0 = 4,
      x1 = W - 4;
    const sx = (t: number) => x0 + ((t - t0) / Math.max(t1 - t0, 1e-9)) * (x1 - x0);
    this.chosen.forEach((k, i) => {
      const ch = CHANNELS.find((c) => c.key === k)!;
      const val = (s: RecSample) => {
        const v = s[k];
        return v === null || !Number.isFinite(v as number) ? Number.NaN : (v as number) * ch.k;
      };
      const vs = S.map(val).filter(Number.isFinite);
      const y0 = i * (bandH + gap);
      g.fillStyle = "rgba(160, 210, 255, 0.05)";
      g.fillRect(x0, y0, x1 - x0, bandH);
      if (!vs.length) return;
      let lo = Math.min(...vs),
        hi = Math.max(...vs);
      if (hi - lo < 1e-9) (lo -= 1), (hi += 1);
      const pad = (hi - lo) * 0.08;
      lo -= pad;
      hi += pad;
      const sy = (v: number) => y0 + bandH - ((v - lo) / (hi - lo)) * bandH;
      g.strokeStyle = INK[i]!;
      g.lineWidth = 1.6;
      g.beginPath();
      let on = false;
      for (const s of S) {
        const v = val(s);
        if (!Number.isFinite(v)) {
          on = false;
          continue;
        }
        if (on) g.lineTo(sx(s.t), sy(v));
        else g.moveTo(sx(s.t), sy(v));
        on = true;
      }
      g.stroke();
      // (its name and last value, top left; its most and least, right — each on a dark backing: the curve
      // runs under them)
      const label = (txt: string, x: number, y: number, align: "left" | "right", col: string) => {
        const w = g.measureText(txt).width;
        g.fillStyle = "rgba(4, 8, 14, 0.78)";
        g.fillRect(align === "left" ? x - 3 : x - w - 3, y - 7, w + 6, 14);
        g.fillStyle = col;
        g.textAlign = align;
        g.fillText(txt, x, y);
      };
      const last = val(S[S.length - 1]!);
      label(`${tr(NAMES[k])} · ${fmt(last, ch.unit)}`, x0 + 6, y0 + 9, "left", INK[i]!);
      label(fmt(Math.max(...vs), ch.unit), x1 - 4, y0 + 9, "right", "rgba(205, 220, 240, 0.7)");
      label(fmt(Math.min(...vs), ch.unit), x1 - 4, y0 + bandH - 8, "right", "rgba(205, 220, 240, 0.7)");
    });
    // the time axis: from the window's start to now
    g.fillStyle = "rgba(205, 220, 240, 0.6)";
    g.textAlign = "left";
    g.fillText(ago(t1 - t0), x0, H - axisH / 2);
    g.textAlign = "center";
    g.fillText(ago((t1 - t0) / 2), (x0 + x1) / 2, H - axisH / 2);
    g.textAlign = "right";
    g.fillText(tr({ fr: "maintenant", en: "now" }), x1, H - axisH / 2);
  }
}
