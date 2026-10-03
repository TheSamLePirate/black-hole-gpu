// Two fingers on a map: their spread zooms (about the point between them), their middle pans. The
// map keeps its own one-pointer gestures; while two touches are down, those are set aside (`active`),
// and a lifted finger does not turn the rest of the pinch into a drag (`settling`, until all are up).
// Also: a long press (a touch held still), the touch's "right click".

export interface PinchDeps {
  /** the spread changed by `k` (> 1: the fingers apart, zoom in) about (x, y) [CSS px, client] */
  zoom(k: number, x: number, y: number): void;
  /** the middle moved by (dx, dy) [CSS px] */
  pan(dx: number, dy: number): void;
  /** a second finger came down: the one-pointer gesture under way is cancelled */
  start?(): void;
}

/** The hit radius for a pointer: 22 CSS px (44 px zones) under a finger, `r` under a mouse. */
export const reach = (e: PointerEvent, r: number) => (e.pointerType === "touch" ? Math.max(r, 22) : r);

export class Pinch {
  private pts = new Map<number, { x: number; y: number }>();
  private last: { d: number; x: number; y: number } | null = null;
  /** a pinch went on since all the fingers were last up */
  private settling = false;

  constructor(
    el: HTMLElement,
    private d: PinchDeps,
  ) {
    // (captured first: the map's own handlers see `active` already set)
    el.addEventListener("pointerdown", this.down, true);
    el.addEventListener("pointermove", this.move, true);
    for (const ev of ["pointerup", "pointercancel"]) el.addEventListener(ev, this.up as EventListener, true);
  }

  /** Two fingers (or more) down, or the end of a pinch: the one-pointer gestures wait. */
  get active() {
    return this.pts.size >= 2 || this.settling;
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pts.size === 2) {
      this.settling = true;
      this.last = this.measure();
      this.d.start?.();
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pts.size < 2 || !this.last) return;
    e.stopImmediatePropagation();
    const m = this.measure();
    if (this.last.d > 0 && m.d > 0) this.d.zoom(m.d / this.last.d, m.x, m.y);
    this.d.pan(m.x - this.last.x, m.y - this.last.y);
    this.last = m;
  };

  private up = (e: PointerEvent) => {
    if (!this.pts.delete(e.pointerId)) return;
    this.last = this.pts.size >= 2 ? this.measure() : null;
    if (this.pts.size === 0) {
      // (the lift of the last finger still reaches the map: it must not read as a tap)
      if (this.settling) e.stopImmediatePropagation();
      this.settling = false;
    }
  };

  private measure() {
    const [a, b] = [...this.pts.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }
}

/**
 * A long press: a touch held 550 ms without moving more than 8 px calls `fire` with where it began
 * (the touch's right click: a node deleted). Returns whether the last press fired (its lift is no tap).
 */
export function longPress(el: HTMLElement, fire: (e: PointerEvent) => void, ms = 550): () => boolean {
  let timer = 0;
  let at: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    at = null;
  };
  el.addEventListener("pointerdown", (e) => {
    fired = false;
    if (e.pointerType !== "touch") return;
    cancel();
    at = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      at = null;
      fired = true;
      fire(e);
    }, ms) as unknown as number;
  });
  el.addEventListener("pointermove", (e) => {
    if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) cancel();
  });
  for (const ev of ["pointerup", "pointercancel"]) el.addEventListener(ev, cancel);
  return () => fired;
}
