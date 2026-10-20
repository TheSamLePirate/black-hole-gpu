// TARS's orb: every one of his animations is a thinking orb (thinking-orbs' engine, drawn by intro/orb.ts —
// the loading orb's painter — in his state's colour). His own (the console's head, his presence, the top bar,
// its handle) follows what he does:
//   idle → breathing (a ring slowly morphing, dim and slow) · listening → listening (a wave through the rings,
//   its pace and size the microphone's level) · thinking → solving (bands scrambling, clicking back) ·
//   acting → connecting (a constellation wiring itself; each action a burst) · speaking → composing (a sash,
//   its pace and size his voice's level) · error → a still ring, red.
// The small ones mark what runs (a step, a sub-agent, a to-do, his wait, a card's live feed) with a fixed state.
// One requestAnimationFrame for all of them, run only while one is on screen and moving: an orb hidden, off
// screen, or in a hidden tab is not drawn; at rest a few frames a second are enough; with reduced motion each
// is one still frame (its state told by its colour and its shape).

import { drawOrb, type OrbState, type RGB } from "../../intro/orb";

export type TarsState = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error";

/** his state's colours (the console's --tc: style.css) */
export const TINT = {
  green: [140, 255, 190],
  red: [255, 128, 112],
  blue: [124, 214, 255],
  amber: [255, 200, 90],
  alarm: [255, 120, 110],
} as const satisfies Record<string, RGB>;

interface Look {
  orb: OrbState;
  tint: RGB;
  /** the animation's pace (1: the engine's tuned one) */
  pace: number;
  /** its brightness (0…1) */
  fade: number;
  /** a still frame whatever the motion setting */
  still?: boolean;
  /** at rest: drawn a few times a second */
  rest?: boolean;
  /** its pace and size follow the voice's level */
  voiced?: boolean;
}

const LOOKS: Record<TarsState, Look> = {
  idle: { orb: "breathing", tint: TINT.green, pace: 0.45, fade: 0.62, rest: true },
  listening: { orb: "listening", tint: TINT.red, pace: 1, fade: 1, voiced: true },
  thinking: { orb: "solving", tint: TINT.blue, pace: 1, fade: 1 },
  acting: { orb: "connecting", tint: TINT.amber, pace: 1, fade: 1 },
  speaking: { orb: "composing", tint: TINT.green, pace: 1, fade: 1, voiced: true },
  error: { orb: "breathing", tint: TINT.alarm, pace: 0, fade: 0.9, still: true },
};

/** the engine's frame time drawn when still (its own reduced-motion frame) */
const STILL_T = 0.6;
/** an action's burst [ms] */
const BURST = 650;
/** at rest, a frame every [ms] */
const REST_MS = 66;

const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
const reducedMotion = () => !!reduced?.matches || !!globalThis.document?.body?.classList.contains("reduce-motion");

/** the orbs alive, and their loop */
const live = new Set<TarsOrb>();
const byEl = new WeakMap<Element, TarsOrb>();
let raf = 0;
let io: IntersectionObserver | null = null;

function observer() {
  if (!io && typeof IntersectionObserver === "function")
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const o = byEl.get(e.target);
        if (o) o.seen(e.isIntersecting);
      }
      wake();
    });
  return io;
}

