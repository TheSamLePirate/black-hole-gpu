// A trace of the compiles, kept in localStorage so the next page load can print the last page's: the console
// of a reloaded page does not hold what the previous one said.

const KEY = "compile-trail";
const stamp = () => `${(performance.now() / 1000).toFixed(1)} s`;

let lines: string[] = [];
try {
  const before = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  if (before.length) console.info(`[compile] previous page:\n${before.join("\n")}`);
} catch {}

export function trail(message: string) {
  const line = `[compile] ${stamp()} ${message}`;
  console.info(line);
  lines.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
  if (lines.length > 60) lines = lines.slice(-60);
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {}
}

addEventListener("beforeunload", () => trail("beforeunload"));
addEventListener("pagehide", () => trail("pagehide"));
