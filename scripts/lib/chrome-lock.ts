// One Chrome at a time on a machine — every browser this repository starts (the e2e tests and the flight
// lab through tests/e2e/lib/cdp.ts, the shaders' check, the benches, the galleries) takes this lock first:
// two renderers on one GPU halve each other (the measures with them), and parallel agents, scripts and
// remote jobs once ran four Chromes at once on this Mac.
//
// The lock is ~/.kerr-lab/chrome.lock (a directory: made atomically), its holder in owner.json — pid, what it
// is (its label: the command), where (cwd), since when. A waiter registers in ~/.kerr-lab/wait/ and takes its
// turn in arrival order; a holder or a waiter whose process is gone is cleared. scripts/lab-monitor.ts shows
// all of it, here and on the other Mac.
//
// KERR_CHROME_LOCK=0 skips it (a deliberate exception, e.g. a GPU-free Linux CI runner of its own).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export const LAB_DIR = join(homedir(), ".kerr-lab");
export const LOCK = join(LAB_DIR, "chrome.lock");
export const WAIT = join(LAB_DIR, "wait");

export interface Holder {
  pid: number;
  label: string;
  cwd: string;
  host: string;
  since: number;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const read = (f: string): Holder | null => {
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Holder;
  } catch {
    return null;
  }
};

/** The holder now (null: free), a dead one cleared. */
export function holder(): Holder | null {
  if (!existsSync(LOCK)) return null;
  const h = read(join(LOCK, "owner.json"));
  // (made but not yet written: being taken — a holder, not a free lock)
  if (!h) return { pid: 0, label: "(being taken)", cwd: "", host: hostname(), since: Date.now() };
  if (!alive(h.pid)) {
    rmSync(LOCK, { recursive: true, force: true });
    return null;
  }
  return h;
}

/** The waiters, oldest first (the dead ones cleared). */
export function waiters(): (Holder & { file: string })[] {
  if (!existsSync(WAIT)) return [];
  const out: (Holder & { file: string })[] = [];
  for (const f of readdirSync(WAIT)) {
    const w = read(join(WAIT, f));
    if (!w || !alive(w.pid)) rmSync(join(WAIT, f), { force: true });
    else out.push({ ...w, file: f });
  }
  return out.sort((a, b) => a.since - b.since || a.file.localeCompare(b.file));
}

const defaultLabel = () =>
  (
    process.env.KERR_LAB_LABEL ??
    process.argv
      .slice(1)
      .map((a) => a.replace(/^.*\/(scripts|tests)\//, "$1/"))
      .join(" ")
  ).slice(0, 160);

// (this process's hold: counted — one test may boot a second page while the first is open — and let go
// whatever way the process ends)
let holds = 0;
let hooked = false;
const letGo = () => {
  holds = 0;
  const h = read(join(LOCK, "owner.json"));
  if (h?.pid === process.pid) rmSync(LOCK, { recursive: true, force: true });
};
function hook() {
  if (hooked) return;
  hooked = true;
  process.once("exit", letGo);
  for (const [sig, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const)
    process.once(sig, () => {
      letGo();
      process.exit(code);
    });
}

/**
 * Waits for this machine's Chrome, then holds it: the release given back (and done anyway when the process
 * ends). `label`: what is shown to the others (lab-monitor; their waiting messages). Re-entrant within a
 * process: the lock is let go with its last release.
 */
export async function chromeLock(label = defaultLabel()): Promise<() => void> {
  if (process.env.KERR_CHROME_LOCK === "0") return () => {};
  if (holds > 0 && read(join(LOCK, "owner.json"))?.pid === process.pid) holds++;
  else {
    await take(label);
    holds = 1;
    hook();
  }
  let mine = true;
  return () => {
    if (!mine) return;
    mine = false;
    if (--holds <= 0) letGo();
  };
}

async function take(label: string) {
  mkdirSync(WAIT, { recursive: true });
  const me: Holder = { pid: process.pid, label, cwd: process.cwd(), host: hostname(), since: Date.now() };
  const file = `${me.since}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  writeFileSync(join(WAIT, file), JSON.stringify(me));
  let said = 0;
  try {
    for (;;) {
      const h = holder();
      // (in turn: the oldest waiter takes it)
      const first = waiters()[0];
      if (!h && first?.file === file) {
        try {
          mkdirSync(LOCK);
          writeFileSync(join(LOCK, "owner.json"), JSON.stringify({ ...me, since: Date.now() }));
          return;
        } catch {
          /* (taken in between: wait on) */
        }
      }
      if (Date.now() - said > 30_000) {
        said = Date.now();
        const ahead = waiters().findIndex((w) => w.file === file);
        console.error(
          `chrome-lock: waiting — Chrome held by pid ${h?.pid} (${h?.label ?? "?"}, ${h ? Math.round((Date.now() - h.since) / 1000) : 0} s)${ahead > 0 ? `, ${ahead} ahead` : ""}`,
        );
      }
      await Bun.sleep(500);
    }
  } finally {
    rmSync(join(WAIT, file), { force: true });
  }
}
