import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R3: a battle between two pages — Ana starts an "everyone for himself" match from the room panel
// (real clicks); at the countdown's end both F-35s are put on the arena's ring, head-on 16 km apart; Ben locks
// Ana (Tab), picks the AIM-120 (=) and fires it (Enter): Ana's helmet warns of it, it hits her, she is shot down
// — said to all, the kill Ben's on both score sheets —, and flies again 5 s later; the host ends the match: the
// ranking on both screens. (NET_SHOTS=<dir>: both views pictured: the missile flying, the end.)

describe.skipIf(!E2E)("a battle", () => {
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
    await a.js(`(() => { __bh.game.setDate("2067-06-21T16:30"); __bh.net.setName("Ana"); __bh.settings.vessel = "f35"; return 1; })()`);
    await a.js(`__bh.net.create("Battle")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "f35"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    for (const p of [a, b]) await p.js(`(() => { for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("the match started from the panel: a countdown on both, then both on the ring, head-on", async () => {
    await a.js(`(() => { __bh.net.open(); return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=nm-start]")`, 10_000);
    await a.click(`[data-testid="nm-start"]`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.phase === "countdown"`, 10_000);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.phase === "run" && !!__bh.camera.combat?.net`, 20_000);
    for (const p of [a, b])
      await p.js(
        `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "chase"; return 1; })()`,
      );
    await Bun.sleep(1500);
    const d = await a.js<number>(`Math.hypot(...__bh.renderer.netOthers[0].rel)`);
    console.log(`  Ana and Ben ${(d / 1000).toFixed(1)} km apart`);
    expect(d).toBeGreaterThan(12_000);
    expect(d).toBeLessThan(18_000);
    expect(await a.js<boolean>(`__bh.camera.combat.world.targets.some((q) => q.peer === ${sb})`)).toBe(true);
  }, 60_000);

  test("Ben: Tab locks Ana, = the AIM-120, Enter fires it — Ana's helmet warns of it", async () => {
    await b.press("Tab");
    await b.waitFor(`__bh.camera.combat.world.lock === ${10_000 + sa}`, 5000);
    await b.press("Equal", "=");
    expect(await b.js<string>(`__bh.camera.combat.weapon`)).toBe("aim120");
    await b.press("Enter");
    await b.waitFor(`__bh.camera.combat.world.ownMissiles().length === 1`, 5000);
    await a.waitFor(`__bh.camera.combatHud((v) => v).threats.length > 0`, 10_000);
    const r = await a.js<number>(`__bh.camera.combatHud((v) => v).threats[0].dist`);
    console.log(`  Ana's helmet: missile at ${(r / 1000).toFixed(1)} km`);
    await Bun.sleep(1500);
    await shot(b, "battle-b-fox3");
    await shot(a, "battle-a-warning");
  }, 60_000);

  test("the AIM-120 hits Ana: shot down, the kill Ben's on both sheets; she flies again", async () => {
    await a.waitFor(`__bh.camera.combat.downAt !== null`, 60_000);
    for (const p of [a, b])
      await p.waitFor(`__bh.net.match.sheet.row(${sb}).kills === 1 && __bh.net.match.sheet.row(${sa}).deaths === 1`, 10_000);
    console.log(`  ${await b.js<string>(`[...document.querySelectorAll(".nm-feed-row")].map((e) => e.textContent).join(" | ")`)}`);
    await a.waitFor(`__bh.camera.combat.downAt === null`, 15_000);
    expect(await a.js<number>(`__bh.camera.combat.world.damage`)).toBe(0);
  }, 90_000);

  test("the host ends the match: the ranking on both screens, Ben first", async () => {
    await a.js(`(() => { __bh.net.match.stop(); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.phase === "over" && !document.querySelector(".nm-end").hidden`, 10_000);
    const first = await b.js<string>(`document.querySelector(".nm-rank li b").textContent`);
    console.log(`  ranking: ${await b.js<string>(`[...document.querySelectorAll(".nm-rank li")].map((e) => e.textContent).join(" | ")`)}`);
    expect(first).toBe("Ben");
    await shot(b, "battle-b-end");
  }, 30_000);
});
