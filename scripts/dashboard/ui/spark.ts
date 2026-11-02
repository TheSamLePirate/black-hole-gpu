// The Monitor's small live charts: one axis, a few series on a shared x (time), an optional coloured band behind
// (the thermal pressure, a test's segments), a crosshair and every series' value under the pointer, a legend with
// each series' last value. Drawn as markup — the page's DOM morph keeps the nodes across the lab's updates — so
// the hover handlers read their data from the element itself (data-d), never from a closure's.
//
//   lineChart({ x, series, bands, height, xFmt })   → HTMLElement
//   gauge(value, max, label)                         → a horizontal gauge (the GPU clock against its maximum)
//   pill(level)                                       → the thermal pressure's coloured word

export interface SparkSeries {
  name: string;
  /** the theme's chart slot (1…6) */
  slot: number;
  values: (number | null)[];
  unit?: string;
  /** digits shown */
  digits?: number;
  /** filled under the line */
  area?: boolean;
  dash?: boolean;
}
export interface SparkBand {
  x0: number;
  x1: number;
  /** a CSS colour */
  color: string;
  label?: string;
}
export interface SparkChart {
  x: number[];
  series: SparkSeries[];
  bands?: SparkBand[];
  height?: number;
  /** how an x is said under the pointer and on the axis */
  xKind?: "clock" | "seconds";
  /** the y range: fixed ends (else the data's, padded) */
  yMin?: number;
  yMax?: number;
  title?: string;
  /** a key that changes when the chart must be rebuilt rather than patched */
  key?: string;
}

const W = 600;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtV = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const clockS = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const secs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)} s`);

/** The thermal pressure levels' colours (0 Nominal … 4 Sleeping). */
export const PRESSURE_COLOR = ["var(--ok)", "var(--warn)", "var(--bad)", "var(--bad)", "var(--bad)"];
export const PRESSURE_NAMES = ["Nominal", "Moderate", "Heavy", "Trapping", "Sleeping"];

export function lineChart(c: SparkChart): HTMLElement {
  const H = c.height ?? 96;
  const box = document.createElement("div");
  box.className = "spark";
  const n = c.x.length;
  const vals = c.series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
  box.dataset.key = c.key ?? `${c.title ?? ""}|${c.series.map((s) => s.name).join(",")}`;
  if (n < 2 || !vals.length) {
    box.innerHTML = `<div class="spark-empty">${c.title ? `${esc(c.title)} — ` : ""}not enough samples yet</div>`;
    return box;
  }
  let lo = c.yMin ?? Math.min(...vals);
  let hi = c.yMax ?? Math.max(...vals);
  if (!(hi > lo)) {
    lo -= 1;
    hi += 1;
  }
  if (c.yMin === undefined) lo -= (hi - lo) * 0.08;
  if (c.yMax === undefined) hi += (hi - lo) * 0.08;
  const x0 = c.x[0]!;
  const x1 = c.x[n - 1]!;
  const px = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const py = (y: number) => 4 + (1 - (y - lo) / (hi - lo)) * (H - 8);
  let g = "";
  for (const b of c.bands ?? []) {
    const a = Math.max(0, px(b.x0));
    const z = Math.min(W, px(b.x1));
    if (z > a) g += `<rect x="${a.toFixed(1)}" y="0" width="${(z - a).toFixed(1)}" height="${H}" fill="${b.color}" opacity=".13"/>`;
  }
  for (const s of c.series) {
    let d = "";
    let pen = false;
    let first = -1;
    let last = -1;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${px(c.x[i]!).toFixed(1)},${py(v).toFixed(1)}`;
      pen = true;
      if (first < 0) first = i;
      last = i;
    });
    if (s.area && first >= 0)
      g += `<path d="${d}L${px(c.x[last]!).toFixed(1)},${H}L${px(c.x[first]!).toFixed(1)},${H}Z" fill="var(--chart-${s.slot})" opacity=".14"/>`;
    g += `<path d="${d}" fill="none" stroke="var(--chart-${s.slot})" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="4 3"' : ""}/>`;
  }
  const lastOf = (s: SparkSeries) => [...s.values].reverse().find((v) => v !== null && Number.isFinite(v)) ?? null;
  const legend = c.series
    .map(
      (s) =>
        `<span class="lg"><i style="background:var(--chart-${s.slot})"></i>${esc(s.name)} <b>${fmtV(lastOf(s), s.digits ?? 0)}${s.unit ? ` ${esc(s.unit)}` : ""}</b></span>`,
    )
    .join("");
  const xa = c.xKind === "seconds" ? secs(0) : clock(x0);
  const xb = c.xKind === "seconds" ? secs(x1 - x0) : clock(x1);
  box.dataset.d = JSON.stringify({
    x: c.x,
    s: c.series.map((s) => [s.name, s.values, s.unit ?? "", s.digits ?? 0, s.slot]),
    k: c.xKind ?? "clock",
    b: c.bands ?? [],
  });
  box.innerHTML = `${c.title ? `<div class="spark-title">${esc(c.title)}</div>` : ""}<div class="spark-legend">${legend}</div><div class="spark-plot" style="height:${H}px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}">${g}<line class="xh" x1="-9" x2="-9" y1="0" y2="${H}" vector-effect="non-scaling-stroke"/></svg><span class="yv hi">${fmtV(hi, hi - lo < 10 ? 1 : 0)}</span><span class="yv lo">${fmtV(lo, hi - lo < 10 ? 1 : 0)}</span><div class="spark-tip" hidden></div></div><div class="spark-x"><span>${xa}</span><span>${xb}</span></div>`;
  return box;
}

