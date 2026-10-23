// The designation cursor — the TDC (PLAN-RADAR-AAA constat 29): without a mouse, a pad's or a HOTAS's way to pick a
// track. Held (the pad's two bumpers together, a HOTAS button bound to it, a key), a cursor stands on the screen in use —
// the HUD's radar scope, or in the F-35's cockpit the PCD's page looked at —; a stick slews it (the pad's right one, a
// throttle's slew or a hat, the arrows); A, the trigger bound to « designate », picks what is under it (the click's
// way: selected, a second time locked). Let go, it goes away and comes back where it was on that screen. Pure: the
// held, the slew, the screen in; the cursor out.

/** The screen the cursor stands on: the HUD's scope (its place a share of its radius: x right, y up, within the disc),
 *  or a PCD page (its place on the display, 0…1 across and down, within the page's body `rect`). */
export type TdcScreen = { kind: "scope" } | { kind: "pcd"; page: string; rect: { u0: number; v0: number; u1: number; v1: number } };

export const TDC = {
  /** the slew at full deflection: the scope's radii a second; the display's widths a second */
  scopeSpeed: 1.1,
  pcdSpeed: 0.28,
  /** the slew's curve: fine near the stick's centre (|s|^curve) */
  curve: 1.6,
  /** a stick's rest */
  dead: 0.08,
  /** the reach of a designation about the cursor [CSS px] (a symbol's) */
  reach: 26,
};

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const shape = (s: number) => (Math.abs(s) <= TDC.dead ? 0 : Math.sign(s) * ((Math.abs(s) - TDC.dead) / (1 - TDC.dead)) ** TDC.curve);
const key = (w: TdcScreen) => (w.kind === "scope" ? "scope" : `pcd:${w.rect.u0.toFixed(3)},${w.rect.v0.toFixed(3)}`);

export class Tdc {
  /** shown now (held, on a screen) */
  on = false;
  screen: TdcScreen | null = null;
  /** its place on that screen (see TdcScreen) */
  x = 0;
  y = 0;
  /** where it was left on each screen (it comes back there) */
  private kept = new Map<string, [number, number]>();

  /** A frame: `held` the TDC's control, `slew` the stick (x right, y up, −1…1), `dt` [s], the screen in use now (null:
   *  none — the cursor off). Whether it is shown. */
  step(held: boolean, slew: readonly [number, number], dt: number, screen: TdcScreen | null): boolean {
    if (!held || !screen) {
      if (this.on && this.screen) this.kept.set(key(this.screen), [this.x, this.y]);
      this.on = false;
      this.screen = null;
      return false;
    }
    // (a new screen — or another PCD page —: the cursor where it was left there, else at its centre)
    if (!this.on || !this.screen || key(this.screen) !== key(screen)) {
      if (this.on && this.screen) this.kept.set(key(this.screen), [this.x, this.y]);
      const k = this.kept.get(key(screen));
      if (k) [this.x, this.y] = k;
      else if (screen.kind === "scope") this.x = this.y = 0;
      else {
        this.x = (screen.rect.u0 + screen.rect.u1) / 2;
        this.y = (screen.rect.v0 + screen.rect.v1) / 2;
      }
    }
    this.on = true;
    this.screen = screen;
    const sx = shape(clamp(slew[0], -1, 1)),
      sy = shape(clamp(slew[1], -1, 1));
    if (screen.kind === "scope") {
      this.x += sx * TDC.scopeSpeed * dt;
      this.y += sy * TDC.scopeSpeed * dt;
      // (within the disc)
      const r = Math.hypot(this.x, this.y);
      if (r > 1) {
        this.x /= r;
        this.y /= r;
      }
    } else {
      const R = screen.rect;
      // (the display's v down: the stick up moves the cursor up)
      this.x = clamp(this.x + sx * TDC.pcdSpeed * dt, R.u0, R.u1);
      this.y = clamp(this.y - sy * TDC.pcdSpeed * dt, R.v0, R.v1);
    }
    return true;
  }

  /** Back to rest (another craft, a scene): off, nothing kept. */
  reset() {
    this.on = false;
    this.screen = null;
    this.x = this.y = 0;
    this.kept.clear();
  }
}

/** The slew from several controls at once: on each axis the one moved the most (a pad's stick, a HOTAS's slew, the
 *  arrows). */
export function slewOf(...s: (readonly [number, number] | null | undefined)[]): [number, number] {
  let x = 0,
    y = 0;
  for (const q of s) {
    if (!q) continue;
    if (Math.abs(q[0]) > Math.abs(x)) x = q[0];
    if (Math.abs(q[1]) > Math.abs(y)) y = q[1];
  }
  return [x, y];
}
