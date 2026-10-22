// What the A320's displays show (docs/PLAN-A320.md, A7): the flight's figures gathered once a refresh — the attitude,
// the air data, the speeds the FMGC would give (VLS, VFE, VMAX, α prot / α max, green dot, S, F — from the A320's
// own stall speeds: src/a320/aero.ts's calibration), the engines (FADEC), the configuration, the fuel, the ILS, the
// place, the deck's EFIS and ECAM selections. The units Airbus's: knots, feet, feet a minute, degrees, kilograms,
// nautical miles (the PFD's metric altitude with its button or the metric units). The displays (pfd.ts, nd.ts, ewd.ts,
// sd.ts, isis.ts) read nothing else.

import type { CameraController } from "../../controls";
import { fleet } from "../../fleet";
import type { Settings } from "../../settings";
import { cameraFrame } from "../../camera";
import { toBodyFixed } from "../../system/our-surface";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../../system/ellipsoid";
import { M_METRES } from "../../units";
import { alphaLimits } from "../fbw";
import { CONF, confOf } from "../pose";
import type { Props } from "../rig";
import { type NdExtra, ndExtra } from "./nd-data";

type V3 = [number, number, number];
const KT = 1.943844;
const FT = 3.28084;
const D = 180 / Math.PI;

export interface DuEngine {
  running: boolean;
  n1: number;
  n2: number;
  egt: number;
  /** fuel flow [kg/h] */
  ff: number;
  /** the reverser's doors 0…1 */
  rev: number;
}

export interface DuData {
  time: Date;
  /** the deck powered (the displays lit) */
  powered: boolean;
  units: Settings["units"];
  // ---- attitude [deg]: pitch up, roll right +, the heading and track true, the sideslip, the flight path, α
  pitch: number;
  roll: number;
  heading: number;
  track: number;
  slip: number;
  fpa: number;
  aoa: number;
  /** the load factor [g] */
  nz: number;
  // ---- air data
  ias: number;
  /** the speed's trend: where it will be in 10 s [kt more] */
  iasTrend: number;
  mach: number;
  tas: number;
  gs: number;
  /** the altitude [ft] (geometric over the ellipsoid, the QNH set), the vertical speed [ft/min], the radio altitude
   *  [ft] (null above 2500 ft) */
  alt: number;
  vs: number;
  ra: number | null;
  /** the baro reference: STD or QNH [hPa] */
  baro: { std: boolean; hpa: number };
  sat: number;
  tat: number;
  wind: { dir: number; kt: number } | null;
  // ---- the speeds [kt]
  vls: number;
  vmax: number;
  /** the next configuration's VFE (null: none) */
  vfeNext: number | null;
  vaprot: number;
  vamax: number;
  greenDot: number;
  s: number;
  f: number;
  // ---- the laws, the protections
  law: "normal" | "alternate" | "direct";
  alphaProt: boolean;
  alphaFloor: boolean;
  // ---- autoflight (A8: the FCU and the FMGC; until then what the game flies)
  fma: {
    thrust: string;
    vert: string;
    lat: string;
    vertArmed: string;
    latArmed: string;
    ap: string;
    fd: string;
    athr: string;
    /** the A/THR's: armed (blue), active (white) */
    athrState?: "" | "armed" | "active";
    /** the modes engaged in the last 10 s: boxed */
    boxed?: { thrust: boolean; vert: boolean; lat: boolean; ap: boolean; athr: boolean };
  };
  /** the flight directors' bars: the pitch [deg] and the roll [deg, right +] they ask more (null: off) */
  fdBars: { pitch: number; roll: number } | null;
  /** the speed target managed (magenta) or selected (blue) */
  targetManaged: boolean;
  targetSpeed: number | null;
  targetAlt: number | null;
  // ---- the ILS: the deviations [dots], its name, the DME [NM]
  ils: { id: string; loc: number | null; gs: number | null; dme: number } | null;
  // ---- the engines
  eng: [DuEngine, DuEngine];
  /** the thrust limit's mode and N1 [%], the FLEX temperature [°C] */
  thrLimit: { mode: string; n1: number };
  /** TOGA's N1 now [%] (the E/WD's amber mark) */
  togaN1: number;
  flexTemp: number | null;
  /** the levers' N1 [%] (the thrust lever's position on the N1's scale) */
  leverN1: number;
  // ---- the configuration
  flapLever: number;
  confName: string;
  slat: number;
  flap: number;
  speedBrake: number;
  spoilers: number[];
  gear: { down: boolean; ext: number };
  autobrake: number;
  parkBrake: boolean;
  /** the control surfaces [deg]: ailerons (left, right; down +), elevators, rudder, the stabiliser */
  surfaces: { ailL: number; ailR: number; elevL: number; elevR: number; rudder: number; stab: number };
  // ---- the fuel [kg], the weights [kg]
  tanks: number[];
  fob: number;
  fuelUsed: number;
  gw: number;
  // ---- the place
  lat: number;
  lon: number;
  onGround: boolean;
  // ---- the deck's selections (its properties: the EFIS, the ECAM's control panel, the metric altitude)
  deck: Props;
  /** the NDs' own (nd-data.ts: the route, the airfields, the navaids, the traffic) */
  nd: NdExtra | null;
}

