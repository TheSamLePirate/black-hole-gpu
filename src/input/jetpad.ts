// The F-35 on an Xbox 360 pad (a fighter's layout, the pad's standard mapping) — pure: the pad's state each frame in,
// the flight's inputs, the head's look, the zoom and the actions out.
//
//   left stick      pitch (back: nose up) · roll                 L3  afterburner
//   right stick     the head: look about — back ahead when let go  R3  zoom (held)
//   RT · LT         throttle up · down                           LB · RB  rudder left · right
//   A  gun (held)   B  fire the weapon (release; else: acknowledge)  X  next weapon
//   Y  tap: lock the next target · hold: the intercept
//   D-pad ▲ gear  ▼ flaps  ◀ flares and chaff  ▶ airbrake
//   View  tap: the camera's view · hold: the head locked on the target     Menu  tap: the autopilot's holds · hold: the settings
//   LB + RB held together   the designation cursor (TDC — input/tdc.ts): the right stick moves it (the head stays),
//                           A designates under it (no gun then)
//
// The A320 on the same pad (an airliner's layout — audit FX-07: it had the general one, a spacecraft's, its stick yawing,
// X and Y the orbital holds): the sticks, the bumpers' rudder, the triggers' thrust levers and the head the same; no gun,
// no weapon, no lock, no cursor —
//   A  A/THR   B  acknowledge   X  the autobrake (its setting in turn)   Y  pushback (on the ground)   L3  the reversers
//   D-pad ▲ gear  ▼ flaps (a notch)  ▶ speed brakes   View  tap: the camera's view   Menu  tap: the autopilot · hold: the settings
// — the keymap's actions, through the keys' own guards (the reversers on the ground only, the A320's FCU for the AP).
//
// Shaped for a fighter: the sticks' fine centre (their curve), the rudder eased in rather than banged, the head's
// look a spring — where the stick points, back ahead as it is let go —, the zoom eased in and out.

import type { PadState } from "../gamepad";

export const JETPAD = {
  /** the head's reach: right and left, up, down [°] */
  lookYaw: 150,
  lookUp: 80,
  lookDown: 45,
  /** the head's and the zoom's easing time [s] */
  lookTau: 0.09,
  zoomTau: 0.12,
  /** the rudder's ramp to full [s] */
  rudderRamp: 0.25,
  /** a press held this long is a hold, not a tap [s] */
  hold: 0.4,
  /** the zoom's field: the view's over this */
  zoom: 2.5,
};

/** An action for the app: a keymap action and its argument, or the pad's own (lock, intercept, settings). */
export interface JetPadAction {
  action: string;
  arg?: string;
}

export interface JetPadOut {
  pitch: number;
  roll: number;
  yaw: number;
  /** the throttle's rate (−1 … 1: RT up, LT down — the keys' and the pad's way, incremental) */
  throttle: number;
  /** the gun's trigger held */
  gun: boolean;
  /** the designation cursor held (LB + RB together); its slew (the right stick: x right, y up) */
  tdc: boolean;
  tdcSlew: [number, number];
  /** the head's look now [°]: right +, up + */
  lookYaw: number;
  lookPitch: number;
  /** the zoom now: 0 none … 1 full (the field over JETPAD.zoom) */
  zoom: number;
  actions: JetPadAction[];
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

/** The layout: a fighter's (the F-35's) or an airliner's (the A320's). */
export type JetPadKind = "fighter" | "airliner";

/** Which buttons fire what on their press (tap-or-hold ones apart). */
const ON_PRESS: Partial<Record<number, JetPadAction>> = {
  [B]: { action: "ack" },
  [X]: { action: "combat", arg: "weapon" },
  [UP]: { action: "gear" },
  [DOWN]: { action: "flaps" },
  [LEFT]: { action: "combat", arg: "cm" },
  [RIGHT]: { action: "airBrake" },
  [L3]: { action: "jetSystem", arg: "ab" },
};
/** Tap or hold: what each does (no hold: the tap's on release, however long). */
const TAP_HOLD: Partial<Record<number, [JetPadAction, JetPadAction | null]>> = {
  [Y]: [{ action: "lock" }, { action: "intercept" }],
  [MENU]: [{ action: "jetSystem", arg: "ap" }, { action: "settings" }],
  [VIEW]: [{ action: "mount" }, { action: "combat", arg: "padlock" }],
};
/** The airliner's (the A320's): the jet's own keymap actions (controller/a320.ts, a320ap.ts behind them). */
const AIRLINER_PRESS: Partial<Record<number, JetPadAction>> = {
  [A]: { action: "jetSystem", arg: "athr" },
  [B]: { action: "ack" },
  [X]: { action: "jetSystem", arg: "stovl" },
  [Y]: { action: "pushback" },
  [UP]: { action: "gear" },
  [DOWN]: { action: "flaps" },
  [RIGHT]: { action: "airBrake" },
  [L3]: { action: "jetSystem", arg: "ab" },
};
const AIRLINER_TAP_HOLD: Partial<Record<number, [JetPadAction, JetPadAction | null]>> = {
  [MENU]: [{ action: "jetSystem", arg: "ap" }, { action: "settings" }],
  [VIEW]: [{ action: "mount" }, null],
};

const ease = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

export class JetPad {
  private prev: boolean[] = [];
  private since: number[] = [];
  private fired: boolean[] = [];
  private t = 0;
  private rudder = 0;
  lookYaw = 0;
  lookPitch = 0;
  zoom = 0;

