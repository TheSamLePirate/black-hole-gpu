import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A player shot down in a room (docs/NETWORK.md, "Shot down" — ui/netmatch.ts, game/wreckfall.ts): Ana and Ben fly
// over Edwards, the free fight on (the room's default); at the shot Ben 2 300 m up flying east, Ana 12 km east of
// him, low, coming west — his fall and crash before her nose. Ana's hit on Ben — an AIM-120's
// 150 % sent over the network as her shot's is (the missiles themselves: net-battle, net-wing-fight) — downs him: his
// controls cut, his craft falls out of control (it rolls, its nose drops) to the ground — seen so on both pages, its
// smoke trailing —, explodes there on both (where he says it ended), his smoke rising; hidden then on Ana's, the
// kill cam on Ana after; Ben in the air again 6 s after the crash, 5 000 m up. Then his AI wingman, shot down so:
// out of control to its crash too, seen from both. (NET_SHOTS=<dir>: both views.)

describe.skipIf(!E2E)("a player shot down: out of control to the crash, seen from both", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  const shots = process.env.NET_SHOTS ?? "remote-results/net-shotdown";
  const shot = async (p: App, name: string) => {
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  /** the flown craft's height over the ground under it [m] (the fight's frame) */
  const AGL = `(() => { const C = __bh.camera.combat; const P = C?.last; return P ? P.p[2] - C.world.groundZ(P.p[0], P.p[1]) : NaN; })()`;
  /** Ben's craft on Ana's page: its height over the ground there [m], falling, alive (her fight's peer) */
  const PEER = (slot: number) =>
    `(() => { const C = __bh.camera.combat; const q = C?.world.targets.find((x) => x.peer === ${slot}); return q ? { h: q.p[2] - C.world.groundZ(q.p[0], q.p[1]), falling: !!q.falling, alive: q.alive, p: q.p } : null; })()`;
  const SETUP = `(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0; __bh.settings.wingmen = 0; __bh.settings.shipMount = "cockpit"; return 1; })()`;
  const fly = (lon: number) =>
    `(() => { __bh.game.flyAt(34.95, ${lon}, 2300, 90, 220); const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 3000; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 220; return 1; })()`;
  beforeAll(async () => {
    a = await App.boot({ width: 1440, height: 900, lang: "fr", hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (the room's clock Ana's: midday over Edwards)
    await a.js(`(() => { __bh.game.setDate("2026-07-10T20:00:00Z"); __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Shot down")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    b = await App.boot({ width: 1440, height: 900, lang: "fr", hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await b.waitFor(`__bh.net.net.clock.synced`, 30_000);
    // (both east at 220 m/s, 2 300 m over the ground; Ben 1.5 km ahead)
    await a.js(fly(-117.8));
    await b.js(fly(-117.8 + 1500 / (111_195 * Math.cos((34.95 * Math.PI) / 180))));
    for (const [p, other] of [
      [a, sb],
      [b, sa],
    ] as const)
      await p.waitFor(
        `__bh.net.match.match?.mode === "free" && !!__bh.camera.combat?.world.targets.some((q) => q.peer === ${other} && q.alive)`,
        60_000,
      );
    for (const p of [a, b]) await p.waitFor(`__bh.renderer.tracerSettled`, 120_000).catch(() => {});
  }, 480_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  let fallH0 = 0;
  test("Ana's hit downs Ben: his controls cut, his craft out of control — falling on both pages, its smoke", async () => {
    // (both put again — their autopilots' holds wander —, a moment for their samples: Ben where he started, Ana 12 km
    // east of him, 500 m over the ground, coming west at 150 m/s — his fall and his crash before her nose; Ana keeps
    // Ben's last place on her page — her fight's peer — as it comes)
    await a.js(
      `(() => { __bh.game.flyAt(34.95, ${-117.8 + 13_500 / (111_195 * Math.cos((34.95 * Math.PI) / 180))}, 500, 270, 150); return 1; })()`,
    );
    await b.js(
      `(() => { __bh.game.flyAt(34.95, ${-117.8 + 1500 / (111_195 * Math.cos((34.95 * Math.PI) / 180))}, 2300, 90, 220); return 1; })()`,
    );
    await Bun.sleep(1000);
    await a.js(
      `(() => { const c = __bh.camera; c.jetModes.alt = c.jetFigures()?.h ?? c.jetModes.alt; c.jetModes.hdg = 1.5 * Math.PI; c.jetModes.spd = 150; return 1; })()`,
    );
    await Bun.sleep(2000);
    await a.js(
      `(() => { window.__peerLast = null; setInterval(() => { const q = (${PEER(sb)}); if (q?.falling) window.__peerLast = q.p; }, 50); return 1; })()`,
    );
    const h0 = await b.js<number>(AGL);
    console.log(`  Ben ${Math.round(h0)} m over the ground`);
    await a.js(`(() => { __bh.net.net.event({ kind: "hit", to: ${sb}, dmg: 150, by: "aim120" }); return 1; })()`);
    await b.waitFor(`__bh.camera.combat?.downAt !== null && !!__bh.camera.combat?.fall`, 10_000);
    expect(
      await b.js<boolean>(`__bh.camera.puppet !== null && __bh.camera.pilot.throttle === 0 && __bh.camera.combat.fall.endAt === null`),
    ).toBe(true);
    // (the kill hers on both, said)
    for (const p of [a, b])
      await p.waitFor(`__bh.net.match.sheet.row(${sa}).kills === 1 && __bh.net.match.sheet.row(${sb}).deaths === 1`, 10_000);
    const feed = await a.js<string>(`[...document.querySelectorAll(".nm-feed-row")].map((e) => e.textContent).join(" | ")`);
    console.log(`  the feed: ${feed}`);
    expect(feed).toContain("Ana ✕ Ben");
    // (Ana sees him falling — not hidden —, his smoke from his tail)
    await a.waitFor(`(${PEER(sb)})?.falling === true`, 10_000);
    expect(await a.js<number>(`__bh.renderer.netOthers.length`)).toBe(1);
    // (rolling: his top turned about his nose a quarter second on, 1.2–3.2 rad/s; Ben's page keeps whom it follows)
    const roll = await b.js<{ spin: number; turn: number }>(`(async () => {
      const W = __bh.camera.combat.fall.wreck; const u0 = [...W.up];
      await new Promise((r) => setTimeout(r, 250));
      return { spin: W.spin, turn: 1 - W.up.reduce((s, x, k) => s + x * u0[k], 0) }; })()`);
    await b.js(
      `(() => { window.__followed = []; setInterval(() => { const s = __bh.net.session.follow?.slot; if (s !== undefined && !window.__followed.includes(s)) window.__followed.push(s); }, 100); return 1; })()`,
    );
    // (falling: lower on both pages 4 s on, his nose down)
    const pa0 = await a.js<{ h: number }>(PEER(sb));
    await Bun.sleep(4000);
    const h1 = await b.js<number>(AGL);
    const pa1 = await a.js<{ h: number; falling: boolean }>(PEER(sb));
    const W = await b.js<{ fwd: number[]; up: number[]; v: number[]; p: number[]; t: number }>(`__bh.camera.combat.fall.wreck`);
    const U = W.p.map((x) => x / Math.hypot(...W.p));
    const nose = W.fwd.reduce((s, x, k) => s + x * U[k]!, 0);
    console.log(
      `  4 s on: Ben ${Math.round(h0)} → ${Math.round(h1)} m (on Ana's page ${Math.round(pa0.h)} → ${Math.round(pa1.h)} m), nose ${((Math.asin(nose) * 180) / Math.PI).toFixed(0)}°, ${Math.round(Math.hypot(...W.v))} m/s, rolling ${roll.spin.toFixed(1)} rad/s`,
    );
    expect(h1).toBeLessThan(h0 - 50);
    expect(pa1.h).toBeLessThan(pa0.h - 50);
    expect(pa1.falling).toBe(true);
    expect(nose).toBeLessThan(-0.1);
    expect(Math.abs(roll.spin)).toBeGreaterThan(1.1);
    expect(roll.turn).toBeGreaterThan(0.005);
    fallH0 = h0;
    // (his own view, the cockpit's; Ana's on him from hers: the fall ahead)
    await shot(b, "b-falling-cockpit");
    await Bun.sleep(2500);
    await shot(a, "a-falling-cockpit");
    const smoke = await a.js<number>(`__bh.camera.contrails.trails.length`);
    console.log(`  Ana's trails: ${smoke}`);
  }, 60_000);

  test("the crash: on the ground, its explosion on both pages where he says it ended, his smoke rising; hidden on Ana's", async () => {
    await b.waitFor(`__bh.camera.combat?.fall?.endAt != null`, 60_000);
    const F = await b.js<{ t: number; broke: boolean }>(
      `(() => { const W = __bh.camera.combat.fall.wreck; return { t: W.t, broke: W.broke }; })()`,
    );
    console.log(
      `  Ben down in ${F.t.toFixed(1)} s from ${Math.round(fallH0)} m — ${await b.js<string>(`__bh.net.match.log.slice(-2).join(" / ")`)}`,
    );
    expect(F.broke).toBe(false);
    expect(
      await b.js<boolean>(`__bh.camera.combat.booms.some((x) => x.size === 2.5) && __bh.camera.combat.crashes.some((x) => x.key === "me")`),
    ).toBe(true);
    // (Ana: his impact said — the explosion, the smoke — near where his craft last was, on the ground; hidden)
    await a.waitFor(`__bh.camera.combat.crashes?.some((x) => x.key === "s${sb}")`, 10_000);
    const crash = await a.js<{ p: number[]; h: number }>(
      `(() => { const C = __bh.camera.combat; const x = C.crashes.find((y) => y.key === "s${sb}"); return { p: x.p, h: x.p[2] - C.world.groundZ(x.p[0], x.p[1]) }; })()`,
    );
    const last = await a.js<number[] | null>(`window.__peerLast`);
    const off = last ? Math.hypot(crash.p[0]! - last[0]!, crash.p[1]! - last[1]!) : Number.NaN;
    console.log(
      `  Ana: his crash ${Math.round(off)} m (over the ground) from his craft's last place there, ${crash.h.toFixed(1)} m over the ground`,
    );
    expect(off).toBeLessThan(600);
    expect(Math.abs(crash.h)).toBeLessThan(5);
    expect(await a.js<boolean>(`__bh.camera.combat.booms.some((x) => x.size === 2.5)`)).toBe(true);
    await a.waitFor(`__bh.net.session.hidden.has(${sb}) && __bh.renderer.netOthers.length === 0`, 5000);
    await Bun.sleep(600);
    await shot(a, "a-crash-cockpit");
    await shot(b, "b-crash-cockpit");
    await Bun.sleep(5000);
    await shot(a, "a-crash-smoke");
  }, 90_000);

  test("Ben: the kill cam on Ana, then in the air again 6 s after the crash, 5 000 m up — seen again by Ana", async () => {
    // (the kill cam: Ana's craft followed 2.5 s after his crash — seen while the shots were taken)
    await b.waitFor(`window.__followed.includes(${sa}) || __bh.camera.combat?.downAt === null`, 10_000);
    expect(await b.js<number[]>(`window.__followed`)).toEqual([sa]);
    await b.waitFor(`__bh.camera.combat?.downAt === null`, 15_000);
    expect(await b.js<boolean>(`__bh.camera.puppet === null && __bh.net.session.follow === null && !__bh.camera.combat.fall`)).toBe(true);
    expect(await b.js<number>(`__bh.camera.combat.world.damage`)).toBe(0);
    await Bun.sleep(1500);
    const h = await b.js<number>(AGL);
    console.log(`  Ben again ${Math.round(h)} m over the ground`);
    expect(h).toBeGreaterThan(4000);
    await a.waitFor(`!__bh.net.session.hidden.has(${sb}) && (${PEER(sb)})?.alive === true`, 15_000);
    await shot(b, "b-again");
  }, 60_000);

  test("Ben's AI wingman shot down by Ana: out of control to its crash too — falling, its smoke, its explosion on both pages", async () => {
    // (Ben where he started, his wingman Two on his wing; Ana 12 km east of him, low, coming west)
    await b.js(
      `(() => { __bh.settings.wingmen = 1; __bh.game.flyAt(34.95, ${-117.8 + 1500 / (111_195 * Math.cos((34.95 * Math.PI) / 180))}, 2300, 90, 220); return 1; })()`,
    );
    await a.js(
      `(() => { __bh.game.flyAt(34.95, ${-117.8 + 13_500 / (111_195 * Math.cos((34.95 * Math.PI) / 180))}, 500, 270, 150); return 1; })()`,
    );
    await b.waitFor(`__bh.camera.wing?.list.some((w) => w.k === 2 && w.alive)`, 20_000);
    await a.waitFor(`__bh.camera.remoteWings.get(${sb})?.list.some((w) => w.k === 2 && !w.x)`, 20_000);
    await Bun.sleep(3000);
    /** Two's height over the ground on Ben's page [m] (its wreck's when falling), on Ana's (the room's sample) */
    const TWO = `(() => { const w = __bh.camera.wing.list.find((x) => x.k === 2); const p = w.wreck && !w.alive ? w.wreck.p : w.jet.p; const R = Math.hypot(...p); return { alive: w.alive, falling: !!w.wreck && !w.wreck.end, ended: !!w.wreck?.end, broke: !!w.wreck?.broke, t: w.wreck?.t ?? 0, p }; })()`;
    const h0 = await b.js<number>(`__bh.camera.wingShips().length`);
    expect(h0).toBeGreaterThan(0);
    await a.js(`(() => { __bh.net.net.event({ kind: "hitWing", to: ${sb}, k: 2, dmg: 150, by: "aim120" }); return 1; })()`);
    await b.waitFor(`(${TWO}).falling`, 10_000);
    // (falling on both: drawn still, on Ana's its samples marked so, not a radar track there any more — its smoke)
    await a.waitFor(`__bh.camera.remoteWings.get(${sb})?.list.some((w) => w.k === 2 && w.x === 1)`, 5000);
    const p0 = await b.js<number[]>(`(${TWO}).p`);
    const q0 = await a.js<number[]>(`__bh.camera.remoteWings.get(${sb}).list.find((w) => w.k === 2).p`);
    await Bun.sleep(4000);
    const p1 = await b.js<number[]>(`(${TWO}).p`);
    const q1 = await a.js<number[]>(`__bh.camera.remoteWings.get(${sb}).list.find((w) => w.k === 2).p`);
    const down = (u: number[], v: number[]) => Math.hypot(...u) - Math.hypot(...v);
    console.log(`  Two 4 s on: ${Math.round(down(p0, p1))} m lower on Ben's page, ${Math.round(down(q0, q1))} m on Ana's`);
    expect(down(p0, p1)).toBeGreaterThan(50);
    expect(down(q0, q1)).toBeGreaterThan(50);
    expect(await b.js<number>(`__bh.camera.wingShips().length`)).toBeGreaterThan(0);
    expect(await a.js<boolean>(`__bh.camera.radarObjects.some((o) => o.id === "rwg:${sb}:2")`)).toBe(false);
    expect(await b.js<boolean>(`__bh.camera.combat.world.targets.some((q) => q.id === 20_002 && q.falling)`)).toBe(true);
    await shot(a, "a-wing-falling");
    // (its crash: on the ground, the explosion and the smoke on both pages)
    await b.waitFor(`(${TWO}).ended`, 60_000);
    const T = await b.js<{ t: number; broke: boolean }>(TWO);
    console.log(`  Two down in ${T.t.toFixed(1)} s — Ana's log: ${await a.js<string>(`__bh.net.match.log.slice(-1).join("")`)}`);
    expect(T.broke).toBe(false);
    expect(await b.js<boolean>(`__bh.camera.combat.crashes.some((x) => x.key === "w2")`)).toBe(true);
    await a.waitFor(`__bh.camera.combat.crashes?.some((x) => x.key === "w${sb}:2")`, 10_000);
    const crash = await a.js<number>(
      `(() => { const C = __bh.camera.combat; const x = C.crashes.find((y) => y.key === "w${sb}:2"); return x.p[2] - C.world.groundZ(x.p[0], x.p[1]); })()`,
    );
    expect(Math.abs(crash)).toBeLessThan(5);
    await a.waitFor(`!__bh.camera.remoteWings.get(${sb})?.list.some((w) => w.k === 2)`, 5000);
    await Bun.sleep(600);
    await shot(a, "a-wing-crash");
    for (const p of [a, b]) expect(p.cdp.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  }, 120_000);
});
