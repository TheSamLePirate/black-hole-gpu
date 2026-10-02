// The flight planner's worker (our universe): the transfers' aims take seconds of n-body paths —
// off the frame loop. Built on its own (server.ts, scripts/build-pages.ts) as plan-worker.js.

import { planOurOrbit, planOurTransfer, refineOurNode, type PlanNode, type OurGoal, type OurMission, type PlanOptions } from "./our-plan";
import type { Vec3 } from "../physics";
import { predictOurs } from "./our-predict";
import { loadEphemerides } from "./de440";
import { extendFrom } from "./our-extend";
import { predict, type Massive } from "../geodesic";
import { lensesOf } from "../lenses";
import type { Settings } from "../settings";
import { EntryGuidance, planDeorbit, type EntryCraft, type EntryState } from "../entry";
import { envOf, type EnvDesc } from "../entry-env";
import type { V3 } from "../aero";

export type PlanRequest =
  | { id: number; kind: "transfer"; X: Vec3; V: Vec3; t: number; goal: OurGoal; o: PlanOptions }
  | { id: number; kind: "orbit"; X: Vec3; V: Vec3; t: number; altM: number; o: PlanOptions }
  | { id: number; kind: "refine"; X: Vec3; V: Vec3; t: number; mission: OurMission; node: PlanNode; o: PlanOptions }
  | { id: number; kind: "predict"; X: Vec3; V: Vec3; t: number; mouthR: number; drag?: number }
  | { id: number; kind: "extend"; X: Vec3; V: Vec3; t: number; ref: string; horizon: number }
  | { id: number; kind: "predictPlan"; X: Vec3; V: Vec3; t: number; nodes: { t: number; dv: Vec3 }[]; mouthR: number; accel: number; drag?: number }
  | { id: number; kind: "kerrPath"; s: Settings; st: Massive; tMax: number }
  | { id: number; kind: "deorbit"; env: EnvDesc; craft: EntryCraft; s: EntryState; place: V3; o: Parameters<typeof planDeorbit>[4] }
  | { id: number; kind: "guide"; env: EnvDesc; craft: EntryCraft; s: EntryState; place: V3; g: { bank: number; sign: number; prev: { b: number; e: number } | null; o: { handoverMach: number; short: number } } };

export function runPlan(q: PlanRequest) {
  if (q.kind === "transfer") return planOurTransfer(q.X, q.V, q.t, q.goal, q.o);
  if (q.kind === "orbit") return planOurOrbit(q.X, q.V, q.t, q.altM, q.o);
  // (the ship's free fall for the map and the telemetry: off the frame loop too)
  if (q.kind === "predict") return predictOurs(q.X, q.V, q.t, [], { mouthR: q.mouthR, drag: q.drag });
  // (the map's preview beyond the predictions: patched conics)
  if (q.kind === "extend") return extendFrom(q.X, q.V, q.t, q.ref, q.horizon);
  // (hand-made nodes: the path through them, far — a turn of the orbit after the last burn)
  // (the camera's free fall around the hole, for the overlay's lensed tube: 480 points)
  if (q.kind === "kerrPath") return predict(q.st, q.s.spin, q.tMax, 480, lensesOf(q.s), 1e-7);
  if (q.kind === "predictPlan") return predictOurs(q.X, q.V, q.t, q.nodes, { mouthR: q.mouthR, accel: q.accel, maxSteps: 12000, drag: q.drag });
  // the entry: the deorbit's burn for a site, the guidance's next bank (entry.ts — seconds of
  // predicted falls, and a tenth of a second each second of an entry)
  if (q.kind === "deorbit") {
    const env = envOf(q.env);
    const p = env ? planDeorbit(env, q.craft, q.s, q.place, q.o) : null;
    return p ? { t: p.t, dv: p.dv, miss: p.miss, heat: p.result.heatPeak, shield: p.result.shieldPeak, g: p.result.gPeak } : null;
  }
  if (q.kind === "guide") {
    const env = envOf(q.env);
    if (!env) return null;
    const g = new EntryGuidance(q.g.o);
    Object.assign(g, { bank: q.g.bank, sign: q.g.sign, prev: q.g.prev });
    const bank = g.update(env, q.craft, q.s, q.place);
    return { out: bank, bank: g.bank, sign: g.sign, prev: g.prev, miss: g.lastMiss, path: g.last?.path ?? null };
  }
  return { node: refineOurNode(q.X, q.V, q.t, q.mission, q.node, q.o) };
}

// (in a worker: answer the page's requests)
const g = globalThis as unknown as { document?: unknown; onmessage: unknown; postMessage: (m: unknown) => void };
if (typeof g.document === "undefined" && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  // (the page's ephemerides here too — the requests wait for them: a path predicted around a planet
  // where the models put it, thousands of km from where DE440 does, would not be the page's)
  // (the page sends the files' URLs first: this bundle's own would not be served)
  let ready: Promise<void> = new Promise(() => {});
  g.onmessage = (e: MessageEvent<PlanRequest | { kind: "ephemeris"; urls: string[] }>) => {
    if (e.data.kind === "ephemeris") return void (ready = loadEphemerides(e.data.urls));
    const q = e.data;
    void ready.then(() => {
      try {
        g.postMessage({ id: q.id, result: runPlan(q) });
      } catch (err) {
        g.postMessage({ id: q.id, result: { error: `Planner: ${String(err)}` } });
      }
    });
  };
}
