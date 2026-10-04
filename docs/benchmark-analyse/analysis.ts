/**
 * Moteur d'analyse Kerr-Bench — fonctions pures (testables avec `bun test`).
 * Entrées : objets au schéma « kerr-bench/1 » (voir types.ts).
 */
import type { Bench } from "./types.ts";
export const fmt = {
  n(x: number, d = 1) { return Number.isFinite(x) ? x.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—"; },
  i(x: number) { return Number.isFinite(x) ? Math.round(x).toLocaleString("fr-FR") : "—"; },
  ms(x: number) {
    if (!Number.isFinite(x)) return "—";
    if (x >= 1000) return `${fmt.n(x / 1000, x / 1000 >= 10 ? 1 : 2)} s`;
    const d = x < 10 ? 2 : x < 100 ? 1 : 0;
    return `${fmt.n(x, d)} ms`;
  },
  /** percentile (0..1) d'un tableau de valeurs */
  pct(arr: number[], p: number) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[clampI(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
  },
};
const clampI = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const esc = (s: string) => s.replace(/[&<>\u0022']/g, c => c === "&" ? "&" : c === "<" ? "<" : c === ">" ? ">" : c === "\u0022" ? '\"' : "&#39;");


/* — Métriques dérivées (moteur d'analyse) — */

/** Proche d'un cap vertical (30/60/120/144/165/240) à ±4 % */
export function nearCap(fps: number): number | null {
  for (const cap of [30, 60, 120, 144, 165, 240]) if (Math.abs(fps - cap) / cap < 0.04) return cap;
  return null;
}
export function topPasses(scene: any, n = 10) {
  const p = (scene.gpuPasses ?? []).slice().sort((a: any, b: any) => b.ms - a.ms).slice(0, n);
  const total = p.reduce((s: number, x: any) => s + x.ms, 0);
  return p.map((x: any) => ({ ...x, share: x.ms / (scene.gpuPasses ?? [{ ms: 1 }]).reduce((s: number, q: any) => s + q.ms, 0) * 100, topTotalShare: x.ms / total * 100 }));
}
export function analysis(b: Bench) {
  const out: { sev: "good" | "warn" | "bad" | "info"; icon: string; html: string }[] = [];
  const A = (sev: "good" | "warn" | "bad" | "info", icon: string, html: string) => out.push({ sev, icon, html });

  // 1. Score global
  const s = b.score?.kerrScore ?? 0;
  A("info", "★", `<b>Score Kerr :</b> <b>${fmt.i(s)}</b> (référence ${esc(b.score?.reference ?? "?")}) → qualité recommandée <b>${esc(b.score?.recommendedQuality ?? "?")}</b>.`);

  // 2. Cap vertical dans le sweep qualité
  for (const [scn, set] of qualityByScene(b)) {
    for (const q of set) {
      const cap = nearCap(q.fps);
      if (cap && cap < 120) { A(q.fps < 25 ? "bad" : "warn", "⇩", `<span class="who">${b.id} · ${scn} (${q.quality})</span> : ${fmt.n(q.fps)} fps ≈ cap ${cap} Hz — la scène tourne à <b>${fmt.n(1000 / (cap ?? 1), 1)} ms/budget</b> mais est bridée par l'affichage, pas par le GPU.`); break; }
    }
    break; // suffisant sur la première scène
  }

  // 3. Bottleneck GPU par scène (auto mode)
  for (const sc of b.scenes.slice(0, 8)) {
    const tops = topPasses(sc, 3);
    if (!tops.length) continue;
    const t = tops[0];
    if (t.share > 45) A(t.share > 65 ? "bad" : "warn", "◆", `<span class="who">${b.id} · ${esc(sc.scene)}</span> : le pass « <b>${esc(t.pass)}</b> » monopolise <b>${fmt.n(t.share, 0)} %</b> du temps GPU (${fmt.ms(t.ms)}). C'est le goulot d'étranglement de cette scène.`);
  }

  // 4. Thermique
  if (b.thermal) {
    const d = b.thermal.driftPct;
    const sev = Math.abs(d) < 3 ? "good" : Math.abs(d) < 8 ? "warn" : "bad";
    A(sev, "🌡", `<span class="who">${b.id}</span> : dérive thermique <b>${d > 0 ? "+" : ""}${fmt.n(d)} %</b> (${fmt.n(b.thermal.firstMraysPerS, 2)} → ${fmt.n(b.thermal.lastMraysPerS, 2)} Mray/s) — ${Math.abs(d) < 3 ? "soutenabilité excellente" : "la cadence s'érode dans le temps"}.`);
  }

  // 5. Saccades (> 33 ms)
  const worst = b.scenes.map(sc => ({ sc, o: sc.auto?.over33 ?? 0, fr: sc.auto?.fps ?? 0 }))
    .sort((a, c) => c.o - a.o)[0];
  if (worst?.sc.auto) A(worst.o > 100 ? "bad" : worst.o > 20 ? "warn" : "good", "◔", `<span class="who">${b.id}</span> : ${worst.o > 0 ? `<b>${worst.o} frames > 33 ms</b>` : "aucune frame > 33 ms"} sur ${esc(worst.sc.scene)} (auto) — p95 ${fmt.ms(worst.sc.auto.p95)}.`);

  // 6. Chargement
  if (b.load?.firstImageMs) {
    const f = b.load.firstImageMs;
    const slowest = b.load.stages.slice().sort((a, c) => c.ms - a.ms)[0];
    A(f > 3000 ? "bad" : f > 1500 ? "warn" : "good", "⏱", `<span class="who">${b.id}</span> : première image en <b>${fmt.ms(f)}</b>${slowest ? `, dominé par « ${esc(slowest.label)} » (${fmt.ms(slowest.ms)})` : ""}.`);
  }

  // 7. Erreurs GPU / device lost
  const gerr = (b.errors as any)?.gpu ?? 0, lost = (b.errors as any)?.deviceLost ?? null;
  A(gerr === 0 && !lost ? "good" : "bad", "⚠", `<span class="who">${b.id}</span> : ${gerr} erreur(s) GPU${lost ? `, device lost « ${esc(String(lost))} »` : ", pas de device lost"} — ${gerr === 0 && !lost ? "run propre" : "à investiguer"}.`);

  // 8. Fluidité fine : part des frames ≤ 16,7 ms (à partir des intervals)
  const ivs = b.scenes.map(sc => sc.auto?.intervals ?? []).filter(i => i.length > 10);
  if (ivs.length) {
    const all = ivs.flat();
    const h = histogramFrom(all);
    const total = Object.values(h).reduce((x, y) => x + y, 0);
    const smooth = ((h["≤8.4"] ?? 0) + (h["≤16.7"] ?? 0)) / total * 100;
    A(smooth > 90 ? "good" : smooth > 60 ? "warn" : "bad", "▤", `<span class="who">${b.id}</span> : <b>${fmt.n(smooth, 0)} %</b> des frames mesurées sous 16,7 ms (sur ${fmt.i(total)} frames) — ${smooth > 90 ? "distribution très saine" : smooth > 60 ? "dans la moyenne, quelques pics" : "beaucoup de frames lentes"}.`);
  }

  // 9. Subsampling nécessaire pour tenir le cap
  for (const sc of b.scenes.slice(0, 8)) {
    const subs = subsamplingSeries(sc);
    if (!subs.length) continue;
    const best = subs.filter(s => s.fps >= 29).sort((x, y) => y.fps - x.fps)[0];
    const full = subs.find(s => s.sub === "1");
    if (full && best && best.sub !== "1") A("warn", "▤", `<span class="who">${b.id} · ${esc(sc.scene)}</span> : pleine résolution = <b>${fmt.n(full.fps)} fps</b>, il faut un subsampling <b>×${esc(best.sub)}</b> pour atteindre ${fmt.n(best.fps)} fps — l'accumulation d'échantillons coûte très cher sur ce GPU.`);
    break; // suffisant sur la première scène
  }

  return out;
}

export function qualityByScene(b: Bench) {
  const m = new Map<string, any[]>();
  for (const q of b.quality ?? []) {
    if (!m.has(q.scene)) m.set(q.scene, []);
    m.get(q.scene)!.push(q);
  }
  return m;
}


/* — Rendu SVG (pas de dépendance CDN) — */

/** Barres groupées : series = [{label, color, values: number[]}] */
export function groupedBars(labels: string[], series: { label: string; color: string; values: number[] }[], opts: { unit?: string; caps?: number[]; h?: number } = {}) {
  const W = Math.max(labels.length * (series.length * 26 + 26), 320), H = opts.h ?? 220;
  const max = Math.max(...series.flatMap(s => s.values), ...(opts.caps ?? []), 1) * 1.15;
  const padL = 42, padB = 34, padT = 10;
  const gw = (W - padL - 10) / labels.length;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 1; i <= 4; i++) {
    const y = padT + (H - padB - padT) * (1 - i / 4);
    out += `<line x1="${padL}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#232a3c" stroke-width="1"/><text x="${padL - 6}" y="${y + 3}" fill="#8b93ab" font-size="9" text-anchor="end">${fmt.i(max * i / 4)}</text>`;
  }
  labels.forEach((lb, i) => {
    const x0 = padL + gw * i;
    series.forEach((s, j) => {
      const v = s.values[i] ?? 0;
      const bh = (H - padB - padT) * v / max;
      const bw = Math.min(24, (gw - 8) / series.length - 2);
      const bx = x0 + 6 + j * ((gw - 8) / series.length);
      out += `<rect class="chart-el" data-series="${esc(s.label)}" data-tip="<b>${esc(s.label)}</b><br>${esc(lb)} : <b>${fmt.n(v)} ${esc(opts.unit ?? "")}</b>" x="${bx}" y="${H - padB - bh}" width="${bw}" height="${Math.max(bh, 0.5)}" rx="3" fill="${s.color}" opacity=".92"/>`;
    });
    if (opts.caps) opts.caps.forEach(cap => {
      const y = H - padB - (H - padB - padT) * cap / max;
      if (y > padT && cap <= max) out += `<line x1="${x0}" x2="${x0 + gw - 6}" y1="${y}" y2="${y}" stroke="#6fe08a" stroke-dasharray="3 3" stroke-width="1" opacity=".55"><title>cap ${cap} fps</title></line>`;
    });
    out += `<text x="${x0 + gw / 2}" y="${H - padB + 13}" fill="#8b93ab" font-size="9.5" text-anchor="middle">${esc(lb.length > 16 ? lb.slice(0, 15) + "…" : lb)}</text>`;
  });
  out += `<line x1="${padL}" x2="${W - 10}" y1="${H - padB}" y2="${H - padB}" stroke="#3a4358"/>`;
  return out + `</svg>`;
}

/** Barres horizontales : passes GPU */
export function passBars(sc: Bench, name: string, n = 10) {
  const scene = sc.scenes.find(s => s.scene === name);
  if (!scene) return `<p class="hint">scène absente</p>`;
  const tops = topPasses(scene, n);
  const max = tops[0]?.ms ?? 1;
  return tops.map(t => `
    <div class="passbar">
      <div class="lbl"><span>${esc(t.pass)}</span><span>${fmt.ms(t.ms)} · ${fmt.n(t.share, 0)} % du GPU</span></div>
      <div class="track" data-tip="<b>${esc(t.pass)}</b><br>${fmt.ms(t.ms)} · ${fmt.n(t.share, 0)} % du temps GPU<br><span style='opacity:.7'>${esc(sc.machineLabel || sc.id)} · ${esc(name)}</span>" style="cursor:crosshair"><div style="width:${t.ms / max * 100}%;background:${sc.color};border-radius:7px"></div></div>
    </div>`).join("");
}


export function worstOver33(b: Bench) { return Math.max(...(b.scenes ?? []).map(s => s.auto?.over33 ?? 0), 0); }
export function avgMrays(b: Bench) {
  const v = (b.scenes ?? []).map(s => s.auto?.mraysPerS ?? 0).filter(Boolean);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
}

export function crossFindings(a: Bench, b: Bench) {
  const out: { sev: "good" | "warn" | "bad" | "info"; icon: string; html: string }[] = [];
  // écart Mray/s
  const ra = avgMrays(a), rb = avgMrays(b);
  if (ra && rb) out.push({ sev: "info", icon: "◎", html: `<b>Débit rayons moyen (auto)</b> : ${fmt.n(rb, 1)} contre ${fmt.n(ra, 1)} Mray/s — écart ×${fmt.n(rb / ra, 1)} pour ${fmt.n(vpix(b) / vpix(a), 1)}× plus de pixels.` });
  // chargement
  if (a.load?.firstImageMs && b.load?.firstImageMs) {
    const fast = a.load.firstImageMs < b.load.firstImageMs ? a : b, slow = fast === a ? b : a;
    out.push({ sev: slow.load.firstImageMs > 3000 ? "bad" : "info", icon: "⏱", html: `<span class="who">${esc(fast.machineLabel || fast.id)}</span> affiche sa première image ${fmt.n(slow.load.firstImageMs / fast.load.firstImageMs, 1)}× plus vite (${fmt.ms(fast.load.firstImageMs)} contre ${fmt.ms(slow.load.firstImageMs)}) — attention aux compilations de shaders au premier lancement sur le côté lent.` });
  }
  // saccades
  const oa = worstOver33(a), ob = worstOver33(b);
  out.push({ sev: Math.min(oa, ob) === 0 ? "good" : "warn", icon: "◔", html: `<b>Fluidité</b> : pire scène > 33 ms — ${fmt.i(oa)} frames (${esc(a.machineLabel || a.id)}) contre ${fmt.i(ob)} (${esc(b.machineLabel || b.id)}).` });
  return out;
}
export function vpix(b: Bench) { return (b.run?.viewport ?? [1, 1, 1]).reduce((x, y) => x * y, 1) * (b.system.screen?.dpr ?? 1) ** 2; }


/* — Graphiques en ligne (frame-times, subsampling) — */

export interface LineSeries { label: string; color: string; points: number[]; dashed?: boolean; width?: number }

/** Décimation en préservant les pics (max par bucket) */
export function downsample(arr: number[], n = 320): number[] {
  if (arr.length <= n) return arr;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * arr.length / n), b = Math.max(a + 1, Math.floor((i + 1) * arr.length / n));
    out.push(Math.max(...arr.slice(a, b)));
  }
  return out;
}

/** Graphique en lignes — points = valeur par frame (x auto-numéroté) */
export function lineChart(series: LineSeries[], opts: { unit?: string; hLines?: { y: number; label: string }[]; h?: number; maxY?: number; xLabel?: string; maxP99?: boolean } = {}) {
  const W = 680, H = opts.h ?? 220, padL = 44, padB = 26, padT = 10, padR = 12;
  const pts = series.map(s => downsample(s.points));
  // maxP99 : échelle portée au 99ᵉ percentile (les outliers de démarrage n'écrasent plus le graphe)
  const allPts = pts.flat();
  const max = opts.maxY ?? (opts.maxP99
    ? Math.max(fmt.pct(allPts, 0.99), ...(opts.hLines ?? []).map(h => h.y)) * 1.12
    : Math.max(...allPts, ...(opts.hLines ?? []).map(h => h.y), 1) * 1.1);
  const N = Math.max(...pts.map(p => p.length), 2);
  // Interactivité : les données + la géométrie sont embarquées dans le SVG (crosshair + tooltip pilotés par app.ts)
  const enc = (o: any) => JSON.stringify(o).replace(/"/g, "&quot;");
  const geo = [padL, W - padL - padR, H - padB - padT, padT, H - padB];
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" data-chart="line" data-pts="${enc(pts)}" data-colors="${enc(series.map(s => s.color))}" data-labels="${enc(series.map(s => s.label))}" data-unit="${esc(opts.unit ?? "")}" data-max="${max}" data-geo="${geo.join(",")}" data-nsrc="${enc(series.map(s => s.points.length))}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`; // hitbox : les zones non peintes du SVG ne reçoivent pas d'événements
  for (let i = 1; i <= 4; i++) {
    const y = padT + (H - padB - padT) * (1 - i / 4);
    out += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#232a3c"/><text x="${padL - 6}" y="${y + 3}" fill="#8b93ab" font-size="9" text-anchor="end">${fmt.n(max * i / 4, max < 40 ? 1 : 0)}</text>`;
  }
  for (const hl of opts.hLines ?? []) {
    const y = H - padB - (H - padB - padT) * hl.y / max;
    if (y > padT) out += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#6fe08a" stroke-dasharray="4 3" opacity=".6"/><text x="${padL + 4}" y="${Math.max(y - 4, 8)}" fill="#6fe08a" font-size="9" text-anchor="start">${esc(hl.label)}</text>`;
  }
  pts.forEach((p, si) => {
    const s = series[si];
    const d = p.map((v, i) => {
      const vc = opts.maxP99 ? Math.min(v, max) : v; // clamp visuel des outliers
      return `${i ? "L" : "M"}${(padL + (W - padL - padR) * i / (p.length - 1)).toFixed(1)} ${(H - padB - (H - padB - padT) * vc / max).toFixed(1)}`;
    }).join(" ");
    out += `<path data-series="${esc(s.label)}" d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.2}"${s.dashed ? ' stroke-dasharray="5 4"' : ""} opacity=".9"/>`;
  });
  out += `<line class="xhair" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="#9aa3b8" stroke-dasharray="3 3" stroke-width="1" visibility="hidden"/>`;
  pts.forEach((p, si) => {
    out += `<circle class="xpt" data-i="${si}" r="3.4" fill="${series[si].color}" stroke="#07080c" stroke-width="1.5" visibility="hidden"/>`;
  });
  out += `<line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="#3a4358"/>`;
  out += `<text x="${padL}" y="${H - 6}" fill="#8b93ab" font-size="9">${esc((opts.xLabel ?? "") + (opts.xLabel ? " : " : ""))}0 → ${N}</text>`;
  return out + `</svg>`;
}

/** Histogramme des frame-times (buckets identiques au rapport : ≤8.4 / ≤16.7 / ≤33.4 / ≤50 / ≤100 / >100 ms) */
export const HIST_BUCKETS: [string, number][] = [["≤8.4", 8.4], ["≤16.7", 16.7], ["≤33.4", 33.4], ["≤50", 50], ["≤100", 100], [">100", Infinity]];
export function histogramFrom(intervals: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const v of intervals) {
    for (const [label, up] of HIST_BUCKETS) {
      if (v <= up) { h[label] = (h[label] ?? 0) + 1; break; }
    }
  }
  for (const [label] of HIST_BUCKETS) h[label] ??= 0;
  return h;
}
export function histBars(hists: { label: string; color: string; hist: Record<string, number> }[]) {
  const total = Math.max(...hists.map(h => Object.values(h.hist).reduce((a, b) => a + b, 0)), 1);
  return groupedBars(HIST_BUCKETS.map(([l]) => l), hists.map(h => ({ label: h.label, color: h.color, values: HIST_BUCKETS.map(([l]) => (h.hist[l] ?? 0) / total * 100) })), { unit: "% des frames", h: 200 });
}

