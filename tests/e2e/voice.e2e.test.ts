import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T1: the voices on the page — a line said shows its subtitle and its speaker; a more urgent line
// cuts the one being said; mission control's by radio; the subtitles off, none shown. The voice off here (its
// lines then last their reading time: the same rhythm on every machine, with or without system voices).

describe.skipIf(!E2E)("the voices and their subtitles", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(__bh.settings.voice = false, __bh.settings.subtitles = true, true)`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const sub = () =>
    app.js<{ on: boolean; who: string; text: string; speaker: string; radio: boolean }>(`(() => {
      const e = document.querySelector("[data-testid=subtitles]");
      return { on: e.classList.contains("on"), who: e.querySelector("small").textContent, text: e.querySelector("span").textContent,
        speaker: e.dataset.speaker ?? "", radio: e.classList.contains("radio") };
    })()`);

  test("said: its subtitle and speaker; a more urgent line cuts it; then the rest, in order", async () => {
    await app.js(`(__bh.voice.stop(), __bh.voice.say({ text: "Ranger, Houston, you are go for entry.", speaker: "mission", priority: 2, radio: true }),
      __bh.voice.say({ text: "Fuel is fine. Probably.", speaker: "tars", priority: 3 }), true)`);
    let s = await sub();
    expect(s.on).toBe(true);
    expect(s.text).toContain("go for entry");
    expect(s.speaker).toBe("mission");
    expect(s.radio).toBe(true);
    await app.js(`(__bh.voice.say({ text: "Sink rate!", speaker: "callout", priority: 0, id: "sink" }), true)`);
    s = await sub();
    expect(s.text).toBe("Sink rate!");
    expect(s.who).toBe("RANGER");
    // (then the rest: TARS's after the callout — the cut line is not said again)
    await app.waitFor(`document.querySelector("[data-testid=subtitles] span").textContent.includes("Probably")`, 8_000);
    expect(await app.js<string[]>(`__bh.voice.said.slice(-3).map((x) => x.speaker)`)).toEqual(["mission", "callout", "tars"]);
    await app.waitFor(`!document.querySelector("[data-testid=subtitles]").classList.contains("on")`, 8_000);
  }, 30_000);

  test("the subtitles off: a line said, none shown", async () => {
    await app.js(`(__bh.settings.subtitles = false, __bh.voice.say({ text: "Nothing to see.", speaker: "tars", priority: 3 }), true)`);
    await Bun.sleep(200);
    expect((await sub()).on).toBe(false);
    expect(await app.js<string>(`__bh.voice.said.at(-1).text`)).toBe("Nothing to see.");
    await app.js(`(__bh.settings.subtitles = true, __bh.voice.stop(), true)`);
  });
});
