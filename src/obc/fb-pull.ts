// Pulling the guest's /dev/fb0 frames without waste (review of 24 Nov 2026): before, the runtime called `vm.frame()` with no
// output buffer every 33 ms — a fresh ~1.2 MB RGBA array each time (640×480) — and bumped its revision even when the guest
// had drawn nothing, so the console's putImageData and the cockpit screens' uploads ran at 30 Hz on a still picture.
//
// Now: one RGBA buffer reused (unkernel's `frame(out)` converts into `out` when its size matches), and unkernel's `frameSeq`
// (WorkerKernel: frames received with new pixels) gates the conversion — unchanged, only `requestFrame()` keeps the next
// frame coming. A kernel without `frameSeq` (on this thread) is still converted each pull, into the same buffer.

/** What the puller needs of an unkernel handle (WorkerKernel has all three; KernelInstance lacks the last two). */
export interface FbFrameSource {
  frame(out?: Uint8ClampedArray): { width: number; height: number; data: Uint8ClampedArray } | null;
  readonly frameSeq?: number;
  requestFrame?(): void;
}

export class FbPuller {
  private buf: Uint8ClampedArray | null = null;
  private lastSeq = -1;
  /** Frames converted (for tests and diagnostics). */
  conversions = 0;

  /**
   * A new frame — its pixels in the puller's reused buffer —, or null when the guest drew nothing new since the last one
   * (`haveFrame`: the caller already holds a frame; without one, the current frame is always converted).
   */
  pull(src: FbFrameSource, haveFrame: boolean): { width: number; height: number; data: Uint8ClampedArray } | null {
    const seq = typeof src.frameSeq === "number" ? src.frameSeq : null;
    if (seq !== null && seq === this.lastSeq && haveFrame) {
      src.requestFrame?.();
      return null;
    }
    const f = src.frame(this.buf ?? undefined);
    if (!f || f.data.byteLength === 0) return null;
    this.buf = f.data;
    // (the sequence read before the conversion: a frame arriving in between is converted once more next pull — harmless)
    if (seq !== null) this.lastSeq = seq;
    this.conversions++;
    return f;
  }

  /** A new display mode: the next pull converts whatever is there. */
  reset(): void {
    this.lastSeq = -1;
  }

  /** The display closed: the buffer is let go. */
  release(): void {
    this.lastSeq = -1;
    this.buf = null;
  }
}
