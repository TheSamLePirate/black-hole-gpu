import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A zone's place on a map (Settings › Offline, ui/settings/offline.ts — I8b): the zone's circle at its radius over the
// zones kept, the mouse and the controller (a pad of the page's own, as tests/e2e/pad.e2e.test.ts). Over Chamonix, the F-35
// held over the valley: the adding of a zone, « Choisir sur la carte »; the mouse — a click sets it down, its circle
// dragged, the wheel zooms —, « Poser la zone ici »; the pad — ▶ ▶ ▲ move it, LB zooms, A sets it down; the zone added and
// paused at once, its sheet's « Voir sur la carte » (the zones drawn, its own centred); the Atlas from the pause, the zone
// drawn there too. (E2E_SHOTS=<dir>: offline-map-pick, offline-map-zones, atlas-zones.)
// Duration: ~2 min on kerr-mini.
// Done when: the place followed the mouse's click and drag and the pad's arrows (each the way pressed), the zoom the
// wheel's and LB's, the adding's place the one set down, the zone drawn on both maps.

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "e2e pad (STANDARD GAMEPAD)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;
const A = 0,
  LB = 4,
  UP = 12,
  DOWN = 13,
  RIGHT = 15;
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: false, earthIgnSilhouettes: false, f35AutoProtect: false }`;

describe.skipIf(!E2E)("a zone's place on a map", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  /** held 600 ms: a button acts on its press's edge (ui/padnav.ts), a slow frame on the mini missed a shorter one */
  const press = async (n: number, times = 1) => {
    for (let k = 0; k < times; k++) {
      await app.js(`(window.__pad.buttons[${n}].pressed = true, 1)`);
      await Bun.sleep(600);
      await app.js(`(window.__pad.buttons[${n}].pressed = false, 1)`);
      await Bun.sleep(200);
    }
  };
  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const screen = () => app.js<string | null>(`document.querySelector(".pls-root [data-screen]")?.dataset.screen ?? null`);
  const text = (testid: string) => app.js<string>(`document.querySelector('[data-testid="${testid}"]')?.textContent ?? ""`);
  /** the map's place and zoom, and where its centre falls on the page [CSS px] */
  const view = () =>
    app.js<{ lat: number; lon: number; zoom: number; x: number; y: number; zones: number }>(`(() => {
      const b = document.querySelector('[data-testid="offline-map-canvas"]'); const m = b.map; const r = m.canvas.getBoundingClientRect();
      const lat = +b.dataset.lat, lon = +b.dataset.lon; const [x, y] = m.toScreen(lat, lon);
      return { lat, lon, zoom: m.zoom, x: r.left + x, y: r.top + y, zones: +b.dataset.zones }; })()`);
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.sleep(1500);
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", sw: true, tiles: true, lang: "fr" });
    await app.js(FAKE_PAD);
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.912, 6.858, 450, 45, 120); __bh.freeze(true); return 1; })()`);
    await app.settled();
  }, 300_000);
  afterAll(async () => {
    for (const z of (await app?.js<{ id: string }[]>(`__bh.pwa.zones.list()`).catch(() => [])) ?? [])
      await app.js(`__bh.pwa.zones.remove(${JSON.stringify(z.id)})`).catch(() => {});
    app?.close();
    stopServer();
  });

  test("the mouse: a click sets the zone down, its circle dragged, the wheel zooms; set down here", async () => {
    await app.js(`(__bh.menu.pause(), 1)`);
    await app.click("[data-testid=pause-group-world]");
    await app.click("[data-testid=pause-offline]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:add"`, 10_000);
    await app.click("[data-testid=offline-add-map]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:map"`, 10_000);
    // (the map flown to the zone's place — the position now —, its tiles in)
    await Bun.sleep(2500);
    const v0 = await view();
    expect(Math.abs(v0.lat - 45.912)).toBeLessThan(0.01);
    // (a click 160 px right of the centre, 80 above: the place there — east and north)
    await app.mouse("move", v0.x + 160, v0.y - 80);
    await app.mouse("down", v0.x + 160, v0.y - 80);
    await app.mouse("up", v0.x + 160, v0.y - 80);
    await Bun.sleep(300);
    const v1 = await view();
    console.log(`  clicked: ${v0.lat.toFixed(4)}, ${v0.lon.toFixed(4)} → ${v1.lat.toFixed(4)}, ${v1.lon.toFixed(4)}`);
    expect(v1.lon).toBeGreaterThan(v0.lon);
    expect(v1.lat).toBeGreaterThan(v0.lat);
    // (its circle dragged 200 px left from its centre: west, the map not panned — its centre where it was)
    const z0 = v1.zoom;
    await app.mouse("move", v1.x, v1.y);
    await app.mouse("down", v1.x, v1.y);
    for (let k = 1; k <= 10; k++) await app.mouse("move", v1.x - 20 * k, v1.y);
    await app.mouse("up", v1.x - 200, v1.y);
    await Bun.sleep(300);
    const v2 = await view();
    expect(v2.lon).toBeLessThan(v1.lon);
    expect(Math.abs(v2.x - (v1.x - 200))).toBeLessThan(6);
    // (the wheel: closer)
    await app.mouse("wheel", v2.x, v2.y, { deltaY: -300 });
    await Bun.sleep(400);
    const v3 = await view();
    expect(v3.zoom).toBeGreaterThan(z0);
    console.log(`  dragged to ${v2.lat.toFixed(4)}, ${v2.lon.toFixed(4)}; zoom ${z0.toFixed(2)} → ${v3.zoom.toFixed(2)}`);
    expect(await text("offline-map-info")).toMatch(/tuiles · \d+ Mo/);
    await shot("offline-map-pick");
    await app.click("[data-testid=offline-map-here]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:add"`, 10_000);
    const place = await text("offline-add-place");
    console.log(`  the adding's place: ${place}`);
    expect(place).toContain(`${v2.lat.toFixed(3)}° N`);
  }, 120_000);

  test("the pad: ▶ ▶ ▲ move the zone, LB zooms, A sets it down", async () => {
    await Bun.sleep(600);
    // (back from the map, the focus where it left: « Choisir sur la carte »; ▲ ▼ through the place's row, A)
    expect(await focused()).toBe("offline-add-map");
    await press(UP);
    expect(await focused()).toBe("offline-add-place");
    await press(DOWN);
    expect(await focused()).toBe("offline-add-map");
    await press(A);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:map"`, 10_000);
    await Bun.sleep(1500);
    expect(await focused()).toBe("offline-map-canvas");
    const p0 = await view();
    await press(RIGHT, 2);
    const p1 = await view();
    expect(p1.lon).toBeGreaterThan(p0.lon);
    expect(Math.abs(p1.lat - p0.lat)).toBeLessThan(1e-3);
    await press(UP);
    const p2 = await view();
    expect(p2.lat).toBeGreaterThan(p1.lat);
    await press(LB);
    await Bun.sleep(300);
    const p3 = await view();
    expect(p3.zoom).toBeGreaterThan(p2.zoom);
    console.log(
      `  the pad: ${p0.lat.toFixed(4)}, ${p0.lon.toFixed(4)} → ${p2.lat.toFixed(4)}, ${p2.lon.toFixed(4)}; zoom ${p2.zoom.toFixed(2)} → ${p3.zoom.toFixed(2)}`,
    );
    await press(A);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:add"`, 10_000);
    expect(await text("offline-add-place")).toContain(`${p2.lat.toFixed(3)}° N`);
  }, 90_000);

  test("the zone kept on both maps: its sheet's « Voir sur la carte », the Atlas", async () => {
    // (added, paused at once: a zone in the list, its download not waited for)
    await app.click("[data-testid=offline-download]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "settings"`, 10_000);
    const id = await app.js<string>(`__bh.pwa.zones.list().then((z) => z[0].id)`);
    await app.js(`__bh.pwa.zones.pause(${JSON.stringify(id)})`);
    await app.waitFor(`document.querySelector('[data-testid="offline-zone-${id}"]')?.textContent.includes("en pause")`, 15_000);
    await app.click(`[data-testid="offline-zone-${id}"]`);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:zone"`, 10_000);
    await app.click("[data-testid=offline-zone-map]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:map"`, 10_000);
    await Bun.sleep(2500);
    const v = await view();
    expect(v.zones).toBe(1);
    expect(await text("offline-map-info")).toContain("Près de");
    await shot("offline-map-zones");
    // (the Atlas, from the pause: the zone drawn on the Earth)
    for (let k = 0; k < 4 && (await screen()); k++) {
      await app.js(
        `(document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })), 1)`,
      );
      await Bun.sleep(500);
    }
    await app.waitFor(`__bh.menu.state().pause === "pause"`, 10_000);
    await app.click("[data-testid=pause-group-world]");
    await app.click("[data-testid=pause-atlas]");
    await app.waitFor(`!!document.querySelector("[data-testid=atlas]")`, 10_000);
    await app.waitFor(`document.querySelector("[data-testid=atlas] .mv-canvas")?.dataset.zones === "1"`, 10_000);
    // (closer, on Chamonix: the zone's circle and its name)
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=atlas-search]"); i.value = "Chamonix"; i.dispatchEvent(new Event("input")); return 1; })()`,
    );
    await Bun.sleep(1500);
    await app.js(
      `(document.querySelector("[data-testid=atlas-search]").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })), 1)`,
    );
    await Bun.sleep(3000);
    await shot("atlas-zones");
    if (app.cdp.errors.length) console.log(app.cdp.errors.join("\n"));
    expect(app.cdp.errors).toEqual([]);
  }, 90_000);
});
