// What every display reads in a frame: the pilot followed, the others, the eased values, the units shown.
import type { Units } from "../../ui/unitsys";
import type { Contact, CrewCraft, HistoryPoint } from "../model";
import type { InstrumentSnapshot, InstrumentZone } from "../../net/instruments";
import { wrapPi } from "./kit";

/** the eased figures: their latest received values approached over ~0.15 s, so 4 Hz looks continuous */
export interface Smoothed {
  pitch: number;
  bank: number;
  hdg: number;
  track: number;
  fpa: number;
  aoa: number;
  beta: number;
  spd: number;
  gs: number;
  alt: number;
  agl: number;
  vz: number;
  g: number;
  mach: number;
  /** the speed's trend [m/s per s] */
  acc: number;
}
const ANGLES = new Set<keyof Smoothed>(["pitch", "bank", "hdg", "track"]);
const KEYS: (keyof Smoothed)[] = [
  "pitch",
  "bank",
  "hdg",
  "track",
  "fpa",
  "aoa",
  "beta",
  "spd",
  "gs",
  "alt",
  "agl",
  "vz",
  "g",
  "mach",
  "acc",
];

export function targets(own: CrewCraft | null): Smoothed {
  const s = own?.snapshot,
    f = s?.flight,
    m = own?.metrics ?? {};
  const hdg = f?.hdg ?? own?.geo?.heading ?? Number.NaN;
  return {
    pitch: f?.pitch ?? Number.NaN,
    bank: f?.bank ?? Number.NaN,
    hdg,
    track: f?.track ?? hdg,
    fpa: f?.fpa ?? Number.NaN,
    aoa: f?.aoa ?? Number.NaN,
    beta: f?.beta ?? Number.NaN,
    spd: f?.tas ?? m.speed ?? Number.NaN,
    gs: f?.gs ?? m.speed ?? Number.NaN,
    alt: m.alt ?? Number.NaN,
    agl: f?.agl ?? Number.NaN,
    vz: m.vz ?? Number.NaN,
    g: f?.nz ?? m.g ?? Number.NaN,
    mach: m.mach ?? Number.NaN,
    acc: Number.NaN,
  };
}

export class Smoother {
  v: Smoothed = targets(null);
  private last = 0;
  private prevSpd: { t: number; v: number } | null = null;
  /** ease towards the targets; true while still moving */
  step(goal: Smoothed, snapT: number | undefined, now: number): boolean {
    const dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 1;
    this.last = now;
    // (the speed's trend from the snapshots' own clock)
    if (snapT !== undefined && Number.isFinite(goal.spd)) {
      const p = this.prevSpd;
      if (!p || snapT < p.t) this.prevSpd = { t: snapT, v: goal.spd };
      else if (snapT - p.t >= 1) {
        const a = (goal.spd - p.v) / (snapT - p.t);
        this.v.acc = Number.isFinite(this.v.acc) ? this.v.acc + (a - this.v.acc) * 0.5 : a;
        this.prevSpd = { t: snapT, v: goal.spd };
      }
    }
    const k = 1 - Math.exp(-dt / 0.15);
    let moving = false;
    for (const key of KEYS) {
      if (key === "acc") continue;
      const g = goal[key],
        x = this.v[key];
      if (!Number.isFinite(g)) {
        this.v[key] = Number.NaN;
        continue;
      }
      if (!Number.isFinite(x)) {
        this.v[key] = g;
        continue;
      }
      const d = ANGLES.has(key) ? wrapPi(g - x) : g - x;
      const nx = Math.abs(d) < 1e-9 ? g : x + d * k;
      this.v[key] = ANGLES.has(key) ? wrapPi(nx) : nx;
      if (Math.abs(d) > (ANGLES.has(key) ? 1e-3 : Math.max(1e-3, Math.abs(g) * 1e-4))) moving = true;
    }
    return moving;
  }
}

export interface Scene {
  own: CrewCraft | null;
  crafts: CrewCraft[];
  snap: InstrumentSnapshot | null;
  s: Smoothed;
  u: Units;
  history: HistoryPoint[];
  /** everything about (the traffic, the units, the ships) and the mission's zones */
  contacts: Contact[];
  zones: InstrumentZone[];
  /** seconds, for the animations (the sweep, the blinking) */
  now: number;
  stale: boolean;
}
