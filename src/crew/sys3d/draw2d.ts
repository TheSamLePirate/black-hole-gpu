// The system map drawn on the canvas (PLAN-VAISSEAUX K3's fallback — no WebGPU): the projected lines, then the
// spheres far to near (a disc shaded toward its light), all in 2D. The labels are the view's (system.ts), drawn over
// either renderer.
import type { Projected } from "./camera";

const rgba = (c: readonly number[], a = 1) => `rgba(${Math.round(c[0]! * 255)},${Math.round(c[1]! * 255)},${Math.round(c[2]! * 255)},${a})`;

export function drawSystem2d(c: CanvasRenderingContext2D, P: Projected) {
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const l of P.lines) {
    c.beginPath();
    let on = false;
    for (const q of l.pts) {
      if (!q) {
        on = false;
        continue;
      }
      if (on) c.lineTo(q[0], q[1]);
      else c.moveTo(q[0], q[1]);
      on = true;
    }
    c.strokeStyle = rgba(l.colour, l.colour[3]);
    c.lineWidth = l.width;
    c.setLineDash(l.dashed ? [6, 5] : []);
    c.stroke();
  }
  c.setLineDash([]);
  for (const d of [...P.discs].sort((a, b) => b.z - a.z)) {
    if (d.shade === "star") {
      const g = c.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 3);
      g.addColorStop(0, rgba(d.colour, 1));
      g.addColorStop(0.33, rgba(d.colour, 0.9));
      g.addColorStop(1, rgba(d.colour, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(d.x, d.y, d.r * 3, 0, Math.PI * 2);
      c.fill();
      continue;
    }
    if (d.shade === "hole") {
      c.beginPath();
      c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      c.fillStyle = "#000";
      c.fill();
      c.strokeStyle = "rgba(255,170,80,0.7)";
      c.lineWidth = 1.5;
      c.stroke();
      continue;
    }
    if (d.shade === "mouth") {
      c.beginPath();
      c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      c.strokeStyle = "rgba(160,200,255,0.9)";
      c.lineWidth = 2;
      c.stroke();
      continue;
    }
    // a lit sphere: its bright side toward the light (the screen's part of it), its night dim
    const lx = d.x + d.light[0] * d.r * 0.55,
      ly = d.y + d.light[1] * d.r * 0.55;
    const g = c.createRadialGradient(lx, ly, d.r * 0.1, d.x, d.y, d.r * 1.05);
    g.addColorStop(0, rgba(d.colour, 1));
    g.addColorStop(
      0.7,
      rgba(
        d.colour.map((x) => x * 0.55),
        1,
      ),
    );
    g.addColorStop(
      1,
      rgba(
        d.colour.map((x) => x * 0.12),
        1,
      ),
    );
    c.fillStyle = g;
    c.beginPath();
    c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    c.fill();
  }
}
