// The sky chart's words on the 2D layer (skychart.ts places them): the constellations' names spaced out
// in capitals, the stars' names beside them, the grids' graduations at the image's edges, the cardinal
// points on the horizon — each with a dark halo, legible over a bright sky; none overlapping another
// (the more important first: cardinal points, stars, constellations, graduations).

import type { ChartLabel } from "../skychart";

const STYLE: Record<ChartLabel["kind"], { font: (k: number) => string; rgb: string; spacing: number; halo: number }> = {
  cardinal: { font: (k) => `700 ${14 * k}px var(--hud-font), ui-sans-serif, sans-serif`, rgb: "255, 196, 120", spacing: 0.12, halo: 3.2 },
  constellation: { font: (k) => `600 ${11.5 * k}px var(--hud-font), ui-sans-serif, sans-serif`, rgb: "178, 206, 255", spacing: 0.24, halo: 3 },
  star: { font: (k) => `500 ${11.5 * k}px var(--font), ui-sans-serif, sans-serif`, rgb: "255, 238, 214", spacing: 0.02, halo: 2.6 },
  grid: { font: (k) => `500 ${10 * k}px var(--mono), ui-monospace, monospace`, rgb: "150, 220, 230", spacing: 0, halo: 2.4 },
  ecliptic: { font: (k) => `italic 500 ${11 * k}px var(--font), ui-sans-serif, sans-serif`, rgb: "255, 216, 110", spacing: 0.04, halo: 2.6 },
};
const ORDER: ChartLabel["kind"][] = ["cardinal", "star", "constellation", "ecliptic", "grid"];

/** Draws the labels (NDC) on a canvas W × H (device pixels, k of them per CSS pixel). */
export function drawChartLabels(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, labels: ChartLabel[], W: number, H: number, k: number) {
  const taken: [number, number, number, number][] = [];
  const free = (x0: number, y0: number, x1: number, y1: number) => !taken.some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.textBaseline = "middle";
  const css = getComputedStyle(document.documentElement);
  const resolve = (f: string) => f.replace(/var\((--[\w-]+)\)/g, (_, v) => css.getPropertyValue(v).trim() || "sans-serif");
  for (const kind of ORDER) {
    const st = STYLE[kind];
    ctx.font = resolve(st.font(k));
    (ctx as { letterSpacing?: string }).letterSpacing = `${st.spacing}em`;
    for (const l of labels) {
      if (l.kind !== kind || l.alpha <= 0.02) continue;
      const text = kind === "constellation" ? l.text.toUpperCase() : l.text;
      const tw = ctx.measureText(text).width;
      const th = parseFloat(ctx.font.match(/(\d+(\.\d+)?)px/)?.[1] ?? "12");
      let x = ((l.x + 1) / 2) * W;
      let y = ((1 - l.y) / 2) * H;
      // (where each sits against its point: names centred, a star's to its right, a graduation inside the
      // image's edge, a cardinal point above the horizon)
      let align: CanvasTextAlign = "center";
      if (kind === "star") (align = "left"), (x += 7 * k), (y -= 6 * k);
      else if (kind === "cardinal") y -= 12 * k;
      else if (kind === "grid") {
        x = Math.min(Math.max(x, 6 * k + tw / 2), W - 6 * k - tw / 2);
        y = Math.min(Math.max(y, 8 * k), H - 10 * k);
      } else if (kind === "ecliptic") (align = "right"), (x -= 8 * k), (y -= 9 * k);
      const x0 = align === "left" ? x : align === "right" ? x - tw : x - tw / 2;
      // (a constellation's name crowded out: tried a line above, then below its place)
      const tries = kind === "constellation" ? [0, -1.6 * th, 1.6 * th] : [0];
      let box: [number, number, number, number] | null = null;
      for (const dy of tries) {
        const b: [number, number, number, number] = [x0 - 3 * k, y + dy - th / 2 - 2 * k, x0 + tw + 3 * k, y + dy + th / 2 + 2 * k];
        if (b[2] < 0 || b[0] > W || b[3] < 0 || b[1] > H || !free(...b)) continue;
        box = b;
        y += dy;
        break;
      }
      if (!box) continue;
      taken.push(box);
      ctx.textAlign = align;
      ctx.lineWidth = st.halo * k;
      ctx.strokeStyle = `rgba(2, 5, 12, ${0.55 * l.alpha})`;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = `rgba(${l.rgb ?? st.rgb}, ${l.alpha})`;
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}
