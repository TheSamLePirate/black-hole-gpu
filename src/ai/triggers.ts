// What wakes TARS (PLAN-TARS-AGENT B1): rules — on a change of the game (the autopilot, the flight's phase,
// a step of the hub, a phase of the entry, an alert, a sphere of influence, a landing, a docking, a report,
// a deviation out of its tolerance), every N minutes, at an hour of the game, in N seconds — each with what
// he is to do then. His reflexes are rules too (the key moments, given by default, each to switch off).
// Kept in this browser with his memory (never in a save), cleared with it. Pure: events in, rules due out;
// the budget (budget.ts) and the turn itself are the caller's.

export type TriggerKind =
  | "autopilot"
  | "phase"
  | "hub_step"
  | "entry_phase"
  | "alert"
  | "soi"
  | "landed"
  | "docked"
  | "report"
  | "deviation"
  | "every"
  | "at"
  | "in";

export const EVENT_KINDS: TriggerKind[] = [
  "autopilot",
  "phase",
  "hub_step",
  "entry_phase",
  "alert",
  "soi",
  "landed",
  "docked",
  "report",
  "deviation",
];

export interface TriggerOn {
  kind: TriggerKind;
  /** an event's value it waits for ("none": an autopilot that ended; "orbit": a phase; an alert's id…) */
  to?: string;
  /** every: the minutes between two; in: the seconds from its creation; at: the game's time [s] */
  minutes?: number;
  seconds?: number;
  simTime?: number;
}

export interface Trigger {
  id: string;
  on: TriggerOn;
  /** what he is to do then, in his own words (sent as the turn's instruction) */
  prompt: string;
  /** once fired, gone */
  once?: boolean;
  enabled: boolean;
  /** one of his reflexes (given by default; switched off, not deleted) */
  reflex?: boolean;
  createdAt: number;
  firedAt?: number;
  fired?: number;
}

/** A change of the game, as the triggers hear it. */
export interface GameEvent {
  kind: TriggerKind;
  /** the new value (the autopilot's mode, the phase's stage, the alert's id…) */
  to?: string;
  from?: string;
  /** a line on what happened, for him */
  detail?: string;
}

export interface TriggerStore {
  get(): Trigger[] | null;
  set(t: Trigger[]): boolean;
  clear(): void;
}

/** His reflexes: the key moments, given by default. */
export const REFLEXES: Omit<Trigger, "createdAt">[] = [
  {
    id: "reflex-autopilot-end",
    reflex: true,
    enabled: true,
    on: { kind: "autopilot", to: "none" },
    prompt:
      "An autopilot just ended. Check the outcome (get_state) and say it in one short sentence; if something went wrong, say what and what you suggest.",
  },
  {
    id: "reflex-entry",
    reflex: true,
    enabled: true,
    on: { kind: "entry_phase" },
    prompt:
      "The entry moved to a new phase. One short callout of where we stand (height, speed, what comes next). Nothing if all is nominal and you spoke less than a minute ago.",
  },
  {
    id: "reflex-warning",
    reflex: true,
    enabled: true,
    on: { kind: "alert", to: "warning" },
    prompt:
      "A warning alert came up. Read the telemetry, say plainly what it is and act if an action of yours clearly saves the situation; otherwise advise.",
  },
  {
    id: "reflex-deviation",
    reflex: true,
    enabled: true,
    on: { kind: "deviation" },
    prompt:
      "A flight's deviation went out of its tolerance. Read the telemetry, say it briefly and correct it if you can (an autopilot, a burn, a go-around).",
  },
  {
    id: "reflex-landed",
    reflex: true,
    enabled: true,
    on: { kind: "report" },
    prompt: "A landing or docking report came in. Comment it in one sentence, its grade first.",
  },
];

/** where they are kept (with his memory: this browser only) */
export const TARS_TRIGGERS_KEY = "kerr.tars.triggers";

