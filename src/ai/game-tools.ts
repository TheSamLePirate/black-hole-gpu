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

import type { MissionSpec } from "../game/mission";
import { completeMission, type Resolver, type Sketch } from "../game/missionedit";
import type { RecoveryCase } from "../game/trap";
import { f35Variant } from "../f35/variant";
import type { GameMode } from "../game/modes";
import type { Auto, Hold } from "../pilot";
import type { CameraController } from "../controls";
import type { Settings, Target } from "../settings";
import type { GameTools } from "../game/tools";
import { type QualId, QUALS, utcHourAt } from "../game/quals";
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
import { GARGANTUA_SYSTEM } from "../system/bodies";
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
import { ORDER_IDS, type OrderId } from "../game/orders";
import { FORMATION_IDS } from "../game/formations";

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
  localMap?: { state(): unknown; zoom(value: number): number };
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
  multiExposure?(r: import("../ui/multiexposure").MxRequest): Promise<{ rendered: number; outside?: { n: number; of: number } } | null>;
  /** the view framed on the Earth's ground now (on foot, the tripod, the free camera near it): its place [°], its aim
   *  (azimuth from the north, altitude) and vertical field [°]; null: none */
  framedView?(): { lat: number; lon: number; az: number; alt: number; fov: number } | null;
  /** the ISS's visible passes from a place over days from a date (photo/iss-pass.ts) */
  issPasses?(lat: number, lon: number, from: number, days: number): import("../photo/iss-pass").IssPass[];
  /** taken to see an eclipse (PLAN-CIEL C7): the one of that kind nearest a date (within 3 days), from a place
   *  if it is seen there, else from where it is best; its id, or null: none */
  seeEclipse?(kind: "solar" | "lunar" | "transit", t: number, place: { lat: number; lon: number } | null): Promise<string | null>;
  /** the clouds of the day drawn over the Earth (the real weather's satellite mosaic: its date, its layer), or null */
  dayClouds?(): { date: string; layer: string } | null;
  /** the game's mode (game/modes.ts): now, into another (why not, or null), the top bar shown or hidden */
  mode?: { get(): GameMode; set(m: GameMode): string | null; hideBar(on: boolean): void };
  /** the ship placed as the Place panel and the Atlas place it (main.ts placeShip: a mission ended, the game's
   *  world loaded, the walker back aboard, the panels redrawn): its note */
  place?(f: () => string): string;
  /** the observatory (ui/observe.ts, system/observing.ts): from where one stands on the Earth's ground — a thing's
   *  windows (when it is up, in a sky dark enough for it, its best moment), the telescope taken to it, the page */
  observe?: {
    when(
      q: string,
      o: { from?: number; days?: number },
    ):
      | {
          name: string;
          now: { alt: number; az: number } | null;
          windows: { from: number; to: number; best: number; alt: number; az: number; sky: string }[];
        }
      | string;
    look(q: string, at?: number | "best"): string | null;
    open(q?: string): void;
  };
  /** the missions (PLAN-AVIATION-AAA P1–P3 — ui/airmission.ts, ui/missioneditor.ts): listed, one flown (its id or
   *  its spec), the one flown, given up, its map, the editor, a mission kept, its link */
  missions?: {
    list(): { id: string; title: string; mine: boolean }[];
    spec(id: string): MissionSpec;
    fly(x: string | MissionSpec): string;
    state(): object | null;
    abort(): void;
    map(): void;
    edit(spec?: MissionSpec): void;
    keep(spec: MissionSpec): void;
    link(spec: MissionSpec): string;
  };
  /** the F-35's flights (ui/flighthub.ts, ui/challengepanel.ts): its airfields, a flight set up, the challenges and fights
   *  (their bests), one flown, the one running given up */
  f35?: {
    fields(): { icao: string | null; name: string }[];
    prepare(o: { field: string; start?: string; hour?: string; weather?: string; fuel?: number; dest?: string }): string;
    challenges(): { id: string; title: string; kind: string; par: number; best: { score: number; medal: string | null } | null }[];
    fights(): { id: string; title: string }[];
    fly(id: string): string;
    abort(): string;
    /** the aerobatic figures (game/aerobatics.ts): their ids, names, what they are, their entries and bests; one
     *  watched (flown by its program before the player) or flown by the player and judged; the box */
    figures(): { id: string; name: string; brief: string; entry: object; best: number | null }[];
    figure(id: string, mode: "watch" | "fly"): string;
  };
  /** the music (audio/music.ts): its state, its themes, its mode, a theme listened to, its intensity, its mixer */
  music?: {
    state(): object;
    themes(): { id: string; name: string }[];
    set(o: { mode?: string; listen?: string | null; intensity?: number | null; layer?: string; level?: number; mute?: boolean }): string;
  };
  /** the Atlas (ui/atlas.ts): the destinations and the Earth's addresses found; the game put at a place; the page */
  atlas?: {
    search(
      q: string,
      body?: "earth" | "moon" | "mars",
    ): Promise<{ name: string; body: string; lat: number; lon: number; kind: string; detail?: string }[]>;
    go(
      to: "orbit" | "land" | "walk" | "camera" | "tripod",
      p: { body: "earth" | "moon" | "mars"; lat: number; lon: number; name: string },
    ): string | null;
    open(o: { body?: "earth" | "moon" | "mars"; query?: string }): void;
  };
  /** the sky's events from where one stands on the Earth (ui/skyevents.ts): listed, taken a way, the page opened */
  skyEvents?: {
    list(): Promise<
      | {
          id: string;
          title: string;
          when: string | null;
          detail: string;
          look: { azDeg: number; altDeg: number; fovDeg: number; lensMm: number };
          render: boolean;
          transit?: boolean;
        }[]
      | null
    >;
    take(id: string, way: "go" | "live" | "render"): string | null;
    open(): string | null;
    /** the live capture running stopped: why not (none running), or null */
    stopLive?(): string | null;
  };
  /** a video (renderdialog.ts, PLAN-MODES-AAA M8): a shot filmed — a draft to test it, or the final —, its state, stopped */
  video?: {
    start(o: { shot: string; seconds?: number; fps?: number; draft?: boolean; format?: "mp4" | "webm" }): string | null;
    state(): {
      shot: string;
      draft: boolean;
      frame: number;
      frames: number;
      etaS: number;
      width: number;
      height: number;
      format: string | null;
    } | null;
    stop(): void;
    shots(): { id: string; label: string; available: boolean }[];
  };
  /** the offline capture (renderdialog.ts): the view now rendered converged, saved by itself; its state; stopped */
  capture?: {
    start(o: { preset?: string; width?: number; height?: number; spp?: number; save?: "png" | "png16" | "exr" | null }): string | null;
    state(): {
      active: boolean;
      progress: number | null;
      done: boolean;
      width: number;
      height: number;
      spp: number;
      autoSave: string | null;
    };
    stop(): void;
    save(kind: "png" | "png16" | "exr"): void;
  };
}

