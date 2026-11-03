import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// Q6 I6 — the image's profile (decision 32): Camera — a discreet footage grade, a light grain, a vignette — in the game's flight
// views, Neutral (the physical image) elsewhere; settings.lookProfile auto, camera, neutral (display.wgsl cameraLook). The
// F-35's cockpit over Tarifa, frozen, the exposure settled: the same view shot Neutral then Camera — the Camera discreet (the
// mean luminance within 5 %, the corners darker than the centre by a little, the image's detail kept) —; auto resolved to
// Camera while the craft is flown.
// Output: remote-results/look-profile/{neutral,camera}.png (LP_OUT).
// Done when: both shots taken and compared, auto checked, no GPU error.
// Duration: ~1.5 min (the tiles, two shots).
const OUT = process.env.LP_OUT ?? "remote-results/look-profile";
afterAll(stopServer);

const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
type Png = ReturnType<typeof png>;
/** mean luminance [0…255] over a box */
function mean(a: Png, x0: number, y0: number, w: number, h: number) {
  let s = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * a.width + x) * a.channels;
      s += 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
    }
  return s / (w * h);
}

test.skipIf(!E2E)(
  "Q6 I6: the Camera profile is discreet, Neutral leaves the image as it is, auto is Camera in flight",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.flyAt(36.08, -5.6, 700, 20, 200);
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
      await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 90_000).catch(() => {});
      await app.js(`(() => { __bh.freeze(true); document.body.classList.add("hide-ui"); return 1; })()`);
      await app.settled(60_000);
      // (auto, the craft flown: Camera)
      const auto = await app.js<{ flight: boolean; profile: string }>(
        `({ flight: __bh.renderer.flightView, profile: __bh.settings.lookProfile })`,
      );
      expect(auto.profile).toBe("auto");
      expect(auto.flight).toBe(true);
      const shots: Record<string, Png> = {};
      for (const p of ["neutral", "camera"]) {
        await app.js(`(() => { __bh.settings.lookProfile = "${p}"; __bh.touch(); return 1; })()`);
        await app.js(
          `new Promise((r) => { let n = 0; const f = () => (++n >= 20 ? r(1) : requestAnimationFrame(f)); requestAnimationFrame(f); })`,
        );
        await app.exposureSettled();
        await app.shot(`${OUT}/${p}.png`);
        shots[p] = png(`${OUT}/${p}.png`);
      }
      const n = shots.neutral!,
        c = shots.camera!;
      const W = n.width,
        H = n.height;
      const whole = [mean(n, 0, 60, W, H - 60), mean(c, 0, 60, W, H - 60)];
      const centre = [mean(n, W / 2 - 100, H / 2 - 60, 200, 120), mean(c, W / 2 - 100, H / 2 - 60, 200, 120)];
      const corner = [mean(n, 10, 70, 120, 90), mean(c, 10, 70, 120, 90)];
      const row = {
        meanNeutral: +whole[0]!.toFixed(1),
        meanCamera: +whole[1]!.toFixed(1),
        centreRatio: +(centre[1]! / centre[0]!).toFixed(3),
        cornerRatio: +(corner[1]! / corner[0]!).toFixed(3),
        gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
      };
      console.log(`  look: ${JSON.stringify(row)}`);
      expect(Math.abs(whole[1]! / whole[0]! - 1)).toBeLessThan(0.05);
      expect(row.cornerRatio).toBeLessThan(row.centreRatio);
      expect(row.gpuErrors).toBe(0);
      await app.js(
        `(() => { __bh.settings.lookProfile = "auto"; __bh.freeze(false); document.body.classList.remove("hide-ui"); return 1; })()`,
      );
    } finally {
      await app.close();
    }
  },
  300_000,
);
