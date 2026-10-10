// TARS's tools (PLAN-TARS-AGENT A2): the whole game, as the agent calls it.
//   - read: the flight's state, the places and runways, the bodies, the weather, the settings, the saves
//     and scenes, the journal, the last flight report, the keys;
//   - fly: the autopilots (a site, a launch goal), the holds, the controls (throttle, gear, flaps, air brake,
//     SAS, the flight law…), go-around, undock, release;
//   - navigate: the target, the flight computer's manoeuvres (planned, executed), a mission to a body;
//   - time, camera and views, the sky, the map and the panels;
//   - teleport (orbit, ground, beside a body, a mouth, a glide onto a runway, a hover), the date;
//   - saves and scenes; the settings (found by words, set checked against the schema); any key;
//   - wait (an autopilot to the end, a landing, an orbit… the game running on); his memory.
// The owner's decision: TARS does everything without asking. The net: before what cannot be undone —
// a load, a deletion, a teleport, the date, a scene — the game is saved as "Before TARS"; undo goes back.
// Every result is short, and carries what the game said (its toasts) since the call.

import type { Auto, Hold } from "../pilot";
import type { CameraController } from "../controls";
import type { Settings, Target } from "../settings";
import type { GameTools } from "../game/tools";
import type { FlightPhase } from "../game/phase";
import type { FlightReport } from "../game/report";
import type { LogEvent } from "../game/log";
import type { TarsMemory } from "./memory";
import type { Tool } from "./agent";
import type { Args } from "./tool-schema";
import { SITES, type Site } from "../game/sites";
import { OpenMeteoFeed, modelWeatherAt } from "../openmeteo";
import { msOfDays } from "../realweather";
import { plan } from "../system/plan-client";
import type { EclipseEvent, EclipseKind } from "../eclipse/search";
import { MISSIONS } from "../game/missions";
import { KEYMAP, type KeyAction } from "../input/keymap";
import { MOUNTS, type Mount } from "../mounts";
import { BODY_NAMES } from "../targeting";
import { SOLAR_BODIES, solarBody } from "../system/solar";
import { FRENCH, tr, type Text } from "../i18n";
import { findSettings, checkSetting } from "./settings-tools";
import { CONSTELLATIONS, NAMED_STARS } from "../skychart";
import {
  circularize,
  setApoapsis,
  setPeriapsis,
  hohmann,
  setInclination,
  matchPlanes,
  resonant,
  transfer,
  matchVelocities,
  fineTune,
  type OpResult,
} from "../fc/ops";
import { alignOverSite } from "../fc/land-ops";
import type { CardSpec } from "../ui/tars/display";
import { EVENT_KINDS, type Triggers, type TriggerKind } from "./triggers";
import { SUBAGENTS_MAX, type SubResult, type SubTask } from "./subagents";
import { type AttitudeSampler, TARS_CHANNELS, TELEMETRY_GROUPS, telemetry, type TarsChannel, type TelemetryGroup } from "./telemetry";
import { liveSeries } from "../ui/tars/display";
import { CHANNELS, type RecKey } from "../game/recorder";

export const UNDO_SAVE = "Before TARS";

/** What the tools reach of the game (built in main.ts, where its closures live). */
export interface GameHost {
  settings: Settings;
  camera: CameraController;
  tools: GameTools;
  /** the flight in a few figures (game/tars.ts TarsState), the phase, the HUD's alerts */
  flight(): object;
  phase(): FlightPhase | null;
  alerts(): { id: string; level: string }[];
  log(): readonly LogEvent[];
  report(): FlightReport | null;
  mission(): { active: boolean; phase: string | null; caption: string | null };
  scenes(): string[];
  pilotAuto(a: Auto): void;
  pilotHold(h: Hold): void;
  autoWhy(a: Auto): string;
  setGear(down: boolean): void;
  toggleAssist(): void;
  releaseControls(): void;
  /** the warp [M/s of scene] through the hub's authority; real time's */
  setWarp(speed: number): void;
  realTimeSpeed(): number;
  playPause(on: boolean): void;
  setMount(m: Mount): void;
  setSpectator(on: boolean): void;
  setView(v: "orbit" | "follow" | "free" | "tripod" | "fall"): void;
  cinematic(c: "orbit" | "dive" | "journey" | null): void;
  lookAt(on: boolean): void;
  telescope(on: boolean): void;
  goTo(b: Target): string | null;
  standOn(b?: Target): string | null;
  skyGoTo(kind: "constellation" | "star", index: number): void;
  map(on: boolean, tab?: "orbit" | "globe" | "map"): void;
  hudDensity(n: 0 | 1 | 2): void;
  open(panel: Panel): void;
  close(): void;
  changed(keys: (keyof Settings)[]): void;
  key(a: KeyAction, arg?: string): void;
  applyScene(name: string): void;
  screenshot(): Promise<unknown>;
  say(text: string): void;
  memory: TarsMemory;
  /** what he shows (ui/tars/display.ts): a card, its id; hide one or all */
  display: { show(spec: CardSpec): number; hide(id?: number): number; list(): { id: number; kind: string; title: string }[] };
  /** a real screen of the game opened (the map's tabs, the tablet's pages, a cockpit display's page, the report) */
  screen(name: Screen, slot?: number): string;
  /** a plan proposed to the pilot (accepted or refused by them, later) */
  propose(p: Proposal): void;
  /** the wait's live line (null: done) */
  progress(text: string | null): void;
  /** his wakings (B1): the rules he sets himself */
  triggers: Triggers;
  /** his task list shown (C4) */
  todos(items: { text: string; status: "pending" | "active" | "done" }[]): void;
  /** his skills (C5): saved requests run by their name */
  skills: { save(name: string, description: string, prompt: string): void };
  /** his own channels sampled while flying (the attitude, the commands): his charts' (B2) */
  sampler: AttitudeSampler;
  /** his sub-agents (B5): questions answered in parallel, reading only */
  subagents(tasks: SubTask[], signal: AbortSignal): Promise<SubResult[]>;
  /** wall time [ms] (the waits) */
  now(): number;
  /** the game's date now [ms UTC] */
  utcNow?(): number;
  /** a multiple exposure made (PLAN-CIEL C8–C10: its dialog opened, the series run): how many exposures, or null */
  multiExposure?(r: import("../ui/multiexposure").MxRequest): Promise<{ rendered: number } | null>;
  /** the ISS's visible passes from a place over days from a date (photo/iss-pass.ts) */
  issPasses?(lat: number, lon: number, from: number, days: number): import("../photo/iss-pass").IssPass[];
  /** taken to see an eclipse (PLAN-CIEL C7): the one of that kind nearest a date (within 3 days), from a place
   *  if it is seen there, else from where it is best; its id, or null: none */
  seeEclipse?(kind: "solar" | "lunar" | "transit", t: number, place: { lat: number; lon: number } | null): Promise<string | null>;
  /** the clouds of the day drawn over the Earth (the real weather's satellite mosaic: its date, its layer), or null */
  dayClouds?(): { date: string; layer: string } | null;
}

export const SCREENS = [
  "map_3d",
  "map_globe",
  "map_planisphere",
  "telemetry",
  "approach_chart",
  "flight_computer",
  "ship",
  "log",
  "flight_report",
  "eclipses",
  "cockpit_pfd",
  "cockpit_orbit",
  "cockpit_nav",
  "cockpit_systems",
  "cockpit_docking",
  "cockpit_plan",
  "cockpit_clocks",
  "cockpit_log",
  "cockpit_approach",
  "cockpit_landing",
  "entry_corridor",
  "hub_graph",
] as const;
export type Screen = (typeof SCREENS)[number];

/** A plan TARS proposes: what for, its steps, its figures; done only once the pilot accepts. */
export interface Proposal {
  title: string;
  summary: string;
  steps: string[];
  figures?: { label: string; value: string }[];
}

export const PANELS = [
  "settings",
  "place",
  "time",
  "weather",
  "eclipses",
  "scenes",
  "photo",
  "controls",
  "help",
  "pause",
  "planner",
  "sky",
  "camera",
] as const;
export type Panel = (typeof PANELS)[number];

const AUTOS: Auto[] = [
  "none",
  "hover",
  "circularize",
  "approach",
  "orbit",
  "node",
  "transfer",
  "land",
  "takeoff",
  "dock",
  "entry",
  "burns",
];
const HOLDS: Hold[] = [
  "none",
  "prograde",
  "retrograde",
  "radialOut",
  "radialIn",
  "normal",
  "antinormal",
  "target",
  "antiTarget",
  "maneuver",
];
const MOUNT_IDS = Object.keys(MOUNTS) as Mount[];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A body by its id or its name, English or French ("Lune", "moon", "Gargantua", "station"). */
export function resolveBody(name: string): Target | null {
  const n = fold(name);
  const ids = [...Object.keys(BODY_NAMES), ...SOLAR_BODIES.map((b) => b.id)];
  const en = (id: string) => solarBody(id)?.name ?? (BODY_NAMES as Record<string, string>)[id] ?? id;
  const keys = (id: string) => {
    const e = en(id);
    return [id, e, FRENCH.get(e) ?? e].map(fold);
  };
  const extra: Record<string, string> = {
    gargantua: "hole",
    "black hole": "hole",
    "trou noir": "hole",
    station: "iss",
    "space station": "iss",
    "station spatiale": "iss",
  };
  if (extra[n]) return extra[n] as Target;
  for (const id of ids) if (keys(id).includes(n)) return id as Target;
  for (const id of ids) if (keys(id).some((k) => k.startsWith(n) && n.length >= 3)) return id as Target;
  return null;
}

/** A landing site by name (a part of it: "Edwards", "Bourget", "Jezero"), on a body if given. */
export function resolveSite(name: string, body?: string): Site | null {
  const n = fold(name);
  const pool = body ? SITES.filter((s) => s.body === body) : SITES;
  return pool.find((s) => fold(s.name) === n || s.icao?.toLowerCase() === n) ?? pool.find((s) => fold(s.name).includes(n)) ?? null;
}

