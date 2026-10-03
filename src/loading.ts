// What is loading, and how far along: the stages of the start (the GPU, the shaders, the tracer's
// pipelines, the sky, the Ranger, the planets' maps), each with a weight and a fraction done — the
// downloads counted in bytes. The splash screen shows it at start, a small pill afterwards (assets
// loaded on demand: the planets' maps when a scene needs them, the Ranger when it is flown).
// No DOM here: the views subscribe.

export type StageState = "pending" | "active" | "done" | "failed";

export interface Stage {
  id: string;
  label: string;
  /** share of the whole start */
  weight: number;
  state: StageState;
  /** fraction done (downloads: bytes; otherwise set by the code, or eased while indeterminate) */
  frac: number;
  /** bytes received / expected (0: unknown) */
  loaded: number;
  total: number;
  /** no measurable progress: eased towards 1 over ~`eta` seconds */
  indeterminate: boolean;
  eta: number;
  startedAt: number;
  error?: string;
}

class LoadTracker {
  private stages = new Map<string, Stage>();
  private listeners = new Set<() => void>();
  private queued = false;

  /** Registers a stage (again: re-opens it, e.g. assets reloaded later). */
  stage(id: string, label: string, o: { weight?: number; indeterminate?: boolean; eta?: number } = {}) {
    const s: Stage = {
      id,
      label,
      weight: o.weight ?? 1,
      state: "active",
      frac: 0,
      loaded: 0,
      total: 0,
      indeterminate: o.indeterminate ?? false,
      eta: o.eta ?? 3,
      startedAt: performance.now(),
    };
    this.stages.set(id, s);
    this.emit();
    return s;
  }

  set(id: string, frac: number) {
    const s = this.stages.get(id);
    if (!s || s.state !== "active") return;
    s.frac = Math.max(s.frac, Math.min(frac, 1));
    this.emit();
  }

  done(id: string) {
    const s = this.stages.get(id);
    if (!s || s.state === "done") return;
    s.state = "done";
    s.frac = 1;
    this.emit();
  }

  fail(id: string, e: unknown) {
    const s = this.stages.get(id);
    if (!s) return;
    s.state = "failed";
    s.error = e instanceof Error ? e.message : String(e);
    this.emit();
  }

  /** Runs `p` as the stage `id` (registered if needed): done or failed when it settles. */
  track<T>(id: string, label: string, p: Promise<T>, o?: { weight?: number; indeterminate?: boolean; eta?: number }): Promise<T> {
    if (!this.stages.has(id) || this.stages.get(id)!.state !== "active") this.stage(id, label, o);
    return p.then(
      (v) => (this.done(id), v),
      (e) => {
        this.fail(id, e);
        throw e;
      },
    );
  }

  /**
   * fetch() whose body is counted into the stage `id` (its bytes / Content-Length; a compressed
   * transfer's length is not the body's, so it then counts as unknown).
   */
  async fetch(url: string, id: string): Promise<Response> {
    const res = await fetch(url);
    const s = this.stages.get(id);
    if (!s || !res.ok || !res.body) return res;
    const enc = res.headers.get("content-encoding");
    const len = enc && enc !== "identity" ? 0 : Number(res.headers.get("content-length")) || 0;
    s.total += len;
    if (!len) s.indeterminate = true;
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      pull: async (ctrl) => {
        const { done, value } = await reader.read();
        if (done) return ctrl.close();
        s.loaded += value.byteLength;
        // (the download is most of the stage; decoding and uploading the rest)
        if (s.total && !s.indeterminate) s.frac = Math.max(s.frac, 0.92 * Math.min(s.loaded / s.total, 1));
        this.emit();
        ctrl.enqueue(value);
      },
      cancel: (r) => reader.cancel(r),
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  /** The stages, in the order they were registered. */
  list(): Stage[] {
    return [...this.stages.values()];
  }

  /** A stage's fraction now (the indeterminate ones eased along 1 − e^(−t/eta), never quite 1). */
  fracOf(s: Stage, now = performance.now()) {
    if (s.state === "done" || s.state === "failed") return 1;
    if (!s.indeterminate) return s.frac;
    return Math.max(s.frac, 0.95 * (1 - Math.exp(-(now - s.startedAt) / 1000 / s.eta)));
  }

  /** The start's progress, 0…1, by weight. */
  progress(now = performance.now()) {
    let w = 0,
      f = 0;
    for (const s of this.stages.values()) {
      w += s.weight;
      f += s.weight * this.fracOf(s, now);
    }
    return w ? f / w : 0;
  }

  /** Stages still running. */
  get pending() {
    return this.list().filter((s) => s.state === "active");
  }

  on(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      for (const f of this.listeners) f();
    });
  }
}

export const loading = new LoadTracker();
