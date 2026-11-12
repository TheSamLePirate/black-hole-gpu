import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The surface's identity read at the image's points (PLAN-J1 J1-2: renderer.surfaceAt, system/surface-id.ts): over the Maures'
// forest north of Hyères, 150 m over the canopy looking along the hills — a 7 × 7 grid read back from the visibility target: the
// sky's row none, the trees' cells (their object, the scenery's generation), the ground between; a tree read twice the same id.
// Duration: ~1 min. Done when: the grid read, its kinds counted.
afterAll(stopServer);
test.skipIf(!E2E)(
  "the visibility's surfaces have an identity: none, ground, trees",
  async () => {
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, autosave: false, weather: "fair", earthClouds: 0 });
        __bh.game.setDate("2026-07-10T09:30:00Z"); return 1; })()`);
      const why = await app.js(`(() => __bh.viewAt(43.19, 6.25, { altM: 450, heading: 60, pitch: -8, fov: 55 }) ?? null)()`);
      if (why) throw new Error(`viewAt: ${why}`);
      await app.dataSettled("forest", { maxMs: 60_000 }).catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
      await app.waitFor(
        `(() => { const s = __bh.renderer.earthScenery.stats(); return s.status === "ready" && !s.quick && s.trees > 0; })()`,
        60_000,
      );
      await app.settled(180_000);
      const grid = await app.js<{ kind: string; object: number; id: number; generation: number; level: number }[]>(`(async () => {
        const out = [];
        for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) out.push(await __bh.renderer.surfaceAt((i + 0.5) / 7, (j + 0.5) / 7));
        return out; })()`);
      expect(grid.every((g) => g !== null)).toBe(true);
      const kinds: Record<string, number> = {};
      for (const g of grid) kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
      console.log(
        `  the 7 × 7 grid: ${JSON.stringify(kinds)}; rows: ${[0, 3, 6]
          .map((j) =>
            grid
              .slice(j * 7, j * 7 + 7)
              .map((g) => g.kind[0])
              .join(""),
          )
          .join(" / ")}`,
      );
      // (the top row: the sky; the lower half: the forest — trees and the ground between)
      expect(grid.slice(0, 7).every((g) => g.kind === "none")).toBe(true);
      expect(kinds.tree ?? 0).toBeGreaterThan(3);
      const tree = grid.find((g) => g.kind === "tree")!;
      expect(tree.object).toBeGreaterThan(0);
      expect(tree.id >>> 20).toBe(tree.generation & 4095);
      expect(tree.generation).toBe(await app.js<number>("__bh.renderer.earthScenery.revision"));
      // (read again, the view still: the same tree, the same word)
      const k = grid.indexOf(tree);
      const again = await app.js<{ id: number }>(`__bh.renderer.surfaceAt(${((k % 7) + 0.5) / 7}, ${(Math.floor(k / 7) + 0.5) / 7})`);
      expect(again.id).toBe(tree.id);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  360_000,
);
