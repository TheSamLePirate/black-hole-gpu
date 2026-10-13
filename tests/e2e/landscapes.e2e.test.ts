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
    !r.earthSurface.pending && s.status === 'ready' && !s.pending && grassIn && r.gpuErrors === 0;
  return { ready, frames: r.completedFrames, tier: r.earthMaps.tier, tiles: { pending: r.earthTiles.pending, failed: r.earthTiles.failed, stamp: r.earthTiles.stamp, imagery: r.earthTiles.imagery },
    scenery: s, grass: { reason: g.reason, pending: g.pending, roots: g.roots }, ground: r.groundStamp,
    signature: [r.featureKey, r.earthMaps.tier, r.earthTiles.stamp, r.earthTiles.imagery, r.earthScenery.stamp, r.groundStamp, g.reason].join(':') };
})()`;

test.skipIf(!E2E)(
  "the landscapes beside their photographs",
  async () => {
    const rows: string[] = [];
    for (const l of chosen) {
      const slug = sceneSlug(l.scene);
      const [width, height] = l.photo.portrait ? [960, 1440] : [1440, 960];
      const app = await App.boot({ hash: `scene=${encodeURIComponent(l.scene)}`, width, height, tiles: true });
      try {
        // (the scene's own clock stopped at the photo's moment: the light held while the tiles stream)
        await app.js(
          `(()=>{Object.assign(__bh.settings,{earthScenery:'high',dynamicResolution:false,pixelRatio:1});__bh.freeze(true);__bh.step(0);__bh.touch();return true;})()`,
        );
        await app.waitFor(`(${readiness}).ready`, 300_000);
        await app.js(`globalThis.__landscape = ${readiness}`);
        // two settled windows: anything arriving restarts the convergence
        await app.waitFor(
          `(() => { __bh.touch(); const now = ${readiness}, before = globalThis.__landscape;
            if (!now.ready || now.signature !== before.signature) { globalThis.__landscape = now; return false; }
            return now.frames >= before.frames + 150; })()`,
          180_000,
        );
        const status = await app.js<{ ready: boolean }>(readiness);
        expect(status.ready).toBe(true);
        // (the still view refined to its end: every sample in — a capture mid-way is noisy and blocky)
        await app.waitFor(`__bh.renderer.lastPhase === "converged"`, 240_000);
        await Bun.write(`${OUT}/${slug}.json`, JSON.stringify({ landscape: l, readiness: status }, null, 2));
        // (the picture alone, as the photograph is: the interface hidden — the data's credits go with the gallery's
        // captions —, a few frames for the page to draw without it)
        await app.js(
          `(()=>{document.body.classList.add("hide-ui");document.querySelectorAll("canvas.fl-hud").forEach((c)=>(c.style.visibility="hidden"));__bh.touch();return true;})()`,
        );
        await app.js("new Promise((r) => setTimeout(r, 600))");
        await app.shot(`${OUT}/${slug}.png`);
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
  },
  Math.max(1, chosen.length) * 600_000,
);
