// The game's showcase pictures (the title's art, the marketing's): each a scene set up by the game itself — aircraft in
// formation over France and elsewhere, the A320, the weathers and hours of a day, the views of exception (game/views.ts),
// the Moon, the stars, Gargantua —, the interface hidden, the world frozen, the image left to converge in the photo mode
// (the raster's view refines there), taken live. A headless Chrome on its own dev server (tests/e2e/lib/app.ts).
//
//   bun scripts/showcase-shots.ts [all|a|b|<name,name…>]     → remote-results/showcase/<name>.png (1920 × 1080)
//   bun scripts/remote.ts run --headless -- bun scripts/showcase-shots.ts b     (the other half on kerr-mini)
//
// SHOW_W, SHOW_H: the size (default 1920 × 1080). Then `python3 scripts/build-showcase.py` makes the title's and the
// marketing's pictures from them.
import { mkdirSync } from "node:fs";
import { App, stopServer } from "../tests/e2e/lib/app";

const W = Number(process.env.SHOW_W ?? 1920);
const H = Number(process.env.SHOW_H ?? 1080);
const OUT = "remote-results/showcase";

interface Shot {
  /** run in the page once the scene is cleared: puts the scene there (the world frozen after it) */
  setup: string;
  /** the camera once there (run each step for a while: the mount recomputes it) */
  camera?: string;
  /** a preset or a view of exception (they frame themselves) — no freezing before */
  own?: boolean;
  group: "a" | "b";
}

/** the F-35, its wingmen in a shape, at a place and hour, the weather, the speed */
const f35 = (o: {
  lat: number;
  lon: number;
  alt: number;
  hdg: number;
  date: string;
  weather?: string;
  clouds?: number;
  wingmen?: number;
  shape?: string;
  spacing?: string;
  real?: string;
}) => `
  __bh.settings.vessel = "f35"; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
  __bh.game.setDate("${o.date}");
  ${o.real ?? `__bh.game.set("weather", "${o.weather ?? "fair"}");`}
  __bh.game.set("earthClouds", ${o.clouds ?? 0.2});
  __bh.settings.wingmen = ${o.wingmen ?? 0};
  __bh.settings.formShape = "${o.shape ?? "echelonR"}"; __bh.settings.formSpacing = "${o.spacing ?? "tight"}";
  __bh.game.flyAt(${o.lat}, ${o.lon}, ${o.alt}, ${o.hdg}, 190);
  const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
  for (let i = 0; i < 90; i++) __bh.step(1 / 30);`;
/** the A320 at a place and hour (its livery the house's) */
const a320 = (o: {
  lat: number;
  lon: number;
  alt: number;
  hdg: number;
  date: string;
  weather?: string;
  clouds?: number;
  real?: string;
}) => `
  __bh.settings.vessel = "a320"; for (let i = 0; i < 5; i++) __bh.step(1 / 30);
  __bh.game.setDate("${o.date}");
  ${o.real ?? `__bh.game.set("weather", "${o.weather ?? "fair"}");`}
  __bh.game.set("earthClouds", ${o.clouds ?? 0.2});
  __bh.settings.wingmen = 0;
  __bh.game.flyAt(${o.lat}, ${o.lon}, ${o.alt}, ${o.hdg}, 140);
  const c = __bh.camera; if (c.jetModes?.alt === null) c.jetToggle("ap"); if (c.jetModes?.spd === null) c.jetToggle("athr");
  for (let i = 0; i < 60; i++) __bh.step(1 / 30);`;
/** the camera about the craft: yaw (0 behind), pitch, distance [m], the lens */
const around = (yaw: number, pitch: number, dist: number, fov = 40) =>
  `__bh.settings.shipMount = "around"; __bh.settings.fov = ${fov}; Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} });`;
/** a weather set as the real one: kind, rain, one layer */
const wx = (kind: string, rain: number, base: number, top: number, cover: number, vis = 30000) =>
  `{ const w = { source: "model", kind: "${kind}", rain: ${rain}, dust: 0, fogTop: 0, visibility: ${vis},
    wind: { u10: 5, from: 270, gust: 2, turb: 1, shear: 2 }, layers: [{ base: ${base}, top: ${top}, cover: ${cover} }] };
    __bh.camera.weatherReal = __bh.renderer.weatherReal = w; __bh.settings.weather = "real"; }`;

