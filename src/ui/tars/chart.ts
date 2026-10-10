// The curves TARS shows (PLAN-TARS-AGENT A8): one or more series, each in its own lane on a shared x axis
// — the flight's recorded figures against time, or any figures he works out (a Δv budget against the
// date, a descent profile) —: a soft area under each line, the line lit, its last value at its end, its
// least and its most; the axis written once, at the bottom. Canvas, drawn at the device's resolution.

export interface Series {
  label: string;
  unit?: string;
  /** [x, y] in order of x */
  points: [number, number][];
  color?: string;
}

export const INKS = ["#7cd6ff", "#ffc85a", "#78ffaa", "#ff8fb3", "#c6a6ff"];

/** A value as the chart writes it. */
export function fmtValue(v: number, unit = "") {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const n =
    a >= 1e6
      ? v.toExponential(2)
      : a >= 100
        ? Math.round(v).toLocaleString("en")
        : a >= 10
          ? v.toFixed(1)
          : a >= 1
            ? v.toFixed(2)
            : v.toPrecision(2);
  return unit ? `${n} ${unit}` : n;
}

/** The x axis's words: a time ago ("−4 min") when `time`, else the value. */
export function fmtX(x: number, time: boolean, unit = "") {
  if (!time) return fmtValue(x, unit);
  const a = Math.abs(x);
  const s = x < 0 ? "−" : "+";
  if (a < 120) return `${s}${a.toFixed(0)} s`;
  if (a < 7200) return `${s}${(a / 60).toFixed(a < 600 ? 1 : 0)} min`;
  if (a < 172800) return `${s}${(a / 3600).toFixed(1)} h`;
  return `${s}${(a / 86400).toFixed(1)} d`;
}

export function drawChart(
  cv: HTMLCanvasElement,
  series: Series[],
  o: {
    time?: boolean;
    xUnit?: string;
    xLabel?: string;
    overlay?: boolean;
    band?: [number, number];
    now?: [number, number] | null;
    yUnit?: string;
  } = {},
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(cv.clientWidth, 200),
    H = Math.max(cv.clientHeight, 100);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const shown = series.filter((s) => s.points.length);
  g.font = "600 10.5px 'JetBrains Mono', ui-monospace, monospace";
  g.textBaseline = "middle";
  if (!shown.length || shown.every((s) => s.points.length < 2)) {
    g.fillStyle = "rgba(205, 220, 240, 0.6)";
    g.textAlign = "center";
    g.fillText("—", W / 2, H / 2);
    return;
  }
  let x0 = Infinity,
    x1 = -Infinity;
  for (const s of shown)
    for (const [x] of s.points) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  if (x1 <= x0) x1 = x0 + 1;
  const L = 8,
    R = 74,
    T = 4,
    B = 18;
  if (o.overlay) return drawOverlay(g, W, H, shown, x0, x1, { L, R, T, B }, o);
  const lane = (H - T - B) / shown.length;
  const X = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  shown.forEach((s, i) => {
    const ink = s.color ?? INKS[i % INKS.length]!;
    const top = T + i * lane + 6,
      bot = T + (i + 1) * lane - 4;
    let lo = Infinity,
      hi = -Infinity;
    for (const [, y] of s.points)
      if (Number.isFinite(y)) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    if (!Number.isFinite(lo)) return;
    if (hi - lo < 1e-9 * Math.max(1, Math.abs(hi))) {
      hi += 0.5 * Math.max(1e-6, Math.abs(hi) * 0.05);
      lo -= 0.5 * Math.max(1e-6, Math.abs(lo) * 0.05);
    }
    const Y = (y: number) => bot - ((y - lo) / (hi - lo)) * (bot - top);
    // (the lane: its guides)
    g.strokeStyle = "rgba(160, 210, 255, 0.07)";
    g.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = Math.round(top + f * (bot - top)) + 0.5;
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(W - R + 4, y);
      g.stroke();
    }
    // (the area, then the line, lit)
    const path = new Path2D();
    let first = true;
    for (const [x, y] of s.points) {
      if (!Number.isFinite(y)) continue;
      if (first) path.moveTo(X(x), Y(y));
      else path.lineTo(X(x), Y(y));
      first = false;
    }
    const area = new Path2D(path);
    const pts = s.points.filter(([, y]) => Number.isFinite(y));
    area.lineTo(X(pts.at(-1)![0]), bot);
    area.lineTo(X(pts[0]![0]), bot);
    area.closePath();
    const grad = g.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, `${ink}33`);
    grad.addColorStop(1, `${ink}00`);
    g.fillStyle = grad;
    g.fill(area);
    g.save();
    g.shadowColor = ink;
    g.shadowBlur = 6;
    g.strokeStyle = ink;
    g.lineWidth = 1.6;
    g.lineJoin = "round";
    g.stroke(path);
    g.restore();
    // (its end: a dot and the value)
    const [lx, ly] = pts.at(-1)!;
    g.fillStyle = ink;
    g.beginPath();
    g.arc(X(lx), Y(ly), 2.6, 0, Math.PI * 2);
    g.fill();
    g.textAlign = "left";
    g.fillStyle = "#eef3fb";
    g.fillText(fmtValue(ly, s.unit), W - R + 8, Math.min(Math.max(Y(ly), top + 6), bot - 6));
    g.fillStyle = "rgba(190, 205, 225, 0.55)";
    g.font = "500 9.5px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(`↑ ${fmtValue(hi)}`, W - R + 8, top + 2);
    g.fillText(`↓ ${fmtValue(lo)}`, W - R + 8, bot - 2);
    // (its name)
    g.font = "700 9.5px 'JetBrains Mono', ui-monospace, monospace";
    g.fillStyle = ink;
    g.fillText(s.label.toUpperCase(), L + 2, top + 4);
    g.font = "600 10.5px 'JetBrains Mono', ui-monospace, monospace";
  });
  // (the x axis, once)
  g.fillStyle = "rgba(190, 205, 225, 0.6)";
  g.font = "500 9.5px 'JetBrains Mono', ui-monospace, monospace";
  g.textAlign = "left";
  g.fillText(fmtX(x0, !!o.time, o.xUnit), L, H - 7);
  g.textAlign = "right";
  g.fillText(o.time ? "0" : fmtX(x1, false, o.xUnit), W - R, H - 7);
  if (o.xLabel) {
    g.textAlign = "center";
    g.fillText(o.xLabel, (L + W - R) / 2, H - 7);
  }
}

