// The TCAS for every craft in the air (docs/PLAN-RADAR-AAA.md RD4): the transponders about, each graded as TCAS II
// grades it — other traffic, proximate (within 6 NM and 1 200 ft), a traffic advisory (TA: the closest approach
// within 40 s, or already within its protected volume), a resolution advisory (RA: within 25 s — climb or descend,
// the sense that leaves the more height between at the closest approach, the intruder's own RA's sense heeded when it
// has one). Its thresholds are TCAS II's at its sensitivity level 5 (5 000–10 000 ft); the RAs inhibited near the
// ground (under 1 000 ft over it: TA only), as TCAS II's. Pure: the craft and the others relative to it (local east,
// north, up [m], their velocities over the ground [m/s]) in, the advisories out — the pilot's HUD, the TSD, the crew's
// ND the same.

export type V3 = [number, number, number];
export type TcasLevel = "other" | "proximate" | "TA" | "RA";
export type RaSense = "climb" | "descend";

export interface TcasOther {
  id: string;
  /** relative to the craft (east, north, up [m]) */
  r: V3;
  /** its velocity over the ground [m/s] */
  v: V3;
}

export interface TcasAdvisory {
  id: string;
  level: TcasLevel;
  /** the time to the closest approach [s] (Infinity: opening) */
  tau: number;
  /** the distance and the height between at the closest approach [m] */
  missD: number;
  missH: number;
  /** an RA's sense */
  sense?: RaSense;
}

/** TCAS II's figures at its sensitivity level 5 [s, m]. */
export const TCAS = {
  taTau: 40,
  raTau: 25,
  /** the protected volume: the distance (DMOD), the height (ZTHR) — TA's, RA's */
  taDmod: 0.75 * 1852,
  raDmod: 0.64 * 1852,
  taZthr: 850 * 0.3048,
  raZthr: 600 * 0.3048,
  /** proximate traffic: within 6 NM, 1 200 ft */
  proxD: 6 * 1852,
  proxH: 1200 * 0.3048,
  /** its reach (the transponders it hears): 30 NM, ±9 900 ft */
  range: 30 * 1852,
  height: 9900 * 0.3048,
  /** the RAs inhibited under 1 000 ft over the ground */
  raFloor: 1000 * 0.3048,
  /** the climb or descent an RA asks [m/s] (1 500 ft/min) */
  raRate: 1500 * 0.00508,
} as const;

/**
 * The advisories (the others within the TCAS's reach, the most urgent first): `ownV` the craft's velocity over the
 * ground [m/s], `agl` its height over the ground [m] (the RAs inhibited low), `theirRa` an intruder's own RA's sense
 * by its id (coordinated: ours the other way).
 */
export function tcasAdvise(ownV: V3, agl: number, others: TcasOther[], theirRa?: Map<string, RaSense>): TcasAdvisory[] {
  const out: TcasAdvisory[] = [];
  for (const o of others) {
    const d = Math.hypot(o.r[0], o.r[1]);
    const h = o.r[2];
    if (d > TCAS.range || Math.abs(h) > TCAS.height) continue;
    // (the relative motion over the ground's plane: the time to the closest approach, the miss then)
    const vx = o.v[0] - ownV[0],
      vy = o.v[1] - ownV[1],
      vz = o.v[2] - ownV[2];
    const vv = vx * vx + vy * vy;
    const tc = vv > 1e-6 ? -(o.r[0] * vx + o.r[1] * vy) / vv : Infinity;
    const tau = tc > 0 ? tc : Infinity;
    const tcpa = Number.isFinite(tau) ? tau : 0;
    const missD = Math.hypot(o.r[0] + vx * tcpa, o.r[1] + vy * tcpa);
    const missH = h + vz * tcpa;
    // (the height's own closing: its time to co-height)
    const vtau = vz * h < 0 ? -h / vz : Infinity;
    const within = (dmod: number, zthr: number, tauMax: number) =>
      (d < dmod && Math.abs(h) < zthr) ||
      (tau < tauMax && missD < dmod && (Math.abs(missH) < zthr || vtau < tauMax) && Math.abs(h) < zthr + Math.abs(vz) * tauMax);
    let level: TcasLevel = d < TCAS.proxD && Math.abs(h) < TCAS.proxH ? "proximate" : "other";
    if (within(TCAS.taDmod, TCAS.taZthr, TCAS.taTau)) level = "TA";
    let sense: RaSense | undefined;
    // (an RA only on one closing: a wingman alongside, inside the volume but holding his place, a TA)
    if (agl > TCAS.raFloor && Number.isFinite(tau) && within(TCAS.raDmod, TCAS.raZthr, TCAS.raTau)) {
      level = "RA";
      const ask = theirRa?.get(o.id);
      if (ask) sense = ask === "climb" ? "descend" : "climb";
      // (else away from where it will be at the closest approach: below it if it passes above, above it if below)
      else sense = (Math.abs(missH) > 1 ? missH : h) > 0 ? "descend" : "climb";
    }
    out.push({ id: o.id, level, tau, missD, missH, ...(sense ? { sense } : {}) });
  }
  const rank: Record<TcasLevel, number> = { RA: 0, TA: 1, proximate: 2, other: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.tau - b.tau);
}
