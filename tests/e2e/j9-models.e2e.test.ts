import { afterAll, expect, test } from "bun:test";
import { TREE_ASPECTS, TREE_MODEL_KINDS, treeModel } from "../../src/vegetation/tree-model";
import { App, E2E, stopServer } from "./lib/app";
import { treePreviewExpression } from "./lib/tree-model-preview";

// J9-1: inspect the actual source triangles and alpha-cut leaf cards, not their baked impostors.
// Each of six kinds at two proportions: side, underneath and above; broadleaf winter exposes its branch structure.
// Duration: ~1 min on kerr-mini.
// Done when: twelve three-view boards and the winter board saved, no GPU or console error.
afterAll(stopServer);
test.skipIf(!E2E)(
  "J9 source geometry: twelve models from side, underneath and above",
  async () => {
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis" });
    try {
      app.steps(["models", "checks"]);
      await app.step("models");
      let count = 0;
      for (const kind of TREE_MODEL_KINDS)
        for (const aspect of TREE_ASPECTS[kind]!) {
          await app.progress(`model ${++count}/12 · kind ${kind} · aspect ${aspect}`);
          const mesh = treeModel(kind, aspect);
          const png = await app.js<string>(treePreviewExpression(mesh, kind));
          await Bun.write(`remote-results/j9-models/kind-${kind}-${aspect}.png`, Buffer.from(png.split(",")[1]!, "base64"));
          if (kind === 1 && aspect === TREE_ASPECTS[kind]![0]) {
            const winter = await app.js<string>(treePreviewExpression(mesh, kind, false));
            await Bun.write("remote-results/j9-models/winter.png", Buffer.from(winter.split(",")[1]!, "base64"));
          }
        }
      await app.stepDone("12 models, 3 views each; winter branches");
      await app.step("checks");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.stepDone("no GPU or console error");
    } finally {
      app.close();
    }
  },
  300_000,
);
