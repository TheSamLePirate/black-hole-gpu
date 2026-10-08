import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-AUDIO S1: the sound's space, measured at the output (the engine's two channels metered apart —
// Chrome's --mute-audio silences the speakers, not the graph). The main engine at full throttle, placed at
// its nozzles: behind the pilot, to the left of the right wingtip's camera, ahead of the nose looking back;
// headphones turn the panner to HRTF; in the air, a free camera hears the passing ship's Doppler.

describe.skipIf(!E2E)("the sound's space", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    // (a key: the audio's user gesture — twice, the SAS back as it was)
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const burn = (mount: string) =>
    app.js<{ on: [number, number]; off: [number, number]; sp: { x: number; y: number; z: number; model: string } }>(`(async () => {
      __bh.settings.shipMount = ${JSON.stringify(mount)}; __bh.refresh();
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      __bh.camera.pilot.throttle = 1;
      await wait(1500);
      const on = __sound.levels(), sp = __sound.spaceState();
      __bh.camera.pilot.throttle = 0;
      await wait(1500);
      return { on, off: __sound.levels(), sp };
    })()`);

  test("the engine placed at its nozzles: behind the pilot, left of the right wingtip, ahead of the nose looking back", async () => {
    const seat = await burn("cockpit");
    expect(seat.sp.z).toBeGreaterThan(5);
    // (heard: the burn well over the cabin's own sound)
    expect(Math.max(...seat.on)).toBeGreaterThan(Math.max(...seat.off) + 6);
    const wing = await burn("wing");
    expect(wing.sp.x).toBeLessThan(-3);
    expect(wing.on[0] - wing.on[1]).toBeGreaterThan(6);
    const rear = await burn("rear");
    expect(rear.sp.z).toBeLessThan(-5);
  }, 60_000);

  test("headphones: the panner in HRTF; speakers: equal-power", async () => {
    await app.js(`(__bh.game.set("soundHeadphones", true), true)`);
    expect(await app.js<string>("__sound.spaceState().model")).toBe("HRTF");
    await app.js(`(__bh.game.set("soundHeadphones", false), true)`);
    expect(await app.js<string>("__sound.spaceState().model")).toBe("equalpower");
  });

  test("in the air, the fly-by camera: the passing ship's Doppler, up then down, and the air's absorption far off", async () => {
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
    const r = await app.js<{ cents: number[]; cutoff: number[] }>(`(async () => {
      __bh.game.glideTo("Edwards", 20, 3, 200);
      __bh.settings.shipMount = "flyby"; __bh.refresh();
      const cents = [], cutoff = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((ok) => setTimeout(ok, 250));
        const s = __sound.spaceState();
        cents.push(s.cents);
        cutoff.push(s.cutoff);
      }
      return { cents, cutoff };
    })()`);
    expect(Math.max(...r.cents)).toBeGreaterThan(300);
    expect(Math.min(...r.cents)).toBeLessThan(-300);
    expect(Math.min(...r.cutoff)).toBeLessThan(8000);
  }, 120_000);
});
