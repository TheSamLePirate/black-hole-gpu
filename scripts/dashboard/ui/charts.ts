// The dashboard's charts: a flight's Chart (tests/flight/lib/charts.ts buildCharts — series, a corridor band,
// phase marks, verdict points) drawn as inline SVG, one measure per chart; hovering shows a crosshair and
// every series' value there, and the crosshair follows on every other chart of the same time axis.
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

// (charts sharing a time axis: the hovered x shown on all of them)
const linked = new Set<{ axis: string; el: HTMLElement; show(x: number | null): void }>();

/** One chart as an element: its title, legend, SVG, hover. `big`: drawn larger (the zoom). */
export function chartEl(c: Chart, o: { big?: boolean; onZoom?: (c: Chart) => void } = {}): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = `vchart${o.big ? " big" : ""}`;
  const finite = ([x, y]: Pt) => Number.isFinite(x) && Number.isFinite(y) && (!c.logY || y > 0);
  const all = [
    ...c.series.flatMap((s) => s.pts),
    ...(c.band ? [...c.band.lo, ...c.band.hi] : []),
    ...(c.states ?? []).map((p) => [p.x, p.y] as Pt),
  ].filter(finite);
  if (!all.length) return fig;
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => (c.logY ? Math.log10(p[1]) : p[1]));
  const X = nice(Math.min(...xs), Math.max(...xs)),
    Y = nice(Math.min(...ys), Math.max(...ys), 4);
  const px = (x: number) => {
    const u = (x - X.a) / (X.b - X.a);
    return L + (c.flipX ? 1 - u : u) * (W - L - R);
  };
  const py = (y: number) => T + (1 - ((c.logY ? Math.log10(Math.max(y, 1e-12)) : y) - Y.a) / (Y.b - Y.a)) * (H - T - B);
  const path = (pts: Pt[]) =>
    pts
      .filter(finite)
      .map(([x, y], k) => `${k ? "L" : "M"}${px(x).toFixed(1)},${py(y).toFixed(1)}`)
      .join("");
  let g = "";
  for (const t of Y.ticks) {
    const y = py(c.logY ? 10 ** t : t);
    g += `<line class="g" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="tk" x="${L - 7}" y="${y + 4}" text-anchor="end">${c.logY ? `1e${t}` : fmt(t)}</text>`;
  }
  for (const t of X.ticks) g += `<text class="tk" x="${px(t)}" y="${H - B + 17}" text-anchor="middle">${fmt(t)}</text>`;
  g += `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  g += `<text class="axl" x="${W - R}" y="${H - 3}" text-anchor="end">${esc(c.xLabel)}</text>`;
  if (c.band) {
    const poly = [...c.band.lo, ...[...c.band.hi].reverse()].filter(finite);
    g += `<path class="band" d="${path(poly)}Z"/>`;
  }
  for (const m of c.marks ?? [])
    if (m.x >= X.a && m.x <= X.b)
      g += `<line class="mk" x1="${px(m.x)}" x2="${px(m.x)}" y1="${T}" y2="${H - B}"><title>${esc(m.label)}</title></line>`;
  for (const s of c.series) {
    g += `<path class="ln s${s.slot ?? 1}${s.dash ? " dash" : ""}" d="${path(s.pts)}"/>`;
    if (s.dots)
      for (const [x, y] of s.pts.filter(finite))
        g += `<circle class="dt s${s.slot ?? 1}" cx="${px(x).toFixed(1)}" cy="${py(y).toFixed(1)}" r="3"/>`;
  }
  for (const p of c.states ?? [])
    if (finite([p.x, p.y]))
      g += `<circle class="st ${p.s}" cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5"><title>${esc(p.s)}</title></circle>`;
  const legend =
    c.series.length + (c.band ? 1 : 0) > 1 || c.states?.length
      ? `<div class="lg">${c.band ? `<span><i class="sw band"></i>corridor</span>` : ""}${c.series.map((s) => `<span><i class="sw s${s.slot ?? 1}${s.dash ? " dash" : ""}"></i>${esc(s.name)}</span>`).join("")}${c.states?.length ? `<span><i class="sw on"></i>in the corridor</span><span><i class="sw off"></i>out</span>` : ""}</div>`
      : "";
  fig.innerHTML = `<figcaption><b>${esc(c.title)}</b> <small>${esc(c.unit)}</small>${o.onZoom ? `<button class="zoom" title="Larger">⤢</button>` : ""}</figcaption>${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">${g}<line class="xh" y1="${T}" y2="${H - B}" x1="-9" x2="-9"/></svg><div class="tip" hidden></div>`;
  if (o.onZoom) fig.querySelector<HTMLButtonElement>(".zoom")!.onclick = () => o.onZoom!(c);
  // (the hover: the nearest point of each series to the pointer's x; the same x on the linked charts)
  const svg = fig.querySelector("svg")!,
    tip = fig.querySelector<HTMLElement>(".tip")!,
    xh = svg.querySelector(".xh")!;
  const data = c.series.map((s) => ({ n: s.name, k: s.slot ?? 1, p: s.pts.filter(finite) }));
  const show = (x: number | null, e?: PointerEvent) => {
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
    if (at === null) return;
    const X0 = px(at);
    xh.setAttribute("x1", String(X0));
    xh.setAttribute("x2", String(X0));
    tip.innerHTML = `<div class="tx">${fmt(at)} · ${esc(c.xLabel)}</div>${rows.join("<br>")}`;
    tip.hidden = false;
    const b = svg.getBoundingClientRect(),
      fb = fig.getBoundingClientRect();
    const left = e ? e.clientX - fb.left + 14 : (X0 / W) * b.width + (b.left - fb.left) + 14;
    tip.style.left = `${Math.min(left, fb.width - tip.offsetWidth - 6)}px`;
    tip.style.top = `${e ? e.clientY - fb.top + 14 : 40}px`;
  };
  const me = { axis: c.xLabel, el: fig as HTMLElement, show: (x: number | null) => show(x) };
  if (!c.states?.length && !c.flipX) linked.add(me);
  const toX = (e: PointerEvent) => {
    const b = svg.getBoundingClientRect();
    const u = (((e.clientX - b.left) / b.width) * W - L) / (W - L - R);
    return X.a + (c.flipX ? 1 - u : u) * (X.b - X.a);
  };
  svg.addEventListener("pointermove", (e) => {
    const x = toX(e);
    show(x, e);
    for (const o2 of linked) {
      // (a chart gone from the page leaves the links)
      if (!o2.el.isConnected) linked.delete(o2);
      else if (o2 !== me && o2.axis === me.axis) o2.show(x);
    }
  });
  svg.addEventListener("pointerleave", () => {
    for (const o2 of linked) if (o2.axis === me.axis) o2.show(null);
  });
  return fig;
}
