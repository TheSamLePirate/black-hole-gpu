// The map's marks — discs, polygons, short lines on the screen, a sphere of influence's faint fill —
// drawn on the GPU when the map has its layer (anti-aliased, under the canvas's labels), else on the
// canvas. Every size in device pixels; colours as CSS ("rgba(…)", "#rrggbb", …).

import type { MapGpu } from "./gpu";

export type Pt = readonly [number, number];

export class Paint {
  /** this frame's GPU layer (null: the canvas draws) */
  G: MapGpu | null = null;

  constructor(private ctx: CanvasRenderingContext2D) {}

  /** A disc: filled, stroked (lw), its rim dashed (dash, gap). */
  disc(x: number, y: number, r: number, fill?: string | null, stroke?: string | null, lw = 1, dash?: readonly number[]) {
    if (this.G) return this.G.disc(x, y, r, fill, stroke, lw, dash);
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, 2 * Math.PI);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.setLineDash(dash ? [...dash] : []);
      c.stroke();
      c.setLineDash([]);
    }
  }

  /** A polygon: its corners from (x, y) (up to 4 on the GPU), filled, stroked. */
  poly(x: number, y: number, pts: readonly Pt[], fill?: string | null, stroke?: string | null, lw = 1) {
    if (this.G) return this.G.poly(x, y, pts, fill, stroke, lw);
    const c = this.ctx;
    c.beginPath();
    pts.forEach(([u, v], j) => (j ? c.lineTo(x + u, y + v) : c.moveTo(x + u, y + v)));
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }

  /** A line on the screen, over everything (dash, gap). */
  path(pts: readonly Pt[], col: string, lw = 1, dash?: readonly number[]) {
    if (pts.length < 2) return;
    if (this.G) {
      this.G.line(col, lw, dash);
      for (const [x, y] of pts) this.G.to(x, y, 0, 1);
      this.G.gap();
      return;
    }
    const c = this.ctx;
    c.strokeStyle = col;
    c.lineWidth = lw;
    c.setLineDash(dash ? [...dash] : []);
    c.beginPath();
    pts.forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
    c.setLineDash([]);
  }

  /** A faint fill rising from clear at r0 to its colour at the rim r1 (a sphere read as a volume). */
  soft(x: number, y: number, r0: number, r1: number, rgb: string, a: number) {
    if (this.G) return this.G.soft(x, y, r0, r1, `rgba(${rgb}, ${a})`);
    const c = this.ctx;
    const gr = c.createRadialGradient(x, y, r0, x, y, r1);
    gr.addColorStop(0, `rgba(${rgb}, 0)`);
    gr.addColorStop(1, `rgba(${rgb}, ${a})`);
    c.fillStyle = gr;
    c.beginPath();
    c.arc(x, y, r1, 0, 2 * Math.PI);
    c.fill();
  }
}
