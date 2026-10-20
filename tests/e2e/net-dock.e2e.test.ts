import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R7: docking together — Ana flies the Endurance in a 400 km orbit, Ben a Ranger: put 3 m out on her
// fore hub's axis, drifting in at 15 cm/s, his rear hatch latches on: held to her craft (his pose hers ⊕ the
// ports'), she sees him on her hub (from her own pose — rigid); she is moved: he goes with her; he undocks: the
// springs push him off. Then his docking autopilot brings him in from 25 m on its own; then, off the axis, his
// Ranger strikes her hull: a bounce, her share of the blow sent to her. (NET_SHOTS=<dir>: both views docked.)

const M_METRES = 1.476625e11;

describe.skipIf(!E2E)("docking together", () => {
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
  /** Ben's distance on Ana's screen [m] (her view: drawn on her hub) */
  const seen = () => a.js<number>(`Math.hypot(...(__bh.renderer.netOthers[0]?.rel ?? [NaN, NaN, NaN]))`);
  /** Ben's own place against where Ana's craft and the link put him, on his page [m] */
  const held = () =>
    b.js<number>(
      `(() => { const t = __bh.camera.nowTime(); const P = __bh.camera.netHostPose(t); const o = __bh.camera.activePoseNow(); return P && o ? Math.hypot(...[0, 1, 2].map((k) => (P.X[k] - o.X[k]) * ${M_METRES})) : NaN; })()`,
    );
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "endurance"; return 1; })()`);
    await a.js(`__bh.net.create("Dock")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await a.js(`(() => { __bh.game.orbit("earth", { altKm: 400, inc: 51.6, raan: 40, nu: 180 }); return 1; })()`);
    const placed = await a.js<number>(`__bh.sim.time * 492.549`);
    await b.waitFor(
      `(__bh.net.net.remotes.track(${sa})?.latest?.t ?? 0) > ${placed} + 0.2 && __bh.net.net.remotes.track(${sa}).latest.kind === 2`,
      30_000,
    );
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ben drifts onto Ana's hub: latched — held to her craft; on her screen, on her hub", async () => {
    console.log(`  ${await b.js<string>(`__bh.net.session.placeAtPort(${sa}, 3, 0.15)`)}`);
    await b.waitFor(`!!__bh.camera.netDocked`, 60_000);
    console.log(`  Ben: ${await b.js<string>(`__bh.camera.netDocked.title + " · " + __bh.camera.netDocked.port`)}`);
    await a.waitFor(`__bh.net.session.links.get(${sb})?.host === ${sa}`, 10_000);
    await Bun.sleep(2000);
    const [h, d] = [await held(), await seen()];
    console.log(`  docked: Ben ${h.toFixed(3)} m off where her craft holds him; on her screen ${d.toFixed(1)} m from her centre`);
    expect(h).toBeLessThan(0.05);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(40);
    await shot(a, "dock-a");
    await shot(b, "dock-b");
  }, 120_000);

  test("Ana moved 1 km on: Ben goes with her; he undocks: pushed off", async () => {
    const d0 = await seen();
    await a.js(
      `(() => { const c = __bh.camera, P = c.activePoseNow(); const f = P.ax[2]; __bh.game.placeAt({ frame: "ours", X: P.X.map((x, k) => x + f[k] * 1000 / ${M_METRES}), vel: P.V, fwd: f, up: P.ax[1], note: "1 km on" }); return 1; })()`,
    );
    await Bun.sleep(3000);
    const [h, d1] = [await held(), await seen()];
    console.log(`  after her jump: Ben ${h.toFixed(3)} m off her hold, on her screen ${d1.toFixed(1)} m (was ${d0.toFixed(1)})`);
    expect(h).toBeLessThan(0.05);
    expect(Math.abs(d1 - d0)).toBeLessThan(2);
    await b.js(`(() => { __bh.camera.undock(); return 1; })()`);
    await a.waitFor(`!__bh.net.session.links.has(${sb})`, 10_000);
    await Bun.sleep(4000);
    const d2 = await seen();
    console.log(`  undocked: ${d2.toFixed(2)} m from her centre 4 s on (was ${d1.toFixed(2)})`);
    expect(d2 - d1).toBeGreaterThan(0.1);
  }, 60_000);

  test("his docking autopilot brings him in from 25 m", async () => {
    console.log(`  ${await b.js<string>(`__bh.net.session.placeAtPort(${sa}, 25, 0)`)}`);
    await b.js(`(() => { __bh.camera.selectTarget("net:${sa}"); __bh.camera.pilot.setAuto("dock"); return 1; })()`);
    await b.waitFor(`!!__bh.camera.netDocked`, 240_000);
    console.log(`  docked by the autopilot: ${await b.js<string>(`__bh.camera.netDocked.title`)}`);
  }, 300_000);

  test("off the axis, his Ranger strikes her hull: a bounce; her share sent to her", async () => {
    await b.js(`(() => { __bh.camera.undock(); return 1; })()`);
    await Bun.sleep(1000);
    // (beside her hub, 2.5 m off its axis, coming in at 0.5 m/s: into the hull, not the port — both flown manual: the
    // keep-out guard — PLAN-VAISSEAUX X1b — armed on either craft would hold them apart)
    await b.js(`(() => { __bh.settings.spaceAssist = "manual"; return 1; })()`);
    await a.js(`(() => { __bh.settings.spaceAssist = "manual"; return 1; })()`);
    await b.js(`__bh.net.session.placeAtPort(${sa}, 6, 0.5)`);
    await b.js(
      `(() => { const c = __bh.camera, P = c.activePoseNow(); const r = P.ax[0]; __bh.game.placeAt({ frame: "ours", X: P.X.map((x, k) => x + r[k] * 2.5 / ${M_METRES}), vel: P.V, fwd: P.ax[2], up: P.ax[1], note: "off the axis" }); return 1; })()`,
    );
    const before = await a.js<number>(`__bh.net.session.bumped`);
    const struck = await a
      .waitFor(`__bh.net.session.bumped > ${before}`, 40_000)
      .then(() => true)
      .catch(() => false);
    console.log(`  Ben's log: ${await b.js<string>(`__bh.game.log.text().split(String.fromCharCode(10)).slice(-6).join(" | ")`)}`);
    await b.js(`(() => { __bh.settings.spaceAssist = "realistic"; return 1; })()`);
    await a.js(`(() => { __bh.settings.spaceAssist = "realistic"; return 1; })()`);
    expect(struck).toBe(true);
    console.log(`  Ana struck — ${await a.js<number>(`__bh.net.session.bumped`)} blow(s) from Ben`);
  }, 60_000);

  test("Ana leaves: her Endurance stays on its orbit — Ben docks to it; back, she takes her craft again", async () => {
    await b.js(`(() => { __bh.camera.undock(); return 1; })()`);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    await a.js(`(() => { __bh.net.leave(); return 1; })()`);
    await b.waitFor(`__bh.net.session.tags.some((g) => g.name.includes("Ana") && g.slot >= 200)`, 20_000);
    const tag = await b.js<string>(
      `__bh.net.session.tags.map((g) => g.name + " · " + g.kind + " · " + Math.round(g.dist) + " m").join(", ")`,
    );
    console.log(`  Ben sees: ${tag}`);
    // (her Endurance carried on along its orbit: Ben, coasting by it, still near it)
    await Bun.sleep(5000);
    const near = await b.js<number>(`__bh.net.session.tags.find((g) => g.slot >= 200).dist`);
    expect(near).toBeLessThan(300);
    console.log(`  ${await b.js<string>(`__bh.net.session.placeAtPort(200, 3, 0.15)`)}`);
    await b.waitFor(`__bh.camera.netDocked?.id === "net:200"`, 60_000);
    console.log(`  Ben docked to the absent Endurance: ${await b.js<string>(`__bh.camera.netDocked.title`)}`);
    await b.js(`(() => { __bh.camera.undock(); return 1; })()`);
    await Bun.sleep(1500);
    // (Ana back: her craft offered, taken — where its orbit carried it)
    await a.js(`(() => { __bh.net.join("${code}"); return 1; })()`);
    await a.waitFor(`!!__bh.net.net?.room && !!__bh.net.net.mine && __bh.net.net.clock.synced`, 30_000);
    await a.waitFor(`!__bh.net.session.resume().includes("clock")`, 20_000);
    await b.waitFor(`__bh.net.session.tags.some((g) => g.slot < 200 && g.name === "Ana")`, 20_000);
    await Bun.sleep(3000);
    const back = await b.js<number>(`__bh.net.session.tags.find((g) => g.slot < 200 && g.name === "Ana").dist`);
    console.log(`  Ana back on her Endurance: ${back.toFixed(1)} m from Ben`);
    expect(back).toBeLessThan(300);
    await shot(b, "world-b");
  }, 180_000);
});
