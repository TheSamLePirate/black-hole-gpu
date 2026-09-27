// The game's self-audit: checks one can run at any moment (the game tools' Audit tab, or
// __bh.game.audit()) — the ephemeris' velocities against its positions, the ship's state and its
// sphere of influence, the free-fall predictor against Kepler, a saved game's round trip, the
// settings, the frame rate, the steadiness of the ship's light and of the auto exposure, and
// (optional) the flight planner on the current target.

import type { Settings } from "../settings";
import { EPOCH_DATE, SOLAR_BODIES, solarState, M_METRES, M_SECONDS } from "../system/solar";
import { referenceBody } from "../system/our-side";
import { predictOurs } from "../system/our-predict";
import { plan } from "../system/plan-client";
import { elements, type V3 } from "./orbit";
import type { RangerStatus } from "./status";
import type { GameSave } from "./save";

export type Verdict = "pass" | "warn" | "fail" | "skip";
export interface Check {
  id: string;
  name: string;
  verdict: Verdict;
  detail: string;
  value?: number;
  ms?: number;
}
export interface AuditReport {
  at: string;
  sceneDate: string;
  checks: Check[];
  counts: Record<Verdict, number>;
}

export interface AuditContext {
  settings: Settings;
  time: number;
  status: RangerStatus;
  /** the ship's home-frame state (our universe), or null */
  ship: { X: V3; V: V3; ref: string } | null;
  snapshot(): GameSave;
  fps(): number;
  gpuMs(): number;
  /** the ship's light (luminance of the probe's L0) over n frames; null without the ship */
  probeSeries(n: number): Promise<number[] | null>;
  /** the auto exposure over n frames [EV] */
  evSeries(n: number): Promise<number[]>;
  /** errors seen since the page loaded */
  errors(): string[];
}

const C = 299792458;
const verdict = (v: number, warn: number, fail: number): Verdict => (!Number.isFinite(v) ? "fail" : v >= fail ? "fail" : v >= warn ? "warn" : "pass");
const rel = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  const step = Math.max(0, ...xs.slice(1).map((x, i) => Math.abs(x - xs[i]!)));
  return { m, sd: m ? sd / Math.abs(m) : 0, step: m ? step / Math.abs(m) : 0 };
};

