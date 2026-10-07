// The assistants' graphs (PLAN-ASSISTANT C1–C6): one figure against another — Δv left against time, the
// height against the distance —, the optimum's line and the corridor about it, what was flown, where the
// craft is now. The data are the hub's (controller/lowthrust.ts hubCompute); drawn by the HUD's panel
// beside the hub's card and by the cockpit's PLAN screen, each with its own palette.

/** An assistant's graph, in its own units (the axes'). */
export interface AssistGraph {
  /** what it plots: the e2e's handle, the cockpit's choice */
  kind: "burn" | "climb" | "entry" | "glide" | "descent" | "approach" | "dock";
  title: string;
  x: GraphAxis;
  y: GraphAxis;
  /** the optimum, a polyline */
  ideal: [number, number][];
  /** the corridor about it: its two edges (polylines; the area between them filled) */
  lo: [number, number][] | null;
  hi: [number, number][] | null;
  /** what was flown, and the craft now (clamped to the frame: an arrow on its edge) */
  flown: [number, number][];
  now: [number, number] | null;
  /** vertical marks on the time (the ignition, the cutoff) */
  marks: { x: number; label: string }[];
  /** horizontal levels (the height asked, the apoapsis) */
  levels?: { y: number; label: string }[];
  /** the verdict: in the corridor, out of it, not yet in it */
  state: "on" | "off" | "wait";
  /** what the graph shows (its title's tooltip), and — out of the corridor — what to do */
  about?: string;
  fix?: string;
}

export interface GraphAxis {
  label: string;
  /** "s", "m/s", "m", "km": the ticks' format */
  unit: "s" | "m/s" | "km/s" | "m" | "km";
  min: number;
  max: number;
}

export interface GraphPalette {
  bg: string | null;
  grid: string;
  text: string;
  dim: string;
  ideal: string;
  corridor: string;
  flown: string;
  on: string;
  off: string;
  wait: string;
  font: string;
}

/** A tick's value as the axis writes it (short: the graph is small). */
export function fmtAxis(v: number, unit: GraphAxis["unit"]): string {
  const a = Math.abs(v);
  if (unit === "s") {
    const sg = v < 0 ? "−" : v > 0 ? "+" : "";
    if (a < 120) return `${sg}${a.toFixed(0)} s`;
    if (a < 7200) return `${sg}${(a / 60).toFixed(a < 600 ? 1 : 0)} min`;
    if (a < 172800) return `${sg}${(a / 3600).toFixed(1)} h`;
    return `${sg}${(a / 86400).toFixed(1)} d`;
  }
  if (unit === "m/s") return a >= 1e4 ? `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)} km/s` : `${v.toFixed(a < 10 ? 1 : 0)} m/s`;
  if (unit === "km/s") return `${v.toFixed(a < 10 ? 1 : 0)} km/s`;
  if (unit === "m") return a >= 1e4 ? `${(v / 1e3).toFixed(0)} km` : `${v.toFixed(0)} m`;
  return `${v.toFixed(a < 10 ? 1 : 0)} km`;
}

/** A tick's step for a span: 1, 2, 5 × 10ⁿ, about `n` of them. */
function step(span: number, n: number) {
  const raw = Math.abs(span) / n;
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-12)));
  const m = raw / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

/** The large graph's extras (the hub's graph opened in its own panel): the legend, the axes' names, the
 *  reading under the pointer (the context's pixels). */
export interface GraphExtras {
  legend?: { ideal: string; corridor: string; flown: string; now: string };
  names?: boolean;
  hover?: { x: number; y: number } | null;
  /** the reading's words: the optimum, the corridor */
  words?: { ideal: string; corridor: string };
}

/**
 * Draws the graph into the box (x, y, w, h in the context's pixels; `k` the text's scale): the corridor
 * filled, the optimum dashed, the flight's trace, the craft's dot — a halo about it (an arrow on the edge
 * when out of the frame) —, the marks, the axes' ticks; large (`ex`), the legend, the axes' names and the
 * reading under the pointer.
 */
