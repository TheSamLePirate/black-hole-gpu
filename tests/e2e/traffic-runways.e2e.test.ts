import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { airframeOf, MESH } from "../../src/game/airtypes";
import { cellOf, cellOrigin, toCell } from "../../src/system/building-cells";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";
import { readSegment, readStreetHeader, SegmentFlag, STREET_CACHE, streetCacheUrl } from "../../src/system/street-cells";
import { App, E2E, stopServer } from "./lib/app";
import { gpuTimes, passesJs } from "./lib/bridge-views";
import {
  at,
  DELAY,
  FINAL,
  frameOn as frameOnTraffic,
  GEARUP,
  injectTraffic,
  LIFTOFF,
  onWay,
  PARKED,
  ROLLOUT,
  runTo as runToTraffic,
  sfoPlanes,
  W01R,
  W28L,
  WHEELS,
} from "./lib/sfo-traffic";

// The real traffic against the game's runways (traffic/runway-phase.ts — Sam, 24 Nov 2026: « positions cohérentes avec les pistes du
// jeu, au sol jamais sous le sol, décollage et atterrissage sur les pistes, train sorti au décollage et à l'atterrissage, rentré en
// croisière »): at San Francisco, no craft, the free camera; four airliners made up as ADS-B reports them (`camera.traffic`, the
// live feed set aside; the traffic's clock the test's): one landing on 28L reported 30 m off its axis and 25 m high, one taking off
// from 01R 15 m off, its climb 20 m high, three parked at the gates. Each framed by the camera beside it at the moment judged: on
// short final (on the axis, gear down), rolled out (on the runway, its wheels on its graded level), lifting off (gear down), climbing
// past 150 m (gear wanted up, then up), parked (on the ground, not under it, at OSM's G stands on the apron — off every road of the
// game's street cells) — the A320's rig drawn near the view (its gear). Since 24 Nov 2026 (PROBLEMES « le train des avions dessinés
// sans gréement »): every airliner its gear — the plain meshes' baked (traffic/airliner-gear.ts), up in cruise on a 737 drawn plain
// and on a CRJ —, its airline's colours by its callsign (traffic/livery.ts: United, Delta, Southwest at the gates, SkyWest's CRJ beside
// them, American's 737 and SkyWest's CRJ in cruise), its shadow on the apron (ship-casters.ts: the shadow map's second half), and
// what they cost — the rigged A320s, the shadows, all the craft's passes — on the parked view (ABBA, an A/A beside).
// Steps: 1 boot · 2 the free camera at SFO, its runways and ground in · 3 the airliners made up · 4 landing: short final · 5 landing:
// rolled out · 6 take-off: lift-off · 7 take-off: gear up · 8 cruise: gear up, drawn plain · 9 parked (liveries, shadows) · 10 costs.
// Shots in TRW_OUT (remote-results/traffic-runways): final, rollout, liftoff, gearup, cruise-b738, cruise-crj, parked,
// parked-noshadow, parked-dal, parked-crj.
// TRW_COST=1 (a measure, not judged — perf lot of 24 Nov 2026): at the short final and at the gates, the render scale pinned at 0.75,
// the GPU's time with the traffic's craft drawn and without (renderer.debugSkipShip: the craft's whole pass), on/off/off/on, and each
// pass's median (gpuprof) — in TRW_OUT/cost.json (~1.5 min more; 256 s in all on kerr-mini, 24 Nov 2026).
// Duration: ~6–7 min (boot and SFO's tiles ~1.5 min, each moment 15 s of the traffic's clock, each wait capped at 45–60 s; the costs
// ~1 min).
// Done when: the parked shots are taken, every moment's phase, gear, runway and height over the ground asserted, the costs printed.

const OUT = process.env.TRW_OUT ?? "remote-results/traffic-runways";
const D = Math.PI / 180;
/** a parked airliner's clearance from the roads: its fuselage's half-width [m] — its origin this far off any road's carriageway */
const ROAD_CLEAR_M = 2;

