import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A14: the A320's ground services and its pushback in the game — at Le Bourget, cold and dark: the stairs at
// the front and rear doors (open), the GPU, the fuel truck, the catering trucks (their boxes rising), the baggage belt,
// the chocks, seen from outside; the GPU making EXT PWR available — its pushbutton in: the AC buses powered, the
// displays lit —; the services withdrawn, the tug called, connected at the nose, the push straight back.

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320's ground services and pushback", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "cold";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "quarter";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.camera.a320Sys", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
    await Bun.sleep(3000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** a view of the craft's (its mount, the look turned on it) */
  const view = async (mount: string, yaw: number, pitch: number, wait = 1500) => {
    await app.js(`(() => {
      __bh.settings.shipMount = ${JSON.stringify(mount)};
      __bh.settings.shipLookYaw = ${yaw};
      __bh.settings.shipLookPitch = ${pitch};
      __bh.refresh();
      return true;
    })()`);
    await Bun.sleep(wait);
  };

  test("the services about it: stairs, GPU, fuel truck, catering, belt, chocks — the doors open", async () => {
    const r = await app.js<string[]>(`(() => {
      const c = __bh.camera;
      return ["stairs", "stairsAft", "gpu", "fuel", "catering", "cateringAft", "belt", "chocks"].map((id) => c.a320Service(id));
    })()`);
    console.log(`  ${r.join(" · ")}`);
    // (the meshes fetched, the catering's boxes up — 20 s —, the doors open)
    await app.waitFor(`__bh.renderer.a320Ground?.length >= 11 && __bh.renderer.ship.has("gs-tug") !== undefined`, 30_000);
    await Bun.sleep(21_000);
    const d = await app.js<number[]>(
      `[0, 1, 2, 3].map((k) => __bh.renderer.a320Pose.props["sim/model/door-positions/" + ["doorl1", "doorl4", "doorr1", "doorr4"][k] + "/position-norm"])`,
    );
    console.log(`  doors L1 L4 R1 R4: ${d.map((x) => x.toFixed(2)).join(" ")}`);
    expect(d[0]).toBeGreaterThan(0.9);
    expect(d[1]).toBeGreaterThan(0.9);
    expect(d[2]).toBeGreaterThan(0.9);
    for (const [m, y, p, n] of [
      ["quarter", 0, -6, "quarter"],
      ["tail", 0, -30, "from-fin"],
      ["wing", 25, -14, "left-side"],
      ["chase", 0, -8, "chase"],
    ] as const) {
      await view(m, y, p);
      await shot(app, `a320-svc-${n}`);
    }
  }, 120_000);

  test("the GPU: EXT PWR available, its pushbutton in — the buses powered from cold and dark", async () => {
    expect(await app.js<number>(`Number(__bh.camera.a320Props["controls/electrical/switches/ground-cart"])`)).toBe(1);
    await app.js(`(__bh.camera.a320Props["controls/electrical/switches/ext-pwr"] = 1, true)`);
    await Bun.sleep(4000);
    const ac = await app.js<number>(`Number(__bh.camera.a320Props["systems/electrical/bus/ac-1"] ?? 0)`);
    console.log(`  EXT PWR: AC 1 ${ac.toFixed(0)} V`);
    expect(ac).toBeGreaterThan(100);
  }, 60_000);

  test("the pushback: the services withdrawn, the tug at the nose, pushed straight back", async () => {
    await app.js(`(() => {
      const c = __bh.camera;
      for (const id of [...c.a320Ground.on]) c.a320Service(id);
      // (the parking brake released: its handle on the deck — the game's follows it)
      c.a320Props["controls/gear/brake-parking"] = 0;
      c.a320Park = false;
      return c.a320PushCmd("call");
    })()`);
    await app.waitFor(`__bh.camera.a320Push.phase === "connected"`, 20_000);
    const p0 = await app.js<{ lat: number; lon: number }>(
      `(() => { const g = __bh.camera.geoNow(); return { lat: g.lat, lon: g.lon }; })()`,
    );
    expect(await app.js<string>(`__bh.camera.a320PushCmd("straight")`)).toBeTruthy();
    await view("tail", 0, -24, 0);
    await Bun.sleep(12_000);
    await shot(app, "a320-push-nose");
    await view("quarter", 0, -8, 0);
    await Bun.sleep(4000);
    await shot(app, "a320-push-side");
    await view("rear", 0, -18, 0);
    await Bun.sleep(3000);
    await shot(app, "a320-push-front");
    console.log(
      `  tug: ${JSON.stringify(await app.js(`(() => { const c = __bh.camera; return { out: c.a320PushOut, park: c.a320Park, chocks: c.a320Ground?.chocked, rolling: !!c.rolling, landed: !!c.ourLanded, engineNow: c.pilot.engineNow, auto: c.pilot.auto, mode: __bh.settings.flightMode, hold: c.pilot.hold, accel: c.pilot.accel, fired: c.pilot.fired.throttle, motion: __bh.settings.motion, anim: __bh.settings.animate, time: c.time, local: !!c.local, landedH: c.ourLanded?.h, gear: c.gearLast?.contact, piloting: c.piloting, puppet: !!c.puppet }; })()`))}`,
    );
    console.log(`  tug drawn: ${JSON.stringify(await app.js(`__bh.renderer.a320Ground`))}`);
    const r = await app.js<{ moved: number; speed: number; phase: string }>(`(() => {
      const c = __bh.camera, g = c.geoNow();
      const D = Math.PI / 180;
      const dn = (g.lat - ${p0.lat}) * D * 6371000, de = (g.lon - ${p0.lon}) * D * 6371000 * Math.cos(g.lat * D);
      return { moved: Math.hypot(dn, de), speed: g.gs, phase: c.a320Push.phase };
    })()`);
    console.log(`  pushed ${r.moved.toFixed(1)} m at ${(r.speed * 3.6).toFixed(1)} km/h (${r.phase})`);
    expect(r.moved).toBeGreaterThan(8);
    expect(r.speed * 3.6).toBeLessThan(7);
  }, 120_000);
});
