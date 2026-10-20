import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The way into the game (PLAN-TITRE-AAA E10), by real clicks: a launch from the title — the menu slides out, the
// black comes in, the launch runs under it, the black lifts, the HUD lights up (its phases recorded in the page as
// they come) —; a launch whose scene's tracer compiles (held by __bh.entry.compile: the free camera's Kerr hole):
// the scene loading screen — its picture, the orb, the stage, a tip — while it does; the asset pill's orb.
// SHOTS=1: its moments captured in docs/progress/title-aaa.

const SHOTS = process.env.SHOTS === "1" ? "docs/progress/title-aaa" : process.env.SHOTS;

/** the veil's phases as they come, and the HUD's start, recorded in the page */
const RECORD = `(() => {
  window.__entryLog = [];
  const t0 = performance.now();
  const note = (x) => window.__entryLog.push([x, Math.round(performance.now() - t0)]);
  new MutationObserver(() => {
    const v = document.querySelector("[data-testid=entry]");
    const p = v ? "veil:" + v.dataset.phase + (v.querySelector("[data-testid=entry-loading]") ? "+card" : "") : "none";
    const hb = document.body.classList.contains("hud-boot") ? "hud-boot" : "";
    const key = p + "|" + hb;
    if (window.__entryLast !== key) { window.__entryLast = key; note(key); }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-phase"] });
  return true;
})()`;

describe.skipIf(!E2E)("the way into the game", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900 });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const settle = () => Bun.sleep(500);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 86 });
    await Bun.write(`${SHOTS}/${name}.jpg`, Buffer.from(r.data, "base64"));
  };
  const log = () => app.js<[string, number][]>("window.__entryLog");

  test("from the title: the menu out, the black in, the launch under it, the black out, the HUD's start", async () => {
    await app.waitFor(
      `!!document.querySelector("[data-testid=title-mode-ship]") && typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0`,
      60_000,
    );
    await Bun.sleep(1000);
    await app.click("[data-testid=title-mode-ship]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-ship-dest-earth-orbit]")`, 5000);
    await settle();
    await app.js(RECORD);
    await app.click("[data-testid=title-ship-dest-earth-orbit]");
    // (the menu sliding out under the black coming in)
    expect(await app.js<boolean>(`!!document.querySelector(".tt-root.leaving") && !!document.querySelector("[data-testid=entry]")`)).toBe(
      true,
    );
    // (mid-fade: the capture itself takes a moment)
    await shot("E10-1-fondu");
    await app.waitFor(`!document.querySelector("[data-testid=entry]")`, 120_000);
    await Bun.sleep(150);
    await shot("E10-2-hud-demarre");
    await app.waitFor(`!document.body.classList.contains("hud-boot")`, 5000);
    const l = await log();
    console.log(`  phases: ${l.map(([x, t]) => `${x}@${t}`).join(" → ")}`);
    const keys = l.map(([x]) => x);
    expect(keys.some((k) => k.startsWith("veil:in"))).toBe(true);
    expect(keys.some((k) => k.startsWith("veil:out") && k.endsWith("hud-boot"))).toBe(true);
    expect(keys.at(-1)).toBe("none|");
    expect(await app.js<boolean>(`__bh.camera.piloting && !document.querySelector("[data-testid=title]")`)).toBe(true);
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);

  test("a scene whose tracer compiles: the loading screen while it does — its picture, the orb, the stage, a tip", async () => {
    await Bun.sleep(2000);
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-group-modes]")`, 5000);
    await app.click("[data-testid=pause-group-modes]");
    await app.click("[data-testid=pause-mode-free]");
    await app.waitFor(`!!document.querySelector("[data-testid=title-free-tab-hole]")`, 5000);
    await settle();
    await app.click("[data-testid=title-free-tab-hole]");
    await settle();
    const first = await app.js<string>(`document.querySelector(".tt-root .tt-scene")?.dataset.testid ?? ""`);
    await app.js(RECORD);
    // (the renderer says a compile only when nothing else can draw — its general tracer draws meanwhile —: held 4 s
    // here, as a machine without that tracer would see it)
    await app.js("__bh.entry.compile(4000)");
    await app.click(`[data-testid=${first}]`);
    const card = await app
      .waitFor(`!!document.querySelector("[data-testid=entry-loading]")`, 8000)
      .then(() => true)
      .catch(() => false);
    expect(card).toBe(true);
    {
      await Bun.sleep(900);
      await shot("E10-3-chargement-scene");
      const t = await app.js<{ title: string; stage: string; tip: string; orb: boolean }>(
        `(() => { const c = document.querySelector("[data-testid=entry-loading]"); return { title: c.querySelector(".en-title").textContent, stage: c.querySelector(".en-stage").textContent, tip: c.querySelector(".en-tip").textContent, orb: !!c.querySelector("canvas.en-orb") }; })()`,
      );
      console.log(`  loading screen: ${JSON.stringify(t)}`);
      expect(t.orb).toBe(true);
      expect(t.title.length).toBeGreaterThan(2);
      expect(t.tip).toMatch(/Tip|Astuce/);
    }
    await app.waitFor(`!document.querySelector("[data-testid=entry]")`, 120_000);
    await app.waitFor(`__bh.mode.get() === "free"`, 10_000);
    console.log(`  phases: ${(await log()).map(([x, t]) => `${x}@${t}`).join(" → ")}`);
    expect(app.cdp.errors).toEqual([]);
  }, 180_000);

  test("the asset pill: the orb at its head", async () => {
    expect(await app.js<boolean>(`!!document.querySelector(".asset-pill canvas.ap-orb")`)).toBe(true);
    expect(await app.js<boolean>(`!document.querySelector(".asset-pill .ap-spin")`)).toBe(true);
  });
});