/* — Séries subsampling / CPU — */

export interface SubPoint { sub: string; fps: number; mraysPerS: number; raysPerPx: number; over33: number }
export function subsamplingSeries(scene: any): SubPoint[] {
  return (scene.subsampling ?? []).map((t: any) => ({
    sub: String(t.subsampling), fps: t.fps ?? 0,
    mraysPerS: t.mraysPerS ?? 0, raysPerPx: t.raysPerPx ?? 0, over33: t.over33 ?? 0,
  }));
}
export function cpuSeries(scene: any) {
  return (scene.cpu ?? []).slice().sort((a: any, b: any) => b.ms - a.ms);
}
/** Matrice des features WebGPU (union, triée) */
export function featureMatrix(benches: Bench[]) {
  const set = new Set<string>();
  for (const b of benches) for (const f of b.system?.features ?? []) set.add(f);
  return [...set].sort().map(f => ({ feature: f, has: benches.map(b => (b.system?.features ?? []).includes(f)) }));
}
/** Matrice des limits WebGPU */
export function limitsMatrix(benches: Bench[]) {
  const keys = [...new Set(benches.flatMap(b => Object.keys(b.system?.limits ?? {})))];
  return keys.sort((a, b2) => Math.max(...benches.map(x => x.system?.limits?.[b2] ?? 0)) - Math.max(...benches.map(x => x.system?.limits?.[a] ?? 0)))
    .map(k => ({ limit: k, values: benches.map(b => b.system?.limits?.[k] ?? null) }));
}

