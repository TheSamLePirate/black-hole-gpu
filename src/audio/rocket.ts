// The rocket engine's sound, granular (PLAN-AUDIO S2): pure DSP, the AudioWorklet's core (engine-worklet.ts)
// and the unit tests' (tests/audio-rocket.test.ts). Everything synthesized, nothing downloaded.
//
// A rocket's roar is the turbulence of its exhaust: countless eddies, each a short burst of sound at the
// frequency of its size — here grains, each a damped sine (an impulse through a resonator: cheap, any
// pitch), their density and their pitches following the thrust. In the air the supersonic jet also
// *crackles*: its Mach waves steepen into shocks, heard as sharp positive spikes (a skewed waveform) — the
// crackle grains: a brief, high compression and a long, shallow expansion after it (zero on the whole),
// their rate and size with the throttle and the air's density. Under them the
// combustion's low rumble (brown noise, low-passed) and the flame's slow flicker (its level wandering).
// In vacuum the plume makes no sound: only the structure carries the chamber's low rumble (the engine's
// graph after this dulls it further for the views off the hull).

/** What the engine does now (each block): the throttle applied 0…1, the air's density over the sea
 *  level's 0…2, a pitch factor (the Doppler) */
export interface RocketControl {
  throttle: number;
  air: number;
  pitch: number;
}

/** A small, fast, seedable random source (xorshift32): the worklet's and the tests' the same. */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  /** uniform in [0, 1) */
  next() {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
}

/** the most grains sounding at once (a voice pool: a grain with no free voice is skipped — never one cut,
 *  a click) */
const POOL = 96;

export class RocketSynth {
  private rng: Rng;
  // the grains: a damped resonator each (y[n] = 2 r cos w · y[n−1] − r² · y[n−2]), its gain
  private c1 = new Float32Array(POOL);
  private c2 = new Float32Array(POOL);
  private y1 = new Float32Array(POOL);
  private y2 = new Float32Array(POOL);
  private amp = new Float32Array(POOL);
  private life = new Int32Array(POOL);
  private next = 0;
  // the crackle: a shock playing (its samples left, its length, its height)
  private nLeft = 0;
  private nLen = 0;
  private nAmp = 0;
  // the rumble's brown noise and its low-pass, the flicker's wander
  private brown = 0;
  private lp1 = 0;
  private lp2 = 0;
  private flick = 0;
  private flickTo = 0;
  private flickIn = 0;
  // the control eased (no zipper): the block's start → its end
  private th = 0;
  private air = 0;
  private pitch = 1;
  // the grains' time to the next (fractional samples)
  private due = 0;
  private due2 = 0;

  constructor(
    private rate: number,
    seed?: number,
  ) {
    this.rng = new Rng(seed);
  }

  /** A grain: a damped sine at `f` [Hz] lasting `tau` [s] (its 1/e), at height `a`. */
  private grain(f: number, tau: number, a: number) {
    let k = -1;
    for (let j = 0; j < POOL; j++) {
      const c = (this.next + j) % POOL;
      if (this.life[c]! <= 0) {
        k = c;
        break;
      }
    }
    if (k < 0) return;
    this.next = (k + 1) % POOL;
    const w = (2 * Math.PI * Math.min(f, this.rate * 0.45)) / this.rate;
    const r = Math.exp(-1 / Math.max(tau * this.rate, 1));
    this.c1[k] = 2 * r * Math.cos(w);
    this.c2[k] = -r * r;
    // (struck: the first sample the impulse, a random sign)
    this.y1[k] = 0;
    this.y2[k] = 0;
    this.amp[k] = a * (this.rng.next() < 0.5 ? -1 : 1) * Math.sin(w);
    this.life[k] = Math.ceil(tau * this.rate * 4);
    // (the impulse: y[0] = amp — kept in y1 so the recursion starts from it)
    this.y1[k] = this.amp[k]!;
  }

