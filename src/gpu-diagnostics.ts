import { storageKey } from "./util/storage";

/** Local, bounded graphics diagnostics. No network telemetry and no scene/save data. */
export interface DiagnosticEvent {
  atMs: number;
  stage: string;
  kind: string;
  message: string;
  stack?: string;
  /** the same kind and message seen again: counted rather than listed (an error every frame) */
  count?: number;
  lastAtMs?: number;
}
const KEY = storageKey("kerr.gpu-diagnostic.v1");
const MAX_EVENTS = 32;
const PERSIST_DELAY_MS = 1000;
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class GpuDiagnostics {
  stage = "startup";
  status: "starting" | "running" | "failed" = "starting";
  private events: DiagnosticEvent[] = [];
  private context: Record<string, unknown> = {};
  private previous: unknown = null;
  private startedAt: number;
  private timestamp = new Date().toISOString();
  private runtime: () => unknown = () => null;
  private persistQueued = false;

  constructor(
    private storage?: StorageLike,
    private clock: () => number = () => performance.now(),
    /** (a non-fatal record's write deferred: the storage is synchronous, and an error can come every frame) */
    private later: (write: () => void) => void = (write) => void setTimeout(write, PERSIST_DELAY_MS),
  ) {
    this.startedAt = clock();
    try {
      const raw = storage?.getItem(KEY);
      if (raw && raw.length <= 100_000) {
        const old = JSON.parse(raw);
        if (old?.version === 1 && old.status !== "running") this.previous = old;
      }
    } catch {
      /* Storage can be disabled or corrupt. */
    }
  }
  setContext(context: Record<string, unknown>) {
    Object.assign(this.context, context);
    this.persistSoon();
  }
  setRuntime(read: () => unknown) {
    this.runtime = read;
  }
  /** A start's stage: written at once — a hung driver may never give the page another turn. */
  enter(stage: string) {
    if (this.status === "failed") return;
    this.stage = stage;
    this.add("stage", stage);
    this.persist();
  }
  ready() {
    if (this.status === "failed") return;
    this.status = "running";
    this.enter("running");
  }
  /** An event: a fatal one written at once, the others with the next deferred write. */
  record(kind: string, error: unknown, fatal = false) {
    if (fatal) this.status = "failed";
    this.add(kind, error);
    if (fatal) this.persist();
    else this.persistSoon();
  }
  /** The diagnostic written now (the page going away). */
  flush() {
    this.persist();
  }
  snapshot() {
    let runtime: unknown = null;
    try {
      runtime = this.runtime();
    } catch {
      /* Renderer may be incomplete. */
    }
    return {
      version: 1,
      timestamp: this.timestamp,
      status: this.status,
      stage: this.stage,
      elapsedMs: Math.round(this.clock() - this.startedAt),
      context: { ...this.context },
      events: this.events.map((event) => ({ ...event })),
      runtime,
    };
  }
  report() {
    return { ...this.snapshot(), previousIncompleteSession: this.previous };
  }
  private add(kind: string, error: unknown) {
    const detail = error && typeof error === "object" && "message" in error ? error : null;
    // (the error's own name first: a minified build renames classes, and GPU errors are not Errors)
    const named = detail && "name" in detail && typeof detail.name === "string" && detail.name ? detail.name : null;
    const name = named ?? detail?.constructor?.name;
    const message = (detail ? `${name || "Error"}: ${String(detail.message)}` : String(error)).slice(0, 1024);
    const atMs = Math.round(this.clock() - this.startedAt);
    const same = this.events.find((event) => event.kind === kind && event.message === message);
    if (same) {
      same.count = (same.count ?? 1) + 1;
      same.lastAtMs = atMs;
      return;
    }
    const stack = error instanceof Error ? error.stack?.slice(0, 1024) : undefined;
    this.events.push({ atMs, stage: this.stage, kind, message, stack });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }
  private persistSoon() {
    if (this.persistQueued) return;
    this.persistQueued = true;
    this.later(() => {
      this.persistQueued = false;
      this.persist();
    });
  }
  private persist() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.snapshot()));
    } catch {
      /* Never break startup for diagnostics. */
    }
  }
}
let storage: StorageLike | undefined;
try {
  storage = globalThis.localStorage;
} catch {
  /* Private browsing policy. */
}
export const gpuDiagnostics = new GpuDiagnostics(storage);

/**
 * Where a page-wide error goes (window "error", "unhandledrejection"). Before the first image it ends
 * the start: a diagnostic rather than an endless splash. After it the flight goes on — a stray throw
 * in a promise chain, an extension's script, a "ResizeObserver loop" must not stop the loop and lose
 * the flight since the last autosave (audit H1): recorded, not fatal, the player told once per kind.
 * (The browser's console keeps its own report of the error: nothing is prevented.)
 */
export function globalErrorRouter(o: {
  started: () => boolean;
  fatal: (kind: string, error: unknown) => void;
  record: (kind: string, error: unknown) => void;
  notify: (kind: string) => void;
}): (kind: string, error: unknown) => void {
  const told = new Set<string>();
  return (kind, error) => {
    if (!o.started()) return o.fatal(kind, error);
    o.record(kind, error);
    if (told.has(kind)) return;
    told.add(kind);
    o.notify(kind);
  };
}

export function downloadGpuDiagnostic() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(gpuDiagnostics.report(), null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "graphics-diagnostic.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
