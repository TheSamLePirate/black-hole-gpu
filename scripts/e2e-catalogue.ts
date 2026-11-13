// The e2e catalogue kept whole (docs/E2E-CATALOGUE.md — audit 2026-11-10, QA-11: 125 of 397 files were missing from it,
// though it says « every e2e file »).
//
//   bun scripts/e2e-catalogue.ts --check    the files without a row (exit 1 if any)
//   bun scripts/e2e-catalogue.ts --write    a row for each, written from the file's own header, in the section
//                                           « From their headers » (to be moved into its theme when edited)
//
// A row is the dashboard's (scripts/dashboard/server.ts): `| file | what it proves | scene | duration | needs |`.
// The probes (`zz-`) are not catalogued. Pure parts exported for tests/e2e-catalogue.test.ts.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIR = join(ROOT, "tests/e2e");
const CATALOGUE = join(ROOT, "docs/E2E-CATALOGUE.md");
export const SECTION = "## From their headers";
const SECTION_INTRO = `${SECTION}

The files the catalogue missed (QA-11, 13 Nov 2026), each row written from the file's own header by
\`bun scripts/e2e-catalogue.ts --write\` — what it proves, its « Done when », the scene it boots, its time (\`tests/e2e/durations.json\`
when known, else the header's « Duration »). A row moves into its theme when the file is next edited.

### From their headers (to sort)

| file | what it proves | scene | duration | needs |
|---|---|---|---|---|
`;

/** The catalogued files: those with a row (the dashboard's own pattern). */
export function catalogued(md: string): Set<string> {
  const out = new Set<string>();
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*`?([\w.-]+\.e2e\.test\.ts)`?\s*\|(.*)\|\s*$/);
    if (m) out.add(m[1]!);
  }
  return out;
}

/** The e2e files to catalogue: every `*.e2e.test.ts` but the probes (`zz-`). */
export function e2eFiles(dir = DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".e2e.test.ts") && !f.startsWith("zz-"))
    .sort();
}

/** The files without a row. */
export function missing(files: string[], md: string): string[] {
  const have = catalogued(md);
  return files.filter((f) => !have.has(f));
}

/** The header: the first block of line comments (its lines, the `// ` taken off). */
export function header(src: string): string[] {
  const L = src.split("\n");
  const i = L.findIndex((l) => l.startsWith("// "));
  if (i < 0) return [];
  let j = i;
  while (j < L.length && L[j]!.startsWith("//")) j++;
  return L.slice(i, j).map((l) => l.replace(/^\/\/\s?/, ""));
}

const cut = (s: string, n: number) => {
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf(" — "));
  return `${(end > n * 0.5 ? head.slice(0, end + 1) : head).trimEnd()} …`;
};
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** A row for a file, from its header and its boot (its scene, its size), its known time. */
export function row(file: string, src: string, durations: Record<string, { mini?: number | null; here?: number | null }> = {}): string {
  const H = header(src);
  const at = (re: RegExp) => H.findIndex((l) => re.test(l));
  const done = at(/^Done when:/i);
  const dur = at(/^Duration:/i);
  const stop = [done, dur].filter((i) => i >= 0);
  const body = H.slice(0, stop.length ? Math.min(...stop) : H.length).join(" ");
  // (the « Done when » runs on to the next tagged line)
  const doneText =
    done >= 0
      ? H.slice(done, dur > done ? dur : H.length)
          .join(" ")
          .replace(/^Done when:\s*/i, "")
      : "";
  const what = cut(body || "(no header)", 320) + (doneText ? ` Done when: ${cut(doneText, 200)}` : "");
  const hash = src.match(/hash:\s*["'`]([^"'`]*)["'`]/)?.[1] ?? "";
  const scene = hash.includes("${") ? "set by the test" : (hash.match(/scene=([^&]*)/)?.[1] ?? (hash ? hash : "default"));
  const w = src.match(/width:\s*(\d+)/)?.[1];
  const h = src.match(/height:\s*(\d+)/)?.[1];
  const D = durations[file];
  const secs = D?.mini ?? D?.here ?? null;
  const duration =
    secs != null ? `${secs} s (${D?.mini != null ? "mini" : "here"})` : dur >= 0 ? H[dur]!.replace(/^Duration:\s*/i, "") : "—";
  const needs: string[] = [];
  for (const m of src.matchAll(/skipIf\([^)]*process\.env\.(\w+)/g)) if (m[1] !== "E2E") needs.push(`\`${m[1]}\``);
  if (/getGamepads/.test(src)) needs.push("simulated `navigator.getGamepads`");
  return `| ${file} | ${cell(what)} | ${cell(`${scene}${w && h ? `, ${w}×${h}` : ""}`)} | ${cell(duration)} | ${cell(needs.join(", ") || "—")} |`;
}

if (import.meta.main) {
  const md = readFileSync(CATALOGUE, "utf8");
  const files = e2eFiles();
  const gone = missing(files, md);
  if (process.argv.includes("--write")) {
    if (!gone.length) {
      console.log("the catalogue has every e2e file");
      process.exit(0);
    }
    const durations = JSON.parse(readFileSync(join(DIR, "durations.json"), "utf8"));
    const rows = gone.map((f) => row(f, readFileSync(join(DIR, f), "utf8"), durations));
    const i = md.indexOf(SECTION);
    const out = i < 0 ? `${md.trimEnd()}\n\n${SECTION_INTRO}${rows.join("\n")}\n` : addRows(md, rows);
    writeFileSync(CATALOGUE, out);
    console.log(`${rows.length} rows written (« ${SECTION.slice(3)} »)`);
  } else {
    console.log(`${files.length} e2e files, ${files.length - gone.length} catalogued, ${gone.length} missing`);
    for (const f of gone) console.log(`  ${f}`);
    process.exit(gone.length ? 1 : 0);
  }
}

/** The rows added at the end of the section's table. */
function addRows(md: string, rows: string[]): string {
  const L = md.split("\n");
  const s = L.findIndex((l) => l.startsWith(SECTION));
  let j = L.findIndex((l, k) => k > s && l.startsWith("| file |"));
  j += 2;
  while (j < L.length && L[j]!.startsWith("|")) j++;
  L.splice(j, 0, ...rows);
  return L.join("\n");
}
