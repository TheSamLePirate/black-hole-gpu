import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R1: flying together over the Earth — two pages, each an F-35 in the air over Edwards; the second
// put off the first's right wing by the room panel's "Beside" (a real click), a wingman at its speed; each sees
// the other's F-35 where it is — now, not a fifth of a second late —, its name tag over it; the leader's
// afterburner lit shows on the wingman's screen. (NET_SHOTS=<dir>: both views pictured in formation.)

describe.skipIf(!E2E)("flying together", () => {
  let a: App;
  let b: App;
  let code = "";
  // (the protections off: the Auto-ACAS took the other — set beside, 2 m off the wing — for a conflict and escaped,
  // its hands on the throttle — no afterburner lit, no collision —; the room's free fight off too: in it a collision
  // is a shot-down's fall to the ground, not the crash put back on a runway this file checks — it is the network's,
  // not the protections' nor the fight's)
  const fly = (app: App, lat: number, lon: number, hdg: number) =>
    app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.f35AutoProtect = false; __bh.settings.netFreeFight = false; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.flyAt(${lat}, ${lon}, 2500, ${hdg}, 220); __bh.settings.shipMount = "chase"; return 1; })()`);
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.game.setDate("2067-06-21T17:30"); __bh.net.setName("Ana"); return 1; })()`);
    await fly(a, 34.905, -117.884, 90);
    await a.js(`__bh.net.create("Patrol")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await fly(b, 34.95, -117.8, 180);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("the joining page set on the room's hour: the same Sun", async () => {
    const [ta, tb] = [await a.js<number>(`__bh.sim.time * 492.5490947`), await b.js<number>(`__bh.sim.time * 492.5490947`)];
    console.log(`  scene time A ${ta.toFixed(1)} s, B ${tb.toFixed(1)} s`);
    expect(Math.abs(ta - tb)).toBeLessThan(30);
  }, 30_000);

  test("each sees the other's F-35 some 10 km off, its name tag over it", async () => {
    for (const p of [a, b]) await p.waitFor(`__bh.renderer.netOthers.length === 1`, 20_000);
    const r = await a.js<{ id: string; d: number; tags: number }>(
      `({ id: __bh.renderer.netOthers[0].id, d: Math.hypot(...__bh.renderer.netOthers[0].rel), tags: __bh.net.session.tags.length })`,
    );
    console.log(`  A sees B's ${r.id} ${(r.d / 1000).toFixed(1)} km off`);
    expect(r.id).toBe("f35");
    expect(r.d).toBeGreaterThan(3000);
    expect(r.d).toBeLessThan(15_000);
    expect(r.tags).toBe(1);
    // (on the F-35's radar scope: the other, his name)
    const radar = await a.js<{ name: string; d: number }[]>(
      `__bh.net.radar().contacts.map((c) => ({ name: c.name, d: Math.hypot(c.x, c.y) }))`,
    );
    console.log(`  A's radar: ${radar.map((c) => `${c.name} ${(c.d / 1000).toFixed(1)} km`).join(", ")}`);
    expect(radar.length).toBe(1);
    expect(radar[0]!.name).toBe("Ben");
  }, 60_000);

  test("the direct link: WebRTC between the two pages, the samples straight to each other", async () => {
    for (const p of [a, b])
      await p.waitFor(`[...(__bh.net.net.mesh?.peers.values() ?? [])].some((l) => l.state === "open")`, 30_000).catch(async (e) => {
        console.log(
          `  diag ${await p.js<string>(`JSON.stringify({ mesh: !!__bh.net.net.mesh, ice: __bh.net.net.iceServers, peers: [...(__bh.net.net.mesh?.peers.values() ?? [])].map((l) => ({ slot: l.slot, state: l.state, pc: l.pc.connectionState, ice: l.pc.iceConnectionState, sig: l.pc.signalingState, ch: l.ch?.readyState })), members: __bh.net.net.room.members.map((m) => m.slot), me: __bh.net.net.room.slot })`)}`,
        );
        throw e;
      });
    await Bun.sleep(3000);
    for (const [n, p] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const r = await p.js<{ route: string; rtt: number; down: number; direct: number; relayed: number; late: number }>(`(() => {
        const n = __bh.net.net; const L = [...n.mesh.peers.values()][0];
        return { route: L.route, rtt: L.rtt, down: L.bytes.down, direct: n.direct, relayed: n.relayed, late: n.remotes.late50 * 1000 }; })()`);
      console.log(
        `  ${n}: ${r.route} link, rtt ${r.rtt.toFixed(1)} ms, ${r.down} bytes in straight; sent ${r.direct} straight, ${r.relayed} through the server; samples ${r.late.toFixed(0)} ms late`,
      );
      expect(r.down).toBeGreaterThan(1000);
      expect(r.direct).toBeGreaterThan(10);
    }
  }, 60_000);

  test("Beside (a click in the room panel): B off A's right wing, at its speed — seen so on both", async () => {
    const slotA = await a.js<number>(`__bh.net.net.room.slot`);
    await b.js(`(() => { __bh.net.open(); return 1; })()`);
    await b.waitFor(`!!document.querySelector("[data-testid=net-tp-${slotA}]")`, 10_000);
    await b.click(`[data-testid="net-tp-${slotA}"]`);
    // (each holds the formation: the autopilot's altitude and heading, the autothrottle's speed)
    for (const p of [a, b]) await p.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(1000);
    type Geo = { lat: number; lon: number; alt: number; track: number; gs: number };
    const [ga, gb] = [await a.js<Geo>(`__bh.camera.geoNow()`), await b.js<Geo>(`__bh.camera.geoNow()`)];
    const fmt = (g: Geo) =>
      `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}, ${g.alt.toFixed(0)} m, ${((g.track * 180) / Math.PI).toFixed(1)}°, ${g.gs.toFixed(0)} m/s`;
    console.log(`  A ${fmt(ga)}; B ${fmt(gb)}`);
    // (heading east: the right wing south — B south of A by some tens of metres; a wingman: the same track, height, speed)
    const dN = (gb.lat - ga.lat) * 111_000;
    expect(dN).toBeLessThan(-5);
    expect(dN).toBeGreaterThan(-60);
    expect(Math.abs(gb.alt - ga.alt)).toBeLessThan(15);
    expect(Math.abs(gb.track - ga.track)).toBeLessThan(0.05);
    expect(Math.abs(gb.gs - ga.gs)).toBeLessThan(8);
    const seen: number[] = [];
    for (const [n, p] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const r = await p.js<{ d: number; right: number }>(
        `(() => { const o = __bh.renderer.netOthers[0]; return { d: Math.hypot(...o.rel), right: o.rel[0] }; })()`,
      );
      console.log(`  ${n} sees the other ${r.d.toFixed(1)} m off (${r.right.toFixed(1)} m to its right)`);
      expect(r.d).toBeLessThan(60);
      seen.push(r.d);
    }
    // (shown now, not a fifth of a second late: both see about the same gap — read 0.1 s apart)
    expect(Math.abs(seen[0]! - seen[1]!)).toBeLessThan(12);
    // (NET_SHOTS=<dir>: both views pictured in formation — the progress sheet's)
    const dir = process.env.NET_SHOTS;
    if (dir) {
      await Bun.$`mkdir -p ${dir}`;
      for (const [n, p] of [
        ["a", a],
        ["b", b],
      ] as const) {
        console.log(
          `  ${n.toUpperCase()}'s HUD: ${await p.js<string>(`__bh.settings.hudKind + " / " + (document.querySelector(".fl-root")?.dataset.kind ?? "?")`)}`,
        );
        const tags = await p.js<string>(
          `JSON.stringify(__bh.net.session.tags.map((g) => [g.name, Math.round(g.dist), g.at.map(Math.round)]))`,
        );
        console.log(`  ${n.toUpperCase()}'s tags ${tags}`);
        await p.shot(`${dir}/flight-${n}.png`);
      }
    }
  }, 90_000);

  test("A's afterburner lit: on B's screen, A's jet with its afterburner", async () => {
    await a.js(`(() => { __bh.camera.pilot.throttle = 1; return 1; })()`);
    await a.press("KeyZ", "z", { shift: true });
    await b.waitFor(`(__bh.renderer.netOthers[0]?.thrust?.boost ?? 1) > 1.05`, 15_000);
    const boost = await b.js<number>(`__bh.renderer.netOthers[0].thrust.boost`);
    console.log(`  B sees A's boost ${boost.toFixed(2)}`);
    expect(boost).toBeGreaterThan(1.05);
  }, 60_000);

  test("a mid-air collision (B put 2 m off A's wing): both destroyed, back on a runway, no pause", async () => {
    const slotA = await a.js<number>(`__bh.net.net.room.slot`);
    // (both held level on the same heading at the same speed — A's afterburner out —: side by side long enough for the
    // touch to be found, 2 s after the placing and on steady samples; free, they drifted apart within 3 s)
    const hold = `(() => { const c = __bh.camera; c.jetModes.ab = false; c.pilot.throttle = 0.6;
      Object.assign(c.jetModes, { alt: Math.round(c.geoNow().alt), hdg: c.attitudeNow().heading, spd: 200 }); return 1; })()`;
    await a.js(hold);
    await Bun.sleep(1500);
    await b.js(`(() => { __bh.net.teleport(${slotA}, 2); return 1; })()`);
    await Bun.sleep(300);
    await b.js(hold);
    // (both destroyed — whoever found it first —, both back on a runway: low, at rest)
    for (const p of [a, b])
      await p.waitFor(`(() => { const g = __bh.camera.geoNow(); return !!g && g.alt < 1500 && g.gs < 5; })()`, 20_000);
    for (const p of [a, b]) expect(await p.js<boolean>(`__bh.settings.animate !== false`)).toBe(true);
    const g = await b.js<{ alt: number; gs: number }>(`__bh.camera.geoNow()`);
    console.log(`  B after the collision: ${g.alt.toFixed(0)} m, ${g.gs.toFixed(1)} m/s — on a runway`);
    expect(g.gs).toBeLessThan(5);
  }, 60_000);
});
