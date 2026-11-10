// J0's fiche from a run of tests/e2e/j0-reference.e2e.test.ts (docs/J0-CONTRAT.md §9): its j0.json read, the figures the
// contract names written as Markdown — the way in, the flight's intervals against the palier, the effective quality, the CPU,
// the memory, the thermal state, the compute passes, the ablations against their baselines. Every figure from the file; nothing
// estimated.
//
//   bun scripts/j0-fiche.ts remote-results/j0/m1max/j0.json [--commit <sha>] [--out docs/progress/j0/FICHE-m1max-2026-11-10.md]
//
// Without --out, the Markdown goes to stdout.
import { $ } from "bun";

type Stats = {
  images: number;
  imagesPerS: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over33: number;
  over33ms: number;
  gpuP50: number;
  gpuP95: number;
};
type J0 = {
  scene: { id: string; date: string; flightS: number };
  machine: string;
  output: string;
  startedAt: string;
  userAgent?: string;
  adapter?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  wayIn?: Record<string, unknown>;
  thermalBefore?: unknown;
  thermalAfter?: unknown;
  memoryBefore?: Record<string, unknown>;
  memoryAfter?: Record<string, unknown>;
  flight?: Flight;
  sustained?: Flight;
  ablations?: (Stats & {
    key: string;
    label: string;
    loopCpuP95?: number;
    gpuMHz?: (number | null)[];
    pressure?: (string | null)[];
    compilingSeen?: number;
    tilesPendingMax?: number;
  })[];
};
type Thermal = { pressure?: string; gpuMHz?: number; gpuOfMaxPct?: number; gpuTempC?: number; state?: string };
type Flight = {
  stats: { all: Stats; firstHalf: Stats; secondHalf: Stats };
  thermal?: { start?: Thermal; mid?: Thermal; end?: Thermal };
  memory?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  samples: Record<string, number | string>[];
  passes: { pass: string; ms: number; n: number }[];
  loopCpu?: { n: number; p50: number; p95: number; p99: number; max: number };
  image?: string;
  tier?: unknown;
  end?: { hdg?: number };
};

const PALIER = { p50: 25, p95: 25, p99: 37.5, cpuP95: 4 };
const file = process.argv[2];
if (!file) {
  console.error("usage: bun scripts/j0-fiche.ts <j0.json> [--commit <sha>] [--out <file.md>]");
  process.exit(2);
}
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const j = (await Bun.file(file).json()) as J0;
const commit = arg("commit") ?? (await $`git rev-parse --short=8 HEAD`.quiet().text()).trim();
const ok = (v: number | undefined, max: number) => (v === undefined ? "—" : v <= max ? `${v} ✓` : `**${v}** ✗`);
const L: string[] = [];
const p = (s = "") => L.push(s);

p(`# J0 — fiche ${j.machine}, ${j.startedAt.slice(0, 10)}`);
p();
p(
  `Scène \`${j.scene.id}\` ([contrat](../../J0-CONTRAT.md)) · commit \`${commit}\` · sortie ${j.output} · lancé ${j.startedAt} · source \`${file}\` (écrite par \`scripts/j0-fiche.ts\`).`,
);
p(`Navigateur : ${j.userAgent ?? "—"}. Adaptateur : \`${JSON.stringify(j.adapter?.adapter ?? j.adapter ?? "—")}\`.`);
p(`Réglages effectifs (profil du joueur) : \`${JSON.stringify(j.settings ?? {})}\`.`);
p();
p("## Chemin d'entrée, à froid (profil Chrome neuf)");
p();
const w = j.wayIn ?? {};
p("| étape | s depuis le démarrage |");
p("|---|---:|");
for (const [k, label] of [
  ["firstImage", "première image (`game:artemis`)"],
  ["pilotableImage", "image pilotable (F-35 placé, noyau de la scène compilé)"],
  ["reliefIn", "couverture utile (relief fin, calme 3 s)"],
  ["fullDetail", "détail complet (imagerie, décor, noyaux)"],
] as const)
  p(`| ${label} | ${w[k] ?? "—"} |`);
