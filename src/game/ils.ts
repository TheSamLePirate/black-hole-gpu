// An ILS approach flown by the F-35 (docs/PLAN-AVIATION-AAA.md, P4): a runway's localizer and its 3° glideslope —
// their deviations as an instrument reads them (the localizer's antenna beyond the far end, the glideslope's beside
// the touchdown zone, 300 m in) —; the approach's procedure: to the initial fix (IAF, 18.5 km out on the axis), a
// hold there if asked (the racetrack, inbound on the runway's course), the localizer intercepted (as a pilot leads
// it), the glideslope captured from below, the final at the approach speed — the gear down at the final fix (FAF,
// 9.3 km), the decision height checked (stable, else the missed approach) —, the flare, the touchdown; the
// arrival's and the departure's fixes for a flight plan. Pure: the craft's state in, what to fly out.

import { type Racetrack, holdRadius, racetrackHeading } from "./racetrack";

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const ILS = {
  /** the glideslope [°], its antenna past the threshold [m] */
  glide: 3,
  gpi: 300,
  /** the initial and final fixes on the axis [m from the threshold] */
  iaf: 18_500,
  faf: 9_300,
  /** the decision height [m over the threshold]; the flare's [m] */
  dh: 60,
  flare: 14,
  /** the craft's reference point over its wheels on the ground [m] */
  wheels: 1.4,
  /** a dot of the localizer [°] (its full scale 2.5° each side), of the glideslope [°] (0.7° full scale) */
  locDot: 1.25,
  gsDot: 0.35,
  /** stable at the decision height: within a dot each way */
  stable: 1,
  /** the localizer's antenna beyond the runway's far end [m] */
  locBeyond: 300,
};

/** A runway's landing end: its threshold, its landing heading [°], its level [m], its length [m]; its names. */
export interface IlsRunway {
  name: string;
  icao?: string;
  lat: number;
  lon: number;
  hdg: number;
  elev: number;
  len: number;
}

/** The runway's number (its heading's tens: 087° → 09). */
export const runwayId = (hdg: number) => String(Math.round((((hdg % 360) + 360) % 360) / 10) || 36).padStart(2, "0");

/** A place on the runway's frame: along its axis from the threshold [m] (> 0 down the runway), across it (> 0 to its
 *  right), over its threshold [m]. */
export function onRunway(R: IlsRunway, p: { lat: number; lon: number; alt: number }) {
  const e = (p.lon - R.lon) * D * R_EARTH * Math.cos(R.lat * D);
  const n = (p.lat - R.lat) * D * R_EARTH;
  const h = R.hdg * D;
  const along = e * Math.sin(h) + n * Math.cos(h);
  const across = e * Math.cos(h) - n * Math.sin(h);
  // (the Earth's curve: a height over the sea far out is lower over the threshold's level plane — the beams are straight)
  return { along, across, h: p.alt - R.elev - (along * along + across * across) / (2 * R_EARTH) };
}

/** A place from the runway's frame (along, across [m]). */
export function fromRunway(R: IlsRunway, along: number, across: number) {
  const h = R.hdg * D;
  const e = along * Math.sin(h) + across * Math.cos(h);
  const n = along * Math.cos(h) - across * Math.sin(h);
  return { lat: R.lat + n / (D * R_EARTH), lon: R.lon + e / (D * R_EARTH * Math.cos(R.lat * D)) };
}

/** What the instruments read: the localizer's and the glideslope's deviations [dots] (> 0: the needle right — the
 *  course to our right —, the glideslope above us — fly up), whether received, the distance to the threshold [km]. */
