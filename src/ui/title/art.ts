// The title's pictures (PLAN-TITRE-AAA E3), every one made by the game itself (scripts/title-art.ts renders them,
// scripts/build-title-art.py crops them): each way to play's card and wide picture, and the hangar's turntables —
// each craft from 36 sides, one sheet of 6 × 6 views (16:9) — turned by a drag, slowly on their own; On foot's
// planispheres (E6).

import fieldArt from "../../../assets/title/field.webp";
import hourDawn from "../../../assets/title/hour-dawn.webp";
import hourDusk from "../../../assets/title/hour-dusk.webp";
import hourMorning from "../../../assets/title/hour-morning.webp";
import hourNight from "../../../assets/title/hour-night.webp";
import hourNoon from "../../../assets/title/hour-noon.webp";
import planeA320 from "../../../assets/title/plane-a320.webp";
import planeF35 from "../../../assets/title/plane-f35.webp";
import wxCloudy from "../../../assets/title/wx-cloudy.webp";
import wxFair from "../../../assets/title/wx-fair.webp";
import wxFog from "../../../assets/title/wx-fog.webp";
import wxOvercast from "../../../assets/title/wx-overcast.webp";
import wxRain from "../../../assets/title/wx-rain.webp";
import wxStorm from "../../../assets/title/wx-storm.webp";
import wxWindy from "../../../assets/title/wx-windy.webp";
import footCard from "../../../assets/title/mode-foot-card.webp";
import footWide from "../../../assets/title/mode-foot-wide.webp";
import mapEarth from "../../../assets/title/map-earth.webp";
import mapMars from "../../../assets/title/map-mars.webp";
import mapMoon from "../../../assets/title/map-moon.webp";
import freeCard from "../../../assets/title/mode-free-card.webp";
import freeWide from "../../../assets/title/mode-free-wide.webp";
import planeCard from "../../../assets/title/mode-plane-card.webp";
import planeWide from "../../../assets/title/mode-plane-wide.webp";
import shipCard from "../../../assets/title/mode-ship-card.webp";
import shipWide from "../../../assets/title/mode-ship-wide.webp";
import turnEndurance from "../../../assets/title/turn-endurance.webp";
import turnLander from "../../../assets/title/turn-lander.webp";
import turnRanger from "../../../assets/title/turn-ranger.webp";
import type { WeatherPreset } from "../../weather";
import type { ModeId, VesselChoice } from "./activities";
import type { Aircraft, Hour } from "./plane";

export const MODE_ART: Record<ModeId, { card: string; wide: string }> = {
  foot: { card: footCard, wide: footWide },
  plane: { card: planeCard, wide: planeWide },
  ship: { card: shipCard, wide: shipWide },
  free: { card: freeCard, wide: freeWide },
};

/** On foot's planispheres (scripts/build-title-maps.py: the game's day textures, −180° at the left) */
export const WORLD_MAPS: Record<"earth" | "moon" | "mars", string> = { earth: mapEarth, moon: mapMoon, mars: mapMars };

export const TURNTABLES: Record<VesselChoice, string> = { ranger: turnRanger, lander: turnLander, endurance: turnEndurance };

// By plane's free flight (scripts/showcase-shots.ts, scripts/build-showcase.py): the setting focused shows its picture — the
// aircraft, the airfield, the hour of the day, the weather (null: as it is — the aircraft's; real: the clear sky's)
const AIRCRAFT_ART: Record<Aircraft, string> = { f35: planeF35, a320: planeA320 };
export const aircraftArt = (a: Aircraft) => AIRCRAFT_ART[a] ?? planeWide;
export const FIELD_ART: string = fieldArt;
const HOUR_ART: Partial<Record<Hour, string>> = { dawn: hourDawn, morning: hourMorning, noon: hourNoon, dusk: hourDusk, night: hourNight };
export const hourArt = (h: Hour) => HOUR_ART[h] ?? hourMorning;
const WEATHER_ART: Partial<Record<WeatherPreset, string>> = {
  fair: wxFair,
  real: wxFair,
  cloudy: wxCloudy,
  overcast: wxOvercast,
  rain: wxRain,
  storm: wxStorm,
  windy: wxWindy,
  fog: wxFog,
};
export const weatherArt = (w: WeatherPreset | null) => (w ? WEATHER_ART[w] : undefined) ?? planeF35;

/** the turntables' sheets: 36 views, 10° apart, 6 a row */
const FRAMES = 36;
const COLS = 6;
/** its own pace: a turn in about 9 s [views a second] */
const PACE = 4;

/** The view of a sheet showing a frame (0…35): its background position, the sheet scaled 600 %. */
export function framePosition(frame: number): string {
  const f = ((Math.round(frame) % FRAMES) + FRAMES) % FRAMES;
  const col = f % COLS,
    row = Math.floor(f / COLS);
  return `${(col * 100) / (COLS - 1)}% ${(row * 100) / (FRAMES / COLS - 1)}%`;
}

/**
 * A craft on its turntable: turning on its own, a drag (a finger, a mouse) turning it by hand. It stops when it
 * leaves the page. `set(url)` changes the craft.
 */
export function turntable(url: string): HTMLElement & { set(url: string): void } {
  const el = document.createElement("div") as HTMLDivElement & { set(url: string): void };
  el.className = "tt-turn";
  el.setAttribute("role", "img");
  el.style.backgroundImage = `url("${url}")`;
  el.set = (u: string) => void (el.style.backgroundImage = `url("${u}")`);
  let frame = 0,
    dragX: number | null = null,
    last = performance.now(),
    shown = false;
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const draw = () => void (el.style.backgroundPosition = framePosition(frame));
  const tick = (now: number) => {
    // (its loop ended once it has left the page)
    if (el.isConnected) shown = true;
    else if (shown) return;
    if (dragX === null && !reduce) frame += ((now - last) / 1000) * PACE;
    last = now;
    draw();
    requestAnimationFrame(tick);
  };
  el.addEventListener("pointerdown", (e) => {
    dragX = e.clientX;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (dragX === null) return;
    // (a frame every 8 px: a turn across about 290 px)
    frame -= (e.clientX - dragX) / 8;
    dragX = e.clientX;
  });
  const up = () => void (dragX = null);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  draw();
  requestAnimationFrame(tick);
  return el;
}
