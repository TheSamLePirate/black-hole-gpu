import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-AUDIO S1: the sound's space, measured at the output (the engine's two channels metered apart —
// Chrome's --mute-audio silences the speakers, not the graph). The main engine at full throttle, placed at
// its nozzles: behind the pilot, to the left of the right wingtip's camera, ahead of the nose looking back;
// headphones turn the panner to HRTF; in the air, a free camera hears the passing ship's Doppler. S2: the
// engine granular — its AudioWorklet loaded, rendering ten seconds offline for a few percent of a core. S3:
// the attitude thrusters heard where they sit — a yaw from the stick fires clusters on both sides. S4: the
// cabin — the hull's modes and the fan from the seat (not from the chase), the beeps from the panel, the
// crew breathing and the structure creaking under 5 g. S5: the ground — a landing at Edwards, live: the
// tyres' chirps at the touchdown (the mains, then the nose), the rolling's rumble, the runway's joints, the
// brakes' squeal once every wheel is down. S6: the station — its hum where its port is on the approach,
// through the structure once docked; the docking's latches and the undocking's springs.

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

  test("the granular engine: its worklet loaded, cheap — ten seconds of full thrust in the air rendered offline", async () => {
    expect(await app.js<string>("__sound.spaceState().engine")).toBe("granular");
    const r = await app.js<{ share: number; rms: number }>(`(async () => {
      const R = 48000, T = 10;
      const ctx = new OfflineAudioContext(1, R * T, R);
      await ctx.audioWorklet.addModule(new URL("audio-worklet.js", location.href));
      const node = new AudioWorkletNode(ctx, "kerr-rocket", { numberOfInputs: 0, outputChannelCount: [1] });
      node.parameters.get("throttle").value = 1;
      node.parameters.get("air").value = 1;
      node.connect(ctx.destination);
      const t0 = performance.now();
      const d = (await ctx.startRendering()).getChannelData(0);
      let e = 0;
      for (const x of d) e += x * x;
      return { share: (performance.now() - t0) / (T * 1000), rms: Math.sqrt(e / d.length) };
    })()`);
    expect(r.rms).toBeGreaterThan(0.05);
    expect(r.share).toBeLessThan(0.05);
  });

  test("a yaw from the stick: the thruster clusters that fire, where they sit on the hull", async () => {
    const r = await app.js<{ x: number; z: number; g: number }[]>(`(async () => {
      __bh.settings.shipMount = "cockpit"; __bh.refresh();
      __bh.camera.touchInput = { pitch: 0, yaw: 1, roll: 0 };
      let best = [];
      for (let k = 0; k < 8; k++) {
        await new Promise((ok) => setTimeout(ok, 100));
        const c = __sound.spaceState().clusters;
        if (c.filter((q) => q.g > 0.3).length > best.filter((q) => q.g > 0.3).length) best = c;
      }
      __bh.camera.touchInput = { pitch: 0, yaw: 0, roll: 0 };
      return best;
    })()`);
    const on = r.filter((c) => c.g > 0.3);
    expect(on.length).toBeGreaterThanOrEqual(2);
    // (placed: not all at one point — on both sides of the pilot, fore and aft)
    expect(Math.max(...on.map((c) => c.x)) - Math.min(...on.map((c) => c.x))).toBeGreaterThan(2);
    expect(Math.max(...on.map((c) => c.z)) - Math.min(...on.map((c) => c.z))).toBeGreaterThan(5);
  });

  test("the cabin: the hull's modes, the fan, the panel's beeps; breathing and creaks under 5 g", async () => {
    type Cab = { hull: number; fan: number; breathing: boolean; breaths: number; creaks: number; g: number; beep: number[] };
    const at = (m: string) =>
      app.js<Cab>(`(async () => {
        __bh.settings.shipMount = ${JSON.stringify(m)}; __bh.refresh();
        await new Promise((ok) => setTimeout(ok, 1500));
        return __sound.spaceState().cabin;
      })()`);
    const seat = await at("cockpit");

    expect(seat.hull).toBeGreaterThan(5);
    expect(seat.fan).toBeGreaterThan(0.005);
    // (the panel: ahead and below, within arm's reach)
    expect(seat.beep[2]!).toBeLessThan(-0.3);
    expect(seat.beep[1]!).toBeLessThan(0);
    expect(Math.hypot(...seat.beep)).toBeLessThan(1.5);
    const chase = await at("chase");
    expect(chase.hull).toBeLessThan(1);
    expect(chase.fan).toBeLessThan(0.003);
    // (5 g at full throttle: the crew strains)
    const r = await app.js<{ before: Cab; after: Cab }>(`(async () => {
      __bh.settings.shipMount = "cockpit"; __bh.refresh();
      const was = __bh.settings.crewG;
      const before = { ...__sound.spaceState().cabin };
      __bh.game.set("crewG", 5);
      __bh.camera.pilot.throttle = 1;
      await new Promise((ok) => setTimeout(ok, 6000));
      const after = __sound.spaceState().cabin;
      __bh.camera.pilot.throttle = 0;
      __bh.game.set("crewG", was);
      return { before, after };
    })()`);
    expect(r.after.g).toBeGreaterThan(4.5);
    expect(r.after.breathing).toBe(true);
    expect(r.after.breaths).toBeGreaterThan(r.before.breaths);
    expect(r.after.creaks).toBeGreaterThan(r.before.creaks + 2);
  }, 60_000);

  test("headphones: the panner in HRTF; speakers: equal-power", async () => {
    await app.js(`(__bh.game.set("soundHeadphones", true), true)`);
    expect(await app.js<string>("__sound.spaceState().model")).toBe("HRTF");
    await app.js(`(__bh.game.set("soundHeadphones", false), true)`);
    expect(await app.js<string>("__sound.spaceState().model")).toBe("equalpower");
  });

  test("the ground: a landing at Edwards — the tyres' chirps, the rolling, the runway's joints, the brakes", async () => {
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
    type Cab = { chirps: number; joints: number; roll: number; squeal: number };
    const r = await app.js<{ before: Cab; after: Cab; roll: number; squeal: number }>(`(async () => {
      __bh.freeze(true);
      __bh.game.glideTo("Edwards");
      const c = __bh.camera;
      for (let i = 0; i < 30 * 200; i++) { __bh.step(1 / 30); const A = c.entryRun?.app; if (A?.final && A.agl < 25) break; }
      __bh.settings.shipMount = "chase"; __bh.refresh();
      const before = { ...__sound.spaceState().cabin };
      __bh.freeze(false);
      let roll = 0, squeal = 0;
      for (let i = 0; i < 300; i++) {
        await new Promise((ok) => setTimeout(ok, 100));
        const s = __sound.spaceState().cabin;
        roll = Math.max(roll, s.roll);
        squeal = Math.max(squeal, s.squeal);
        if (s.joints > before.joints + 10 && squeal > 0) break;
      }
      __bh.freeze(true);
      return { before, after: __sound.spaceState().cabin, roll, squeal };
    })()`);
    expect(r.after.chirps - r.before.chirps).toBeGreaterThanOrEqual(2);
    expect(r.after.joints - r.before.joints).toBeGreaterThan(10);
    expect(r.roll).toBeGreaterThan(0.2);
    expect(r.squeal).toBeGreaterThan(0.005);
    await app.js("(__bh.freeze(false), true)");
  }, 120_000);

  test("the station: its hum at the port on the approach, through the structure docked; the latches, the springs", async () => {
    const r = await app.js<{ near: { g: number; z: number }; docked: { g: number }; isDocked: boolean; docks: number[] }>(`(async () => {
      __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      await wait(2500);
      const c = __bh.camera;
      const near = __sound.spaceState().cabin.station;
      const d0 = __sound.spaceState().cabin.docks;
      __bh.freeze(true);
      c.pilot.auto = "none"; c.pilot.setAuto("dock");
      for (let i = 0; i < 30 * 600 && !c.docked; i++) __bh.step(1 / 30);
      __bh.freeze(false);
      await wait(3000);
      const docked = __sound.spaceState().cabin.station, isDocked = !!c.docked, d1 = __sound.spaceState().cabin.docks;
      c.undock();
      await wait(1000);
      return { near, docked, isDocked, docks: [d0, d1, __sound.spaceState().cabin.docks] };
    })()`);
    // (ahead, tens of metres off: a dulled hum)
    expect(r.near.g).toBeGreaterThan(0.01);
    expect(r.near.z).toBeLessThan(-10);
    expect(r.isDocked).toBe(true);
    expect(r.docked.g).toBeGreaterThan(r.near.g * 2);
    expect(r.docks[1]).toBe(r.docks[0]! + 1);
    expect(r.docks[2]).toBe(r.docks[1]! + 1);
  }, 120_000);

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
