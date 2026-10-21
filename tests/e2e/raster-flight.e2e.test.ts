// The raster's primary visibility in flight (docs/PLAN-RENDU-RASTER-AAA.md étape 1): the F-35 from its cockpit over the
// live relief, its imagery, the regional surface, the scenery and the clouds — the game as it is played. At each place
// the craft is flown until the ground is in, then the clock is stopped and the same view drawn with the near Earth traced
// at ×6, at ×4, then shaded by the raster (`earthPipeline: "raster"`, the sky at ×4), the view touched every frame (fresh
// rays, no history: a fast turn's worst); each mode's GPU passes and image, against the same view converged.
// PLACES=tarifa-low,tarifa,alps (default all); FRAMES: frames flown a mode (90); MODES=trace6,trace4,rasterwalk,raster,rasterhalf,rasterquarter (rasterwalk: the raster without the trees' instances; half, quarter:
// its shading rate); RF_DETAIL (below).
// Captures remote-results/rf-<place>-<mode>[-ref].png; measures remote-results/raster-flight.json. RF_NOREF=1: no converged
// reference (a timing run: no PSNR).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

const PLACES: Record<string, string> = {
  "tarifa-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  tarifa: `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(36.1, -5.55, 900, 200, 210);`,
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  // (the weather's clouds — docs/PLAN-NUAGES-AAA.md N0 —: cumulus over the craft, the same deck seen from above, an overcast
  // over the Alps, a storm)
  "tarifa-cumulus": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  "cumulus-above": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 3400, 20, 240);`,
  "alps-overcast": `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "overcast"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  storm: `__bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 900, 20, 220);`,
  // (a low Sun: the relief's long shadows — the shadow map's and the march's)
  "alps-evening": `__bh.game.setDate("2026-07-10T17:45:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  // (the sea — N6 —: low over the Atlantic off Tarifa into the evening Sun's glint, the coast's shallows by day, the strait
  // under a strong wind, the same under an overcast)
  "sea-glint": `__bh.game.setDate("2026-07-10T18:40:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(36.0, -5.75, 300, 285, 220);`,
  "sea-coast": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(36.06, -5.74, 250, 115, 200);`,
  "sea-windy": `__bh.game.setDate("2026-07-10T12:00:00Z"); __bh.game.set("weather", "windy"); __bh.game.set("earthClouds", 0.2);
    __bh.game.flyAt(35.99, -5.52, 300, 190, 220);`,
  "sea-overcast": `__bh.game.setDate("2026-07-10T12:00:00Z"); __bh.game.set("weather", "overcast"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(35.99, -5.52, 300, 190, 220);`,
  // (showcases: relief, the sea, a few clouds, the Sun — the strait at dawn into the Sun's glint, Jebel Musa ahead, the Rock
  // on the left; the Gulf of Porto's 2000 m ridges falling into the sea in the evening Sun; Jebel Musa from Spain at dusk)
  "show-strait": `__bh.game.setDate("2026-07-10T06:15:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.35);
    __bh.game.flyAt(35.95, -5.66, 450, 95, 220);`,
  "show-corsica": `__bh.game.setDate("2026-07-10T17:20:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(42.24, 8.50, 400, 65, 220);`,
  "show-musa": `__bh.game.setDate("2026-07-10T18:30:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(36.04, -5.52, 450, 165, 220);`,
  "show-porto": `__bh.game.setDate("2026-07-10T17:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 0.3);
    __bh.game.flyAt(42.26, 8.58, 500, 80, 220);`,
  "show-porto-fair": `__bh.game.setDate("2026-07-10T17:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.4);
    __bh.game.flyAt(42.26, 8.58, 500, 80, 220);`,
  "show-rock": `__bh.game.setDate("2026-07-10T07:30:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.35);
    __bh.game.flyAt(36.08, -5.43, 400, 55, 220);`,
  // (the marks on the water — N6b —: the F-35 at 8 m over the strait at 130 m/s seen from its nose looking back, its downwash and
  // spray behind it; slow at 15 m, its jets on the water; a carrier at 14 m/s, its wake, from 120 m)
  "wake-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.2);
    __bh.game.flyAt(35.99, -5.52, 12, 190, 130); { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap");
    if (c.jetModes.spd === null) c.jetToggle("athr"); c.jetModes.alt = 12; c.jetModes.spd = 130; c.jetModes.hdg = 190 * Math.PI / 180; }
    __bh.settings.shipMount = "rear";`,
  "wake-hover": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.2);
    __bh.game.flyAt(35.99, -5.52, 15, 190, 15); __bh.settings.shipMount = "around";`,
  "ship-wake": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.2);
    __bh.camera.carrierSpawn("ford", { lat: 35.97, lon: -5.52, heading: 90, speed: 14 });
    __bh.game.flyAt(35.975, -5.533, 80, 115, 150); __bh.settings.shipMount = "cockpit";`,
  // (N4: the storm's cumulonimbus seen from 3 km — their towers, anvils, the rain shield under them)
  "storm-high": `__bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 5500, 20, 220);`,
  "storm-top": `__bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 12500, 20, 230);`,
  // (N5: a flash to the ground 2.5 km ahead under the storm — the mode bolt, struck once the clock stands: held at its first stroke —; the storm in the evening, the Sun low
  // behind the camera: the rain lit, its rainbow)
  "storm-bolt": `__bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 250, 20, 220);`,
  rainbow: `__bh.game.setDate("2026-07-10T18:40:00Z"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(36.08, -5.6, 600, 150, 200);`,
  // (isolated showers — cumulonimbus at a third of the sky, the Sun low behind the camera between them: their rain lit, its
  // rainbow — a state set as the real weather's)
  showers: `__bh.game.setDate("2026-07-10T18:40:00Z"); const w = { source: "model", kind: "storm", rain: 0.9, dust: 0, fogTop: 0,
    visibility: 25000, wind: { u10: 6, from: 270, gust: 4, turb: 1, shear: 3 }, layers: [{ base: 900, top: 8500, cover: 0.35 }] };
    __bh.camera.weatherReal = __bh.renderer.weatherReal = w; __bh.settings.weather = "real"; __bh.game.set("earthClouds", 0.2);
    __bh.game.flyAt(36.08, -5.6, 600, 150, 200);`,
  // (N5: a valley fog in the Alps in the morning — its top over the valleys' floor about the camera, the ridges above it)
  "alps-fog": `__bh.game.setDate("2026-07-10T07:30:00Z"); __bh.game.set("weather", "fog"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
  // (the town of Tarifa from 200 m, 2 km off: its buildings — the raster's boxes' check)
  "tarifa-town": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.016, -5.632, 200, 100, 150);`,
  // (low over the Alcornocales' cork oaks in the afternoon: the trees' long shadows — their shadow map's check)
  "forest-low": `__bh.game.setDate("2026-07-10T17:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.30, -5.55, 150, 200, 120);`,
};
const MODE_SET: Record<string, string> = {
  trace6: `__bh.settings.earthPipeline = "trace"; __bh.game.set("realtimeSubsampling", 6);`,
  trace4: `__bh.settings.earthPipeline = "trace"; __bh.game.set("realtimeSubsampling", 4);`,
  raster: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "every"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  // (the raster's shading rate: one pixel in two, one in 2 × 2 a frame — the rest rebuilt, then the history)
  rasterhalf: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "half"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  rasterquarter: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  rastereighth: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  rastersixteenth: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "sixteenth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4);`,
  // (the trees' proxies' detail at the ¼ rate — renderer.sceneryRasterLod: the near ones' reach, their round crown's faces, the far ones')
  // (the relief's shadow map — terrain-raster.ts encodeSunShadow — on, the default, and off: the march alone)
  sun: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.sunShadowOn = true;`,
  nosun: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.sunShadowOn = false;`,
  // (the cloud pass — trace.wgsl clouds, docs/PLAN-NUAGES-AAA.md N1 — on, the default, and off: each pixel marches its clouds)
  cloudpass: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.cloudPassOn = true;`,
  nocloudpass: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.cloudPassOn = false;`,
  // (the cloud pass's light — N2 —: marched through the clouds, the default, or the column of their cover)
  cloudlight: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.cloudPassOn = true; __bh.renderer.tune = {};`,
  nocloudlight: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.cloudPassOn = true; __bh.renderer.tune = { TUNE_CLOUD_LIGHT: 0 };`,
  // (the clear sky's light, physical and shared — N2b — on, the default, and off: the old constant)
  sky: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.skyAmbientOn = true;`,
  nosky: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.skyAmbientOn = false;`,
  // (the sea's N6 — the shallows over the bathymetry, the surf, the clear sky's own radiance mirrored — on, and off)
  // (everything on, as shipped — every switch the other modes turn off set back: the A/B's reference)
  sea: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {};
    Object.assign(__bh.renderer, { skyAmbientOn: true, cloudPassOn: true, cloudShadowOn: true, sunShadowOn: true });`,
  nosea: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 1536 };`,
  // (the sea's reflections — the slopes' mean Fresnel, the lifted mirror, the screen-space reflections — off: the rest of N6 on)
  norefl: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 6144 };`,
  // (the clouds' shadow map — N3: the ground's, the scenery's, the craft's, the shafts in the air — on, and off: the old 2D covers)
  csm: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {};`,
  nocsm: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 8192 };`,
  // (the far clouds mirrored in the sea from the cloud pass's image — N6b — off)
  nocloudrefl: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 16384 };`,
  // (a tune that turns nothing off — an unread bit —: the control for the tuned A/B, a tune itself costing the terrain cache)
  tunectl: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304 };`,
  // (the weather clouds' empty-space exit — wxShape — off: the optimisation's A/B, against tunectl)
  cloudslow: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304 | 8388608 };`,
  // (the weather clouds' sky light computed at every sample, as before the hoisting — the A/B, against tunectl)
  cloudsky: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304 | 16777216 };`,
  // (the buildings' raster boxes ignored: every ray its BVH, as before — the check, against tunectl)
  bldold: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304, TUNE_SC_SKIP: 8 };`,
  // (the grazing rays marched from the camera, as before the window — against tunectl)
  grazeold: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304, TUNE_GRAZE_WINDOW: 0 };`,
  // (the trees' and buildings' shadow map off: the rays towards the Sun, as before — against tunectl)
  tsmoff: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304, TUNE_SC_SKIP: 32 };`,
  // (the clouds' baked Perlin–Worley and Worley noises off: the gradient noise's octaves, as before — against tunectl)
  pwoff: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 4194304, TUNE_SC_SKIP: 64 };`,
  // (the visibility pass's parts left out, to weigh them — the image then wrong: the trees' proxies, the buildings' boxes)
  vistrees: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.sceneryRaster && (__bh.renderer.sceneryRaster.debugSkip = 1);`,
  visboxes: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.sceneryRaster && (__bh.renderer.sceneryRaster.debugSkip = 2);`,
  visall: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.sceneryRaster && (__bh.renderer.sceneryRaster.debugSkip = 0);`,
  // (the trees the raster draws by their projected size: every one, under 0.6 px left out, under 1.2 px (the default))
  treesall: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.treeMinPx = 0;`,
  trees06: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.treeMinPx = 0.6;`,
  trees12: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "eighth"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.treeMinPx = 1.2;`,
  // (the rain's shafts — N5 — off)
  norain: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 65536 };`,
  bolt: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = {}; __bh.renderer.lightning.strike(855, 2349, true);`,
  raindebug: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 262144 };`,
  wakedebug: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.tune = { TUNE_GSKIP: 32768 };`,
  lod300: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.sceneryRasterLod = { nearM: 300, near: "ico80", far: "ico20" };`,
  lod150: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.sceneryRasterLod = { nearM: 150, near: "ico80", far: "ico20" };`,
  lod150light: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.sceneryRasterLod = { nearM: 150, near: "ico20", far: "octa" };`,
  lod300octa: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "quarter"; __bh.renderer.sceneryRasterOn = true; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.sceneryRasterLod = { nearM: 300, near: "ico80", far: "octa" };`,
  // (the raster without the trees' instances: the grid walked from every pixel, as étape 1a had it)
  rasterwalk: `__bh.settings.earthPipeline = "raster"; __bh.settings.earthRasterShading = "every"; __bh.renderer.sceneryRasterOn = false; __bh.game.set("realtimeSubsampling", 4);`,
};
const places = (process.env.PLACES ?? "tarifa-low,tarifa,alps").split(",");
const modes = (process.env.MODES ?? "trace6,trace4,rasterwalk,raster,rasterhalf,rasterquarter").split(",");
const FRAMES = Number(process.env.FRAMES ?? 90);
const NOREF = process.env.RF_NOREF === "1";
// (RF_DETAIL=max, the default: the scenery's trees and buildings at their most, drawn farthest, with their shadows and the
// satellite surface — the image aimed at; RF_DETAIL=game: the game's own settings)
const DETAIL =
  process.env.RF_DETAIL === "game"
    ? ""
    : `Object.assign(__bh.settings, { earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite" });`;

type Png = ReturnType<typeof readPng>;
function psnr(a: Png, b: Png) {
  let sq = 0,
    n = 0;
  for (let y = 60; y < a.height; y++)
    for (let x = 0; x < a.width; x++)
      for (let c = 0; c < 3; c++) {
        const i = (y * a.width + x) * a.channels + c;
        const d = a.data[i]! - b.data[i]!;
        sq += d * d;
        n++;
      }
  return +(10 * Math.log10((255 * 255) / Math.max(sq / n, 1e-9))).toFixed(2);
}
const png = (f: string) => readPng(new Uint8Array(require("node:fs").readFileSync(f)));

describe.skipIf(!E2E)("the raster's primary visibility in flight: frame rate and image, against the traced ×6 and ×4", () => {
  let app: App;
  const rows: unknown[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write("remote-results/raster-flight.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  for (const pl of places)
    test(`${pl}: ${modes.join(", ")}`, async () => {
      // (the craft put there and flown until the ground's tiles and the scenery are in; then the clock stopped — every
      // mode draws the same view —, the view touched every frame: fresh rays, no history, the worst of a fast turn)
      await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 0 });
        __bh.settings.shipMount = "cockpit"; ${PLACES[pl]} ${DETAIL} __bh.settings.earthPipeline = "trace";
        const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
      // (the clock stopped a few frames after the craft is put there: every run sees the same view, however long the
      // ground's tiles and the kernels take)
      await app.js(
        `(async () => { for (let i = 0; i < 10; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.settings.animate = false; return 1; })()`,
      );
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 120000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 4000) break; await frame(); }
        __bh.settings.animate = false;
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return 1; })()`);
      const shots: Record<string, string> = {};
      const measured: Record<string, { gpuMs: number; passes: Record<string, number>; raster: Record<string, unknown> }> = {};
      // (a mode asked twice — MODES=a,b,a,b, alternated — measured each time: its rows numbered)
      const runs = modes.map((md, i) => (modes.indexOf(md) === i ? md : `${md}#${modes.slice(0, i + 1).filter((x) => x === md).length}`));
      for (const [i, md] of modes.entries()) {
        const run = runs[i]!;
        await app.js(`(() => { ${MODE_SET[md]} __bh.touch(); return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        await app.js(`(() => { const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; r.prof.reset(); return 1; })()`);
        if (MODE_SET[md]!.includes(`earthPipeline = "raster"`))
          await app.waitFor(
            `__bh.renderer.terrainRasterStats.primary && __bh.renderer.prof.table().some((p) => p.label === "earth shade (raster)") &&
              (() => { const r = __bh.renderer, v = r.variants.get(r.featureKey); return !!(v && v.shade); })() &&
              (!__bh.renderer.sceneryRasterOn || __bh.settings.earthScenery === "off" || !!__bh.renderer.terrainRasterStats.scenery?.active)`,
            300_000,
          );
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 30; i++) await frame();
          r.prof.reset();
          let done = 0, last = r.lastDoneAt; const sum = {}; let gpu = 0;
          while (done < ${FRAMES}) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs;
            for (const p of r.prof.table()) sum[p.label] = (sum[p.label] ?? 0) + p.last; } }
          window.__m = { gpuMs: +(gpu / done).toFixed(1), raster: { ...r.terrainRasterStats },
            passes: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / done).toFixed(2)])) };
          return 1; })()`);
        measured[run] = await app.js("window.__m");
        shots[run] = `remote-results/rf-${pl}-${run.replace("#", "-")}.png`;
        await app.shot(shots[run]!);
      }
      // (the reference: the same view, the touching stopped, converged — RF_NOREF=1: none, a timing run)
      const fr = `remote-results/rf-${pl}-ref.png`;
      if (!NOREF) {
        await app.js(
          `(() => { window.__t = false; __bh.settings.earthPipeline = "trace"; __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`,
        );
        for (let i = 0; i < 180; i++) {
          await Bun.sleep(500);
          if (await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`)) break;
        }
        await app.shot(fr);
      }
      const ref = NOREF ? null : png(fr);
      for (const [i, md] of modes.entries()) {
        const run = runs[i]!;
        const m = measured[run]!;
        const rays = ["trace", "earth shade (raster)", "terrain raster visibility"].reduce((a, k) => a + (m.passes[k] ?? 0), 0);
        const row = {
          place: pl,
          mode: run,
          gpuMs: m.gpuMs,
          raysMs: +rays.toFixed(1),
          psnrVsConverged: ref ? psnr(png(shots[run]!), ref) : null,
          primary: m.raster.primary,
          trees: (m.raster.scenery as { active?: boolean } | null)?.active ?? false,
          passes: m.passes,
        };
        rows.push(row);
        console.log(JSON.stringify({ ...row, passes: undefined }));
        if (MODE_SET[md]!.includes(`earthPipeline = "raster"`)) expect(m.raster.error).toBeFalsy();
      }
      await app.js(`(() => { __bh.settings.animate = true; __bh.settings.targetSpp = 0; return 1; })()`);
    }, 1_200_000);
});
