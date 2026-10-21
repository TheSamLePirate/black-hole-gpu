import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The Ranger's nose radar (PLAN-RADAR-AAA, RD4's leftover): the Ranger flown over the Alps, two fighters put before
// its nose — one 50 km ahead (within its 90 km on a 5 m² fighter), one 120 km ahead (within the F-35's APG-81's
// 150 km, beyond the nose's) —: the radar on with the Ranger's spec (NOSE), the near one tracked, the far one not; on
// the HUD's scope (its contacts, its label — the orbit panel's corner given to it); a click's selection and its second click's lock on it; then the F-35
// flown instead: its APG-81 back, both held. (E2E_SHOTS=<dir>: the Ranger's scope.)

describe.skipIf(!E2E)("the Ranger's nose radar", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { Object.assign(__bh.settings, { vessel: "ranger", traffic: false, wind: 0, wingmen: 0 }); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "ranger"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.9, 6.9, 6000, 0, 220); __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.waitFor(`__bh.camera.airFlight.inAir && !!__bh.camera.picture`, 30_000);
    // (two fighters ahead, held still relative to the ground — their place carried on by our own motion)
    await app.js(`(() => { const c = __bh.camera; let r = null, last = 0;
      c.radarSources.set("tst", (fix) => {
        const now = performance.now() / 1000;
        if (!r) { const h = Math.atan2(fix.own.fwd[0], fix.own.fwd[1]);
          r = { near: [Math.sin(h) * 50000, Math.cos(h) * 50000, 0], far: [Math.sin(h + 0.05) * 120000, Math.cos(h + 0.05) * 120000, 0] }; last = now; }
        const dt = Math.min(now - last, 0.2); last = now;
        for (const k of ["near", "far"]) for (let j = 0; j < 3; j++) r[k][j] -= fix.own.v[j] * dt;
        return ["near", "far"].map((k) => ({ id: "tst:" + k, r: [...r[k]], v: [0, 0, 0], rcs: 5, kind: "air", iff: "hostile", name: k.toUpperCase(), squawk: false }));
      });
      return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the Ranger in the air: NOSE on, the fighter at 50 km held, the one at 120 km not; on the HUD's scope", async () => {
    await app.waitFor(`__bh.camera.radar.tracks.has("tst:near")`, 15_000);
    await Bun.sleep(6000);
    const R = await app.js<{
      spec: string | null;
      near: boolean;
      far: boolean;
      hud: string | null;
      az: number;
      contacts: string[];
    }>(`(() => {
      const c = __bh.camera, i = c.flightInfo();
      return { spec: c.airRadar()?.name ?? null, near: c.radar.tracks.has("tst:near"), far: c.radar.tracks.has("tst:far"),
        hud: i.radar?.name ?? null, az: i.radar?.az ?? 0, contacts: (i.radar?.contacts ?? []).map((k) => k.id) }; })()`);
    console.log(
      `  ${R.spec}: near ${R.near}, far ${R.far}; HUD ${R.hud} ±${((R.az * 180) / Math.PI).toFixed(0)}° [${R.contacts.join(", ")}]`,
    );
    expect(R.spec).toBe("NOSE");
    expect(R.near).toBe(true);
    expect(R.far).toBe(false);
    expect(R.hud).toBe("NOSE");
    expect(Math.round((R.az * 180) / Math.PI)).toBe(60);
    expect(R.contacts).toContain("tst:near");
    expect(R.contacts).not.toContain("tst:far");
    // (selected, then locked by a second selection — the click's way)
    const said = await app.js<string[]>(`[__bh.camera.pictureSelect("tst:near"), __bh.camera.pictureSelect("tst:near")]`);
    console.log(`  ${said.join(" · ")}`);
    expect(await app.js<string | null>("__bh.camera.radar.lock")).toBe("tst:near");
    // (its scope in the orbit panel's corner: that panel put away, the key hints above)
    await Bun.sleep(2000);
    const ui = await app.js<{ craft: string | undefined; orbit: string | null; jet: boolean }>(`(() => {
      const r = document.querySelector(".fl-root"), o = document.querySelector(".fl-orbit");
      return { craft: r?.dataset.craft, orbit: o ? getComputedStyle(o).display : null, jet: document.body.classList.contains("jet-hud") }; })()`);
    expect(ui.craft).toBe("nose");
    expect(ui.orbit === null || ui.orbit === "none").toBe(true);
    expect(ui.jet).toBe(true);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await Bun.sleep(1500);
      await app.shot(`${shots}/ranger-nose-radar.png`);
    }
  }, 120_000);

  test("the F-35 instead: its APG-81 back, the far one held too", async () => {
    await app.js(`(() => { __bh.settings.vessel = "f35"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.9, 6.9, 6000, 0, 220); return 1; })()`);
    await app.waitFor(`__bh.camera.airFlight.inAir && __bh.camera.airRadar()?.name === "APG-81"`, 30_000);
    // (the far fighter put ahead again from the new place)
    await app.js(`(() => { const c = __bh.camera; let r = null, last = 0;
      c.radarSources.set("tst", (fix) => {
        const now = performance.now() / 1000;
        if (!r) { const h = Math.atan2(fix.own.fwd[0], fix.own.fwd[1]); r = [Math.sin(h) * 120000, Math.cos(h) * 120000, 0]; last = now; }
        const dt = Math.min(now - last, 0.2); last = now;
        for (let j = 0; j < 3; j++) r[j] -= fix.own.v[j] * dt;
        return [{ id: "tst:far", r: [...r], v: [0, 0, 0], rcs: 5, kind: "air", iff: "hostile", name: "FAR", squawk: false }];
      });
      return 1; })()`);
    await app.waitFor(`__bh.camera.radar.tracks.has("tst:far")`, 15_000);
    expect(await app.js<string | null>("__bh.camera.flightInfo().radar?.name ?? null")).toBe("APG-81");
    await app.js(`(() => { __bh.camera.radarSources.delete("tst"); return 1; })()`);
  }, 120_000);
});
