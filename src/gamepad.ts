// Game controller (Gamepad API, "standard" mapping: Xbox, PlayStation, …). Polled once per frame.
//
//   left stick      fly: forward / back, left / right (analog)      L3  hold: boost (×4)
//   right stick     around the target: orbit it · free: look         R3  recentre the view
//   RT · LT         up · down                                        LB · RB  roll left · right
//   A  fly to the target   B  gravity   X  auto-orbit   Y  rotation: around ⟷ free
//   D-pad ◀ ▶  previous / next target   ▲ ▼  closer / farther
//   View  run / pause time            Menu  settings

/** Discrete actions (edge-triggered buttons), handled by the app. */
export type PadAction = "focus" | "gravity" | "auto" | "rotation" | "prevTarget" | "nextTarget" | "recentre" | "time" | "settings";

export interface PadState {
  /** [forward, right, up, roll] in −1 … 1, like the flight keys. */
  move: [number, number, number, number];
  /** Right stick: [right, up] in −1 … 1. */
  look: [number, number];
  /** D-pad ▲ (+1) / ▼ (−1), held. */
  zoom: number;
  fast: boolean;
  /** Buttons pressed since the last poll. */
  actions: PadAction[];
  /** Anything moved or pressed this frame. */
  active: boolean;
  id: string;
}

const BUTTONS: Partial<Record<number, PadAction>> = {
  0: "focus", // A
  1: "gravity", // B
  2: "auto", // X
  3: "rotation", // Y
  8: "time", // View / Back
  9: "settings", // Menu / Start
  11: "recentre", // R3
  14: "prevTarget", // D-pad ◀
  15: "nextTarget", // D-pad ▶
};

const DEAD = 0.14;

/** Radial dead zone, rescaled, with a gentle curve for fine control near the centre. */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.pow(Math.min((m - DEAD) / (1 - DEAD), 1), 1.6) / m;
  return [x * k, y * k];
}

const trigger = (v: number) => (v < 0.06 ? 0 : (v - 0.06) / 0.94);

export class GamepadInput {
  private prev: boolean[] = [];
  private index = -1;

  /** The first connected pad with the standard mapping (or any pad), or null. */
  private pad(): Gamepad | null {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    const pads = [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected);
    const pad = pads.find((p) => p.index === this.index) ?? pads.find((p) => p.mapping === "standard") ?? pads[0] ?? null;
    this.index = pad ? pad.index : -1;
    return pad;
  }

  get connected() {
    return this.pad() !== null;
  }

  poll(): PadState | null {
    const p = this.pad();
    if (!p) {
      this.prev = [];
      return null;
    }
    const b = (i: number) => p.buttons[i]?.pressed ?? false;
    const v = (i: number) => p.buttons[i]?.value ?? 0;
    const [lx, ly] = stick(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const [rx, ry] = stick(p.axes[2] ?? 0, p.axes[3] ?? 0);
    const up = trigger(v(7)) - trigger(v(6));
    const roll = (b(4) ? 1 : 0) - (b(5) ? 1 : 0);
    const actions: PadAction[] = [];
    for (const [i, a] of Object.entries(BUTTONS)) {
      const n = Number(i);
      if (b(n) && !this.prev[n]) actions.push(a!);
    }
    this.prev = p.buttons.map((x) => x.pressed);
    const zoom = (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
    const move: PadState["move"] = [ly ? -ly : 0, lx, up, roll]; // (no −0: stick up is forward)
    const active = actions.length > 0 || zoom !== 0 || move.some((x) => x !== 0) || rx !== 0 || ry !== 0;
    return { move, look: [rx, ry ? -ry : 0], zoom, fast: b(10), actions, active, id: p.id };
  }

  /** A short rumble, if the pad can (Chrome, Edge, Safari). */
  rumble(strong = 0.35, weak = 0.6, ms = 90) {
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    p?.vibrationActuator?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
  }
}
