import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The Earth's auroras redone (PLAN-AURORES-MAGNETOSPHERES AM1): the oval in magnetic local time — wider on the night side than
// at noon, its midnight sector brighter, its diffuse band, the blue N₂⁺ edge of a storm —, the dipole's pole the field module's.
// Seen from 4 000 km over the Canadian Arctic at night (Kp 3, then 7 — the far Earth's path draws none yet: AM2), from 400 km
// to the limb (Kp 5), then from the ground at Tromsø (Kp 4, looking south).
// The live Kp off (the setting's values). AO_OUT.
// Output: remote-results/aurora-oval/*.png, stats.json. Done when: the aurora kernel in (featureKey 16384), each view shot, no
// GPU error. Duration: ~2 min.
const OUT = process.env.AO_OUT ?? "remote-results/aurora-oval";
afterAll(stopServer);

test.skipIf(!E2E)(
  "the auroral oval in magnetic local time, from space at Kp 3 and 7, from the ground at Tromsø",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    const view = async (name: string, kp: number, js: string) => {
      await app.js(`(() => { Object.assign(__bh.settings, { aurora: ${kp}, auroraLive: false }); ${js}; return 1; })()`);
      await app.waitFor(`(__bh.renderer.featureKey & 16384) === 16384`, 60_000);
      // (the kernel's variant asked a moment after the setting: the compiles waited for twice, across a pause)
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 90_000);
      await Bun.sleep(2500);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 90_000);
      await Bun.sleep(3000);
      await app.shot(`${OUT}/${name}.png`);
      stats[name] = await app.js(
        `({ kp: __bh.renderer.auroraKp, fps: __bh.game.perf({ gpu: true }).renderFps, gpuMs: __bh.game.perf({ gpu: true }).gpuFrameMs })`,
      );
      console.log(`  ${name}: ${JSON.stringify(stats[name])}`);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.game.setDate("2026-12-21T07:00:00Z"); __bh.game.set("weather", "fair"); return 1; })()`);
      // (from 4 000 km over 75° N 95° W, looking down: the oval's night side over Canada, its noon side towards Siberia)
      await view("space-kp3", 3, `__bh.viewAt(75, -95, { altM: 4_000_000, heading: 0, pitch: -89, fov: 70 })`);
      await view("space-kp7", 7, `1`);
      // (from 400 km — the station's height — over 62° N 100° W, looking north to the limb: the oval's curtains below the horizon)
      await view("orbit-kp5", 5, `__bh.viewAt(62, -100, { altM: 400_000, heading: 0, pitch: -12, fov: 90 })`);
      // (Tromsø at 23:00 local, looking south, 30° up: at Kp 4 the oval's midnight arc passes some 3° of magnetic latitude south of
      // it — 63.4° against its 66.7° —; looking north, none — the Lofoten's view in s2-views looks south too)
      await view(
        "tromso-kp4",
        4,
        `__bh.game.setDate("2026-12-21T22:00:00Z"); __bh.viewAt(69.65, 18.96, { altM: 60 + __bh.sys.geoid(69.65, 18.96), heading: 180, pitch: 30, fov: 80 })`,
      );
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  6 * 60_000,
);
