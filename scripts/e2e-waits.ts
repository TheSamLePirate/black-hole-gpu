// The e2e's long waits as measured (audit 2026-11-10, QA-09): tests/e2e/lib/app.ts writes each wait of 60 s or more — its file and
// line, its cap, how long it took, met or not — to remote-results/e2e-waits.jsonl. This reads them: for each wait, its runs, the
// longest it took, and what its cap could be — twice its longest, a minute at least — when it was always met; a cap lowered
// from that, not blind.
//
//   bun scripts/e2e-waits.ts [file.jsonl …] [--over 120]   (several logs: this Mac's and the mini's, fetched)

import { existsSync, readFileSync } from "node:fs";

interface Wait {
  file: string;
  line: number;
  cap: number;
  took: number;
  met: boolean;
  on?: string;
}

export interface WaitSummary {
  at: string;
  cap: number;
  runs: number;
  met: number;
  longest: number;
  /** the cap it could have (ms): twice its longest, 60 s at least, rounded up to 10 s; null when it was not always met */
  could: number | null;
}

/** Each wait's runs summed up, the longest-capped first. */
export function summarise(rows: Wait[]): WaitSummary[] {
  const by = new Map<string, Wait[]>();
  for (const r of rows) {
    const k = `${r.file}:${r.line}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([at, w]) => {
      const longest = Math.max(...w.map((x) => x.took));
      const met = w.filter((x) => x.met).length;
      const could = met === w.length ? Math.max(60_000, Math.ceil((2 * longest) / 10_000) * 10_000) : null;
      return { at, cap: Math.max(...w.map((x) => x.cap)), runs: w.length, met, longest, could };
    })
    .sort((a, b) => b.cap - a.cap);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const overAt = args.indexOf("--over");
  const over = overAt >= 0 ? Number(args[overAt + 1]) * 1000 : 0;
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--over");
  const rows: Wait[] = [];
  for (const f of files.length ? files : ["remote-results/e2e-waits.jsonl"]) {
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) rows.push(JSON.parse(l) as Wait);
  }
  const s = summarise(rows).filter((w) => w.cap > over);
  console.log(`e2e-waits: ${rows.length} waits measured, ${s.length} call sites${over ? ` capped over ${over / 1000} s` : ""}`);
  for (const w of s)
    console.log(
      `  ${w.at.padEnd(44)} cap ${(w.cap / 1000).toFixed(0).padStart(4)} s · ${w.runs} run(s), ${w.met} met · longest ${(w.longest / 1000).toFixed(1)} s` +
        (w.could !== null && w.could < w.cap
          ? ` → could be ${(w.could / 1000).toFixed(0)} s`
          : w.could === null
            ? " (not always met)"
            : ""),
    );
}
