// By plane, on the title (PLAN-TITRE-AAA E4): what each of its tabs offers — a free flight set up (the airfield, the
// start, the hour of its day, the weather, the fuel: the Flight hub's own choices, ui/flighthub.ts prepareFlight),
// the combat (the air missions and the fights), the flight school (its lessons, watched, tried or guided), the
// challenges (the courses, the landings, the figures and the aerobatic box, with the best marks kept). Data only:
// the screen is ui/title/title.ts's, the launches the game's (TitleGame).

import { AIR_MISSIONS } from "../../game/airmissions";
import { FIGURE_ORDER, FIGURES } from "../../game/aerobatics";
import { CHALLENGES } from "../../game/challenges";
import { LESSONS } from "../../game/lessons";
import { SCENARIOS } from "../../game/scenarios";
import { SITES } from "../../game/sites";
import { lang, t, type Text, tr } from "../../i18n";
import { store } from "../../util/storage";
import type { WeatherPreset } from "../../weather";

export type Start = "runway" | "final" | "cruise";
export type Hour = "now" | "dawn" | "morning" | "noon" | "dusk" | "night";
export type LessonHow = "demo" | "try" | "guided";
export type FigureHow = "fly" | "watch";
export type Aircraft = "f35" | "a320";

/** the aircraft a free flight is flown in: its name, its line */
export const AIRCRAFT: { id: Aircraft; label: Text; text: Text }[] = [
  {
    id: "f35",
    label: { fr: "F-35B Lightning II", en: "F-35B Lightning II" },
    text: {
      fr: "Chasseur furtif à décollage court et atterrissage vertical : poste de pilotage complet, casque, armement, ravitaillement en vol.",
      en: "Short take-off, vertical landing stealth fighter: the full cockpit, the helmet, the weapons, air refuelling.",
    },
  },
  {
    id: "a320",
    label: { fr: "Airbus A320", en: "Airbus A320" },
    text: {
      fr: "L'avion de ligne : écrans du poste, pilote automatique, MCDU, ECAM, vol d'aéroport en aéroport.",
      en: "The airliner: the flight deck's displays, the autopilot, the MCDU, the ECAM, from airport to airport.",
    },
  },
];

/** A free flight's set-up (the Flight hub's FlightSetup: the weather null keeps it as it is). */
export interface FlightChoice {
  /** the aircraft flown */
  aircraft: Aircraft;
  /** the airfield: a site's id (ICAO or name) or any airport's code of the world (names.json, siteByName) */
  field: string;
  /** that airport's name as found (shown; none: the site's own) */
  fieldName?: string;
  start: Start;
  hour: Hour;
  weather: WeatherPreset | null;
  fuel: number;
}

/** the airfields a flight starts from (the Earth's runways), by name, their ICAO */
export const FIELDS = SITES.filter((s) => s.body === "earth" && s.runway).map((s) => ({
  id: s.icao ?? s.name,
  name: s.name,
  icao: s.icao ?? null,
}));

export const STARTS: { id: Start; label: Text }[] = [
  { id: "runway", label: { fr: "Sur la piste", en: "On the runway" } },
  { id: "final", label: { fr: "En finale (15 km)", en: "On final (15 km)" } },
  { id: "cruise", label: { fr: "En croisière (40 km)", en: "Cruising (40 km out)" } },
];
export const HOURS: { id: Hour; label: Text }[] = [
  { id: "now", label: { fr: "Maintenant", en: "Now" } },
  { id: "dawn", label: { fr: "Aube", en: "Dawn" } },
  { id: "morning", label: { fr: "Matin", en: "Morning" } },
  { id: "noon", label: { fr: "Midi", en: "Noon" } },
  { id: "dusk", label: { fr: "Crépuscule", en: "Dusk" } },
  { id: "night", label: { fr: "Nuit", en: "Night" } },
];
export const WEATHERS: { id: WeatherPreset | null; label: Text }[] = [
  { id: null, label: { fr: "Telle quelle", en: "As it is" } },
  { id: "real", label: { fr: "Réelle (METAR)", en: "Real (METAR)" } },
  { id: "fair", label: { fr: "Clair", en: "Fair" } },
  { id: "cloudy", label: { fr: "Nuageux", en: "Cloudy" } },
  { id: "overcast", label: { fr: "Couvert", en: "Overcast" } },
  { id: "rain", label: { fr: "Pluie", en: "Rain" } },
  { id: "storm", label: { fr: "Orage", en: "Storm" } },
  { id: "windy", label: { fr: "Vent fort", en: "Strong wind" } },
  { id: "fog", label: { fr: "Brouillard", en: "Fog" } },
];
export const FUELS = [0.25, 0.5, 0.75, 1];

