// The F-35B's short take-off and vertical landing (docs/PLAN-F35.md, F4). Pure: the thrust's split and direction
// for a swivel of the nozzle, and the hover's control law — the "unified control law" the real aircraft flies:
// the stick asks for a speed over the ground (forward and sideways), the throttle for a vertical speed, the pedals
// for a turn; let go, it comes to a stop over a point and holds its height. The attitude stays near level (a few degrees nose up,
// banked to slide sideways); the swivelling nozzle and the lift fan aim the thrust.

type V3 = [number, number, number];

/** The STOVL propulsion's figures: the total vertical thrust over the engine's dry thrust (the lift fan's shaft
 *  power: 184 kN of the F135's 120 kN dry), the lift fan's share of it, the conversion's time [s], the nozzle's
 *  bearings' tilt [rad], the hover's attitude [rad]. */
export const STOVL = {
  boost: 184 / 120,
  fanShare: 0.5,
  convert: 6,
  bearing: (23.75 * Math.PI) / 180,
  pitch: (6 * Math.PI) / 180,
  /** the conversion's limit [m/s] (250 kt) and the hover law's engagement (and release) [m/s] */
  vConvert: 128,
  vHover: 65,
  vRelease: 80,
};

function rot(n: V3, a: number, v: V3): V3 {
  const l = Math.hypot(...n) || 1;
  const k: V3 = [n[0] / l, n[1] / l, n[2] / l];
  const c = Math.cos(a),
    s = Math.sin(a);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: V3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

/** The nozzle's deflection from the duct's axis [rad] for a swivel 0…1 (95° at 1): its two oblique bearings
 *  half a turn each, opposite ways (src/f35/model.ts swivel — the same, without the mesh). */
export function swivelDeflection(s: number): number {
  const f = STOVL.bearing;
  const psi = Math.min(Math.max(s, 0), 1) * Math.PI;
  const aft: V3 = [0, 0, -1];
  const nA: V3 = [0, -Math.sin(f), -Math.cos(f)];
  const nB: V3 = [0, Math.sin(f), -Math.cos(f)];
  const e = rot(nA, psi, rot(nB, -psi, aft));
  return Math.acos(Math.min(Math.max(-e[2], -1), 1));
}

/**
 * The thrust's direction on the ship's axes (x left, y up, z the nose) for a swivel and the lift fan engaged
 * 0…1: the fan's share straight up, the nozzle's along its deflection (0: forward, 90°: up, 95°: up and a little
 * back). Unit.
 */
export function thrustDir(s: number, fan: number): V3 {
  const d = swivelDeflection(s);
  const f = STOVL.fanShare * Math.min(Math.max(fan, 0), 1);
  const y = f + (1 - f) * Math.sin(d),
    z = (1 - f) * Math.cos(d);
  const l = Math.hypot(y, z) || 1;
  return [0, y / l, z / l];
}

/** The swivel giving the thrust a forward tilt ε from the ship's up [rad] (the fan engaged): bisection — the
 *  tilt runs from the nozzle's 95° (a little back) to its 0 (the fan's share up, the nozzle's forward). */
export function swivelFor(eps: number, fan: number): number {
  let lo = 0,
    hi = 1;
  const tilt = (s: number) => {
    const d = thrustDir(s, fan);
    return Math.atan2(d[2], d[1]);
  };
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (tilt(m) > eps) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** What the hover law gets each frame (the local frame: its up, the heading's way, its right; SI). */
export interface HoverInputs {
  dt: number;
  /** the stick (pitch > 0 back, roll > 0 right), the throttle keys (> 0 up), the pedals (yaw > 0 right), −1…1 */
  pitch: number;
  roll: number;
  throttle: number;
  yaw: number;
  /** the velocity over the ground [m/s] and the gravity and the air's acceleration [m/s²] (local frame vectors) */
  v: V3;
  grav: V3;
  air: V3;
  up: V3;
  north: V3;
  east: V3;
  /** the height over the ground [m], on its wheels, the mass [kg], the thrust at full throttle [N] */
  h: number;
  onGround: boolean;
  mass: number;
  thrustMax: number;
}

/** The hover law's held commands: the speeds over the ground forward and sideways [m/s], the heading [rad]. */
export interface HoverCmd {
  fwd: number;
  side: number;
  heading: number;
}

export interface HoverOut {
  /** the attitude asked (local: the nose, the top), the throttle 0…1, the swivel 0…1 */
  nose: V3;
  up: V3;
  throttle: number;
  swivel: number;
  /** the vertical speed asked [m/s] (the HUD's) and whether the thrust can hold it up at all */
  vz: number;
  heavy: boolean;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lin = (a: V3, ka: number, b: V3, kb: number): V3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/**
 * A frame of the hover law: the commands moved by the stick (the forward speed integrated — pushed, it
 * accelerates, let go it holds; the sideways one proportional — let go, it stops), the velocity flown by the
 * thrust: its vertical part by the throttle, its forward part by the nozzle's swivel, its sideways part by a bank.
 */
export function hoverStep(i: HoverInputs, cmd: HoverCmd): HoverOut {
  // (the stick pushed: faster forward, pulled: slower — then backwards; let go, the speed eased to a hover
  // at 2.5 m/s², as the real law's translational rate command brings it to a stop over a point)
  if (i.pitch !== 0) cmd.fwd = clamp(cmd.fwd - i.pitch * 5 * i.dt, -12, 75);
  else cmd.fwd -= clamp(cmd.fwd, -2.5 * i.dt, 2.5 * i.dt);
  cmd.side = i.roll * 10;
  cmd.heading += i.yaw * 0.35 * i.dt;
  const hd = unit(lin(i.north, Math.cos(cmd.heading), i.east, Math.sin(cmd.heading)));
  const right = cross(hd, i.up);
  // (the vertical speed: up or down by the throttle keys, held at zero let go; near the ground a descent eased
  // to a touchdown's 1.5 m/s)
  let vz = i.throttle * 4;
  if (i.h < 15 && vz < 0) vz = Math.max(vz, -Math.max(1.5, 0.25 * i.h));
  const want = lin(lin(hd, cmd.fwd, right, cmd.side), 1, i.up, vz);
  const err = lin(want, 1, i.v, -1);
  // (the acceleration asked: the error closed over ~1.5 s, no more than 4 m/s² across, 3 up or down)
  const eu = dot(err, i.up);
  const eh = lin(err, 1, i.up, -eu);
  const ah = Math.hypot(...eh) > 6 ? lin(eh, 4 / Math.hypot(...eh), eh, 0) : lin(eh, 0.67, eh, 0);
  const a = lin(ah, 1, i.up, clamp(eu * 0.9, -3, 3));
  // the force per mass the thrust must give: the acceleration less gravity and the air's
  const F = lin(lin(a, 1, i.grav, -1), 1, i.air, -1);
  const Fu = dot(F, i.up),
    Ff = dot(F, hd),
    Fs = dot(F, right);
  // (the bank slides it sideways; the nozzle tilts the thrust forwards or back from the attitude's)
  const bank = clamp(Math.atan2(Fs, Math.max(Fu, 1)), -0.35, 0.35);
  // (the thrust's tilt over the ground's vertical; on the craft's axes it is that plus the attitude's pitch —
  // the nozzle reaches from 2.5° back to 45° forward: past either, the nose raised or lowered, as the pilot of
  // a Harrier would — up to 15° up to brake hard, 6° down to press on)
  const tw = Math.atan2(Ff, Math.max(Fu, 1));
  const lo = Math.atan2(thrustDir(1, 1)[2], thrustDir(1, 1)[1]),
    hi = Math.atan2(thrustDir(0, 1)[2], thrustDir(0, 1)[1]);
  const pitch = clamp(clamp(STOVL.pitch, lo - tw, hi - tw), -0.1, 0.26);
  const swivel = swivelFor(tw + pitch, 1);
  const n = Math.hypot(Fu, Ff, Fs);
  let throttle = i.thrustMax > 0 ? (n * i.mass) / i.thrustMax : 0;
  const heavy = (i.mass * Math.hypot(...i.grav)) / Math.max(i.thrustMax, 1) > 0.98;
  // (on its wheels, nothing asked up: the engine back to idle, the craft set down)
  if (i.onGround && vz <= 0) throttle = 0.12;
  const nose0 = lin(hd, Math.cos(pitch), i.up, Math.sin(pitch));
  const top0 = lin(i.up, Math.cos(pitch), hd, -Math.sin(pitch));
  // (banked right: the top towards the right — nose × top is the right)
  const top = lin(top0, Math.cos(bank), cross(nose0, top0), Math.sin(bank));
  return { nose: unit(nose0), up: unit(top), throttle: clamp(throttle, 0, 1), swivel, vz, heavy };
}
