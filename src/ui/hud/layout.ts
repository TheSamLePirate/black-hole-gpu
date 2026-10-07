// The HUD's room: what the panels hold on the screen, and where an instrument drawn on the HUD's canvas
// (the vertical landing's scope, the runway's box) or a panel placed by the code (the air data) may stand
// without falling under another. The panels are measured on the page, at most four times a second; the
// canvas's own boxes are told here as they are drawn — the e2e "nothing overlaps" reads both (__bh.hud).

/** A box on the screen [CSS px]. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** what it is (a panel's class, an instrument's name) */
  id?: string;
}

/** The panels that hold their place on the screen while flying (the passing menus and toasts left out). */
const PANELS = [
  ".fl-mission",
  ".fl-target",
  ".fl-tel",
  ".fl-orbit",
  ".fl-right",
  ".fl-bezel",
  ".fl-hubcard",
  ".fl-airdata",
  ".fl-entry",
  ".kh.show",
];

let cache: Box[] = [];
let at = -1e9;
let size = "";

const visible = (e: HTMLElement) => {
  if (e.closest("[hidden]")) return false;
  const cs = getComputedStyle(e);
  return cs.display !== "none" && cs.visibility !== "hidden";
};

/** The panels shown now (cached 250 ms; measured again when the window's size changes). */
export function panels(now = performance.now()): Box[] {
  if (typeof document === "undefined") return [];
  const sz = `${innerWidth}x${innerHeight}`;
  if (sz === size && now - at < 250) return cache;
  size = sz;
  at = now;
  const out: Box[] = [];
  for (const sel of PANELS)
    for (const e of document.querySelectorAll<HTMLElement>(`.fl-root:not([hidden]) ${sel}, body > ${sel}`)) {
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, id: sel });
    }
  cache = out;
  return out;
}

/** Forget the measure: a panel just moved (the next call measures again). */
export function remeasure() {
  at = -1e9;
}

export const overlap = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/**
 * Where a box may stand: from where it wants to be, moved along `dir` (a step of 2 px, at most `reach`)
 * until it falls under no panel (`skip`: its own) and stays on the screen with `margin` around it; null:
 * no room within reach.
 */
export function fit(
  want: Box,
  dir: "up" | "down" | "left" | "right",
  o: { reach?: number; margin?: number; skip?: string; others?: Box[] } = {},
): Box | null {
  // (no page — a test drawing on a recorder —: where it wants to be)
  if (typeof innerWidth === "undefined") return want;
  const m = o.margin ?? 6;
  const reach = o.reach ?? 400;
  const blocks = [...panels(), ...(o.others ?? [])].filter((b) => b.id !== o.skip);
  const [dx, dy] = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
  for (let d = 0; d <= reach; d += 2) {
    const b = { ...want, x: want.x + dx * d, y: want.y + dy * d };
    if (b.x < m || b.y < m || b.x + b.w > innerWidth - m || b.y + b.h > innerHeight - m) return null;
    if (!blocks.some((p) => overlap(b, p, m))) return b;
  }
  return null;
}

/** The boxes the HUD's canvas drew this frame (CSS px) — the instruments placed by `fit`. */
export const drawn: Box[] = [];
