import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runwayFrame } from "../../src/game/sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";
import { type Way, waysOf } from "../../src/traffic/landing";
import { App, E2E, stopServer } from "./lib/app";

// The real traffic against the game's runways (traffic/runway-phase.ts — Sam, 24 Nov 2026: « positions cohérentes avec les pistes du
// jeu, au sol jamais sous le sol, décollage et atterrissage sur les pistes, train sorti au décollage et à l'atterrissage, rentré en
// croisière »): at San Francisco, no craft, the free camera; four airliners made up as ADS-B reports them (`camera.traffic`, the
// live feed set aside; the traffic's clock the test's): one landing on 28L reported 30 m off its axis and 25 m high, one taking off
// from 01R 15 m off, its climb 20 m high, three parked at the gates. Each framed by the camera beside it at the moment judged: on
// short final (on the axis, gear down), rolled out (on the runway, its wheels on its graded level), lifting off (gear down), climbing
// past 150 m (gear wanted up, then up), parked (on the ground, not under it) — the A320's rig drawn near the view (its gear).
// Steps: 1 boot · 2 the free camera at SFO, its runways and ground in · 3 the airliners made up · 4 landing: short final · 5 landing:
// rolled out · 6 take-off: lift-off · 7 take-off: gear up · 8 parked. Shots in TRW_OUT (remote-results/traffic-runways): final,
// rollout, liftoff, gearup, parked.
// Duration: ~4–5 min (boot and SFO's tiles ~1.5 min, each moment 15 s of the traffic's clock, each wait capped at 45–60 s).
// Done when: the parked shot is taken, every moment's phase, gear, runway and height over the ground asserted.

const OUT = process.env.TRW_OUT ?? "remote-results/traffic-runways";
const D = Math.PI / 180;
/** the traffic's clock at the start of the made-up reports [s] (the drawn moment: the clock less the 60 s delay) */
const T0 = 1_900_000_000;
const DELAY = 60;
/** KSFO's two runways used (OurAirports, assets/runways/v1 — as world/runways3d.ts frames them) */
const frame = (le: string, lat: number, lon: number, hdg: number, len: number) => {
  const f = runwayFrame({ body: "earth", name: `KSFO ${le}`, lat, lon, runway: true, rwy: hdg }, len, 30.5, 48);
  f.world = { field: "KSFO", measuring: false };
  return f;
};
const W28L = waysOf(frame("10R", 37.6263, -122.39312, 117.8, 3469))[1]!;
const W01R = waysOf(frame("1R", 37.60633, -122.38106, 27.81, 2638))[0]!;
/** the A320's wheels under its plain mesh's origin at 37.6 m (game/airtypes.ts) */
const WHEELS = (3.9 * 37.6) / 37.7;

function at(w: Way, a: number, c: number) {
  const q = [0, 1, 2].map((k) => w.o[k]! + w.d[k]! * a + w.r[k]! * c) as [number, number, number];
  const g = cartToGeodetic(WGS84_A, WGS84_F, q);
  return { lat: g.lat / D, lon: g.lon / D };
}
function onWay(w: Way, lat: number, lon: number) {
  const q = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0);
  const v = [q[0] - w.o[0], q[1] - w.o[1], q[2] - w.o[2]];
  return { a: v[0]! * w.d[0] + v[1]! * w.d[1] + v[2]! * w.d[2], c: v[0]! * w.r[0] + v[1]! * w.r[1] + v[2]! * w.r[2] };
}
const glide3 = (x: number) => Math.max(0, x) * Math.tan(3 * D);

type Plane = Record<string, unknown> & { t: number };
const base = (id: string, cs: string, reg: string) => ({ id, cs, reg, type: "A320", cat: "A3", hdg: null, roll: null, src: "adsb.lol" });

