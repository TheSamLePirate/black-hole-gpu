import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Lagrange points (L1–L5), JWST 3D WebGPU spacecraft at Sun–Earth L2, 3D map rendering & targeting,
// N-body Flight Computer transfer planning to a JWST-style Halo orbit, and closed-loop Halo orbit
// station-keeping autopilot — verified end-to-end in real WebGPU Chrome with captures.
// Duration: ~1–1.5 min on this Mac (not run since 2026-11-24: the Halo flight is now 10 days at 6 h/s, ~1 200 steps).
// Done when: JWST prepared only on approach and its close-up drawn (its shadow map kept between frames), 3D map with L1–L5 + Halo loop, LEO→SE-L2 Halo mission plan, and the Halo autopilot holding the orbit 10 days at the present date (≤ 20 km, ≤ 1 m/s) all pass and write PNG captures under remote-results/lagrange-jwst/, with zero console or WebGPU errors.

const OUT = "remote-results/lagrange-jwst";

describe.skipIf(!E2E)("Lagrange points, JWST at Sun–Earth L2, 3D map & Halo autopilot", () => {
  let app: App;

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis", width: 1440, height: 900 });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.settled();
    app.steps(["JWST à L2 Soleil–Terre", "Carte 3D (L1–L5 + Halo)", "Plan de mission LEO → Halo SE-L2", "Autopilote Halo autour de SE-L2"]);
    app.estimate(80);
  }, 300_000);

  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("renders JWST on its Southern Halo orbit at Sun–Earth L2 with real sun-shielding attitude", async () => {
    await app.step("JWST à L2 Soleil–Terre");
    // (nothing of JWST on the GPU while it is 1.5 million km away — jwst.ts: prepared on approach, < 100,000 km)
    const lazy = await app.js<{ ready: boolean; prepared: number }>(
      `(() => { const g = __bh.jwst.gpu(); return { ready: g.ready, prepared: g.stats.prepared }; })()`,
    );
    expect(lazy.ready).toBe(false);
    expect(lazy.prepared).toBe(0);
    await app.js(`(async () => {
      const f = () => new Promise((r) => requestAnimationFrame(r));
      __bh.game.setDate("2026-06-21T12:00:00Z");
      await f();
      await f();
      __bh.camera.selectTarget("jwst");
      __bh.goTo("jwst");
      __bh.touch();
      return true;
    })()`);
    await app.waitFor("__bh.renderer.jwst.ready", 30_000);
    // Wait until the voyage to JWST completes and the telescope is framed cleanly on screen
    await app.waitFor("!__bh.voyage() && __bh.renderer.jwst.rect[2] > 60", 30_000);
    const rect = await app.js<number[]>(`(async () => {
      const f = () => new Promise((r) => requestAnimationFrame(r));
      const c0 = __bh.renderer.completedFrames;
      for (let i = 0; i < 40 && __bh.renderer.completedFrames < c0 + 6; i++) {
        __bh.touch();
        await f();
      }
      return Array.from(__bh.renderer.jwst.rect);
    })()`);
    expect(rect[2]!).toBeGreaterThan(60);
    expect(rect[3]!).toBeGreaterThan(60);
    // its shadow map kept while the Sun holds still in its frame: 30 more frames drawn, at most one shadow redraw
    const cache = await app.js<{ draws: number; shadowDraws: number }>(`(async () => {
      const f = () => new Promise((r) => requestAnimationFrame(r));
      const g0 = __bh.jwst.gpu().stats;
      for (let i = 0; i < 30; i++) { __bh.touch(); await f(); }
      const g1 = __bh.jwst.gpu().stats;
      return { draws: g1.draws - g0.draws, shadowDraws: g1.shadowDraws - g0.shadowDraws };
    })()`);
    expect(cache.draws).toBeGreaterThan(10);
    expect(cache.shadowDraws).toBeLessThanOrEqual(1);
    await app.shot(`${OUT}/jwst-closeup.png`);
    await app.stepDone(
      `JWST rendu ${Math.round(rect[2]!)}×${Math.round(rect[3]!)} px · ombre redessinée ${cache.shadowDraws}× en ${cache.draws} images`,
    );
    expect(app.cdp.errors).toEqual([]);
  });

  test("displays L1–L5, Halo orbits, and JWST on the 3D map and selects lag:earth:2 as target", async () => {
    await app.step("Carte 3D (L1–L5 + Halo)");
    await app.js(`(() => {
      __bh.settings.ship = true;
      __bh.spectate(false);
      __bh.game.orbit("earth", { altKm: 400, inc: 28.5 });
      __bh.settings.lagrangePoints = true;
      __bh.camera.selectTarget("lag:earth:2");
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("__bh.camera.piloting", 10_000);
    // Open the full-screen 3D map via the real M key
    await app.press("KeyM");
    await app.waitFor(`document.body.classList.contains("map-open")`, 10_000);
    // Zoom out smoothly to ~2.2 Mkm across so Earth, Moon, EM-L1..L5, SE-L1/L2, JWST & the 3D Halo loop all fill the view
    for (let k = 0; k < 16; k++) {
      await app.mouse("wheel", 720, 450, { deltaY: 180 });
    }
    const targetInfo = await app.js<{
      target: string;
      name: string;
      seL2DistKm: number;
      l4Stable: boolean;
      l2Stable: boolean;
    }>(`(async () => {
      const st = __bh.lagrange.state("lag:earth:2", __bh.time());
      const stab2 = __bh.lagrange.stability("lag:earth:2", __bh.time());
      const stab4 = __bh.lagrange.stability("lag:earth:4", __bh.time());
      const f = () => new Promise((r) => requestAnimationFrame(r));
      for (let i = 0; i < 12; i++) await f();
      return {
        target: __bh.settings.target,
        name: __bh.game.status().target?.name ?? "",
        seL2DistKm: st ? Math.round((st.distSecondary * 1.476625e11) / 1e3) : 0,
        l4Stable: !!stab4?.linearlyStable,
        l2Stable: !!stab2?.linearlyStable,
      };
    })()`);
    expect(targetInfo.target).toBe("lag:earth:2");
    expect(targetInfo.seL2DistKm).toBeGreaterThan(1_400_000);
    expect(targetInfo.seL2DistKm).toBeLessThan(1_600_000);
    expect(targetInfo.l4Stable).toBe(true);
    expect(targetInfo.l2Stable).toBe(false);
    await app.shot(`${OUT}/map3d-lagrange.png`);
    await app.stepDone(`SE-L2 à ${(targetInfo.seL2DistKm / 1e6).toFixed(2)} Mkm · ciblé`);
    await app.press("Escape");
    await app.waitFor(`!document.body.classList.contains("map-open")`, 5_000);
    expect(app.cdp.errors).toEqual([]);
  });

  test("Flight Computer plans an Earth LEO → Sun–Earth L2 Halo mission and renders it on the 3D map", async () => {
    await app.step("Plan de mission LEO → Halo SE-L2");
    const plan = await app.js<{
      ok: boolean;
      note: string;
      dvTotal: number;
      burns: number;
      hasHaloCap: boolean;
      err: string | null;
    }>(`(async () => {
      __bh.game.orbit("earth", { altKm: 400, inc: 28.5 });
      __bh.camera.selectTarget("lag:earth:2");
      __bh.refresh();
      const f = () => new Promise((r) => requestAnimationFrame(r));
      for (let i = 0; i < 3; i++) await f();
      const res = await __bh.camera.missionPlan({ target: "lag:earth:2", arrival: "halo" });
      let err = null;
      if (res.ok) err = __bh.camera.missionCommit();
      const nodes = __bh.camera.plan.nodes;
      return {
        ok: !!res.ok,
        note: res.note ?? "",
        dvTotal: res.dvTotal ?? 0,
        burns: res.burns?.length ?? 0,
        hasHaloCap: nodes.some((n) => n.role === "capture" && n.then === "orbit" && n.body === "lag:earth:2"),
        err,
      };
    })()`);
    if (!plan.ok) throw new Error(`missionPlan failed: ${JSON.stringify(plan)}`);
    expect(plan.ok).toBe(true);
    expect(plan.err).toBeNull();
    expect(plan.burns).toBeGreaterThanOrEqual(2);
    expect(plan.hasHaloCap).toBe(true);
    expect(plan.dvTotal).toBeGreaterThan(2500);
    expect(plan.dvTotal).toBeLessThan(8500);

    // Open the 3D map to visualize the planned LEO → SE-L2 Halo transfer trajectory
    await app.press("KeyM");
    await app.waitFor(`document.body.classList.contains("map-open")`, 10_000);
    // Center on Earth/ship (⊙ button) and zoom out to frame Earth → SE-L2 transfer arc + Halo orbit
    await app.click(".m3-bar button:first-child");
    for (let k = 0; k < 15; k++) {
      await app.mouse("wheel", 720, 450, { deltaY: 180 });
    }
    await app.js(
      `(async () => { const f = () => new Promise((r) => requestAnimationFrame(r)); for (let i = 0; i < 12; i++) await f(); })()`,
    );
    await app.shot(`${OUT}/mission-se-l2-halo.png`);
    await app.stepDone(`${plan.burns} manœuvres · Δv ${(plan.dvTotal / 1000).toFixed(2)} km/s`);
    await app.press("Escape");
    await app.waitFor(`!document.body.classList.contains("map-open")`, 5_000);
    expect(app.cdp.errors).toEqual([]);
  });

  test("Halo orbit autopilot holds a spacecraft in a JWST-style 3D Halo orbit around Sun–Earth L2", async () => {
    await app.step("Autopilote Halo autour de SE-L2");
    // At the present date (the bug of 07021ba5: the Halo's phase ran from 2067 at the day's rate — at 2026-11-24 its
    // velocity was 1.6 km/s off its own path; the old check, 4 s of real time at ×1, could not see it). Engaged 2 km off
    // the orbit, flown 10 days at 6 h a second: the craft must stay on the orbit and move with it.
    const res = await app.js<{
      auto: string;
      haloTarget: string | null;
      days: number;
      fdVelErrMs: number;
      distEndKm: number;
      errEndKm: number;
      errMaxKm: number;
      dvEndMs: number;
    }>(`(() => {
      __bh.freeze(true);
      __bh.game.setDate("2026-11-24T12:00:00Z");
      const t0 = __bh.time();
      const M = 1.476625e11, C = 299792458, S = 4.925490947e-6 * __bh.settings.massSolar;
      const azM = __bh.lagrange.defaultAzM("lag:earth:2", t0);
      const P = { azM, branch: -1, phase0: 0.25 };
      const h0 = __bh.lagrange.halo("lag:earth:2", t0, P);
      // (the reference's own consistency in this bundle: its velocity against its positions 60 s apart)
      const dt = 60 / S, hp = __bh.lagrange.halo("lag:earth:2", t0 + dt, P), hm = __bh.lagrange.halo("lag:earth:2", t0 - dt, P);
      const fdVelErrMs = Math.hypot(...[0, 1, 2].map((k) => (hp.pos[k] - hm.pos[k]) / (2 * dt) - h0.vel[k])) * C;
      // Place craft slightly offset (2 km) from the exact Halo orbit and engage the Halo 'orbit' autopilot
      const X0 = [h0.pos[0] + 2000 / M, h0.pos[1], h0.pos[2]];
      __bh.game.placeAt({ frame: "ours", X: X0, vel: h0.vel, fwd: [0, 1, 0], up: [0, 0, 1], note: "SE-L2 Halo" });
      __bh.camera.selectTarget("lag:earth:2");
      __bh.camera.pilot.auto = "none";
      __bh.camera.pilot.setAuto("orbit");
      __bh.settings.timeSpeed = (6 * 3600) / S;
      let errMaxKm = 0;
      const err = () => {
        const nav = __bh.sys.nav();
        const h = __bh.lagrange.halo("lag:earth:2", nav.t, { azM, branch: -1, phase0: __bh.camera.ourHalo?.phase0 ?? 0.25 });
        return { nav, h, km: (Math.hypot(nav.X[0] - h.pos[0], nav.X[1] - h.pos[1], nav.X[2] - h.pos[2]) * M) / 1e3 };
      };
      for (let i = 0; i < 1200 && (__bh.time() - t0) * S < 10 * 86400; i++) {
        __bh.step(1 / 30);
        if (i % 30 === 29) errMaxKm = Math.max(errMaxKm, err().km);
      }
      const e = err();
      const nav = e.nav, h1 = e.h;
      const distEndKm = (Math.hypot(nav.X[0] - h1.lagrange.pos[0], nav.X[1] - h1.lagrange.pos[1], nav.X[2] - h1.lagrange.pos[2]) * M) / 1e3;
      const dvEndMs = Math.hypot(nav.V[0] - h1.vel[0], nav.V[1] - h1.vel[1], nav.V[2] - h1.vel[2]) * C;
      __bh.freeze(false);
      return {
        auto: __bh.camera.pilot.auto,
        haloTarget: __bh.camera.ourHalo?.target ?? null,
        days: +(((nav.t - t0) * S) / 86400).toFixed(2),
        fdVelErrMs: +fdVelErrMs.toFixed(4),
        distEndKm: Math.round(distEndKm),
        errEndKm: +e.km.toFixed(2),
        errMaxKm: +errMaxKm.toFixed(2),
        dvEndMs: +dvEndMs.toFixed(3),
      };
    })()`);
    expect(res.fdVelErrMs).toBeLessThan(0.01);
    expect(res.auto).toBe("orbit");
    expect(res.haloTarget).toBe("lag:earth:2");
    expect(res.days).toBeGreaterThan(5);
    expect(res.distEndKm).toBeGreaterThan(200_000);
    expect(res.distEndKm).toBeLessThan(900_000);
    expect(res.errMaxKm).toBeLessThan(20);
    expect(res.errEndKm).toBeLessThan(5);
    expect(res.dvEndMs).toBeLessThan(1);
    await app.stepDone(
      `Halo SE-L2 tenu ${res.days} j · écart ${res.errEndKm} km (max ${res.errMaxKm}) · ${res.dvEndMs} m/s · réf. ${res.fdVelErrMs} m/s`,
    );
    expect(app.cdp.errors).toEqual([]);
  });
});
