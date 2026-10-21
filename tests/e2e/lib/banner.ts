// The e2e's banner on a Chrome one sees (the mini's full screen, a window — never headless): the file, the test running
// (its place, its title) and what the file proves (its header comment), in a corner of the page — so who sits at the
// screen knows what is being tried. Read from the test file itself (its describe, its tests in order, the -t filter
// applied); shown by the recorder (telemetry.ts: a page attached, each test begun); see-through to the pointer (the
// clicks' elementFromPoint pass through it) and hidden for every screenshot (cdp.ts). docs/E2E.md.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SHOW } from "./cdp";

interface FileInfo {
  name: string;
  suite: string;
  about: string;
  tests: string[];
}

const cache = new Map<string, FileInfo>();

/** The -t filter bun test was given (null: none). */
function filter(): RegExp | null {
  const a = process.argv;
  const i = a.findIndex((x) => x === "-t" || x === "--test-name-pattern");
  if (i < 0 || !a[i + 1]) return null;
  try {
    return new RegExp(a[i + 1]!);
  } catch {
    return null;
  }
}

/** A test file's describe, its tests (in order, the filter applied) and its header comment. */
export function fileInfo(path: string): FileInfo {
  const hit = cache.get(path);
  if (hit) return hit;
  let src = "";
  try {
    src = readFileSync(path.includes("/") ? path : `tests/e2e/${path}`, "utf8");
  } catch {}
  const str = (q: string) => String.raw`${q}((?:\\.|(?!${q})[^\\])*)${q}`;
  const title = `(?:${str('"')}|${str("'")}|${str("`")})`;
  const pick = (m: RegExpMatchArray) => (m[1] ?? m[2] ?? m[3] ?? "").replace(/\\(.)/g, "$1");
  const suite = src.match(new RegExp(String.raw`\bdescribe(?:\.skipIf\([^)]*\))?\(\s*${title}`));
  const f = filter();
  const full = (t: string) => (suite ? `${pick(suite)} ${t}` : t);
  const tests = [...src.matchAll(new RegExp(String.raw`\btest(?:\.skipIf\([^)]*\)|\.if\([^)]*\))?\(\s*${title}`, "g"))]
    .map(pick)
    .filter((t) => !f || f.test(t) || f.test(full(t)));
  // (the header: the first block of line comments — after the imports —, its lines joined)
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith("//") && !l.includes("biome-ignore"));
  const about: string[] = [];
  for (let k = start; k >= 0 && k < lines.length && lines[k]!.startsWith("//"); k++) about.push(lines[k]!.replace(/^\/\/\s?/, ""));
  const info = { name: basename(path), suite: suite ? pick(suite) : "", about: about.join(" ").replace(/\s+/g, " ").trim(), tests };
  cache.set(path, info);
  return info;
}

/** What the page runs to put up (or update) the banner. */
function script(file: string, k: number): string {
  const I = fileInfo(file);
  const head = k === 0 ? "setting up" : `test ${k}/${I.tests.length || "?"}`;
  const now = k === 0 ? I.suite || I.name : (I.tests[k - 1] ?? "");
  const about = I.about.length > 420 ? `${I.about.slice(0, 417)}…` : I.about;
  const data = JSON.stringify({ file: I.name, head, now, about });
  return `(() => { const d = ${data}; let el = document.getElementById("e2e-banner");
    if (!el) { el = document.createElement("div"); el.id = "e2e-banner"; el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(560px,calc(100vw - 24px));padding:10px 14px;border-radius:10px;background:rgba(8,12,20,.82);border:1px solid rgba(255,200,90,.55);color:#e8eef6;font:13px/1.35 system-ui,-apple-system,sans-serif;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.45)";
      document.documentElement.append(el); }
    el.replaceChildren();
    const row = (t, css) => { const s = document.createElement("div"); s.textContent = t; s.style.cssText = css; el.append(s); };
    row("E2E · " + d.file + " — " + d.head, "font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#ffc85a;margin-bottom:3px");
    row(d.now, "font-weight:650;font-size:14px;margin-bottom:4px");
    if (d.about) row(d.about, "font-size:12px;color:#b9c4d2;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden");
    return 1; })()`;
}

/** Puts the banner up on a page one sees: the file being set up (k 0) or its k-th test. Headless: nothing. */
export async function showBanner(page: { js(expr: string): Promise<unknown> } | null, file: string, k: number) {
  if (!page || SHOW === "headless" || !file || process.env.E2E_BANNER === "0") return;
  await page.js(script(file, k)).catch(() => {});
}
