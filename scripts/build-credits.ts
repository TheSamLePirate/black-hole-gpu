// CREDITS.md from the game's credits (src/ui/title/credits.ts — the one source, PLAN-TITRE-AAA E7): who made the
// game and every work it is built on. tests/title-credits.test.ts fails when the file is not up to date.
//   bun scripts/build-credits.ts
import { creditsMarkdown } from "../src/ui/title/credits";

await Bun.write("CREDITS.md", `${creditsMarkdown("en")}`);
console.log("CREDITS.md written");
