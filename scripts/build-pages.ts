// Static site for GitHub Pages: the simulator at the root, the "Atlas de Kerr" gallery under docs/
// (its videos come from docs/video). Output: _site/
import { $ } from "bun";

await $`rm -rf _site`;
await $`bun build ./index.html --outdir _site --minify`;
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
await $`touch _site/.nojekyll`;
console.log("site ready in _site/");