export const SCREENS = [
  "map_3d",
  "map_globe",
  "map_planisphere",
  "telemetry",
  "character",
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
  "music",
  "render",
  "atlas",
  "skyevents",
  "observe",
  "multiexposure",
  "flighthub",
  "route",
  "challenges",
  "title",
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
/** the worlds one walks on (a solid surface: Gargantua's planets and ours) */
const WALK_BODIES = GARGANTUA_SYSTEM.bodies.filter((b) => b.kind === "planet" && b.surface && b.surface.kind !== "gas").map((b) => b.id);

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
  /**
   * The place a tool names — `site` (a runway or site), `query` (a site, a destination, an address on the Earth,
   * coordinates: the Atlas's search, WGS84), or `body` with `lat`/`lon` —, or null when none is named (a mode that
   * needs none: orbit, near, wormhole).
   */
  const placeOf = async (a: Args): Promise<{ body: string; lat: number; lon: number; name?: string; site?: Site } | null> => {
    const on = a.body !== undefined ? body(a.body) : undefined;
    if (a.site !== undefined) {
      const site = resolveSite(String(a.site), on);
      if (!site) throw new Error(`no site named "${a.site}" — list_places lists them`);
      return { body: site.body, lat: site.lat, lon: site.lon, name: site.name, site };
    }
    if (a.query !== undefined) {
      const q = String(a.query);
      // (a runway named exactly or by its ICAO code; a part of a name — "Paris" — is the Atlas's to find: the city first)
      const n = fold(q);
      const site = SITES.find((s) => (!on || s.body === on) && (fold(s.name) === n || s.icao?.toLowerCase() === n));
      if (site) return { body: site.body, lat: site.lat, lon: site.lon, name: site.name, site };
      const world = on === "earth" || on === "moon" || on === "mars" ? on : undefined;
      if (on && !world) throw new Error(`places by name are on the Earth, the Moon and Mars — on ${on}, give lat/lon`);
      const hit = (await h.atlas?.search(q, world))?.[0];
      if (!hit) throw new Error(`nothing found for "${q}"${world ? ` on ${world}` : ""}`);
      const found = SITES.find((s) => s.body === hit.body && s.name === hit.name);
      return { body: hit.body, lat: hit.lat, lon: hit.lon, name: hit.name, site: found };
    }
    if (on !== undefined) return { body: on, lat: (a.lat as number) ?? 0, lon: (a.lon as number) ?? 0 };
    return null;
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
        "The whole situation now: phase, status and orbit (km, m/s), fuel and Δv, target, next event, autopilot/hold/throttle, alerts, landing/runway state, mission, date, warp, view, craft, satellite surface region/availability/memory and worldwide 3D scenery availability, counts and memory. Call it before acting when unsure.",
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
          mode: h.mode?.get() ?? null,
          view: { ship: settings.ship, mount: settings.shipMount, spectating: camera.spectating, vessel: settings.vessel },
          hud: { kind: settings.hudKind, views: settings.hudViews },
          gear: { down: camera.gearDown, flaps: camera.airFlight?.cfg.flaps, airBrake: camera.airBrake },
          docked: camera.docked,
          surface: tools.perf({ gpu: false }).earthSurface,
          scenery: tools.perf({ gpu: false }).earthScenery,
          sceneryHitboxes: settings.sceneryHitboxes,
          character: camera.character.state(),
          grass: tools.perf({ gpu: false }).grass,
          localMap: h.localMap?.state(),
          streaming: tools.perf({ gpu: false }).streaming,
        };
      },
    },
    {
      name: "get_telemetry",
      description:
        "Everything the cockpit and the hub know, now, in figures (degrees, metres, m/s, s): attitude (pitch, bank, heading, angle of attack, sideslip, stall AoA), air (height, airspeed, Mach, q, heat, load, skin temperatures and margins, wind), controls (throttle, thrust, surface deflections, flaps, air brake, gear, holds), autopilot (director, flight-computer command, launch goal), hub (its title, current step, rows, next, progress, cue: time to ignition and Δv left, callout, its graph's verdict on/off/wait and the fix), entry (phase, commanded bank and AoA, range and heading error to the site, miss, in corridor, planned peaks, reversal), approach (runway offset, height, PAPI whites 0–4, commanded vs flown ground path angle, height over the threshold, ground speed and airspeed, profile deviation, leg, flare, MLS, wind), descent (powered landing's command), burn (plan, cue), dock (offsets, signed actual and commanded closing rates in the rotating port frame), sky (the world under the camera, the Sun's and the Moon's altitude and azimuth — true and as seen through the Earth's air —, the refraction at the horizon and the air's refractivity). surface (regional satellite loading and memory), scenery (worldwide forests, OSM buildings/roads/railways/water/bridges, source layer/field inventory, cast-shadow state and ranges, counts, loading, memory and errors), character (on foot: the world, position, speed, vertical speed, grounded, height over the ground, time airborne, the craft's hull distance, the ground patch, the last error), grass (on the Earth on foot: on or why not, blades and stones drawn, loading, memory). map (local position, zoom, source availability and CPU drawing cost), streaming (bounded prediction distance and look-ahead time). Ask only the groups you need.",
      params: { groups: { type: "array", maxItems: TELEMETRY_GROUPS.length, items: { type: "string", enum: TELEMETRY_GROUPS } } },
      run: (a) =>
        telemetry(
          camera,
          (a.groups as TelemetryGroup[] | undefined)?.length ? (a.groups as TelemetryGroup[]) : TELEMETRY_GROUPS,
          tools.perf({ gpu: false }).earthSurface,
          tools.perf({ gpu: false }).earthScenery,
          tools.perf({ gpu: false }).grass,
          h.localMap?.state(),
          tools.perf({ gpu: false }).streaming,
        ),
    },
    {
      name: "character",
      description:
        "Walk on solid planets. disembark/board use the same safety checks as Shift+K; start places an explorer at geodetic lat/lon (both required) on body (default earth; saved first as 'Before TARS'); move lasts at most 10 seconds; jump, stop, orbit (the camera around the walker: only the yaw/pitch given change) and status. Grass runs only on Earth on foot. Units metres, seconds and degrees.",
      params: {
        action: { type: "string", enum: ["disembark", "board", "start", "move", "stop", "jump", "orbit", "status"] },
        body: { type: "string", enum: WALK_BODIES },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lon: { type: "number", minimum: -180, maximum: 180 },
        forward: { type: "number", minimum: -1, maximum: 1 },
        right: { type: "number", minimum: -1, maximum: 1 },
        seconds: { type: "number", minimum: 0, maximum: 10 },
        run: { type: "boolean" },
        yaw: { type: "number", minimum: -180, maximum: 180 },
        pitch: { type: "number", minimum: -8, maximum: 68 },
      },
      required: ["action"],
      run: act((a) => {
        const c = camera.character;
        let error: string | null = null;
        switch (a.action) {
          case "disembark":
            error = c.disembark();
            break;
          case "board":
            error = c.board();
            break;
          case "start": {
            const world = String(a.body ?? "earth");
            // (no default place: 0°/0° is the sea off Africa)
            if (a.lat === undefined || a.lon === undefined) error = "start needs lat and lon";
            else if (!WALK_BODIES.includes(world)) error = `cannot walk on "${world}": ${WALK_BODIES.join(", ")}`;
            else {
              net();
              error = c.start(world, Number(a.lat), Number(a.lon));
            }
            break;
          }
          case "move":
            error = c.move(Number(a.forward ?? 0), Number(a.right ?? 0), Number(a.seconds ?? 1), !!a.run);
            break;
          case "stop":
            c.move(0, 0, 0);
            break;
          case "jump":
            c.jump();
            break;
          case "orbit":
            if (a.yaw !== undefined) c.yaw = (Number(a.yaw) * Math.PI) / 180;
            if (a.pitch !== undefined) c.pitch = (Number(a.pitch) * Math.PI) / 180;
            break;
        }
        h.changed([]);
        return { ...c.state(), ok: !error, error };
      }),
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
        "Make a multiple-exposure photograph (several renders from one fixed tripod blended into one image, shown to the player with a Download button). 'trails': star trails over hours of a dark night (`date` its evening, `hours`, `count` frames 40–160, `toward` the pole or a quarter, `fov`, `comet`). 'moon': the Moon's way — `mode` night (every `step` min, `span` h about its highest), daily (each day at `time` UTC for `days`), lunar (each lunar day: the lunar analemma). 'iss': the ISS's trail on its visible pass nearest `date` (iss_passes lists them; `dashes` for an interval shooting's gaps). 'analemma': the Sun at the same UTC time every N days for a year from a place, its figure-eight over the landscape. 'eclipse': a solar or lunar eclipse seen from a place — `before` phases, the central one (totality, ring or greatest), `after` phases, each disc taken through a telephoto and laid where it was in the sky, over the landscape (the totality's own twilight, or dusk) or black; the eclipse nearest `date` that is seen from there (find_eclipses gives them). It takes from seconds to a few minutes; the player sees its progress. Place: lat/lon or a site; default the player's. fromView: from the view the player framed on the Earth's ground (on foot, the tripod, the free camera near it) — its place, its aim and its field kept, the series not framing itself (the answer says how much of the subject falls outside it).",
      params: {
        kind: { type: "string", enum: ["analemma", "eclipse", "trails", "moon", "iss"] },
        fromView: { type: "boolean", description: "from the camera's framing now (its place, aim and field), not one the series chooses" },
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
        eclipse: {
          type: "string",
          enum: ["solar", "lunar", "transit"],
          description: "eclipse: of the Sun or the Moon (default solar), or a planet's transit across the Sun (Mercury, Venus)",
        },
        layout: {
          type: "string",
          enum: ["sky", "strip", "shadow"],
          description:
            "eclipse: in the tripod's sky over the landscape (default), the phases in a row (north up, black), or (lunar) the Moons placed about the Earth's shadow with its umbra and penumbra drawn",
        },
        planet: { type: "string", enum: ["mercury", "venus"], description: "transit: which planet (default the nearest transit's)" },
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
        const framed = a.fromView ? (h.framedView?.() ?? null) : null;
        if (a.fromView && !framed)
          return {
            error:
              "no view framed on the Earth's ground: walk, set the tripod (camera view tripod) or take the free camera near the ground first",
          };
        const site = a.site ? resolveSite(String(a.site), "earth") : null;
        const here = camera.weatherPlace?.();
        const lat = framed?.lat ?? site?.lat ?? (a.lat !== undefined ? Number(a.lat) : here?.body === "earth" ? here.lat : 48.86);
        const lon = framed?.lon ?? site?.lon ?? (a.lon !== undefined ? Number(a.lon) : here?.body === "earth" ? here.lon : 2.35);
        const now = h.utcNow?.() ?? Date.now();
        const clamp = (v: unknown, d: number, lo: number, hi: number) => Math.min(Math.max(Number(v ?? d), lo), hi);
        let r: { rendered: number; outside?: { n: number; of: number } } | null;
        const dateOf = (d: unknown) => (d ? Date.parse(String(d)) : now);
        const common = {
          lat,
          lon,
          width: 1920,
          height: 1080,
          framing: a.framing === "sky" ? ("sky" as const) : ("landscape" as const),
          sky: a.sky === "game" ? ("game" as const) : ("clear" as const),
          ...(framed ? { view: { az: framed.az, alt: framed.alt, fov: framed.fov } } : {}),
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
            ...(framed ? { view: common.view } : {}),
            eclipse: a.eclipse === "lunar" ? "lunar" : a.eclipse === "transit" && !framed ? "transit" : "solar",
            // (from the player's view: in the tripod's sky — a row, the shadow's map, a transit lay their own)
            layout: framed ? "sky" : a.eclipse === "transit" ? "transit" : ((a.layout as "sky" | "strip" | "shadow" | undefined) ?? "sky"),
            planet: a.planet === "mercury" || a.planet === "venus" ? a.planet : undefined,
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
            ...(framed ? { view: common.view } : {}),
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
          ? {
              ok: true,
              exposures: r.rendered,
              shown: "the image is in the Multiple exposure dialog (Download PNG)",
              ...(r.outside?.n ? { outsideFraming: `${r.outside.n} of ${r.outside.of} outside the player's framing` } : {}),
            }
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
      params: { ship: { type: "boolean" }, vessel: { type: "string", enum: ["ranger", "lander", "endurance", "f35"] } },
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
        "The camera (only what is given): shipView: back to the ship's view (from the spectator, a cinematic, the map); mount = a view on the ship (cockpit, cabin, quarter, chase, dorsal, wing, belly, rear, dock, around, free, flyby, station); spectator: a free camera anywhere, the ship flying on; view (without the ship): orbit, follow, free, tripod, fall; lookAt: locked on the target; telescope; spot: the telescope's spot meter (the exposure set by the target's disc alone — a faint object, the wormhole's mouth, drawn bright; on by default); fovDeg; cinematic: orbit/dive/journey/none; goTo: fly the free camera to a body; standOn: a tripod on a body's ground.",
      params: {
        mount: { type: "string", enum: MOUNT_IDS },
        spectator: { type: "boolean" },
        view: { type: "string", enum: ["orbit", "follow", "free", "tripod", "fall"] },
        lookAt: { type: "boolean" },
        telescope: { type: "boolean" },
        spot: { type: "boolean" },
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
        if (a.spot !== undefined) {
          camera.viewController().s.telescopeSpot = settings.telescopeSpot = a.spot as boolean;
          h.changed(["telescopeSpot"]);
        }
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
          spot: settings.telescopeSpot,
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
        "The interface: open a panel (settings, place, time, weather, eclipses — the eclipse calculator's page —, scenes, photo — the photo mode —, controls, help, pause, planner: the flight computer's MISSION tab over the map, sky, camera, music — the music console —, render — the offline render dialog, atlas, skyevents, observe — the observatory —, multiexposure, flighthub — the F-35's flight preparation —, route — its flight plan —, challenges, title — the title screen) or close the one on top; the map (open, tab: orbit/globe/map; on the ground: local planisphere, mapZoom 0–21, default 18); HUD density 0 full, 1 minimal, 2 clean; the ship's HUD (hudKind: auto — by the flight —, atmo, space, approach) and where it shows (hudViews: chaseDorsal — the default —, outside, all; in the cockpit the cabin's screens); a screenshot (PNG download).",
      params: {
        open: { type: "string", enum: PANELS },
        close: { type: "boolean" },
        map: { type: "boolean" },
        mapTab: { type: "string", enum: ["orbit", "globe", "map"] },
        mapZoom: {
          type: "number",
          minimum: 0,
          maximum: 21,
          description: "Local ground planisphere zoom, default 18; on foot or a landed craft.",
        },
        hudDensity: { type: "number", minimum: 0, maximum: 2, integer: true },
        hudKind: { type: "string", enum: ["auto", "atmo", "space", "approach"] },
        hudViews: { type: "string", enum: ["chaseDorsal", "outside", "all"] },
        screenshot: { type: "boolean" },
      },
      run: act(async (a) => {
        if (a.close) h.close();
        if (a.open !== undefined) h.open(a.open as Panel);
        if (a.map !== undefined || a.mapTab !== undefined) h.map((a.map as boolean) ?? true, a.mapTab as never);
        if (a.mapZoom !== undefined) {
          h.map(true, "map");
          h.localMap?.zoom(Number(a.mapZoom));
        }
        if (a.hudDensity !== undefined) h.hudDensity(a.hudDensity as 0 | 1 | 2);
        if (a.hudKind !== undefined || a.hudViews !== undefined) {
          if (a.hudKind !== undefined) settings.hudKind = a.hudKind as Settings["hudKind"];
          if (a.hudViews !== undefined) settings.hudViews = a.hudViews as Settings["hudViews"];
          h.changed(["hudKind", "hudViews"]);
        }
        if (a.screenshot) await h.screenshot();
        return "done";
      }),
    },
    {
      name: "set_mode",
      description:
        "The game's mode, as the top bar's tabs and F1–F4: ship (fly the craft — back on board, back from the spectator), foot (on foot: out of the landed, still craft; else set down on the solid world under the camera — far from any, place_ship or character start first), free (the free camera anywhere in the system; a ship flown flies on, its autopilots and plan), photo (the photo mode over the current one: the view alone, renders). bar: show or hide the top bar. Returns the mode now, or why not.",
      params: {
        mode: { type: "string", enum: ["ship", "foot", "free", "photo"] },
        bar: { type: "string", enum: ["show", "hide"] },
      },
      run: act((a) => {
        if (!h.mode) return { ok: false, error: "no modes here" };
        if (a.bar) h.mode.hideBar(a.bar === "hide");
        // (on foot may set the walker down elsewhere: the net first)
        if (a.mode === "foot" && h.mode.get() !== "foot") net();
        const error = a.mode ? h.mode.set(a.mode as GameMode) : null;
        return { ok: !error, error, mode: h.mode.get() };
      }),
    },
    {
      name: "atlas",
      description:
        "The Atlas of the Earth, the Moon and Mars. search: the destinations (launch sites, summits, wonders, observatories, cities, poles; the Apollo sites, craters, seas; the rovers, volcanoes, canyons), the runways and viewpoints, and on the Earth any address or place name (OpenStreetMap) or coordinates — names, places [°], kinds. go: the game put at a place (lat, lon, or the first found for query): to orbit (an orbit over it now), land (the craft set down there), walk (landed, you on foot beside it), camera (the free camera above it, looking at it), tripod (the camera on the ground there). open: the Atlas's page, on a world, a search typed.",
      params: {
        action: { type: "string", enum: ["search", "go", "open"] },
        query: { type: "string" },
        body: { type: "string", enum: ["earth", "moon", "mars"] },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lon: { type: "number", minimum: -180, maximum: 180 },
        to: { type: "string", enum: ["orbit", "land", "walk", "camera", "tripod"] },
      },
      required: ["action"],
      run: act(async (a) => {
        const A = h.atlas;
        if (!A) return { ok: false, error: "no Atlas here" };
        const body = a.body as "earth" | "moon" | "mars" | undefined;
        if (a.action === "open") {
          A.open({ body, query: a.query as string | undefined });
          return { ok: true };
        }
        const found = a.query ? await A.search(String(a.query), body) : [];
        if (a.action === "search") return { ok: true, found: found.slice(0, 12) };
        const p =
          a.lat !== undefined && a.lon !== undefined
            ? { body: body ?? "earth", lat: Number(a.lat), lon: Number(a.lon), name: String(a.query ?? `${a.lat}, ${a.lon}`) }
            : found[0]
              ? { body: found[0].body as "earth" | "moon" | "mars", lat: found[0].lat, lon: found[0].lon, name: found[0].name }
              : null;
        if (!p) return { ok: false, error: "no place: give lat and lon, or a query that finds one" };
        net();
        const error = A.go((a.to as "orbit" | "land" | "walk" | "camera" | "tripod" | undefined) ?? "camera", p);
        return { ok: !error, error, place: p };
      }),
    },
    {
      name: "sky_events",
      description:
        "The sky's events from where one stands on the Earth (walking, the tripod, the free camera over the ground) and the way one looks: the star trails (circumpolar when the pole is up), the analemma, the Moon's path tonight, the next ISS pass, the ISS's closest approach to the Moon and the Sun (a transit when it crosses their disc), the next solar and lunar eclipses seen here, the next selenelion, the next transits of Mercury and Venus — each with its date (UTC), where to look (azimuth, altitude), the field and the lens. list: them all (takes a few seconds: the eclipses searched over 30 years). take (id from the list): go — the tripod set there at that time, aimed; live — its exposures taken one after the other in the game and stacked on screen (the pilot watches the event unfold; saved as a PNG or rendered at full quality after); render — the multiple exposure's full-quality dialog filled. stop_live: the live capture running stopped (what it stacked kept on screen). open: the page.",
      params: {
        action: { type: "string", enum: ["list", "take", "open", "stop_live"] },
        id: { type: "string" },
        way: { type: "string", enum: ["go", "live", "render"] },
      },
      required: ["action"],
      run: act(async (a) => {
        const S = h.skyEvents;
        if (!S) return { ok: false, error: "no sky events here" };
        if (a.action === "open") {
          const error = S.open();
          return { ok: !error, error };
        }
        if (a.action === "stop_live") {
          const error = S.stopLive?.() ?? "not available";
          return { ok: !error, error };
        }
        if (a.action === "list") {
          const events = await S.list();
          return events ? { ok: true, events } : { ok: false, error: "not on the Earth's ground: walk there (F2), or set the tripod (⇧T)" };
        }
        if (!a.id) return { ok: false, error: "take needs an id from the list" };
        // (go and live move the tripod and the clock: the net first; render only fills a dialog)
        if (a.way !== "render") net();
        const error = S.take(String(a.id), (a.way as "go" | "live" | "render" | undefined) ?? "go");
        return { ok: !error, error };
      }),
    },
    {
      name: "video",
      description:
        "A video of the view, in every mode — each frame an offline render. shot: live (the scene goes on from now as it would: the ship and its autopilot, the mission, the time), take (the take recorded live with ● on the time bar), orbit (the auto-orbit around the target), dive (to the horizon), journey (through the wormhole), director (the director's cameras on the ship flown: chase, orbit, pass, tracking). draft: true for a quick test — 640×360, 4 samples, seconds to minutes — played at once with a button for the final; false for the final at the render dialog's size and quality (minutes to hours: say so). seconds (1–600), fps (24, 30, 60), format (mp4, else webm). start, status (frame, frames, time left), stop, shots (which can film now). The pilot sees it when it is done (a draft plays by itself; a final is saved).",
      params: {
        action: { type: "string", enum: ["start", "status", "stop", "shots"] },
        shot: { type: "string", enum: ["live", "take", "orbit", "dive", "journey", "director"] },
        seconds: { type: "number", minimum: 1, maximum: 600 },
        fps: { type: "number", minimum: 24, maximum: 60, integer: true, description: "24, 30 or 60" },
        draft: { type: "boolean" },
        format: { type: "string", enum: ["mp4", "webm"] },
      },
      required: ["action"],
      run: act((a) => {
        const V = h.video;
        if (!V) return { ok: false, error: "no video here" };
        if (a.action === "shots") return { ok: true, shots: V.shots() };
        if (a.action === "status") return { ok: true, video: V.state() };
        if (a.action === "stop") {
          V.stop();
          return { ok: true };
        }
        const error = V.start({
          shot: String(a.shot ?? "orbit"),
          seconds: a.seconds as number | undefined,
          fps: a.fps as number | undefined,
          draft: a.draft === undefined ? true : !!a.draft,
          format: a.format as "mp4" | "webm" | undefined,
        });
        return { ok: !error, error, video: V.state() };
      }),
    },
    {
      name: "capture",
      description:
        "The offline capture, in every mode: the view now (the ship's, the walker's, the free camera's) rendered converged — noise-free, any size — and saved by itself as a PNG once done (save: png, png16, exr or none). start (preset: 'Mega photo · 8K reference'; or width, height, spp: 16 to 4096), status (progress 0…1, done), save (the picture now, as a kind), stop. A render takes from seconds to minutes: say so, then wait or let the pilot know when it is done (schedule on render).",
      params: {
        action: { type: "string", enum: ["start", "status", "save", "stop"] },
        preset: { type: "string", enum: ["Mega photo · 8K reference"] },
        width: { type: "number", minimum: 16, maximum: 16384, integer: true },
        height: { type: "number", minimum: 16, maximum: 16384, integer: true },
        spp: { type: "number", minimum: 16, maximum: 4096, integer: true },
        save: { type: "string", enum: ["png", "png16", "exr", "none"] },
      },
      required: ["action"],
      run: act((a) => {
        const c = h.capture;
        if (!c) return { ok: false, error: "no capture here" };
        if (a.action === "start") {
          const error = c.start({
            preset: a.preset as string | undefined,
            width: a.width as number | undefined,
            height: a.height as number | undefined,
            spp: a.spp as number | undefined,
            save: a.save === "none" ? null : (a.save as "png" | "png16" | "exr" | undefined),
          });
          return { ok: !error, error, ...c.state() };
        }
        if (a.action === "save") c.save((a.save === "none" ? "png" : (a.save as "png" | "png16" | "exr" | undefined)) ?? "png");
        if (a.action === "stop") c.stop();
        return { ok: true, ...c.state() };
      }),
    },
    // ------------------------------------------------------------------ teleporting, saves, scenes
    {
      name: "f35",
      description:
        "The F-35B's flights. fields: the airfields a flight starts from. prepare: a flight set up and started at once — field (ICAO or name), start (runway: lined up; final: on a 15 km final; cruise: 40 km out), hour (now, dawn, morning, noon, dusk, night — the airfield's own), weather (real, fair, cloudy, overcast, rain, storm, windy, fog), fuel (0.05–1 of full), dest (an arrival field: a flight plan to it, flown with flight_plan / LNAV). challenges: the challenges (Mach Loop, Rainbow Canyon, the slalom, the landings, the aerobatics) and fights with their bests and medals. fly: a challenge or a fight by its id, started (the F-35 at its start, tanks full, the judge or the aggressors running). abort: the challenge or fight running given up. figures: the aerobatic figures (loop, immelmann, splitS, aileronRoll, barrelRoll, cuban8, inverted, highAlpha, reversal, spin) with their entries and bests. figure: one by its id (or \"box\": five in a row, out of 100) — mode watch: the autopilot flies it before the player, the cues said; mode fly: the F-35 placed at its entry, the player flies it, judged out of 20 (the HUD shows the load to pull and the roll's way).",
      params: {
        action: { type: "string", enum: ["fields", "prepare", "challenges", "fly", "abort", "figures", "figure"] },
        mode: { type: "string", enum: ["watch", "fly"] },
        field: { type: "string" },
        start: { type: "string", enum: ["runway", "final", "cruise"] },
        hour: { type: "string", enum: ["now", "dawn", "morning", "noon", "dusk", "night"] },
        weather: { type: "string", enum: ["real", "fair", "cloudy", "overcast", "rain", "storm", "windy", "fog"] },
        fuel: { type: "number", minimum: 0.05, maximum: 1 },
        dest: { type: "string" },
        id: { type: "string" },
      },
      required: ["action"],
      run: act((a) => {
        const F = h.f35;
        if (!F) return { error: "not available" };
        switch (a.action) {
          case "fields":
            return F.fields();
          case "challenges":
            return { challenges: F.challenges(), fights: F.fights() };
          case "prepare":
            if (!a.field) throw new Error("prepare needs a field (f35 fields lists them)");
            net();
            return F.prepare({
              field: String(a.field),
              start: a.start as string | undefined,
              hour: a.hour as string | undefined,
              weather: a.weather as string | undefined,
              fuel: a.fuel as number | undefined,
              dest: a.dest as string | undefined,
            });
          case "fly":
            if (!a.id) throw new Error("fly needs an id (f35 challenges lists them)");
            net();
            return F.fly(String(a.id));
          case "figures":
            return { figures: F.figures() };
          case "figure":
            if (!a.id) throw new Error("figure needs an id (f35 figures lists them) or box");
            net();
            return F.figure(String(a.id), a.mode === "watch" ? "watch" : "fly");
          default:
            return F.abort();
        }
      }),
    },
    {
      name: "flight_lead",
      description:
        "The flight the player leads (a patrouille of two to four: the room's pilots flying in formation on him, his AI wingmen). wingmen: how many AI wingmen fly with his F-35 (count 0–3: Two, Three, Four — they muster at their places in the air). order: an order given as its leader, said on the radio and carried out by the wingmen in formation — rejoin, shape (a formation: echelonR, echelonL, fingertip, vic, diamond, line, trail, spread), tighten, loosen, attack (his radar's lock), engage (the hostiles), cover (him), hold (a racetrack over where he is), rtb (home to the nearest airfield), breakL, breakR (a hard 90° turn), show (the tight diamond for a pass, the fly-by camera). status: the formation, its spacing, his place in another's, the wingmen.",
      params: {
        action: { type: "string", enum: ["order", "status", "wingmen"] },
        order: { type: "string", enum: ORDER_IDS },
        count: { type: "number", minimum: 0, maximum: 3 },
        shape: { type: "string", enum: FORMATION_IDS },
      },
      required: ["action"],
      run: act((a) => {
        const c = h.camera;
        if (a.action === "status")
          return {
            formation: c.s.formShape,
            spacing: c.s.formSpacing,
            myPlace: c.s.formPos,
            inFormationOn: c.form?.name ?? null,
            flying: c.brk ? "break" : c.holdPat ? "hold" : c.form ? "formation" : null,
            wingmen: (c.wing?.list ?? []).map((w) => ({
              place: w.k,
              mode: w.mode,
              alive: w.alive,
              hp: w.hp,
              slotOffM: Math.round(w.dist),
            })),
          };
        if (a.action === "wingmen") {
          c.s.wingmen = Math.min(Math.max(Math.round(Number(a.count ?? 0)), 0), 3);
          return `AI wingmen: ${c.s.wingmen}`;
        }
        if (!a.order) throw new Error("order needs an order");
        if (a.order === "shape" && !a.shape) throw new Error("shape needs a shape");
        return c.flightOrder(a.order as OrderId, a.shape as string | undefined);
      }),
    },
    {
      name: "approach",
      description:
        "The F-35's instrument approaches and procedures. ils: an ILS approach flown by the autopilot to a runway (field: ICAO or name, else the nearest within 150 km; its end into the wind) — to the initial fix 18.5 km out, the localizer and the 3° glideslope captured, the gear and flaps at the final fix, minimums at 60 m (not stable: the missed approach, round again), the flare, braked to a stop, graded out of 20; hold: laps of the racetrack at the initial fix first (0: none; 99: until cleared). clear: out of the hold, the approach begun. off: the approach given up (the needles gone). status: the approach flown (its phase, the needles in dots, the distance) and the last one's grade. procedures: the flight plan given its departure's fix (after an airfield it starts from) and its arrival's (the initial and final fixes before the airfield it ends at) — LNAV then hands over to the ILS at the initial fix.",
      params: {
        action: { type: "string", enum: ["ils", "clear", "off", "status", "procedures"] },
        field: { type: "string" },
        hold: { type: "number", minimum: 0, maximum: 99 },
      },
      required: ["action"],
      run: act((a) => {
        const c = camera;
        switch (a.action) {
          case "ils":
            return c.ilsStart(a.field ? String(a.field) : undefined, { hold: a.hold === 99 ? Infinity : Number(a.hold ?? 0) });
          case "clear":
            return c.ilsClear();
          case "off":
            c.ilsOff();
            return "ILS approach off";
          case "procedures":
            return c.routeProcedures();
          default:
            return { flown: c.ilsInfo(), last: c.ilsLast ?? null };
        }
      }),
    },
    {
      name: "mission",
      description:
        'Missions: flights with objectives, scored out of 20 at their debrief, flown solo or with the room. list: the game\'s and the pilot\'s own. fly: one by its id, at once (its briefing skipped). create: a new one from the pilot\'s words, as JSON in `mission` — {title?, brief?, units: [{id, kind: sam|truck|bunker|drone|fighter|airliner|traffic|carrier, name?, at: {lat, lon, alt? (m over the sea)} or {place: an airfield\'s ICAO or a town}, hdg?, speed?, side?: hostile|friend|neutral, match?: {callsign} (kind traffic: a real flight taken over — that callsign, else the nearest heard), carrier?: ford|kiev|implacable, later?: true (set by a trigger\'s spawn)}], objectives: [{kind: reach (at {place|lat/lon, radius?}) | destroy (units: [ids]) | escort (unit, until: {place|lat/lon}, within? m) | protect (unit, seconds) | identify (unit, within? m) | land (carrier: unit id, or at), text?, optional?: true (a bonus), after?: another objective\'s id}], triggers?: [{id, when: {time: s} | {done: objective id} | {near: {unit, within}} | {enter: {lat, lon, radius}}, do: [{say: text} | {spawn: unit} | {course: {unit, hdg?, alt?, speed?, to?: {lat, lon, alt?}}} | {side: {unit, side}} | {squawk: {unit, off}} | {win: true} | {fail: why}]}], start?: {place or lat/lon, alt (m over the sea), hdg, speed (m/s), variant: B|C, loadout: aa|ag|gun} (leave it out unless the pilot names where to start: then it is where the craft flies now), time?: {localHour}, weather?: {preset: fair|cloudy|overcast|rain|storm|fog|windy}, limit?: s}. Places by name are found; an airliner or a real flight escorted to a place is sent there; the words left out are made. Kept among the pilot\'s missions, then flown (fly: false — opened in the editor instead). E.g. \'an escort of the A320 AFR123 to Nice\': {"units":[{"id":"a","kind":"traffic","match":{"callsign":"AFR123"}}],"objectives":[{"kind":"escort","unit":"a","until":{"place":"Nice"}}]}. status: the mission flown and its objectives. abort: given up. map: the mission map opened. edit: the editor (on a mission\'s id, else a new one). link: a mission\'s link to share (id).',
      params: {
        action: { type: "string", enum: ["list", "fly", "create", "status", "abort", "map", "edit", "link"] },
        id: { type: "string" },
        mission: { type: "string", description: "create: the mission as JSON" },
        fly: { type: "boolean", description: "create: fly it at once (default) or open it in the editor" },
      },
      required: ["action"],
      run: act(async (a) => {
        const M = h.missions;
        if (!M) throw new Error("no missions here");
        switch (a.action) {
          case "list":
            return M.list();
          case "fly":
            if (!a.id) throw new Error("fly needs an id (mission list)");
            return M.fly(String(a.id));
          case "status":
            return M.state() ?? "No mission flown";
          case "abort":
            M.abort();
            return "Mission abandoned";
          case "map":
            M.map();
            return "The mission map is open";
          case "edit":
            M.edit(a.id ? M.spec(String(a.id)) : undefined);
            return "The mission editor is open";
          case "link":
            if (!a.id) throw new Error("link needs an id (mission list)");
            return M.link(M.spec(String(a.id)));
          default: {
            let sketch: Sketch;
            try {
              sketch = JSON.parse(String(a.mission ?? ""));
            } catch {
              throw new Error("create needs the mission as JSON in `mission`");
            }
            const g = camera.geoNow();
            const here = g ? { lat: g.lat, lon: g.lon, alt: g.alt, hdg: (g.track * 180) / Math.PI, speed: g.gs } : undefined;
            const resolve: Resolver = async (name) => {
              // (an airfield by its exact name or ICAO — "Nice" is not Venice —, else the Atlas's search)
              const n = fold(name);
              const site = SITES.find((s) => s.body === "earth" && (fold(s.name) === n || s.icao?.toLowerCase() === n));
              if (site) return { lat: site.lat, lon: site.lon, name: site.icao ?? site.name };
              const hit = (await h.atlas?.search(name, "earth"))?.[0];
              return hit ? { lat: hit.lat, lon: hit.lon, name: hit.name.split(",")[0]! } : null;
            };
            const { spec, errors } = await completeMission(sketch, { here, resolve });
            if (!spec) throw new Error(errors.join("; "));
            M.keep(spec);
            if (a.fly === false) {
              M.edit(spec);
              return { opened: spec.title, objectives: spec.objectives.map((o) => o.text) };
            }
            return { flown: M.fly(spec), title: spec.title, objectives: spec.objectives.map((o) => o.text), link: M.link(spec) };
          }
        }
      }),
    },
    {
      name: "carrier",
      description:
        "The carriers at sea (the Gerald R. Ford: catapults and wires; the Kiev and the Implacable: short take-offs and vertical landings), each with two frigates as escort, steaming into the wind at their speed, the same in a room for everyone. spawn: one set off (kind; at lat/lon, else 4 km ahead of the craft; heading [°], else into the wind). qual: a carrier qualification flown by the autopilot (qual: day, night — the clock set to night there —, sea — a heavy sea, a swell of 4.4 m —; passes, else 4), graded pass by pass by the LSO, its average said: qualified at 3.0. land: the flown craft set down on its deck (x across — port + —, z along — bow + — [m]; else aft of its island), carried along with it. recover: the F-35B's autopilot lands it there as a real one does — up the port side, a hover alongside, across over the spot, down — the LSO calling it and grading the touchdown (the nearest carrier, else kind; light enough to hover: some 2 t of fuel at most); the F-35C's recovery onto the Ford's wires by its case (case: I — the initial 3 NM astern, the break past the bow, the downwind, the 180, the groove —, II — the descent to ten miles then the break —, III — the marshal 21 NM astern on the final bearing, marshal: laps of its hold, then down to the platform, dirty at ten miles, the glide path —, straight: from the gate; else by the hour and the weather: night or a low ceiling III, clouds II, else I). takeoff: the F-35B off the deck it stands on — a short take-off when the deck's run allows its weight (some 150 m full), else vertical when light enough (vertical: true asks for it). status: those at sea, where, their speed. clear: none at sea any more.",
      params: {
        action: { type: "string", enum: ["spawn", "land", "recover", "takeoff", "qual", "status", "clear"] },
        vertical: { type: "boolean" },
        qual: { type: "string", enum: ["day", "night", "sea"] },
        case: { type: "string", enum: ["I", "II", "III", "straight"] },
        marshal: { type: "number", minimum: 0, maximum: 5 },
        passes: { type: "number" },
        kind: { type: "string", enum: ["ford", "kiev", "implacable"] },
        lat: { type: "number" },
        lon: { type: "number" },
        heading: { type: "number" },
        x: { type: "number" },
        z: { type: "number" },
      },
      required: ["action"],
      run: act((a) => {
        const c = h.camera;
        if (a.action === "status")
          return c.carrierNow().map(({ sp, P }) => ({
            kind: sp.kind,
            lat: +P.lat.toFixed(4),
            lon: +P.lon.toFixed(4),
            headingDeg: Math.round((sp.heading * 180) / Math.PI),
            speedKt: Math.round(sp.speed * 1.943844),
          }));
        if (a.action === "clear") {
          c.carrierClear();
          return "No carrier at sea";
        }
        if (a.action === "recover") {
          // (the F-35C's recovery by its case — P4: I the break, II the descent then the break, III the marshal)
          if (a.case && f35Variant() === "C")
            return (
              c.trapLand(a.kind as "ford" | undefined, { case: a.case as RecoveryCase, marshal: a.marshal as number | undefined }) ??
              "No carrier with wires within 30 km"
            );
          return c.deckLand(a.kind as "ford" | "kiev" | "implacable" | undefined) ?? "No carrier within 30 km";
        }
        if (a.action === "takeoff") return c.deckTakeoff(a.vertical ? "vertical" : undefined) ?? "Not on a carrier's deck";
        if (a.action === "qual") {
          // (the qualification's hour where we are: by day, by night — local solar time —, its wind and sea)
          const id = (a.qual ?? "day") as QualId;
          const g = c.geoNow();
          if (g) {
            const d = new Date(`${h.tools.date().replace(" ", "T")}Z`);
            d.setUTCHours(0, Math.round(utcHourAt(QUALS[id].hour, g.lon) * 60), 0, 0);
            h.tools.setDate(d.toISOString());
          }
          return c.qualStart(id, { auto: true, passes: a.passes as number | undefined });
        }
        const kind = (a.kind ?? "ford") as "ford" | "kiev" | "implacable";
        if (a.action === "spawn")
          return c.carrierSpawn(kind, {
            lat: a.lat as number | undefined,
            lon: a.lon as number | undefined,
            heading: a.heading as number | undefined,
          });
        return c.carrierLand(kind, { x: a.x as number | undefined, z: a.z as number | undefined });
      }),
    },
    {
      name: "flight_plan",
      description:
        "A plane's flight plan (the F-35): its waypoints over the Earth, flown by LNAV (lateral) and VNAV (vertical) on the autopilot. show: the plan (waypoints with their altitude and speed constraints, the cruise level and speed, the reserve, LNAV/VNAV on, the active point). add: a waypoint — query (an airfield, a place, an address, coordinates) or lat/lon, its altM and spdMs constraints, at an index (default the end). remove (index), clear, cruise (altM, spdMs, reserveKg), direct (index: flown direct from here), nav (lnav, vnav: on or off).",
      params: {
        action: { type: "string", enum: ["show", "add", "remove", "clear", "cruise", "direct", "nav"] },
        query: { type: "string" },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lon: { type: "number", minimum: -180, maximum: 360 },
        altM: { type: "number", minimum: 0, maximum: 20000 },
        spdMs: { type: "number", minimum: 30, maximum: 700 },
        reserveKg: { type: "number", minimum: 0, maximum: 8000 },
        index: { type: "number", minimum: 0, maximum: 99, integer: true },
        lnav: { type: "boolean" },
        vnav: { type: "boolean" },
      },
      required: ["action"],
      run: act(async (a) => {
        const N = camera.nav;
        const R = N.route;
        const changed = () => camera.routeChanged();
        const view = () => ({
          waypoints: R.wps.map((w, i) => ({
            i,
            name: w.name,
            lat: round(w.lat, 4),
            lon: round(w.lon, 4),
            altM: w.alt ?? null,
            spdMs: w.spd ?? null,
          })),
          cruiseAltM: R.cruiseAlt,
          cruiseSpdMs: R.cruiseSpd,
          reserveKg: R.reserveKg,
          lnav: N.on.l,
          vnav: N.on.v,
          active: N.lnav?.active ?? null,
        });
        const idx = (i: unknown) => {
          const n = Number(i);
          if (!Number.isInteger(n) || n < 0 || n >= R.wps.length) throw new Error(`no waypoint ${i} — ${R.wps.length} in the plan`);
          return n;
        };
        switch (a.action) {
          case "show":
            return view();
          case "add": {
            let p: { name: string; lat: number; lon: number } | null = null;
            if (a.query !== undefined) {
              const q = String(a.query);
              const site = SITES.find((s) => s.body === "earth" && (s.icao?.toLowerCase() === q.toLowerCase() || fold(s.name) === fold(q)));
              if (site) p = { name: site.icao ?? site.name, lat: site.lat, lon: site.lon };
              else {
                const hit = (await h.atlas?.search(q, "earth"))?.[0];
                if (!hit) throw new Error(`nothing found for "${q}"`);
                p = { name: hit.name.slice(0, 12), lat: hit.lat, lon: hit.lon };
              }
            } else if (a.lat !== undefined && a.lon !== undefined)
              p = { name: `WP${String(R.wps.length + 1).padStart(2, "0")}`, lat: Number(a.lat), lon: Number(a.lon) };
            if (!p) throw new Error("add needs a query or lat/lon");
            const field = SITES.find((s) => s.body === "earth" && s.runway && Math.hypot(s.lat - p!.lat, s.lon - p!.lon) < 0.02);
            const wp = {
              ...p,
              ...(a.altM !== undefined ? { alt: Number(a.altM) } : {}),
              ...(a.spdMs !== undefined ? { spd: Number(a.spdMs) } : {}),
              ...(field ? { field: { icao: field.icao, elev: field.elev ?? 0, rwy: field.rwy } } : {}),
            };
            const at = a.index !== undefined ? Math.min(Number(a.index), R.wps.length) : R.wps.length;
            R.wps.splice(at, 0, wp);
            changed();
            return view();
          }
          case "remove":
            R.wps.splice(idx(a.index), 1);
            changed();
            return view();
          case "clear":
            R.wps.length = 0;
            N.on = { l: false, v: false };
            changed();
            return view();
          case "cruise":
            if (a.altM !== undefined) R.cruiseAlt = Number(a.altM);
            if (a.spdMs !== undefined) R.cruiseSpd = Number(a.spdMs);
            if (a.reserveKg !== undefined) R.reserveKg = Number(a.reserveKg);
            changed();
            return view();
          case "direct": {
            const i = idx(a.index);
            const here = camera.geoNow();
            if (!here) throw new Error("not flying over the Earth");
            if (!N.lnav) changed();
            N.lnav?.directTo(i, here);
            return view();
          }
          default:
            if (!R.wps.length && (a.lnav || a.vnav)) throw new Error("no waypoints: add some first");
            if (a.lnav !== undefined) N.on.l = !!a.lnav;
            if (a.vnav !== undefined) N.on.v = !!a.vnav;
            if (!N.lnav && (N.on.l || N.on.v)) changed();
            return view();
        }
      }),
    },
    {
      name: "music",
      description:
        "The music. state: what plays (the theme, its section, bar, chord, intensity, the mode). themes: the themes. set — mode (moments: at the flight's great moments; adaptive: following the context; playlist), listen (a theme's id played now; 'none': back to the game's choice), intensity (0–1; omitted with 'auto': the flight's), a layer's level (layer: perc, bass, strings, ostinato, brass, melody, keys, organ, choir or master; level 0–2), mute (with layer: muted or not).",
      params: {
        action: { type: "string", enum: ["state", "themes", "set"] },
        mode: { type: "string", enum: ["moments", "adaptive", "playlist"] },
        listen: { type: "string" },
        intensity: { type: "number", minimum: 0, maximum: 1 },
        auto: { type: "boolean" },
        layer: { type: "string" },
        level: { type: "number", minimum: 0, maximum: 2 },
        mute: { type: "boolean" },
      },
      required: ["action"],
      run: act((a) => {
        const M = h.music;
        if (!M) return { error: "not available" };
        if (a.action === "state") return M.state();
        if (a.action === "themes") return M.themes();
        return M.set({
          mode: a.mode as string | undefined,
          listen: a.listen === undefined ? undefined : a.listen === "none" ? null : String(a.listen),
          intensity: a.auto ? null : (a.intensity as number | undefined),
          layer: a.layer as string | undefined,
          level: a.level as number | undefined,
          mute: a.mute as boolean | undefined,
        });
      }),
    },
    {
      name: "observe",
      description:
        "The observatory, from where the player stands on the Earth's ground (walking, the tripod, the free camera near the ground): any planet, moon, dwarf world, the Sun (filtered), the Moon, the ISS, a bright star by name, the wormhole (Gargantua beyond it). when: its windows over `days` (default 14; the ISS 10) from a date (default now) — when it is above the horizon in a sky dark enough for it, its best moment (the highest) with its altitude, azimuth and the sky (day/twilight/night), and where it is now. look: the telescope taken to it — at: 'now' (default), 'best' (the clock set to its next best moment) or an ISO date; on foot the tripod is set where they stand first; a star is tracked at the view's centre. open: the observatory page, a search typed.",
      params: {
        action: { type: "string", enum: ["when", "look", "open"] },
        name: { type: "string", description: "Jupiter, Lune, Saturn, Sirius, Bételgeuse, ISS, wormhole…" },
        at: { type: "string", description: "look: now, best, or an ISO date" },
        from: { type: "string", description: "when: from this ISO date (default the game's)" },
        days: { type: "number", minimum: 1, maximum: 120 },
      },
      required: ["action"],
      run: act((a) => {
        const O = h.observe;
        if (!O) return { error: "not available" };
        if (a.action === "open") return O.open(a.name ? String(a.name) : undefined), "the observatory opened";
        if (a.name === undefined) throw new Error("give a name: a planet, a moon, a star, the ISS, the wormhole");
        if (a.action === "when") {
          const from = a.from ? Date.parse(String(a.from)) : undefined;
          if (from !== undefined && !Number.isFinite(from)) throw new Error(`not a date: ${a.from}`);
          const r = O.when(String(a.name), { from, days: a.days as number | undefined });
          if (typeof r === "string") throw new Error(r);
          const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`;
          const deg = (x: number) => Math.round(x * 10) / 10;
          return {
            name: r.name,
            now: r.now ? { altDeg: deg(r.now.alt), azDeg: deg(r.now.az) } : null,
            windows: r.windows
              .slice(0, 12)
              .map((w) => ({ from: iso(w.from), to: iso(w.to), best: iso(w.best), altDeg: deg(w.alt), azDeg: deg(w.az), sky: w.sky })),
          };
        }
        const at = a.at === undefined || a.at === "now" ? undefined : a.at === "best" ? ("best" as const) : Date.parse(String(a.at));
        if (typeof at === "number" && !Number.isFinite(at)) throw new Error(`not a date: ${a.at}`);
        if (at !== undefined) net();
        const why = O.look(String(a.name), at);
        if (why) throw new Error(why);
        return `the telescope on ${a.name}`;
      }),
    },
    {
      name: "place_ship",
      description:
        "Teleport the ship (saved first as 'Before TARS'; a mission running ends; on foot, back aboard first). Where: a place by name — `query`: a runway or site, a destination (summits, launch sites, Apollo sites, craters, rovers…), any address or place name on the Earth (OpenStreetMap, WGS84), or coordinates typed —, or `site` (a runway), or body + lat/lon. mode: orbit (body, altKm or peKm/apKm, incDeg, retrograde; about Gargantua rM), orbit_over (an orbit passing over the place now, altKm, incDeg), ground (set down there, on its gear; on a runway lined up), walk (set down there and step out on foot), lineup (on a runway's threshold ready to take off: site or query, alongM), fly (a plane flying over the place: aglM, headingDeg, speedMs), near (beside a body at rest, altKm), wormhole (side: ours/gargantua), glide (onto a runway: site, distKm, altKm, speedMs — the entry autopilot lands it), hover (the place, altKm — at rest over it).",
      params: {
        mode: {
          type: "string",
          enum: ["orbit", "orbit_over", "ground", "walk", "lineup", "fly", "near", "wormhole", "glide", "hover"],
        },
        query: { type: "string" },
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
        alongM: { type: "number", minimum: 0, maximum: 5000 },
        aglM: { type: "number", minimum: 30, maximum: 20000 },
        headingDeg: { type: "number", minimum: 0, maximum: 360 },
      },
      required: ["mode"],
      run: act(async (a) => {
        const where = await placeOf(a);
        net();
        const b = () => {
          if (where) return where.body;
          throw new Error("give a place: query, site, or body with lat/lon");
        };
        const lat = () => where?.lat ?? 0;
        const lon = () => where?.lon ?? 0;
        const site = where?.site ?? null;
        const run = (): string => {
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
              return tools.orbitOver(b(), lat(), lon(), {
                altKm: a.altKm as number,
                peKm: a.peKm as number,
                apKm: a.apKm as number,
                inc: a.incDeg as number,
                retrograde: a.retrograde as boolean,
              });
            case "ground":
              return tools.land(b(), lat(), lon());
            case "walk":
              return tools.walk(b(), lat(), lon());
            case "lineup":
              if (!site?.runway) throw new Error("lineup needs a runway (site or query naming one) — list_places lists them");
              return tools.lineUp(site.name, (a.alongM as number) ?? 60);
            case "fly":
              return tools.flyAt(lat(), lon(), (a.aglM as number) ?? 600, (a.headingDeg as number) ?? 0, (a.speedMs as number) ?? 200, b());
            case "near":
              return tools.near(b(), { altKm: a.altKm as number, rM: a.rM as number });
            case "wormhole":
              return tools.wormhole((a.side as "ours") ?? "ours");
            case "glide":
              if (!site?.runway) throw new Error("glide needs a runway site");
              return tools.glideTo(site.name, (a.distKm as number) ?? 80, (a.altKm as number) ?? 25, (a.speedMs as number) ?? 750);
            default:
              return tools.hoverOver(b(), lat(), lon(), (a.altKm as number) ?? 1.5);
          }
        };
        const note = h.place ? h.place(run) : run();
        return where?.name ? `${where.name}: ${note}` : note;
      }),
    },
    {
      name: "saves",
      description:
        "Saved games: save (a name), load (a name; the current game saved first as 'Before TARS'), delete, undo: back to 'Before TARS' (the state before TARS's last teleport, load, date change or scene); export (a name, or the game now: downloaded as a file), import (json: a save's file text; loaded and kept), share (a link that opens the game as it is now), autosave (the autosave written now).",
      params: {
        action: { type: "string", enum: ["save", "load", "delete", "undo", "export", "import", "share", "autosave"] },
        name: { type: "string" },
        json: { type: "string" },
      },
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
          case "export":
            tools.exportSave(name);
            return `exported ${name ?? "the game now"} (a file downloaded)`;
          case "import":
            if (!a.json) throw new Error("import needs json: a save file's text");
            net();
            return tools.importSave(String(a.json));
          case "share":
            return { link: tools.shareLink() };
          case "autosave":
            tools.autosaveNow();
            return "autosaved";
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
        "Wait while the game runs (warp it with `time` first for long waits): until the autopilot is off (its job done), landed (stopped on the ground), in_orbit (about `body` if given — else any), docked, the plan executed, a phase stage (orbit, air, entry, approach, ground…), surface_ready (surface streaming settled; read returned surface status for fallback/unsupported), scenery_ready (worldwide 3D streaming and fade settled; read returned scenery status for degraded/unsupported), character_grounded (on foot and touching ground), character_on_foot, character_boarded (back at the controls), or just seconds. Returns whether it was met and the state then — read it before saying what happened. At most maxSeconds of real time (default 120, max 900).",
      params: {
        until: {
          type: "string",
          enum: [
            "autopilot_off",
            "landed",
            "in_orbit",
            "docked",
            "plan_done",
            "stage",
            "surface_ready",
            "scenery_ready",
            "character_grounded",
            "character_on_foot",
            "character_boarded",
            "seconds",
          ],
        },
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
            case "character_grounded":
              return camera.character.active && camera.character.grounded;
            case "character_on_foot":
              return camera.character.active;
            case "character_boarded":
              return !camera.character.active && camera.piloting;
            case "scenery_ready":
              return !tools.perf({ gpu: false }).earthScenery.pending;
            case "surface_ready":
              return !tools.perf({ gpu: false }).earthSurface.pending;
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
          surface_ready: { fr: "le sol satellite chargé", en: "satellite ground settled" },
          scenery_ready: { fr: "le paysage 3D chargé", en: "3D scenery settled" },
          character_grounded: { fr: "le personnage au sol", en: "the character grounded" },
          character_on_foot: { fr: "la sortie du vaisseau", en: "the character on foot" },
          character_boarded: { fr: "le retour aux commandes", en: "the character boarded" },
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
                ...(String(a.until).startsWith("character_") ? { character: camera.character.state() } : {}),
                alerts: h.alerts(),
                ...(a.until === "surface_ready" ? { surface: tools.perf({ gpu: false }).earthSurface } : {}),
                ...(a.until === "scenery_ready" ? { scenery: tools.perf({ gpu: false }).earthScenery } : {}),
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
        "Show the pilot a chart beside the flight. Either channels, live — the flight recorder's (alt, speed, vz, g, q, mach, heat, throttle, dv, fuel) and your own (bank, pitch, heading, aoa, sideslip, cmdBank, cmdAoa: the entry's commanded bank (as flown: the guidance's damped against the phugoid) and AoA, velBank: the bank flown about the velocity — the command's own angle (bank is the body's about its nose, another angle at high incidence) —, across: the runway offset, profile: the approach's height deviation); seconds: the window, default 600 — or series you computed (series: [{label, unit, points: [[x, y], …]}], xLabel). Up to 4 lanes.",
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
        "Set yourself a rule that wakes you later, with what to do then (your own words, an instruction to yourself): on a change of the game — autopilot (to: a mode, or none = an autopilot ended), phase (to: orbit, air, entry, approach, ground…), hub_step, entry_phase, alert (to: warning/caution), soi (to: a body), landed, docked, report, deviation, eclipse (to: solar_partial, solar_total, solar_annular, lunar_partial, lunar_total or end: at the camera's place), mode (to: ship, foot, free, photo — the game's mode changed), render (to: done or stopped — an offline render ended), character (to: disembarked, boarded, landed, jump, unavailable), surface (the satellite imagery's region and status changed: to = region:status), scenery (the 3D scenery's place or status changed), grass (to: grass, outside-grass, loading, off, other-planet, above-ground, mask-unavailable), map (the map view or its zoom changed: to = view:zoom) —, every N minutes, at a game time (simTimeS, seconds), or in N seconds. once: fired a single time. Use it when the pilot asks you to watch, remind, check regularly or react to something.",
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
