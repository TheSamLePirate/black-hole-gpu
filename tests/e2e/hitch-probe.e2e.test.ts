import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { HITCH_PROBE } from "./lib/hitch-probe";
// The hitch probe's witnesses (PLAN-J7 J7-0, rule 3 of the method — a probe sees a defect injected and nothing in an A/A before its
// figures are used): the F-35 over the Rade d'Hyères under its autopilot (tiles off), the probe installed (lib/hitch-probe.ts). Positive:
// a 200 ms busy wait injected in a frame — seen as one gap of 200 ms or more, its cause the main thread. Negative: the same held flight
// watched 20 s, twice (A/A) — no gap over 100 ms either time, the counts of gaps over 50 ms alike.
// Duration: ~2 min on kerr-mini.
// Done when: both A/A windows watched and compared.
afterAll(stopServer);
type Probe = { gaps: { t: number; ms: number; causes: string[] }[]; frames: number; over50: number; over100: number; max: number };
const read = (app: App) =>
  app.js<Probe>(
    `(() => { const H = window.__hitch; return { gaps: H.gaps.slice(), frames: H.frames, over50: H.over50, over100: H.over100, max: +H.max.toFixed(1) }; })()`,
  );
describe.skipIf(!E2E)("J7-0: the hitch probe sees an injected stall and nothing in a held flight", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => { Object.assign(__bh.settings, { vessel: "f35", damage: false, dof: false, motionBlur: 0 }); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(43.06, 6.31, 500, 270, 140); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
      const c = __bh.camera; c.apSet({ ap: true, athr: true, alt: 500, hdg: 270 * Math.PI / 180, spd: 140 }); return 1; })()`);
    await app.settled(120_000);
    await app.js(HITCH_PROBE);
  }, 300_000);
  afterAll(() => app?.close());

  test("positive: a 200 ms wait injected in a frame — one gap of 200 ms or more, given to the main thread", async () => {
    await app.scenario("témoin positif : 200 ms injectées");
    const before = await read(app);
    await app.js(`window.__hitch.inject(200)`);
    // (judged 300 ms after the gap: a second's wait in the page)
    await app.js(`new Promise((q) => setTimeout(q, 1000))`);
    const after = await read(app);
    const fresh = after.gaps.slice(before.gaps.length);
    const big = fresh.filter((g) => g.ms >= 195);
    console.log(`  injected 200 ms: ${JSON.stringify(fresh)}`);
    expect(big.length).toBe(1);
    expect(big[0]!.causes.join(" ")).toMatch(/main thread (\d+)/);
    expect(Number(/main thread (\d+)/.exec(big[0]!.causes.join(" "))![1])).toBeGreaterThanOrEqual(150);
  }, 60_000);

  test("negative (A/A): a held flight watched 20 s twice — no gap over 100 ms, the gaps over 50 ms alike", async () => {
    await app.scenario("témoin négatif (A/A) : 2 × 20 s de vol tenu");
    const win: Probe[] = [];
    for (let k = 0; k < 2; k++) {
      const a = await read(app);
      await app.js(`new Promise((q) => setTimeout(q, 20000))`);
      const b = await read(app);
      win.push({
        gaps: b.gaps.slice(a.gaps.length),
        frames: b.frames - a.frames,
        over50: b.over50 - a.over50,
        over100: b.over100 - a.over100,
        max: b.max,
      });
    }
    console.log(`  A/A: ${JSON.stringify(win.map((w) => ({ frames: w.frames, over50: w.over50, over100: w.over100, gaps: w.gaps })))}`);
    await app.snap("remote-results/hitch-probe-temoin-negatif.png");
    for (const w of win) {
      expect(w.frames).toBeGreaterThan(200);
      expect(w.over100).toBe(0);
    }
    expect(Math.abs(win[0]!.over50 - win[1]!.over50)).toBeLessThanOrEqual(Math.max(3, 0.5 * Math.max(win[0]!.over50, win[1]!.over50)));
  }, 90_000);
});
