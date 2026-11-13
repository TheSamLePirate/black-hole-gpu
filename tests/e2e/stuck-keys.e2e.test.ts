import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A key left « held » by its character (audit 2026-11-10, FX-12): the keys pressed were kept by their character — `+` — and let go
// by the keyup's — on AZERTY `+` is ⇧ and the `=` key: Maj let go first, the keyup carries `=`, `+` stayed held until the window
// lost the focus, and the zoom ran on alone. Real key events (CDP): ⇧ down, `+` (Equal) down, ⇧ up, `=` (Equal) up.
// Done when: after the keys let go nothing is held and the view's distance no longer moves.
// Duration: ~30 s.

describe.skipIf(!E2E)("a key let go is let go", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("⇧ let go before `+`: nothing held after, the zoom stopped", async () => {
    const key = (type: "keyDown" | "keyUp", key: string, code: string, shift: boolean, text?: string) =>
      app.cdp.send("Input.dispatchKeyEvent", { type, key, code, modifiers: shift ? 8 : 0, ...(text ? { text } : {}) });
    await key("keyDown", "Shift", "ShiftLeft", true);
    await key("keyDown", "+", "Equal", true, "+");
    await Bun.sleep(300);
    await key("keyUp", "Shift", "ShiftLeft", false);
    await key("keyUp", "=", "Equal", false);
    await Bun.sleep(200);
    const held = await app.js<string[]>(`[...__bh.camera.keys, ...__bh.camera.codes]`);
    const d0 = await app.js<number>(`__bh.camera.targetDistance`);
    await Bun.sleep(1500);
    const d1 = await app.js<number>(`__bh.camera.targetDistance`);
    console.log(`  held after: [${held.join(", ")}] · the view's distance ${d0.toFixed(3)} → ${d1.toFixed(3)} in 1.5 s`);
    expect(held).toEqual([]);
    expect(Math.abs(d1 - d0)).toBeLessThan(1e-9);
  }, 60_000);
});
