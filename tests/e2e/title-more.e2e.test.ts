import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// More… and the credits on the title (PLAN-TITRE-AAA E7), by real events: More…'s groups (play, create, together,
// learn, measure, the game) and the language's row; Load a game, a screen of its own; How to play, its page in a new
// tab; the Kerr Bench confirmed first (cancelled here: the page would reload); the credits rolling by themselves, a
// key taking them over, every section there (the landscapes' photographers among them), Escape back to More….
// SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("More… and the credits, on the title", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const screen = () => app.js<string>(`document.querySelector(".tt-root [data-screen]:last-child")?.dataset.screen ?? ""`);
  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(400);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  const open = async (testid: string, screenId: string) => {
    await app.click(`[data-testid=${testid}]`);
    await app.waitFor(`document.querySelector(".tt-root [data-screen]:last-child")?.dataset.screen === "${screenId}"`, 5000);
    await settle();
  };
  const back = async (screenId: string) => {
    await app.press("Escape");
    await app.waitFor(`document.querySelector(".tt-root [data-screen]:last-child")?.dataset.screen === "${screenId}"`, 5000);
    await settle();
  };

  test("More…: its groups, the language; Load, a screen of its own; How to play in a new tab", async () => {
    await app.waitFor(`!!document.querySelector("[data-testid=title-more]")`, 10_000);
    await settle();
    await open("title-more", "more");
    const groups = await app.js<string[]>(`[...document.querySelectorAll(".tt-more .tt-group")].map((g) => g.textContent)`);
    expect(groups).toEqual(["Play", "Create", "Together", "Learn", "Measure", "The game"]);
    expect(await app.js<string>(`document.activeElement?.dataset.testid ?? ""`)).toBe("title-act-more-scenes");
    expect(await app.js<string>(`document.querySelector("[data-testid=title-more-language] b").textContent`)).toBe("English");
    await shot("E7-1-plus");
    await open("title-act-more-load", "load");
    await back("more");
    // (How to play: its page, in a tab of its own — window.open caught here)
    await app.js(`(window.__opened = [], window.open = (u) => (window.__opened.push(String(u)), null), true)`);
    await app.js(`(document.querySelector("[data-testid=title-act-more-howto]").scrollIntoView({ block: "center" }), true)`);
    await app.click("[data-testid=title-act-more-howto]");
    expect(await app.js<string[]>("window.__opened")).toEqual([expect.stringMatching(/\/docs\/comment-jouer\.html$/)]);
  });

  test("the Kerr Bench: confirmed first, cancelled here", async () => {
    await app.js(`(document.querySelector("[data-testid=title-act-more-bench]").scrollIntoView({ block: "center" }), true)`);
    await open("title-act-more-bench", "more:bench");
    expect(await app.js<string>(`document.activeElement?.dataset.testid ?? ""`)).toBe("title-bench-go");
    await shot("E7-2-kerr-bench");
    await app.click("[data-testid=title-bench-cancel]");
    await app.waitFor(`document.querySelector(".tt-root [data-screen]:last-child")?.dataset.screen === "more"`, 5000);
    expect(await app.js<string>("location.hash")).not.toContain("bench");
    await settle();
  });

  test("the credits: rolling by themselves, a key taking them over, every section; Escape back", async () => {
    await app.js(`(document.querySelector("[data-testid=title-act-more-credits]").scrollIntoView({ block: "center" }), true)`);
    await open("title-act-more-credits", "credits");
    const sections = await app.js<string[]>(`[...document.querySelectorAll(".tt-roll-sec")].map((s) => s.dataset.section)`);
    expect(sections).toEqual(["game", "craft", "sky", "worlds", "live", "photos", "software", "thanks"]);
    expect(await app.js<string>(`document.querySelector(".tt-roll-game .tt-roll-who").textContent`)).toBe("SamLePirate");
    expect(await app.js<number>(`document.querySelectorAll(".tt-roll-photos .tt-roll-item").length`)).toBeGreaterThanOrEqual(10);
    await Bun.sleep(1500);
    await shot("E7-3-credits-debut");
    const top0 = await app.js<number>(`document.querySelector("[data-testid=title-credits]").scrollTop`);
    await Bun.sleep(1500);
    const top1 = await app.js<number>(`document.querySelector("[data-testid=title-credits]").scrollTop`);
    console.log(`  rolled ${(top1 - top0).toFixed(0)} px in 1.5 s`);
    expect(top1).toBeGreaterThan(top0 + 20);
    // (Page Down: taken over — further at once, then held)
    await app.press("PageDown");
    await Bun.sleep(700);
    const top2 = await app.js<number>(`document.querySelector("[data-testid=title-credits]").scrollTop`);
    expect(top2).toBeGreaterThan(top1 + 200);
    // (the craft's section in view, for the picture)
    await app.js(
      `(document.querySelector("[data-testid=title-credits]").scrollTop = document.querySelector(".tt-roll-craft").offsetTop - 120, true)`,
    );
    await app.js(`document.querySelector("[data-testid=title-credits]").dispatchEvent(new WheelEvent("wheel")), true`);
    await shot("E7-4-credits-vaisseaux");
    await back("more");
    expect(await screen()).toBe("more");
    expect(app.cdp.errors).toEqual([]);
  });
});
