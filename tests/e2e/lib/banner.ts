// The e2e's banner on a Chrome one sees (the mini's full screen, a window — never headless): the file, the test running
// (its place, its title) and what the file proves (its header comment), in a corner of the page — so who sits at the
// screen knows what is being tried. Read from the test file itself (its describe, its tests in order, the -t filter
// applied); shown by the recorder (telemetry.ts: a page attached, each test begun); see-through to the pointer (the
// clicks' elementFromPoint pass through it) and hidden for every screenshot (cdp.ts). docs/E2E.md.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename } from "node:path";
import { SHOW } from "./cdp";

interface FileInfo {
  name: string;
  suite: string;
  about: string;
  tests: string[];
  /** its header's "Duration:" line — how long it takes (docs/E2E.md) —, and its "Done when:" line — what ends it */
  duration: string;
  done: string;
}

const cache = new Map<string, FileInfo>();

/** A duration [s] said as the banner says it: "~45 s", "~4 min". */
const said = (s: number) => (s < 90 ? `~${Math.round(s)} s` : `~${Math.round(s / 60)} min`);
/** The file's measured duration (tests/e2e/durations.json — scripts/e2e-durations.ts: the median of the runs that passed),
 *  this machine's first (kerr-mini's, or this Mac's), else the other's; "" when never measured. */
function measured(name: string): string {
  let all: Record<string, { mini: number | null; here: number | null; runs: number }> = {};
  try {
    all = JSON.parse(readFileSync("tests/e2e/durations.json", "utf8"));
  } catch {
    return "";
  }
  const d = all[name];
  if (!d) return "";
  const mini = /mini/i.test(hostname());
  const [mine, other] = mini ? [d.mini, d.here] : [d.here, d.mini];
  const where = mine !== null ? (mini ? "on kerr-mini" : "on this Mac") : mini ? "on the MacBook" : "on kerr-mini";
  const s = mine ?? other;
  return s === null ? "" : `${said(s)} ${where} (median of ${d.runs} run${d.runs > 1 ? "s" : ""})`;
}

/** The -t filter bun test was given (null: none). bun test leaves it out of process.argv: read from the process's own command line
 *  (ps — its quoting lost: the pattern runs to the next flag or the line's end). */
