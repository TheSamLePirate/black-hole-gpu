import { afterAll, expect, test } from "bun:test";
import { sceneSlug } from "../../scripts/scene-slug";
import { LANDSCAPES, landscapeFov, photoUtc, viewHeading } from "../../src/system/landscapes";
import { App, E2E, stopServer } from "./lib/app";
// The exceptional landscapes against their photographs: each scene on the real ground (tiles on), its
// terrain, scenery and lighting settled, captured at 3 : 2 (the photo's frame, so the vertical field of
// view matches), then remote-results/landscapes/index.html sets each capture beside its photograph
// (loaded from Commons by the browser that opens the report). LANDSCAPES="Matterhorn|Fuji" narrows it.
afterAll(stopServer);

const OUT = "remote-results/landscapes";
const only = (process.env.LANDSCAPES ?? "").split("|").filter(Boolean);
const chosen = LANDSCAPES.filter((l) => !only.length || only.some((o) => l.scene.toLowerCase().includes(o.toLowerCase())));

// (a completed frame is not a loaded scene: the relief and its imagery, the regional surface, the scenery and the
// forests, the grass round the camera, the light — all in, none failed, the tripod set on the finest ground, the
// kernel with every feature the scene uses compiled in; then the still view refined to its end)
const readiness = `(() => {
  const r = __bh.renderer, s = r.earthScenery.stats(), g = r.characterRenderer.stats();
  const grassIn = !g.pending && g.reason !== 'loading';
  const ready = r.variantReady && !!r.variants.get(r.featureKey)?.env && r.calibrationReady && !r.hdLoading &&
    r.earthMaps.tier === 'high' && r.earthTiles.pending === 0 && r.earthTiles.failed === 0 &&
    !r.earthSurface.pending && (s.status === 'ready' || s.status === 'degraded') && !s.pending && grassIn && r.gpuErrors === 0;
  return { ready, frames: r.completedFrames, tier: r.earthMaps.tier, tiles: { pending: r.earthTiles.pending, failed: r.earthTiles.failed, stamp: r.earthTiles.stamp, imagery: r.earthTiles.imagery },
    scenery: s, grass: { reason: g.reason, pending: g.pending, roots: g.roots }, ground: r.groundStamp,
    signature: [r.featureKey, r.earthMaps.tier, r.earthTiles.stamp, r.earthTiles.imagery, r.earthScenery.stamp, r.groundStamp, g.reason].join(':') };
})()`;