// the weathers' and the hours' set: the F-35 and its wingman off Gibraltar's Rock, the same framing
const GIB = { lat: 36.06, lon: -5.47, alt: 450, hdg: 300 };
const gibCam = around(205, 7, 55);

const SHOTS: Record<string, Shot> = {
  // ---- heroes: aircraft in formation over France, the A320
  "f35-diamond-montblanc": {
    group: "a",
    setup: f35({ lat: 45.86, lon: 6.95, alt: 4600, hdg: 230, date: "2026-07-10T18:35:00Z", wingmen: 3, shape: "diamond", clouds: 0.25 }),
    camera: around(155, 6, 75, 38),
  },
  "f35-echelon-corsica": {
    group: "b",
    setup: f35({ lat: 42.27, lon: 8.6, alt: 900, hdg: 250, date: "2026-07-10T17:50:00Z", wingmen: 2, shape: "echelonR", clouds: 0.3 }),
    camera: around(215, 7, 60),
  },
  "f35-vic-provence": {
    group: "a",
    setup: f35({
      lat: 43.72,
      lon: 5.4,
      alt: 3600,
      hdg: 90,
      date: "2026-07-10T07:30:00Z",
      wingmen: 2,
      shape: "vic",
      weather: "cloudy",
      clouds: 0.5,
    }),
    camera: around(200, 4, 70),
  },
  "f35-crepuscular": {
    group: "b",
    setup: f35({
      lat: 36.08,
      lon: -5.6,
      alt: 800,
      hdg: 295,
      date: "2026-07-10T19:15:00Z",
      wingmen: 1,
      real: wx("cloudy", 0, 1500, 3200, 0.55),
    }),
    camera: around(15, 2, 45, 45),
  },
  "f35-rainbow": {
    group: "a",
    setup: f35({
      lat: 36.08,
      lon: -5.42,
      alt: 450,
      hdg: 112,
      date: "2026-07-10T18:50:00Z",
      wingmen: 1,
      real: wx("rain", 0.7, 2000, 4500, 0.5, 40000),
    }),
    camera: around(8, 9, 50, 55),
  },
  "f35-sea-glint": {
    group: "b",
    setup: f35({ lat: 36.0, lon: -5.75, alt: 120, hdg: 285, date: "2026-07-10T18:45:00Z", wingmen: 1, shape: "echelonL" }),
    camera: around(25, 4, 40),
  },
  "f35-storm": {
    group: "a",
    setup: f35({ lat: 36.08, lon: -5.6, alt: 5500, hdg: 20, date: "2026-07-10T15:00:00Z", wingmen: 1, weather: "storm", clouds: 1 }),
    camera: around(200, 5, 45),
  },
  "f35-mont-saint-michel": {
    group: "b",
    setup: f35({ lat: 48.62, lon: -1.56, alt: 300, hdg: 60, date: "2026-07-10T19:30:00Z", wingmen: 2, shape: "echelonL" }),
    camera: around(210, 8, 65),
  },
  "a320-paris-dusk": {
    group: "a",
    setup: a320({ lat: 48.835, lon: 2.25, alt: 650, hdg: 60, date: "2026-07-10T19:20:00Z" }),
    camera: around(220, 9, 95),
  },
  "a320-above-clouds": {
    group: "b",
    setup: a320({ lat: 43.6, lon: 1.3, alt: 3800, hdg: 280, date: "2026-07-10T19:10:00Z", real: wx("cloudy", 0, 1300, 3100, 0.8) }),
    camera: around(160, 5, 85),
  },
  "a320-alps": {
    group: "a",
    setup: a320({ lat: 45.95, lon: 6.9, alt: 4800, hdg: 60, date: "2026-07-10T10:30:00Z", weather: "cloudy", clouds: 0.4 }),
    camera: around(230, 12, 90),
  },
  "a320-runway": {
    group: "b",
    setup: `__bh.settings.vessel = "a320"; for (let i = 0; i < 5; i++) __bh.step(1 / 30); __bh.game.setDate("2026-07-10T18:30:00Z");
      __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.3); __bh.settings.wingmen = 0; __bh.game.lineUp("Bourget");
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);`,
    camera: around(150, 6, 70),
  },
  "f35-manhattan": {
    group: "a",
    setup: f35({ lat: 40.7, lon: -74.03, alt: 500, hdg: 30, date: "2026-07-10T23:40:00Z", wingmen: 1, shape: "echelonR" }),
    camera: around(200, 6, 50),
  },
  "f35-grand-canyon": {
    group: "b",
    setup: f35({ lat: 36.08, lon: -112.15, alt: 2300, hdg: 80, date: "2026-07-10T02:30:00Z", wingmen: 2, shape: "trail" }),
    camera: around(195, 10, 70),
  },
  // ---- the weathers, the same framing off Gibraltar
  ...Object.fromEntries(
    (["fair", "cloudy", "overcast", "rain", "storm", "windy", "fog"] as const).map((w, i) => [
      `wx-${w}`,
      {
        group: i % 2 ? "b" : "a",
        setup: f35({ ...GIB, date: "2026-07-10T11:00:00Z", wingmen: 1, weather: w, clouds: w === "fair" ? 0.1 : 1 }),
        camera: gibCam,
      } satisfies Shot,
    ]),
  ),
  // ---- the hours of a day there
  ...Object.fromEntries(
    (
      [
        ["dawn", "2026-07-10T05:05:00Z"],
        ["morning", "2026-07-10T08:30:00Z"],
        ["noon", "2026-07-10T12:30:00Z"],
        ["dusk", "2026-07-10T19:35:00Z"],
        ["night", "2026-07-10T22:30:00Z"],
      ] as const
    ).map(([h, date], i) => [
      `hour-${h}`,
      { group: i % 2 ? "a" : "b", setup: f35({ ...GIB, date, wingmen: 1, weather: "cloudy", clouds: 0.4 }), camera: gibCam } satisfies Shot,
    ]),
  ),
  // ---- the world's great places (the views of exception's — game/views.ts —, set as stills: the views are timed missions)
  "f35-sea-sunset": {
    group: "a",
    setup: f35({ lat: 43.2, lon: 6.6, alt: 250, hdg: 280, date: "2026-07-10T19:25:00Z", wingmen: 2, shape: "echelonL", clouds: 0.3 }),
    camera: around(20, 3, 60, 42),
  },
  "f35-fjords": {
    group: "b",
    setup: f35({ lat: 62.1, lon: 7.0, alt: 1300, hdg: 110, date: "2026-07-10T17:30:00Z", wingmen: 1, weather: "cloudy", clouds: 0.4 }),
    camera: around(200, 8, 55),
  },
  "f35-himalaya": {
    group: "a",
    setup: f35({ lat: 27.9, lon: 86.82, alt: 8600, hdg: 20, date: "2026-11-10T11:10:00Z", wingmen: 2, shape: "vic" }),
    camera: around(205, 6, 70),
  },
  "f35-iceland": {
    group: "b",
    setup: f35({ lat: 64.35, lon: -17.2, alt: 2200, hdg: 70, date: "2026-07-10T23:00:00Z", wingmen: 1 }),
    camera: around(215, 8, 55),
  },
  "f35-patagonia": {
    group: "a",
    setup: f35({ lat: -51.0, lon: -73.05, alt: 2600, hdg: 20, date: "2026-12-15T23:20:00Z", wingmen: 1, weather: "cloudy", clouds: 0.4 }),
    camera: around(200, 6, 55),
  },
  "f35-aurora": {
    group: "b",
    setup: f35({ lat: 69.65, lon: 18.95, alt: 1500, hdg: 0, date: "2026-12-15T21:00:00Z", wingmen: 1 }),
    camera: around(180, 18, 45, 60),
  },
  // ---- space: the Moon, the stars, Gargantua
  ...Object.fromEntries(
    (
      [
        ["moon-earthrise", "Moon: Earthrise"],
        ["gargantua-disk", "Interstellar: along the disk (the film's close pass)"],
        ["miller", "Miller: Gargantua over the sea"],
        ["earth-sunset-orbit", "Earth: sunset from orbit"],
        ["endurance-earth", "Earth: the Endurance, 800 km up"],
        ["saturn-backlit", "Saturn: backlit"],
      ] as const
    ).map(([n, p], i) => [n, { group: i % 2 ? "a" : "b", own: true, setup: `__bh.preset(${JSON.stringify(p)});` } satisfies Shot]),
  ),
};

