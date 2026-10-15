import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The mission map (docs/PLAN-AVIATION-AAA.md, P2): first the Alps as ever; then the Corsica strike's map — the SAM's
// reach, its truck, the Ford —, the SAM clicked (a real click) and flown to (put in the plan, NAV on), the plan's
// point dragged south by the mouse; then near the coast, from the cockpit: the TSD with the SAM's reach and the
// targets, and the objective's cue in the view. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the mission map", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** A place's point on the screen through the mission map [CSS px]. */
  const onMap = (lat: string, lon: string) =>
    app.js<{ x: number; y: number }>(`(() => { const mv = __bh.flight.missions.map.map; const [x, y] = mv.toScreen(${lat}, ${lon});
      const r = mv.canvas.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; })()`);
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
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the Corsica strike's map: the SAM clicked and flown to, the plan's point dragged", async () => {
    await app.js(
      `(() => { __bh.flight.missions.fly("corsica-strike"); __bh.camera.nav.route.wps.length = 0; __bh.camera.routeChanged(); return 1; })()`,
    );
    await app.waitFor(`__bh.camera.carrierNow().length > 0 && __bh.camera.missionMarks().some((m) => m.kind === "threat")`, 20_000);
    await app.js(`(() => { __bh.flight.missions.map.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="mission-map"]')`, 5000);
    await Bun.sleep(1500);
    // (the view on the coast: the Ford west, the targets east)
    await app.js(`(() => { __bh.flight.missions.map.map.flyTo(42.55, 8.2, 8.2, 0.3); return 1; })()`);
    await Bun.sleep(5000);
    await shot("map");
    // the SAM clicked — a real click — and flown to
    const sam = await onMap(
      `__bh.camera.missionMarks().find((m) => m.unit === "sam" && m.kind === "hostile").lat`,
      `__bh.camera.missionMarks().find((m) => m.unit === "sam" && m.kind === "hostile").lon`,
    );
    await app.mouse("move", sam.x, sam.y);
    await app.mouse("down", sam.x, sam.y);
    await app.mouse("up", sam.x, sam.y);
    await app.waitFor(`document.querySelector(".mm-sel")?.textContent.includes("SA-6")`, 3000);
    await app.click(`[data-testid="mm-flyto"]`);
    const nav = await app.js<{ wps: string[]; on: boolean; active: number }>(
      `(() => { const N = __bh.camera.nav; return { wps: N.route.wps.map((w) => w.name), on: N.on.l, active: N.lnav?.active ?? -1 }; })()`,
    );
    console.log(`  fly to: ${nav.wps.join(" → ")}, LNAV ${nav.on ? "on" : "off"}, to ${nav.active}`);
    expect(nav.wps).toEqual(["PPOS", "SA-6"]);
    expect(nav.on).toBe(true);
    expect(nav.active).toBe(1);
    await Bun.sleep(800);
    await shot("map-flyto");
    // its point dragged 80 px south by the mouse
    const lat0 = await app.js<number>(`__bh.camera.nav.route.wps[1].lat`);
    const p = await onMap(`__bh.camera.nav.route.wps[1].lat`, `__bh.camera.nav.route.wps[1].lon`);
    await app.mouse("move", p.x, p.y);
    await app.mouse("down", p.x, p.y);
    for (let k = 1; k <= 8; k++) await app.mouse("move", p.x, p.y + k * 10);
    await app.mouse("up", p.x, p.y + 80);
    const lat1 = await app.js<number>(`__bh.camera.nav.route.wps[1].lat`);
    console.log(`  dragged: ${lat0.toFixed(4)}° → ${lat1.toFixed(4)}°`);
    expect(lat1).toBeLessThan(lat0 - 0.01);
    await Bun.sleep(500);
    await shot("map-drag");
    await app.press("Escape");
    await app.waitFor(`!document.querySelector('[data-testid="mission-map"]')`, 3000);
  }, 120_000);

  test("near the coast: the TSD with the SAM's reach, the objective's cue in the view", async () => {
    // (35 km west of the SAM, heading for it)
    await app.js(`(() => { __bh.game.flyAt(42.5, 8.42, 2500, 90, 230); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    // (the head down on the displays: the TSD)
    await app.js(`(__bh.camera.setLook(-12, -32), true)`);
    await Bun.sleep(1200);
    await shot("tsd");
    await app.js(`(__bh.camera.setLook(0, 0), true)`);
    const cue = await app.js<{ name: string; brg: number; dist: number } | null>(`__bh.camera.flightInfo().msn`);
    console.log(`  the cue: ${cue?.name}, ${cue?.brg.toFixed(0)}°, ${((cue?.dist ?? 0) / 1000).toFixed(1)} km`);
    expect(cue?.name).toBe("Destroy the SA-6 battery");
    expect(Math.abs((cue?.brg ?? 0) - 90)).toBeLessThan(10);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await shot("hud-cue");
    await app.js(`(() => { __bh.flight.missions.abort(); return 1; })()`);
  }, 60_000);
});
