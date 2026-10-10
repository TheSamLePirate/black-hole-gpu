// The flight lab's charts: one scenario's folder (telemetry.jsonl, events.jsonl, graphs.json, summary.json,
// shots/) turned into report.html — a page of its own, no dependency: inline SVG, one measure per chart
// (never two y-scales), a crosshair and its tooltip on every line, light and dark.
//   - the time series: height, speed, vertical speed, the angle of attack and sideslip, bank (flown and
//     commanded), Mach, dynamic pressure, load factor, heat flux, throttle, warp, propellant, apsides;
//   - the corridors: each assistant's own graph (its optimum, its corridor's edges, what the HUD recorded)
//     with the craft's points on it, sample by sample, coloured by its verdict;
//   - the approach: the runway seen from above (across against along) and the vertical profile;
//   - the docking: range, lateral offset and closing speed.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Sample } from "./lab";

export type Pt = [number, number];
export interface Series {
  name: string;
  pts: Pt[];
  /** a categorical slot (1…6: the report pages draw 3, the dashboard 6), or a status for verdict points */
  slot?: 1 | 2 | 3 | 4 | 5 | 6;
  dash?: boolean;
  dots?: boolean;
}
export interface Chart {
  title: string;
  unit: string;
  xLabel: string;
  series: Series[];
  /** a corridor: the area between two edges */
  band?: { lo: Pt[]; hi: Pt[] };
  /** vertical marks (x, label): phase changes */
  marks?: { x: number; label: string }[];
  logY?: boolean;
  /** points coloured by state (on / off / wait) */
  states?: { x: number; y: number; s: string }[];
  /** the x axis reversed (a distance counting down) */
  flipX?: boolean;
}

const W = 640,
  H = 230,
  L = 56,
  R = 14,
  T = 26,
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

const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6 || a < 1e-3) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

/** One chart: an SVG with its data for the hover layer. */
function svg(c: Chart): string {
  const all = [
    ...c.series.flatMap((s) => s.pts),
    ...(c.band ? [...c.band.lo, ...c.band.hi] : []),
    ...(c.states ?? []).map((p) => [p.x, p.y] as Pt),
  ].filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!c.logY || y > 0));
  if (!all.length) return "";
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
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y], k) => `${k ? "L" : "M"}${px(x).toFixed(1)},${py(y).toFixed(1)}`)
      .join("");
  let g = "";
  for (const t of Y.ticks)
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${py(c.logY ? 10 ** t : t)}" y2="${py(c.logY ? 10 ** t : t)}"/><text class="tick" x="${L - 6}" y="${py(c.logY ? 10 ** t : t) + 4}" text-anchor="end">${c.logY ? `1e${t}` : fmt(t)}</text>`;
  for (const t of X.ticks) g += `<text class="tick" x="${px(t)}" y="${H - B + 16}" text-anchor="middle">${fmt(t)}</text>`;
  g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  g += `<text class="axl" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(c.xLabel)}</text>`;
  if (c.band) {
    const poly = [...c.band.lo, ...[...c.band.hi].reverse()].filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    g += `<path class="band" d="${path(poly)}Z"/>`;
  }
  for (const m of c.marks ?? [])
    if (m.x >= X.a && m.x <= X.b)
      g += `<line class="mark" x1="${px(m.x)}" x2="${px(m.x)}" y1="${T}" y2="${H - B}"><title>${esc(m.label)}</title></line>`;
  for (const s of c.series) {
    g += `<path class="ln s${s.slot ?? 1}${s.dash ? " dash" : ""}" d="${path(s.pts)}"/>`;
    if (s.dots)
      for (const [x, y] of s.pts) g += `<circle class="dot s${s.slot ?? 1}" cx="${px(x).toFixed(1)}" cy="${py(y).toFixed(1)}" r="3"/>`;
  }
  for (const p of c.states ?? []) g += `<circle class="st ${p.s}" cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="4"/>`;
  const legend =
    c.series.length + (c.band ? 1 : 0) > 1
      ? `<div class="legend">${c.band ? `<span><i class="sw band"></i>corridor</span>` : ""}${c.series.map((s) => `<span><i class="sw s${s.slot ?? 1}${s.dash ? " dash" : ""}"></i>${esc(s.name)}</span>`).join("")}${c.states?.length ? `<span><i class="sw on"></i>in</span><span><i class="sw off"></i>out</span>` : ""}</div>`
      : "";
  // (the hover layer's data: each series' points in pixels and in values)
  const data = c.series.map((s) => ({
    n: s.name,
    k: s.slot ?? 1,
    p: s.pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => [+px(x).toFixed(1), +py(y).toFixed(1), x, y]),
  }));
  return `<figure class="chart"><figcaption>${esc(c.title)} <small>${esc(c.unit)}</small></figcaption>${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}" data-d='${JSON.stringify(data).replace(/'/g, "&#39;")}'>${g}<line class="xh" y1="${T}" y2="${H - B}" x1="-9" x2="-9"/></svg><div class="tip" hidden></div></figure>`;
}

