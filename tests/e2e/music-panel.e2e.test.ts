import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The music system's console (ui/musicpanel.ts, audio/music.ts): opened from the toolbar, a theme listened to and
// heard on the music bus, its section and chord shown, the mixer's mute, the adaptive mode, back to the game's
// choice; every theme played a few seconds without an error. Captures `music-panel.png`.

describe.skipIf(!E2E)("the music panel", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1400, height: 900, hash: "scene=Earth: the Blue Marble" });
    await app.press("KeyH", "h");
    await app.waitFor("__sound.ctx?.state === 'running'", 10_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("open it, listen to a theme: heard, its section and chord shown", async () => {
    await app.click("#btn-music");
    await app.waitFor(`!document.querySelector('[data-testid=music-panel]').hidden`, 5000);
    await app.js(
      `(()=>{[...document.querySelectorAll('#music-pop .mp-theme')].find(b=>b.textContent.includes('Ascent')).click();return true})()`,
    );
    await app.waitFor(`__bh.music.state().theme === "ascent"`, 5000);
    await Bun.sleep(6000);
    expect(await app.js<number>(`__sound.busLevels().music`)).toBeGreaterThan(-45);
    const st = await app.js<{ playing: boolean; section: string; chord: number[] }>(`__bh.music.state()`);
    expect(st.playing).toBe(true);
    expect(st.section.length).toBeGreaterThan(0);
    expect(st.chord.length).toBeGreaterThan(1);
    await app.shot("remote-results/music-panel.png");
  }, 40_000);

  test("the mixer: the percussion muted, kept in the browser", async () => {
    await app.js(`(()=>{__bh.music.prefs.muted=["perc"];__bh.music.save();return true})()`);
    expect(await app.js<string>(`localStorage.getItem("kerr.music")`)).toContain("perc");
    await app.js(`(()=>{__bh.music.prefs.muted=[];__bh.music.save();return true})()`);
  });

  test("every theme plays a few seconds, no error; back to the game's choice: silence in orbit (moments mode)", async () => {
    const ids = await app.js<string[]>(`__bh.music.prefs.playlist`);
    for (const id of ids) {
      await app.js(`(__bh.music.listen(${JSON.stringify(id)}), true)`);
      await app.waitFor(`__bh.music.state().theme === ${JSON.stringify(id)}`, 8000);
      await Bun.sleep(2500);
    }
    await app.js(`(__bh.music.listen(null), true)`);
    await app.waitFor(`__bh.music.state().playing === false`, 10_000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