  /** Back to rest (another craft flown, the pad let go). */
  reset() {
    this.prev = [];
    this.since = [];
    this.fired = [];
    this.rudder = 0;
    this.lookYaw = this.lookPitch = this.zoom = 0;
  }

  step(p: PadState, dt: number, kind: JetPadKind = "fighter"): JetPadOut {
    this.t += dt;
    const held = p.held ?? [];
    const on = (i: number) => !!held[i];
    const actions: JetPadAction[] = [];
    const fighter = kind === "fighter";
    const PRESS = fighter ? ON_PRESS : AIRLINER_PRESS;
    const TH = fighter ? TAP_HOLD : AIRLINER_TAP_HOLD;
    // (both bumpers held: the TDC — their rudders cancel anyway; A then designates — the fighter's alone)
    const tdc = fighter && on(LB) && on(RB);
    if (tdc && on(A) && !this.prev[A]) actions.push({ action: "designate" });
    for (let i = 0; i < Math.max(held.length, 16); i++) {
      const now = on(i),
        was = !!this.prev[i];
      if (now && !was) {
        this.since[i] = this.t;
        this.fired[i] = false;
        const a = PRESS[i];
        if (a) actions.push(a);
      }
      const th = TH[i];
      if (th) {
        // (held long enough: the hold's, once; let go before it: the tap's)
        if (th[1] && now && !this.fired[i] && this.t - (this.since[i] ?? this.t) >= JETPAD.hold) {
          this.fired[i] = true;
          actions.push(th[1]);
        }
        if (!now && was && !this.fired[i]) actions.push(th[0]);
      }
    }
    this.prev = [...held];
    // the rudder: eased in and out over a quarter of a second
    const want = (on(RB) ? 1 : 0) - (on(LB) ? 1 : 0);
    const step = dt / JETPAD.rudderRamp;
    this.rudder = want > this.rudder ? Math.min(want, this.rudder + step) : Math.max(want, this.rudder - step);
    // the head: where the right stick points (its edge a little farther), back ahead when it is let go — the TDC held:
    // the stick slews it, the head stays where it was
    if (!tdc) {
      const [rx, ry] = p.look;
      const reach = (x: number) => Math.sign(x) * Math.abs(x) ** 1.2;
      const tYaw = reach(rx) * JETPAD.lookYaw;
      const tPitch = ry >= 0 ? reach(ry) * JETPAD.lookUp : reach(ry) * JETPAD.lookDown;
      this.lookYaw = ease(this.lookYaw, tYaw, dt, JETPAD.lookTau);
      this.lookPitch = ease(this.lookPitch, tPitch, dt, JETPAD.lookTau);
      if (Math.abs(this.lookYaw) < 0.05 && tYaw === 0) this.lookYaw = 0;
      if (Math.abs(this.lookPitch) < 0.05 && tPitch === 0) this.lookPitch = 0;
    }
    this.zoom = ease(this.zoom, on(R3) ? 1 : 0, dt, JETPAD.zoomTau);
    if (this.zoom < 1e-3) this.zoom = 0;
    return {
      // (move: [forward — stick up —, right, RT − LT, LB − RB])
      pitch: -p.move[0],
      roll: p.move[1],
      yaw: this.rudder,
      throttle: p.move[2],
      gun: fighter && on(A) && !tdc,
      tdc,
      tdcSlew: tdc ? [p.look[0], p.look[1]] : [0, 0],
      lookYaw: this.lookYaw,
      lookPitch: this.lookPitch,
      zoom: this.zoom,
      actions,
    };
  }
}
