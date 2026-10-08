// The Kerr Bench's screen, at …/#bench (a link to send to friends with other hardware): what the test
// does and what it collects, its depth, the suites measured (the reference scenes, the heavy worlds, the
// vessels, the weather, the flights), a name for the machine; then the scenes it renders with a band of
// progress; then the score, the quality it recommends, a table by scene and one by suite, and the report —
// downloaded, copied, shared, or compared with another one dropped here. Nothing is sent anywhere.

import "./bench.css";
import { tr, type Text } from "../i18n";
import { BENCH_SCENES, estimateSeconds, type KerrBench } from "../bench/runner";
import {
  BENCH_MODES,
  SUITES,
  checkReport,
  reportFileName,
  type BenchMode,
  type BenchReport,
  type SceneReport,
  type SuiteId,
} from "../bench/report";
import { itemsFor } from "../bench/suites";
import { store } from "../util/storage";

const T = {
  title: { fr: "Kerr Bench", en: "Kerr Bench" },
  intro: {
    fr: "Mesure ce que ta machine fait du jeu : les scènes de référence du traceur de Kerr (le Kerr Score, comparable d'une machine à l'autre), puis les mondes lourds, les vaisseaux, la météo et de vrais vols pilotés par les autopilotes. À la fin, un rapport JSON à m'envoyer.",
    en: "Measures what your machine makes of the game: the Kerr ray tracer's reference scenes (the Kerr Score, comparable between machines), then the heavy worlds, the vessels, the weather and real flights flown by the autopilots. At the end, a JSON report to send back.",
  },
  mode: { fr: "Profondeur", en: "Depth" },
  quick: { fr: "Rapide", en: "Quick" },
  standard: { fr: "Standard", en: "Standard" },
  complete: { fr: "Complet", en: "Complete" },
  full: { fr: "Intégral", en: "Full" },
  quickD: { fr: "l'essentiel de chaque suite", en: "the gist of each suite" },
  standardD: { fr: "les 8 scènes de référence, plus d'éléments", en: "the 8 reference scenes, more items" },
  completeD: { fr: "+ qualités, sous-échantillonnage", en: "+ qualities, subsampling" },
  fullD: { fr: "tout, mesuré plus longtemps", en: "everything, measured longer" },
  measures: { fr: "mesures", en: "measures" },
  suites: { fr: "Suites", en: "Suites" },
  core: { fr: "Référence · Kerr Score", en: "Reference · Kerr Score" },
  worlds: { fr: "Mondes lourds", en: "Heavy worlds" },
  vessels: { fr: "Vaisseaux", en: "Vessels" },
  weather: { fr: "Météo", en: "Weather" },
  flights: { fr: "Vols", en: "Flights" },
  coreD: { fr: "trou noir, trou de ver, planètes", en: "black hole, wormhole, planets" },
  worldsD: { fr: "Yosemite, Everest, Cévennes, nuit, éclipse…", en: "Yosemite, Everest, the Cévennes, night, eclipse…" },
  vesselsD: { fr: "ISS, Endurance, Lander, cabine", en: "ISS, Endurance, Lander, cabin" },
  weatherD: { fr: "beau temps, orage, brouillard, pluie…", en: "fair, storm, fog, rain…" },
  flightsD: { fr: "finales, entrée, orage, orbite — en vol réel", en: "finals, entry, storm, orbit — really flown" },
  total: { fr: "Durée estimée", en: "Estimated time" },
  left: { fr: "restantes", en: "left" },
  none: { fr: "Choisis au moins une suite", en: "Pick at least one suite" },
  item: { fr: "Élément", en: "Item" },
  load: { fr: "charg. s", en: "load s" },
  flight: { fr: "vol", en: "flight" },
  summary: {
    fr: "{0} fps (moy. géom.) · {1}/{2} à 30 fps ou plus · p95 au pire {3} ms",
    en: "{0} fps (geo. mean) · {1}/{2} at 30 fps or more · worst p95 {3} ms",
  },
  subs: {
    fr: "Sous-échantillonnage temps réel : images par seconde (survol : p95, temps GPU, Mrays/s)",
    en: "Realtime subsampling: frames per second (hover: p95, GPU time, Mrays/s)",
  },
  machine: { fr: "Nom de la machine (facultatif)", en: "Machine's name (optional)" },
  machinePh: { fr: "ex. PC de Max, RTX 3060", en: "e.g. Max's PC, RTX 3060" },
  collected: { fr: "Ce que le rapport contient", en: "What the report holds" },
  c1: { fr: "le GPU tel que WebGPU le nomme, ses fonctions et limites", en: "the GPU as WebGPU names it, its features and limits" },
  c2: {
    fr: "le navigateur, l'écran, le nombre de cœurs et la mémoire annoncés",
    en: "the browser, the screen, the cores and memory it tells",
  },
  c3: {
    fr: "les images par seconde, les temps de rendu et la mémoire GPU de chaque scène",
    en: "each scene's frame rate, render times and GPU memory",
  },
  c4: {
    fr: "aucune donnée personnelle, rien n'est envoyé : c'est toi qui transmets le fichier",
    en: "no personal data, nothing is sent: you pass the file on yourself",
  },
  tips: {
    fr: "Pour une mesure juste : portable branché, autres onglets fermés, ne touche à rien pendant le test.",
    en: "For a fair measure: laptop plugged in, other tabs closed, hands off during the test.",
  },
  go: { fr: "Lancer", en: "Start" },
  back: { fr: "Retour au jeu", en: "Back to the game" },
  cancel: { fr: "Annuler", en: "Cancel" },
  running: { fr: "Mesure en cours", en: "Measuring" },
  score: { fr: "Kerr Score", en: "Kerr Score" },
  noScore: { fr: "pas de référence encore", en: "no reference yet" },
  recommended: { fr: "Qualité conseillée", en: "Recommended quality" },
  scene: { fr: "Scène", en: "Scene" },
  download: { fr: "Télécharger le rapport", en: "Download the report" },
  copy: { fr: "Copier le JSON", en: "Copy the JSON" },
  copied: { fr: "Copié", en: "Copied" },
  share: { fr: "Partager", en: "Share" },
  compare: { fr: "Comparer avec un rapport", en: "Compare with a report" },
  again: { fr: "Recommencer", en: "Run again" },
  thermal: { fr: "Chauffe : le débit a baissé de", en: "Heat: the throughput fell by" },
  lost: { fr: "Le GPU a été perdu pendant le test — rapport partiel.", en: "The GPU was lost during the test — a partial report." },
  errors: { fr: "erreurs pendant le test", en: "errors during the test" },
  hidden: {
    fr: "La page est passée en arrière-plan pendant le test : le navigateur la ralentit, les chiffres sont faussés. Relance-le en gardant l'onglet au premier plan.",
    en: "The page went to the background during the test: the browser slows it down, the figures are off. Run it again with the tab in front.",
  },
} satisfies Record<string, Text>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function button(label: string, onClick: () => void, cls = "") {
  const b = el("button", `kb-btn ${cls}`.trim(), label);
  b.type = "button";
  b.onclick = onClick;
  return b;
}

