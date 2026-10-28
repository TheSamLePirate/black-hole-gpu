// The lab's state for the dashboard: each machine's Chrome lock, its waiters, its live test Chromes, the remote
// runner's jobs, the flight lab's campaigns — scripts/lab-monitor.ts --json, here and over ssh on kerr-mini and
// kerr-pc (scripts/lib/lab-hosts.ts) — and each one's Chrome mode (~/.kerr-lab/config.json). Polled, the last
// answer kept.
import { labConfig } from "../lib/chrome-lock";
import { labHost, remoteCommand } from "../lib/lab-hosts";

const HOST = process.env.KERR_REMOTE ?? "kerr-mini";
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"];

/** The dashboard's names of the remote machines → their ssh aliases. */
export const REMOTES = { mini: HOST, pc: "kerr-pc" } as const;

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

export const lab: { here: MacState | null; mini: MacState | null; pc: MacState | null } = { here: null, mini: null, pc: null };

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

/** A remote machine's state (the mini, the PC): its own monitor over ssh, its Chrome mode with it. */
async function pollRemote(key: keyof typeof REMOTES): Promise<MacState> {
  const h = labHost(REMOTES[key]);
  const r = await run(
    [
      "ssh",
      ...SSH,
      h.name,
      remoteCommand(
        h,
        `cd ${h.dir}/base 2>/dev/null && ${h.bun} scripts/lab-monitor.ts --json; echo; sed -n 's/.*"chrome": *"\\([a-z]*\\)".*/\\1/p' ~/.kerr-lab/config.json 2>/dev/null`,
      ),
    ],
    25_000,
  );
  // (the JSON's line, then the mode's — an empty line between when the config has none)
  const lines = r.out
    .trim()
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
  const json = lines.find((l) => l.startsWith("{"));
  const mode = lines.at(-1)?.startsWith("{") ? "" : lines.at(-1);
  try {
    lab[key] = { ...JSON.parse(json!), ok: true, chrome: mode?.trim() || "headless" };
  } catch {
    lab[key] = blank(h.name, r.err.trim().split("\n").pop() || "unreachable");
  }
  return lab[key]!;
}
export const pollMini = () => pollRemote("mini");
export const pollPc = () => pollRemote("pc");

/** A remote machine's health, as `remote.ts doctor` prints it. */
export async function doctor(key: keyof typeof REMOTES = "mini") {
  const r = await run(["bun", "scripts/remote.ts", "--host", REMOTES[key], "doctor"], 90_000);
  return { code: r.code, text: (r.out + r.err).trim() };
}

/**
 * A flight-lab campaign's control (scripts/flightlab.ts's server, on its Mac's loopback): status, shot, eval,
 * pause, resume, skip, abort, note — here by fetch, on the mini by curl over ssh. A shot's PNG kept in
 * remote-results/dash/flight-shots/ (its path returned).
 */
export async function flightCtl(where: "here" | "mini", port: number, verb: string, body?: string) {
  if (!/^(status|shot|eval|pause|resume|skip|abort|note)$/.test(verb)) throw new Error(`no such control: ${verb}`);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("a campaign's port");
  const url = `http://127.0.0.1:${port}/${verb}`;
  let bytes: Uint8Array;
  if (where === "mini") {
    const p = Bun.spawn(["ssh", ...SSH, HOST, `curl -s --max-time 60 ${body !== undefined ? "--data-binary @-" : ""} '${url}'`], {
      stdin: body !== undefined ? new TextEncoder().encode(body) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    bytes = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    if ((await p.exited) !== 0) throw new Error(`the mini's campaign did not answer (${(await new Response(p.stderr).text()).trim()})`);
  } else {
    const r = await fetch(url, body !== undefined ? { method: "POST", body } : undefined).catch(() => null);
    if (!r) throw new Error(`nothing listens on ${url}`);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  if (verb === "shot") {
    const dir = "remote-results/dash/flight-shots";
    await Bun.$`mkdir -p ${dir}`.quiet();
    const file = `${dir}/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${where}.png`;
    await Bun.write(file, bytes);
    return { url: `/files/${file}` };
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
