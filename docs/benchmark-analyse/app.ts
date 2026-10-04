/**
 * Kerr-Bench — outil d'analyse comparative des benchmarks black-hole-gpu.
 * Données : docs/bench-result-externes/*.json (copiés dans ./data/) — schéma « kerr-bench/1 ».
 * Usage : `bun serve.ts` — le glisser-déposer de fichiers JSON marche aussi.
 */
import type { Bench } from "./types.ts";
import {
  fmt, esc, nearCap, topPasses, analysis, qualityByScene,
  worstOver33, avgMrays, crossFindings, vpix,
  groupedBars, passBars, lineChart, histogramFrom, histBars,
  subsamplingSeries, cpuSeries, featureMatrix, limitsMatrix,
  SUB_MODES, subModes, subRow,
  cpuGpuVerdict, jitterStats, headroom, fpsSimulator, SimResult,
  machineKey, groupRuns, regressions,
} from "./analysis.ts";
import { renderDashboard } from "./dashboard.ts";

const COLORS = ["#ffb64d", "#5ec8ff", "#b78cff", "#6fe08a", "#ff6b6b", "#ffd166", "#f78fb3", "#4dd0e1"];
const QUALITIES = ["low", "medium", "high", "game", "realtime"];

/* — État — */
let benches: Bench[] = [];
const sel = new Set<string>();
let currentScene = 0;
let qualityScene = 0;

const el = (id: string) => document.getElementById(id)!;
const active = () => benches.filter(b => sel.has(b.id));

function showErr(msg: string) {
  const b = el("errBanner");
  b.hidden = false;
  b.textContent += (b.textContent ? "\n" : "") + msg;
}

/* ===== Moteur d'interactivité global =====
   Tooltip flottant sur tout [data-tip] + crosshair multi-séries sur les lineChart (svg[data-chart="line"]). */
const tip = document.createElement("div");
tip.id = "chartTip";
document.body.appendChild(tip);
function placeTip(e: PointerEvent) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hoverLine(svg: SVGElement, e: PointerEvent) {
  const r = svg.getBoundingClientRect();
  const [padL, plotW, plotH, padT] = (svg as any).dataset.geo.split(",").map(Number);
  const pts: number[][] = JSON.parse((svg as any).dataset.pts);
  const colors: string[] = JSON.parse((svg as any).dataset.colors);
  const labels: string[] = JSON.parse((svg as any).dataset.labels);
  const nsrc: number[] = JSON.parse((svg as any).dataset.nsrc);
  const max = +(svg as any).dataset.max, unit = (svg as any).dataset.unit;
  const n = pts[0]?.length ?? 0;
  if (!n) return;
  const xv = (e.clientX - r.left) / r.width * 680;
  const idx = Math.round((xv - padL) / plotW * (n - 1));
  const cx = padL + plotW * Math.max(0, Math.min(n - 1, idx)) / (n - 1);
  const xh = svg.querySelector(".xhair") as SVGLineElement | null;
  if (xh) { xh.setAttribute("x1", String(cx)); xh.setAttribute("x2", String(cx)); xh.setAttribute("visibility", "visible"); }
  svg.querySelectorAll(".xpt").forEach((c, i) => {
    const v = pts[i]?.[idx] ?? 0;
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(padT + plotH * (1 - Math.min(v, max) / max)));
    c.setAttribute("visibility", "visible");
  });
  const frame0 = Math.round(idx * (nsrc[0] ?? n) / n);
  tip.innerHTML = `<b>frame ≈ ${frame0}</b>` + pts.map((p, i) =>
    `<div class="tip-row"><span class="tip-dot" style="background:${colors[i]}"></span>${esc(labels[i])} <b>${fmt.n(p[idx] ?? 0, 1)} ${esc(unit)}</b></div>`).join("");
  tip.style.opacity = "1";
  placeTip(e);
}
function wireInteractivity() {
  document.addEventListener("pointermove", e => {
    const t = e.target as Element;
    const tipEl = t.closest?.("[data-tip]") as HTMLElement | null;
    if (tipEl) {
      tip.innerHTML = tipEl.dataset.tip!;
      tip.style.opacity = "1";
      placeTip(e);
      return;
    }
    const svg = t.closest?.("svg[data-chart='line']") as unknown as SVGElement | null;
    if (svg) { hoverLine(svg, e); return; }
    tip.style.opacity = "0";
  }, { passive: true });
  document.addEventListener("pointerleave", () => { tip.style.opacity = "0"; });
  // Clics délégués : navigation (planètes), bascule machine, toggle de séries en légende
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const goto = t.closest<HTMLElement>("[data-goto-view]");
    if (goto) {
      const si = goto.dataset.gotoScene;
      if (si != null && Number.isFinite(+si)) currentScene = +si;
      setView(goto.dataset.gotoView!);
      return;
    }
    const tog = t.closest<HTMLElement>("[data-toggle-machine]");
    if (tog) {
      const id = tog.dataset.toggleMachine!;
      if (sel.has(id) && active().length > 1) sel.delete(id);
      else sel.add(id);
      render();
      return;
    }
    const lt = t.closest<HTMLElement>("[data-series-toggle]");
    if (lt) {
      const name = lt.dataset.seriesToggle!;
      const card = lt.closest(".card") ?? document;
      const off = lt.classList.toggle("legend-off");
      card.querySelectorAll(`[data-series="${CSS.escape(name)}"]`).forEach(x => x.classList.toggle("series-off", off));
    }
  });
}
addEventListener("error", e => showErr((e as ErrorEvent).message));
addEventListener("unhandledrejection", e => showErr(String((e as PromiseRejectionEvent).reason)));

/* — Chargement — */
async function loadFromServer() {
  try {
    const list = await fetch("/api/benchs").then(r => r.json()) as string[];
    await loadUrls(list.map((f: string) => `/api/bench/${encodeURIComponent(f)}`), f => f.replace(/^.*kerr-bench-/, "").replace(/\.json$/, ""));
  } catch (e) {
    await loadFromDataCopies();
  }
}
async function loadFromDataCopies() {
  const files = ["kerr-bench-iPad-Pro-m1-2026-10-04.json", "kerr-bench-nvidia-2026-10-04.json"];
  await loadUrls(files.map(f => `./data/${f}`), u => u.replace(/^.*kerr-bench-/, "").replace(/\.json$/, ""));
}
async function loadUrls(urls: string[], nameOf: (u: string) => string) {
  const results = await Promise.all(urls.map(async u => {
    try { return { u, data: await fetch(u).then(r => { if (!r.ok) throw 0; return r.json(); }) }; }
    catch { return { u, data: null }; }
  }));
  for (const { u, data } of results) if (data) addBench(data, nameOf(u));
}

