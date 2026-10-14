import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Set down on the ground anywhere (the place panel's "on a ground", the Atlas's "land"): on its gear as the
// ground under each leg has it — on a runway level, on a hillside (Mount Fuji's flank) tilted with it —, every
// leg at the same height over the ground, still; its nose where it pointed.

describe.skipIf(!E2E)("set down on the ground", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1000, height: 700, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await Bun.sleep(4000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const legs = (v: string, lat: number, lon: number) =>
    app.js<{ h: number[]; tilt: number; gs: number; label: string }>(`(async () => {
      __bh.freeze(true); __bh.settings.vessel = ${JSON.stringify(v)}; for (let i = 0; i < 3; i++) __bh.step(1 / 30);
      __bh.game.land("earth", ${lat}, ${lon});
      for (let i = 0; i < 90; i++) __bh.step(1 / 30);
      const F = __bh.fleet, t = __bh.sim.time, p = F.pose(F.active, t), mR = 1476.625 * __bh.settings.massSolar;
      const G = __bh.sys.gears()[F.active];
      const L = (G ?? { legs: [] }).legs;
      const h = L.map((g) => __bh.sys.heightOverGround("earth", p.X.map((x, i) => x + (p.ax[0][i] * g.at[0] + p.ax[1][i] * g.at[1] + p.ax[2][i] * g.at[2]) / mR), t));
      const q = __bh.sys.bodyFixed("earth", p.X, t), top = __bh.sys.bodyFixed("earth", p.X.map((x, i) => x + p.ax[1][i] * 1e-9), t).map((x, i) => x - q[i]);
      const lq = Math.hypot(...q), lt = Math.hypot(...top);
      const tilt = Math.acos(Math.min(1, (q[0] * top[0] + q[1] * top[1] + q[2] * top[2]) / lq / lt)) * 180 / Math.PI;
      return { h, tilt, gs: __bh.camera.geoNow().gs, label: __bh.game.status().label };
    })()`);

  test("set down at an airfield's place: lined up on its runway in use, at its start", async () => {
    const r = await app.js<{ note: string; dh: number; off: number }>(`(() => {
      __bh.freeze(true); __bh.settings.vessel = "ranger"; for (let i = 0; i < 3; i++) __bh.step(1 / 30);
      const note = __bh.game.land("earth", 48.96, 2.44);
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      const F = __bh.fleet, t = __bh.sim.time, p = F.pose(F.active, t), mR = 1476.625 * __bh.settings.massSolar;
      const bf = (X) => __bh.sys.bodyFixed("earth", X, t).map((x) => x * mR);
      const q = bf(p.X), nose = bf(p.X.map((x, i) => x + p.ax[2][i] * 1e-9)).map((x, i) => x - q[i]);
      const R = __bh.sys.runways().find((r) => r.site.name.includes("Bourget"));
      const d = q.map((x, i) => x - R.origin[i]);
      const ln = Math.hypot(...nose);
      const na = (nose[0] * R.along[0] + nose[1] * R.along[1] + nose[2] * R.along[2]) / ln;
      return { note, dh: Math.acos(Math.min(1, Math.abs(na))) * 180 / Math.PI, off: d[0] * R.across[0] + d[1] * R.across[1] + d[2] * R.across[2] };
    })()`);
    console.log(`  ${r.note} · Δhdg ${r.dh.toFixed(3)}° · off ${r.off.toFixed(2)} m`);
    expect(r.note).toContain("lined up");
    expect(r.dh).toBeLessThan(0.1);
    expect(Math.abs(r.off)).toBeLessThan(1);
  }, 60_000);

  for (const v of ["f35", "ranger"])
    test(`the ${v}: on a runway and on Mount Fuji's flank, every leg on the ground`, async () => {
      const flat = await legs(v, 34.9046, -117.8844);
      const hill = await legs(v, 35.3335, 138.7);
      console.log(`  ${v} runway: legs ${flat.h.map((x) => x.toFixed(2)).join(" ")} m, tilt ${flat.tilt.toFixed(2)}°`);
      console.log(`  ${v} Fuji:   legs ${hill.h.map((x) => x.toFixed(2)).join(" ")} m, tilt ${hill.tilt.toFixed(2)}°`);
      expect(flat.h.length).toBeGreaterThanOrEqual(3);
      const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
      expect(spread(flat.h)).toBeLessThan(0.15);
      expect(spread(hill.h)).toBeLessThan(0.6);
      // (on the hill as on the runway: the gear at the same height over the ground)
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      expect(Math.abs(mean(hill.h) - mean(flat.h))).toBeLessThan(0.4);
      expect(hill.tilt).toBeGreaterThan(2);
      for (const r of [flat, hill]) {
        expect(r.label).toBe("LANDED");
        expect(r.gs).toBeLessThan(0.05);
      }
    }, 120_000);
});