export async function runAudit(ctx: AuditContext, o: { planner?: boolean } = {}): Promise<AuditReport> {
  const checks: Check[] = [];
  const t = ctx.time;
  const run = async (id: string, name: string, f: () => Promise<Omit<Check, "id" | "name">> | Omit<Check, "id" | "name">) => {
    const t0 = performance.now();
    try {
      const r = await f();
      checks.push({ id, name, ...r, ms: performance.now() - t0 });
    } catch (e) {
      checks.push({ id, name, verdict: "fail", detail: `threw: ${(e as Error).message ?? e}`, ms: performance.now() - t0 });
    }
  };

  await run("settings", "Settings are finite", () => {
    const bad = Object.entries(ctx.settings).filter(([, v]) => typeof v === "number" && !Number.isFinite(v)).map(([k]) => k);
    return bad.length ? { verdict: "fail", detail: `not finite: ${bad.join(", ")}` } : { verdict: "pass", detail: `${Object.keys(ctx.settings).length} settings` };
  });

  await run("ephemeris", "Ephemeris: velocities match positions", () => {
    // central difference over ±60 s against the analytic velocity, every body
    const h = 60 / M_SECONDS;
    let worst = 0, who = "";
    for (const b of SOLAR_BODIES) {
      const p1 = solarState(b.id, t + h).pos, p0 = solarState(b.id, t - h).pos, v = solarState(b.id, t).vel;
      const e = Math.hypot(...[0, 1, 2].map((i) => (p1[i]! - p0[i]!) / (2 * h) - v[i]!)) * C;
      if (e > worst) (worst = e), (who = b.name);
    }
    return { verdict: verdict(worst, 1, 10), value: worst, detail: `worst ${worst.toFixed(3)} m/s (${who}), ${SOLAR_BODIES.length} bodies` };
  });

  await run("ship", "Ship state is sane", () => {
    const st = ctx.status;
    const issues: string[] = [];
    if (!(st.speed < C)) issues.push(`speed ${st.speed}`);
    if (st.side !== "throat" && st.status !== "landed" && st.altKm < -1) issues.push(`${(-st.altKm).toFixed(1)} km under ${st.soiName}'s surface`);
    if (ctx.ship && !ctx.ship.X.every(Number.isFinite)) issues.push("position not finite");
    return issues.length ? { verdict: "fail", detail: issues.join("; ") } : { verdict: "pass", detail: `${st.label} · ${st.soiName}` };
  });

  await run("soi", "Sphere of influence", () => {
    if (!ctx.ship) return { verdict: "skip", detail: "Gargantua's side: the planets' frames" };
    const ref = referenceBody(ctx.ship.X, t);
    return ref === ctx.ship.ref
      ? { verdict: "pass", detail: `${ref} (the controller agrees)` }
      : { verdict: "warn", detail: `controller: ${ctx.ship.ref}, a (m/M)^0.4 rule: ${ref}` };
  });

  await run("predictor", "Free-fall predictor vs Kepler (one orbit)", () => {
    const sh = ctx.ship;
    const st = ctx.status;
    if (!sh || st.status !== "orbit" || !st.orbit || !Number.isFinite(st.orbit.period)) return { verdict: "skip", detail: "in orbit only" };
    const b = SOLAR_BODIES.find((q) => q.id === sh.ref)!;
    const T = st.orbit.period / M_SECONDS;
    const p = predictOurs(sh.X, sh.V, t, [], { tMax: T, maxSteps: 20000 });
    const k = p.pts.length - 1;
    const B = solarState(sh.ref, p.times[k]!);
    const e1 = elements(b.mass, [0, 1, 2].map((i) => p.pts[k]![i]! - B.pos[i]!) as V3, [0, 1, 2].map((i) => p.vels[k]![i]! - B.vel[i]!) as V3);
    const B0 = solarState(sh.ref, t);
    const e0 = elements(b.mass, [0, 1, 2].map((i) => sh.X[i]! - B0.pos[i]!) as V3, [0, 1, 2].map((i) => sh.V[i]! - B0.vel[i]!) as V3);
    const da = Math.abs(e1.a - e0.a) * M_METRES / 1e3;
    // (the other bodies perturb the orbit: a few km per orbit in low Earth orbit is the Moon and the Sun)
    return { verdict: verdict(da / Math.max(e0.a * M_METRES / 1e3, 1), 1e-3, 1e-2), value: da, detail: `Δa ${da.toFixed(2)} km over one orbit (${(T * M_SECONDS / 60).toFixed(0)} min), ${p.pts.length} steps` };
  });

  await run("save", "Saved game round trip", () => {
    const g = ctx.snapshot();
    const back = JSON.parse(JSON.stringify(g)) as GameSave;
    const diff = Object.keys(g.settings).filter((k) => (g.settings as unknown as Record<string, unknown>)[k] !== (back.settings as unknown as Record<string, unknown>)[k]);
    const size = JSON.stringify(g).length;
    return diff.length ? { verdict: "fail", detail: `changed: ${diff.join(", ")}` } : { verdict: "pass", value: size, detail: `${(size / 1024).toFixed(1)} kB, every setting exact` };
  });

  await run("frame", "Frame rate", () => {
    const f = ctx.fps(), g = ctx.gpuMs();
    return { verdict: f >= 24 ? "pass" : f >= 12 ? "warn" : "fail", value: f, detail: `${f.toFixed(0)} fps · GPU ${g.toFixed(1)} ms per frame` };
  });

  await run("light", "Ship's light is steady", async () => {
    const L = await ctx.probeSeries(40);
    if (!L) return { verdict: "skip", detail: "no ship" };
    const r = rel(L);
    return { verdict: verdict(r.step, 0.03, 0.1), value: r.step, detail: `largest frame-to-frame step ${(100 * r.step).toFixed(2)} %, rms ${(100 * r.sd).toFixed(2)} % (40 frames)` };
  });

  await run("exposure", "Auto exposure is steady", async () => {
    if (!ctx.settings.autoExposure) return { verdict: "skip", detail: "auto exposure off" };
    const ev = await ctx.evSeries(40);
    const step = Math.max(0, ...ev.slice(1).map((x, i) => Math.abs(x - ev[i]!)));
    return { verdict: verdict(step, 0.25, 1), value: step, detail: `${ev.at(-1)!.toFixed(2)} EV, largest step ${step.toFixed(3)} EV (40 frames)` };
  });

  await run("errors", "No errors since loading", () => {
    const e = ctx.errors();
    return e.length ? { verdict: "warn", value: e.length, detail: `${e.length}: ${e.slice(-3).join(" | ").slice(0, 300)}` } : { verdict: "pass", detail: "none" };
  });

  if (o.planner) {
    await run("planner", "Flight planner on the target", async () => {
      const sh = ctx.ship;
      const tgt = String(ctx.settings.target);
      if (!sh || !SOLAR_BODIES.some((b) => b.id === tgt) || tgt === sh.ref) return { verdict: "skip", detail: "a body of ours, other than the one orbited, as the target" };
      const t0 = performance.now();
      const res = await plan<{ error?: string; nodes?: { dv: V3 }[]; note?: string }>({
        kind: "transfer", X: sh.X, V: sh.V, t, goal: { kind: "transfer", target: tgt, arrival: "orbit", altM: 200e3, returnAltM: 200e3 },
        o: { lead: 60 / M_SECONDS, mouthR: 0.05, accel: 0 },
      });
      const ms = performance.now() - t0;
      if (res.error || !res.nodes) return { verdict: "fail", detail: res.error ?? "no plan" };
      const dv = res.nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0) * C;
      return { verdict: ms < 20000 ? "pass" : "warn", value: dv, detail: `${res.note} · Δv ${(dv / 1000).toFixed(2)} km/s · ${(ms / 1000).toFixed(1)} s` };
    });
  }

  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 } as Record<Verdict, number>;
  checks.forEach((c) => counts[c.verdict]++);
  const date = new Date(EPOCH_DATE + t * M_SECONDS * 1e3).toISOString().slice(0, 16).replace("T", " ");
  return { at: new Date().toISOString(), sceneDate: date, checks, counts };
}
