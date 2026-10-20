// The room's fleet of spacecraft (PLAN-VAISSEAUX N1): each pilot's craft told to the room once a second — which, where
// (its body, its height, how it flies), its Δv left, its failures, docked or not, its oxygen and battery —, read back
// checked; the fleet's rows (who, what, where, how far, how fast closing); the orders a pilot gives another (come to
// me, hold on me, dock to me — proposed, accepted or refused); the proximity warning. Pure: the session sends and
// hears, the panel draws.

import { t, tf } from "../i18n";

export const SPACE_VESSELS = ["ranger", "lander", "endurance"] as const;
export type SpaceVesselId = (typeof SPACE_VESSELS)[number];

/** A pilot's spacecraft as the room hears it (the "stel" event). */
export interface SpaceTel {
  vsl: SpaceVesselId;
  /** the body of its sphere of influence ("hole" on Gargantua's side, far from its worlds) */
  body: string;
  /** above it [km] */
  alt: number;
  /** how it flies: orbit, suborbital, escape, landed, flight… (game/orbit.ts Status; throat, plunge, bound, unbound) */
  st: string;
  /** its Δv left [m/s] (null: unknown) */
  dv: number | null;
  /** its failures not fixed */
  fails: number;
  docked: boolean;
  /** its oxygen left [h], its battery [0–1] (null: no systems) */
  o2h: number | null;
  bat: number | null;
  /** Gargantua's side or ours */
  side: "ours" | "gargantua" | "throat";
}

