import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A burn flown by hand, assisted (C1), by real input: CIRC assisted plans its burn at the apoapsis, the
// time slows to real for its countdown; the pilot holds prograde (1) and lights it (Z), the Δv left follows the thrust given
// along the burn, the graph beside the hub shows it on its profile; at the cue the pilot cuts (X) — the
// Δv given is the burn's, the orbit flown the circle asked.

describe.skipIf(!E2E)("a burn flown by hand, assisted", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("CIRC assisted: counted down, lit by hand, its Δv followed, cut at the cue — circular", async () => {
    // (an orbit 300 × 420 km, the apoapsis a few minutes ahead)
    await app.js(`__bh.game.orbit("earth", { peKm: 300, apKm: 420, inc: 20, nu: 165 })`);
    await app.press("F4", "F4");
    expect(await app.js<boolean>("__bh.camera.pilot.assist")).toBe(true);
    const sp0 = await app.js<number>("__bh.camera.spent");
    await app.press("Digit9", "9");
    // its burn planned: the hub's card counts down to it, the graph beside it
    await app.waitFor(`!!__bh.camera.hubInfo()?.cue`, 30_000);
    expect(
      await app.js<boolean>(`!!document.querySelector("[data-testid=assist-graph]") && !document.querySelector(".fl-hub-graph").hidden`),
    ).toBe(true);
    // the pilot points the nose: CIRC's burn at the apoapsis is prograde (1: hold prograde)
    await app.press("Digit1", "1");
    // (the last seconds before the ignition: the time no faster than real — a countdown to follow)
    await app.waitFor(`(() => { const c = __bh.camera.hubInfo()?.cue; return c && c.tIgn < 8; })()`, 180_000);
    const dv = await app.js<number>("__bh.camera.hubInfo().cue.dv");
    expect(dv).toBeGreaterThan(5);
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.burning`, 30_000);
    // nothing flown yet: the ship waits for its pilot
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    // (the cue's moment and the cut's, each frame, the cue fresh — not the card's four refreshes a second:
    // what the pilot's reaction adds after the cue is the burn's own, not the cue's error)
    await app.js(`(() => {
      const c = __bh.camera;
      window.__cut = { cue: null, cut: null };
      const w = () => {
        c.hubCache = null;
        if (window.__cut.cue === null && c.hubInfo()?.cue?.cut) window.__cut.cue = c.spent;
        if (window.__cut.cue !== null && window.__cut.cut === null && c.pilot.throttle <= 0) window.__cut.cut = c.spent;
        if (window.__cut.cut === null) requestAnimationFrame(w);
      };
      requestAnimationFrame(w);
      return true;
    })()`);
    await app.press("KeyZ", "z");
    await app.waitFor(`__bh.camera.pilot.throttle > 0.99`);
    // the Δv left falls as the pilot burns; the cue says cut once it is delivered
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.left < ${dv} * 0.8`, 60_000);
    expect(await app.js<string>(`document.querySelector(".fl-hub-graph").dataset.state`)).not.toBe("wait");
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.cut`, 120_000);
    await app.press("KeyX", "x");
    // the burn done (the node gone), the engine run down: the Δv given is the burn's — the cue came as
    // early as the engine's run-down
    await app.waitFor(`!__bh.camera.plan.nodes.length`, 30_000);
    await app.waitFor(`__bh.camera.pilot.engineNow < 0.01`, 30_000);
    const given = (await app.js<number>(`__bh.camera.spent - ${sp0}`)) * 299792458;
    // (the Δv the pilot gave between the cue and the cut — their reaction, a poll here: some 0.1–0.2 s at
    // 2 g on a slow machine —, given back; the rest the cue's own error, the engine's run-down included:
    // 1.8 % on the mini, five runs in a row — the 18 % of the run-down unanticipated is far off)
    const late = (await app.js<number>("window.__cut.cut - window.__cut.cue")) * 299792458;
    expect(late).toBeGreaterThanOrEqual(0);
    expect(Math.abs(given - late - dv) / dv).toBeLessThan(0.03);
    await app.press("Digit9", "9");
    // the circle as flown over a revolution (fixed steps at ×30): its radius within a few km — the
    // osculating apsides of a circle there stand ~17 km apart, the Earth's oblateness's, not the burn's
    const r = await app.js<{ lo: number; hi: number }>(`(() => {
      const c = __bh.camera, h = () => { const f = c.fcContext(); return (Math.hypot(...f.ctx.r) - f.ctx.R) / 1e3; };
      __bh.freeze(true);
      __bh.game.warp(30);
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 6000; k++) {
        __bh.step(1 / 30);
        if (k % 5 === 0) (lo = Math.min(lo, h())), (hi = Math.max(hi, h()));
      }
      __bh.freeze(false);
      return { lo, hi };
    })()`);
    expect(r.hi - r.lo).toBeLessThan(5);
    expect(Math.abs((r.hi + r.lo) / 2 - 420)).toBeLessThan(5);
  }, 420_000);
});
