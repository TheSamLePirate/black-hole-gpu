import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T4: the score in the game — on Miller its piece and its tick (the film's 1.25 s), heard on the
// music bus; the music switched off: silence; in orbit round the Earth, nothing (silence by default).
// PLAN-J7 J7-8b: its rendered notes made in the CPU worker — the same samples as on the page (A/B; the A/A and a defect injected,
// its controls), a theme's start held for its first bar (its delay said), no note rendered on the page's thread as it plays.
// Duration: ~1 min on kerr-mini.
// Done when: the music switched off and silent, the last test.

describe.skipIf(!E2E)("the score at the great moments", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=Miller: Gargantua over the sea" });
    await app.waitFor("__bh.camera.piloting", 60_000);
    // (the sound starts with a key: the browser's rule)
    await app.press("KeyH", "h");
    await app.waitFor("__sound.ctx?.state === 'running'", 10_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  // (the notes the themes render most: piano, brass stabs, harp, timpani, taiko, organ, celesta)
  const JOBS = `[["piano", 1, 40, 0.6], ["horn", 0.3, 55, 0.8], ["trumpet", 0.3, 67, 0.5], ["harp", 1, 72, 0.5], ["timpani", 1, 43, 0.9],
    ["taiko", 0.5, 36, 0.8], ["organ", 0.25, 48, 0.6], ["celesta", 1, 84, 0.5], ["piano", 1, 30, 0.9]].map(([inst, dur, note, vel]) =>
    ({ inst, dur, note, vel, beat: NaN }))`;
  test("J7-8b: the worker's notes the page's — A/B the same samples; the A/A nothing; a sample changed, seen", async () => {
    await app.scenario("A/B des notes : page contre worker");
    const ab = await app.js<{ keys: number; here: number; missing: string[]; lengths: boolean; maxDiff: number }>(
      `__bh.music.abRender(${JOBS})`,
    );
    const aa = await app.js<typeof ab>(`__bh.music.abRender(${JOBS}, { where: "page" })`);
    const seen = await app.js<typeof ab>(`__bh.music.abRender(${JOBS}, { tamper: 0.01 })`);
    console.log(`  A/B ${JSON.stringify(ab)} · A/A ${JSON.stringify(aa)} · the defect injected ${JSON.stringify(seen)}`);
    expect(ab.keys).toBeGreaterThanOrEqual(9);
    expect(ab.missing).toEqual([]);
    expect(ab.lengths).toBe(true);
    expect(ab.maxDiff).toBe(0);
    expect(aa.maxDiff).toBe(0);
    expect(aa.keys).toBe(ab.here);
    expect(seen.maxDiff).toBeGreaterThan(0.009);
  }, 60_000);

  test("on Miller: its piece, the tick every 1.25 s, heard", async () => {
    await app.waitFor(`__bh.music.moment === "miller"`, 10_000);
    const t0 = await app.js<number>(`__bh.music.ticks`);
    await Bun.sleep(5000);
    const n = (await app.js<number>(`__bh.music.ticks`)) - t0;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    expect(await app.js<number>(`__sound.busLevels().music`)).toBeGreaterThan(-50);
  }, 30_000);

  test("J7-8b: a theme started — its notes from the worker, its start's delay, none rendered on the page as it plays", async () => {
    await app.scenario("un thème lancé : ses notes du worker");
    const r0 = await app.js<{ offThread: boolean; madeHere: number; adopted: number; startDelays: number[] }>(`__bh.music.rendering`);
    await app.js(`(__bh.music.listen("ascent"), true)`);
    await app.waitFor(`__bh.music.state().theme === "ascent"`, 5_000);
    await app.js(`new Promise((q) => setTimeout(q, 8000))`);
    const r1 = await app.js<typeof r0>(`__bh.music.rendering`);
    console.log(
      `  before ${JSON.stringify(r0)} · 8 s into « ascent » ${JSON.stringify(r1)} · notes ${await app.js<number>("__bh.music.notes")}`,
    );
    await app.js(`(__bh.music.listen(null), true)`);
    expect(r1.offThread).toBe(true);
    expect(r1.adopted).toBeGreaterThan(r0.adopted);
    // (what waiting for its first bar's notes added to its start — on the playing theme's next bar: 0.6 s at most)
    expect(r1.startDelays.at(-1)!).toBeLessThan(0.65);
    expect(r1.madeHere - r0.madeHere).toBe(0);
  }, 30_000);

  test("the music off: silence", async () => {
    await app.js(`(__bh.settings.music = false, true)`);
    await app.waitFor(`__bh.music.moment === null`, 5_000);
    // (its fade-out, 8 s, waited for to its end — what is checked —: not 9 s slept, 15 Nov 2026)
    await app.waitFor(`__sound.busLevels().music < -60`, 20_000);
    expect(await app.js<number>(`__sound.busLevels().music`)).toBeLessThan(-60);
    await app.js(`(__bh.settings.music = true, true)`);
  }, 30_000);
});
