// (a probe — no assertion, a measure to read —, not in `bun run e2e`: E2E_PROBE=1 to run it)
// A boot's health at a scene (a diagnostic): the GPU's and the page's errors, the kernels, the tiles, the camera — every 15 s for a
// minute. DIAG_SCENE (default Monument Valley's Mittens).
import { afterAll, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "a scene's boot health",
  async () => {
    const scene = process.env.DIAG_SCENE ?? "Earth: Monument Valley's Mittens";
    const app = await App.boot({ hash: `scene=${encodeURIComponent(scene)}`, width: 1200, height: 800, tiles: true });
    try {
      for (let i = 0; i < 4; i++) {
        await app.js("new Promise((r) => { __bh.touch(); setTimeout(r, 15000); })");
        console.log(
          JSON.stringify(
            await app.js(`(() => { const r = __bh.renderer, g = __bh.camera.geoNow();
          return { gpuErrors: r.gpuErrors, variantReady: r.variantReady, frames: r.completedFrames, phase: r.lastPhase,
            tiles: { pending: r.earthTiles.pending, failed: r.earthTiles.failed, stamp: r.earthTiles.stamp },
            alt: g && Math.round(g.alt), compile: r.compileErrors ?? r.lastCompileError ?? null }; })()`),
          ),
        );
      }
      console.log("page errors:", JSON.stringify(app.cdp.errors).slice(0, 2000));
    } finally {
      app.close();
    }
  },
  300_000,
);
