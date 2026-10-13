import type { Vec3 } from "../physics";
import { sub, dot, cross, add } from "./vec3";
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const inside = (p: Vec3, a: Vec3, b: Vec3, c: Vec3, n: Vec3) =>
  [
    [a, b],
    [b, c],
    [c, a],
  ].every(([x, y]) => dot(cross(sub(y!, x!), sub(p, x!)), n) >= -1e-10);
function pointEdge(p: Vec3, a: Vec3, b: Vec3) {
  const e = sub(b, a),
    t = clamp(dot(sub(p, a), e) / (dot(e, e) || 1));
  return dot(sub(p, add(a, e, t)), sub(p, add(a, e, t)));
}
function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3, n: Vec3) {
  const nn = dot(n, n),
    d = dot(sub(p, a), n);
  if (nn > 1e-20 && inside(add(p, n, -d / nn), a, b, c, n)) return (d * d) / nn;
  return Math.min(pointEdge(p, a, b), pointEdge(p, b, c), pointEdge(p, c, a));
}
function segments(p: Vec3, q: Vec3, a: Vec3, b: Vec3) {
  const d = sub(q, p),
    e = sub(b, a),
    r = sub(p, a),
    dd = dot(d, d),
    ee = dot(e, e),
    de = dot(d, e),
    dr = dot(d, r),
    er = dot(e, r);
  let s = 0,
    t = 0;
  if (dd <= 1e-20) return pointEdge(p, a, b);
  if (ee <= 1e-20) return pointEdge(a, p, q);
  const denom = dd * ee - de * de;
  s = denom > 1e-20 ? clamp((de * er - dr * ee) / denom) : 0;
  t = (de * s + er) / ee;
  if (t < 0) {
    t = 0;
    s = clamp(-dr / dd);
  } else if (t > 1) {
    t = 1;
    s = clamp((de - dr) / dd);
  }
  const diff = sub(add(p, d, s), add(a, e, t));
  return dot(diff, diff);
}
/** Exact squared distance between a finite segment (capsule axis) and an arbitrary triangle. */
export function capsuleTriangle(p: Vec3, q: Vec3, radius: number, a: Vec3, b: Vec3, c: Vec3) {
  const n = cross(sub(b, a), sub(c, a)),
    denom = dot(n, sub(q, p));
  if (Math.abs(denom) > 1e-20) {
    const t = dot(n, sub(a, p)) / denom;
    if (t >= 0 && t <= 1 && inside(add(p, sub(q, p), t), a, b, c, n)) return true;
  }
  return (
    Math.min(pointTriangle(p, a, b, c, n), pointTriangle(q, a, b, c, n), segments(p, q, a, b), segments(p, q, b, c), segments(p, q, c, a)) <
    radius * radius
  );
}
