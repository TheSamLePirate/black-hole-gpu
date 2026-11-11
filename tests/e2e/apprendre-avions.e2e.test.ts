import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Le cours de pilotage des avions (docs/VOL-AVIONS.md, partie I ; docs/apprendre-avions.html) volé en jeu, recette par
// recette, tel qu'un LLM élève l'applique : le F-35B aligné à Edwards et son décollage (leçons 0 et 3), puis par la touche U, le palier sous
// autopilote et auto-manette puis le virage à la main sans toucher S (leçon 4), l'approche ILS jugée sur son toucher
// (leçon 7), le F-35B posé verticalement sur le Ford (leçon 8), l'A320 du Bourget — décollage TOGA, AP1, approche ILS par son FMGC (leçon 10) —, la reprise après un
// crash (« Après un crash »). Chaque critère de réussite est celui du cours ; une capture à chaque état jugé.
// Duration: ~4–6 min ici (le vol de l'A320 en pas fixes en est la plus grande part).
// Done when: l'A320 posé au Bourget, puis le crash volontaire repris.

const DIR = "remote-results/apprendre/avions";
mkdirSync(DIR, { recursive: true });

describe.skipIf(!E2E)("apprendre à voler : les avions", () => {
  let app: App;
  // (des pas de 1/30 s par paquets d'une minute de vol : jamais un appel tenu plus de quelques secondes)
  const fly = async (until: string, maxS: number) => {
    for (let t = 0; t < maxS; t += 60) {
      const done = await app.js<boolean>(`(() => { const c = __bh.camera;
        for (let i = 0; i < 1800; i++) { __bh.step(1 / 30); if (${until}) return true; } return false; })()`);
      if (done) return true;
    }
    return false;
  };
  const state = () =>
    app.js<{ altMer: number; sol: number; v: number; vz: number; bank: number; hdg: number; fail: string | null }>(`(() => {
      const c = __bh.camera, t = __bh.time(), g = c.geoNow(), a = c.attitudeNow();
      return { altMer: Math.round(g.alt), sol: Math.round(__bh.sys.heightOverGround("earth", __bh.fleet.pose(__bh.fleet.active, t).X, t)),
        v: Math.round(c.airFlight.last?.speed ?? 0), vz: +g.vs.toFixed(1), bank: Math.round((a.bank ?? 0) * 57.3),
        hdg: Math.round((((a.heading ?? 0) * 57.3) + 360) % 360), fail: c.airFlight.failure };
    })()`);
  const cockpit = () => app.js(`(__bh.settings.shipMount = "cockpit", __bh.refresh(), __bh.camera.viewReset(), true)`);

  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("leçons 0 et 3 : le F-35B aligné à Edwards décolle, train rentré, en montée stable", async () => {
    // (la recette de la leçon 0, puis celle de la leçon 3 — le manche tiré à 0,8 au-dessus de 67 m/s au sol)
    const active = await app.js<string>(`(() => { __bh.freeze(true); __bh.game.setDate("2026-06-21T18:00:00Z");
      __bh.settings.vessel = "f35"; __bh.settings.wind = 0;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      return __bh.fleet.active; })()`);
    expect(active).toBe("f35");
    await app.js(`(() => { __bh.game.lineUp("Edwards"); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
    await cockpit();
    await app.js(`(() => { for (let i = 0; i < 3; i++) __bh.step(1 / 30); return 1; })()`);
    await app.shot(`${DIR}/l3-aligne.png`);
    const r = await app.js<{ off: boolean; t: number }>(`(() => {
      const c = __bh.camera;
      c.__input ??= c.pilotInput.bind(c);
      c.pilotInput = (pad) => { const i = c.__input(pad);
        return (c.rolling || c.ourLanded) && (c.airFlight.last?.speed ?? 0) > 67 ? { ...i, pitch: 0.8 } : i; };
      c.pilot.throttle = 1; c.jetToggle("ab");
      let k = 0;
      for (; k < 30 * 40 && (c.rolling || c.ourLanded); k++) __bh.step(1 / 30);
      c.pilotInput = c.__input; c.gearDown = false;
      for (let i = 0; i < 30 * 8; i++) __bh.step(1 / 30);
      return { off: !c.rolling && !c.ourLanded, t: k / 30 };
    })()`);
    const s = await state();
    console.log(`  décollage en ${r.t.toFixed(1)} s ; après 8 s :`, JSON.stringify(s));
    await app.shot(`${DIR}/l3-montee.png`);
    // (le critère du cours : quitté le sol, vario > 5 m/s, ailes à plat, train rentré)
    expect(r.off).toBe(true);
    expect(s.fail).toBeNull();
    expect(s.vz).toBeGreaterThan(5);
    expect(Math.abs(s.bank)).toBeLessThan(5);
    expect(await app.js<boolean>(`__bh.camera.gearDown`)).toBe(false);
  }, 120_000);

  test("leçon 3 (U) : le décollage automatique du F-35B aligné à Edwards — la vraie touche U", async () => {
    // (avant le 11 nov. 2026, U sur une piste lançait le décollage orbital, refusé : 0,6 g de poussée — PROBLEMES-A-REGLER)
    await app.js(`(() => { __bh.game.lineUp("Edwards"); for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      const c = __bh.camera; window.__said = []; if (!c.__saidHook) { const prev = c.onPilotMessage;
        c.onPilotMessage = (m) => { window.__said.push(String(m)); prev?.(m); }; c.__saidHook = 1; } return 1; })()`);
    const hdg0 = (await state()).hdg;
    await app.press("KeyU", "u");
    await Bun.sleep(200);
    const r = await app.js<{
      off: number | null;
      pitchMax: number;
      hdgMax: number;
      field: number;
      modes: (number | boolean | null)[];
      gear: boolean;
      said: string[];
    }>(`(() => {
      const c = __bh.camera, field = c.geoNow().alt; let off = null, pitchMax = 0, hdgMax = 0;
      for (let k = 0; k < 30 * 45; k++) { __bh.step(1 / 30); const a = c.attitudeNow();
        if (off === null && !c.rolling && !c.ourLanded) off = k / 30;
        if (off !== null) { pitchMax = Math.max(pitchMax, (a.pitch ?? 0) * 57.3);
          hdgMax = Math.max(hdgMax, Math.abs(((((a.heading ?? 0) * 57.3) - ${hdg0} + 540) % 360) - 180)); } }
      const m = c.jetModes;
      return { off, pitchMax: +pitchMax.toFixed(1), hdgMax: +hdgMax.toFixed(1), field: Math.round(field),
        modes: [m.alt && Math.round(m.alt), m.spd, m.ab], gear: c.gearDown, said: window.__said }; })()`);
    const s = await state();
    console.log("  U :", JSON.stringify(r), "après 45 s :", JSON.stringify(s));
    await app.shot(`${DIR}/l3-u-montee.png`);
    // (en l'air dans les 15 s ; jamais au-delà de 25° d'assiette ; l'axe à 5° près ; les maintiens passés — 1 500 m
    // au-dessus du terrain, 210 m/s, postcombustion coupée — ; le train rentré ; aucun Auto-GCAS)
    expect(r.off ?? 99).toBeLessThan(15);
    expect(r.pitchMax).toBeLessThan(25);
    expect(r.hdgMax).toBeLessThan(5);
    expect(Math.abs(Number(r.modes[0]) - (r.field + 1500))).toBeLessThan(3);
    expect(r.modes.slice(1)).toEqual([210, false]);
    expect(r.gear).toBe(false);
    expect(r.said.some((m) => /GCAS/.test(m))).toBe(false);
    expect(s.fail).toBeNull();
    expect(s.vz).toBeGreaterThan(5);
  }, 120_000);

  test("leçon 4 : 3 000 m, cap 270°, 200 m/s sous AP et auto-manette, puis un virage à 30° à la main vers 000°", async () => {
    await app.js(`(() => { const c = __bh.camera; c.jetModes.ab = false;
      __bh.game.flyAt(34.95, -117.70, 2300, 270, 200);
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      c.apSet({ ap: true, athr: true, alt: 3000, hdg: 270 * Math.PI / 180, spd: 200 });
      return 1; })()`);
    await fly("false", 90);
    const tenu = await state();
    console.log("  sous AP après 90 s :", JSON.stringify(tenu));
    await cockpit();
    await app.js(`(() => { for (let i = 0; i < 3; i++) __bh.step(1 / 30); return 1; })()`);
    await app.shot(`${DIR}/l4-palier-ap.png`);
    expect(Math.abs(tenu.altMer - 3000)).toBeLessThan(30);
    expect(Math.abs(tenu.hdg - 270)).toBeLessThan(2);
    expect(Math.abs(tenu.v - 200)).toBeLessThan(5);
    // (à la main : l'AP coupé, l'auto-manette gardée — { ap: false } ; Q/E par petites pressions jusqu'à 30°, lâcher,
    // ne pas toucher S ; sortir ~5° avant 000°)
    const v = await app.js<{ altMin: number; altMax: number; t: number; bankMax: number }>(`(() => {
      const c = __bh.camera; c.apSet({ ap: false });
      c.__input ??= c.pilotInput.bind(c);
      let roll = 1, altMin = 1e9, altMax = -1e9, bankMax = 0, k = 0;
      c.pilotInput = (pad) => ({ ...c.__input(pad), roll });
      const hdg = () => ((c.attitudeNow().heading * 57.3) + 360) % 360, bank = () => c.attitudeNow().bank * 57.3;
      for (; k < 30 * 200; k++) {
        __bh.step(1 / 30);
        const b = bank(), h = hdg(), alt = c.geoNow().alt;
        altMin = Math.min(altMin, alt); altMax = Math.max(altMax, alt); bankMax = Math.max(bankMax, b);
        if (roll > 0 && b >= 29) roll = 0;
        if (roll === 0 && h > 300 && h < 360 && h >= 355) roll = -1;
        if (roll < 0 && b <= 1) { roll = 0; break; }
      }
      c.pilotInput = c.__input;
      for (let i = 0; i < 30 * 5; i++) __bh.step(1 / 30);
      return { altMin, altMax, t: k / 30, bankMax };
    })()`);
    const fin = await state();
    console.log(
      `  virage en ${v.t.toFixed(0)} s, inclinaison max ${v.bankMax.toFixed(0)}°, altitude ${v.altMin.toFixed(0)}–${v.altMax.toFixed(0)} m ;`,
      JSON.stringify(fin),
    );
    await app.shot(`${DIR}/l4-virage-fin.png`);
    expect(v.bankMax).toBeGreaterThan(25);
    expect(v.altMax - 3000).toBeLessThan(30);
    expect(3000 - v.altMin).toBeLessThan(30);
    expect(Math.min(Math.abs(fin.hdg - 360), fin.hdg)).toBeLessThan(8);
  }, 240_000);

  test("leçon 7 : l'approche ILS d'Edwards, jugée sur son toucher", async () => {
    const said = await app.js<string>(`(() => { const c = __bh.camera;
      const R = c.ilsRunways("KEDW").auto.rwy, h = R.hdg * Math.PI / 180;
      const lat = R.lat - 12000 * Math.cos(h) / 111320, lon = R.lon - 12000 * Math.sin(h) / (111320 * Math.cos(R.lat * Math.PI / 180));
      __bh.game.flyAt(lat, lon, 630, R.hdg, 90);
      c.gearDown = true; c.gearExt = 1; c.gearInit = true;
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      return c.ilsStart("KEDW"); })()`);
    console.log("  ", said);
    expect(said).toMatch(/^ILS approach/);
    await cockpit();
    await fly(
      "c.ilsRun && c.ilsRun.phase === 'final' && c.geoNow() && __bh.sys.heightOverGround('earth', __bh.fleet.pose(__bh.fleet.active, __bh.time()).X, __bh.time()) < 150",
      120,
    );
    await app.shot(`${DIR}/l7-courte-finale.png`);
    await fly("!c.ilsRun", 300);
    const last = await app.js<{ rwy: string; score: number; touch?: { along: number; across: number; vs: number } }>(`__bh.camera.ilsLast`);
    console.log("  ilsLast :", JSON.stringify(last));
    await app.shot(`${DIR}/l7-pose.png`);
    expect(last?.touch).toBeDefined();
    expect(last!.touch!.along).toBeGreaterThan(150);
    expect(last!.touch!.along).toBeLessThan(900);
    expect(Math.abs(last!.touch!.across)).toBeLessThan(8);
    expect(last!.touch!.vs).toBeGreaterThan(-3);
  }, 300_000);

  test("leçon 8 : le F-35B en finale du Ford, posé verticalement sur le pont (deckLand)", async () => {
    // (la recette de la leçon 8 : en mer, le porte-avions 4 km devant, la finale, 1 800 kg de carburant, les maintiens, deckLand)
    await app.js(`(() => { __bh.settings.vessel = "f35"; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.settings.wind = 0; __bh.game.flyAt(42.75, 6.1, 300, 20, 140); for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      return __bh.camera.carrierSpawn("ford"); })()`);
    await app.waitFor(`!!__bh.camera.carrierNow().length`, 10_000);
    await app.js(`(() => { const c = __bh.camera; const r = c.carrierFinal("ford", 3500, 90); __bh.fleet.fuel.f35 = 1800;
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return r; })()`);
    // (deckLand attend la carte du pont : « still loading » — réessayer, une image entre)
    let said = "";
    for (let k = 0; k < 60 && !/Deck landing on/.test(said); k++) {
      said = await app.js<string>(
        `(async () => { await new Promise((r) => requestAnimationFrame(r)); return String(__bh.camera.deckLand("ford") ?? ""); })()`,
      );
      if (!/Deck landing on/.test(said)) await Bun.sleep(250);
    }
    console.log("  ", said);
    expect(said).toContain("Deck landing on");
    await cockpit();
    await fly("!c.deckRun || c.airFlight.failure", 300);
    const last = await app.js<{ dx: number; dz: number; sink: number; grade: string } | null>(`__bh.camera.deckLast`);
    const fail = await app.js<string | null>(`__bh.camera.airFlight.failure`);
    console.log("  deckLast :", JSON.stringify(last), fail ?? "");
    await app.shot(`${DIR}/l8-pont.png`);
    expect(fail).toBeNull();
    expect(last).not.toBeNull();
    expect(Math.hypot(last!.dx, last!.dz)).toBeLessThan(3);
    await app.js(`(__bh.camera.carrierClear(), 1)`);
  }, 360_000);

  test("leçon 10 : l'A320 du Bourget — décollage TOGA, AP1, puis une approche ILS posée par son FMGC", async () => {
    await app.js(`(() => { __bh.settings.vessel = "a320"; __bh.settings.a320Start = "ready";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
    expect(await app.js<string>(`__bh.fleet.active`)).toBe("a320");
    await app.js(`(() => { __bh.game.lineUp("Paris – Le Bourget"); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
    await app.waitFor("!!__bh.camera.a320Sys", 30_000);
    await cockpit();
    await app.js(`(() => { for (let i = 0; i < 3; i++) __bh.step(1 / 30); return 1; })()`);
    await app.shot(`${DIR}/l10-aligne.png`);
    // (CONF 1+F, TOGA, le manche tiré doucement à VR ≈ 135 kt ≈ 69 m/s ; le train rentré une fois en montée)
    const to = await app.js<{ off: boolean; t: number; fma: unknown }>(`(() => { const c = __bh.camera;
      c.airFlight.cfg.flaps = 0.25; c.a320Park = false; c.pilot.throttle = 1;
      c.__input ??= c.pilotInput.bind(c);
      c.pilotInput = (pad) => { const i = c.__input(pad);
        const v = c.airFlight.last?.speed ?? 0, a = c.attitudeNow().pitch * 57.3;
        return v > 69 && a < 15 ? { ...i, pitch: 0.5 } : i; };
      let k = 0;
      for (; k < 30 * 80 && (c.rolling || c.ourLanded); k++) __bh.step(1 / 30);
      for (let i = 0; i < 30 * 4; i++) __bh.step(1 / 30);
      c.pilotInput = c.__input; c.gearDown = false;
      for (let i = 0; i < 30 * 6; i++) __bh.step(1 / 30);
      c.a320ApKey("ap");
      for (let i = 0; i < 30 * 3; i++) __bh.step(1 / 30);
      return { off: !c.rolling && !c.ourLanded, t: k / 30, fma: c.a320Fmgc.fma() };
    })()`);
    console.log(`  décollage en ${to.t.toFixed(0)} s ; FMA :`, JSON.stringify(to.fma));
    await app.shot(`${DIR}/l10-montee-ap1.png`);
    expect(to.off).toBe(true);
    expect((to.fma as { ap: string }).ap).toMatch(/AP1/);
    // (l'approche : sur l'axe à 20 km, 1 000 m, 75 m/s, lisse ; ≥ 5 s de vol, puis ilsStart — le FMGC la vole)
    const said = await app.js<string>(`(() => { const c = __bh.camera;
      const R = c.ilsRunways("LFPB").auto.rwy, h = R.hdg * Math.PI / 180;
      const lat = R.lat - 20000 * Math.cos(h) / 111320, lon = R.lon - 20000 * Math.sin(h) / (111320 * Math.cos(R.lat * Math.PI / 180));
      __bh.game.flyAt(lat, lon, 1000, R.hdg, 75);
      c.airFlight.cfg.flaps = 0; c.pilot.throttle = 0.6;
      for (let i = 0; i < 30 * 7; i++) __bh.step(1 / 30);
      c.a320ApKey("ap");
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      return c.ilsStart("LFPB"); })()`);
    console.log("  ", said);
    await cockpit();
    const landed = await fly("c.ourLanded || c.airFlight.failure || (!c.a320App && !!c.ilsLast)", 900);
    const end = await app.js<{ landed: boolean; fail: string | null; last: unknown; log: string[] }>(`(() => { const c = __bh.camera;
      return { landed: !!c.ourLanded || !!c.rolling, fail: c.airFlight.failure, last: c.ilsLast,
        log: __bh.game.log.events.filter((e) => e.kind === "pilot").slice(-6).map((e) => e.text) }; })()`);
    console.log("  fin d'approche :", JSON.stringify(end));
    await app.shot(`${DIR}/l10-pose.png`);
    expect(landed).toBe(true);
    expect(end.fail).toBeNull();
    expect(end.landed).toBe(true);
  }, 600_000);

  test("après un crash : la pause et l'écran de perte, un nouveau placement efface la panne, un bouton reprend", async () => {
    await app.js(`(() => { __bh.settings.vessel = "f35"; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.settings.damage = true; __bh.game.flyAt(34.95, -117.80, 80, 270, 150);
      const c = __bh.camera; c.__input ??= c.pilotInput.bind(c); c.pilotInput = (pad) => ({ ...c.__input(pad), pitch: -1 });
      for (let i = 0; i < 30 * 30 && !c.airFlight.failure; i++) __bh.step(1 / 30);
      c.pilotInput = c.__input; return 1; })()`);
    await app.waitFor(`!!document.querySelector(".craft-lost")`, 5000);
    const lost = await app.js<{ fail: string | null; animate: boolean }>(
      `({ fail: __bh.camera.airFlight.failure, animate: __bh.settings.animate })`,
    );
    console.log("  perdu :", JSON.stringify(lost));
    await app.shot(`${DIR}/crash-ecran.png`);
    expect(lost.fail).not.toBeNull();
    expect(lost.animate).toBe(false);
    // (un nouveau placement : la panne effacée, l'écran et la pause restent)
    const after = await app.js<{ fail: string | null; animate: boolean; screen: boolean }>(`(() => { __bh.game.lineUp("Edwards");
      return { fail: __bh.camera.airFlight.failure, animate: __bh.settings.animate, screen: !!document.querySelector(".craft-lost") }; })()`);
    expect(after.fail).toBeNull();
    expect(after.animate).toBe(false);
    expect(after.screen).toBe(true);
    // (un bouton de l'écran, par un vrai clic : « Undamaged » — les dégâts coupés, le temps relancé)
    await app.js(`(() => { const b = [...document.querySelectorAll(".craft-lost button")].find((x) => /without damage|sans dégâts/i.test(x.textContent));
      b.dataset.e2e = "undamaged"; return 1; })()`);
    await app.click(`[data-e2e="undamaged"]`);
    const back = await app.js<{ animate: boolean; screen: boolean }>(
      `({ animate: __bh.settings.animate, screen: !!document.querySelector(".craft-lost") })`,
    );
    await app.js(`(__bh.settings.damage = true, __bh.freeze(false), 1)`);
    await app.shot(`${DIR}/crash-repris.png`);
    expect(back.animate).toBe(true);
    expect(back.screen).toBe(false);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
