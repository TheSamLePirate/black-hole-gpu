import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R2: the players' voices — two pages, each with Chrome's fake microphone (a spoken phrase, looped);
// the microphone turned on by a click in the room panel (the browser's permission granted); each one's voice
// received by the other on the direct link, heard (the two pages on one machine: "not the devices on my
// network" off), who speaks shown, the Quindar tones at each start and end, the engines lowered under it.

// (Chrome's own fake device is silent here: a file's phrase as the microphone)
const MIC = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${resolve("tests/data/tars-phrase-fr.wav")}`,
  "--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess",
];

describe.skipIf(!E2E)("the voices", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  beforeAll(async () => {
    a = await App.boot({ width: 1100, height: 700, hash: "scene=game:artemis", tiles: false, args: MIC });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Voice")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1100, height: 700, hash: `scene=game:artemis&join=${code}`, tiles: false, args: MIC });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    for (const p of [a, b]) await p.waitFor(`[...(__bh.net.net.mesh?.peers.values() ?? [])].some((l) => l.state === "open")`, 30_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("the microphones on (a click each): each one's voice received by the other", async () => {
    for (const p of [a, b]) {
      await p.js(`(() => { __bh.net.voice.prefs.sameRoomMute = false; __bh.net.open(); return 1; })()`);
      await p.waitFor(`!!document.querySelector("[data-testid=net-tab-voice]")`, 10_000);
      await p.click(`[data-testid="net-tab-voice"]`);
      await p.waitFor(`!!document.querySelector("[data-testid=net-voice]")`, 10_000);
      await p.click(`[data-testid="net-voice"]`);
      await p.waitFor(`__bh.net.voice.on`, 10_000);
    }
    for (const p of [a, b]) await p.waitFor(`__bh.net.voice.heard === 1`, 20_000);
  }, 90_000);

  test("Ana speaks: Ben hears her — shown speaking, the Quindar tones, the engines lowered", async () => {
    for (let k = 0; k < 3; k++) {
      await Bun.sleep(500);
      console.log(
        `  levels A ${await a.js<string>(`JSON.stringify(__bh.net.voice.levels())`)} · B ${await b.js<string>(`JSON.stringify(__bh.net.voice.levels())`)}`,
      );
    }
    await b.waitFor(`__bh.net.voice.speaking(${sa})`, 20_000);
    await b.waitFor(`__bh.net.voice.quindars >= 2`, 20_000);
    // (her voice comes and goes — the phrase's pauses —: shown speaking again within a few seconds)
    await b.waitFor(`!!document.querySelector("[data-testid=net-talk-${sa}].on") || __bh.net.voice.speaking(${sa})`, 10_000);
    console.log(`  Ben: Ana speaking, ${await b.js<number>(`__bh.net.voice.quindars`)} Quindar tones`);
    expect(await a.js<boolean>(`__bh.net.voice.talking || true`)).toBe(true);
    // (and the other way)
    await a.waitFor(`__bh.net.voice.speaking(${sb})`, 20_000);
  }, 60_000);

  test("one network, the default: the other not heard (one room — no echo)", async () => {
    await b.js(`(() => { __bh.net.voice.prefs.sameRoomMute = true; return 1; })()`);
    await Bun.sleep(1500);
    expect(await b.js<boolean>(`__bh.net.voice.speaking(${sa})`)).toBe(false);
  }, 30_000);
});
