// A spacecraft's mission flown (PLAN-VAISSEAUX X11 — game/spacemissions.ts): begun once the page has set its start up,
// its objectives watched in their order (each held a moment), its failures injected at their times, its budget kept
// (the Δv spent, the time) — over it, failed —; at its end its debrief (each objective, the budget), the campaign's
// next chapter opened when a chapter is flown whole.

import type { CameraController } from "../controls";
import { holds } from "../game/spacecourse";
import { CAMPAIGN, objText, SPACE_MISSIONS, type SpaceMission, type SpaceMissionId } from "../game/spacemissions";
import type { RangerStatus } from "../game/status";
import type { FailureKind } from "../game/systems";
import { t, tf } from "../i18n";
import { C_MPS } from "../units";
import { store } from "../util/storage";
import { fixOf } from "./spacecourse";

declare module "../controls" {
  interface CameraController {
    spaceMissionBegin: typeof spaceMissionBegin;
    spaceMissionFrame: typeof spaceMissionFrame;
  }
}

export interface SpaceMissionRun {
  M: SpaceMission;
  i: number;
  t: number;
  spent0: number;
  held: number;
  injected: number;
  /** the messages said so far */
  said: number;
  results: { text: string; ok: boolean; t: number }[];
}

const KEY = "kerr.space.campaign";
/** The campaign's chapters flown whole (the highest). */
export const campaignDone = (): number => store.getJSON<number>(KEY, 0);

/** A mission begun (its start set up by the page): one of ours by its id, or one made (the editor's, a link's). */
function spaceMissionBegin(this: CameraController, id: SpaceMissionId | SpaceMission): string {
  const M = typeof id === "string" ? SPACE_MISSIONS.find((x) => x.id === id) : id;
  if (!M) return t("No such mission");
  this.spaceMission = { M, i: 0, t: 0, spent0: this.spent, held: 0, injected: 0, said: 0, results: [] };
  this.onLessonSay?.(tf("Objective: {0}", objText(M.objectives[0]!)));
  return tf("Mission: {0}", t(M.title));
}

/** One frame of the mission (main.ts, with the flight's status). */
function spaceMissionFrame(this: CameraController, dt: number, st: RangerStatus | null) {
  const R = this.spaceMission;
  if (!R || !this.piloting || !this.s.animate) return;
  const M = R.M;
  R.t += dt;
  // the failures at their times
  const F0 = M.failures ?? [];
  while (R.injected < F0.length && R.t >= F0[R.injected]!.at) this.systemsFail(F0[R.injected++]!.kind as FailureKind);
  // the messages at theirs
  const S0 = M.says ?? [];
  while (R.said < S0.length && R.t >= S0[R.said]!.at) this.onLessonSay?.(t(S0[R.said++]!.text));
  const F = fixOf(this, st);
  const O = M.objectives[R.i];
  const spent = (this.spent - R.spent0) * C_MPS;
  const end = (reason: string | null) => {
    this.spaceMission = null;
    // (the objectives not reached: failed)
    for (let k = R.results.length; k < M.objectives.length; k++) R.results.push({ text: objText(M.objectives[k]!), ok: false, t: R.t });
    const done = R.results.filter((r) => r.ok).length;
    const whole = done === M.objectives.length;
    if (whole && M.chapter && M.chapter > campaignDone()) store.setJSON(KEY, M.chapter);
    const score = (20 * done) / M.objectives.length;
    const lines = R.results.map((r) => ({
      label: r.text,
      value: r.ok ? `✓ ${fmtT(r.t)}` : "✗",
      q: (r.ok ? "good" : "bad") as "good" | "bad",
    }));
    if (M.budget?.dv)
      lines.push({ label: t("Δv spent"), value: `${spent.toFixed(0)} / ${M.budget.dv} m/s`, q: spent <= M.budget.dv ? "good" : "bad" });
    lines.push({ label: t("Time"), value: M.budget?.timeS ? `${fmtT(R.t)} / ${fmtT(M.budget.timeS)}` : fmtT(R.t), q: "good" });
    if (reason) lines.push({ label: t("Ended"), value: reason, q: "bad" });
    if (whole && M.chapter && M.chapter < CAMPAIGN.length)
      lines.push({ label: t("Next chapter"), value: t(CAMPAIGN[M.chapter]!.title), q: "good" });
    this.onFlightReport?.({
      kind: "mission",
      ref: `mission:${M.id}`,
      title: tf("Mission · {0}", t(M.title)),
      score,
      letter: score >= 17 ? "A" : score >= 14 ? "B" : score >= 10 ? "C" : score >= 6 ? "D" : "F",
      lines,
    });
    this.onLessonSay?.(whole ? tf("Mission accomplished: {0}", t(M.title)) : tf("Mission failed: {0}", t(M.title)));
  };
  if (M.budget?.dv && spent > M.budget.dv) return end(t("Δv budget spent"));
  if (M.budget?.timeS && R.t > M.budget.timeS) return end(t("time up"));
  if (!O) return end(null);
  const ok = holds(O.done, { ...F, stepT: R.t });
  R.held = ok ? R.held + dt : 0;
  if (ok && R.held >= 1) {
    R.results.push({ text: objText(O), ok: true, t: R.t });
    this.onPilotMessage?.(tf("✓ {0}", objText(O)));
    R.i++;
    R.held = 0;
    const next = M.objectives[R.i];
    if (next) this.onLessonSay?.(tf("Objective: {0}", objText(next)));
    else end(null);
  }
}

const fmtT = (s: number) => (s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${Math.floor(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installSpaceMission(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { spaceMissionBegin, spaceMissionFrame });
}