/** the landing on 28L: a 3° final from 9 km at 70 m/s, 30 m north of the axis, 25 m high; « ground » from 700 m on; braking 2 m/s² */
function landing(G: number): Plane[] {
  const out: Plane[] = [];
  let t = T0;
  for (let a = -9000; a < 2600; ) {
    const air = a < 700;
    const gs = a < 300 ? 70 : Math.max(12, Math.sqrt(Math.max(0, 70 * 70 - 4 * (a - 300))));
    out.push({
      ...base("e2e281", "E2E28L", "N28LTS"),
      ...at(W28L, a, 30),
      alt: G + WHEELS + (air ? glide3(300 - a) + 25 : 0),
      gs,
      trk: W28L.hdg,
      vs: a < 300 ? -3.67 : 0,
      gnd: !air,
      t,
    });
    a += gs * 4;
    t += 4;
  }
  return out;
}
/** the take-off from 01R from T0 + 20 s: 2 m/s² from 5 m/s, 15 m east of the axis, lift-off at 75 m/s, climbing 8 m/s reported 20 m high */
function takeoff(G: number): Plane[] {
  const out: Plane[] = [];
  let t = T0 + 20,
    a = 0,
    gs = 5,
    h = 0;
  for (let k = 0; h < 1200; k++) {
    const air = gs >= 75;
    if (k % 6 === 0)
      out.push({
        ...base("e2e01r", "E2E01R", "N01RTS"),
        ...at(W01R, a, 15),
        alt: G + WHEELS + (air ? h + 20 : 0),
        gs,
        trk: W01R.hdg,
        vs: air ? 8 : 0,
        gnd: !air,
        t,
      });
    a += gs * 0.5;
    if (air) h += 4;
    else gs = Math.min(75, gs + 1);
    t += 0.5;
  }
  return out;
}
/** three parked at the international terminal's gates (N796UA's place, 24 Nov 2026, and two beside), on the ground */
const PARKED = [
  { id: "e2ep01", lat: 37.6152, lon: -122.39, hdg: 280 },
  { id: "e2ep02", lat: 37.6162, lon: -122.3912, hdg: 190 },
  { id: "e2ep03", lat: 37.6143, lon: -122.3887, hdg: 10 },
];

