// What docked spacecraft share across the room (PLAN-VAISSEAUX N2): propellant, electricity, oxygen — asked by the one
// short of it, given by the other (his own tanks his, on his screen: accepted or refused), as much as asked, no more
// than he can spare (a reserve of his own kept) nor the taker hold —; and a target or a mission plan sent. Pure: the
// session asks, gives and takes.

import { t, tf } from "../i18n";

export type ShareWhat = "prop" | "power" | "o2";
export const SHARE_WHATS: ShareWhat[] = ["prop", "power", "o2"];
export const isShareWhat = (x: unknown): x is ShareWhat => SHARE_WHATS.includes(x as ShareWhat);

/** The giver's own reserve, a share of his capacity he never gives away. */
export const SHARE_RESERVE = 0.25;

/** How much a giver gives (`need` asked, what he has, his capacity): never below his reserve, never a negative. */
export function giveAmount(have: number, capacity: number, need: number, reserve = SHARE_RESERVE): number {
  if (!(need > 0) || !(have > 0)) return 0;
  return Math.max(0, Math.min(need, have - reserve * capacity));
}

/** What a taker can hold more [the unit's] (its capacity, what it has). */
export const roomFor = (have: number, capacity: number) => Math.max(0, capacity - have);

/** An amount in its unit, said ("3.2 t of propellant", "140 kWh", "12 kg of oxygen"). */
export function amountText(what: ShareWhat, x: number): string {
  if (what === "prop") return x >= 1000 ? tf("{0} t of propellant", (x / 1000).toFixed(1)) : tf("{0} kg of propellant", Math.round(x));
  if (what === "power") return tf("{0} kWh", x >= 10 ? Math.round(x) : x.toFixed(1));
  return tf("{0} kg of oxygen", x >= 10 ? Math.round(x) : x.toFixed(1));
}

/** A share's name on a button. */
export const shareName = (what: ShareWhat) =>
  what === "prop" ? t("Ask for propellant") : what === "power" ? t("Ask for power") : t("Ask for oxygen");

/** A heard amount checked: a finite positive number no larger than the largest tank (the Endurance's), else null. */
export function amountOf(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1e9 ? x : null;
}
