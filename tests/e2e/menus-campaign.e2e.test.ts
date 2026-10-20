import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The menus' campaign (PLAN-TITRE-AAA E11), one player's path by real CDP events from the first visit on: the intro
// passed by a key; while the graphics are held back (#slowboot), By plane › Free flight › Fly — the F-35B in its
// cockpit on the runway once the game is there; By ship › Lander › landed on the Moon; On foot › Earth › a place
// found by its name (Monument Valley); Free camera › Gargantua; Continue; the pause by the keyboard and by a pad of the page's own; a
// setting changed and found again after a reload; a phone's screen with reduced motion. SHOTS=1: each moment
// captured in docs/progress/title-aaa (FINAL-*).

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "e2e pad (STANDARD GAMEPAD)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the menus' campaign", () => {
  let app: App;
  beforeAll(async () => {
    // (the intro whole, as on a first visit: the campaign passes it by a key)
    app = await App.boot({ width: 1440, height: 900, fullIntro: true });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(300);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 84 });
    await Bun.write(`${SHOTS}/FINAL-${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  const menu = () => app.js<{ title: string | null; pause: string | null; settings: string | null; entry: boolean }>("__bh.menu.state()");
  const entered = () => app.waitFor(`!__bh.menu.state().entry && !document.querySelector("[data-testid=title]")`, 120_000);
  /** the pause by Escape, then one of its entries — a drawer's after its group */
  const fromPause = async (group: string | null, item: string) => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-resume]")`, 10_000);
    if (group) await app.click(`[data-testid=pause-group-${group}]`);
    await app.click(`[data-testid=pause-${item}]`);
    await settle();
  };
  const where = () => app.js<string>(`__bh.game.snapshot("x").summary`);

  test("the intro passed by a key; while the graphics are held back, By plane › Free flight › Fly — the F-35B in its cockpit on the runway", async () => {
    // (a first visit: the intro played whole, the game's graphics held 12 s)
    const origin = await app.js<number>("performance.timeOrigin");
    await app.js(`(localStorage.removeItem("kerr.intro.seen"), localStorage.removeItem("kerr.title.flight"), true)`);
    await app.cdp.send("Page.navigate", { url: `${app.url}?e2e=${Math.random()}#slowboot=12` });
    await app.waitFor(`performance.timeOrigin !== ${origin} && document.body.classList.contains("intro-play")`, 30_000);
    await Bun.sleep(1200);
    await shot("1-intro");
    await app.press("Space", " ");
    await app.waitFor(`!document.body.classList.contains("intro-play")`, 4000);
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-plane]")`, 10_000);
    expect(await app.js<boolean>(`typeof __bh === "undefined"`)).toBe(true);
    await settle();
    await app.click("[data-testid=title-mode-plane]");
    await app.waitFor(`!!document.querySelector(".tt-root [data-mode=plane]")`, 5000);
    await settle();
    await app.click("[data-testid=title-tab-free]");
    await settle();
    // (the morning of the field's own day, by → on its row: the game's clock is dawn at Edwards)
    await app.js(`(document.querySelector("[data-testid=title-flight-hour]").focus(), true)`);
    await app.press("ArrowRight");
    await app.press("ArrowRight");
    expect(await app.js<string>(`document.querySelector("[data-testid=title-flight-hour] b").textContent`)).toBe("Morning");
    await shot("2-avion-pendant-chargement");
    await app.click("[data-testid=title-flight-fly]");
    // (kept until the game is there, said by the intro)
    await app.waitFor(`typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0`, 120_000);
    await app.waitFor(
      `__bh.settings.vessel === "f35" && __bh.camera.piloting && __bh.game.snapshot("x").ship.landed?.body === "earth"`,
      60_000,
    );
    await app.waitFor(`!document.querySelector("#loading")`, 30_000);
    await Bun.sleep(2500);
    console.log(`  F-35B: ${await where()} · mount ${await app.js<string>("__bh.settings.shipMount")}`);
    expect(await app.js<string>("__bh.settings.shipMount")).toBe("cockpit");
    await shot("3-cockpit-piste");
  }, 300_000);

  test("By ship › Lander › landed on the Moon", async () => {
    await fromPause(null, "title");
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-ship]")`, 10_000);
    await settle();
    await app.click("[data-testid=title-mode-ship]");
    await app.waitFor(`!!document.querySelector(".tt-root [data-mode=ship]")`, 5000);
    await settle();
    await app.click("[data-testid=title-vessel-lander]");
    await app.waitFor(`document.querySelector(".tt-root [data-mode=ship]")?.dataset.vessel === "lander"`, 5000);
    await settle();
    await app.click("[data-testid=title-ship-dest-moon-ground]");
    await entered();
    await app.waitFor(`__bh.settings.vessel === "lander" && __bh.game.snapshot("x").ship.landed?.body === "moon"`, 60_000);
    await Bun.sleep(2500);
    console.log(`  Lander: ${await where()}`);
    await shot("4-lander-lune");
  }, 180_000);

  test("On foot › Earth › Monument Valley, found by its name", async () => {
    await fromPause("modes", "mode-foot");
    await app.waitFor(`!!document.querySelector(".tt-root [data-mode=foot]")`, 5000);
    await settle();
    await app.click("[data-testid=title-world-earth]");
    await app.waitFor(`document.querySelector(".tt-root [data-mode=foot]")?.dataset.world === "earth"`, 5000);
    await settle();
    await app.click("[data-testid=title-foot-place]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-place-search]")`, 5000);
    await settle();
    await app.click("[data-testid=title-place-search]");
    await app.type("monument");
    await app.waitFor(`!!document.querySelector("[data-testid=title-place-monument-valley]")`, 5000);
    await app.click("[data-testid=title-place-monument-valley]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-foot-go]")`, 5000);
    await settle();
    await app.click("[data-testid=title-foot-go]");
    await entered();
    await app.waitFor(`__bh.mode.get() === "foot" && __bh.camera.character.place()?.body === "earth"`, 60_000).catch(async (e) => {
      console.log(
        `  the game said: ${await app.js<string>(`[...document.querySelectorAll(".sp-toast")].map((t) => t.textContent).join(" | ")`)}`,
      );
      throw e;
    });
    const p = await app.js<{ lat: number; lon: number }>("__bh.camera.character.place()");
    console.log(`  on foot: ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`);
    expect(p.lat).toBeCloseTo(36.998, 1);
    expect(p.lon).toBeCloseTo(-110.098, 1);
    await Bun.sleep(3000);
    await shot("5-a-pied-monument-valley");
  }, 180_000);

  test("Free camera › Gargantua", async () => {
    await fromPause("modes", "mode-free");
    await app.waitFor(`document.querySelector(".tt-root [data-mode=free]")?.dataset.tab === "gargantua"`, 5000);
    await settle();
    const first = await app.js<string>(`document.querySelector(".tt-root .tt-scene")?.dataset.testid ?? ""`);
    await app.click(`[data-testid=${first}]`);
    await entered();
    await app.waitFor(`__bh.mode.get() === "free"`, 30_000);
    await Bun.sleep(3000);
    await shot("6-camera-libre-gargantua");
  }, 180_000);

  test("Continue: the title, then the game left behind it", async () => {
    await fromPause(null, "title");
    await app.waitFor(`!!document.querySelector("[data-testid=title-continue]")`, 10_000);
    await settle();
    await shot("7-titre-continuer");
    await app.click("[data-testid=title-continue]");
    await app.waitFor(`!document.querySelector("[data-testid=title]")`, 5000);
    expect(await app.js<string>("__bh.mode.get()")).toBe("free");
  });

  test("the pause by the keyboard, then by a pad of the page's own (Start opens it, B resumes)", async () => {
    await app.press("Escape");
    await app.waitFor(`__bh.menu.state().pause === "pause"`, 5000);
    await settle();
    await app.press("Escape");
    await app.waitFor(`__bh.menu.state().pause === null`, 5000);
    await app.js(FAKE_PAD);
    const press = async (n: number) => {
      await app.js(`(window.__pad.buttons[${n}].pressed = true, 1)`);
      await Bun.sleep(250);
      await app.js(`(window.__pad.buttons[${n}].pressed = false, 1)`);
      await Bun.sleep(150);
    };
    await press(9);
    await app.waitFor(`__bh.menu.state().pause === "pause"`, 5000);
    await Bun.sleep(600);
    await press(1);
    await app.waitFor(`__bh.menu.state().pause === null`, 5000);
    expect((await menu()).pause).toBeNull();
  });

  test("a setting changed in the player's settings, found again after a reload", async () => {
    await app.click("[data-testid=topbar-settings]");
    await app.waitFor(`__bh.menu.state().settings === "game"`, 5000);
    await settle();
    await app.js(`(document.querySelector("[data-testid=setting-walkSpeed]").focus(), true)`);
    await app.press("ArrowRight");
    await app.press("ArrowRight");
    const w = await app.js<number>("__bh.settings.walkSpeed");
    expect(w).toBeGreaterThan(1.4);
    await shot("8-reglages");
    await app.press("Escape");
    await Bun.sleep(1500);
    const origin = await app.js<number>("performance.timeOrigin");
    await app.cdp.send("Page.reload", {});
    await app.waitFor(`performance.timeOrigin !== ${origin} && typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0`, 120_000);
    expect(await app.js<number>("__bh.settings.walkSpeed")).toBe(w);
    // (as it was — from the title, the page's start: its Settings)
    await app.waitFor(
      `!!document.querySelector("[data-testid=title-settings]") && !document.body.classList.contains("intro-play")`,
      30_000,
    );
    await settle();
    await app.click("[data-testid=title-settings]");
    await app.waitFor(`__bh.menu.state().settings === "game"`, 5000);
    await settle();
    await app.js(`(document.querySelector("[data-testid=setting-walkSpeed]").focus(), true)`);
    await app.press("ArrowLeft");
    await app.press("ArrowLeft");
    expect(await app.js<number>("__bh.settings.walkSpeed")).toBe(1.4);
    await app.press("Escape");
  }, 180_000);

  test("a phone's screen, reduced motion: the title within the width, a launch at once", async () => {
    await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await app.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const origin = await app.js<number>("performance.timeOrigin");
    await app.cdp.send("Page.navigate", { url: `${app.url}?e2e=${Math.random()}` });
    await app.waitFor(`performance.timeOrigin !== ${origin} && !!document.querySelector("[data-testid=title-mode-ship]")`, 60_000);
    await app.waitFor(`typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0`, 120_000);
    await app.waitFor(`!document.body.classList.contains("intro-play")`, 10_000);
    await settle();
    expect(await app.js<boolean>(`matchMedia("(prefers-reduced-motion: reduce)").matches`)).toBe(true);
    expect(await app.js<boolean>(`document.documentElement.scrollWidth <= innerWidth + 1`)).toBe(true);
    await shot("9-telephone");
    await app.click("[data-testid=title-mode-ship]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-ship-dest-earth-orbit]")`, 5000);
    await settle();
    expect(await app.js<boolean>(`document.documentElement.scrollWidth <= innerWidth + 1`)).toBe(true);
    await shot("10-telephone-vaisseau");
    const t0 = Date.now();
    await app.click("[data-testid=title-ship-dest-earth-orbit]");
    await entered();
    const ms = Date.now() - t0;
    console.log(`  reduced motion: in the game ${ms} ms after the click`);
    expect(ms).toBeLessThan(3000);
    await app.cdp.send("Emulation.clearDeviceMetricsOverride", {});
    await app.cdp.send("Emulation.setEmulatedMedia", { features: [] });
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);
});