function addBench(data: any, name?: string) {
  if (!data || data.schema !== "kerr-bench/1") { console.warn("schéma inconnu", data?.schema); return; }
  const id = name || data.runId.slice(0, 8) || `bench${benches.length}`;
  if (benches.some(b => b.id === id)) return;
  // machineLabel absent dans certains runs → dérivé du nom de fichier (ex. « nvidia-2026-10-04 » → « Nvidia »)
  if (!data.machineLabel) {
    const raw = id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/[-_]+/g, " ").trim();
    data.machineLabel = raw.charAt(0).toUpperCase() + raw.slice(1) || `Bench ${benches.length + 1}`;
  }
  benches.push({ ...data, id, color: COLORS[benches.length % COLORS.length] });
  sel.add(id);
}
function removeBench(id: string) { benches = benches.filter(b => b.id !== id); sel.delete(id); render(); }

/* — Onglets des benches — */
function renderTabs() {
  el("benchTabs").innerHTML = benches.map(b =>
    `<div class="tab ${sel.has(b.id) ? "on" : ""}" data-id="${esc(b.id)}" title="cliquer pour (dés)activer la comparaison">
      <span class="dot" style="background:${b.color}"></span>${esc(b.machineLabel || b.id)} · ${fmt.i(b.score?.kerrScore ?? 0)}
      <span class="x" data-x="${esc(b.id)}" title="retirer">✕</span>
    </div>`).join("");
  el("benchTabs").querySelectorAll(".tab").forEach(t => t.addEventListener("click", e => {
    const id = (e.target as HTMLElement).dataset.x;
    if (id) { removeBench(id); return; }
    const tid = (t as HTMLElement).dataset.id!;
    sel.has(tid) ? sel.delete(tid) : sel.add(tid);
    render();
  }));
}

/* — Vue 1 : Vue d'ensemble — */
function renderOverview() {
  const act = active();
  el("overview").innerHTML = !act.length
    ? `<div class="loading">Aucun bench actif — importez un JSON ou rechargez.</div>`
    : `<div class="grid g3">${act.map(b => {
      const s = b.score?.kerrScore ?? 0, st = b.system;
      const cap = nearCap(fixedFps(b));
      return `<div class="card mcard" data-toggle-machine="${esc(b.id)}" data-tip="<b>${esc(b.machineLabel || b.id)}</b><br><span style='opacity:.7'>Cliquer pour retirer / remettre cette machine de la comparaison</span>" style="cursor:pointer">
        <div class="row" style="justify-content:space-between">
          <div><div class="mlabel" style="color:${b.color}">${esc(b.machineLabel || b.id)}</div>
          <div class="mtag">${esc(st.gpu.vendor)} · ${esc(st.gpu.architecture)} · ${st.cpuThreads} threads · ${esc(st.tier?.label ?? "")}</div></div>
          <span class="badge acc">${esc(b.score?.recommendedQuality ?? "?")}</span>
        </div>
        <div class="score">${fmt.i(s)} <small>pts · réf. 1000</small></div>
        <div class="scorebar"><div style="width:${Math.min(100, s / 3805 * 100)}%;background:${b.color}"></div></div>
        <div class="kv">
          <span class="k">Run</span><span class="v">${esc(b.runId?.slice(0, 8) ?? "")} · ${esc((b.app?.version ?? "").slice(0, 7))}</span>
          <span class="k">Viewport / DPR</span><span class="v">${(b.run?.viewport ?? [0, 0, 1]).join("×")} @${st.screen?.dpr ?? 1}x</span>
          <span class="k">1ʳᵉ image</span><span class="v">${fmt.ms(b.load?.firstImageMs ?? 0)}</span>
          <span class="k">Durée du run</span><span class="v">${fmt.i(b.durationS ?? 0)} s</span>
          <span class="k">VRAM max</span><span class="v">${fmt.i(b.peakVramMiB ?? 0)} MiB</span>
          <span class="k">Dérive thermique</span><span class="v">${b.thermal ? `${b.thermal.driftPct > 0 ? "+" : ""}${fmt.n(b.thermal.driftPct)} %` : "—"}</span>
          <span class="k">Rés. fixe max</span><span class="v">${fixedFps(b) ? fmt.n(fixedFps(b)) + " fps" + (cap ? ` ≈ cap ${cap} Hz` : "") : "—"}</span>
          <span class="k">Erreurs GPU</span><span class="v">${(b.errors as any)?.gpu ?? 0}</span>
          <span class="k">Navigateur</span><span class="v">${browserName(b)}</span>
        </div>
      </div>`;
    }).join("")}</div>
    <div class="card full" style="margin-top:16px">
      <h3>Score Kerr — comparaison</h3>
      <p class="hint">Référence : ${esc(act[0]?.score?.reference ?? "Apple M1 Max, Chrome (2026-10) = 1000")}</p>
      ${groupedBars(act.map(b => b.machineLabel || b.id), [{ label: "kerrScore", color: "#ffb64d", values: act.map(b => b.score?.kerrScore ?? 0) }], { unit: "pts" })}
      ${act.length === 2 ? `<p class="hint">Rapport : ×${fmt.n(Math.max(...act.map(b => b.score?.kerrScore ?? 0)) / Math.max(1, Math.min(...act.map(b => b.score?.kerrScore ?? 0))), 2)} entre les deux machines.</p>` : ""}
    </div>`;
}
function browserName(b: Bench) {
  const ua = b.system?.browser?.ua ?? "";
  return ua.includes("CriOS") ? "Chrome iOS (WebKit)" : ua.includes("Chrome") ? "Chrome" : ua.includes("Safari") ? "Safari/WebKit" : "?";
}
function fixedFps(b: Bench): number {
  return Math.max(...(b.scenes ?? []).map(s => (s.fixed as any)?.fps ?? 0), 0);
}

