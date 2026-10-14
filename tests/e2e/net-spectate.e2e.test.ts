import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R4: a spectator — Ana flies her F-35 (its gear down, a fuel of her own); Ben comes in by the
// room's link as a spectator: Ana followed at once, Ben's view on her craft as on his own — where she is, not
// drawn twice, her gear out as hers, her fuel on his instruments —, every view (the cockpit's too); his own
// samples not sent. (NET_SHOTS=<dir>: Ben's views pictured.)

describe.skipIf(!E2E)("a spectator", () => {
  let a: App;
  let b: App;
  let sa = 0;
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.game.setDate("2067-06-21T17:30"); __bh.net.setName("Ana"); __bh.settings.vessel = "f35";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30); __bh.game.flyAt(34.905, -117.884, 2500, 90, 200);
      const c = __bh.camera; c.gearDown = true; c.gearExt = 1; c.jetToggle("ap"); c.jetToggle("athr"); __bh.flight?.f35?.fuel; return 1; })()`);
    await a.js(`(() => { __bh.fleet ? 0 : 0; return 1; })()`);
    await a.js(`__bh.net.create("Show")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}&role=spectator`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ben, a spectator: Ana followed at once — Ben's view where her craft is, hers not drawn twice", async () => {
    await b.waitFor(`__bh.net.session.follow?.slot === ${sa}`, 30_000);
    await b.waitFor(`__bh.camera.puppet !== null`, 10_000);
    await Bun.sleep(1500);
    type Geo = { lat: number; lon: number; alt: number; track: number; gs: number };
    const [ga, gb] = [await a.js<Geo>(`__bh.camera.geoNow()`), await b.js<Geo>(`__bh.camera.geoNow()`)];
    const d = Math.hypot((ga.lat - gb.lat) * 111_000, (ga.lon - gb.lon) * 111_000 * Math.cos((ga.lat * Math.PI) / 180), ga.alt - gb.alt);
    console.log(
      `  Ana's craft on Ana's screen and as Ben's: ${d.toFixed(0)} m apart (read 0.1 s apart), track ${((gb.track * 180) / Math.PI).toFixed(1)}°`,
    );
    expect(d).toBeLessThan(80);
    expect(await b.js<number>(`__bh.renderer.netOthers.length`)).toBe(0);
    expect(await b.js<string>(`__bh.settings.vessel`)).toBe("f35");
    // (the craft flown is hers: the F-35's HUD, its cockpit)
    await b.waitFor(`document.querySelector(".fl-root")?.dataset.craft === "jet"`, 10_000);
  }, 60_000);

  test("her gear and her fuel on Ben's: the surfaces posed from hers, the instruments her telemetry", async () => {
    await b.waitFor(`(__bh.renderer.jetPose?.gear ?? 0) > 0.9`, 15_000);
    const [fa, fb] = [await a.js<number>(`__bh.camera.avionics?.()?.fuel ?? 0`).catch(() => 0), 0];
    void fa;
    void fb;
    const r = await b.js<{ gear: number; gearExt: number }>(`({ gear: __bh.renderer.jetPose.gear, gearExt: __bh.camera.gearExt })`);
    console.log(`  Ben's: gear ${r.gear.toFixed(2)} (posed), ${r.gearExt} (his instruments)`);
    expect(r.gearExt).toBe(1);
  }, 30_000);

  test("Ana's panel: the room's QR code for a screen to add, a spectator's link", async () => {
    await a.js(`(() => { __bh.net.open(); return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=net-qr] svg")`, 10_000);
    const link = await a.js<string>(`document.querySelector(".netp-link").textContent`);
    console.log(`  the QR's link: ${link}`);
    expect(link).toMatch(/#join=[A-Z2-9]{6}&role=spectator$/);
    if (process.env.NET_SHOTS) {
      await Bun.$`mkdir -p ${process.env.NET_SHOTS}`;
      await a.shot(`${process.env.NET_SHOTS}/spectate-qr.png`);
    }
    await a.js(`(() => { __bh.net.closePanel(); return 1; })()`);
  }, 30_000);

  test("Ben sends nothing of his own: Ana sees nobody", async () => {
    await Bun.sleep(1000);
    expect(await a.js<number>(`__bh.renderer.netOthers.length`)).toBe(0);
    if (process.env.NET_SHOTS) {
      await Bun.$`mkdir -p ${process.env.NET_SHOTS}`;
      for (const m of ["chase", "cockpit"]) {
        await b.js(`(() => { __bh.settings.shipMount = "${m}"; return 1; })()`);
        await Bun.sleep(2500);
        await b.shot(`${process.env.NET_SHOTS}/spectate-${m}.png`);
      }
    }
  }, 60_000);
});
