import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Settings › Offline (docs/ANALYSE-IGN-LIDAR.md §9.5, I8b; ui/settings/offline.ts), by the mouse and by a game controller
// (a pad of the page's own, as tests/e2e/pad.e2e.test.ts). Over Chamonix, the F-35 held 450 m over the valley: the pause,
// its World drawer, « Garder cette zone hors ligne » (the mouse) — the adding of a zone on the position now —; its radius
// brought down to 1 km (the D-pad), downloaded (the mouse); the tab's row of the zone and its progress; its sheet (the
// mouse), paused and resumed (A), ready; the automatic cache's budget changed and back (◀ ▶); the zone deleted, asked
// twice (A, A); the tab in English. (E2E_SHOTS=<dir>: offline-add, offline-tab, offline-zone, offline-tab-en.)
// Duration: ~3 min on kerr-mini (the zone's download ~1 of them).
// Done when: every screen reached by both, the zone downloaded, paused, resumed, ready, then gone with its tiles; the
// budget the worker's.

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "e2e pad (STANDARD GAMEPAD)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;
const A = 0,
  B = 1,
  UP = 12,
  DOWN = 13,
  LEFT = 14,
  RIGHT = 15;
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: false, earthIgnSilhouettes: false, f35AutoProtect: false }`;

describe.skipIf(!E2E)("Settings › Offline", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  /** a button pressed for a few frames, then released — held 600 ms: the settings over a scene still streaming its
   *  tiles drew some frames slower than pad.e2e's 250 ms on kerr-mini, a press missed; a button never repeats (ui/padnav.ts:
   *  its press's edge) */
  const press = async (n: number, times = 1) => {
    for (let k = 0; k < times; k++) {
      await app.js(`(window.__pad.buttons[${n}].pressed = true, 1)`);
      await Bun.sleep(600);
      await app.js(`(window.__pad.buttons[${n}].pressed = false, 1)`);
      await Bun.sleep(150);
    }
  };
  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const text = (testid: string) => app.js<string>(`document.querySelector('[data-testid="${testid}"]')?.textContent ?? ""`);
  const zones = () =>
    app.js<{ id: string; state: string; cursor: number; total: number; bytes: number; failed: number }[]>(`__bh.pwa.zones.list()`);
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.sleep(500);
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
    // (held over the valley at once: the position now is a zone's place)
    await app.js(`(() => { __bh.game.flyAt(45.912, 6.858, 450, 45, 120); __bh.freeze(true); return 1; })()`);
    await app.settled();
  }, 300_000);
  afterAll(async () => {
    // (nothing left behind: a zone still there dropped)
    for (const z of (await zones().catch(() => [])) ?? []) await app.js(`__bh.pwa.zones.remove(${JSON.stringify(z.id)})`).catch(() => {});
    app?.close();
    stopServer();
  });

  test("from the pause (the mouse): a zone on the position now, its radius by the D-pad, downloaded", async () => {
    await app.js(`(__bh.menu.pause(), 1)`);
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    await app.click("[data-testid=pause-group-world]");
    await app.click("[data-testid=pause-offline]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:add"`, 10_000);
    expect(await text("offline-add-place")).toContain("position actuelle");
    expect(await text("offline-add-profile")).toContain("Vol bas");
    await Bun.sleep(600);
    expect(await focused()).toBe("offline-add-place");
    // (the D-pad: ▼ ▼ ▼ to the radius — past « Choisir sur la carte » and the profile, ◀ until 1 km — 10, 5, 3, 2, 1 —, a step a press: a press the pad's poll missed
    // pressed again, never two steps at once)
    await press(DOWN, 3);
    expect(await focused()).toBe("offline-add-radius");
    const radii = [10, 5, 3, 2, 1];
    const km = async () => Number((await text("offline-add-radius")).match(/(\d+) km/)?.[1]);
    for (let k = 0; k < 10 && (await km()) > 1; k++) {
      const before = radii.indexOf(await km());
      await press(LEFT);
      expect(radii.indexOf(await km()) - before).toBeLessThanOrEqual(1);
    }
    expect(await km()).toBe(1);
    const est = await text("offline-add-estimate");
    console.log(`  the adding: ${await text("offline-add-place")} · ${await text("offline-add-profile")} · ${est}`);
    expect(est).toMatch(/\d[\d\s  ]* tuiles · \d+ Mo · ≈ /);
    await shot("offline-add");
    await app.click("[data-testid=offline-download]");
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "settings"`, 10_000);
    await app.waitFor(`!!document.querySelector('[data-testid^="offline-zone-zone-"]')`, 10_000);
    const z = (await zones())[0]!;
    expect(z.state).toBe("downloading");
    await app.waitFor(`(async () => ((await __bh.pwa.zones.list())[0]?.cursor ?? 0) > 0)()`, 60_000);
    await Bun.sleep(1600);
    const row = await text(`offline-zone-${z.id}`);
    console.log(`  its row: ${row}`);
    expect(row).toMatch(/téléchargement|en attente/);
    await shot("offline-tab");
  }, 180_000);

  test("its sheet (the mouse): paused and resumed by A, ready", async () => {
    const z = (await zones())[0]!;
    await app.click(`[data-testid="offline-zone-${z.id}"]`);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:zone"`, 10_000);
    await Bun.sleep(600);
    expect(await focused()).toBe("offline-zone-pause");
    await press(A);
    await app.waitFor(`!!document.querySelector('[data-testid="offline-zone-resume"]')`, 30_000);
    const p0 = (await zones())[0]!;
    expect(p0.state).toBe("paused");
    await Bun.sleep(3000);
    expect((await zones())[0]!.cursor).toBe(p0.cursor);
    console.log(`  paused at ${p0.cursor} / ${p0.total}`);
    await shot("offline-zone");
    await Bun.sleep(600);
    expect(await focused()).toBe("offline-zone-resume");
    await press(A);
    await app.waitFor(`(async () => (await __bh.pwa.zones.list())[0]?.state === "ready")()`, 240_000);
    const r = (await zones())[0]!;
    console.log(`  ready: ${r.cursor} / ${r.total} chains, ${(r.bytes / 1e6).toFixed(0)} MB, ${r.failed} failed`);
    expect(r.failed).toBe(0);
    await app.waitFor(`!!document.querySelector('[data-testid="offline-zone-update"]')`, 10_000);
    expect(await text("offline-zone")).toContain("Téléchargée le");
  }, 300_000);

  test("the automatic cache's budget by ◀ ▶ (the worker keeps it); the zone deleted, asked twice (A, A)", async () => {
    // (B: back to the tab, its zone's row focused; ▲ to the cache's)
    await press(B);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "settings"`, 10_000);
    await Bun.sleep(600);
    const z = (await zones())[0]!;
    expect(await focused()).toBe(`offline-zone-${z.id}`);
    await press(UP, 2);
    expect(await focused()).toBe("offline-cache");
    const b0 = await app.js<number>(`__bh.pwa.stats().then((s) => s.tileBudget)`);
    await press(RIGHT);
    await app.waitFor(`__bh.pwa.stats().then((s) => s.tileBudget > ${b0})`, 10_000);
    expect(await text("offline-cache")).toContain("1,0 Go");
    await press(LEFT);
    await app.waitFor(`__bh.pwa.stats().then((s) => s.tileBudget === ${b0})`, 10_000);
    // (the zone's sheet: ▼ ▼ back to its row, A; ▼ ▼ past « Mettre à jour » and « Voir sur la carte » to « Supprimer »)
    await press(DOWN, 2);
    expect(await focused()).toBe(`offline-zone-${z.id}`);
    await press(A);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "offline:zone"`, 10_000);
    await Bun.sleep(600);
    await press(DOWN, 2);
    expect(await focused()).toBe("offline-zone-delete");
    await press(A);
    await app.waitFor(`!!document.querySelector('[data-testid="offline-zone-delete-sure"]')`, 5000);
    await Bun.sleep(400);
    expect(await focused()).toBe("offline-zone-delete-sure");
    await press(A);
    await app.waitFor(`(async () => (await __bh.pwa.zones.list()).length === 0)()`, 30_000);
    await app.waitFor(`document.querySelector(".pls-root [data-screen]")?.dataset.screen === "settings"`, 10_000);
    expect(await app.js<number>(`__bh.pwa.stats().then((s) => s.zoneTiles)`)).toBe(0);
  }, 120_000);

  test("in English: the tab, its rows", async () => {
    await app.click("[data-testid=settings-tab-interface]");
    await app.waitFor(`__bh.menu.state().settings === "interface"`, 5000);
    // (the language's row: → to English — the menus drawn again in it)
    await app.js(`(document.querySelector('[data-testid="setting-language"]')?.focus(), 1)`);
    await press(RIGHT);
    await app.waitFor(
      `document.querySelector('[data-testid="settings-tab-offline"]')?.textContent.trim().toLowerCase() === "offline"`,
      5000,
    );
    await app.click("[data-testid=settings-tab-offline]");
    await app.waitFor(`!!document.querySelector('[data-testid="offline-cache"]')`, 5000);
    expect(await text("offline-cache")).toContain("Tiles seen in flight");
    expect(await text("offline-add")).toContain("Add a zone");
    await shot("offline-tab-en");
    if (app.cdp.errors.length) console.log(app.cdp.errors.join("\n"));
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
