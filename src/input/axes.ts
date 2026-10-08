// The game controllers' model (PLAN-HOTAS H1): what a device is (its model, from the browser's id), how an
// axis becomes a command — its calibration, dead zone, curve, inversion, half —, an absolute throttle and
// its idle detent, and the bindings: each command fed by an axis, a half-axis, a button or a hat of any
// device plugged in (a stick, a throttle and pedals: three USB devices, read together). Pure: the devices'
// snapshot in, the commands out (input/devices.ts reads the browser, the controller flies with them).

import type { KeyAction } from "./keymap";
import type { HeldAxis } from "./bindings";

/** The continuous commands an axis can drive. Centred ones −1…1; the throttle and the brakes 0…1. */
export type AxisTarget = "pitch" | "roll" | "yaw" | "throttle" | "rcsX" | "rcsY" | "rcsZ" | "lookX" | "lookY" | "brakeL" | "brakeR";

export const AXIS_TARGETS: AxisTarget[] = [
  "pitch",
  "roll",
  "yaw",
  "throttle",
  "rcsX",
  "rcsY",
  "rcsZ",
  "lookX",
  "lookY",
  "brakeL",
  "brakeR",
];

/** the targets read 0…1 (a lever, a pedal's toe brake): the others centred, −1…1 */
export const ABSOLUTE: ReadonlySet<AxisTarget> = new Set(["throttle", "brakeL", "brakeR"]);

/** Where a command comes from: a device's axis (whole, or one half: a split rudder, a trigger pair), a
 *  button, a hat's direction (a POV reported as an axis: −1 up … +1, going round; > 1: centred). */
export type Source =
  | { kind: "axis"; index: number; half?: 1 | -1 }
  | { kind: "button"; index: number }
  | { kind: "hat"; index: number; dir: "up" | "right" | "down" | "left" };

/** How an axis is shaped: its dead zone (a share of the travel), its curve (0 linear … 1 cubic: fine near
 *  the centre), inverted; its calibrated travel (learnt from its extremes). */
export interface Shape {
  dead: number;
  curve: number;
  invert: boolean;
  min?: number;
  max?: number;
}

export const SHAPE_DEFAULT: Shape = { dead: 0.08, curve: 0.35, invert: false };

/** A command bound: an axis target fed by a source (and shaped); or an action (a keymap's) / a held key
 *  (a flight key's) fired by a button or a hat. */
export type Binding =
  | { target: AxisTarget; source: Source; shape?: Shape }
  | { action: KeyAction; arg?: string; source: Source }
  | { held: HeldAxis; source: Source };

/** A device's settings: its model's key, its name (shown), its bindings. */
export interface Profile {
  model: string;
  name: string;
  bindings: Binding[];
}

/** What a device reports this frame. */
export interface DeviceSnapshot {
  /** its model's key (deviceModel) */
  model: string;
  name: string;
  /** the browser's "standard" mapping (a pad laid out as an Xbox one) */
  standard: boolean;
  axes: readonly number[];
  buttons: readonly number[];
}

/**
 * A device's model from the browser's id — Chrome: "Name (STANDARD GAMEPAD Vendor: 044f Product: b10a)" or
 * "Name (Vendor: 044f Product: b10a)"; Firefox: "044f-b10a-Name"; Safari: "Name" — its vendor and product
 * ids when the id gives them ("044f:b10a"), else its name; and its name.
 */
export function deviceModel(id: string): { model: string; name: string } {
  const c = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id);
  if (c) return { model: `${c[1]!.toLowerCase()}:${c[2]!.toLowerCase()}`, name: id.replace(/\s*\(.*\)\s*$/, "").trim() || id };
  const f = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.*)$/i.exec(id);
  if (f) return { model: `${f[1]!.toLowerCase().padStart(4, "0")}:${f[2]!.toLowerCase().padStart(4, "0")}`, name: f[3]!.trim() };
  const name = id.trim();
  return { model: `name:${name.toLowerCase()}`, name };
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The calibrated reading of a raw axis −1…1: its learnt travel stretched to −1…1 (a stick that only
 *  reaches ±0.9 reads full). */
export function calibrated(raw: number, s: Shape): number {
  const lo = s.min ?? -1,
    hi = s.max ?? 1;
  if (!(hi > lo)) return clamp(raw, -1, 1);
  return clamp(((raw - lo) / (hi - lo)) * 2 - 1, -1, 1);
}

/** A centred command from a raw axis (−1…1): calibrated, inverted, its dead zone round the centre taken out
 *  (the rest stretched back to full), curved — x·(1 − c) + x³·c: as fine as wanted near the centre, the
 *  full deflection kept. */
export function centred(raw: number, s: Shape): number {
  let x = calibrated(raw, s);
  if (s.invert) x = -x;
  const m = Math.abs(x);
  if (m <= s.dead) return 0;
  const u = (m - s.dead) / (1 - s.dead);
  const c = clamp(s.curve, 0, 1);
  return Math.sign(x) * (u * (1 - c) + u * u * u * c);
}

/** the idle detent: the lever's bottom 4 % reads 0 — the engine surely off */
export const IDLE_DETENT = 0.04;

/** A 0…1 command from a raw lever (−1 at one stop, +1 at the other): calibrated, inverted, the idle detent
 *  at the bottom, linear above it (a throttle's travel is its thrust). */
