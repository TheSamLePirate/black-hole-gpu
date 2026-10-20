// The menus' focus in two dimensions (PLAN-TITRE-AAA): the arrows, the D-pad or the stick move to the nearest
// item that way — by the items' boxes on screen, as a console menu does: the banner, the row of cards, the line
// under them. An item can name its neighbour (data-nav-up="#id" …) where the geometry would choose wrong.

export type Dir = "up" | "down" | "left" | "right";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** the gap along `dir` from `a` to `b` (≥ 0), or null when b is not that way */
function ahead(a: Box, b: Box, dir: Dir): number | null {
  const acx = a.x + a.w / 2,
    acy = a.y + a.h / 2,
    bcx = b.x + b.w / 2,
    bcy = b.y + b.h / 2;
  switch (dir) {
    case "right":
      return bcx > acx + 1 ? Math.max(0, b.x - (a.x + a.w)) : null;
    case "left":
      return bcx < acx - 1 ? Math.max(0, a.x - (b.x + b.w)) : null;
    case "down":
      return bcy > acy + 1 ? Math.max(0, b.y - (a.y + a.h)) : null;
    case "up":
      return bcy < acy - 1 ? Math.max(0, a.y - (b.y + b.h)) : null;
  }
}

/** how far `b` sits off `a`'s line across `dir` (0: they overlap there) */
function across(a: Box, b: Box, dir: Dir): number {
  const [a0, a1, b0, b1] = dir === "left" || dir === "right" ? [a.y, a.y + a.h, b.y, b.y + b.h] : [a.x, a.x + a.w, b.x, b.x + b.w];
  return Math.max(0, b0 - a1, a0 - b1);
}

/**
 * The box to go to from `from`, along `dir`, among `boxes` (its index; −1: none that way). The nearest ahead
 * wins, an item off the line weighing twice its offset — and among those level with it, the one whose centre is
 * nearest across (the card under the one focused, not the first of the row).
 */
export function pickNext(from: Box, boxes: readonly Box[], dir: Dir): number {
  let best = -1,
    bestScore = Infinity;
  const horiz = dir === "left" || dir === "right";
  const fc = horiz ? from.y + from.h / 2 : from.x + from.w / 2;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const gap = ahead(from, b, dir);
    if (gap === null) continue;
    const off = across(from, b, dir);
    const centre = Math.abs((horiz ? b.y + b.h / 2 : b.x + b.w / 2) - fc);
    const score = gap + 2 * off + 0.01 * centre;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The items one can focus in `root`, shown on screen (not hidden, not skipped by data-nav-skip). */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (e) => !e.closest("[data-nav-skip], [hidden], [inert]") && e.getClientRects().length > 0,
  );
}

const NAV_ATTR: Record<Dir, string> = { up: "navUp", down: "navDown", left: "navLeft", right: "navRight" };

/**
 * Moves the focus in `root` along `dir` from the item focused (none, or one outside: the first item).
 * Whether it moved.
 */
export function moveFocus(root: ParentNode, dir: Dir, from = document.activeElement as HTMLElement | null): boolean {
  const items = focusables(root);
  if (!items.length) return false;
  if (!from || !items.includes(from)) {
    items[0]!.focus();
    return true;
  }
  const named = from.dataset[NAV_ATTR[dir]];
  if (named) {
    const to = named === "none" ? null : root.querySelector<HTMLElement>(named);
    if (to && items.includes(to)) to.focus();
    return !!to;
  }
  const box = (e: HTMLElement): Box => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const others = items.filter((e) => e !== from);
  const i = pickNext(box(from), others.map(box), dir);
  if (i < 0) return false;
  others[i]!.focus();
  others[i]!.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return true;
}