const KEY = "kerr.title.flight";
const DEFAULT: FlightChoice = { aircraft: "f35", field: "KEDW", start: "runway", hour: "now", weather: null, fuel: 1 };

/** The free flight set up last (kept from one visit to the next), checked against the lists. */
export function lastFlight(): FlightChoice {
  const s = { ...DEFAULT, ...store.getJSON<Partial<FlightChoice>>(KEY, {}) };
  if (!AIRCRAFT.some((a) => a.id === s.aircraft)) s.aircraft = DEFAULT.aircraft;
  // (a site's, or any airport's code kept with its name)
  if (typeof s.field !== "string" || !s.field || (!FIELDS.some((f) => f.id === s.field) && !s.fieldName)) {
    s.field = FIELDS.find((f) => f.id === DEFAULT.field)?.id ?? FIELDS[0]!.id;
    s.fieldName = undefined;
  }
  if (!STARTS.some((x) => x.id === s.start)) s.start = DEFAULT.start;
  if (!HOURS.some((x) => x.id === s.hour)) s.hour = DEFAULT.hour;
  if (!WEATHERS.some((x) => x.id === s.weather)) s.weather = DEFAULT.weather;
  if (!FUELS.includes(s.fuel)) s.fuel = DEFAULT.fuel;
  return s;
}
export const keepFlight = (c: FlightChoice) => store.setJSON(KEY, c);

/** The next or previous of a list (a selector's ◂ ▸), round. */
export function cycle<T>(list: readonly T[], now: T, step: number): T {
  const i = Math.max(0, list.indexOf(now));
  return list[(i + step + list.length * 4) % list.length]!;
}

/** A free flight's airfield as shown: its code · its name. */
export function fieldLabel(c: FlightChoice): string {
  const f = FIELDS.find((x) => x.id === c.field);
  if (f) return `${f.icao ? `${f.icao} · ` : ""}${f.name}`;
  return c.fieldName ? `${c.field} · ${c.fieldName}` : c.field;
}

/** A free flight's line: the aircraft, the field, the start, the hour, the weather, the fuel. */
export function flightLine(c: FlightChoice, l = lang): string {
  const pick = <T extends { id: unknown; label: Text }>(xs: T[], id: unknown) => xs.find((x) => x.id === id)?.label[l] ?? "";
  return [
    pick(AIRCRAFT, c.aircraft),
    fieldLabel(c),
    pick(STARTS, c.start),
    pick(HOURS, c.hour),
    pick(WEATHERS, c.weather),
    `${Math.round(c.fuel * 100)} % ${l === "fr" ? "de carburant" : "fuel"}`,
  ].join(" — ");
}

/** an entry of a list tab: its title, its text, a mark (a best result) */
export interface PlaneItem {
  id: string;
  title: string;
  text: string;
  mark?: string;
  /** a group's first entry: the group's name over it */
  group?: string;
}

const L = (x: Text) => tr(x);

/** Combat: the air missions, then the fights. */
export function combatItems(): PlaneItem[] {
  const missions = AIR_MISSIONS.map((m, i) => {
    const s = m.make();
    return { id: `mission:${m.id}`, title: s.title, text: s.brief, group: i === 0 ? L({ fr: "Missions", en: "Missions" }) : undefined };
  });
  const fights = SCENARIOS.map((d, i) => ({
    id: `fight:${d.id}`,
    title: tr(d.title),
    text: tr(d.brief),
    group: i === 0 ? L({ fr: "Combats libres", en: "Free fights" }) : undefined,
  }));
  return [...missions, ...fights];
}

/** The flight school's lessons. */
export function lessonItems(): PlaneItem[] {
  return LESSONS.map((x) => ({ id: `lesson:${x.id}`, title: t(x.title), text: t(x.summary) }));
}

