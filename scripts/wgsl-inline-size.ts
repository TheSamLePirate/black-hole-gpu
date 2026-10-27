// How big each tracer kernel is once every call is inlined (what D3D12 compiles), per reference scene — and what
// inflates it. docs/PLAN-LEAN-TRACER-KERNELS.md (P0); the calibrated compile times: scripts/d3d12-compile-proxy.ts.
//
//   bun scripts/wgsl-inline-size.ts                       every profile, every pipeline of its cascade
//   bun scripts/wgsl-inline-size.ts earth-raster main     one pipeline: its multipliers and heaviest call edges
//   bun scripts/wgsl-inline-size.ts earth-raster main --stub earthNear,nearMarch   a "what if" (functions emptied)
//   bun scripts/wgsl-inline-size.ts --json                machine-readable (tests/kernel-budget.test.ts)
import type { TracerEntry } from "../src/system/tracer-kernels";
import { PROFILES, profileConstants, tracerSource } from "./lib/kernel-profiles";
import { InlineModel } from "./lib/wgsl-inline";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1] ?? "";
  args.splice(i, 2);
  return v;
};
const json = args.includes("--json");
if (json) args.splice(args.indexOf("--json"), 1);
const stubs = (flag("--stub") ?? "").split(",").filter(Boolean);
const [profileId, entryId] = args;

const src = tracerSource();
const k = (n: number) => `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;

if (profileId && entryId) {
  const p = PROFILES.find((x) => x.id === profileId);
  if (!p) throw new Error(`no profile ${profileId}: ${PROFILES.map((x) => x.id).join(", ")}`);
  const entry = entryId as TracerEntry;
  const m = new InlineModel(src, profileConstants(p, entry), stubs);
  const wgslEntry = entry === "discs" ? "main" : entry;
  const s = m.size(wgslEntry);
  console.log(`${p.label} — ${entry}${stubs.length ? ` (stubbed: ${stubs.join(", ")})` : ""}`);
  console.log(`  ${s.functions} functions, ${k(s.unique)} unique lines, ${k(s.inlined)} inlined`);
  console.log("\n  largest inlined subtrees (copies × lines each):");
  for (const x of m.multipliers(wgslEntry, 800).slice(0, 25))
    console.log(
      `    ${x.name.padEnd(26)} ×${String(x.copies).padStart(4)}  ${k(x.each).padStart(6)}  = ${((100 * x.total) / s.inlined).toFixed(0)} %`,
    );
  console.log("\n  heaviest call edges (a callee called from several sites, each site a copy):");
  for (const e of m.heavyEdges(wgslEntry)) console.log(`    ${e.caller} → ${e.callee} ×${e.sites} (${k(e.each)} each)`);
  process.exit(0);
}

const rows: { profile: string; entry: string; unique: number; inlined: number }[] = [];
for (const p of PROFILES.filter((x) => !profileId || x.id === profileId)) {
  let total = 0;
  if (!json) console.log(`\n${p.label}  [key ${p.key}${p.quality ? ", quality" : ""}]`);
  for (const entry of p.entries) {
    const m = new InlineModel(src, profileConstants(p, entry), stubs);
    const s = m.size(entry === "discs" ? "main" : entry);
    total += s.inlined;
    rows.push({ profile: p.id, entry, unique: s.unique, inlined: s.inlined });
    if (!json) console.log(`  ${entry.padEnd(11)} ${k(s.unique).padStart(6)} unique  ${k(s.inlined).padStart(7)} inlined`);
  }
  if (!json) console.log(`  ${"total".padEnd(11)} ${"".padStart(13)} ${k(total).padStart(7)}`);
}
if (json) console.log(JSON.stringify(rows, null, 1));
