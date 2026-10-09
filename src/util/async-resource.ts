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
  private tail = Promise.resolve();
  /** compiles queued or running, a stalled one no longer counted */
  pending = 0;
  /** the longest compile completed so far [ms] */
  private longest = 0;

  constructor(
    private readonly stallMs = 60_000,
    private readonly learn = false,
  ) {}

  /** the stall limit now [ms] (Infinity: none yet) */
  get stallLimit() {
    if (!this.learn) return this.stallMs;
    return this.longest > 0 ? Math.max(this.stallMs, 3 * this.longest) : Number.POSITIVE_INFINITY;
  }

  run<T>(current: () => boolean, compile: () => Promise<T>, onStall: () => void = () => {}): Promise<T | null> {
    this.pending++;
    let freeSlot!: () => void;
    const slot = new Promise<void>((resolve) => (freeSlot = resolve));
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      this.pending--;
      freeSlot();
    };
    const task = this.tail
      .then(() => {
        if (!current()) return null;
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
        return Promise.resolve()
          .then(compile)
          .then((value) => {
            this.longest = Math.max(this.longest, performance.now() - t0);
            return value;
          })
          .finally(() => cancel());
      })
      .finally(release);
    this.tail = slot;
    return task;
  }
}
