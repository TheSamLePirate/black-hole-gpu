import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The game out of view — the tab put aside (audit 2026-11-10, AR-02, NET-14, TA-06; strategy §19.3; wave 4.2; Sam's choice of
// 13 Nov 2026): alone, the game paused and the pause said (how long it was out of view), nothing caught up; the game saved as
// it went out of view (a hidden tab may be thrown away by the browser). In a room nothing stops: the others told he is out
// of view, his ask of the room's pace not holding it meanwhile; back, his scene set on the room's hour and said. Before
// 13 Nov 2026: alone, the flight went on at the return as if nothing, nothing said, nothing saved; in a room, a pilot who
// had paused and put his tab aside held the whole room paused, the others told nothing. The page hidden by a second tab
// opened over it in the same Chrome (Target.createTarget), shown again by closing it.
// Done when: alone, the pause menu up at the return, its out-of-view line, the scene's time held; in a room, the others'
// warp back to ×1 while he is out of view, he marked so, and his scene on the room's hour at his return, said. Duration: ~2 min.

const hide = async (app: App) => (await app.cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
const show = async (app: App, id: string) => {
  await app.cdp.send("Target.closeTarget", { targetId: id });
  await app.waitFor(`document.visibilityState === "visible"`, 10_000);
};
const said = (app: App, from: number) => app.js<string[]>(`__bh.game.log.events.slice(${from}).map((e) => e.text)`);

describe.skipIf(!E2E)("the game out of view", () => {
  let a: App;
  let b: App;
  beforeAll(async () => {
    // (both pages up first, one after the other — their first compiles not over the room's test: on 13 Nov 2026 a second page
    // booted while the first flew on stood 4 min on its tracer's compile)
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 120_000);
    b = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await b.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 120_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("alone: paused while out of view, said at the return; nothing caught up; saved as it went", async () => {
    const log0 = await a.js<number>(`__bh.game.log.events.length`);
    // (the instants it went out of view and came back, the page's own: an autosave between them is the one made at hiding —
    // the loop's own, every 10 s, does not run while the page is hidden)
    await a.js(
      `(window.__vis = {}, document.addEventListener("visibilitychange", () => (window.__vis[document.visibilityState] = Date.now())), 1)`,
    );
    const t0 = await a.js<number>("__bh.time()");
    // (each autosave noted with the page's visibility as it was made: one made hidden is the one at the hiding — the loop's own,
    // every 10 s, runs only while the page draws)
    await a.js(`(() => { const g = __bh.game, f = g.autosaveNow.bind(g); window.__saves = [];
      g.autosaveNow = () => { window.__saves.push(document.visibilityState); return f(); }; return 1; })()`);
    const id = await hide(a);
    await a.waitFor(`document.visibilityState === "hidden"`, 10_000);
    await Bun.sleep(2500);
    await show(a, id);
    await Bun.sleep(1500);
    const r = await a.js<{ pause: boolean; away: string; t: number; saves: string[]; out: number; back: number }>(`({
      out: window.__vis.hidden ?? 0,
      back: window.__vis.visible ?? 0,
      pause: !!document.querySelector('[data-testid="pause"]'),
      away: document.querySelector('[data-testid="pause-away"]')?.textContent ?? "",
      t: __bh.time(),
      saves: window.__saves,
    })`);
    const lines = await said(a, log0);
    console.log(
      `  the pause menu up: ${r.pause}; its line: « ${r.away} »; scene time Δ ${(r.t - t0).toFixed(5)} M; autosaves (the page's visibility at each): ${JSON.stringify(r.saves)}; said: ${JSON.stringify(lines)}`,
    );
    await a.snap("remote-results/hidden-tab-solo.png");
    expect(r.pause).toBe(true);
    expect(r.away).toMatch(/\d+ s/);
    expect(r.saves).toContain("hidden");
    // (held at the return: the time the menu stood not run)
    const t1 = await a.js<number>("__bh.time()");
    await Bun.sleep(1000);
    expect(await a.js<number>("__bh.time()")).toBe(t1);
    // (what holds the flight, as the loop asks it: the pause — game/session.ts)
    expect(await a.js<string | null>("__bh.held()")).toBe("paused");
    // (resumed: Esc, the time runs again)
    await a.press("Escape");
    await a.waitFor(`!document.querySelector('[data-testid="pause"]')`, 5000);
    const t2 = await a.js<number>("__bh.time()");
    await Bun.sleep(800);
    expect(await a.js<number>("__bh.time()")).toBeGreaterThan(t2);
    expect(await a.js<string | null>("__bh.held()")).toBeNull();
  }, 60_000);

  test("in a room: nothing stops; the others told; his pause not holding the room; back, on the room's hour and said", async () => {
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Out of view")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await b.js(`__bh.net.join("${code}", "pilot")`);
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.net.net.clock.synced`, 20_000);
    const sb = await b.js<number>(`__bh.net.net.room.slot`);
    // Ben pauses: the room paused (the slowest ask)
    await b.js(`(__bh.settings.animate = false, 1)`);
    await a.waitFor(`__bh.net.net.roomWarp() === 0`, 10_000);
    const log0 = await a.js<number>(`__bh.game.log.events.length`);
    const id = await hide(b);
    await b.waitFor(`document.visibilityState === "hidden"`, 10_000);
    // (Ana: the room's pace back — his ask not holding it while he is away —, Ben marked out of view)
    const goesOn = await a
      .waitFor(`__bh.net.net.roomWarp() > 0 && __bh.net.net.room.members.some((m) => m.slot === ${sb} && m.away)`, 8000)
      .then(() => true)
      .catch(() => false);
    const toldA = await said(a, log0);
    const warpAway = await a.js<number>(`__bh.net.net.roomWarp()`);
    console.log(`  Ben out of view: the room's warp ${warpAway}; Ana told ${JSON.stringify(toldA)}`);
    await a.snap("remote-results/hidden-tab-room-ana.png");
    await Bun.sleep(3000);
    const logB = await b.js<number>(`__bh.game.log.events.length`);
    await show(b, id);
    await Bun.sleep(1500);
    const lagB = await b.js<number>(`__bh.net.session.lag`);
    const toldB = await said(b, logB);
    console.log(`  Ben back: his scene ${lagB.toFixed(2)} s off the room's; told ${JSON.stringify(toldB)}`);
    await b.snap("remote-results/hidden-tab-room-ben.png");
    await b.js(`(__bh.settings.animate = true, 1)`);
    expect(goesOn).toBe(true);
    expect(toldA.some((s) => /Ben/.test(s))).toBe(true);
    expect(Math.abs(lagB)).toBeLessThan(1);
    expect(toldB.some((s) => /room/i.test(s))).toBe(true);
  }, 90_000);
});
