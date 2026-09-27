// The scene gallery's pictures: moves the captures from snapshots/scene-<slug>.webp to
// assets/scenes/<slug>.webp and writes src/ui/scene-thumbs.ts (one import per scene that has one).
//
// Capture (dev server, the page open, in the devtools console): each scene is applied, left to
// converge, then its image is cropped to 16:9, scaled to 640 × 360 and posted to snapshots/ —
//
//   await __bh.captureScenes()          // all of them, ~4 minutes
//   await __bh.captureScenes(["Jet side view"])
//
// then: bun scripts/scene-thumbs.ts
import { presets } from "../src/settings";
import { readdirSync, renameSync, mkdirSync, existsSync } from "node:fs";

export const sceneSlug = (n: string) =>
  n.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);

mkdirSync("assets/scenes", { recursive: true });
for (const f of existsSync("snapshots") ? readdirSync("snapshots") : []) {
  const m = /^scene-(.+\.webp)$/.exec(f);
  if (m) renameSync(`snapshots/${f}`, `assets/scenes/${m[1]}`);
}
const have = new Set(readdirSync("assets/scenes"));
const lines: string[] = [];
const entries: string[] = [];
let i = 0;
for (const name of Object.keys(presets)) {
  const file = `${sceneSlug(name)}.webp`;
  if (!have.has(file)) {
    console.warn(`no picture for “${name}”`);
    continue;
  }
  lines.push(`import t${i} from "../../assets/scenes/${file}";`);
  entries.push(`  ${JSON.stringify(name)}: t${i},`);
  i++;
}
await Bun.write(
  "src/ui/scene-thumbs.ts",
  `// The scene gallery's pictures (assets/scenes, made by scripts/scene-thumbs.ts); a scene without
// one shows its glyph.
${lines.join("\n")}

export const SCENE_THUMBS: Record<string, string> = {
${entries.join("\n")}
};
`,
);
console.log(`${i} / ${Object.keys(presets).length} scenes with a picture → src/ui/scene-thumbs.ts`);
