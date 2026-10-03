// The Kerr Bench's reports gathered: every kerr-bench-*.json of a folder (friends' machines) in one
// table — a row per machine: its GPU, browser and platform, the Kerr Score, the Game frame rate by
// scene, the fixed throughput, the heat, the tier guessed and measured, the errors. Markdown on the
// console, CSV next to the reports.
//
//   bun scripts/bench-merge.ts [folder]        (default docs/perf/field)
import { Glob } from "bun";
import { checkReport, type BenchReport } from "../src/bench/report";

const dir = process.argv[2] ?? "docs/perf/field";
const reports: { file: string; r: BenchReport }[] = [];
for await (const f of new Glob("*.json").scan(dir)) {
  try {
    reports.push({ file: f, r: checkReport(JSON.parse(await Bun.file(`${dir}/${f}`).text())) });
  } catch (e) {
    console.warn(`(skipped ${f}: ${(e as Error).message})`);
  }
}
if (!reports.length) {
  console.log(`no Kerr Bench report in ${dir}`);
  process.exit(0);
}
reports.sort((a, b) => (b.r.score.kerrScore ?? 0) - (a.r.score.kerrScore ?? 0));
const scenes = [...new Set(reports.flatMap(({ r }) => r.scenes.map((s) => s.scene)))];
const short = (s: string) =>
  s
    .replace(/^Interstellar: /, "")
    .replace(/ \(.*\)$/, "")
    .slice(0, 18);

const head = [
  "machine",
  "GPU",
  "browser",
  "score",
  "tier (guess → measured)",
  ...scenes.map((s) => `${short(s)} fps`),
  "Mrays/s (mean)",
  "heat %",
  "errors",
];
const rows = reports.map(({ r }) => {
  const okFixed = r.scenes.filter((s) => s.fixed);
  const mean = okFixed.length ? okFixed.reduce((a, s) => a + s.fixed!.mraysPerS, 0) / okFixed.length : 0;
  return [
    r.machineLabel || "—",
    r.system.gpu.description || `${r.system.gpu.vendor} ${r.system.gpu.architecture}`,
    `${r.system.browser.brands[0] ?? ""} ${r.system.browser.platform}`.trim(),
    r.score.kerrScore ?? "—",
    `${r.system.tier.guessed} → ${r.system.tier.measured ?? "?"}`,
    ...scenes.map((n) => r.scenes.find((s) => s.scene === n)?.auto?.fps.toFixed(0) ?? "—"),
    mean.toFixed(2),
    r.thermal ? r.thermal.driftPct : "—",
    r.errors.gpu + r.scenes.reduce((a, s) => a + s.errors.length, 0) + (r.errors.deviceLost ? 1 : 0),
  ].map(String);
});
console.log(`| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|`);
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
const csv = [head, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
await Bun.write(`${dir}/summary.csv`, csv);
console.log(`\n${reports.length} reports → ${dir}/summary.csv`);
