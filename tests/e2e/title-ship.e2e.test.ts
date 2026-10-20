import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// By ship on the title (PLAN-TITRE-AAA E5): the hangar — a tab per craft by Q / E, its sheet, its turntable —;
// the Endurance's grounds shown closed (a click launches nothing, the preview says why); the Ranger's missions
// (their picture, how hard and how long); launches by real clicks: the Lander landed on the Moon, the Endurance in
// Martian orbit, the Ranger on Gargantua's side of the wormhole — each craft the one flown.
// SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("by ship, on the title", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const vessel = () => app.js<string>(`document.querySelector(".tt-root [data-mode=ship]")?.dataset.vessel ?? ""`);
  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(400);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  /** the title open (from the game: the pause's Title), then By ship */
  const toShip = async (fromGame = false) => {
    if (fromGame) {
      await app.press("Escape");
      await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
      await settle();
      await app.click("[data-testid=pause-title]");
    }
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-ship]")`, 10_000);
    await settle();
    await app.click("[data-testid=title-mode-ship]");
    await app.waitFor(`!!document.querySelector(".tt-root [data-mode=ship]")`, 5000);
    await settle();
  };
  const toCraft = async (id: string) => {
    await app.click(`[data-testid=title-vessel-${id}]`);
    await app.waitFor(`document.querySelector(".tt-root [data-mode=ship]")?.dataset.vessel === "${id}"`, 3000).catch(async (e) => {
      console.log(
        await app.js<string>(
          `(() => { const b = document.querySelector("[data-testid=title-vessel-${id}]"); const r = b.getBoundingClientRect(); return JSON.stringify({ pages: document.querySelectorAll(".tt-root [data-mode=ship]").length, at: document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).slice(0, 4).map((e) => e.tagName + "." + e.className), screen: document.querySelector("[data-screen]")?.dataset.screen }); })()`,
        ),
      );
      throw e;
    });
    await settle();
  };

  test("the hangar: the craft by Q / E, each its sheet and its turntable", async () => {
    await toShip();
    expect(await vessel()).toBe("ranger");
    expect(await focused()).toBe("title-ship-dest-earth-orbit");
    expect(await app.js<string>(`document.querySelector("[data-testid=title-ship-sheet]").textContent`)).toMatch(/40 t/);
    expect(await app.js<boolean>(`document.querySelector(".tt-preview-frame").classList.contains("turning")`)).toBe(true);
    await shot("E5-1-hangar");
    await app.press("KeyE", "e");
    await settle();
    expect(await vessel()).toBe("lander");
    expect(await app.js<string>(`document.querySelector(".tt-turn").style.backgroundImage`)).toContain("turn-lander");
    expect(await app.js<string>(`document.querySelector("[data-testid=title-ship-sheet]").textContent`)).toMatch(/160 t/);
    await app.press("KeyE", "e");
    await settle();
    expect(await vessel()).toBe("endurance");
    await app.press("KeyE", "e");
    await settle();
    expect(await vessel()).toBe("ranger");
    await app.press("KeyQ", "q");
    await settle();
    expect(await vessel()).toBe("endurance");
  });

  test("the Endurance: its grounds closed — shown, with why, launching nothing", async () => {
    const moon = "[data-testid=title-ship-dest-moon-ground]";
    expect(await app.js<boolean>(`document.querySelector("${moon}").classList.contains("locked")`)).toBe(true);
    await app.click(moon);
    await settle();
    expect(await app.js<boolean>(`!!document.querySelector(".tt-root [data-mode=ship]")`)).toBe(true);
    expect(await app.js<string>(`document.querySelector(".tt-preview-mark").textContent`)).toMatch(/never lands|ne se pose jamais/);
    await shot("E5-2-endurance-sol-ferme");
    // (its own scenes: the ring in orbit, before Gargantua)
    expect(await app.js<number>(`document.querySelectorAll("[data-testid^=title-ship-scene-endurance]").length`)).toBe(2);
  });

  test("the Ranger's missions: their picture, how hard and how long", async () => {
    await toCraft("ranger");
    const first = await app.js<string>(`document.querySelector("[data-testid^=title-ship-mission-]")?.dataset.testid ?? ""`);
    expect(first).toMatch(/^title-ship-mission-/);
    await app.js(
      `(document.querySelector("[data-testid=${first}]").scrollIntoView({ block: "center" }), document.querySelector("[data-testid=${first}]").focus(), true)`,
    );
    await settle();
    expect(await app.js<boolean>(`document.querySelector(".tt-preview-frame").classList.contains("turning")`)).toBe(false);
    expect(await app.js<string>(`document.querySelector(".tt-preview-mark").textContent`)).toMatch(/[●○]{3} · ~\d+ min/);
    await shot("E5-3-missions");
  });

  test("the Lander, landed on the Moon", async () => {
    await toCraft("lander");
    await app.click("[data-testid=title-ship-dest-moon-ground]");
    await app.waitFor(
      `__bh.settings.vessel === "lander" && __bh.camera.piloting && __bh.game.snapshot("x").ship.landed?.body === "moon"`,
      60_000,
    );
    await Bun.sleep(3000);
    await shot("E5-4-lander-lune");
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("the Endurance, in Martian orbit", async () => {
    await toShip(true);
    await toCraft("endurance");
    await app.click("[data-testid=title-ship-dest-mars-orbit]");
    await app.waitFor(`__bh.settings.vessel === "endurance" && __bh.camera.piloting && !__bh.game.snapshot("x").ship.landed`, 60_000);
    await Bun.sleep(3000);
    console.log(`  ${await app.js<string>(`__bh.game.snapshot("x").summary`)}`);
    expect(await app.js<string>(`__bh.game.snapshot("x").summary`)).toMatch(/Mars/);
    await shot("E5-5-endurance-mars");
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("the Ranger, on Gargantua's side of the wormhole", async () => {
    await toShip(true);
    await toCraft("ranger");
    await app.js(`(document.querySelector("[data-testid=title-ship-dest-gargantua]").scrollIntoView({ block: "center" }), true)`);
    await settle();
    await app.click("[data-testid=title-ship-dest-gargantua]");
    await app.waitFor(`__bh.settings.vessel === "ranger" && __bh.camera.piloting && __bh.settings.target === "wormhole"`, 60_000);
    await Bun.sleep(3000);
    console.log(`  ${await app.js<string>(`__bh.game.snapshot("x").summary`)}`);
    await shot("E5-6-ranger-gargantua");
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("every mission's briefing: the labels left and whole (the plan's finding 7)", async () => {
    await toShip(true);
    await app.js(`(document.querySelector("[data-testid=title-act-ship-missions]").scrollIntoView({ block: "center" }), true)`);
    await settle();
    await app.click("[data-testid=title-act-ship-missions]");
    await app.waitFor(`!!document.querySelector("[data-testid=mission-launch]")`, 10_000);
    await settle();
    const items = await app.js<{ dir: string; cut: boolean }[]>(
      `[...document.querySelectorAll(".ms-item")].map((b) => ({ dir: getComputedStyle(b).flexDirection, cut: [...b.children].some((c) => c.scrollWidth > c.clientWidth + 1) }))`,
    );
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const x of items) expect(x).toEqual({ dir: "column", cut: false });
    await shot("E5-7-missions");
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=title]")`, 5000);
  }, 60_000);
});
