// Static site for GitHub Pages: the simulator at the root, the "Atlas de Kerr" gallery under docs/
// (its videos come from docs/video). Output: _site/
// KERR_SUBPATH: the directory the site serves this build under (the CI's preview: test) — its storage
// keys kept apart from the root app's on the same origin (src/util/storage.ts); empty: the root.
import { readdirSync } from "node:fs";
import { $ } from "bun";

const subpath = process.env.KERR_SUBPATH ?? "";
await $`rm -rf _site`;
await $`bun build ./index.html --outdir _site --minify --define __KERR_SUBPATH__=${JSON.stringify(subpath)}`;
// (the flight planner's worker, loaded by URL next to the page)
await $`bun build ./src/system/plan-worker.ts --outfile _site/plan-worker.js --minify --target browser`;
// (the KTX2 transcoder's worker and its WebAssembly)
await $`bun build ./src/system/ktx-worker.ts --outfile _site/ktx-worker.js --minify --target browser`;
await $`cp vendor/basis/basis_transcoder.wasm _site/basis_transcoder.wasm`;
await $`mkdir -p _site/docs/video`;
await $`cp -R gallery/. _site/docs/`;
await $`cp docs/video/*.mp4 _site/docs/video/`;
// (the French pages: how to play, the presentation; their images)
await $`mkdir -p _site/docs/img && cp docs/comment-jouer.html docs/decouvrir.html _site/docs/ && cp -R docs/img/comment-jouer docs/img/marketing _site/docs/img/`;
// (the build's version: the benchmark's report names it)
await Bun.write(
  "_site/version.json",
  JSON.stringify({ sha: (await $`git rev-parse --short HEAD`.text()).trim(), date: new Date().toISOString() }),
);
// the PWA (PLAN-MONDE M1): the manifest and icons; the Service Worker named by the build and told its
// directories (an app deployed under it — the CI's test/ — is not its to serve); the shell's core
// files to precache (the page, its script and styles, the workers, the WASM — not the textures)
const sha = (await $`git rev-parse --short HEAD`.text()).trim();
await $`cp pwa/manifest.webmanifest _site/ && mkdir -p _site/icons && cp pwa/icons/* _site/icons/`;
const dirs = readdirSync("_site", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
await $`bun build ./src/sw.ts --outfile _site/sw.js --minify --target browser --define __BUILD__=${JSON.stringify(sha)} --define __DIRS__=${JSON.stringify(dirs)}`;
const core = (await Array.fromAsync(new Bun.Glob("*").scan({ cwd: "_site", onlyFiles: true })))
  .filter((f) => /\.(js|css|wasm|html|json)$/.test(f) && f !== "sw.js" && f !== "precache.json")
  .map((f) => (f === "index.html" ? "./" : f))
  .sort();
await Bun.write("_site/precache.json", JSON.stringify(core));
await $`touch _site/.nojekyll`;
console.log("site ready in _site/");
