import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Le cours de pilotage des vaisseaux (docs/VOL-VAISSEAUX.md, partie I ; docs/apprendre-vaisseaux.html) volé en jeu,
// recette par recette, tel qu'un LLM élève l'applique : une rotation arrêtée puis le rétrograde tenu (leçons 1–2),
// l'apoapside montée à 600 km en coupant avant la consigne (leçon 3), la circularisation (leçon 4), l'amarrage à l'ISS
// (leçon 7), le changement de plan de 10° (leçon 5), la rentrée et le plané du Ranger jusqu'à Edwards (leçon 8), l'alunissage du Lander avec le point déplacé
// de 300 m (leçon 9), le décollage lunaire vers 100 km du Lander posé puis du Ranger (leçon 10). Chaque critère de réussite est celui du cours ; une
// capture à chaque état jugé.
// Duration: ~5–8 min (les orbites et la remontée lunaire en pas fixes, le temps accéléré par les autopilotes).
// Done when: le Lander puis le Ranger remontés en orbite lunaire.

const DIR = "remote-results/apprendre/vaisseaux";
mkdirSync(DIR, { recursive: true });

describe.skipIf(!E2E)("apprendre à piloter : les vaisseaux", () => {
  let app: App;
  const fly = async (until: string, maxChunks: number) => {
    for (let k = 0; k < maxChunks; k++) {
      const done = await app.js<boolean>(`(() => { const c = __bh.camera, p = c.pilot;
        for (let i = 0; i < 1800; i++) { __bh.step(1 / 30); if (${until}) return true; } return false; })()`);
      if (done) return true;
    }
    return false;
  };
  const orbit = () =>
    app.js<{
      status: string;
      soi: string;
      peKm: number;
      apKm: number;
      circ: { km: number; swingKm: number } | null;
      auto: string;
      fail: string | null;
    }>(`(() => {
      const s = __bh.game.status(), p = __bh.camera.pilot;
      return { status: s.status, soi: s.soi, peKm: s.orbit ? Math.round(s.orbit.peKm) : NaN, apKm: s.orbit ? Math.round(s.orbit.apKm) : NaN,
        circ: s.orbit?.circular ?? null, auto: p.auto, fail: __bh.camera.airFlight.failure }; })()`);
  const view = (mount = "chase") =>
    app.js(
      `(__bh.settings.shipMount = "${mount}", __bh.refresh(), __bh.camera.viewReset(), (() => { for (let i = 0; i < 3; i++) __bh.step(1 / 30); })(), true)`,
    );

  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("leçons 1–2 : une rotation arrêtée (récupération), puis le rétrograde tenu à moins de 5°", async () => {
    const r = await app.js<{ spin0: number; spin1: number; ang: number }>(`(() => {
      __bh.freeze(true); __bh.game.orbit("earth", { altKm: 400, inc: 51.6 });
      const c = __bh.camera, p = c.pilot, n3 = (v) => Math.hypot(...v);
      for (let i = 0; i < 3; i++) __bh.step(1 / 30);
      p.omega = [0.04, 0.06, 0.02]; const spin0 = n3(p.omega);
      c.spaceRecoverStart();
      for (let i = 0; i < 30 * 8; i++) __bh.step(1 / 30);
      const spin1 = n3(p.omega);
      p.hold = "none"; p.setHold("retrograde");
      for (let i = 0; i < 30 * 30; i++) __bh.step(1 / 30);
      const nose = c.activePoseNow().ax[2], n = __bh.sys.nav();
      const v = [0, 1, 2].map((k) => n.V[k] - n.refVel[k]), nv = n3(v);
      const cos = -(nose[0] * v[0] + nose[1] * v[1] + nose[2] * v[2]) / (n3(nose) * nv);
      return { spin0, spin1, ang: Math.acos(Math.min(1, Math.max(-1, cos))) * 57.3 };
    })()`);
    console.log("  rotation", r.spin0.toFixed(3), "→", r.spin1.toFixed(4), "rad/s ; écart au rétrograde", r.ang.toFixed(1), "°");
    await view();
    await app.shot(`${DIR}/l2-retrograde.png`);
    expect(r.spin1).toBeLessThan(0.5 / 57.3);
    expect(r.ang).toBeLessThan(5);
  }, 120_000);

  test("leçon 3 : l'apoapside montée à 600 km, coupée ~28 km avant, lue une fois la poussée retombée", async () => {
    const r = await app.js<{ ap0: number }>(`(() => {
      __bh.game.orbit("earth", { altKm: 400, inc: 51.6 });
      const c = __bh.camera, p = c.pilot;
      for (let i = 0; i < 3; i++) __bh.step(1 / 30);
      const ap0 = __bh.game.status().orbit.apKm;
      p.hold = "none"; p.setHold("prograde");
      for (let i = 0; i < 30 * 20; i++) __bh.step(1 / 30);
      p.throttle = 1;
      for (let i = 0; i < 30 * 600 && __bh.game.status().orbit.apKm < 600 - 28; i++) __bh.step(1 / 30);
      p.throttle = 0;
      for (let i = 0; i < 150 && p.engineNow > 0.01; i++) __bh.step(1 / 30);
      return { ap0 };
    })()`);
    const o = await orbit();
    console.log(`  Ap ${r.ap0} → ${o.apKm} km ; Pe ${o.peKm} km`);
    await view();
    await app.shot(`${DIR}/l3-apoapside.png`);
    expect(Math.abs(o.apKm - 600)).toBeLessThan(10);
  }, 120_000);

  test("leçon 4 : la circularisation (9) — se termine d'elle-même, l'orbite circulaire", async () => {
    await app.js(`(() => { const p = __bh.camera.pilot; p.hold = "none"; p.auto = "none"; p.setAuto("circularize"); return 1; })()`);
    const done = await fly(`p.auto === "none" && !!__bh.game.status().orbit?.circular`, 40);
    const o = await orbit();
    console.log("  après CIRC :", JSON.stringify(o));
    await view();
    await app.shot(`${DIR}/l4-circulaire.png`);
    expect(done).toBe(true);
    expect(o.circ).not.toBeNull();
    // (circulaire au sens du cours : orbit.circular — sa hauteur moyenne et son écart ; Pe et Ap, géodésiques, diffèrent
    // de ~20 km sur une orbite inclinée — la Terre aplatie —, ce n'est pas une excentricité)
    expect(o.circ!.swingKm).toBeLessThan(5);
  }, 300_000);

  test("leçon 5 : un changement de plan de +10° (l'outil plan_maneuver de l'ordinateur de vol)", async () => {
    const r = await app.js<{ inc0: number; said: unknown }>(`(async () => {
      __bh.game.orbit("earth", { altKm: 400, inc: 51.6 }); for (let i = 0; i < 3; i++) __bh.step(1 / 30);
      const inc0 = __bh.game.status().orbit.incDeg;
      const tool = __bh.tars.tools().find((x) => x.name === "plan_maneuver");
      const said = await tool.run({ op: "inclination", incDeg: 61.6 }, new AbortController().signal);
      return { inc0, said }; })()`);
    console.log("  plan :", JSON.stringify(r));
    // (le plan arrive d'un worker : des paquets de pas avec une image entre, jusqu'à la fin des poussées)
    let o = await orbit();
    for (let k = 0; k < 60; k++) {
      await app.js(
        `(async () => { await new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 600; i++) __bh.step(1 / 30); return 1; })()`,
      );
      o = await orbit();
      const inc = await app.js<number>(`__bh.game.status().orbit.incDeg`);
      if (o.auto === "none" && Math.abs(inc - 61.6) < 0.5) break;
    }
    const inc = await app.js<number>(`__bh.game.status().orbit.incDeg`);
    console.log(`  inclinaison ${r.inc0.toFixed(2)} → ${inc.toFixed(2)}° ; auto ${o.auto}`);
    await view();
    await app.shot(`${DIR}/l5-plan.png`);
    expect(Math.abs(inc - 61.6)).toBeLessThan(0.5);
  }, 400_000);

  test("leçon 7 : l'amarrage automatique à l'ISS depuis la scène d'amarrage", async () => {
    await app.js(`(() => { __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS"); return 1; })()`);
    await app.settled();
    const r = await app.js<{ docked: boolean; said: string[] }>(`(() => { const c = __bh.camera; __bh.freeze(true);
      const said = []; const prev = c.onPilotMessage; c.onPilotMessage = (m) => { said.push(String(m)); prev?.(m); };
      for (let i = 0; i < 3; i++) __bh.step(1 / 30);
      c.pilot.auto = "none"; c.pilot.setAuto("dock");
      for (let i = 0; i < 30 * 600 && !c.docked; i++) __bh.step(1 / 30);
      c.onPilotMessage = prev; return { docked: !!c.docked, said: said.slice(-4) }; })()`);
    console.log("  amarrage :", JSON.stringify(r));
    await view("dock");
    await app.shot(`${DIR}/l7-amarre.png`);
    expect(r.docked).toBe(true);
    await app.js(`(() => { __bh.camera.undock(); __bh.setDate(null); return 1; })()`);
  }, 240_000);

  test("leçon 8 : la rentrée et le plané du Ranger jusqu'à Edwards (autopilote d'entrée), posé sous 3 m/s", async () => {
    await app.js(`(() => { __bh.game.preset("game:artemis"); return 1; })()`);
    await app.settled();
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
    const r = await app.js<{ landed: boolean; fail: string | null; sink: number | null }>(`(() => {
      __bh.freeze(true); __bh.settings.wind = 0; __bh.game.glideTo("Edwards");
      const c = __bh.camera;
      for (let i = 0; i < 30 * 200 && !c.ourLanded && !c.airFlight.failure; i++) __bh.step(1 / 30);
      return { landed: !!c.ourLanded, fail: c.airFlight.failure, sink: c.lastTouch?.sink ?? null }; })()`);
    console.log("  rentrée :", JSON.stringify(r));
    await view();
    await app.shot(`${DIR}/l8-pose.png`);
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    expect(Math.abs(r.sink ?? 99)).toBeLessThan(3);
  }, 240_000);

  test("leçon 9 : le Lander posé à Tranquillité, son point déplacé de 300 m (LPD)", async () => {
    const active = await app.js<string>(
      `(() => { __bh.settings.vessel = "lander"; for (let i = 0; i < 5; i++) __bh.step(1 / 30); return __bh.fleet.active; })()`,
    );
    expect(active).toBe("lander");
    const r = await app.js<{ landed: boolean; fail: string | null; sink: number | null; moved: number | null; said: string[] }>(`(() => {
      __bh.game.hoverOver("moon", 0.674, 23.473, 1.5);
      const c = __bh.camera, said = []; const prev = c.onPilotMessage; c.onPilotMessage = (m) => { said.push(String(m)); prev?.(m); };
      c.pilot.auto = "none"; c.pilot.setAuto("land");
      __bh.step(1 / 30);
      c.lpdOrder = { fwd: 300, right: 0 };
      for (let i = 0; i < 30 * 400 && !c.ourLanded && !c.airFlight.failure; i++) __bh.step(1 / 30);
      c.onPilotMessage = prev;
      const G = __bh.sys.geodetic(), D = Math.PI / 180;
      const offM = G ? 1737400 * Math.hypot((G.lat - 0.674) * D, (G.lon - 23.473) * D * Math.cos(0.674 * D)) : null;
      return { landed: !!c.ourLanded, fail: c.airFlight.failure, sink: c.lastTouch?.sink ?? null, moved: offM, said: said.slice(-3) }; })()`);
    console.log("  alunissage :", JSON.stringify(r));
    await view();
    await app.shot(`${DIR}/l9-alunissage.png`);
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    expect(Math.abs(r.sink ?? 99)).toBeLessThan(3);
    // (le point déplacé de 300 m : posé à 150–450 m de Tranquillité — `moved` est la distance au site)
    expect(r.moved ?? 0).toBeGreaterThan(150);
    expect(r.moved ?? 1e9).toBeLessThan(450);
  }, 240_000);

  test("leçon 10 : le décollage lunaire du Lander posé vers une orbite de 100 km (launchGoal posé avant U)", async () => {
    // (posé, il partait jadis sans poussée — le 6 nov. 2026, PROBLEMES-A-REGLER — : son départ vertical sur sa poussée
    // vectorée jusqu'à 200 m, puis la loi de montée ; vérifié qu'il quitte le sol dans les 3 s)
    const r = await app.js<{ active: string; landed: boolean; liftedM: number | null }>(`(() => { const c = __bh.camera;
      __bh.settings.vessel = "lander"; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.land("moon", 0.674, 23.473); for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      const landed = !!c.ourLanded, h0 = __bh.game.status().altKm;
      c.launchGoal = { altKm: 100, incDeg: null }; c.pilot.auto = "none"; c.pilot.setAuto("takeoff");
      for (let i = 0; i < 90; i++) __bh.step(1 / 30);
      return { active: __bh.fleet.active, landed, liftedM: Math.round((__bh.game.status().altKm - h0) * 1000) }; })()`);
    console.log("  départ du Lander :", JSON.stringify(r));
    expect(r.active).toBe("lander");
    expect(r.landed).toBe(true);
    expect(r.liftedM ?? 0).toBeGreaterThan(3);
    const done = await fly(`__bh.game.status().status === "orbit" && p.auto === "none"`, 60);
    const o = await orbit();
    console.log("  remontée du Lander :", JSON.stringify(o));
    await view();
    await app.shot(`${DIR}/l10-lander-orbite-lunaire.png`);
    expect(done).toBe(true);
    expect(o.soi).toBe("moon");
    expect(o.peKm).toBeGreaterThan(80);
    expect(app.cdp.errors).toEqual([]);
  }, 400_000);

  test("leçon 10 (Ranger) : le décollage lunaire du Ranger vers une orbite de 100 km", async () => {
    await app.js(`(() => { const c = __bh.camera; __bh.settings.vessel = "ranger"; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.land("moon", 0.674, 23.473); for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      c.launchGoal = { altKm: 100, incDeg: null }; c.pilot.auto = "none"; c.pilot.setAuto("takeoff"); return 1; })()`);
    const done = await fly(`__bh.game.status().status === "orbit" && p.auto === "none"`, 60);
    const o = await orbit();
    console.log("  remontée :", JSON.stringify(o));
    await view();
    await app.shot(`${DIR}/l10-orbite-lunaire.png`);
    expect(done).toBe(true);
    expect(o.soi).toBe("moon");
    expect(o.peKm).toBeGreaterThan(80);
    expect(app.cdp.errors).toEqual([]);
  }, 400_000);
});
