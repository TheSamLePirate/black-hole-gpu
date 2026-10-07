import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The HUD's panels and the instruments its canvas draws never fall under one another — in every flight
// state of the HUD gallery (tests/hud/states/: ascent, CIRC, deorbit, entry, glide, final, rollout, the
// Moon's descent, the Lander's, the docking), at the lab's 1440 × 900. The boxes: hud/layout.ts (the
// panels measured, the canvas's boxes told as drawn — __bh.hud.boxes()). Before: the air data's band ran
// across the attitude ball and under the hub's card, the entry's box over the speed tape, the vertical
// landing's scope under the take-off's card.

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  id?: string;
}

const dir = `${import.meta.dir}/../hud/states`;
const states = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const over = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe.skipIf(!E2E)("the HUD: nothing overlaps", () => {
  let app: App;
  beforeAll(async () => {
    // (straight into a scene: the title screen would hide the HUD)
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });
  for (const f of states)
    test(f.replace(/\.json$/, ""), async () => {
      const json = await Bun.file(`${dir}/${f}`).text();
      await app.js(`(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)`);
      await Bun.sleep(2500);
      const boxes = await app.js<Box[]>("__bh.hud.boxes()");
      if (process.env.HUD_BOXES) console.log(f, JSON.stringify(boxes.map((b) => [b.id, ...[b.x, b.y, b.w, b.h].map(Math.round)])));
      // (the HUD up: its panels there to be measured — a hidden HUD overlaps nothing, and proves nothing)
      expect(boxes.length).toBeGreaterThan(5);
      const hits: string[] = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          if (over(boxes[i]!, boxes[j]!)) {
            const a = boxes[i]!,
              b = boxes[j]!;
            hits.push(`${a.id} [${[a.x, a.y, a.w, a.h].map(Math.round)}] × ${b.id} [${[b.x, b.y, b.w, b.h].map(Math.round)}]`);
          }
      expect(hits).toEqual([]);
    }, 60_000);
});