const CSS = `
.viz-root{color-scheme:light;--surface-1:#fcfcfb;--surface-2:#f1f0ec;--text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#8a8984;
--grid:#e4e3de;--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--band:#2a78d622;--good:#008300;--critical:#e34948;--warning:#c98500}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--surface-1:#1a1a19;--surface-2:#242422;
--text-primary:#fff;--text-secondary:#c3c2b7;--text-muted:#8a8984;--grid:#33332f;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--band:#3987e533;--good:#2fa82f;--critical:#e66767;--warning:#e0a020}}
body{margin:0;background:var(--surface-1)}
.viz-root{background:var(--surface-1);color:var(--text-primary);font:14px/1.45 system-ui,sans-serif;padding:16px;max-width:1340px;margin:auto}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.06em}
.verdict{display:inline-block;padding:2px 10px;border-radius:4px;font-weight:600;color:#fff}.verdict.pass{background:var(--good)}.verdict.fail{background:var(--critical)}.verdict.other{background:var(--warning)}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,560px),1fr));gap:12px}
.chart{margin:0;background:var(--surface-2);border-radius:6px;padding:8px 8px 4px;position:relative}
figcaption{font-weight:600;font-size:13px}figcaption small{color:var(--text-muted);font-weight:400}
svg{width:100%;height:auto;display:block}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--text-muted)}.tick,.axl{fill:var(--text-muted);font-size:10px}
.ln{fill:none;stroke-width:2;stroke-linejoin:round}.ln.dash{stroke-dasharray:5 4}
.s1{stroke:var(--series-1);fill:var(--series-1)}.s2{stroke:var(--series-2);fill:var(--series-2)}.s3{stroke:var(--series-3);fill:var(--series-3)}.ln.s1,.ln.s2,.ln.s3{fill:none}
.dot{stroke:var(--surface-2);stroke-width:2}.band{fill:var(--band);stroke:none}
.mark{stroke:var(--text-muted);stroke-dasharray:2 3}.st{stroke:var(--surface-2);stroke-width:1.5}.st.on{fill:var(--good)}.st.off{fill:var(--critical)}.st.wait{fill:var(--text-muted)}
.xh{stroke:var(--text-secondary);stroke-width:1;pointer-events:none}
.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);margin:2px 0}
.sw{display:inline-block;width:14px;height:3px;margin-right:4px;vertical-align:middle;background:var(--series-1)}.sw.s2{background:var(--series-2)}.sw.s3{background:var(--series-3)}
.sw.band{height:9px;background:var(--band)}.sw.on{width:8px;height:8px;border-radius:4px;background:var(--good)}.sw.off{width:8px;height:8px;border-radius:4px;background:var(--critical)}
.tip{position:absolute;pointer-events:none;background:var(--surface-1);border:1px solid var(--grid);border-radius:4px;padding:4px 6px;font-size:11px;white-space:nowrap;box-shadow:0 2px 6px #0003}
table{border-collapse:collapse;font-size:12px}td,th{padding:3px 8px;border-bottom:1px solid var(--grid);text-align:left;vertical-align:top}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}.shots figure{margin:0}.shots img{width:100%;border-radius:4px}.shots figcaption{font-size:11px;font-weight:400;color:var(--text-secondary)}
.ev{font:11px/1.5 ui-monospace,monospace;color:var(--text-secondary);max-height:340px;overflow:auto;background:var(--surface-2);padding:8px;border-radius:6px}
@media (max-width:600px){.viz-root{padding:16px}}`;