export function drawGraph(
  g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  G: AssistGraph,
  box: { x: number; y: number; w: number; h: number },
  pal: GraphPalette,
  k = 1,
  ex: GraphExtras = {},
) {
  const padL = 44 * k,
    padB = (ex.names ? 30 : 16) * k,
    padT = (ex.names ? 18 : 4) * k,
    padR = 6 * k;
  const X0 = box.x + padL,
    Y0 = box.y + padT,
    W = box.w - padL - padR,
    H = box.h - padT - padB;
  if (W <= 10 || H <= 10) return;
  if (pal.bg) {
    g.fillStyle = pal.bg;
    g.fillRect(box.x, box.y, box.w, box.h);
  }
  const { x: ax, y: ay } = G;
  const sx = (v: number) => X0 + ((v - ax.min) / (ax.max - ax.min || 1)) * W;
  const sy = (v: number) => Y0 + H - ((v - ay.min) / (ay.max - ay.min || 1)) * H;
  // the grid and its ticks
  g.lineWidth = 1 * k;
  g.font = `500 ${9.5 * k}px ${pal.font}`;
  g.textBaseline = "middle";
  // (as many ticks as their labels have room for)
  const dy = step(ay.max - ay.min, Math.max(2, Math.floor(H / (28 * k))));
  g.textAlign = "right";
  for (let v = Math.ceil(ay.min / dy) * dy; v <= ay.max + 1e-9 * dy; v += dy) {
    const py = sy(v);
    g.strokeStyle = pal.grid;
    g.beginPath();
    g.moveTo(X0, py);
    g.lineTo(X0 + W, py);
    g.stroke();
    g.fillStyle = pal.dim;
    g.fillText(fmtAxis(v, ay.unit), X0 - 4 * k, py);
  }
  const dx = step(ax.max - ax.min, Math.max(2, Math.floor(W / (58 * k))));
  g.textAlign = "center";
  g.textBaseline = "top";
  // (a label that would touch the one before it left out — its line kept)
  let lastEnd = -Infinity;
  for (let v = Math.ceil(ax.min / dx) * dx; v <= ax.max + 1e-9 * dx; v += dx) {
    const px = sx(v);
    g.strokeStyle = pal.grid;
    g.beginPath();
    g.moveTo(px, Y0);
    g.lineTo(px, Y0 + H);
    g.stroke();
    const label = fmtAxis(v, ax.unit);
    const w = g.measureText(label).width;
    const lx = Math.min(Math.max(px, X0 + w / 2), X0 + W - w / 2);
    if (lx - w / 2 < lastEnd + 4 * k) continue;
    lastEnd = lx + w / 2;
    g.fillStyle = pal.dim;
    g.fillText(label, lx, Y0 + H + 3 * k);
  }
  g.save();
  g.beginPath();
  g.rect(X0, Y0, W, H);
  g.clip();
  // the corridor
  if (G.lo && G.hi && G.lo.length && G.hi.length) {
    g.fillStyle = pal.corridor;
    g.beginPath();
    G.lo.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
    for (let i = G.hi.length - 1; i >= 0; i--) g.lineTo(sx(G.hi[i]![0]), sy(G.hi[i]![1]));
    g.closePath();
    g.fill();
  }
  // the optimum
  const line = (pts: [number, number][], col: string, w: number, dash: number[]) => {
    if (pts.length < 2) return;
    g.strokeStyle = col;
    g.lineWidth = w * k;
    g.setLineDash(dash.map((d) => d * k));
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
    g.stroke();
    g.setLineDash([]);
  };
  line(G.ideal, pal.ideal, 1.2, [4, 3]);
  // the marks
  g.font = `600 ${9 * k}px ${pal.font}`;
  g.textAlign = "left";
  for (const m of G.marks) {
    const px = sx(m.x);
    g.strokeStyle = pal.dim;
    g.lineWidth = 1 * k;
    g.setLineDash([2 * k, 3 * k]);
    g.beginPath();
    g.moveTo(px, Y0);
    g.lineTo(px, Y0 + H);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = pal.dim;
    g.fillText(m.label, px + 3 * k, Y0 + 2 * k);
  }
  // the levels
  for (const l of G.levels ?? []) {
    const py = sy(l.y);
    if (py < Y0 - 1 || py > Y0 + H + 1) continue;
    g.strokeStyle = pal.wait;
    g.lineWidth = 1 * k;
    g.setLineDash([6 * k, 4 * k]);
    g.beginPath();
    g.moveTo(X0, py);
    g.lineTo(X0 + W, py);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = pal.wait;
    g.textAlign = "right";
    g.fillText(l.label, X0 + W - 3 * k, py - 6 * k);
    g.textAlign = "left";
  }
  // the flight
  const col = G.state === "on" ? pal.on : G.state === "off" ? pal.off : pal.wait;
  line(G.flown, pal.flown, 1.8, []);
  g.restore();
  if (G.now) {
    const [nx, ny] = G.now;
    const px = sx(nx),
      py = sy(ny);
    const cx = Math.min(Math.max(px, X0), X0 + W),
      cy = Math.min(Math.max(py, Y0), Y0 + H);
    // (where it is: dotted to both axes, a halo about the dot — a small dot on a busy plot was lost)
    if (cx === px && cy === py) {
      g.strokeStyle = col;
      g.globalAlpha = 0.45;
      g.lineWidth = 1 * k;
      g.setLineDash([2 * k, 3 * k]);
      g.beginPath();
      g.moveTo(X0, cy);
      g.lineTo(cx, cy);
      g.moveTo(cx, cy);
      g.lineTo(cx, Y0 + H);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(cx, cy, 7.5 * k, 0, 2 * Math.PI);
      g.lineWidth = 2 * k;
      g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = col;
    g.strokeStyle = "rgba(0, 0, 0, 0.6)";
    g.lineWidth = 1.5 * k;
    g.beginPath();
    if (cx !== px || cy !== py) {
      // (out of the frame: an arrow on its edge, towards it)
      const a = Math.atan2(py - cy || 0, px - cx || 0);
      const r = 6 * k;
      g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.lineTo(cx + Math.cos(a + 2.4) * r, cy + Math.sin(a + 2.4) * r);
      g.lineTo(cx + Math.cos(a - 2.4) * r, cy + Math.sin(a - 2.4) * r);
      g.closePath();
    } else g.arc(cx, cy, 3.5 * k, 0, 2 * Math.PI);
    g.stroke();
    g.fill();
  }
  // the frame
  g.strokeStyle = pal.grid;
  g.lineWidth = 1 * k;
  g.strokeRect(X0, Y0, W, H);
  // (large: the axes' names — the y's above its ticks, the x's under its own)
  if (ex.names) {
    g.font = `600 ${9.5 * k}px ${pal.font}`;
    g.fillStyle = pal.text;
    g.textBaseline = "bottom";
    g.textAlign = "left";
    g.fillText(`${ay.label.toUpperCase()} · ${ay.unit}`, box.x + 2 * k, Y0 - 5 * k);
    g.textAlign = "right";
    g.textBaseline = "bottom";
    g.fillText(`${ax.label.toUpperCase()} · ${ax.unit}`, X0 + W, box.y + box.h - 1 * k);
  }
  // (large: the legend, top right inside the frame)
  if (ex.legend) {
    const L = ex.legend;
    const items: [string, (x: number, y: number) => void][] = [
      [
        L.ideal,
        (x, y) => {
          g.strokeStyle = pal.ideal;
          g.lineWidth = 1.2 * k;
          g.setLineDash([4 * k, 3 * k]);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 16 * k, y);
          g.stroke();
          g.setLineDash([]);
        },
      ],
      ...(G.lo && G.hi
        ? ([
            [
              L.corridor,
              (x: number, y: number) => {
                g.fillStyle = pal.corridor;
                g.fillRect(x, y - 4 * k, 16 * k, 8 * k);
              },
            ],
          ] as [string, (x: number, y: number) => void][])
        : []),
      [
        L.flown,
        (x, y) => {
          g.strokeStyle = pal.flown;
          g.lineWidth = 1.8 * k;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 16 * k, y);
          g.stroke();
        },
      ],
      [
        L.now,
        (x, y) => {
          g.fillStyle = col;
          g.beginPath();
          g.arc(x + 8 * k, y, 3.5 * k, 0, 2 * Math.PI);
          g.fill();
        },
      ],
    ];
    g.font = `500 ${9.5 * k}px ${pal.font}`;
    const wMax = Math.max(...items.map(([s]) => g.measureText(s).width)) + 24 * k;
    const lx = X0 + W - wMax - 6 * k,
      ly = Y0 + 6 * k;
    g.fillStyle = "rgba(4, 8, 14, 0.72)";
    g.fillRect(lx - 4 * k, ly - 2 * k, wMax + 8 * k, items.length * 14 * k + 4 * k);
    items.forEach(([s, mark], n) => {
      const y = ly + 7 * k + n * 14 * k;
      mark(lx, y);
      g.fillStyle = pal.text;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(s, lx + 22 * k, y);
    });
  }
  // (large: the reading under the pointer — its abscissa, the optimum and the corridor there)
  const hv = ex.hover;
  if (hv && hv.x >= X0 && hv.x <= X0 + W && hv.y >= Y0 && hv.y <= Y0 + H) {
    const xv = ax.min + ((hv.x - X0) / W) * (ax.max - ax.min);
    g.strokeStyle = pal.text;
    g.globalAlpha = 0.5;
    g.lineWidth = 1 * k;
    g.beginPath();
    g.moveTo(hv.x, Y0);
    g.lineTo(hv.x, Y0 + H);
    g.stroke();
    g.globalAlpha = 1;
    const id = G.ideal.length ? polyAt(G.ideal, xv) : NaN;
    const parts = [`${ax.label} ${fmtAxis(xv, ax.unit)}`];
    if (Number.isFinite(id)) parts.push(`${ex.words?.ideal ?? "optimum"} ${fmtAxis(id, ay.unit)}`);
    if (G.lo && G.hi && G.lo.length && G.hi.length) {
      const a = polyAt(G.lo, xv),
        b = polyAt(G.hi, xv);
      parts.push(`${ex.words?.corridor ?? "corridor"} ${fmtAxis(Math.min(a, b), ay.unit)}–${fmtAxis(Math.max(a, b), ay.unit)}`);
    }
    const txt = parts.join(" · ");
    g.font = `500 ${10 * k}px ${pal.font}`;
    const tw = g.measureText(txt).width;
    const tx = Math.min(Math.max(hv.x - tw / 2, X0 + 2 * k), X0 + W - tw - 2 * k);
    const ty = Y0 + H - 16 * k;
    g.fillStyle = "rgba(4, 8, 14, 0.85)";
    g.fillRect(tx - 4 * k, ty - 8 * k, tw + 8 * k, 16 * k);
    g.fillStyle = pal.text;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(txt, tx, ty);
  }
}

