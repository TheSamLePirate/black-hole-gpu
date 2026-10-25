import { visibleTimeout } from "./visible-timeout";

/** An optional resource: explicit terminal failure, bounded waiting (in visible time), no unhandled
 * rejection. A timed-out WebGPU compilation cannot be cancelled: its late result is ignored — unless
 * `lateIsCurrent` says it is still wanted, then a late success makes the resource ready after all. */
export class AsyncResource<T> {
  state: "idle" | "pending" | "ready" | "failed" = "idle";
  value: T | null = null;
  error: string | null = null;
  private task: Promise<void> | null = null;

  constructor(
    private readonly compile: () => Promise<T>,
    private readonly changed: () => void = () => {},
    private readonly timeoutMs = 180_000,
    private readonly lateIsCurrent: () => boolean = () => false,
  ) {}

  start(): Promise<void> {
    if (this.task) return this.task;
    this.state = "pending";
    let timedOut = false;
    this.task = new Promise<void>((resolve) => {
      const finish = (value: T | null, error: string | null) => {
        const late = timedOut && this.state === "failed" && error === null && this.lateIsCurrent();
        if (this.state !== "pending" && !late) return;
        cancel();
        this.value = value;
        this.error = error;
        this.state = error === null ? "ready" : "failed";
        resolve();
        this.changed();
      };
      const cancel = visibleTimeout(this.timeoutMs, () => {
        timedOut = true;
        finish(null, `Compilation timed out after ${this.timeoutMs / 1000} s`);
      });
      void Promise.resolve()
        .then(this.compile)
        .then(
          (value) => finish(value, null),
          (error: unknown) => finish(null, (error instanceof Error ? error.message : String(error)) || "Compilation failed"),
        );
    });
    return this.task;
  }
}

/** Serialises costly specialised compiles. Obsolete queued work is skipped before it starts.
 * A running WebGPU compile cannot be cancelled: it keeps its slot until it settles — or, hung past
 * the stall limit of visible time, the queue moves on without it (onStall told; its result still delivered
 * if it ever lands), so one hung driver compile does not hold every later scene's (audit M7).
 * `learn`: the limit follows the driver — none before a first compile has completed (the 15-min start
 * watchdog covers a hung one), then `stallMs` or 3× the longest compile seen, whichever is longer: a
 * slow D3D12 driver's 3-minute compile (RX 5700 XT) is not taken for a hung one, and a second kernel
 * compiled beside it. */
export class CompileQueue {
  /** compiles queued or running, a stalled one no longer counted */
  pending = 0;
  /** the longest compile completed so far [ms] */
  private longest = 0;
  /** the compiles not started yet, in order; `urgent` ones start first (a frame's own kernels before a still view's) */
  private waiting: { urgent: boolean | (() => boolean); start: () => void }[] = [];
  /** a compile holds the slot */
  private running = false;

  constructor(
    private readonly stallMs = 60_000,
    private readonly learn = false,
    /** a compile shorter than this came out of the browser's pipeline cache: it says nothing of the driver's pace [ms] */
    private readonly cacheHitMs = 5_000,
  ) {}

  /** the stall limit now [ms] (Infinity: none yet) */
  get stallLimit() {
    if (!this.learn) return this.stallMs;
    return this.longest > 0 ? Math.max(this.stallMs, 3 * this.longest) : Number.POSITIVE_INFINITY;
  }

  /** the next compile into the free slot: the first urgent one waiting, else the first */
  private pump() {
    if (this.running) return;
    const u = this.waiting.findIndex((j) => (typeof j.urgent === "function" ? j.urgent() : j.urgent));
    const job = this.waiting.splice(u >= 0 ? u : 0, 1)[0];
    if (!job) return;
    this.running = true;
    job.start();
  }

  /**
   * `urgent`: ahead of every compile not started yet — the realtime image's kernels (the raster's shading among them) past a
   * still view's quality kernel queued during a pause: queued behind it, the flight after the pause drew the near Earth with
   * the traced blocks for the minute it took on an M1. A function: asked when the slot frees (a key compiled ahead urgent
   * once it is the frame's own).
   */
  run<T>(
    current: () => boolean,
    compile: () => Promise<T>,
    onStall: () => void = () => {},
    urgent: boolean | (() => boolean) = false,
  ): Promise<T | null> {
    this.pending++;
    return new Promise<T | null>((resolve, reject) => {
      this.waiting.push({
        urgent,
        start: () => {
          let held = true;
          const release = () => {
            if (!held) return;
            held = false;
            this.pending--;
            this.running = false;
            queueMicrotask(() => this.pump());
          };
          if (!current()) {
            release();
            resolve(null);
            return;
          }
          // (checked every stallMs of visible time against the limit, which may have grown meanwhile)
          let cancel = () => {};
          const arm = (waited: number) => {
            cancel = visibleTimeout(this.stallMs, () => {
              const total = waited + this.stallMs;
              if (total < this.stallLimit) return arm(total);
              release();
              onStall();
            });
          };
          arm(0);
          const t0 = performance.now();
          Promise.resolve()
            .then(compile)
            .then((value) => {
              // (a real compile only: one out of the browser's pipeline cache — 0.2 s — set the limit at its floor, the next
              // real one — 90 s on an M1 Max — taken for hung after 60 s, two more started beside it: 379 s for the three)
              const ms = performance.now() - t0;
              if (ms > this.cacheHitMs) this.longest = Math.max(this.longest, ms);
              return value;
            })
            .finally(() => {
              cancel();
              release();
            })
            .then(resolve, reject);
        },
      });
      queueMicrotask(() => this.pump());
    });
  }
}
