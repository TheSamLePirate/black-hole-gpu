import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T5a: TARS's robot voice in the game (the interface in English): a line of his is synthesized and
// played on the voice bus — heard, its subtitle shown —, the queue waits for its end; a more urgent line cuts
// it at once.

describe.skipIf(!E2E)("TARS's robot voice", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.press("KeyH", "h");
    await app.waitFor("__sound.ctx?.state === 'running'", 10_000);
    await app.js(
      `(document.documentElement.lang === "en" || localStorage.setItem("kerr.lang", JSON.stringify("en")), __bh.settings.voice = true, true)`,
    );
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("said by the robot: heard on the voice bus, the queue holding till its end; cut by a callout", async () => {
    // (the page's language: English — the robot speaks English only)
    expect(await app.js<string>(`document.documentElement.lang`)).toBe("en");
    await app.js(
      `(__bh.voice.stop(), window.__t0 = performance.now(), __bh.voice.say({ text: "Honesty setting at ninety percent. Humour at seventy five.", speaker: "tars", priority: 3 }), true)`,
    );
    await Bun.sleep(900);
    const mid = await app.js<{ v: number; current: string | null }>(
      `({ v: __sound.busLevels().voice, current: __bh.voice.queue.current?.speaker ?? null })`,
    );
    expect(mid.current).toBe("tars");
    expect(mid.v).toBeGreaterThan(-45);
    // (said to its end: 4–6 s for these two sentences)
    await app.waitFor(`!__bh.voice.queue.current`, 12_000);
    const ms = await app.js<number>(`performance.now() - window.__t0`);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(8000);
    // (a callout cuts him: the robot's voice stopped at once)
    await app.js(`(__bh.voice.say({ text: "Ninety percent of what, exactly, I cannot say.", speaker: "tars", priority: 3 }), true)`);
    await Bun.sleep(600);
    await app.js(`(__bh.voice.say({ text: "Sink rate!", speaker: "callout", priority: 0 }), true)`);
    await Bun.sleep(400);
    expect(await app.js<string | null>(`__bh.voice.queue.current?.speaker ?? null`)).toBe("callout");
    expect(await app.js<boolean>(`!!__sound.robotSrc`)).toBe(false);
  }, 60_000);
});