const HOVER = `for (const f of document.querySelectorAll('.chart')) { const s = f.querySelector('svg'), tip = f.querySelector('.tip'), xh = s?.querySelector('.xh'); if (!s) continue;
const D = JSON.parse(s.dataset.d || '[]');
s.addEventListener('pointermove', (e) => { const b = s.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * ${W};
 const rows = []; let px = null;
 for (const d of D) { let best = null; for (const p of d.p) if (!best || Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p; if (best) { px = best[0]; rows.push('<b>' + d.n + '</b> ' + (+best[3].toPrecision(5)) + ' @ ' + (+best[2].toPrecision(6))); } }
 if (px === null) return; xh.setAttribute('x1', px); xh.setAttribute('x2', px); tip.hidden = false; tip.innerHTML = rows.join('<br>');
 const fb = f.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - fb.left + 12, fb.width - tip.offsetWidth - 4) + 'px'; tip.style.top = (e.clientY - fb.top + 12) + 'px'; });
s.addEventListener('pointerleave', () => { tip.hidden = true; xh.setAttribute('x1', -9); xh.setAttribute('x2', -9); }); }`;

const readJsonl = (f: string): Sample[] =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/** The time axis: seconds, minutes, hours or days of simulated time, from the flight's start. */
export function timeAxis(T: Sample[]) {
  const t0 = T[0]?.t ?? 0,
    span = (T[T.length - 1]?.t ?? 0) - t0;
  const [k, u] = span > 3 * 86400 ? [86400, "d"] : span > 3 * 3600 ? [3600, "h"] : span > 600 ? [60, "min"] : [1, "s"];
  return { x: (S: Sample) => (S.t - t0) / k, label: `simulated time [${u}]`, k, t0 };
}

const ser = (T: Sample[], x: (S: Sample) => number, f: (S: Sample) => unknown): Pt[] =>
  T.map((S) => [x(S), f(S)] as [number, unknown]).filter((p): p is Pt => typeof p[1] === "number" && Number.isFinite(p[1]));

