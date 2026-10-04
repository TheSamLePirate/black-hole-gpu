// The wind and its turbulence (phase 2, audit: "ni vent ni turbulence"): what the air does besides
// turning with its world.
//
//  · the mean wind: 0 (calm), 4, 9 or 15 m/s at 10 m (the setting: light by default); up the boundary
//    layer a power law (1/7), stronger aloft to a jet near the tropopause (× 3 at 11 km), dying out
//    above 30 km; its direction slowly turning with the place and the day (the same weather for the
//    same place and hour);
//  · the turbulence: the Dryden model (MIL-HDBK-1797) — three first-order shaping filters driven by
//    white noise as the craft flies through the frozen field, their intensities and scales by height
//    (low: from the wind at 6 m, ~20 ft; aloft: light turbulence's 1.5 m/s);
//  · the gusts (a moderate or strong wind's): now and then a 1 − cos gust of a few metres per second
//    over a few hundred metres.
//
// Seeded, so a flight is the same each time it is flown (the golden flights at fixed steps).

import type { V3 } from "./mounts";

export type WindLevel = 0 | 1 | 2 | 3;

/** The mean wind at 10 m by level [m/s]. */
export const WIND_10M = [0, 4, 9, 15];

/** A small seeded PRNG (mulberry32) and its Gaussian (Box–Muller). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) * Math.cos(2 * Math.PI * next());
  return { next, gauss };
}

/** The mean wind's speed at a height above the ground [m/s]: the boundary layer, the jet aloft, nothing high up. */
export function meanWindSpeed(level: WindLevel, h: number): number {
  const u10 = WIND_10M[level]!;
  if (u10 <= 0) return 0;
  const hb = Math.max(h, 0.5);
  if (hb <= 500) return u10 * (hb / 10) ** (1 / 7);
  const u500 = u10 * 50 ** (1 / 7);
  // (aloft: up to the jet's three times the surface wind at 11 km, then down to nothing at 30 km)
  if (hb <= 11e3) return u500 + (3 * u10 - u500) * ((hb - 500) / 10500);
  return 3 * u10 * Math.max(0, 1 - (hb - 11e3) / 19e3);
}

/** The direction the wind blows from [rad from north, clockwise]: slowly turning with the place and the day. */
export function windFrom(lat: number, lon: number, days: number): number {
  const s = Math.sin(lat * 0.11 + days * 0.7) + 0.6 * Math.sin(lon * 0.07 - days * 0.31) + 0.3 * Math.sin(days * 2.1 + lat * 0.05);
  // (mostly westerlies, ±70°)
  return ((270 + 70 * s) * Math.PI) / 180;
}

/** The Dryden model's intensities [m/s] and scales [m] at a height [m] for a wind at 6 m (20 ft) [m/s]. */
export function dryden(h: number, w6: number, level: WindLevel) {
  const ft = Math.max(h, 1) / 0.3048;
  if (ft < 1000) {
    const sw = 0.1 * w6;
    const k = (0.177 + 0.000823 * ft) ** 0.4;
    const L = ft / (0.177 + 0.000823 * ft) ** 1.2;
    return { su: sw / k, sw, Lu: L * 0.3048, Lw: ft * 0.3048 };
  }
  // (aloft: light, moderate or severe turbulence's intensity; the scales 1750 ft)
  const s = [0, 1.5, 3, 6][level]!;
  const fade = ft < 2000 ? (ft - 1000) / 1000 : 1;
  const low = 0.1 * w6;
  return { su: low + (s - low) * fade, sw: low + (s - low) * fade, Lu: 533, Lw: 533 };
}

/** The weather a flight flies through: the mean wind and its turbulence, advanced frame by frame. */
export class Weather {
  private r: ReturnType<typeof rng>;
  /** the turbulence's velocity (along the wind, across it, up) [m/s] */
  private turb: V3 = [0, 0, 0];
  /** a gust under way: its peak [m/s], its length [m], how far through it [m]; the distance to the next */
  private gust: { peak: number; len: number; at: number } | null = null;
  private nextGust = 0;
  /** a new flight's field not drawn yet: at its first step, from that step's moment */
  private unseeded = false;

  constructor(seed = 1) {
    this.r = rng(seed);
    this.nextGust = 2000 + 6000 * this.r.next();
  }

  /**
   * A new flight: the field drawn anew from the seed (the same flight, the same weather) — none given,
   * from the flight's first step's moment (the clocks at the flight's setting-up are the last flight's).
   */
  reset(seed?: number) {
    this.unseeded = seed === undefined;
    this.r = rng(seed ?? 1);
    this.turb = [0, 0, 0];
    this.gust = null;
    this.nextGust = 2000 + 6000 * this.r.next();
  }

  /**
   * The wind now [m/s] — east, north, up — at a height h [m] above the ground, at latitude, longitude
   * [°] on day `days`, for a craft moving through the air at V [m/s], advanced by dt [s].
   */
  step(level: WindLevel, h: number, lat: number, lon: number, days: number, V: number, dt: number): V3 {
    if (this.unseeded) this.reset(1 + (Math.floor(Math.abs(days) * 864e5) % 2147483646));
    if (level === 0 || !(h < 30e3)) {
      this.turb = [0, 0, 0];
      return [0, 0, 0];
    }
    const U = meanWindSpeed(level, h);
    const from = windFrom(lat, lon, days);
    // (blowing from `from`: towards the opposite way)
    const to = from + Math.PI;
    const ax: V3 = [Math.sin(to), Math.cos(to), 0];
    const cr: V3 = [Math.cos(to), -Math.sin(to), 0];
    // the turbulence: each component a first-order filter of white noise over its scale, as flown through
    const D = dryden(h, meanWindSpeed(level, 6), level);
    const Vf = Math.max(V, 5);
    if (dt > 0) {
      const sig = [D.su, D.su, D.sw],
        L = [D.Lu, D.Lu, D.Lw];
      for (let i = 0; i < 3; i++) {
        const a = Math.exp((-Vf * dt) / L[i]!);
        this.turb[i] = a * this.turb[i]! + sig[i]! * Math.sqrt(1 - a * a) * this.r.gauss();
      }
      // the gusts: one every few kilometres flown, 1 − cos over a few hundred metres
      this.nextGust -= Vf * dt;
      if (!this.gust && this.nextGust <= 0) {
        this.gust = {
          peak: (0.4 + 0.6 * this.r.next()) * [0, 0, 5, 9][level]! * (this.r.next() < 0.5 ? -1 : 1),
          len: 150 + 350 * this.r.next(),
          at: 0,
        };
        this.nextGust = 2000 + 8000 * this.r.next();
      }
      if (this.gust) {
        this.gust.at += Vf * dt;
        if (this.gust.at > this.gust.len) this.gust = null;
      }
    }
    const g = this.gust ? 0.5 * this.gust.peak * (1 - Math.cos((2 * Math.PI * this.gust.at) / this.gust.len)) : 0;
    const along = U + this.turb[0] + g;
    return [ax[0] * along + cr[0] * this.turb[1], ax[1] * along + cr[1] * this.turb[1], this.turb[2] * Math.min(h / 50, 1)];
  }
}
