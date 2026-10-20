import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The pause menu (PLAN-TITRE-AAA E8), by real events: a column on the left — its first level short, nothing cut
// (the plan's finding 4), the diagnostic gone from it (finding 5) —, the context on the right (where one is, the
// flight's figures, the time played, a tip); a drawer opened by → and left by ← or Escape (the menu still open);
// Change mode › By plane: the title's launch screen alone, its back the pause again; an air mission's objectives
// in the context; Save and Load as screens of their own.
// SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("the pause menu", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(400);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  const openPause = async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause] [data-testid=pause-resume]")`, 5000);
    await settle();
  };

  test("its column: a short first level, nothing cut, no diagnostic; the context beside", async () => {
    // (in the game: by ship, low orbit — from the title)
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-ship]")`, 10_000);
    await settle();
    await app.click("[data-testid=title-mode-ship]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-ship-dest-earth-orbit]")`, 5000);
    await settle();
    await app.click("[data-testid=title-ship-dest-earth-orbit]");
    await app.waitFor(`__bh.camera.piloting && !document.querySelector("[data-testid=title]")`, 60_000);
    await Bun.sleep(2000);
    await openPause();
    expect(await focused()).toBe("pause-resume");
    const first = await app.js<string[]>(`[...document.querySelectorAll(".pz-list > .pz-item")].map((b) => b.dataset.testid)`);
    console.log(`  first level: ${first.join(" ")}`);
    expect(first.length).toBeLessThanOrEqual(11);
    expect(first).not.toContain("pause-graphics-diagnostic");
    expect(first.slice(0, 3)).toEqual(["pause-resume", "pause-save", "pause-load"]);
    // (nothing past its box: the old two columns cut the right one)
    const cut = await app.js<string[]>(
      `[...document.querySelectorAll(".pz-item")].filter((b) => b.getBoundingClientRect().right > document.querySelector(".pz-context").getBoundingClientRect().left + 1).map((b) => b.dataset.testid)`,
    );
    expect(cut).toEqual([]);
    const ctx = await app.js<string>(`document.querySelector("[data-testid=pause-context]").textContent`);
    expect(ctx).toMatch(/Played|Temps de jeu/);
    expect(ctx).toMatch(/Tip|Astuce/);
    expect(await app.js<number>(`document.querySelectorAll(".pz-figs dt").length`)).toBeGreaterThanOrEqual(3);
    // (the game held behind it: out of a room)
    expect(await app.js<boolean>(`!!document.querySelector(".pz-root.live")`)).toBe(false);
    await shot("E8-1-pause");
  }, 120_000);

  test("a drawer: → opens it, ← and Escape leave it, the menu still open", async () => {
    await app.js(`(document.querySelector("[data-testid=pause-group-world]").focus(), true)`);
    await settle();
    expect(await app.js<boolean>(`!document.querySelector(".pz-drawer").hidden`)).toBe(true);
    await app.press("ArrowRight");
    expect(await focused()).toBe("pause-atlas");
    await shot("E8-2-tiroir-monde");
    await app.press("ArrowLeft");
    expect(await focused()).toBe("pause-group-world");
    await app.press("ArrowRight");
    await app.press("ArrowDown");
    expect(await focused()).toBe("pause-place");
    await app.press("Escape");
    expect(await focused()).toBe("pause-group-world");
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=pause]")`)).toBe(true);
    // (the settings' drawer: the diagnostic now there)
    await app.click("[data-testid=pause-group-settings]");
    expect(await app.js<boolean>(`!!document.querySelector(".pz-drawer [data-testid=pause-graphics-diagnostic]")`)).toBe(true);
  });

  test("Save and Load: screens of their own, back to the menu", async () => {
    await app.click("[data-testid=pause-save]");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-save-new]")`, 5000);
    await settle();
    await app.click("[data-testid=pause-save-new]");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-resume]")`, 5000);
    await settle();
    expect(await app.js<string>(`document.querySelector("[data-testid=pause-context]").textContent`)).toMatch(/saved|sauvé/);
    await app.click("[data-testid=pause-load]");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-load-auto], .pz-save")`, 5000);
    await shot("E8-3-charger");
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-resume]")`, 5000);
    await settle();
  });

  test("Change mode › By plane: the title's launch screen alone; its back, the pause again", async () => {
    await app.click("[data-testid=pause-group-modes]");
    await app.click("[data-testid=pause-mode-plane]");
    await app.waitFor(`!!document.querySelector(".tt-root [data-mode=plane]")`, 5000);
    await settle();
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=pause]")`)).toBe(false);
    await shot("E8-4-changer-de-mode");
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=title]") && !!document.querySelector("[data-testid=pause-resume]")`, 5000);
    await settle();
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=pause]")`, 5000);
  });

  test("an air mission flown: its objectives in the context", async () => {
    await app.js(`(__bh.flight.missions.fly("renegade"), true)`);
    await app.waitFor(`!!__bh.flight.missions.state()`, 60_000);
    await Bun.sleep(3000);
    await openPause();
    const objs = await app.js<string[]>(`[...document.querySelectorAll("[data-testid=pause-mission] .pz-obj")].map((o) => o.className)`);
    console.log(`  objectives: ${objs.join(" · ")}`);
    expect(objs.length).toBeGreaterThanOrEqual(2);
    expect(objs.some((c) => /active/.test(c))).toBe(true);
    await shot("E8-5-mission");
    await app.press("Escape");
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
