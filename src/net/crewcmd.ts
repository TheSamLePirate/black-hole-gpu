// The crew's orders (docs/PLAN-CREW-ACTIONS.md): what a crew console (crew/) asks the pilot it follows to do — never to
// fly: no stick, no throttle, no free key — and the pilot's answer. Shared by the console and the simulator, pure.
//   crew-cmd { v: 1, id, to: the pilot's slot, act, args }   — from a member joined as "instruments"
//   crew-ack { v: 1, id, to: the sender's slot, act, ok, msg } — from the pilot, heard by every screen
// The sender is the server's stamp (`from`), its role the room's roster's: neither can be forged. Every act is in
// the catalogue below with its arguments' schema (the game tools' own checker), checked again where it runs.
import { checkArgs, type Args, type Param } from "../ai/tool-schema";
import { type Units, unitsOf } from "../ui/unitsys";

/** the families a pilot opens (the instruments' `caps`): what can be done now, on this craft, in this mode */
export const FAMILIES = ["nav", "config", "jet", "space", "weapons"] as const;
export type Family = (typeof FAMILIES)[number];

/** an act's words, its figures in the units of who reads them (the pilot's settings, the console's switch) */
type Say = (a: Args, u: Units) => { fr: string; en: string };

/** the spacecraft's holds, autopilots and manoeuvres (the game's own lists — src/ai/game-tools.ts) */
export const HOLDS = [
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
] as const;
export const AUTOS = [
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
  "keep",
] as const;
export const MANEUVERS = [
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
] as const;
export const WEAPON_NAMES: Record<string, string> = { aim120: "AIM-120 AMRAAM", aim9x: "AIM-9X", jdam: "GBU-32 JDAM", jsm: "JSM" };
/** the spacecraft's failures (game/systems.ts) by a short name */
export const SYS_NAMES: Record<string, { fr: string; en: string }> = {
  engine: { fr: "moteur éteint", en: "engine out" },
  rcsStuck: { fr: "RCS bloqué", en: "RCS stuck" },
  gyro: { fr: "centrale inertielle", en: "IMU drift" },
  bus: { fr: "court-circuit du bus", en: "bus short" },
  o2Leak: { fr: "fuite d'oxygène", en: "oxygen leak" },
  scrubber: { fr: "épurateur", en: "scrubber" },
};
export const HOLD_FR: Record<string, string> = {
  prograde: "prograde",
  retrograde: "rétrograde",
  radialOut: "radiale extérieure",
  radialIn: "radiale intérieure",
  normal: "normale",
  antinormal: "anti-normale",
  target: "vers la cible",
  antiTarget: "opposée à la cible",
  maneuver: "sur le nœud",
};
export const AUTO_FR: Record<string, string> = {
  hover: "stationnaire",
  circularize: "circulariser",
  approach: "approche de la cible",
  orbit: "orbiter la cible",
  node: "exécuter le nœud",
  transfer: "transfert",
  land: "atterrissage",
  takeoff: "décollage vers l'orbite",
  dock: "amarrage",
  entry: "rentrée",
  burns: "combustions du plan",
  keep: "maintien à poste",
};
export const MANEUVER_FR: Record<string, string> = {
  circularize: "circularisation",
  apoapsis: "apoapside",
  periapsis: "périapside",
  hohmann: "Hohmann",
  inclination: "inclinaison",
  match_planes: "plans alignés",
  resonant: "orbite résonante",
  rendezvous: "rendez-vous",
  intercept: "interception",
  match_velocities: "vitesses égalisées",
  fine_tune: "ajustement fin",
  align_over_site: "passage au-dessus d'un site",
};
export const HOLD_EN: Record<string, string> = {
  prograde: "prograde",
  retrograde: "retrograde",
  radialOut: "radial out",
  radialIn: "radial in",
  normal: "normal",
  antinormal: "anti-normal",
  target: "to the target",
  antiTarget: "away from the target",
  maneuver: "on the node",
};
export const AUTO_EN: Record<string, string> = {
  hover: "hover",
  circularize: "circularize",
  approach: "approach the target",
  orbit: "orbit the target",
  node: "execute the node",
  transfer: "transfer",
  land: "landing",
  takeoff: "take-off to orbit",
  dock: "docking",
  entry: "entry",
  burns: "the plan's burns",
  keep: "station keeping",
};
export const MANEUVER_EN: Record<string, string> = {
  circularize: "circularization",
  apoapsis: "apoapsis",
  periapsis: "periapsis",
  hohmann: "Hohmann",
  inclination: "inclination",
  match_planes: "planes matched",
  resonant: "resonant orbit",
  rendezvous: "rendezvous",
  intercept: "intercept",
  match_velocities: "velocities matched",
  fine_tune: "fine tuning",
  align_over_site: "pass over a site",
};
/** a hold's, an autopilot's, a manoeuvre's words in both languages (an unknown one: its own name) */
export const holdWords = (k: string) => ({ fr: HOLD_FR[k] ?? k, en: HOLD_EN[k] ?? k });
export const autoWords = (k: string) => ({ fr: AUTO_FR[k] ?? k, en: AUTO_EN[k] ?? k });
export const maneuverWords = (k: string) => ({ fr: MANEUVER_FR[k] ?? k, en: MANEUVER_EN[k] ?? k });
export interface ActSpec {
  fam: Family;
  params?: Record<string, Param>;
  required?: readonly string[];
  /** the line the pilot's toast and every screen's journal say */
  say: Say;
}

