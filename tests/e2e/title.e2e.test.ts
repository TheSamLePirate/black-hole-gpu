import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The title screen: at a launch without a scene in the link, over the scene, the time held; its
// entries by the keyboard (↑ ↓ Enter) and by a real click; Continue only with a saved flight.

describe.skipIf(!E2E)("the title screen", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot();
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const shown = `!!document.querySelector("[data-testid=title]")`;

  test("it opens at launch, the time held; no Continue without a saved flight; Escape is not the pause", async () => {
    await app.waitFor(shown, 10_000);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=title-continue]")`)).toBe(false);
    const t0 = await app.js<number>("__bh.time()");
    await Bun.sleep(400);
    expect(await app.js<number>("__bh.time()")).toBe(t0);
    await app.press("Escape");
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=pause]")`)).toBe(false);
    expect(await app.js<boolean>(shown)).toBe(true);
  });

  test("the keyboard walks the entries; Missions: the briefings, Escape back, Enter launches", async () => {
    expect(await app.js<string>("document.activeElement?.dataset.testid")).toBe("title-missions");
    await app.press("ArrowDown");
    expect(await app.js<string>("document.activeElement?.dataset.testid")).toBe("title-explore");
    await app.press("ArrowUp");
    await app.press("Enter");
    await app.waitFor(`!!document.querySelector("[data-testid=missions]")`);
    expect(await app.js<boolean>(shown)).toBe(false);
    // (↓: the second mission briefed)
    const first = await app.js<string>(`document.querySelector(".ms-name").textContent`);
    await app.press("ArrowDown");
    expect(await app.js<string>(`document.querySelector(".ms-name").textContent`)).not.toBe(first);
    await app.press("Escape");
    await app.waitFor(shown);
    await app.press("Enter"); // (Missions again)
    await app.waitFor(`!!document.querySelector("[data-testid=missions]")`);
    await app.click("[data-testid=mission-launch]");
    await app.waitFor("__bh.camera.piloting", 30_000);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=missions]")`)).toBe(false);
  });

  test("from the pause menu, back to the title screen; then Continue resumes", async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    await app.click("[data-testid=pause-title]");
    await app.waitFor(shown);
    // (the game left behind the screen: Continue, focused first)
    expect(await app.js<string>("document.activeElement?.dataset.testid")).toBe("title-continue");
    await app.press("Enter");
    expect(await app.js<boolean>(shown)).toBe(false);
    // (the keys reach the game again — flying the mission launched: T the SAS)
    const sas = await app.js<boolean>("__bh.camera.pilot.sas");
    await app.press("KeyT");
    expect(await app.js<boolean>("__bh.camera.pilot.sas")).toBe(!sas);
    expect(app.cdp.errors).toEqual([]);
  });
});