  /** Fills `out` (mono) with the engine at `c` (eased from the last block's). */
  process(out: Float32Array, c: RocketControl) {
    const n = out.length;
    const R = this.rate;
    const rng = this.rng;
    const th0 = this.th,
      air0 = this.air,
      p0 = this.pitch;
    const th1 = Math.min(Math.max(c.throttle, 0), 1),
      air1 = Math.min(Math.max(c.air, 0), 2),
      p1 = Math.min(Math.max(c.pitch, 0.25), 4);
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n;
      const th = th0 + (th1 - th0) * u;
      const air = air0 + (air1 - air0) * u;
      const pitch = p0 + (p1 - p0) * u;
      const loud = Math.sqrt(th);
      const wet = Math.min(air, 1);
      // the turbulence's grains: ~200 a second at a whisper, ~1 800 at full thrust; their pitches spread
      // log-uniformly over 120 Hz … 1.2 kHz in vacuum's structure-borne sound, up to 6 kHz in the air —
      // brighter with the thrust; each two to five cycles, 12 ms at most (the low end is the rumble's)
      this.due -= 1;
      while (this.due <= 0 && th > 0.003) {
        const rateG = 200 + 1600 * th;
        this.due += (R / rateG) * (0.5 + rng.next());
        const top = 1200 + (4800 * wet + 600) * th;
        const f = 120 * (top / 120) ** rng.next() * pitch;
        const tau = Math.min((2 + 3 * rng.next()) / f, 0.012);
        // (the big eddies the loudest: a 1/√f height, a log-normal spread)
        const a = loud * (0.09 / Math.sqrt(f / 120)) * Math.exp(0.6 * (rng.next() + rng.next() - 1));
        this.grain(f, tau, a);
      }
      let s = 0;
      for (let k = 0; k < POOL; k++) {
        if (this.life[k]! <= 0) continue;
        const y = this.c1[k]! * this.y1[k]! + this.c2[k]! * this.y2[k]!;
        s += this.y1[k]!;
        this.y2[k] = this.y1[k]!;
        this.y1[k] = y;
        this.life[k]!--;
      }
      // the crackle (in the air only): shocks — the compression a sixth of the event, a triangle peak; the
      // expansion the rest, shallow, its area the peak's (zero mean) — 20 to 120 a second, a Pareto's heights
      // (a few big ones), 0.6–2 ms long
      this.due2 -= 1;
      if (this.due2 <= 0) {
        const rateC = (20 + 100 * th) * wet * (th > 0.05 ? 1 : 0);
        this.due2 += rateC > 0 ? (R / rateC) * (0.3 + 1.4 * rng.next()) : R * 0.05;
        if (rateC > 0 && this.nLeft <= 0) {
          this.nLen = Math.max(12, Math.round(R * (0.0006 + 0.0014 * rng.next())));
          this.nLeft = this.nLen;
          this.nAmp = 0.35 * loud * wet * Math.min((1 - rng.next()) ** -0.45, 4);
        }
      }
      if (this.nLeft > 0) {
        const ph = 1 - this.nLeft / this.nLen;
        const F = 1 / 6;
        // (the peak a triangle of area A·F/2; the expansion −A·F/(2(1 − F)) over the rest)
        s += ph < F ? this.nAmp * (1 - Math.abs(2 * ph - F) / F) : (-this.nAmp * F) / (2 * (1 - F));
        this.nLeft--;
      }
      // the combustion's rumble: brown noise, twice low-passed (~60–180 Hz with the thrust)
      this.brown = (this.brown + 0.02 * (rng.next() * 2 - 1)) / 1.02;
      const fc = (60 + 120 * th) * pitch;
      const a1 = 1 - Math.exp((-2 * Math.PI * fc) / R);
      this.lp1 += (this.brown * 3.5 - this.lp1) * a1;
      this.lp2 += (this.lp1 - this.lp2) * a1;
      s += this.lp2 * 0.9 * loud;
      // the flame's flicker: the level wandering ±25 % every ~40 ms
      if (--this.flickIn <= 0) {
        this.flickIn = Math.round(R * 0.04);
        this.flickTo = rng.next() * 2 - 1;
      }
      this.flick += (this.flickTo - this.flick) * 0.002;
      out[i] = s * (1 + 0.25 * this.flick * th);
    }
    this.th = th1;
    this.air = air1;
    this.pitch = p1;
  }
}

/** The level [RMS], the skewness and the spectral centroid of a signal (tests, measures). */
export function measure(x: Float32Array, rate: number) {
  let m = 0;
  for (const v of x) m += v;
  m /= x.length;
  let s2 = 0,
    s3 = 0;
  for (const v of x) {
    const d = v - m;
    s2 += d * d;
    s3 += d * d * d;
  }
  const varr = s2 / x.length;
  const rms = Math.sqrt(varr);
  const skew = varr > 0 ? s3 / x.length / varr ** 1.5 : 0;
  // (the centroid by the zero crossings' rate: half of it, a rough mean frequency — no FFT needed)
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! - m < 0 !== x[i]! - m < 0) z++;
  return { rms, skew, centroid: (z * rate) / (2 * x.length) };
}