const onOff = (on: unknown, fr: [string, string], en: [string, string]) => ({ fr: on ? fr[0] : fr[1], en: on ? en[0] : en[1] });

/** The catalogue: every act a crew may ask. Nothing here flies the craft by hand. */
export const ACTS = {
  "cfg.ack": { fam: "config", say: () => ({ fr: "alarme acquittée", en: "master caution silenced" }) },
  // the configuration: what a copilot sets on the pilot's call
  "cfg.gear": {
    fam: "config",
    params: { down: { type: "boolean" } },
    required: ["down"],
    say: (a) => onOff(a.down, ["train sorti", "train rentré"], ["gear down", "gear up"]),
  },
  "cfg.flaps": {
    fam: "config",
    params: { pos: { type: "number", minimum: 0, maximum: 1 } },
    required: ["pos"],
    say: (a) => {
      const p = Number(a.pos);
      return p < 0.25
        ? { fr: "volets rentrés", en: "flaps up" }
        : p < 0.75
          ? { fr: "volets à moitié", en: "flaps half" }
          : { fr: "volets pleins", en: "flaps full" };
    },
  },
  "cfg.brake": {
    fam: "config",
    params: { on: { type: "boolean" } },
    required: ["on"],
    say: (a) => onOff(a.on, ["aérofrein sorti", "aérofrein rentré"], ["air brake out", "air brake in"]),
  },
  // the navigation: the flight plan edited, flown direct, the target
  "nav.add": {
    fam: "nav",
    params: {
      query: { type: "string" },
      lat: { type: "number", minimum: -90, maximum: 90 },
      lon: { type: "number", minimum: -180, maximum: 180 },
      alt: { type: "number", minimum: 0, maximum: 20_000 },
      spd: { type: "number", minimum: 30, maximum: 700 },
      index: { type: "number", minimum: 0, maximum: 63, integer: true },
    },
    say: (a) => {
      const what = typeof a.query === "string" ? a.query.toUpperCase().slice(0, 16) : "un point";
      return {
        fr: `${what} ajouté au plan`,
        en: `${typeof a.query === "string" ? a.query.toUpperCase().slice(0, 16) : "a waypoint"} added to the plan`,
      };
    },
  },
  "nav.remove": {
    fam: "nav",
    params: { index: { type: "number", minimum: 0, maximum: 63, integer: true } },
    required: ["index"],
    say: (a) => ({ fr: `point ${Number(a.index) + 1} retiré du plan`, en: `waypoint ${Number(a.index) + 1} removed` }),
  },
  "nav.move": {
    fam: "nav",
    params: {
      index: { type: "number", minimum: 0, maximum: 63, integer: true },
      lat: { type: "number", minimum: -90, maximum: 90 },
      lon: { type: "number", minimum: -180, maximum: 180 },
    },
    required: ["index", "lat", "lon"],
    say: (a) => ({ fr: `point ${Number(a.index) + 1} déplacé`, en: `waypoint ${Number(a.index) + 1} moved` }),
  },
  "nav.point": {
    fam: "nav",
    params: {
      index: { type: "number", minimum: 0, maximum: 63, integer: true },
      alt: { type: "number", minimum: 0, maximum: 20_000 },
      spd: { type: "number", minimum: 30, maximum: 700 },
      clearAlt: { type: "boolean" },
      clearSpd: { type: "boolean" },
    },
    required: ["index"],
    say: (a) => ({ fr: `contraintes du point ${Number(a.index) + 1}`, en: `waypoint ${Number(a.index) + 1}'s constraints` }),
  },
  "nav.clear": { fam: "nav", say: () => ({ fr: "plan de vol vidé", en: "flight plan cleared" }) },
  "nav.cruise": {
    fam: "nav",
    params: {
      alt: { type: "number", minimum: 0, maximum: 20_000 },
      spd: { type: "number", minimum: 30, maximum: 700 },
      reserve: { type: "number", minimum: 0, maximum: 8000 },
    },
    say: () => ({ fr: "croisière réglée", en: "cruise set" }),
  },
  "nav.direct": {
    fam: "nav",
    params: { index: { type: "number", minimum: 0, maximum: 63, integer: true } },
    required: ["index"],
    say: (a) => ({ fr: `direct vers le point ${Number(a.index) + 1}`, en: `direct to waypoint ${Number(a.index) + 1}` }),
  },
  "nav.procedures": {
    fam: "nav",
    say: () => ({ fr: "procédures de départ et d'arrivée", en: "departure and arrival procedures" }),
  },
  "nav.target": {
    fam: "nav",
    params: { name: { type: "string" } },
    required: ["name"],
    say: (a) => ({ fr: `cible : ${String(a.name).slice(0, 24)}`, en: `target: ${String(a.name).slice(0, 24)}` }),
  },
  // the autopilot (an aircraft): it flies, the crew sets it as on an MCP
  "ap.set": {
    fam: "jet",
    params: {
      alt: { type: "number", minimum: 0, maximum: 20_000 },
      hdgDeg: { type: "number", minimum: 0, maximum: 360 },
      spd: { type: "number", minimum: 30, maximum: 700 },
    },
    say: (a, u) => {
      const parts: string[] = [];
      if (a.alt !== undefined) parts.push(`ALT ${u.fAlt(Number(a.alt))}`);
      if (a.hdgDeg !== undefined) parts.push(`CAP ${String(Math.round(Number(a.hdgDeg)) % 360).padStart(3, "0")}°`);
      if (a.spd !== undefined) parts.push(`VIT ${u.fSpd(Number(a.spd))}`);
      const s = parts.join(" · ") || "—";
      return { fr: `consigne ${s}`, en: `selected ${s.replace("CAP", "HDG").replace("VIT", "SPD")}` };
    },
  },
  "ap.engage": {
    fam: "jet",
    params: { ap: { type: "boolean" }, athr: { type: "boolean" } },
    say: (a) => {
      const fr = [
        a.ap === undefined ? "" : a.ap ? "AP engagé" : "AP coupé",
        a.athr === undefined ? "" : a.athr ? "A/THR engagée" : "A/THR coupée",
      ];
      const en = [a.ap === undefined ? "" : a.ap ? "AP on" : "AP off", a.athr === undefined ? "" : a.athr ? "A/THR on" : "A/THR off"];
      return { fr: fr.filter(Boolean).join(", ") || "pilote automatique", en: en.filter(Boolean).join(", ") || "autopilot" };
    },
  },
  "ap.nav": {
    fam: "jet",
    params: { lnav: { type: "boolean" }, vnav: { type: "boolean" } },
    say: (a) => {
      const p = (k: string, v: unknown) => (v === undefined ? "" : `${k} ${v ? "on" : "off"}`);
      const s = [p("LNAV", a.lnav), p("VNAV", a.vnav)].filter(Boolean).join(", ") || "NAV";
      return { fr: s, en: s };
    },
  },
  "ap.ils": {
    fam: "jet",
    params: { field: { type: "string" } },
    say: (a) => ({
      fr: `approche ILS${a.field ? ` ${String(a.field).toUpperCase().slice(0, 12)}` : ""}`,
      en: `ILS approach${a.field ? ` ${String(a.field).toUpperCase().slice(0, 12)}` : ""}`,
    }),
  },
  "ap.ilsOff": { fam: "jet", say: () => ({ fr: "approche ILS annulée", en: "ILS approach off" }) },
  "ap.mode": {
    fam: "jet",
    params: {
      // (the refuelling too — jet_mode's: the tanker set and joined, the way it is flown, let go)
      mode: { type: "string", enum: ["orbit", "hold", "tf", "tanker", "tankerOff", "refuelMode", "off"] },
      lat: { type: "number", minimum: -90, maximum: 90 },
      lon: { type: "number", minimum: -180, maximum: 180 },
      radiusKm: { type: "number", minimum: 1, maximum: 50 },
      dir: { type: "string", enum: ["right", "left"] },
      inboundDeg: { type: "number", minimum: 0, maximum: 360 },
      aglM: { type: "number", minimum: 0, maximum: 1000 },
      near: { type: "boolean" },
      side: { type: "string", enum: ["right", "left"] },
      refuelMode: { type: "string", enum: ["auto", "assisted", "manual"] },
    },
    required: ["mode"],
    say: (a) => {
      const how = { auto: ["automatique", "automatic"], assisted: ["assisté", "assisted"], manual: ["manuel", "manual"] }[
        String(a.refuelMode)
      ];
      const side = a.side === "left" ? ["tuyau gauche", "left hose"] : ["tuyau droit", "right hose"];
      const fr: Record<string, string> = {
        orbit: "orbite",
        hold: "circuit d'attente",
        tf: "suivi de terrain",
        tanker: `ravitailleur TEXACO, ${side[0]}${how ? ` — ${how[0]}` : ""}`,
        tankerOff: "ravitaillement arrêté",
        refuelMode: `ravitaillement ${how?.[0] ?? ""}`.trim(),
        off: "mode du pilote automatique coupé",
      };
      const en: Record<string, string> = {
        orbit: "orbit",
        hold: "holding pattern",
        tf: "terrain following",
        tanker: `tanker TEXACO, ${side[1]}${how ? ` — ${how[1]}` : ""}`,
        tankerOff: "refuelling stopped",
        refuelMode: `refuelling ${how?.[1] ?? ""}`.trim(),
        off: "autopilot mode off",
      };
      return { fr: fr[String(a.mode)] ?? "mode", en: en[String(a.mode)] ?? "mode" };
    },
  },
  "ap.traffic": {
    fam: "jet",
    params: { action: { type: "string", enum: ["intercept", "join", "stop"] }, name: { type: "string" } },
    required: ["action"],
    say: (a) => {
      const n = typeof a.name === "string" ? ` ${a.name.slice(0, 16)}` : "";
      const fr: Record<string, string> = { intercept: `interception${n}`, join: `formation sur${n}`, stop: "interception arrêtée" };
      const en: Record<string, string> = { intercept: `intercept${n}`, join: `join${n}`, stop: "intercept stopped" };
      return { fr: fr[String(a.action)]!, en: en[String(a.action)]! };
    },
  },
  "ap.goAround": { fam: "jet", say: () => ({ fr: "remise de gaz", en: "go-around" }) },
  // the spacecraft's flight computer: its holds, its autopilots, the manoeuvres previewed then flown, a mission
  "sp.hold": {
    fam: "space",
    params: { direction: { type: "string", enum: HOLDS } },
    required: ["direction"],
    say: (a) => ({
      fr: a.direction === "none" ? "tenue d'attitude coupée" : `tenue ${HOLD_FR[String(a.direction)] ?? a.direction}`,
      en: a.direction === "none" ? "attitude hold off" : `hold ${HOLD_EN[String(a.direction)] ?? a.direction}`,
    }),
  },
  "sp.auto": {
    fam: "space",
    params: {
      mode: { type: "string", enum: AUTOS },
      site: { type: "string" },
      altKm: { type: "number", minimum: 50, maximum: 100_000 },
      incDeg: { type: "number", minimum: -180, maximum: 180 },
    },
    required: ["mode"],
    say: (a) => ({
      fr: a.mode === "none" ? "autopilote coupé" : `autopilote ${AUTO_FR[String(a.mode)] ?? a.mode}`,
      en: a.mode === "none" ? "autopilot off" : `autopilot ${AUTO_EN[String(a.mode)] ?? a.mode}`,
    }),
  },
  "sp.maneuver": {
    fam: "space",
    params: {
      op: { type: "string", enum: MANEUVERS },
      where: { type: "string", enum: ["now", "pe", "ap"] },
      altKm: { type: "number", minimum: 1, maximum: 1e7 },
      incDeg: { type: "number", minimum: 0, maximum: 180 },
      ratio: { type: "number", minimum: 0.2, maximum: 20 },
      site: { type: "string" },
      execute: { type: "boolean" },
    },
    required: ["op", "execute"],
    say: (a) => {
      const op = MANEUVER_FR[String(a.op)] ?? String(a.op);
      return {
        fr: a.execute ? `manœuvre ${op} exécutée` : `manœuvre ${op} — aperçu`,
        en: `${MANEUVER_EN[String(a.op)] ?? a.op} ${a.execute ? "executed" : "— preview"}`,
      };
    },
  },
  "sp.mission": {
    fam: "space",
    params: {
      target: { type: "string" },
      arrival: { type: "string", enum: ["orbit", "flyby", "freeReturn"] },
      altKm: { type: "number", minimum: 1, maximum: 1e7 },
      execute: { type: "boolean" },
    },
    required: ["target", "execute"],
    say: (a) => ({
      fr: `mission vers ${String(a.target).slice(0, 20)}${a.execute ? " — lancée" : " — aperçu"}`,
      en: `mission to ${String(a.target).slice(0, 20)}${a.execute ? "" : " previewed"}`,
    }),
  },
  "sp.plan": {
    fam: "space",
    params: { action: { type: "string", enum: ["execute", "clear"] } },
    required: ["action"],
    say: (a) => onOff(a.action === "execute", ["plan exécuté", "plan effacé"], ["plan executed", "plan cleared"]),
  },
  "sp.target": {
    fam: "space",
    params: { name: { type: "string" } },
    required: ["name"],
    say: (a) => ({ fr: `cible : ${String(a.name).slice(0, 24)}`, en: `target: ${String(a.name).slice(0, 24)}` }),
  },
  "sp.release": { fam: "space", say: () => ({ fr: "autopilote et tenue relâchés", en: "autopilot and hold released" }) },
  // (PLAN-VAISSEAUX K6: the docking's — undock, refuel, keep station, the RCS's mode —, the Endurance's ring, the plan's
  // burns moved in time or removed, the systems' checklists ticked and their actions given)
  "sp.dock": {
    fam: "space",
    params: { action: { type: "string", enum: ["undock", "refuel", "keep", "rcs"] } },
    required: ["action"],
    say: (a) =>
      ({
        undock: { fr: "désamarrage", en: "undock" },
        refuel: { fr: "plein depuis le vaisseau amarré", en: "refuel from the docked craft" },
        keep: { fr: "maintien à poste", en: "station keeping" },
        rcs: { fr: "mode RCS basculé", en: "RCS mode switched" },
      })[String(a.action)] ?? { fr: "amarrage", en: "docking" },
  },
  "sp.ring": {
    fam: "space",
    params: { dir: { type: "number", minimum: -1, maximum: 1, integer: true } },
    required: ["dir"],
    say: (a) => (a.dir === 1 ? { fr: "anneau plus vite", en: "ring faster" } : { fr: "anneau moins vite", en: "ring slower" }),
  },
  "sp.node": {
    fam: "space",
    params: {
      action: { type: "string", enum: ["shift", "delete"] },
      index: { type: "number", minimum: 0, maximum: 15, integer: true },
      dtS: { type: "number", minimum: -1e7, maximum: 1e7 },
    },
    required: ["action", "index"],
    say: (a) =>
      a.action === "delete"
        ? { fr: `poussée ${Number(a.index) + 1} supprimée`, en: `burn ${Number(a.index) + 1} removed` }
        : {
            fr: `poussée ${Number(a.index) + 1} déplacée de ${Math.round(Number(a.dtS ?? 0))} s`,
            en: `burn ${Number(a.index) + 1} moved ${Math.round(Number(a.dtS ?? 0))} s`,
          },
  },
  // (the powered landing's point redesignated from the console — PLAN-VAISSEAUX K4/K6, the Lander's LPD: a place on
  // the body, or a step over the ground forward and right [m])
  "sp.lpd": {
    fam: "space",
    params: {
      lat: { type: "number", minimum: -90, maximum: 90 },
      lon: { type: "number", minimum: -180, maximum: 180 },
      fwd: { type: "number", minimum: -5000, maximum: 5000 },
      right: { type: "number", minimum: -5000, maximum: 5000 },
    },
    say: (a) =>
      a.lat !== undefined
        ? { fr: "point d'atterrissage désigné", en: "landing point designated" }
        : {
            fr: `point d'atterrissage déplacé de ${Math.round(Number(a.fwd ?? 0))} m devant, ${Math.round(Number(a.right ?? 0))} m à droite`,
            en: `landing point moved ${Math.round(Number(a.fwd ?? 0))} m ahead, ${Math.round(Number(a.right ?? 0))} m right`,
          },
  },
  // (the room's fleet — N1: the pilot followed asks another pilot's spacecraft to come to him, hold on him, dock to him)
  "sp.fleet": {
    fam: "space",
    params: {
      order: { type: "string", enum: ["come", "hold", "dock"] },
      slot: { type: "number", minimum: 0, maximum: 15, integer: true },
      name: { type: "string" },
    },
    required: ["order", "slot"],
    say: (a) => {
      const who = typeof a.name === "string" ? a.name.slice(0, 16) : `#${a.slot}`;
      const W: Record<string, [string, string]> = {
        come: [`${who} : rejoins-moi`, `${who}: come to me`],
        hold: [`${who} : maintiens-toi sur moi`, `${who}: hold on me`],
        dock: [`${who} : amarre-toi à moi`, `${who}: dock to me`],
      };
      const w = W[String(a.order)] ?? [who, who];
      return { fr: `ordre de flotte — ${w[0]}`, en: `fleet order — ${w[1]}` };
    },
  },
  // (the failures' short names, the console's French and the pilot's English)
  "sys.step": {
    fam: "space",
    params: {
      kind: { type: "string", enum: ["engine", "rcsStuck", "gyro", "bus", "o2Leak", "scrubber"] },
      step: { type: "number", minimum: 0, maximum: 11, integer: true },
      on: { type: "boolean" },
    },
    required: ["kind", "step", "on"],
    say: (a) => ({
      fr: `checklist ${SYS_NAMES[String(a.kind)]?.fr ?? a.kind} : étape ${Number(a.step) + 1} ${a.on ? "faite" : "décochée"}`,
      en: `checklist ${SYS_NAMES[String(a.kind)]?.en ?? a.kind}: step ${Number(a.step) + 1} ${a.on ? "done" : "unticked"}`,
    }),
  },
  "sys.fix": {
    fam: "space",
    params: { kind: { type: "string", enum: ["engine", "rcsStuck", "gyro", "bus", "o2Leak", "scrubber"] } },
    required: ["kind"],
    say: (a) => ({
      fr: `action de panne : ${SYS_NAMES[String(a.kind)]?.fr ?? a.kind}`,
      en: `failure action: ${SYS_NAMES[String(a.kind)]?.en ?? a.kind}`,
    }),
  },
  // the F-35's weapons (the backseater's): the radar, the weapon, the lock, the shots, the decoys
  "wp.radar": {
    fam: "weapons",
    params: { mode: { type: "string", enum: ["RWS", "TWS", "STT"] } },
    required: ["mode"],
    say: (a) => ({ fr: `radar ${a.mode}`, en: `radar ${a.mode}` }),
  },
  "wp.select": {
    fam: "weapons",
    params: { weapon: { type: "string", enum: ["aim120", "aim9x", "jdam", "jsm"] } },
    required: ["weapon"],
    say: (a) => ({
      fr: `arme : ${WEAPON_NAMES[String(a.weapon)] ?? a.weapon}`,
      en: `weapon: ${WEAPON_NAMES[String(a.weapon)] ?? a.weapon}`,
    }),
  },
  "wp.lock": {
    fam: "weapons",
    params: { target: { type: "string" } },
    say: (a) => ({
      fr: a.target ? `verrouillage ${String(a.target).slice(0, 20)}` : "verrouillage de la piste suivante",
      en: a.target ? `lock ${String(a.target).slice(0, 20)}` : "lock the next track",
    }),
  },
  /** a track designated to the pilot — selected on all his screens, not locked (PLAN-RADAR-AAA RD9) */
  "wp.designate": {
    fam: "weapons",
    params: { id: { type: "string" } },
    say: (a) => ({ fr: `désignation ${String(a.id ?? "").slice(0, 24)}`, en: `designate ${String(a.id ?? "").slice(0, 24)}` }),
  },
  "wp.fire": { fam: "weapons", say: () => ({ fr: "tir", en: "fire" }) },
  "wp.gun": {
    fam: "weapons",
    params: { seconds: { type: "number", minimum: 0.2, maximum: 3 } },
    say: (a) => ({ fr: `rafale canon ${Number(a.seconds ?? 1).toFixed(1)} s`, en: `gun burst ${Number(a.seconds ?? 1).toFixed(1)} s` }),
  },
  "wp.cm": { fam: "weapons", say: () => ({ fr: "leurres", en: "countermeasures" }) },
  "cfg.sas": {
    fam: "config",
    params: { on: { type: "boolean" } },
    required: ["on"],
    say: (a) => onOff(a.on, ["SAS engagé", "SAS coupé"], ["SAS on", "SAS off"]),
  },
} satisfies Record<string, ActSpec>;
export type Act = keyof typeof ACTS;
const SPECS: Record<string, ActSpec> = ACTS;

