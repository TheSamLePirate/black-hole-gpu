import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runBot } from "../../src/net/bot";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R0: the solo game never touches the network; a room created from the pause menu (real clicks
// and keys), a second page joining by the room's link, the bot flying in it; the members on both, the clock
// the same on both, the bot's samples read back moving; the second page leaving.

describe.skipIf(!E2E)("the network's rooms", () => {
  let a: App;
  let b: App | null = null;
  let bot: Awaited<ReturnType<typeof runBot>> | null = null;
  let code = "";
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
  }, 180_000);
  afterAll(() => {
    bot?.stop();
    b?.close();
    a?.close();
    stopServer();
  });

  test("solo: the network's code never loaded, nothing asked of a server", async () => {
    const r = await a.js<{ loaded: boolean; res: string[] }>(
      `({ loaded: __bh.net.loaded, res: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /net\\.js|\\/net\\b|samlepirate/.test(n)) })`,
    );
    expect(r.loaded).toBe(false);
    expect(r.res).toEqual([]);
  });

  test("a room created from the pause menu: its code shown, the badge up", async () => {
    await a.press("Escape");
    await a.waitFor(`!!document.querySelector("[data-testid=pause-network]")`, 5000);
    await a.click(`[data-testid="pause-network"]`);
    await a.waitFor(`!!document.querySelector("[data-testid=net-panel]")`, 5000);
    await a.click(`[data-testid="net-name"]`);
    await a.type("Ana");
    await a.click(`[data-testid="net-create"]`);
    await a.waitFor(`!!document.querySelector("[data-testid=net-code]")`, 15_000);
    code = await a.js<string>(`document.querySelector("[data-testid=net-code]").textContent`);
    console.log(`  room ${code}`);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await a.js<boolean>(`__bh.net.loaded && !document.querySelector("[data-testid=net-badge]").hidden`)).toBe(true);
    expect(await a.js<string>(`__bh.net.net.room.members[0].name`)).toBe("Ana");
  }, 60_000);

  test("a second page by the link, the bot flying: three members on both, one clock", async () => {
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}"`, 60_000);
    await b.waitFor("__bh.camera.piloting", 60_000);
    bot = await runBot({ url: new URL("/net", a.url).href.replace(/^http/, "ws"), room: code, name: "Bot" });
    for (const p of [a, b]) await p.waitFor(`__bh.net.net.room.members.length === 3`, 10_000);
    const names = await a.js<string[]>(`[...document.querySelectorAll("[data-testid=net-members] li")].map((l) => l.textContent)`);
    console.log(`  members: ${names.join(" · ")}`);
    expect(names.length).toBe(3);
    // (each page's guess of the server's clock, against its own wall clock: one machine, the same within a few ms)
    // (both pages settled — the second one's loading slowed its first exchanges)
    await Bun.sleep(6000);
    const skew = `(() => { const n = __bh.net.net; return { date: n.clock.serverNow(performance.now()) - Date.now(), origin: n.clock.serverNow(performance.now()) - (performance.timeOrigin + performance.now()), n: n.clock.count, rtt: n.clock.rtt, jit: n.clock.jitter }; })()`;
    await a.waitFor(`__bh.net.net.clock.synced`, 10_000);
    await b.waitFor(`__bh.net.net.clock.synced`, 10_000);
    type Skew = { date: number; origin: number; n: number; rtt: number; jit: number };
    const [ka, kb] = [await a.js<Skew>(skew), await b.js<Skew>(skew)];
    for (const [w, k] of [
      ["A", ka],
      ["B", kb],
    ] as const)
      console.log(
        `  clock ${w}: ${k.date.toFixed(1)} ms off Date.now (${k.origin.toFixed(1)} off timeOrigin), ${k.n} exchanges, rtt ${k.rtt.toFixed(1)} ± ${k.jit.toFixed(1)}`,
      );
    const [sa, sb] = [ka.date, kb.date];
    expect(Math.abs(sa - sb)).toBeLessThan(5);
  }, 120_000);

  // (NET_SHOTS=<dir>: both pages pictured, their panels open on the room — the progress sheet's)
  test.skipIf(!process.env.NET_SHOTS)(
    "pictures of both pages",
    async () => {
      const dir = process.env.NET_SHOTS!;
      await Bun.$`mkdir -p ${dir}`;
      for (const [n, p] of [
        ["a", a],
        ["b", b!],
      ] as const) {
        await p.js(`(() => { if (!document.querySelector("[data-testid=net-panel]")) __bh.net.open(); return 1; })()`);
        await Bun.sleep(1500);
        await p.shot(`${dir}/room-${n}.png`);
      }
    },
    60_000,
  );

  test("the bot's samples read back on the page, moving at its speed", async () => {
    const slot = bot!.net.room!.slot;
    await a.waitFor(`(__bh.net.net.remotes.track(${slot})?.samples.length ?? 0) > 20`, 10_000);
    const r = await a.js<{ d: number; dt: number; delay: number; ghost: boolean; l50: number; l95: number }>(`(async () => {
      const n = __bh.net.net;
      const s0 = n.remotes.states(n.roomNow()).find((s) => s.slot === ${slot});
      await new Promise((r) => setTimeout(r, 500));
      const s1 = n.remotes.states(n.roomNow()).find((s) => s.slot === ${slot});
      return { d: Math.hypot(s1.p[0] - s0.p[0], s1.p[1] - s0.p[1], s1.p[2] - s0.p[2]), dt: s1.t - s0.t, delay: n.remotes.delay, ghost: s1.ghost, l50: n.remotes.late50, l95: n.remotes.late95 };
    })()`);
    console.log(
      `  the bot: ${r.d.toFixed(1)} m in ${r.dt.toFixed(3)} s; its samples ${Math.round(r.l50 * 1000)} ms late (95 %: ${Math.round(r.l95 * 1000)}), shown ${Math.round(r.delay * 1000)} ms late`,
    );
    expect(r.ghost).toBe(false);
    expect(r.d / r.dt).toBeGreaterThan(190);
    expect(r.d / r.dt).toBeLessThan(210);
    // (a page drawing a full scene reads its messages between its frames: the delay follows)
    expect(r.delay).toBeLessThan(0.25);
  }, 30_000);

  test("the second page leaves: two members left", async () => {
    // (its panel closed once in by the link: opened again)
    await b!.js(`(() => { __bh.net.open(); return 1; })()`);
    await b!.waitFor(`!!document.querySelector("[data-testid=net-leave]")`, 5000);
    await b!.click(`[data-testid="net-leave"]`);
    await a.waitFor(`__bh.net.net.room.members.length === 2`, 10_000);
    expect(await b!.js<boolean>(`__bh.net.net === null && document.querySelector("[data-testid=net-badge]").hidden`)).toBe(true);
  }, 30_000);
});