export function ilsReading(R: IlsRunway, p: { lat: number; lon: number; alt: number }) {
  const o = onRunway(R, p);
  const toLoc = R.len + ILS.locBeyond - o.along;
  const locDeg = Math.atan2(o.across, Math.max(toLoc, 1)) / D;
  const toGs = ILS.gpi - o.along;
  const gsDeg = Math.atan2(o.h, Math.max(toGs, 1)) / D - ILS.glide;
  return {
    ...o,
    /** the needle: the course left of us (we right of it) → the needle left (−) */
    loc: clamp(-locDeg / ILS.locDot, -2.5, 2.5),
    /** the glideslope: above us (we low) → (+) */
    gs: clamp(-gsDeg / ILS.gsDot, -2.5, 2.5),
    locIn: toLoc > 0 && toLoc < 45_000 && Math.abs(locDeg) < 35,
    gsIn: toGs > 0 && toGs < 20_000 && Math.abs(locDeg) < 10 && gsDeg > -2 && gsDeg < 5,
    dme: Math.hypot(o.along, o.across) / 1000,
  };
}

export type IlsPhase = "base" | "toIaf" | "hold" | "intercept" | "final" | "flare" | "rollout" | "missed" | "done";

export interface IlsRun {
  rwy: IlsRunway;
  phase: IlsPhase;
  t: number;
  /** a hold at the initial fix asked: its laps left (Infinity: until cleared) */
  hold: number;
  holdS?: number;
  /** the localizer and the glideslope captured */
  loc: boolean;
  gs: boolean;
  /** what was said */
  said: Set<string>;
  /** the worst deviations on the final, below the final fix [dots] */
  worst: { loc: number; gs: number };
  missed: number;
  /** a circuit's base: the turn onto the final begun */
  baseIn?: boolean;
  /** the gap across's integral on the final [m s] */
  xInt?: number;
  /** the last vertical speed in the air [m/s] */
  vs?: number;
  /** the touchdown: where along, across, its sink [m/s] */
  touch?: { along: number; across: number; vs: number };
}

export const newIlsRun = (rwy: IlsRunway, hold = 0, base = false): IlsRun => ({
  rwy,
  phase: base ? "base" : "toIaf",
  t: 0,
  hold,
  loc: false,
  gs: false,
  said: new Set(),
  worst: { loc: 0, gs: 0 },
  missed: 0,
});

export interface IlsOut {
  gamma: number;
  bank: number;
  spd: number;
  /** the gear out, the flaps (0…1) */
  gear: boolean;
  flaps: number;
  /** the throttle cut (the flare's end) */
  idle?: boolean;
  call?: string;
}

/** The height of the glideslope at a place along the axis [m over the threshold]. */
const gsHeight = (along: number) => (ILS.gpi - along) * Math.tan(ILS.glide * D);

/**
 * A frame of the approach: our place [lat, lon, alt over the sea], track [rad], ground speed and vertical speed [m/s],
 * on the wheels; the approach speed [m/s]. Its phase moved on; what to fly (null: done).
 */