let seq = 0;
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export class Triggers {
  private list_: Trigger[];

  constructor(
    private store: TriggerStore,
    private now: () => number = () => Date.now(),
  ) {
    const kept = store.get();
    const t0 = this.now();
    // (his reflexes always there, as kept — switched off stays off)
    const reflexes = REFLEXES.map((r) => ({ ...r, createdAt: t0, ...(kept?.find((k) => k.id === r.id) ?? {}) }));
    this.list_ = [...reflexes, ...(kept ?? []).filter((k) => !k.reflex)];
  }

  list(): readonly Trigger[] {
    return this.list_;
  }

  private save() {
    this.store.set(this.list_);
  }

  /** A rule added: its id. */
  add(t: { on: TriggerOn; prompt: string; once?: boolean }): Trigger {
    const r: Trigger = { id: newId(), on: t.on, prompt: t.prompt.trim().slice(0, 600), once: t.once, enabled: true, createdAt: this.now() };
    this.list_.push(r);
    this.save();
    return r;
  }

  /** A rule removed (a reflex only switched off): whether it was there. */
  remove(id: string): boolean {
    const r = this.list_.find((x) => x.id === id);
    if (!r) return false;
    if (r.reflex) r.enabled = false;
    else this.list_ = this.list_.filter((x) => x !== r);
    this.save();
    return true;
  }

  enable(id: string, on: boolean): boolean {
    const r = this.list_.find((x) => x.id === id);
    if (!r) return false;
    r.enabled = on;
    this.save();
    return true;
  }

  /** All gone (his memory cleared): the reflexes back on. */
  clear() {
    this.store.clear();
    const t0 = this.now();
    this.list_ = REFLEXES.map((r) => ({ ...r, createdAt: t0 }));
  }

  /** The rules an event wakes. */
  match(e: GameEvent): Trigger[] {
    return this.list_.filter((r) => r.enabled && r.on.kind === e.kind && (r.on.to === undefined || r.on.to === e.to));
  }

  /** The timed rules due now (wall clock [ms], the game's time [s]). */
  due(simTime: number): Trigger[] {
    const now = this.now();
    return this.list_.filter((r) => {
      if (!r.enabled) return false;
      switch (r.on.kind) {
        case "every":
          return now - (r.firedAt ?? r.createdAt) >= (r.on.minutes ?? 10) * 60_000;
        case "in":
          return !r.fired && now - r.createdAt >= (r.on.seconds ?? 60) * 1000;
        case "at":
          return !r.fired && r.on.simTime !== undefined && simTime >= r.on.simTime;
        default:
          return false;
      }
    });
  }

  /** A rule fired: counted, and gone if once (or a one-shot time). */
  fired(id: string) {
    const r = this.list_.find((x) => x.id === id);
    if (!r) return;
    r.firedAt = this.now();
    r.fired = (r.fired ?? 0) + 1;
    if (r.once || r.on.kind === "in" || r.on.kind === "at") {
      if (r.reflex) r.enabled = false;
      else this.list_ = this.list_.filter((x) => x !== r);
    }
    this.save();
  }
}

/** What he is told when rules wake him — every rule one event woke, in one waking. */
export function wakeText(rules: Trigger[], e: GameEvent | null): string {
  const r0 = rules[0]!;
  const what = e
    ? `${e.kind}${e.from !== undefined ? ` ${e.from} →` : ""}${e.to !== undefined ? ` ${e.to}` : ""}${e.detail ? ` (${e.detail})` : ""}`
    : r0.on.kind;
  const who = rules.map((r) => `${r.reflex ? "reflex" : "rule"} "${r.id}"`).join(", ");
  const asks = rules.length === 1 ? r0.prompt : rules.map((r, k) => `${k + 1}) ${r.prompt}`).join(" ");
  return `[Woken by your ${who} — ${what}. No pilot is speaking: this is your own initiative. Keep it short; stay silent (answer exactly "—") if nothing is worth saying.] ${asks}`;
}
