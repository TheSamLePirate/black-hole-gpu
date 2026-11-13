import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const OUT = "remote-results/tars-duck";

// The voices heard over the engines (audio-engine duck; audit 2026-11-10, TA-13): a line said — TARS's, the callouts, the
// radio — lowers the engines, the ambience and the music under it (−8 dB), as a room player's voice already did; the pilot
// speaking (F6 held) lowers them more (−14 dB) and cuts TARS's line being said. Before 13 Nov 2026 only another player's
// voice lowered anything: TARS was covered by full power, and F6 neither cut him nor lowered the rest.
// Done when: the engine and music busses' gains drop under a TARS line and come back after it; F6 held drops them further and
// TARS's line is cut. Duration: ~30 s.

describe.skipIf(!E2E)("the voices over the engines", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({
      width: 1280,
      height: 800,
      hash: "scene=game:artemis",
      tiles: false,
      // (the browser's speech recognition stood in for, as tars-agent's)
      initScript: `window.SpeechRecognition = class { constructor() { window.__rec = this; } start() { this.on = true; } stop() { this.on = false; setTimeout(() => this.onend && this.onend(), 30); } abort() {} };`,
    });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.sound = true, __bh.settings.tarsEar = "browser", true)`);
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const gains = () =>
    app.js<{ engine: number; music: number; ambience: number }>(
      `(() => { const b = __sound.busses; return { engine: b.engine.gain.value, music: b.music.gain.value, ambience: b.ambience.gain.value }; })()`,
    );
  const LINE = "Cooper, the fuel holds to the Moon and back with a margin of twelve percent, as long as we keep this attitude.";

  test("a TARS line lowers the engines and the music under it, and lets them back", async () => {
    await Bun.sleep(400);
    const quiet = await gains();
    await app.js(`(__bh.voice.say({ text: ${JSON.stringify(LINE)}, speaker: "tars", priority: 2 }), true)`);
    await Bun.sleep(600);
    const under = await gains();
    await app.snap(`${OUT}/tars-speaking.png`);
    await app.js(`(__bh.voice.stop(), true)`);
    await Bun.sleep(600);
    const after = await gains();
    const dB = (a: number, b: number) => (20 * Math.log10(a / b)).toFixed(1);
    console.log(
      `  quiet ${JSON.stringify(quiet)}\n  under TARS ${JSON.stringify(under)} (engine ${dB(under.engine, quiet.engine)} dB)\n  after ${JSON.stringify(after)}`,
    );
    expect(quiet.engine).toBeGreaterThan(0);
    expect(under.engine).toBeLessThan(quiet.engine * 0.6);
    expect(under.music).toBeLessThan(quiet.music * 0.6 + 1e-6);
    expect(after.engine).toBeCloseTo(quiet.engine, 2);
  }, 60_000);

  test("F6 held: the rest lowered further, TARS's line cut", async () => {
    await Bun.sleep(400);
    const quiet = await gains();
    await app.js(`(__bh.voice.say({ text: ${JSON.stringify(LINE)}, speaker: "tars", priority: 2 }), true)`);
    await Bun.sleep(300);
    let held: { g: { engine: number }; current: string | null } | null = null;
    await app.hold("F6", 900, async () => {
      await Bun.sleep(500);
      held = {
        g: await gains(),
        current: await app.js<string | null>(`__bh.voice.queue.current?.speaker ?? null`),
      };
    });
    await Bun.sleep(600);
    const after = await gains();
    console.log(`  quiet ${quiet.engine.toFixed(3)}; F6 held ${JSON.stringify(held)}; after ${after.engine.toFixed(3)}`);
    expect(held!.current).toBeNull();
    expect(held!.g.engine).toBeLessThan(quiet.engine * 0.3);
    expect(after.engine).toBeCloseTo(quiet.engine, 2);
  }, 60_000);
});
