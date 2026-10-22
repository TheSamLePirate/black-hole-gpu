// Monument Valley's Mittens (system/landscapes.ts): the buttes' relief — 150 to 300 m of near-vertical cliffs over the
// plain — as the game draws it in realtime (the raster pipeline's defaults; the traced one) and converged. Not a pass/fail
// test: remote-results/monument-<mode>.png. MV_SCENE (default the Mittens' landscape scene).
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);
const SCENE = process.env.MV_SCENE ?? "Earth: Monument Valley's Mittens";

test.skipIf(!E2E)(
  "Monument Valley's buttes, realtime and converged",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent(SCENE)}`, width: 1440, height: 960, tiles: true });
    try {
      await app.js(
        `(()=>{Object.assign(__bh.settings,{dynamicResolution:false,pixelRatio:1});__bh.freeze(true);__bh.step(0);__bh.touch();return true;})()`,
      );
      // (everything in — the relief, its imagery, the surface, the scenery, the grass —, the tripod set on the finest ground:
      // landscapes.e2e.test.ts's readiness, then a settled window — anything arriving restarts it)
      const readiness = `(() => { const r = __bh.renderer, s = r.earthScenery.stats(), g = r.characterRenderer.stats();
        const ready = r.variantReady && r.calibrationReady && !r.hdLoading && r.earthMaps.tier === 'high' && r.earthTiles.pending === 0 &&
          !r.earthSurface.pending && s.status === 'ready' && !s.pending && !g.pending && g.reason !== 'loading';
        return { ready }; })()`;
      await app.waitFor(`(${readiness}).ready`, 240_000).catch(() => console.log("  (not all in: going on)"));
      // (the camera — the renderer's, the tripod's: geoNow is the craft's, hidden here — standing over the ground drawn, not
      // under it: set on the sea-level sphere until the relief is known)
      const above = `(() => { __bh.touch(); const n = __bh.renderer.lastNear, T = __bh.renderer.earthTiles; if (!n) return false;
        const b = n.axes.map((x) => -(n.centre[0] * x[0] + n.centre[1] * x[1] + n.centre[2] * x[2]));
        const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), X = b[0] * A, Y = b[1] * A, Z = b[2] * A, P = Math.hypot(X, Y);
        let la = Math.atan2(Z, P * (1 - E2)), h = 0;
        for (let i = 0; i < 6; i++) { const N = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2); h = P / Math.cos(la) - N; la = Math.atan2(Z, P * (1 - E2 * N / (N + h))); }
        const lo = Math.atan2(Y, X), g = T.heightAt([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], 2);
        return g.rem < 0.5 && h > g.h - 2 && h < g.h + 200; })()`;
      await app.waitFor(above, 600_000);
      // (then a while for the tripod to settle on the finest ground)
      for (let i = 0; i < 15; i++) await app.js("new Promise((r) => { __bh.touch(); setTimeout(r, 1000); })");
      // (the ground truth: the relief's profile seen from the camera — the tiles' heights on the CPU, as the tracer weighs them —
      // each azimuth's highest elevation angle out to 4 km and where it stands: a near hill hiding a butte's foot, or not)
      const profile = await app.js<string[]>(`(() => { const n = __bh.renderer.lastNear, T = __bh.renderer.earthTiles, out = [];
        const b = n.axes.map((x) => -(n.centre[0] * x[0] + n.centre[1] * x[1] + n.centre[2] * x[2]));
        const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), X = b[0] * A, Y = b[1] * A, Z = b[2] * A, P = Math.hypot(X, Y);
        let lat0 = Math.atan2(Z, P * (1 - E2)), hh = 0;
        for (let i = 0; i < 6; i++) { const N = A / Math.sqrt(1 - E2 * Math.sin(lat0) ** 2); hh = P / Math.cos(lat0) - N; lat0 = Math.atan2(Z, P * (1 - E2 * N / (N + hh))); }
        const g = { lat: lat0 * 180 / Math.PI, lon: Math.atan2(Y, X) * 180 / Math.PI, alt: hh };
        const R = 6371000, la = g.lat * Math.PI / 180, lo = g.lon * Math.PI / 180;
        for (let az = 20; az <= 120; az += 4) { let best = -90, at = 0, a = az * Math.PI / 180;
          for (let d = 30; d <= 4000; d += 15) {
            const dl = d / R * Math.cos(a), dn = d / R * Math.sin(a) / Math.cos(la);
            const lat = la + dl, lon = lo + dn, q = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
            const h = T.heightAt(q, 2).h; const e = Math.atan2(h - g.alt, d) * 180 / Math.PI - d / (2 * R) * 180 / Math.PI;
            if (e > best) { best = e; at = d; } }
          out.push(az + '°: ' + best.toFixed(2) + '° at ' + at + ' m'); }
        return [JSON.stringify({ cam: g, here: T.heightAt([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], 2) })].concat(out); })()`);
      console.log(`  ${profile.join("\n  ")}`);
      const geo = () => app.js(`(() => { const g = __bh.camera.geoNow(); return g && [g.lat, g.lon, g.alt]; })()`);
      const info = await app.js(
        `(() => { const g = __bh.camera.geoNow(); return { geo: g && { lat: g.lat, lon: g.lon, alt: g.alt, agl: g.agl }, tiles: __bh.renderer.earthTiles.stats?.() }; })()`,
      );
      console.log(`  ${JSON.stringify(info)}`);
      const modes: Record<string, string> = {
        n256: `__bh.settings.earthPipeline = "raster"; __bh.renderer.tune = { TUNE_TILE_CR: 2 };`,
        n512: `__bh.settings.earthPipeline = "raster"; __bh.renderer.tune = { TUNE_TILE_CR: 2, TUNE_MARCH_N: 512 };`,
        n1024: `__bh.settings.earthPipeline = "raster"; __bh.renderer.tune = { TUNE_TILE_CR: 2, TUNE_MARCH_N: 1024 };`,
      };
      for (const [name, set] of Object.entries(modes)) {
        await app.js(`(async () => { ${set} __bh.settings.targetSpp = 0; window.__t = true;
          const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        await app.js(`new Promise((r) => setTimeout(r, 4000))`);
        await app.shot(`remote-results/monument-${name}.png`);
        console.log(
          `  ${name}: cache ${JSON.stringify(await app.js("__bh.renderer.terrainCacheStats"))} tiles ${JSON.stringify(await app.js("({ stamp: __bh.renderer.earthTiles.stamp, pending: __bh.renderer.earthTiles.pending })"))}`,
        );
        console.log(`  ${name}: at ${JSON.stringify(await geo())}`);
        await app.js(`(() => { window.__t = false; return 1; })()`);
      }
      await app.js(`(() => { __bh.settings.earthPipeline = "trace"; __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`);
      await app.waitFor(`__bh.renderer.lastPhase === "converged"`, 240_000).catch(() => {});
      await app.shot("remote-results/monument-converged.png");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  900_000,
);
