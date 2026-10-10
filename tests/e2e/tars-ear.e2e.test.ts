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

  test("his settings' tab: the sections, a Deepgram voice through the relay, the ear's test with the microphone", async () => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.click(".tp-tab:nth-child(5)");
    // (a control scrolled into the tab's view, then clicked as a hand would)
    const go = async (sel: string) => {
      await app.js(`(document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: "center" }), true)`);
      await Bun.sleep(150);
      await app.click(sel);
    };
    expect(await app.js<string[]>(`[...document.querySelectorAll(".ts-title")].map((x) => x.textContent)`)).toEqual([
      "Son esprit",
      "Sa voix",
      "La radio",
      "Son oreille",
    ]);
    // (a line's sound by Hector, through the relay: some seconds at 24 kHz)
    const n = await app.js<number>(`__bh.tars.voiceSynth("Orbite stable, Cooper.", "aura-2-hector-fr")`);
    expect(n).toBeGreaterThan(24000);
    // (his voice tried: what speaks it said)
    await app.js(`(__bh.settings.voice = true, true)`);
    await go("[data-testid=ts-try-tars]");
    await app.waitFor(`document.querySelector(".ts-try .ts-now").textContent.includes("Deepgram · Hector")`, 10_000);
    // (a setting set here: the settings' own value)
    await go("[data-testid=ts-tarsEarModel-nova-2]");
    expect(await app.js<string>(`__bh.settings.tarsEarModel`)).toBe("nova-2");
    await go("[data-testid=ts-tarsEarModel-nova-3]");
    // (the ear's test: the fake microphone's phrase heard, shown)
    await go("[data-testid=ts-test-ear]");
    await app.waitFor(`/orbite autour de la lune/i.test(document.querySelector("[data-testid=ts-heard]").textContent)`, 15_000);
  }, 60_000);
});
