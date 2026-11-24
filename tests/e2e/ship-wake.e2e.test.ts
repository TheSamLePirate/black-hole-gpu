import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// (25 Nov 2026) A big ship's wake as the sea draws it (trace.wgsl seaWake → kelvinSlope): the Gerald R. Ford at 28 kt and its escorts in
// the Alboran Sea (no IGN tile: run anywhere), mid-morning, a light breeze (wind 1); our F-35B (never damaged) set on its deck, the camera « around » it high
// astern, looking down the wake — then lower, abeam. Before 25 Nov the Kelvin waves were a target of regular concentric rings (their
// heights ∝ the hull's length, unbroken); now the V's arms on the cusps (~19.5°), the transverse waves between them smoothed over the
// turbulent wake, their crests broken by the sea's noise. Shots for the eye, and the wakes' GPU cost in each view (with and without
// them in turn — renderer.seaWakes held empty —, three times, 60 images each: the p50s' medians).
// Then the slow boat's pattern — the campaign's « concentric rings » (a fishing boat at 2 m/s): the Ford's wake given to the renderer as
// a 20 m hull's at 2 m/s on its course, its bow 190 m aft of the Ford's middle (clear of its hull), seen from astern.
// Steps: 1 boot · 2 the Ford at sea, the craft on its deck · 3 astern, high · 4 abeam, low · 5 a slow boat's pattern.
// Duration: ~3 min (boot and tiles ~1 min).
// Done when: the three views shot, the two big-ship views' wakes' cost measured, the wakes given to the renderer, no page error.

const OUT = process.env.WAKE_OUT ?? "remote-results/ship-wake";
const SEA = { lat: 36.0, lon: -4.0 };

describe.skipIf(!E2E)("a big ship's wake: Kelvin's V, broken crests, the turbulent lane", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps(["the Ford at sea, the craft on its deck", "astern, high", "abeam, low", "a slow boat's pattern"]);
    // (the F-35B, never damaged — a craft lost pauses the world: E2E-VOLS)
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", damage: false, crashSpeed: 1e9, autosave: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    stopServer();
  });

  const view = async (name: string, yaw: number, pitch: number, dist: number) => {
    await app.js(`(async () => { __bh.freeze(false); __bh.settings.shipMount = "around"; __bh.refresh();
      const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 20; i++) { __bh.touch(); await f(); }
      Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} });
      for (let i = 0; i < 90; i++) { __bh.touch(); await f(); }
      return 1; })()`);
    console.log(`  ${name}: the view ${JSON.stringify(await app.js(`({ ...__bh.camera.outside })`))}`);
    await app.settled(60_000);
    const cost = await app.js<{ on: number; off: number; wakes: number }>(`(async () => {
      const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
      const p50 = async () => { const ms = []; for (let i = 0; i < 60; i++) { __bh.touch(); await f(); if (R.lastGpuMs > 0) ms.push(R.lastGpuMs); }
        ms.sort((a, b) => a - b); return ms[Math.floor(ms.length / 2)] ?? 0; };
      const wakes = R.seaWakes.length; const on = [], off = [];
      for (let k = 0; k < 3; k++) {
        on.push(await p50());
        Object.defineProperty(R, "seaWakes", { get: () => [], set: () => {}, configurable: true });
        for (let i = 0; i < 10; i++) await f();
        off.push(await p50());
        Object.defineProperty(R, "seaWakes", { value: [], writable: true, configurable: true, enumerable: true });
        for (let i = 0; i < 10; i++) await f();
      }
      const med = (v) => +[...v].sort((a, b) => a - b)[1].toFixed(2);
      return { on: med(on), off: med(off), wakes }; })()`);
    await app.shot(`${OUT}/${name}.png`);
    console.log(
      `  ${name}: GPU p50 ${cost.on} ms with ${cost.wakes} wakes, ${cost.off} ms without (Δ ${(cost.on - cost.off).toFixed(2)} ms)`,
    );
    return cost;
  };

  test("the Ford's wake seen astern and abeam; its cost", async () => {
    await app.step("the Ford at sea, the craft on its deck");
    await app.js(`(() => { __bh.game.setDate("2026-07-10T09:30:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, traffic: false });
      __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 250, 140);
      // (held level at 300 m while the scene loads — E2E-VOLS rule 13: never a glide at idle —, then set down on the deck)
      const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await app.settled(120_000);
    const said = await app.js<string>(`__bh.camera.carrierSpawn("ford")`);
    console.log(`  ${said}`);
    expect(said).toContain("Gerald R. Ford");
    await app.waitFor(`__bh.camera.carrierLand("ford", { x: 10, z: -40, facing: -10 }).startsWith("On")`, 30_000);
    await app.dataSettled("the Alboran Sea", { maxMs: 60_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
    const wakes = await app.js<{ len: number; U: number; beam: number }[]>(
      `__bh.renderer.seaWakes.slice(0, 4).map((w) => ({ len: w.len, U: +w.U.toFixed(1), beam: w.beam }))`,
    );
    console.log(`  the wakes given: ${JSON.stringify(wakes)}`);
    await app.stepDone(`Ford à la mer, ${wakes.length} sillages`, wakes.length > 0);
    expect(wakes.some((w) => w.len > 300 && w.U > 10)).toBe(true);

    await app.step("astern, high");
    const a = await view("astern-high", 0, 28, 520);
    await app.stepDone(`arrière, haut : GPU ${a.on} ms avec, ${a.off} sans`);

    await app.step("abeam, low");
    const b = await view("abeam-low", 120, 9, 380);
    await app.stepDone(`travers, bas : GPU ${b.on} ms avec, ${b.off} sans`);

    await app.step("a slow boat's pattern");
    await app.js(`(() => { const R = __bh.renderer; let last = R.seaWakes;
      Object.defineProperty(R, "seaWakes", { configurable: true, set: (v) => { last = v; },
        get: () => last.filter((w) => w.len > 300).map((w) => ({ ...w, p: w.p.map((v, i) => v - w.fwd[i] * 200), U: 2, len: 20, beam: 6 })) });
      return 1; })()`);
    await app.js(`(async () => { __bh.freeze(false); __bh.settings.shipMount = "around"; __bh.refresh();
      const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 20; i++) { __bh.touch(); await f(); }
      Object.assign(__bh.camera.outside, { yaw: 0, pitch: 9, dist: 420 }); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`);
    await app.settled(60_000);
    await app.shot(`${OUT}/slow-boat-pattern.png`);
    await app.js(
      `(() => { Object.defineProperty(__bh.renderer, "seaWakes", { value: [], writable: true, configurable: true, enumerable: true }); return 1; })()`,
    );
    await app.stepDone("motif d'un bateau lent (20 m, 2 m/s) à l'arrière");
    expect(app.cdp.errors).toEqual([]);
  }, 400_000);
});