export function ilsStep(
  R: IlsRun,
  own: { lat: number; lon: number; alt: number; trk: number; gs: number; vs: number; onGround: boolean },
  vApp: number,
  dt: number,
): IlsOut | null {
  R.t += dt;
  const W = R.rwy;
  const r = ilsReading(W, own);
  if (!own.onGround) R.vs = own.vs;
  const crs = W.hdg * D;
  const say = (k: string) => {
    if (R.said.has(k)) return undefined;
    R.said.add(k);
    return k;
  };
  // (our speed across the axis [m/s], > 0 to its right)
  const xRate = own.gs * Math.sin(own.trk - crs);
  const steer = (want: number, max = 30 * D) => clamp(1.6 * wrap(want - own.trk), -max, max);
  const gearAt = r.along > -ILS.faf - 1500;
  if (R.phase === "done") return null;
  if (own.onGround && (R.phase === "final" || R.phase === "flare")) {
    R.phase = "rollout";
    R.touch = { along: r.along, across: r.across, vs: R.vs ?? own.vs };
    return { gamma: 0, bank: 0, spd: 0, gear: true, flaps: 1, idle: true, call: "Touchdown" };
  }
  if (R.phase === "rollout") {
    if (own.gs < 3) R.phase = "done";
    return { gamma: 0, bank: 0, spd: 0, gear: true, flaps: 1, idle: true };
  }
  if (R.phase === "missed") {
    // (climb straight ahead to 600 m over the field, then round again: the initial fix)
    if (r.h > 600) {
      R.phase = "toIaf";
      R.loc = R.gs = false;
      R.said.delete("Localizer captured");
      R.said.delete("Glideslope captured");
      R.said.delete("Gear down");
      R.said.delete("Minimums");
    }
    return { gamma: 10 * D, bank: steer(crs), spd: vApp + 40, gear: false, flaps: 0.5 };
  }
  // a visual circuit's base (`base`, from the downwind abeam the field): the base leg square to the runway, towards its
  // axis (45° of bank, a fighter's circuit); the turn onto the final begun where its radius (40° at our speed) rolls it out on the centreline —
  // the gap left as wide as that turn's own (R (1 − cos Δψ)) —, then the intercept's law, latched; down to the path
  // (300 m over the field at most), the gear and half flaps out, the final's speed and a little; lined up: the
  // final; over the threshold still not: round again
  if (R.phase === "base") {
    const side = Math.sign(r.across) || 1;
    const dpsi = wrap(own.trk - crs);
    const rad = (own.gs * own.gs) / (9.80665 * Math.tan(40 * D));
    if (!R.baseIn && Math.abs(dpsi) < 110 * D && Math.abs(r.across) <= rad * (1 - Math.cos(dpsi)) + 40 && side * xRate < 0) R.baseIn = true;
    const want = R.baseIn ? crs + clamp(-0.006 * (r.across + 10 * xRate), -40 * D, 40 * D) : crs - (side * Math.PI) / 2;
    if (Math.abs(r.across) < 100 && Math.abs(xRate) < 6 && Math.cos(dpsi) > 0.97 && r.along < -800) {
      R.loc = R.gs = true;
      R.phase = "final";
    } else if (r.along > -500 && Math.cos(dpsi) > 0) {
      R.phase = "missed";
      R.missed++;
      return { gamma: 10 * D, bank: 0, spd: vApp + 40, gear: false, flaps: 0.5, call: "Go around" };
    } else {
      // (the path's own descent as we close the field, and the gap closed in some 5 s)
      const hT = clamp(gsHeight(r.along), 60, 300);
      const vz = -Math.max(own.gs * Math.cos(dpsi), 0) * Math.tan(ILS.glide * D) - 0.2 * (r.h - hT);
      const gamma = clamp(Math.atan2(vz, Math.max(own.gs, 1)), -8 * D, 3 * D);
      return { gamma, bank: steer(want, 45 * D), spd: vApp + 8, gear: true, flaps: 0.5 };
    }
  }
  // the initial fix, its hold
  const iafH = Math.max(gsHeight(-ILS.iaf), 600);
  if (R.phase === "toIaf" || R.phase === "hold") {
    // (on the localizer's beam already, far enough, heading roughly down the course: intercepted from here)
    const headingIn = Math.cos(wrap(own.trk - crs)) > 0.3;
    // (or established already inside it: on the localizer, heading down the course, near the glideslope — carried on)
    const established =
      r.along < -1500 && Math.abs(r.across) < 300 && Math.cos(wrap(own.trk - crs)) > 0.96 && r.gsIn && Math.abs(r.gs) < 1.5;
    if (
      R.phase === "toIaf" &&
      R.hold <= 0 &&
      ((r.locIn && r.along < -ILS.faf - 2500 && Math.abs(r.across) < 6000 && headingIn) || established)
    )
      R.phase = "intercept";
    else {
      const fix = fromRunway(W, -ILS.iaf, 0);
      const e = (fix.lon - own.lon) * D * R_EARTH * Math.cos(own.lat * D);
      const n = (fix.lat - own.lat) * D * R_EARTH;
      const d = Math.hypot(e, n);
      const hT = iafH + W.elev;
      const gamma = clamp(Math.atan2(hT - own.alt, Math.max(d, 3000)), -6 * D, 8 * D);
      if (R.phase === "toIaf") {
        if (d < 2500) {
          if (R.hold > 0) {
            R.phase = "hold";
            R.holdS = 0;
            return { gamma, bank: steer(crs), spd: 120, gear: false, flaps: 0, call: say("Holding") };
          }
          R.phase = "intercept";
        } else return { gamma, bank: steer(Math.atan2(e, n)), spd: d > 10_000 ? 160 : 130, gear: false, flaps: 0 };
      }
      if (R.phase === "hold") {
        // (the racetrack: inbound to the fix on the runway's course, right turns; a lap counted at the fix)
        const T: Racetrack = { inbound: crs, leg: 6000, radius: holdRadius(Math.max(own.gs, 100)) };
        const p: [number, number] = [-e, -n];
        const h = racetrackHeading(T, p, 1500);
        const was = R.holdS ?? 0;
        R.holdS = was + dt;
        // (a lap: back over the fix inbound, after a minute at least)
        if (d < 1200 && Math.cos(wrap(own.trk - crs)) > 0.8 && was > 60) {
          R.hold--;
          R.holdS = 0;
        }
        if (R.hold <= 0) R.phase = "intercept";
        else return { gamma, bank: steer(h.hdg), spd: 120, gear: false, flaps: 0 };
      }
    }
  }
  // the intercept: onto the localizer at an angle as the gap asks (45° at most), the gap foreseen 8 s on; the height
  // held at the initial fix's — the glideslope captured from below
  if (R.phase === "intercept") {
    const want = crs + clamp(-0.0015 * (r.across + 8 * xRate), -45 * D, 45 * D);
    if (!R.loc && r.locIn && Math.abs(r.across) < 150 && Math.abs(xRate) < 8) R.loc = true;
    const call = R.loc ? say("Localizer captured") : undefined;
    // (the level held to the glideslope's capture; on the localizer above it — a straight-in begun high —, the path
    // joined from above: aimed 40 m under it, 5° down at most, captured as it is crossed)
    // (above the path by the geometry itself — the glideslope's signal maybe not in reach yet, 16 km out)
    const above = R.loc && r.along < 0 && r.h > gsHeight(r.along) + 30;
    // (else, inside the initial fix: just under the path where we are — met from below, as an approach is flown —;
    // farther: the initial fix's height — never the height the approach began at, 1 300 m kept down the final)
    const hHold = above
      ? Math.max(gsHeight(r.along) - 40, 120)
      : r.along > -ILS.iaf
        ? Math.max(Math.min(gsHeight(r.along) - 30, iafH), 150)
        : iafH;
    // (the glideslope captured from below — or, established inside the final fix already, within a dot of it either
    // way: placed on a short final a little low, it went round at once)
    if (
      R.loc &&
      r.gsIn &&
      (r.gs <= 0.05 || (r.along > -ILS.faf - 2000 && Math.abs(r.gs) < 1.2) || (r.h - gsHeight(r.along) < 15 && r.gs < 0.4))
    ) {
      R.gs = true;
      R.phase = "final";
    }
    // (past the final fix without the glideslope: the missed approach)
    if (!R.gs && r.along > -ILS.faf + 1500) {
      R.phase = "missed";
      R.missed++;
      return { gamma: 10 * D, bank: 0, spd: vApp + 40, gear: false, flaps: 0.5, call: "Go around" };
    }
    const gamma = clamp(Math.atan2(hHold + W.elev - own.alt, 2500), -5 * D, 5 * D);
    return { gamma, bank: steer(want), spd: vApp + 25, gear: gearAt, flaps: gearAt ? 0.5 : 0, call };
  }
  // the final: two loops across (the speed across asked by the gap, the bank closing it), down the glideslope
  // (and the gap's integral, a crosswind's drift taken out)
  // (the integral only once near the axis: the capture's transient not wound into it — a drift pushed past it)
  if ((R.phase === "final" || R.phase === "flare") && Math.abs(r.across) < 20) R.xInt = clamp((R.xInt ?? 0) + r.across * dt, -400, 400);
  const xWant = clamp(-0.12 * r.across - 0.01 * (R.xInt ?? 0), -12, 12);
  const aLat = 0.4 * (xWant - xRate);
  const bank = clamp(Math.atan2(aLat, 9.80665), -20 * D, 20 * D);
  if (R.phase === "final") {
    let call = say("Glideslope captured");
    if (!call && gearAt) call = say("Gear down");
    if (r.along > -ILS.faf) {
      R.worst.loc = Math.max(R.worst.loc, Math.abs(r.loc));
      R.worst.gs = Math.max(R.worst.gs, Math.abs(r.gs));
    }
    // (over the threshold still above the decision height: never down to it — the missed approach)
    if (r.along > 0 && r.h > ILS.dh) {
      R.phase = "missed";
      R.missed++;
      return { gamma: 10 * D, bank: 0, spd: vApp + 40, gear: false, flaps: 0.5, call: "Go around" };
    }
    // (the decision height: stable — within a dot —, else the missed approach)
    if (r.h < ILS.dh + 5 && !R.said.has("Minimums")) {
      R.said.add("Minimums");
      if (Math.abs(r.loc) > ILS.stable || Math.abs(r.gs) > ILS.stable) {
        R.phase = "missed";
        R.missed++;
        return { gamma: 10 * D, bank: 0, spd: vApp + 40, gear: false, flaps: 0.5, call: "Go around" };
      }
      call = "Minimums";
    }
    if (r.h < ILS.flare) {
      R.phase = "flare";
      call = say("Flare");
    }
    // (down the path, its height's error closed over some 6 s)
    const hErr = r.h - gsHeight(r.along);
    const vz = -own.gs * Math.tan(ILS.glide * D) - 0.15 * hErr;
    return { gamma: clamp(Math.atan2(vz, Math.max(own.gs, 1)), -6 * D, 2 * D), bank, spd: vApp, gear: true, flaps: 1, call };
  }
  // the flare: the sink eased to some 1.2 m/s (a fighter's firm touchdown, no float), the throttle back
  // (its height at the wheels, foreseen 1.5 s on — the jet answers its flight path's command in about that)
  const hw = Math.max(r.h - ILS.wheels + 1.5 * Math.min(own.vs, 0), 0);
  const vz = -Math.max(0.6, 0.3 * hw);
  return { gamma: Math.atan2(vz, Math.max(own.gs, 1)), bank: bank * 0.5, spd: vApp - 10, gear: true, flaps: 1, idle: true };
}