/** the moments judged [s after T0]: short final (a ≈ −600 m), rolled out, lift-off + 3 s, gear up, parked */
const FINAL = (9000 - 600) / 70;
const ROLLOUT = (9000 + 300) / 70 + 6;
const LIFTOFF = 20 + 35 + 3;
const GEARUP = 20 + 35 + 30;

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
  /** the traffic's clock run in real time up to the moment `m` [s after T0], from 12 s before it; then held */
  const runTo = async (m: number) => {
    await app.js(
      `(() => { const s = window.__trf; s.t = ${T0 + DELAY + m - 12}; s.until = ${T0 + DELAY + m}; s.rate = 1; s.last = performance.now(); return 1; })()`,
    );
    const t0 = Date.now();
    for (;;) {
      if (await app.js<boolean>(`window.__trf.t >= window.__trf.until`)) return;
      const k = (Date.now() - t0) / 1000;
      if (k > 45)
        throw new Error(`the traffic's clock did not reach ${m} s within 45 s: ${await app.js<string>(`JSON.stringify(window.__trf)`)}`);
      await app.progress(`horloge du trafic → T0+${m.toFixed(0)} s · ${k.toFixed(0)} / 45 s`);
      await Bun.sleep(1000);
    }
  };
  /** the camera panel's Chase view on an aircraft (target `trf:…`, camera/subjectcam.ts — no craft flown): turned `yaw` [°] about
   *  it, `pitch` [°] (negative: from above — positive put the camera under it, under the ground on the runway), `zoom` (~90 m a
   *  unit) — the game frames it whatever its place */
  const frameOn = async (c: Craft, yaw: number, pitch: number, zoom: number) => {
    await app.js(`(() => { const vc = __bh.camera.viewController();
      __bh.settings.target = vc.s.target = "trf:${c.id}"; __bh.settings.subjectView = vc.s.subjectView = "chase";
      vc.subject.yaw = ${yaw}; vc.subject.pitch = ${pitch}; vc.subject.zoom = ${zoom}; return 1; })()`);
    await app.waitFor(
      `(() => { const m = __bh.camera.trafficOverlay((x) => "", __bh.camera.viewController()).find((x) => x.id === "${c.id}"); return !!m && m.dist < ${zoom * 200 + 300}; })()`,
      30_000,
    );
    // (the place's relief, imagery and scenery in about the new view before the moment is run and shot: drawn on tiles not
    // yet in, the ground stands where it is not — the aircraft hidden under it, 24 Nov 2026 on kerr-mini)
    // (a tile or two stalling: said, not fatal — the moment's judgement reads the contact ground itself, `sys.groundAt`)
    try {
      await app.dataSettled(`SFO's data about ${c.id}`, { maxMs: 60_000 });
    } catch (e) {
      console.log(`  ⚠ ${String(e)} — shot all the same`);
    }
  };
  /** the ground under an aircraft [m over the ellipsoid] (the player's contact ground), and its place */
  const under = async (c: Craft) => {
    const g = cartToGeodetic(WGS84_A, WGS84_F, c.p as [number, number, number]);
    const lat = g.lat / D,
      lon = g.lon / D;
    const ground = await app.js<number>(`__bh.sys.groundAt(${lat}, ${lon})`);
    return { lat, lon, h: g.h, ground };
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
      "parked",
    ]);
    app.estimate(200);
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
    const planes = [
      landing(G28),
      takeoff(G01),
      ...PARKED.map((q) => [
        { ...base(q.id, q.id.toUpperCase(), ""), lat: q.lat, lon: q.lon, alt: 0, gs: 0, trk: q.hdg, hdg: q.hdg, vs: 0, gnd: true, t: T0 },
        {
          ...base(q.id, q.id.toUpperCase(), ""),
          lat: q.lat,
          lon: q.lon,
          alt: 0,
          gs: 0,
          trk: q.hdg,
          hdg: q.hdg,
          vs: 0,
          gnd: true,
          t: T0 + 400,
        },
      ]),
    ];
    const n = await app.js<number>(`(() => {
      const planes = ${JSON.stringify(planes)};
      window.__trf = { t: ${T0 + DELAY}, rate: 0, until: ${T0 + DELAY}, last: performance.now() };
      __bh.camera.trafficClock = () => { const s = window.__trf, n = performance.now(); s.t = Math.min(s.until, s.t + ((n - s.last) / 1000) * s.rate); s.last = n; return s.t; };
      __bh.camera.traffic = { planes: new Map(planes.map((h) => [h[0].id, { p: h.at(-1), prev: h.at(-2) ?? null, hist: h, heard: 1e12 }])),
        ships: new Map(), status: "live", credit: {}, attribution: [], focus: null, asks: { air: 0, sea: 0, trace: 0 } };
      return __bh.camera.traffic.planes.size; })()`);
    expect(n).toBe(5);
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

    // ---- parked
    await app.step("parked");
    await app.scenario("parked at the gates");
    c = (await craft("e2ep01"))!;
    await frameOn(c, 150, 0.5, 1.5);
    await runTo(GEARUP + 2);
    const rows: string[] = [];
    for (const q of PARKED) {
      const k = (await craft(q.id))!;
      const v = await under(k);
      rows.push(`${q.id} ${k.phase} gnd ${k.gnd} origin ${(v.h - v.ground).toFixed(2)} m over the ground, gear ${k.gear}`);
      expect(k.gnd).toBe(true);
      expect(k.phase).toBe("parked");
      expect(Math.abs(v.h - v.ground - WHEELS)).toBeLessThan(0.5);
      expect(k.gear).toBe(1);
    }
    await app.shot(`${OUT}/parked.png`);
    console.log(`  parked: ${rows.join(" | ")}`);
    // (a diagnostic, not judged: seen from above with the ground behind, a traffic mesh near the ground was hidden by the
    // occlusion test, its lights shown — the same view from 40 m up, then without the craft drawn into the scene)
    await frameOn(c, 150, -15, 1.5);
    await app.shot(`${OUT}/parked-above.png`);
    await app.js(`(() => { __bh.renderer.shipInScene = false; __bh.touch(); return 1; })()`);
    await app.shot(`${OUT}/parked-above-noscene.png`);
    await app.js(`(() => { __bh.renderer.shipInScene = true; __bh.touch(); return 1; })()`);
    expect(app.cdp.errors).toEqual([]);
    await app.stepDone(`3 au parking, au sol`);
  }, 360_000);
});
