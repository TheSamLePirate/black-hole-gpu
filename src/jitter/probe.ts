// The flight's jitter probe (docs/progress/JITTER-VOL.md): what moved the image each turn of the loop, layer by layer —
// the loop's timing and the GPU's, the flown craft's attitude (before any view), the view's mount on it (the rig, the
// shake turned into it), the camera shake's own turns, the display's shake (the whole image offset), the renderer's
// scale and shading rate —, kept in a ring while running. analyze.ts turns it into pixels per category. Free when
// stopped: main.ts asks `active` before gathering anything.

export type V3 = [number, number, number];

/** One turn of the loop. Angles in radians, times in milliseconds but `dt` and `sim` (seconds). */
export interface JitterSample {
  /** the rAF stamp [ms] */
  t: number;
  /** the step given to the simulation [s] (0: frozen, paused) */
  dt: number;
  /** an image was encoded and submitted this turn */
  rendered: boolean;
  /** when this turn's image was submitted and when the GPU finished it [ms] (filled once known; NaN: none) */
  sub: number;
  done: number;
  /** the playback clock [s] — the flight's time as the loop advanced it */
  sim: number;
  /** the camera's axes after the step (right, up, fwd) in the flight's frame — the view drawn, the shake turned in */
  cam: [V3, V3, V3];
  /** the camera's axes in the ship's frame (rows: right, up, fwd) — the view's mount on the craft, shaken */
  S: [V3, V3, V3];
  /** the camera shake's turn this frame (camshake.ts) [rad]: yaw, pitch, roll */
  sh: V3;
  /** the display's shake (renderer.shake): the image's offset, a fraction of its width and height */
  ds: [number, number];
  /** the vertical field [deg], the output's size [device px] */
  fov: number;
  W: number;
  H: number;
  /** the render scale, the raster's shading rate (0: none), the live phase */
  scale: number;
  rate: number;
  phase: string;
  /** the renderer's own estimate of the seen ground's slide [px/s] */
  groundPx: number;
  /** the craft's speed [m/s], dynamic pressure [Pa], the pilot's body rates [rad/s] */
  speed: number;
  q: number;
  omega: V3;
  /** the frame's GPU time as the renderer last measured it [ms] */
  gpuMs: number;
  /** the display's refresh (the loop's median interval) [ms] */
  refreshMs: number;
}

export interface ProbeOptions {
  /** the most samples kept (the oldest dropped) */
  max?: number;
}

/** A label for a stretch of the run (a lever set, a view): the samples from `at` on carry it. */
export interface JitterMark {
  at: number;
  label: string;
}

export class JitterProbe {
  active = false;
  private ring: JitterSample[] = [];
  private max = 20_000;
  marks: JitterMark[] = [];
  private count = 0;

  start(o: ProbeOptions = {}) {
    this.max = o.max ?? 20_000;
    this.ring = [];
    this.marks = [];
    this.count = 0;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  /** a label from now on (a lever set, a view — the analysis reads each stretch apart) */
  mark(label: string) {
    this.marks.push({ at: this.ring.length ? this.ring[this.ring.length - 1]!.t : 0, label });
  }

  record(s: JitterSample) {
    if (!this.active) return;
    this.ring.push(s);
    this.count++;
    if (this.ring.length > this.max) this.ring.shift();
  }

  /** The renderer's submit, then its completion (renderer.onSubmitDone): given to the last rendered sample. */
  submitted(sub: number, done: number) {
    if (!this.active) return;
    // (the latest rendered sample begun before this submit: its own — a later turn's began after it)
    for (let i = this.ring.length - 1; i >= 0 && i >= this.ring.length - 8; i--) {
      const r = this.ring[i]!;
      if (r.rendered && Number.isNaN(r.done) && r.t <= sub + 0.5) {
        r.sub = sub;
        r.done = done;
        return;
      }
    }
  }

  samples(): JitterSample[] {
    return this.ring;
  }

  get recorded() {
    return this.count;
  }
}
