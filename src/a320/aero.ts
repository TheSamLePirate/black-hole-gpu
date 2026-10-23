// The A320's aerodynamics (docs/PLAN-A320.md, A3): FlightGear's JSBSim model (FDE/Config/a320-aerodynamics.xml —
// src/a320/fdm-data.ts) evaluated as JSBSim does — lift, drag and side force in the wind axes, roll, pitch and yaw
// about its aerodynamic reference point carried to the centre of gravity —, from the flight's state and the
// configuration its systems set (src/a320/fcs.ts: the slats, the flaps, the spoilers, the stabiliser, the gear, the
// surfaces' deflections). The control surfaces' own moments are the flight control computer's authority
// (a320Authority): pilot.ts flies the rates the law asks within it — their lift, drag and side force stay here.
// Pure.

import { AERO_MODELS, type AeroOut, type Air, type V3 } from "../aero";
import { FDM } from "./fdm-data";
import { type Bag, evaluate, type FdmFn, short } from "./jsbsim";

const FT = 0.3048;
const LBF = 4.4482216;
const FTLBF = 1.3558179;
const PSF = 0.020885434;
const D = Math.PI / 180;

/** What the A320's systems set (src/a320/fcs.ts): angles in degrees (JSBSim's signs: the elevators and ailerons'
 *  trailing edges down > 0, the rudder's to the left > 0, the stabiliser's leading edge up > 0 — nose down —), the
 *  gear 0…1, the landing lights out 0…1, the angle of attack's rate [rad/s]. */
export interface A320Surfaces {
  slat: number;
  flap: number;
  /** the roll spoilers' mean deflection on each wing, the symmetric (speed brake, ground spoilers) */
  spoilerL: number;
  spoilerR: number;
  spoilerSym: number;
  aileronL: number;
  aileronR: number;
  elevator: number;
  rudder: number;
  stab: number;
  gear: number;
  lights: [number, number];
  alphaDot: number;
  /** the engines' unequal thrust's yawing moment [N·m, nose right > 0 — failures.ts thrustYaw] */
  thrustYaw?: number;
}

export const restSurfaces = (): A320Surfaces => ({
  slat: 0,
  flap: 0,
  spoilerL: 0,
  spoilerR: 0,
  spoilerSym: 0,
  aileronL: 0,
  aileronR: 0,
  elevator: 0,
  rudder: 0,
  stab: 0,
  gear: 1,
  lights: [0, 0],
  alphaDot: 0,
});

/** the control surfaces' moments: the flight control computer's to fly (a320Authority) */
const CONTROL = new Set(["Clda_l", "Clda_r", "Cldsp_l", "Cldsp_r", "Cldr", "Cmde_l", "Cmde_r", "Cndr"]);
const M = FDM.metrics;
const S_FT = M.S / (FT * FT);
const B_FT = M.b / FT;
const C_FT = M.c / FT;
const AX = FDM.aero.axes as Record<"LIFT" | "DRAG" | "SIDE" | "ROLL" | "PITCH" | "YAW", FdmFn[]>;
const free = (fs: FdmFn[]) => fs.filter((f) => !CONTROL.has(short(f)));
const AXES = { LIFT: AX.LIFT, DRAG: AX.DRAG, SIDE: AX.SIDE, ROLL: free(AX.ROLL), PITCH: free(AX.PITCH), YAW: free(AX.YAW) };
const CL_ALPHA = AX.LIFT.find((f) => short(f) === "CLalpha")!;
const sum = (fs: FdmFn[], b: Bag) => fs.reduce((s, f) => s + evaluate(f.expr, b), 0);
/** the aerodynamic reference point from the centre of gravity, JSBSim's body axes (x forward, y right, z down) [m] —
 *  the FDM's structural frame (x aft, y right, z up) turned */
const ARM: V3 = [-(M.AERORP[0]! - FDM.mass.cg[0]!), M.AERORP[1]! - FDM.mass.cg[1]!, -(M.AERORP[2]! - FDM.mass.cg[2]!)];
/** the wing's height over the belly (the reference point's, ship frame) [m] — the ground effect's */
const WING_UP = 1.71;

