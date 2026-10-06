import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The handovers (C8) by real input, for each autopilot where it flies: engaged, then F4 — assisted, the
// director out, the autopilot still engaged, the throttle the pilot's from where the engine was; F4 again —
// the autopilot flies, no director; and again, with the card's own button. Each from a place the game's
// tools set up (the take-off from the Cape, the landing and the hold over the Moon, CIRC and a node in orbit,
// the entry's glide onto Kennedy).

const CASES: { name: string; setup: string; key: [string, string, boolean?]; auto: string }[] = [
  { name: "hold position", setup: `__bh.game.orbit("earth", { peKm: 400, apKm: 400 })`, key: ["Digit8", "8"], auto: "hover" },
  // (CIRC flies its burn as a node — the hub's CIRC lit —: the pilot's real time, its burn half an hour ahead,
  // so the node is still coasting through the hand-overs)
  {
    name: "circularize",
    setup: `__bh.game.orbit("earth", { peKm: 300, apKm: 600, nu: 60 }), __bh.camera.setWarpAuthority(false), __bh.game.warp(1)`,
    key: ["Digit9", "9"],
    auto: "node",
  },
  { name: "take-off", setup: `__bh.game.land("earth", 28.573, -80.649)`, key: ["KeyU", "u"], auto: "takeoff" },
  { name: "landing", setup: `__bh.game.near("moon", { altKm: 3 })`, key: ["KeyG", "g"], auto: "land" },
  { name: "entry's glide", setup: `__bh.game.glideTo("Kennedy", 40, 6, 220)`, key: ["", ""], auto: "entry" },
];

describe.skipIf(!E2E)("auto ⇄ assisted for every autopilot", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  for (const c of CASES)
    test(c.name, async () => {
      await app.js(`(__bh.camera.pilot.assist = false, __bh.camera.setWarpAuthority(true), ${c.setup}, true)`);
      await Bun.sleep(1500);
      if (c.key[0]) await app.press(c.key[0], c.key[1], { shift: !!c.key[2] });
      await app.waitFor(`__bh.camera.pilot.auto === ${JSON.stringify(c.auto)}`, 10_000);
      await Bun.sleep(1500);
      expect(await app.js<boolean>("!!__bh.camera.pilot.director")).toBe(false);
      // assisted: the director out, the autopilot kept, the throttle where the engine was
      const engine = await app.js<number>("__bh.camera.pilot.engineNow");
      await app.press("F4", "F4");
      await app.waitFor("!!__bh.camera.pilot.director", 5_000);
      expect(await app.js<string>("__bh.camera.pilot.auto")).toBe(c.auto);
      expect(Math.abs((await app.js<number>("__bh.camera.pilot.throttle")) - engine)).toBeLessThan(0.15);
      // the card says so, and gives it back
      await app.waitFor(`document.querySelector("[data-testid=hub-assist]")?.textContent === "ASSISTED"`, 5_000);
      await app.click("[data-testid=hub-assist]");
      await app.waitFor("!__bh.camera.pilot.director", 5_000);
      expect(await app.js<boolean>("__bh.camera.pilot.assist")).toBe(false);
      expect(await app.js<string>("__bh.camera.pilot.auto")).toBe(c.auto);
      // (and F4 both ways once more)
      await app.press("F4", "F4");
      await app.waitFor("!!__bh.camera.pilot.director", 5_000);
      await app.press("F4", "F4");
      await app.waitFor("!__bh.camera.pilot.director", 5_000);
    }, 120_000);
});
