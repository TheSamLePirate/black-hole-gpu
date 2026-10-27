// The D3D12 proxy's runs side by side (scripts/d3d12-compile-proxy.ts --json): per profile and pipeline, Tint + DXC seconds
// in each run, and the totals — a Markdown table for docs/progress/kernels/ (docs/PLAN-LEAN-TRACER-KERNELS.md).
//
//   bun scripts/kernel-report.ts docs/progress/kernels/proxy-baseline.json docs/progress/kernels/proxy-p1b.json …

interface Row {
  profile: string;
  entry: string;
  key: number;
  tintS: number;
  dxcS: number;
  dxilKB: number;
  ok: boolean;
}
const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: bun scripts/kernel-report.ts run1.json run2.json …");
const runs = await Promise.all(
  files.map(async (f) => ({
    name: f
      .split("/")
      .pop()!
      .replace(/^proxy-|\.json$/g, ""),
    rows: (await Bun.file(f).json()).rows as Row[],
  })),
);
const ids: string[] = [];
for (const r of runs) for (const x of r.rows) if (!ids.includes(`${x.profile} ${x.entry}`)) ids.push(`${x.profile} ${x.entry}`);
const cell = (x?: Row) => (x ? (x.ok ? `${(x.tintS + x.dxcS).toFixed(1)}` : "failed") : "—");
const lines = [`| profile | pipeline | ${runs.map((r) => `${r.name} [s]`).join(" | ")} |`, `|---|---|${runs.map(() => "---:").join("|")}|`];
const totals = new Map<string, number[]>();
for (const id of ids) {
  const [profile, entry] = id.split(" ");
  const xs = runs.map((r) => r.rows.find((x) => x.profile === profile && x.entry === entry));
  lines.push(`| ${profile} | ${entry} | ${xs.map(cell).join(" | ")} |`);
  const t = totals.get(profile!) ?? runs.map(() => 0);
  xs.forEach((x, i) => (t[i]! += x ? x.tintS + x.dxcS : 0));
  totals.set(profile!, t);
}
lines.push("", `| profile | ${runs.map((r) => `${r.name} total [s]`).join(" | ")} |`, `|---|${runs.map(() => "---:").join("|")}|`);
for (const [p, t] of totals) lines.push(`| ${p} | ${t.map((x) => x.toFixed(0)).join(" | ")} |`);
console.log(lines.join("\n"));
