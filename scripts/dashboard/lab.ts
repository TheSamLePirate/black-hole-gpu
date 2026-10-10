// The lab's state for the dashboard: each Mac's Chrome lock, its waiters, its live test Chromes, the remote
// runner's jobs, the flight lab's campaigns — scripts/lab-monitor.ts --json, here and over ssh on kerr-mini —
// and each Mac's Chrome mode (~/.kerr-lab/config.json). Polled, the last answer kept.
import { labConfig } from "../lib/chrome-lock";

const HOST = process.env.KERR_REMOTE ?? "kerr-mini";
const RUNNER_DIR = process.env.KERR_REMOTE_DIR ?? "kerr-runner";
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"];

export interface MacState {
  host: string;
  ok: boolean;
  error?: string;
  at: number;
  /** headless | window | kiosk */
  chrome: string;
  lock: { pid: number; label: string; since: number } | null;
  waiting: { pid: number; label: string; since: number }[];
  chromes: { pid: number; elapsed: string; headless: boolean }[];
  jobs: { id: string; state: string; cmd: string; started?: number }[];
  campaigns: { pid: number; out: string; status?: unknown }[];
  tests: { pid: number; elapsed: string; cmd: string }[];
  orphans: { pid: number; elapsed: string; what: string }[];
}

export const lab: { here: MacState | null; mini: MacState | null } = { here: null, mini: null };

const blank = (host: string, error: string): MacState => ({
  host,
  ok: false,
  error,
  at: Date.now(),
  chrome: "?",
  lock: null,
  waiting: [],
  chromes: [],
  jobs: [],
  campaigns: [],
  tests: [],
  orphans: [],
});

async function run(cmd: string[], timeoutMs: number) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  clearTimeout(timer);
  return { code: await p.exited, out, err };
}

export async function pollHere(): Promise<MacState> {
  const r = await run(["bun", "scripts/lab-monitor.ts", "--json"], 15_000);
  try {
    lab.here = { ...JSON.parse(r.out), ok: true, chrome: labConfig().chrome ?? "headless" };
  } catch {
    lab.here = blank("here", r.err.trim().split("\n").pop() || `exit ${r.code}`);
  }
  return lab.here!;
}

export async function pollMini(): Promise<MacState> {
  const r = await run(
    [
      "ssh",
      ...SSH,
      HOST,
      `cd ${RUNNER_DIR}/base 2>/dev/null && ~/.bun/bin/bun scripts/lab-monitor.ts --json; echo; sed -n 's/.*"chrome": *"\\([a-z]*\\)".*/\\1/p' ~/.kerr-lab/config.json 2>/dev/null`,
    ],
    20_000,
  );
  // (the JSON's line, then the mode's — an empty line between when the config has none)
  const lines = r.out.trim().split("\n");
  const json = lines.find((l) => l.startsWith("{"));
  const mode = lines.at(-1)?.startsWith("{") ? "" : lines.at(-1);
  try {
    lab.mini = { ...JSON.parse(json!), ok: true, chrome: mode?.trim() || "headless" };
  } catch {
    lab.mini = blank(HOST, r.err.trim().split("\n").pop() || "unreachable");
  }
  return lab.mini!;
}

/** The mini's health, as `remote.ts doctor` prints it. */
export async function doctor() {
  const r = await run(["bun", "scripts/remote.ts", "doctor"], 60_000);
  return { code: r.code, text: (r.out + r.err).trim() };
}
