import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The sea by FFT (docs/PLAN-AVIATION-AAA.md, M1): over the Atlantic west of Brittany, low, the sea in four states —
// a calm with a long swell, a force 5, a storm, the same force 5 against the setting Sun — each its sea imposed
// (renderer.seaOverride: its wind's sea and swell), its wind the weather's; the FFT's texture there, its waves
// drawn. (E2E_SHOTS=<dir>: the views.)

const D = Math.PI / 180;
const AT = { lat: 47.6, lon: -6.2 };

describe.skipIf(!E2E)("the sea by FFT", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** a sea, a weather, a time, a flight: then two views (low behind the jet, higher looking down) */
  const scene = async (name: string, o: { date: string; weather: string; wind: number; sea: unknown; hdg: number; alt: number }) => {
    await app.js(`(() => {
      __bh.game.setDate("${o.date}");
      Object.assign(__bh.settings, { weather: "${o.weather}", wind: ${o.wind}, earthClouds: 1 });
      __bh.renderer.seaOverride = ${JSON.stringify(o.sea)};
      __bh.game.flyAt(${AT.lat}, ${AT.lon}, ${o.alt}, ${o.hdg}, 140);
      __bh.settings.shipMount = "chase";
      return 1; })()`);
    await Bun.sleep(1200);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(3000);
    // (held still: the image converged — the waves under a jet at 140 m/s smear otherwise)
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(2500);
    await shot(`sea-${name}`);
    await app.js(`(() => { __bh.freeze(false); __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 160, pitch: 4, dist: 40 }); __bh.freeze(true); return 1; })()`);
    await Bun.sleep(3000);
    await shot(`sea-${name}-low`);
    await app.js(`(__bh.freeze(false), 1)`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first, a landscape of the Earth as ever: over the Alps by day", async () => {
    await app.js(`(() => {
      __bh.game.setDate("2026-07-10T11:00:00Z");
      Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150);
      __bh.settings.shipMount = "chase";
      return 1; })()`);
    await Bun.sleep(1200);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    // (a few seconds: the relief's tiles in — the Alps seen as ever before the sea is judged)
    await Bun.sleep(6000);
    await app.js(`(__bh.freeze(true), 1)`);
    await shot("land-alps");
    await app.js(`(__bh.freeze(false), 1)`);
  }, 180_000);

  test("the FFT's texture on this device; a calm with a long swell", async () => {
    const has = await app.js<boolean>(`!!__bh.renderer.seaFft`);
    console.log(`  the sea's FFT texture: ${has ? "yes" : "no — the trains"}`);
    expect(has).toBe(true);
    await scene("calm", {
      date: "2026-07-10T11:00:00Z",
      weather: "fair",
      wind: 0,
      sea: { wind: { hs: 0.15, tp: 2.2, to: 80 * D }, swell: { hs: 0.6, tp: 12, to: 60 * D }, source: "marine" },
      hdg: 260,
      alt: 60,
    });
    const st = await app.js<{ hs: number; source: string }>(`({ hs: __bh.renderer.seaHs, source: __bh.renderer.seaState?.source })`);
    console.log(`  calm: Hs ${st.hs.toFixed(2)} m (${st.source})`);
    expect(st.hs).toBeGreaterThan(0.5);
  }, 120_000);

  test("a force 5", async () => {
    await scene("force5", {
      date: "2026-07-10T11:00:00Z",
      weather: "fair",
      wind: 3,
      sea: { wind: { hs: 2.0, tp: 6.5, to: 70 * D }, swell: { hs: 1.0, tp: 11, to: 40 * D }, source: "marine" },
      hdg: 260,
      alt: 60,
    });
  }, 120_000);

  test("a storm", async () => {
    await scene("storm", {
      date: "2026-07-10T11:00:00Z",
      weather: "storm",
      wind: 3,
      sea: { wind: { hs: 7, tp: 11, to: 70 * D }, swell: { hs: 3, tp: 14, to: 40 * D }, source: "marine" },
      hdg: 260,
      alt: 80,
    });
  }, 120_000);

  test("a force 5 against the setting Sun", async () => {
    await scene("backlit", {
      date: "2026-07-10T19:40:00Z",
      weather: "fair",
      wind: 3,
      sea: { wind: { hs: 2.0, tp: 6.5, to: 70 * D }, swell: { hs: 1.0, tp: 11, to: 40 * D }, source: "marine" },
      hdg: 300,
      alt: 60,
    });
  }, 120_000);
});
