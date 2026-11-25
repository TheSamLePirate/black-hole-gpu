import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";
import { readPng, writePng } from "./lib/png";

// PROBLEMES-A-REGLER « Un trait clair et un « poteau » sombre à travers un F-35 posé sur le mont Faron » (24 Nov 2026): the F-35 set
// down on Mont Faron's southern flank (j2-contact-camera's place, 11 h UTC, the J0 scene), the camera « around » 25 m in front of it
// (yaw 180, pitch 8): a pale straight streak across the trees by the craft. Cause (8d4e0be1): the sea's surface kept a crest standing
// over the land behind it testing the ground's distance alone, not the nearest surface's: the sea's horizon 25–57 km off, lifted by
// the air (R4b), was kept over the trees 10 m from the camera — gone without the lift. Measures it: the same frozen view with the
// lift on (A) and off (D), the pixels the lift makes paler over a dark ground (5 816 and 3 257 before the fix, kerr-mini; 9 after,
// this Mac); B, the material's trees off, for the eye; FARON_DIAG=1 the parts found innocent (the raster's projection lift, the near
// trees' 3D geometry, the craft).
// Steps: 1 boot · 2 the craft set down on the flank, the relief in · 3 the view in front · 4 the images, the streak counted.
// Duration: ~3 min on kerr-mini (the Earth data on disk).
// And the craft over the near trees: its pixels (A against C, the craft's passes off) where the visibility holds a surface nearer
// than it (20 943 of 21 006 before the flown craft was hidden from outside views, 74 after).
// Done when: the streak's pixels counted — those the lift makes paler over a dark ground — under 200; the craft over nearer under 500.

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
    console.log(
      `  the scene: ${JSON.stringify(await app.js(`(() => { const s = __bh.renderer.earthScenery.stats(); return { pylons: s.pylons, cables: s.cables, turbines: s.turbines, trees: s.trees, buildings: s.buildings }; })()`))}`,
    );
    const set = (js: string) => app.js(`(async () => { const R = __bh.renderer; ${js} ${frames(90)} return 1; })()`);
    await set(`R.liteSkip = ${base}; R.liftOn = true;`);
    await app.shot(`${OUT}/a-as-is.png`);
    await set(`R.liftOn = false;`);
    await app.shot(`${OUT}/d-no-lift.png`);
    await set(`R.liftOn = true; R.liteSkip = ${base} | 64;`);
    await app.shot(`${OUT}/b-no-material-trees.png`);
    await set(`R.liteSkip = ${base};`);
    // (the craft over the near trees: its passes off — C —, its pixels the image's difference; there the visibility's nearest surface
    // (the raster's distance image, b) against the craft's own distance — its centre's from the eye less 9 m, its half-length and a
    // margin: a surface nearer than that the craft must not be drawn over)
    await set("R.debugSkipShip = true;");
    await app.shot(`${OUT}/c-no-craft.png`);
    await set("R.debugSkipShip = false;");
    // (the « around » view's distance to the craft's centre [m] — camera.outside.dist)
    const craftM = await app.js<number>(`__bh.camera.outside.dist`);
    // (diagnostic, FARON_DIAG=1: the parts the lift reaches, each alone — the scenery raster's projection lift zeroed (its trees and
    // buildings drawn unlifted, the tracer's kept), the near trees' 3D geometry off, the craft's passes off)
    const diag: [string, string, string][] =
      process.env.FARON_DIAG === "1"
        ? [
            ["e-raster-lift-zero", "R.sceneryRaster.lift.fill(0);", "R.liftNow = ''; R.liftAsked = null;"],
            ["f-no-near-geometry", "R.nearTreeGeometryOn = false;", "R.nearTreeGeometryOn = true;"],
            ["g-no-craft", "R.debugSkipShip = true;", "R.debugSkipShip = false;"],
          ]
        : [];
    for (const [name, off, on] of diag) {
      await set(off);
      await app.shot(`${OUT}/${name}.png`);
      await set(on);
    }
    const read = async (f: string) => readPng(new Uint8Array(await Bun.file(`${OUT}/${f}.png`).arrayBuffer()));
    const A = await read("a-as-is"),
      D = await read("d-no-lift");
    // (the pixels the lift changes, the page's bars left out — the far land's own lift, by design, among them —, and the streak's: those
    // the lift makes paler by more than 48 over a dark ground — the sea's horizon drawn over the trees)
    const mask = new Uint8Array(A.width * A.height * 3);
    let moved = 0,
      streak = 0;
    const movedAt: [number, number][] = [];
    const lum = (P: typeof A, i: number) =>
      0.2126 * P.data[i * P.channels]! + 0.7152 * P.data[i * P.channels + 1]! + 0.0722 * P.data[i * P.channels + 2]!;
    for (let i = 0; i < A.width * A.height; i++) {
      if (Math.floor(i / A.width) < 90) continue;
      let m = 0;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.data[i * A.channels + c]! - D.data[i * D.channels + c]!));
      if (m > 48) {
        moved++;
        mask[3 * i] = 255;
        movedAt.push([i % A.width, Math.floor(i / A.width)]);
      }
      if (lum(A, i) - lum(D, i) > 48 && lum(D, i) < 70) {
        streak++;
        mask[3 * i + 1] = 255;
      }
    }
    await Bun.write(`${OUT}/streak-mask.png`, writePng(A.width, A.height, mask));
    // (each diagnostic image against A on the streak's pixels — the lift's: how many it changes there)
    for (const [name] of diag) {
      const E = await read(name);
      let n = 0;
      for (const [x, y] of movedAt) {
        const i = y * A.width + x;
        let m = 0;
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.data[i * A.channels + c]! - E.data[i * E.channels + c]!));
        if (m > 48) n++;
      }
      console.log(`  ${name}: the streak's pixels it changes ${n} of ${movedAt.length}`);
    }
    console.log(`  pixels the lift moves: ${moved} (before the fix, 25 Nov 2026: 9 982 — the pale streak) → ${OUT}/streak-mask.png`);
    // (the points asked — FARON_POINTS "x,y;…": the raster's texel there — r the hint, g the tree, b its distance, a its code)
    // (and a dozen of the pixels the lift moves, spread over them)
    const picks = [
      ...(process.env.FARON_POINTS ?? "")
        .split(";")
        .filter(Boolean)
        .map((v) => v.split(",").map(Number) as [number, number]),
      ...movedAt.filter((_, k) => k % Math.max(1, Math.floor(movedAt.length / 12)) === 0).slice(0, 12),
      // (and the streak's brightest: the pale line itself)
      ...[...movedAt]
        .sort((p, q) => {
          const l = (v: [number, number]) => {
            const i = (v[1] * A.width + v[0]) * A.channels;
            return A.data[i]! + A.data[i + 1]! + A.data[i + 2]!;
          };
          return l(q) - l(p);
        })
        .slice(0, 6),
    ];
    if (picks.length) {
      const texels = await app.js(`(async () => {
        const R = __bh.renderer, d = R.device, tex = R.terrainRaster.distanceTexture(); const out = [];
        for (const [x, y] of ${JSON.stringify(picks)}) {
          const tx = Math.min(tex.width - 1, Math.floor(x / ${A.width} * tex.width)), ty = Math.min(tex.height - 1, Math.floor(y / ${A.height} * tex.height));
          const b = d.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex, origin: [tx, ty] }, { buffer: b, bytesPerRow: 256 }, [1, 1]);
          d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const v = [...new Float32Array(b.getMappedRange().slice(0, 16))]; b.destroy();
          const s = await R.surfaceAt(x / ${A.width}, y / ${A.height});
          out.push({ x, y, hint: v[0], id: v[1], dist: v[2], code: Math.floor(v[3] / 262144), bits: v[3] % 262144, kind: s?.kind, object: s?.object, craft: s?.craft, nearest: s?.nearest });
        }
        return out; })()`);
      console.log(`  texels: ${JSON.stringify(texels)}`);
    }
    // (the craft's pixels — A against C —, and among them those the visibility holds a surface nearer than the craft at)
    const C = await read("c-no-craft");
    const craftPx: number[] = [];
    for (let i = 0; i < A.width * A.height; i++) {
      if (Math.floor(i / A.width) < 90) continue;
      let m = 0;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.data[i * A.channels + c]! - C.data[i * C.channels + c]!));
      if (m > 40) craftPx.push(i);
    }
    const over = await app.js<{ over: number; samples: number[][] }>(`(async () => {
      const R = __bh.renderer, d = R.device, tex = R.terrainRaster.distanceTexture();
      const W = tex.width, H = tex.height, row = Math.ceil(W * 16 / 256) * 256;
      const b = d.createBuffer({ size: row * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: b, bytesPerRow: row }, [W, H]);
      d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const V = new Float32Array(b.getMappedRange());
      const px = ${JSON.stringify(craftPx)}; let over = 0; const samples = [];
      for (const i of px) {
        const x = i % ${A.width}, y = Math.floor(i / ${A.width});
        const tx = Math.min(W - 1, Math.floor(x / ${A.width} * W)), ty = Math.min(H - 1, Math.floor(y / ${A.height} * H));
        const k = ty * row / 4 + tx * 4, near = V[k + 2];
        if (near > 0.1 && near < ${craftM.toFixed(2)} - 9) { over++; if (samples.length < 8) samples.push([x, y, +near.toFixed(2), V[k + 1], Math.floor(V[k + 3] / 262144)]); }
      }
      b.unmap(); b.destroy(); return { over, samples }; })()`);
    console.log(
      `  the craft ${craftM.toFixed(1)} m off, its pixels ${craftPx.length}; drawn over a nearer surface ${over.over} — ${JSON.stringify(over.samples)}`,
    );
    console.log(`  the streak: pixels the lift makes paler over a dark ground ${streak} (5 816 and 3 257 before 8d4e0be1, kerr-mini)`);
    // (20 943 of 21 006 before 25 Nov 2026 — the flown craft never hidden from an outside view —, 74 after: its shadow's edge on the
    // ground before it, the canopy's glass)
    await app.stepDone(`trait : ${streak} pixels · appareil sur plus proche : ${over.over}`, streak < 200 && over.over < 500);
    expect(streak).toBeLessThan(200);
    expect(over.over).toBeLessThan(500);
  }, 500_000);
});
