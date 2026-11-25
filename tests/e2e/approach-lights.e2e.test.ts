import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { at, W28L } from "./lib/sfo-traffic";

// The approach lights' structures (src/world/approach-lights.ts, controller/approach-lights.ts — 25 Nov 2026): at San Francisco, the
// free camera 25 m over the bay beside the approach of 28L, looking along it toward the field — the end's pylons, bars and lamp heads
// standing in the water out to 900 m (its ILS in the approaches' data: world/approaches.ts ilsAt), drawn by the craft's pass as an
// instance (`als:KSFO 10R#1` in ship.lastDraws). By day the steel; at night (22:00 PST) the runway's approach lights lit over it
// (trace.wgsl runwayLights — the flashers' run).
// Steps: 1 boot · 2 the bay beside 28L's approach · 3 by day · 4 at night.
// Shots: AL_OUT (remote-results/approach-lights): day.png, day-close.png, night.png, night-close.png (close: 110 m beside the lights).
// Earth data: the e2e disk cache (SFO: USGS/NAIP, no IGN).
// Duration: ~2.5 min (boot and SFO's tiles ~1.5 min).
// Done when: 28L's end found with an ILS, its structures drawn (≥ 1 500 triangles), by day and at night, no GPU error.

const OUT = process.env.AL_OUT ?? "remote-results/approach-lights";

describe.skipIf(!E2E)("the approach lights' structures at SFO's 28L", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    app.steps(["boot", "the bay beside 28L's approach", "by day", "at night"]);
    app.estimate(150);
    await app.step("boot");
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, autosave: false }); return 1; })()`);
    await app.js(`__bh.game.setDate("2026-11-24T20:30:00Z")`);
    await app.stepDone("booted");
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const drawn = () =>
    app.js<{ id: string; tris: number; d: number }[]>(
      `(__bh.renderer.ship.lastDraws ?? []).filter((x) => x.id.startsWith("als:")).map((x) => ({ id: x.id, tris: x.tris, d: x.d }))`,
    );

  test("28L's approach-light structures drawn in the bay, by day and at night", async () => {
    await app.step("the bay beside 28L's approach");
    await app.js(`(() => { __bh.settings.ship = false; __bh.refresh(); return 1; })()`);
    await app.waitFor("!__bh.camera.piloting && !__bh.camera.spectating", 20_000);
    // (600 m out on 28L's approach, 140 m to its right, 25 m over the sea — the geoid's −32 m under the ellipsoid there —, looking
    // back along the lights toward the runway)
    const P = at(W28L, -600, 140);
    const N = await app.js<number>(`__bh.sys.geoid(${P.lat}, ${P.lon})`);
    expect(
      await app.js<string | null>(
        `(() => __bh.viewAt(${P.lat}, ${P.lon}, { altM: ${N + 25}, heading: ${W28L.hdg - 25}, pitch: -9, fov: 55 }) ?? null)()`,
      ),
    ).toBeNull();
    await app.waitFor(`__bh.sys.runways().filter((r) => r.world?.field === "KSFO").length >= 4`, 45_000);
    await app.dataSettled("SFO's relief and imagery", { maxMs: 90_000 });
    const t0 = Date.now();
    let als = await drawn();
    while (!als.some((x) => x.id.includes("#1") && x.id.includes("10R")) && Date.now() - t0 < 30_000) {
      await app.progress(`structures · ${((Date.now() - t0) / 1000).toFixed(0)} / 30 s`);
      await app.js(`(() => { __bh.touch(); return 1; })()`);
      await Bun.sleep(1000);
      als = await drawn();
    }
    console.log(`  drawn: ${JSON.stringify(als)}`);
    const e28 = als.find((x) => x.id === "als:KSFO 10R#1");
    expect(e28, `28L's structures (als:KSFO 10R#1) among ${JSON.stringify(als)}`).toBeDefined();
    expect(e28!.tris).toBeGreaterThan(1500);
    await app.stepDone(`${als.length} extrémités · 28L ${e28!.tris} triangles à ${e28!.d} m`);

    // (and close: 450 m out, 110 m to the right of the axis, 10 m over the sea, looking across at the lights — their bars 60 px wide)
    const C = at(W28L, -450, 110);
    const close = `__bh.viewAt(${C.lat}, ${C.lon}, { altM: ${N + 10}, heading: ${W28L.hdg - 70}, pitch: -2, fov: 40 })`;
    const far = `__bh.viewAt(${P.lat}, ${P.lon}, { altM: ${N + 25}, heading: ${W28L.hdg - 25}, pitch: -9, fov: 55 })`;
    const both = async (when: string) => {
      for (const [name, js] of [
        ["", far],
        ["-close", close],
      ] as const) {
        await app.js(`(() => { ${js}; __bh.touch(); return 1; })()`);
        await app.settled(60_000);
        await Bun.sleep(2500);
        await app.shot(`${OUT}/${when}${name}.png`);
      }
    };
    await app.step("by day");
    await both("day");
    await app.stepDone("jour");

    await app.step("at night");
    await app.js(`__bh.game.setDate("2026-11-25T06:00:00Z")`);
    await both("night");
    expect((await drawn()).some((x) => x.id === "als:KSFO 10R#1")).toBe(true);
    expect(app.cdp.errors).toEqual([]);
    await app.stepDone("nuit");
  }, 300_000);
});
