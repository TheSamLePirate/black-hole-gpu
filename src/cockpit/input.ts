// The pointer working the cockpit's controls (PLAN-COCKPIT K2): over a control, it is lit and named (the
// tip); pressed on one, the control is held — a lever follows the pointer up and down its slot and settles in
// its detent, the knob turns with it, a lit button goes in and acts as it is let go; a click without a drag
// does what the control's click does (the gear's lever: up or down; the flaps' one detent on; a switch:
// flipped); the wheel turns the knob, moves a lever. The host does the acting (the flight's own actions: the
// keys' — main.ts) and says where each control stands.

import { CONTROLS, type ControlDef } from "./controls";
import type { CockpitTarget } from "./pointer";

export interface CockpitHost {
  /** a pixel's ray in the ship's frame (ndc −1…1, y up), and what it meets */
  target(ndcX: number, ndcY: number): CockpitTarget | null;
  /** where a control stands now, 0…1 */
  value(id: string): number;
  /** act: a control set to a position (a lever, a switch, the knob), or pushed (a button: no value) */
  act(id: string, value?: number): void;
}

const byId = new Map(CONTROLS.map((c) => [c.id, c]));
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** A lever's or a switch's position nearest `v` among its detents (a switch: 0 or 1). */
export function settle(c: ControlDef, v: number): number {
  const stops = c.kind === "toggle" ? [0, 1] : c.stops;
  if (!stops) return clamp01(v);
  return stops.reduce((b, s) => (Math.abs(s - v) < Math.abs(b - v) ? s : b), stops[0]!);
}

/** What a click does to a control at `v`: the next position (a button: undefined — pushed). */
export function clickValue(c: ControlDef, v: number): number | undefined {
  if (c.kind === "button") return undefined;
  if (c.kind === "knob") return v;
  if (c.kind === "toggle") return v > 0.5 ? 0 : 1;
  const stops = c.stops ?? [0, 1];
  // (the next detent on, round to the first: the flaps 0 → ½ → full → 0; the gear up ↔ down)
  const i = stops.findIndex((s) => s > v + 1e-6);
  return i < 0 ? stops[0]! : stops[i]!;
}

/** Pixels of drag for a lever's whole travel, the knob's whole turn. */
export const LEVER_PX = 120;
export const KNOB_PX = 240;

export class CockpitInput {
  /** the control under the pointer, the one held */
  hover: string | null = null;
  pressed: string | null = null;
  private held: { c: ControlDef; v0: number; v: number; dx: number; dy: number } | null = null;
  /** what the pointer is over now (a screen: K3's) */
  over: CockpitTarget | null = null;

  constructor(private host: CockpitHost) {}

  /** The pointer moved, nothing held: what it is over (a control lit). */
  move(ndcX: number, ndcY: number): CockpitTarget | null {
    this.over = this.host.target(ndcX, ndcY);
    this.hover = this.over?.kind === "control" ? this.over.id : null;
    return this.over;
  }

  /** Pressed: on a control, it is held (true: the pointer is the cockpit's until let go). */
  down(ndcX: number, ndcY: number): boolean {
    const t = this.move(ndcX, ndcY);
    if (t?.kind !== "control") return false;
    const c = byId.get(t.id)!;
    const v = this.host.value(c.id);
    this.held = { c, v0: v, v, dx: 0, dy: 0 };
    this.pressed = c.id;
    return true;
  }

  /** Dragged while held [px]: a lever follows down and up its slot, the knob turns (right and up: more). */
  drag(dx: number, dy: number) {
    const h = this.held;
    if (!h) return;
    h.dx += dx;
    h.dy += dy;
    if (h.c.kind === "lever") {
      // (the state's 0 is the lever up: dragged down, it goes down)
      const v = clamp01(h.v0 + h.dy / LEVER_PX);
      // (a lever with detents moves through them: it acts as it reaches one)
      const s = h.c.stops ? settle(h.c, v) : v;
      if (s !== h.v) this.host.act(h.c.id, s);
      h.v = s;
    } else if (h.c.kind === "knob") {
      const v = clamp01(h.v0 + (h.dx - h.dy) / KNOB_PX);
      if (Math.abs(v - h.v) > 1e-3) this.host.act(h.c.id, v);
      h.v = v;
    } else if (h.c.kind === "toggle" && Math.abs(h.dy) > 12) {
      // (a switch flicked up or down)
      const v = h.dy > 0 ? 0 : 1;
      if (v !== h.v) this.host.act(h.c.id, v);
      h.v = v;
    }
  }

  /** Let go: a click (no drag) does the control's click; a drag ends where it is. */
  up(click: boolean) {
    const h = this.held;
    this.held = null;
    this.pressed = null;
    if (!h) return;
    if (click && Math.hypot(h.dx, h.dy) < 5) {
      const v = clickValue(h.c, h.v0);
      if (h.c.kind === "button") this.host.act(h.c.id);
      else if (v !== undefined && v !== h.v0) this.host.act(h.c.id, v);
    }
  }

  /** The wheel over a control [notches, + towards the user]: the knob turned, a lever moved; true if
   *  taken. */
  wheel(notches: number): boolean {
    const id = this.hover;
    const c = id ? byId.get(id) : undefined;
    if (!c || c.kind === "button") return false;
    const v = this.host.value(c.id);
    let n: number;
    if (c.kind === "knob") n = clamp01(v - notches * 0.05);
    else if (c.kind === "toggle") n = notches < 0 ? 1 : 0;
    else if (c.stops) {
      const i = c.stops.indexOf(settle(c, v));
      n = c.stops[Math.min(Math.max(i + Math.sign(notches), 0), c.stops.length - 1)]!;
    } else n = clamp01(v + notches * 0.1);
    if (n !== v) this.host.act(c.id, n);
    return true;
  }

  /** The control held or hovered (the tip's). */
  get focus(): string | null {
    return this.held?.c.id ?? this.hover;
  }
}
