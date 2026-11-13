import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// TARS's Deepgram voice played as it comes (audit 2026-11-10, TA-22): a long line said, its first sound heard on the
// voice bus (the engine's meter, `busLevels().voice`) — against the old way, which waited for the whole line before
// playing it (`voiceSynth`: the time to its end). Witnesses (method rule 3): a short line and a long one — the old wait
// grows with the line, the new first sound does not; two long lines alike. Only with a Deepgram key (the dev relay,
// .env).
// Done when: the long lines' first sound heard under half the old wait (over 4 s), no gap between their parts.
// Duration: ~60 s.

const KEY = !!process.env.DEEPGRAM_API_KEY;
process.env.KERR_EAR_RELAY = "1";

const SHORT = ["Orbite stable, Cooper.", "Orbite stable, Brand."];
const LONG = [
  "Cooper, le carburant tient jusqu'à la Lune et retour avec une marge de douze pour cent, tant que nous gardons cette attitude et que la poussée reste nominale sur les deux moteurs principaux.",
  "Brand, le carburant tient jusqu'à la Lune et retour avec une marge de onze pour cent, tant que nous gardons cette attitude et que la poussée reste nominale sur les deux moteurs principaux.",
];
const VOICE = "aura-2-hector-fr";

describe.skipIf(!E2E || !KEY)("TARS's voice played as it comes", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 720, lang: "fr", hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.sound = true, __bh.settings.tarsRemarks = false, true)`);
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** the new way: asked, then the first sound heard on the voice bus [ms] */
  const firstHeard = (text: string) =>
    app.js<number>(`(async () => {
      // (the bus quiet first: the line before's tail is not this one's first sound)
      for (let i = 0; i < 300 && (__sound.busLevels().voice ?? -Infinity) > -70; i++) await new Promise((r) => setTimeout(r, 10));
      const t0 = performance.now();
      let at = -1;
      const watch = setInterval(() => { if (at < 0 && (__sound.busLevels().voice ?? -Infinity) > -50) at = performance.now() - t0; }, 10);
      await __bh.tars.voiceSay(${JSON.stringify(text)}, "${VOICE}");
      clearInterval(watch);
      return Math.round(at);
    })()`);
  /** the old way: the whole line's sound waited for [ms] (a text not said yet: not kept) */
  const whole = (text: string) =>
    app.js<number>(
      `(async () => { const t0 = performance.now(); await __bh.tars.voiceSynth(${JSON.stringify(text)}, "${VOICE}"); return Math.round(performance.now() - t0); })()`,
    );

  test("the first sound heard long before the whole line came", async () => {
    // (the old wait, on lines not yet said: then kept, so the new way is measured on others)
    const oldShort = await whole(`${SHORT[0]} `);
    const oldLong = await whole(`${LONG[0]} `);
    const gaps0 = await app.js<number>(`__sound.voiceGaps`);
    const newShort = await firstHeard(SHORT[1]!);
    const newLong = [await firstHeard(LONG[0]!), await firstHeard(LONG[1]!)];
    const gaps = (await app.js<number>(`__sound.voiceGaps`)) - gaps0;
    console.log(
      `  old (whole line waited): short ${oldShort} ms, long ${oldLong} ms\n  new (first sound heard): short ${newShort} ms, long ${newLong.join(" / ")} ms; gaps heard ${gaps}`,
    );
    // (played part by part without a hole)
    expect(gaps).toBe(0);
    expect(newShort).toBeGreaterThan(0);
    expect(Math.min(...newLong)).toBeGreaterThan(0);
    // witnesses: the old wait grows with the line (a short and a long one); the new first sound does not — two long lines
    // alike both under half the old wait (Deepgram's first part varies from one request to the next: 0.7–2 s measured)
    expect(oldLong - oldShort).toBeGreaterThan(2000);
    expect(oldLong).toBeGreaterThan(4000);
    expect(Math.max(...newLong)).toBeLessThan(oldLong / 2);
  }, 120_000);
});