const num = (v: unknown, lo = -Infinity, hi = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const name = (v: unknown) => typeof v === "string" && /^[\w-]{1,24}$/.test(v);

/** A heard "stel" checked (null: not one). */
export function spaceTelOf(x: unknown): SpaceTel | null {
  const o = x as Partial<Record<keyof SpaceTel, unknown>> | null;
  if (!o || typeof o !== "object") return null;
  if (!SPACE_VESSELS.includes(o.vsl as SpaceVesselId) || !name(o.body) || !name(o.st)) return null;
  if (!num(o.alt, -1e3, 1e12) || !num(o.fails, 0, 99)) return null;
  if (o.dv !== null && !num(o.dv, 0, 1e9)) return null;
  if (o.o2h !== null && !num(o.o2h, 0, 1e7)) return null;
  if (o.bat !== null && !num(o.bat, 0, 1)) return null;
  if (!["ours", "gargantua", "throat"].includes(o.side as string)) return null;
  return {
    vsl: o.vsl as SpaceVesselId,
    body: o.body as string,
    alt: o.alt as number,
    st: o.st as string,
    dv: o.dv as number | null,
    fails: o.fails as number,
    docked: !!o.docked,
    o2h: o.o2h as number | null,
    bat: o.bat as number | null,
    side: o.side as SpaceTel["side"],
  };
}

const ST: Record<string, string> = {
  orbit: "in orbit",
  suborbital: "suborbital",
  escape: "escaping",
  hyperbolic: "escaping",
  landed: "landed",
  flight: "flying",
  throat: "in the wormhole",
  plunge: "plunging",
  bound: "bound to Gargantua",
  unbound: "free of Gargantua",
};
const VESSEL_NAME: Record<SpaceVesselId, string> = { ranger: "Ranger", lander: "Lander", endurance: "Endurance" };
const BODY_NAME: Record<string, string> = {
  sun: "the Sun",
  earth: "the Earth",
  moon: "the Moon",
  mars: "Mars",
  venus: "Venus",
  mercury: "Mercury",
  jupiter: "Jupiter",
  saturn: "Saturn",
  hole: "Gargantua",
  miller: "Miller",
  mann: "Mann",
  edmunds: "Edmunds",
};

/** Where a craft is and how it flies, said ("in orbit · the Moon · 52 km"). */
export function whereText(T: SpaceTel): string {
  const st = t(ST[T.st] ?? T.st);
  if (T.docked) return tf("docked · {0}", t(BODY_NAME[T.body] ?? T.body));
  const body = t(BODY_NAME[T.body] ?? T.body);
  const alt = T.alt >= 1e5 ? `${(T.alt / 1e3).toFixed(0)} 000 km` : T.alt >= 100 ? `${Math.round(T.alt)} km` : `${T.alt.toFixed(1)} km`;
  return T.st === "landed" ? `${st} · ${body}` : `${st} · ${body} · ${alt}`;
}

export interface FleetRow {
  slot: number;
  name: string;
  colour: string;
  me: boolean;
  craft: string;
  where: string;
  /** its Δv left said, its consumables, its failures */
  dv: string;
  life: string;
  fails: number;
  /** from us [m], closing [m/s] (null: not known — another universe, not seen) */
  range: number | null;
  closing: number | null;
}

/** The fleet's rows: the pilots in spacecraft, us first, then by distance. */
export function fleetRows(
  members: { slot: number; name: string; colour: string; role: string }[],
  tel: Map<number, SpaceTel>,
  me: number,
  near: Map<number, { range: number; closing: number }>,
): FleetRow[] {
  const rows: FleetRow[] = [];
  for (const m of members) {
    if (m.role !== "pilot") continue;
    const T = tel.get(m.slot);
    if (!T) continue;
    const N = near.get(m.slot);
    rows.push({
      slot: m.slot,
      name: m.name || `#${m.slot}`,
      colour: m.colour,
      me: m.slot === me,
      craft: VESSEL_NAME[T.vsl],
      where: whereText(T),
      dv: dvText(T.dv),
      life: [
        T.o2h === null ? "" : tf("O₂ {0} h", T.o2h >= 100 ? Math.round(T.o2h) : T.o2h.toFixed(1)),
        T.bat === null ? "" : tf("battery {0} %", Math.round(T.bat * 100)),
      ]
        .filter(Boolean)
        .join(" · "),
      fails: T.fails,
      range: m.slot === me ? null : (N?.range ?? null),
      closing: m.slot === me ? null : (N?.closing ?? null),
    });
  }
  return rows.sort((a, b) => (a.me ? -1 : b.me ? 1 : (a.range ?? Infinity) - (b.range ?? Infinity)));
}

/** A Δv left said: m/s, km/s past 10 km/s (the game's craft's tanks), ∞ when not counted. */
export const dvText = (dv: number | null) =>
  dv === null ? "∞" : dv >= 1e4 ? `${Math.round(dv / 1e3).toLocaleString("en")} km/s` : `${Math.round(dv)} m/s`;

/** A distance said short. */
export const rangeText = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : m < 1e6 ? `${(m / 1000).toFixed(m < 1e4 ? 2 : 0)} km` : `${Math.round(m / 1000)} km`;

// ------------------------------------------------------------------------------------ orders

/** An order to another pilot's spacecraft: come to me (my target, held near), hold on me (station keeping), dock. */
export type SpaceOrder = "come" | "hold" | "dock";
export const SPACE_ORDERS: SpaceOrder[] = ["come", "hold", "dock"];
export const isSpaceOrder = (x: unknown): x is SpaceOrder => SPACE_ORDERS.includes(x as SpaceOrder);

/** The order said to the one who gets it ("Ana asks you to dock to her"). */
export function orderAsk(o: SpaceOrder, from: string): string {
  return o === "come"
    ? tf("{0} asks you to come to their craft", from)
    : o === "hold"
      ? tf("{0} asks you to hold station on their craft", from)
      : tf("{0} asks you to dock to their craft", from);
}
/** The order's name on a button. */
export const orderName = (o: SpaceOrder) => (o === "come" ? t("Come to me") : o === "hold" ? t("Hold on me") : t("Dock to me"));

/** What the autopilot does for an order accepted, from how far the one who gave it is [m] (null: unknown). */
export function orderPlan(o: SpaceOrder, range: number | null): { auto: "keep" | "dock" | null; say: string } {
  const reach = range !== null && range <= 3000;
  if (o === "dock")
    return reach
      ? { auto: "dock", say: t("Docking autopilot on their craft") }
      : { auto: null, say: t("Too far to dock: rendezvous first (the map)") };
  if (o === "hold")
    return reach
      ? { auto: "keep", say: t("Station keeping on their craft") }
      : { auto: null, say: t("Too far to hold station: rendezvous first (the map)") };
  return reach
    ? { auto: "keep", say: t("Station keeping on their craft") }
    : { auto: null, say: t("Their craft targeted: plan the rendezvous (the map)") };
}

// ------------------------------------------------------------------------------------ proximity

/** Another craft near and closing: whether to warn, how hard (a collision course within the minute: urgent). */
export function proximity(range: number, closing: number): "none" | "caution" | "warning" {
  if (!(range > 0) || !(closing > 0)) return "none";
  const inS = range / closing;
  if (range < 200 && closing > 1) return "warning";
  if (range < 1000 && closing > 3 && inS < 60) return "warning";
  if (range < 2000 && closing > 2 && inS < 180) return "caution";
  return "none";
}
