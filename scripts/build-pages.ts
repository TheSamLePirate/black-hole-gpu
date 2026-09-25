// Static site for GitHub Pages: the simulator at the root, the "Atlas de Kerr" gallery under docs/
// (its videos come from docs/video). Output: _site/
import { $ } from "bun";

await $`rm -rf _site`;
await $`bun build ./index.html --outdir _site --minify`;
await $`mkdir -p _site/docs/video`;
await $`cp -R gallery/. _site/docs/`;
await $`cp docs/video/*.mp4 _site/docs/video/`;
await $`touch _site/.nojekyll`;
console.log("site ready in _site/");