/** The flight's graphs, by section — the report pages' (report.html here, the e2e dashboard's interactive one). */
export function buildCharts(
  T: Sample[],
  ev: { t: number; kind: string; text: string }[],
  // biome-ignore lint/suspicious/noExplicitAny: graphs.json as the sampler wrote it
  G: { graphs?: Record<string, any>; on?: Record<string, [number, number, number, string][]> },
) {
  const ax = timeAxis(T);
  const marks = ev
    .filter((e) => e.kind === "phase" && !/^label|^soi/.test(e.text))
    .map((e) => ({ x: (e.t - ax.t0) / ax.k, label: e.text }));
  const charts: Chart[] = [];
  const ts = (title: string, unit: string, ...s: [string, (S: Sample) => unknown, Partial<Series>?][]) => {
    const series = s
      .map(([name, f, o], k) => ({ name, pts: ser(T, ax.x, f), slot: (k + 1) as 1 | 2 | 3, ...o }))
      .filter((x) => x.pts.length > 1);
    if (series.length && series.some((x) => x.pts.some((p) => p[1] !== x.pts[0]![1])))
      charts.push({ title, unit, xLabel: ax.label, series, marks });
  };
  const inAir = (S: Sample) => !!S.air?.body && (S.air?.q ?? 0) > 0.001;
  ts("Height", "km", ["altitude", (S) => S.alt]);
  ts("Speed", "m/s", ["speed", (S) => S.v], ["airspeed", (S) => (inAir(S) ? S.air.aspeed : null), { dash: true }]);
  ts("Vertical speed", "m/s", ["vertical", (S) => S.vz]);
  ts(
    "Angle of attack α · sideslip β",
    "°",
    ["α", (S) => (inAir(S) ? S.air.alpha : null)],
    ["β", (S) => (inAir(S) ? S.air.beta : null), { dash: true }],
  );
  ts("Bank", "°", ["flown", (S) => (inAir(S) ? S.att?.bank : null)], ["commanded (entry)", (S) => S.bankCmd, { dash: true }]);
  ts("Pitch", "°", ["pitch", (S) => S.att?.pitch]);
  ts("Mach", "", ["Mach", (S) => (inAir(S) ? S.air.mach : null)]);
  ts("Dynamic pressure", "kPa", ["q", (S) => (inAir(S) ? S.air.q : null)]);
  ts("Load factor", "g", ["g", (S) => S.air?.g]);
  ts("Heat flux (stagnation)", "kW/m²", ["heat", (S) => (inAir(S) ? S.air.heat : null)]);
  ts("Lift / drag", "", ["L/D", (S) => (inAir(S) ? S.air.ld : null)]);
  ts("Throttle", "0–1", ["throttle", (S) => S.thr]);
  ts("Propellant", "fraction", ["fuel", (S) => S.fuel]);
  ts(
    "Apsides",
    "km",
    ["periapsis", (S) => S.orbit?.pe],
    ["apoapsis", (S) => ((S.orbit?.ap ?? 0) < 1e6 ? S.orbit?.ap : null), { dash: true }],
  );
  ts("Target distance", "km", ["range", (S) => S.target?.km]);
  const warp = ser(T, ax.x, (S) => S.warp).filter((p) => p[1] > 0);
  if (warp.some((p) => p[1] !== warp[0]![1]))
    charts.push({
      title: "Time warp",
      unit: "× real time (log)",
      xLabel: ax.label,
      series: [{ name: "warp", pts: warp }],
      logY: true,
      marks,
    });
  // (the corridors: the assistants' own graphs, the craft's points on them coloured by verdict)
  const corridors: Chart[] = [];
  for (const [kind, g] of Object.entries(G.graphs ?? {}) as [
    string,
    {
      title: string;
      x: { label: string; unit: string };
      y: { label: string; unit: string };
      ideal: Pt[];
      lo: Pt[] | null;
      hi: Pt[] | null;
      flown: Pt[];
      levels?: { y: number; label: string }[] | null;
    },
  ][]) {
    const on = ((G.on ?? {})[kind] ?? []) as [number, number, number, string][];
    corridors.push({
      title: `${g.title} — corridor (${kind})`,
      unit: `${g.y.label} [${g.y.unit}]`,
      xLabel: `${g.x.label} [${g.x.unit}]`,
      band: g.lo && g.hi ? { lo: g.lo, hi: g.hi } : undefined,
      series: (
        [
          { name: "optimum", pts: g.ideal, slot: 1, dash: true },
          { name: "flown (HUD)", pts: g.flown ?? [], slot: 2 },
        ] as Series[]
      ).filter((s) => s.pts.length),
      states: on.map(([, x, y, s]) => ({ x, y, s })),
    });
  }
  // (the approach: the runway from above, and the profile)
  const app = T.filter((S) => S.entry?.app && Number.isFinite(S.entry.app.along));
  const approach: Chart[] = [];
  if (app.length > 2) {
    approach.push({
      title: "Approach — ground track",
      unit: "across the axis [m]",
      xLabel: "along the runway from the threshold [m]",
      series: [{ name: "flown", pts: app.map((S) => [S.entry.app.along, S.entry.app.across] as Pt), slot: 2 }],
    });
    approach.push({
      title: "Approach — vertical profile",
      unit: "height above ground [m]",
      xLabel: "along the runway from the threshold [m]",
      series: [{ name: "flown", pts: app.map((S) => [S.entry.app.along, S.entry.app.agl] as Pt), slot: 2 }],
    });
  }
  const roll = T.filter((S) => S.runway && (S.landed || S.rolling));
  if (roll.length > 1)
    approach.push({
      title: "Rollout on the runway",
      unit: "across [m]",
      xLabel: "along [m]",
      series: [{ name: "rollout", pts: roll.map((S) => [S.runway.along, S.runway.across] as Pt), slot: 3 }],
    });
  const dock = T.filter((S) => S.dockInfo);
  const docking: Chart[] = [];
  if (dock.length > 2) {
    const x = (S: Sample) => ax.x(S);
    docking.push({
      title: "Docking — range to the port",
      unit: "m",
      xLabel: ax.label,
      series: [{ name: "range", pts: dock.map((S) => [x(S), S.dockInfo.range] as Pt) }],
      marks,
    });
    docking.push({
      title: "Docking — lateral offset",
      unit: "m",
      xLabel: ax.label,
      series: [{ name: "lateral", pts: dock.map((S) => [x(S), S.dockInfo.lateral] as Pt) }],
      marks,
    });
    docking.push({
      title: "Docking — closing speed",
      unit: "m/s",
      xLabel: ax.label,
      series: [{ name: "closing", pts: dock.map((S) => [x(S), S.dockInfo.closing] as Pt) }],
      marks,
    });
  }
  // (what was asked against what was flown: the entry's bank, the approach's slope and line, the guidance's
  // predicted miss — each the commanded value and the flown one on one chart, their gap the deviation)
  const commanded: Chart[] = [];
  const pair = (title: string, unit: string, cmd: [string, (S: Sample) => unknown], flown: [string, (S: Sample) => unknown]) => {
    const series = [
      { name: flown[0], pts: ser(T, ax.x, flown[1]), slot: 2 as const },
      { name: cmd[0], pts: ser(T, ax.x, cmd[1]), slot: 1 as const, dash: true },
    ].filter((x) => x.pts.length > 1);
    if (series.length === 2) commanded.push({ title, unit, xLabel: ax.label, series, marks });
  };
  pair(
    "Bank — commanded vs flown",
    "°",
    ["commanded (entry guidance)", (S) => S.bankCmd],
    ["flown", (S) => (inAir(S) ? S.att?.bank : null)],
  );
  pair("Glide slope — aimed vs flown", "°", ["aimed (gRef)", (S) => S.entry?.app?.gRef], ["flown (γ)", (S) => S.entry?.app?.gam]);
  pair(
    "Approach line — axis vs flown",
    "m across the runway's axis",
    ["the axis", (S) => (S.entry?.app ? 0 : null)],
    ["flown", (S) => S.entry?.app?.across],
  );
  pair(
    "Entry guidance — predicted miss (along)",
    "km",
    ["the site", (S) => (S.entry?.miss ? 0 : null)],
    ["predicted miss", (S) => S.entry?.miss?.along],
  );
  pair(
    "Entry guidance — predicted miss (across)",
    "km",
    ["the site", (S) => (S.entry?.miss ? 0 : null)],
    ["predicted miss", (S) => S.entry?.miss?.across],
  );
  pair(
    "Docking — lateral offset vs the port's axis",
    "m",
    ["the axis", (S) => (S.dockInfo ? 0 : null)],
    ["flown", (S) => S.dockInfo?.lateral],
  );
  return { corridors, commanded, approach, docking, telemetry: charts, marks };
}