/** Every key's action, from the keymap: its id ("auto:land", "gear"), its key and what it does. */
export function keyCatalog() {
  const out: { id: string; key: string; does: string }[] = [];
  const seen = new Set<string>();
  for (const s of KEYMAP)
    for (const r of s.rows)
      for (const b of r.bind ?? []) {
        if (b.do === "held" || b.do === "tars") continue;
        const id = b.arg ? `${b.do}:${b.arg}` : b.do;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, key: r.keys, does: r.text });
      }
  return out;
}

const round = (x: number, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/** A flight computer's result, said briefly. */
const opText = (r: OpResult) =>
  r.ok
    ? {
        ok: true,
        note: r.note,
        dvTotalMs: round(r.dvTotal),
        burns: r.burns.map((b) => ({ inS: round(b.t, 0), dvMs: round(Math.hypot(...b.dv)), label: b.label })),
      }
    : { ok: false, note: r.note };

/** An eclipse in a few words for TARS: its kind, type, times as ISO, its figures rounded. */
export function eclipseBrief(e: EclipseEvent): Record<string, unknown> {
  return isoTimes({ ...e, at: undefined }) as Record<string, unknown>;
}
/** Times [ms] in an answer as ISO dates (the keys t, at, start, end and contacts' t); numbers rounded. */
export function isoTimes(v: unknown, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => isoTimes(x));
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => [k, isoTimes(x, k)]),
    );
  if (typeof v === "number") {
    if (/^(t|at|start|end|max)$/.test(key)) return Number.isFinite(v) ? new Date(v).toISOString().slice(0, 19) + "Z" : null;
    return Math.round(v * 1e4) / 1e4;
  }
  return v;
}

/** the weather_at tool's own requests (the game's feed is the real weather's) */
const toolFeed = new OpenMeteoFeed();

