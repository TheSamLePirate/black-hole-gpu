// On foot, on the title (PLAN-TITRE-AAA E6): the world (the Earth, the Moon, Mars), the place on it — one of the
// Atlas's destinations (game/pois.ts), an address or coordinates found by a search, or anywhere chosen on the
// Atlas itself —, the hour of that place's own day (its Sun: a lunar day is a month long), the weather (the
// Earth's). The place chosen on each world and the rest kept from one visit to the next. Data only: the screen is
// ui/title/title.ts's, the walk the game's (TitleGame.stroll).

import { fmtLatLon } from "../../game/geo";
import { POI_KINDS, POIS, type Poi, type PoiKind, searchPois } from "../../game/pois";
import { lang, type Text, tr } from "../../i18n";
import { store } from "../../util/storage";
import type { WeatherPreset } from "../../weather";
import { HOURS, type Hour, WEATHERS } from "./plane";

export type World = "earth" | "moon" | "mars";

/** A place to walk: a destination of the Atlas, an address, coordinates. */
export interface FootPlace {
  id: string;
  name: Text;
  /** [°] geodetic on the Earth (WGS84), planetocentric elsewhere, east positive */
  lat: number;
  lon: number;
  kind?: PoiKind | "address" | "point";
  about?: Text;
}

export interface FootChoice {
  world: World;
  /** the place chosen on each world */
  place: Record<World, FootPlace>;
  hour: Hour;
  /** the Earth's weather (null: as it is) */
  weather: WeatherPreset | null;
}

export const WORLDS: { id: World; name: Text; hint: Text }[] = [
  {
    id: "earth",
    name: { fr: "Terre", en: "Earth" },
    hint: { fr: "Ses sommets, ses merveilles, ses villes", en: "Its summits, its wonders, its cities" },
  },
  {
    id: "moon",
    name: { fr: "Lune", en: "Moon" },
    hint: { fr: "Les sites Apollo, les cratères, les pôles", en: "The Apollo sites, the craters, the poles" },
  },
  {
    id: "mars",
    name: { fr: "Mars", en: "Mars" },
    hint: { fr: "Les rovers, les volcans, les canyons", en: "The rovers, the volcanoes, the canyons" },
  },
];

/** the local (mean solar) hour of each choice of the day [h] — the Flight hub's own */
export const HOUR_OF: Record<Exclude<Hour, "now">, number> = { dawn: 6.2, morning: 9.5, noon: 12.5, dusk: 18.6, night: 22.5 };

/** a destination of the Atlas as a place to walk */
export const placeOf = (p: Poi): FootPlace => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, about: p.about });

const poi = (id: string) => placeOf(POIS.find((p) => p.id === id)!);

const DEFAULT: FootChoice = {
  world: "moon",
  place: {
    earth: {
      id: "lac-blanc",
      name: { fr: "Lac Blanc, face au Mont-Blanc", en: "Lac Blanc, facing Mont Blanc" },
      lat: 45.9794,
      lon: 6.8908,
      kind: "nature",
      about: { fr: "À 2 352 m, le massif en face, de l'autre côté de la vallée", en: "2 352 m up, the range across the valley" },
    },
    moon: poi("apollo-11"),
    mars: poi("curiosity"),
  },
  hour: "now",
  weather: null,
};

const KEY = "kerr.title.foot";

const okPlace = (p: unknown): p is FootPlace => {
  const q = p as FootPlace;
  return !!q && typeof q.id === "string" && !!q.name?.fr && Number.isFinite(q.lat) && Number.isFinite(q.lon) && Math.abs(q.lat) <= 90;
};

/** The walk set up last (kept from one visit to the next), checked. */
export function lastFoot(): FootChoice {
  const s = store.getJSON<Partial<FootChoice>>(KEY, {});
  const c: FootChoice = { ...DEFAULT, place: { ...DEFAULT.place } };
  if (WORLDS.some((w) => w.id === s.world)) c.world = s.world!;
  for (const w of WORLDS) if (okPlace(s.place?.[w.id])) c.place[w.id] = s.place![w.id];
  if (HOURS.some((x) => x.id === s.hour)) c.hour = s.hour!;
  if (WEATHERS.some((x) => x.id === s.weather)) c.weather = s.weather ?? null;
  return c;
}
export const keepFoot = (c: FootChoice) => store.setJSON(KEY, c);

/** A walk's line: the world, the place, the hour, the weather (the Earth's). */
export function footLine(c: FootChoice, l = lang): string {
  const w = WORLDS.find((x) => x.id === c.world)!;
  const parts = [w.name[l], c.place[c.world].name[l], HOURS.find((x) => x.id === c.hour)!.label[l]];
  if (c.world === "earth") parts.push(WEATHERS.find((x) => x.id === c.weather)!.label[l]);
  return parts.join(" — ");
}

/** A place's coordinates in words (N/S, E/W — or the French N/S, E/O). */
export const placeCoords = (p: FootPlace, l = lang) => fmtLatLon(p.lat, p.lon, 3, l === "fr" ? ["N", "S", "E", "O"] : ["N", "S", "E", "W"]);

/** Where a place falls on its world's planisphere (−180° at the left, the north up) [0..1]. */
export const mapPoint = (p: { lat: number; lon: number }) => ({
  x: ((((p.lon + 180) % 360) + 360) % 360) / 360,
  y: (90 - p.lat) / 180,
});

/** The places of a world: its destinations by kind (a search: the best first, no groups). */
export function placesOf(world: World, q = ""): { place: FootPlace; group?: string }[] {
  if (q.trim()) return searchPois(q, POIS, world).map((p) => ({ place: placeOf(p) }));
  const kinds = [...new Set(POIS.filter((p) => p.body === world).map((p) => p.kind))];
  return kinds.flatMap((k) =>
    POIS.filter((p) => p.body === world && p.kind === k).map((p, i) => ({
      place: placeOf(p),
      group: i === 0 ? tr(POI_KINDS[k]) : undefined,
    })),
  );
}

/** a place's kind in words */
export const kindName = (p: FootPlace) =>
  p.kind === "address"
    ? tr({ fr: "Adresse", en: "Address" })
    : p.kind === "point"
      ? tr({ fr: "Coordonnées", en: "Coordinates" })
      : p.kind
        ? tr(POI_KINDS[p.kind])
        : "";
