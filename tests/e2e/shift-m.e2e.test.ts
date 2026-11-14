import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// ⇧M in flight (audit 2026-11-10, FX-13): the keymap's NAV (by the key's code, KeyM) and the settings panel (by its character, M)
// on one key — on a QWERTY keyboard ⇧M did both: the NAV toggled and the panel opened. An F-35 in the air over the sea, real key
// events (CDP) as a QWERTY keyboard sends them: Shift, then M (code KeyM, key "M"); then as an AZERTY one (the M on the code
// Semicolon). Sam's choice (13 Nov 2026): the flight first — the panel leaves a key the flight binds.
// Done when: on QWERTY ⇧M toggles the NAV and leaves the panel shut; on AZERTY it opens the panel and leaves the NAV.
// Duration: ~40 s.

describe.skipIf(!E2E)("⇧M in flight: one thing", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.js(`(() => { __bh.settings.vessel = "f35"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(42.9, 6.0, 2000, 90, 200); return 1; })()`);
    await Bun.sleep(1500);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Shift + M: QWERTY the NAV alone, AZERTY the panel alone", async () => {
    const state = () =>
      app.js<{ panel: boolean; said: string[] }>(`(() => {
        const r = document.getElementById("panel");
        return { panel: !!r && !r.classList.contains("collapsed"), said: __bh.game.log.events.slice(-3).map((e) => e.text) };
      })()`);
    // (the panel closed first: its opening seen)
    await app.js(`(document.getElementById("panel")?.classList.add("collapsed"), 1)`);
    const before = await state();
    const key = (type: "keyDown" | "keyUp", key: string, code: string, shift: boolean, text?: string) =>
      app.cdp.send("Input.dispatchKeyEvent", { type, key, code, modifiers: shift ? 8 : 0, ...(text ? { text } : {}) });
    await key("keyDown", "Shift", "ShiftLeft", true);
    await key("keyDown", "M", "KeyM", true, "M");
    await key("keyUp", "M", "KeyM", true);
    await key("keyUp", "Shift", "ShiftLeft", false);
    await Bun.sleep(400);
    const after = await state();
    const nav = after.said.filter((x) => /NAV/.test(x) && !before.said.includes(x));
    console.log(`  the panel ${before.panel} → ${after.panel}; said: ${nav.join(" | ") || "—"}`);
    await app.snap("remote-results/shift-m/after.png");
    // AZERTY: the M character on the key whose code is Semicolon (KeyM is its « , »)
    await app.js(`(document.getElementById("panel")?.classList.add("collapsed"), 1)`);
    const b2 = await state();
    await key("keyDown", "Shift", "ShiftLeft", true);
    await key("keyDown", "M", "Semicolon", true, "M");
    await key("keyUp", "M", "Semicolon", true);
    await key("keyUp", "Shift", "ShiftLeft", false);
    await Bun.sleep(400);
    const a2 = await state();
    const nav2 = a2.said.filter((x) => /NAV/.test(x) && !b2.said.includes(x));
    console.log(`  AZERTY ⇧M: the panel ${b2.panel} → ${a2.panel}; said: ${nav2.join(" | ") || "—"}`);
    expect(nav.length).toBeGreaterThan(0);
    expect(after.panel).toBe(false);
    expect(a2.panel).toBe(true);
    expect(nav2).toEqual([]);
  }, 60_000);
});
