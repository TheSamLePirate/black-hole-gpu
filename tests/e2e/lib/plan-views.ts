// The views of the common plan (docs/PLAN-REFRACTION-HORIZONS.md — M0a, M0b and every phase after: decision 36, one shared
// suite): the Earth in the raster pipeline, in the F-35's cockpit, at fixed places and dates, plus the rocky worlds' views
// of PLAN-PLANETES-AAA (tests/e2e/lib/planet-views.ts). tests/e2e/plan-views.e2e.test.ts measures them.

import { SPOTS } from "./planet-views";

/** an Earth view: the craft placed (flyAt: latitude, longitude [°], height over the ground [m], heading [°], speed [m/s])
 *  at a date (UTC); ortho: wait for the IGN's orthophotos (France) */
export type EarthView = {
  name: string;
  what: string;
  date: string;
  at: [number, number, number, number, number];
  ortho?: boolean;
};

export const EARTH_VIEWS: EarthView[] = [
  {
    // (the U10 reference: Paris low, a July morning — the cities, the scenery, the material's cost)
    name: "paris-low",
    what: "Paris, 450 m, a July morning",
    date: "2026-07-10T10:30:00Z",
    at: [48.83, 2.27, 450, 60, 120],
    ortho: true,
  },
  {
    // (the low Sun over the Alps — ~11° up, west-north-west behind the craft: the relief's shadows, its stairs and facets,
    // the rings' seams; as tests/e2e/lowflight-governor.e2e.test.ts's place)
    name: "chamonix-low-sun",
    what: "Chamonix valley, 450 m, the Sun ~11° up",
    date: "2026-07-10T17:50:00Z",
    at: [
      45.92 - (1.1 * Math.cos(Math.PI / 4)) / 111.2,
      6.87 - (1.1 * Math.sin(Math.PI / 4)) / (111.2 * Math.cos((45.92 * Math.PI) / 180)),
      450,
      45,
      120,
    ],
    ortho: true,
  },
  {
    // (gentle slopes on SRTM's metres alone — the Mongolian steppe east of Ulaanbaatar, a low morning Sun: the monotone
    // cubic's stairs, T1)
    name: "srtm-steppe",
    what: "Mongolian steppe (SRTM only), 300 m, the Sun ~20° up",
    date: "2026-07-10T23:15:00Z",
    at: [47.75, 107.2, 300, 300, 120],
  },
  {
    // (the sea at sunset — Biarritz looking west-north-west at the Sun ~2° up: the coast's teeth, the glint's moiré, R3)
    name: "biarritz-sunset",
    what: "Biarritz coast, 1 500 m, sunset (Sun ~2°)",
    date: "2026-06-21T19:45:00Z",
    at: [43.45, -1.52, 1500, 300, 140],
    ortho: true,
  },
];

/** the rocky worlds' views kept for the plan (H, R): their first set of planet-views.ts */
export const WORLD_VIEWS = SPOTS.filter((s) =>
  [
    ["earth", "orbit"],
    ["moon", "cine"],
    ["mercury", "cine"],
    ["ceres", "cine"],
    ["europa", "cine"],
    ["mars", "low"],
  ].some(([b, v]) => s.body === b && s.view === v),
);

/** the game's own settings for the Earth's views, the network's chance left out (no traffic), the F-35 in its cockpit */
export const EARTH_SETTINGS = `{ traffic: false, weather: "fair", earthPipeline: "raster", f35AutoProtect: false, damage: false, crashSpeed: 1e9 }`;