p();
const th = (t?: Thermal) =>
  t ? `${t.pressure ?? t.state ?? "?"}, GPU ${t.gpuMHz ?? "?"} MHz (${t.gpuOfMaxPct ?? "?"} % du max), ${t.gpuTempC ?? "?"} °C` : "—";
const mem = (m?: Record<string, unknown>) =>
  m ? `Chrome ${m.chromeRssMB ?? "—"} Mo résidents, processus GPU ${m.gpuFootprintMB ?? "—"} Mo d'empreinte` : "—";
function flight(f: Flight, title: string) {
  const a = f.stats.all;
  p(`## ${title}`);
  p();
  p(`Thermique : au départ ${th(f.thermal?.start)} ; au milieu ${th(f.thermal?.mid)} ; à la fin ${th(f.thermal?.end)}.`);
  p();
  p("| mesure | valeur | palier 1 (proposition) |");
  p("|---|---:|---|");
  p(`| images nouvelles | ${a.images} (${a.imagesPerS}/s) | 40/s |`);
  p(`| intervalle p50 [ms] | ${ok(a.p50, PALIER.p50)} | ≤ ${PALIER.p50} |`);
  p(`| intervalle p95 [ms] | ${ok(a.p95, PALIER.p95)} | ≤ ${PALIER.p95} |`);
  p(`| intervalle p99 [ms] | ${ok(a.p99, PALIER.p99)} | ≤ ${PALIER.p99} |`);
  p(`| intervalle max [ms] | ${a.max} | — |`);
  p(`| épisodes > 33,3 ms | ${a.over33} (${a.over33ms} ms cumulés) | datés |`);
  p(`| temps GPU par image p50 / p95 [ms] (\`lastGpuMs\`) | ${a.gpuP50} / ${a.gpuP95} | — |`);
  p(
    `| boucle CPU p50 / p95 / p99 [ms] | ${f.loopCpu ? `${f.loopCpu.p50} / ${ok(f.loopCpu.p95, PALIER.cpuP95)} / ${f.loopCpu.p99}` : "—"} | p95 ≤ ${PALIER.cpuP95} |`,
  );
  p(`| image, tier | ${f.image ?? "—"}, \`${JSON.stringify(f.tier ?? "—")}\` | 1920×1080 |`);
  p(`| cap final | ${f.end?.hdg?.toFixed(0) ?? "—"}° | 340° demandé |`);
  p();
  p(
    `Première moitié (ligne droite et entrée du virage) : p50 ${f.stats.firstHalf.p50}, p95 ${f.stats.firstHalf.p95} ms ; seconde : p50 ${f.stats.secondHalf.p50}, p95 ${f.stats.secondHalf.p95} ms.`,
  );
  const col = (k: string) => f.samples.map((s) => Number(s[k])).filter((x) => Number.isFinite(x));
  const rng = (v: number[]) => (v.length ? `${Math.min(...v)} – ${Math.max(...v)}` : "—");
  p();
  p(
    `**Qualité effective et contexte, chaque seconde** : échelle de rendu ${rng(col("scale"))} ; bloc ${rng(col("block"))} ; qualité « ${f.samples[0]?.quality ?? "—"} » ; AGL ${rng(col("agl"))} m ; tuiles de relief en attente ${rng(col("tilesPending"))} ; orthophotos en attente ${rng(col("orthoPending"))} ; compilations ${rng(col("compiling"))} ; tas JS ${rng(col("heapMB"))} Mo.`,
  );
  if (f.memory) p(`Mémoire : avant ${mem(f.memory.before)} ; après ${mem(f.memory.after)}.`);
  p();
  p(
    "**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :",
  );
  p();
  p("| passe | ms moyen |");
  p("|---|---:|");
  for (const x of [...f.passes].sort((a, b) => b.ms - a.ms).slice(0, 15)) p(`| ${x.pass} | ${x.ms.toFixed(2)} |`);
  p();
}
if (j.flight)
  flight(j.flight, `Vol mesuré (${j.scene.flightS} s, temps réel, virage compris) — la machine telle que le démarrage la laisse`);
