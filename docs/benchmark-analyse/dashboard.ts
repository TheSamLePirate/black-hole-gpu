/**
 * Vue « Dashboard » — cockpit AAA : hero score, KPI, verre, courbes animées, radar, tri planétaire.
 * Rendu dans #dashboard (index.html). Réutilise le moteur analysis.ts.
 */
import type { Bench } from "./types.ts";
import {
  fmt, esc, nearCap, topPasses, qualityByScene, worstOver33, avgMrays, vpix,
  lineChart, histogramFrom, HIST_BUCKETS, downsample, SUB_MODES, subModes, subRow,
  groupedBars,
} from "./analysis.ts";

/* — helpers — */
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
function findScene(b: Bench, frag: string) { return (b.scenes ?? []).find(s => s.scene.includes(frag)); }

/* (l'ancienne esquisse « radar » a été retirée — voir radarRings) */

/* — Vue Dashboard — */
export function renderDashboard(dashEl: HTMLElement, benches: Bench[], sel: Set<string>) {
  const act = benches.filter(b => sel.has(b.id));
  if (!act.length) { dashEl.innerHTML = `<div class="loading">Aucun bench actif — importez un JSON ou rechargez.</div>`; return; }
  const win = act.length === 2 ? (act[0].score?.kerrScore ?? 0) > (act[1].score?.kerrScore ?? 0) ? act[0] : act[1] : null;

  /* Hero */
  const hero = act.map(b => {
    const s = b.score?.kerrScore ?? 0;
    const pct = clamp(s / Math.max(...act.map(x => x.score?.kerrScore ?? 1)) * 100, 2, 100);
    const f = b.load?.firstImageMs ?? 0;
    return `<div class="dash-machine" style="--mc:${b.color}" data-toggle-machine="${esc(b.id)}" data-tip="<b>${esc(b.machineLabel || b.id)}</b><br>${fmt.i(s)} pts · ${esc(b.system.gpu.vendor)} ${esc(b.system.gpu.architecture)}<br><span style='opacity:.7'>Cliquer pour retirer / remettre cette machine de la comparaison</span>">
      <div class="dm-head"><span class="dm-dot"></span><span class="dm-name">${esc(b.machineLabel || b.id)}</span>
      ${b === win ? '<span class="dm-crown">meilleur score</span>' : ""}</div>
      <div class="dm-score" data-target="${s}">0</div>
      <div class="dm-ref">${esc((b.score?.reference ?? "").split("=")[1]?.trim() ?? "réf. 1000")}</div>
      <div class="dm-bar"><div style="width:0%"></div></div>
      <div class="dm-badges">
        <span class="gb acc">${esc(b.score?.recommendedQuality ?? "?")}</span>
        <span class="gb">${esc(b.system.gpu.vendor)} ${esc(b.system.gpu.architecture)}</span>
        <span class="gb ${f > 3000 ? "bad" : "ok"}">1ʳᵉ image ${f > 3000 ? "⚠ " : ""}${fmt.ms(f)}</span>
        <span class="gb">${(b.run?.viewport ?? []).join("×")} @${b.system.screen?.dpr ?? 1}x</span>
      </div>
    </div>`;
  }).join("");

  /* KPI */
  const bestSub = act.map(b => {
    const sc = findScene(b, "artemis");
    const rows = SUB_MODES.map(m => subRow(subModes(sc).get(m))).filter(Boolean);
    return rows.reduce((a, r) => (r.fps > a.fps ? r : a), rows[0]);
  });
  const kpis = [
    { k: "Score Kerr — pire machine", v: fmt.i(Math.min(...act.map(b => b.score?.kerrScore ?? 0))), s: "réf. 1000", d: "Score global du bench : la machine la plus lente des sélectionnées." },
    { k: "Score Kerr — meilleure", v: fmt.i(Math.max(...act.map(b => b.score?.kerrScore ?? 0))), s: act.length === 2 ? `×${fmt.n(Math.max(...act.map(b => b.score?.kerrScore ?? 0)) / Math.max(1, Math.min(...act.map(b => b.score?.kerrScore ?? 0))), 1)} vs pire` : "", d: "Rapport entre la meilleure et la pire machine." },
    { k: "Mray/s max (auto)", v: fmt.n(Math.max(...act.flatMap(b => (b.scenes ?? []).map(s => s.auto?.mraysPerS ?? 0))), 1), s: "pic mesuré", d: "Débit de rayons maximal, mode résolution dynamique." },
    { k: "Mray/s min (auto)", v: fmt.n(Math.min(...act.flatMap(b => (b.scenes ?? []).map(s => s.auto?.mraysPerS ?? 0)).filter(Boolean)), 2), s: "scène la plus lourde", d: "La scène qui demande le moins de débit = la plus coûteuse par rayon." },
    { k: "Cap détecté (rés. fixe)", v: (() => { const c = nearCap(Math.max(...act.flatMap(b => (b.scenes ?? []).map(s => (s.fixed as any)?.fps ?? 0)))); return c ? `${c} Hz` : "—"; })(), s: "fps fixe max ≈ cap", d: "Fréquence de rafraîchissement de l'écran, déduite du fps en résolution fixe." },
    { k: "Saccades totales", v: fmt.i(act.reduce((n, b) => n + (b.scenes ?? []).reduce((m, s) => m + (s.auto?.over33 ?? 0), 0), 0)), s: "frames > 33 ms", d: "Nombre total de frames au-delà du budget 30 fps, toutes scènes." },
    { k: "Dérive thermique", v: `${fmt.n(Math.max(...act.map(b => Math.abs(b.thermal?.driftPct ?? 0))), 1)} %`, s: "pire machine", d: "Érosion du débit rayons entre le début et la fin du run (throttling)." },
    { k: "VRAM max", v: `${fmt.i(Math.max(...act.map(b => b.peakVramMiB ?? 0)))} MiB`, s: "toutes scènes", d: "Pic de mémoire graphique du navigateur." },
  ];

  /* Radars par machine — axes normalisés 0..1 */
  const radarAxes = [
    { name: "Score Kerr", unit: "score" },
    { name: "Débit rayons", unit: "Mray/s" },
    { name: "Fluidité 30+", unit: "% scènes ≥ 30" },
    { name: "Temps de charg.", unit: "1 = 0,5 s" },
    { name: "Santé thermique", unit: "1 = 0 % dérive" },
    { name: "Convergence still", unit: "1 = 0,3 s" },
  ];
  const maxScore = Math.max(...act.map(b => b.score?.kerrScore ?? 1), 1);
  const maxMrays = Math.max(...act.flatMap(b => (b.scenes ?? []).map(s => s.auto?.mraysPerS ?? 0)), 1);
  // compression log pour les axes à très forte dynamique (débit rayons, chargement, convergence)
  const logN = (v: number, max: number) => clamp(Math.log1p(Math.max(0, v)) / Math.log1p(max), 0.02, 1);
  const radarRefs = act.map(b => {
    const stillMs = Math.min(...(b.scenes ?? []).map(s => s.still?.convergeMs ?? Infinity).filter(Number.isFinite), 5000);
    const fpsGe30 = (b.scenes ?? []).filter(s => (s.auto?.fps ?? 0) >= 29).length / Math.max(1, (b.scenes ?? []).length);
    return {
      label: b.machineLabel || b.id, color: b.color, width: 2,
      points: [
        (b.score?.kerrScore ?? 0) / maxScore,
        logN(avgMrays(b) || 0, maxMrays),
        fpsGe30,
        logN(500, Math.max(1, b.load?.firstImageMs ?? 500)),
        clamp(1 - Math.abs(b.thermal?.driftPct ?? 10) / 10, 0.05, 1),
        logN(400, Math.max(1, stillMs)),
      ],
      raw: [
        `${fmt.i(b.score?.kerrScore ?? 0)} pts`,
        `${fmt.n(avgMrays(b), 1)} Mray/s`,
        `${fmt.i(fpsGe30 * 8)} scènes / 8 ≥ 30 fps`,
        `${fmt.ms(b.load?.firstImageMs ?? 0)}`,
        `${fmt.n(b.thermal?.driftPct ?? NaN, 1)} % de dérive`,
        `${fmt.ms(stillMs)} (spp 32)`,
      ],
    };
  });
  const radarSvg = radarRings(radarAxes, radarRefs);

  /* Cœur : frame-times côte à côte (Kerr = pire scène) */
  const coreSeries = act.flatMap(b => {
    const sc = findScene(b, "Kerr") ?? b.scenes[0];
    return (sc?.auto?.intervals ?? []).length > 10
      ? [{ label: `${b.machineLabel || b.id} · Kerr`, color: b.color, points: sc!.auto!.intervals!, width: 1.4 }]
      : [];
  });

  /* Histogrammes */
  const hists = act.map(b => {
    const all = (b.scenes ?? []).flatMap(s => s.auto?.intervals ?? []);
    const h = histogramFrom(all);
    const total = Object.values(h).reduce((a, x) => a + x, 0) || 1;
    return { label: b.machineLabel || b.id, color: b.color, values: HIST_BUCKETS.map(([l]) => (h[l] ?? 0) / total * 100) };
  });

  /* Scènes classées (planètes) */
  const planets = act[0].scenes.map((sc, i) => {
    const per = act.map(b => ({ b, s: (b.scenes ?? []).find(x => x.scene === sc.scene) }));
    const fpsMin = Math.min(...per.map(p => p.s?.auto?.fps ?? 999));
    const fpsMax = Math.max(...per.map(p => p.s?.auto?.fps ?? 0));
    const worst = per.reduce((a, p) => ((p.s?.auto?.fps ?? 0) < (a.s?.auto?.fps ?? 999) ? p : a), per[0]);
    const size = 34 + 34 * clamp(1 - fpsMin / Math.max(...act[0].scenes.map(x => x.auto?.fps ?? 1), 1), 0, 1);
    return { i, name: sc.scene, fpsMin, fpsMax, worst, size, pct: clamp(fpsMax / Math.max(1, fpsMax) * 100, 0, 100), minPct: clamp(fpsMin / Math.max(fpsMax, 1) * 100, 0, 100) };
  }).sort((a, b) => a.fpsMin - b.fpsMin);

  /* Assembly */
  dashEl.innerHTML = `
  <div class="dash-hero">${hero}</div>

  <div class="dash-kpis">${kpis.map(x => `
    <div class="kpi" data-tip="<b>${esc(x.k)}</b><br>${esc(x.d)}"><div class="kpi-k">${esc(x.k)}</div><div class="kpi-v">${x.v}</div><div class="kpi-s">${esc(x.s)}</div></div>`).join("")}
  </div>

  <div class="dash-grid">
    <div class="card dash-radar">
      <h3>Portrait des machines</h3>
      <p class="hint">Six axes normalisés (1 = meilleur observé). Plus la toile est grande, plus la machine est à l'aise sur l'axe.</p>
      ${radarSvg}
      <div class="legend">${act.map(b => `<span data-series-toggle="${esc(b.machineLabel || b.id)}" data-tip="Cliquer pour masquer / afficher <b>${esc(b.machineLabel || b.id)}</b>"><span class="sw" style="background:${b.color}"></span>${esc(b.machineLabel || b.id)}</span>`).join("")}</div>
    </div>

    <div class="card dash-core">
      <h3>Le cœur du réacteur — frame-times sur Kerr</h3>
      <p class="hint">Pire scène des deux runs. Chaque point = une frame réelle (décimation max par paquet).</p>
      ${coreSeries.length ? lineChart(coreSeries, { unit: "ms", h: 210, maxP99: true, hLines: [{ y: 33, label: "33 ms (30 fps)" }, { y: 16.7, label: "16,7 ms (60 fps)" }] }) : "<p class='hint'>pas de données</p>"}
      <div class="legend">${act.map(b => `<span data-series-toggle="${esc(b.machineLabel || b.id)}" data-tip="Cliquer pour masquer / afficher <b>${esc(b.machineLabel || b.id)}</b>"><span class="sw" style="background:${b.color}"></span>${esc(b.machineLabel || b.id)}</span>`).join("")}</div>
    </div>

    <div class="card dash-hist">
      <h3>Distribution des frame-times — toutes scènes</h3>
      <p class="hint">% des frames par bucket. À gauche de 16,7 ms : confort ; à droite de 33 ms : saccades.</p>
      ${histBarsDash(hists)}
    </div>

    <div class="card dash-load">
      <h3>Anatomie du chargement</h3>
      <p class="hint">Chaque étage = une étape du boot, normalisée par machine. Largeur = temps.</p>
      ${act.map(b => {
      const st = b.load?.stages ?? [];
      const total = Math.max(...st.map(x => x.ms), 1);
      return `<div style="margin-bottom:14px">
        <div class="hint" style="margin-bottom:6px"><b style="color:${b.color}">${esc(b.machineLabel || b.id)}</b> — 1ʳᵉ image ${fmt.ms(b.load?.firstImageMs ?? 0)}</div>
        <div class="load-stack">${st.slice().sort((a, c) => c.ms - a.ms).map(s => `
          <div class="ls-row" data-tip="<b>${esc(s.label)}</b><br>${fmt.ms(s.ms)} · ${fmt.n(s.ms / (b.load?.firstImageMs ?? s.ms) * 100, 0)} % de la 1ʳᵉ image"><span class="ls-l">${esc(s.label.split("—")[0].trim())}</span>
          <span class="ls-track"><span style="width:${Math.max(s.ms / total * 100, 1)}%;background:linear-gradient(90deg, transparent, ${b.color})"></span></span>
          <span class="ls-v">${fmt.ms(s.ms)}</span></div>`).join("")}</div>
      </div>`;
    }).join("")}
    </div>
  </div>

  <div class="card full dash-planets">
    <h3>Système des scènes — classées du plus dur au plus facile</h3>
    <p class="hint">Taille de la planète = difficulté (pire fps auto parmi les machines sélectionnées). Anneau = fps de la meilleure machine.</p>
    <div class="planets">${planets.map(p => `
      <div class="planet" data-goto-view="scene" data-goto-scene="${p.i}" data-tip="<b>${esc(p.name)}</b><br>Pire machine : <b>${fmt.n(p.fpsMin)} fps</b> (${esc(p.worst.b.machineLabel || p.worst.b.id)})<br>Meilleure : ${fmt.n(p.fpsMax)} fps<br><span style='opacity:.7'>Cliquer pour explorer la scène</span>">
        <div class="p-ring" style="width:${p.size + 14}px;height:${p.size + 14}px">
          <div class="p-body" style="width:${p.size}px;height:${p.size}px;background:radial-gradient(circle at 32% 30%, ${p.worst.b.color}, #1a2030 78%)"></div>
        </div>
        <div class="p-name">${esc(shortName(p.name))}</div>
        <div class="p-fps"><b style="color:${p.worst.b.color}">${fmt.n(p.fpsMin)}</b> / ${fmt.n(p.fpsMax)} fps</div>
      </div>`).join("")}</div>
  </div>

  <div class="card full dash-anim">
    <h3>Rythme du moteur — 6 secondes sur game:artemis</h3>
    <p class="hint">Temps GPU par frame (timestamps WebGPU), lissé. Le moteur doit tenir sous le budget frame de l'écran.</p>
    <div class="anim-charts">${act.map(b => {
    const sc = findScene(b, "artemis");
    const gpu = (sc?.auto as any)?.gpu as number[] | undefined;
    return gpu?.length ? `<div><div class="hint" style="margin-bottom:4px"><b style="color:${b.color}">${esc(b.machineLabel || b.id)}</b></div>${lineChart([{ label: "gpu", color: b.color, points: gpu.slice(0, 400) }], { unit: "ms", h: 140, maxP99: true, hLines: [{ y: 33, label: "33 ms" }] })}</div>` : "";
  }).join("")}</div>
  </div>`;

  /* — Animations d'entrée — */
  requestAnimationFrame(() => {
    dashEl.querySelectorAll<HTMLElement>(".dm-score").forEach(n => countUp(n, +n.dataset.target!));
    act.forEach((b, i) => {
      const bar = dashEl.querySelectorAll<HTMLElement>(".dash-machine")[i]?.querySelector<HTMLElement>(".dm-bar > div");
      if (!bar) return;
      const pct = clamp((b.score?.kerrScore ?? 0) / Math.max(...act.map(x => x.score?.kerrScore ?? 1)) * 100, 2, 100);
      setTimeout(() => { bar.style.width = pct.toFixed(1) + "%"; }, 150 + i * 120);
    });
  });
}

