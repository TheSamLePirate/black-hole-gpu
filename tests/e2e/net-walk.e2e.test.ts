import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R5: on foot together — Ana and Ben walking on Edwards' apron, 12 m apart: each sees the other's
// astronaut (the real one: his skinned body, his gait) where he is, his name tag over his head; Ben walks
// (W held): on Ana's screen his astronaut goes the way, at his speed. (NET_SHOTS=<dir>: Ana's view.)

describe.skipIf(!E2E)("on foot together", () => {
  let a: App;
  let b: App;
  let sb = 0;
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.game.setDate("2067-06-21T16:30"); __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Walk")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    // (on foot on the apron, Ben 12 m ahead of Ana (north), both facing north)
    expect(await a.js(`__bh.camera.character.start("earth", 34.9046, -117.8844)`)).toBeNull();
    expect(await b.js(`__bh.camera.character.start("earth", 34.90471, -117.8844)`)).toBeNull();
    for (const p of [a, b]) {
      await p.js(`(() => { for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`);
      await p.waitFor("__bh.renderer.characterRenderer.model.ready || __bh.renderer.characterRenderer.model.error", 120_000);
    }
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("each sees the other's astronaut some 12 m off, his name over his head", async () => {
    for (const p of [a, b]) await p.waitFor(`__bh.renderer.netWalkersCam.length === 1`, 20_000);
    const d = await a.js<number>(`__bh.renderer.netWalkersCam[0].dist`);
    const tag = await a.js<string>(`__bh.net.session.tags.map((g) => g.name + " " + g.kind).join(", ")`);
    console.log(`  Ana sees Ben on foot ${d.toFixed(1)} m off — tags: ${tag}`);
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(25);
    expect(await a.js<number>(`__bh.renderer.characterRenderer.remoteWalkers.length`)).toBe(1);
  }, 60_000);

  test("Ben walks (W held): on Ana's screen he goes, at his speed", async () => {
    // (his place in Ana's view relative to her — the Earth carries both along its orbit)
    const d0 = await a.js<number>(`__bh.renderer.netWalkersCam[0].dist`);
    const walking = b.hold("KeyW", 3000);
    await Bun.sleep(2000);
    const v = await a.js<number>(`__bh.renderer.netWalkers[0].speed`);
    await walking;
    await Bun.sleep(600);
    const d1 = await a.js<number>(`__bh.renderer.netWalkersCam[0].dist`);
    console.log(`  Ben walking at ${v.toFixed(1)} m/s on Ana's screen; ${d0.toFixed(1)} m → ${d1.toFixed(1)} m from her`);
    expect(v).toBeGreaterThan(0.8);
    expect(d1 - d0).toBeGreaterThan(1);
    if (process.env.NET_SHOTS) {
      await Bun.$`mkdir -p ${process.env.NET_SHOTS}`;
      await b.hold("KeyW", 1200);
      await a.shot(`${process.env.NET_SHOTS}/walk-a.png`);
      await b.shot(`${process.env.NET_SHOTS}/walk-b.png`);
    }
  }, 60_000);

  test("Ben boards Ana's parked F-35 as her passenger (⇧K), then gets off at its door (⇧K)", async () => {
    const sa = await a.js<number>(`__bh.net.net.room.slot`);
    await a.js(
      `(() => { __bh.camera.character.stop(); __bh.settings.vessel = "f35"; __bh.game.land("earth", 34.9046, -117.8844); return 1; })()`,
    );
    // (Ben's own F-35 parked 14 km south in the desert, he on foot beside it — then put 6 m east of Ana's)
    await b.js(`(() => { __bh.camera.character.stop(); __bh.settings.vessel = "f35"; return 1; })()`);
    // (out of it once its ground is there — tried again)
    for (let k = 0; k < 20 && !(await b.js<boolean>(`__bh.camera.character.active`)); k++) {
      await b.js(`(() => { try { __bh.game.walk("earth", 34.78, -117.9); } catch { __bh.step(1 / 30); } return 1; })()`);
      await Bun.sleep(500);
    }
    await Bun.sleep(1500);
    const own0 = await b.js<number[]>(`__bh.camera.netOwn().p`);
    await b.waitFor(
      `(() => { const s = __bh.net.net.remotes.track(${sa})?.at(__bh.net.net.roomNow()); return !!s && (s.flags & 1) === 1 && s.kind === 3; })()`,
      30_000,
    );
    // (Ben walked to 6 m east of Ana's craft — its place as his page has it)
    expect(
      await b.js(`(() => {
        const p = __bh.net.net.remotes.track(${sa}).at(__bh.net.net.roomNow()).p;
        const e = [-p[1], p[0], 0], l = Math.hypot(...e);
        return __bh.camera.character.startAt("earth", p.map((x, k) => x + (6 * e[k]) / l), [0, 0, 1]); })()`),
    ).toBeNull();
    await Bun.sleep(500);
    await b.press("KeyK", "K", { shift: true });
    await b.waitFor(`__bh.net.session.follow?.why === "passenger" && __bh.camera.puppet !== null`, 5000);
    expect(await b.js<number>(`__bh.net.session.follow.slot`)).toBe(sa);
    expect(await b.js<boolean>(`__bh.camera.character.active`)).toBe(false);
    await a.waitFor(`__bh.net.session.aboard.get(${sb}) === ${sa}`, 10_000);
    console.log(
      `  Ana's panel: ${await a.js<string>(`(__bh.net.open(), document.querySelector("[data-testid=net-aboard-${sb}]")?.textContent ?? "—")`)}`,
    );
    // (Ben's view: Ana's craft — his own at her place, her kind)
    await Bun.sleep(1500);
    const gap = await b.js<number>(
      `(() => { const o = __bh.camera.netOwn().p, s = __bh.net.net.remotes.track(${sa}).at(__bh.net.net.roomNow()).p; return Math.hypot(o[0] - s[0], o[1] - s[1], o[2] - s[2]); })()`,
    );
    console.log(`  Ben aboard: his view ${gap.toFixed(1)} m from Ana's craft; landed ${await b.js(`__bh.camera.landed`)}`);
    expect(await b.js<boolean>(`__bh.camera.landed`)).toBe(true);
    expect(gap).toBeLessThan(3);
    if (process.env.NET_SHOTS) await b.shot(`${process.env.NET_SHOTS}/aboard-b.png`);
    // off
    await b.press("KeyK", "K", { shift: true });
    await b.waitFor(`__bh.camera.character.active && __bh.net.session.follow === null`, 10_000);
    await a.waitFor(`!__bh.net.session.aboard.has(${sb})`, 10_000);
    for (let i = 0; i < 20; i++) await b.js(`(() => { __bh.step(1 / 30); return 1; })()`);
    const own1 = await b.js<number[]>(`__bh.camera.netOwn().p`);
    const back = Math.hypot(own1[0]! - own0[0]!, own1[1]! - own0[1]!, own1[2]! - own0[2]!);
    const door = await b.js<number>(
      `(() => { const q = __bh.camera.character.q, s = __bh.net.net.remotes.track(${sa}).at(__bh.net.net.roomNow()).p; return Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2]); })()`,
    );
    const far = await b.js<number>(
      `(() => { const q = __bh.camera.character.q, o = __bh.camera.netOwn().p; return Math.hypot(q[0] - o[0], q[1] - o[1], q[2] - o[2]); })()`,
    );
    console.log(
      `  Ben off: on foot ${door.toFixed(1)} m from Ana's craft; his own F-35 ${back.toFixed(1)} m from where he left it, ${(far / 1000).toFixed(1)} km away`,
    );
    expect(door).toBeLessThan(12);
    expect(back).toBeLessThan(3);
    expect(far).toBeGreaterThan(1000);
    if (process.env.NET_SHOTS) {
      await a.shot(`${process.env.NET_SHOTS}/off-a.png`);
      await b.shot(`${process.env.NET_SHOTS}/off-b.png`);
    }
  }, 120_000);
});
