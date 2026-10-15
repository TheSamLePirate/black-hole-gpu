import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The carrier qualifications (docs/PLAN-AVIATION-AAA.md, M3): first the Alps as ever (the image sound); then the
// F-35C on the Ford's final by night — the deck's lights, the ball —, a pass flown by the autopilot and graded; then
// in a heavy sea — a swell of 4.4 m, the deck pitching and heaving —, a pass graded. (A pass each: the four of a full
// qualification flown headless — tests/quals.test.ts.) (E2E_SHOTS=<dir>: the views.)

const SEA = { lat: 42.75, lon: 6.1 };

describe.skipIf(!E2E)("the carrier qualifications", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const around = async (yaw: number, pitch: number, dist: number) => {
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); return 1; })()`);
    await Bun.sleep(800);
  };
  /** On the Ford's final 2.5 km out, the qualification `id` begun (a pass), flown until graded: its result. */
  const pass = async (id: string, date: string, name: string) => {
    await app.js(
      `(() => { const c = __bh.camera; c.carrierClear(); __bh.game.setDate("${date}"); __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 20, 140); return 1; })()`,
    );
    await Bun.sleep(1000);
    await app.js(`__bh.camera.carrierSpawn("ford")`);
    await app.waitFor(`!!__bh.camera.carrierNow().length`, 10_000);
    await app.js(
      `(() => { __bh.settings.shipMount = "cockpit"; const r = __bh.camera.carrierFinal("ford", 2500, 75); __bh.fleet.fuel.f35 = 3000; return r; })()`,
    );
    await Bun.sleep(300);
    const said = await app.js<string>(`__bh.camera.qualStart("${id}", { kind: "ford", auto: true, passes: 1 })`);
    console.log(`  ${said}`);
    await app.waitFor(`__bh.camera.trapRun?.ball === true`, 60_000);
    await Bun.sleep(3000);
    await shot(`${name}-final`);
    await around(240, 6, 70);
    await Bun.sleep(1500);
    await shot(`${name}-deck`);
    const hs = await app.js<number>(`__bh.camera.seaHs`);
    await app.waitFor(`!__bh.camera.qual`, 120_000);
    const r = await app.js<{ passes: { grade: string; wire?: number }[]; gpa: number; qualified: boolean }>(`__bh.camera.qualLast`);
    return { ...r, hs };
  };
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
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "C" });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("by night (23 h there): a pass on the ball by the deck's lights, graded", async () => {
    const r = await pass("night", "2026-07-10T22:35:00Z", "night");
    console.log(`  by night: ${r.passes.map((p) => `${p.grade} ${p.wire ?? 0}-wire`).join(", ")}`);
    expect(r.passes.length).toBe(1);
    expect(r.passes[0]!.wire ?? 0).toBeGreaterThan(0);
  }, 240_000);

  test("in a heavy sea (a 4.4 m swell): a pass on the pitching deck, graded", async () => {
    const r = await pass("sea", "2026-07-10T10:35:00Z", "sea");
    console.log(`  in a ${r.hs.toFixed(1)} m sea: ${r.passes.map((p) => `${p.grade} ${p.wire ?? 0}-wire`).join(", ")}`);
    expect(r.passes.length).toBe(1);
    expect(r.hs).toBeGreaterThan(3.5);
    await app.js(`(() => { __bh.settings.f35Variant = "B"; return 1; })()`);
  }, 240_000);
});
