import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The Earth's auroras redone (PLAN-AURORES-MAGNETOSPHERES AM1): the oval in magnetic local time — wider on the night side than
// at noon, its midnight sector brighter, its diffuse band, the blue N₂⁺ edge of a storm —, the dipole's pole the field module's.
// AM2: their light in kR → cd/m², thin slabs along the field, the eye adapted to the night sky. Seen from 4 000 km over the
// Canadian prairies in the Earth's shadow (Kp 3, then 7: the oval's night side in front of the Earth, its noon side towards the
// pole), from 400 km over Manitoba looking south across the oval (Kp 5), from 400 km looking north to the limb (Kp 5: the
// oval beyond the pole), then from the ground at Tromsø (Kp 4, looking south).
// The live Kp off (the setting's values). AO_OUT. AO_TUNE=NAME=value,…: a renderer.tune for every view (a measuring lever).
// Output: remote-results/aurora-oval/*.png, stats.json. Done when: the aurora kernel in (featureKey 16384), each view shot, no
// GPU error. Duration: ~2.5 min.
const OUT = process.env.AO_OUT ?? "remote-results/aurora-oval";
// (AO_TUNE=NAME=value,…: a measuring lever for every view — renderer.tune, e.g. TUNE_AIR_N=8)
const AO_TUNE = JSON.stringify(
  Object.fromEntries(
    (process.env.AO_TUNE ?? "")
      .split(",")
      .filter((x) => x.includes("="))
      .map((x) => [x.split("=")[0]!, Number(x.split("=")[1])]),
  ),
);
afterAll(stopServer);

test.skipIf(!E2E)(
  "the auroral oval in magnetic local time, from space at Kp 3 and 7, from the ground at Tromsø",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    const view = async (name: string, kp: number, js: string) => {
      await app.js(
        `(() => { Object.assign(__bh.settings, { aurora: ${kp}, auroraLive: false }); __bh.renderer.tune = ${AO_TUNE}; ${js}; return 1; })()`,
      );
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
      // (from 4 000 km over 50° N 100° W, looking down, in the Earth's shadow — the camera sunlit, the eye adapts to the day and
      // the night side's oval vanishes —: the midnight oval at 62–65° of magnetic latitude, 54–56° N, in front of the Earth)
      await view("space-kp3", 3, `__bh.viewAt(50, -100, { altM: 4_000_000, heading: 0, pitch: -89, fov: 70 })`);
      await view("space-kp7", 7, `1`);
      // (from 400 km — the station's height — over 58° N 95° W, poleward of the oval, looking south: its curtains over the Earth)
      await view("orbit-south-kp5", 5, `__bh.viewAt(58, -95, { altM: 400_000, heading: 180, pitch: -20, fov: 90 })`);
      // (from 400 km over 62° N 100° W, looking north to the limb: the oval's far side beyond the pole)
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
