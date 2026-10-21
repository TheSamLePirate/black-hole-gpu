import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// The missiles' cues (PLAN-RADAR-AAA RD8 — P9): solo, in the drone hunt over the Alps, an AIM-120 at a drone — its line
// to its target and its time to go on the HUD's scope, PITBULL in its last 15 km with its A-pole, SPLASH or MISS where it
// ended with its F-pole —; an SA-6 at us — at us, its time to go —, flares and chaff out, the end said. Then in a room,
// the free fight: Ana fires at Ben 8 km ahead — her missile's cues, the same missile at him (at him, its time to go) and
// on her crew's console (its time, its end). Every frame's missiles sampled in the page (an end lasts 3 s).
// (E2E_SHOTS=<dir>: the scope with a missile flying.)

/** the HUD's missiles sampled in a page every 100 ms: window.__mc */
const SAMPLE = `(() => { window.__mc = []; clearInterval(window.__mcI); window.__mcI = setInterval(() => {
  const R = __bh.camera.flightInfo().radar; if (!R) return;
  for (const m of R.missiles ?? []) window.__mc.push({ id: m.id, red: m.red, atUs: m.atUs, tti: m.tti, end: m.end ?? null,
    pitbull: !!m.pitbull, apole: m.apole ?? null, fpole: m.fpole ?? null, decoyed: !!m.decoyed, line: m.tx !== null }); }, 100); return 1; })()`;
type Mc = {
  id: string;
  red: boolean;
  atUs: boolean;
  tti: number | null;
  end: string | null;
  pitbull: boolean;
  apole: number | null;
  fpole: number | null;
  decoyed: boolean;
  line: boolean;
};

