// The network's input boundary (PLAN-RESEAU-DURCISSEMENT RD1; audit 2026-11-10 NET-01, NET-07, NET-21): what another
// member sends is data, never trusted. A relayed event is read here before any listener sees it: its envelope (an
// object, a short kind of letters, digits and dashes, a `to` slot if any) and, for the kinds whose fields the game keeps
// and reads every frame, its fields — finite, bounded, of the right shape. One that is not is dropped and counted: before
// 13 Nov 2026, `{kind:"match", m:{id:"x"}}`, a `tel` of strings or a `dock` without its place each froze every member's
// image (an exception before the render, every frame — reproduced by tests/e2e/net-inbound), and the server replayed the
// bad match to every newcomer.
//
// A kind not in READERS passes with its envelope checked: its listener reads it with its own guards (crew-cmd,
// stel, sorder… — readCrewCmd, spaceTelOf, isSpaceOrder), and an exception in any listener is caught by the client
// (client.ts emit), counted, never thrown into the frame. A later version's event of a known kind but another shape is
// dropped, not half-read (the version question: docs/PLAN-RESEAU-DURCISSEMENT.md §4, decision 3).

import type { NetEvent } from "./proto";

const MATCH_MODES = ["coop", "ffa", "teams", "race", "landing", "free"] as const;
const SKILLS = ["easy", "normal", "ace"] as const;

/** a slot of a room (the members' 0…199; the away crafts' from 200 never send) */
export const isSlot = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 200;
/** an event's addressee: a slot, or another's AI wingman (negative: −its index — combat.ts `peer`) */
const isTo = (x: unknown) => Number.isInteger(x) && Math.abs(x as number) < 256;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const vec = (x: unknown, n = 3, max = 1e13): x is number[] =>
  Array.isArray(x) && x.length === n && x.every((v) => fin(v) && Math.abs(v) < max);
const str = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A match as said by its host (game/match.ts Match), or null. */
export function readMatch(m: unknown): boolean {
  if (!obj(m)) return false;
  const r = m.rules;
  return (
    str(m.id, 64) &&
    MATCH_MODES.includes(m.mode as never) &&
    str(m.def, 64) &&
    isSlot(m.host) &&
    fin(m.start) &&
    obj(r) &&
    typeof r.infinite === "boolean" &&
    typeof r.invulnerable === "boolean" &&
    SKILLS.includes(r.skill as never) &&
    typeof r.enemyMissiles === "boolean" &&
    typeof r.friendlyFire === "boolean" &&
    [r.limit, r.scoreLimit, r.respawn].every((v) => fin(v) && (v as number) >= 0 && (v as number) < 1e6) &&
    Array.isArray(m.pilots) &&
    m.pilots.length <= 16 &&
    m.pilots.every(isSlot) &&
    obj(m.teams) &&
    Object.entries(m.teams).every(([k, v]) => isSlot(Number(k)) && (v === 0 || v === 1))
  );
}

/** A pilot's combat state (netmatch.ts CombatState): his missiles, the host's aggressors, his place. */
export function readCombatState(s: unknown): boolean {
  if (!obj(s) || !Array.isArray(s.ms) || s.ms.length > 64) return false;
  for (const x of s.ms as unknown[])
    if (
      !Array.isArray(x) ||
      x.length !== 10 ||
      !fin(x[0]) ||
      !(typeof x[1] === "string" && /^[a-z0-9]{1,12}$/.test(x[1])) ||
      ![2, 3, 4, 5, 6, 7].every((k) => fin(x[k]) && Math.abs(x[k] as number) < 1e8) ||
      !str(x[8], 12) ||
      (x[9] !== 0 && x[9] !== 1)
    )
      return false;
  if (s.ai !== undefined) {
    if (!Array.isArray(s.ai) || s.ai.length > 64) return false;
    for (const a of s.ai as unknown[])
      if (!Array.isArray(a) || a.length !== 14 || !a.every((v) => fin(v) && Math.abs(v) < 1e8)) return false;
  }
  return s.o === undefined || vec(s.o, 3, 1e8);
}

/** The events whose fields the game keeps and reads every frame: their reading (true: well formed). */
const READERS: Record<string, (e: Record<string, unknown>) => boolean> = {
  match: (e) => readMatch(e.m),
  matchEnd: (e) =>
    (e.id === undefined || str(e.id, 64)) &&
    (e.ranking === undefined ||
      (Array.isArray(e.ranking) &&
        e.ranking.length <= 16 &&
        e.ranking.every((r) => obj(r) && isSlot(r.slot) && str(r.name, 64) && str(r.line, 240)))),
  cs: (e) => readCombatState(e.s),
  // (a craft docked to another's port: the ports, the place and the axes on the host)
  dock: (e) =>
    isSlot(e.to) &&
    Number.isInteger(e.port) &&
    Number.isInteger(e.ownPort) &&
    vec(e.c, 3, 1e4) &&
    Array.isArray(e.ax) &&
    e.ax.length === 3 &&
    e.ax.every((a) => vec(a, 3, 2)),
  // (a pilot's telemetry for the others' tags: figures only)
  tel: (e) => obj(e.v) && Object.keys(e.v).length <= 32 && Object.entries(e.v).every(([k, v]) => k.length <= 24 && fin(v)),
  bump: (e) => isSlot(e.to) && vec(e.dv, 3, 100),
  board: (e) => isSlot(e.to) && (e.gone === undefined || typeof e.gone === "boolean"),
  wingCrash: (e) => (e.p === undefined || e.p === null || vec(e.p, 3, 1e13)) && (fin(e.k) || str(e.k, 24)),
  hit: (e) => e.dmg === undefined || (fin(e.dmg) && Math.abs(e.dmg) < 1e4),
  hitWing: (e) => isSlot(e.to) && (e.dmg === undefined || (fin(e.dmg) && Math.abs(e.dmg) < 1e4)),
  down: (e) => isSlot(e.slot) && (e.by === undefined || e.by === null || isSlot(e.by)),
  crash: (e) => e.why === undefined || str(e.why, 240),
};

/** The kinds read field by field (the others: envelope only). */
export const READ_KINDS = Object.keys(READERS);

/**
 * A relayed event read (null: dropped — not an object, a kind that is not one, a `to` that is no slot, or a known kind
 * of another shape). The event is returned as it came: a reader checks, it does not rebuild.
 */
export function readEvent(raw: unknown): NetEvent | null {
  if (!obj(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== "string" || !/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(kind)) return null;
  if (raw.to !== undefined && raw.to !== null && !isTo(raw.to)) return null;
  const R = READERS[kind];
  if (R && !R(raw)) return null;
  return raw as NetEvent;
}

/** What crossed the boundary (the page's `__bh.net.net.inbound`): events taken, dropped, listeners that threw; samples
 *  dropped (not finite, out of bounds, another's slot, a time far from the room's). */
export interface InboundStats {
  events: number;
  rejected: number;
  failed: number;
  samplesRejected: number;
  /** the last dropped event's kind, the last listener's error */
  lastRejected: string;
  lastFailure: string;
}
export const inboundStats = (): InboundStats => ({
  events: 0,
  rejected: 0,
  failed: 0,
  samplesRejected: 0,
  lastRejected: "",
  lastFailure: "",
});
