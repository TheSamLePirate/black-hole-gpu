// A spacecraft on a pad (PLAN-VAISSEAUX X5 — the Ranger, the Lander, the Endurance; the F-35 has its own: jetpad.ts) —
// pure: the pad's state each frame in, the flight's inputs, the wheel's aim and the actions out.
//
//   left stick      pitch (back: nose up) · yaw — translation: up/down · left/right   L3  RCS mode: rotation ⟷ translation
//   right stick     look about                                                       R3  look ahead
//   RT · LT         throttle up · down — translation: forward · back
//   LB · RB         roll left · right
//   A  SAS           B  tap: acknowledge · hold: stop the tumble (⇧X)
//   X  tap: dock (B) · hold: station keeping (⇧8)
//   Y  tap: next target · hold: the wheel — the right stick picks, A (or Y let go) does it, B goes back
//   D-pad ▲ prograde  ▼ retrograde  ◀ to the target  ▶ radial out · in · normal · anti-normal in turn
//   View  tap: next view · hold: the map           Menu  tap: the pause menu · hold: the mission plan
//
// The translation's mode is the craft's (⇧9, the keys' too — controller/spaceassist.ts translateKeys turns the attitude
// inputs into the RCS's): the pad's L3 flips it.

import type { PadState } from "../gamepad";

export const SPACEPAD = {
  /** a press held this long is a hold, not a tap [s] */
  hold: 0.4,
  /** the wheel's aim: the stick past this picks a sector */
  aimDead: 0.35,
};

/** An action for the app: a keymap action and its argument, or the pad's own (the wheel's, the settings). */
export interface SpacePadAction {
  action: string;
  arg?: string;
}

export interface SpacePadOut {
  pitch: number;
  yaw: number;
  roll: number;
  /** the throttle's rate (−1 … 1, incremental: the keys' way) */
  throttle: number;
  /** the right stick for the look (rate, as the built-in mapping) — none while it aims the wheel */
  look: [number, number];
  /** the wheel open by the pad: the stick's aim (right +, up +), null within its dead zone */
  wheelAim: [number, number] | null;
  actions: SpacePadAction[];
}

// the standard mapping's buttons
const A = 0,
  B = 1,
  X = 2,
  Y = 3,
  LB = 4,
  RB = 5,
  VIEW = 8,
  MENU = 9,
  L3 = 10,
  R3 = 11,
  UP = 12,
  DOWN = 13,
  LEFT = 14,
  RIGHT = 15;

/** The D-pad ▶'s holds in turn. */
export const SIDE_HOLDS = ["radialOut", "radialIn", "normal", "antinormal"] as const;

const ON_PRESS: Partial<Record<number, SpacePadAction>> = {
  [A]: { action: "sas" },
  [L3]: { action: "spaceSystem", arg: "rcsMode" },
  [R3]: { action: "resetShipView" },
  [UP]: { action: "hold", arg: "prograde" },
  [DOWN]: { action: "hold", arg: "retrograde" },
  [LEFT]: { action: "hold", arg: "target" },
  [RIGHT]: { action: "sideHold" },
};
const TAP_HOLD: Partial<Record<number, [SpacePadAction, SpacePadAction]>> = {
  [B]: [{ action: "ack" }, { action: "jetSystem", arg: "recover" }],
  [X]: [
    { action: "auto", arg: "dock" },
    { action: "spaceSystem", arg: "keep" },
  ],
  [Y]: [{ action: "nextTarget" }, { action: "wheelOpen" }],
  [VIEW]: [{ action: "mount" }, { action: "map" }],
  [MENU]: [{ action: "settings" }, { action: "route" }],
};

export class SpacePad {
  private prev: boolean[] = [];
  private since: number[] = [];
  private fired: boolean[] = [];
  private t = 0;
  /** the wheel opened by Y held: the pad drives it until it closes */
  wheel = false;

  /** Back to rest (another craft flown, the pad let go). */
  reset() {
    this.prev = [];
    this.since = [];
    this.fired = [];
    this.wheel = false;
  }

  /** One frame: the pad's state. */
  step(p: PadState, dt: number): SpacePadOut {
    this.t += dt;
    const held = p.held ?? [];
    const on = (i: number) => !!held[i];
    const actions: SpacePadAction[] = [];
    for (let i = 0; i < Math.max(held.length, 16); i++) {
      const now = on(i),
        was = !!this.prev[i];
      const pressed = now && !was,
        released = !now && was;
      if (pressed) {
        this.since[i] = this.t;
        this.fired[i] = false;
      }
      // (the wheel open: A does the sector, B goes back, Y let go does it too — nothing else)
      if (this.wheel) {
        if (pressed && i === A) actions.push({ action: "wheelDo" });
        if (pressed && i === B) actions.push({ action: "wheelBack" });
        if (released && i === Y) actions.push({ action: "wheelDo" });
        continue;
      }
      if (pressed) {
        const a = ON_PRESS[i];
        if (a) actions.push(a);
      }
      const th = TAP_HOLD[i];
      if (th) {
        if (now && !this.fired[i] && this.t - (this.since[i] ?? this.t) >= SPACEPAD.hold) {
          this.fired[i] = true;
          actions.push(th[1]);
          if (th[1].action === "wheelOpen") this.wheel = true;
        }
        if (released && !this.fired[i]) actions.push(th[0]);
      }
    }
    this.prev = [...held];
    const [rx, ry] = p.look;
    const aim = Math.hypot(rx, ry) > SPACEPAD.aimDead ? ([rx, ry] as [number, number]) : null;
    // (move: [forward — stick up —, right, RT − LT, LB − RB])
    return {
      pitch: this.wheel ? 0 : -p.move[0],
      yaw: this.wheel ? 0 : p.move[1],
      roll: this.wheel ? 0 : (on(RB) ? 1 : 0) - (on(LB) ? 1 : 0),
      throttle: this.wheel ? 0 : p.move[2],
      look: this.wheel ? [0, 0] : [rx, ry],
      wheelAim: this.wheel ? aim : null,
      actions,
    };
  }

  /** The wheel closed (done, Escape, the pointer's click): the pad flies again. */
  wheelClosed() {
    this.wheel = false;
  }
}