/** Writes <dir>/report.html; returns its charts' count. */
export function scenarioReport(dir: string): number {
  const T = readJsonl(`${dir}/telemetry.jsonl`);
  const ev = readJsonl(`${dir}/events.jsonl`) as unknown as { t: number; kind: string; text: string }[];
  const sum = existsSync(`${dir}/summary.json`) ? JSON.parse(readFileSync(`${dir}/summary.json`, "utf8")) : {};
  const G = existsSync(`${dir}/graphs.json`) ? JSON.parse(readFileSync(`${dir}/graphs.json`, "utf8")) : { graphs: {}, on: {} };
  const { corridors, approach, docking, telemetry: charts, commanded } = buildCharts(T, ev, G);
  const shots = existsSync(`${dir}/shots`)
    ? readdirSync(`${dir}/shots`)
        .filter((f) => f.endsWith(".png"))
        .sort()
    : [];
  const verdict = sum.verdict ?? "?";
  const metrics = Object.entries(sum.metrics ?? {})
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === "number" ? fmt(v) : JSON.stringify(v))}</td></tr>`)
    .join("");
  const section = (title: string, cs: Chart[]) => (cs.length ? `<h2>${title}</h2><div class="grid2">${cs.map(svg).join("")}</div>` : "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(sum.id ?? "flight")}</title><style>${CSS}</style></head>
<body><div class="viz-root"><h1>${esc(sum.title ?? sum.id ?? dir)} <span class="verdict ${verdict === "PASS" ? "pass" : verdict === "FAIL" ? "fail" : "other"}">${esc(verdict)}</span></h1>
<div style="color:var(--text-secondary)">${esc(sum.why ?? "")} · ${esc(String(sum.wallS ?? "?"))} s wall · ${T.length} samples</div>
${metrics ? `<h2>Measures</h2><table>${metrics}</table>` : ""}
${section("Corridors (the assistants' graphs)", corridors)}${section("Commanded against flown", commanded)}${section("Approach", approach)}${section("Docking", docking)}${section("Telemetry", charts)}
${shots.length ? `<h2>Moments</h2><div class="shots">${shots.map((f) => `<figure><a href="shots/${f}"><img loading="lazy" src="shots/${f}" alt="${esc(f)}"></a><figcaption>${esc(f.replace(/\.png$/, ""))}</figcaption></figure>`).join("")}</div>` : ""}
<h2>Events</h2><div class="ev">${ev
    .filter((e) => e.kind !== "shot")
    .map((e) => `${Math.round(e.t)} s · ${esc(e.kind)} · ${esc(e.text)}`)
    .join("<br>")}</div>
</div><script>${HOVER}</script></body></html>`;
  writeFileSync(`${dir}/report.html`, html);
  return corridors.length + commanded.length + approach.length + docking.length + charts.length;
}

