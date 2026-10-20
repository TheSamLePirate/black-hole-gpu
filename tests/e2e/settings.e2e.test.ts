import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The player's settings (PLAN-TITRE-AAA E9), by real events: opened from the title — a row per setting, the one
// focused explained, → changing it at once, R resetting the tab —; the tabs by Q / E (the quality's preset by →);
// a risky setting (the render scale) back by itself after 15 s, kept when kept; the common search (a setting here,
// the hole's spin in the Lab, opened on it); from the pause, the Controls tab's keys screen — its back these
// settings, theirs the pause. SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("the player's settings", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const tab = () => app.js<string>(`document.querySelector(".pls-page")?.dataset.tab ?? ""`);
  const s = <T>(k: string) => app.js<T>(`__bh.settings.${k}`);
  const settle = () => Bun.sleep(400);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(400);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };

  test("from the title: a row per setting, explained; → changes it at once, R resets the tab", async () => {
    await app.waitFor(`!!document.querySelector("[data-testid=title-settings]") && typeof __bh !== "undefined"`, 60_000);
    await Bun.sleep(800);
    await app.click("[data-testid=title-settings]");
    await app.waitFor(`!!document.querySelector("[data-testid=settings]")`, 5000);
    await settle();
    expect(await tab()).toBe("game");
    expect(await focused()).toBe("setting-walkSpeed");
    expect(await app.js<string>(`document.querySelector("[data-testid=settings-explain]").textContent`)).toMatch(
      /Walking speed|Vitesse de marche/,
    );
    const w0 = await s<number>("walkSpeed");
    await app.press("ArrowRight");
    await app.press("ArrowRight");
    expect(await s<number>("walkSpeed")).toBeGreaterThan(w0);
    await shot("E9-1-jeu");
    await app.press("KeyR", "r");
    await settle();
    expect(await s<number>("walkSpeed")).toBe(w0);
  });

  test("the tabs by Q / E; the quality's preset by →", async () => {
    await app.press("KeyE", "e");
    await settle();
    expect(await tab()).toBe("graphics");
    expect(await focused()).toBe("setting-quality");
    const q0 = await s<string>("quality");
    await app.press("ArrowRight");
    await settle();
    expect(await s<string>("quality")).not.toBe(q0);
    await shot("E9-2-graphismes");
    await app.press("ArrowLeft");
    await settle();
    expect(await s<string>("quality")).toBe(q0);
    for (const t of ["display", "audio", "controls", "access", "interface", "network"]) {
      await app.press("KeyE", "e");
      await settle();
      expect(await tab()).toBe(t);
      if (t === "display") await shot("E9-3-affichage");
    }
  });

  test("a risky setting — the render scale —: back by itself after 15 s, kept when kept", async () => {
    await app.click("[data-testid=settings-tab-graphics]");
    await settle();
    const p0 = await s<number>("pixelRatio");
    await app.js(`(document.querySelector("[data-testid=setting-pixelRatio]").focus(), true)`);
    await app.press("ArrowLeft");
    expect(await s<number>("pixelRatio")).not.toBe(p0);
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=settings-keep]").hidden`)).toBe(true);
    await shot("E9-4-garder");
    await app.waitFor(`__bh.settings.pixelRatio === ${p0}`, 20_000);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=settings-keep]").hidden`)).toBe(true);
    // (kept: it stays)
    await app.js(`(document.querySelector("[data-testid=setting-pixelRatio]").focus(), true)`);
    await app.press("ArrowLeft");
    const p1 = await s<number>("pixelRatio");
    await app.click("[data-testid=settings-keep-yes]");
    await Bun.sleep(1500);
    expect(await s<number>("pixelRatio")).toBe(p1);
    // (as it was)
    await app.js(`(__bh.settings.pixelRatio = ${p0}, true)`);
  }, 60_000);

  test("the common search: a setting here, the hole's spin in the Lab — opened on it", async () => {
    await app.js(`(document.querySelector("[data-testid=settings-search]").focus(), true)`);
    await app.type("marche");
    await settle();
    expect(await app.js<boolean>(`!!document.querySelector(".pls-list [data-testid=setting-walkSpeed]")`)).toBe(true);
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=settings-search]"); i.value = "spin"; i.dispatchEvent(new Event("input")); return true; })()`,
    );
    await settle();
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=settings-lab-spin]")`)).toBe(true);
    await shot("E9-5-recherche");
    await app.click("[data-testid=settings-lab-spin]");
    await app.waitFor(
      `!document.getElementById("panel").classList.contains("collapsed") && !document.querySelector("[data-testid=settings]")`,
      5000,
    );
    expect(await app.js<string>(`document.querySelector("#panel .sp-search input").value`)).toMatch(/spin|Spin|rotation/i);
    await shot("E9-6-labo");
    await app.press("Escape");
    await app.press("Escape");
  });

  test("from the pause: Controls' keys screen, its back these settings, theirs the pause", async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-group-settings]")`, 5000);
    await app.click("[data-testid=pause-group-settings]");
    await app.click("[data-testid=pause-settings]");
    await app.waitFor(`!!document.querySelector("[data-testid=settings]")`, 5000);
    await settle();
    await app.click("[data-testid=settings-tab-controls]");
    await settle();
    await app.click("[data-testid=settings-keys]");
    await app.waitFor(`!!document.querySelector("[data-testid=controls]")`, 5000);
    await app.press("Escape");
    await app.waitFor(`document.querySelector(".pls-page")?.dataset.tab === "controls"`, 5000);
    await settle();
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=settings]") && !!document.querySelector("[data-testid=pause-resume]")`, 5000);
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=pause]")`, 5000);
    expect(app.cdp.errors).toEqual([]);
  });
});
