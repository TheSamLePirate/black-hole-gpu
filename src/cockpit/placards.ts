// The cockpit controls' placards (PLAN-COCKPIT K1): each control's text — engraved under a lever, a switch,
// the knob; the legend on a lit button's cap — drawn once into a texture of cells (cockpit/controls.ts
// PLACARD_GRID), white on transparent, its mips made by halving.

import { CONTROLS, PLACARD_GRID } from "./controls";

/** The placards' picture: a canvas per mip level, the full size first. */
export function placardLevels(): OffscreenCanvas[] {
  const { cols, rows, w, h } = PLACARD_GRID;
  const c = new OffscreenCanvas(cols * w, rows * h);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  CONTROLS.forEach((ctl, k) => {
    const x = (k % cols) * w + w / 2,
      y = Math.floor(k / cols) * h + h / 2;
    // (the size fitted to the cell: a short word large, a long one narrower)
    // (small in its cell: the mips' filtering would blend a neighbour's text in)
    let size = 30;
    g.font = `700 ${size}px ui-monospace, Menlo, monospace`;
    const tw = g.measureText(ctl.placard).width;
    if (tw > w * 0.84) size = Math.floor((size * w * 0.84) / tw);
    g.font = `700 ${size}px ui-monospace, Menlo, monospace`;
    g.fillText(ctl.placard, x, y + 2);
  });
  const levels = [c];
  // (down to 64 × 16 px a cell: smaller, the cells bleed)
  while (levels.at(-1)!.width > 256) {
    const p = levels.at(-1)!;
    const q = new OffscreenCanvas(p.width / 2, p.height / 2);
    q.getContext("2d")!.drawImage(p, 0, 0, q.width, q.height);
    levels.push(q);
  }
  return levels;
}