/** The arrival's fixes before a runway (the initial and final fixes on its axis, their heights on the glideslope) and
 *  the departure's after it (6 km down the runway's heading, 900 m over it) — for a flight plan. */
export function arrivalFixes(R: IlsRunway): { name: string; lat: number; lon: number; alt: number }[] {
  const id = runwayId(R.hdg);
  return [
    { name: `IAF${id}`, ...fromRunway(R, -ILS.iaf, 0), alt: R.elev + Math.max(gsHeight(-ILS.iaf), 600) },
    { name: `FAF${id}`, ...fromRunway(R, -ILS.faf, 0), alt: R.elev + gsHeight(-ILS.faf) },
  ];
}
export function departureFix(R: IlsRunway): { name: string; lat: number; lon: number; alt: number } {
  return { name: `DEP${runwayId(R.hdg)}`, ...fromRunway(R, R.len + 6000, 0), alt: R.elev + 900 };
}

/** A pass graded as an instructor would: the worst deviations below the final fix, the touchdown (in the zone —
 *  150 to 900 m in —, on the centreline, gently). Out of 20. */
export function ilsGrade(R: IlsRun): { score: number; notes: string[] } {
  const notes: string[] = [];
  let s = 20;
  s -= Math.max(0, R.worst.loc - 0.3) * 4;
  s -= Math.max(0, R.worst.gs - 0.3) * 4;
  if (R.worst.loc > 1) notes.push("localizer");
  if (R.worst.gs > 1) notes.push("glideslope");
  const T = R.touch;
  if (T) {
    if (T.along < 150 || T.along > 900) (s -= 3), notes.push("touchdown zone");
    if (Math.abs(T.across) > 6) (s -= 3), notes.push("centreline");
    if (T.vs < -2.5) (s -= 3), notes.push("firm");
  }
  s -= R.missed * 4;
  return { score: Math.max(0, Math.round(s * 10) / 10), notes };
}