/** A duration as the screen says it: "≈ 40 s", "≈ 6 min", "≈ 1 h 05". */
function duration(s: number) {
  if (s < 60) return `≈ ${Math.round(s / 5) * 5} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `≈ ${m} min` : `≈ ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** A setting kept between visits (the depth, the suites): read back only if still valid. */
function kept<X>(key: string, ok: (x: unknown) => x is X, fallback: X): X {
  try {
    const x = JSON.parse(store.get(key) ?? "null") as unknown;
    return ok(x) ? x : fallback;
  } catch {
    return fallback;
  }
}

export class BenchScreen {
  private root = el("div", "kb");
  private mode: BenchMode = kept("kerr.bench-mode", (x): x is BenchMode => BENCH_MODES.includes(x as BenchMode), "standard");
  private suites: SuiteId[] = kept(
    "kerr.bench-suites",
    (x): x is SuiteId[] => Array.isArray(x) && x.length > 0 && x.every((s) => SUITES.includes(s)),
    [...SUITES],
  );

  constructor(
    private bench: KerrBench,
    private o: { onClose: () => void; onStart?: () => void },
  ) {
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", tr(T.title));
    document.body.append(this.root);
    document.body.classList.add("benching");
    this.intro();
  }

  /** How many measures a depth takes of the suites chosen. */
  private count(m: BenchMode) {
    const core = this.suites.includes("core") ? (m === "quick" ? 4 : BENCH_SCENES.length) : 0;
    return core + itemsFor(m, this.suites).length;
  }

  private intro() {
    const p = el("div", "kb-panel");
    p.append(el("div", "kb-code", "KB-01 · WEBGPU"), el("h1", "", tr(T.title)), el("p", "", tr(T.intro)));
    // the depth: four levels, each with its time and its measures for the suites chosen
    p.append(el("span", "kb-label", tr(T.mode)));
    const modes = el("div", "kb-modes kb-modes-4");
    const DEPTH: Record<BenchMode, [Text, Text]> = {
      quick: [T.quick, T.quickD],
      standard: [T.standard, T.standardD],
      complete: [T.complete, T.completeD],
      full: [T.full, T.fullD],
    };
    const subs = new Map<BenchMode, HTMLElement>();
    for (const m of BENCH_MODES) {
      const b = button(tr(DEPTH[m][0]), () => {
        this.mode = m;
        store.set("kerr.bench-mode", JSON.stringify(m));
        for (const x of modes.children) x.setAttribute("aria-pressed", String(x === b));
        update();
      });
      const sub = el("small");
      subs.set(m, sub);
      b.append(sub, el("small", "kb-dim", tr(DEPTH[m][1])));
      b.setAttribute("aria-pressed", String(m === this.mode));
      modes.append(b);
    }
    p.append(modes);
    // the suites: each on or off
    p.append(el("span", "kb-label", tr(T.suites)));
    const suites = el("div", "kb-suites");
    const counts = new Map<SuiteId, HTMLElement>();
    for (const s of SUITES) {
      const b = button(tr(T[s]), () => {
        const on = !this.suites.includes(s);
        this.suites = on ? SUITES.filter((x) => x === s || this.suites.includes(x)) : this.suites.filter((x) => x !== s);
        b.setAttribute("aria-pressed", String(on));
        store.set("kerr.bench-suites", JSON.stringify(this.suites));
        update();
      });
      const n = el("b", "kb-count");
      counts.set(s, n);
      b.prepend(n);
      b.append(el("small", "", tr(T[`${s}D`])));
      b.setAttribute("aria-pressed", String(this.suites.includes(s)));
      suites.append(b);
    }
    p.append(suites);
    const total = el("div", "kb-total");
    p.append(total);
    p.append(el("span", "kb-label", tr(T.machine)));
    const name = el("input", "kb-input");
    name.placeholder = tr(T.machinePh);
    name.maxLength = 80;
    name.value = store.get("kerr.bench-machine") ?? "";
    p.append(name);
    p.append(el("span", "kb-label", tr(T.collected)));
    const ul = el("ul", "kb-collect");
    for (const k of [T.c1, T.c2, T.c3, T.c4]) ul.append(el("li", "", tr(k)));
    p.append(ul, el("div", "kb-tips", tr(T.tips)));
    const row = el("div", "kb-row");
    const go = button(
      tr(T.go),
      () => {
        if (!this.suites.length) return;
        store.set("kerr.bench-machine", name.value.trim());
        void this.start(name.value.trim());
      },
      "kb-go",
    );
    row.append(
      button(tr(T.back), () => this.close()),
      go,
    );
    p.append(row);
    const update = () => {
      for (const m of BENCH_MODES)
        subs.get(m)!.textContent = this.suites.length
          ? `${duration(estimateSeconds(m, this.suites))} · ${this.count(m)} ${tr(T.measures)}`
          : "—";
      for (const s of SUITES) {
        const n = s === "core" ? (this.mode === "quick" ? 4 : BENCH_SCENES.length) : itemsFor(this.mode, [s]).length;
        counts.get(s)!.textContent = String(n);
      }
      total.textContent = this.suites.length
        ? `${tr(T.total)} : ${duration(estimateSeconds(this.mode, this.suites))} · ${this.count(this.mode)} ${tr(T.measures)}`
        : tr(T.none);
      go.disabled = !this.suites.length;
    };
    update();
    this.root.replaceChildren(p);
    go.focus();
  }
  private async start(machineLabel: string) {
    this.o.onStart?.();
    const band = el("div", "kb-run");
    const head = el("div", "kb-run-head");
    const what = el("span", "", tr(T.running));
    const fps = el("b", "", "");
    head.append(what, fps);
    const bar = el("div", "kb-bar");
    const fill = el("i");
    bar.append(fill);
    const foot = el("div", "kb-run-foot");
    const phase = el("span", "", "");
    const cancel = el("button", "kb-cancel", tr(T.cancel));
    cancel.type = "button";
    cancel.onclick = () => this.bench.cancel();
    foot.append(phase, cancel);
    band.append(head, bar, foot);
    this.root.replaceChildren(band);
    const t0 = performance.now();
    const report = await this.bench.run({
      mode: this.mode,
      machineLabel,
      suites: this.suites,
      onProgress: (p) => {
        what.textContent = p.scene;
        const suite = [p.suite ? tr(T[p.suite]) : "", p.phase].filter(Boolean).join(" · ");
        // (the time left: the elapsed over the share done, once a few percent are)
        const left = p.frac > 0.03 ? ((performance.now() - t0) / 1000) * (1 / p.frac - 1) : null;
        phase.textContent = [tr(T.running), suite, left !== null ? `${duration(left)} ${tr(T.left)}` : ""].filter(Boolean).join(" · ");
        fps.textContent = p.fps > 0 ? `${p.fps.toFixed(0)} fps` : "";
        fill.style.width = `${(100 * p.frac).toFixed(1)}%`;
      },
    });
    this.results(report);
  }

  private results(r: BenchReport, other?: BenchReport) {
    const p = el("div", "kb-panel");
    p.append(el("div", "kb-code", `KB-02 · ${r.app.mode.toUpperCase()} · ${r.durationS} s`), el("h1", "", tr(T.title)));
    // (the score: the reference scenes' — none measured, none shown)
    if (r.scenes.length) {
      const sc = el("div", "kb-score");
      sc.append(el("b", "", r.score.kerrScore === null ? "—" : String(r.score.kerrScore)));
      sc.append(el("span", "", r.score.kerrScore === null ? tr(T.noScore) : tr(T.score)));
      if (r.score.recommendedQuality) sc.append(el("span", "", `${tr(T.recommended)} : ${r.score.recommendedQuality}`));
      p.append(sc);
    }
    const g = r.system.gpu;
    p.append(
      el(
        "div",
        "kb-sys",
        [
          g.description || g.vendor,
          g.architecture,
          r.system.browser.brands[0] ?? "",
          `${r.system.screen.css.join("×")} @${r.system.screen.dpr}`,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    // the table: fps in the game, its p95, the fixed throughput (and the other report's, side by side)
    const tb = el("table", "kb-table");
    const hr = el("tr");
    for (const h of [tr(T.scene), "fps", "p95 ms", "Mrays/s", ...(other ? ["Mrays/s ⇄"] : []), "VRAM"]) hr.append(el("th", "", h));
    tb.append(hr);
    for (const s of r.scenes) {
      const tr_ = el("tr");
      const o = other?.scenes.find((x) => x.scene === s.scene);
      const cells = [
        s.scene,
        s.auto ? s.auto.fps.toFixed(0) : s.status,
        s.auto ? s.auto.p95.toFixed(1) : "",
        s.fixed ? s.fixed.mraysPerS.toFixed(1) : "",
        ...(other ? [o?.fixed ? o.fixed.mraysPerS.toFixed(1) : "—"] : []),
        s.vramMiB !== null ? `${s.vramMiB}` : "",
      ];
      for (const c of cells) tr_.append(el("td", "", c));
      tb.append(tr_);
    }
    if (r.scenes.length) p.append(tb);
    // the subsampling sweep (the complete run): a scene by row, a setting by column
    const swept = r.scenes.filter((s) => s.subsampling?.length);
    if (swept.length) {
      const subs = r.run?.subsamplings ?? swept[0]!.subsampling!.map((x) => x.subsampling);
      const st = el("table", "kb-table kb-subs");
      const cap = el("caption", "", tr(T.subs));
      const h2 = el("tr");
      for (const h of [tr(T.scene), ...subs.map((x) => (x === "auto" ? "auto" : `${x}×`))]) h2.append(el("th", "", h));
      st.append(cap, h2);
      for (const s of swept) {
        const row = el("tr");
        row.append(el("td", "", s.scene));
        for (const x of subs) {
          const q = s.subsampling!.find((y) => y.subsampling === x);
          const td = el("td", "", q ? q.fps.toFixed(0) : "—");
          if (q) td.title = `p95 ${q.p95} ms · GPU ${q.gpuMs.mean} ms · ${q.mraysPerS} Mrays/s`;
          row.append(td);
        }
        st.append(row);
      }
      p.append(st);
    }
    for (const s of r.suites ?? []) if (s.items.length) p.append(suiteTable(s.id, s.items, s.summary, other));
    if (r.thermal && r.thermal.driftPct < -5) p.append(el("div", "kb-warn", `${tr(T.thermal)} ${-r.thermal.driftPct} %`));
    if (r.errors.deviceLost) p.append(el("div", "kb-warn", tr(T.lost)));
    if (r.scenes.some((s) => s.errors.some((e) => e.includes("foreground")))) p.append(el("div", "kb-warn", tr(T.hidden)));
    const nErr = r.errors.gpu + r.scenes.reduce((a, s) => a + s.errors.length, 0);
    if (nErr) p.append(el("div", "kb-warn", `${nErr} ${tr(T.errors)}`));
    const json = JSON.stringify(r, null, 1);
    const row = el("div", "kb-row");
    const copy = button(tr(T.copy), () => {
      void navigator.clipboard?.writeText(json).then(() => (copy.textContent = tr(T.copied)));
    });
    row.append(
      button(tr(T.download), () => download(json, reportFileName(r)), "kb-go"),
      copy,
    );
    const file = new File([json], reportFileName(r), { type: "application/json" });
    if (navigator.canShare?.({ files: [file] }))
      row.append(button(tr(T.share), () => void navigator.share({ files: [file], title: tr(T.title) }).catch(() => {})));
    const pick = el("input");
    pick.type = "file";
    pick.accept = "application/json,.json";
    pick.hidden = true;
    pick.onchange = async () => {
      const f = pick.files?.[0];
      if (!f) return;
      try {
        this.results(r, checkReport(JSON.parse(await f.text())));
      } catch (e) {
        alert((e as Error).message);
      }
    };
    row.append(
      button(tr(T.compare), () => pick.click()),
      pick,
    );
    const row2 = el("div", "kb-row");
    row2.append(
      button(tr(T.again), () => this.intro()),
      button(tr(T.back), () => this.close()),
    );
    p.append(row, row2);
    this.root.replaceChildren(p);
  }

  private close() {
    this.root.remove();
    document.body.classList.remove("benching");
    this.o.onClose();
  }
}

/**
 * A suite's table: each item's frame rate as in the game, its p95 and 99th percentile, the frames over
 * 33 ms, the fixed throughput (a view) or the flight's height from start to end, the time its assets took,
 * the GPU's memory; the other report's frame rate beside it; the suite's summary as its caption.
 */
function suiteTable(id: SuiteId, items: SceneReport[], sum: NonNullable<BenchReport["suites"]>[number]["summary"], other?: BenchReport) {
  const flights = id === "flights";
  const t = el("table", "kb-table kb-suite");
  const cap = el("caption");
  cap.append(el("b", "", tr(T[id])));
  if (sum.fpsGeo !== null)
    cap.append(
      el(
        "span",
        "",
        tr(T.summary)
          .replace("{0}", sum.fpsGeo.toFixed(0))
          .replace("{1}", String(sum.playable))
          .replace("{2}", String(sum.n))
          .replace("{3}", sum.worstP95?.toFixed(0) ?? "—"),
      ),
    );
  const hr = el("tr");
  // (the throughput's column only where phase B ran: not in a quick run)
  const third = flights || items.some((s) => s.fixed);
  const heads = [
    tr(T.item),
    "fps",
    ...(other ? ["fps ⇄"] : []),
    "p95 ms",
    "p99 ms",
    "> 33 ms",
    ...(third ? [flights ? `${tr(T.flight)} km` : "Mrays/s"] : []),
    tr(T.load),
    "VRAM",
  ];
  for (const h of heads) hr.append(el("th", "", h));
  t.append(cap, hr);
  const otherItems = other?.suites?.find((s) => s.id === id)?.items ?? [];
  for (const s of items) {
    const row = el("tr");
    const o = otherItems.find((x) => x.id === s.id);
    const a = s.auto;
    const f = s.flight;
    const fl = f?.start && f.end ? `${f.start.altKm.toFixed(1)} → ${f.end.altKm.toFixed(1)}` : "";
    const cells = [
      s.title ?? s.scene,
      a ? a.fps.toFixed(0) : s.status,
      ...(other ? [o?.auto ? o.auto.fps.toFixed(0) : "—"] : []),
      a ? a.p95.toFixed(1) : "",
      a ? a.p99.toFixed(1) : "",
      a ? String(a.over33) : "",
      ...(third ? [flights ? fl : s.fixed ? s.fixed.mraysPerS.toFixed(1) : ""] : []),
      (s.assetsMs / 1000).toFixed(1),
      s.vramMiB !== null ? `${s.vramMiB}` : "",
    ];
    for (const c of cells) row.append(el("td", "", c));
    const first = row.firstElementChild as HTMLElement;
    first.title = [
      s.scene,
      s.weather ? `weather: ${s.weather}` : "",
      f ? `${f.auto} · ${f.end?.status ?? ""} · tiles +${f.tilesLoaded ?? 0} (${f.tilesPending ?? 0} pending)` : "",
      ...s.errors,
    ]
      .filter(Boolean)
      .join("\n");
    if (a && a.fps < 30) row.classList.add("kb-slow");
    t.append(row);
  }
  return t;
}

function download(text: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