const arg = process.argv[2] ?? "all";
const names =
  arg === "all"
    ? Object.keys(SHOTS)
    : arg === "a" || arg === "b"
      ? Object.keys(SHOTS).filter((k) => SHOTS[k]!.group === arg)
      : arg.split(",");
mkdirSync(OUT, { recursive: true });

const HIDE = `(() => { __bh.settings.showFps = false; __bh.settings.keyHints = false; __bh.settings.subtitles = false;
  document.body.classList.add("hide-ui", "benching");
  document.querySelectorAll("canvas.fl-hud, #overlay, .sp-toasts, .fps-meter, .ph-bar, .compile-meter, .scenery-credit, .msn-hud").forEach((e) => (e.style.visibility = "hidden"));
  return 1; })()`;
/** the ground's tiles, the scenery, the kernels in — at most ms */
const READY = (ms: number) => `(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
  const t0 = performance.now(); let calm = 0;
  while (performance.now() - t0 < ${ms}) { const sc = r.earthScenery?.stats?.();
    const ok = r.earthTiles.pending === 0 && r.compilingNow.length === 0 && !!r.variantReady && !(sc && (sc.pending || sc.status === "loading"));
    calm = ok ? calm || performance.now() : 0; if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
  return Math.round((performance.now() - t0) / 1000); })()`;

