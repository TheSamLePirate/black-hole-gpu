import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fromRunway, ILS } from "../../src/game/ils";
import { RUNWAY_LENGTH, SITES } from "../../src/game/sites";
import { App, E2E, stopServer } from "./lib/app";

// The ILS (docs/PLAN-AVIATION-AAA.md, P4): first the Alps as ever; then the F-35B on Edwards's final, 5 km out on its
// 3° glideslope, the ILS engaged — its needles in the view, the gear, minimums, the flare —, down in the touchdown
// zone and braked to a stop, graded. (Headless and whole, from 30 km, a hold, a missed approach, a flight plan's end:
// tests/ils.test.ts.) (E2E_SHOTS=<dir>: the views.)

const K = SITES.find((s) => s.icao === "KEDW")!;
const W = { name: K.name, lat: K.lat, lon: K.lon, hdg: K.rwy!, elev: K.elev!, len: RUNWAY_LENGTH };

describe.skipIf(!E2E)("the ILS", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
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
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "B" });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("Edwards's final from 5 km: the needles, minimums, the flare, down in the zone and stopped", async () => {
    const p = fromRunway(W, -5000, 0);
    const h = (ILS.gpi + 5000) * Math.tan((ILS.glide * Math.PI) / 180);
    await app.js(`(() => { __bh.game.setDate("2026-07-10T17:00:00Z"); __bh.game.flyAt(${p.lat}, ${p.lon}, ${h.toFixed(0)}, ${W.hdg}, 90);
      __bh.fleet.fuel.f35 = 3000; __bh.camera.gearDown = true; __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(800);
    const said = await app.js<string>(`__bh.camera.ilsStart("KEDW")`);
    console.log(`  ${said}`);
    expect(said).toMatch(/KEDW 22/);
    await app.waitFor(`__bh.camera.ilsRun?.phase === "final"`, 20_000);
    await Bun.sleep(12_000);
    await shot("final");
    await app.waitFor(`__bh.camera.ilsRun?.phase === "flare" || __bh.camera.ilsRun?.phase === "rollout"`, 90_000);
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 140, pitch: 6, dist: 40 }); return 1; })()`);
    await Bun.sleep(1200);
    await shot("touchdown");
    await app.waitFor(`!__bh.camera.ilsRun`, 90_000);
    const L = await app.js<{ rwy: string; score: number; touch: { along: number; across: number; vs: number } }>(`__bh.camera.ilsLast`);
    console.log(
      `  ${L.rwy}: ${L.score}/20 — ${L.touch.along.toFixed(0)} m in, ${L.touch.across.toFixed(1)} m off, ${L.touch.vs.toFixed(2)} m/s`,
    );
    expect(L.touch.along).toBeGreaterThan(150);
    expect(L.touch.along).toBeLessThan(900);
    expect(Math.abs(L.touch.across)).toBeLessThan(8);
    await Bun.sleep(1000);
    await shot("stopped");
  }, 240_000);
});
