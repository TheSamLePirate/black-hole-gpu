import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// V through the views (audit 2026-11-10, FX-08): before 13 Nov 2026 the key went through every attach point of the table
// (`Object.keys(MOUNTS)`), the A320's own among them — on the Ranger, three presses of V said « Camera: Main gear… » and
// showed the chase view; the pad's D-pad went through the craft's own (`mountKeys()`). The Ranger flown, V pressed round
// the cycle, by real key events; then the A320, its own views met.
// Done when: on the Ranger no A320 view comes up, every view met is the Ranger's; on the A320 its window, gear and fin views do.
// Duration: ~40 s.

describe.skipIf(!E2E)("V through the craft's own views", () => {
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

  /** V pressed n times: the views met, in order (the spectator's turn counted as « spectator ») */
  const cycle = async (n: number) => {
    const met: string[] = [];
    for (let i = 0; i < n; i++) {
      await app.press("KeyV");
      await Bun.sleep(120);
      met.push(await app.js<string>(`__bh.camera.spectating ? "spectator" : __bh.settings.shipMount`));
    }
    return met;
  };

  test("the Ranger: no A320 view; the A320: its own", async () => {
    const all = await app.js<number>(`Object.keys(__bh.mounts?.MOUNTS ?? {}).length || 30`);
    const ranger = await cycle(all + 2);
    console.log(`  the Ranger, V × ${all + 2}: ${ranger.join(" → ")}`);
    await app.js(`(() => { __bh.settings.vessel = "a320"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    const a320 = await cycle(all + 2);
    console.log(`  the A320, V × ${all + 2}: ${a320.join(" → ")}`);
    for (const own of ["passenger", "gear", "tail"]) expect(ranger).not.toContain(own);
    for (const own of ["passenger", "gear", "tail"]) expect(a320).toContain(own);
  }, 120_000);
});
