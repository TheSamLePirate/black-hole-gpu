import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35's protections (docs/PLAN-AVIATION-AAA.md, A2): first the Alps as ever; then the autopilot holding 3 600 m
// straight at the Mont Blanc (4 808 m) — the Auto-GCAS's chevrons closing, its fly-up at the last moment, over the
// massif, given back —; then an A320 head-on at our height over the sea — the Auto-ACAS's escape, the closest approach
// kept. (Measured headless — a dive into the sea, on its back, a ridge, off: into it: tests/gcas.test.ts.)
// (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the Auto-GCAS and the Auto-ACAS", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "B", f35Assist: "realistic", f35AutoProtect: true });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the autopilot holding 3 600 m at the Mont Blanc: the fly-up at the last moment, over it, given back", async () => {
    // (17 km north-west of it over the Arve's valley, heading for it; the altitude held)
    await app.js(`(() => { __bh.game.flyAt(45.95, 6.72, 2600, 140, 230); __bh.fleet.fuel.f35 = 5000; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(
      `(() => { const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt); c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("athr"); return 1; })()`,
    );
    const alt0 = await app.js<number>(`__bh.camera.geoNow().alt`);
    await app.waitFor(`__bh.camera.gcas?.flyUp === true`, 90_000);
    await Bun.sleep(1200);
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(600);
    await shot("flyup");
    let low = Infinity;
    for (let i = 0; i < 60 && (await app.js<boolean>(`!!__bh.camera.gcas?.flyUp`)); i++) {
      low = Math.min(low, await app.js<number>(`__bh.camera.gcas?.clear ?? Infinity`));
      await Bun.sleep(500);
    }
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 200, pitch: 8, dist: 60 }); return 1; })()`);
    await Bun.sleep(1500);
    await shot("over");
    const st = await app.js<{ alt: number; failed: boolean; flyUp: boolean }>(
      `({ alt: __bh.camera.geoNow().alt, failed: !!__bh.camera.airFlight.failure, flyUp: !!__bh.camera.gcas?.flyUp })`,
    );
    console.log(
      `  held ${alt0.toFixed(0)} m; the fly-up's foreseen clearance at its least ${low.toFixed(0)} m; now ${st.alt.toFixed(0)} m, given back: ${!st.flyUp}`,
    );
    expect(st.failed).toBe(false);
    expect(st.alt).toBeGreaterThan(alt0);
  }, 180_000);

  test("an A320 head-on at our height: the escape, the closest approach kept", async () => {
    await app.js(`(() => { __bh.game.flyAt(43.0, 5.0, 3000, 90, 220); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera, g = c.geoNow();
      c.jetModes.alt = Math.round(g.alt); c.jetModes.hdg = c.attitudeNow().heading;
      c.combatStart({ id: "acas", title: { fr: "ACAS", en: "ACAS" }, brief: { fr: "", en: "" }, anchor: { lat: g.lat, lon: g.lon },
        start: { e: 0, n: 0, agl: 3000, hdg: 90, speed: 220 }, loadout: "gun", limit: 1e9, mission: true,
        targets: [{ kind: "airliner", at: [7000, 0, g.alt], hdg: 270, speed: 210, name: "AFR1234" }] });
      return 1; })()`);
    // (the closest approach watched in the page, every frame)
    await app.js(`(() => { window.__cpa = Infinity; const tick = () => { const C = __bh.camera.combat; if (!C) return;
      const q = C.world.targets[0], P = C.last; if (P) window.__cpa = Math.min(window.__cpa, Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]));
      requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`);
    let closest = Infinity;
    let escaped = false;
    for (let i = 0; i < 80; i++) {
      const s = await app.js<{
        d: number;
        esc: string | null;
        passed: boolean;
      }>(`(() => { const C = __bh.camera.combat, q = C.world.targets[0], P = C.last;
        return { d: P ? Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]) : -1, esc: __bh.camera.gcas?.escape?.name ?? null, passed: !!P && q.p[0] < P.p[0] }; })()`);
      // (no fight's frame yet: -1 — Infinity would come back as null, a 0)
      if (s.d >= 0) closest = Math.min(closest, s.d);
      if (s.esc && !escaped) {
        escaped = true;
        await Bun.sleep(1500);
        await shot("acas");
      }
      // (past each other, and a little more)
      if (s.passed && s.d > 1000) break;
      await Bun.sleep(250);
    }
    closest = Math.min(closest, await app.js<number>(`window.__cpa`));
    console.log(`  the A320 passed at ${closest.toFixed(0)} m, escaped: ${escaped}`);
    expect(escaped).toBe(true);
    expect(closest).toBeGreaterThan(150);
    await app.js(`(() => { __bh.camera.combatEnd(); return 1; })()`);
  }, 120_000);
});
