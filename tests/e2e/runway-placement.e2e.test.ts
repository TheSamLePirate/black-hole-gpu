import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A craft lined up on a runway (the game's lineUp — the place panel's, the flight hub's, a challenge's start):
// on the drawn runway's axis (WGS84), its nose down it to a tenth of a degree, level on its gear, at rest — on
// every runway of the Earth, the F-35 and the Ranger; whatever the view (the chase view's look once tilted it
// 5–7° nose up).

describe.skipIf(!E2E)("lined up on a runway", () => {
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

  for (const v of ["f35", "ranger"])
    test(`the ${v}: on the axis, down it, level, still — every runway`, async () => {
      const rows: string[] = [];
      for (const site of ["Edwards", "Kennedy", "Bourget", "Woomera", "Tanegashima", "Kourou", "Baikonur"]) {
        for (const mount of ["chase", "cockpit"]) {
          const r = await app.js<{ dh: number; off: number; pitch: number; bank: number; gs: number; label: string }>(`(() => {
            __bh.freeze(true); __bh.settings.vessel = ${JSON.stringify(v)}; __bh.settings.shipMount = ${JSON.stringify(mount)};
            for (let i = 0; i < 3; i++) __bh.step(1 / 30);
            __bh.game.lineUp(${JSON.stringify(site)});
            for (let i = 0; i < 90; i++) __bh.step(1 / 30);
            const F = __bh.fleet, t = __bh.sim.time, p = F.pose(F.active, t), mR = 1476.625 * __bh.settings.massSolar;
            const bf = (X) => __bh.sys.bodyFixed("earth", X, t).map((x) => x * mR);
            const q = bf(p.X);
            const nose = bf(p.X.map((x, i) => x + p.ax[2][i] * 1e-9)).map((x, i) => x - q[i]);
            const top = bf(p.X.map((x, i) => x + p.ax[1][i] * 1e-9)).map((x, i) => x - q[i]);
            const R = __bh.sys.runways().find((r) => r.site.name.includes(${JSON.stringify(site)}));
            const d = q.map((x, i) => x - R.origin[i]);
            const off = d[0] * R.across[0] + d[1] * R.across[1] + d[2] * R.across[2];
            const ln = Math.hypot(...nose), lt = Math.hypot(...top);
            const na = (nose[0] * R.along[0] + nose[1] * R.along[1] + nose[2] * R.along[2]) / ln;
            const nc = (nose[0] * R.across[0] + nose[1] * R.across[1] + nose[2] * R.across[2]) / ln;
            const up = R.p;
            const g = __bh.camera.geoNow();
            return { dh: Math.atan2(nc, Math.abs(na)) * 180 / Math.PI, off,
              pitch: Math.asin((nose[0] * up[0] + nose[1] * up[1] + nose[2] * up[2]) / ln) * 180 / Math.PI,
              bank: Math.acos(Math.min(1, (top[0] * up[0] + top[1] * up[1] + top[2] * up[2]) / lt)) * 180 / Math.PI,
              gs: g.gs, label: __bh.game.status().label };
          })()`);
          rows.push(
            `${site}/${mount}: Δhdg ${r.dh.toFixed(3)}° off ${r.off.toFixed(1)} m pitch ${r.pitch.toFixed(2)}° tilt ${r.bank.toFixed(2)}° ${r.label}`,
          );
          expect(Math.abs(r.dh)).toBeLessThan(0.1);
          expect(Math.abs(r.off)).toBeLessThan(1);
          expect(Math.abs(r.pitch)).toBeLessThan(0.6);
          expect(r.bank).toBeLessThan(0.6);
          expect(r.gs).toBeLessThan(0.05);
          expect(r.label).toBe("LANDED");
        }
      }
      console.log(rows.map((l) => `  ${l}`).join("\n"));
    }, 300_000);
});
