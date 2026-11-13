import { expect, test } from "bun:test";
import { Governor } from "../src/game/governor";
import { defaultSettings } from "../src/settings";

// The resolution governor out of main() (src/game/governor.ts; audit AR-12, wave 4.8): the scale a resize makes the targets at, a
// forced scale and its release, the raster's own scale held and moving, the GPU's time averaged per finished frame.

const make = (o: { raster?: boolean; dyn?: boolean } = {}) => {
  const s = defaultSettings();
  s.quality = o.dyn ? "game" : "high";
  s.earthRasterScale = 0.75;
  let resizes = 0;
  const renderer = { rasterPrimaryNow: !!o.raster, rasterHold: false, completedFrames: 0, lastFrameDense: false, lastGpuMs: 0 };
  const g = new Governor({
    renderer: renderer as never,
    settings: s,
    canvas: { clientWidth: 1280, clientHeight: 800 } as never,
    resize: () => resizes++,
    toast: () => {},
    benching: () => false,
  });
  return { g, s, renderer, resizes: () => resizes };
};

test("a forced scale first; released, the canvas's again", () => {
  const { g, resizes } = make();
  g.force(0.6);
  expect(g.scaleForResize()).toBe(0.6);
  g.force(3);
  expect(g.forcedScale).toBe(1);
  g.force(null);
  expect(g.renderScale).toBe(1);
  expect(resizes()).toBe(3);
});

test("the raster's own scale without dynamic resolution: the full one held, its ceiling in motion", () => {
  const { g } = make({ raster: true });
  g.heldFor = 1;
  expect(g.rasterScale()).toBe(1);
  g.heldFor = 0;
  g.movingFor = 0.2;
  expect(g.rasterScale()).toBe(0.75);
  expect(g.scaleForResize()).toBe(0.75);
  // (a forced scale takes over the raster's)
  g.forcedScale = 0.5;
  expect(g.rasterScale()).toBeNull();
});

test("the GPU's time averaged once per finished frame, not a dense one", () => {
  const { g, renderer } = make();
  renderer.completedFrames = 1;
  renderer.lastGpuMs = 10;
  g.measure();
  g.measure();
  expect(g.gpuEma).toBe(10);
  renderer.completedFrames = 2;
  renderer.lastGpuMs = 20;
  g.measure();
  expect(g.gpuEma).toBeCloseTo(11, 9);
  renderer.completedFrames = 3;
  renderer.lastFrameDense = true;
  renderer.lastGpuMs = 100;
  g.measure();
  expect(g.gpuEma).toBeCloseTo(11, 9);
});
