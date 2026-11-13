import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { App, E2E, stopServer } from "./lib/app";

// TARS's ear: how long from F6 pressed to the first sound sent to Deepgram (audit 2026-11-10, TA-22) — what the pilot says
// before it is lost. The probe: the ear's steps dated from the key down in its trail (src/ai/listen.ts). Its witnesses
// (CLAUDE.md, method rule 3): two holds alike (A/A), then the microphone made 500 ms slower — the probe must see it.
// A tap (the field) closes that early ear unseen. Only with a Deepgram key (the dev relay, .env). Done when: the three holds'
// « first audio » read, the witnesses hold, a tap shows no listening and asks nothing.
// Duration: ~40 s.

const KEY = !!process.env.DEEPGRAM_API_KEY;
process.env.KERR_EAR_RELAY = "1";

describe.skipIf(!E2E || !KEY)("TARS's ear: F6 to the first sound sent", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({
      hash: "scene=game:artemis",
      width: 1280,
      height: 720,
      lang: "fr",
      tiles: false,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${resolve("tests/data/tars-phrase-fr.wav")}`,
        "--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess",
      ],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(__bh.settings.tarsOnline = false, __bh.settings.tarsEar = "auto", __bh.settings.voice = false, true)`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** one hold: the trail's dated steps of that hold, and its first audio [ms after the key down] */
  const hold = async () => {
    const n0 = await app.js<number>(`(__bh.tars.earTrail?.() ?? []).length`);
    await app.hold("F6", 1800);
    await Bun.sleep(1500);
    const steps = await app.js<string[]>(`(__bh.tars.earTrail?.() ?? []).slice(${n0})`);
    const first = steps.map((s) => /^(\d+) ms ear first audio/.exec(s)).find(Boolean);
    return { steps, first: first ? Number(first[1]) : null };
  };

  test("the first sound's delay, measured with its witnesses", async () => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    // (a first hold warms the microphone's grant: not counted)
    await hold();
    const a = await hold();
    const b = await hold();
    // (the positive witness: the microphone answering 500 ms later)
    await app.js(`(() => {
      const md = navigator.mediaDevices, real = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => new Promise((r) => setTimeout(r, 500)).then(() => real(c));
      return true;
    })()`);
    const slow = await hold();
    // (a tap with the ear opened at the key's down: closed unseen — never shown listening, nothing asked)
    const asked0 = await app.js<number>(`document.querySelectorAll("[data-testid=tars-panel] .tp-you").length`);
    let shown = false;
    await app.hold("F6", 80, async () => {
      shown = await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").classList.contains("listening")`);
    });
    await Bun.sleep(1200);
    const asked = await app.js<number>(`document.querySelectorAll("[data-testid=tars-panel] .tp-you").length`);
    console.log(`  tap: shown listening ${shown}, questions ${asked0} → ${asked}`);
    expect(shown).toBe(false);
    expect(asked).toBe(asked0);
    console.log(
      `  A: ${a.first} ms; A': ${b.first} ms; microphone +500 ms: ${slow.first} ms\n  steps A: ${a.steps.join(" · ")}\n  steps slow: ${slow.steps.join(" · ")}`,
    );
    expect(a.first).not.toBeNull();
    expect(b.first).not.toBeNull();
    expect(slow.first).not.toBeNull();
    // A/A within 150 ms; the injected 500 ms seen (at least 350 ms more)
    expect(Math.abs(a.first! - b.first!)).toBeLessThan(150);
    expect(slow.first! - Math.max(a.first!, b.first!)).toBeGreaterThan(350);
  }, 90_000);
});
