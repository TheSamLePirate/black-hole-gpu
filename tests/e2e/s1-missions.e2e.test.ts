import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The missions of exception (docs/PLAN-AVIATION-AAA.md, S1): first the Alps as ever; the anti-ship strike — the two
// frigates under way west of Sardinia, locked one after the other, a JSM at each from 25 km, low under their SAMs, both
// sunk —; the display team's diamond at Salon — its three AI wingmen mustered, a low pass before the crowd counted —;
// a team mission in a room — Ana starts two-against-two, Ben joins it as her wingman (his role, his objective marked
// his). (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the missions of exception", () => {
  let a: App;
  let b: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  const tool = (p: App, name: string, args: object) =>
    p.js<unknown>(`(async () => { const t = __bh.tars.tools().find((x) => x.name === ${JSON.stringify(name)});
      const o = await t.run(${JSON.stringify(args)}, new AbortController().signal); return o.result ?? o; })()`);
  const SETUP = `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Invulnerable: true, subtitles: true }); return 1; })()`;

  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await a.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot(a, "alps");
  }, 120_000);

  test("the anti-ship strike: the frigates locked, a JSM at each from 25 km, low — both sunk", async () => {
    await a.js(`(() => { __bh.flight.missions.fly("antiship"); return 1; })()`);
    await a.waitFor(`!!__bh.camera.mission && __bh.camera.combat?.world.targets.filter((q) => q.kind === "ship").length === 2`, 30_000);
    // (25 km short of them, 60 m over the sea — under their SAMs —, heading for them)
    await a.js(`(() => { const c = __bh.camera, W = c.combat.world, A = c.combat.def.anchor, q = W.targets.find((x) => x.kind === "ship");
      const D = Math.PI / 180, R = 6371008.8;
      const lat = A.lat + (q.p[1] - 25000 * Math.cos(110 * D)) / (D * R), lon = A.lon + (q.p[0] - 25000 * Math.sin(110 * D)) / (D * R * Math.cos(A.lat * D));
      __bh.game.flyAt(lat, lon, 80, 110, 220); return 1; })()`);
    await Bun.sleep(1500);
    await a.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 80; c.jetModes.spd = 220; return 1; })()`,
    );
    await a.waitFor(`__bh.camera.radarObjects.filter((o) => o.kind === "sea" && o.id.startsWith("cmb:")).length === 2`, 20_000);
    await Bun.sleep(4000);
    await shot(a, "frigates");
    const names = await a.js<string[]>(`__bh.camera.combat.world.targets.filter((q) => q.kind === "ship").map((q) => q.name)`);
    for (const n of names) {
      console.log(`  ${await tool(a, "weapons", { action: "lock", target: n })}`);
      console.log(`  ${await tool(a, "weapons", { action: "select", weapon: "jsm" })}`);
      console.log(`  ${await tool(a, "weapons", { action: "fire" })}`);
      await Bun.sleep(1500);
    }
    expect(await a.js<number>(`__bh.camera.combat.world.missiles.filter((m) => m.kind === "jsm").length`)).toBe(2);
    // (away from them, low)
    await a.js(`(() => { __bh.camera.jetModes.hdg = (290 * Math.PI) / 180; return 1; })()`);
    await a.waitFor(`__bh.camera.combat.world.targets.filter((q) => q.kind === "ship" && !q.alive).length >= 1`, 150_000);
    await Bun.sleep(2500);
    await shot(a, "jsm-hit");
    await a.waitFor(`__bh.camera.mission?.run.state.ships === "done" || __bh.camera.missionLast?.spec.id === "antiship"`, 120_000);
    const st = await a.js<string>(`__bh.camera.mission?.run.state.ships ?? __bh.camera.missionLast?.status`);
    console.log(`  the frigates: ${st}`);
    expect(["done", "won"]).toContain(st);
  }, 420_000);

  test("the display: the diamond mustered at Salon, a low pass before the crowd counted", async () => {
    await a.js(`(() => { __bh.camera.missionAbort(); __bh.flight.missions.fly("display"); return 1; })()`);
    await a.waitFor(`__bh.camera.mission?.run.spec.id === "display" && (__bh.camera.wing?.list.length ?? 0) === 3`, 30_000);
    // (low over the crowd line on the holds: 250 m over the sea, heading for Salon's runway)
    await a.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 260; c.jetModes.hdg = (92 * Math.PI) / 180; c.jetModes.spd = 170; return 1; })()`,
    );
    await a.waitFor(`__bh.camera.wing.list.filter((w) => w.alive && w.dist < 40).length === 3`, 90_000);
    await a.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await a.js(`(() => { __bh.camera.outside = { yaw: 2.6, pitch: 0.25, dist: 90 }; return 1; })()`);
    await Bun.sleep(1500);
    await shot(a, "diamond");
    await a.waitFor(`(__bh.camera.mission?.run.apart.passes ?? 0) >= 1`, 150_000);
    console.log(`  passes: ${await a.js<number>(`__bh.camera.mission.run.apart.passes`)}`);
    await a.js(`(() => { __bh.settings.shipMount = "chase"; __bh.camera.missionAbort(); __bh.settings.wingmen = 0; return 1; })()`);
  }, 300_000);

  test("a team mission in a room: Ana leads two-against-two, Ben joins as her wingman", async () => {
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("S1")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1000, height: 700, lang: "fr", hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await a.js(`(() => { __bh.flight.missions.fly("team-2v2"); return 1; })()`);
    await b.waitFor(`__bh.camera.mission?.run.spec.id === "team-2v2"`, 60_000);
    const roles = {
      ana: await a.js<number>(`__bh.camera.mission.role`),
      ben: await b.js<number>(`__bh.camera.mission.role`),
    };
    console.log(`  roles: Ana ${roles.ana}, Ben ${roles.ben}`);
    expect(roles).toEqual({ ana: 0, ben: 1 });
    await Bun.sleep(3000);
    const hud = await b.js<string>(`document.querySelector(".msn-hud")?.textContent ?? ""`);
    console.log(`  Ben's objectives: ${hud}`);
    expect(hud).toContain("[Ailier]");
    await shot(b, "team-ben");
    await shot(a, "team-ana");
  }, 300_000);
});
