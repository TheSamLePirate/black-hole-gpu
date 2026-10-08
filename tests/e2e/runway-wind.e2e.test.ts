import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-METEO W4: a runway landed into the wind. Edwards's runway 22, the wind from 040° at 5 m/s (a report's —
// W7's "real" weather, its direction fixed): blowing down it, the entry autopilot's glide from 80 km out
// takes its far end, runway 04 — the HUD's runway box says so with the wind along and across it —, and lands
// there as on the published one (the landing e2e's figures). Stepped at fixed steps, as that e2e.

describe.skipIf(!E2E)("a runway landed into the wind", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Edwards, the wind from 040°: runway 04, a head wind, landed on its axis", async () => {
    const r = await app.js<{
      far: boolean;
      rwy: number | null;
      head: number | null;
      mls: { az: number; el: number | null; azIn: boolean; elIn: boolean; dmeKm: number } | null;
      landed: boolean;
      fail: string | null;
      across: number;
      stop: number | null;
      along: number | null;
      log: string[];
      dhc: { across: number; dh: number; ga: boolean } | null;
    }>(`(() => {
      const w = { source: "metar", kind: "windy", wind: { u10: 5, from: 40, gust: 0, turb: 1, shear: 0 }, visibility: 30000,
        fogTop: 0, layers: [], rain: 0, dust: 0 };
      __bh.freeze(true);
      __bh.settings.weather = "real"; __bh.camera.weatherReal = w; __bh.renderer.weatherReal = w;
      __bh.game.glideTo("Edwards");
      const c = __bh.camera; let across = 0, rwy = null, head = null, mls = null, dhc = null;
      for (let i = 0; i < 30 * 170; i++) {
        __bh.step(1 / 30);
        const R = c.entryRun, A = R?.app; if (A && A.along > -500) across = Math.max(across, Math.abs(A.across));
        if (rwy === null && A?.final) { c.runwayCache = null; const v = c.runwayView(); rwy = v?.rwy ?? null; head = v?.wind?.head ?? null; }
        // (the guidance 6 km out, on the final: the far end's stations — A4)
        if (mls === null && A?.final && A.along > -6000) { c.runwayCache = null; mls = c.runwayView()?.mls ?? null; }
        // (the decision at the minima — A5)
        if (!dhc && R?.dhCheck) dhc = { ...R.dhCheck };
        if (c.ourLanded || c.airFlight.failure) break;
      }
      __bh.freeze(false);
      c.runwayCache = null;
      const v = c.runwayView();
      return { far: !!c.entrySite?.reverse, rwy, head, mls, landed: !!c.ourLanded, fail: c.airFlight.failure, across,
        stop: v?.across ?? null, along: v?.along ?? null, dhc,
        log: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text) };
    })()`);
    // (the far end: runway 04 — 220 + 180, to the meridians' turn —, the wind on its nose)
    expect(r.far).toBe(true);
    expect(Math.abs((r.rwy ?? 0) - 40)).toBeLessThan(0.1);
    expect(r.head).toBeGreaterThan(4.5);
    // (the guidance of runway 04 — its own stations —: in coverage, on the axis and the profile, 6 km out)
    expect(r.mls?.azIn && r.mls?.elIn).toBe(true);
    expect(Math.abs(r.mls!.az)).toBeLessThan(0.5);
    expect(Math.abs(r.mls!.el!)).toBeLessThan(1);
    expect(r.mls!.dmeKm).toBeGreaterThan(5);
    // (stabilised at the minima: on, no go-around — A5)
    expect(r.dhc?.ga).toBe(false);
    // (landed there as on the published end: under 2 m/s down, on the axis, stopped on the runway)
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    const td = r.log.find((l) => l.startsWith("Touchdown"));
    expect(td).toBeDefined();
    expect(Number(td!.match(/· ([-\d.]+) m\/s down/)![1])).toBeLessThan(2);
    expect(r.across).toBeLessThan(60);
    expect(Math.abs(r.stop ?? Infinity)).toBeLessThan(10);
    expect(r.along).toBeGreaterThan(0);
    expect(r.along).toBeLessThan(4500);
  }, 150_000);
});
