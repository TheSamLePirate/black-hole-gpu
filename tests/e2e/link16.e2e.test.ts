import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The Link 16 between the room's F-35s (PLAN-RADAR-AAA RD12): an airliner put at one place on both pages (a source of
// the radar's own kind, the same id), 25 km before Ana's nose — her radar holds it — and behind Ben, who flies the
// other way — his radar cannot. Out of a match, Ben's picture holds it by the datalink (dashed on his screens, its IFF
// known); one track, not two. In the free fight (everyone against everyone): shared no more.

/** the airliner's source, its Earth-fixed place from its geodetic one (WGS84), still, 300 m above Ana's height */
const SOURCE = (lat: number, lon: number, h: number) => `(() => {
  const A = 6378137, F = 1 / 298.257223563, e2 = F * (2 - F), D = Math.PI / 180;
  const la = ${lat} * D, lo = ${lon} * D, N = A / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  const q = [(N + ${h}) * Math.cos(la) * Math.cos(lo), (N + ${h}) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + ${h}) * Math.sin(la)];
  __bh.camera.radarSources.set("tst", (fix) => [{ id: "trf:L16TST", r: fix.toLocal(q), v: [0, 0, 0], rcs: 20, kind: "air", iff: "neutral",
    name: "L16TST", squawk: false }]);
  return 1; })()`;

describe.skipIf(!E2E)("the Link 16", () => {
  let a: App;
  let b: App;
  const SETUP = `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, wind: 0, wingmen: 0, netFreeFight: false }); return 1; })()`;
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Link 16")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await b.waitFor(`__bh.net.net.clock.synced`, 30_000);
    // (Ana east over the Alps; Ben 17 km south of the airliner, west — it is 96° off his nose)
    await a.js(`(() => { __bh.game.flyAt(45.9, 6.9, 6000, 90, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = Math.PI / 2; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await b.js(`(() => { __bh.game.flyAt(45.75, 7.2, 6000, 270, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = 1.5 * Math.PI; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(1500);
    const h = await a.js<number>(`__bh.camera.geoNow().alt`);
    for (const p of [a, b]) await p.js(SOURCE(45.9, 7.2226, h + 300));
  }, 480_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("out of a match: Ana's radar holds it, Ben's does not — Ben holds it by the datalink, one track", async () => {
    await a.waitFor(`__bh.camera.radar.tracks.has("trf:L16TST")`, 20_000);
    expect(await b.js<boolean>(`__bh.camera.radar.tracks.has("trf:L16TST") && !__bh.camera.radar.tracks.get("trf:L16TST").datalink`)).toBe(
      false,
    );
    await b.waitFor(`(__bh.radar.track("trf:L16TST")?.sensors ?? 0) & 2`, 15_000);
    const T = await b.js<{ sensors: number; state: string; iff: string; n: number; scope: boolean }>(`(() => {
      const T = __bh.radar.track("trf:L16TST"); return { sensors: T.sensors, state: T.state, iff: T.iff,
        n: __bh.radar.picture().tracks.filter((x) => x.id === "trf:L16TST").length,
        scope: (__bh.camera.flightInfo().radar?.contacts ?? []).some((k) => k.id === "trf:L16TST" && k.datalink) }; })()`);
    console.log(`  Ben's picture: ${JSON.stringify(T)}`);
    expect(T.sensors & 1).toBe(0);
    expect(T.state).toBe("datalink");
    expect(T.iff).toBe("neutral");
    expect(T.n).toBe(1);
    expect(T.scope).toBe(true);
  }, 90_000);

  test("the free fight (everyone against everyone): shared no more", async () => {
    for (const p of [a, b]) await p.js(`(() => { __bh.settings.netFreeFight = true; return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.match?.mode === "free"`, 30_000);
    await b.waitFor(`!((__bh.radar.track("trf:L16TST")?.sensors ?? 0) & 2)`, 15_000);
    console.log(`  Ben's picture in the free fight: sensors ${await b.js<number>(`__bh.radar.track("trf:L16TST")?.sensors ?? -1`)}`);
    for (const p of [a, b]) expect(p.cdp.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  }, 90_000);
});