export function absolute(raw: number, s: Shape): number {
  let x = (calibrated(raw, s) + 1) / 2;
  if (s.invert) x = 1 - x;
  if (x <= IDLE_DETENT) return 0;
  return clamp((x - IDLE_DETENT) / (1 - IDLE_DETENT), 0, 1);
}

/** A hat reported as an axis (the old DirectInput POV: −1 = up, +1/7 steps round clockwise; > 1 centred)
 *  pressed toward `dir`. */
export function hatPressed(v: number, dir: "up" | "right" | "down" | "left"): boolean {
  if (!(v >= -1.05 && v <= 1.05)) return false;
  // (eight positions, −1 … 1 in sevenths: up, up-right, right, down-right, down, down-left, left, up-left)
  const k = Math.round(((v + 1) * 7) / 2) % 8;
  const want = { up: [7, 0, 1], right: [1, 2, 3], down: [3, 4, 5], left: [5, 6, 7] }[dir];
  return want.includes(k);
}

/** A source's value now on its device: an axis (a half: its part on that side, 0…1), a button 0…1, a hat 0/1. */
export function sourceValue(d: DeviceSnapshot, src: Source): number {
  if (src.kind === "button") return d.buttons[src.index] ?? 0;
  if (src.kind === "hat") return hatPressed(d.axes[src.index] ?? 2, src.dir) ? 1 : 0;
  const v = d.axes[src.index] ?? 0;
  return src.half ? Math.max(0, v * src.half) : v;
}

/** The commands from every device this frame: the axis targets (summed over their sources, clamped; an
 *  absolute target present only when bound), the actions' buttons and the held keys' state (pressed: > 0.5). */
export interface Commands {
  axes: Partial<Record<AxisTarget, number>>;
  actions: Map<string, boolean>;
  held: Set<HeldAxis>;
}

/** The key of an action binding (its action and argument) — the edges are found against the last frame's. */
export const actionKey = (b: { action: KeyAction; arg?: string }) => (b.arg ? `${b.action}:${b.arg}` : b.action);

/** Reads every device through its profile (devices without one: nothing). */
export function readCommands(devices: DeviceSnapshot[], profiles: Map<string, Profile>): Commands {
  const axes: Partial<Record<AxisTarget, number>> = {};
  const actions = new Map<string, boolean>();
  const held = new Set<HeldAxis>();
  for (const d of devices) {
    const p = profiles.get(d.model);
    if (!p) continue;
    for (const b of p.bindings) {
      const v = sourceValue(d, b.source);
      if ("target" in b) {
        const s = b.shape ?? SHAPE_DEFAULT;
        let x: number;
        if (b.source.kind !== "axis") x = v;
        else if (ABSOLUTE.has(b.target)) x = b.source.half ? clamp(centred(v, { ...s, invert: false }), 0, 1) : absolute(v, s);
        // (a half on a centred target: 0…1, its sign the shape's inversion — a split rudder's two halves)
        else x = centred(v, s);
        const lim = ABSOLUTE.has(b.target) ? [0, 1] : [-1, 1];
        axes[b.target] = clamp((axes[b.target] ?? 0) + x, lim[0]!, lim[1]!);
      } else if ("action" in b) {
        const k = actionKey(b);
        actions.set(k, (actions.get(k) ?? false) || v > 0.5);
      } else if (v > 0.5) held.add(b.held);
    }
  }
  return { axes, actions, held };
}

/** The actions newly pressed this frame (their keys), from this frame's and the last's. */
export function pressedEdges(now: Map<string, boolean>, before: Map<string, boolean>): string[] {
  const out: string[] = [];
  for (const [k, on] of now) if (on && !before.get(k)) out.push(k);
  return out;
}

/**
 * The detection (the controls screen's "move the axis now"): from a device's rest snapshot to now, the
 * source moved the most — an axis's travel (its side: a half when it only went one way from a centred
 * rest, the whole when it is a lever or went both ways), a button pressed; null under the threshold.
 */
export function detect(rest: DeviceSnapshot, now: DeviceSnapshot, seen: { lo: number[]; hi: number[] }): Source | null {
  let best: { src: Source; amount: number } | null = null;
  now.buttons.forEach((v, i) => {
    if (v > 0.5 && (rest.buttons[i] ?? 0) < 0.5 && (!best || 2 > best.amount)) best = { src: { kind: "button", index: i }, amount: 2 };
  });
  if (best) return (best as { src: Source }).src;
  now.axes.forEach((v, i) => {
    const r = rest.axes[i] ?? 0;
    seen.lo[i] = Math.min(seen.lo[i] ?? r, v);
    seen.hi[i] = Math.max(seen.hi[i] ?? r, v);
    const up = seen.hi[i]! - r,
      down = r - seen.lo[i]!;
    const amount = Math.max(up, down);
    if (amount < 0.5 || (best && amount <= best.amount)) return;
    // (a centred rest — a stick, a twist —, moved one way only: that half; a lever resting at a stop, or
    // moved both ways: the whole axis)
    const centredRest = Math.abs(r) < 0.3;
    const oneWay = Math.min(up, down) < 0.25;
    const src: Source = centredRest && oneWay ? { kind: "axis", index: i, half: up > down ? 1 : -1 } : { kind: "axis", index: i };
    best = { src, amount };
  });
  return best ? (best as { src: Source }).src : null;
}