/* — Comparatif subsampling par scène (auto, ×1 … ×8) — */

export const SUB_MODES = ["auto", "×1", "×2", "×3", "×4", "×6", "×8"] as const;
export type SubMode = (typeof SUB_MODES)[number];

/** Entrées subsampling d'une scène, indexées par libellé de mode (auto, ×1, ×2, ×3, ×4, ×6, ×8) */
export function subModes(scene: any): Map<SubMode, any> {
  const m = new Map<SubMode, any>();
  for (const t of scene?.subsampling ?? []) {
    const key = (t.subsampling === "auto" ? "auto" : `×${t.subsampling}`) as SubMode;
    m.set(key, t);
  }
  return m;
}

/** Ligne de métriques pour un mode donné : fps, p95, Mray/s, densité, résolution réelle */
export function subRow(mode: any) {
  if (!mode) return null;
  return {
    fps: mode.fps ?? 0,
    p95: mode.p95 ?? 0,
    p99: mode.p99 ?? 0,
    over33: mode.over33 ?? 0,
    mraysPerS: mode.mraysPerS ?? 0,
    raysPerPx: mode.raysPerPx ?? 0,
    frames: mode.frames ?? 0,
    gpuMean: mode.gpuMs?.mean ?? 0,
    gpuP95: mode.gpuMs?.p95 ?? 0,
    res: mode.width && mode.height ? `${mode.width}×${mode.height}` : "—",
    pr: mode.pixelRatio ?? null,
    dynamic: !!mode.dynamicResolution,
  };
}

