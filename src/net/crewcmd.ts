// The crew's orders (docs/PLAN-CREW-ACTIONS.md): what a crew console (crew/) asks the pilot it follows to do — never to
// fly: no stick, no throttle, no free key — and the pilot's answer. Shared by the console and the simulator, pure.
//   crew-cmd { v: 1, id, to: the pilot's slot, act, args }   — from a member joined as "instruments"
//   crew-ack { v: 1, id, to: the sender's slot, act, ok, msg } — from the pilot, heard by every screen
// The sender is the server's stamp (`from`), its role the room's roster's: neither can be forged. Every act is in
// the catalogue below with its arguments' schema (the game tools' own checker), checked again where it runs.
import { checkArgs, type Args, type Param } from "../ai/tool-schema";

/** the families a pilot opens (the instruments' `caps`): what can be done now, on this craft, in this mode */
export const FAMILIES = ["nav", "config", "jet", "space", "weapons"] as const;
export type Family = (typeof FAMILIES)[number];

type Say = (a: Args) => { fr: string; en: string };
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
    say: (a) => {
      const parts: string[] = [];
      if (a.alt !== undefined) parts.push(`ALT ${Math.round(Number(a.alt))} m`);
      if (a.hdgDeg !== undefined) parts.push(`CAP ${String(Math.round(Number(a.hdgDeg)) % 360).padStart(3, "0")}°`);
      if (a.spd !== undefined) parts.push(`VIT ${Math.round(Number(a.spd))} m/s`);
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
      mode: { type: "string", enum: ["orbit", "hold", "tf", "off"] },
      lat: { type: "number", minimum: -90, maximum: 90 },
      lon: { type: "number", minimum: -180, maximum: 180 },
      radiusKm: { type: "number", minimum: 1, maximum: 50 },
      dir: { type: "string", enum: ["right", "left"] },
      inboundDeg: { type: "number", minimum: 0, maximum: 360 },
      aglM: { type: "number", minimum: 0, maximum: 1000 },
    },
    required: ["mode"],
    say: (a) => {
      const fr: Record<string, string> = {
        orbit: "orbite",
        hold: "circuit d'attente",
        tf: "suivi de terrain",
        off: "mode du pilote automatique coupé",
      };
      const en: Record<string, string> = { orbit: "orbit", hold: "holding pattern", tf: "terrain following", off: "autopilot mode off" };
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
}
export interface CrewAck {
  v: 1;
  id: string;
  to: number;
  act: string;
  ok: boolean;
  msg: string;
  /** what was asked, in the crew console's words (French: its language) */
  what: string;
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
  return { ok: true, cmd: { v: 1, id, to: x.to, act: x.act as Act, args: chk.args } };
}

/** An answer heard (untrusted, bounded). */
export function readCrewAck(x: unknown): CrewAck | null {
  if (!record(x) || x.v !== 1 || typeof x.id !== "string" || typeof x.to !== "number" || typeof x.ok !== "boolean") return null;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  return { v: 1, id: x.id.slice(0, 40), to: x.to, act: s(x.act, 32), ok: x.ok, msg: s(x.msg, 200), what: s(x.what, 80) };
}

export const familyOf = (act: string): Family | null => SPECS[act]?.fam ?? null;
export const sayOf = (act: string, args: Args) => SPECS[act]?.say(args) ?? { fr: act, en: act };
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
