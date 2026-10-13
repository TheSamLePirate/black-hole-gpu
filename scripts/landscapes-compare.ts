// The landscapes' captures against their photographs, measured in a browser (scripts/landscapes-compare.html):
// writes remote-results/landscapes/list.json (each landscape with a capture: its slug, title, vertical field of
// view, the photograph's page and a 1440-px rendition on Commons) and serves the repository's root.
//
//   bun run e2e landscapes                    (the captures, on this Mac: remote-results/landscapes/*.png)
//   bun scripts/landscapes-compare.ts [--port 4710]
//   → http://localhost:4710/scripts/landscapes-compare.html (window.__results: the figures, saved to
//     remote-results/landscapes/compare.json for scripts/landscapes-gallery.ts)
import { existsSync } from "node:fs";
import { LANDSCAPES, landscapeFov } from "../src/system/landscapes";
import { sceneSlug } from "./scene-slug";

const i = process.argv.indexOf("--port");
const port = i > 0 ? Number(process.argv[i + 1]) : 4710;
const DIR = "remote-results/landscapes";

/** a Commons file page's rendition at a width (Special:FilePath: redirected to upload.wikimedia.org, CORS open) */
export function commonsImage(page: string, width = 1440) {
  const file = decodeURIComponent(page.split("/wiki/")[1]!).replace(/^File:/, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
}

const list = LANDSCAPES.filter((l) => existsSync(`${DIR}/${sceneSlug(l.scene)}.png`)).map((l) => ({
  slug: sceneSlug(l.scene),
  title: l.title,
  fov: landscapeFov(l),
  page: l.photo.page,
  photoUrl: commonsImage(l.photo.page),
}));
await Bun.write(`${DIR}/list.json`, JSON.stringify(list, null, 2));
console.log(`${list.length} landscape(s) with a capture — http://localhost:${port}/scripts/landscapes-compare.html`);

Bun.serve({
  port,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
    // (the page's figures, kept for the gallery's captions: scripts/landscapes-gallery.ts)
    if (req.method === "POST" && path === "save") {
      await Bun.write(`${DIR}/compare.json`, `${JSON.stringify(await req.json(), null, 2)}\n`);
      return new Response("saved");
    }
    if (path.includes("..")) return new Response("no", { status: 400 });
    const f = Bun.file(path || "index.html");
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
