import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A pilot's message in the journal once (PROBLEMES, 13 Nov 2026 — « le toucher dit deux fois dans la page »): the message was
// shown as a toast — the toast writes every message to the journal, as « info », with no time — and then written again as the
// pilot's, with its time. The controller's own message hook, a word of the pilot's; then a landing (the Lander put down by its
// autopilot beside Kennedy).
// Done when: each message is in the journal once, the pilot's, with its time.
// Duration: ~1 min.

describe.skipIf(!E2E)("the pilot's messages in the journal once", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const lines = (re: string) =>
    app.js<string[]>(
      `__bh.game.log.events.filter((e) => /${re}/.test(e.text)).map((e) => e.kind + " " + (Number.isFinite(e.t) ? "t" : "no-time"))`,
    );

  test("a word of the pilot's, a touchdown: each once in the journal", async () => {
    await app.js(`(__bh.camera.onPilotMessage("Journal probe 42"), 1)`);
    await Bun.sleep(200);
    const word = await lines("Journal probe 42");
    const landed = await app.js<boolean>(`(() => {
      __bh.freeze(true);
      __bh.settings.vessel = "lander";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.hoverOver("earth", 28.6, -80.6, 0.3);
      const c = __bh.camera;
      c.pilot.auto = "none"; c.pilot.setAuto("land");
      for (let i = 0; i < 30 * 200 && !c.ourLanded && !c.airFlight.failure; i++) __bh.step(1 / 30);
      __bh.freeze(false);
      return !!c.ourLanded; })()`);
    await Bun.sleep(300);
    const td = await lines("Touchdown on");
    console.log(`  the word: [${word.join(", ")}] · the touchdown (landed ${landed}): [${td.join(", ")}]`);
    expect(word).toEqual(["pilot t"]);
    expect(landed).toBe(true);
    expect(td).toEqual(["pilot t"]);
  }, 120_000);
});
