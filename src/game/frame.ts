// The frame cut in guarded stages (audit 2026-11-10, AR-03; strategy §19.5; wave 4.8 — main()'s loop cut by responsibility,
// its first lot): a stage of the frame that throws costs that stage, never the image. Before 13 Nov 2026 some sixty calls ran
// unguarded before renderer.frame: one deterministic exception, thrown again every frame, and nothing was drawn after it — the
// image frozen, the HUD, the sound and the autosave with it (e2e frame-guard: 0 frames in 2 s), the journal flooded.
//
// A stage that throws: its exception caught and counted, said once (a toast and the journal, through `say`), the rest of the frame
// goes on. Failing `setAsideAfter` frames in a row, it is set aside — skipped, its fallback given — and tried again every
// `retryMs`; once it runs through, it is back and said so.

/** a stage's failure said again at most this often [ms] */
const SAY_EVERY_MS = 30_000;

export interface StageState {
  /** exceptions caught, all told */
  failures: number;
  /** failing frames in a row */
  inRow: number;
  /** set aside since (a time of `now`), null while it runs */
  asideSince: number | null;
  /** its last exception's message */
  last: string;
  /** when its failure was last said (a time of `now`) */
  saidAt: number;
}

export interface FrameGuardDeps {
  /** a stage failed for the first time (or again after it had come back), or is back: what to tell */
  say(text: { stage: string; error?: unknown; back?: boolean }): void;
  now?: () => number;
  /** failing frames in a row before it is set aside (default 3) */
  setAsideAfter?: number;
  /** an aside stage tried again after this long [ms] (default 5 000) */
  retryMs?: number;
}

export class FrameGuard {
  private s = new Map<string, StageState>();
  private now: () => number;
  private after: number;
  private retry: number;
  constructor(private d: FrameGuardDeps) {
    this.now = d.now ?? (() => performance.now());
    this.after = d.setAsideAfter ?? 3;
    this.retry = d.retryMs ?? 5000;
  }

  /** Runs a stage of the frame: its value, or `fallback` when it throws or is set aside. */
  run<T>(stage: string, f: () => T, fallback?: T): T | undefined {
    const st = this.s.get(stage);
    const t = this.now();
    if (st?.asideSince != null && t - st.asideSince < this.retry) return fallback;
    try {
      const v = f();
      if (st && (st.inRow > 0 || st.asideSince != null)) {
        const wasAside = st.asideSince != null;
        st.inRow = 0;
        st.asideSince = null;
        if (wasAside) this.d.say({ stage, back: true });
      }
      return v;
    } catch (e) {
      const s = st ?? { failures: 0, inRow: 0, asideSince: null, last: "", saidAt: -Infinity };
      this.s.set(stage, s);
      // (said at its first failure, again only after it had come back and not within half a minute — an intermittent one is
      // not a toast every few frames)
      if (s.inRow === 0 && s.asideSince == null && t - s.saidAt > SAY_EVERY_MS) {
        s.saidAt = t;
        this.d.say({ stage, error: e });
      }
      s.failures++;
      s.inRow++;
      s.last = e instanceof Error ? e.message : String(e);
      if (s.inRow >= this.after) s.asideSince = t;
      return fallback;
    }
  }

  /** the stages that failed, as they stand (TARS's, the tests', the diagnostic's) */
  states(): Record<string, StageState> {
    return Object.fromEntries([...this.s].map(([k, v]) => [k, { ...v }]));
  }
}
