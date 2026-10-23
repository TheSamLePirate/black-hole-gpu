// What FlightGear's ECAM logic runs on (docs/PLAN-A320.md, A11): the systems' bag read and written as Nasal does
// (logic.ts, generated from ECAM-logic.nas: g a property's value, b its getBoolValue, s its setValue), Nasal's truth,
// equality and string concatenation, its math, settimer; the messages as ECAM-controller.nas's warning / memo /
// status objects (their activity, their clearing, their light and aural once) and the logic's own variables. Pure.

import type { Props } from "../rig";
import { Clock } from "../systems/nasal/util";
import {
  type MsgDef,
  type MsgName,
  configmemos,
  leftmemos,
  memos,
  secondaryFailures,
  specialLines,
  statusApprProc,
  statusLim,
  warnings,
} from "./messages";
import { LOCALS } from "./logic";

/** a Nasal value: a number, a string, nil (null) — the logic's arithmetic and comparisons as Nasal's, unchecked */
// biome-ignore lint/suspicious/noExplicitAny: Nasal's values are dynamically typed
export type Val = any;

/** a message as ECAM-controller.nas's warning object: its definition and its state */
export interface Msg extends MsgDef {
  active: number;
  noRepeat: number;
  noRepeat2: number;
  clearFlag: number;
  hasCalled: number;
  wasActive: number;
}

const msgOf = (d: MsgDef): Msg => ({ ...d, active: 0, noRepeat: 0, noRepeat2: 0, clearFlag: 0, hasCalled: 0, wasActive: 0 });

/** Nasal's truth: nil, 0, "" false; a numeric string its number's */
export const t = (x: Val): boolean => {
  if (x === null || x === undefined || x === false) return false;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "boolean") return x;
  if (x === "") return false;
  const n = Number(x);
  return Number.isFinite(n) ? n !== 0 : true;
};
/** Nasal's ==: numbers by value (a numeric string too), nil only nil, strings by text */
export const eq = (a: Val, b: Val): boolean => {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === "boolean") a = a ? 1 : 0;
  if (typeof b === "boolean") b = b ? 1 : 0;
  if (typeof a === "number" && typeof b === "number") return a === b;
  const x = Number(a),
    y = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y)) return x === y;
  return String(a) === String(b);
};
/** Nasal's ~ (a number as its shortest text) */
export const cat = (a: Val, b: Val): string => `${str(a)}${str(b)}`;
const str = (x: Val) => (x === null || x === undefined ? "" : typeof x === "number" ? String(Number(x.toPrecision(10))) : String(x));
/** Nasal's find(needle, haystack): its index, -1 not found */
export const find = (n: Val, h: Val): number => String(h ?? "").indexOf(String(n));

/** The FWC's working state: the bag, the messages, the logic's variables, its timers. */
export class Fwc {
  P: Props = {};
  /** the messages by name (FlightGear's variables: a name defined twice, its last) */
  readonly M = {} as Record<MsgName, Msg>;
  /** the vectors, in FlightGear's order */
  readonly warnings: Msg[];
  readonly configmemos: Msg[];
  readonly leftmemos: Msg[];
  readonly specialLines: Msg[];
  readonly secondaryFailures: Msg[];
  readonly memos: Msg[];
  readonly status: Msg[];
  /** ECAM-logic.nas's own variables */
  V: Record<string, Val> = LOCALS();
  readonly clock = new Clock();
  /** the Nasal functions the logic calls that the game does not have (mcdu.chooseVS1G…): their answers, by name */
  calls: Record<string, (...a: Val[]) => Val> = {};

  constructor() {
    const v = (ds: MsgDef[]) =>
      ds.map((d) => {
        const m = msgOf(d);
        this.M[d.name as MsgName] = m;
        return m;
      });
    this.warnings = v(warnings);
    this.configmemos = v(configmemos);
    this.leftmemos = v(leftmemos);
    this.specialLines = v(specialLines);
    this.secondaryFailures = v(secondaryFailures);
    this.memos = v(memos);
    this.status = [...v(statusLim), ...v(statusApprProc)];
  }

  // ---- the logic's vocabulary (logic.ts destructures these: arrow functions, bound)
  readonly g = (k: string): Val => this.P[k] ?? 0;
  readonly b = (k: string): boolean => t(this.P[k]);
  readonly s = (k: string, v: Val) => {
    this.P[k] = typeof v === "boolean" ? (v ? 1 : 0) : v === null || v === undefined ? 0 : v;
  };
  /** ECAM_controller.warningReset: inactive, its light and aural free to come again (wasActive left to them) */
  readonly R = (w: Msg) => {
    if (w.aural !== undefined && w.aural !== 9 && w.active === 1) this.P[AURAL[w.aural]!] = 0;
    w.active = 0;
    w.noRepeat = 0;
    w.noRepeat2 = 0;
  };
  readonly t = t;
  readonly eq = eq;
  readonly cat = cat;
  readonly find = find;
  readonly abs = Math.abs;
  readonly max = Math.max;
  readonly min = Math.min;
  readonly round = Math.round;
  readonly size = (x: Val) => (x?.length ?? 0) as number;
  readonly after = (s: Val, fn: () => void) => this.clock.after(Number(s), fn);
  readonly call = (name: string, ...a: Val[]): Val => this.calls[name]?.(...a) ?? 0;
}

/** the aurals' properties (ECAM-controller.nas's aural vector, by a warning's aural number) */
export const AURAL = [
  "sim/sound/warnings/crc",
  "sim/sound/warnings/chime",
  "sim/sound/warnings/cricket",
  "sim/sound/warnings/retard",
  "sim/sound/warnings/cchord",
  "sim/sound/warnings/click",
];
/** the master lights' (its lights vector: 0 warning, 1 caution) */
export const LIGHT = ["ECAM/warnings/master-warning-light", "ECAM/warnings/master-caution-light"];