if (j.sustained) flight(j.sustained, "Le même vol, soutenu — après les ablations, la machine telle qu'un jeu prolongé la laisse");
p("## Mémoire et thermique de la séance");
p();
if (j.memoryBefore) p(`- Avant le vol : ${mem(j.memoryBefore)} ; après : ${mem(j.memoryAfter)}.`);
p(`- Thermique au lancement : ${th(j.thermalBefore as Thermal)} ; à la fin : ${th(j.thermalAfter as Thermal)}.`);
p();
if (j.ablations?.length) {
  const base = j.ablations.filter((x) => x.key === "base");
  const b50 = base.reduce((s, x) => s + x.p50, 0) / base.length;
  const b95 = base.reduce((s, x) => s + x.p95, 0) / base.length;
  const bGpu = base.reduce((s, x) => s + x.gpuP50, 0) / base.length;
  const bIps = base.reduce((s, x) => s + x.imagesPerS, 0) / base.length;
  // (a row's mean GPU clock against the baselines': past 10 % apart, its deltas measure the clock, not the item)
  const mhz = (x: { gpuMHz?: (number | null)[] }) => {
    const v = (x.gpuMHz ?? []).filter((m): m is number => typeof m === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const baseMhz = base.map(mhz).filter((m): m is number => m !== null);
  const bMhz = baseMhz.length ? baseMhz.reduce((a, b) => a + b, 0) / baseMhz.length : null;
  const spread = baseMhz.length > 1 ? Math.max(...baseMhz) / Math.min(...baseMhz) : 1;
  const apart = (x: { gpuMHz?: (number | null)[] }) => {
    const m = mhz(x);
    return bMhz !== null && m !== null && (Math.abs(m - bMhz) / bMhz > 0.1 || spread > 1.1);
  };
  const comparable = j.ablations.filter((x) => x.key !== "base" && !apart(x)).length;
  p("## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)");
  p();
  p(
    `Référence moyenne des deux vols de base : p50 ${b50.toFixed(1)} ms, p95 ${b95.toFixed(1)} ms (dérive entre eux : ${base.length === 2 ? `${(base[1]!.p50 - base[0]!.p50).toFixed(1)} ms au p50` : "—"}).`,
  );
  p();
  p(
    "| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |",
  );
  p("|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|");
  j.ablations.forEach((x, i) => {
    const d = (v: number, b: number, sign = 1) => (x.key === "base" ? "" : `${v - b >= 0 ? "+" : ""}${((v - b) * sign).toFixed(1)}`);
    p(
      `| ${i} | ${x.label}${x.key === "ship" ? " ¹" : ""} | ${x.imagesPerS} | ${d(x.imagesPerS, bIps)} | ${x.gpuP50} | ${d(x.gpuP50, bGpu)} | ${x.p50} | ${d(x.p50, b50)} | ${x.p95} | ${d(x.p95, b95)} | ${x.loopCpuP95 ?? "—"} | ${x.gpuMHz ? x.gpuMHz.join("→") : "—"}${apart(x) ? " ⚠" : ""} | ${x.compilingSeen ?? "—"} |`,
    );
  });
  p();
  if (j.ablations.some((x) => x.key === "ship"))
    p(
      "¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.",
    );
  if (spread > 1.1 || comparable < j.ablations.length - base.length)
    p(
      `**⚠ Fréquence GPU instable** (bases de ${baseMhz.map((m) => Math.round(m)).join(" et ")} MHz) : les lignes marquées ⚠ mesurent la fréquence, pas le poste — ${comparable} ablation(s) comparable(s) sur ${j.ablations.length - base.length}. La répartition par poste se lit sur une machine à fréquence stable.`,
    );
  p();
  p(
    "Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.",
  );
  p();
}
const md = L.join("\n");
const outFile = arg("out");
if (outFile) {
  await Bun.write(outFile, `${md}\n`);
  console.log(`j0-fiche: ${outFile}`);
} else console.log(md);
