// Every e2e says what it does, one JSON line per fact, kept after the process ends (docs/E2E.md §4, « Every e2e is
// emitted ») — for a reader outside this repository (the lab's cockpit, Agent Universe) that the live record
// (lib/live.ts: one state, its last 12 events, removed at the end) and the log (no time on its lines, a test's verdict
// matched to its report by order) cannot feed whole:
//   ~/.kerr-lab/events/e2e-<pid>-<start ms>.jsonl   (KERR_EVENTS_DIR moves it)
//   {"v":1,"seq":7,"at":1794915900000,"pid":4242,"host":"kerr-mini","file":"j8-a.e2e.test.ts","k":1,
//    "kind":"step_started","data":{"index":4,"total":60,"name":"paris de jour : tronçon 1/5"}}
// `seq` counts this process's lines from 0; `at` is this machine's clock when the fact was said [ms]; `file` and `k`
// are the test file and the test's place among the tests run (0: the file's setup), as the banner's reference.
//
// Only added to what the harness already does: the banner, the live record, the reports, the waits and the measures
// are as they were. A small synchronous append per fact (a few hundred bytes); a write that fails turns the emitter
// off for the process, silently — an e2e never fails for it. E2E_EMIT=0 leaves it out.
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export const EMIT_VERSION = 1;

/** The facts said (the reader ignores a kind it does not know). */
export type EmitKind =
  | "process" // this process: its command, its folder, its reports' root — the file's first line
  | "suite" // a test file begins: its title, its tests' titles in order, its estimate
  | "test_started" // a test begins (k: 0 the file's setup)
  | "test_ended" // a test ends: its time — its verdict is bun's, in the log, at the same k
  | "step_declared" // app.steps: the whole list, known from the start
  | "step_started" // app.step
  | "step_ended" // app.stepDone: its result
  | "progress" // app.progress: a count against its total, the live values judged
  | "waiting" // the harness's own count in a wait the test said nothing about (null: over)
  | "scenario" // app.scenario
  | "estimate" // app.estimate
  | "shot"; // app.shot: the picture's path, the reference said with it

const DAY = 86_400_000;
/** files of ended processes are kept this long, then removed by the next process that emits */
const KEEP_MS = 14 * DAY;

export class Emitter {
  private seq = 0;
  private path: string | null = null;
  private off: boolean;
  private file = "";
  private k = 0;

  constructor(
    private readonly dir = process.env.KERR_EVENTS_DIR ?? join(homedir(), ".kerr-lab", "events"),
    off = process.env.E2E_EMIT === "0",
    private readonly now: () => number = Date.now,
  ) {
    this.off = off;
  }

  /** Where this process writes (null: nothing said yet, or off). */
  get target(): string | null {
    return this.path;
  }

  /** The test file and the test now under way: stamped on every line from here. */
  at(file: string, k: number) {
    this.file = file;
    this.k = k;
  }

  /** One fact, appended. Never throws. */
  say(kind: EmitKind, data: Record<string, unknown> = {}) {
    if (this.off) return;
    try {
      if (!this.path) this.open();
      this.write(kind, data);
    } catch {
      this.off = true;
    }
  }

  private open() {
    mkdirSync(this.dir, { recursive: true });
    this.sweep();
    this.path = join(this.dir, `e2e-${process.pid}-${this.now()}.jsonl`);
    this.write("process", {
      argv: process.argv.slice(1),
      cwd: process.cwd(),
      reportRoot: process.env.E2E_REPORT_ROOT ?? null,
      headed: process.env.E2E_HEADED ?? null,
    });
  }

  private write(kind: EmitKind, data: Record<string, unknown>) {
    const line = {
      v: EMIT_VERSION,
      seq: this.seq++,
      at: this.now(),
      pid: process.pid,
      host: hostname().replace(/\.local$/, ""),
      file: this.file,
      k: this.k,
      kind,
      data,
    };
    appendFileSync(this.path as string, `${JSON.stringify(line)}\n`);
  }

  /** Old files removed (once per process, at its first line): the folder stays bounded without a service. */
  private sweep() {
    const limit = this.now() - KEEP_MS;
    for (const f of readdirSync(this.dir)) {
      if (!/^e2e-\d+-\d+\.jsonl$/.test(f)) continue;
      const p = join(this.dir, f);
      try {
        if (statSync(p).mtimeMs < limit) unlinkSync(p);
      } catch {}
    }
  }
}

/** This process's emitter (lib/telemetry.ts says the facts). */
export const emitter = new Emitter();
