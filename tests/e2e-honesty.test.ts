import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// The e2e that verify nothing (audit 2026-11-10, QA-08; wave 3.10), kept from coming back: a file without an `expect(` says
// so in its header (« no assertion »: a measure or a probe, its figures read, not judged); no wait is swallowed in
// silence — `waitFor(…).catch(() => {})` let a missing condition go by unseen (92 of them in 68 files on 13 Nov 2026): a wait
// that may not be met is `app.waitOptional(…)`, which says what was not met. The probes (`zz-`) are not tracked.

const DIR = `${import.meta.dir}/e2e`;
const files = readdirSync(DIR).filter((f) => f.endsWith(".e2e.test.ts") && !f.startsWith("zz-"));
const text = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");
/** the header: the first block of line comments after the imports */
const header = (s: string) => {
  const L = s.split("\n");
  const i = L.findIndex((l) => l.startsWith("// "));
  if (i < 0) return "";
  let j = i;
  while (j < L.length && L[j]!.startsWith("//")) j++;
  return L.slice(i, j).join("\n");
};
/** the session of the rendering's files, its own to change (CLAUDE.md, 13 Nov 2026): their swallowed waits counted, not changed */
const OTHERS = /^(j0-|j2|motion-quality)/;

test("every e2e asserts something, or says in its header that it is a measure (« no assertion »)", () => {
  const silent = files.filter((f) => !/expect\(/.test(text(f)) && !/no assertion/i.test(header(text(f))));
  expect(silent).toEqual([]);
});

test("no wait swallowed in silence: waitFor(…).catch(() => {}) replaced by app.waitOptional", () => {
  const swallowed = (f: string) => (text(f).match(/\.waitFor\([^;]*?\)\.catch\(\(\) => \{\}\)/g) ?? []).length;
  const mine = files.filter((f) => !OTHERS.test(f) && swallowed(f) > 0);
  expect(mine).toEqual([]);
  // (the rendering session's: counted — at most what they had on 13 Nov 2026 —, for it to take up)
  const theirs = files.filter((f) => OTHERS.test(f)).reduce((n, f) => n + swallowed(f), 0);
  expect(theirs).toBeLessThanOrEqual(1);
});
