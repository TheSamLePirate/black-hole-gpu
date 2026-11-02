// The lab's state for the dashboard: each machine's Chrome lock, its waiters, its live test Chromes, the remote
// runner's jobs, the flight lab's campaigns — scripts/lab-monitor.ts --json, here and over ssh on kerr-mini and
// kerr-pc (scripts/lib/lab-hosts.ts) — and each one's Chrome mode (~/.kerr-lab/config.json). Polled, the last
// answer kept.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { E2eLive } from "../../tests/e2e/lib/live";
import { LIVE_DIR } from "../../tests/e2e/lib/live";
import { labConfig } from "../lib/chrome-lock";
import { labHost, remoteCommand } from "../lib/lab-hosts";
import { type ThermalBrief, type ThermalSeries, thermalSeries } from "../lib/thermal";

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
  /** its heat now, and its last 15 minutes (docs/THERMAL.md; null: no thermal service) */
  thermal?: ThermalBrief | null;
  heat?: ThermalSeries | null;
  /** what each e2e process is doing now (tests/e2e/lib/live.ts) */
  e2e?: E2eLive[];
  machine?: { chip: string; cores: number };
}

/** A flight-lab campaign's scenario as the dashboard saw it fly: a point per poll —
 *  [ms, km, m/s, vertical m/s, fps|null] — kept while it flies (the campaign's /status has only the last sample). */
export const flightTracks = new Map<
  string,
  { key: string; scenario: string; points: [number, number | null, number | null, number | null, number | null][] }
>();

const numOr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Each campaign's latest sample appended to its scenario's track (a new scenario: a new track). */
function track(where: string, m: MacState) {
  const alive = new Set<string>();
  for (const c of m.campaigns) {
    // biome-ignore lint/suspicious/noExplicitAny: the campaign's /status as lab-monitor relays it
    const st = (c as any).status;
    const id = st?.scenario?.id;
    if (!id) continue;
    const key = `${where}:${c.pid}`;
    alive.add(key);
    let t = flightTracks.get(key);
    if (!t || t.scenario !== id) flightTracks.set(key, (t = { key, scenario: id, points: [] }));
    const T = st.T ?? {};
    const now = Date.now();
    if (t.points.at(-1)?.[0] !== now) t.points.push([now, numOr(T.alt), numOr(T.v), numOr(T.vz), numOr(T.fps)]);
    if (t.points.length > 900) t.points.splice(0, t.points.length - 900);
    // biome-ignore lint/suspicious/noExplicitAny: the track rides with the campaign to the page
    (c as any).track = t.points;
  }
  for (const k of flightTracks.keys()) if (k.startsWith(`${where}:`) && !alive.has(k)) flightTracks.delete(k);
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
    track("here", lab.here!);
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
    track(key, lab[key]!);
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

/**
 * A picture of a running e2e's page, now (tests/e2e/lib/live.ts's peek): the request file made — here, or on the
 * mini over ssh —, the recorder's JPEG waited for (its next pull: ≤ 2 s, longer while the page is held) and kept
 * in remote-results/dash/peeks/. Not on the PC (no POSIX shell to wait with).
 */
export async function peek(where: "here" | "mini", pid: number): Promise<{ url: string; at: number }> {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("a process id");
  const dir = "remote-results/dash/peeks";
  mkdirSync(dir, { recursive: true });
  const out = `${dir}/${where}-${pid}.jpg`;
  // (the last picture removed, the request made, the new one waited for: the recorder writes it whole, by a rename)
  if (where === "here") {
    const jpg = join(LIVE_DIR, `e2e-${pid}.jpg`);
    if (!existsSync(join(LIVE_DIR, `e2e-${pid}.json`))) throw new Error(`no live e2e ${pid} here`);
    rmSync(jpg, { force: true });
    writeFileSync(join(LIVE_DIR, `e2e-${pid}.peek`), "");
    for (let i = 0; i < 60; i++) {
      await Bun.sleep(250);
      if (existsSync(jpg)) {
        await Bun.write(out, Bun.file(jpg));
        return { url: `/files/${out}?t=${Date.now()}`, at: Date.now() };
      }
    }
    rmSync(join(LIVE_DIR, `e2e-${pid}.peek`), { force: true });
    throw new Error("the page did not answer in 15 s (held by a long call?)");
  }
  const L = "~/.kerr-lab/live";
  const script = `test -f ${L}/e2e-${pid}.json || { echo "no live e2e ${pid} there" >&2; exit 3; }
rm -f ${L}/e2e-${pid}.jpg; : > ${L}/e2e-${pid}.peek; i=0
while [ $i -lt 60 ]; do sleep 0.25; if [ -s ${L}/e2e-${pid}.jpg ]; then cat ${L}/e2e-${pid}.jpg; exit 0; fi; i=$((i + 1)); done
rm -f ${L}/e2e-${pid}.peek; echo "the page did not answer in 15 s (held by a long call?)" >&2; exit 4`;
  const p = Bun.spawn(["ssh", ...SSH, HOST, script], { stdout: "pipe", stderr: "pipe" });
  const bytes = new Uint8Array(await new Response(p.stdout).arrayBuffer());
  if ((await p.exited) !== 0 || bytes.length < 100) throw new Error((await new Response(p.stderr).text()).trim() || "no picture");
  await Bun.write(out, bytes);
  return { url: `/files/${out}?t=${Date.now()}`, at: Date.now() };
}

/** A machine's heat over the last minutes, as a chart's series: here from its files, on the mini by its runner's
 *  scripts/thermal.ts over ssh. Kept 20 s (the charts ask often, the samples come every 5 s). */
const heatCache = new Map<string, { at: number; v: ThermalSeries | null }>();
export async function heat(where: "here" | "mini", minutes: number, to?: number): Promise<ThermalSeries | null> {
  const m = Math.min(24 * 60, Math.max(1, Math.round(minutes) || 60));
  // (a window in the past — a test's —: its end; else now, and the cache key moves with the minute)
  const end = to && Number.isFinite(to) ? Math.round(to) : 0;
  const key = `${where}:${m}:${end}`;
  const hit = heatCache.get(key);
  if (hit && (end || Date.now() - hit.at < 20_000)) return hit.v;
  if (heatCache.size > 200) heatCache.clear();
  let v: ThermalSeries | null = null;
  if (where === "here") v = thermalSeries(m, 240, end || Date.now());
  else {
    const h = labHost(HOST);
    const r = await run(
      [
        "ssh",
        ...SSH,
        h.name,
        remoteCommand(
          h,
          `cd ${h.dir}/base 2>/dev/null && ${h.bun} scripts/thermal.ts series --minutes ${m} --points 240${end ? ` --to ${end}` : ""}`,
        ),
      ],
      20_000,
    );
    try {
      v = JSON.parse(r.out.trim().split("\n").at(-1) ?? "null");
    } catch {
      v = null;
    }
  }
  heatCache.set(key, { at: Date.now(), v });
  return v;
}