/** Efficacité : fps par Mray/s dépensé, ou fps par ms GPU — coûteux à lire, décisif à comparer */
export function subEfficiency(scene: any, machineLabel: string) {
  const modes = subModes(scene);
  const rows = SUB_MODES.map(l => ({ mode: l, r: subRow(modes.get(l)) })).filter(x => x.r);
  const best = rows.slice().sort((a, b) => b.r!.fps - a.r!.fps)[0];
  return { rows, best };
}

/* — Verdict CPU-bound / GPU-bound par scène — */

export function cpuGpuVerdict(scene: any) {
  const cpuMs = (scene?.cpu ?? []).reduce((s: number, t: any) => s + (t.ms || 0), 0);
  const gpu = (scene?.auto?.gpu ?? []) as number[];
  const gpuMs = gpu.length > 10 ? fmt.pct(gpu, 0.5) : (scene?.gpuPasses ?? []).reduce((s: number, p: any) => s + (p.ms || 0), 0);
  const gpuShare = (gpuMs + cpuMs) > 0 ? gpuMs / (gpuMs + cpuMs) * 100 : 0;
  const verdict = gpuShare >= 70 ? "GPU-bound" : gpuShare <= 40 ? "CPU-bound" : "équilibré";
  return { cpuMs, gpuMs, gpuShare, verdict };
}

