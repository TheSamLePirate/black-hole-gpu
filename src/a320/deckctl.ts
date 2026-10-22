// The A320's flight deck under the pointer (docs/PLAN-A320.md, A6): its 583 controls as FlightGear defines them
// (a320.flightdeck.xml's pick, knob and slider animations — scripts/build-a320-cockpit.py), worked as FlightGear works
// them: a click is mouse button 0 (its bindings as it is pressed, its "mod-up" ones as it is let go), the wheel buttons
// 3 (up) and 4 (down), a knob's increase / decrease by notch; a switch dragged up or down, a knob or a lever dragged,
// step by step. The bindings act on the deck's properties (the rig shows them: switches, guards, buttons going in,
// lights tested), Nasal's calls on the game through the host — the gear, the flaps, the speed brakes, the levers,
// the reversers, the autobrake, the lights; the others (the systems, the FCU, the MCDU…) wait for their step. Pure:
// the host gives the ray, the deck's posed maps and the game; the deck's properties are the poser's (deck.ts).

import { condition, type Props } from "./rig";
import type { DeckBinding, DeckControl, DeckMesh } from "./deck";
import type { DeckHit, DeckPicker } from "./deckpick";

type V3 = [number, number, number];

/** A Nasal call of a binding's script: its function's path, its arguments (numbers, strings; NaN: not a literal). */
export interface NasalCall {
  fn: string;
  args: (number | string)[];
}

export interface DeckHost {
  /** a pixel's ray in the ship's frame (ndc −1…1, y up) */
  ray(ndcX: number, ndcY: number): { o: V3; d: V3 } | null;
  /** the deck's maps as last drawn (rows of 3 × 4 a part), the picker */
  mats(): Float32Array | null;
  picker(): DeckPicker | null;
  /** a Nasal call done on the game: true if the game does it (false: not yet — its step to come) */
  call(c: NasalCall): boolean;
  /** a property set by the deck: true if the game follows it (a light's switch, the parking brake…) */
  changed?(prop: string, value: number | string): boolean;
}

/** the Nasal calls that only make a sound (A12) or nothing the game shows: done, silently */
const QUIET = /^(core\.pushbutton|core\.CabinCallFunc)$/;

/** A binding's script cut into its calls: setprop("p", v) and f(args); an if / else keeps its first branch (the
 *  host toggles: the autobrake's button pressed again disarms it). */