/* — Vue 2 : Comparaison — */
function renderCompare() {
  const act = active();
  if (!act.length) { el("compare").innerHTML = `<div class="loading">Aucun bench actif.</div>`; return; }
  const qbm = act.map(b => qualityByScene(b));
  const scenes = [...new Set(act.flatMap(b => (b.scenes ?? []).map(s => s.scene)))];
  const caps = [30, 60, 120, 144];

  el("compare").innerHTML = `
  <div class="card full">
    <h3>Sweep qualité — fps par scène × qualité</h3>
    <p class="hint">Pointillés verts = caps verticaux détectés (30/60/120/144 fps). <em>game</em> et <em>realtime</em> = profils du moteur.</p>
    <div class="row" style="margin-bottom:10px"><span class="hint">Scène :</span>
      <select id="qSel">${scenes.map((s, i) => `<option value="${i}" ${i === qualityScene ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
    </div>
    <div id="qChart"></div>
    <div class="legend">${act.map(b => `<span data-series-toggle="${esc(b.machineLabel || b.id)}" data-tip="Cliquer pour masquer / afficher <b>${esc(b.machineLabel || b.id)}</b>"><span class="sw" style="background:${b.color}"></span>${esc(b.machineLabel || b.id)}</span>`).join("")}<span><span class="sw" style="background:#6fe08a"></span>cap</span></div>
  </div>
  <div class="card full" style="margin-top:16px">
    <h3>Multiligne — fps par scène, machine par machine</h3>
    <p class="hint">Chaque ligne = une machine. Trait plein = mode auto, pointillé = résolution fixe (GPU brut, sans résolution dynamique). Une ligne plate sous un cap = bridée par l'affichage, pas par la scène.</p>
    ${multilineCompare(act, scenes, caps)}
    <div class="legend">${act.map(b => `<span><span class="sw" style="background:${b.color}"></span>${esc(b.machineLabel || b.id)} — plein : auto · pointillé : fixe</span>`).join("")}</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Débit rayons (Mray/s) — mode auto</h3><p class="hint">Résolution dynamique : chaque machine atteint son propre équilibre densité/cadence.</p>
      ${groupedBars(scenes.map(shortScene), [{ ...serName(act[0]), values: scenes.map(s => mrayScene(act[0], s)) }, { ...serName(act[1] ?? act[0]), values: act[1] ? scenes.map(s => mrayScene(act[1], s)) : [] }], { unit: "Mray/s" })}
    </div>
    <div class="card"><h3>Auto vs résolution fixe — fps</h3><p class="hint">Le mode auto maintient la cadence ; le mode fixe révèle le GPU brut.</p>
      ${groupedBars(scenes.map(shortScene), act.flatMap(b => [
        { label: `${b.machineLabel || b.id} · auto`, color: b.color, values: scenes.map(s => autoFps(b, s)) },
        { label: `${b.machineLabel || b.id} · fixe`, color: b.color, values: scenes.map(s => fixedSceneFps(b, s)) },
      ]), { unit: "fps", caps })}
    </div>
    <div class="card"><h3>Frames > 33 ms — pire scène (auto)</h3><p class="hint">Moins c'est mieux : comptage des saccades sur ~5 s de mesure.</p>
      ${groupedBars(act.map(b => b.machineLabel || b.id), [{ label: "over33", color: "#ff6b6b", values: act.map(b => worstOver33(b)) }], { unit: "frames" })}
    </div>
    <div class="card"><h3>Densité de rayons (raysPerPx) — sweep qualité</h3><p class="hint">Combien de rayons/pixel chaque qualité demande, sur la scène sélectionnée.</p>
      <div id="rppChart"></div>
    </div>
  </div>
  <div class="card full" style="margin-top:16px">
    <h3>Comparaison détaillée</h3>
    ${compareTable(act)}
  </div>
  <div class="grid g2" style="margin-top:16px">
    ${act.map(b => `<div class="card"><h3>Chargement — ${esc(b.machineLabel || b.id)}</h3>${passBarsLoad(b)}</div>`).join("")}
  </div>`;

  const qSel = el("qSel") as HTMLSelectElement;
  const drawQ = () => {
    const scn = scenes[+qSel.value];
    qualityScene = +qSel.value;
    el("qChart").innerHTML = groupedBars(QUALITIES, act.map(b => ({
      label: b.machineLabel || b.id, color: b.color,
      values: QUALITIES.map(q => (qbm[active().indexOf(b)].get(scn) ?? []).find(x => x.quality === q)?.fps ?? 0),
    })), { unit: "fps", caps });
    el("rppChart").innerHTML = groupedBars(QUALITIES, act.map(b => ({
      label: b.machineLabel || b.id, color: b.color,
      values: QUALITIES.map(q => (qbm[active().indexOf(b)].get(scn) ?? []).find(x => x.quality === q)?.raysPerPx ?? 0),
    })), { unit: "rayons/px" });
  };
  qSel.addEventListener("change", drawQ); drawQ();
}
function serName(b?: Bench) { return { label: b?.machineLabel || b?.id || "", color: b?.color ?? "#fff" }; }
/** Multiligne : une ligne par machine (auto plein, fixe pointillé), x = scènes */
function multilineCompare(act: Bench[], scenes: string[], caps: number[]) {
  const series = act.flatMap(b => [
    { label: `${b.machineLabel || b.id} · auto`, color: b.color, points: scenes.map(s => autoFps(b, s)), width: 2 },
    { label: `${b.machineLabel || b.id} · fixe`, color: b.color, points: scenes.map(s => fixedSceneFps(b, s)), dashed: true },
  ]);
  return lineChart(series, {
    unit: "fps", h: 260, xLabel: "scènes",
    hLines: caps.map(c => ({ y: c, label: `cap ${c}` })),
  });
}
function shortScene(s: string) { return s.replace("Interstellar: ", "Inter. ").replace(" (the film's close pass)", "").replace("Kerr a=0.94", "Kerr").replace(": approaching Gargantua", " → G.").replace(": backlit", "").replace(": an afternoon on the plains", "").replace("Miller: ", "Miller ").replace("Moon: ", "Lune ").replace("Ranger: ", "Ranger "); }
function mrayScene(b: Bench, s: string) { return (b.scenes ?? []).find(x => x.scene === s)?.auto?.mraysPerS ?? 0; }
function autoFps(b: Bench, s: string) { return (b.scenes ?? []).find(x => x.scene === s)?.auto?.fps ?? 0; }
function fixedSceneFps(b: Bench, s: string) { return ((b.scenes ?? []).find(x => x.scene === s)?.fixed as any)?.fps ?? 0; }
function passBarsLoad(b: Bench) {
  const st = b.load?.stages ?? [];
  const max = Math.max(...st.map(s => s.ms), 1);
  return `<p class="hint">1ʳᵉ image : <b>${fmt.ms(b.load?.firstImageMs ?? 0)}</b> — total étapes ${fmt.i((b.load?.stages ?? []).reduce((s, x) => s + x.ms, 0))} ms</p>` +
    st.slice().sort((a, c) => c.ms - a.ms).map(s => `
    <div class="passbar">
      <div class="lbl"><span>${esc(s.label)}</span><span>${fmt.ms(s.ms)}</span></div>
      <div class="track"><div style="width:${Math.max(s.ms / max * 100, .5)}%;background:${b.color};border-radius:7px"></div></div>
    </div>`).join("");
}
function compareTable(act: Bench[]) {
  const rows: [string, (b: Bench) => string, (b: Bench) => number][] = [
    ["Score Kerr", b => fmt.i(b.score?.kerrScore ?? 0), b => b.score?.kerrScore ?? 0],
    ["Qualité recommandée", b => esc(b.score?.recommendedQuality ?? "—"), () => 0],
    ["GPU", b => `${esc(b.system.gpu.vendor)} ${esc(b.system.gpu.architecture)}`, () => 0],
    ["Tier (guessed → mesuré)", b => `${b.system.tier?.guessed ?? "?"} → ${b.system.tier?.measured ?? "?"}`, b => b.system.tier?.measured ?? 0],
    ["Threads CPU", b => fmt.i(b.system.cpuThreads), b => b.system.cpuThreads],
    ["Viewport", b => (b.run?.viewport ?? []).join("×"), b => (b.run?.viewport ?? [0]).reduce((x, y) => x * y, 1)],
    ["Écran (gamut/HDR)", b => `${esc(b.system.screen?.gamut ?? "?")} / ${b.system.screen?.hdr ? "oui" : "non"}`, () => 0],
    ["1ʳᵉ image", b => fmt.ms(b.load?.firstImageMs ?? 0), b => b.load?.firstImageMs ?? 0],
    ["Durée run", b => `${fmt.i(b.durationS ?? 0)} s`, b => b.durationS ?? 0],
    ["VRAM max", b => `${fmt.i(b.peakVramMiB ?? 0)} MiB`, b => b.peakVramMiB ?? 0],
    ["Dérive thermique", b => `${b.thermal?.driftPct > 0 ? "+" : ""}${fmt.n(b.thermal?.driftPct ?? NaN)} %`, b => b.thermal?.driftPct ?? 0],
    ["Frames > 33 ms (pire scène)", b => fmt.i(worstOver33(b)), b => worstOver33(b)],
    ["Mray/s moyen (auto)", b => fmt.n(avgMrays(b), 1), b => avgMrays(b)],
    ["Pixels/frame (viewport×DPR²)", b => fmt.i(vpix(b)), b => vpix(b)],
    ["App / version", b => esc((b.app?.version ?? "").slice(0, 7)) + ` · ${esc(b.app?.mode ?? "")}`, () => 0],
    ["Erreurs GPU", b => fmt.i((b.errors as any)?.gpu ?? 0), b => (b.errors as any)?.gpu ?? 0],
  ];
  const [a, b] = act;
  return `<table class="cmp"><tr><th>Métrique</th>${act.map(m => `<th style="color:${m.color}">${esc(m.machineLabel || m.id)}</th>`).join("")}${a && b ? "<th>Δ (B vs A)</th>" : ""}</tr>` +
    rows.map(([label, show, num]) => {
      let diff = "";
      if (a && b) {
        const na = num(a), nb = num(b);
        if (na !== nb) diff = `<td class="diff ${nb > na ? "up" : "dn"}">${na === 0 ? "—" : `×${fmt.n(nb / na, 1)}`}</td>`;
      }
      return `<tr><td>${label}</td>${act.map(m => `<td class="num">${show(m)}</td>`).join("")}${a && b ? diff : ""}</tr>`;
    }).join("") + `</table>`;
}

/* — Vue 3 : Scènes — */
function renderScene() {
  const act = active();
  if (!act.length) { el("scene").innerHTML = `<div class="loading">Aucun bench actif.</div>`; return; }
  const scenes = [...new Set(act.flatMap(b => (b.scenes ?? []).map(s => s.scene)))];
  if (currentScene >= scenes.length) currentScene = 0;

  el("scene").innerHTML = `
  <div class="card full">
    <div class="row" style="justify-content:space-between">
      <div class="row"><h3 style="margin:0">Explorateur de scène</h3>
      <select id="sSel">${scenes.map((s, i) => `<option value="${i}" ${i === currentScene ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      <span class="hint">frame-times, histogramme, subsampling, passes GPU, CPU — tout est mesuré sur ~5 s par mode</span>
    </div>
  </div>
  <div class="grid g3" style="margin-top:16px" id="sCards"></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Frame-time CPU → GPU (ms par frame)</h3><p class="hint">Intervalle entre frames (mode auto). Pointillé = seuil 33 ms (> 30 fps impossible).</p><div id="tIntervals"></div></div>
    <div class="card"><h3>Temps GPU par frame (ms)</h3><p class="hint">Somme des passes GPU mesurée par frame (timestamps WebGPU).</p><div id="tGpu"></div></div>
  </div>
  <div class="card full" style="margin-top:16px"><h3>Distribution des frame-times</h3><p class="hint">Buckets identiques au rapport. Le mode auto recale la machine sur son cap.</p><div id="sHist"></div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Subsampling — fps</h3><p class="hint">Accumulation ×N : fps en fonction du facteur d'accumulation (1 = pleine résolution).</p><div id="sSub"></div></div>
    <div class="card"><h3>Subsampling — Mray/s</h3><p class="hint">Débit de rayons selon l'accumulation.</p><div id="sSubMrays"></div></div>
  </div>
  <div class="card full" style="margin-top:16px"><h3>Passes GPU — top 10 (auto)</h3><div class="grid g2" id="sPasses" style="gap:24px"></div></div>
  <div class="card full" style="margin-top:16px"><h3>Temps CPU par tâche (ms/frame)</h3><div class="grid g2" id="sCpu" style="gap:24px"></div></div>`;

  const sSel = el("sSel") as HTMLSelectElement;
  sSel.addEventListener("change", () => { currentScene = +sSel.value; drawScene(scenes[+sSel.value]); });
  drawScene(scenes[currentScene]);
}
function drawScene(scn: string) {
  const act = active();
  const data = act.map(b => ({ b, sc: (b.scenes ?? []).find(s => s.scene === scn) }));

  el("sCards").innerHTML = data.map(({ b, sc }) => {
    const a = sc?.auto as any, fix = sc?.fixed as any, still = sc?.still as any;
    const v = cpuGpuVerdict(sc);
    const j = jitterStats(a?.intervals ?? []);
    const hr = headroom(b, sc);
    const vIcon = v.verdict === "GPU-bound" ? "◆" : v.verdict === "CPU-bound" ? "⚙" : "⚖";
    const vCls = v.verdict === "GPU-bound" ? "acc" : v.verdict === "CPU-bound" ? "warn" : "ok";
    return `<div class="card">
      <h3 style="color:${b.color}">${esc(b.machineLabel || b.id)}</h3>
      <div class="row" style="margin:6px 0"><span class="badge acc">auto</span><span class="badge ${a?.over33 ? "warn" : "ok"}">${a ? fmt.n(a.fps) : "—"} fps</span>${a ? `<span class="badge">p95 ${fmt.ms(a.p95)}</span><span class="badge">p99 ${fmt.ms(a.p99)}</span>` : ""}</div>
      <div class="row" style="margin:2px 0 8px">
        <span class="badge ${vCls}" data-tip="<b>${v.verdict}</b><br>Temps GPU : <b>${fmt.n(v.gpuMs, 2)} ms/frame</b> (médiane)<br>Temps CPU : <b>${fmt.n(v.cpuMs, 2)} ms/frame</b><br>→ le GPU absorbe <b>${fmt.n(v.gpuShare, 0)} %</b> du frame budget${v.verdict === "GPU-bound" ? "<br><span style='opacity:.7'>Le shader est le goulot — optimiser le ray-tracer</span>" : v.verdict === "CPU-bound" ? "<br><span style='opacity:.7'>Le game code limite — profiler l'encodage / la logique</span>" : ""}">${vIcon} ${v.verdict} · GPU ${fmt.n(v.gpuShare, 0)} %</span>
        ${j ? `<span class="badge ${j.jitterPct < 15 ? "ok" : "warn"}" data-tip="<b>Stabilité</b><br>Jitter : <b>±${fmt.n(j.jitterPct, 0)} %</b> (σ ${fmt.n(j.sd, 1)} ms)<br>Spikes (> 2× médiane) : <b>${j.spikes}</b><br>p99.9 : ${fmt.ms(j.p999)} · max ${fmt.ms(j.max)}">jitter ±${fmt.n(j.jitterPct, 0)} % · ${j.spikes} spike${j.spikes > 1 ? "s" : ""}</span>` : ""}
      </div>
      <div class="kv">
        <span class="k">rayons / pixel</span><span class="v">${a ? fmt.n(a.raysPerPx, 4) : "—"}</span>
        <span class="k">Mray/s</span><span class="v">${a ? fmt.n(a.mraysPerS, 2) : "—"}</span>
        <span class="k">rayons / frame</span><span class="v">${a ? fmt.i(a.raysPerFrame) : "—"}</span>
        <span class="k">frames mesurées</span><span class="v">${a ? `${fmt.i(a.frames ?? a.intervals?.length ?? 0)} / ${fmt.n(a.spanMs ?? 0, 0)} ms` : "—"}</span>
        <span class="k">> 33 ms</span><span class="v">${a ? fmt.i(a.over33) : "—"} frames</span>
        <span class="k">VRAM scène</span><span class="v">${sc ? fmt.i(sc.vramMiB) : "—"} MiB</span>
        <span class="k">pire boucle CPU</span><span class="v">${sc ? fmt.ms(sc.worstLoopMs) : "—"}</span>
        <span class="k">long tasks</span><span class="v">${sc ? fmt.i(sc.longTasks) : "—"}</span>
      </div>
      ${hr ? `<div class="note" style="margin:10px 0 0;padding:8px 12px;font-size:.8rem" data-tip="<b>Marge vs cap ${hr.cap} Hz</b><br>${fmt.n(hr.fps)} fps / ${hr.cap} Hz = <b>${fmt.n(hr.pct, 0)} %</b> du budget d'affichage consommé">◎ Marge : <b>${fmt.n(hr.pct, 0)} %</b> du cap ${hr.cap} Hz utilisé${hr.pct > 95 ? " — <b>au bord du cap</b>" : hr.pct < 50 ? " — large marge" : ""}</div>` : ""}
      <div class="row" style="margin-top:10px;gap:6px">
        ${fix ? `<span class="badge ok">fixe</span><span class="hint mono">${fix.width}×${fix.height} — ${fmt.n(fix.fps)} fps · ${fmt.n(fix.mraysPerS, 1)} Mray/s · p95 ${fmt.ms(fix.p95)}</span>` : ""}
      </div>
      ${still ? `<div class="row" style="margin-top:6px"><span class="badge">still</span><span class="hint">convergence ${fmt.ms(still.convergeMs)} · spp ${fmt.i(still.spp)}</span></div>` : ""}
    </div>`;
  }).join("");

  // Timelines
  const hasIv = data.some(({ sc }) => (sc?.auto?.intervals ?? []).length > 10);
  el("tIntervals").innerHTML = hasIv
    ? lineChart(data.filter(d => (d.sc?.auto?.intervals ?? []).length > 10).map(({ b, sc }) => ({ label: b.machineLabel || b.id, color: b.color, points: sc!.auto!.intervals! })), { unit: "ms", hLines: [{ y: 33, label: "33 ms (30 fps)" }], h: 200 })
    : `<p class="hint">pas de données d'intervalles</p>`;
  const hasGpu = data.some(({ sc }) => Array.isArray((sc?.auto as any)?.gpu) && ((sc!.auto as any).gpu).length > 10);
  el("tGpu").innerHTML = hasGpu
    ? lineChart(data.filter(d => Array.isArray((d.sc?.auto as any)?.gpu) && ((d.sc!.auto as any).gpu).length > 10).map(({ b, sc }) => ({ label: b.machineLabel || b.id, color: b.color, points: (sc!.auto as any).gpu as number[] })), { unit: "ms", h: 200 })
    : `<p class="hint">pas de mesures GPU par frame</p>`;

  // Histogrammes (calculés depuis les intervals)
  const ivData = data.filter(d => (d.sc?.auto?.intervals ?? []).length > 10);
  el("sHist").innerHTML = ivData.length
    ? histBars(ivData.map(({ b, sc }) => ({ label: b.machineLabel || b.id, color: b.color, hist: histogramFrom(sc!.auto!.intervals!) })))
    : `<p class="hint">pas de données</p>`;

  // Subsampling
  const subData = data.map(({ b, sc }) => ({ b, subs: subsamplingSeries(sc) })).filter(d => d.subs.length);
  el("sSub").innerHTML = subData.length
    ? lineChart(subData.map(({ b, subs }) => ({ label: b.machineLabel || b.id, color: b.color, points: subs.map(s => s.fps) })), { unit: "fps", h: 200 })
    : `<p class="hint">pas de données</p>`;
  el("sSubMrays").innerHTML = subData.length
    ? lineChart(subData.map(({ b, subs }) => ({ label: b.machineLabel || b.id, color: b.color, points: subs.map(s => s.mraysPerS) })), { unit: "Mray/s", h: 200 })
    : `<p class="hint">pas de données</p>`;

  // Passes GPU
  el("sPasses").innerHTML = data.map(({ b, sc }) => sc
    ? `<div><div class="hint" style="margin-bottom:8px"><b style="color:${b.color}">${esc(b.machineLabel || b.id)}</b> — ${fmt.n((sc.gpuPasses ?? []).reduce((s, p: any) => s + p.ms, 0), 2)} ms total GPU</div>${passBars(b, scn)}</div>`
    : `<div><p class="hint">pas de données</p></div>`).join("");

  // CPU
  el("sCpu").innerHTML = data.map(({ b, sc }) => {
    const tasks = cpuSeries(sc);
    if (!tasks.length) return `<div><p class="hint">pas de données</p></div>`;
    const max = tasks[0].ms;
    return `<div><div class="hint" style="margin-bottom:8px"><b style="color:${b.color}">${esc(b.machineLabel || b.id)}</b> — total ${fmt.n(tasks.reduce((s, t) => s + t.ms, 0), 2)} ms/frame</div>` +
      tasks.slice(0, 8).map(t => `
      <div class="passbar">
        <div class="lbl"><span>${esc(t.label)}</span><span>${fmt.n(t.ms, 2)} ms (max ${fmt.n(t.max, 1)})</span></div>
        <div class="track"><div style="width:${Math.max(t.ms / max * 100, .5)}%;background:${b.color};border-radius:7px"></div></div>
      </div>`).join("") + `</div>`;
  }).join("");
}

/* — Vue 4 : Subsampling (auto, ×1…×8 par scène) — */
let subScene = 0;
function renderSubs() {
  const act = active();
  if (!act.length) { el("subs").innerHTML = `<div class="loading">Aucun bench actif.</div>`; return; }
  const scenes = [...new Set(act.flatMap(b => (b.scenes ?? []).map(s => s.scene)))];
  if (subScene >= scenes.length) subScene = 0;
  const caps = [30, 60, 120, 144];

  // Petits multiples : un mini-graphe fps par scène
  const multiples = scenes.map(scn => {
    const per = act.map(b => ({ b, modes: subModes((b.scenes ?? []).find(s => s.scene === scn)) }));
    return `<div class="card"><h4 style="margin:0 0 2px;color:var(--dim);font-size:.82rem">${esc(scn)}</h4>
      ${groupedBars([...SUB_MODES], per.map(({ b, modes }) => ({
        label: b.machineLabel || b.id, color: b.color,
        values: SUB_MODES.map(m => subRow(modes.get(m))?.fps ?? 0),
      })), { unit: "fps", caps, h: 150 })}</div>`;
  }).join("");

  const scn = scenes[subScene];
  const per = act.map(b => ({ b, modes: subModes((b.scenes ?? []).find(s => s.scene === scn)) }));
  const metrics: [string, (r: any) => number, string][] = [
    ["fps", (r: any) => r.fps, "fps"],
    ["Mray/s", (r: any) => r.mraysPerS, "Mray/s"],
    ["p95 frame-time", (r: any) => r.p95, "ms"],
    ["frames > 33 ms", (r: any) => r.over33, "frames"],
  ];

  // Graphiques de détail construits hors template (évite les imbrications profondes)
  const metricCharts = metrics.map(([name, pick, unit]) => {
    const series = per.map(({ b, modes }) => ({
      label: b.machineLabel || b.id, color: b.color,
      values: SUB_MODES.map(m => pick(subRow(modes.get(m)) ?? {}) || 0),
    }));
    return `<div><div class="hint" style="margin-bottom:4px"><b>${name}</b> par mode</div>${groupedBars([...SUB_MODES], series, { unit, caps, h: 170 })}</div>`;
  }).join("");

  el("subs").innerHTML = `
  <div class="card full">
    <h3>Subsampling — vue d'ensemble des 8 scènes</h3>
    <p class="hint">fps par mode d'accumulation (auto, ×1, ×2, ×3, ×4, ×6, ×8) sur chaque scène. Pointillés verts = caps verticaux. L'accumulation ×N rend N× plus cher — le mode « auto » adapte la densité dynamiquement.</p>
    <div class="grid g3" style="gap:12px">${multiples}</div>
  </div>
  <div class="card full" style="margin-top:16px">
    <div class="row" style="justify-content:space-between">
      <h3 style="margin:0">Comparatif détaillé — <span style="color:var(--acc)">${esc(scn)}</span></h3>
      <div class="row"><span class="hint">Scène :</span>
      <select id="subSel">${scenes.map((s, i) => `<option value="${i}" ${i === subScene ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
    </div>
    <div class="grid g2" style="margin-top:12px;gap:24px">${metricCharts}</div>
  </div>
  <div class="card full" style="margin-top:16px">
    <h3>Tableau complet — <span style="color:var(--acc)">${esc(scn)}</span></h3>
    ${per.map(({ b, modes }) => {
      const rows = SUB_MODES.map(m => ({ m, r: subRow(modes.get(m)) }));
      return `<div style="margin-top:14px"><div class="hint" style="margin-bottom:6px"><b style="color:${b.color}">${esc(b.machineLabel || b.id)}</b></div>
      <table class="cmp"><tr><th>Mode</th><th class="num">fps</th><th class="num">p50</th><th class="num">p95</th><th class="num">p99</th><th class="num">> 33 ms</th><th class="num">Mray/s</th><th class="num">rayons/px</th><th class="num">GPU moyen</th><th class="num">Résolution réelle</th></tr>
      ${rows.map(({ m, r }) => !r ? `<tr><td>${m}</td><td colspan="9" style="color:var(--dim)">—</td></tr>` :
        `<tr><td><b>${m}</b>${r.dynamic ? ` <span class="badge acc" style="font-size:.68rem;padding:1px 8px">dyn</span>` : ""}</td>
          <td class="num">${fmt.n(r.fps)}</td><td class="num">${fmt.ms(r.p95 ? r.p95 : r.fps ? 1000 / r.fps : 0)}</td>
          <td class="num">${fmt.ms(r.p95)}</td><td class="num">${fmt.ms(r.p99)}</td>
          <td class="num ${r.over33 ? "" : ""}">${fmt.i(r.over33)}</td>
          <td class="num">${fmt.n(r.mraysPerS, 1)}</td><td class="num">${fmt.n(r.raysPerPx, 4)}</td>
          <td class="num">${fmt.ms(r.gpuMean)}</td>
          <td class="num">${r.res}${r.pr ? ` @${r.pr}x` : ""}</td></tr>`).join("")}
      </table></div>`;
    }).join("")}
  </div>
  <div class="card full" style="margin-top:16px">
    <h3>Simulateur de budget frame</h3>
    <p class="hint">À partir de la courbe subsampling (régression log-log fps vs densité de rayons) : quelle densité faut-il pour tenir une cible fps ? Et quel mode d'accumulation y arrive déjà ?</p>
    <div class="row" style="margin:8px 0 14px">
      <span class="hint" style="font-size:.85rem">Cible :</span>
      <input id="simFps" type="range" min="10" max="144" step="1" value="60" style="flex:1;max-width:420px">
      <span class="badge acc" id="simOut">60 fps</span>
    </div>
    <div class="grid g2" style="gap:24px" id="simResults"></div>
  </div>`;

  const subSel = el("subSel") as HTMLSelectElement;
  subSel.addEventListener("change", () => { subScene = +subSel.value; renderSubs(); });

  // Simulateur interactif
  const simFps = el("simFps") as HTMLInputElement;
  const simOut = el("simOut");
  const drawSim = () => {
    const target = +simFps.value;
    simOut.textContent = `${target} fps`;
    const scn = scenes[subScene];
    el("simResults").innerHTML = act.map(b => {
      const sc = (b.scenes ?? []).find(s => s.scene === scn);
      const r = fpsSimulator(sc, target);
      const ok = r.bestMode || r.autoOk;
      const modeTxt = r.autoOk
        ? `<span class="badge ok">auto tient (${fmt.n(r.autoFps)} fps)</span> ${r.bestMode ? `· mode fixe le moins cher : <b>${r.bestMode.sub}</b>` : ""}`
        : r.bestMode
          ? `<span class="badge warn">auto insuffisant (${fmt.n(r.autoFps)} fps)</span> · mode à forcer : <b>${r.bestMode.sub}</b>`
          : `<span class="badge bad">aucun mode ne tient la cible</span>`;
      const dens = r.neededRpp != null && Number.isFinite(r.neededRpp)
        ? `Densité requise : <b>${fmt.n(r.neededRpp, 4)} rayon/px</b>${r.fit ? ` <span class="hint">(loi y = k·x^${fmt.n(r.fit.a, 2)})</span>` : ""}`
        : `Densité requise : — <span class="hint">(hors plage mesurée${r.range ? ` : ${fmt.n(r.range[0], 0)}–${fmt.n(r.range[1], 0)} fps` : ""})</span>`;
      return `<div>
        <div class="hint" style="margin-bottom:6px"><b style="color:${b.color}">${esc(b.machineLabel || b.id)}</b></div>
        <div style="font-size:.88rem;line-height:1.7">${modeTxt}<br>${dens}</div>
      </div>`;
    }).join("");
  };
  simFps.addEventListener("input", drawSim);
  drawSim();
}

/* — Vue 5 : Analyse — */
function renderAnalyse() {
  const act = active();
  if (!act.length) { el("analyse").innerHTML = `<div class="loading">Aucun bench actif.</div>`; return; }
  el("analyse").innerHTML = act.map(b => `
    <div class="card full" style="margin-bottom:16px">
      <h3 style="color:${b.color}">Analyse automatique — ${esc(b.machineLabel || b.id)}</h3>
      ${analysis(b).map(f => `<div class="finding sev-${f.sev}"><div class="icon">${f.icon}</div><div>${f.html}</div></div>`).join("")}
    </div>`).join("");
  if (act.length === 2) {
    const [a, b] = act;
    const ratio = (b.score?.kerrScore ?? 1) / Math.max(1, a.score?.kerrScore ?? 1);
    el("analyse").innerHTML += `<div class="card full">
      <h3>Synthèse comparative</h3>
      <div class="finding sev-info"><div class="icon">⚖</div><div><span class="who">${esc(b.machineLabel || b.id)}</span> est <b>×${fmt.n(ratio, 2)}</b> plus rapide que <span class="who">${esc(a.machineLabel || a.id)}</span> au score Kerr global.</div></div>
      ${crossFindings(a, b).map(f => `<div class="finding sev-${f.sev}"><div class="icon">${f.icon}</div><div>${f.html}</div></div>`).join("")}
    </div>`;
  }
}

/* — Vue 6 : Tendances (historique multi-runs par machine) — */
function renderTrends() {
  const groups = groupRuns(benches.filter(b => sel.has(b.id)));
  const tracked = [...groups.entries()].filter(([, g]) => g.length >= 2);
  const singles = [...groups.entries()].filter(([, g]) => g.length === 1);

  el("trends").innerHTML = `
  <div class="card full">
    <h3>Tendances — suivi des runs dans le temps</h3>
    <p class="hint">Les runs sont regroupés par machine (même machineLabel, dates différentes). Pour suivre l'évolution de ton moteur, nomme tes fichiers <code>kerr-bench-&#60;machine&#62;-&#60;date&#62;.json</code> et laisse le même label — chaque nouveau run enrichira ces courbes.</p>
    ${tracked.length ? `` : `<div class="note">Aucune machine n'a encore <b>2 runs ou plus</b> chargés (les 2 runs actuels sont de machines différentes). Dès qu'un second run d'une même machine sera importé, cette vue affichera les courbes d'évolution et les régressions par scène.</div>`}
  </div>
  ${tracked.map(([key, g]) => {
    const scores = g.map(b => b.score?.kerrScore ?? 0);
    const mrs = g.map(b => avgMrays(b));
    const deltas = regressions(g);
    const scoreDelta = scores.length >= 2 ? (scores[scores.length - 1] - scores[scores.length - 2]) / Math.max(1, scores[scores.length - 2]) * 100 : 0;
    return `<div class="grid g2" style="margin-top:14px">
      <div class="card">
        <h3 style="color:${g[g.length - 1].color}">${esc(key)} — ${g.length} runs</h3>
        ${lineChart([{ label: "score Kerr", color: g[g.length - 1].color, points: scores, width: 2 }], { unit: "pts", h: 170, xLabel: "runs" })}
        <div class="kv" style="margin-top:8px">
          <span class="k">Score Kerr</span><span class="v">${scores.map(s => fmt.i(s)).join(" → ")} <span class="diff ${scoreDelta >= 0 ? "up" : "dn"}">${scoreDelta >= 0 ? "+" : ""}${fmt.n(scoreDelta, 1)} %</span></span>
          <span class="k">Mray/s moyen</span><span class="v">${mrs.map(x => fmt.n(x, 1)).join(" → ")}</span>
          <span class="k">Dates</span><span class="v">${g.map(b => esc((b.app?.date ?? "").slice(0, 10))).join(" → ")}</span>
        </div>
      </div>
      <div class="card">
        <h3>Régressions / gains par scène (dernier run vs précédent)</h3>
        <table class="cmp"><tr><th>Scène</th><th class="num">Avant</th><th class="num">Après</th><th class="num">Δ</th></tr>
        ${deltas.map(d => `<tr><td>${esc(shortScene(d.scene))}</td><td class="num">${fmt.n(d.prev)} fps</td><td class="num">${fmt.n(d.last)} fps</td><td class="num diff ${d.deltaPct >= -1 ? "up" : d.deltaPct <= -5 ? "dn" : ""}">${d.deltaPct >= 0 ? "+" : ""}${fmt.n(d.deltaPct, 1)} %</td></tr>`).join("")}
        </table>
      </div>
    </div>`;
  }).join("")}
  ${singles.length ? `<div class="card full" style="margin-top:14px"><h3>Machines avec un seul run (pas de tendance encore)</h3><div class="chips">${singles.map(([k, g]) => `<span class="chip" data-tip="run du ${esc((g[0].app?.date ?? "").slice(0, 10))}">${esc(k)} · ${fmt.i(g[0].score?.kerrScore ?? 0)} pts</span>`).join("")}</div></div>` : ""}`;
}

/* — Vue 7 : Données brutes — */
function renderData() {
  const act = active();
  if (!act.length) { el("data").innerHTML = `<div class="loading">Aucun bench actif.</div>`; return; }
  const feats = featureMatrix(act), limits = limitsMatrix(act);
  const sysRows: [string, (b: Bench) => string][] = [
    ["runId", b => esc((b.runId ?? "").slice(0, 13)) + "…"],
    ["machineLabel", b => esc(b.machineLabel || b.id)],
    ["app.version / date", b => esc((b.app?.version ?? "").slice(0, 7)) + " · " + esc(b.app?.date ?? "")],
    ["app.mode / url", b => esc(b.app?.mode ?? "") + (b.app?.url ? ` · <a href="${esc(b.app.url)}" target="_blank" rel="noopener">${esc(b.app.url)}</a>` : "")],
    ["gpu.vendor / arch / device", b => esc(b.system.gpu.vendor) + " / " + esc(b.system.gpu.architecture) + " / " + esc(b.system.gpu.device || "—")],
    ["gpu.fallback", b => b.system.gpu.fallback ? "oui" : "non"],
    ["browser.ua", b => `<span style="word-break:break-all">${esc(b.system.browser?.ua ?? "")}</span>`],
    ["browser.platform / mobile", b => esc(b.system.browser?.platform ?? "") + " / " + (b.system.browser?.mobile ? "mobile" : "desktop")],
    ["screen.css / dpr", b => (b.system.screen?.css ?? []).join("×") + ` @${b.system.screen?.dpr ?? "?"}x`],
    ["screen.gamut / hdr", b => esc(b.system.screen?.gamut ?? "?") + " / " + (b.system.screen?.hdr ? "oui" : "non")],
    ["cpuThreads / deviceMemory", b => fmt.i(b.system.cpuThreads) + " / " + (b.system.deviceMemoryGB != null ? b.system.deviceMemoryGB + " Go" : "—")],
    ["tier guessed / measured", b => `${b.system.tier?.guessed ?? "?"} / ${b.system.tier?.measured ?? "?"}`],
    ["run.viewport", b => (b.run?.viewport ?? []).join("×")],
    ["run.subsamplings", b => (b.run?.subsamplings ?? []).join(", ")],
    ["run.sweepWarmMs / sweepMs / shots", b => `${fmt.i(b.run?.sweepWarmMs ?? 0)} / ${fmt.i(b.run?.sweepMs ?? 0)} / ${b.run?.shots ? "oui" : "non"}`],
    ["durationS", b => fmt.i(b.durationS ?? 0) + " s"],
    ["peakVramMiB", b => fmt.n(b.peakVramMiB ?? 0, 1)],
    ["errors", b => `gpu: ${(b.errors as any)?.gpu ?? 0} · caught: ${fmt.i((Object.values((b.errors as any)?.caught ?? {}) as number[]).reduce((x, y) => x + (Number(y) || 0), 0))} · deviceLost: ${esc(String((b.errors as any)?.deviceLost ?? "non"))}`],
  ];
  const sysTable = `<table class="cmp"><tr><th>Champ</th>${act.map(m => `<th style="color:${m.color}">${esc(m.machineLabel || m.id)}</th>`).join("")}</tr>` +
    sysRows.map(([label, show]) => `<tr><td>${label}</td>${act.map(m => `<td class="num">${show(m)}</td>`).join("")}</tr>`).join("") + `</table>`;
  el("data").innerHTML = `
  <div class="card full"><h3>Configuration système (tout le rapport)</h3>
    <div style="overflow-x:auto">${sysTable}</div>
  </div>
  <div class="card full" style="margin-top:16px"><h3>Features WebGPU (${feats.length} au total)</h3>
    <p class="hint">✓ = exposée par la machine. Les divergences expliquent les écarts de capabilities (ex. subgroups, primitive-index, tier2).</p>
    <table class="feat"><tr><th>Feature</th>${act.map(m => `<th style="color:${m.color}">${esc(m.machineLabel || m.id)}</th>`).join("")}</tr>
    ${feats.map(f => `<tr><td>${esc(f.feature)}</td>${f.has.map(h => `<td class="${h ? "yes" : "no"}">${h ? "✓" : "—"}</td>`).join("")}</tr>`).join("")}</table>
  </div>
  <div class="card full" style="margin-top:16px"><h3>Limits WebGPU</h3>
    <table class="cmp"><tr><th>Limite</th>${act.map(m => `<th class="num" style="color:${m.color}">${esc(m.machineLabel || m.id)}</th>`).join("")}</tr>
    ${limits.map(l => `<tr><td>${esc(l.limit)}</td>${l.values.map(v => `<td class="num">${v == null ? "—" : fmt.i(v)}</td>`).join("")}</tr>`).join("")}</table>
  </div>`;
}

/* — Rendu global — */
let currentView = "dashboard";
function setView(v: string) {
  currentView = v;
  document.querySelectorAll<HTMLElement>(".view").forEach(x => x.classList.toggle("on", x.id === v));
  document.querySelectorAll<HTMLElement>(".nav-btn").forEach(x => x.classList.toggle("on", x.dataset.view === v));
}
function render() {
  renderTabs();
  try {
    renderOverview(); renderCompare(); renderScene(); renderSubs(); renderTrends(); renderAnalyse(); renderData();
    renderDashboard(el("dashboard"), benches, sel);
  } catch (e) { showErr("render: " + (e as Error).message); }
  setView(currentView);
}

/* — Boot — */
function boot() {
  wireInteractivity();
  document.querySelectorAll<HTMLElement>(".nav-btn").forEach(x => x.addEventListener("click", () => setView(x.dataset.view!)));
  // CTA du hero
  el("heroDash").addEventListener("click", () => setView("dashboard"));
  el("heroAnalyse").addEventListener("click", () => setView("analyse"));
  el("reloadBtn").addEventListener("click", () => { benches = []; sel.clear(); loadFromServer().then(render); });
  el("fileInput").addEventListener("change", async e => {
    for (const f of (e.target as HTMLInputElement).files ?? []) {
      try { addBench(JSON.parse(await f.text()), f.name.replace(/^kerr-bench-|\.json$/g, "")); } catch { /* ignore */ }
    }
    render();
  });
  const drop = el("dropOverlay");
  let dragN = 0;
  addEventListener("dragenter", e => { e.preventDefault(); if (++dragN === 1) drop.classList.add("on"); });
  addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; drop.classList.remove("on"); } });
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", (e: DragEvent) => {
    e.preventDefault(); dragN = 0; drop.classList.remove("on");
    (async () => {
      for (const f of e.dataTransfer?.files ?? []) if (f.name.endsWith(".json")) {
        try { addBench(JSON.parse(await f.text()), f.name.replace(/^kerr-bench-|\.json$/g, "")); } catch { /* ignore */ }
      }
      render();
    })();
  });

  loadFromServer().then(() => { if (!benches.length) return loadFromDataCopies(); }).then(render);
  // Watch mode : sonde /api/watch toutes les 4 s, recharge auto si un nouveau JSON atterrit
  let lastStamp = "";
  const watchOnce = async () => {
    try {
      const r = await fetch("/api/watch", { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const { stamp } = await r.json();
      if (stamp && stamp !== lastStamp) {
        const isNew = lastStamp !== "";
        lastStamp = stamp;
        if (isNew) {
          await loadFromServer();
          render();
          toast("◆ Nouveau benchmark détecté — comparaison mise à jour");
        }
      }
    } catch { /* serveur absent (file://) — pas grave */ }
  };
  watchOnce(); // baseline immédiate (sinon un fichier arrivé avant la 1ʳᵉ sonde est invisible)
  setInterval(watchOnce, 4000);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove("on"), 4000);
}
boot();
