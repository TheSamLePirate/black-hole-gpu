// The flight planner's worker (our universe): the transfers' aims take seconds of n-body paths —
// off the frame loop. Built on its own (server.ts, scripts/build-pages.ts) as plan-worker.js.

import { planOurOrbit, planOurTransfer, refineOurNode, type PlanNode, type OurGoal, type OurMission, type PlanOptions } from "./our-plan";
import type { Vec3 } from "../physics";
import { predictOurs } from "./our-predict";
import { extendFrom } from "./our-extend";

export type PlanRequest =
  | { id: number; kind: "transfer"; X: Vec3; V: Vec3; t: number; goal: OurGoal; o: PlanOptions }
  | { id: number; kind: "orbit"; X: Vec3; V: Vec3; t: number; altM: number; o: PlanOptions }
  | { id: number; kind: "refine"; X: Vec3; V: Vec3; t: number; mission: OurMission; node: PlanNode; o: PlanOptions }
  | { id: number; kind: "predict"; X: Vec3; V: Vec3; t: number; mouthR: number }
  | { id: number; kind: "extend"; X: Vec3; V: Vec3; t: number; ref: string; horizon: number };

export function runPlan(q: PlanRequest) {
  if (q.kind === "transfer") return planOurTransfer(q.X, q.V, q.t, q.goal, q.o);
  if (q.kind === "orbit") return planOurOrbit(q.X, q.V, q.t, q.altM, q.o);
  // (the ship's free fall for the map and the telemetry: off the frame loop too)
  if (q.kind === "predict") return predictOurs(q.X, q.V, q.t, [], { mouthR: q.mouthR });
  // (the map's preview beyond the predictions: patched conics)
  if (q.kind === "extend") return extendFrom(q.X, q.V, q.t, q.ref, q.horizon);
  return { node: refineOurNode(q.X, q.V, q.t, q.mission, q.node, q.o) };
}

// (in a worker: answer the page's requests)
const g = globalThis as unknown as { document?: unknown; onmessage: unknown; postMessage: (m: unknown) => void };
if (typeof g.document === "undefined" && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== "undefined") {
  g.onmessage = (e: MessageEvent<PlanRequest>) => {
    try {
      g.postMessage({ id: e.data.id, result: runPlan(e.data) });
    } catch (err) {
      g.postMessage({ id: e.data.id, result: { error: `Planner: ${String(err)}` } });
    }
  };
}