let filterRead: RegExp | null | undefined;
function filter(): RegExp | null {
  if (filterRead !== undefined) return filterRead;
  const a = process.argv;
  const i = a.findIndex((x) => x === "-t" || x === "--test-name-pattern");
  let pat = i >= 0 ? (a[i + 1] ?? null) : null;
  if (pat === null) {
    try {
      const line = Bun.spawnSync(["ps", "-ww", "-o", "args=", "-p", String(process.pid)])
        .stdout.toString()
        .trim();
      const m = line.match(/(?:^|\s)(?:-t|--test-name-pattern)(?:=|\s+)(.+?)(?=\s+--?[a-zA-Z]|$)/);
      // (ps writes the bytes beyond ASCII as « M-x » — « leçons » comes as « leM-CM-'ons »: such a run one or two characters)
      pat = m ? m[1]!.replace(/^(["'])(.*)\1$/, "$2").replace(/(?:M-.)+/g, ".{1,2}") : null;
    } catch {}
  }
  try {
    filterRead = pat ? new RegExp(pat) : null;
  } catch {
    filterRead = null;
  }
  return filterRead;
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
  const all = [...src.matchAll(new RegExp(String.raw`\btest(?:\.skipIf\([^)]*\)|\.if\([^)]*\))?\(\s*${title}`, "g"))].map(pick);
  // (a filter that picks none — misread —: the file's tests all, rather than none)
  const picked = all.filter((t) => !f || f.test(t) || f.test(full(t)));
  const tests = picked.length ? picked : all;
  // (the header: the first block of line comments — after the imports —, its lines joined; its "Duration:" and "Done when:"
  // lines apart, each running on to the next tagged line or the header's end)
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith("//") && !l.includes("biome-ignore"));
  const about: string[] = [];
  const tagged: Record<"duration" | "done", string[]> = { duration: [], done: [] };
  let into: string[] = about;
  for (let k = start; k >= 0 && k < lines.length && lines[k]!.startsWith("//"); k++) {
    const l = lines[k]!.replace(/^\/\/\s?/, "");
    const m = l.match(/^(Duration|Done when):\s*(.*)$/i);
    if (m) {
      into = m[1]!.toLowerCase() === "duration" ? tagged.duration : tagged.done;
      into.push(m[2]!);
    } else into.push(l);
  }
  const join = (x: string[]) => x.join(" ").replace(/\s+/g, " ").trim();
  const info = {
    name: basename(path),
    suite: suite ? pick(suite) : "",
    about: join(about),
    tests,
    // (no header line: the measured median; the file's last test's end)
    duration: join(tagged.duration) || measured(basename(path)),
    done: join(tagged.done) || (tests.length ? `its last test ends — “${tests[tests.length - 1]}”` : ""),
  };
  cache.set(path, info);
  return info;
}

/** This machine's name as the lab says it (kerr-mini, this Mac's). */
const HOST = hostname().replace(/\.local$/, "");

/** A test title as one reads it: a template's `${…}` (its values unknown to the file's text) said « … ». */
export const titleOf = (t: string) => t.replace(/\$\{[^}]*\}/g, "…");

/**
 * The run's reference Sam can quote (docs/E2E.md, the banner): `<file> #<k>/<n> · <scenario or test>` — the same words on the
 * banner's first line, in the log (app.scenario's line), in the live record and in the captures' names.
 */
export function bannerRef(file: string, k: number, scenario: string | null): string {
  const I = fileInfo(file);
  const name = I.name.replace(/\.e2e\.test\.ts$/, "");
  if (k === 0) return `${name} · setting up${scenario ? ` · ${scenario}` : ""}`;
  return `${name} #${k}/${I.tests.length || "?"} · ${scenario ?? titleOf(I.tests[k - 1] ?? "")}`;
}

/** The run's progress as the test declares it (lib/app.ts steps/step/progress/stepDone/estimate — docs/E2E.md, the banner, point 6:
 *  « moins de blabla dans la bannière mais plus d'infos sur le déroulement du test », Sam, 17 Nov 2026). */
export interface BannerProgress {
  /** the steps in order, the one under way (its index, -1 none) */
  steps: string[];
  at: number;
  /** its own progress (« zone 49 920 / 60 738 · 1 811 Mo ») */
  progress: string | null;
  /** the steps ended, with their result */
  done: { text: string; ok: boolean }[];
  /** the live values the test judges (GPU p50 so far, quick images…) */
  values: string | null;
  /** the whole run's estimate [s] (the test's own) */
  estimateS: number | null;
  /** when the step began and its progress was last said [ms, epoch] — counted on the page every second (a long page call that
   *  holds the banner's updates leaves its clocks running; « dit il y a N s » under a count that no longer moves) */
  stepAt: number | null;
  saidAt: number | null;
  /** the harness's own count in a wait the test left silent over 10 s (waitFor, waitProgress — the approaches session's idea) */
  auto: string | null;
}

/** What it proves, in one line: the header's first sentence, ~120 characters. */
export function aboutLine(about: string): string {
  const m = about.match(/^(.+?[.!?])(?:\s|$)/);
  const s = (m ? m[1]! : about).trim();
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/** What the page runs to put up (or update) the banner. */
function script(
  file: string,
  k: number,
  scenario: string | null = null,
  earth: string | null = null,
  p: BannerProgress | null = null,
): string {
  const I = fileInfo(file);
  const head = `${bannerRef(file, k, scenario)} · ${HOST}`;
  // (the test's title — a template's values unknown to the text: the scenario said in its place)
  const title = k === 0 ? I.suite || I.name : (I.tests[k - 1] ?? "");
  const now = /\$\{/.test(title) && scenario ? scenario : titleOf(title);
  const about = aboutLine(I.about);
  // (the declared steps: « Étape k/n · name », its progress, the last ended ones; the time against the run's own estimate)
  const step = p && p.at >= 0 ? `Étape ${p.at + 1}/${p.steps.length} · ${p.steps[p.at]}` : null;
  const ended = p ? p.done.slice(-4).map((d) => `${d.ok ? "✓" : "✗"} ${d.text}`) : [];
  const total = p?.estimateS ? `${said(p.estimateS)} estimated` : I.duration;
  const data = JSON.stringify({
    file: I.name,
    head,
    now,
    scenario: step ? null : scenario,
    about,
    duration: total,
    done: I.done,
    earth,
    step,
    progress: p?.progress ?? null,
    ended,
    values: p?.values ?? null,
    stepAt: p?.stepAt ?? null,
    saidAt: p?.saidAt ?? null,
    auto: p?.auto ?? null,
  });
  return `(() => { const d = ${data}; let el = document.getElementById("e2e-banner");
    if (!el) { el = document.createElement("div"); el.id = "e2e-banner"; el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(560px,calc(100vw - 24px));padding:10px 14px;border-radius:10px;background:rgba(8,12,20,.82);border:1px solid rgba(255,200,90,.55);color:#e8eef6;font:13px/1.35 system-ui,-apple-system,sans-serif;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.45)";
      document.documentElement.append(el); }
    el.replaceChildren();
    const row = (t, css) => { const s = document.createElement("div"); s.textContent = t; s.style.cssText = css; el.append(s); };
    row("E2E · " + d.head, "font-size:11.5px;letter-spacing:.03em;color:#ffc85a;margin-bottom:3px;font-variant-numeric:tabular-nums");
    row(d.now, "font-weight:650;font-size:14px;margin-bottom:4px");
    if (d.scenario && d.scenario !== d.now) row("Scénario · " + d.scenario, "font-weight:600;font-size:13px;color:#ffe2a8;margin-bottom:4px");
    if (d.about) row(d.about, "font-size:12px;color:#b9c4d2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
    if (d.step) row(d.step, "font-weight:650;font-size:13.5px;color:#ffe2a8;margin-top:5px");
    if (d.progress) row(d.progress, "font-size:12.5px;color:#e8eef6;font-variant-numeric:tabular-nums");
    if (d.auto) row("⏳ " + d.auto, "font-size:12.5px;color:#ffd38a;font-variant-numeric:tabular-nums");
    // (the step's clock and the age of its count, kept running by the page)
    const since = document.createElement("div");
    since.style.cssText = "font-size:11.5px;color:#9fb6d6;font-variant-numeric:tabular-nums";
    if (d.stepAt) el.append(since);
    if (d.values) row(d.values, "font-size:12px;color:#9fe0a8;font-variant-numeric:tabular-nums");
    for (const t of d.ended) row(t, "font-size:11.5px;color:" + (t.startsWith("✗") ? "#ff9b8a" : "#9fb6d6"));
    // (how long it takes against the time gone — since this file's or test's banner first went up —, and what ends it)
    const key = d.file + "|" + d.head.split(" · ")[0];
    if (window.__e2eBannerKey !== key) { window.__e2eBannerKey = key; window.__e2eBannerT0 = Date.now(); }
    const clock = document.createElement("div");
    clock.style.cssText = "font-size:12px;color:#ffc85a;margin-top:4px;font-variant-numeric:tabular-nums";
    el.append(clock);
    const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    const tick = () => { const s = Math.round((Date.now() - window.__e2eBannerT0) / 1000);
      clock.textContent = "⏱ " + mmss(s) + (d.duration ? " / " + d.duration : "");
      if (d.stepAt) { const a = d.saidAt ? Math.round((Date.now() - d.saidAt) / 1000) : 0;
        since.textContent = "étape " + mmss(Math.round((Date.now() - d.stepAt) / 1000)) + (d.saidAt && a >= 15 ? " · compteur dit il y a " + a + " s" : ""); } };
    tick();
    clearInterval(window.__e2eBannerTimer);
    window.__e2eBannerTimer = setInterval(tick, 1000);
    if (d.done) row("Done when: " + d.done, "font-size:12px;color:#9fe0a8;margin-top:2px");
    if (d.earth) row("Earth data: " + d.earth, "font-size:11.5px;color:#9fb6d6;margin-top:2px");
    return 1; })()`;
}

/** Puts the banner up on a page one sees: the file being set up (k 0) or its k-th test. Headless: nothing. */
export async function showBanner(
  page: { js(expr: string): Promise<unknown>; earth?: { mode: string; dir: string } | null } | null,
  file: string,
  k: number,
  scenario: string | null = null,
  progress: BannerProgress | null = null,
) {
  if (!page || SHOW === "headless" || !file || process.env.E2E_BANNER === "0") return;
  // (where the tiles come from — PLAN-J8 J8-T: the disk's folder, or the network)
  const e = page.earth;
  const earth = !e || e.mode === "off" ? "network" : `${e.mode === "on" ? "disk" : e.mode} · ${e.dir.replace(/^\/Users\/[^/]+/, "~")}`;
  await page.js(script(file, k, scenario, earth, progress)).catch(() => {});
}
