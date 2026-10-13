import type { App } from "./app";

// A completed first frame is not a loaded scene. Keep an inspectable readiness record with each shot.
const readiness = `(() => {
  const r = __bh.renderer, c = __bh.camera.character;
  const surface = r.earthSurface.stats(), scenery = r.earthScenery.stats();
  const ground = c.groundPatch;
  const lightingReady = !!r.variants.get(r.featureKey)?.env;
  const baseReady = r.variantReady && lightingReady && r.calibrationReady &&
    !r.hdLoading && r.characterRenderer.ready && r.characterRenderer.model.ready &&
    !r.characterRenderer.model.error && !r.characterRenderer.stats().pending && r.gpuErrors === 0;
  const earthReady = r.earthMaps.tier === 'high' && !!r.earthMaps.heights &&
    r.earthTiles.pending === 0 && r.earthTiles.failed === 0 &&
    surface.status === 'ready' && surface.loaded === surface.pages && surface.pages > 0 &&
    surface.failed === 0 && !surface.pending &&
    scenery.status === 'ready' && scenery.coverPixels > 0 && scenery.rgbPixels > 0 && !scenery.pending &&
    ground.ready && ground.size === 65 && !ground.pending;
  return {
    ready: baseReady && (c.body !== 'earth' || earthReady),
    body: c.body, variantReady: r.variantReady, lightingReady, calibrationReady: r.calibrationReady,
    pipelines: r.pipelineStatus, earthMaps: r.earthMaps.tier,
    terrain: { pending: r.earthTiles.pending, loaded: r.earthTiles.loaded, failed: r.earthTiles.failed, stamp: r.earthTiles.stamp },
    surface, scenery, ground: { ready: ground.ready, size: ground.size, pending: !!ground.pending, stamp: ground.stamp },
    character: r.characterRenderer.stats(), frames: r.completedFrames, gpuErrors: r.gpuErrors,
    signature: [r.featureKey, r.earthMaps.tier, r.earthTiles.stamp, r.earthSurface.stamp, r.earthScenery.stamp, ground.stamp].join(':')
  };
})()`;

export async function captureLoadedCharacter(app: App, name: string) {
  const path = `remote-results/${name}`;
  try {
    // Two consecutive settled frame windows; any arriving resource restarts the warm-up.
    await app.waitFor(`(${readiness}).ready`, 240_000);
    await app.js(`globalThis.__characterCapture = ${readiness}`);
    await app.waitFor(
      `(() => {
      const now = ${readiness}, previous = globalThis.__characterCapture;
      if (!now.ready || now.signature !== previous.signature) {
        globalThis.__characterCapture = now; return false;
      }
      return now.frames >= previous.frames + 120;
    })()`,
      120_000,
    );
    const status = await app.js<{ ready: boolean }>(readiness);
    if (!status.ready) throw new Error("Scene readiness changed before capture");
    await Bun.write(`${path}-readiness.json`, JSON.stringify(status, null, 2));
    await app.shot(`${path}.png`);
  } catch (error) {
    await Bun.write(`${path}-not-ready.json`, JSON.stringify(await app.js(readiness), null, 2));
    throw error; // Never produce a success capture while loading or using a degraded source.
  }
}
