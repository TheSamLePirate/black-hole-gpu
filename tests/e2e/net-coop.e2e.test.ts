import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R3: the fights together and the races — Ana starts the drone hunt for both: Ben's world has the
// drones Ana's runs (placed from hers); Ben, put 5 km behind one, locks it and fires an AIM-9X — the hit sent to
// Ana, her world downs the drone, the kill Ben's on both sheets; then a gate race: both put at the course's start
// in echelon, each judged.

describe.skipIf(!E2E)("together against the aggressors, then a race", () => {
  let a: App;
  let b: App;
  let sb = 0;
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.game.setDate("2067-06-21T16:30"); __bh.net.setName("Ana"); __bh.settings.vessel = "f35"; return 1; })()`);
    await a.js(`__bh.net.create("Coop")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "f35"; return 1; })()`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("the drone hunt together: Ben's world has Ana's drones, placed from hers", async () => {
    await a.js(`(() => { __bh.net.match.start("coop", "drones"); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.phase === "run" && !!__bh.camera.combat?.net`, 30_000);
    await b.waitFor(`__bh.camera.combat.world.targets.filter((q) => q.remote).length === 5`, 10_000);
    await Bun.sleep(2000);
    const [pa, pb] = [
      await a.js<number[]>(`__bh.camera.combat.world.target(1).p`),
      await b.js<number[]>(`__bh.camera.combat.world.target(1).p`),
    ];
    const gap = Math.hypot(pa[0]! - pb[0]!, pa[1]! - pb[1]!, pa[2]! - pb[2]!);
    console.log(`  BQM-1 on Ana's world and on Ben's: ${gap.toFixed(0)} m apart`);
    expect(gap).toBeLessThan(250);
  }, 60_000);

  test("Ben downs BQM-1 with an AIM-9X: the hit sent to Ana, the kill Ben's on both sheets", async () => {
    // (Ben put 5 km behind the drone, at its height, flying its way faster)
    await b.js(`(() => {
      const q = __bh.camera.combat.world.target(1);
      const D = Math.PI / 180, a = { lat: 34.95, lon: -117.8 };
      const e = q.p[0] - 5000 * q.fwd[0], n = q.p[1] - 5000 * q.fwd[1];
      const lat = a.lat + n / (D * 6371008.8), lon = a.lon + e / (D * 6371008.8 * Math.cos(a.lat * D));
      const hdg = Math.atan2(q.fwd[0], q.fwd[1]) / D;
      __bh.game.flyAt(lat, lon, q.p[2] - __bh.camera.combat.world.groundZ(q.p[0], q.p[1]), hdg, 230);
      return 1; })()`);
    await Bun.sleep(2000);
    await b.press("Tab");
    await b.waitFor(`__bh.camera.combat.world.lock !== null`, 5000);
    const locked = await b.js<number>(`__bh.camera.combat.world.lock`);
    console.log(`  Ben locked #${locked}`);
    await b.press("Enter");
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.sheet.row(${sb}).ai === 1`, 40_000);
    expect(await a.js<boolean>(`!__bh.camera.combat.world.target(${locked}).alive`)).toBe(true);
    console.log(`  ${await a.js<string>(`[...document.querySelectorAll(".nm-feed-row")].map((e) => e.textContent).join(" | ")`)}`);
  }, 90_000);

  test("a gate race: both at the course's start in echelon, each judged", async () => {
    await a.js(`(() => { __bh.net.match.stop(); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.phase === "over"`, 10_000);
    await a.js(
      `(() => { document.querySelector("[data-testid=nm-close]")?.click(); __bh.net.match.start("race", "rogers"); return 1; })()`,
    );
    for (const p of [a, b])
      await p.waitFor(
        `__bh.net.match.match?.mode === "race" && __bh.net.match.phase === "run" && __bh.camera.chal?.status === "run"`,
        30_000,
      );
    const [ga, gb] = [
      await a.js<{ lat: number; lon: number }>(`__bh.camera.geoNow()`),
      await b.js<{ lat: number; lon: number }>(`__bh.camera.geoNow()`),
    ];
    const d = Math.hypot((ga.lat - gb.lat) * 111_000, (ga.lon - gb.lon) * 111_000 * Math.cos((ga.lat * Math.PI) / 180));
    console.log(`  the two racers ${d.toFixed(0)} m apart at the start`);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(160);
  }, 60_000);
});
