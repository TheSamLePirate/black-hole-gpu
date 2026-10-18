import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The title screen (PLAN-TITRE-AAA E2): at a launch without a scene in the link, over the scene, the time held;
// the four ways to play as cards walked in two dimensions, a mode's screen and back (its card focused again);
// a launch chosen while the game still loads (the graphics held by #slowboot) kept and run once it is there —
// before the first image, the flight saved left unloaded; from the pause, the title again and Continue.
// SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("the title screen", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const shown = `!!document.querySelector("[data-testid=title]")`;
  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const screen = () => app.js<string>(`document.querySelector("[data-testid=title] [data-screen]")?.dataset.screen ?? ""`);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(450);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };

  test("it opens at launch, the time held; no Continue without a saved flight; Escape is not the pause", async () => {
    await app.waitFor(shown, 10_000);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=title-continue]")`)).toBe(false);
    const t0 = await app.js<number>("__bh.time()");
    await Bun.sleep(400);
    expect(await app.js<number>("__bh.time()")).toBe(t0);
    await app.press("Escape");
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=pause]")`)).toBe(false);
    expect(await app.js<boolean>(shown)).toBe(true);
    await shot("E2-1-titre");
  });

  test("the cards walked across, a mode's screen, and back to its card", async () => {
    await app.waitFor(`document.activeElement?.dataset.testid === "title-mode-foot"`, 5000);
    await app.press("ArrowRight");
    await app.press("ArrowRight");
    expect(await focused()).toBe("title-mode-ship");
    await shot("E2-2-carte");
    // (down: the links under the cards — the nearest under this one)
    await app.press("ArrowDown");
    expect(["title-more", "title-settings"]).toContain(await focused());
    await app.press("ArrowUp");
    expect(await focused()).toMatch(/^title-mode-/);
    await app.js(`(document.querySelector("[data-testid=title-mode-ship]").focus(), true)`);
    await app.press("Enter");
    await app.waitFor(`document.querySelector("[data-screen='mode:ship']")`, 3000);
    await Bun.sleep(400);
    expect(await focused()).toBe("title-act-ship-orbit");
    // (the craft by the shoulder buttons' keys: Q/E — A/E on AZERTY)
    await app.press("KeyE", "e");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=title-vessel-lander]").classList.contains("on")`)).toBe(true);
    await shot("E2-3-vaisseau");
    await app.press("Escape");
    await app.waitFor(`document.querySelector("[data-screen='title']")`, 3000);
    expect(await focused()).toBe("title-mode-ship");
    expect(await screen()).toBe("title");
  });

  test("a launch chosen while the game loads: kept, run once it is there — before the first image", async () => {
    // (the graphics held 12 s: the title is there long before them)
    const origin = await app.js<number>("performance.timeOrigin");
    await app.cdp.send("Page.navigate", { url: `${app.url}?e2e=${Math.random()}#slowboot=12` });
    await app.waitFor(`performance.timeOrigin !== ${origin} && !!document.querySelector("[data-testid=title-mode-ship]")`, 30_000);
    // (no __bh yet: the game is not built — the title is)
    expect(await app.js<boolean>(`typeof __bh === "undefined"`)).toBe(true);
    await app.waitFor(`!document.body.classList.contains("intro-play")`, 10_000);
    await shot("E2-4-titre-chargement");
    await app.click("[data-testid=title-mode-ship]");
    await app.waitFor(`document.querySelector("[data-screen='mode:ship']")`, 3000);
    // (the screens' change — a View Transition — over before the next click)
    await Bun.sleep(500);
    await app.click("[data-testid=title-act-ship-orbit]");
    expect(await app.js<boolean>(shown)).toBe(false);
    await app.waitFor(`!document.querySelector(".in-note")?.hidden`, 2000);
    await shot("E2-5-lancement-attendu");
    // (the game there: the ship in orbit about the Earth, the launch run before the first image)
    await app.waitFor(`typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0`, 90_000);
    await app.waitFor(`__bh.camera.piloting`, 30_000);
    const b = await app.js<{ marks: { name: string; t: number }[]; firstImage: number }>("__bh.boot()");
    const title = b.marks.find((m) => m.name === "title")?.t ?? Number.NaN;
    const renderer = b.marks.find((m) => m.name === "renderer")?.t ?? Number.NaN;
    console.log(`  title ${title} ms · renderer ${renderer} ms · first image ${b.firstImage} ms`);
    expect(title).toBeLessThan(renderer);
    expect(await app.js<string>(`__bh.game.snapshot("x").summary`)).toMatch(/Earth/);
    await app.waitFor(`!document.querySelector("#loading")`, 30_000);
    await shot("E2-6-en-orbite");
  }, 180_000);

  test("from the pause menu, back to the title screen; then Continue resumes", async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    await app.click("[data-testid=pause-title]");
    await app.waitFor(shown);
    // (the game left behind the screen: Continue, focused first)
    expect(await focused()).toBe("title-continue");
    await shot("E2-7-titre-continuer");
    await app.press("Enter");
    expect(await app.js<boolean>(shown)).toBe(false);
    // (the keys reach the game again — flying: T the SAS)
    const sas = await app.js<boolean>("__bh.camera.pilot.sas");
    await app.press("KeyT");
    expect(await app.js<boolean>("__bh.camera.pilot.sas")).toBe(!sas);
    expect(app.cdp.errors).toEqual([]);
  });
});
