// The leader's orders (docs/PLAN-AVIATION-AAA.md, F2): what he tells his flight — by the wheel, by voice (TARS),
// by the HOTAS — and each its radio call. A wingman in formation carries it out (a human's formation autopilot,
// an AI's own — F3); out of formation it is heard and shown. Pure: the order and its words.

import type { FormationId, Spacing } from "./formations";

export type OrderId = "rejoin" | "shape" | "tighten" | "loosen" | "attack" | "engage" | "cover" | "hold" | "rtb" | "breakL" | "breakR";

export const ORDER_IDS: OrderId[] = [
  "rejoin",
  "shape",
  "tighten",
  "loosen",
  "attack",
  "engage",
  "cover",
  "hold",
  "rtb",
  "breakL",
  "breakR",
];

/** An order as sent: its kind and what it needs — the formation, the spacing, the leader's lock, the hold's fix and
 *  its inbound course. */
export interface Order {
  id: OrderId;
  shape?: FormationId;
  spacing?: Spacing;
  /** the leader's radar lock (a track's id) */
  target?: string;
  /** the hold's fix [°] and its inbound course [rad, clockwise from north] */
  fix?: { lat: number; lon: number };
  inbound?: number;
}

/** Each order's name on the wheel, and its radio call ({0}: the formation's name). */
export const ORDERS: Record<OrderId, { fr: string; en: string; call: { fr: string; en: string } }> = {
  rejoin: { fr: "Rejoindre", en: "Rejoin", call: { fr: "Patrouille, rejoignez", en: "Flight, rejoin" } },
  shape: { fr: "Formation", en: "Formation", call: { fr: "Patrouille, en {0}", en: "Flight, go {0}" } },
  tighten: { fr: "Serrer", en: "Tighten", call: { fr: "Serrez", en: "Tighten up" } },
  loosen: { fr: "S'écarter", en: "Loosen", call: { fr: "Écartez", en: "Spread out" } },
  attack: { fr: "Attaquer ma cible", en: "Attack my target", call: { fr: "Attaquez ma cible", en: "Attack my target" } },
  engage: { fr: "Engager les hostiles", en: "Engage hostiles", call: { fr: "Engagez les hostiles", en: "Engage bandits" } },
  cover: { fr: "Me couvrir", en: "Cover me", call: { fr: "Couvrez-moi", en: "Cover me" } },
  hold: { fr: "Tenir ici", en: "Hold here", call: { fr: "Patrouille, attente ici", en: "Flight, hold here" } },
  rtb: { fr: "Rentrer à la base", en: "Return to base", call: { fr: "Patrouille, retour base", en: "Flight, RTB" } },
  breakL: { fr: "Dégagement à gauche", en: "Break left", call: { fr: "Dégagez à gauche !", en: "Break left!" } },
  breakR: { fr: "Dégagement à droite", en: "Break right", call: { fr: "Dégagez à droite !", en: "Break right!" } },
};

/** Whether a wingman in formation carries it out by flying (the others: heard, his own to carry out). */
export const FLOWN: Record<OrderId, boolean> = {
  rejoin: true,
  shape: true,
  tighten: true,
  loosen: true,
  attack: false,
  engage: false,
  cover: false,
  hold: true,
  rtb: true,
  breakL: true,
  breakR: true,
};

/** An order read off the network (a stranger's fields checked); null: not one. */
export function orderOf(v: unknown): Order | null {
  const o = v as Partial<Order> | null;
  if (!o || typeof o !== "object" || !ORDER_IDS.includes(o.id as OrderId)) return null;
  const out: Order = { id: o.id as OrderId };
  if (typeof o.shape === "string") out.shape = o.shape as FormationId;
  if (o.spacing === "tight" || o.spacing === "normal" || o.spacing === "wide") out.spacing = o.spacing;
  if (typeof o.target === "string") out.target = o.target.slice(0, 40);
  if (o.fix && Number.isFinite(o.fix.lat) && Number.isFinite(o.fix.lon)) out.fix = { lat: o.fix.lat, lon: o.fix.lon };
  if (Number.isFinite(o.inbound)) out.inbound = o.inbound;
  return out;
}

/** A break's turn: 90° off the heading now, to its side [rad]. */
export const breakHeading = (hdg: number, id: "breakL" | "breakR") => hdg + (id === "breakL" ? -1 : 1) * (Math.PI / 2);

/** a break's bank [rad] (a hard turn, the afterburner lit) */
export const BREAK_BANK = (75 * Math.PI) / 180;
