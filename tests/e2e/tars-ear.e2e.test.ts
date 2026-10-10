import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { App, E2E, stopServer } from "./lib/app";

// TARS's ear by Deepgram, end to end: Chrome's fake microphone playing a French phrase (tests/data, spoken
// by macOS's voice), F6 held — the dev server's relay with the key of .env —, the words shown as they come,
// released: asked. Only with a Deepgram key (DEEPGRAM_API_KEY in .env: never in the code, never in CI).

const KEY = !!process.env.DEEPGRAM_API_KEY;
// (the test's server runs as production: its relay asked for)
process.env.KERR_EAR_RELAY = "1";

describe.skipIf(!E2E || !KEY)("TARS's ear (Deepgram)", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({
      hash: "scene=game:artemis",
      width: 1280,
      height: 720,
      lang: "fr",
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${resolve("tests/data/tars-phrase-fr.wav")}`,
        // (the audio service's sandbox keeps it from the file: silence)
        "--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess",
      ],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
    // (offline: his answer is not what is tested — the words heard are; nothing sent to a model)
    await app.js(`(__bh.settings.tarsOnline = false, __bh.settings.tarsEar = "auto", true)`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("F6 held: the phrase heard as it is spoken, released: asked", async () => {
    let seen = "";
    await app.hold("F6", 300, async () => {
      // (the words as they come, while the key is held)
      const t0 = Date.now();
      while (Date.now() - t0 < 7000) {
        seen = await app.js<string>(`document.querySelector("[data-testid=tars-input]").value`);
        if (/vise mars/i.test(seen)) break;
        await Bun.sleep(150);
      }
      expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").classList.contains("listening")`)).toBe(true);
    });
    if (!seen) console.log("ear trail:", await app.js<string[]>(`__bh.tars.earTrail?.()`));
    expect(seen.toLowerCase()).toContain("orbite autour de la lune");
    // (released: the last words come, then the question asked — in his console's thread)
    await app.waitFor(`document.querySelector("[data-testid=tars-panel]").textContent.toLowerCase().includes("vise mars")`, 10_000);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").classList.contains("listening")`)).toBe(false);
  }, 60_000);
});
