import { afterAll, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The raster's Moon (TERRE-UNREAL U8: the sky's discs at one ray a pixel — trace.wgsl main's layers z ≥ 1 —, four a pixel
// for a small one): a full Moon over the Beauce at night, the F-35 level at 1 000 m on its autopilot, the cockpit view.
// 1. The view locked on it (C), the 60° lens: 12 frames in a row of the disc, 1:1, side by side — its limb steady, no
//    lattice round it (moon-frames.png) —, the frame rate and the GPU's time.
// 2. The telescope (Y), the wheel zoomed to its narrowest: the Moon over the whole image, held on it as the jet flies
//    (stabilised: controller/piloting.ts aimShipViews), its spot meter on — the Moon's colours, not a black point on its
//    maria —, a wide disc drawn a 2 × 2 block's pixel a frame: its centre 1:1 twice 3 s apart (moon-tele-<k>.png), the
//    target's offset from the view's centre over 6 s, the frame rate.
// Figures in $OUT/moon.json. Duration: ~6 min on kerr-mini, its shaders compiled (+ ~5 min cold).
// Done when: both views measured, their shots written.

const OUT = process.env.AB_OUT ?? "remote-results";
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthRasterShading: "every", earthRasterScale: 1, dynamicResolution: false, autoGear: false, f35AutoProtect: false, telescopeSpot: true }`;

afterAll(stopServer);

test.skipIf(!E2E)(
  "the raster's Moon: steady at 60°, sharp and held in the telescope",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    await app.js(`(() => { __bh.game.setDate("2026-07-29T23:00:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    await app.js(`(() => { __bh.game.flyAt(48.25, 1.55, 900, 170, 130); __bh.settings.shipMount = "cockpit";
      const c = __bh.camera; c.gearDown = true; c.gearExt = 1; c.gearInit = true; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      if (c.jetModes.spd !== null) c.jetModes.spd = 130; __bh.settings.target = "moon"; return 1; })()`);
    await app
      .waitFor(`__bh.renderer.rasterLiteActive && __bh.renderer.variantQueue.pending === 0 && __bh.renderer.discsDrawn > 0`, 600_000)
      .catch(() => console.warn("  raster kernels not all in"));
    // (the view on the Moon)
    if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
    await Bun.sleep(4000);
    const perf = async () => {
      const f0 = await app.js<number>(`__bh.renderer.completedFrames`);
      await Bun.sleep(4000);
      return app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer;
        return { fps4: +((r.completedFrames - ${f0}) / 4).toFixed(2), gpuMs: +[...r.completedDurations].slice(-30).sort((a, b) => a - b)[15]?.toFixed(1),
          discs: r.discsDrawn, stars: r.starsRasterNow, fov: +__bh.settings.fov.toFixed(4), alt: __bh.camera.jetModes.alt, ev: +r.ev(__bh.settings).toFixed(2) }; })()`);
    };
    // (the canvas's own pixels — a frame grabbed at its rAF —: n crops of 2·half px round (cx, cy) [fractions], side by side)
    const frames = (n: number, half: number, at: string, every: number) =>
      app.js<string>(`(async () => {
        const cv = document.querySelector("canvas");
        const out = new OffscreenCanvas(${n} * 2 * ${half} + (${n} - 1) * 2, 2 * ${half}), g = out.getContext("2d");
        g.fillStyle = "#f0f"; g.fillRect(0, 0, out.width, out.height);
        for (let i = 0; i < ${n}; ) {
          const b = await new Promise((r) => requestAnimationFrame(() => r(createImageBitmap(cv))));
          const t = new OffscreenCanvas(1, 1).getContext("2d"); t.drawImage(b, b.width / 2, b.height / 2, 1, 1, 0, 0, 1, 1);
          const p = t.getImageData(0, 0, 1, 1).data;
          if (p[3] === 0) continue;
          const [cx, cy] = ${at};
          g.drawImage(b, Math.round(cx * b.width - ${half}), Math.round(cy * b.height - ${half}), 2 * ${half}, 2 * ${half}, i * (2 * ${half} + 2), 0, 2 * ${half}, 2 * ${half});
          i++;
          await new Promise((r) => setTimeout(r, ${every}));
        }
        const blob = await out.convertToBlob({ type: "image/png" });
        const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
        return btoa(s); })()`);
    const moonAt = `(() => { const d = __bh.renderer.skyDiscs.find((x) => x.moon); return d ? [0.5 + 0.5 * d.x, 0.5 - 0.5 * d.y] : [0.5, 0.5]; })()`;
    const wide = await perf();
    writeFileSync(`${OUT}/moon-frames.png`, Buffer.from(await frames(12, 20, moonAt, 70), "base64"));
    await app.shot(`${OUT}/moon-60.png`);
    console.log(`  60°: ${JSON.stringify(wide)}`);

    // (the telescope, zoomed in to its narrowest)
    await app.press("KeyY");
    await Bun.sleep(1500);
    for (let k = 0; k < 14; k++) await app.mouse("wheel", 800, 500, { deltaY: -300 });
    await Bun.sleep(6000);
    // (the target's offset from the view's centre — in its own field —, sampled over 6 s of flight)
    const offs: number[] = [];
    for (let k = 0; k < 30; k++) {
      offs.push(
        await app.js<number>(
          `(() => { const d = __bh.renderer.skyDiscs.find((x) => x.moon); return d ? +Math.hypot(d.x, d.y).toFixed(4) : -1; })()`,
        ),
      );
      await Bun.sleep(200);
    }
    const tele = { ...(await perf()), offsetMax: Math.max(...offs), offsetMed: [...offs].sort((a, b) => a - b)[15] };
    for (let k = 0; k < 2; k++) {
      writeFileSync(`${OUT}/moon-tele-${k}.png`, Buffer.from(await frames(1, 260, "[0.5, 0.5]", 0), "base64"));
      await Bun.sleep(3000);
    }
    await app.shot(`${OUT}/moon-tele.png`);
    console.log(`  telescope: ${JSON.stringify(tele)}`);
    writeFileSync(`${OUT}/moon.json`, JSON.stringify({ wide, tele, offs }, null, 1));
  },
  1_800_000,
);
