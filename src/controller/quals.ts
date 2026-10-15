// The CameraController — a carrier qualification flown (game/quals.ts): its passes counted as the LSO grades them
// (the F-35C's traps, the F-35B's vertical recoveries); flown by the autopilot when asked — off the deck (the
// catapult, a short take-off), round and down again — or by the pilot; its result said and its best kept.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { CARRIER, type CarrierId } from "../game/carrier";
import { type QualId, QUALS, qualResult, VL_POINTS } from "../game/quals";
import { f35Variant } from "../f35/variant";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { store } from "../util/storage";
import type { CameraController } from "../controls";

const BEST_KEY = "kerr.quals";

export interface QualRun {
  id: QualId;
  kind: CarrierId;
  variant: "B" | "C";
  need: number;
  auto: boolean;
  passes: { grade: string; points: number; wire?: number }[];
  /** the last grades seen when it began (not counted) */
  seenTrap: unknown;
  seenDeck: unknown;
  /** on the deck since [s of the run] (the next launch after a moment) */
  onDeck: number | null;
  t: number;
  /** refuelled on the deck this time */
  pumped?: boolean;
}

declare module "../controls" {
  interface CameraController {
    qual?: QualRun | null;
    qualLast?: { id: QualId; variant: "B" | "C"; passes: QualRun["passes"]; gpa: number; qualified: boolean } | null;
    qualStart: typeof qualStart;
    qualStep: typeof qualStep;
    qualStop: typeof qualStop;
    /** a swell imposed on the sea [m] (the heavy sea's qualification: the renderer's sea state — sim.ts) */
    seaSwell?: number | null;
  }
}

/** The bests kept: by qualification and variant, the grade point average. */
export function qualBests(): Record<string, { gpa: number; qualified: boolean; at: number }> {
  try {
    return JSON.parse(store.get(BEST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * A qualification begun on a carrier at sea (the nearest; `kind` — the F-35C on the Ford, its wires —): its wind
 * set (the hour is the caller's: game/quals.ts utcHourAt), the F-35B's bring-back fuel; flown by the autopilot when
 * `auto`. What to say.
 */
function qualStart(this: CameraController, id: QualId, o: { kind?: CarrierId; auto?: boolean; passes?: number } = {}): string {
  if (fleet.active !== "f35") return t("Carrier qualification: the F-35's");
  const variant = f35Variant();
  const Q = QUALS[id];
  const kind = o.kind ?? (variant === "C" ? "ford" : (this.carrierNow()[0]?.sp.kind ?? "ford"));
  if (variant === "C" && kind !== "ford") return t("Carrier qualification: the F-35C's on the Ford, its wires");
  if (!this.carrierNow().some((c) => c.sp.kind === kind)) this.carrierSpawn(kind);
  this.s.wind = Q.wind;
  this.seaSwell = Q.swell;
  if (variant === "B") fleet.fuel.f35 = 2000;
  this.qual = {
    id,
    kind,
    variant,
    need: o.passes ?? Q.passes,
    auto: o.auto ?? true,
    passes: [],
    seenTrap: this.trapLast ?? null,
    seenDeck: this.deckLast ?? null,
    onDeck: null,
    t: 0,
  };
  this.onRadio?.(tf("Mother: {0} qualification on {1} — {2} passes. Charlie.", t(Q.name), CARRIER[kind].name, o.passes ?? Q.passes));
  return tf("{0} qualification on {1}", t(Q.name), CARRIER[kind].name);
}

/** The qualification let go. */
function qualStop(this: CameraController) {
  this.qual = null;
  this.seaSwell = null;
}

/** A frame of the qualification: a new grade counted; the autopilot's next leg; its end. */
function qualStep(this: CameraController, dt: number) {
  const Q = this.qual;
  if (!Q) return;
  Q.t += dt;
  // (a pass graded: the F-35C's — a trap, a bolter, a wave-off —, the F-35B's)
  if (Q.variant === "C" && this.trapLast && this.trapLast !== Q.seenTrap) {
    Q.seenTrap = this.trapLast;
    Q.passes.push({ grade: this.trapLast.grade, points: this.trapLast.points, wire: this.trapLast.wire });
  }
  if (Q.variant === "B" && this.deckLast && this.deckLast !== Q.seenDeck) {
    Q.seenDeck = this.deckLast;
    Q.passes.push({ grade: this.deckLast.grade, points: VL_POINTS[this.deckLast.grade] ?? 2 });
  }
  // (on the deck between passes: hot-pumped back to the qualification's fuel — the real ones are, engine running)
  const down0 = !!(this.ourLanded || this.rolling);
  const want = Q.variant === "B" ? 2000 : 5000;
  if (down0 && Q.passes.length < Q.need && !this.trapWire && (fleet.fuel.f35 ?? want) < want - 50 && !Q.pumped) {
    fleet.fuel.f35 = want;
    Q.pumped = true;
    this.onRadio?.(tf("Mother: hot pump — {0} kg.", want));
  }
  if (!down0) Q.pumped = false;
  if (Q.passes.length >= Q.need) {
    const r = qualResult(Q.passes);
    this.qualLast = { id: Q.id, variant: Q.variant, passes: Q.passes, ...r };
    const key = `${Q.id}:${Q.variant}`;
    const bests = qualBests();
    if (!bests[key] || r.gpa > bests[key].gpa) {
      bests[key] = { gpa: r.gpa, qualified: r.qualified, at: Date.now() };
      store.set(BEST_KEY, JSON.stringify(bests));
    }
    this.seaSwell = null;
    this.onRadio?.(
      tf(
        r.qualified
          ? "Mother: {0} qualification — {1} passes, {2} average: qualified."
          : "Mother: {0} qualification — {1} passes, {2} average: not qualified.",
        t(QUALS[Q.id].name),
        Q.passes.length,
        r.gpa.toFixed(2),
      ),
    );
    this.qual = null;
    return;
  }
  if (!Q.auto) return;
  // the autopilot's next leg: off the deck after a moment, then round and down again
  const busy = this.trapRun || this.deckRun || this.catRun || this.stoRun || this.trapWire;
  if (busy) {
    Q.onDeck = null;
    return;
  }
  const down = !!(this.ourLanded || this.rolling);
  if (down) {
    Q.onDeck ??= Q.t;
    if (Q.t - Q.onDeck > 3) {
      Q.onDeck = null;
      if (Q.variant === "C") this.catLaunch(0);
      else this.deckTakeoff();
    }
    return;
  }
  if ((this.geoNow()?.alt ?? 0) > 40) {
    if (Q.variant === "C") this.trapLand(Q.kind);
    else this.deckLand(Q.kind);
  }
}

export function installQuals(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { qualStart, qualStep, qualStop });
}
