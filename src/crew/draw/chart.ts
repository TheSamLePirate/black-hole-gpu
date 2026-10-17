// The telemetry: a measure's curve over the window (its area shaded, its line lit, its minimum, maximum and mean, the
// cursor's reading), or four of them stacked.
import { METRICS, type HistoryPoint } from "../model";
import type { InstrumentKey } from "../../net/instruments";
import { C, clamp, fmt, type Pen, type Rect } from "./kit";

const COLOURS: Partial<Record<InstrumentKey, string>> = {
  alt: C.cyan,
  speed: C.green,
  vz: "#8fb7ff",
  mach: C.amber,
  g: C.magenta,
  fuel: C.green,
  throttle: C.amber,
  q: "#ff8a5c",
  heat: C.red,
  tau: C.cyan,
};
export const MULTI: InstrumentKey[] = ["alt", "speed", "vz", "g"];

export interface ChartOut {
  readout: string;
}

function one(
  p: Pen,
  r: Rect,
  hist: HistoryPoint[],
  key: InstrumentKey,
  start: number,
  end: number,
  inspect: number,
  compact: boolean,
): string {
  const metric = METRICS.find((m) => m.key === key)!;
  const col = COLOURS[key] ?? C.cyan;
  const pts = hist.filter((h) => h.t >= start && h.t <= end && h.metrics[key] !== undefined);
  p.panel(r);
  const pad = compact ? 8 : 12;
  p.text(`${metric.name.toUpperCase()}${metric.unit ? ` · ${metric.unit}` : ""}`, r.x + pad + 4, r.y + 18, {
    col,
    size: compact ? 10 : 11,
    weight: 700,
  });
  if (pts.length < 2) {
    p.text("Les mesures reçues apparaîtront ici", r.x + r.w / 2, r.y + r.h / 2 + 4, { col: C.dim, size: 11, align: "center" });
    return "—";
  }
  const vals = pts.map((h) => h.metrics[key]! * metric.k);
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 1e-3);
  lo -= span * 0.12;
  hi += span * 0.12;
  const g = { x: r.x + (compact ? 48 : 62), y: r.y + 30, w: r.w - (compact ? 60 : 84), h: r.h - (compact ? 46 : 62) };
  const X = (t: number) => g.x + ((t - start) / Math.max(end - start, 1e-6)) * g.w;
  const Y = (v: number) => g.y + ((hi - v) / (hi - lo)) * g.h;
  for (let j = 0; j <= (compact ? 2 : 4); j++) {
    const v = lo + ((hi - lo) * j) / (compact ? 2 : 4);
    p.seg(g.x, Y(v), g.x + g.w, Y(v), C.grid, 1);
    p.text(fmt(v, Math.abs(v) < 10 ? 2 : 0), g.x - 6, Y(v) + 4, { col: C.dim, size: 9, align: "right" });
  }
  if (!compact)
    for (let j = 0; j <= 4; j++)
      p.text(`−${fmt((end - start) * (1 - j / 4))} s`, g.x + (g.w * j) / 4, g.y + g.h + 16, { col: C.dim, size: 9, align: "center" });
  // the area, the line
  const c = p.c;
  const fill = c.createLinearGradient(0, g.y, 0, g.y + g.h);
  fill.addColorStop(0, `${col}44`);
  fill.addColorStop(1, `${col}00`);
  c.beginPath();
  c.moveTo(X(pts[0]!.t), g.y + g.h);
  pts.forEach((h, i) => c.lineTo(X(h.t), Y(vals[i]!)));
  c.lineTo(X(pts.at(-1)!.t), g.y + g.h);
  c.closePath();
  p.fill(fill);
  p.path(pts.map((h, i) => [X(h.t), Y(vals[i]!)]));
  p.glow(col, 1.8, 0.22);
  // the mean
  p.seg(g.x, Y(mean), g.x + g.w, Y(mean), `${col}66`, 1, [4, 5]);
  // the cursor
  const at = start + (end - start) * inspect;
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i]!.t - at) < Math.abs(pts[best]!.t - at)) best = i;
  const x = X(pts[best]!.t),
    y = Y(vals[best]!);
  p.seg(x, g.y, x, g.y + g.h, C.amber, 1, [3, 3]);
  p.circle(x, y, 4.5);
  p.fill(C.amber);
  const readout = `${fmt(vals[best]!, Math.abs(vals[best]!) < 10 ? 2 : 1)} ${metric.unit} · t ${fmt(pts[best]!.t, 1)} s`;
  // the figures
  const last = vals.at(-1)!;
  p.text(fmt(last, Math.abs(last) < 10 ? 2 : 1), r.x + r.w - pad - 4, r.y + (compact ? 20 : 24), {
    col: C.white,
    size: compact ? 15 : 20,
    align: "right",
    weight: 700,
  });
  if (!compact) {
    const stats = `min ${fmt(Math.min(...vals), 1)} · moy ${fmt(mean, 1)} · max ${fmt(Math.max(...vals), 1)}`;
    p.text(stats, r.x + r.w / 2, r.y + 20, { col: C.dim, size: 10, align: "center" });
    p.text(readout, clamp(x, g.x + 90, g.x + g.w - 90), g.y + 14, {
      col: C.amber,
      size: 11,
      align: "center",
      weight: 700,
      bg: "#05090ee0",
    });
  }
  return readout;
}

export function drawChart(
  p: Pen,
  r: Rect,
  hist: HistoryPoint[],
  channel: InstrumentKey | "multi",
  window: number,
  end: number,
  inspect: number,
): ChartOut {
  const start = end - window;
  if (channel !== "multi") return { readout: one(p, r, hist, channel, start, end, inspect, false) };
  const gap = 8,
    h = (r.h - gap * 3) / 4;
  let readout = "";
  MULTI.forEach((k, i) => {
    const out = one(p, { x: r.x, y: r.y + i * (h + gap), w: r.w, h }, hist, k, start, end, inspect, true);
    if (!i) readout = out;
  });
  return { readout };
}