/** The hover of every spark chart: delegated from the document (the nodes outlive any closure). */
export function wireSparks(root: Document = document) {
  const cache = new WeakMap<
    HTMLElement,
    { raw: string; d: { x: number[]; s: [string, (number | null)[], string, number, number][]; k: string; b: SparkBand[] } }
  >();
  const dataOf = (box: HTMLElement) => {
    const raw = box.dataset.d ?? "";
    let hit = cache.get(box);
    if (!hit || hit.raw !== raw) {
      hit = { raw, d: JSON.parse(raw) };
      cache.set(box, hit);
    }
    return hit.d;
  };
  root.addEventListener("pointermove", (e) => {
    const plot = (e.target as Element | null)?.closest?.(".spark-plot") as HTMLElement | null;
    for (const t of root.querySelectorAll<HTMLElement>(".spark-plot.hover")) if (t !== plot) hide(t);
    if (!plot) return;
    const box = plot.closest(".spark") as HTMLElement;
    if (!box?.dataset.d) return;
    const d = dataOf(box);
    const r = plot.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const x0 = d.x[0]!;
    const x1 = d.x[d.x.length - 1]!;
    const xv = x0 + u * (x1 - x0);
    let i = 0;
    for (let k = 1; k < d.x.length; k++) if (Math.abs(d.x[k]! - xv) < Math.abs(d.x[i]! - xv)) i = k;
    const xl = plot.querySelector("line.xh")!;
    const p = ((d.x[i]! - x0) / (x1 - x0 || 1)) * W;
    xl.setAttribute("x1", String(p));
    xl.setAttribute("x2", String(p));
    const tip = plot.querySelector<HTMLElement>(".spark-tip")!;
    const band = d.b.find((b) => d.x[i]! >= b.x0 && d.x[i]! <= b.x1 && b.label);
    tip.innerHTML = `<div class="tx">${d.k === "seconds" ? secs(d.x[i]! - x0) : clockS(d.x[i]!)}${band ? ` · ${esc(band.label!)}` : ""}</div>${d.s
      .map(
        ([name, v, unit, digits, slot]) =>
          `<div><i style="background:var(--chart-${slot})"></i>${esc(name)} <b>${fmtV(v[i], digits)}${unit ? ` ${esc(unit)}` : ""}</b></div>`,
      )
      .join("")}`;
    tip.hidden = false;
    const left = u * r.width;
    tip.style.left = `${left > r.width * 0.6 ? left - tip.offsetWidth - 10 : left + 10}px`;
    plot.classList.add("hover");
  });
  const hide = (plot: HTMLElement) => {
    plot.classList.remove("hover");
    const t = plot.querySelector<HTMLElement>(".spark-tip");
    if (t) t.hidden = true;
    const xl = plot.querySelector("line.xh");
    xl?.setAttribute("x1", "-9");
    xl?.setAttribute("x2", "-9");
  };
  root.addEventListener("pointerleave", () => root.querySelectorAll<HTMLElement>(".spark-plot.hover").forEach(hide), true);
}

/** A horizontal gauge: value against max, coloured by the share (an amber band from warn, red from bad). */
export function gauge(value: number | null, max: number | null, o: { warn?: number; bad?: number; invert?: boolean } = {}): HTMLElement {
  const g = document.createElement("div");
  g.className = "gauge";
  const u = value !== null && max ? Math.max(0, Math.min(1, value / max)) : 0;
  const share = o.invert ? 1 - u : u;
  const cls = o.bad !== undefined && share >= o.bad ? "bad" : o.warn !== undefined && share >= o.warn ? "warn" : "ok";
  g.innerHTML = `<i class="${cls}" style="width:${(u * 100).toFixed(1)}%"></i>`;
  return g;
}

/** The thermal pressure as a coloured word (null: unknown). */
export function pill(pressure: string | null | undefined): HTMLElement {
  const s = document.createElement("span");
  const i = pressure ? PRESSURE_NAMES.indexOf(pressure) : -1;
  s.className = `pill ${i < 0 ? "" : i === 0 ? "ok" : i === 1 ? "warn" : "bad"}`;
  s.textContent = pressure ?? "pressure ?";
  return s;
}

/** Consecutive equal levels → bands (the pressure behind a heat chart). */
export function levelBands(x: number[], levels: number[], color: (l: number) => string | null, label: (l: number) => string): SparkBand[] {
  const out: SparkBand[] = [];
  const half = x.length > 1 ? (x[1]! - x[0]!) / 2 : 0;
  for (let i = 0; i < x.length; i++) {
    const c = color(levels[i]!);
    if (!c) continue;
    const last = out.at(-1);
    if (last && last.label === label(levels[i]!) && Math.abs(last.x1 - (x[i]! - half)) < half * 2.5) last.x1 = x[i]! + half;
    else out.push({ x0: x[i]! - half, x1: x[i]! + half, color: c, label: label(levels[i]!) });
  }
  return out;
}