function wake() {
  if (!raf && live.size && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(tick);
}

function tick(now: number) {
  raf = 0;
  let more = false;
  for (const o of live) if (o.step(now)) more = true;
  if (more) raf = requestAnimationFrame(tick);
}

reduced?.addEventListener?.("change", () => {
  for (const o of live) o.redraw();
  wake();
});
globalThis.document?.addEventListener?.("visibilitychange", wake);

/** The orbs taken out of the page (a step done, a card gone): let go. */
function sweep() {
  for (const o of live) if (o.gone()) drop(o);
}

function drop(o: TarsOrb) {
  live.delete(o);
  io?.unobserve(o.el);
}

export class TarsOrb {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private state: TarsState = "idle";
  private fixed: Look | null;
  private visible = false;
  private attached = false;
  private dirty = true;
  private vt = Math.random() * 10;
  private last = 0;
  private painted = 0;
  private pulse = -1e9;
  /** the voice's level now (0…1): heard (listening) or said (speaking); null: unknown (a system voice) */
  level: () => number | null = () => null;
  /** motion reduced: a still frame */
  still: () => boolean = reducedMotion;

  /**
   * An orb `size` CSS pixels square. Without `fixed`, his: in his state (set()); with it, a mark of something
   * running — that state of the engine, in `tint`.
   */
  constructor(
    readonly size = 30,
    o: { fixed?: OrbState; tint?: RGB; pace?: number } = {},
  ) {
    this.fixed = o.fixed ? { orb: o.fixed, tint: o.tint ?? TINT.amber, pace: o.pace ?? 1, fade: 1 } : null;
    const cv = document.createElement("canvas");
    cv.className = "tars-orb";
    cv.setAttribute("aria-hidden", "true");
    cv.style.width = cv.style.height = `${size}px`;
    cv.dataset.state = this.fixed ? this.fixed.orb : this.state;
    this.el = cv;
    this.ctx = cv.getContext("2d");
    byEl.set(cv, this);
    sweep();
    live.add(this);
    observer()?.observe(cv);
    // (no observer — a test's DOM —: taken as seen)
    if (!io) this.visible = true;
    wake();
  }

  /** A mark of something running: a small fixed orb. */
  static mark(orb: OrbState, tint: RGB, size = 16) {
    return new TarsOrb(size, { fixed: orb, tint }).el;
  }

  get current() {
    return this.state;
  }

  set(s: TarsState) {
    if (!live.has(this)) {
      live.add(this);
      observer()?.observe(this.el);
    }
    if (s === this.state) return;
    this.state = s;
    this.el.dataset.state = s;
    this.redraw();
    wake();
  }

  /** an action done: a burst */
  flash() {
    this.pulse = performance.now();
    wake();
  }

  /** drawn again at the next frame (its look changed) */
  redraw() {
    this.dirty = true;
  }

  /** on screen or not (the observer) */
  seen(on: boolean) {
    if (on && !this.visible) this.dirty = true;
    this.visible = on;
    if (on) this.attached = true;
  }

  /** out of the page, having been in it */
  gone() {
    if (this.el.isConnected) this.attached = true;
    return this.attached && !this.el.isConnected;
  }

  private look(): Look {
    return this.fixed ?? LOOKS[this.state];
  }

  /** One frame of the loop: drawn if on screen; true while it wants more. */
  step(now: number): boolean {
    if (this.gone()) {
      drop(this);
      return false;
    }
    if (!this.visible || document.hidden || !this.ctx) return false;
    const look = this.look();
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    if (look.still || this.still()) {
      if (this.dirty) this.paint(look, STILL_T, 1, look.fade);
      this.dirty = false;
      this.last = 0;
      return false;
    }
    const burst = Math.max(0, 1 - (now - this.pulse) / BURST);
    const lv = look.voiced ? this.level() : null;
    const voice = lv == null ? 1 : 0.5 + 1.6 * Math.min(1, lv);
    this.vt += dt * look.pace * voice * (1 + 2.5 * burst);
    if (look.rest && !burst && !this.dirty && now - this.painted < REST_MS) return true;
    this.painted = now;
    this.dirty = false;
    const scale = (lv == null ? 0.96 : 0.86 + 0.14 * Math.min(1, lv)) * (1 + 0.04 * burst);
    this.paint(look, this.vt, scale, Math.min(1, look.fade + 0.4 * burst));
    return true;
  }

  private paint(look: Look, t: number, scale: number, fade: number) {
    const ctx = this.ctx!;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const px = Math.round(this.size * dpr);
    if (this.el.width !== px) this.el.width = this.el.height = px;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    const s = this.size * scale;
    const o = (this.size - s) / 2;
    const [r, g, b] = look.tint;
    // (near dots the tint lifted toward white, far ones the tint: the loading orb's depth, in his colour)
    const near: RGB = [r + (255 - r) * 0.4, g + (255 - g) * 0.4, b + (255 - b) * 0.4];
    // (under 40 px, the engine's 20 px design: fewer, larger dots — legible inline)
    drawOrb(ctx, look.orb, o, o, s, t, fade, { design: this.size < 40 ? 20 : 64, far: look.tint, near });
  }
}
