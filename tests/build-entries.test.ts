import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The workers built the same for production and for development (audit 2026-11-10, QA-13): their list lived in three places — the
// production build (scripts/build-pages.ts), the dev server's routes (server.ts), and a `build` script missing three of them
// (`bun run build` is now the production build itself). Each worker the site loads by URL: built by the first, served by the second,
// from the same source.

const ROOT = join(import.meta.dir, "..");
const pages = readFileSync(join(ROOT, "scripts/build-pages.ts"), "utf8");
const dev = readFileSync(join(ROOT, "server.ts"), "utf8");

/** production: `bun build ./src/… --outfile _site/X.js` (and the scenery worker's own script) */
const prod = new Map<string, string>();
for (const m of pages.matchAll(/bun build \.\/(\S+\.ts) --outfile _site\/([\w-]+\.js)/g)) prod.set(m[2]!, m[1]!);
if (/build-scenery-worker\.ts _site\/scenery-worker\.js/.test(pages)) prod.set("scenery-worker.js", "src/system/scenery-worker.ts");
/** development: `"/X.js": async () => { const r = await Bun.build({ entrypoints: ["./src/…"]` (on one line or several) */
const ROUTE = /"\/([\w-]+\.js)": async \(\) => \{\s*const r = await Bun\.build\(\{\s*entrypoints: \["\.\/([^"]+)"\]/g;
const served = new Map<string, string>();
for (const m of dev.matchAll(ROUTE)) served.set(m[1]!, m[2]!);

test("every worker of the production build served by the dev server, from the same source — and none only in one", () => {
  console.log(`  production ${prod.size}, development ${served.size}`);
  expect(prod.size).toBeGreaterThan(8);
  expect([...prod.keys()].sort()).toEqual([...served.keys()].sort());
  for (const [name, src] of prod) expect({ name, src: served.get(name) }).toEqual({ name, src });
});

test("`bun run build` is the production build", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  expect(pkg.scripts.build).toBe("bun scripts/build-pages.ts");
});
