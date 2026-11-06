// The graphics pipeline's static inventory, read from the sources (no browser, no GPU): every pipeline created and
// where, every WGSL program and its entry points, every pass label the GPU profiler can show — and a check that
// docs/GRAPHICS-PIPELINE.md names each of them (the doc is the map; this keeps it honest).
//
//   bun scripts/pipeline-inventory.ts                 the inventory, as text
//   bun scripts/pipeline-inventory.ts --json          machine-readable
//   bun scripts/pipeline-inventory.ts --check         the doc against the code: what the doc does not name (exit 1)
//   bun scripts/pipeline-inventory.ts --write         regenerate the doc's annex (between the inventory markers)
//   bun scripts/pipeline-inventory.ts --write --sizes … and the tracer kernels' inlined sizes (wgsl-inline-size, ~16 s CPU)
//
// Under a second without --sizes. Static only: a label built at run time (a variable) is listed as « dynamic » with its
// place; pipelines' compile times are not known here (see the doc, §5 — they need a browser).
import { Glob } from "bun";

const ROOT = new URL("..", import.meta.url).pathname;
const DOC = `${ROOT}docs/GRAPHICS-PIPELINE.md`;
const BEGIN = "<!-- pipeline-inventory:begin (bun scripts/pipeline-inventory.ts --write) -->";
const END = "<!-- pipeline-inventory:end -->";

const args = new Set(process.argv.slice(2));

interface PipelineSite {
  file: string;
  line: number;
  kind: "render" | "compute" | "module";
  async: boolean;
  label: string | null;
  entries: string[];
}
interface Program {
  file: string;
  line: number;
  /** a .wgsl file, or WGSL held in a TypeScript string */
  source: "wgsl" | "ts";
  lines: number;
  entries: { stage: string; name: string }[];
}
interface Label {
  label: string;
  file: string;
  line: number;
}

const rel = (p: string) => p.replace(ROOT, "");
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

const files: string[] = [];
for await (const f of new Glob("src/**/*.{ts,wgsl}").scan(ROOT)) if (!f.endsWith(".d.ts")) files.push(f);
files.sort();

const pipelines: PipelineSite[] = [];
const programs: Program[] = [];
const labels: Label[] = [];
const dynamic: Label[] = [];
/** passes encoded without the profiler's timestamps (their cost hides in the frame's) */
const untimed: Label[] = [];

const ENTRY_RE = /@(compute|vertex|fragment)\b[^;{}]*?\bfn\s+(\w+)/g;

