// A dedicated worker's CPU profile, read from the page's DevTools (PLAN-J8 J8-0 (b): where the scenery worker's 12.7 s and 24 s go —
// computing or waiting for the network): the worker attached (Target.setAutoAttach, flatten — its own session on the page's
// connection, cdp.ts `sendTo`), its Profiler started and stopped round a scene, the samples cut into the scene's phases (the worker's own
// `phases`, cumulative ms from the scene's start), each phase's time busy (script, garbage collection) against idle (waiting: fetches,
// timers, messages), and the functions it was busy in. Rule 3 of CLAUDE.md: `witness` injects a known busy loop and a known wait.
import type { App } from "./app";
import type { CdpProfile } from "./cpu-profile";

export interface WorkerSession {
  sessionId: string;
  url: string;
}

/** each page's attached workers, newest last (an auto-attach listener installed once a page: a worker made again — the scenery's,
 *  at a far placing — comes as a new target, its session replacing the old one's) */
const seen = new WeakMap<App, WorkerSession[]>();
/** the profile's sampling interval [µs] */
const INTERVAL_US = 250;

/**
 * The page's dedicated workers whose script URL matches `match`: the newest session of each. Attached by Target.setAutoAttach, a new
 * worker held at its start (waitForDebuggerOnStart): one matching `profile` has its profiler started before its first line runs, then
 * is let go — a scene's worker made again within a measure is profiled whole (16 Nov 2026: the scenery's worker replaced after a
 * placing, its old session gone at the profile's stop).
 */
export async function attachWorkers(app: App, match: RegExp, profile?: RegExp): Promise<WorkerSession[]> {
  let list = seen.get(app);
  if (!list) {
    const l: WorkerSession[] = [];
    seen.set(app, l);
    list = l;
    // (the workers the Earth data cache attached at the boot — lib/earth-cache.ts: Chrome does not tell a second auto-attach of them;
    // those already running are profiled from now, not from their birth)
    for (const w of app.earth?.attached() ?? []) l.push(w);
    app.cdp.on("Target.attachedToTarget", (p) => {
      const t = p.targetInfo as { type: string; url: string };
      const sid = String(p.sessionId);
      if (t.type !== "worker") {
        void app.cdp.sendTo(sid, "Runtime.runIfWaitingForDebugger").catch(() => {});
        return;
      }
      l.push({ sessionId: sid, url: t.url });
      void (async () => {
        if (profile?.test(t.url)) {
          await app.cdp.sendTo(sid, "Profiler.enable").catch(() => {});
          await app.cdp.sendTo(sid, "Profiler.setSamplingInterval", { interval: INTERVAL_US }).catch(() => {});
          await app.cdp.sendTo(sid, "Profiler.start").catch(() => {});
        }
        await app.cdp.sendTo(sid, "Runtime.runIfWaitingForDebugger").catch(() => {});
      })();
    });
    app.cdp.on("Target.detachedFromTarget", (p) => {
      const i = l.findIndex((w) => w.sessionId === String(p.sessionId));
      if (i >= 0) l.splice(i, 1);
    });
    await app.cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: !!profile, flatten: true });
  }
  for (let i = 0; i < 30 && !list.some((w) => match.test(w.url)); i++) await Bun.sleep(100);
  const newest = new Map<string, WorkerSession>();
  for (const w of list) if (match.test(w.url)) newest.set(w.url, w);
  const out = [...newest.values()];
  for (const w of out) await app.cdp.sendTo(w.sessionId, "Profiler.enable").catch(() => {});
  return out;
}

/** the newest worker matching `match` now (null: none attached) */
export function newestWorker(app: App, match: RegExp): WorkerSession | null {
  const l = seen.get(app) ?? [];
  for (let i = l.length - 1; i >= 0; i--) if (match.test(l[i]!.url)) return l[i]!;
  return null;
}

export async function profileStart(app: App, w: WorkerSession, intervalUs = INTERVAL_US) {
  // (started anew: Profiler.start on a running profile keeps its samples)
  await app.cdp.sendTo(w.sessionId, "Profiler.stop").catch(() => {});
  await app.cdp.sendTo(w.sessionId, "Profiler.setSamplingInterval", { interval: intervalUs });
  await app.cdp.sendTo(w.sessionId, "Profiler.start");
}

export async function profileStop(app: App, w: WorkerSession): Promise<CdpProfile & { endTime: number }> {
  const r = await app.cdp.sendTo<{ profile?: CdpProfile & { endTime: number }; error?: { message: string } }>(
    w.sessionId,
    "Profiler.stop",
    {},
    120,
  );
  if (!r.profile) throw new Error(`the worker's profile: none (${r.error?.message ?? JSON.stringify(r).slice(0, 200)})`);
  return r.profile;
}

