import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The free camera without a craft (ship: false — viewAt's photograph view) held on the Earth: placed over Toulon at 350 m, the world
// running 60 s, then the clock jumped an hour on (game.setDate) and back — it stays over Toulon, at its height. Found by PLAN-J8's
// junction e2e (16 Nov 2026): the camera left in space — « away from the Earth », the image black (PROBLEMES). Asserted at each step
// (geoNow, game.status are the craft's): the scenery not « away from the Earth », the image's middle on a surface within 10 km.
// Duration: ~3 min on kerr-mini.
// Done when: the hour jumped and back, the camera held at each step.
afterAll(stopServer);
const AT = { lat: 43.124, lon: 5.958, altM: 350 };
test.skipIf(!E2E)(
  "the free camera without a craft held over Toulon while the world runs and across a jump of the clock",
  async () => {
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, earthPipeline: "raster" }); __bh.renderer.debugSkipShip = true;
      __bh.game.setDate("2026-07-10T13:30:00Z"); return 1; })()`);
      const why = await app.js<string | null>(
        `__bh.viewAt(${AT.lat}, ${AT.lon}, { altM: ${AT.altM}, heading: 270, pitch: -6, fov: 50 }) ?? null`,
      );
      expect(why).toBeNull();
      // (what tells the camera's place without a craft — geoNow and game.status are the craft's —: the scenery's status, made round
      // the camera (« away-from-earth » off it) and its centre; the image's middle below the horizon, its surface and distance)
      const where = () =>
        app.js<{ scene: string; lat: number | null; lon: number | null; kind: string; d: number }>(`(async () => {
        const R = __bh.renderer, sc = R.earthScenery.stats(), s = await R.surfaceAt(0.5, 0.65);
        return { scene: sc.status, lat: sc.lat, lon: sc.lon, kind: s?.kind ?? "none", d: Math.round(s?.nearest ?? -1) }; })()`);
      const check = async (label: string) => {
        const p = await where();
        const km =
          p.lat === null || p.lon === null
            ? null
            : Math.hypot((p.lat - AT.lat) * 111.32, (p.lon - AT.lon) * 111.32 * Math.cos((AT.lat * Math.PI) / 180));
        console.log(`  ${label}: ${JSON.stringify(p)} — the scene's centre ${km === null ? "none" : `${km.toFixed(1)} km`} off`);
        expect(p.scene).not.toBe("away-from-earth");
        expect(p.kind).not.toBe("none");
        expect(p.d).toBeGreaterThan(0);
        expect(p.d).toBeLessThan(10000);
      };
      await app.scenario("placée, le monde gelé");
      await app.js(`(() => { __bh.freeze(true); __bh.touch(); return 1; })()`);
      // (the place's data and its scene in, frozen — rule 13's way)
      await app.dataSettled("Toulon", { maxMs: 120_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
      await app.waitProgress(
        `(() => { const sc = __bh.renderer.earthScenery.stats(); __bh.touch(); return sc.status === "ready"; })()`,
        "the scene round the camera",
        { stallMs: 60_000, maxMs: 120_000 },
      );
      await app.settled(60_000);
      await check("placed, frozen");
      await app.scenario("le monde qui tourne, 60 s");
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      for (let s = 1; s <= 6; s++) {
        await app.js(
          `(async () => { const t0 = performance.now(); while (performance.now() - t0 < 10000) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`,
        );
        await check(`running ${s * 10} s`);
      }
      await app.scenario("l'heure sautée d'une heure, puis remise");
      await app.js(`(() => { __bh.game.setDate("2026-07-10T14:30:00Z"); return 1; })()`);
      await app.js(`(async () => { for (let i = 0; i < 20; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      await check("an hour on");
      await app.js(`(() => { __bh.game.setDate("2026-07-10T13:30:00Z"); return 1; })()`);
      await app.js(`(async () => { for (let i = 0; i < 20; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      await check("the hour back");
      // (the junction e2e's own sequence: the clock set while frozen, then the world let go)
      await app.scenario("l'heure remise monde gelé, puis le monde relâché");
      await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("2026-07-10T14:00:00Z"); __bh.touch(); return 1; })()`);
      await app.js(`(async () => { for (let i = 0; i < 20; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      await check("set while frozen");
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      for (let s = 1; s <= 3; s++) {
        await app.js(
          `(async () => { const t0 = performance.now(); while (performance.now() - t0 < 10000) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`,
        );
        await check(`let go ${s * 10} s`);
      }
      await app.js(`(() => { __bh.freeze(true); return 1; })()`);
      const why2 = await app.js<string | null>(
        `__bh.viewAt(${AT.lat}, ${AT.lon}, { altM: ${AT.altM}, heading: 270, pitch: -6, fov: 50 }) ?? null`,
      );
      expect(why2).toBeNull();
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      for (let s = 1; s <= 3; s++) {
        await app.js(
          `(async () => { const t0 = performance.now(); while (performance.now() - t0 < 10000) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`,
        );
        await check(`placed again frozen, let go ${s * 10} s`);
      }
    } finally {
      app.close();
    }
  },
  600_000,
);
