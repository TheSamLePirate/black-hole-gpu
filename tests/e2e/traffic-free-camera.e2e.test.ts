import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The real traffic with no craft at all (Sam, 24 Nov 2026: « les avions et les bateaux toujours actifs, même en caméra libre sans appareil »; traffic/focus.ts): the craft left, the free camera over San Francisco Bay — the relay asked about the camera (`__bh.trafficFocus()`: who "view"), the aircraft and the ships about it live, moving, labelled and drawn from the view (`renderer.othersFromView`); an airliner then a ship followed by the camera panel's Chase view (target `trf:…`, `ais:…`), the airliner's trace asked; a jump to Marseille asked anew at once; the setting off: none asked.
// Steps: 1 boot · 2 leave the craft · 3 the free camera over the bay · 4 the traffic live · 5 moving, labelled, drawn · 6 an airliner followed · 7 a ship followed · 8 the jump to Marseille · 9 the setting off. Shots in TFC_OUT (remote-results/traffic-free-camera): bay, airliner, ship, marseille.
// Live data: adsb.lol through the dev server's relay (needs internet); the ships the AIS's if the relay has its key, else the sea's own life (game/seasim.ts) — either counts. Few aircraft at night over the bay: at least 3 asked.
// Duration: ~4 min (boot and tiles ~1.5 min, each wait capped at 45 s).
// Done when: the setting turned off has emptied the feed, after the four shots.

const OUT = process.env.TFC_OUT ?? "remote-results/traffic-free-camera";
/** over the bay east of SFO, 1 200 m up, looking west-north-west along runways 28 (their approach over the water) */
const BAY = { lat: 37.6, lon: -122.3, altM: 1200, heading: 290, pitch: -6 };
const MARSEILLE = { lat: 43.3, lon: 5.36, altM: 800, heading: 200, pitch: -6 };
const fmtA = `(m) => m.toFixed(0) + " m"`;
const fmtS = `(v) => v.toFixed(1) + " m/s"`;

type Focus = {
  focus: { lat: number; lon: number; alt: number; airR: number; seaR: number; who: string; jumps: number } | null;
  moves: number;
  status: string;
  at: { lat: number; lon: number } | null;
  asks: { air: number; sea: number; trace: number };
  planes: number;
  ships: number;
};

