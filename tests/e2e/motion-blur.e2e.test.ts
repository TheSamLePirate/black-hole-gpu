import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// Q6 I6 A4 — the motion blur at a fixed exposure (decision 38 (3): off by default, an option for replays and videos;
// renderer.shutterShare, post.wgsl motionBlur): settings.motionBlur × 1/30 s of exposure whatever the frame rate. The F-35 over
// Tarifa from around it, the view turned about it at 60° a second of real time (the image sweeping ~21 px each 1/60 s), in real
// time: the default checked (0), then the blur off, at 0.5 (1/60 s), and at 0.5 with the frames capped at 30 a second instead of
// 60 — the image's sharpness (the Laplacian's energy) over the ground: softer with the blur, the same at both cadences (the
// exposure fixed; a share of the frame's would smear twice as long at 30 a second).
// Output: remote-results/motion-blur/{off,on60,on30}.png (MB_OUT).
// Done when: the three turns shot and compared, no GPU error.
// Duration: ~2 min (the tiles, three turns of 1.5 s).
const OUT = process.env.MB_OUT ?? "remote-results/motion-blur";
afterAll(stopServer);

// (the HUD off — its lines sharp in every image, over the ground's measure)
const CLEAN = `Object.assign(__bh.settings, { hudJet: "off", hudHorizon: false, hudHeading: false, hudBank: false, hudMarkers: false,
  hudEdge: false, hudAoA: false, hudEnergy: false, hudDirector: false, hudPath: false, hudFuture: false, hudImpact: false, hudRunway: false });`;
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
/** the Laplacian's mean energy of the luminance below the horizon's band (rows 0.55–0.75 of the height, x 0.3–0.7 — the ground, clear of the page's panels) */
function sharpness(f: string) {
  const a = png(f);
  const L = (x: number, y: number) => {
    const i = (y * a.width + x) * a.channels;
    return 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
  };
  let e = 0,
    n = 0;
  for (let y = Math.round(a.height * 0.55); y < a.height * 0.75; y++)
    for (let x = Math.round(a.width * 0.3); x < a.width * 0.7; x++) {
      const l = 4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1);
      e += l * l;
      n++;
    }
  return e / n;
}

test.skipIf(!E2E)(
  "Q6 I6 A4: the motion blur off by default; on, the same smear at 60 and 30 images a second",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis", tiles: true });
    try {
      expect(await app.js<number>(`__bh.settings.motionBlur`)).toBe(0);
      await app.js(
        `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false }); Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, dynamicResolution: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.flyAt(36.08, -5.6, 400, 20, 160);
        __bh.settings.shipMount = "chase"; __bh.refresh(); return 1; })()`);
      await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).catch(() => {});
      await app.js(
        `(() => { document.body.classList.add("hide-ui"); document.getElementById("overlay").style.visibility = "hidden"; return 1; })()`,
      );
      const save = await app.js<string>(`JSON.stringify(__bh.game.snapshot("motion-blur"))`);
      const rows: Record<string, number> = {};
      for (const [name, blur, cap] of [
        ["off", 0, 60],
        ["on60", 0.5, 60],
        ["on30", 0.5, 30],
      ] as const) {
        await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(save)}, false); __bh.settings.shipMount = "around";
          Object.assign(__bh.settings, { motionBlur: ${blur}, fpsCap: ${cap} }); ${CLEAN}
          document.body.classList.add("hide-ui"); document.getElementById("overlay").style.visibility = "hidden"; return 1; })()`);
        await Bun.sleep(500);
        await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 0, pitch: 20, dist: 30 }); return 1; })()`);
        await app.settled(60_000);
        // (the view turned about the craft at 60° a second of real time, in real time — the image sweeping ~21 px each 1/60 s: the
        // fixed exposure's smear the same at both caps; a share of the frame's would double at 30 a second). Shot while it turns.
        await app.js(`(() => { const c = __bh.camera; let last = performance.now(); window.__mbSpin = true;
          const f = () => { if (!window.__mbSpin) return; const now = performance.now(); c.outside.yaw += 60 * (now - last) / 1000; last = now;
            __bh.touch(); requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
        await Bun.sleep(1500);
        // (captured as it is — app.shot waits for the scene settled first)
        const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        await Bun.write(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
        await app.js(`(() => { window.__mbSpin = false; return 1; })()`);
        rows[name] = +sharpness(`${OUT}/${name}.png`).toFixed(1);
      }
      const gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(
        `  motion blur: ${JSON.stringify({ ...rows, ratio60: +(rows.on60! / rows.off!).toFixed(3), ratio30: +(rows.on30! / rows.off!).toFixed(3), gpuErrors })}`,
      );
      expect(rows.on60!).toBeLessThan(rows.off! * 0.9);
      expect(Math.abs(rows.on30! / rows.on60! - 1)).toBeLessThan(0.25);
      expect(gpuErrors).toBe(0);
      await app.js(
        `(() => { Object.assign(__bh.settings, { motionBlur: 0, fpsCap: 0 }); __bh.freeze(false); document.body.classList.remove("hide-ui"); document.getElementById("overlay").style.visibility = ""; return 1; })()`,
      );
    } finally {
      await app.close();
    }
  },
  300_000,
);