describe.skipIf(!E2E)("the real traffic on the game's runways: on them, never under the ground, its gear by its phase", () => {
  let app: App;
  type Craft = {
    id: string;
    p: number[];
    fwd: number[];
    right: number[];
    up: number[];
    gnd: boolean;
    over: number;
    msl: number;
    phase: string;
    gear: number;
    gearWanted: number;
    runway: { key: string; a: number; c: number; pull: number } | null;
  };
  const craft = (id: string) =>
    app.js<Craft | null>(
      `(() => { const c = __bh.camera.trafficNow().find((x) => x.id === "${id}"); return c ? JSON.parse(JSON.stringify(c)) : null; })()`,
    );
  /** the traffic's clock run in real time up to the moment `m` [s after T0], from 12 s before it; then held (lib/sfo-traffic.ts) */
  const runTo = (m: number) => runToTraffic(app, m);
  /** the camera panel's Chase view on an aircraft, the place's data in about it (lib/sfo-traffic.ts) */
  const frameOn = (c: Craft, yaw: number, pitch: number, zoom: number) => frameOnTraffic(app, c.id, yaw, pitch, zoom);
  /** the ground under an aircraft [m over the ellipsoid] (the player's contact ground), and its place */
  const under = async (c: Craft) => {
    const g = cartToGeodetic(WGS84_A, WGS84_F, c.p as [number, number, number]);
    const lat = g.lat / D,
      lon = g.lon / D;
    const ground = await app.js<number>(`__bh.sys.groundAt(${lat}, ${lon})`);
    return { lat, lon, h: g.h, ground };
  };
  /** the street cells' nearest road to a place (the game's own: the scene's roads, decks included, tunnels and railways not): its
   *  axis's distance less its half-width [m] — negative on it —, and which. The cells about it asked of the streets' pool (the scene
   *  asks them too), read from their cache. */
  const roadClearance = async (lat: number, lon: number) => {
    const keys = new Map<string, { x: number; y: number }>();
    for (const [de, dn] of [
      [0, 0],
      [-60, 0],
      [60, 0],
      [0, -60],
      [0, 60],
    ] as const) {
      const c = cellOf(lat + dn / 111_000, lon + de / (111_000 * Math.cos(lat * D)));
      keys.set(`${c.x}/${c.y}`, c);
    }
    const cells = [...keys.values()];
    await app.js(`(() => { __bh.sys.streets.want(${JSON.stringify(cells.map((c) => ({ ...c, priority: 0, d: 0 })))}); return 1; })()`);
    let best = { clear: Number.POSITIVE_INFINITY, what: "none" };
    for (const c of cells) {
      const path = streetCacheUrl("", c.x, c.y);
      const b64 = await app.waitFor(
        `(async () => { const r = await (await caches.open("${STREET_CACHE}")).match(location.origin + "${path}"); if (!r) return null;
          const b = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
          return btoa(s); })()`,
        60_000,
      );
      const bytes = Buffer.from(String(b64), "base64");
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const h = readStreetHeader(buf);
      if (!h) continue;
      const p = toCell(cellOrigin(c.x, c.y), lat, lon);
      for (let i = 0; i < h.segmentCount; i++) {
        const s = readSegment(buf, i);
        if (s.cls === "rail" || s.flags & SegmentFlag.Tunnel) continue;
        const dx = s.b[0] - s.a[0],
          dy = s.b[1] - s.a[1];
        const t = Math.max(0, Math.min(1, ((p.east - s.a[0]) * dx + (p.north - s.a[1]) * dy) / Math.max(dx * dx + dy * dy, 1e-9)));
        const clear = Math.hypot(p.east - s.a[0] - dx * t, p.north - s.a[1] - dy * t) - s.width / 2;
        if (clear < best.clear)
          best = { clear, what: `${s.cls} ${s.width.toFixed(1)} m${s.flags & SegmentFlag.Bridge ? " (deck)" : ""}, cell ${c.x}/${c.y}` };
      }
    }
    return best;
  };
  /** TRW_COST: the craft's pass measured at a moment, drawn (on) and skipped (off), on off off on — GPU p50 and the passes' medians */
  const costs: Record<string, unknown> = {};
  const cost = async (name: string) => {
    if (process.env.TRW_COST !== "1") return;
    await app.js(`(() => { __bh.forceScale(0.75); __bh.touch(); return 1; })()`);
    await app.settled(60_000);
    await Bun.sleep(2000);
    type Prof = { frames: number; sum: number; passes: Record<string, number> };
    const runs: { on: boolean; p50: number; p95: number; prof: Prof }[] = [];
    for (const on of [true, false, false, true]) {
      await app.js(`(() => { __bh.renderer.debugSkipShip = ${!on}; __bh.touch(); return 1; })()`);
      await Bun.sleep(1000);
      const g = await gpuTimes(app);
      runs.push({ on, p50: g.p50, p95: g.p95, prof: await app.js<Prof>(passesJs(24)) });
    }
    await app.js(`(() => { __bh.renderer.debugSkipShip = false; __bh.forceScale(null); __bh.touch(); return 1; })()`);
    const others = await app.js<{ n: number; a320: number }>(
      `(() => { const o = __bh.renderer.combatOthers ?? []; return { n: o.length, a320: o.filter((x) => x.a320).length }; })()`,
    );
    const avg = (on: boolean, f: (r: (typeof runs)[number]) => number) => {
      const x = runs.filter((r) => r.on === on).map(f);
      return +(x.reduce((a, b) => a + b, 0) / x.length).toFixed(2);
    };
    const labels = [...new Set(runs.flatMap((r) => Object.keys(r.prof.passes)))];
    const passes = Object.fromEntries(
      labels.map((l) => [l, { on: avg(true, (r) => r.prof.passes[l] ?? 0), off: avg(false, (r) => r.prof.passes[l] ?? 0) }]),
    );
    costs[name] = {
      others,
      p50: { on: avg(true, (r) => r.p50), off: avg(false, (r) => r.p50) },
      runs: runs.map((r) => ({ on: r.on, p50: r.p50, p95: r.p95 })),
      passes,
    };
    console.log(
      `  cost at ${name}: GPU p50 with the craft ${avg(true, (r) => r.p50)} ms, without ${avg(false, (r) => r.p50)} ms (${others.n} drawn, ${others.a320} rigged A320)`,
    );
    await Bun.write(`${OUT}/cost.json`, JSON.stringify(costs, null, 1));
  };
  /** the rigged A320 drawn for it: its gear's position as drawn (null: none rigged near the view) */
  const rigGear = () =>
    app.js<number | null>(`(() => { const o = __bh.renderer.combatOthers.find((x) => x.id === "a320" && x.a320);
      return o ? Number(o.a320.props["gear/gear[1]/position-norm"]) : null; })()`);

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    app.steps([
      "boot",
      "free camera at SFO",
      "airliners made up",
      "landing: short final",
      "landing: rolled out",
      "take-off: lift-off",
      "take-off: gear up",
      "cruise: gear up, drawn plain",
      "parked",
      "costs",
    ]);
    app.estimate(330);
    await app.step("boot");
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { Object.assign(__bh.settings, { traffic: true, autosave: false, trafficDelay: ${DELAY} }); return 1; })()`);
    // (daylight at San Francisco: 12:30 PST — the harness's own daylight is Europe's)
    await app.js(`__bh.game.setDate("2026-11-24T20:30:00Z")`);
    await app.stepDone("booted");
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("landing on 28L and taking off from 01R on the runways, gear down; gear up climbing; parked on the ground", async () => {
    await app.step("free camera at SFO");
    await app.js(`(() => { __bh.settings.ship = false; __bh.refresh(); return 1; })()`);
    await app.waitFor("!__bh.camera.piloting && !__bh.camera.spectating", 20_000);
    const P0 = at(W28L, 1200, -500);
    expect(
      await app.js<string | null>(`(() => __bh.viewAt(${P0.lat}, ${P0.lon}, { altM: 400, heading: 300, pitch: -12, fov: 50 }) ?? null)()`),
    ).toBeNull();
    await app.waitFor(`__bh.sys.runways().filter((r) => r.world?.field === "KSFO").length >= 4`, 45_000);
    await app.dataSettled("SFO's relief and imagery", { maxMs: 90_000 });
    // (the runways' level: the ground the game grades there — 28L's threshold, 01R's —, over the ellipsoid)
    const thr28 = at(W28L, 0, 0),
      thr01 = at(W01R, 0, 0);
    const G28 = await app.js<number>(`__bh.sys.groundAt(${thr28.lat}, ${thr28.lon})`);
    const G01 = await app.js<number>(`__bh.sys.groundAt(${thr01.lat}, ${thr01.lon})`);
    const geoid = await app.js<number>(`__bh.sys.geoid(${thr28.lat}, ${thr28.lon})`);
    const frames = await app.js<string>(
      `JSON.stringify(__bh.sys.runways().filter((r) => r.world?.field === "KSFO").map((r) => ({ n: r.site.name, lat: r.site.lat, lon: r.site.lon, rwy: r.site.rwy, len: r.len, hw: r.halfWidth })))`,
    );
    console.log(`  the game's KSFO frames: ${frames}`);
    console.log(
      `  SFO: 28L's threshold ground ${G28.toFixed(1)} m, 01R's ${G01.toFixed(1)} m over the ellipsoid (geoid ${geoid.toFixed(1)} m)`,
    );
    await app.stepDone(`pistes KSFO · sol 28L ${G28.toFixed(1)} m ellipsoïde`);

    await app.step("airliners made up");
    const n = await injectTraffic(app, sfoPlanes(G28, G01));
    expect(n).toBe(8);
    await app.stepDone(`${n} avions de ligne · horloge du trafic à T0`);

    // ---- landing: short final
    await app.step("landing: short final");
    await app.scenario("28L short final");
    await runTo(FINAL);
    let c = (await craft("e2e281"))!;
    await frameOn(c, 60, 3, 2.5);
    await runTo(FINAL);
    c = (await craft("e2e281"))!;
    let u = await under(c);
    let w = onWay(W28L, u.lat, u.lon);
    let rig = await rigGear();
    await app.shot(`${OUT}/final.png`);
    await cost("final");
    console.log(
      `  final: ${c.phase}, ${w.a.toFixed(0)} m past 28L's threshold, ${w.c.toFixed(1)} m off its axis (reported 30), wheels ${c.over.toFixed(1)} m up (its origin ${(u.h - u.ground).toFixed(1)} m over the ground), ${c.msl.toFixed(0)} m over the sea; gear ${c.gear} wanted ${c.gearWanted}, rig ${rig}; runway ${JSON.stringify(c.runway)}`,
    );
    expect(c.phase).toBe("approach");
    expect(c.runway?.key).toContain("KSFO 10R<");
    expect(Math.abs(w.c)).toBeLessThan(3);
    expect(c.gear).toBe(1);
    expect(u.h - u.ground).toBeGreaterThan(WHEELS);
    await app.stepDone(`approche · ${w.c.toFixed(1)} m de l'axe · roues à ${c.over.toFixed(0)} m · train ${c.gear}`);

    // ---- landing: rolled out
    await app.step("landing: rolled out");
    await app.scenario("28L rollout");
    await runTo(ROLLOUT);
    c = (await craft("e2e281"))!;
    await frameOn(c, 110, 0.5, 1.5);
    await runTo(ROLLOUT);
    c = (await craft("e2e281"))!;
    u = await under(c);
    w = onWay(W28L, u.lat, u.lon);
    rig = await rigGear();
    await app.shot(`${OUT}/rollout.png`);
    console.log(
      `  rollout: ${c.phase}, on the ground ${c.gnd}, ${w.a.toFixed(0)} m down 28L, ${w.c.toFixed(2)} m off its axis; its origin ${(u.h - u.ground).toFixed(2)} m over the ground (wheels ${WHEELS.toFixed(2)}); gear ${c.gear}, rig ${rig}`,
    );
    expect(c.gnd).toBe(true);
    expect(c.phase).toBe("landing");
    expect(Math.abs(w.c)).toBeLessThan(1);
    expect(w.a).toBeGreaterThan(300);
    expect(w.a).toBeLessThan(W28L.len);
    expect(Math.abs(u.h - u.ground - WHEELS)).toBeLessThan(0.5);
    expect(c.gear).toBe(1);
    await app.stepDone(`au sol sur 28L · ${w.c.toFixed(2)} m de l'axe · ${(u.h - u.ground - WHEELS).toFixed(2)} m d'écart au sol`);

    // ---- take-off: lift-off
    await app.step("take-off: lift-off");
    await app.scenario("01R lift-off");
    await runTo(LIFTOFF);
    c = (await craft("e2e01r"))!;
    await frameOn(c, 75, 3, 2.5);
    await runTo(LIFTOFF);
    c = (await craft("e2e01r"))!;
    u = await under(c);
    w = onWay(W01R, u.lat, u.lon);
    rig = await rigGear();
    await app.shot(`${OUT}/liftoff.png`);
    console.log(
      `  lift-off: ${c.phase}, ${w.a.toFixed(0)} m down 01R, ${w.c.toFixed(2)} m off its axis (reported 15), wheels ${c.over.toFixed(1)} m up; gear ${c.gear} wanted ${c.gearWanted}, rig ${rig}; runway ${JSON.stringify(c.runway)}`,
    );
    expect(["takeoff", "climb"]).toContain(c.phase);
    expect(Math.abs(w.c)).toBeLessThan(3);
    expect(c.gear).toBe(1);
    expect(u.h - u.ground).toBeGreaterThan(WHEELS - 0.05);
    await app.stepDone(`décollage · ${w.c.toFixed(1)} m de l'axe · train ${c.gear}`);

    // ---- take-off: gear up
    await app.step("take-off: gear up");
    await app.scenario("01R climb, gear up");
    await runTo(GEARUP);
    c = (await craft("e2e01r"))!;
    await frameOn(c, 120, 6, 1.8);
    await runTo(GEARUP);
    c = (await craft("e2e01r"))!;
    rig = await rigGear();
    await app.shot(`${OUT}/gearup.png`);
    console.log(
      `  climbing: ${c.phase}, wheels ${c.over.toFixed(0)} m up, ${c.msl.toFixed(0)} m over the sea; gear ${c.gear.toFixed(2)} wanted ${c.gearWanted}, rig ${rig}`,
    );
    expect(c.phase).toBe("climb");
    expect(c.over).toBeGreaterThan(150);
    expect(c.gearWanted).toBe(0);
    expect(c.gear).toBeLessThan(0.05);
    expect(rig).not.toBeNull();
    expect(rig!).toBeLessThan(0.05);
    await app.stepDone(`montée · ${c.over.toFixed(0)} m · train ${c.gear.toFixed(2)} (rig ${rig})`);

    // ---- cruise: gear up on the plain meshes (a 737 — the game's A320 left out by the measuring lever, the 737 drawn plain within
    // 4 km of the view —, a CRJ), their airlines' colours
    await app.step("cruise: gear up, drawn plain");
    await app.scenario("cruise, plain meshes");
    await app.js(`(() => { __bh.camera.trafficRigMax = 0; return 1; })()`);
    const plainOf = (mesh: string) =>
      app.js<{
        gear: number;
        livery: string;
      } | null>(`(() => { const o = __bh.renderer.combatOthers.filter((x) => x.id === "${mesh}" && x.traffic)
        .sort((a, b) => Math.hypot(...a.rel) - Math.hypot(...b.rel))[0];
        return o ? { gear: o.traffic.gear, livery: o.traffic.livery.icao + " " + o.traffic.livery.pattern } : null; })()`);
    const cruiseRows: string[] = [];
    for (const [id, mesh, shot] of [
      ["e2ec01", "a320t", "cruise-b738"],
      ["e2ec02", "crj900", "cruise-crj"],
    ] as const) {
      c = (await craft(id))!;
      await frameOn(c, 140, 8, 1.3);
      await runTo(GEARUP + 2);
      c = (await craft(id))!;
      const inst = (await app.waitFor(
        `(() => { const o = __bh.renderer.combatOthers.filter((x) => x.id === "${mesh}" && x.traffic)
          .sort((a, b) => Math.hypot(...a.rel) - Math.hypot(...b.rel))[0];
          return o ? { gear: o.traffic.gear, livery: o.traffic.livery.icao + " " + o.traffic.livery.pattern, d: Math.hypot(...o.rel) } : null; })()`,
        20_000,
      )) as { gear: number; livery: string; d: number };
      await app.shot(`${OUT}/${shot}.png`);
      cruiseRows.push(
        `${id} ${c.phase} ${c.msl.toFixed(0)} m over the sea, gear ${c.gear.toFixed(2)} wanted ${c.gearWanted}; drawn ${mesh}, gear ${inst.gear.toFixed(2)}, livery ${inst.livery}`,
      );
      expect(c.phase).toBe("cruise");
      expect(c.gear).toBeLessThan(0.05);
      expect(inst.gear).toBeLessThan(0.05);
    }
    console.log(`  cruise: ${cruiseRows.join(" | ")}`);
    await app.js(`(() => { __bh.camera.trafficRigMax = undefined; return 1; })()`);
    expect(await plainOf("crj900")).not.toBeNull();
    await app.stepDone(`737 et CRJ en croisière, train rentré, maillages simples`);

    // ---- parked
    await app.step("parked");
    await app.scenario("parked at the gates");
    c = (await craft("e2ep01"))!;
    // (from the apron's side, its tail to the camera's left: turned 150° the camera stood behind pier G's building)
    await frameOn(c, -30, 0.5, 1.5);
    await runTo(GEARUP + 2);
    const rows: string[] = [];
    for (const q of PARKED) {
      const k = (await craft(q.id))!;
      const v = await under(k);
      // (its wheels under its mesh's origin at its type's length — game/airtypes.ts)
      const af = airframeOf(q.type);
      const wheels = (MESH[af.mesh!].wheels * af.len) / MESH[af.mesh!].len;
      // (on the apron, not on a road: its place off every road's carriageway in the game's street cells)
      const road = await roadClearance(q.lat, q.lon);
      rows.push(
        `${q.id} ${q.cs} ${q.type} ${k.phase} gnd ${k.gnd} origin ${(v.h - v.ground).toFixed(2)} m over the ground (wheels ${wheels.toFixed(2)}), gear ${k.gear}, nearest road ${road.clear.toFixed(1)} m off (${road.what})`,
      );
      expect(road.clear).toBeGreaterThan(ROAD_CLEAR_M);
      expect(k.gnd).toBe(true);
      expect(k.phase).toBe("parked");
      expect(Math.abs(v.h - v.ground - wheels)).toBeLessThan(0.5);
      expect(k.gear).toBe(1);
    }
    await cost("parked");
    console.log(`  parked: ${rows.join(" | ")}`);
    // (their liveries: the rigged A320s' and the CRJ's, each its airline's — two different at least)
    const liveries = await app.js<string[]>(
      `__bh.renderer.combatOthers.filter((x) => x.traffic && (x.id === "a320" || x.id === "crj900") && x.cast).map((x) => x.id + " " + x.traffic.livery.icao + " " + x.traffic.livery.pattern)`,
    );
    console.log(`  liveries drawn about the gates: ${liveries.join(" | ")}`);
    expect(new Set(liveries.map((x) => x.split(" ")[1])).size).toBeGreaterThanOrEqual(2);
    // (their shadows: the shadow map's second half about the group looked at — on, then off by the measuring lever)
    const group = () =>
      app.js<{ r: number; d: number } | null>(
        `(() => { const b = __bh.renderer.ship.shadowBound2; return b ? { r: b.r, d: Math.hypot(...b.c) } : null; })()`,
      );
    await app.shot(`${OUT}/parked.png`);
    const on = await group();
    await app.js(`(() => { __bh.renderer.ship.trafficCast = false; __bh.touch(); return 1; })()`);
    await app.shot(`${OUT}/parked-noshadow.png`);
    const off = await group();
    await app.js(`(() => { __bh.renderer.ship.trafficCast = true; __bh.touch(); return 1; })()`);
    console.log(
      `  shadows: the second half's sphere ${on ? `r ${on.r.toFixed(0)} m at ${on.d.toFixed(0)} m` : "none"}; without the casters ${off ? `r ${off.r.toFixed(0)} m` : "none"}`,
    );
    expect(on).not.toBeNull();
    expect(on!.r).toBeLessThan(470);
    expect(off).toBeNull();
    // (Delta's A320 close — the game's A320 under its colours: its white livery, its fin, its belly)
    const k2 = (await craft("e2ep02"))!;
    await frameOn(k2, 70, 1, 0.75);
    await runTo(GEARUP + 2);
    await app.shot(`${OUT}/parked-dal.png`);
    // (the CRJ beside them, its gear baked: its plain mesh)
    const k4 = (await craft("e2ep04"))!;
    await frameOn(k4, 60, 1, 0.9);
    await runTo(GEARUP + 2);
    await app.shot(`${OUT}/parked-crj.png`);
    // (a diagnostic, not judged: seen from above with the ground behind, the same view from 40 m up, then without the craft drawn into
    // the scene — until 24 Nov 2026 the parked ones stood under the landside deck and in a building, hidden by them, their lights shown)
    await frameOn(c, -30, -15, 1.5);
    await app.shot(`${OUT}/parked-above.png`);
    await app.js(`(() => { __bh.renderer.shipInScene = false; __bh.touch(); return 1; })()`);
    await app.shot(`${OUT}/parked-above-noscene.png`);
    await app.js(`(() => { __bh.renderer.shipInScene = true; __bh.touch(); return 1; })()`);
    expect(app.cdp.errors).toEqual([]);
    await app.stepDone(`4 au parking, au sol · livrées ${liveries.length} · ombres r ${on?.r.toFixed(0)} m`);

    // ---- costs (a measure, not judged): the parked view, the images' GPU time (renderer.lastGpuMs, median over 3 s) — all drawn; the
    // rigged A320s drawn plain (trafficRigMax 0); the casters out of the shadow map (ship.trafficCast); none of the craft's passes
    // (debugSkipShip) — ABBA over two rounds, the first condition again as an A/A
    await app.step("costs");
    await app.scenario("costs at the gates");
    await frameOn(c, -30, 0.5, 1.5);
    await runTo(GEARUP + 2);
    const conds: Record<string, string> = {
      all: "",
      rig0: "__bh.camera.trafficRigMax = 0;",
      nocast: "__bh.renderer.ship.trafficCast = false;",
      noship: "__bh.renderer.debugSkipShip = true;",
    };
    const reset = "__bh.camera.trafficRigMax = undefined; __bh.renderer.ship.trafficCast = true; __bh.renderer.debugSkipShip = false;";
    const gpuP50 = (set: string) =>
      app.js<{ p50: number; p95: number; n: number }>(`(async () => { ${reset} ${set} __bh.touch();
        const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)), g = [];
        for (let i = 0; i < 30; i++) await f();
        let last = r.completedFrames ?? 0; const t0 = performance.now();
        while (performance.now() - t0 < 3000) { await f(); const d = r.completedFrames ?? 0; if (d !== last && r.lastGpuMs > 0) g.push(r.lastGpuMs); last = d; }
        g.sort((a, b) => a - b);
        return { p50: +(g[Math.floor(g.length / 2)] ?? 0).toFixed(2), p95: +(g[Math.floor(g.length * 0.95)] ?? 0).toFixed(2), n: g.length }; })()`);
    const order = ["all", "rig0", "nocast", "noship", "noship", "nocast", "rig0", "all", "all"];
    const res: Record<string, number[]> = {};
    for (const [i, k] of order.entries()) {
      const m = await gpuP50(conds[k]!);
      // (the last "all": the A/A's second side)
      const key = i === order.length - 1 ? "all-AA" : k;
      (res[key] ??= []).push(m.p50);
      await app.progress(`coûts ${i + 1}/${order.length} · ${k} ${m.p50} ms (p95 ${m.p95}, ${m.n} images)`);
    }
    await app.js(`(() => { ${reset} return 1; })()`);
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    const M = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, med(v)]));
    console.log(
      `  costs (GPU ms, median of the medians): ${Object.entries(res)
        .map(([k, v]) => `${k} ${v.join("/")}`)
        .join(
          " · ",
        )} → all ${M.all} · rigged A320s ${(M.all! - M.rig0!).toFixed(2)} ms · shadows ${(M.all! - M.nocast!).toFixed(2)} ms · every craft pass ${(M.all! - M.noship!).toFixed(2)} ms · A/A ${(M.all! - M["all-AA"]!).toFixed(2)} ms`,
    );
    await app.stepDone(
      `coûts : A320 gréés ${(M.all! - M.rig0!).toFixed(2)} ms · ombres ${(M.all! - M.nocast!).toFixed(2)} ms · passes ${(M.all! - M.noship!).toFixed(2)} ms`,
    );
  }, 540_000);
});