export function gameTools(h: GameHost): Tool[] {
  const { camera, settings, tools } = h;
  /** what the game said since a mark (its journal's toasts and events) */
  const since = (mark: number) =>
    h
      .log()
      .slice(mark)
      .map((e) => e.text)
      .slice(-6);
  /** a call wrapped: its result and what the game said meanwhile */
  const act = (fn: (a: Args, signal: AbortSignal) => unknown) => async (a: Args, signal: AbortSignal) => {
    const mark = h.log().length;
    const r = await fn(a, signal);
    const said = since(mark);
    return said.length ? { result: r ?? "done", game: said } : (r ?? "done");
  };
  /** the net before what cannot be undone */
  const net = () => {
    try {
      tools.save(UNDO_SAVE);
    } catch {
      /* nothing to save: no game */
    }
  };
  const body = (name: unknown) => {
    const b = resolveBody(String(name));
    if (!b) throw new Error(`no body named "${name}" — list_bodies lists them`);
    return b;
  };
  const autoOn = (a: Auto) => {
    if (a === "none") {
      if (camera.pilot.auto !== "none") h.pilotAuto(camera.pilot.auto);
      return "autopilot off";
    }
    const why = h.autoWhy(a);
    if (why) throw new Error(why);
    if (camera.pilot.auto !== a) h.pilotAuto(a);
    return camera.pilot.auto === a ? `autopilot ${a} engaged` : `autopilot ${a} not engaged`;
  };

  const tools_: Tool[] = [
    // ------------------------------------------------------------------ reading
    {
      name: "get_state",
      description:
        "The whole situation now: phase, status and orbit (km, m/s), fuel and Δv, target, next event, autopilot/hold/throttle, alerts, landing/runway state, mission, date, warp, view, craft. Call it before acting when unsure.",
      run: () => {
        const st = tools.status();
        const rw = camera.runwayView?.();
        return {
          phase: h.phase(),
          flight: h.flight(),
          status: st,
          pilot: tools.pilotState(),
          alerts: h.alerts(),
          entrySite: camera.entrySite?.name ?? null,
          runway: rw
            ? {
                name: rw.name,
                rwy: rw.rwy,
                alongKm: round(rw.along / 1e3, 2),
                acrossM: round(rw.across, 0),
                aglM: round(rw.agl, 0),
                final: rw.final,
              }
            : null,
          plan: camera.fcPlan?.()
            ? { note: camera.fcPlan()!.note, executing: camera.fcPlan()!.executing, burns: camera.fcPlan()!.burns.length }
            : null,
          mission: h.mission(),
          date: tools.date(),
          warp: { running: settings.animate, timesRealTime: round(settings.timeSpeed / h.realTimeSpeed(), 2), autoWarp: settings.autoWarp },
          view: { ship: settings.ship, mount: settings.shipMount, spectating: camera.spectating, vessel: settings.vessel },
          gear: { down: camera.gearDown, flaps: camera.airFlight?.cfg.flaps, airBrake: camera.airBrake },
          docked: camera.docked,
        };
      },
    },
    {
      name: "get_telemetry",
      description:
        "Everything the cockpit and the hub know, now, in figures (degrees, metres, m/s, s): attitude (pitch, bank, heading, angle of attack, sideslip, stall AoA), air (height, airspeed, Mach, q, heat, load, skin temperatures and margins, wind), controls (throttle, thrust, surface deflections, flaps, air brake, gear, holds), autopilot (director, flight-computer command, launch goal), hub (its title, current step, rows, next, progress, cue: time to ignition and Δv left, callout, its graph's verdict on/off/wait and the fix), entry (phase, commanded bank and AoA, range and heading error to the site, miss, in corridor, planned peaks, reversal), approach (runway offset, height, PAPI whites 0–4, glidepath vs flown path, profile deviation, leg, flare, MLS, wind), descent (powered landing's command), burn (plan, cue), dock (offsets, closing rate), sky (the world under the camera, the Sun's and the Moon's altitude and azimuth — true and as seen through the Earth's air —, the refraction at the horizon and the air's refractivity). Ask only the groups you need.",
      params: { groups: { type: "array", maxItems: TELEMETRY_GROUPS.length, items: { type: "string", enum: TELEMETRY_GROUPS } } },
      run: (a) => telemetry(camera, (a.groups as TelemetryGroup[] | undefined)?.length ? (a.groups as TelemetryGroup[]) : TELEMETRY_GROUPS),
    },
    {
      name: "list_places",
      description: "Landing sites and runways (name, body, lat/lon, runway heading, ICAO). Optional body filter.",
      params: { body: { type: "string", description: "a body (Earth, Moon, Mars…), any language" } },
      run: (a) => {
        const b = a.body ? body(a.body) : null;
        return SITES.filter((s) => !b || s.body === b).map((s) => ({
          name: s.name,
          body: s.body,
          lat: s.lat,
          lon: s.lon,
          runway: s.runway ? s.rwy : undefined,
          icao: s.icao,
        }));
      },
    },
    {
      name: "list_bodies",
      description: "The bodies of the ship's universe (radius, sphere of influence, distance, altitude) and the targets available.",
      run: () => ({ bodies: tools.bodies(), soi: tools.soi(), targets: tools.targets() }),
    },
    {
      name: "get_weather",
      description:
        "The weather where the ship is (wind, visibility, clouds, rain) and the weather setting; with 'real': the real weather and where it comes from (realSource.why: metar — a runway's report, the game's date now —, model — Open-Meteo at the game's date —, out-of-range — a plausible draw —, pending, other-world, high), and the clouds of that day drawn over the whole Earth (dayClouds: the satellites' mosaic's date and layer; null: the fixed map — before 2000, a future date, not in yet).",
      run: () => ({
        setting: settings.weather,
        wind: settings.wind,
        now: camera.weatherNow ?? null,
        real: camera.weatherReal ?? null,
        realSource: camera.weatherRealInfo ?? null,
        dayClouds: h.dayClouds?.() ?? null,
      }),
    },
    {
      name: "weather_at",
      description:
        "The real weather anywhere on the Earth at a date (Open-Meteo: its archive since 1940, its forecast up to 15 days ahead): the cloud layers, visibility, rain, wind, temperature and pressure, decoded as the game would fly it. Use it to answer what the weather was or will be somewhere (an eclipse's sky, a landing site's) — not only where the ship is. The date defaults to the game's.",
      params: {
        lat: { type: "number", description: "latitude [°], north +" },
        lon: { type: "number", description: "longitude [°], east +" },
        date: { type: "string", description: "ISO date-time, UTC (e.g. 2026-08-12T18:30:00Z); default: the game's" },
      },
      required: ["lat", "lon"],
      run: async (a) => {
        const p = camera.weatherPlace();
        const ms = a.date ? Date.parse(String(a.date)) : p ? msOfDays(p.days) : Date.now();
        if (!Number.isFinite(ms)) return { error: "bad date" };
        const r = await modelWeatherAt(toolFeed, Number(a.lat), Number(a.lon), ms);
        if (!r.reachable) return { reachable: false, why: "before 1940 or beyond the 15-day forecast", date: new Date(ms).toISOString() };
        return r.state ? { reachable: true, weather: r.state } : { reachable: true, error: "no answer (network)" };
      },
    },
    {
      name: "find_eclipses",
      description:
        "The eclipse calculator: every eclipse in a window of dates — solar (total, annular, hybrid, partial: the greatest moment UTC, gamma, magnitude, its place, the duration and the path's width there, saros), lunar (total, partial, penumbral: umbral and penumbral magnitudes, contacts P1…P4, durations, saros), Mercury's and Venus's transits, the phenomena of a planet's moons seen from the Earth (ecl: in its shadow; occ: behind it; tra: before it; sha: its shadow on it — a year at most; Jupiter's by default), and the Sun's eclipses seen from another world (world: its planet's and its moons' shadows on it — two years at most). Up to 50 years for the Earth's. Use it for any question about eclipses past or to come, then eclipse_local for a place.",
      params: {
        kinds: { type: "array", items: { type: "string", enum: ["solar", "lunar", "transit", "phenomena", "world"] } },
        from: { type: "string", description: "ISO date (default: the game's date)" },
        to: { type: "string", description: "ISO date (default: from + 3 years; phenomena: + 1 month)" },
        planet: { type: "string", description: "phenomena: jupiter (default), saturn, neptune, mars, uranus, pluto" },
        world: { type: "string", description: "world: the body the Sun is seen from (moon, io, mars, titan…)" },
        limit: { type: "number", description: "at most this many events (default 40)" },
      },
      required: ["kinds"],
      run: async (a) => {
        const kinds = (a.kinds as EclipseKind[]) ?? [];
        const from = a.from ? Date.parse(String(a.from)) : (h.utcNow?.() ?? Date.now());
        const phen = kinds.length === 1 && kinds[0] === "phenomena";
        const to = a.to ? Date.parse(String(a.to)) : from + (phen ? 31 : 3 * 365.25) * 86400e3;
        if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: "bad date" };
        const world = a.world ? (resolveBody(String(a.world)) ?? String(a.world)) : undefined;
        const planet = a.planet ? (resolveBody(String(a.planet)) ?? String(a.planet)) : undefined;
        const r = await plan<{ events: EclipseEvent[]; clipped: EclipseKind[] } | { error: string }>({
          kind: "eclipses",
          q: { from, to, kinds, planets: planet ? [planet] : undefined, world },
        });
        if ("error" in r) return r;
        const limit = Math.max(1, Math.min(Number(a.limit ?? 40), 200));
        return { count: r.events.length, clipped: r.clipped, events: r.events.slice(0, limit).map(eclipseBrief) };
      },
    },
    {
      name: "multiple_exposure",
      description:
        "Make a multiple-exposure photograph (several renders from one fixed tripod blended into one image, shown to the player with a Download button). 'trails': star trails over hours of a dark night (`date` its evening, `hours`, `count` frames 40–160, `toward` the pole or a quarter, `fov`, `comet`). 'moon': the Moon's way — `mode` night (every `step` min, `span` h about its highest), daily (each day at `time` UTC for `days`), lunar (each lunar day: the lunar analemma). 'iss': the ISS's trail on its visible pass nearest `date` (iss_passes lists them; `dashes` for an interval shooting's gaps). 'analemma': the Sun at the same UTC time every N days for a year from a place, its figure-eight over the landscape. 'eclipse': a solar or lunar eclipse seen from a place — `before` phases, the central one (totality, ring or greatest), `after` phases, each disc taken through a telephoto and laid where it was in the sky, over the landscape (the totality's own twilight, or dusk) or black; the eclipse nearest `date` that is seen from there (find_eclipses gives them). It takes from seconds to a few minutes; the player sees its progress. Place: lat/lon or a site; default the player's.",
      params: {
        kind: { type: "string", enum: ["analemma", "eclipse", "trails", "moon", "iss"] },
        hours: { type: "number", description: "trails: hours of the night (default 3)" },
        count: { type: "number", description: "trails: frames, 40–160 (default 80)" },
        toward: {
          type: "string",
          enum: ["pole", "north", "east", "south", "west"],
          description: "trails: where the tripod looks (default the pole)",
        },
        fov: { type: "number", description: "trails: the vertical field [°], 40–120 (default 70)" },
        comet: { type: "boolean", description: "trails: a comet's tail (older frames dimmer)" },
        mode: {
          type: "string",
          enum: ["night", "daily", "lunar"],
          description: "moon: through a night (default), each day at a time, each lunar day",
        },
        step: { type: "number", description: "moon night: minutes between frames (default 60)" },
        span: { type: "number", description: "moon night: hours about its highest (default 6)" },
        days: { type: "number", description: "moon daily/lunar: days (default 30)" },
        lit: { type: "boolean", description: "moon: each disc's lit share written (default true)" },
        dashes: { type: "boolean", description: "iss: the trail in dashes (an interval shooting)" },
        lat: { type: "number" },
        lon: { type: "number" },
        site: { type: "string" },
        time: { type: "string", description: "analemma: the clock time each day, HH:MM UTC (default 12:00)" },
        from: { type: "string", description: "analemma: the first day (ISO date; default the game's)" },
        cadence: { type: "number", description: "analemma: days between exposures, 1–10 (default 7)" },
        base: {
          type: "string",
          enum: ["dusk", "same", "central", "none"],
          description: "the landscape under it: at dusk, at that hour (analemma), the eclipse's totality (default for a total one), none",
        },
        dates: {
          type: "string",
          enum: ["monthly", "all", "none"],
          description: "analemma: dates written beside the Suns: one a month (default), every one, none",
        },
        position: {
          type: "boolean",
          description: "write each labelled disc's azimuth and altitude (analemma: and the place and hour in a corner)",
        },
        eclipse: { type: "string", enum: ["solar", "lunar"], description: "eclipse: of the Sun or the Moon (default solar)" },
        date: { type: "string", description: "eclipse: its day or a date near it (ISO; default the game's: the nearest)" },
        before: { type: "number", description: "eclipse: phases before the central one, 0–10 (default 5)" },
        after: { type: "number", description: "eclipse: phases after it, 0–10 (default 5)" },
        framing: {
          type: "string",
          enum: ["landscape", "sky"],
          description: "eclipse: the horizon in the frame (default) or the sky alone, larger discs",
        },
        sky: { type: "string", enum: ["clear", "game"], description: "eclipse: a clear sky (default) or the game's weather" },
        times: { type: "boolean", description: "eclipse: each disc's time written beside it (default true)" },
        share: { type: "boolean", description: "eclipse: each disc's share hidden written beside it" },
        caption: { type: "boolean", description: "eclipse: its name, date, place and saros in a corner (default true)" },
      },
      required: ["kind"],
      run: async (a) => {
        if (!h.multiExposure) return { error: "not available" };
        const site = a.site ? resolveSite(String(a.site), "earth") : null;
        const here = camera.weatherPlace?.();
        const lat = site?.lat ?? (a.lat !== undefined ? Number(a.lat) : here?.body === "earth" ? here.lat : 48.86);
        const lon = site?.lon ?? (a.lon !== undefined ? Number(a.lon) : here?.body === "earth" ? here.lon : 2.35);
        const now = h.utcNow?.() ?? Date.now();
        const clamp = (v: unknown, d: number, lo: number, hi: number) => Math.min(Math.max(Number(v ?? d), lo), hi);
        let r: { rendered: number } | null;
        const dateOf = (d: unknown) => (d ? Date.parse(String(d)) : now);
        const common = {
          lat,
          lon,
          width: 1920,
          height: 1080,
          framing: a.framing === "sky" ? ("sky" as const) : ("landscape" as const),
          sky: a.sky === "game" ? ("game" as const) : ("clear" as const),
        };
        if (a.kind === "trails" || a.kind === "moon" || a.kind === "iss") {
          const date = dateOf(a.date);
          if (!Number.isFinite(date)) return { error: `not a date: ${a.date}` };
          const [hh, mm] = String(a.time ?? "21:00")
            .split(":")
            .map(Number);
          r =
            a.kind === "trails"
              ? await h.multiExposure({
                  kind: "trails",
                  ...common,
                  date,
                  hours: clamp(a.hours, 3, 0.5, 10),
                  count: clamp(a.count, 80, 20, 200),
                  toward: (a.toward as "pole") ?? "pole",
                  fov: clamp(a.fov, 70, 30, 120),
                  comet: a.comet === true,
                  caption: a.caption !== false,
                  spp: 2,
                })
              : a.kind === "moon"
                ? await h.multiExposure({
                    kind: "moon",
                    ...common,
                    mode: (a.mode as "night" | "daily" | "lunar") ?? "night",
                    date,
                    step: clamp(a.step, 60, 5, 240),
                    span: clamp(a.span, 6, 1, 14),
                    days: clamp(a.days, 30, 3, 60),
                    minutesUtc: (hh ?? 21) * 60 + (mm ?? 0),
                    lit: a.lit !== false,
                    times: a.times !== false,
                    position: a.position === true,
                    caption: a.caption !== false,
                    spp: 4,
                  })
                : await h.multiExposure({
                    kind: "iss",
                    ...common,
                    date,
                    dashes: a.dashes === true,
                    times: a.times !== false,
                    position: a.position === true,
                    caption: a.caption !== false,
                    spp: 4,
                  });
        } else if (a.kind === "eclipse") {
          const date = a.date ? Date.parse(String(a.date)) : now;
          if (!Number.isFinite(date)) return { error: `not a date: ${a.date}` };
          r = await h.multiExposure({
            kind: "eclipse",
            lat,
            lon,
            eclipse: a.eclipse === "lunar" ? "lunar" : "solar",
            date,
            before: clamp(a.before, 5, 0, 10),
            after: clamp(a.after, 5, 0, 10),
            framing: a.framing === "sky" ? "sky" : "landscape",
            base: (a.base as "central" | "dusk" | "none" | undefined) ?? "central",
            sky: a.sky === "game" ? "game" : "clear",
            times: a.times !== false,
            share: a.share === true,
            position: a.position === true,
            caption: a.caption !== false,
            width: 1920,
            height: 1080,
            spp: 4,
          });
        } else {
          const [hh, mm] = String(a.time ?? "12:00")
            .split(":")
            .map(Number);
          r = await h.multiExposure({
            kind: "analemma",
            lat,
            lon,
            minutesUtc: (hh ?? 12) * 60 + (mm ?? 0),
            start: a.from ? Date.parse(String(a.from)) : now,
            cadence: clamp(a.cadence, 7, 1, 10),
            base: (a.base as "dusk" | "same" | "none") ?? "dusk",
            dates: (a.dates as "monthly" | "all" | "none") ?? "monthly",
            position: a.position === true,
            width: 1200,
            height: 1600,
            spp: 2,
          });
        }
        return r
          ? { ok: true, exposures: r.rendered, shown: "the image is in the Multiple exposure dialog (Download PNG)" }
          : { error: "stopped, failed, or no such eclipse seen from there (see the dialog's message)" };
      },
    },
    {
      name: "iss_passes",
      description:
        "The ISS's passes seen from a place over the next days (SGP4 on its latest elements): the station over 10°, lit by the Sun, the sky dark there — each with its times (rising into view, highest, leaving), its highest altitude and its brightest magnitude. Use it to tell the player when to look up, or to pick one for multiple_exposure kind 'iss'.",
      params: {
        lat: { type: "number" },
        lon: { type: "number" },
        site: { type: "string" },
        from: { type: "string", description: "the first day (ISO; default the game's date)" },
        days: { type: "number", description: "how many days, 1–15 (default 7)" },
      },
      run: async (a) => {
        if (!h.issPasses) return { error: "not available" };
        const site = a.site ? resolveSite(String(a.site), "earth") : null;
        const here = camera.weatherPlace?.();
        const lat = site?.lat ?? (a.lat !== undefined ? Number(a.lat) : here?.body === "earth" ? here.lat : 48.86);
        const lon = site?.lon ?? (a.lon !== undefined ? Number(a.lon) : here?.body === "earth" ? here.lon : 2.35);
        const from = a.from ? Date.parse(String(a.from)) : (h.utcNow?.() ?? Date.now());
        if (!Number.isFinite(from)) return { error: `not a date: ${a.from}` };
        const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z";
        const passes = h.issPasses(lat, lon, from, Math.min(Math.max(Number(a.days ?? 7), 1), 15));
        return {
          place: { lat, lon },
          passes: passes.map((p) => ({
            from: iso(p.seenFrom),
            highest: iso(p.top),
            to: iso(p.seenTo),
            maxAltDeg: Math.round(p.maxAlt),
            magnitude: +p.mag.toFixed(1),
          })),
        };
      },
    },
    {
      name: "go_see_eclipse",
      description:
        "Take the player to see an eclipse: the scene set at its date, a few minutes before its greatest, from the place given if it is seen there (else from where it is best: the greatest point of a solar one, under the Moon for a lunar one), the view on the Sun or the Moon. For a moon's phenomenon or another world's, use set_date and place_ship near that world instead. Give its date (from find_eclipses).",
      params: {
        kind: { type: "string", enum: ["solar", "lunar", "transit"] },
        date: { type: "string", description: "its greatest moment or its day (ISO)" },
        lat: { type: "number" },
        lon: { type: "number" },
        site: { type: "string", description: "a site's name instead of lat/lon" },
      },
      required: ["kind", "date"],
      run: async (a) => {
        const t = Date.parse(String(a.date));
        if (!Number.isFinite(t)) return { error: "bad date" };
        const site = a.site ? resolveSite(String(a.site), "earth") : null;
        const place = site
          ? { lat: site.lat, lon: site.lon }
          : Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) && a.lat !== undefined
            ? { lat: Number(a.lat), lon: Number(a.lon) }
            : null;
        const id = (await h.seeEclipse?.(a.kind as "solar" | "lunar" | "transit", t, place)) ?? null;
        return id ? { ok: true, eclipse: id } : { error: "no such eclipse within 3 days of that date" };
      },
    },
    {
      name: "eclipse_local",
      description:
        "What a solar or lunar eclipse looks like from a place: its contacts (UTC), the greatest moment, the magnitude and the obscuration, total/annular/partial or not seen there, the Sun's or the Moon's height at each (geometric, degrees). Give the eclipse's date (from find_eclipses) and a place (lat/lon in degrees, or a site's name).",
      params: {
        date: { type: "string", description: "the eclipse's greatest moment or its day (ISO)" },
        kind: { type: "string", enum: ["solar", "lunar"] },
        lat: { type: "number" },
        lon: { type: "number" },
        site: { type: "string", description: "a site's name instead of lat/lon" },
      },
      required: ["date", "kind"],
      run: async (a) => {
        const t = Date.parse(String(a.date));
        if (!Number.isFinite(t)) return { error: "bad date" };
        const site = a.site ? resolveSite(String(a.site), "earth") : null;
        const lat = site ? site.lat : Number(a.lat),
          lon = site ? site.lon : Number(a.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: "a place: lat and lon, or a site" };
        const r = await plan<unknown>({ kind: "eclipseLocal", what: a.kind === "lunar" ? "lunar" : "solar", t, lat, lon, h: 0 });
        return r ? isoTimes(r) : { error: "no such eclipse within 3 days of that date" };
      },
    },
    {
      name: "find_settings",
      description:
        "Find settings by words (English or French): each with its key, type, current value, range or options. Every setting of the game is reachable this way (graphics, sound, HUD, physics, the Ranger, TARS…).",
      params: { query: { type: "string" } },
      required: ["query"],
      run: (a) => findSettings(String(a.query), settings, 12),
    },
    {
      name: "list_saves_and_scenes",
      description: "The saved games, the missions (scene + title) and every scene name (for start_scene).",
      run: () => ({ saves: tools.saves(), missions: MISSIONS.map((m) => ({ scene: m.scene, title: m.title.en })), scenes: h.scenes() }),
    },
    {
      name: "get_log",
      description: "The game's journal, newest last: messages, autopilot changes, sphere-of-influence changes, saves, errors.",
      params: { count: { type: "number", minimum: 1, maximum: 60, integer: true } },
      run: (a) =>
        h
          .log()
          .slice(-((a.count as number) ?? 20))
          .map((e) => `${e.kind}: ${e.text}`),
    },
    {
      name: "get_flight_report",
      description: "The last landing or docking report: score out of 20, letter, the lines (speed, centre line, sink rate…).",
      run: () => h.report() ?? "no report yet",
    },
    {
      name: "list_keys",
      description: "Every keyboard action of the game (id, key, what it does) — for press_key, when no other tool does it.",
      run: () => keyCatalog(),
    },
    // ------------------------------------------------------------------ flying
    {
      name: "autopilot",
      description:
        "Engage an autopilot (none switches it off). hover: hold position; circularize; approach: close on the target only (it does not dock); orbit: orbit the target; node: execute the planned manoeuvre; transfer; land: powered landing below; takeoff: to orbit (altKm, incDeg); dock: TO DOCK — target the station or craft first; within 3 km it closes in, aligns and docks by itself (farther: plan_mission to it first, which ends 200 m from the port); entry: from orbit, deorbit burn + entry + glide + runway landing at `site`; burns: fly the flight computer's burns.",
      params: {
        mode: { type: "string", enum: AUTOS },
        site: { type: "string", description: "entry/land: a landing site or runway name (list_places)" },
        altKm: { type: "number", minimum: 50, maximum: 100000, description: "takeoff: the orbit's altitude [km]" },
        incDeg: { type: "number", minimum: -180, maximum: 180, description: "takeoff: the orbit's inclination [°] (default: due east)" },
      },
      required: ["mode"],
      run: act((a) => {
        const mode = a.mode as Auto;
        if (a.site !== undefined) {
          const s = resolveSite(String(a.site));
          if (!s) throw new Error(`no site named "${a.site}" — list_places lists them`);
          camera.entrySite = s;
        }
        if (mode === "takeoff" && (a.altKm !== undefined || a.incDeg !== undefined))
          camera.launchGoal = {
            altKm: (a.altKm as number) ?? camera.launchGoal.altKm,
            incDeg: (a.incDeg as number) ?? camera.launchGoal.incDeg,
          };
        return autoOn(mode);
      }),
    },
    {
      name: "hold",
      description:
        "Hold an attitude (none: off): prograde, retrograde, radial in/out, normal/antinormal, toward/away from the target, the manoeuvre node.",
      params: { direction: { type: "string", enum: HOLDS } },
      required: ["direction"],
      run: act((a) => {
        const d = a.direction as Hold;
        if (d === "none") {
          if (camera.pilot.hold !== "none") h.pilotHold(camera.pilot.hold);
        } else if (camera.pilot.hold !== d) h.pilotHold(d);
        return `hold ${camera.pilot.hold}`;
      }),
    },
    {
      name: "controls",
      description:
        "Set the ship's controls (only those given): throttle 0–1 (switches an autopilot off), gear, flaps (0, 0.5, 1), airBrake, sas, rollAlign (wings in the orbital plane), precision, assist (you fly, the autopilot's director shows the way), flightMode in the air (rocket, plane, sf: the flight computer flies a commanded velocity), antigrav.",
      params: {
        throttle: { type: "number", minimum: 0, maximum: 1 },
        gear: { type: "boolean", description: "true: down" },
        flaps: { type: "number", minimum: 0, maximum: 1 },
        airBrake: { type: "boolean" },
        sas: { type: "boolean" },
        rollAlign: { type: "boolean" },
        precision: { type: "boolean" },
        assist: { type: "boolean" },
        flightMode: { type: "string", enum: ["rocket", "plane", "sf"] },
        antigrav: { type: "boolean" },
      },
      run: act((a) => {
        const p = camera.pilot;
        if (a.throttle !== undefined) {
          if (p.auto !== "none") h.pilotAuto(p.auto);
          p.throttle = a.throttle as number;
        }
        if (a.gear !== undefined) h.setGear(a.gear as boolean);
        if (a.flaps !== undefined) camera.airFlight.cfg.flaps = (a.flaps as number) < 0.25 ? 0 : (a.flaps as number) < 0.75 ? 0.5 : 1;
        if (a.airBrake !== undefined) camera.airBrake = a.airBrake ? 1 : 0;
        if (a.sas !== undefined && p.sas !== a.sas) h.key("sas");
        if (a.rollAlign !== undefined && p.rollAlign !== a.rollAlign) h.key("roll");
        if (a.precision !== undefined && p.precision !== a.precision) h.key("precision");
        if (a.assist !== undefined && p.assist !== a.assist) h.toggleAssist();
        if (a.flightMode !== undefined && settings.flightMode !== a.flightMode) {
          settings.flightMode = a.flightMode as Settings["flightMode"];
          h.changed(["flightMode"]);
        }
        if (a.antigrav !== undefined && settings.antigrav !== a.antigrav) h.key("antigrav");
        return {
          throttle: round(p.throttle, 2),
          gearDown: camera.gearDown,
          flaps: camera.airFlight.cfg.flaps,
          airBrake: camera.airBrake > 0,
          sas: p.sas,
          rollAlign: p.rollAlign,
          precision: p.precision,
          assist: p.assist,
          flightMode: settings.flightMode,
          antigrav: settings.antigrav,
        };
      }),
    },
    {
      name: "flight_action",
      description:
        "go_around: on a runway approach under the entry autopilot, the missed approach flown; undock; release: stops the mission, the hold, the autopilot; acknowledge: the master caution silenced.",
      params: { action: { type: "string", enum: ["go_around", "undock", "release", "acknowledge"] } },
      required: ["action"],
      run: act((a) => {
        switch (a.action) {
          case "go_around":
            return camera.goAround() ? "going around" : "no runway approach to go around from";
          case "undock":
            if (!camera.docked) return "not docked";
            camera.undock();
            return "undocked";
          case "release":
            h.releaseControls();
            return "controls released";
          default:
            h.key("ack");
            return "acknowledged";
        }
      }),
    },
    {
      name: "set_craft",
      description: "The ship on or off (off: the free camera), and the craft flown: ranger, lander, endurance.",
      params: { ship: { type: "boolean" }, vessel: { type: "string", enum: ["ranger", "lander", "endurance"] } },
      run: act((a) => {
        if (a.ship !== undefined && settings.ship !== a.ship) h.key("ship");
        if (a.vessel !== undefined && settings.vessel !== a.vessel) {
          settings.vessel = a.vessel as Settings["vessel"];
          h.changed(["vessel"]);
        }
        return { ship: settings.ship, vessel: settings.vessel };
      }),
    },
    // ------------------------------------------------------------------ navigating
    {
      name: "set_target",
      description: "Target a body or craft by name, any language (Moon/Lune, Mars, ISS/station, Gargantua, Miller, the wormhole…).",
      params: { name: { type: "string" } },
      required: ["name"],
      run: act((a) => tools.target(body(a.name))),
    },
    {
      name: "plan_maneuver",
      description:
        "The flight computer: a manoeuvre about the body the ship orbits, planned and (execute: true, the default) flown by the autopilot; execute: false only previews it (nothing changed — for a proposal). op: circularize (where: now/pe/ap), apoapsis/periapsis (altKm, where), hohmann (altKm), inclination (incDeg), match_planes (with the target), resonant (ratio), rendezvous/intercept (the target about the same body), match_velocities, fine_tune (inS), align_over_site (site: the orbit passing over a landing site). Near Gargantua itself the Kerr equivalents are used. For another body or the station use plan_mission.",
      params: {
        op: {
          type: "string",
          enum: [
            "circularize",
            "apoapsis",
            "periapsis",
            "hohmann",
            "inclination",
            "match_planes",
            "resonant",
            "rendezvous",
            "intercept",
            "match_velocities",
            "fine_tune",
            "align_over_site",
          ],
        },
        where: { type: "string", enum: ["now", "pe", "ap"] },
        altKm: { type: "number", minimum: 1, maximum: 1e7 },
        incDeg: { type: "number", minimum: 0, maximum: 180 },
        ratio: { type: "number", minimum: 0.2, maximum: 20 },
        inS: { type: "number", minimum: 0, maximum: 1e7 },
        site: { type: "string" },
        execute: { type: "boolean" },
      },
      required: ["op"],
      run: act((a) => {
        const op = a.op as string;
        const where = (a.where as "now" | "pe" | "ap" | undefined) ?? undefined;
        const need = (k: string) => {
          if (a[k] === undefined) throw new Error(`${op} needs ${k}`);
          return a[k] as number;
        };
        let r: OpResult | string;
        const c = camera.fcContext();
        if (!c) {
          // (about Gargantua itself: the Kerr operations, radii in M)
          const kind = {
            circularize: "circ",
            apoapsis: "ap",
            periapsis: "pe",
            hohmann: "hohmann",
            inclination: "inc",
            resonant: "res",
            match_planes: "plane",
          }[op];
          if (!kind) throw new Error("no orbit about a body here for that manoeuvre (far from any body, or not flying)");
          const x =
            kind === "circ"
              ? (where ?? "ap")
              : kind === "inc"
                ? need("incDeg")
                : kind === "res"
                  ? need("ratio")
                  : kind === "plane"
                    ? undefined
                    : need("altKm");
          r = camera.fcKerrOp(kind as Parameters<CameraController["fcKerrOp"]>[0], x as never);
        } else {
          const ctx = c.ctx;
          const alt = (k = "altKm") => ctx.R + need(k) * 1e3;
          switch (op) {
            case "circularize":
              r = circularize(ctx, where ?? "ap");
              break;
            case "apoapsis":
              r = setApoapsis(ctx, alt(), where ?? "pe");
              break;
            case "periapsis":
              r = setPeriapsis(ctx, alt(), where ?? "ap");
              break;
            case "hohmann":
              r = hohmann(ctx, alt());
              break;
            case "inclination":
              r = setInclination(ctx, (need("incDeg") * Math.PI) / 180);
              break;
            case "match_planes":
              r = matchPlanes(ctx);
              break;
            case "resonant":
              r = resonant(ctx, need("ratio"));
              break;
            case "rendezvous":
            case "intercept":
              r = transfer(ctx, { rendezvous: op === "rendezvous" });
              break;
            case "match_velocities":
              r = matchVelocities(ctx);
              break;
            case "fine_tune":
              r = fineTune(ctx, need("inS"));
              break;
            default: {
              const s = resolveSite(String(a.site ?? ""), c.body);
              if (!s) throw new Error(`no landing site named "${a.site}" on ${c.bodyName}`);
              const track = camera.fcSiteTrack(s);
              if (!track) throw new Error(`${s.name} cannot be tracked from here`);
              camera.entrySite = s;
              r = alignOverSite(ctx, track, { orbits: 16 });
            }
          }
        }
        if (typeof r === "string") throw new Error(r);
        if (!r.ok) return opText(r);
        // (execute: false — a proposal's figures —: previewed on the maps, nothing adopted, nothing flown)
        if (a.execute === false) {
          camera.fcPreview(r.burns, r.note);
          return { ...opText(r), executing: false, adopted: false };
        }
        const err = camera.fcSetPlan(r.burns, r.note);
        if (err) throw new Error(err);
        const e = camera.fcExecute();
        if (e) throw new Error(e);
        return { ...opText(r), executing: true };
      }),
    },
    {
      name: "plan_mission",
      description:
        "A mission to another body, the station or a craft, or the wormhole, planned by the flight computer (MISSION tab) and (execute: true, the default) flown; execute: false only works out its figures (the target and plan untouched — for a proposal). target: a body/craft name; arrival: orbit (altKm), flyby, freeReturn (retKm: the return's periapsis). Rendezvous with iss/ranger/lander/endurance ends 200 m from the port (then autopilot dock).",
      params: {
        target: { type: "string" },
        arrival: { type: "string", enum: ["orbit", "flyby", "freeReturn"] },
        altKm: { type: "number", minimum: 1, maximum: 1e7 },
        retKm: { type: "number", minimum: 1, maximum: 1e6 },
        execute: { type: "boolean" },
      },
      required: ["target"],
      run: act(async (a) => {
        const name = String(a.target);
        const t = fold(name) === "wormhole" || fold(name) === "trou de ver" ? "wormhole" : body(name);
        const r = await camera.missionPlan({
          target: t,
          arrival: a.arrival as never,
          altKm: a.altKm as number | undefined,
          retKm: a.retKm as number | undefined,
        });
        if (!r.ok) return { ok: false, note: r.note };
        // (execute: false — a proposal's figures —: the mission only previewed, its target and plan untouched)
        if (a.execute !== false) {
          const err = camera.missionCommit();
          if (err) throw new Error(err);
          const e = camera.fcExecute();
          if (e) throw new Error(e);
        }
        return {
          ok: true,
          note: r.note,
          dvTotalMs: round(r.dvTotal),
          burns: r.burns.length,
          arrive: r.afterText,
          executing: a.execute !== false,
        };
      }),
    },
    {
      name: "manage_plan",
      description: "The flight plan: execute it (the node/burns autopilot), clear it, or read it.",
      params: { action: { type: "string", enum: ["execute", "clear", "read"] } },
      required: ["action"],
      run: act((a) => {
        if (a.action === "clear") {
          camera.fcClear();
          return "plan cleared";
        }
        if (a.action === "execute") {
          const e = camera.fcExecute();
          if (e) throw new Error(e);
          return "executing the plan";
        }
        const p = camera.fcPlan();
        return p
          ? {
              note: p.note,
              executing: p.executing,
              burns: p.burns.map((b) => ({ inS: round(b.t, 0), dvMs: round(Math.hypot(...b.dv)), label: b.label })),
            }
          : "no plan";
      }),
    },
    // ------------------------------------------------------------------ time
    {
      name: "time",
      description:
        "Time: run or pause it, the warp as times real time (1 = real time, up to 1 000 000; the hub may cap it during a manoeuvre), or let the hub manage the warp (autoWarp).",
      params: { running: { type: "boolean" }, warp: { type: "number", minimum: 1, maximum: 1e6 }, autoWarp: { type: "boolean" } },
      run: act((a) => {
        if (a.autoWarp !== undefined && settings.autoWarp !== a.autoWarp) camera.setWarpAuthority(a.autoWarp as boolean);
        if (a.warp !== undefined) h.setWarp((a.warp as number) * h.realTimeSpeed());
        if (a.running !== undefined) h.playPause(a.running as boolean);
        return { running: settings.animate, timesRealTime: round(settings.timeSpeed / h.realTimeSpeed(), 2), autoWarp: settings.autoWarp };
      }),
    },
    {
      name: "set_date",
      description:
        "Move the clock (the world moves, the ship is carried with its body; a plan is dropped): an ISO date (UTC), or a step in hours/days (negative: back), or 'now' (the real date). Saved first as 'Before TARS'.",
      params: { date: { type: "string" }, hours: { type: "number", minimum: -1e6, maximum: 1e6 }, now: { type: "boolean" } },
      run: act((a) => {
        net();
        if (a.now) return tools.setDate(new Date().toISOString());
        if (a.date !== undefined) return tools.setDate(String(a.date));
        if (a.hours !== undefined) return tools.jumpTo(tools.now() + ((a.hours as number) * 3600) / (4.925490947e-6 * settings.massSolar));
        throw new Error("give date, hours or now");
      }),
    },
    // ------------------------------------------------------------------ camera, views, the interface
    {
      name: "camera",
      description:
        "The camera (only what is given): shipView: back to the ship's view (from the spectator, a cinematic, the map); mount = a view on the ship (cockpit, cabin, quarter, chase, dorsal, wing, belly, rear, dock, around, free, flyby, station); spectator: a free camera anywhere, the ship flying on; view (without the ship): orbit, follow, free, tripod, fall; lookAt: locked on the target; telescope; fovDeg; cinematic: orbit/dive/journey/none; goTo: fly the free camera to a body; standOn: a tripod on a body's ground.",
      params: {
        mount: { type: "string", enum: MOUNT_IDS },
        spectator: { type: "boolean" },
        view: { type: "string", enum: ["orbit", "follow", "free", "tripod", "fall"] },
        lookAt: { type: "boolean" },
        telescope: { type: "boolean" },
        fovDeg: { type: "number", minimum: 0.02, maximum: 150 },
        cinematic: { type: "string", enum: ["orbit", "dive", "journey", "none"] },
        goTo: { type: "string" },
        standOn: { type: "string" },
        shipView: {
          type: "boolean",
          description: "back to the ship's view: the ship on, the spectator and cinematics off, the map closed",
        },
      },
      run: act((a) => {
        const notes: string[] = [];
        if (a.shipView) {
          if (!settings.ship) h.key("ship");
          h.setSpectator(false);
          h.cinematic(null);
          h.map(false);
          if (a.mount === undefined && (settings.shipMount === "free" || settings.shipMount === "flyby")) h.setMount("chase");
        }
        if (a.spectator !== undefined) h.setSpectator(a.spectator as boolean);
        if (a.mount !== undefined) h.setMount(a.mount as Mount);
        if (a.view !== undefined) h.setView(a.view as never);
        if (a.lookAt !== undefined) h.lookAt(a.lookAt as boolean);
        if (a.telescope !== undefined) h.telescope(a.telescope as boolean);
        if (a.fovDeg !== undefined) camera.setFov(a.fovDeg as number);
        if (a.cinematic !== undefined) h.cinematic(a.cinematic === "none" ? null : (a.cinematic as "orbit"));
        if (a.goTo !== undefined) {
          const why = h.goTo(body(a.goTo));
          if (why) notes.push(why);
        }
        if (a.standOn !== undefined) {
          const why = h.standOn(body(a.standOn));
          if (why) notes.push(why);
        }
        return {
          mount: settings.shipMount,
          spectating: camera.spectating,
          view: settings.rotation,
          lookAt: settings.lookAt,
          telescope: settings.telescope,
          notes,
        };
      }),
    },
    {
      name: "sky",
      description:
        "Turn the view to a constellation or a named star (Orion, Sirius…); show the constellation lines and names, star names, the grids.",
      params: {
        goTo: { type: "string" },
        lines: { type: "boolean" },
        starNames: { type: "boolean" },
        gridEquatorial: { type: "boolean" },
        gridHorizontal: { type: "boolean" },
      },
      run: act((a) => {
        const keys: (keyof Settings)[] = [];
        const set = (k: "skyLines" | "starNames" | "gridEquatorial" | "gridHorizontal", v: unknown) => {
          if (v === undefined) return;
          settings[k] = v as boolean;
          keys.push(k);
          if (k === "skyLines") {
            settings.skyNames = v as boolean;
            keys.push("skyNames");
          }
        };
        set("skyLines", a.lines);
        set("starNames", a.starNames);
        set("gridEquatorial", a.gridEquatorial);
        set("gridHorizontal", a.gridHorizontal);
        if (keys.length) h.changed(keys);
        if (a.goTo !== undefined) {
          const n = fold(String(a.goTo));
          const c = CONSTELLATIONS.findIndex((k) => fold(k.name) === n || fold(k.abbr) === n || fold(FRENCH.get(k.name) ?? "") === n);
          const st = c >= 0 ? -1 : NAMED_STARS.findIndex((k) => fold(k.name) === n || fold(FRENCH.get(k.name) ?? "") === n);
          if (c < 0 && st < 0) throw new Error(`no constellation or named star "${a.goTo}"`);
          h.skyGoTo(c >= 0 ? "constellation" : "star", c >= 0 ? c : st);
          return `turned to ${c >= 0 ? CONSTELLATIONS[c]!.name : NAMED_STARS[st]!.name}`;
        }
        return "done";
      }),
    },
    {
      name: "interface",
      description:
        "The interface: open a panel (settings, place, time, weather, eclipses — the eclipse calculator's page —, scenes, photo, controls, help, pause, planner: the flight computer's MISSION tab over the map, sky, camera) or close the one on top; the map (open, tab: orbit/globe/map); HUD density 0 full, 1 minimal, 2 clean; a screenshot (PNG download).",
      params: {
        open: { type: "string", enum: PANELS },
        close: { type: "boolean" },
        map: { type: "boolean" },
        mapTab: { type: "string", enum: ["orbit", "globe", "map"] },
        hudDensity: { type: "number", minimum: 0, maximum: 2, integer: true },
        screenshot: { type: "boolean" },
      },
      run: act(async (a) => {
        if (a.close) h.close();
        if (a.open !== undefined) h.open(a.open as Panel);
        if (a.map !== undefined || a.mapTab !== undefined) h.map((a.map as boolean) ?? true, a.mapTab as never);
        if (a.hudDensity !== undefined) h.hudDensity(a.hudDensity as 0 | 1 | 2);
        if (a.screenshot) await h.screenshot();
        return "done";
      }),
    },
    // ------------------------------------------------------------------ teleporting, saves, scenes
    {
      name: "place_ship",
      description:
        "Teleport the ship (saved first as 'Before TARS'; a mission running ends). mode: orbit (body, altKm or peKm/apKm, incDeg, retrograde; about Gargantua rM), orbit_over (an orbit passing over lat/lon now), ground (body, lat, lon; or site), near (beside a body at rest, altKm), wormhole (side: ours/gargantua), glide (onto a runway: site, distKm, altKm, speedMs — the entry autopilot lands it), hover (body, lat, lon or site, altKm — at rest over it).",
      params: {
        mode: { type: "string", enum: ["orbit", "orbit_over", "ground", "near", "wormhole", "glide", "hover"] },
        body: { type: "string" },
        site: { type: "string" },
        altKm: { type: "number", minimum: 0, maximum: 1e7 },
        peKm: { type: "number", minimum: 0, maximum: 1e7 },
        apKm: { type: "number", minimum: 0, maximum: 1e8 },
        incDeg: { type: "number", minimum: 0, maximum: 180 },
        retrograde: { type: "boolean" },
        rM: { type: "number", minimum: 1.5, maximum: 1000 },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lon: { type: "number", minimum: -180, maximum: 360 },
        side: { type: "string", enum: ["ours", "gargantua"] },
        distKm: { type: "number", minimum: 2, maximum: 2000 },
        speedMs: { type: "number", minimum: 50, maximum: 8000 },
      },
      required: ["mode"],
      run: act((a) => {
        net();
        const site = a.site !== undefined ? resolveSite(String(a.site)) : null;
        if (a.site !== undefined && !site) throw new Error(`no site named "${a.site}" — list_places lists them`);
        const b = () =>
          site
            ? site.body
            : a.body !== undefined
              ? body(a.body)
              : (() => {
                  throw new Error("give a body or a site");
                })();
        const lat = () => (site ? site.lat : ((a.lat as number) ?? 0));
        const lon = () => (site ? site.lon : ((a.lon as number) ?? 0));
        switch (a.mode) {
          case "orbit":
            return tools.orbit(b(), {
              altKm: a.altKm as number,
              peKm: a.peKm as number,
              apKm: a.apKm as number,
              inc: a.incDeg as number,
              retrograde: a.retrograde as boolean,
              rM: a.rM as number,
            });
          case "orbit_over":
            return tools.orbitOver(b(), lat(), lon(), { altKm: a.altKm as number, inc: a.incDeg as number });
          case "ground":
            return tools.land(b(), lat(), lon());
          case "near":
            return tools.near(b(), { altKm: a.altKm as number, rM: a.rM as number });
          case "wormhole":
            return tools.wormhole((a.side as "ours") ?? "ours");
          case "glide":
            if (!site) throw new Error("glide needs a runway site");
            return tools.glideTo(site.name, (a.distKm as number) ?? 80, (a.altKm as number) ?? 25, (a.speedMs as number) ?? 750);
          default:
            return tools.hoverOver(b(), lat(), lon(), (a.altKm as number) ?? 1.5);
        }
      }),
    },
    {
      name: "saves",
      description:
        "Saved games: save (a name), load (a name; the current game saved first as 'Before TARS'), delete, or undo: back to 'Before TARS' (the state before TARS's last teleport, load, date change or scene).",
      params: { action: { type: "string", enum: ["save", "load", "delete", "undo"] }, name: { type: "string" } },
      required: ["action"],
      run: act((a) => {
        const name = a.name !== undefined ? String(a.name) : undefined;
        switch (a.action) {
          case "save":
            return tools.save(name);
          case "load":
            if (!name) throw new Error("load needs a name (list_saves_and_scenes)");
            net();
            return tools.load(name);
          case "delete":
            if (!name) throw new Error("delete needs a name");
            return tools.deleteSave(name);
          default:
            return tools.load(UNDO_SAVE);
        }
      }),
    },
    {
      name: "start_scene",
      description:
        "Start a scene or a mission by its name (list_saves_and_scenes): the world, the ship, the time it sets. Saved first as 'Before TARS'.",
      params: { name: { type: "string" } },
      required: ["name"],
      run: act((a) => {
        const n = fold(String(a.name));
        const all = h.scenes();
        const hit =
          all.find((s) => fold(s) === n) ??
          all.find((s) => fold(s).includes(n)) ??
          MISSIONS.find((m) => fold(m.title.en).includes(n) || fold(m.title.fr).includes(n))?.scene;
        if (!hit) throw new Error(`no scene named "${a.name}"`);
        net();
        h.applyScene(hit);
        return `scene: ${hit}`;
      }),
    },
    // ------------------------------------------------------------------ settings, keys
    {
      name: "set_settings",
      description:
        "Change settings by key (find_settings gives the keys, types, ranges, options); each value checked. Also quality: low, medium, high, ultra, realtime, game. Your own honesty/humour are tarsHonesty/tarsHumour (0–100).",
      params: {
        changes: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: "string", description: "the value (numbers and true/false as text are fine)" },
            },
            required: ["key", "value"],
          },
        },
        quality: { type: "string", enum: ["low", "medium", "high", "ultra", "realtime", "game"] },
      },
      run: act((a) => {
        const done: Record<string, unknown> = {};
        const errors: string[] = [];
        if (a.quality !== undefined) done.quality = tools.quality(a.quality as Settings["quality"]);
        const keys: (keyof Settings)[] = [];
        for (const c of (a.changes as { key: string; value: unknown }[]) ?? []) {
          const r = checkSetting(c.key, c.value, settings);
          if (!r.ok) {
            errors.push(r.error);
            continue;
          }
          (settings as unknown as Record<string, unknown>)[c.key] = r.value;
          keys.push(c.key as keyof Settings);
          done[c.key] = r.value;
        }
        if (keys.length) h.changed(keys);
        return errors.length ? { set: done, errors } : { set: done };
      }),
    },
    {
      name: "press_key",
      description:
        "Do any keyboard action of the game by its id (list_keys): e.g. 'map', 'missions', 'nextView', 'constellations', 'quality:game', 'warp:1'. For what no other tool does.",
      params: { id: { type: "string" } },
      required: ["id"],
      run: act((a) => {
        const id = String(a.id);
        const k = keyCatalog().find((x) => x.id === id);
        if (!k) throw new Error(`no key action "${id}" — list_keys lists them`);
        const [action, arg] = id.split(":") as [KeyAction, string | undefined];
        h.key(action, arg);
        return `pressed ${id} (${k.key})`;
      }),
    },
    // ------------------------------------------------------------------ waiting, speaking, memory
    {
      name: "wait",
      description:
        "Wait while the game runs (warp it with `time` first for long waits): until the autopilot is off (its job done), landed (stopped on the ground), in_orbit (about `body` if given — else any), docked, the plan executed, a phase stage (orbit, air, entry, approach, ground…), or just seconds. Returns whether it was met and the state then — read it before saying what happened. At most maxSeconds of real time (default 120, max 900).",
      params: {
        until: { type: "string", enum: ["autopilot_off", "landed", "in_orbit", "docked", "plan_done", "stage", "seconds"] },
        stage: {
          type: "string",
          enum: ["ground", "air", "entry", "approach", "suborbital", "orbit", "escape", "docking", "kerr", "throat", "space"],
        },
        body: { type: "string", description: "in_orbit, landed: about / on this body" },
        maxSeconds: { type: "number", minimum: 1, maximum: 900 },
      },
      required: ["until"],
      run: (a, signal) => {
        if (a.until === "stage" && !a.stage) throw new Error("until stage needs stage (ground, air, orbit, docking…)");
        const max = ((a.maxSeconds as number) ?? 120) * 1000;
        const t0 = h.now();
        const on = a.body !== undefined ? body(a.body) : null;
        const about = () => !on || tools.status().soi === on;
        const done = (): boolean => {
          switch (a.until) {
            case "autopilot_off":
              return camera.pilot.auto === "none";
            case "landed":
              return camera.landed && !camera.rolling && about();
            case "in_orbit":
              return tools.status().status === "orbit" && about();
            case "docked":
              return camera.docked;
            case "plan_done":
              return !camera.fcPlan()?.executing && camera.pilot.auto !== "node" && camera.pilot.auto !== "burns";
            case "stage":
              return h.phase()?.stage === a.stage;
            default:
              return false;
          }
        };
        // (what is awaited, in words: the console shows it)
        const words: Record<string, Text> = {
          autopilot_off: { fr: "fin de l'autopilote", en: "the autopilot's end" },
          landed: { fr: "le posé", en: "the landing" },
          in_orbit: { fr: "l'orbite", en: "the orbit" },
          docked: { fr: "l'amarrage", en: "the docking" },
          plan_done: { fr: "le plan exécuté", en: "the plan flown" },
          stage: { fr: "la phase", en: "the phase" },
          seconds: { fr: "le temps", en: "the time" },
        };
        const what = `${tr(words[String(a.until)] ?? { fr: String(a.until), en: String(a.until) })}${a.stage ? ` ${a.stage}` : ""}${on ? ` · ${String(a.body)}` : ""}`;
        let shown = 0;
        return new Promise((res) => {
          const tick = () => {
            if (signal.aborted) {
              h.progress(null);
              return res({ waited: "stopped" });
            }
            const met = a.until !== "seconds" && done();
            // (the wait's live line, once a second: what is awaited, how long, where the craft is)
            if (h.now() - shown > 1000) {
              shown = h.now();
              const st = tools.status();
              const el = Math.round((h.now() - t0) / 1000);
              h.progress(
                `${what} · ${el} s · ${st.soiName} · ${st.label} · ${st.altKm < 100 ? st.altKm.toFixed(2) : Math.round(st.altKm).toLocaleString("en")} km`,
              );
            }
            if (met || h.now() - t0 >= max) h.progress(null);
            if (met || h.now() - t0 >= max)
              return res({
                waited: Math.round((h.now() - t0) / 1000),
                met: a.until === "seconds" ? true : met,
                ...(met || a.until === "seconds" ? {} : { note: "not met: the time ran out — say so, do not claim it happened" }),
                status: {
                  body: tools.status().soiName,
                  status: tools.status().status,
                  altKm: round(tools.status().altKm, 1),
                  orbit: tools.status().orbit,
                },
                pilot: tools.pilotState(),
                phase: h.phase(),
                alerts: h.alerts(),
              });
            setTimeout(tick, 250);
          };
          tick();
        });
      },
    },
    {
      name: "say",
      description:
        "Say a short line aloud now, during a long task before a wait ('Burn in two minutes.'). Not for your final answer (that one is said anyway).",
      params: { text: { type: "string" } },
      required: ["text"],
      run: (a) => {
        h.say(String(a.text));
        return "said";
      },
    },
    // ------------------------------------------------------------------ showing
    {
      name: "show_chart",
      description:
        "Show the pilot a chart beside the flight. Either channels, live — the flight recorder's (alt, speed, vz, g, q, mach, heat, throttle, dv, fuel) and your own (bank, pitch, heading, aoa, sideslip, cmdBank, cmdAoa: the entry's commanded bank and AoA, across: the runway offset, profile: the approach's height deviation); seconds: the window, default 600 — or series you computed (series: [{label, unit, points: [[x, y], …]}], xLabel). Up to 4 lanes.",
      params: {
        title: { type: "string" },
        channels: {
          type: "array",
          maxItems: 4,
          items: { type: "string", enum: [...CHANNELS.map((c) => c.key), ...Object.keys(TARS_CHANNELS)] },
        },
        seconds: { type: "number", minimum: 10, maximum: 1e7 },
        series: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              unit: { type: "string" },
              points: { type: "array", maxItems: 400, items: { type: "array", maxItems: 2, items: { type: "number" } } },
            },
            required: ["label", "points"],
          },
        },
        xLabel: { type: "string" },
      },
      required: ["title"],
      run: (a) => {
        const series = (a.series as { label: string; unit?: string; points: number[][] }[] | undefined)?.map((x) => ({
          label: x.label,
          unit: x.unit,
          points: x.points.filter((p) => p.length === 2) as [number, number][],
        }));
        const channels = a.channels as string[] | undefined;
        if (!series?.length && !channels?.length) throw new Error("give channels (live) or series");
        const secs = (a.seconds as number) ?? 600;
        const mine = (channels ?? []).filter((k) => k in TARS_CHANNELS) as TarsChannel[];
        const id = h.display.show(
          series?.length
            ? { kind: "chart", title: String(a.title), series, xLabel: a.xLabel as string | undefined }
            : mine.length
              ? {
                  kind: "chart",
                  title: String(a.title),
                  lanes: channels!.length,
                  // (the recorder's channels and his own, each in its lane, live)
                  source: () => ({
                    time: true,
                    series: channels!.map((k) =>
                      k in TARS_CHANNELS
                        ? {
                            label: tr(TARS_CHANNELS[k as TarsChannel].label),
                            unit: TARS_CHANNELS[k as TarsChannel].unit,
                            points: h.sampler.series(k as TarsChannel, secs),
                          }
                        : liveSeries([k as RecKey], secs)[0]!,
                    ),
                  }),
                }
              : { kind: "chart", title: String(a.title), live: { channels: channels as RecKey[], seconds: secs } },
        );
        return `chart ${id} shown`;
      },
    },
    {
      name: "show_card",
      description:
        "Show the pilot a card of data you compose — a mission's balance, a comparison, a checklist, figures: a title, rows {label, value, tone: good|caution|bad}, a note.",
      params: {
        title: { type: "string" },
        rows: {
          type: "array",
          maxItems: 16,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              tone: { type: "string", enum: ["good", "caution", "bad"] },
            },
            required: ["label", "value"],
          },
        },
        note: { type: "string" },
      },
      required: ["title", "rows"],
      run: (a) =>
        `card ${h.display.show({ kind: "data", title: String(a.title), rows: a.rows as never, note: a.note as string | undefined })} shown`,
    },
    {
      name: "show_screen",
      description:
        "Open a real screen of the game for the pilot: the map (map_3d, map_globe, map_planisphere), the tablet's pages (telemetry: the flight's curves; approach_chart; flight_computer; ship; log), the last flight_report, the hub's live graph (hub_graph: the burn, climb, entry, glide, descent, approach or docking — the optimum, its corridor, what was flown, the craft now) and the entry corridor (entry_corridor), or a page on a cockpit display (cockpit_pfd, cockpit_orbit, cockpit_nav, cockpit_systems, cockpit_docking, cockpit_plan, cockpit_clocks, cockpit_log, cockpit_approach, cockpit_landing; slot 0–7 the display, default 0).",
      params: { screen: { type: "string", enum: SCREENS }, slot: { type: "number", minimum: 0, maximum: 7, integer: true } },
      required: ["screen"],
      run: act((a) => {
        // (the hub's graph — the entry's corridor among them —: his live card)
        if (a.screen === "entry_corridor" || a.screen === "hub_graph") {
          const src = graphSource(camera, a.screen === "entry_corridor");
          if (!src())
            throw new Error(
              a.screen === "entry_corridor"
                ? "no entry under way: the corridor exists during an entry"
                : "no hub graph now (an autopilot or a manoeuvre has one)",
            );
          return `card ${h.display.show({ kind: "chart", title: src()!.title, lanes: 3, source: src })} shown`;
        }
        return h.screen(a.screen as Screen, a.slot as number | undefined);
      }),
    },
    {
      name: "hide_display",
      description: "Close what you showed: one card (id) or all of them.",
      params: { id: { type: "number", integer: true, minimum: 1 } },
      run: (a) => `${h.display.hide(a.id as number | undefined)} closed`,
    },
    {
      name: "propose_plan",
      description:
        "When the pilot asks you to PROPOSE or SUGGEST a plan ('propose-moi un plan pour…', 'que proposes-tu', 'suggest', 'what would you do'): after gathering real figures (read tools; plan_mission / plan_maneuver with execute: false), propose it here — a title, a one-line summary, the steps in order, the key figures (Δv, duration, arrival…). Do NOT execute anything yourself: the pilot accepts or refuses on screen; accepted, you are asked to carry it out. One proposal per turn, then answer briefly.",
      params: {
        title: { type: "string" },
        summary: { type: "string" },
        steps: { type: "array", maxItems: 10, items: { type: "string" } },
        figures: {
          type: "array",
          maxItems: 8,
          items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
        },
      },
      required: ["title", "summary", "steps"],
      run: (a) => {
        h.propose({
          title: String(a.title),
          summary: String(a.summary),
          steps: (a.steps as string[]) ?? [],
          figures: a.figures as Proposal["figures"],
        });
        return "proposed: the pilot will accept or refuse — do not carry it out now";
      },
    },
    // ------------------------------------------------------------------ waking himself, sub-agents
    {
      name: "schedule",
      description:
        "Set yourself a rule that wakes you later, with what to do then (your own words, an instruction to yourself): on a change of the game — autopilot (to: a mode, or none = an autopilot ended), phase (to: orbit, air, entry, approach, ground…), hub_step, entry_phase, alert (to: warning/caution), soi (to: a body), landed, docked, report, deviation —, every N minutes, at a game time (simTimeS, seconds), or in N seconds. once: fired a single time. Use it when the pilot asks you to watch, remind, check regularly or react to something.",
      params: {
        on: { type: "string", enum: [...EVENT_KINDS, "every", "at", "in"] },
        to: { type: "string" },
        minutes: { type: "number", minimum: 1, maximum: 1440 },
        seconds: { type: "number", minimum: 5, maximum: 86400 },
        simTimeS: { type: "number" },
        prompt: { type: "string" },
        once: { type: "boolean" },
      },
      required: ["on", "prompt"],
      run: (a) => {
        const r = h.triggers.add({
          on: {
            kind: a.on as TriggerKind,
            to: a.to as string | undefined,
            minutes: a.minutes as number | undefined,
            seconds: a.seconds as number | undefined,
            simTime: a.simTimeS as number | undefined,
          },
          prompt: String(a.prompt),
          once: a.once as boolean | undefined,
        });
        return { scheduled: r.id };
      },
    },
    {
      name: "list_schedules",
      description: "Your rules and reflexes that wake you: id, what wakes you, what you do then, on or off, how many times fired.",
      run: () =>
        h.triggers
          .list()
          .map((r) => ({ id: r.id, on: r.on, prompt: r.prompt, enabled: r.enabled, reflex: !!r.reflex, fired: r.fired ?? 0 })),
    },
    {
      name: "cancel_schedule",
      description: "Delete one of your rules (a reflex is switched off), or switch one on or off (enabled).",
      params: { id: { type: "string" }, enabled: { type: "boolean" } },
      required: ["id"],
      run: (a) => {
        const ok = a.enabled !== undefined ? h.triggers.enable(String(a.id), a.enabled as boolean) : h.triggers.remove(String(a.id));
        if (!ok) throw new Error(`no rule "${a.id}" — list_schedules lists them`);
        return "done";
      },
    },
    {
      name: "spawn_agents",
      description: `Run up to ${SUBAGENTS_MAX} sub-agents in parallel — copies of you that only READ the game and COMPUTE (plans worked out, never executed) — each on its own question ("fuel to Mars and back", "the next windows to the station", "is the entry within its corridor"). Their conclusions come back to you; you decide and act. Use it for analyses that take several looks, or to compare options.`,
      params: {
        tasks: {
          type: "array",
          maxItems: SUBAGENTS_MAX,
          items: { type: "object", properties: { name: { type: "string" }, question: { type: "string" } }, required: ["name", "question"] },
        },
      },
      required: ["tasks"],
      run: async (a, signal) => {
        const r = await h.subagents(a.tasks as SubTask[], signal);
        return r.map((x) => ({ name: x.name, ok: x.ok, conclusion: x.text }));
      },
    },
    {
      name: "update_todos",
      description:
        "Your task list, shown to the pilot: for a task of several steps, write its steps (pending, active, done) at the start and update it as you go — the whole list each time.",
      params: {
        items: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: { text: { type: "string" }, status: { type: "string", enum: ["pending", "active", "done"] } },
            required: ["text", "status"],
          },
        },
      },
      required: ["items"],
      run: (a) => {
        h.todos(a.items as { text: string; status: "pending" | "active" | "done" }[]);
        return "shown";
      },
    },
    {
      name: "save_skill",
      description:
        "Save a procedure that worked as one of the pilot's commands: a short name (letters, digits, dashes), what it does, and the request that does it (in the pilot's words). The pilot runs it with /name.",
      params: { name: { type: "string" }, description: { type: "string" }, prompt: { type: "string" } },
      required: ["name", "description", "prompt"],
      run: (a) => {
        const name = String(a.name)
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-|-$/g, "");
        if (!name) throw new Error("a name of letters, digits and dashes");
        h.skills.save(name, String(a.description), String(a.prompt));
        return `saved as /${name}`;
      },
    },
    {
      name: "memory",
      description:
        "Your long-term memory of this pilot: remember a short note (their name, a preference, a plan), forget the notes about something, or clear everything (only when the pilot asks you to forget all).",
      params: { action: { type: "string", enum: ["remember", "forget", "clear"] }, note: { type: "string" } },
      required: ["action"],
      run: (a) => {
        if (a.action === "clear") {
          h.memory.clear();
          h.triggers.clear();
          return "memory cleared";
        }
        if (!a.note) throw new Error(`${a.action} needs a note`);
        if (a.action === "forget") return `${h.memory.forget(String(a.note))} notes forgotten`;
        return h.memory.remember(String(a.note)) ? "noted" : "notes full — forget some first";
      },
    },
  ];
  return tools_;
}