/** All the series on one frame and one scale (a corridor: its edges, the optimum, what was flown, where the
 *  craft is now); `band` the series indexes of the corridor's edges, filled between. */
function drawOverlay(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  shown: Series[],
  x0: number,
  x1: number,
  m: { L: number; R: number; T: number; B: number },
  o: { time?: boolean; xUnit?: string; xLabel?: string; band?: [number, number]; now?: [number, number] | null; yUnit?: string },
) {
  let lo = Infinity,
    hi = -Infinity;
  for (const s of shown)
    for (const [, y] of s.points)
      if (Number.isFinite(y)) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
  if (o.now) {
    lo = Math.min(lo, o.now[1]);
    hi = Math.max(hi, o.now[1]);
  }
  if (!(hi > lo)) hi = lo + 1;
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const top = m.T + 14,
    bot = H - m.B - 4;
  const X = (x: number) => m.L + ((x - x0) / (x1 - x0)) * (W - m.L - m.R);
  const Y = (y: number) => bot - ((y - lo) / (hi - lo)) * (bot - top);
  g.strokeStyle = "rgba(160, 210, 255, 0.07)";
  g.lineWidth = 1;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(top + f * (bot - top)) + 0.5;
    g.beginPath();
    g.moveTo(m.L, y);
    g.lineTo(W - m.R + 4, y);
    g.stroke();
  }
  // (the corridor: filled between its edges)
  if (o.band) {
    const a = shown[o.band[0]],
      b = shown[o.band[1]];
    if (a?.points.length && b?.points.length) {
      g.beginPath();
      a.points.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      for (let i = b.points.length - 1; i >= 0; i--) g.lineTo(X(b.points[i]![0]), Y(b.points[i]![1]));
      g.closePath();
      g.fillStyle = "rgba(120, 255, 170, 0.08)";
      g.fill();
    }
  }
  shown.forEach((s, i) => {
    const ink = s.color ?? INKS[i % INKS.length]!;
    g.save();
    g.strokeStyle = ink;
    g.lineWidth = o.band && (i === o.band[0] || i === o.band[1]) ? 1 : 1.7;
    if (o.band && (i === o.band[0] || i === o.band[1])) g.setLineDash([4, 3]);
    else {
      g.shadowColor = ink;
      g.shadowBlur = 5;
    }
    g.beginPath();
    let first = true;
    for (const [x, y] of s.points) {
      if (!Number.isFinite(y)) continue;
      if (first) g.moveTo(X(x), Y(y));
      else g.lineTo(X(x), Y(y));
      first = false;
    }
    g.stroke();
    g.restore();
  });
  // (the craft now: a ringed dot)
  if (o.now) {
    const [nx, ny] = o.now;
    g.strokeStyle = "#fff";
    g.fillStyle = "#ffcf5a";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(X(Math.min(Math.max(nx, x0), x1)), Y(ny), 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // (the legend, top left; the scale, right)
  g.font = "700 9.5px 'JetBrains Mono', ui-monospace, monospace";
  g.textBaseline = "middle";
  g.textAlign = "left";
  let lx = m.L + 2;
  for (const [i, s] of shown.entries()) {
    g.fillStyle = s.color ?? INKS[i % INKS.length]!;
    const w = g.measureText(s.label.toUpperCase()).width;
    g.fillText(s.label.toUpperCase(), lx, m.T + 5);
    lx += w + 12;
  }
  g.font = "500 9.5px 'JetBrains Mono', ui-monospace, monospace";
  g.fillStyle = "rgba(190, 205, 225, 0.6)";
  g.fillText(`↑ ${fmtValue(hi, o.yUnit)}`, W - m.R + 8, top + 2);
  g.fillText(`↓ ${fmtValue(lo, o.yUnit)}`, W - m.R + 8, bot - 2);
  g.fillText(fmtX(x0, !!o.time, o.xUnit), m.L, H - 7);
  g.textAlign = "right";
  g.fillText(o.time ? "0" : fmtX(x1, false, o.xUnit), W - m.R, H - 7);
  if (o.xLabel) {
    g.textAlign = "center";
    g.fillText(o.xLabel, (m.L + W - m.R) / 2, H - 7);
  }
}
