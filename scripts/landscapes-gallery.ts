// The exceptional landscapes into the galleries, from their captures (tests/e2e/landscapes: remote-results/landscapes/
// <slug>.png, 3 : 2 or 2 : 3 like their photographs):
//   - the web gallery (gallery/index.html, "Les paysages"): gallery/img/paysages/<slug>.jpg (1440 px on the long side)
//     and gallery/paysages.json — each one's French title and caption, the photograph's credit and page, the lens,
//     the moment, and the comparison with the photograph when remote-results/landscapes/compare.json has it
//     (scripts/landscapes-compare.html → window.__results, saved there);
//   - the scene gallery in the game: assets/scenes/<slug>.webp (640 × 360, the middle of the frame), then
//     scripts/scene-thumbs.ts writes their imports.
//
//   bun scripts/landscapes-gallery.ts
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import fr from "../src/i18n/fr-settings";
import { LANDSCAPES, landscapeFov, photoUtc, viewHeading } from "../src/system/landscapes";
import { sceneSlug } from "./scene-slug";

const SRC = "remote-results/landscapes";
/** What the capture shares with its photograph and what it misses — looked at side by side
 *  (scripts/landscapes-compare.html), 13 October 2026, the last six again after their fixes */
const NOTES: Record<string, string> = {
  "earth-the-grand-canyon-from-hopi-point":
    "Fidèle au cadrage : la rive nord et les temples au même endroit. La photo, voilée de nuages, est plus claire que la lumière du soir calculée.",
  "earth-the-matterhorn-from-the-riffelsee":
    "Fidèle : la pyramide et son reflet dans le Riffelsee à la même place. La neige et la roche manquent de détail (le relief est à ~20 m).",
  "earth-mont-blanc-from-the-lac-blanc":
    "Fidèle après correction (cap 7° plus à l'ouest, regard 12° plus bas) : la ligne de crêtes du massif épouse celle de la photo.",
  "earth-the-geirangerfjord-from-flydalsjuvet": "Fidèle : la vallée, le lac du fond et les deux versants au même endroit.",
  "earth-reine-from-reinebringen":
    "Fidèle : Olstinden au-delà du Reinefjord, ligne d'horizon corrélée à 0,93 — la photo vise ce sommet, nommé sur sa page, et non le village en contrebas.",
  "earth-kirkjufell-over-kirkjufellsfoss":
    "Proche après correction (cap 14° plus à droite) : le cône à gauche du centre. La cascade du premier plan, trop petite pour le relief, manque.",
  "earth-lauterbrunnen-and-the-staubbach-falls":
    "Proche : la chute dans le tiers gauche, la paroi désormais nue (plus d'arbres sur les pentes de plus de 50°), les maisons en volumes ; la photo, prise plus près, emplit le cadre de la paroi.",
  "earth-the-cuernos-del-paine":
    "Partiel : le point de vue dégagé de sa forêt et le massif à la bonne hauteur, mais les aiguilles des Cuernos, trop fines pour le relief (~30 m), deviennent un dôme arrondi.",
  "earth-fitz-roy-above-the-laguna-de-los-tres":
    "Partiel : au point GPS la caméra était dans un creux ; depuis la crête entre les deux lagunas, la Sucia à gauche, la Tres à droite et le massif derrière, mais les tours de granit, plus fines que le relief, sont arrondies.",
  "earth-mount-fuji-across-lake-kawaguchi":
    "Proche : les pins à gauche, le lac et le Fuji au fond ; le volcan paraît plus grand que sur la photo.",
  "earth-moraine-lake-and-the-valley-of-the-ten-peaks":
    "Proche : la caméra posée au sommet du Rockpile tel que le relief le dessine (120 m plus loin que le point GPS) — le lac et les Dix Pics avec leur reflet. Les sommets, arrondis par le relief, et le miroir du lac reste tacheté.",
  "earth-the-dunes-of-sossusvlei":
    "Partiel : au 150 mm, la crête d'une dune sur le ciel comme sur la photo ; le sable sans ses rides ni le jeu d'ombre du matin.",
  "earth-monument-valley-s-mittens": "Fidèle : les deux Mittens et Merrick Butte au même endroit, sur le même horizon.",
  "earth-mount-moran-from-oxbow-bend":
    "Proche après correction (cap 4° à gauche, regard 9° plus bas) : le mont Moran et la rivière ; les fleurs du premier plan manquent.",
};
mkdirSync("gallery/img/paysages", { recursive: true });
const tr = (s: string) => (fr as Record<string, string>)[s] ?? s;
const compare: {
  slug: string;
  skylineCorr?: number;
  skylineCorrAligned?: number;
  headingErrDeg?: number;
  pitchErrDeg?: number;
  edgeCorr?: number;
}[] = existsSync(`${SRC}/compare.json`) ? await Bun.file(`${SRC}/compare.json`).json() : [];

const out = [];
for (const l of LANDSCAPES) {
  const slug = sceneSlug(l.scene);
  const png = `${SRC}/${slug}.png`;
  if (!existsSync(png)) {
    console.warn(`no capture for “${l.scene}” — bun run e2e landscapes`);
    continue;
  }
  await $`magick ${png} -resize 1440x1440 -quality 86 -strip gallery/img/paysages/${slug}.jpg`.quiet();
  // (the scene gallery's 16 : 9 card: the frame's middle band, as the game's own captures crop)
  await $`magick ${png} -gravity center -crop ${"%[fx:w]x%[fx:w*9/16]+0+0"} +repage -resize 640x360^ -gravity center -extent 640x360 -quality 82 assets/scenes/${slug}.webp`.quiet();
  const file = decodeURIComponent(l.photo.page.split("/wiki/")[1]!).replace(/^File:/, "");
  const c = compare.find((x) => x.slug === slug);
  out.push({
    slug,
    scene: l.scene,
    title: tr(l.title),
    text: tr(l.description),
    portrait: !!l.photo.portrait,
    photo: {
      page: l.photo.page,
      file,
      thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`,
      author: l.photo.author,
      licence: l.photo.licence,
      estimated: l.photo.estimated ?? null,
    },
    at: l.at,
    heading: +viewHeading(l).toFixed(1),
    headingFrom: l.headingFrom,
    pitch: l.pitch,
    focal35: l.photo.focal35,
    fov: +landscapeFov(l).toFixed(1),
    utc: new Date(photoUtc(l.photo)).toISOString().slice(0, 16).replace("T", " "),
    compare: c && !("error" in c) ? c : null,
    note: NOTES[slug] ?? null,
  });
}
await Bun.write("gallery/paysages.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.length} landscape(s): gallery/img/paysages, gallery/paysages.json, assets/scenes`);
await $`bun scripts/scene-thumbs.ts`;
