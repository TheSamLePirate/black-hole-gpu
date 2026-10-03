// The view's free frame: where the HUD may draw its marks without falling under the interface — below
// the mission bar, above the hub and its attitude ball, off the sides. Measured on the page (the bars
// move with the window, the density, a phone's rotation), at most four times a second: the marks at
// the screen's edge, the target's lock and the heading tape all keep to it.

export interface SafeFrame {
  /** CSS px from the top / the bottom of the window */
  top: number;
  bottom: number;
  /** CSS px off each side */
  side: number;
}

let cache: SafeFrame | null = null;
let at = -1e9;
let size = "";

/** The free frame now (cached 250 ms, measured again when the window's size changes). */
export function safeFrame(now = performance.now()): SafeFrame {
  // (no page — a test, a worker —: the frame the HUD was drawn for before)
  if (typeof document === "undefined") return { top: 120, bottom: 250, side: 60 };
  const sz = `${innerWidth}x${innerHeight}`;
  if (cache && sz === size && now - at < 250) return cache;
  size = sz;
  at = now;
  const shown = (sel: string) => {
    const e = document.querySelector<HTMLElement>(sel);
    if (!e || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return r.width && r.height ? r : null;
  };
  // (flying: the mission bar on top, the hub with the ball at the bottom; on foot: the dock)
  const bar = shown(".fl-root:not([hidden]) .fl-mission");
  const ball = shown(".fl-root:not([hidden]) .fl-cockpit") ?? shown("#toolbar");
  cache = {
    top: Math.max(bar ? bar.bottom + 16 : 56, 56),
    bottom: Math.max(ball ? innerHeight - ball.top + 12 : 70, 70),
    // (flying, the speed and altitude tapes stand on each side)
    side: bar ? 120 : 60,
  };
  return cache;
}
