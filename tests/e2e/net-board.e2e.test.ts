import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX N4: the room's challenges and board, two browsers, both in Rangers — Ana proposes "docking against
// the clock" to the room from the challenges panel (real clicks): both set at the same start, Ben's card accepted;
// each a ghost to the other while both fly it. Their results — Ben's done in a few seconds (his goal eased), Ana's
// time up — told to the room: the Results tab ranks them, Ben first. (NET_SHOTS=<dir>: the proposal, the board.) ~2 min.

describe.skipIf(!E2E)("the room's challenges and board (N4)", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "ranger"; return 1; })()`);
    await a.js(`__bh.net.create("Board")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await b.waitFor(`__bh.net.net.clock.synced`, 30_000);
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ana proposes the challenge to the room; Ben accepts: both on it, ghosts to each other", async () => {
    await a.js(`(__bh.flight.spaceChallenges.open(), 1)`);
    await a.waitFor(`!!document.querySelector('[data-testid="space-chal-room-dock-clock"]')`, 5000);
    await a.click('[data-testid="space-chal-room-dock-clock"]');
    await b.waitFor(`!!document.querySelector('[data-testid="net-rchal"]')`, 10_000);
    const ask = await b.js<string>(`document.querySelector('[data-testid="net-rchal"] p').textContent`);
    expect(ask).toBe("Ana proposes a room challenge: Challenge · Docking against the clock");
    await shot(b, "n4-proposal");
    await b.click('[data-testid="net-rchal-yes"]');
    await a.waitFor(`__bh.camera.spaceChal?.C.id === "dock-clock"`, 30_000);
    await b.waitFor(`__bh.camera.spaceChal?.C.id === "dock-clock"`, 30_000);
    await a.waitFor(`__bh.net.session.roomChal?.slots.size === 2`, 10_000);
    // (the same start: each a ghost to the other — nothing to strike, nothing to dock to)
    await b.waitFor(`!__bh.net.session.ships.some((s) => s.slot === ${sa} && !s.ghost)`, 10_000);
    await a.waitFor(`!__bh.net.session.ships.some((s) => s.slot === ${sb} && !s.ghost)`, 10_000);
  }, 90_000);

  test("their results told to the room: the Results tab ranks Ben (done) before Ana (time up)", async () => {
    // (Ben's goal eased to a few seconds — his result, its medal, told as any; Ana's clock run out)
    await b.js(`(() => { const R = __bh.camera.spaceChal; R.C = { ...R.C, goal: { time: 2 } }; return 1; })()`);
    await b.waitFor(`__bh.camera.spaceChal === null`, 30_000);
    await a.js(`(() => { __bh.camera.spaceChal.t = 1e6; return 1; })()`);
    await a.waitFor(`__bh.camera.spaceChal === null`, 10_000);
    await a.waitFor(`__bh.net.session.results.filter((r) => r.ref === "challenge:dock-clock").length === 2`, 10_000);
    await a.js(`(__bh.net.openTab("results"), 1)`);
    await a.waitFor(`!!document.querySelector('[data-testid="net-board-challenge_dock-clock"]')`, 5000);
    const rows = await a.js<string[]>(
      `[...document.querySelectorAll('[data-testid="net-board-challenge_dock-clock"] li')].map((l) => l.textContent)`,
    );
    console.log(`  ${rows.join(" ‖ ")}`);
    expect(rows[0]).toMatch(/^1\.Ben.*20\.0\/20 · 🥇/);
    expect(rows[1]).toMatch(/^2\.Ana.*0\.0\/20/);
    // (both done: no ghosts left)
    await a.waitFor(`__bh.net.session.roomChal.slots.size === 0`, 5000);
    await shot(a, "n4-board");
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors).toEqual([]);
  }, 90_000);
});
