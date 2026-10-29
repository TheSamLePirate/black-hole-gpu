import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The camera's smoothness, situation by situation (docs/PLAN-CAMERA-AAA.md CAM0, the sensor src/camera/metrics.ts):
// each situation recorded frame by frame — an orbit held, the wheel's zoom, travels Earth → Moon → Mars → ISS → Earth,
// a key held in free flight, Gargantua's worlds and the hole, the F-35's views cycled by V, the spectator out and back —
// and its faults counted (jumps, snapped aims, fov jumps, speed breaks). CAM0 records the baseline (BASELINE=1: report
// only); from CAM2 on, each situation must have no fault but its marked cuts.
// Duration: ~4 min here (headless).
// Done when: every situation's faults are written to remote-results/camera-smooth/report.json.

const BASELINE = process.env.BASELINE === "1";
const OUT = "remote-results/camera-smooth";

interface Fault {
  kind: string;
  t: number;
  score: number;
  size: number;
  h: number;
}
interface Report {
  frames: number;
  seconds: number;
  counts: { jump: number; turn: number; fov: number; speed: number };
  faults: Fault[];
  worstJump: number;
  p95Jump: number;
  worstTurn: number;
}

describe.skipIf(!E2E)("the camera's smoothness", () => {
  let app: App;
  const results: Record<string, Report> = {};
  // (a situation: the sensor started afresh, the action, its report kept and printed)
  const situation = async (name: string, act: () => Promise<void>) => {
    await app.js(`__bh.cam.start()`);
    await act();
    const r = await app.js<Report>(`(__bh.cam.stop(), __bh.cam.report())`);
    results[name] = r;
    const c = r.counts;
    console.log(
      `  ${name.padEnd(28)} ${String(r.frames).padStart(5)} frames  jump ${c.jump}  turn ${c.turn}  fov ${c.fov}  speed ${c.speed}` +
        `  worst ×${r.worstJump.toFixed(1)}  turn ${r.worstTurn.toFixed(1)}°`,
    );
    await app.shot(`${OUT}/${name.replace(/[^a-z0-9]+/gi, "-")}.png`);
    if (!BASELINE) expect(c.jump + c.turn + c.fov + c.speed).toBe(0);
  };
  const travelling = `(() => { const v = __bh.camera.viewController(); return !!v.travel || !!v.flight; })()`;
  const travel = async (id: string) => {
    await app.js(`__bh.goTo(${JSON.stringify(id)})`);
    await app.waitFor(`!${travelling}`, 60_000);
    await Bun.sleep(800);
  };

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1280, height: 720, hash: "scene=Earth: the Blue Marble", tiles: false });
    await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
  }, 300_000);
  afterAll(() => {
    if (app) writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 1));
    app?.close();
    stopServer();
  });

  test("our system: orbit, zoom, travels, free flight", async () => {
    await situation("orbit-held", async () => Bun.sleep(3000));
    await situation("wheel-zoom", async () => {
      for (let k = 0; k < 20; k++) {
        await app.mouse("wheel", 640, 360, { deltaY: k < 10 ? -240 : 240 });
        await Bun.sleep(120);
      }
      await Bun.sleep(1500);
    });
    await situation("travel-earth-moon", () => travel("moon"));
    await situation("travel-moon-mars", () => travel("mars"));
    await situation("travel-mars-iss", () => travel("iss"));
    await situation("travel-iss-earth", () => travel("earth"));
    await situation("free-key-held", async () => {
      await app.hold("KeyW", 3000);
      await Bun.sleep(1000);
    });
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);

  test("Gargantua: its worlds and the hole", async () => {
    await app.load("scene=Gargantua system (10⁸ M☉, a* = 0.998)");
    await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
    await situation("gargantua-orbit-held", async () => Bun.sleep(3000));
    await situation("travel-to-miller", () => travel("miller"));
    await situation("travel-to-hole", () => travel("hole"));
    await situation("travel-to-wormhole", () => travel("wormhole"));
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);

  test("a flown craft: the F-35's views, the spectator out and back", async () => {
    await app.load("scene=game:artemis");
    await app.waitFor("__bh.camera.piloting && __bh.renderer.completedFrames > 30", 120_000);
    await situation("f35-views-cycled", async () => {
      for (let k = 0; k < 6; k++) {
        await app.press("KeyV");
        await Bun.sleep(1200);
      }
    });
    await situation("spectator-out-back", async () => {
      await app.press("F3");
      await app.waitFor(`__bh.camera.spectating`, 10_000);
      await Bun.sleep(2000);
      await app.press("F1");
      await app.waitFor(`!__bh.camera.spectating`, 10_000);
      await Bun.sleep(2000);
    });
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);
});
