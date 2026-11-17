// An e2e file's header and its scenarios, read from its text (docs/E2E.md, the banner — Sam, 16 Nov 2026: « les e2e doivent
// obligatoirement utiliser le bandeau d'information visible … et le scénario en cours »): the static guard's judge
// (tests/e2e-banner-guard.test.ts). Pure.

/** What a file lacks (empty: nothing). */
export function headerProblems(src: string): string[] {
  const out: string[] = [];
  const lines = src.split("\n");
  // (the header: the first block of line comments — after the imports —, as lib/banner.ts reads it)
  const start = lines.findIndex((l) => l.startsWith("//") && !l.includes("biome-ignore"));
  const head: string[] = [];
  for (let k = start; k >= 0 && k < lines.length && lines[k]!.startsWith("//"); k++) head.push(lines[k]!.replace(/^\/\/\s?/, ""));
  const about = head.filter((l) => !/^(Duration|Done when):/i.test(l)).join(" ");
  if (about.replace(/\s+/g, " ").trim().length < 60) out.push("no header saying what it proves and what it does");
  if (!head.some((l) => /^Duration:\s*\S/i.test(l))) out.push("no « // Duration: » line");
  if (!head.some((l) => /^Done when:\s*\S/i.test(l))) out.push("no « // Done when: » line");
  // (app.step says its step as a scenario — the declared steps, docs/E2E.md the banner point 6)
  if (casesChained(src) && !/\.scenario\(|\bapp\.step\(/.test(src))
    out.push("runs through cases without app.scenario(label) or app.step(name)");
  return out;
}

/** Whether a file runs through several cases a watcher must tell apart: a test title made from a template, or a loop over a list
 *  that places, lines up, engages an approach, changes the craft, the date or the weather. */
export function casesChained(src: string): boolean {
  if (/\btest(?:\.skipIf\([^)]*\)|\.if\([^)]*\))?\(\s*`[^`]*\$\{/.test(src)) return true;
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/\bfor \(const .* of /.test(lines[i]!)) continue;
    const body = lines.slice(i, i + 25).join("\n");
    if (/flyAt\(|lineUp\(|ilsStart\(|setDate\(|weather\s*[:=]|vessel\s*[:=]|fleet\.active/.test(body)) return true;
  }
  return false;
}