/* — Stabilité : jitter, spikes, p99.9 (depuis les intervals) — */

export function jitterStats(intervals: number[]) {
  const n = intervals.length;
  if (n < 10) return null;
  const med = fmt.pct(intervals, 0.5);
  const mean = intervals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return {
    median: med, mean, sd,
    jitterPct: sd / mean * 100,
    spikes: intervals.filter(v => v > 2 * med).length,
    p999: fmt.pct(intervals, 0.999),
    max: Math.max(...intervals),
  };
}

/* — Headroom : marge entre le fps réel et le cap de l'écran — */

export function headroom(b: Bench, scene: any) {
  const fps = scene?.auto?.fps || (scene?.fixed as any)?.fps || 0;
  const cap = nearCap(Math.max(...(b.scenes ?? []).map(s => (s.fixed as any)?.fps ?? 0), fps)) ?? 60;
  const c = Math.min(120, Math.max(0, fps / cap * 100));
  return { fps, cap, pct: c };
}

/* — Simulateur : quelle densité pour tenir N fps ? (loi de puissance sur la courbe subsampling) — */

/** régression log-log : y = k · x^a → predict(x) */
export function powerLaw(pts: [number, number][]) {
  const L = pts.filter(([x, y]) => x > 0 && y > 0).map(([x, y]) => [Math.log(x), Math.log(y)] as [number, number]);
  const n = L.length;
  if (n < 2) return null;
  const mx = L.reduce((s, [x]) => s + x, 0) / n, my = L.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of L) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const a = sxx ? sxy / sxx : 0;
  const logk = my - a * mx;
  return { a, k: Math.exp(logk), predict: (x: number) => Math.exp(logk + a * Math.log(x)), inv: (y: number) => Math.pow(y / Math.exp(logk), 1 / a) };
}