/** A corridor's edge at x: the polyline's value there (held flat beyond its ends). */
export function polyAt(pts: [number, number][], x: number): number {
  if (!pts.length) return NaN;
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!,
      [x1, y1] = pts[i]!;
    if (x <= x1) return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
  }
  return pts[pts.length - 1]![1];
}

/**
 * A burn's graph: the Δv left [m/s] against the time from its node [s] — the optimum the whole Δv until
 * half the burn before the node, then down at full thrust to nothing half the burn after; the corridor
 * that burn started up to `slack` early or late; the trace flown, now.
 */
export function burnGraph(o: {
  title: string;
  dv: number;
  left: number;
  /** the burn's length at full thrust [s] */
  T: number;
  /** now, from the node [s] (negative before it) */
  x: number;
  trace: [number, number][];
  burning: boolean;
  labels: { y: string; x: string; ignition: string; cutoff: string; about?: string; late?: string; early?: string };
}): AssistGraph {
  const T = Number.isFinite(o.T) && o.T > 0 ? o.T : 1;
  const slack = Math.max(0.15 * T, 2);
  const pre = Math.max(0.6 * T, 20),
    post = Math.max(0.3 * T, 8);
  const at = (sh: number): [number, number][] => [
    [-T / 2 - pre - slack, o.dv],
    [-T / 2 + sh, o.dv],
    [T / 2 + sh, 0],
    [T / 2 + post + slack, 0],
  ];
  const ideal = at(0),
    lo = at(-slack),
    hi = at(slack);
  const xMin = Math.min(-T / 2 - pre, o.burning ? o.x - 5 : -T / 2 - pre),
    xMax = Math.max(T / 2 + post, o.x + 3);
  const inside = o.left <= polyAt(hi, o.x) + 1e-9 * o.dv && o.left >= polyAt(lo, o.x) - 1e-9 * o.dv;
  return {
    kind: "burn",
    title: o.title,
    x: { label: o.labels.x, unit: "s", min: xMin, max: xMax },
    y: { label: o.labels.y, unit: "m/s", min: 0, max: o.dv * 1.08 || 1 },
    ideal,
    lo,
    hi,
    flown: o.trace,
    now: [o.x, o.left],
    marks: [
      { x: -T / 2, label: o.labels.ignition },
      { x: T / 2, label: o.labels.cutoff },
    ],
    state: !o.burning && o.x < -T / 2 - slack ? "wait" : inside ? "on" : "off",
    about: o.labels.about,
    fix: o.left > polyAt(hi, o.x) ? o.labels.late : o.labels.early,
  };
}
