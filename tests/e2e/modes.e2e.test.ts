import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The game's four modes (game/modes.ts, ui/topbar.ts — PLAN-MODES-AAA M1): the top bar in every mode, its tab
// following the mode; F1–F4 and the tabs change it (the ship put in, the spectator out and back, the photo mode
// over a mode and back to it, on foot out of a landed craft and back on board); the bar hidden and brought back
// by its handle (TARS still breathing in it); TARS's set_mode tool; nothing logged in the console.

describe.skipIf(!E2E)("the four modes and the top bar", () => {
  let app: App;
  const settle = () => app.js("(()=>{for(let i=0;i<10;i++)__bh.step(1/30);__bh.touch();return true;})()");
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: false });
    await app.js(`(__bh.freeze(true), __bh.settings.ship = false, __bh.touch(), true)`);
    await settle();
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the bar in the free camera: its tab lit, TARS, the time, the actions", async () => {
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("free")}`, 10_000);
    await app.waitFor(`document.querySelector("#topbar .tb-tab.on")?.dataset.mode === "free"`, 3_000);
    const r = await app.js<{ shown: boolean; tars: boolean; time: boolean; camera: boolean; inside: boolean }>(`(() => {
      const b = document.getElementById("topbar"), r = b.getBoundingClientRect();
      return { shown: !b.hidden && r.height > 30, tars: !!b.querySelector(".tb-tars .tars-orb"), time: !!b.querySelector(".tb-time .tp"),
        camera: !!b.querySelector(".tb-free #btn-camera"), inside: r.left >= 0 && r.right <= innerWidth };
    })()`);
    expect(r).toEqual({ shown: true, tars: true, time: true, camera: true, inside: true });
  }, 30_000);

  test("F1: the ship put in and flown; F3: the spectator; F1: back on board", async () => {
    await app.press("F1", "F1");
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("ship")}`, 10_000);
    await app.waitFor(`document.querySelector("#topbar .tb-tab.on")?.dataset.mode === "ship"`, 10_000);
    expect(await app.js<boolean>(`!!document.querySelector("#topbar .tb-ship .fl-chip")`)).toBe(true);
    await app.press("F3", "F3");
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("free")}`, 10_000);
    expect(await app.js<boolean>("__bh.camera.spectating")).toBe(true);
    await app.press("F1", "F1");
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("ship")}`, 10_000);
    expect(await app.js<boolean>("__bh.camera.spectating")).toBe(false);
  }, 60_000);

  test("F4: the photo mode over the ship; Esc: back to the ship", async () => {
    await app.press("F4", "F4");
    await app.waitFor(`document.body.classList.contains("photo")`, 3_000);
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("photo")}`, 10_000);
    await app.waitFor(`document.querySelector("#topbar .tb-tab.on")?.dataset.mode === "photo"`, 10_000);
    await app.press("Escape", "Escape");
    await app.waitFor(`!document.body.classList.contains("photo")`, 3_000);
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("ship")}`, 10_000);
  }, 30_000);

  test("on foot: out of the landed craft (F2), the free camera from the walker's view (F3), back on board (F1)", async () => {
    await app.js(`(()=>{__bh.game.land('moon',0,0);__bh.step(0);return true;})()`);
    await settle();
    await app.press("F2", "F2");
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("foot")}`, 10_000);
    expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
    await app.waitFor(`/°/.test(document.querySelector("[data-testid=topbar-context]")?.textContent ?? "")`, 5_000);
    // (the on-foot HUD — M5: the compass, the place with the craft's distance, the minimap zoomed by its +)
    await app.waitFor(`!document.querySelector("[data-testid=foot-hud]").hidden`, 3_000);
    await app.waitFor(`/\\d+ m/.test(document.querySelector(".fh-craft b")?.textContent ?? "")`, 3_000);
    const z0 = await app.js<string>(`document.querySelector(".fh-zoom").textContent`);
    await app.click(".fh-zb");
    expect(await app.js<string>(`document.querySelector(".fh-zoom").textContent`)).not.toBe(z0);
    // (TARS on foot — M2: F6 opens his console; his state has the walker's place and the craft's distance)
    await app.press("F6", "F6");
    await app.waitFor(`!!document.querySelector(".tars-panel:not([hidden])")`, 3_000);
    await app.press("Escape", "Escape");
    const st = await app.js<{ mode: string; foot: { body: string; craft: { distM: number } | null } | null }>(
      `Promise.resolve(__bh.tars.tools().find((t) => t.name === "get_state").run({}, new AbortController().signal)).then((r) => r.flight)`,
    );
    expect(st.mode).toBe("foot");
    expect(st.foot?.body).toBe("moon");
    expect(st.foot?.craft?.distM ?? Infinity).toBeLessThan(200);
    await app.press("F3", "F3");
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("free")}`, 10_000);
    expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
    await app.press("F1", "F1");
    await settle();
    await app.waitFor(`__bh.mode.get() === ${JSON.stringify("ship")}`, 10_000);
  }, 120_000);

  test("hidden by its button, brought back by its handle (TARS in it), remembered", async () => {
    await app.click("[data-testid=topbar-hide]");
    expect(
      await app.js<boolean>(`document.getElementById("topbar").hidden && !document.querySelector("[data-testid=topbar-handle]").hidden`),
    ).toBe(true);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=topbar-handle] .tars-orb")`)).toBe(true);
    await app.click("[data-testid=topbar-handle]");
    expect(await app.js<boolean>(`!document.getElementById("topbar").hidden`)).toBe(true);
    expect(await app.js<{ hidden: boolean }>("__bh.mode.bar()")).toMatchObject({ hidden: false });
  }, 30_000);

  test("the capture in every mode (M3): on foot, the free camera, the ship — the view rendered converged", async () => {
    const capture = (args: object) =>
      app.js<{ ok: boolean; active: boolean; progress: number | null; done: boolean; error?: string }>(
        `Promise.resolve(__bh.tars.tools().find((t) => t.name === "capture").run(${JSON.stringify(args)}, new AbortController().signal)).then((r) => r.result ?? r)`,
      );
    await app.js(`(()=>{__bh.camera.character.start('moon',0.67,23.47);__bh.step(0);return true;})()`);
    await settle();
    for (const m of ["foot", "free", "ship"]) {
      if (m !== "foot") await app.js(`__bh.mode.set(${JSON.stringify(m)})`);
      await settle();
      await app.waitFor(`__bh.mode.get() === ${JSON.stringify(m)}`, 10_000);
      const r = await capture({ action: "start", width: 320, height: 180, spp: 16, save: "none" });
      expect(r).toMatchObject({ ok: true, active: true });
      await app.waitFor(`document.getElementById("r-bar").classList.contains("done")`, 120_000);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      await capture({ action: "stop" });
      expect(await app.js<boolean>("__bh.renderer.offlineActive")).toBe(false);
    }
    await app.press("Escape", "Escape");
  }, 400_000);

  test("the pause menu offers the capture", async () => {
    await app.press("Escape", "Escape");
    // (since PLAN-TITRE-AAA E8 the entry is in its group's drawer)
    await app.waitFor(`!!document.querySelector("[data-testid=pause-group-capture]")`, 5000);
    await app.click("[data-testid=pause-group-capture]");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-capture]")`, 3_000);
    await app.press("Escape", "Escape");
  }, 30_000);

  test("TARS's set_mode: the free camera, then the ship", async () => {
    const run = (args: object) =>
      app.js<{ ok: boolean; mode: string }>(
        `Promise.resolve(__bh.tars.tools().find((t) => t.name === "set_mode").run(${JSON.stringify(args)}, new AbortController().signal)).then((r) => r.result ?? r)`,
      );
    expect(await run({ mode: "free" })).toMatchObject({ ok: true, mode: "free" });
    await settle();
    expect(await run({ mode: "ship" })).toMatchObject({ ok: true, mode: "ship" });
    expect(app.cdp.errors).toEqual([]);
  }, 30_000);
});