/** The hub's graph as a live card's source (the entry's corridor from the entry run when the hub has none). */
function graphSource(camera: CameraController, entryOnly: boolean) {
  // biome-ignore lint/suspicious/noExplicitAny: the controller's state, read loosely
  const c = camera as any;
  return () => {
    const g = c.hubInfo?.()?.graph;
    if (g && (!entryOnly || g.kind === "entry"))
      return {
        title: g.title as string,
        overlay: true,
        band: [0, 1] as [number, number],
        now: g.now as [number, number] | null,
        xLabel: `${g.x.label} (${g.x.unit})`,
        yUnit: g.y.unit as string,
        series: [
          { label: "lo", points: (g.lo ?? []) as [number, number][], color: "#78ffaa" },
          { label: "hi", points: (g.hi ?? []) as [number, number][], color: "#78ffaa" },
          { label: tr({ fr: "optimum", en: "optimum" }), points: g.ideal as [number, number][], color: "#7cd6ff" },
          { label: tr({ fr: "volé", en: "flown" }), points: g.flown as [number, number][], color: "#ffc85a" },
        ],
      };
    const e = c.entryRun;
    if (!e?.corr?.length) return null;
    const pred = (e.guid?.last?.track ?? []) as [number, number][];
    return {
      title: tr({ fr: "Couloir de rentrée", en: "Entry corridor" }),
      overlay: true,
      band: [0, 1] as [number, number],
      now: (e.trace?.at(-1) ?? null) as [number, number] | null,
      xLabel: tr({ fr: "vitesse (km/s)", en: "speed (km/s)" }),
      yUnit: "km",
      series: [
        {
          label: "lo",
          points: e.corr.map((p: { v: number; lo: number }) => [p.v / 1e3, p.lo / 1e3]) as [number, number][],
          color: "#78ffaa",
        },
        {
          label: "hi",
          points: e.corr.map((p: { v: number; hi: number }) => [p.v / 1e3, p.hi / 1e3]) as [number, number][],
          color: "#78ffaa",
        },
        {
          label: tr({ fr: "prévu", en: "predicted" }),
          points: pred.map(([v, h]) => [v / 1e3, h / 1e3]) as [number, number][],
          color: "#7cd6ff",
        },
        { label: tr({ fr: "volé", en: "flown" }), points: (e.trace ?? []) as [number, number][], color: "#ffc85a" },
      ],
    };
  };
}