for (const f of files) {
  const text = await Bun.file(ROOT + f).text();
  if (f.endsWith(".wgsl")) {
    const entries = [...text.matchAll(ENTRY_RE)].map((m) => ({ stage: m[1]!, name: m[2]! }));
    programs.push({ file: f, line: 1, source: "wgsl", lines: text.split("\n").length, entries });
    continue;
  }
  // WGSL in TypeScript: the template literals that declare an entry point
  for (const m of text.matchAll(/`([^`]*@(?:compute|vertex|fragment)[^`]*)`/g)) {
    const body = m[1]!;
    const entries = [...body.matchAll(ENTRY_RE)].map((x) => ({ stage: x[1]!, name: x[2]! }));
    if (entries.length) programs.push({ file: f, line: lineAt(text, m.index!), source: "ts", lines: body.split("\n").length, entries });
  }
  // pipelines and modules
  for (const m of text.matchAll(/\.create(Render|Compute)Pipeline(Async)?\(|\.createShaderModule\(/g)) {
    const at = m.index!;
    const kind = m[1] === "Render" ? "render" : m[1] === "Compute" ? "compute" : "module";
    // the descriptor: up to the next creation call, at most ~60 lines
    const rest = text.slice(at + m[0].length);
    const next = rest.search(/\.create(Render|Compute)Pipeline(Async)?\(|\.createShaderModule\(/);
    const window = rest.slice(0, Math.min(next < 0 ? rest.length : next, 4000));
    const label = /label:\s*["'`]([^"'`$]+)["'`]/.exec(window)?.[1] ?? null;
    const entries =
      kind === "module" ? [] : [...window.matchAll(/entryPoint:\s*["'`]?([\w.$]+)/g)].map((x) => x[1]!).filter((e) => e !== "string");
    pipelines.push({ file: f, line: lineAt(text, at), kind, async: !!m[2], label, entries: [...new Set(entries)] });
  }
  // the profiler's pass labels: prof.pass("…"), prof.timed("…"), this.pass("…"), profile("…")
  for (const m of text.matchAll(/\b(?:pass|timed|profile)\(\s*(?:"([^"]+)"|'([^']+)'|`([^`$]+)`|([A-Za-z_][\w.]*)\s*[,)])/g)) {
    const word = m[1] ?? m[2] ?? m[3];
    const ln = lineAt(text, m.index!);
    // only the GPU profiler's calls (a pass descriptor or a profiler handle near it)
    const lineText = text.split("\n")[ln - 1] ?? "";
    if (!/prof\??\.|this\.pass\(|(^|[^.\w])profile\(\s*"|beginComputePass|beginRenderPass/.test(lineText)) continue;
    if (word) labels.push({ label: word, file: f, line: ln });
    else if (m[4] && !/^(d|desc|descriptor|undefined)$/.test(m[4]) && !dynamic.some((x) => x.file === f && x.line === ln))
      dynamic.push({ label: m[4], file: f, line: ln });
  }
  // passes the profiler never times: no profiler descriptor, no timestamp callback handed in
  for (const m of text.matchAll(/\.begin(Compute|Render)Pass\(/g)) {
    const w = text.slice(m.index!, m.index! + 420);
    const call = w.slice(0, w.indexOf(";") < 0 ? w.length : w.indexOf(";"));
    if (/prof\??\.|this\.pass\(|profile\(|timestamp|\((?:desc|descriptor|pass)\b|\.\.\.prof/.test(call)) continue;
    const label = /label:\s*["'`]([^"'`$]+)/.exec(call)?.[1] ?? `${m[1]!.toLowerCase()} pass`;
    untimed.push({ label, file: f, line: lineAt(text, m.index!) });
  }
  // the post chain's labels (renderer: t.postPasses, labelled at creation)
  if (f === "src/renderer.ts")
    for (const m of text.matchAll(/label:\s*["`]((?:bloom|post|resolve|gather|glare|flare|lens|exposure|display)[^"`$]*)(\$\{)?/g))
      labels.push({ label: m[2] ? `${m[1]!.trim()} …` : m[1]!, file: f, line: lineAt(text, m.index!) });
}

// one row per label (its first place, and how many)
const byLabel = new Map<string, Label & { n: number }>();
for (const l of labels) {
  const x = byLabel.get(l.label);
  if (x) x.n++;
  else byLabel.set(l.label, { ...l, n: 1 });
}
const labelRows = [...byLabel.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const pipelineFiles = new Map<string, { render: number; compute: number; module: number; async: number }>();
for (const p of pipelines) {
  const x = pipelineFiles.get(p.file) ?? { render: 0, compute: 0, module: 0, async: 0 };
  x[p.kind]++;
  if (p.async) x.async++;
  pipelineFiles.set(p.file, x);
}

async function kernelSizes(): Promise<string> {
  const proc = Bun.spawnSync(["bun", "scripts/wgsl-inline-size.ts", "--json"], { cwd: ROOT, stderr: "pipe" });
  if (proc.exitCode !== 0) return `(wgsl-inline-size failed: ${proc.stderr.toString().slice(0, 200)})`;
  const rows = JSON.parse(proc.stdout.toString()) as { profile: string; entry: string; unique: number; inlined: number }[];
  const profiles = [...new Set(rows.map((r) => r.profile))];
  const out = [
    "| profil | noyaux (lignes inlinées, en milliers) | total |",
    "|---|---|---:|",
    ...profiles.map((p) => {
      const rs = rows.filter((r) => r.profile === p);
      const total = rs.reduce((s, r) => s + r.inlined, 0);
      return `| \`${p}\` | ${rs.map((r) => `${r.entry} ${(r.inlined / 1000).toFixed(1)}`).join(" · ")} | ${(total / 1000).toFixed(0)}k |`;
    }),
  ];
  return out.join("\n");
}

function markdown(sizes: string | null): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const head = (() => {
    const p = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT });
    return p.stdout.toString().trim();
  })();
  const o: string[] = [];
  o.push(`_Généré le ${now} sur \`${head}\` (arbre de travail). Ne pas éditer à la main : relancer l'outil._`, "");
  o.push(
    `**${pipelines.filter((p) => p.kind !== "module").length} sites de création de pipeline** (${pipelines.filter((p) => p.kind === "render").length} rendu, ${pipelines.filter((p) => p.kind === "compute").length} calcul, dont ${pipelines.filter((p) => p.async).length} asynchrones) et ${pipelines.filter((p) => p.kind === "module").length} \`createShaderModule\` dans ${pipelineFiles.size} fichiers ; ` +
      `**${programs.length} programmes WGSL** (${programs.filter((p) => p.source === "wgsl").length} fichiers .wgsl, ${programs.filter((p) => p.source === "ts").length} chaînes dans le TypeScript) ; ` +
      `**${labelRows.length} libellés de passes** du profileur GPU (+ ${dynamic.length} sites à libellé dynamique).`,
    "",
  );
  o.push("#### A.1 Sites de création de pipeline, par fichier", "");
  o.push("| fichier | rendu | calcul | modules | dont async |", "|---|---:|---:|---:|---:|");
  for (const [f, x] of [...pipelineFiles].sort((a, b) => b[1].render + b[1].compute - (a[1].render + a[1].compute)))
    o.push(`| \`${f}\` | ${x.render} | ${x.compute} | ${x.module} | ${x.async} |`);
  o.push("", "<details><summary>Détail des sites (fichier:ligne, type, libellé, points d'entrée)</summary>", "");
  o.push("| site | type | libellé | entrées |", "|---|---|---|---|");
  for (const p of pipelines.filter((x) => x.kind !== "module"))
    o.push(
      `| \`${p.file}:${p.line}\` | ${p.kind}${p.async ? " async" : ""} | ${p.label ? `\`${p.label}\`` : "—"} | ${p.entries.map((e) => `\`${e}\``).join(", ") || "—"} |`,
    );
  o.push("", "</details>", "");
  o.push("#### A.2 Programmes WGSL et points d'entrée", "");
  o.push("| source | lignes | points d'entrée |", "|---|---:|---|");
  for (const p of programs.sort((a, b) => b.lines - a.lines))
    o.push(
      `| \`${p.file}${p.source === "ts" ? `:${p.line}` : ""}\` | ${p.lines} | ${p.entries.length > 14 ? `${p.entries.length} entrées : ${p.entries.map((e) => e.name).join(", ")}` : p.entries.map((e) => `${e.name} (${e.stage[0]})`).join(", ")} |`,
    );
  o.push("", "#### A.3 Libellés du profileur GPU (`gpuprof.ts`)", "");
  o.push("| libellé | posé à | fois |", "|---|---|---:|");
  for (const l of labelRows) o.push(`| \`${l.label}\` | \`${l.file}:${l.line}\` | ${l.n} |`);
  if (dynamic.length) {
    o.push("", "Libellés dynamiques (calculés à l'exécution) :", "");
    for (const d of dynamic) o.push(`- \`${d.file}:${d.line}\` — \`${d.label}\``);
  }
  o.push("", "#### A.3b Passes jamais chronométrées (ni libellé du profileur, ni horodatage transmis)", "");
  o.push("Leur coût n'apparaît que dans l'intervalle de complétion de la frame (ou d'une soumission séparée).", "");
  o.push("| passe (libellé GPU) | site |", "|---|---|");
  for (const u of untimed) o.push(`| ${u.label} | \`${u.file}:${u.line}\` |`);
  if (sizes) o.push("", "#### A.4 Noyaux du traceur : taille inlinée par profil (`scripts/wgsl-inline-size.ts`)", "", sizes);
  return o.join("\n");
}

if (args.has("--json")) {
  console.log(JSON.stringify({ pipelines, programs, labels: labelRows, dynamic, untimed }, null, 1));
} else if (args.has("--check")) {
  const doc = await Bun.file(DOC).text();
  // the hand-written part only: the annex would name everything
  const body = doc.split(BEGIN)[0]!;
  const missing: string[] = [];
  for (const l of labelRows)
    if (!body.includes(l.label.replace(/ …$/, ""))) missing.push(`libellé de passe « ${l.label} » (${l.file}:${l.line})`);
  for (const f of pipelineFiles.keys()) {
    const base = f.split("/").pop()!;
    if (!body.includes(base)) missing.push(`fichier qui crée des pipelines : ${f}`);
  }
  for (const p of programs.filter((x) => x.source === "wgsl")) {
    const base = p.file.split("/").pop()!;
    if (!body.includes(base)) missing.push(`programme WGSL : ${p.file}`);
  }
  if (missing.length) {
    console.log(`docs/GRAPHICS-PIPELINE.md ne nomme pas ${missing.length} élément(s) du code :`);
    for (const m of missing) console.log(`  - ${m}`);
    console.log("\nLes décrire dans la section concernée, puis : bun scripts/pipeline-inventory.ts --write");
    process.exit(1);
  }
  console.log(
    `docs/GRAPHICS-PIPELINE.md nomme les ${labelRows.length} libellés, ${pipelineFiles.size} fichiers de pipelines et ${programs.filter((x) => x.source === "wgsl").length} fichiers WGSL.`,
  );
} else if (args.has("--write")) {
  const doc = await Bun.file(DOC).text();
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`markers not found in ${rel(DOC)}`);
  const sizes = args.has("--sizes")
    ? await kernelSizes()
    : (/#### A\.4[^\n]*\n\n([\s\S]*?)(?=\n<!-- pipeline-inventory:end)/.exec(doc)?.[1]?.trim() ?? null);
  const out = `${doc.slice(0, a + BEGIN.length)}\n\n${markdown(sizes)}\n\n${doc.slice(b)}`;
  await Bun.write(DOC, out);
  console.log(`annex regenerated in ${rel(DOC)}${args.has("--sizes") ? " (with the kernels' sizes)" : ""}`);
} else {
  console.log(markdown(args.has("--sizes") ? await kernelSizes() : null));
}