/** what is never in the catalogue, whatever a later phase adds (tests/crew-actions.test.ts checks it) */
export const NEVER = [
  "throttle",
  "stick",
  "pitch",
  "roll",
  "yaw",
  "press_key",
  "flightMode",
  "set_craft",
  "place_ship",
  "set_mode",
  "time",
  "set_date",
  "saves",
  "start_scene",
  "set_settings",
];

export interface CrewCmd {
  v: 1;
  id: string;
  to: number;
  act: Act;
  args: Args;
  /** the console's language: the pilot answers in it (absent: an older console's — French) */
  lang?: "fr" | "en";
}
export interface CrewAck {
  v: 1;
  id: string;
  to: number;
  act: string;
  ok: boolean;
  msg: string;
  /** what was asked, in the asking console's language */
  what: string;
  /** what was asked's arguments (primitives): every screen says it again in its own language and units */
  args?: Record<string, string | number | boolean>;
  /** a few figures back (a manoeuvre previewed: its Δv, its burns…), primitives only */
  data?: Record<string, string | number | boolean>;
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** An order heard (untrusted): its act known, its arguments checked against the act's schema — or why not. */
export function readCrewCmd(x: unknown): { ok: true; cmd: CrewCmd } | { ok: false; error: string; id?: string } {
  if (!record(x) || x.v !== 1 || typeof x.id !== "string" || !x.id || x.id.length > 40) return { ok: false, error: "malformed" };
  const id = x.id;
  if (typeof x.to !== "number" || !Number.isInteger(x.to)) return { ok: false, error: "no pilot named", id };
  if (typeof x.act !== "string" || !Object.hasOwn(SPECS, x.act))
    return { ok: false, error: `unknown act ${String(x.act).slice(0, 32)}`, id };
  const spec = SPECS[x.act]!;
  const chk = checkArgs({ name: x.act, description: "", params: spec.params ?? {}, required: spec.required }, x.args ?? {});
  if (!chk.ok) return { ok: false, error: chk.error, id };
  return {
    ok: true,
    cmd: { v: 1, id, to: x.to, act: x.act as Act, args: chk.args, ...(x.lang === "en" || x.lang === "fr" ? { lang: x.lang } : {}) },
  };
}

/** An answer heard (untrusted, bounded). */
export function readCrewAck(x: unknown): CrewAck | null {
  if (!record(x) || x.v !== 1 || typeof x.id !== "string" || typeof x.to !== "number" || typeof x.ok !== "boolean") return null;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const data: Record<string, string | number | boolean> = {};
  if (record(x.data))
    for (const [k, v] of Object.entries(x.data).slice(0, 12)) {
      if (typeof v === "string") data[k.slice(0, 24)] = v.slice(0, 120);
      else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") data[k.slice(0, 24)] = v;
    }
  let args: CrewAck["args"];
  if (record(x.args)) {
    args = {};
    for (const [k, v] of Object.entries(x.args).slice(0, 12)) {
      if (typeof v === "string") args[k.slice(0, 24)] = v.slice(0, 64);
      else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") args[k.slice(0, 24)] = v;
    }
  }
  return {
    v: 1,
    id: x.id.slice(0, 40),
    to: x.to,
    act: s(x.act, 32),
    ok: x.ok,
    msg: s(x.msg, 200),
    what: s(x.what, 80),
    data,
    ...(args ? { args } : {}),
  };
}

export const familyOf = (act: string): Family | null => SPECS[act]?.fam ?? null;
export const sayOf = (act: string, args: Args, u: Units = unitsOf("metric")) => SPECS[act]?.say(args, u) ?? { fr: act, en: act };
export { onOff };

/** a sender's pace: at most `n` orders a second (a burst of 2n), each id once */
export class CrewGate {
  private tokens = new Map<number, { t: number; n: number }>();
  private seen = new Map<number, string[]>();
  constructor(private rate = 4) {}
  pass(from: number, id: string, now: number): "ok" | "rate" | "again" {
    const ids = this.seen.get(from) ?? [];
    if (ids.includes(id)) return "again";
    const b = this.tokens.get(from) ?? { t: now, n: this.rate * 2 };
    b.n = Math.min(this.rate * 2, b.n + ((now - b.t) / 1000) * this.rate);
    b.t = now;
    if (b.n < 1) {
      this.tokens.set(from, b);
      return "rate";
    }
    b.n -= 1;
    this.tokens.set(from, b);
    ids.push(id);
    if (ids.length > 64) ids.shift();
    this.seen.set(from, ids);
    return "ok";
  }
}