describe.skipIf(!E2E)("the missiles' cues", () => {
  let a: App;
  let b: App | null = null;
  let crew: CrewFrame | null = null;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; __bh.settings.wind = 0; __bh.settings.wingmen = 0; return 1; })()`,
    );
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { Object.assign(__bh.settings, { weather: "fair", f35InfiniteAmmo: true }); __bh.net.setName("Ana");
      __bh.game.flyAt(45.9, 6.9, 4500, 90, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await a.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await a.click(`[data-testid="chp-fight-drones"]`);
    await a.waitFor(`__bh.camera.combat?.status === "run" && __bh.camera.combat.world.targets.length >= 3`, 20_000);
    await a.waitFor("__bh.camera.radar.tracks.size > 0", 15_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("solo: an AIM-120 at a drone — its line, its time to go, PITBULL and its A-pole, its end and its F-pole", async () => {
    await a.js(SAMPLE);
    await a.js(`(() => { const c = __bh.camera; c.weaponSelect("aim120"); return c.lockOnName(); })()`);
    await a.waitFor("__bh.camera.combat.world.lock !== null", 5000);
    let fired = "";
    for (let k = 0; k < 3; k++) {
      fired = (await a.js<string>(`__bh.camera.combatTrigger("fire") ?? "Fired"`)) ?? "";
      await a.waitFor(`__bh.camera.combat.world.ownMissiles().length > 0`, 3000).catch(() => {});
      if (await a.js<boolean>(`__bh.camera.combat.world.ownMissiles().length > 0`)) break;
      await Bun.sleep(1500);
    }
    console.log(`  ${fired}`);
    await Bun.sleep(1200);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await a.shot(`${shots}/missile-scope.png`);
    }
    // (its end: SPLASH or MISS on the scope, three seconds)
    await a.waitFor(`window.__mc.some((m) => !m.red && m.end)`, 90_000);
    const mc = await a.js<Mc[]>("window.__mc");
    const ours = mc.filter((m) => !m.red);
    const flying = ours.filter((m) => !m.end);
    const ended = ours.find((m) => m.end)!;
    console.log(
      `  ours: ${flying.length} samples flying, time to go ${Math.max(...flying.map((m) => m.tti ?? 0)).toFixed(1)} s at most; PITBULL ${flying.some((m) => m.pitbull)} (A-pole ${flying.find((m) => m.apole !== null)?.apole?.toFixed(0)} m); ${ended.end}, F-pole ${ended.fpole?.toFixed(0)} m`,
    );
    expect(flying.some((m) => m.line && m.tti !== null && m.tti > 0)).toBe(true);
    expect(flying.some((m) => m.pitbull && m.apole !== null && m.apole > 0)).toBe(true);
    // (no promise of minutes at the launch: its motor's speed counted)
    expect(Math.max(...flying.map((m) => m.tti ?? 0))).toBeLessThan(120);
    expect(ended.end).toMatch(/splash|miss/);
    expect(ended.fpole).not.toBeNull();
    expect(ended.tti).toBeNull();
  }, 150_000);

  test("solo: an SA-6 at us — at us, its time to go —, decoys out, its end said", async () => {
    await a.js(SAMPLE);
    // (a SAM 9 km off our left, climbing at us — the fight's own missile, its seeker a radar's)
    await a.js(`(() => { const C = __bh.camera.combat, W = C.world, P = __bh.camera.combatPlayer();
      const right = [P.fwd[1], -P.fwd[0], 0], k = 1 / Math.hypot(right[0], right[1]);
      const p = [P.p[0] - right[0] * k * 9000, P.p[1] - right[1] * k * 9000, P.p[2] - 1500];
      const d = [P.p[0] - p[0], P.p[1] - p[1], P.p[2] - p[2]], n = Math.hypot(...d);
      W.missiles.push({ id: W.nextId++, kind: "sam", owner: "red", from: W.targets[0].id, p, v: d.map((x) => (x / n) * 400),
        t: 0, target: -1, alive: true, seen: new Set() }); return 1; })()`);
    await a.waitFor(`window.__mc.some((m) => m.red && m.atUs && m.tti !== null)`, 5000);
    await a.js(`__bh.camera.combatTrigger("cm")`);
    await Bun.sleep(400);
    await a.js(`__bh.camera.combatTrigger("cm")`);
    await a.waitFor(
      `window.__mc.some((m) => m.red && m.end) || __bh.camera.combat.world.missiles.every((m) => m.owner !== "red" || !m.alive)`,
      60_000,
    );
    await Bun.sleep(500);
    const mc = await a.js<Mc[]>("window.__mc");
    const theirs = mc.filter((m) => m.red);
    const ended = theirs.find((m) => m.end);
    console.log(
      `  theirs: at us ${theirs.some((m) => m.atUs)}, time to go ${theirs.find((m) => m.tti !== null)?.tti?.toFixed(1)} s, decoyed ${theirs.some((m) => m.decoyed)}, end ${ended?.end ?? "—"}`,
    );
    expect(theirs.some((m) => m.atUs && m.tti !== null && m.tti > 0 && m.tti < 60)).toBe(true);
    expect(ended?.end ?? null).toMatch(/splash|miss/);
  }, 120_000);

  test("in a room, the free fight: Ana's AIM-120 at Ben — her cues, his warning, her crew's console", async () => {
    await a.js(`(() => { __bh.camera.combatEnd(); return 1; })()`);
    await a.js(`__bh.net.create("Missiles")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    const sa = await a.js<number>(`__bh.net.net.room.slot`);
    crew = new CrewFrame(a);
    await crew.open(code, "Cid", { w: 900, h: 600 });
    await a.js(`(() => { document.querySelector('#crew-frame').style.visibility = 'hidden'; return 1; })()`);
    b = await App.boot({ width: 1200, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.wingmen = 0; __bh.net.setName("Ben"); return 1; })()`);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.waitFor(`__bh.net.net.clock.synced`, 30_000);
    const sb = await b.js<number>(`__bh.net.net.room.slot`);
    // (Ben 8 km ahead of Ana on her heading, at her height, the same way)
    const g = await a.js<{ lat: number; lon: number; alt: number; hdg: number }>(
      `(() => { const g = __bh.camera.geoNow(); return { lat: g.lat, lon: g.lon, alt: g.alt, hdg: __bh.camera.attitudeNow().heading }; })()`,
    );
    const D = Math.PI / 180;
    const lat = g.lat + (Math.cos(g.hdg) * 8000) / 111_195,
      lon = g.lon + (Math.sin(g.hdg) * 8000) / (111_195 * Math.cos(g.lat * D));
    await b.js(`(() => { __bh.game.flyAt(${lat}, ${lon}, ${Math.round(g.alt)}, ${(g.hdg / D).toFixed(1)}, 230); const c = __bh.camera;
      c.jetModes.alt = ${Math.round(g.alt)}; c.jetModes.hdg = ${g.hdg}; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.match?.mode === "free" && !!__bh.camera.combat?.free`, 30_000);
    await a.waitFor(`__bh.camera.combat.world.targets.some((q) => q.peer === ${sb} && q.alive && !q.friendly)`, 20_000);
    for (const p of [a, b]) await p.js(SAMPLE);
    await crew.js(`(() => { window.__cmc = []; clearInterval(window.__cmcI); window.__cmcI = setInterval(() => {
      for (const c of __crew.model.contacts()) if (c.kind === "missile") window.__cmc.push({ id: c.id, type: c.type }); }, 100); return 1; })()`);
    // (her lock on him, the AIM-120: fox three)
    await a.waitFor(`__bh.camera.radarObjects.some((x) => x.id === "cmb:${10_000 + sb}")`, 30_000);
    for (let k = 0; k < 8 && !(await a.js<boolean>(`__bh.camera.combat.world.lock === ${10_000 + sb}`)); k++) {
      await a.js(`__bh.camera.combatTrigger("lock")`);
      await Bun.sleep(300);
    }
    expect(await a.js<number>(`__bh.camera.combat.world.lock`)).toBe(10_000 + sb);
    await a.js(`__bh.camera.weaponSelect("aim120")`);
    await a.js(`__bh.camera.combatTrigger("fire")`);
    await a.waitFor(`__bh.camera.combat.world.ownMissiles().length > 0`, 5000);
    // (at him: the warning, its time to go; he drops his decoys)
    await b.waitFor(`window.__mc.some((m) => m.red && m.atUs && m.tti !== null)`, 10_000).catch(async (e) => {
      console.log(
        `  Ben's world: ${await b!.js<string>(`JSON.stringify({ msl: __bh.camera.combat?.world.missiles.map((m) => ({ o: m.owner, t: m.target, r: m.remote, a: m.alive })),
          pic: (__bh.camera.picture?.tracks ?? []).filter((T) => T.kind === "missile").map((T) => ({ id: T.id, msl: T.msl, s: T.sensors })),
          hud: (__bh.camera.flightInfo().radar?.missiles ?? []).length, mc: window.__mc.slice(-3), ana: __bh.camera.combat ? "fight" : "none" })`)}`,
      );
      throw e;
    });
    await b.js(`__bh.camera.combatTrigger("cm")`);
    await a.waitFor(`window.__mc.some((m) => !m.red && m.end)`, 60_000);
    await Bun.sleep(800);
    const am = await a.js<Mc[]>("window.__mc");
    const bm = await b.js<Mc[]>("window.__mc");
    const cm = await crew.js<{ id: string; type: string }[]>("window.__cmc");
    const ended = am.find((m) => !m.red && m.end)!;
    console.log(
      `  Ana: time to go ${am.find((m) => !m.red && m.tti !== null)?.tti?.toFixed(1)} s, PITBULL ${am.some((m) => m.pitbull)}, ${ended.end} F-pole ${ended.fpole?.toFixed(0)} m`,
    );
    console.log(
      `  Ben: at him ${bm.some((m) => m.red && m.atUs)}, time to go ${bm.find((m) => m.red && m.tti !== null)?.tti?.toFixed(1)} s`,
    );
    console.log(`  crew: ${[...new Set(cm.map((c) => c.type))].slice(0, 8).join(" · ")}`);
    expect(am.some((m) => !m.red && m.line && m.tti !== null)).toBe(true);
    expect(am.some((m) => !m.red && m.pitbull)).toBe(true);
    expect(ended.fpole).not.toBeNull();
    expect(bm.some((m) => m.red && m.atUs && m.tti !== null && m.tti > 0)).toBe(true);
    expect(cm.some((c) => /\d+s/.test(c.type))).toBe(true);
    expect(cm.some((c) => /SPLASH|MISS/.test(c.type))).toBe(true);
    void sa;
    for (const p of [a, b]) expect(p.cdp.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  }, 400_000);
});
