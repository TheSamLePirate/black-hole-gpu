import type { Vec3 } from "../physics";
import type { Primitive } from "./scenery-data";

export function roadWidth(cls: string, subclass = "") {
  if (cls === "motorway") return 18;
  if (cls === "trunk") return 14;
  if (cls === "primary") return 11;
  if (cls === "secondary") return 9;
  if (cls === "tertiary") return 7;
  if (cls === "minor") return 6;
  if (cls === "service") return 4;
  if (cls === "rail") return 3;
  return subclass === "pedestrian" ? 4 : 2;
}
export function surfaceSegment(a: Vec3, b: Vec3, width: number, kind: number, color: number[]): Primitive {
  const r = width / 2;
  return {
    min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, 0],
    max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, 0],
    tree: false,
    data: [a[0], a[1], b[0], b[1], r, kind, 0, 0, ...color, 0],
  };
}
export function polygonPrimitive(rings: Vec3[][], bottom: number, top: number, kind: number, color: number[]): Primitive | null {
  const edges: number[] = [];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const ring of rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!,
        b = ring[i + 1]!;
      edges.push(a[0], a[1], b[0], b[1]);
      x0 = Math.min(x0, a[0], b[0]);
      y0 = Math.min(y0, a[1], b[1]);
      x1 = Math.max(x1, a[0], b[0]);
      y1 = Math.max(y1, a[1], b[1]);
    }
  if (!edges.length) return null;
  return {
    min: [x0, y0, bottom],
    max: [x1, y1, top],
    tree: false,
    data: [bottom, top, edges.length / 4, kind, x0, y0, x1, y1, ...color, (rings[0]?.length ?? 1) - 1, ...edges],
  };
}
// Analytic strip footprint, shared by bridge decks and parapets; no per-frame mesh work.
export function stripPolygon(a: Vec3, b: Vec3, width: number, offset = 0): Vec3[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / Math.max(length, 1e-6),
    ny = (b[0] - a[0]) / Math.max(length, 1e-6);
  const p = (v: Vec3, side: number): Vec3 => [v[0] + nx * (offset + (side * width) / 2), v[1] + ny * (offset + (side * width) / 2), 0];
  return [p(a, -1), p(b, -1), p(b, 1), p(a, 1), p(a, -1)];
}
export function surfaceContains(p: Vec3, primitive: Primitive, margin = 0) {
  const v = primitive.data;
  if (v[5]! < 4 && v.length === 12) {
    const x = v[2]! - v[0]!,
      y = v[3]! - v[1]!;
    const t = Math.max(0, Math.min(1, ((p[0] - v[0]!) * x + (p[1] - v[1]!) * y) / Math.max(x * x + y * y, 1e-8)));
    return Math.hypot(p[0] - v[0]! - t * x, p[1] - v[1]! - t * y) < v[4]! + margin;
  }
  let inside = false;
  for (let i = 12; i < v.length; i += 4) {
    if (margin > 0) {
      const dx = v[i + 2]! - v[i]!,
        dy = v[i + 3]! - v[i + 1]!;
      const t = Math.max(0, Math.min(1, ((p[0] - v[i]!) * dx + (p[1] - v[i + 1]!) * dy) / Math.max(dx * dx + dy * dy, 1e-8)));
      if ((p[0] - v[i]! - t * dx) ** 2 + (p[1] - v[i + 1]! - t * dy) ** 2 < margin * margin) return true;
    }
    if (v[i + 1]! > p[1] !== v[i + 3]! > p[1] && p[0] < v[i]! + ((p[1] - v[i + 1]!) * (v[i + 2]! - v[i]!)) / (v[i + 3]! - v[i + 1]!))
      inside = !inside;
  }
  return inside;
}
