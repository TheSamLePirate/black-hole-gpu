// The controllers' vibrations (PLAN-HOTAS H5): the flight felt in the hands — a continuous rumble (the engine's
// thrust, the entry's plasma, the rolling on the runway) and impulses (each wheel touching, a boom, the
// transonic shudder, the docking's latches, a crash) — sent to every device that can vibrate (the Gamepad API's
// vibrationActuator: "dual-rumble"; Firefox's hapticActuators: pulse), scaled by the player's setting (0: none).
// Independent of the sound: felt with it off. The mix is pure (hapticMix); the sending throttled (a continuous
// effect renewed every 100 ms, an impulse at once over it).

import { sharedPad } from "../gamepad";

/** What the continuous rumble follows: the throttle applied 0…1, the plasma 0…1, the speed on the wheels
 *  [m/s] (0 off them). */
export interface FeltState {
  throttle: number;
  plasma: number;
  rolling: number;
}

/** A rumble: the strong (low, heavy) motor and the weak (high, light) one, 0…1 each. */
export interface Rumble {
  strong: number;
  weak: number;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** The continuous rumble from the flight: the engine a light buzz with a little weight, the plasma heavy, the
 *  rolling a growing rumble. */
export function hapticMix(s: FeltState): Rumble {
  const th = clamp01(s.throttle),
    pl = clamp01(s.plasma),
    rl = clamp01(s.rolling / 80);
  return {
    strong: clamp01(0.15 * th + 0.6 * pl ** 1.5 + 0.35 * rl),
    weak: clamp01(0.3 * th + 0.3 * pl + 0.15 * rl),
  };
}

/** The impulses: each a rumble and its length [ms]. */
export const IMPULSES = {
  wheel: { strong: 0.7, weak: 0.4, ms: 140 },
  joint: { strong: 0.15, weak: 0.25, ms: 40 },
  boom: { strong: 0.9, weak: 0.6, ms: 300 },
  transonic: { strong: 0.6, weak: 0.3, ms: 600 },
  dock: { strong: 0.8, weak: 0.3, ms: 400 },
  undock: { strong: 0.5, weak: 0.2, ms: 250 },
  crash: { strong: 1, weak: 1, ms: 800 },
} satisfies Record<string, Rumble & { ms: number }>;

export type ImpulseKind = keyof typeof IMPULSES;

type Actuated = Gamepad & {
  vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } | null;
  hapticActuators?: readonly { pulse?: (v: number, ms: number) => Promise<unknown> }[];
};

export class Haptics {
  /** the player's setting, 0…1 */
  intensity = 0.6;
  /** when the continuous rumble was last sent, an impulse's end */
  private sentAt = 0;
  private impulseUntil = 0;
  /** what was sent (tests): the effects issued, the last one */
  stats = { effects: 0, last: null as (Rumble & { ms: number }) | null };

  constructor(private list: () => readonly Gamepad[] = () => sharedPad().list()) {}

  /** The continuous rumble this frame (re-sent every 100 ms, not over an impulse). */
  continuous(r: Rumble, now = performance.now()) {
    if (now < this.impulseUntil || now - this.sentAt < 100) return;
    this.sentAt = now;
    this.send({ ...r, ms: 140 });
  }

  /** An impulse (`k` scales it, 0…1), at once. */
  impulse(kind: ImpulseKind, k = 1, now = performance.now()) {
    const I = IMPULSES[kind];
    const r = { strong: clamp01(I.strong * k), weak: clamp01(I.weak * k), ms: I.ms };
    this.impulseUntil = now + I.ms;
    this.sentAt = now;
    this.send(r);
  }

  private send(r: Rumble & { ms: number }) {
    const g = clamp01(this.intensity);
    const strong = clamp01(r.strong * g),
      weak = clamp01(r.weak * g);
    if (g <= 0 || (strong < 0.01 && weak < 0.01 && (this.stats.last?.strong ?? 0) < 0.01 && (this.stats.last?.weak ?? 0) < 0.01)) return;
    this.stats.effects++;
    this.stats.last = { strong, weak, ms: r.ms };
    for (const p of this.list() as Actuated[]) {
      if (p.vibrationActuator?.playEffect) {
        p.vibrationActuator.playEffect("dual-rumble", { duration: r.ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
      } else if (p.hapticActuators?.[0]?.pulse) {
        p.hapticActuators[0].pulse(Math.max(strong, weak), r.ms).catch(() => {});
      }
    }
  }
}

/** The one haptics of the page. */
export const haptics = new Haptics();