/** The speeds' tables (Airbus's: VFE by configuration [kt]; VMO 350 kt, MMO 0.82). */
const VFE = [350, 230, 215, 200, 185, 177];
const VMO = 350;
const MMO = 0.82;

/** VS1G [kt] for a mass [kg] and a configuration index (CONF: 0, 1, 1+F, 2, 3, FULL) — FlightGear's FMGC tables at
 *  60 t, by √(m / 60 t). */
const VS1G_60 = [150.81, 124.84, 117.97, 110.94, 109.1, 106.01];
export const vs1g = (mass: number, conf: number) => VS1G_60[Math.min(Math.max(conf, 0), 5)]! * Math.sqrt(mass / 60000);

/** The displays' data now; null away from the Earth. */
export function duData(c: CameraController, s: Settings, deck: Props, date: Date): DuData | null {
  const cam = cameraFrame(s);
  const nav = c.ourNav(cam);
  const fr = c.sfFrame(cam);
  if (!nav || nav.ref !== "earth" || !fr) return null;
  const q = toBodyFixed("earth", nav.X, nav.t);
  const geo = cartToGeodetic(WGS84_A, WGS84_F, [q[0] * M_METRES, q[1] * M_METRES, q[2] * M_METRES]);
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const v = fr.vRel as V3;
  const vz = dot(v, fr.up as V3);
  const ve = dot(v, fr.east as V3),
    vn = dot(v, fr.north as V3);
  const gsMs = Math.hypot(ve, vn);
  const att = c.attitudeNow() as { pitch?: number; bank?: number; heading?: number };
  const L = c.airFlight.last;
  const F = c.a320;
  // (the flight guidance — controller/a320ap.ts —: its modes, its targets, its directors' orders)
  const G = c.a320Fmgc,
    GI = c.a320FmgcIn,
    fo = c.a320FmgcOut;
  const mass = fleet.massProps().mass;
  const q0 = L?.out.q ?? 0;
  const ias = Math.sqrt((2 * q0) / 1.225) * KT;
  const mach = L ? L.speed / Math.max(L.air.a, 1) : 0;
  const onGround = !!c.rolling || !!c.ourLanded;
  const lever = Math.round((c.airFlight.cfg.flaps ?? 0) * 4);
  const ci = confOf(lever, ias, onGround);
  const conf = CONF[ci]!;
  // (the speed's trend: its rate, smoothed — 10 s ahead)
  const now = performance.now() / 1000;
  const T = (trend.t ? Math.min(now - trend.t, 0.5) : 0) || 0;
  if (T > 0) trend.rate += ((ias - trend.ias) / T - trend.rate) * Math.min(T / 1.5, 1);
  trend.ias = ias;
  trend.t = now;
  const vs1 = vs1g(mass, ci);
  // (α prot and α max as speeds: the 1 g speed at those incidences — VS1G at α max, scaled by the lift's slope)
  const lim = alphaLimits(mach, conf.slats, conf.flaps);
  const vamax = vs1 * 1.0;
  const vaprot = vs1 * Math.sqrt(lim.max / Math.max(lim.prot, 1));
  const tat = (L?.air.T ?? 288.15) - 273.15;
  const sat = tat / (1 + 0.2 * mach * mach);
  const e = F?.engines;
  const eng = (k: 0 | 1): DuEngine => ({
    running: e ? e[k].running : true,
    n1: e ? e[k].n1 : 0,
    n2: e ? e[k].n2 : 0,
    egt: e ? e[k].egt : 15,
    ff: e ? e[k].ff * 3600 : 0,
    rev: e ? e[k].rev : 0,
  });
  const lm = F?.limits;
  const toga = lm?.toga ?? 0;
  const thrLimit = !lm
    ? { mode: "", n1: 0 }
    : onGround || ias < 80
      ? F?.flexTemp !== null && F?.flexTemp !== undefined
        ? { mode: "FLX", n1: lm.flex }
        : { mode: "TOGA", n1: toga }
      : c.pilot.throttle > 0.9
        ? { mode: "TOGA", n1: toga }
        : c.pilot.throttle > 0.7
          ? { mode: "MCT", n1: lm.mct }
          : { mode: "CLB", n1: lm.clb };
  const S = F?.surfaces;
  const ils = c.ilsInfo();
  const wind = c.windNow;
  const ra = fr.h * FT;
  const fob = F?.fuel ?? fleet.fuel.a320 ?? 0;
  used.start ??= fob;
  if (fob > used.start) used.start = fob;
  return {
    time: date,
    powered: true,
    units: s.units,
    pitch: (att.pitch ?? 0) * D,
    // (the controller's bank positive to the right — computer.ts: the craft's left axis over the up —: the PFD's roll)
    roll: (att.bank ?? 0) * D,
    heading: ((((att.heading ?? 0) * D) % 360) + 360) % 360,
    track: gsMs > 1 ? (((Math.atan2(ve, vn) * D) % 360) + 360) % 360 : ((((att.heading ?? 0) * D) % 360) + 360) % 360,
    slip: (L?.out.beta ?? 0) * D,
    fpa: gsMs > 1 ? Math.atan2(vz, gsMs) * D : 0,
    aoa: (L?.out.alpha ?? 0) * D,
    nz: c.airFlight.g,
    ias,
    iasTrend: trend.rate * 10,
    mach,
    tas: (L?.speed ?? 0) * KT,
    gs: gsMs * KT,
    alt: geo.h * FT,
    vs: vz * FT * 60,
    ra: ra < 2500 ? Math.max(ra - 6, 0) : null,
    baro: {
      std: Number(deck["instrumentation/altimeter/std"] ?? 0) > 0.5,
      hpa: Number(deck["instrumentation/altimeter/setting-hpa"] ?? 1013),
    },
    sat,
    tat,
    wind: wind ? { dir: wind.from, kt: wind.speed * KT } : null,
    vls: vs1 * (ci === 0 ? 1.28 : 1.23),
    // (VMO / MMO clean — the Mach limit as a speed once there is one to scale —, VFE out)
    vmax: ci === 0 ? (mach > 0.3 ? Math.min(VMO, (MMO / mach) * ias) : VMO) : VFE[ci]!,
    vfeNext: ci < 5 ? VFE[ci + 1]! : null,
    vaprot,
    vamax,
    greenDot: 2 * (mass / 1000) + 85,
    s: vs1g(mass, 1) * 1.23 * 1.0,
    f: vs1g(mass, 3) * 1.26,
    law: F?.law ?? "normal",
    alphaProt: !!c.pilot.airbusOut?.alphaProt,
    alphaFloor: !!F?.alphaFloor,
    fma: G
      ? G.fma()
      : {
          thrust: F?.alphaFloor ? "A.FLOOR" : onGround && c.pilot.throttle > 0.9 ? "MAN TOGA" : "",
          vert: "",
          lat: "",
          vertArmed: "",
          latArmed: "",
          ap: "",
          fd: "",
          athr: "",
        },
    fdBars: fo?.fd ? { pitch: fo.fd.pitch, roll: fo.fd.bank - (att.bank ?? 0) * D } : null,
    targetManaged: G ? G.spdManaged : true,
    targetSpeed: G && GI ? G.targetSpeed(GI) : null,
    targetAlt: G ? G.alt : null,
    ils: ils ? { id: ils.id, loc: ils.loc, gs: ils.gs, dme: ils.dme / 1.852 } : null,
    eng: [eng(0), eng(1)],
    thrLimit,
    togaN1: toga,
    flexTemp: F?.flexTemp ?? null,
    leverN1: (lm ? lm.idle + (toga - lm.idle) * c.pilot.throttle : 0) || 0,
    flapLever: lever,
    confName: conf.name,
    slat: S?.slat ?? 0,
    flap: S?.flap ?? 0,
    speedBrake: c.airBrake,
    spoilers: F?.spoilers ?? new Array(10).fill(0),
    gear: { down: c.gearDown, ext: c.gearExt },
    autobrake: F?.autobrake ?? 0,
    parkBrake: c.a320Park,
    surfaces: {
      ailL: S?.aileronL ?? 0,
      ailR: S?.aileronR ?? 0,
      elevL: S?.elevator ?? 0,
      elevR: S?.elevator ?? 0,
      rudder: S?.rudder ?? 0,
      stab: S?.stab ?? 0,
    },
    tanks: F?.tanks ?? [0, 0, 0, 0, 0],
    fob,
    fuelUsed: Math.max(used.start - fob, 0),
    gw: mass,
    lat: (geo.lat * 180) / Math.PI,
    lon: (geo.lon * 180) / Math.PI,
    onGround,
    deck,
    nd: ndExtra(c),
  };
}
const trend = { ias: 0, t: 0, rate: 0 };
const used: { start?: number } = {};