test.skipIf(!E2E)(
  "the landscapes beside their photographs",
  async () => {
    const rows: string[] = [];
    const notReady: string[] = [];
    for (const l of chosen) {
      const slug = sceneSlug(l.scene);
      const [width, height] = l.photo.portrait ? [960, 1440] : [1440, 960];
      const app = await App.boot({ hash: `scene=${encodeURIComponent(l.scene)}`, width, height, tiles: true });
      try {
        // (the scene's own clock stopped at the photo's moment: the light held while the tiles stream)
        await app.js(
          `(()=>{Object.assign(__bh.settings,{earthScenery:'high',dynamicResolution:false,pixelRatio:1});__bh.freeze(true);__bh.step(0);__bh.touch();return true;})()`,
        );
        // (two minutes at most — everything in within ~20–60 s on the lab's Macs —, what is missing said)
        // (a scenery source failed — "degraded" — counts as in when nothing is pending, its error said; a landscape never ready
        // is shot and listed, the others still taken — the run failed at the end)
        const inTime = await app.waitFor(`(${readiness}).ready`, 120_000).then(
          () => true,
          () => false,
        );
        if (!inTime) {
          const st = await app.js<{ tiles: unknown; scenery: { status: string; pending: boolean } }>(readiness);
          console.log(
            `  ${l.scene}: not ready after 120 s — tiles ${JSON.stringify(st.tiles)}, scenery ${st.scenery.status}${st.scenery.pending ? " (pending)" : ""}`,
          );
          await app.shot(`${OUT}/${slug}-NOT-READY.png`);
          notReady.push(l.scene);
          continue;
        }
        const err = await app.js<string | null>(`__bh.renderer.earthScenery.lastError ?? null`);
        if (err) console.log(`  ${l.scene}: scenery degraded — ${err.slice(0, 160)}`);
        await app.js(`globalThis.__landscape = ${readiness}`);
        // two settled windows: anything arriving restarts the convergence
        await app.waitFor(
          `(() => { __bh.touch(); const now = ${readiness}, before = globalThis.__landscape;
            if (!now.ready || now.signature !== before.signature) { globalThis.__landscape = now; return false; }
            return now.frames >= before.frames + 150; })()`,
          90_000,
        );
        const status = await app.js<{ ready: boolean }>(readiness);
        await Bun.write(`${OUT}/${slug}.json`, JSON.stringify({ landscape: l, readiness: status }, null, 2));
        // (the picture alone, as the photograph is: the interface hidden — the data's credits go with the gallery's
        // captions —, a few frames for the page to draw without it)
        await app.js(
          `(()=>{document.body.classList.add("hide-ui");document.querySelectorAll("canvas.fl-hud").forEach((c)=>(c.style.visibility="hidden"));__bh.touch();return true;})()`,
        );
        await app.js("new Promise((r) => setTimeout(r, 600))");
        // (shot before judged: the game's own still image — the raster held, renderer.rasterHold since 25 Oct —, then the view
        // refined to its end in the traced pipeline — as these captures were before —: every sample in, 2 minutes at most)
        await app.shot(`${OUT}/${slug}.png`);
        expect(status.ready).toBe(true);
        // (the traced pipeline: main.ts holds renderer.rasterHold each frame — its raster kept but in the photo mode)
        await app.js(`(() => { __bh.settings.earthPipeline = "trace"; __bh.touch(); return 1; })()`);
        const refined = await app.waitFor(`__bh.renderer.lastPhase === "converged"`, 120_000).then(
          () => true,
          () => false,
        );
        if (!refined) console.log(`  ${l.scene}: not converged after 120 s (${await app.js("__bh.renderer.lastPhase")}) — shot as it is`);
        await app.shot(`${OUT}/${slug}-traced.png`);
        expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
        expect(app.cdp.errors).toEqual([]);
      } finally {
        app.close();
      }
      const file = decodeURIComponent(l.photo.page.split("/wiki/")[1]!);
      const photo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/, ""))}?width=1440`;
      rows.push(`<section><h2>${l.title}</h2>
<p>${l.description}</p>
<p class="m">${l.at.join(", ")} · heading ${viewHeading(l).toFixed(1)}° · pitch ${l.pitch}° · ${l.photo.focal35} mm (fov ${landscapeFov(l).toFixed(1)}° vertical) · heading from ${l.headingFrom}${l.photo.estimated ? ` · estimated: ${l.photo.estimated}` : ""} · ${new Date(photoUtc(l.photo)).toISOString()} UTC</p>
<div class="pair"><figure><img src="${photo}" alt="photograph"><figcaption><a href="${l.photo.page}">${file}</a> — ${l.photo.author}, ${l.photo.licence}</figcaption></figure>
<figure><img src="${slug}.png" alt="capture"><figcaption>${l.scene}</figcaption></figure></div></section>`);
    }
    await Bun.write(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><title>Landscapes vs photographs</title>
<style>body{font:14px system-ui;background:#111;color:#ddd;margin:16px}h2{margin:24px 0 4px}.m{color:#999}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0}img{width:100%;max-height:80vh;object-fit:contain;background:#222}a{color:#9cf}</style>
<h1>Landscapes vs photographs</h1>${rows.join("\n")}`,
    );
    expect(notReady).toEqual([]);
  },
  Math.max(1, chosen.length) * 600_000,
);
