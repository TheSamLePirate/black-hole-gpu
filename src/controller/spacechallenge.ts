// A spacecraft's challenge flown (PLAN-VAISSEAUX X10 — game/spacechallenges.ts): begun once the page has set its start
// up, measured each frame (the time, the Δv spent, the greatest load), ended at its goal held a moment — the miss from
// the site then —, or failed past its time; the result, its medal, the best kept on this device, said in a report.

import type { CameraController } from "../controls";
import { holds } from "../game/spacecourse";
import {
  keepBest,
  medalOf,
  scoreText,
  type SpaceBest,
  SPACE_CHALLENGES,
  type SpaceChallenge,
  type SpaceChallengeId,
} from "../game/spacechallenges";
import type { RangerStatus } from "../game/status";
import { t, tf } from "../i18n";
import { solarBody } from "../system/solar";
import { C_MPS, M_METRES } from "../units";
import { store } from "../util/storage";
import { fixOf } from "./spacecourse";

declare module "../controls" {
  interface CameraController {
    spaceChal: SpaceChalRun | null;
    spaceChallengeBegin: typeof spaceChallengeBegin;
    spaceChallengeFrame: typeof spaceChallengeFrame;
  }
}

export type SpaceChalRunPublic = SpaceChalRun;
interface SpaceChalRun {
  C: SpaceChallenge;
  t: number;
  spent0: number;
  gMax: number;
  held: number;
  body: string;
}

const KEY = "kerr.space.bests";
/** The bests kept on this device. */
export const spaceBests = (): Record<string, SpaceBest> => store.getJSON<Record<string, SpaceBest>>(KEY, {});

/** A challenge begun (its start set up by the page). */
function spaceChallengeBegin(this: CameraController, id: SpaceChallengeId): string {
  const C = SPACE_CHALLENGES.find((x) => x.id === id);
  if (!C) return t("No such challenge");
  this.spaceChal = { C, t: 0, spent0: this.spent, gMax: 0, held: 0, body: "" };
  // (the hoverslam: the engine off, falling)
  if (C.freefall) {
    this.pilot.setAuto("none");
    this.pilot.setHold("none");
    this.pilot.throttle = 0;
  }
  return tf("Challenge: {0}", t(C.title));
}

/** The great-circle distance over a body between two places [m] (its mean radius). */
function arcM(body: string, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = (solarBody(body)?.radius ?? 0) * M_METRES;
  const D = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * D) / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(((b.lon - a.lon) * D) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One frame of the challenge (main.ts, with the flight's status). */
function spaceChallengeFrame(this: CameraController, dt: number, st: RangerStatus | null) {
  const R = this.spaceChal;
  if (!R || !this.piloting || !this.s.animate) return;
  const F = fixOf(this, st);
  R.t += dt;
  R.gMax = Math.max(R.gMax, F.g ?? 0);
  if (st?.soi) R.body = st.soi;
  const C = R.C;
  const ok = holds(C.goal, { ...F, stepT: R.t });
  R.held = ok ? R.held + dt : 0;
  const end = (score: number | null) => {
    this.spaceChal = null;
    const lines: { label: string; value: string; q: "good" | "ok" | "bad" }[] = [];
    if (score === null) {
      this.onFlightReport?.({
        kind: "challenge",
        ref: `challenge:${C.id}`,
        title: tf("Challenge · {0}", t(C.title)),
        score: 0,
        letter: "F",
        lines: [{ label: t("Result"), value: t("time up"), q: "bad" }],
      });
      return;
    }
    const medal = medalOf(C, score);
    const B = spaceBests();
    const record = keepBest(B, C, score, Date.now());
    store.setJSON(KEY, B);
    lines.push(
      { label: t("Result"), value: scoreText(C, score), q: medal === "gold" ? "good" : medal ? "ok" : "bad" },
      {
        label: t("Medal"),
        value: medal ? t(medal === "gold" ? "Gold" : medal === "silver" ? "Silver" : "Bronze") : "—",
        q: medal ? "good" : "bad",
      },
      { label: t("Gold under"), value: scoreText(C, C.medals[0]), q: "good" },
      { label: t("Best"), value: `${scoreText(C, B[C.id]!.score)}${record ? ` · ${t("new record")}` : ""}`, q: record ? "good" : "ok" },
    );
    // (a mark out of 20: gold 20, silver 15, bronze 10, none by how far past the bronze's)
    const twenty =
      medal === "gold"
        ? 20
        : medal === "silver"
          ? 15
          : medal === "bronze"
            ? 10
            : Math.max(0, 10 * (1 - (score - C.medals[2]) / C.medals[2]));
    this.onFlightReport?.({
      kind: "challenge",
      ref: `challenge:${C.id}`,
      medal,
      metric: { value: score, text: scoreText(C, score) },
      title: tf("Challenge · {0}", t(C.title)),
      score: twenty,
      letter: twenty >= 17 ? "A" : twenty >= 14 ? "B" : twenty >= 10 ? "C" : twenty >= 6 ? "D" : "F",
      lines,
    });
  };
  if (ok && R.held >= 1) {
    const score =
      C.metric === "time"
        ? R.t
        : C.metric === "dv"
          ? (this.spent - R.spent0) * C_MPS
          : C.metric === "gmax"
            ? R.gMax
            : C.site && F.lat != null && F.lon != null
              ? arcM(R.body, { lat: F.lat, lon: F.lon }, C.site)
              : Number.NaN;
    end(Number.isFinite(score) ? score : null);
  } else if (R.t > C.max) end(null);
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installSpaceChallenge(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { spaceChallengeBegin, spaceChallengeFrame });
}
