// The Lander's landing radar (PLAN-RADAR-AAA, RD4's leftover — Apollo's LM landing radar's way): a Doppler set under
// the craft's belly, its altitude beam and its three velocity beams fixed to it. It locks on the ground below a height
// (the altitude from 12 km, the velocities from 7.5 km — Apollo's ~40 000 and ~25 000 ft) while the belly looks down
// within its beams' reach (50° off the vertical); then it gives the height over the ground, its rate, the speeds
// forward and across — the same figures the craft's probes measure (controller/craftpanel.ts descentFigures): the
// sensor is their validity, not another computation. Out of its lock, the navigation's figures stand alone (the DESCENT
// panel says NAV, the Approach HUD's height too). Pure.

export interface LandingRadarSpec {
  /** the altitude beam's lock below this height [m] */
  altMax: number;
  /** the velocity beams' below this height [m] */
  velMax: number;
  /** the belly's tilt off the vertical beyond which the beams lose the ground [rad] */
  tiltMax: number;
}

export const LANDER_LR: LandingRadarSpec = { altMax: 12_000, velMax: 7_500, tiltMax: (50 * Math.PI) / 180 };

/** The landing radar each craft carries, by its id (the Lander's). */
export const LANDING_RADARS: Readonly<Record<string, LandingRadarSpec>> = { lander: LANDER_LR };

/** The ground as the probes find it: the height over it [m], its rate [m/s, up +], the speeds forward and across over
 *  it [m/s]; the belly's tilt off the vertical [rad]; landed. */
export interface LandingRadarIn {
  h: number;
  hDot: number;
  vFwd: number;
  vLat: number;
  tilt: number;
  landed: boolean;
}

/** The radar's reading: the altitude's and the velocities' locks (ALT, VEL — Apollo's lamps out), the figures held
 *  (null where not locked), the slant range along the altitude beam [m]. */
export interface LandingRadarOut {
  alt: boolean;
  vel: boolean;
  h: number | null;
  hDot: number | null;
  vFwd: number | null;
  vLat: number | null;
  slant: number | null;
}

/** The landing radar's reading now. */
export function landingRadar(spec: LandingRadarSpec, i: LandingRadarIn): LandingRadarOut {
  const look = i.landed || Math.abs(i.tilt) <= spec.tiltMax;
  const h = Math.max(i.h, 0);
  const alt = look && h <= spec.altMax;
  const vel = look && h <= spec.velMax;
  return {
    alt,
    vel,
    h: alt ? h : null,
    hDot: vel ? i.hDot : null,
    vFwd: vel ? i.vFwd : null,
    vLat: vel ? i.vLat : null,
    // (the altitude beam along the belly: its range to flat ground below)
    slant: alt ? h / Math.max(Math.cos(i.tilt), 0.05) : null,
  };
}

/** The lock as one word: ALT·VEL, ALT, or none. */
export const lrLock = (o: Pick<LandingRadarOut, "alt" | "vel">): "ALT·VEL" | "ALT" | null =>
  o.alt && o.vel ? "ALT·VEL" : o.alt ? "ALT" : null;
