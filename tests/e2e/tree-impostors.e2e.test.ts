import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Probe — not in `bun run e2e`: E2E_PROBE=1 — (V2a/V2b, vegetation/tree-model.ts and tree-impostors.ts): the twelve modelled trees
// (six kinds, wide and slender) baked into their hemi-octahedral impostors on the device, each layer's 8 × 8 views saved lit as a
// PNG (renderer.treeImpostorPreview); the bake's time.
// Duration: ~1 min. Done when: the twelve layers saved, no GPU error.
afterAll(stopServer);
const OUT = process.env.IMPOSTOR_OUT ?? "remote-results/tree-impostors";
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the trees' impostors",
  async () => {
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis" });
    try {
      for (let layer = 0; layer < 12; layer++) {
        const r = await app.js<{ png: string; bakeMs: number; models: { kind: number; aspect: number; leaves: number; tris: number }[] }>(
          `__bh.renderer.treeImpostorPreview(${layer})`,
        );
        if (layer === 0) console.log(JSON.stringify({ bakeMs: Math.round(r.bakeMs), models: r.models }));
        await Bun.write(`${OUT}/layer-${String(layer).padStart(2, "0")}.png`, Buffer.from(r.png.split(",")[1]!, "base64"));
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  300_000,
);
