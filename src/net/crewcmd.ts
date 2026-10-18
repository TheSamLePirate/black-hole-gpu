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
