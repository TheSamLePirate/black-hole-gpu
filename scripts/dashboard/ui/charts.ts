// The dashboard's charts: a flight's Chart (tests/flight/lib/charts.ts buildCharts — series, a corridor band,
// phase marks, verdict points) drawn as inline SVG, one measure per chart. Every chart of a time axis is linked
// to the others: hovering shows a crosshair and each series' value there on all of them; dragging across one
// zooms them all to that span, a double click goes back. The legend says each series' min, max and last value
// in the span shown. And the timeline: what the craft was doing (autopilot, hold, the hub's card, the entry…)
// as bands on the same axis.
import type { Chart, Pt } from "../../../tests/flight/lib/charts";

const W = 640,
  H = 240,
  L = 58,
  R = 14,
  T = 14,
  B = 34;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function nice(lo: number, hi: number, n = 5) {
  if (!(hi > lo)) [lo, hi] = [lo - 1, hi + 1];
  const step0 = (hi - lo) / n;
  const p = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= step0) ?? 10 * p;
  const a = Math.floor(lo / step) * step,
    b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { a, b, ticks };
}

export const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6 || a < 1e-3) return v.toExponential(2);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

// ------------------------------------------------------------------------------------------- zoom & links

/** The span each time axis is zoomed to (its label: "simulated time [s]"…); none: the whole flight. */
const zooms = new Map<string, [number, number]>();
let onZoom: (() => void) | null = null;
/** Told when a zoom changes (the page repaints its charts). */
export function setZoomListener(fn: () => void) {
  onZoom = fn;
}
export const zoomOf = (axis: string) => zooms.get(axis) ?? null;
export function setZoom(axis: string, span: [number, number] | null) {
  if (span) zooms.set(axis, span);
  else zooms.delete(axis);
  onZoom?.();
}
export const clearZooms = () => zooms.clear();

// (charts sharing a time axis: the hovered x shown on all of them)
const linked = new Set<{ axis: string; el: Element; show(x: number | null): void }>();
function link(me: { axis: string; el: Element; show(x: number | null): void }, x: number | null) {
  for (const o of linked) {
    if (!o.el.isConnected) linked.delete(o);
    else if (o !== me && o.axis === me.axis) o.show(x);
  }
}

/** A brush on an SVG (x only): its drag zooms `axis` to the span; a double click lets go. */
function brush(svg: SVGSVGElement, axis: string, toX: (e: PointerEvent) => number, pxOf: (e: PointerEvent) => number) {
  let x0: number | null = null,
    p0 = 0;
  const rect = svg.querySelector<SVGRectElement>(".brush")!;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    x0 = toX(e);
    p0 = pxOf(e);
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    const p = pxOf(e);
    rect.setAttribute("x", String(Math.min(p, p0)));
    rect.setAttribute("width", String(Math.abs(p - p0)));
  });
  svg.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const x1 = toX(e);
    const from = x0;
    x0 = null;
    rect.setAttribute("width", "0");
    if (Math.abs(pxOf(e) - p0) > 8) setZoom(axis, [Math.min(from, x1), Math.max(from, x1)]);
  });
  svg.addEventListener("dblclick", () => setZoom(axis, null));
}

// ------------------------------------------------------------------------------------------- a chart

let clipN = 0;