const app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true,
  dynamicResolution: false, earthPipeline: "raster", earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true,
  earthSurface: "satellite" }); __bh.game.quality("realtime"); return 1; })()`);
const log: unknown[] = [];
for (const name of names) {
  const s = SHOTS[name];
  if (!s) {
    console.log(`  ${name}: no such shot`);
    continue;
  }
  const t0 = performance.now();
  try {
    await app.js(`(() => { if (__bh.mode.get() === "photo") __bh.mode.set("ship"); document.body.classList.remove("hide-ui", "benching");
      try { if (__bh.flight.missions.state()) __bh.flight.missions.abort(); } catch {}
      __bh.freeze(false); __bh.settings.animate = true; return 1; })()`);
    if (s.own) {
      await app.js(`(() => { ${s.setup} return 1; })()`);
      await Bun.sleep(4000);
    } else {
      await app.js(`(() => { __bh.freeze(true); ${s.setup} return 1; })()`);
    }
    const waited = await app.js<number>(READY(150_000));
    if (s.camera) await app.js(`(() => { for (let i = 0; i < 60; i++) { ${s.camera} __bh.step(1 / 30); } return 1; })()`);
    if (s.own) await app.js(`(() => { __bh.freeze(true); return 1; })()`);
    // (the photo mode: the raster's view refines; its framing for a view of exception)
    await app.js(`(() => { __bh.mode.set("photo"); return 1; })()`);
    await app.js(HIDE);
    await app.js(READY(60_000));
    await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); while (performance.now() - t0 < 45000 && r.lastPhase !== "converged") await frame();
      for (let i = 0; i < 30; i++) await frame(); return r.lastPhase; })()`);
    await app.js(HIDE);
    await app.shot(`${OUT}/${name}.png`);
    const s2 = Math.round((performance.now() - t0) / 1000);
    log.push({ name, waited, s: s2 });
    console.log(`  ${name}: ${s2} s (scene ready in ${waited} s)`);
  } catch (e) {
    log.push({ name, error: String(e) });
    console.log(`  ${name}: FAILED ${String(e).slice(0, 200)}`);
  }
}
await Bun.write(`${OUT}/log-${arg.replace(/[^a-z0-9-]/gi, "_").slice(0, 40)}.json`, JSON.stringify(log, null, 2));
app.close();
stopServer();
