// The cockpit's chronometer (PLAN-COCKPIT): one button, as an aircraft's — started, stopped (its time held),
// reset. Wall-clock time: what the pilot times (a burn, a leg), as a hand-held one would.

export class Chrono {
  private startedAt: number | null = null;
  private held = 0;

  /** The button pushed: running → stopped; stopped with a time → reset; reset → running. */
  push(now = performance.now()): "started" | "stopped" | "reset" {
    if (this.startedAt !== null) {
      this.held += now - this.startedAt;
      this.startedAt = null;
      return "stopped";
    }
    if (this.held > 0) {
      this.held = 0;
      return "reset";
    }
    this.startedAt = now;
    return "started";
  }

  get running() {
    return this.startedAt !== null;
  }

  /** Its time [s]. */
  seconds(now = performance.now()) {
    return (this.held + (this.startedAt !== null ? now - this.startedAt : 0)) / 1000;
  }
}