/** The campaign's index: every scenario's verdict, measures and its report. */
export function campaignReport(
  dir: string,
  rows: { id: string; title: string; verdict: string; why: string; wallS: number; machine: string; tags: string[] }[],
) {
  const n = (v: string) => rows.filter((r) => r.verdict === v).length;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flight campaign</title><style>${CSS}</style></head>
<body><div class="viz-root"><h1>Flight campaign</h1><div>${rows.length} scenarios · <span class="verdict pass">${n("PASS")} pass</span> <span class="verdict fail">${n("FAIL")} fail</span> <span class="verdict other">${rows.length - n("PASS") - n("FAIL")} other</span></div>
<h2>Scenarios</h2><table><tr><th>scenario</th><th>verdict</th><th>why</th><th>wall</th><th>machine</th><th>tags</th></tr>
${rows.map((r) => `<tr><td><a href="${esc(r.id)}/report.html">${esc(r.title)}</a></td><td><span class="verdict ${r.verdict === "PASS" ? "pass" : r.verdict === "FAIL" ? "fail" : "other"}">${esc(r.verdict)}</span></td><td>${esc(r.why)}</td><td>${Math.round(r.wallS)} s</td><td>${esc(r.machine)}</td><td>${esc(r.tags.join(" "))}</td></tr>`).join("")}
</table></div></body></html>`;
  writeFileSync(`${dir}/index.html`, html);
}
