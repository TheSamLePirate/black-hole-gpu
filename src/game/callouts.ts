// The landing's callouts (PLAN-TARS T2) — the craft's own voice, as an airliner's: the radio heights going
// down (300, 100, 50, 40, 30, 20, 10 m), "minimums" at the decision height on a runway's final, "sink rate"
// past the descent's envelope, "pull up" with the ground seconds away, and the HUD's warnings said once as
// they come (the gear, the stall, the fuel, the heat, the load, a collision course). Pure: a frame's state
// in, the lines to say out; each height said once going down (re-armed 20 % back above it), each warning
// once while it lasts.
//
// The envelope is the Ranger's steep glide, measured on the entry autopilot's own landings at Edwards (the
// greatest sink in each band of height, three approaches): 52 m/s down from 700 to 300 m, 38 at 200–300 m,
// 26 at 100–150 m, 19 at 70–100 m, 10 at 50–70 m, under 4 below 50 m — "sink rate" past 1.4 times that, as a
// GPWS's mode 1 is set for its own aircraft; "pull up" past 1.3 times the envelope, or the ground 2.5 s away.

import { t } from "../i18n";
import type { VoiceLine } from "../audio/voice";

export interface CalloutInput {
  /** flying (not landed, not rolling), a world's ground below */
  inAir: boolean;
  /** the height over the ground [m] (the gear's), and its rate [m/s, up > 0] */
  agl: number;
  vz: number;
  /** on a runway's final (the decision height then said), the height over its threshold [m] */
  final: boolean;
  hp?: number;
  /** the decision height [m] (procedures.ts RUNWAY_DH) */
  dh: number;
  /** the HUD's alerts now (hud/alerts.ts): their ids and levels */
  alerts: { id: string; level: string }[];
  /** the wall's clock [ms] (a warning that comes back within 30 s not said again) */
  now?: number;
}

/** The radio heights called going down [m]. */
export const HEIGHTS = [300, 100, 50, 40, 30, 20, 10] as const;

const HEIGHT_TEXT: Record<number, () => string> = {
  300: () => t("Three hundred"),
  100: () => t("One hundred"),
  50: () => t("Fifty"),
  40: () => t("Forty"),
  30: () => t("Thirty"),
  20: () => t("Twenty"),
  10: () => t("Ten"),
};

/** The sink rate past which "sink rate" is called [m/s], at a height over the ground (none above 700 m). */
export function sinkLimit(agl: number): number {
  const T: [number, number][] = [
    [10, 6],
    [30, 7],
    [50, 8],
    [70, 14],
    [100, 27],
    [150, 37],
    [200, 44],
    [300, 53],
    [500, 72],
    [700, 73],
  ];
  if (agl > 700) return Infinity;
  if (agl <= T[0]![0]) return T[0]![1];
  for (let i = 1; i < T.length; i++) {
    const [h1, v1] = T[i]!;
    const [h0, v0] = T[i - 1]!;
    if (agl <= h1) return v0 + ((v1 - v0) * (agl - h0)) / (h1 - h0);
  }
  return T[T.length - 1]![1];
}

/** The HUD's warnings said aloud (the others shown only). */
const SPOKEN: Record<string, () => string> = {
  gear: () => t("Too low, gear!"),
  stall: () => t("Stall! Stall!"),
  "fuel-empty": () => t("Fuel empty"),
  "fuel-low": () => t("Fuel low"),
  shield: () => t("Shield temperature"),
  hull: () => t("Hull temperature"),
  load: () => t("Overload"),
  horizon: () => t("Event horizon ahead"),
};

export class Callouts {
  /** the heights armed (said when crossed going down) */
  private armed = new Set<number>(HEIGHTS);
  private dhArmed = true;
  private sinking = false;
  private pulling = false;
  private warned = new Set<string>();
  /** when each warning was last said [ms] */
  private saidAt = new Map<string, number>();

  /** A new flight: everything armed again. */
  reset() {
    this.armed = new Set(HEIGHTS);
    this.dhArmed = true;
    this.sinking = this.pulling = false;
    this.warned.clear();
    this.saidAt.clear();
  }

  update(i: CalloutInput): VoiceLine[] {
    const out: VoiceLine[] = [];
    // the warnings: each said as it comes, once while it lasts
    const now = new Set(i.alerts.filter((a) => a.level === "warning" || a.level === "caution").map((a) => a.id));
    const wall = i.now ?? 0;
    for (const id of now)
      if (SPOKEN[id] && !this.warned.has(id) && !(i.now !== undefined && wall - (this.saidAt.get(id) ?? -Infinity) < 30_000)) {
        this.saidAt.set(id, wall);
        out.push({ id: `alert-${id}`, text: SPOKEN[id]!(), speaker: "callout", priority: 0 });
      }
    this.warned = new Set([...now].filter((id) => SPOKEN[id]));
    if (!i.inAir || !Number.isFinite(i.agl)) {
      if (!i.inAir) {
        this.armed = new Set(HEIGHTS);
        this.dhArmed = true;
      }
      this.sinking = this.pulling = false;
      return out;
    }
    // the ground seconds away, low: "pull up" (not in the flare: within 30 m it is the landing)
    const tti = i.vz < 0 ? i.agl / -i.vz : Infinity;
    const pull = i.agl > 30 && i.agl < 500 && (tti < 2.5 || -i.vz > 1.3 * sinkLimit(i.agl));
    if (pull && !this.pulling) out.push({ id: "pull-up", text: t("Terrain! Pull up!"), speaker: "callout", priority: 0 });
    this.pulling = pull;
    // the descent past its envelope
    const sink = !pull && i.vz < -sinkLimit(i.agl);
    if (sink && !this.sinking) out.push({ id: "sink-rate", text: t("Sink rate!"), speaker: "callout", priority: 0 });
    this.sinking = sink;
    // the decision height on a runway's final (the height over the threshold), once going down
    const hp = i.final ? (i.hp ?? i.agl) : NaN;
    if (i.final && this.dhArmed && hp <= i.dh && i.vz < 0) {
      this.dhArmed = false;
      out.push({ id: "minimums", text: t("Minimums"), speaker: "callout", priority: 1, ttl: 2500 });
    } else if (!(hp <= 1.2 * i.dh)) this.dhArmed = true;
    // the radio heights, going down; re-armed 20 % back above (a go-around, a bounce)
    for (const h of HEIGHTS) {
      if (this.armed.has(h) && i.agl <= h && i.vz < -0.3) {
        this.armed.delete(h);
        // (only the lowest crossed in one frame: a frame that jumped two heights says the last)
        for (const o of out) if (o.id?.startsWith("h-")) o.text = "";
        out.push({ id: `h-${h}`, text: HEIGHT_TEXT[h]!(), speaker: "callout", priority: 1, ttl: 1500 });
      } else if (i.agl > 1.2 * h + 5) this.armed.add(h);
    }
    return out.filter((o) => o.text);
  }
}
