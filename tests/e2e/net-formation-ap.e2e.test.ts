import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Formation flight (game/formation.ts, the room panel's Formation): Ana's F-35 on her autopilot over Edwards, Ben's
// 3 km behind her and 1 km to her left (the light wind, the default: its turbulence each craft's own) — Formation: his autopilot rejoins her right wing and holds it; she turns
// 90°, she speeds up: he stays there; the autopilot's key lets it go (the holds kept). From 60 km: Beside first,
// then the formation. (NET_SHOTS=<dir>: Ben's view in formation.)

describe.skipIf(!E2E)("formation flight's autopilot", () => {
  let a: App;
  let b: App;
  let sa = 0;
  const shots = process.env.NET_SHOTS;
  const SETUP = `(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; return 1; })()`;
  /** Ben's distance to his slot [m] as his formation reads it, and Ana's true distance [m] */
  const slot = () => b.js<number>(`__bh.camera.form?.last?.dist ?? NaN`);
  const gap = () =>
    b.js<number>(
      `(() => { const W = __bh.net.net.remotes.track(${sa})?.at(__bh.net.session.d.sceneTime()), o = __bh.camera.netOwn(); return W && o ? Math.hypot(...[0, 1, 2].map((k) => W.p[k] - o.p[k])) : NaN; })()`,
    );
  /** the worst slot distance over `s` seconds, sampled each half second */
  const worst = async (s: number) => {
    let w = 0;
    for (let k = 0; k < s * 2; k++) {
      w = Math.max(w, await slot());
      await Bun.sleep(500);
    }
    return w;
  };
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Formation")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
    // (Ana on her holds: 3000 m, 090°, 220 m/s)
    await a.js(`(() => { __bh.game.flyAt(34.95, -117.80, 2300, 90, 220); return 1; })()`);
    await Bun.sleep(1000);
    await a.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 3000; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 220; return 1; })()`,
    );
    await b.waitFor(
      `__bh.net.net.remotes.track(${sa})?.latest?.kind === 3 && !(__bh.net.net.remotes.track(${sa}).latest.flags & 1)`,
      30_000,
    );
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("from 3 km behind and 1 km to her left: Formation — on her right wing within two minutes, held within a few metres (the light wind)", async () => {
    // (Ben 3 km behind her, 1 km to her left, 300 m under, at her speed: about 0.027° of longitude per 2.5 km there)
    const at = await a.js<number[]>(`(() => { const g = __bh.camera.geoNow(); return [g.lat, g.lon]; })()`);
    await b.js(`(() => { __bh.game.flyAt(${at[0]! + 0.009}, ${at[1]! - 0.033}, 2000, 85, 220); return 1; })()`);
    await Bun.sleep(1500);
    console.log(`  Ben: ${await b.js<string>(`__bh.net.formation(${sa})`)} — ${(await gap()).toFixed(0)} m from her`);
    await b.waitFor(`__bh.camera.jetModes.form === "Ana"`, 5000);
    // (what the law is given and does, each half second: Ben's page)
    await b.js(`(() => { window.__fm = []; const c = __bh.camera, t0 = performance.now();
      window.__fmT = setInterval(() => { const F = c.form, r = F?.last; if (!r) return; const L = F.lead();
        window.__fm.push([((performance.now() - t0) / 1000).toFixed(1), r.along.toFixed(1), r.cross.toFixed(1), r.up.toFixed(1),
          (r.bank * 57.3).toFixed(1), r.spd.toFixed(1), c.jetFigures()?.V.toFixed(1), L ? (L.aLat ?? Number.NaN).toFixed(2) : "-", L ? Math.hypot(...L.v).toFixed(2) : "-"].join(" ")); }, 500); return 1; })()`);
    const t0 = Date.now();
    const log: string[] = [];
    let d = Infinity;
    while (Date.now() - t0 < 150_000) {
      await Bun.sleep(5000);
      d = await slot();
      log.push(`${Math.round((Date.now() - t0) / 1000)} s ${d.toFixed(1)} m`);
      if (d < 5) break;
    }
    console.log(`  to the slot: ${log.join(", ")}`);
    const fm = await b.js<string[]>(`window.__fm`);
    console.log(
      `  t along cross up bank spdT V aLat |vL| (every 2 s)\n${fm
        .filter((_, i) => i % 4 === 0)
        .slice(-40)
        .map((l) => `    ${l}`)
        .join("\n")}`,
    );
    expect(d).toBeLessThan(5);
    await Bun.sleep(10_000);
    const held = await worst(20);
    const g = await gap();
    console.log(`  held: within ${held.toFixed(2)} m of the slot over 20 s; ${g.toFixed(1)} m from Ana (the slot 25.8 m right, 15 m back)`);
    // (the light wind's turbulence, each craft its own: a few metres fore and aft — across and up, under one)
    expect(held).toBeLessThan(8);
    expect(Math.abs(g - Math.hypot(25.8, 15))).toBeLessThan(8);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await b.shot(`${shots}/form-b.png`);
      await a.shot(`${shots}/form-a.png`);
    }
  }, 240_000);

  test("Ana turns 90° right, then speeds up to 250 m/s: Ben stays on her wing", async () => {
    const from = await b.js<number>(`window.__fm.length`);
    await a.js(`(() => { __bh.camera.jetModes.hdg = Math.PI; return 1; })()`);
    // (her 90° at 30° of bank: about a minute)
    const turn = await worst(65);
    const fm = await b.js<string[]>(`window.__fm.slice(${from})`);
    console.log(
      `  t along cross up bank spdT V aLat |vL| (her turn, each second)\n${fm
        .filter((_, i) => i % 2 === 0)
        .filter((_, i) => i % 2 === 0)
        .slice(0, 35)
        .map((l) => `    ${l}`)
        .join("\n")}`,
    );
    const settled = await worst(15);
    console.log(`  her turn (Ben on the inside): ${turn.toFixed(1)} m off at worst; then ${settled.toFixed(2)} m`);
    // (her roll into it and the light wind's gusts: the worst a few seconds as she rolls in)
    expect(turn).toBeLessThan(25);
    expect(settled).toBeLessThan(10);
    await a.js(`(() => { __bh.camera.jetModes.spd = 250; return 1; })()`);
    const fast = await worst(25);
    const after = await worst(10);
    console.log(`  her speed-up: ${fast.toFixed(1)} m off at worst; then ${after.toFixed(2)} m`);
    expect(fast).toBeLessThan(25);
    expect(after).toBeLessThan(10);
  }, 180_000);

  test("the autopilot's key lets it go: altitude, heading and speed held", async () => {
    console.log(`  Ben: ${await b.js<string>(`__bh.camera.jetToggle("ap")`)}`);
    const m = await b.js<{ alt: number | null; hdg: number | null; spd: number | null; form: string | null }>(
      `(() => { const m = __bh.camera.jetModes; return { alt: m.alt, hdg: m.hdg, spd: m.spd, form: m.form ?? null }; })()`,
    );
    expect(m.form).toBe(null);
    expect(await b.js<boolean>(`__bh.camera.form === null`)).toBe(true);
    expect(m.alt).not.toBe(null);
    expect(m.spd).not.toBe(null);
  }, 30_000);

  test("from 60 km: Beside first, then the formation", async () => {
    const at = await a.js<number[]>(`(() => { const g = __bh.camera.geoNow(); return [g.lat, g.lon]; })()`);
    await b.js(`(() => { __bh.game.flyAt(${at[0]! - 0.5}, ${at[1]!}, 2000, 0, 220); return 1; })()`);
    await Bun.sleep(1500);
    console.log(`  ${((await gap()) / 1000).toFixed(0)} km off — Ben: ${await b.js<string>(`__bh.net.formation(${sa})`)}`);
    await b.waitFor(`__bh.camera.jetModes.form === "Ana"`, 5000);
    await Bun.sleep(8000);
    const d = await worst(5);
    console.log(`  8 s on: ${d.toFixed(1)} m from the slot, ${(await gap()).toFixed(1)} m from Ana`);
    expect(d).toBeLessThan(15);
  }, 60_000);
});
