// The flight's alerts, ranked as a cockpit ranks them: WARNING (red, the master warning sounds until
// acknowledged — a limit reached, a collision), CAUTION (amber — a limit near), ADVISORY (white —
// a state worth knowing). Pure: what is on, from the frame's figures; the HUD shows three at most
// (ui/flighthud.ts, the master caution), the tests read them as they are.

import type { FlightInfo } from "../../controller/telemetry";
import { BODY_NAMES } from "../../targeting";

export type AlertLevel = "warning" | "caution" | "advisory";

export interface Alert {
  /** stable while the condition holds (an acknowledgement is kept by it) */
  id: string;
  level: AlertLevel;
  text: string;
}

/** What the alerts read: the frame's figures (a subset of FlightInfo, and the orbit's status). */
export type AlertInput = Pick<
  FlightInfo,
  "path" | "landed" | "surface" | "air" | "ergo" | "region" | "r" | "photon" | "isco" | "auto" | "target" | "engine"
> & {
  status?: { soi: string; status: string } | null;
  landedOn?: FlightInfo["landedOn"];
  /** the time running */
  animate: boolean;
  /** a coordinate time [M] in words (the horizon's countdown) */
  fmtM: (t: number) => string;
};

const RANK: Record<AlertLevel, number> = { warning: 0, caution: 1, advisory: 2 };

export function alertsOf(i: AlertInput): Alert[] {
  const out: Alert[] = [];
  const add = (id: string, level: AlertLevel, text: string) => out.push({ id, level, text });
  const nm = (b: string) => (b === "star" ? "THE STAR" : ((BODY_NAMES as Record<string, string>)[b] ?? b).toUpperCase());
  const p = i.path;
  if (p?.fate === "horizon") add("horizon", "warning", `COLLISION COURSE — HORIZON IN ${i.fmtM(p.pts.length * p.dt).toUpperCase()}`);
  const hit = p?.hit ?? "star";
  const onGround = i.landed || i.surface?.landed;
  // (in a planet's frame the Kerr path ignores the planet's own pull: its status knows better)
  const orbiting =
    i.status?.soi === hit && (i.status.status === "orbit" || i.status.status === "escape" || i.status.status === "hyperbolic");
  // (not while an autopilot flies about that body: it keeps the ship off it)
  const flownAbout = (i.auto === "approach" || i.auto === "orbit" || i.auto === "land" || i.auto === "takeoff") && i.target === hit;
  if (p?.fate === "star" && !onGround && !orbiting && !flownAbout) add("collision", "warning", `COLLISION COURSE — ${nm(hit)}`);
  // the air's limits: the shield, the hull, the load
  const air = i.air;
  if (air && (air.inAir || air.margins.shield > 0.6 || air.margins.hull > 0.6)) {
    const pc = (x: number) => `${Math.round(x * 100)} %`;
    if (air.failure) add("failure", "warning", air.failure.toUpperCase());
    if (air.margins.shield > 0.85)
      add(
        "shield",
        air.margins.shield > 0.95 ? "warning" : "caution",
        `HEAT SHIELD ${Math.round(air.shield)} K · ${pc(air.margins.shield)}`,
      );
    if (air.margins.hull > 0.8)
      add("hull", air.margins.hull > 0.95 ? "warning" : "caution", `HULL ${Math.round(air.hull)} K · ${pc(air.margins.hull)}`);
    if (air.margins.g > 0.75)
      add("load", air.margins.g > 0.92 ? "warning" : "caution", `LOAD ${air.g.toFixed(1)} g · ${pc(air.margins.g)}`);
    if (air.stalled && air.mach < 3) add("stall", "warning", "STALL");
    if (air.heat > 5e4) add("plasma", "advisory", `PLASMA · ${(air.heat / 1e4).toFixed(0)} W/cm² · MACH ${air.mach.toFixed(1)}`);
  }
  // the tank
  const fuel = i.engine.fuel;
  if (fuel?.empty) add("fuel-empty", "warning", "PROPELLANT EXHAUSTED");
  else if (fuel && fuel.fraction < 0.1) add("fuel-low", "caution", `PROPELLANT LOW · ${Math.round(fuel.fraction * 100)} %`);
  // the hole
  if (i.ergo) add("ergo", "advisory", "ERGOSPHERE · NO STATIC OBSERVER · FRAME DRAGGING");
  else if (i.region === "hole" && i.r < i.photon) add("photon", "caution", "INSIDE THE PHOTON ORBIT");
  else if (i.region === "hole" && i.r < i.isco) add("isco", "caution", "BELOW THE ISCO · NO STABLE ORBIT");
  // the ground, the time
  if (i.surface?.rolling) add("wheels", "advisory", `ON THE WHEELS · ${nm(i.surface.body)} · ${Math.round(i.surface.vHor)} M/S`);
  else if (i.surface?.landed) add("landed", "advisory", `LANDED ON ${nm(i.surface.body)}`);
  else if (i.landed && !i.surface) add("landed", "advisory", `LANDED ON ${nm(i.landedOn ?? "star")}`);
  if (!i.animate) add("paused", "advisory", "TIME PAUSED · SPACE TO FLY");
  // (the gravest first, in the order found)
  return out
    .map((a, k) => ({ a, k }))
    .sort((x, y) => RANK[x.a.level] - RANK[y.a.level] || x.k - y.k)
    .map((x) => x.a);
}

/**
 * The master caution's memory: the warnings and cautions seen, which were acknowledged. A new one
 * (or one back after it cleared) is unacknowledged again.
 */
export class MasterCaution {
  private acked = new Set<string>();
  private seen = new Set<string>();

  /** The frame's alerts: returns what the lamp shows and whether the master warning sounds. */
  update(alerts: Alert[]): { lamp: "warning" | "caution" | null; sound: boolean; unacked: Set<string> } {
    const now = new Set(alerts.filter((a) => a.level !== "advisory").map((a) => a.id));
    // (cleared: forgotten, so its return calls again)
    for (const id of this.acked) if (!now.has(id)) this.acked.delete(id);
    this.seen = now;
    const unacked = new Set([...now].filter((id) => !this.acked.has(id)));
    const lvl = (id: string) => alerts.find((a) => a.id === id)?.level;
    const lamp = [...unacked].some((id) => lvl(id) === "warning") ? "warning" : unacked.size ? "caution" : null;
    return { lamp, sound: lamp === "warning", unacked };
  }

  /** Acknowledged: the lamp out, the sound off, the lines steady (while the conditions hold). */
  acknowledge() {
    for (const id of this.seen) this.acked.add(id);
  }
}
