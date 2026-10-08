// The runways' guidance as the Shuttle's (PLAN-AEROPORTS A4): a microwave landing system's two stations per
// runway end — the azimuth's past the far end (the localizer: the craft's bearing off the centreline), the
// elevation's beside the touchdown point (the craft's angle above it against the Ranger's own profile: the
// steep outer glide, then the shallow inner one, not an airliner's 3°) — and its distance. What the HUD's
// scales and the NAV screen's needles show; pure (the controller gives the runway's figures).

/** the azimuth station past the far end [m from the threshold, beyond the runway's length] */
export const AZ_PAST = 300;
/** coverage: ±40° off the centreline, 37 km (20 nm) out, under 6 km; the elevation from 0.5° to 30° */
export const MLS_RANGE = 37e3;

export interface MlsReading {
  /** the bearing off the centreline seen from the azimuth station [°, > 0: the craft right of it] */
  az: number;
  /** the angle above the profile seen from the elevation station [°, > 0: high]; null: none asked here */
  el: number | null;
  /** in each station's coverage */
  azIn: boolean;
  elIn: boolean;
  /** the distance to the touchdown point [km] (the DME's) */
  dmeKm: number;
}

/**
 * The guidance at a craft `along` the runway's axis from its threshold (< 0 before it), `across` it (> 0
 * right) [m], `agl` over the ground, the profile asking `profileH` there (null: none — off the final);
 * the runway `length` long, its touchdown point `td` in.
 */
export function mlsReading(o: {
  along: number;
  across: number;
  agl: number;
  profileH: number | null;
  length?: number;
  td?: number;
}): MlsReading {
  const L = o.length ?? 4500;
  const td = o.td ?? 450;
  const D = 180 / Math.PI;
  const toAz = L + AZ_PAST - o.along;
  const az = Math.atan2(o.across, toAz) * D;
  const range = Math.hypot(td - o.along, o.across);
  const azIn = Math.abs(az) <= 40 && toAz > 0 && Math.hypot(toAz, o.across) <= MLS_RANGE + L && o.agl < 6000;
  const toEl = Math.max(td - o.along, 1);
  const elAngle = Math.atan2(o.agl, toEl) * D;
  const elIn = azIn && o.profileH !== null && o.along < td && elAngle >= 0.5 && elAngle <= 30;
  const el = o.profileH === null ? null : elAngle - Math.atan2(o.profileH, toEl) * D;
  return { az, el, azIn, elIn, dmeKm: Math.hypot(range, o.agl) / 1000 };
}