/** JSBSim's body axes from the ship's (x left, y up, z nose): x forward, y right, z down. */
const toBody = (v: V3): V3 => [v[2], -v[0], -v[1]];
const toShip = (b: V3): V3 => [-b[1], -b[2], b[0]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The bag of JSBSim's properties for a flight state (its kinematics, the configuration). */
export function aeroBag(vb: V3, wb: V3, air: Air, s: A320Surfaces, agl: number | undefined): Bag {
  const V = Math.hypot(...vb);
  const qPa = 0.5 * air.rho * V * V;
  const alpha = Math.atan2(vb[2], vb[0]);
  const beta = Math.asin(Math.max(-1, Math.min(1, vb[1] / (V || 1))));
  const Vf = Math.max(V / FT, 1e-3);
  const mu = (1.458e-6 * air.T ** 1.5) / (air.T + 110.4);
  const b: Bag = {
    "aero/qbar-psf": qPa * PSF,
    "aero/qbarUW-psf": 0.5 * air.rho * (vb[0] * vb[0] + vb[2] * vb[2]) * PSF,
    "metrics/Sw-sqft": S_FT,
    "metrics/bw-ft": B_FT,
    "metrics/cbarw-ft": C_FT,
    "aero/alpha-deg": alpha / D,
    "aero/beta-deg": beta / D,
    "aero/beta-rad": beta,
    "aero/ci2vel": C_FT / (2 * Vf),
    "aero/bi2vel": B_FT / (2 * Vf),
    "aero/alphadot-rad_sec": s.alphaDot,
    "aero/h_b-mac-ft": agl !== undefined ? Math.max(agl + WING_UP, 0) / M.b : 10,
    "aero/Re": air.rho > 0 ? (V * M.c * air.rho) / mu : 0,
    "velocities/mach": air.a > 0 ? V / air.a : 0,
    "velocities/p-aero-rad_sec": wb[0],
    "velocities/q-aero-rad_sec": wb[1],
    "velocities/r-aero-rad_sec": wb[2],
    "fcs/slat-pos-deg": s.slat,
    "fcs/slat-pos-norm": s.slat / 27,
    "fcs/flap-pos-deg": s.flap,
    "fcs/spoiler-left-deg": s.spoilerL,
    "fcs/spoiler-right-deg": s.spoilerR,
    "fcs/spoiler-symmetrical-deg": s.spoilerSym,
    "systems/fcs/aileron-l/final-deg": s.aileronL,
    "systems/fcs/aileron-r/final-deg": s.aileronR,
    "systems/fcs/elevator-l/final-deg": s.elevator,
    "systems/fcs/elevator-r/final-deg": s.elevator,
    "systems/fcs/rudder/final-deg": s.rudder,
    "systems/fcs/stabilizer/final-deg": s.stab,
    "systems/gear/all-norm": s.gear,
    "controls/lighting/landing-light-pos-l": s.lights[0],
    "controls/lighting/landing-light-pos-r": s.lights[1],
  };
  for (const f of FDM.aero.functions) b[f.name] = evaluate(f.expr, b);
  return b;
}

/**
 * The lift calibrated on Airbus's stall speeds (FlightGear's own FMGC tables, Systems/a320-fmgc.xml VS1G: 150.8 kt
 * clean, 124.8 in CONF 1, 118.0 in 1+F, 110.9 in 2, 109.1 in 3, 106.0 in FULL at 60 t): the FDM's lift short of them
 * — its stall 6 to 13 kt fast with the high-lift devices out. The clean lift slope scaled; the slats' and the flaps'
 * own increments added (tests/a320-aero.test.ts measures the speeds).
 */
export const CL_SCALE = 1.077;
const lerp1 = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]!) return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
  return ys[ys.length - 1]!;
};
/** the slats' added lift (by their angle), the flaps' (by theirs) */
export const CAL_SLAT: [number[], number[]] = [
  [0, 18, 27],
  [0, 0.402, 0.402],
];
export const CAL_FLAP: [number[], number[]] = [
  [0, 10, 15, 20, 35],
  [0, 0.135, 0.204, 0.231, 0.024],
];
export const calLift = (slat: number, flap: number) => lerp1(CAL_SLAT[0], CAL_SLAT[1], slat) + lerp1(CAL_FLAP[0], CAL_FLAP[1], flap);

/** the incidence of the lift's peak [deg], clean and with the slats out (the CLalpha table's) */
const STALL_CLEAN = 12.65;
const STALL_SLATS = 14.8;

/**
 * The A320's air force and moment (ship frame: x left, y up, z nose — N, N m about the centre of gravity) for its
 * velocity through the air v and its turn w (ship frame, right-handed), as aero.ts's aeroForces gives the others'.
 */
