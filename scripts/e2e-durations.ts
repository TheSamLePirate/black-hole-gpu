// The e2e files' measured durations (docs/E2E.md — the banner's "⏱ 3:12 / ~4 min"): every `bun run e2e --each` summary
// found (remote-results/**/e2e-summary-*.json — here and brought back from kerr-mini), its files that passed, their
// seconds' median by machine — kerr-mini (the M1 that runs the campaigns, full screen) and this Mac — written to
// tests/e2e/durations.json. A file's own header line "// Duration: …" wins over it.
//
//   bun scripts/e2e-durations.ts [roots…]     (default: remote-results)
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  file: string;
  code: number;
  fail: number;
  seconds: number;
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["remote-results"];
const found: string[] = [];
const walk = (dir: string, depth: number) => {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (/^e2e-summary-.*\.json$/.test(n)) found.push(p);
    // (the reports' own folders hold no summary: not walked — thousands of them)
    else if (depth < 6 && n !== "e2e-reports" && statSync(p, { throwIfNoEntry: false })?.isDirectory()) walk(p, depth + 1);
  }
};
for (const r of roots) walk(r, 0);

const times: Record<string, { mini: number[]; here: number[] }> = {};
for (const f of found) {
  let s: { host?: string; rows?: Row[] };
  try {
    s = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    continue;
  }
  const mini = /mini/i.test(s.host ?? "");
  for (const r of s.rows ?? []) {
    if (r.code !== 0 || r.fail > 0 || !(r.seconds > 0)) continue;
    const t = (times[r.file] ??= { mini: [], here: [] });
    (mini ? t.mini : t.here).push(r.seconds);
  }
}
const median = (x: number[]) => {
  if (!x.length) return null;
  const s = [...x].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};
const out: Record<string, { mini: number | null; here: number | null; runs: number }> = {};
for (const [file, t] of Object.entries(times).sort(([a], [b]) => a.localeCompare(b)))
  out[file] = { mini: median(t.mini), here: median(t.here), runs: t.mini.length + t.here.length };
writeFileSync("tests/e2e/durations.json", `${JSON.stringify(out, null, 1)}\n`);
console.log(`e2e-durations: ${found.length} summaries, ${Object.keys(out).length} files → tests/e2e/durations.json`);
