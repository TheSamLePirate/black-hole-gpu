// GPU profiler: the time each pass of a frame takes on the GPU (timestamp queries), averaged — for
// the performance tools (the game tools' Perf tab, __bh.game.perf()). Off unless switched on; without
// the "timestamp-query" feature it stays empty.

const MAX_PASSES = 64;

export interface PassTime {
  label: string;
  /** mean over the recent frames [ms], last value, frames seen */
  ms: number;
  last: number;
  n: number;
}

export class GpuProfiler {
  enabled = false;
  readonly supported: boolean;
  private qs: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBuf: GPUBuffer | null = null;
  private labels: string[] = [];
  private reading = false;
  private stats = new Map<string, PassTime>();
  /** the frames profiled; the GPU time of the last one, summed over its passes [ms] */
  frames = 0;
  frameMs = 0;

  constructor(private device: GPUDevice) {
    this.supported = device.features.has("timestamp-query");
    if (!this.supported) return;
    this.qs = device.createQuerySet({ type: "timestamp", count: 2 * MAX_PASSES });
    this.resolveBuf = device.createBuffer({ size: 16 * MAX_PASSES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.readBuf = device.createBuffer({ size: 16 * MAX_PASSES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  private get on() {
    return this.enabled && this.supported && !this.reading;
  }
  /** profile one frame in `every` (timestamps split the GPU's work: ~2–3 % when every frame) */
  every = 8;
  private tick = 0;
  private active = false;

  /** A new frame's passes (call before encoding them). */
  begin() {
    this.active = this.on && this.tick++ % this.every === 0;
    if (this.active) this.labels = [];
    this.timedDone = null;
    this.timedAt = -1;
  }

  /** the pass timed this frame (timed): its time's taker, its index among the labelled ones (−1: alone) */
  private timedDone: ((ms: number) => void) | null = null;
  private timedAt = -1;
  /**
   * One pass timed whether the profiler is on or not, its time handed to `done` once read back — the renderer's refinement
   * sizes its bands on its trace pass's own cost, not the frame's (whose fixed part — the cockpit, the post — is no row's).
   * Nothing without the feature, or while the last read is pending.
   */
  timed<T extends GPUComputePassDescriptor | GPURenderPassDescriptor>(label: string, done: (ms: number) => void, desc?: T): T {
    const d = (desc ?? {}) as T;
    if (this.active && this.on) {
      const out = this.pass(label, d);
      if (out.timestampWrites) {
        this.timedDone = done;
        this.timedAt = this.labels.length - 1;
      }
      return out;
    }
    if (!this.supported || this.reading || this.timedDone) return d;
    this.timedDone = done;
    this.timedAt = -1;
    return { ...d, timestampWrites: { querySet: this.qs!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } };
  }

  /** A pass descriptor's timestamp writes, for a labelled pass (or nothing when off / full). */
  pass<T extends GPUComputePassDescriptor | GPURenderPassDescriptor>(label: string, desc?: T): T {
    const d = (desc ?? {}) as T;
    if (!this.active || !this.on || this.labels.length >= MAX_PASSES) return d;
    const k = this.labels.length;
    this.labels.push(label);
    return { ...d, timestampWrites: { querySet: this.qs!, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } };
  }

  /** At the end of the frame's encoder: resolves the timestamps. */
  end(enc: GPUCommandEncoder) {
    const done = this.timedDone;
    const at = this.timedAt;
    this.timedDone = null;
    if (done && at < 0) {
      // (the timed pass alone, the profiler off this frame)
      enc.resolveQuerySet(this.qs!, 0, 2, this.resolveBuf!, 0);
      enc.copyBufferToBuffer(this.resolveBuf!, 0, this.readBuf!, 0, 16);
      this.reading = true;
      queueMicrotask(() =>
        this.device.queue.onSubmittedWorkDone().then(() =>
          this.readBuf!.mapAsync(GPUMapMode.READ).then(
            () => {
              const t = new BigUint64Array(this.readBuf!.getMappedRange().slice(0, 16));
              this.readBuf!.unmap();
              this.reading = false;
              const ms = Number(t[1]! - t[0]!) / 1e6;
              if (ms >= 0 && ms < 1e4) done(ms);
            },
            () => (this.reading = false),
          ),
        ),
      );
      return;
    }
    if (!this.active || !this.on || !this.labels.length) return;
    const n = 2 * this.labels.length;
    enc.resolveQuerySet(this.qs!, 0, n, this.resolveBuf!, 0);
    enc.copyBufferToBuffer(this.resolveBuf!, 0, this.readBuf!, 0, n * 8);
    this.reading = true;
    const labels = this.labels;
    // (after the submission: read them back)
    queueMicrotask(() =>
      this.device.queue.onSubmittedWorkDone().then(() =>
        this.readBuf!.mapAsync(GPUMapMode.READ).then(
          () => {
            const t = new BigUint64Array(this.readBuf!.getMappedRange().slice(0, n * 8));
            this.readBuf!.unmap();
            this.reading = false;
            let sum = 0;
            const seen = new Map<string, number>();
            labels.forEach((l, i) => {
              const ms = Number(t[2 * i + 1]! - t[2 * i]!) / 1e6;
              if (!(ms >= 0 && ms < 1e4)) return;
              if (i === at) done?.(ms);
              seen.set(l, (seen.get(l) ?? 0) + ms);
              sum += ms;
            });
            for (const [l, ms] of seen) {
              const p = this.stats.get(l) ?? { label: l, ms, last: ms, n: 0 };
              p.ms = p.n ? 0.9 * p.ms + 0.1 * ms : ms;
              p.last = ms;
              p.n++;
              this.stats.set(l, p);
            }
            this.frames++;
            this.frameMs = sum;
          },
          () => (this.reading = false),
        ),
      ),
    );
  }

  /** The realtime trace pass's recent time [ms] (0: not measured). */
  traceMs() {
    const p = this.stats.get("trace");
    return p && p.n > 2 ? p.last : 0;
  }

  /** The passes, most expensive first. */
  table(): PassTime[] {
    return [...this.stats.values()].sort((a, b) => b.ms - a.ms);
  }
  reset() {
    this.stats.clear();
    this.frames = 0;
  }
}