const IDLE = /^\((idle|program)\)$/;

/** The profile's samples as [time µs since its start, busy, function] */
function samples(pr: CdpProfile) {
  const node = new Map(pr.nodes.map((n) => [n.id, n]));
  const out: { t: number; dt: number; busy: boolean; fn: string }[] = [];
  let t = 0;
  for (let i = 0; i < pr.samples.length; i++) {
    t += pr.timeDeltas[i] ?? 0;
    const dt = pr.timeDeltas[i + 1] ?? 0;
    const n = node.get(pr.samples[i]!)!;
    const fn = n.callFrame.functionName || "(anonymous)";
    out.push({ t, dt, busy: !IDLE.test(fn), fn: `${fn} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}` });
  }
  return out;
}

/** Busy and idle ms in [fromUs, toUs) of the profile (µs since its start), and the busiest functions (self ms). */
export function busyBetween(pr: CdpProfile, fromUs: number, toUs: number, top = 6) {
  let busy = 0,
    idle = 0;
  const self = new Map<string, number>();
  for (const s of samples(pr)) {
    if (s.t < fromUs || s.t >= toUs) continue;
    if (s.busy) {
      busy += s.dt;
      self.set(s.fn, (self.get(s.fn) ?? 0) + s.dt);
    } else idle += s.dt;
  }
  const fns = [...self].sort((a, b) => b[1] - a[1]).slice(0, top);
  return { busyMs: busy / 1000, idleMs: idle / 1000, top: fns.map(([f, us]) => ({ fn: f, ms: Math.round(us / 100) / 10 })) };
}

/** The profile's whole span [µs] */
export const spanUs = (pr: CdpProfile & { endTime: number }) => pr.endTime - pr.startTime;

/**
 * A scene's phases cut from a profile ending at the scene's reply: the scene's start `workerMs` before the profile's end less
 * `lagMs` (the reply's way to the test's poll), each phase from the previous one's end (`phases`: cumulative ms from the start).
 */
export function phasesBusy(pr: CdpProfile & { endTime: number }, phases: Record<string, number>, workerMs: number, lagMs: number) {
  const end = spanUs(pr) - lagMs * 1000;
  const start = end - workerMs * 1000;
  const marks = Object.entries(phases)
    .filter(([, v]) => typeof v === "number" && v >= 0 && v <= workerMs + 1)
    .sort((a, b) => a[1] - b[1]);
  const out: { phase: string; wallMs: number; busyMs: number; idleMs: number; top: { fn: string; ms: number }[] }[] = [];
  let prev = 0;
  for (const [name, at] of marks) {
    if (at <= prev) continue;
    const b = busyBetween(pr, start + prev * 1000, start + at * 1000, 4);
    out.push({ phase: name, wallMs: at - prev, busyMs: Math.round(b.busyMs), idleMs: Math.round(b.idleMs), top: b.top });
    prev = at;
  }
  if (workerMs > prev) {
    const b = busyBetween(pr, start + prev * 1000, end, 4);
    out.push({
      phase: "(after the last mark)",
      wallMs: Math.round(workerMs - prev),
      busyMs: Math.round(b.busyMs),
      idleMs: Math.round(b.idleMs),
      top: b.top,
    });
  }
  const all = busyBetween(pr, start, end, 8);
  return {
    phases: out,
    busyMs: Math.round(all.busyMs),
    idleMs: Math.round(all.idleMs),
    top: all.top,
    coveredMs: Math.round((end - Math.max(start, 0)) / 1000),
  };
}

/** Rule 3's witnesses: a busy loop of `ms` in the worker must read ≈ ms busy; a wait of `ms`, ≈ 0 busy. */
export async function witness(app: App, w: WorkerSession, ms = 400) {
  // (a profile already running — a worker profiled from its birth —: profileStart stops it first, this one starts empty)
  await profileStart(app, w);
  await app.cdp.sendTo(w.sessionId, "Runtime.evaluate", {
    expression: `(() => { const t = performance.now(); let x = 0; while (performance.now() - t < ${ms}) x += Math.sqrt(x + 1); return x > 0; })()`,
    returnByValue: true,
  });
  const p1 = await profileStop(app, w);
  await profileStart(app, w);
  await app.cdp.sendTo(w.sessionId, "Runtime.evaluate", {
    expression: `new Promise((ok) => setTimeout(() => ok(1), ${ms}))`,
    awaitPromise: true,
    returnByValue: true,
  });
  const p2 = await profileStop(app, w);
  const b1 = busyBetween(p1, 0, spanUs(p1)),
    b2 = busyBetween(p2, 0, spanUs(p2));
  return { loopBusyMs: Math.round(b1.busyMs), waitBusyMs: Math.round(b2.busyMs), waitIdleMs: Math.round(b2.idleMs), waitTop: b2.top };
}
