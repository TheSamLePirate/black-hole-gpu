import { afterAll, beforeAll, describe, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { showView, widestRoad } from "./lib/bridge-views";

// (a probe — no assertion but its data —, 25 Nov 2026; PROBLEMES « Ponts et routes, campagne e2e 2 ») bridges' Paris street (the widest
// road near rue de Rivoli, 2.5 m over it, dry, 14 h): the image, the raster material's shadow debug view (liteSkip 8192: red the trees'
// and buildings' map's sun visibility, green the relief's) — where the thin light lines across the shaded street come from —, the
// scene's pavements widened to the façades (stats().pavementsWidened), and a cross-section of the contact ground across the street
// from its axis to 25 m each side (sys.groundAt): the relief against the façades.
// Duration: ~2 min on kerr-mini.
// Done when: the shots and the cross-section written.

const OUT = process.env.PSP_OUT ?? "remote-results/paris-street-shadows";
const AT: [number, number] = [48.8628, 2.3365];

describe.skipIf(!E2E)("probe: a Paris street's shadows and pavements", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the street: its image, its shadows' debug view, its cross-section", async () => {
    const v = { key: "paris-street", at: AT, aglM: 60, look: [48.8638, 2.333] as [number, number], holds: "sc.cellRoads > 0" };
    await showView(app, v);
    const road = await widestRoad(app, AT, 120, 115);
    console.log(`  road: ${JSON.stringify(road)}`);
    if (!road) throw new Error("no road");
    const lenM = Math.hypot((road.b[0] - road.a[0]) * 111132, (road.b[1] - road.a[1]) * 111320 * Math.cos((road.a[0] * Math.PI) / 180));
    const k = 70 / Math.max(lenM, 1);
    const ahead: [number, number] = [road.a[0] + (road.b[0] - road.a[0]) * k, road.a[1] + (road.b[1] - road.a[1]) * k];
    await showView(app, { ...v, at: road.a, aglM: 2.5, look: ahead, lookAglM: 0 });
    await app.settled(60_000);
    const frames = `for (let i = 0; i < 90; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }`;
    await app.shot(`${OUT}/street.png`);
    const base = await app.js<number>(`__bh.renderer.liteSkip`);
    await app.js(`(async () => { __bh.renderer.liteSkip = ${base} | 8192; ${frames} return 1; })()`);
    await app.shot(`${OUT}/street-shadow-debug.png`);
    await app.js(`(async () => { __bh.renderer.liteSkip = ${base}; ${frames} return 1; })()`);
    // (the cross-section: from the axis at 10 m along the road, perpendicular, each side)
    const section = await app.js(`(() => {
      const D = Math.PI / 180, a = ${JSON.stringify(road.a)}, b = ${JSON.stringify(road.b)};
      const kx = 111320 * Math.cos(a[0] * D), ky = 111132;
      const e = (b[1] - a[1]) * kx, n = (b[0] - a[0]) * ky, L = Math.hypot(e, n), ue = e / L, un = n / L;
      const out = [];
      for (let s = -25; s <= 25; s += 0.5) {
        const pe = ue * 10 + un * s, pn = un * 10 - ue * s;
        const lat = a[0] + pn / ky, lon = a[1] + pe / kx;
        out.push([s, +__bh.sys.groundAt(lat, lon).toFixed(2)]);
      }
      return out; })()`);
    console.log(`  cross-section [offset m (+ right of the way), ground m]: ${JSON.stringify(section)}`);
    // (a column of the image by the white car, bottom right — the smeared columns: what the visibility drew down it, its distances —
    // equal ones a face standing up)
    const column = await app.js(`(async () => { const out = []; for (let k = 0; k < 20; k++) { const y = 0.72 + k * 0.01;
      const s = await __bh.renderer.surfaceAt(0.93, y); out.push([+y.toFixed(2), s?.kind ?? "null", s ? +s.ground.toFixed(2) : -1, s?.level ?? -9]); }
      return out; })()`);
    console.log(`  the column at x 0.93 [y, kind, distance m, level]: ${JSON.stringify(column)}`);
    console.log(
      `  surfaces near: ${JSON.stringify(await app.js(`(() => { const s = __bh.renderer.earthScenery.stats(); return { cellRoads: s.cellRoads, pavementsWidened: s.pavementsWidened, furniture: s.furniture, buildings: s.buildings }; })()`))}`,
    );
  }, 400_000);
});
