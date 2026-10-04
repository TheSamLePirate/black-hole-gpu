import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The deorbit and the entry assisted (C3) by real input: ⇧G assisted plans the deorbit; at its countdown
// the pilot holds retrograde (2), lights the engine (Z) and cuts it at the cue (X) — the Δv followed as for a
// node; then the entry's graph is its corridor in the height–speed plane with the guidance's predicted fall,
// and, handed to the autopilot, the director gives the bank and its side through the air.

describe.skipIf(!E2E)("the deorbit and the entry assisted", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the deorbit burned by hand to its cue, then the entry in its corridor", async () => {
    await app.js(`__bh.game.orbit("earth", { peKm: 400, apKm: 400, inc: 35 })`);
    await app.press("F4", "F4");
    await app.press("KeyG", "G", { shift: true });
    await app.waitFor(`__bh.camera.entryRun?.phase === "wait"`, 60_000);
    expect(await app.js<string>("__bh.camera.hubInfo().graph.kind")).toBe("burn");
    await app.waitFor(`(() => { const c = __bh.camera.hubInfo()?.cue; return c && c.tIgn < 8; })()`, 420_000);
    await app.press("Digit2", "2");
    await app.waitFor(`__bh.camera.entryRun?.phase === "burn"`, 30_000);
    // (nothing flown until the pilot lights it)
    await Bun.sleep(500);
    expect(await app.js<number>("__bh.camera.entryRun.done")).toBeLessThan(0.5);
    await app.press("KeyZ", "z");
    await app.waitFor(`__bh.camera.hubInfo()?.cue?.cut`, 120_000);
    await app.press("KeyX", "x");
    await app.waitFor(`__bh.camera.entryRun?.phase === "entry"`, 30_000);
    const R = await app.js<{ done: number; dv: number }>(`({ done: __bh.camera.entryRun.done, dv: __bh.camera.entryRun.dv })`);
    expect(Math.abs(R.done - R.dv) / R.dv).toBeLessThan(0.08);
    // the entry: its corridor, the predicted fall in it
    await app.press("Digit2", "2");
    await app.click("[data-testid=hub-assist]");
    await app.waitFor(`__bh.camera.hubInfo()?.graph?.kind === "entry" && __bh.camera.hubInfo().graph.ideal.length > 10`, 120_000);
    const G = await app.js<{ lo: number; hi: number; state: string }>(
      `(() => { const g = __bh.camera.hubInfo().graph; return { lo: g.lo.length, hi: g.hi.length, state: g.state }; })()`,
    );
    expect(G.lo).toBeGreaterThan(20);
    expect(G.hi).toBe(G.lo);
    expect(G.state).not.toBe("off");
    // through the air (the autopilot flying): the bank and its side said
    await app.waitFor(`__bh.game.status().altKm < 95`, 300_000);
    await app.press("F4", "F4");
    const say = await app.js<string[]>("__bh.camera.hubInfo().say");
    expect(say.some((l) => /^BANK \d+°/.test(l))).toBe(true);
    await app.press("F4", "F4");
  }, 900_000);
});
