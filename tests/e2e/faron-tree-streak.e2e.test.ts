import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";
import { readPng, writePng } from "./lib/png";

// PROBLEMES-A-REGLER « Un trait clair et un « poteau » sombre à travers un F-35 posé sur le mont Faron » (24 Nov 2026): the F-35 set
// down on Mont Faron's southern flank (j2-contact-camera's place, 11 h UTC, the J0 scene), the camera « around » 25 m in front of it
// (yaw 180, pitch 8): a pale straight streak across the trees by the craft, drawn by the raster material's trees (shadeLite,
// sceneryTreeLite — gone with liteSkip 64). Cause (25 Nov 2026): the material tested each tree the raster drew lifted by the air's lift
// (R4b) at the GROUND's distance behind it — kilometres along the rays just under the horizontal on a rise, ~0.3 m —, not at its own:
// a band of misses, the far ground's haze through the crowns. Proves the near trees no longer move with the lift: the same frozen
// view with the lift on (A) and off (D), the pixels it changes counted (9 982 before the fix); B, the material's trees off, for the eye.
// Steps: 1 boot · 2 the craft set down on the flank, the relief in · 3 the view in front · 4 the images, the streak counted.
// Duration: ~3 min on kerr-mini (the Earth data on disk).
// Done when: the pixels the lift moves counted (under 1 500).

const OUT = process.env.FARON_OUT ?? "remote-results/faron-tree-streak";
const W = 1920,
  H = 1080;
const GROUND = [43.1405, 5.942] as const;

describe.skipIf(!E2E)("Mont Faron: no tree streak through a craft at rest", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    app.steps([
      "the craft set down on Mont Faron",
      "the view in front, 25 m",
      "the images: as is, the lift off, the trees off — the streak counted",
    ]);
    await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
  }, 300_000);
  afterAll(async () => {
    await app?.close();
    stopServer();
  });

  test("the craft's pixels: the material's trees draw nothing over them", async () => {
    await app.step("the craft set down on Mont Faron");
    const [lat, lon] = GROUND;
    const land = `(async () => { __bh.freeze(false); __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair");
      __bh.game.set("earthClouds", 0); const note = __bh.game.land("earth", ${lat}, ${lon});
      __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
      for (let i = 0; i < 60; i++) await new Promise((q) => requestAnimationFrame(q)); return note; })()`;
    console.log(`  land: ${await app.js(land)}`);
    await app.settled(180_000);
    const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
      const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) { const ok = t.pending === 0 && t.finest >= 14; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; await frame(); }
      return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
    console.log(`  relief: ${JSON.stringify(relief)}`);
    console.log(`  land again: ${await app.js(land)}`);
    await app.dataSettled("Mont Faron", { maxMs: 60_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
    await app.settled(60_000);
    await app.stepDone(`posé · relief z${relief.finest}`, relief.ok);

    await app.step("the view in front, 25 m");
    const frames = (n: number) => `for (let i = 0; i < ${n}; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }`;
    await app.js(`(async () => { __bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset();
      Object.assign(__bh.camera.outside, { yaw: 180, pitch: 8, dist: 25 }); ${frames(60)} __bh.freeze(true); ${frames(30)} return 1; })()`);
    await app.settled(60_000);
    await app.stepDone("vue « autour », lacet 180°, tangage 8°, 25 m");

    await app.step("the images: as is, the lift off, the trees off — the streak counted");
    const base = await app.js<number>(`__bh.renderer.liteSkip`);
    const lift = await app.js<number[]>(`[...(__bh.renderer.sceneryLiftNow ?? [])]`);
    console.log(`  the scenery's lift (R4b: (x + y d) d², fade, on): ${JSON.stringify(lift)}`);
    const set = (js: string) => app.js(`(async () => { const R = __bh.renderer; ${js} ${frames(90)} return 1; })()`);
    await set(`R.liteSkip = ${base}; R.liftOn = true;`);
    await app.shot(`${OUT}/a-as-is.png`);
    await set(`R.liftOn = false;`);
    await app.shot(`${OUT}/d-no-lift.png`);
    await set(`R.liftOn = true; R.liteSkip = ${base} | 64;`);
    await app.shot(`${OUT}/b-no-material-trees.png`);
    await set(`R.liteSkip = ${base};`);
    const read = async (f: string) => readPng(new Uint8Array(await Bun.file(`${OUT}/${f}.png`).arrayBuffer()));
    const A = await read("a-as-is"),
      D = await read("d-no-lift");
    // (the pixels the lift changes, the page's bar left out: the near trees must not move with it — they are tested lifted at their
    // own distance, as the raster draws them; the far scenery's sub-pixel lift, a few)
    const mask = new Uint8Array(A.width * A.height * 3);
    let moved = 0;
    for (let i = 0; i < A.width * A.height; i++) {
      if (Math.floor(i / A.width) < 60) continue;
      let m = 0;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.data[i * A.channels + c]! - D.data[i * D.channels + c]!));
      if (m > 48) {
        moved++;
        mask[3 * i] = 255;
      }
    }
    await Bun.write(`${OUT}/streak-mask.png`, writePng(A.width, A.height, mask));
    console.log(`  pixels the lift moves: ${moved} (before the fix, 25 Nov 2026: 9 982 — the pale streak) → ${OUT}/streak-mask.png`);
    // (the points asked — FARON_POINTS "x,y;…": the raster's texel there — r the hint, g the tree, b its distance, a its code)
    const picks = (process.env.FARON_POINTS ?? "")
      .split(";")
      .filter(Boolean)
      .map((v) => v.split(",").map(Number) as [number, number]);
    if (picks.length) {
      const texels = await app.js(`(async () => {
        const R = __bh.renderer, d = R.device, tex = R.terrainRaster.distanceTexture(); const out = [];
        for (const [x, y] of ${JSON.stringify(picks)}) {
          const tx = Math.min(tex.width - 1, Math.floor(x / ${A.width} * tex.width)), ty = Math.min(tex.height - 1, Math.floor(y / ${A.height} * tex.height));
          const b = d.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex, origin: [tx, ty] }, { buffer: b, bytesPerRow: 256 }, [1, 1]);
          d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const v = [...new Float32Array(b.getMappedRange().slice(0, 16))]; b.destroy();
          const s = await R.surfaceAt(x / ${A.width}, y / ${A.height});
          out.push({ x, y, hint: v[0], id: v[1], dist: v[2], code: Math.floor(v[3] / 262144), kind: s?.kind, object: s?.object, craft: s?.craft, nearest: s?.nearest });
        }
        return out; })()`);
      console.log(`  texels: ${JSON.stringify(texels)}`);
    }
    await app.stepDone(`pixels déplacés par le relèvement : ${moved}`, moved < 1500);
    expect(moved).toBeLessThan(1500);
  }, 500_000);
});