export interface SimResult {
  autoFps: number;
  fit: { a: number } | null;
  /** densité de rayons/px nécessaire pour tenir la cible (interpolation) — null si hors plage observée */
  neededRpp: number | null;
  /** mode d'accumulation le moins coûteux qui tient la cible */
  bestMode: { sub: string; fps: number; raysPerPx: number } | null;
  /** auto tient-il la cible ? */
  autoOk: boolean;
  /** plage fps observée sur les modes fixes (bornes de validité de l'interpolation) */
  range: [number, number] | null;
}

export function fpsSimulator(scene: any, targetFps: number): SimResult {
  const modes = (scene?.subsampling ?? []).filter((t: any) => t.subsampling !== "auto");
  const fit = powerLaw(modes.map((t: any) => [t.raysPerPx, t.fps] as [number, number]));
  const autoFps = scene?.auto?.fps ?? 0;
  const ok = modes.filter((t: any) => t.fps >= targetFps).sort((a: any, c: any) => c.raysPerPx - a.raysPerPx)[0];
  // l'interpolation n'a de sens que dans la plage fps observée (+10 % de tolérance) :
  // extrapoler une pente quasi-nulle (ex. Nvidia) produit des nombres absurdes
  const fpsList = modes.map((t: any) => t.fps).filter(Boolean);
  const range: [number, number] | null = fpsList.length >= 2 ? [Math.min(...fpsList), Math.max(...fpsList)] : null;
  const inRange = range != null && targetFps <= range[1] * 1.1 && targetFps >= range[0] * 0.9;
  return {
    autoFps,
    fit: fit ? { a: fit.a } : null,
    neededRpp: fit && inRange ? fit.inv(targetFps) : null,
    bestMode: ok ? { sub: `×${ok.subsampling}`, fps: ok.fps, raysPerPx: ok.raysPerPx } : null,
    autoOk: autoFps >= targetFps,
    range,
  };
}

