import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// On foot and the free camera on the title (PLAN-TITRE-AAA E6), by real events: the worlds by Q / E (the weather
// only on the Earth), the place pinned on the planisphere, the hour by → on its row; a place found by a search
// ("eiffel": the Atlas's destination); a walk launched — the astronaut on the Moon at noon of its own day (the Sun
// high: the probe's cosine), then at night (the Sun below); the free camera's gallery — its tabs by Q / E, a scene
// launched, the free camera in it.
// SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("on foot and the free camera, on the title", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const world = () => app.js<string>(`document.querySelector(".tt-root [data-mode=foot]")?.dataset.world ?? ""`);
  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(400);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  /** the title open (from the game: the pause's Title), then a mode's screen */
  const toMode = async (mode: "foot" | "free", fromGame = false) => {
    if (fromGame) {
      await app.press("Escape");
      await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
      await settle();
      await app.click("[data-testid=pause-title]");
    }
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-${mode}]")`, 10_000);
    await settle();
    await app.click(`[data-testid=title-mode-${mode}]`);
    await app.waitFor(`!!document.querySelector(".tt-root [data-mode=${mode}]")`, 5000);
    await settle();
  };
  const toWorld = async (id: string) => {
    await app.click(`[data-testid=title-world-${id}]`);
    await app.waitFor(`document.querySelector(".tt-root [data-mode=foot]")?.dataset.world === "${id}"`, 3000);
    await settle();
  };
  const value = (testid: string) => app.js<string>(`document.querySelector("[data-testid=${testid}] b")?.textContent ?? ""`);
  /** the hour's row set to a value by → */
  const setHour = async (label: string) => {
    await app.js(`(document.querySelector("[data-testid=title-foot-hour]").focus(), true)`);
    for (let k = 0; k < 6 && (await value("title-foot-hour")) !== label; k++) await app.press("ArrowRight");
    expect(await value("title-foot-hour")).toBe(label);
  };

  test("the worlds by Q / E; the place pinned on the planisphere; the hour by →", async () => {
    await toMode("foot");
    expect(await world()).toBe("moon");
    expect(await focused()).toBe("title-foot-go");
    expect(await value("title-foot-place")).toMatch(/Apollo 11/);
    // (Tranquility: 0.67° N 23.47° E — just right of the map's middle)
    const pin = await app.js<{ x: number; y: number }>(
      `(() => { const f = document.querySelector("[data-testid=title-foot-map]").getBoundingClientRect(), p = document.querySelector(".tt-map-pin").getBoundingClientRect(); return { x: (p.x + p.width / 2 - f.x) / f.width, y: (p.y + p.height / 2 - f.y) / f.height }; })()`,
    );
    expect(pin.x).toBeCloseTo(0.565, 2);
    expect(pin.y).toBeCloseTo(0.496, 2);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=title-foot-weather]")`)).toBe(false);
    await setHour("Noon");
    await shot("E6-1-a-pied-lune");
    await app.press("KeyE", "e");
    await settle();
    expect(await world()).toBe("mars");
    await shot("E6-2-a-pied-mars");
    await app.press("KeyE", "e");
    await settle();
    expect(await world()).toBe("earth");
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=title-foot-weather]")`)).toBe(true);
    // (kept for the next visit)
    expect(await app.js<string>(`JSON.parse(localStorage.getItem("kerr.title.foot")).world`)).toBe("earth");
  });

  test("a place found by a search: the Eiffel Tower", async () => {
    await app.click("[data-testid=title-foot-place]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-place-search]")`, 5000);
    await settle();
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=title-place-search]"); i.value = "eiffel"; i.dispatchEvent(new Event("input")); return true; })()`,
    );
    await app.waitFor(`!!document.querySelector("[data-testid=title-place-eiffel]")`, 3000);
    // (the addresses: the service's, when it answers — said, not required)
    await Bun.sleep(2500);
    console.log(`  addresses: ${await app.js<number>(`document.querySelectorAll("[data-testid^=title-place-address-]").length`)}`);
    await shot("E6-3-lieu");
    await app.click("[data-testid=title-place-eiffel]");
    await app.waitFor(`document.querySelector(".tt-root [data-mode=foot]")?.dataset.world === "earth"`, 5000);
    await settle();
    expect(await value("title-foot-place")).toMatch(/Eiffel/);
    await shot("E6-4-a-pied-terre");
  });

  test("a walk on the Moon at noon of its own day: the Sun high", async () => {
    await toWorld("moon");
    expect(await value("title-foot-hour")).toBe("Noon");
    await app.click("[data-testid=title-foot-go]");
    await app.waitFor(`__bh.mode.get() === "foot" && __bh.camera.character.place()?.body === "moon"`, 60_000);
    await Bun.sleep(4000);
    const L = await app.js<{ cosine: number } | null>(`__bh.renderer.characterLight()`);
    console.log(`  noon: the Sun's cosine ${L?.cosine.toFixed(3)} · ${await app.js<string>(`__bh.game.date()`)}`);
    expect(L!.cosine).toBeGreaterThan(0.9);
    await shot("E6-5-lune-midi");
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("then at night: the Sun below the horizon", async () => {
    await toMode("foot", true);
    await setHour("Night");
    await app.click("[data-testid=title-foot-go]");
    await app.waitFor(`__bh.mode.get() === "foot" && __bh.camera.character.place()?.body === "moon"`, 60_000);
    await Bun.sleep(4000);
    const L = await app.js<{ cosine: number } | null>(`__bh.renderer.characterLight()`);
    console.log(`  night: the Sun's cosine ${L?.cosine.toFixed(3)} · ${await app.js<string>(`__bh.game.date()`)}`);
    // (the probe's cosine is held at 0 once the Sun is down)
    expect(L!.cosine).toBeLessThan(0.02);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("the free camera: the gallery by Q / E, a scene launched, the free camera in it", async () => {
    await toMode("free", true);
    expect(await app.js<string>(`document.querySelector(".tt-root [data-mode=free]").dataset.tab`)).toBe("gargantua");
    expect(await focused()).toMatch(/^title-free-/);
    await shot("E6-6-galerie-gargantua");
    await app.press("KeyQ", "q");
    await settle();
    expect(await app.js<string>(`document.querySelector(".tt-root [data-mode=free]").dataset.tab`)).toBe("hole");
    await shot("E6-7-galerie-trous-noirs");
    await app.press("KeyE", "e");
    await app.press("KeyE", "e");
    await settle();
    expect(await app.js<string>(`document.querySelector(".tt-root [data-mode=free]").dataset.tab`)).toBe("wormhole");
    const first = await app.js<string>(`document.querySelector(".tt-root .tt-scene")?.dataset.testid ?? ""`);
    const name = await app.js<string>(`document.querySelector(".tt-root .tt-scene")?.dataset.focusId ?? ""`);
    await app.click(`[data-testid=${first}]`);
    await app.waitFor(`!document.querySelector("[data-testid=title]") && __bh.mode.get() === "free"`, 30_000);
    await Bun.sleep(3000);
    console.log(`  ${name} · ${await app.js<string>("__bh.mode.get()")}`);
    await shot("E6-8-camera-libre");
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
