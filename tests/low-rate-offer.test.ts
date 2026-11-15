import { afterEach, expect, test } from "bun:test";
import { Governor } from "../src/game/governor";
import { LOW_RATE_FLOOR, LOW_RATE_HOLD_S, lighterSettings, RASTER_SCALES } from "../src/quality-policy";
import { defaultSettings } from "../src/settings";
import { type ChoiceDef, SCHEMA_BY_KEY } from "../src/ui/schema";

// The playable floor (Sam's decision, 15 Nov 2026 — the raster's fallback to the traced pipeline retired, (b)): under 15 images a second
// held 12 s in flight on the raster, the governor asks main.ts to propose lighter settings — proposed, not imposed. The steps proposed;
// the watch's positive witness (10 images a second: proposed once, at 12 s) and its negative ones (30 a second, the page hidden, a bench,
// the camera held, the traced pipeline: never).

const realNow = performance.now.bind(performance);
afterEach(() => {
  performance.now = realNow;
});

test("one step lighter: the raster's scale the settings' next one down, the scenery balanced, the reach one step nearer", () => {
  const s = defaultSettings();
  expect(lighterSettings(s)).toEqual({ earthRasterScale: 0.667, earthScenery: "balanced", detailReach: "far" });
  expect(lighterSettings({ earthRasterScale: 1, earthScenery: "balanced", detailReach: "far" })).toEqual({
    earthRasterScale: 0.833,
    detailReach: "normal",
  });
  // (at the lightest of each: nothing left to propose)
  expect(lighterSettings({ earthRasterScale: 0.667, earthScenery: "off", detailReach: "normal" })).toEqual({});
  // (the scales the settings offer, the same list)
  const opts = (SCHEMA_BY_KEY.get("earthRasterScale") as ChoiceDef).options.map((o) => Number(o.value));
  expect([...RASTER_SCALES] as number[]).toEqual(opts);
});

/** the governor ticked every 1.5 s of a fake clock, `fps` images finished a second; what it proposed */
function fly(o: { fps: number; seconds: number; raster?: boolean; hidden?: boolean; bench?: boolean; held?: boolean }) {
  let clock = 1000;
  performance.now = () => clock;
  const s = defaultSettings();
  s.quality = "high";
  const renderer = {
    rasterPrimaryNow: o.raster ?? true,
    rasterHold: false,
    completedFrames: 0,
    lastFrameDense: false,
    lastGpuMs: 1000 / o.fps,
    calibrationReady: true,
    terrainRasterInspecting: false,
    realtimeBlockNow: 1,
    offlineActive: false,
    rasterLiteActive: true,
    rasterRateCoarsest: false,
    tier: { level: 3, capMpx: 4 },
    frameBudget: () => 16,
    effectiveQuality: () => ({ capped: false }),
    resetQualityTiming: () => {},
    setTier: () => {},
  };
  const offers: number[] = [];
  const g = new Governor({
    renderer: renderer as never,
    settings: s,
    canvas: { clientWidth: 1280, clientHeight: 800 } as never,
    resize: () => {},
    benching: () => !!o.bench,
    hidden: () => !!o.hidden,
    offerLighter: (rate) => offers.push(rate),
  });
  const firstAt: number[] = [];
  for (let t = 0; t < o.seconds; t += 1.6) {
    clock += 1600;
    renderer.completedFrames += Math.round(1.6 * o.fps);
    g.tick(1.6, o.held ? "converged" : "realtime");
    if (offers.length && !firstAt.length) firstAt.push(t + 1.6);
  }
  return { offers, firstAt: firstAt[0] ?? null, g };
}

test("10 images a second in flight on the raster: proposed once, after 12 s; answered yes and still slow, proposed again", () => {
  const r = fly({ fps: 10, seconds: 30 });
  expect(r.offers.length).toBe(1);
  expect(r.offers[0]!).toBeCloseTo(10, 0);
  expect(r.firstAt!).toBeGreaterThanOrEqual(LOW_RATE_HOLD_S);
  expect(r.firstAt!).toBeLessThan(LOW_RATE_HOLD_S + 4);
  // (a yes: main.ts lets the governor propose the next step if still under the floor)
  r.g.lowRateOffered = false;
  expect(LOW_RATE_FLOOR).toBe(15);
});

test("never proposed: 30 images a second, the page hidden, a bench, the camera held, the traced pipeline", () => {
  expect(fly({ fps: 30, seconds: 40 }).offers).toEqual([]);
  expect(fly({ fps: 16, seconds: 40 }).offers).toEqual([]);
  expect(fly({ fps: 10, seconds: 40, hidden: true }).offers).toEqual([]);
  expect(fly({ fps: 10, seconds: 40, bench: true }).offers).toEqual([]);
  expect(fly({ fps: 10, seconds: 40, held: true }).offers).toEqual([]);
  expect(fly({ fps: 10, seconds: 40, raster: false }).offers).toEqual([]);
});
