import { storageKey } from "./util/storage";

/** Local, bounded graphics diagnostics. No network telemetry and no scene/save data. */
export interface DiagnosticEvent {
  atMs: number;
  stage: string;
  kind: string;
  message: string;
  stack?: string;
}
const KEY = storageKey("kerr.gpu-diagnostic.v1");
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

  constructor(
    private storage?: StorageLike,
    private clock: () => number = () => performance.now(),
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
    this.persist();
  }
  setRuntime(read: () => unknown) {
    this.runtime = read;
  }
  enter(stage: string) {
    if (this.status === "failed") return;
    this.stage = stage;
    this.record("stage", stage);
  }
  ready() {
    if (this.status === "failed") return;
    this.status = "running";
    this.enter("running");
  }
  record(kind: string, error: unknown, fatal = false) {
    if (fatal) this.status = "failed";
    const detail = error && typeof error === "object" && "message" in error ? error : null;
    const name = detail && "name" in detail ? String(detail.name) : detail?.constructor.name;
    const message = (detail ? `${name || "Error"}: ${String(detail.message)}` : String(error)).slice(0, 1024);
    const stack = error instanceof Error ? error.stack?.slice(0, 1024) : undefined;
    this.events.push({ atMs: Math.round(this.clock() - this.startedAt), stage: this.stage, kind, message, stack });
    if (this.events.length > 32) this.events.shift();
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

export function downloadGpuDiagnostic() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(gpuDiagnostics.report(), null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "graphics-diagnostic.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