export function a320Forces(v: V3, air: Air, w: V3, s: A320Surfaces, agl: number | undefined): AeroOut {
  const V = Math.hypot(...v);
  const vb = toBody(v);
  // (JSBSim's rates: p the roll right, q the pitch up, r the yaw right — the ship's right-handed turn on its axes)
  const wb: V3 = [w[2], -w[0], -w[1]];
  const b = aeroBag(vb, wb, air, s, agl);
  const qS = b["aero/qbar-psf"]! * S_FT;
  const L = sum(AXES.LIFT, b) + (CL_SCALE - 1) * evaluate(CL_ALPHA.expr, b) + qS * b["aero/function/kCLge"]! * calLift(s.slat, s.flap);
  b["aero/cl-squared"] = qS > 0 ? (L / qS) ** 2 : 0;
  const Dr = sum(AXES.DRAG, b);
  const Y = sum(AXES.SIDE, b);
  // (the wind axes: x along the motion, y JSBSim's — the body's y turned by the sideslip —, z down across it in the
  // plane of symmetry; drag against x, the side force along y, the lift up — against z)
  const xw = unit(vb);
  const zw = unit(cross(xw, [0, 1, 0]));
  const yw = cross(zw, xw);
  const Fb: V3 = [0, 1, 2].map((i) => (-Dr * xw[i]! + Y * yw[i]! - L * zw[i]!) * LBF) as V3;
  const Mb: V3 = [sum(AXES.ROLL, b) * FTLBF, sum(AXES.PITCH, b) * FTLBF, sum(AXES.YAW, b) * FTLBF + (s.thrustYaw ?? 0)];
  // (carried from the reference point to the centre of gravity)
  const t = cross(ARM, Fb);
  const Mcg: V3 = [Mb[0] + t[0], Mb[1] + t[1], Mb[2] + t[2]];
  const alpha = b["aero/alpha-deg"]!;
  const stallAt = s.slat > 1 ? STALL_SLATS : STALL_CLEAN;
  const u: V3 = V > 0 ? [v[0] / V, v[1] / V, v[2] / V] : [0, 0, 1];
  return {
    F: toShip(Fb),
    M: toShip(Mcg),
    q: b["aero/qbar-psf"]! / PSF,
    mach: b["velocities/mach"]!,
    alpha: alpha * D,
    beta: Math.asin(Math.max(-1, Math.min(1, u[0]))),
    L: L * LBF,
    D: Dr * LBF,
    cl: qS > 0 ? L / qS : 0,
    stalled: alpha > stallAt,
    heat: 0,
    Tr: air.T * (1 + 0.2 * b["velocities/mach"]! ** 2),
    // (the buffet: from two degrees short of the lift's peak)
    buffet: Math.min(Math.max((alpha - (stallAt - 2)) / 3, 0), 1) * Math.min(V / 40, 1),
  };
}

/** the surfaces' full travel (FlightGear's a320-fcs.xml): the ailerons ±25° with the roll spoilers (2–5) to 35°, the
 *  elevators −30° (nose up) / +15°, the rudder ±25° — limited at speed (its travel limiter: 25° below 160 kt, 3.4°
 *  at 380 kt) */
export function rudderTravel(ias: number): number {
  return ias < 160 ? 25 : ias > 380 ? 3.4 : 25 - ((ias - 160) / 220) * 21.6;
}

/**
 * The flight control computer's authority now: the angular accelerations [rad/s²] its surfaces give at full travel —
 * pitch (nose up), yaw, roll — for the inertias about the ship's x, y, z [kg m²], the flight's state.
 */
export function a320Authority(v: V3, air: Air, I: V3, s: A320Surfaces, ias: number): V3 {
  const vb = toBody(v);
  const full = (sf: Partial<A320Surfaces>) => aeroBag(vb, [0, 0, 0], air, { ...s, ...sf }, undefined);
  const fn = (axis: FdmFn[], names: string[], b: Bag) =>
    axis.filter((f) => names.includes(short(f))).reduce((x, f) => x + evaluate(f.expr, b), 0);
  const pitch = Math.abs(fn(AX.PITCH, ["Cmde_l", "Cmde_r"], full({ elevator: -30 }))) * FTLBF;
  const roll =
    Math.abs(fn(AX.ROLL, ["Clda_l", "Clda_r", "Cldsp_l", "Cldsp_r"], full({ aileronL: 25, aileronR: -25, spoilerL: 0, spoilerR: 35 }))) *
    FTLBF;
  const yaw = Math.abs(fn(AX.YAW, ["Cndr"], full({ rudder: rudderTravel(ias) }))) * FTLBF;
  return [pitch / I[0], yaw / I[1], roll / I[2]];
}

AERO_MODELS.a320 = (v, air, w, cfg) => a320Forces(v, air, w, cfg.a320 ?? restSurfaces(), cfg.agl);
