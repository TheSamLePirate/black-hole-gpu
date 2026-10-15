import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35's levels of assistance (docs/PLAN-AVIATION-AAA.md, A1): first the Alps as ever; then the beginner's ring
// moved by real keys (the roll key (E) held: the ring to the right, the jet following it round); then rolled onto its
// back with the realistic law, ⇧X: back to stable flight — the wings level, climbing, the holds. (Measured headless:
// tests/assistlevel.test.ts.) (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the levels of assistance", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const att = () =>
    app.js<{ hdg: number; bank: number; alt: number }>(
      `(() => { const a = __bh.camera.attitudeNow(); return { hdg: a.heading * 180 / Math.PI, bank: a.bank * 180 / Math.PI, alt: __bh.camera.geoNow().alt }; })()`,
    );
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "B" });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("beginner: the roll key moves the ring right, the jet follows it round", async () => {
    await app.js(`(() => { __bh.settings.f35Assist = "beginner"; __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1000);
    const a0 = await att();
    await app.hold("KeyE", 1200);
    await Bun.sleep(400);
    await shot("ring");
    const ring = await app.js<number>(`__bh.camera.aimRing.hdg * 180 / Math.PI`);
    await Bun.sleep(10_000);
    const a1 = await att();
    const turned = ((a1.hdg - a0.hdg + 540) % 360) - 180;
    const onRing = ((a1.hdg - ring + 540) % 360) - 180;
    console.log(
      `  the ring ${(((ring - a0.hdg + 540) % 360) - 180).toFixed(0)}° right; the jet turned ${turned.toFixed(0)}°, ${onRing.toFixed(1)}° off it`,
    );
    expect(turned).toBeGreaterThan(25);
    expect(Math.abs(onRing)).toBeLessThan(3);
    await shot("ring-followed");
  }, 60_000);

  test("on its back, ⇧X: back to stable flight — the wings level, climbing, the holds", async () => {
    await app.js(`(() => { __bh.settings.f35Assist = "realistic"; __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.hold("KeyE", 1100);
    await Bun.sleep(200);
    const a0 = await att();
    await shot("inverted");
    await app.press("KeyX", "X", { shift: true });
    expect(await app.js<boolean>(`!!__bh.camera.recovering`)).toBe(true);
    await app.waitFor(`!__bh.camera.recovering`, 20_000);
    const a1 = await att();
    console.log(
      `  from ${a0.bank.toFixed(0)}° of bank: level at ${a1.bank.toFixed(1)}°, ${(a1.alt - a0.alt).toFixed(0)} m; the holds ${await app.js<string>(`JSON.stringify(__bh.camera.jetModes)`)}`,
    );
    expect(Math.abs(a0.bank)).toBeGreaterThan(90);
    expect(Math.abs(a1.bank)).toBeLessThan(10);
    expect(await app.js<number | null>(`__bh.camera.jetModes.alt`)).not.toBeNull();
    await Bun.sleep(1000);
    await shot("recovered");
  }, 60_000);
});
