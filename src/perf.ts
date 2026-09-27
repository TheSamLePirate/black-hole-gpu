// CPU profiler of the frame loop: the time each section takes on the main thread (averaged, and its
// worst over the last seconds), the display's frame rate and the rendered one — with the GPU
// profiler (gpuprof.ts), the game tools' Perf tab and __bh.game.perf().

export interface CpuSection {
  label: string;
  /** mean per loop iteration [ms] (EMA), the worst over the last ~3 s */
  ms: number;
  max: number;
}

export class CpuProfiler {
  private s = new Map<string, { ms: number; max: number; maxAt: number; acc: number }>();
  /** loop iterations and rendered frames per second (EMA) */
  loopFps = 0;
  renderFps = 0;
  private last = 0;
  private rendered = 0;
  private iters = 0;
  private winAt = 0;
  /** the longest main-thread iteration over the last ~3 s [ms] */
  worstLoop = 0;
  private worstAt = 0;
  private loopT0 = 0;

  /** Times a section of this iteration. */
  time<T>(label: string, f: () => T): T {
    const t0 = performance.now();
    try {
      return f();
    } finally {
      this.add(label, performance.now() - t0);
    }
  }
  add(label: string, ms: number) {
    const e = this.s.get(label) ?? { ms: 0, max: 0, maxAt: 0, acc: 0 };
    e.acc += ms;
    this.s.set(label, e);
  }

  /** The loop's iteration starts. */
  begin() {
    this.loopT0 = performance.now();
  }
  /** It ends (rendered: a frame went to the GPU). */
  end(rendered: boolean) {
    const now = performance.now();
    const took = now - this.loopT0;
    if (took > this.worstLoop || now - this.worstAt > 3000) (this.worstLoop = took), (this.worstAt = now);
    for (const e of this.s.values()) {
      e.ms = 0.95 * e.ms + 0.05 * e.acc;
      if (e.acc > e.max || now - e.maxAt > 3000) (e.max = e.acc), (e.maxAt = now);
      e.acc = 0;
    }
    this.iters++;
    if (rendered) this.rendered++;
    if (!this.winAt) this.winAt = now;
    if (now - this.winAt >= 1000) {
      const k = 1000 / (now - this.winAt);
      this.loopFps = this.iters * k;
      this.renderFps = this.rendered * k;
      this.iters = this.rendered = 0;
      this.winAt = now;
    }
    this.last = now;
  }

  table(): CpuSection[] {
    return [...this.s.entries()].map(([label, e]) => ({ label, ms: e.ms, max: e.max })).sort((a, b) => b.ms - a.ms);
  }
}

export const cpuProf = new CpuProfiler();
