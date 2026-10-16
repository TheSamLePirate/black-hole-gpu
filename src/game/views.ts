// The views of exception (docs/PLAN-AVIATION-AAA.md, S2): each scene its place, its hour, its weather and its
// challenge — the total eclipse of 12 August 2026 chased at Mach 1.6 over Iceland as Concorde chased 1973's, at its
// real date; the full Moon rising before a formation; the auroras over the Lofoten's fjords; the sunset on the
// carrier; the Grand Canyon, Monument Valley, the Mach Loop, Star Wars Canyon; the fjords, the Himalaya, Patagonia,
// Iceland's volcanoes; a storm at sea and a deck to land on. Each a mission (game/mission.ts) made when flown — its
// hour found by the ephemeris (the next full Moon's rising, tonight's darkness, today's sunset) —, or one of the
// challenges already given (the Mach Loop, Rainbow Canyon). Their words in the language of the moment.

import { altitudeAt, azAltAt, lunations, solarEclipses, solarPath } from "../eclipse/earth-moon";
import { tr } from "../i18n";
import type { GeoPt, MissionSpec, Zone } from "./mission";

const L = (fr: string, en: string) => tr({ fr, en });
const D = Math.PI / 180;
const MIN = 60_000;
const HOUR = 3_600_000;

export interface ExceptionalView {
  id: string;
  title: string;
  place: string;
  /** its hour and weather in words */
  when: string;
  weather: string;
  /** what is asked */
  challenge: string;
  /** a challenge already given (game/challenges.ts), else a mission made now */
  challengeId?: string;
  make?: (now: number) => MissionSpec;
}

/** When a body crosses a height [°] at a place (rising or setting), first after `from` within `span` [ms]; null:
 *  none. Scanned every 5 minutes, bisected to a few seconds. */
export function whenAltitude(
  id: string,
  lat: number,
  lon: number,
  deg: number,
  from: number,
  rising: boolean,
  span = 36 * HOUR,
): number | null {
  const f = (t: number) => altitudeAt(id, lat * D, lon * D, 0, t) - deg;
  let t0 = from;
  let f0 = f(t0);
  for (let t1 = from + 5 * MIN; t1 <= from + span; t1 += 5 * MIN) {
    const f1 = f(t1);
    if (rising ? f0 < 0 && f1 >= 0 : f0 > 0 && f1 <= 0) {
      let a = t0,
        b = t1;
      for (let k = 0; k < 14; k++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (rising ? fm < 0 : fm > 0) a = m;
        else b = m;
      }
      return (a + b) / 2;
    }
    t0 = t1;
    f0 = f1;
  }
  return null;
}

/** The point `d` [m] from a place on a bearing [°]. */
function ahead(p: GeoPt, bearing: number, d: number): GeoPt {
  return {
    lat: p.lat + (d * Math.cos(bearing * D)) / (D * 6_371_008.8),
    lon: p.lon + (d * Math.sin(bearing * D)) / (D * 6_371_008.8 * Math.cos(p.lat * D)),
  };
}
const bearingOf = (a: GeoPt, b: GeoPt) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * D), b.lat - a.lat) / D + 360) % 360;
const gates = (pts: [number, number][], radius: number): Zone[] => pts.map(([lat, lon]) => ({ lat, lon, radius }));
const iso = (ms: number) => new Date(ms).toISOString();

/** A scenic way's mission: its start, its hour, its weather, its gates flown low. */
function routeMission(o: {
  id: string;
  title: string;
  brief: string;
  start: MissionSpec["start"];
  localHour?: number;
  utc?: number;
  weather: MissionSpec["weather"];
  gates: Zone[];
  below?: number;
  text: string;
  limit?: number;
  aurora?: number;
}): MissionSpec {
  return {
    v: 1,
    id: o.id,
    title: o.title,
    brief: o.brief,
    start: o.start,
    time: o.utc !== undefined ? { utc: iso(o.utc) } : { localHour: o.localHour },
    weather: { ...o.weather, aurora: o.aurora },
    units: [],
    objectives: [{ id: "route", kind: "route", gates: o.gates, below: o.below, text: o.text }],
    limit: o.limit ?? 1200,
  };
}

