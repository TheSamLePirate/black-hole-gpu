import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// By plane on the title (PLAN-TITRE-AAA E4): its four tabs by Q / E; the free flight set up by the keys (the hour
// by → on its row, kept for the next visit) and the airfield found by a few letters; an air mission's briefing
// opened from Combat; the flight launched — the F-35B at the field chosen —; a challenge launched from its tab.
// SHOTS=1: its screens captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

describe.skipIf(!E2E)("by plane, on the title", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  const tab = () => app.js<string>(`document.querySelector("[data-mode=plane]")?.dataset.tab ?? ""`);
  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    await Bun.sleep(400);
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  /** the title open, then By plane */
  const toPlane = async () => {
    await app.waitFor(`!!document.querySelector("[data-testid=title-mode-plane]")`, 10_000);
    await settle();
    await app.click("[data-testid=title-mode-plane]");
    await app.waitFor(`!!document.querySelector("[data-mode=plane]")`, 5000);
    await settle();
  };

  test("the free flight set up by the keys; the airfield found by a few letters", async () => {
    await toPlane();
    expect(await tab()).toBe("free");
    expect(await focused()).toBe("title-flight-fly");
    // (↑ to the fuel, the weather, the hour; → on the hour: Dawn, Morning)
    await app.press("ArrowUp");
    await app.press("ArrowUp");
    await app.press("ArrowUp");
    expect(await focused()).toBe("title-flight-hour");
    await app.press("ArrowRight");
    await app.press("ArrowRight");
    expect(await app.js<string>(`document.querySelector("[data-testid=title-flight-hour] b").textContent`)).toBe("Morning");
    expect(await app.js<string>(`JSON.parse(localStorage.getItem("kerr.title.flight")).hour`)).toBe("morning");
    // (the airfield: its list, found by "bourget")
    await app.click("[data-testid=title-flight-field]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-field-search]")`, 5000);
    await settle();
    await app.js(
      `(() => { const i = document.querySelector("[data-testid=title-field-search]"); i.value = "bourget"; i.dispatchEvent(new Event("input")); return true; })()`,
    );
    await shot("E4-2-aerodrome");
    const found = await app.js<string>(`document.querySelector(".tt-fields button")?.dataset.testid ?? ""`);
    expect(found).toMatch(/^title-field-/);
    await app.click(`[data-testid=${found}]`);
    await app.waitFor(`!!document.querySelector("[data-mode=plane]")`, 5000);
    await settle();
    expect(await app.js<string>(`document.querySelector("[data-testid=title-flight-field] b").textContent`)).toMatch(/Bourget/);
    await shot("E4-1-vol-libre");
  });

  test("the tabs by Q / E; Combat: a mission's briefing opened", async () => {
    await app.js(`(document.querySelector("[data-testid=title-flight-fly]").focus(), true)`);
    await app.press("KeyE", "e");
    await settle();
    expect(await tab()).toBe("combat");
    await shot("E4-3-combat");
    await app.press("KeyE", "e");
    await settle();
    expect(await tab()).toBe("school");
    await shot("E4-4-ecole");
    await app.press("KeyE", "e");
    await settle();
    expect(await tab()).toBe("challenges");
    await shot("E4-5-defis");
    await app.press("KeyQ", "q");
    await app.press("KeyQ", "q");
    await settle();
    expect(await tab()).toBe("combat");
    const first = await app.js<string>(`document.querySelector("[data-tab=combat] .tt-act")?.dataset.testid ?? ""`);
    expect(first).toMatch(/^title-plane-mission-/);
    await app.click(`[data-testid=${first}]`);
    await app.waitFor(`!!document.querySelector("[data-testid=mission-brief]")`, 30_000);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=title]")`)).toBe(false);
    await shot("E4-6-briefing");
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=mission-brief]")`, 5000);
  });

  test("the flight launched: the F-35B at the airfield chosen", async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    // (the title's own closing — a View Transition — over before the pause is clicked)
    await settle();
    await app.click("[data-testid=pause-title]");
    await toPlane();
    // (By plane opens on the tab used last — Combat here: Free flight again)
    await app.click("[data-testid=title-tab-free]");
    await app.waitFor(`document.querySelector("[data-mode=plane]")?.dataset.tab === "free"`, 3000);
    expect(await app.js<string>(`document.querySelector("[data-testid=title-flight-field] b").textContent`)).toMatch(/Bourget/);
    await app.click("[data-testid=title-flight-fly]");
    await app.waitFor(`__bh.settings.vessel === "f35" && __bh.camera.piloting`, 60_000);
    // (the craft at Le Bourget: some 13 km north-east of Paris)
    const where = await app.js<{ lat: number; lon: number }>(
      `(() => { const s = __bh.game.snapshot("x"); return s.ship.landed ? { lat: 0, lon: 0 } : JSON.parse(JSON.stringify(__bh.game.place?.() ?? { lat: 0, lon: 0 })); })()`,
    );
    console.log(`  the craft: ${JSON.stringify(where)} · ${await app.js<string>(`__bh.game.snapshot("x").summary`)}`);
    expect(await app.js<string>(`__bh.game.snapshot("x").summary`)).toMatch(/F-35|Earth/);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("Challenges: one launched from its tab", async () => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    // (the title's own closing — a View Transition — over before the pause is clicked)
    await settle();
    await app.click("[data-testid=pause-title]");
    await toPlane();
    await app.click("[data-testid=title-tab-challenges]");
    await settle();
    const first = await app.js<string>(`document.querySelector("[data-tab=challenges] .tt-act")?.dataset.testid ?? ""`);
    expect(first).toMatch(/^title-plane-challenge-/);
    await app.click(`[data-testid=${first}]`);
    await app.waitFor(`!!__bh.camera.chal`, 60_000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
