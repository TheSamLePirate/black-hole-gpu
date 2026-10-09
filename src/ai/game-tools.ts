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
  /** wall time [ms] (the waits) */
  now(): number;
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
      description: "The weather where the ship is (wind, visibility, clouds, rain; the real METAR when 'real') and the weather setting.",
      run: () => ({ setting: settings.weather, wind: settings.wind, now: camera.weatherNow ?? null, real: camera.weatherReal ?? null }),
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
        "Engage an autopilot (none switches it off). hover: hold position; circularize; approach: close on the target; orbit: orbit the target; node: execute the planned manoeuvre; transfer; land: powered landing below; takeoff: to orbit (altKm, incDeg); dock: dock with the station/craft (within 3 km); entry: from orbit, deorbit burn + entry + glide + runway landing at `site`; burns: fly the flight computer's burns.",
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
        "The flight computer: a manoeuvre about the body the ship orbits, planned and (execute: true, the default) flown by the autopilot. op: circularize (where: now/pe/ap), apoapsis/periapsis (altKm, where), hohmann (altKm), inclination (incDeg), match_planes (with the target), resonant (ratio), rendezvous/intercept (the target about the same body), match_velocities, fine_tune (inS), align_over_site (site: the orbit passing over a landing site). Near Gargantua itself the Kerr equivalents are used. For another body or the station use plan_mission.",
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
        const err = camera.fcSetPlan(r.burns, r.note);
        if (err) throw new Error(err);
        if (a.execute !== false) {
          const e = camera.fcExecute();
          if (e) throw new Error(e);
        }
        return { ...opText(r), executing: a.execute !== false };
      }),
    },
    {
      name: "plan_mission",
      description:
        "A mission to another body, the station or a craft, or the wormhole, planned by the flight computer (MISSION tab) and (execute: true, the default) flown. target: a body/craft name; arrival: orbit (altKm), flyby, freeReturn (retKm: the return's periapsis). Rendezvous with iss/ranger/lander/endurance ends 200 m from the port (then autopilot dock).",
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
        const err = camera.missionCommit();
        if (err) throw new Error(err);
        if (a.execute !== false) {
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
        "The camera (only what is given): mount = a view on the ship (cockpit, cabin, quarter, chase, dorsal, wing, belly, rear, dock, around, free, flyby, station); spectator: a free camera anywhere, the ship flying on; view (without the ship): orbit, follow, free, tripod, fall; lookAt: locked on the target; telescope; fovDeg; cinematic: orbit/dive/journey/none; goTo: fly the free camera to a body; standOn: a tripod on a body's ground.",
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
      },
      run: act((a) => {
        const notes: string[] = [];
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
        "The interface: open a panel (settings, place, time, weather, scenes, photo, controls, help, pause, planner: the flight computer's MISSION tab over the map, sky, camera) or close the one on top; the map (open, tab: orbit/globe/map); HUD density 0 full, 1 minimal, 2 clean; a screenshot (PNG download).",
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
        "Show the pilot a chart beside the flight. Either the flight's recorded channels, live (channels: alt, speed, vz, g, q, mach, heat, throttle, dv, fuel; seconds: the window, default 600), or series you computed (series: [{label, unit, points: [[x, y], …]}], xLabel). Up to 4 lanes.",
      params: {
        title: { type: "string" },
        channels: { type: "array", maxItems: 4, items: { type: "string", enum: CHANNELS.map((c) => c.key) } },
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
        const channels = a.channels as RecKey[] | undefined;
        if (!series?.length && !channels?.length) throw new Error("give channels (live) or series");
        const id = h.display.show(
          series?.length
            ? { kind: "chart", title: String(a.title), series, xLabel: a.xLabel as string | undefined }
            : { kind: "chart", title: String(a.title), live: { channels: channels!, seconds: (a.seconds as number) ?? 600 } },
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
        "Open a real screen of the game for the pilot: the map (map_3d, map_globe, map_planisphere), the tablet's pages (telemetry: the flight's curves; approach_chart; flight_computer; ship; log), the last flight_report, or a page on a cockpit display (cockpit_pfd, cockpit_orbit, cockpit_nav, cockpit_systems, cockpit_docking, cockpit_plan, cockpit_clocks, cockpit_log, cockpit_approach, cockpit_landing; slot 0–7 the display, default 0).",
      params: { screen: { type: "string", enum: SCREENS }, slot: { type: "number", minimum: 0, maximum: 7, integer: true } },
      required: ["screen"],
      run: act((a) => h.screen(a.screen as Screen, a.slot as number | undefined)),
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
    {
      name: "memory",
      description:
        "Your long-term memory of this pilot: remember a short note (their name, a preference, a plan), forget the notes about something, or clear everything (only when the pilot asks you to forget all).",
      params: { action: { type: "string", enum: ["remember", "forget", "clear"] }, note: { type: "string" } },
      required: ["action"],
      run: (a) => {
        if (a.action === "clear") {
          h.memory.clear();
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