export function nasalCalls(script: string): NasalCall[] {
  let s = script;
  const els = s.indexOf("} else");
  if (els >= 0) s = s.slice(0, els);
  const out: NasalCall[] = [];
  const re = /([A-Za-z_][\w.]*(?:\[\d+\])?(?:\.[\w]+)*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  for (const m of s.matchAll(re)) {
    const fn = m[1]!;
    if (fn === "if" || fn.endsWith(".getValue") || fn === "getprop") continue;
    const args = m[2]!.trim()
      ? splitArgs(m[2]!).map((a) => {
          const t = a.trim();
          if (/^"[^"]*"$/.test(t)) return t.slice(1, -1);
          const n = Number(t);
          return t !== "" && Number.isFinite(n) ? n : Number.NaN;
        })
      : [];
    out.push({ fn, args });
  }
  return out;
}
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    q = false,
    cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s: string | undefined, d = 0) => {
  if (s === undefined) return d;
  if (s === "true") return 1;
  if (s === "false") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : d;
};
const clean = (p: string) => p.replace(/^\//, "");

/** The bindings run: on the deck's properties P, a knob's or a wheel's `offset` (±1 a notch); → whether the game
 *  took one (a call it does, a property it follows) — else the control is the deck's alone for now. */
export function runBindings(
  bs: DeckBinding[],
  P: Props,
  host: Pick<DeckHost, "call" | "changed">,
  offset = 1,
  /** a wheel's or a drag's: a cycle stops at its ends (a three-way switch turned past ON stays ON) */
  stops = false,
): boolean {
  let live = false;
  for (const b of bs) {
    if (b.condition && !condition(b.condition, P)) continue;
    const prop = b.property ? clean(b.property) : "";
    switch (b.command) {
      case "property-assign": {
        const v = typeof b.value === "string" ? b.value : (b.value?.[0] ?? "0");
        P[prop] = Number.isFinite(Number(v)) || v === "true" || v === "false" ? num(v) : v;
        if (host.changed?.(prop, P[prop]!)) live = true;
        break;
      }
      case "property-toggle": {
        P[prop] = Number(P[prop] ?? 0) ? 0 : 1;
        if (host.changed?.(prop, P[prop]!)) live = true;
        break;
      }
      case "property-cycle": {
        const vals = (Array.isArray(b.value) ? b.value : b.value ? [b.value] : []).map((v) => num(v));
        if (!vals.length) break;
        const now = Number(P[prop] ?? vals[0]);
        let i = vals.findIndex((v) => Math.abs(v - now) < 1e-6);
        // (a knob turned the other way: back along the list; no wrap when the list says so)
        const step = offset < 0 ? -1 : 1;
        i = i < 0 ? 0 : i + step;
        const wrap = b.wrap !== "false" && !stops;
        if (i >= vals.length) i = wrap ? 0 : vals.length - 1;
        if (i < 0) i = wrap ? vals.length - 1 : 0;
        P[prop] = vals[i]!;
        if (host.changed?.(prop, P[prop]!)) live = true;
        break;
      }
      case "property-adjust": {
        const d = b.step !== undefined ? num(b.step) * Math.sign(offset || 1) : num(b.factor, 1) * offset;
        let v = Number(P[prop] ?? 0) + d;
        const lo = b.min !== undefined ? num(b.min) : -Infinity,
          hi = b.max !== undefined ? num(b.max) : Infinity;
        if (b.wrap === "true" && Number.isFinite(lo) && Number.isFinite(hi)) {
          const span = hi - lo;
          v = ((((v - lo) % span) + span) % span) + lo;
        } else v = Math.min(Math.max(v, lo), hi);
        P[prop] = v;
        if (host.changed?.(prop, v)) live = true;
        break;
      }
      case "nasal":
        for (const c of nasalCalls(b.script ?? "")) {
          if (c.fn === "setprop") {
            const p = clean(String(c.args[0] ?? ""));
            if (p && !p.startsWith("sim/sound/") && c.args[1] !== undefined && !Number.isNaN(c.args[1])) {
              P[p] = c.args[1]!;
              if (host.changed?.(p, P[p]!)) live = true;
            }
          } else if (QUIET.test(c.fn)) {
            // (a sound: A12)
          } else if (host.call(c)) live = true;
        }
        break;
    }
  }
  return live;
}

/** what the pointer is over, as the cabin's pointer says it (cockpit/pointer.ts's kinds) */
export type DeckTarget =
  | { kind: "control"; id: string; t: number }
  | { kind: "screen"; slot: number; u: number; v: number; t: number; name: string }
  | { kind: "cabin"; t: number };

/** Pixels of drag a step (a switch flicked, a knob's notch, a lever's step). */
export const DRAG_PX = 14;

export class DeckControls {
  /** FlightGear's knobs pulled by the middle button (controls.ts: Alt with the left too) */
  readonly middle = true;
  hover: string | null = null;
  pressed: string | null = null;
  over: DeckTarget | null = null;
  overTab = false;
  /** the controls by object */
  private byObject = new Map<string, number>();
  private held: { i: number; dx: number; dy: number; acc: number; ups: DeckBinding[] | null } | null = null;
  /** the controls the game took at least once (their tooltip says it), the last hit */
  readonly live = new Set<number>();
  lastHit: DeckHit | null = null;

  constructor(
    readonly mesh: DeckMesh,
    readonly P: Props,
    private host: DeckHost,
  ) {
    mesh.controls.forEach((c, i) => {
      for (const o of c.objects) if (!this.byObject.has(o)) this.byObject.set(o, i);
    });
  }

  control(id: string | null): DeckControl | null {
    return id === null ? null : (this.mesh.controls[Number(id)] ?? null);
  }

  /** What the pointer is on: a control (its object's), a display, the deck; null through the windows. */
  target(ndcX: number, ndcY: number): DeckTarget | null {
    const r = Number.isFinite(ndcX) ? this.host.ray(ndcX, ndcY) : null;
    const pk = this.host.picker();
    const h = r && pk ? pk.pick(r.o, r.d, this.host.mats()) : null;
    this.lastHit = h;
    if (!h) return null;
    const i = this.byObject.get(h.object);
    if (i !== undefined) return { kind: "control", id: String(i), t: h.t };
    if (h.screen) return { kind: "screen", slot: -1, u: h.screen.u, v: h.screen.v, t: h.t, name: h.screen.name };
    return { kind: "cabin", t: h.t };
  }

  move(ndcX: number, ndcY: number): DeckTarget | null {
    this.over = this.target(ndcX, ndcY);
    this.hover = this.over?.kind === "control" ? this.over.id : null;
    return this.over;
  }

  /** The actions of a control for a mouse button (0 click, 1 middle, 3 wheel up, 4 wheel down). */
  private actionsFor(c: DeckControl, button: number) {
    return c.actions.filter((a) => a.button.includes(button));
  }

  /** A knob's turn (+1 increase, −1 decrease): its increase / decrease actions, or its plain one by ±1. */
  private turn(i: number, dir: number) {
    const c = this.mesh.controls[i]!;
    const kind = dir > 0 ? "increase" : "decrease";
    let acts = c.actions.filter((a) => a.kind === kind);
    if (!acts.length) acts = c.actions.filter((a) => !a.kind && !a.button.length);
    if (!acts.length) acts = this.actionsFor(c, dir > 0 ? 3 : 4);
    let live = false;
    for (const a of acts) live = runBindings(a.bindings, this.P, this.host, a.kind ? 1 : dir, true) || live;
    if (live) this.live.add(i);
    return acts.length > 0;
  }

  /** A pick's button pressed: its bindings now, its "mod-up" ones kept for the release. */
  private press(i: number, button: number): DeckBinding[] | null {
    const c = this.mesh.controls[i]!;
    const acts = this.actionsFor(c, button);
    if (!acts.length) return null;
    let live = false;
    const ups: DeckBinding[] = [];
    for (const a of acts) {
      live = runBindings(a.bindings, this.P, this.host, 1, button >= 3) || live;
      if (a.up) ups.push(...a.up);
    }
    if (live) this.live.add(i);
    return ups;
  }

  /** Pressed: on a control, it is held (true: the pointer is the deck's until let go). A pick does its click; a
   *  knob with a click of its own too; one without waits for the drag or the release (a click: a notch on). */
  down(ndcX: number, ndcY: number, button = 0): boolean {
    const t = this.move(ndcX, ndcY);
    if (t?.kind !== "control") return false;
    const i = Number(t.id);
    const c = this.mesh.controls[i]!;
    const ups = c.type === "pick" || this.actionsFor(c, button).length ? this.press(i, button) : null;
    this.held = { i, dx: 0, dy: 0, acc: 0, ups };
    this.pressed = t.id;
    return true;
  }

  /** Dragged while held [px]: a knob or a lever turned a notch every DRAG_PX (up or right: more — a vertical one by
   *  its vertical travel), a switch flicked (a pick's wheel buttons: up 3, down 4). */
  drag(dx: number, dy: number) {
    const h = this.held;
    if (!h) return;
    h.dx += dx;
    h.dy += dy;
    const c = this.mesh.controls[h.i]!;
    const along = c.type === "knob" && c.drag !== "vertical" && Math.abs(h.dx) > Math.abs(h.dy) ? dx : -dy;
    h.acc += along;
    while (Math.abs(h.acc) >= DRAG_PX) {
      const dir = Math.sign(h.acc);
      h.acc -= dir * DRAG_PX;
      if (c.type === "knob") this.turn(h.i, dir);
      else if (!h.ups?.length || this.actionsFor(c, dir > 0 ? 3 : 4).length) this.press(h.i, dir > 0 ? 3 : 4);
    }
  }

  /** Let go: the pick's "mod-up" bindings; a knob clicked without a drag: a notch on. */
  up(click: boolean) {
    const h = this.held;
    this.held = null;
    this.pressed = null;
    if (!h) return;
    if (h.ups?.length) runBindings(h.ups, this.P, this.host);
    const c = this.mesh.controls[h.i]!;
    if (click && c.type === "knob" && !this.actionsFor(c, 0).length && Math.hypot(h.dx, h.dy) < 5) this.turn(h.i, 1);
  }

  /** The wheel over a control [notches, + towards the user: down]: a knob turned, a pick's wheel buttons. */
  wheel(notches: number): boolean {
    if (this.hover === null) return false;
    const i = Number(this.hover);
    const c = this.mesh.controls[i]!;
    const dir = -Math.sign(notches);
    if (c.type === "knob") return this.turn(i, dir);
    const ups = this.press(i, dir > 0 ? 3 : 4);
    if (ups?.length) runBindings(ups, this.P, this.host);
    return ups !== null;
  }

  get focus(): string | null {
    return this.held ? String(this.held.i) : this.hover;
  }
}
