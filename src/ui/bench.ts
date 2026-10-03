// The Kerr Bench's screen, at …/#bench (a link to send to friends with other hardware): what the test
// does and what it collects, the mode, a name for the machine; then the scenes it renders with a band
// of progress; then the score, the quality it recommends, a table by scene, and the report — downloaded,
// copied, shared, or compared with another one dropped here. Nothing is sent anywhere.

import "./bench.css";
import { tr, type Text } from "../i18n";
import type { KerrBench } from "../bench/runner";
import { checkReport, reportFileName, type BenchMode, type BenchReport } from "../bench/report";
import { store } from "../util/storage";

const T = {
  title: { fr: "Kerr Bench", en: "Kerr Bench" },
  intro: {
    fr: "Mesure ce que ta machine fait du traceur de Kerr : les scènes de référence rendues comme en jeu, puis à un réglage fixe comparable d'une machine à l'autre. À la fin, un rapport JSON à m'envoyer.",
    en: "Measures what your machine makes of the Kerr ray tracer: the reference scenes rendered as in the game, then at a fixed setting comparable between machines. At the end, a JSON report to send back.",
  },
  mode: { fr: "Durée", en: "Length" },
  quick: { fr: "Rapide", en: "Quick" },
  standard: { fr: "Standard", en: "Standard" },
  complete: { fr: "Complet", en: "Complete" },
  quickT: { fr: "≈ 1 min 30 · 4 scènes", en: "≈ 1 min 30 · 4 scenes" },
  standardT: { fr: "≈ 4 min · 8 scènes", en: "≈ 4 min · 8 scenes" },
  completeT: { fr: "≈ 15 min · + qualités, sous-échantillonnage", en: "≈ 15 min · + qualities, subsampling" },
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

export class BenchScreen {
  private root = el("div", "kb");
  private mode: BenchMode = "standard";

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

  private intro() {
    const p = el("div", "kb-panel");
    p.append(el("div", "kb-code", "KB-01 · WEBGPU"), el("h1", "", tr(T.title)), el("p", "", tr(T.intro)));
    p.append(el("span", "kb-label", tr(T.mode)));
    const modes = el("div", "kb-modes");
    const mk = (m: BenchMode, label: Text, sub: Text) => {
      const b = button(tr(label), () => {
        this.mode = m;
        for (const x of modes.children) x.setAttribute("aria-pressed", String(x === b));
      });
      b.append(el("small", "", tr(sub)));
      b.setAttribute("aria-pressed", String(m === this.mode));
      return b;
    };
    modes.append(mk("quick", T.quick, T.quickT), mk("standard", T.standard, T.standardT), mk("complete", T.complete, T.completeT));
    p.append(modes);
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
    row.append(
      button(tr(T.back), () => this.close()),
      button(
        tr(T.go),
        () => {
          store.set("kerr.bench-machine", name.value.trim());
          void this.start(name.value.trim());
        },
        "kb-go",
      ),
    );
    p.append(row);
    this.root.replaceChildren(p);
    (row.lastElementChild as HTMLButtonElement).focus();
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
    const report = await this.bench.run({
      mode: this.mode,
      machineLabel,
      onProgress: (p) => {
        what.textContent = p.scene;
        phase.textContent = p.phase ? `${tr(T.running)} · ${p.phase}` : tr(T.running);
        fps.textContent = p.fps > 0 ? `${p.fps.toFixed(0)} fps` : "";
        fill.style.width = `${(100 * p.frac).toFixed(1)}%`;
      },
    });
    this.results(report);
  }

  private results(r: BenchReport, other?: BenchReport) {
    const p = el("div", "kb-panel");
    p.append(el("div", "kb-code", `KB-02 · ${r.app.mode.toUpperCase()} · ${r.durationS} s`), el("h1", "", tr(T.title)));
    const sc = el("div", "kb-score");
    sc.append(el("b", "", r.score.kerrScore === null ? "—" : String(r.score.kerrScore)));
    sc.append(el("span", "", r.score.kerrScore === null ? tr(T.noScore) : tr(T.score)));
    if (r.score.recommendedQuality) sc.append(el("span", "", `${tr(T.recommended)} : ${r.score.recommendedQuality}`));
    p.append(sc);
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
    p.append(tb);
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

function download(text: string, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