describe.skipIf(!E2E)("the traffic about a free camera with no craft", () => {
  let app: App;
  const focus = () => app.js<Focus>("__bh.trafficFocus()");
  /** waits for `cond` (a page expression) up to `s` seconds, the count said on the banner every 2 s */
  const until = async (label: string, cond: string, s = 45, values = "") => {
    const t0 = Date.now();
    for (;;) {
      if (await app.js<boolean>(cond)) return (Date.now() - t0) / 1000;
      const k = (Date.now() - t0) / 1000;
      if (k > s) throw new Error(`${label}: not within ${s} s — ${JSON.stringify(await focus())}`);
      await app.progress(`${label} · ${k.toFixed(0)} / ${s} s`, values ? await app.js<string>(values) : undefined);
      await Bun.sleep(2000);
    }
  };
  const counts = `(() => { const f = __bh.trafficFocus(); return "avions " + f.planes + " · navires " + __bh.camera.seaNow().length + " · " + f.status; })()`;

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis" });
    app.steps([
      "boot",
      "leave the craft",
      "free camera over the bay",
      "traffic live",
      "moving, labelled, drawn",
      "an airliner followed",
      "a ship followed",
      "jump to Marseille",
      "setting off",
    ]);
    app.estimate(240);
    await app.step("boot");
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(
      `(() => { Object.assign(__bh.settings, { traffic: true, seaLife: true, autosave: false, trafficDelay: 60 }); return 1; })()`,
    );
    await app.stepDone("booted, a craft flown");
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("no craft: the relay asked about the free camera; aircraft and ships live, moving, labelled, drawn from the view", async () => {
    await app.step("leave the craft");
    await app.js(`(() => { __bh.settings.ship = false; __bh.refresh(); return 1; })()`);
    await until("the craft left", "!__bh.camera.piloting && !__bh.camera.spectating", 20);
    await app.stepDone("no craft flown");

    await app.step("free camera over the bay");
    const why = await app.js<string | null>(
      `(() => __bh.viewAt(${BAY.lat}, ${BAY.lon}, { altM: ${BAY.altM}, heading: ${BAY.heading}, pitch: ${BAY.pitch}, fov: 60 }) ?? null)()`,
    );
    expect(why).toBeNull();
    await until(
      "the focus on the view",
      `(() => { const f = __bh.trafficFocus().focus; return !!f && f.who === "view" && Math.abs(f.lat - ${BAY.lat}) < 0.3 && Math.abs(f.lon - ${BAY.lon}) < 0.3; })()`,
      15,
    );
    const f0 = await focus();
    console.log(`  focus: ${JSON.stringify(f0.focus)} · asked ${JSON.stringify(f0.asks)}`);
    await app.stepDone(`focus ${f0.focus!.who} ${f0.focus!.lat.toFixed(2)}, ${f0.focus!.lon.toFixed(2)} · ${f0.focus!.airR} km`);

    await app.step("traffic live");
    await until("aircraft and ships about the camera", `__bh.trafficFocus().planes >= 3 && __bh.camera.seaNow().length >= 1`, 45, counts);
    const live = await app.js<{
      n: number;
      sea: number;
      ais: number;
      status: string;
      credit: string;
      at: { lat: number; lon: number };
    }>(`(() => {
      const f = __bh.trafficFocus(), el = document.querySelector("[data-testid=traffic-credit]");
      return { n: f.planes, sea: __bh.camera.seaNow().length, ais: f.ships, status: f.status, credit: el?.textContent ?? "", at: f.at };
    })()`);
    console.log(`  ${live.n} aircraft, ${live.sea} ships (${live.ais} from the AIS), ${live.status} — "${live.credit}"`);
    expect(live.status).toBe("live");
    expect(Math.abs(live.at.lat - BAY.lat)).toBeLessThan(0.3);
    await app.stepDone(`${live.n} avions · ${live.sea} navires (${live.ais} AIS)`);

    await app.step("moving, labelled, drawn");
    // (their places now and 3 s on: the traffic's clock runs with no flight — controller/lens.ts)
    const at = `JSON.stringify(Object.fromEntries(__bh.camera.trafficNow().filter((c) => !c.gnd).map((c) => [c.id, c.p])))`;
    const a = JSON.parse(await app.js<string>(at)) as Record<string, number[]>;
    await Bun.sleep(3000);
    const b = JSON.parse(await app.js<string>(at)) as Record<string, number[]>;
    const moved = Object.keys(a)
      .filter((k) => b[k])
      .map((k) => Math.hypot(...a[k]!.map((x, i) => x - b[k]![i]!)));
    console.log(`  in 3 s the airborne moved ${moved.map((d) => d.toFixed(0)).join(", ")} m`);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.filter((d) => d > 60).length / moved.length).toBeGreaterThan(0.7);
    const marks = await app.js<{ air: number; sea: number; first: string[]; fromView: boolean; drawn: number }>(`(() => {
      const vc = __bh.camera.viewController();
      const air = __bh.camera.trafficOverlay(${fmtA}, vc), sea = __bh.camera.seaOverlay(${fmtS}, vc);
      return { air: air.length, sea: sea.length, first: [...air, ...sea].slice(0, 4).map((m) => m.label + " @ " + (m.dist / 1000).toFixed(1) + " km"),
        fromView: __bh.renderer.othersFromView, drawn: __bh.renderer.combatOthers.length };
    })()`);
    console.log(
      `  marks: ${marks.air} aircraft, ${marks.sea} ships — ${marks.first.join(" | ")}; ${marks.drawn} meshes, from the view ${marks.fromView}`,
    );
    expect(marks.air + marks.sea).toBeGreaterThan(0);
    expect(marks.fromView).toBe(true);
    await app.shot(`${OUT}/bay.png`);
    await app.stepDone(`${moved.length} en vol bougent · ${marks.air + marks.sea} étiquettes`);
  }, 240_000);

  test("followable: an airliner, then a ship, by the camera panel's Chase view — no craft", async () => {
    await app.step("an airliner followed");
    // (the nearest airborne one with a mesh within 60 km, flying: over 40 m/s — a parked airliner whose transponder
    // reports a numeric barometric height instead of "ground" counts as airborne, e.g. N796UA at SFO's gate, 0.7 kt,
    // alt_baro −200 ft, 24 Nov 2026: followed, it "moved 0 m in 4 s")
    const id = await app.js<string | null>(`(() => {
      const vc = __bh.camera.viewController(), by = new Map(__bh.camera.trafficNow().map((c) => [c.id, c]));
      const m = __bh.camera.trafficOverlay(${fmtA}, vc).find((x) => { const c = by.get(x.id); return c && c.mesh && !c.gnd && Math.hypot(...c.v) > 40 && x.dist < 60000; });
      return m ? m.id : null; })()`);
    if (!id) throw new Error("no airborne airliner within 60 km of the bay to follow");
    await app.scenario(`airliner trf:${id}`);
    await app.js(`(() => { const vc = __bh.camera.viewController();
      __bh.settings.target = vc.s.target = "trf:${id}"; __bh.settings.subjectView = vc.s.subjectView = "chase";
      vc.subject.yaw = vc.subject.pitch = 0; return 1; })()`);
    const near = (pfx: string, ov: string, fmt: string, km: number) =>
      `(() => { const m = __bh.camera.${ov}(${fmt}, __bh.camera.viewController()).find((x) => x.id === "${pfx}"); return !!m && m.dist < ${km * 1000}; })()`;
    await until("the camera behind it", near(id, "trafficOverlay", fmtA, 2), 30);
    const p0 = await app.js<number[]>(`__bh.camera.trafficNow().find((c) => c.id === "${id}").p`);
    await Bun.sleep(4000);
    const follow = await app.js<{ dist: number; moved: number; trace: string | null; who: string; mesh: boolean }>(`(() => {
      const vc = __bh.camera.viewController(), c = __bh.camera.trafficNow().find((x) => x.id === "${id}");
      const m = __bh.camera.trafficOverlay(${fmtA}, vc).find((x) => x.id === "${id}");
      return { dist: m ? m.dist : 1e9, moved: Math.hypot(...c.p.map((x, i) => x - ${JSON.stringify(p0)}[i])), trace: __bh.camera.traffic.focus,
        who: __bh.trafficFocus().focus?.who ?? "none",
        mesh: __bh.renderer.othersFromView && __bh.renderer.combatOthers.some((o) => (o.id === "a320t" || o.id === "crj900") && Math.hypot(...o.rel) < 2000) };
    })()`);
    console.log(
      `  followed ${id}: ${follow.dist.toFixed(0)} m off, moved ${follow.moved.toFixed(0)} m in 4 s, trace ${follow.trace}, focus ${follow.who}, mesh ${follow.mesh}`,
    );
    expect(follow.dist).toBeLessThan(2000);
    expect(follow.moved).toBeGreaterThan(150);
    expect(follow.trace).toBe(id);
    expect(follow.who).toBe("view");
    expect(follow.mesh).toBe(true);
    await app.shot(`${OUT}/airliner.png`);
    await app.stepDone(`${id} suivi à ${follow.dist.toFixed(0)} m`);

    await app.step("a ship followed");
    const sid = await app.js<string | null>(`(() => {
      const m = __bh.camera.seaOverlay(${fmtS}, __bh.camera.viewController())[0]; return m ? m.id.slice(4) : null; })()`);
    if (!sid) throw new Error("no ship within 30 km of the view to follow");
    await app.scenario(`ship ais:${sid}`);
    await app.js(`(() => { const vc = __bh.camera.viewController();
      __bh.settings.target = vc.s.target = "ais:${sid}"; __bh.settings.subjectView = vc.s.subjectView = "chase";
      vc.subject.yaw = vc.subject.pitch = 0; return 1; })()`);
    await until("the camera behind it", near(`ais:${sid}`, "seaOverlay", fmtS, 2), 30);
    const ship = await app.js<{ dist: number; label: string }>(`(() => {
      const m = __bh.camera.seaOverlay(${fmtS}, __bh.camera.viewController()).find((x) => x.id === "ais:${sid}");
      return { dist: m.dist, label: m.label }; })()`);
    console.log(`  followed ${ship.label}: ${ship.dist.toFixed(0)} m off`);
    await app.shot(`${OUT}/ship.png`);
    await app.stepDone(`${ship.label} suivi à ${ship.dist.toFixed(0)} m`);
  }, 180_000);

  test("a jump to Marseille asked at once; the setting off: none asked", async () => {
    await app.step("jump to Marseille");
    await app.scenario("Marseille");
    const before = await focus();
    await app.js(`(() => { const vc = __bh.camera.viewController(); __bh.settings.target = vc.s.target = "earth"; return 1; })()`);
    const why = await app.js<string | null>(
      `(() => __bh.viewAt(${MARSEILLE.lat}, ${MARSEILLE.lon}, { altM: ${MARSEILLE.altM}, heading: ${MARSEILLE.heading}, pitch: ${MARSEILLE.pitch}, fov: 60 }) ?? null)()`,
    );
    expect(why).toBeNull();
    // (the jump asked within adsb.lol's pace at the relay — 10 s —, not the 15 s period)
    const s = await until(
      "the relay asked about Marseille",
      `(() => { const f = __bh.trafficFocus(); return !!f.at && Math.abs(f.at.lat - ${MARSEILLE.lat}) < 0.3 && f.asks.air > ${before.asks.air}; })()`,
      20,
      counts,
    );
    const after = await focus();
    console.log(
      `  asked about Marseille in ${s.toFixed(1)} s · jumps ${before.focus?.jumps} → ${after.focus?.jumps} · ${after.planes} aircraft held`,
    );
    expect(after.focus!.jumps).toBeGreaterThan(before.focus!.jumps);
    expect(s).toBeLessThan(13);
    // (what lay about the bay let go: none held beyond 1.6 radii)
    const far = await app.js<number>(
      `[...__bh.camera.traffic.planes.values()].filter((t) => Math.abs(t.p.lat - ${BAY.lat}) < 3 && Math.abs(t.p.lon - ${BAY.lon}) < 3).length`,
    );
    expect(far).toBe(0);
    await app.shot(`${OUT}/marseille.png`);
    await app.stepDone(`demandé en ${s.toFixed(1)} s · ${after.planes} avions`);

    await app.step("setting off");
    await app.js(`(() => { __bh.settings.traffic = false; return 1; })()`);
    await until(
      "the feed emptied",
      `(() => { const f = __bh.trafficFocus(); return f.status === "off" && f.planes === 0 && f.focus === null; })()`,
      10,
    );
    const asks = (await focus()).asks;
    await Bun.sleep(3000);
    expect((await focus()).asks).toEqual(asks);
    await app.js(`(() => { __bh.settings.traffic = true; return 1; })()`);
    await app.stepDone("éteint : rien demandé");
  }, 120_000);
});