/* — Radar (implémentation réelle) — */
function radarRings(ax: { name: string; unit: string }[], refs: { label: string; color: string; points: number[]; width?: number; raw?: string[] }[]) {
  const W = 680, H = 400, cx = W / 2, cy = H / 2 + 6, R = 148;
  const N = ax.length;
  const ang = (i: number) => -Math.PI / 2 + i * 2 * Math.PI / N;
  const pt = (i: number, v: number) => [cx + Math.cos(ang(i)) * R * v, cy + Math.sin(ang(i)) * R * v] as const;
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let g = 1; g <= 4; g++) {
    out += `<polygon points="${ax.map((_, i) => pt(i, g / 4).join(",")).join(" ")}" fill="none" stroke="#2a3145" stroke-width="0.7"/>`;
  }
  for (let i = 0; i < N; i++) {
    const [x, y] = pt(i, 1);
    out += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#2a3145" stroke-width="0.7"/>`;
    const [lx, ly] = pt(i, 1.26);
    const anchor = Math.abs(lx - cx) < 14 ? "middle" : lx > cx ? "start" : "end";
    const two = ax[i].name.length > 20;
    out += `<text x="${lx}" y="${ly - (two ? 5 : 0)}" fill="#aeb5c9" font-size="10.5" text-anchor="${anchor}">${esc(ax[i].name)}</text>`;
    out += `<text x="${lx}" y="${ly + (two ? 10 : 13)}" fill="#5f6780" font-size="9" text-anchor="${anchor}">${esc(ax[i].unit)}</text>`;
  }
  refs.forEach((r, ri) => {
    const d = r.points.map((v, i) => { const [x, y] = pt(i, clamp(v, 0.02, 1)); return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ") + " Z";
    const vals = ax.map((a, i) => `<br>${esc(a.name)} : <b>${esc(r.raw?.[i] ?? fmt.n(r.points[i] * 100, 0) + " %")}</b>`).join("");
    out += `<path class="chart-el" data-series="${esc(r.label)}" data-tip="<b>${esc(r.label)}</b>${vals}" d="${d}" fill="${r.color}" fill-opacity="${refs.length === 1 ? 0.14 : 0.1}" stroke="${r.color}" stroke-width="${r.width ?? 1.6}" opacity=".95" style="animation: dash-draw 1s ${ri * 0.15}s ease-out both"/>`;
  });
  return out + `</svg>`;
}
function histBarsDash(hists: { label: string; color: string; values: number[] }[]) {
  const colors = ["#3ddc84", "#8fd14f", "#ffd166", "#ff9f43", "#ff6b6b", "#b23a48"];
  const total = Math.max(...hists.map(h => h.values.reduce((a, b) => a + b, 0)), 1);
  return `<div class="histgrid">${HIST_BUCKETS.map(([label], bi) => `
    <div class="hb-row" data-tip="<b>${esc(label)} ms par frame</b><br>${hists.map(h => `${esc(h.label)} : <b>${fmt.n(h.values[bi], 0)} %</b>`).join(" · ")}"><div class="hb-l" style="color:${colors[bi]}">${esc(label)} ms</div>
      <div class="hb-tracks">${hists.map(h => `
        <div class="hb-line"><span class="hb-dot" style="background:${h.color}"></span>
        <span class="hb-track"><span style="width:${h.values[bi] / total * 100}%;background:${h.color}"></span></span>
        <span class="hb-v" style="color:${h.color}">${fmt.n(h.values[bi], 0)} %</span></div>`).join("")}</div>
    </div>`).join("")}</div>`;
}
function shortName(s: string) {
  return s.replace("Interstellar: ", "Inter. ").replace(" (the film's close pass)", "").replace("Kerr a=0.94, near edge-on", "Kerr a=0.94").replace(": approaching Gargantua", " → Gargantua").replace(": backlit", "").replace(": an afternoon on the plains", "").replace("Miller: ", "Miller ").replace("Moon: ", "Lune ").replace("game:", "").replace("Saturn", "Saturne");
}
function countUp(node: HTMLElement, target: number) {
  const t0 = performance.now(), dur = 900;
  const step = (t: number) => {
    const p = clamp((t - t0) / dur, 0, 1);
    node.textContent = fmt.i(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
