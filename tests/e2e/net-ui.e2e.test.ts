import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The network's interface, shown (R8): the panel out of a room (a new one, joining one, one's rooms), in one (the
// room's card — its code, its link, its pace —, its tabs: the crew, the match, the voices, the screens), a speed-up
// offered (the card's Accept, the badge), a match's HUD (the countdown, the run, the ranking), the pause menu's
// item. Each step checked by its elements; NET_SHOTS=<dir>: each one pictured.

describe.skipIf(!E2E)("the network's interface", () => {
  let a: App;
  let b: App;
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/ui-${name}.png`);
  };
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "f35"; __bh.game.setDate("2067-06-21T16:30"); return 1; })()`);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("out of a room: a new one, joining one", async () => {
    await a.js(`(() => { __bh.net.open(); return 1; })()`);
    await a.waitFor(
      `!!document.querySelector("[data-testid=net-create]") && !!document.querySelector("[data-testid=net-join-code]")`,
      10_000,
    );
    await shot(a, "lobby");
    await a.click(`[data-testid="net-create"]`);
    await a.waitFor(`!!__bh.net.net?.room && !!document.querySelector("[data-testid=net-code]")`, 20_000);
  }, 60_000);

  test("in a room: its card, its tabs — the crew, the match, the voices, the screens", async () => {
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "f35"; return 1; })()`);
    await a.waitFor(`document.querySelectorAll("[data-testid=net-members] li").length === 2`, 20_000);
    await shot(a, "crew");
    for (const tab of ["match", "voice", "screens"]) {
      await a.click(`[data-testid="net-tab-${tab}"]`);
      await a.waitFor(`!!document.querySelector("[data-testid=net-pane-${tab}]")`, 5000);
      await Bun.sleep(400);
      await shot(a, tab);
    }
    expect(await a.js<boolean>(`!!document.querySelector("[data-testid=net-qr] svg")`)).toBe(true);
    await a.click(`[data-testid="net-tab-crew"]`);
  }, 300_000);

  test("a speed-up asked by Ben: offered on Ana's card and badge; Accept", async () => {
    await b.js(`(() => { __bh.game.warp(10); return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=net-warp-accept]") && !!document.querySelector(".nb-offer")`, 15_000);
    await shot(a, "offer");
    // (Ben on a runway: his ask held to the air's ×4)
    const offered = await a.js<number>(`__bh.net.session.offer.warp`);
    await a.click(`[data-testid="net-warp-accept"]`);
    await a.waitFor(`__bh.net.net.roomWarp() === ${offered}`, 10_000);
    await b.js(`(() => { __bh.game.warp(1); return 1; })()`);
    await a.waitFor(`__bh.net.net.roomWarp() === 1`, 10_000);
  }, 60_000);

  test("a match: started from the panel, its countdown, its run, the ranking", async () => {
    await a.click(`[data-testid="net-tab-match"]`);
    await a.waitFor(`!!document.querySelector("[data-testid=nm-start]")`, 5000);
    await a.click(`[data-testid="nm-start"]`);
    await a.waitFor(`__bh.net.match.phase === "countdown"`, 10_000);
    await Bun.sleep(1500);
    await shot(a, "countdown");
    await a.waitFor(`__bh.net.match.phase === "run"`, 20_000);
    await Bun.sleep(3000);
    await shot(a, "run");
    await a.js(`(() => { __bh.net.open(); return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=nm-stop]")`, 10_000);
    await shot(a, "match-running");
    await a.click(`[data-testid="nm-stop"]`);
    await a.waitFor(`__bh.net.match.phase === "over" && !document.querySelector(".nm-end").hidden`, 10_000);
    await Bun.sleep(500);
    await shot(a, "end");
    await a.js(`(() => { document.querySelector("[data-testid=nm-close]")?.click(); return 1; })()`);
  }, 120_000);

  test("the pause menu: the network's item says the room", async () => {
    await a.js(`(() => { __bh.net.closePanel(); return 1; })()`);
    await Bun.sleep(300);
    await a.press("Escape");
    await a.waitFor(`!!document.querySelector("[data-testid=pause-network]")`, 10_000);
    const hint = await a.js<string>(`document.querySelector("[data-testid=pause-network]").textContent`);
    console.log(`  pause item: ${hint}`);
    expect(hint).toContain(await a.js<string>(`__bh.net.net.room.code`));
    // (in a room the common clock does not stop: the pause says so and holds nothing — PLAN-TITRE-AAA E8)
    expect(await a.js<boolean>(`!!document.querySelector(".pz-root.live [data-testid=pause-live]")`)).toBe(true);
    const t0 = await a.js<number>("__bh.sim.time");
    await Bun.sleep(1500);
    expect(await a.js<number>("__bh.sim.time")).toBeGreaterThan(t0);
    await shot(a, "pause");
    await a.press("Escape");
  }, 30_000);
});
