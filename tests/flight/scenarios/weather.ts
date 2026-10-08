// The landings in weather (PLAN-METEO W8): the entry autopilot's glide from the nominal hand-over (80 km out,
// 25 km up, 750 m/s) through the weather of a report — W7's "real" weather, its state fixed here (the same
// each run) —: a 15 kt crosswind with gusts, a tail wind down the published runway (the far end landed:
// W4), fog at Le Bourget, a thunderstorm's gusts, turbulence and shear at Kennedy. Judged as every landing
// (landing.ts LIMITS: one touchdown, its sink, on the axis, stopped on the runway, how it flew), the gusty
// ones on the strong wind's sink; the end landed checked where the wind picks it.
import type { WeatherState } from "../../../src/weather";
import { fly, glide, judge } from "./landing";
import type { Scenario } from "./helpers";

const base = { source: "metar" as const, fogTop: 0, layers: [], rain: 0, dust: 0 };

function weatherGlide(id: string, title: string, site: string, w: WeatherState, o: { gusty?: boolean; far?: boolean } = {}): Scenario {
  return {
    id,
    title,
    tags: ["landing", "glide", "ranger", "plane", "runway", "weather", ...(o.gusty ? ["wind"] : [])],
    minutes: 6,
    async run(lab) {
      await lab.js(`(() => {
        const w = ${JSON.stringify(w)};
        __bh.settings.weather = "real"; __bh.camera.weatherReal = w; __bh.renderer.weatherReal = w;
        return true;
      })()`);
      await glide(lab, site, 80, 25, 750, 0);
      const end = await lab.js(`__bh.camera.entrySite?.reverse ? "far" : "published"`);
      const e = await fly(lab, { maxSim: 1200, maxWall: 700 });
      const v = await judge(lab, e, "glide", o.gusty ? 2 : 0);
      if (o.far !== undefined && (end === "far") !== o.far) {
        return { ...v, ok: false, why: `✗ landed at the ${end} end, the wind asked the ${o.far ? "far" : "published"} one · ${v.why}` };
      }
      return { ...v, metrics: { ...v.metrics, end } };
    },
  };
}

export const WEATHER: Scenario[] = [
  weatherGlide(
    "weather-edwards-crosswind",
    "Ranger — Edwards, a 15 kt crosswind from the right, gusting 23 (310°/8 G12 m/s)",
    "Edwards",
    { ...base, kind: "windy", wind: { u10: 8, from: 310, gust: 4, turb: 2, shear: 2 }, visibility: 30e3 },
    { gusty: true, far: false },
  ),
  weatherGlide(
    "weather-edwards-tailwind",
    "Ranger — Edwards, the wind down runway 22 (040°/7 m/s): runway 04, its far end",
    "Edwards",
    { ...base, kind: "windy", wind: { u10: 7, from: 40, gust: 0, turb: 1, shear: 1 }, visibility: 30e3 },
    { far: true },
  ),
  weatherGlide(
    "weather-bourget-fog",
    "Ranger — Le Bourget in fog: 300 m, its top 120 m, a deck at 150 m (LIFR), light wind",
    "Bourget",
    {
      ...base,
      kind: "fog",
      wind: { u10: 2, from: 270, gust: 0, turb: 0, shear: 0 },
      visibility: 300,
      fogTop: 120,
      layers: [{ base: 150, top: 900, cover: 0.9 }],
    },
    { far: false },
  ),
  weatherGlide(
    "weather-kennedy-storm",
    "Ranger — Kennedy under a thunderstorm: 13 m/s from 150°, gusting 21, severe turbulence, shear, heavy rain",
    "Kennedy",
    {
      ...base,
      kind: "storm",
      wind: { u10: 13, from: 150, gust: 8, turb: 3, shear: 6 },
      visibility: 2500,
      rain: 1,
      layers: [
        { base: 400, top: 9000, cover: 1 },
        { base: 10000, top: 11500, cover: 0.6 },
      ],
    },
    { gusty: true, far: false },
  ),
];
