import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The page's scripts only its own (audit 2026-11-10, QA-18): the players' keys (OpenRouter, Deepgram) live in this browser's
// storage; a script slipped into the page — a name shown unescaped, a library compromised — could read and send them. The
// page's Content Security Policy runs its own scripts and the two in its head (by their hashes), nothing else. Done when:
// the game boots and runs as before (its workers, its WASM), and an inline script injected into the page does not run (its
// violation reported). Duration: ~30 s.

describe.skipIf(!E2E)("the page's scripts only its own", () => {
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

  test("the game runs; an injected inline script does not", async () => {
    const r = await app.js<{ ran: boolean; violated: string | null; boot: boolean; frames: number }>(`(async () => {
      let violated = null;
      document.addEventListener("securitypolicyviolation", (e) => (violated = e.violatedDirective), { once: true });
      window.__pwned = false;
      const s = document.createElement("script");
      s.textContent = "window.__pwned = true";
      document.head.append(s);
      await new Promise((r) => setTimeout(r, 200));
      // (the head's own two scripts ran: the boot's timeline and the intro's language)
      return { ran: window.__pwned === true, violated, boot: !!window.__boot, frames: __bh.renderer?.frame ?? -1 };
    })()`);
    console.log(`  injected script ran: ${r.ran}; violation: ${r.violated}; the head's own scripts ran: ${r.boot}`);
    expect(r.boot).toBe(true);
    expect(r.ran).toBe(false);
    expect(r.violated).toMatch(/script-src/);
  }, 60_000);
});
