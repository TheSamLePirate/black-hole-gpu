/** An optional resource: explicit terminal failure, bounded waiting, no unhandled rejection.
 * A timed-out WebGPU compilation cannot be cancelled; its late result is deliberately ignored. */
export class AsyncResource<T> {
  state: "idle" | "pending" | "ready" | "failed" = "idle";
  value: T | null = null;
  error: string | null = null;
  private task: Promise<void> | null = null;

  constructor(
    private readonly compile: () => Promise<T>,
    private readonly changed: () => void = () => {},
    private readonly timeoutMs = 180_000,
  ) {}

  start(): Promise<void> {
    if (this.task) return this.task;
    this.state = "pending";
    this.task = new Promise<void>((resolve) => {
      const finish = (value: T | null, error: string | null) => {
        if (this.state !== "pending") return;
        clearTimeout(timer);
        this.value = value;
        this.error = error;
        this.state = error === null ? "ready" : "failed";
        resolve();
        this.changed();
      };
      const timer = setTimeout(() => finish(null, `Compilation timed out after ${this.timeoutMs / 1000} s`), this.timeoutMs);
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
 * A running WebGPU compile cannot be cancelled and retains its slot until it settles. */
export class CompileQueue {
  private tail = Promise.resolve();
  pending = 0;

  run<T>(current: () => boolean, compile: () => Promise<T>): Promise<T | null> {
    this.pending++;
    const task = this.tail
      .then(() => (current() ? compile() : null))
      .finally(() => {
        this.pending--;
      });
    this.tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
}
