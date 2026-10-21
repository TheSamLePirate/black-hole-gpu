// A storm's lightning about the camera (docs/PLAN-NUAGES-AAA.md N5): its flashes in time — a few a minute in a storm,
// more the stronger it is —, each at a place 3 to 25 km off, in the cloud (intra-cloud, most) or to the ground (a third),
// its light flickering with its return strokes (three or four, tens of milliseconds apart, each a 40 ms pulse, the
// channel's continuing current between them). The tracer lights the clouds, the rain, the ground and draws the channel
// from it (trace.wgsl: Params.wx[6], wx[7]); the sound's thunder follows it at the speed of sound.

/** A flash: when (the scene's clock [s]), where (east, north of the camera [m], the height its light starts at [m above
 *  the sea]), to the ground or not, its strokes' times after it [s], its seed (the channel's shape). */
export interface Flash {
  t0: number;
  east: number;
  north: number;
  h: number;
  ground: boolean;
  strokes: number[];
  seed: number;
}

/** a deterministic stream of numbers in [0, 1) */
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Lightning {
  private flash: Flash | null = null;
  private next = Number.NaN;
  private n = 0;
  /** the flashes born since last asked (the thunder's) */
  private born: Flash[] = [];

  /**
   * The clock moved to `t` [s]: `storm` how stormy it is about the camera (0 none … 1 a cumulonimbus overhead), the deck's
   * base and top [m above the sea]. A flash is born when its time comes (none while the clock stands still).
   */
  step(t: number, storm: number, base: number, top: number) {
    this.base = base;
    if (storm <= 0) {
      this.next = Number.NaN;
      return;
    }
    // (the waits between flashes: exponential, a mean of 20 s at a storm's edge, 5 s in its heart)
    const r = rand(Math.floor(t * 7) + 977 * this.n);
    if (!Number.isFinite(this.next) || this.next < t - 60) this.next = t + 1 + r() * 4;
    if (t < this.next) return;
    const ground = r() < 0.33;
    const d = 3000 + Math.sqrt(r()) * 22000;
    const a = r() * 2 * Math.PI;
    const strokes = [0];
    const k = ground ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
    for (let i = 1; i < k; i++) strokes.push(strokes[i - 1]! + 0.04 + r() * 0.09);
    this.flash = {
      t0: t,
      east: d * Math.sin(a),
      north: d * Math.cos(a),
      h: ground ? base : base + (0.3 + 0.4 * r()) * (top - base),
      ground,
      strokes,
      seed: Math.floor(r() * 1e6),
    };
    this.born.push(this.flash);
    this.n++;
    const mean = 20 - 15 * Math.min(storm, 1);
    this.next = t + 0.3 - mean * Math.log(1 - r() * 0.999);
  }

  private base = 1000;
  /** A flash made now (tests, a mission's cue): `east`, `north` of the camera [m], to the ground or in the cloud — held at its
   *  first stroke's peak while the clock stands still. */
  strike(east: number, north: number, ground = true, h = this.base) {
    // (its time: the clock's at its next step — a scene's date set in the same breath moves the clock first)
    this.flash = { t0: Number.NaN, east, north, h, ground, strokes: [0, 0.07, 0.15], seed: 4242 };
    this.born.push(this.flash);
  }

  /** The flash's light now (0 none, ~1 a stroke's peak): its strokes' pulses and the current between them. */
  light(t: number): { f: Flash; i: number } | null {
    const f = this.flash;
    if (!f) return null;
    if (Number.isNaN(f.t0)) f.t0 = t;
    const dt = t - f.t0;
    if (dt < 0 || dt > 1.2) return null;
    let i = 0;
    for (const s of f.strokes) if (dt >= s) i += Math.exp(-(dt - s) / 0.04);
    // (the continuing current: a dim glow while the strokes go on)
    if (dt < f.strokes[f.strokes.length - 1]! + 0.15) i += 0.12;
    return { f, i: Math.min(i, 1.5) };
  }

  /** The flashes born since the last call (each heard once). */
  drain(): Flash[] {
    const b = this.born;
    this.born = [];
    return b;
  }
}