/** Challenges: the courses and landings (their best medal), the figures (their best /20), the aerobatic box. */
export function challengeItems(): PlaneItem[] {
  const B = store.getJSON<Record<string, { score: number; medal?: string | null }>>("kerr.challenges", {});
  const A = store.getJSON<Record<string, number>>("kerr.aero.best", {});
  const medal: Record<string, Text> = {
    gold: { fr: "or", en: "gold" },
    silver: { fr: "argent", en: "silver" },
    bronze: { fr: "bronze", en: "bronze" },
  };
  const chal = CHALLENGES.map((d, i) => ({
    id: `challenge:${d.id}`,
    title: tr(d.title),
    text: tr(d.brief),
    mark: B[d.id]?.medal ? tr(medal[B[d.id]!.medal!] ?? { fr: B[d.id]!.medal!, en: B[d.id]!.medal! }) : undefined,
    group: i === 0 ? L({ fr: "Défis", en: "Challenges" }) : undefined,
  }));
  const figs = FIGURE_ORDER.map((id, i) => ({
    id: `figure:${id}`,
    title: t(FIGURES[id].name),
    text: t(FIGURES[id].brief),
    mark: A[id] !== undefined ? `${A[id]!.toFixed(1)}/20` : undefined,
    group: i === 0 ? L({ fr: "Voltige", en: "Aerobatics" }) : undefined,
  }));
  const box = {
    id: "figure:box",
    title: L({ fr: "Le box de voltige", en: "The aerobatic box" }),
    text: L({ fr: "Cinq figures d'affilée, chacune jugée, notées sur 100", en: "Five figures in a row, each judged, marked out of 100" }),
    mark: A.box !== undefined ? `${A.box.toFixed(0)}/100` : undefined,
  };
  return [...chal, ...figs, box];
}

export const LESSON_HOWS: { id: LessonHow; label: Text }[] = [
  { id: "guided", label: { fr: "Guidée", en: "Guided" } },
  { id: "demo", label: { fr: "Démonstration", en: "Demonstration" } },
  { id: "try", label: { fr: "Essai noté", en: "Graded try" } },
];
export const FIGURE_HOWS: { id: FigureHow; label: Text }[] = [
  { id: "fly", label: { fr: "La voler, jugée", en: "Fly it, judged" } },
  { id: "watch", label: { fr: "La regarder", en: "Watch it" } },
];

/** an airport of the world found by name (names.json — scripts/build-airport-names.ts) */
export interface AirportHit {
  /** the code the flight is set up with (ICAO, else the local ident) */
  id: string;
  name: string;
  /** its codes and town, its longest runway */
  line: string;
  large: boolean;
}
type NameRow = [string, string, string, string, string, number, number, number, number, number];
let names: Promise<NameRow[]> | null = null;
/** the world's large and medium airports, loaded once (served with the runways' tiles) */
function airportNames(): Promise<NameRow[]> {
  // (a failed load not kept: tried again at the next search — offline, then online)
  names ??= fetch("runways/v1/names.json")
    .then((r) => (r.ok ? r.json() : { a: [] }))
    .then((j: { a: NameRow[] }) => j.a ?? [])
    .catch(() => [] as NameRow[])
    .then((a) => {
      if (!a.length) names = null;
      return a;
    });
  return names;
}
const fold = (x: string) =>
  x
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
/**
 * The airports matching a few letters — a code (ICAO, IATA, ident) first, then a name or a town —, the large first; any
 * other code of the world typed whole is kept as it is (siteByName finds it at the launch). `max` at most.
 */
export async function airportSearch(q: string, max = 60): Promise<AirportHit[]> {
  const n = fold(q.trim());
  const rows = await airportNames();
  const hit = (r: NameRow): AirportHit => ({
    id: r[1] || r[0],
    name: r[3],
    line: [[r[1] || r[0], r[2]].filter(Boolean).join(" / "), r[4], `${(r[8] / 1000).toFixed(1)} km`].filter(Boolean).join(" · "),
    large: r[5] === 0,
  });
  if (!n) return rows.slice(0, max).map(hit);
  const code = rows.filter((r) => fold(r[1]) === n || fold(r[2]) === n || fold(r[0]) === n);
  const starts = rows.filter(
    (r) => !code.includes(r) && (fold(r[1]).startsWith(n) || fold(r[3]).startsWith(n) || fold(r[4]).startsWith(n)),
  );
  const inside =
    n.length < 3 ? [] : rows.filter((r) => !code.includes(r) && !starts.includes(r) && (fold(r[3]).includes(n) || fold(r[4]).includes(n)));
  return [...code, ...starts, ...inside].slice(0, max).map(hit);
}