/** The total eclipse of 12 August 2026: its greatest moment, where, the shadow's way there. */
function eclipse2026() {
  const e = solarEclipses(Date.UTC(2026, 7, 12), Date.UTC(2026, 7, 13)).find((x) => x.type === "total");
  if (!e) return null;
  const path = solarPath(e, MIN);
  const c0 = e.contacts.find((c) => c.name === "C1");
  if (!c0 || path.centre.length < 3) return null;
  // (the centre line's point nearest the greatest moment, the next one: the shadow's heading there)
  const k = Math.min(Math.max(Math.round((e.t - c0.t - 1000) / MIN), 0), path.centre.length - 2);
  const [la, lo] = path.centre[k]!;
  const [lb, lob] = path.centre[k + 1]!;
  return {
    t: c0.t + 1000 + k * MIN,
    at: { lat: la, lon: lo },
    hdg: bearingOf({ lat: la, lon: lo }, { lat: lb, lon: lob }),
    duration: e.greatest.duration,
  };
}

export const VIEWS: ExceptionalView[] = [
  {
    id: "view-eclipse",
    title: L("Poursuivre l'éclipse du 12 août 2026", "Chasing the eclipse of 12 August 2026"),
    place: L("Islande, au-dessus de l'Atlantique Nord", "Iceland, over the North Atlantic"),
    when: L("12 août 2026, 17 h 45 UTC — sa vraie date", "12 August 2026, 17:45 UTC — its real date"),
    weather: L("Ciel clair, 15 000 m", "Clear sky, 15 000 m"),
    challenge: L(
      "Rester trois minutes dans la totalité à Mach 1,6, comme Concorde en 1973",
      "Stay three minutes in totality at Mach 1.6, as Concorde did in 1973",
    ),
    make: () => {
      const E = eclipse2026();
      // (offline of the ephemeris: its greatest point as published)
      const at = E?.at ?? { lat: 65.2, lon: -25.2 };
      const t = E?.t ?? Date.UTC(2026, 7, 12, 17, 46);
      const hdg = E?.hdg ?? 120;
      return {
        v: 1,
        id: "view-eclipse",
        title: L("Poursuivre l'éclipse du 12 août 2026", "Chasing the eclipse of 12 August 2026"),
        brief: L(
          "Le 30 juin 1973, le Concorde 001 a suivi l'ombre de la Lune 74 minutes à Mach 2. Le F-35 ne va qu'à Mach 1,6 : partez sur la ligne de centralité juste avant l'ombre, cap sur sa course, et restez dedans le plus longtemps possible.",
          "On 30 June 1973 Concorde 001 rode the Moon's shadow for 74 minutes at Mach 2. The F-35 only reaches Mach 1.6: start on the central line just ahead of the shadow, along its course, and stay in it as long as you can.",
        ),
        start: { lat: at.lat, lon: at.lon, alt: 15_000, hdg, speed: 470, variant: "B", loadout: "gun" },
        time: { utc: iso(t - 120_000) },
        weather: { preset: "fair", wind: 1, clouds: 0 },
        units: [],
        objectives: [
          { id: "totality", kind: "eclipse", seconds: 180, text: L("Trois minutes dans la totalité", "Three minutes in totality") },
        ],
        limit: 900,
      };
    },
  },
  {
    id: "view-moonrise",
    title: L("Le lever de la pleine Lune en patrouille", "The full Moon rising before a formation"),
    place: L("Le Mont-Saint-Michel", "Mont-Saint-Michel"),
    when: L("La prochaine pleine Lune, à son lever", "The next full Moon, as it rises"),
    weather: L("Beau temps", "Fair"),
    challenge: L("Tenir la patrouille une minute face à la Lune", "Hold the formation for a minute towards the Moon"),
    make: (now) => {
      const at = { lat: 48.636, lon: -1.511 };
      const full = lunations(now, now + 35 * 24 * HOUR, true)[0] ?? now;
      const rise = whenAltitude("moon", at.lat, at.lon, 0.5, full - 14 * HOUR, true) ?? full;
      // (a quarter of an hour on: 3–4° up — lower, its light through the whole air is too dimmed to stand out)
      const t = rise + 14 * MIN;
      const az = azAltAt("moon", at.lat * D, at.lon * D, 0, t).az;
      const start = ahead(at, az + 180, 9000);
      return {
        v: 1,
        id: "view-moonrise",
        title: L("Le lever de la pleine Lune en patrouille", "The full Moon rising before a formation"),
        brief: L(
          "Deux équipiers en échelon, la baie du Mont-Saint-Michel sous vous : la pleine Lune se lève droit devant. Tenez la patrouille une minute — le moment de la photo.",
          "Two wingmen in echelon, the bay of Mont-Saint-Michel beneath: the full Moon rises dead ahead. Hold the formation for a minute — the moment for the photograph.",
        ),
        start: { ...start, alt: 900, hdg: az, speed: 170, variant: "B", loadout: "gun", wingmen: 2, formation: "echelonR" },
        time: { utc: iso(t) },
        weather: { preset: "fair", wind: 1, clouds: 0.1 },
        units: [],
        objectives: [
          {
            id: "form",
            kind: "formation",
            wingmen: 2,
            seconds: 60,
            text: L("Tenir la patrouille face à la Lune", "Hold the formation towards the Moon"),
          },
        ],
        limit: 900,
      };
    },
  },
  {
    id: "view-aurora",
    title: L("Les aurores sur les fjords des Lofoten", "The auroras over the Lofoten's fjords"),
    place: L("Trollfjord, Norvège", "Trollfjord, Norway"),
    when: L("Cette nuit, une heure après le crépuscule", "Tonight, an hour after dusk"),
    weather: L("Ciel clair, aurores Kp 4", "Clear sky, auroras at Kp 4"),
    challenge: L("Remonter le fjord à moins de 400 m sous les aurores", "Fly up the fjord below 400 m under the auroras"),
    make: (now) => {
      const at = { lat: 68.3, lon: 14.3 };
      const dark = whenAltitude("sun", at.lat, at.lon, -12, now - 2 * HOUR, false) ?? now;
      return routeMission({
        id: "view-aurora",
        title: L("Les aurores sur les fjords des Lofoten", "The auroras over the Lofoten's fjords"),
        brief: L(
          "Nuit noire au-dessus des Lofoten, l'ovale auroral au-dessus de vous : remontez les fjords jusqu'au Trollfjord, bas, sous les rideaux verts.",
          "A dark night over the Lofoten, the auroral oval overhead: fly up the fjords to the Trollfjord, low, under the green curtains.",
        ),
        start: { lat: 68.25, lon: 14.1, alt: 700, hdg: 60, speed: 170, variant: "B", loadout: "gun" },
        utc: dark + HOUR,
        weather: { preset: "fair", wind: 1, clouds: 0.05 },
        aurora: 4,
        gates: gates(
          [
            [68.3, 14.4],
            [68.36, 14.7],
            [68.37, 14.95],
            [68.35, 15.25],
          ],
          2500,
        ),
        below: 400,
        text: L("Les fjords sous les aurores", "The fjords under the auroras"),
      });
    },
  },
  {
    id: "view-sunset-carrier",
    title: L("Le coucher de soleil sur le porte-avions", "Sunset on the carrier"),
    place: L("Le Ford, au large de la Provence", "The Ford, off Provence"),
    when: L("Ce soir, le Soleil à 2° au-dessus de l'horizon", "This evening, the Sun 2° over the horizon"),
    weather: L("Beau temps, mer calme", "Fair, a calm sea"),
    challenge: L("Apponter face au soleil couchant", "Land aboard into the setting Sun"),
    make: (now) => {
      const ford = { lat: 42.6, lon: 7.4 };
      const sun = whenAltitude("sun", ford.lat, ford.lon, 2, now - 6 * HOUR, false) ?? now;
      return {
        v: 1,
        id: "view-sunset-carrier",
        title: L("Le coucher de soleil sur le porte-avions", "Sunset on the carrier"),
        brief: L(
          "Le Gerald R. Ford fait route à l'ouest, droit sur le soleil couchant. Votre F-35C est à 9 km sur l'arrière : le ball, l'alignement, le brin — dans la lumière dorée.",
          "The Gerald R. Ford steams west, straight into the setting Sun. Your F-35C is 9 km astern: the ball, the line-up, the wire — in the golden light.",
        ),
        start: { lat: 42.6, lon: 7.51, alt: 450, hdg: 270, speed: 140, variant: "C", loadout: "aa", fuel: 0.4 },
        time: { utc: iso(sun - 6 * MIN) },
        weather: { preset: "fair", wind: 1, clouds: 0.2 },
        units: [{ id: "ford", kind: "carrier", carrier: "ford", at: ford, hdg: 270 }],
        objectives: [{ id: "trap", kind: "land", carrier: "ford", text: L("Apponter sur le Ford", "Land aboard the Ford") }],
        limit: 900,
      };
    },
  },
  {
    id: "view-grand-canyon",
    title: L("Le Grand Canyon", "The Grand Canyon"),
    place: L("Arizona, le Colorado", "Arizona, the Colorado"),
    when: L("La fin d'après-midi, 18 h", "Late afternoon, 6 pm"),
    weather: L("Beau temps", "Fair"),
    challenge: L(
      "Suivre le Colorado sous le rebord, à moins de 1 200 m du fond",
      "Follow the Colorado below the rim, within 1 200 m of the bottom",
    ),
    make: () =>
      routeMission({
        id: "view-grand-canyon",
        title: L("Le Grand Canyon", "The Grand Canyon"),
        brief: L(
          "Descendez dans le Grand Canyon et suivez le Colorado vers l'ouest, sous le rebord, la lumière rasante sur les falaises.",
          "Drop into the Grand Canyon and follow the Colorado west, below the rim, the low light on the cliffs.",
        ),
        start: { lat: 36.2, lon: -111.65, alt: 2400, hdg: 250, speed: 200, variant: "B", loadout: "gun" },
        localHour: 18,
        weather: { preset: "fair", wind: 1, clouds: 0.1 },
        gates: gates(
          [
            [36.19, -111.8],
            [36.1, -111.96],
            [36.1, -112.09],
            [36.11, -112.2],
            [36.16, -112.33],
          ],
          3000,
        ),
        below: 1200,
        text: L("Les portes du Grand Canyon", "The Grand Canyon's gates"),
      }),
  },
  {
    id: "view-monument-valley",
    title: L("Monument Valley", "Monument Valley"),
    place: L("Utah – Arizona, les Mittens", "Utah – Arizona, the Mittens"),
    when: L("Au coucher du soleil", "At sunset"),
    weather: L("Beau temps", "Fair"),
    challenge: L("Contourner les buttes à moins de 200 m du sol", "Weave round the buttes below 200 m"),
    make: () =>
      routeMission({
        id: "view-monument-valley",
        title: L("Monument Valley", "Monument Valley"),
        brief: L(
          "Les Mittens et Merrick Butte dans la lumière du soir : passez entre elles, bas, d'une porte à l'autre.",
          "The Mittens and Merrick Butte in the evening light: pass between them, low, from gate to gate.",
        ),
        start: { lat: 36.92, lon: -110.18, alt: 1900, hdg: 30, speed: 170, variant: "B", loadout: "gun" },
        localHour: 18.5,
        weather: { preset: "fair", wind: 1, clouds: 0.1 },
        gates: gates(
          [
            [36.97, -110.13],
            [36.986, -110.102],
            [37.0, -110.08],
            [36.99, -110.05],
          ],
          1200,
        ),
        below: 200,
        text: L("Les portes de Monument Valley", "Monument Valley's gates"),
      }),
  },
  {
    id: "view-mach-loop",
    title: L("La Mach Loop", "The Mach Loop"),
    place: L("Pays de Galles", "Wales"),
    when: L("Le défi existant", "The challenge as given"),
    weather: L("La météo du jour", "The day's weather"),
    challenge: L("Le circuit des vallées galloises, bas et vite", "The Welsh valleys' circuit, low and fast"),
    challengeId: "machloop",
  },
  {
    id: "view-star-wars-canyon",
    title: L("Le Star Wars Canyon", "Star Wars Canyon"),
    place: L("Rainbow Canyon, Death Valley", "Rainbow Canyon, Death Valley"),
    when: L("Le défi existant", "The challenge as given"),
    weather: L("La météo du jour", "The day's weather"),
    challenge: L("Le canyon où passent les chasseurs, sous les photographes", "The canyon the fighters fly, under the photographers"),
    challengeId: "rainbow",
  },
  {
    id: "view-fjords",
    title: L("Le Geirangerfjord", "The Geirangerfjord"),
    place: L("Norvège", "Norway"),
    when: L("L'après-midi, 15 h", "Afternoon, 3 pm"),
    weather: L("Quelques nuages", "A few clouds"),
    challenge: L("Remonter le fjord à moins de 300 m au-dessus de l'eau", "Fly up the fjord below 300 m over the water"),
    make: () =>
      routeMission({
        id: "view-fjords",
        title: L("Le Geirangerfjord", "The Geirangerfjord"),
        brief: L(
          "Des falaises de 1 500 m, les cascades des Sept Sœurs : remontez le Geirangerfjord de Hellesylt à Geiranger, au ras de l'eau.",
          "Cliffs 1 500 m high, the Seven Sisters falls: fly up the Geirangerfjord from Hellesylt to Geiranger, over the water.",
        ),
        start: { lat: 62.08, lon: 6.8, alt: 500, hdg: 80, speed: 160, variant: "B", loadout: "gun" },
        localHour: 15,
        weather: { preset: "cloudy", wind: 1, clouds: 0.4 },
        gates: gates(
          [
            [62.085, 6.9],
            [62.11, 6.98],
            [62.115, 7.08],
            [62.1, 7.18],
          ],
          1200,
        ),
        below: 300,
        text: L("Les portes du fjord", "The fjord's gates"),
      }),
  },
  {
    id: "view-himalaya",
    title: L("L'Himalaya, de l'Ama Dablam à l'Everest", "The Himalaya, from Ama Dablam to Everest"),
    place: L("Khumbu, Népal", "Khumbu, Nepal"),
    when: L("Le matin, 7 h 30", "Morning, 7:30"),
    weather: L("Ciel pur", "A clear sky"),
    challenge: L(
      "Passer l'Ama Dablam, le Lhotse, puis entre l'Everest et le Nuptse",
      "Pass Ama Dablam, Lhotse, then between Everest and Nuptse",
    ),
    make: () =>
      routeMission({
        id: "view-himalaya",
        title: L("L'Himalaya, de l'Ama Dablam à l'Everest", "The Himalaya, from Ama Dablam to Everest"),
        brief: L(
          "La lumière du matin sur le toit du monde : de l'Ama Dablam, remontez la vallée du Khumbu, passez le Lhotse puis entre l'Everest et le Nuptse, à 8 000 m.",
          "The morning light on the roof of the world: from Ama Dablam, fly up the Khumbu valley, past Lhotse, then between Everest and Nuptse at 8 000 m.",
        ),
        start: { lat: 27.78, lon: 86.75, alt: 7500, hdg: 40, speed: 200, variant: "B", loadout: "gun" },
        localHour: 7.5,
        weather: { preset: "fair", wind: 1, clouds: 0 },
        gates: gates(
          [
            [27.86, 86.83],
            [27.94, 86.9],
            [27.975, 86.91],
            [28.02, 86.95],
          ],
          3000,
        ),
        text: L("Les portes de l'Himalaya", "The Himalaya's gates"),
      }),
  },
  {
    id: "view-patagonia",
    title: L("Les tours du Paine", "The towers of Paine"),
    place: L("Patagonie chilienne", "Chilean Patagonia"),
    when: L("Le soir, 20 h", "Evening, 8 pm"),
    weather: L("Venteux", "Windy"),
    challenge: L("Longer les Cuernos et les Torres à moins de 900 m du sol", "Skirt the Cuernos and the Torres below 900 m"),
    make: () =>
      routeMission({
        id: "view-patagonia",
        title: L("Les tours du Paine", "The towers of Paine"),
        brief: L(
          "Le vent de Patagonie, les Cuernos noirs et blancs, les trois Torres de granit : longez le massif du sud au nord, bas.",
          "The Patagonian wind, the black-and-white Cuernos, the three granite Torres: skirt the massif from south to north, low.",
        ),
        start: { lat: -51.15, lon: -72.85, alt: 1500, hdg: 340, speed: 180, variant: "B", loadout: "gun" },
        localHour: 20,
        weather: { preset: "windy", wind: 2, clouds: 0.3 },
        gates: gates(
          [
            [-51.05, -72.95],
            [-50.98, -72.98],
            [-50.94, -72.94],
            [-50.9, -72.95],
          ],
          2000,
        ),
        below: 900,
        text: L("Les portes du Paine", "Paine's gates"),
      }),
  },
  {
    id: "view-iceland",
    title: L("Les volcans d'Islande", "Iceland's volcanoes"),
    place: L("L'Eyjafjallajökull, le Katla, l'Hekla", "Eyjafjallajökull, Katla, Hekla"),
    when: L("Le jour, 13 h", "Midday, 1 pm"),
    weather: L("Quelques nuages", "A few clouds"),
    challenge: L("Passer les trois volcans", "Pass the three volcanoes"),
    make: () =>
      routeMission({
        id: "view-iceland",
        title: L("Les volcans d'Islande", "Iceland's volcanoes"),
        brief: L(
          "Des glaciers sur des volcans : l'Eyjafjallajökull de 2010, le Katla sous le Mýrdalsjökull, puis l'Hekla, la « porte de l'enfer ».",
          "Glaciers on volcanoes: 2010's Eyjafjallajökull, Katla under Mýrdalsjökull, then Hekla, the 'gateway to hell'.",
        ),
        start: { lat: 63.5, lon: -20.2, alt: 2500, hdg: 60, speed: 200, variant: "B", loadout: "gun" },
        localHour: 13,
        weather: { preset: "cloudy", wind: 1, clouds: 0.35 },
        gates: gates(
          [
            [63.63, -19.62],
            [63.63, -19.1],
            [63.99, -19.67],
          ],
          3500,
        ),
        text: L("Les volcans", "The volcanoes"),
      }),
  },
  {
    id: "view-storm-carrier",
    title: L("La tempête et l'appontage", "The storm and the deck"),
    place: L("Le Ford, golfe du Lion", "The Ford, Gulf of Lion"),
    when: L("L'après-midi, 14 h", "Afternoon, 2 pm"),
    weather: L("Tempête, houle de 4,4 m", "A storm, a 4.4 m swell"),
    challenge: L("Apponter sur un pont qui tangue", "Land on a pitching deck"),
    make: () => ({
      v: 1,
      id: "view-storm-carrier",
      title: L("La tempête et l'appontage", "The storm and the deck"),
      brief: L(
        "Coup de mistral sur le golfe du Lion : le Ford tangue dans une houle de 4,4 m, la pluie bat la verrière. Votre F-35C est à 9 km sur l'arrière, le carburant compté.",
        "A mistral gale over the Gulf of Lion: the Ford pitches in a 4.4 m swell, the rain lashes the canopy. Your F-35C is 9 km astern, its fuel counted.",
      ),
      start: { lat: 42.6, lon: 7.51, alt: 450, hdg: 270, speed: 140, variant: "C", loadout: "aa", fuel: 0.3 },
      time: { localHour: 14 },
      weather: { preset: "storm", wind: 3, clouds: 0.9, swell: 4.4 },
      units: [{ id: "ford", kind: "carrier", carrier: "ford", at: { lat: 42.6, lon: 7.4 }, hdg: 270 }],
      objectives: [{ id: "trap", kind: "land", carrier: "ford", text: L("Apponter dans la tempête", "Land aboard in the storm") }],
      limit: 900,
    }),
  },
];

/** A view's mission now (null: a challenge's). */
export const viewSpec = (id: string, now = Date.now()): MissionSpec | null => VIEWS.find((v) => v.id === id)?.make?.(now) ?? null;