/* — Tendances : regrouper les runs par machine, détecter les régressions — */

export function machineKey(b: Bench) {
  const label = (b.machineLabel || b.id).toLowerCase().replace(/-?\d{4}-\d{2}-\d{2}/g, "").replace(/[_\s]+/g, " ").trim();
  return label || `${b.system.gpu.vendor} ${b.system.gpu.architecture}`.toLowerCase();
}

export function groupRuns(benches: Bench[]) {
  const m = new Map<string, Bench[]>();
  for (const b of benches) {
    const k = machineKey(b);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(b);
  }
  for (const g of m.values()) g.sort((a, c) => (a.app?.date ?? "").localeCompare(c.app?.date ?? ""));
  return m;
}

export interface SceneDelta { scene: string; prev: number; last: number; deltaPct: number }

export function regressions(group: Bench[]): SceneDelta[] {
  if (group.length < 2) return [];
  const prev = group[group.length - 2], last = group[group.length - 1];
  return (last.scenes ?? []).map(sc => {
    const p = (prev.scenes ?? []).find(x => x.scene === sc.scene)?.auto?.fps ?? 0;
    const l = sc.auto?.fps ?? 0;
    return { scene: sc.scene, prev: p, last: l, deltaPct: p > 0 ? (l - p) / p * 100 : 0 };
  }).sort((a, b2) => a.deltaPct - b2.deltaPct);
}
