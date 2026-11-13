import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const OUT = "remote-results/tars-settings-panel";

// A setting changed by TARS goes the panel's way (audit 2026-11-10, TA-09): `set_settings` — here by its own command typed in
// his console, `/set` — is undone by the Lab's Undo like one the player changed, and the quality preset shown follows it.
// Before 13 Nov 2026 the tool wrote `settings` itself and told the game: the Lab's history never saw it (Undo did nothing),
// and its preset could stay shown as matching.
// Done when: after `/set wind 3`, the Lab's Undo is enabled and brings the wind back; after `/set realtimeSteps …` the
// preset shown is « Custom ». Duration: ~40 s.

describe.skipIf(!E2E)("a setting changed by TARS, the panel's way", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, lang: "fr", hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.voice = false, __bh.settings.tarsRemarks = false, true)`);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const run = async (line: string) => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.js(
      `(document.querySelector("[data-testid=tars-input]").focus(), document.querySelector("[data-testid=tars-input]").value = "", true)`,
    );
    await app.type(line);
    await app.press("Enter");
    await Bun.sleep(400);
    console.log(
      `  console: ${await app.js<string>(`[...document.querySelectorAll("[data-testid=tars-panel] .tp-you, [data-testid=tars-panel] .tp-tars, [data-testid=tars-card]")].slice(-3).map((e) => e.textContent.trim().slice(0, 120)).join(" | ")`)}`,
    );
  };
  const undoBtn = `[...document.querySelectorAll(".sp-icon")].find((b) => /^(Annuler|Undo)/.test(b.title))`;

  test("/set wind: in the Lab's history — Undo enabled, the wind back", async () => {
    const wind0 = await app.js<number>(`__bh.settings.wind`);
    const enabled0 = await app.js<boolean>(`!${undoBtn}.disabled`);
    const target = wind0 === 3 ? 1 : 3;
    await run(`/set wind ${target}`);
    await app.waitFor(`__bh.settings.wind === ${target}`, 10_000);
    const enabled = await app.js<boolean>(`!${undoBtn}.disabled`);
    // (the Lab's Undo, as the player's ⌘Z — the button's own handler)
    await app.js(`(${undoBtn}.click(), true)`);
    await Bun.sleep(300);
    const wind = await app.js<number>(`__bh.settings.wind`);
    await app.snap(`${OUT}/after-undo.png`);
    console.log(
      `  wind ${wind0} → /set ${target}; Undo enabled before ${enabled0}, after the command ${enabled}; after Undo the wind is ${wind}`,
    );
    expect(enabled).toBe(true);
    expect(wind).toBe(wind0);
  }, 60_000);

  test("/set realtimeSteps: the quality preset shown becomes « Custom »", async () => {
    const q = await app.js<string>(`__bh.settings.quality`);
    const custom0 = await app.js<boolean>(`!!document.querySelector(".sp-custom.on")`);
    const steps = await app.js<number>(`__bh.settings.realtimeSteps`);
    await run(`/set realtimeSteps ${steps + 7}`);
    await app.waitFor(`__bh.settings.realtimeSteps === ${steps + 7}`, 10_000);
    const custom = await app.js<boolean>(`!!document.querySelector(".sp-custom.on")`);
    const on = await app.js<string | null>(`document.querySelector(".sp-seg.wide button.on")?.dataset.value ?? null`);
    console.log(
      `  quality ${q} (custom shown before: ${custom0}); realtimeSteps ${steps} → ${steps + 7}: custom shown ${custom}, preset lit ${on}`,
    );
    expect(custom0).toBe(false);
    expect(custom).toBe(true);
    expect(on).toBeNull();
  }, 60_000);
});
