import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A downed aircraft and its replay: first the Alps as ever; a drone ahead hit — smoking —, then destroyed
// — out of control, spinning down, burning —, its explosion where it hits the ground and a column of smoke there; the
// replay plays the smoke trails again and draws the explosion. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("a downed aircraft: smoke, the fall, the crash; its replay", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** the drone set ahead: its distance, its height over the ground, alive, crashed, its nose's climb */
  const drone = () =>
    app.js<{ d: number; z: number; alive: boolean; crashed: boolean; fwdZ: number }>(`(() => {
      const C = __bh.camera.combat, q = C.world.target(window.__drone), P = C.last;
      return { d: Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]), z: q.p[2] - C.world.groundZ(q.p[0], q.p[1]),
        alive: q.alive, crashed: !!q.wreck && !Number.isNaN(q.wreck.crashedAt), fwdZ: q.fwd[2] };
    })()`);
  const hit = (dmg: number) =>
    app.js(
      `(() => { const W = __bh.camera.combat.world, q = W.target(window.__drone); W.damageTarget(q, ${dmg}, "gun", __bh.camera.combat.events); return 1; })()`,
    );
  /** The outside free camera beside the craft, turned each tenth of a second to the drone (or its wreck, where it
   *  crashed): its direction from the fight's frame to the craft's axes (x left, y top, z nose). */
  const aim = (fov: number) =>
    app.js(`(() => {
      clearInterval(window.__aim);
      __bh.settings.shipMount = "free"; __bh.settings.fov = ${fov};
      __bh.camera.outside = { ...__bh.camera.outside, eye: [6, 3, -12] };
      window.__aim = setInterval(() => {
        const C = __bh.camera.combat, s = __bh.camera.replaySample();
        if (!C || !s || !C.last) return;
        const q = C.world.target(window.__drone), P = C.last;
        const r = [q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]];
        const D = Math.PI / 180, f = s.lat * D, l = s.lon * D;
        const E = [-Math.sin(l), Math.cos(l), 0], N = [-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f)], U = [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)];
        const w = [0, 1, 2].map((k) => E[k] * r[0] + N[k] * r[1] + U[k] * r[2]);
        const ax = s.ax.map((a) => [0, 1, 2].map((k) => a[0] * E[k] + a[1] * N[k] + a[2] * U[k]));
        const c = ax.map((a) => a[0] * w[0] + a[1] * w[1] + a[2] * w[2]);
        const L = Math.hypot(...c);
        __bh.camera.outside = { ...__bh.camera.outside, fyaw: Math.atan2(c[0], c[2]) / D, fpitch: Math.asin(c[1] / L) / D };
      }, 100);
      return 1; })()`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Invulnerable: true, f35EnemyMissiles: false, showFps: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(2500);
    await shot("alps");
  }, 240_000);

  test("a drone hit: smoking; destroyed: spinning down, burning; its explosion and smoke where it crashes", async () => {
    // (midday over Rogers Dry Lake; a drone set 2.5 km ahead, 600 m above, flying on as we do)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T19:00:00Z"); return 1; })()`);
    await app.js(
      `(async () => { const t = __bh.tars.tools().find((x) => x.name === "f35"); await t.run({ action: "fly", id: "drones" }, new AbortController().signal); return 1; })()`,
    );
    await app.waitFor(`__bh.camera.combat?.status === "run" && !!__bh.camera.combat.last`, 30_000);
    await app.js(`(() => {
      const C = __bh.camera.combat, W = C.world, P = C.last;
      const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr");
      const agl = 1200, hdg = Math.atan2(P.fwd[0], P.fwd[1]);
      c.jetModes.alt = W.groundZ(P.p[0], P.p[1]) + agl; c.jetModes.hdg = hdg; c.jetModes.spd = 130;
      for (const q of W.targets) q.alive = false, q.diedAt = -1e9;
      const f = [Math.sin(hdg), Math.cos(hdg)];
      window.__drone = W.addTarget({ kind: "drone", at: [P.p[0] + f[0] * 2500, P.p[1] + f[1] * 2500, agl + 40], hdg: (hdg * 180) / Math.PI, speed: 130, name: "BQM" });
      const q = W.target(window.__drone); q.ai.mode = "course"; q.ai.course = { hdg: (hdg * 180) / Math.PI, alt: q.p[2] };
      return 1; })()`);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(12_000);
    // (far off, from the cockpit: its spot in the HUD's box)
    await app.js(`(() => { Object.assign(__bh.settings, { shipMount: "cockpit", fov: 40 }); return 1; })()`);
    await Bun.sleep(1500);
    await shot("spot");
    await hit(20);
    await aim(8);
    await Bun.sleep(4000);
    const d1 = await drone();
    console.log(`  hit: ${d1.d.toFixed(0)} m ahead, alive ${d1.alive}`);
    expect(d1.alive).toBe(true);
    await shot("hit-smoke");
    await hit(100);
    await aim(12);
    await Bun.sleep(4000);
    const d2 = await drone();
    console.log(`  destroyed: ${d2.d.toFixed(0)} m, ${d2.z.toFixed(0)} m over the ground, its nose ${d2.fwdZ.toFixed(2)}`);
    expect(d2.alive).toBe(false);
    expect(d2.crashed).toBe(false);
    expect(d2.fwdZ).toBeLessThan(-0.2);
    await shot("falling");
    await aim(20);
    // (its crash: the explosion, the smoke rising)
    await app.waitFor(
      `(() => { const q = __bh.camera.combat.world.target(window.__drone); return !!q.wreck && !Number.isNaN(q.wreck.crashedAt); })()`,
      120_000,
    );
    await app.js(`(() => { window.__crashEnd = __bh.flight.replay.tape().end; return 1; })()`);
    const booms = await app.js<number[]>(`__bh.camera.combat.booms.map((b) => b.size)`);
    const d3 = await drone();
    console.log(`  crashed ${d3.d.toFixed(0)} m away: the explosions ${JSON.stringify(booms)}`);
    expect(booms.some((s) => s > 2)).toBe(true);
    await Bun.sleep(500);
    await shot("crash");
    await Bun.sleep(7000);
    await shot("crash-smoke");
    const n = await app.js<number>(`__bh.renderer.shipContrails?.n ?? 0`);
    console.log(`  the smoke's segments: ${n}`);
    expect(n).toBeGreaterThan(0);
    await app.js(`(() => { clearInterval(window.__aim); Object.assign(__bh.settings, { shipMount: "chase", fov: 60 }); return 1; })()`);
  }, 300_000);

  test("the replay: the lens on the wreck — its fall, its explosion —; the smoke trails played again", async () => {
    console.log(`  the tape: ${JSON.stringify(await app.js(`__bh.flight.replay.tape()`))}`);
    expect(await app.js<string | null>(`__bh.flight.replay.open()`)).toBeNull();
    // (the crash's time on the tape — its clock runs with the flight, not the wall)
    const at = (s: number) => `window.__crashEnd + ${s} - __bh.flight.replay.tape().end`;
    // (falling, 8 s before its crash)
    await app.js(
      `(() => { __bh.flight.replay.shot("target"); __bh.flight.replay.seek(${at(-8)}); __bh.flight.replay.play(false); return 1; })()`,
    );
    await Bun.sleep(1500);
    await shot("replay-falling");
    const n0 = await app.js<number>(`__bh.renderer.shipContrails?.n ?? 0`);
    // (its crash: the explosion drawn)
    await app.js(`(() => { __bh.flight.replay.seek(${at(0.5)}); return 1; })()`);
    await Bun.sleep(1500);
    const st = await app.js<{ booms: number; shot: string }>(`__bh.flight.replay.state()`);
    const n = await app.js<number>(`__bh.renderer.shipContrails?.n ?? 0`);
    console.log(`  falling: ${n0} smoke segments; at the crash (${st.shot}): ${st.booms} explosion(s) drawn, ${n} smoke segments`);
    await shot("replay-crash");
    expect(st.booms).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(0);
    // (back 40 s and forward again: the trails rebuilt each way)
    await app.js(`(() => { __bh.flight.replay.tape(); __bh.flight.replay.seek(-40); return 1; })()`);
    await Bun.sleep(800);
    const back = await app.js<number>(`__bh.flight.replay.tape().trailMs`);
    await app.js(`(() => { __bh.flight.replay.tape(); __bh.flight.replay.seek(${at(0.5)}); return 1; })()`);
    await Bun.sleep(800);
    const fwd = await app.js<number>(`__bh.flight.replay.tape().trailMs`);
    const again = await app.js<number>(`__bh.renderer.shipContrails?.n ?? 0`);
    console.log(`  the smoke at the crash again: ${again}; rebuilt in ${back.toFixed(1)} ms back, ${fwd.toFixed(1)} ms forward`);
    expect(Math.abs(again - n)).toBeLessThan(Math.max(30, n * 0.25));
    // (a seek's rebuild within a frame or two: no hitch)
    expect(Math.max(back, fwd)).toBeLessThan(25);
    // (the director over the kill and the fall: the lens on the wreck among its shots, the explosion drawn)
    const shots = new Set<string>();
    let drawn = 0;
    await app.js(
      `(() => { __bh.flight.replay.shot("auto"); __bh.flight.replay.seek(${at(-12)}); __bh.flight.replay.play(true); return 1; })()`,
    );
    for (let i = 0; i < 64; i++) {
      const x = await app.js<{ shot: string; booms: number }>(`__bh.flight.replay.state()`);
      shots.add(x.shot);
      drawn = Math.max(drawn, x.booms);
      await Bun.sleep(250);
    }
    console.log(`  the director: ${[...shots].join(", ")}; up to ${drawn} explosion(s) drawn`);
    expect(shots.has("target")).toBe(true);
    await app.js(`(() => { __bh.flight.replay.close(); return 1; })()`);
  }, 180_000);
});