/** One chart as an element: its title, legend (with each series' min, max, last), SVG, hover, zoom. */
export function chartEl(c: Chart, o: { big?: boolean; onZoom?: (c: Chart) => void } = {}): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = `vchart${o.big ? " big" : ""}`;
  const timed = !c.states?.length && !c.flipX && /time/.test(c.xLabel);
  const span = timed ? zoomOf(c.xLabel) : null;
  const finite = ([x, y]: Pt) => Number.isFinite(x) && Number.isFinite(y) && (!c.logY || y > 0);
  const inSpan = (pts: Pt[]) => {
    if (!span) return pts;
    // (one point past each end kept: the line reaches the edges)
    let i0 = pts.findIndex((p) => p[0] >= span[0]);
    if (i0 < 0) return [];
    i0 = Math.max(0, i0 - 1);
    let i1 = i0;
    for (let i = pts.length - 1; i >= 0; i--)
      if (pts[i]![0] <= span[1]) {
        i1 = Math.min(pts.length - 1, i + 1);
        break;
      }
    return pts.slice(i0, i1 + 1);
  };
  const series = c.series.map((s) => ({ ...s, pts: inSpan(s.pts) }));
  const band = c.band ? { lo: inSpan(c.band.lo), hi: inSpan(c.band.hi) } : null;
  const all = [
    ...series.flatMap((s) => s.pts),
    ...(band ? [...band.lo, ...band.hi] : []),
    ...(c.states ?? []).map((p) => [p.x, p.y] as Pt),
  ].filter(finite);
  fig.dataset.key = `${c.title}|${span ? span.join(",") : ""}|${c.series.map((s) => `${s.name}:${s.pts.length}`).join(",")}`;
  if (!all.length) return fig;
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => (c.logY ? Math.log10(p[1]) : p[1]));
  const X0 = nice(span ? span[0] : Math.min(...xs), span ? span[1] : Math.max(...xs));
  const X = span ? { a: span[0], b: span[1], ticks: X0.ticks.filter((t) => t >= span[0] && t <= span[1]) } : X0;
  const Y = nice(Math.min(...ys), Math.max(...ys), 4);
  const px = (x: number) => {
    const u = (x - X.a) / (X.b - X.a);
    return L + (c.flipX ? 1 - u : u) * (W - L - R);
  };
  const py = (y: number) => T + (1 - ((c.logY ? Math.log10(Math.max(y, 1e-12)) : y) - Y.a) / (Y.b - Y.a)) * (H - T - B);
  // (a gap — a NaN — lifts the pen: a track across the antimeridian, a series that pauses)
  const path = (pts: Pt[]) => {
    let d = "",
      pen = false;
    for (const p of pts) {
      if (!finite(p)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const clipId = `vclip${++clipN}`;
  let g = `<clipPath id="${clipId}"><rect x="${L}" y="${T - 2}" width="${W - L - R}" height="${H - T - B + 4}"/></clipPath>`;
  for (const t of Y.ticks) {
    const y = py(c.logY ? 10 ** t : t);
    g += `<line class="g" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="tk" x="${L - 7}" y="${y + 4}" text-anchor="end">${c.logY ? `1e${t}` : fmt(t)}</text>`;
  }
  for (const t of X.ticks) g += `<text class="tk" x="${px(t)}" y="${H - B + 17}" text-anchor="middle">${fmt(t)}</text>`;
  g += `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  g += `<text class="axl" x="${W - R}" y="${H - 3}" text-anchor="end">${esc(c.xLabel)}${span ? " · zoomed — double-click: all" : ""}</text>`;
  g += `<g clip-path="url(#${clipId})">`;
  if (band) {
    const poly = [...band.lo, ...[...band.hi].reverse()].filter(finite);
    g += `<path class="band" d="${path(poly)}Z"/>`;
  }
  for (const m of c.marks ?? [])
    if (m.x >= X.a && m.x <= X.b)
      g += `<line class="mk" x1="${px(m.x)}" x2="${px(m.x)}" y1="${T}" y2="${H - B}"><title>${esc(m.label)}</title></line>`;
  for (const s of series) {
    g += `<path class="ln s${s.slot ?? 1}${s.dash ? " dash" : ""}" d="${path(s.pts)}"/>`;
    if (s.dots)
      for (const [x, y] of s.pts.filter(finite))
        g += `<circle class="dt s${s.slot ?? 1}" cx="${px(x).toFixed(1)}" cy="${py(y).toFixed(1)}" r="3"/>`;
  }
  for (const p of c.states ?? [])
    if (finite([p.x, p.y]))
      g += `<circle class="st ${p.s}" cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5"><title>${esc(p.s)}</title></circle>`;
  g += "</g>";
  // (the legend: each series, its range and last value in the span shown)
  const stat = (pts: Pt[]) => {
    const v = pts.filter(finite).map((p) => p[1]);
    return v.length ? ` <small>${fmt(Math.min(...v))} … ${fmt(Math.max(...v))} · last ${fmt(v[v.length - 1]!)}</small>` : "";
  };
  const legend = `<div class="lg">${band ? `<span><i class="sw band"></i>corridor</span>` : ""}${series
    .map((s) => `<span><i class="sw s${s.slot ?? 1}${s.dash ? " dash" : ""}"></i>${esc(s.name)}${stat(s.pts)}</span>`)
    .join("")}${c.states?.length ? `<span><i class="sw on"></i>in the corridor</span><span><i class="sw off"></i>out</span>` : ""}</div>`;
  fig.innerHTML = `<figcaption><b>${esc(c.title)}</b> <small>${esc(c.unit)}</small>${o.onZoom ? `<button class="zoom" title="Larger">⤢</button>` : ""}</figcaption>${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">${g}<rect class="brush" y="${T}" height="${H - T - B}" x="0" width="0"/><line class="xh" y1="${T}" y2="${H - B}" x1="-9" x2="-9"/></svg><div class="tip" hidden></div>`;
  if (o.onZoom) fig.querySelector<HTMLButtonElement>(".zoom")!.onclick = () => o.onZoom!(c);
  const svg = fig.querySelector("svg")!,
    tip = fig.querySelector<HTMLElement>(".tip")!,
    xh = svg.querySelector(".xh")!;
  const data = series.map((s) => ({ n: s.name, k: s.slot ?? 1, p: s.pts.filter(finite) }));
  const show = (x: number | null, e?: PointerEvent): void => {
    if (x === null) {
      tip.hidden = true;
      xh.setAttribute("x1", "-9");
      xh.setAttribute("x2", "-9");
      return;
    }
    const rows: string[] = [];
    let at: number | null = null;
    for (const d of data) {
      let best: Pt | null = null;
      for (const p of d.p) if (!best || Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      if (best) {
        at ??= best[0];
        rows.push(`<span class="k s${d.k}">●</span> ${esc(d.n)} <b>${fmt(best[1])}</b>`);
      }
    }
    if (at === null || at < Math.min(X.a, X.b) || at > Math.max(X.a, X.b)) {
      show(null);
      return;
    }
    const X0p = px(at);
    xh.setAttribute("x1", String(X0p));
    xh.setAttribute("x2", String(X0p));
    tip.innerHTML = `<div class="tx">${fmt(at)} · ${esc(c.xLabel)}</div>${rows.join("<br>")}`;
    tip.hidden = false;
    const b = svg.getBoundingClientRect(),
      fb = fig.getBoundingClientRect();
    const left = e ? e.clientX - fb.left + 14 : (X0p / W) * b.width + (b.left - fb.left) + 14;
    tip.style.left = `${Math.max(4, Math.min(left, fb.width - tip.offsetWidth - 6))}px`;
    tip.style.top = `${e ? e.clientY - fb.top + 14 : 40}px`;
  };
  const me = { axis: c.xLabel, el: fig as Element, show: (x: number | null) => show(x) };
  if (timed) linked.add(me);
  const pxOf = (e: PointerEvent) => {
    const b = svg.getBoundingClientRect();
    return ((e.clientX - b.left) / b.width) * W;
  };
  const toX = (e: PointerEvent) => {
    const u = (pxOf(e) - L) / (W - L - R);
    return X.a + (c.flipX ? 1 - u : u) * (X.b - X.a);
  };
  svg.addEventListener("pointermove", (e) => {
    const x = toX(e);
    show(x, e);
    if (timed) link(me, x);
  });
  svg.addEventListener("pointerleave", () => {
    show(null);
    if (timed) link(me, null);
  });
  if (timed) brush(svg, c.xLabel, toX, pxOf);
  return fig;
}

// ------------------------------------------------------------------------------------------- the timeline

export interface Timeline {
  xLabel: string;
  x1: number;
  rows: { key: string; segs: { x0: number; x1: number; v: string }[] }[];
}

// (a value's own colour, the same everywhere: "entry" always the same hue)
const hue = (v: string) => {
  let h = 7;
  for (const ch of v) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

/** What the craft did, row by row, on the flight's time axis — hover linked, a drag zooms every chart. */
export function timelineEl(tl: Timeline): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = "vchart vtimeline";
  const span = zoomOf(tl.xLabel);
  const a = span ? span[0] : 0,
    b = span ? span[1] : Math.max(tl.x1, 1e-9);
  const LW = 92,
    RH = 22,
    TW = 1000,
    Hh = tl.rows.length * RH + 26;
  fig.dataset.key = `timeline|${span ? span.join(",") : ""}|${tl.rows.length}`;
  const px = (x: number) => LW + ((x - a) / (b - a)) * (TW - LW - 10);
  let g = "";
  tl.rows.forEach((r, i) => {
    const y = i * RH + 4;
    g += `<text class="tlk" x="${LW - 8}" y="${y + RH / 2 + 3}" text-anchor="end">${esc(r.key)}</text>`;
    for (const sg of r.segs) {
      if (sg.x1 < a || sg.x0 > b) continue;
      const x0 = Math.max(px(sg.x0), LW),
        x1 = Math.min(px(sg.x1), TW - 10);
      const w = Math.max(1.5, x1 - x0);
      g += `<g><rect class="seg" x="${x0.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${RH - 5}" rx="3" style="--h:${hue(sg.v)}"><title>${esc(r.key)}: ${esc(sg.v)} · ${fmt(sg.x0)} → ${fmt(sg.x1)}</title></rect>${w > 6.5 * sg.v.length + 12 ? `<text class="segt" x="${(x0 + 6).toFixed(1)}" y="${y + RH / 2 + 2}">${esc(sg.v)}</text>` : ""}</g>`;
    }
  });
  for (const t of nice(a, b, 8).ticks.filter((t) => t >= a && t <= b))
    g += `<text class="tk" x="${px(t)}" y="${Hh - 6}" text-anchor="middle">${fmt(t)}</text>`;
  fig.innerHTML = `<figcaption><b>Timeline</b> <small>${esc(tl.xLabel)}${span ? " · zoomed — double-click: all" : " · drag across to zoom every chart"}</small></figcaption><svg viewBox="0 0 ${TW} ${Hh}" role="img" aria-label="timeline">${g}<rect class="brush" y="0" height="${Hh - 18}" x="0" width="0"/><line class="xh" y1="0" y2="${Hh - 18}" x1="-9" x2="-9"/></svg>`;
  const svg = fig.querySelector("svg")!,
    xh = svg.querySelector(".xh")!;
  const pxOf = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * TW;
  };
  const toX = (e: PointerEvent) => a + ((pxOf(e) - LW) / (TW - LW - 10)) * (b - a);
  const me = {
    axis: tl.xLabel,
    el: fig as Element,
    show: (x: number | null) => {
      const p = x === null || x < a || x > b ? -9 : px(x);
      xh.setAttribute("x1", String(p));
      xh.setAttribute("x2", String(p));
    },
  };
  linked.add(me);
  svg.addEventListener("pointermove", (e) => {
    const x = toX(e);
    me.show(x);
    link(me, x);
  });
  svg.addEventListener("pointerleave", () => {
    me.show(null);
    link(me, null);
  });
  brush(svg, tl.xLabel, toX, pxOf);
  return fig;
}
