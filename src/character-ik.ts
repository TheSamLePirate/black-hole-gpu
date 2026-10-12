// The astronaut's feet on the ground under them: a two-bone leg (thigh, calf) bent so that its ankle reaches a
// target, the knee kept in the plane it had (its pole). Pure arithmetic on joint positions and column-major
// 4×4 matrices, so the tests hold it to its millimetres.
type V = [number, number, number];

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A matrix's translation (its joint's position). */
export const jointAt = (m: ArrayLike<number>): V => [m[12]!, m[13]!, m[14]!];

/**
 * The knee's new place for an ankle at target: thigh and shin lengths kept, the knee in the plane of the hip,
 * the target and its present place (bent the same way). A target out of reach is reached as nearly as the
 * leg can (straight, 1 mm short of locked).
 */
export function solveKnee(hip: V, knee: V, ankle: V, target: V): V {
  const a = len(sub(knee, hip)),
    b = len(sub(ankle, knee));
  const toTarget = sub(target, hip);
  const reach = len(toTarget);
  if (reach < 1e-6 || a < 1e-6 || b < 1e-6) return knee;
  const d = Math.min(Math.max(reach, Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const dir: V = [toTarget[0] / reach, toTarget[1] / reach, toTarget[2] / reach];
  // (the pole: the knee's offset off the hip–target line, as it is bent now)
  const k = sub(knee, hip);
  let pole: V = sub(k, [dir[0] * dot(k, dir), dir[1] * dot(k, dir), dir[2] * dot(k, dir)]);
  if (len(pole) < 1e-6) pole = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  const pl = len(pole);
  pole = [pole[0] / pl, pole[1] / pl, pole[2] / pl];
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  return [0, 1, 2].map((i) => hip[i]! + a * (cosA * dir[i]! + sinA * pole[i]!)) as V;
}

/** The rotation (row-major 3×3) turning the direction of `from` onto that of `to` (the shortest arc). */
export function rotationBetween(from: V, to: V): number[] {
  const f = len(from),
    t = len(to);
  if (f < 1e-9 || t < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const u: V = [from[0] / f, from[1] / f, from[2] / f],
    v: V = [to[0] / t, to[1] / t, to[2] / t];
  const c = dot(u, v);
  const axis = cross(u, v);
  const s = len(axis);
  if (s < 1e-9) {
    if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    // (opposite: half a turn about any axis across them)
    const p = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
    const n = len(p);
    const [x, y, z] = [p[0] / n, p[1] / n, p[2] / n];
    return [2 * x * x - 1, 2 * x * y, 2 * x * z, 2 * x * y, 2 * y * y - 1, 2 * y * z, 2 * x * z, 2 * y * z, 2 * z * z - 1];
  }
  const [x, y, z] = [axis[0] / s, axis[1] / s, axis[2] / s];
  const C = 1 - c;
  return [
    c + x * x * C,
    x * y * C - z * s,
    x * z * C + y * s,
    y * x * C + z * s,
    c + y * y * C,
    y * z * C - x * s,
    z * x * C - y * s,
    z * y * C + x * s,
    c + z * z * C,
  ];
}

/** The column-major 4×4 m turned in place by the rotation R (row-major 3×3) about the point pivot. */
export function rotateAbout(m: Float32Array, pivot: V, R: number[]) {
  for (let col = 0; col < 4; col++) {
    const x = m[col * 4]!,
      y = m[col * 4 + 1]!,
      z = m[col * 4 + 2]!;
    // (the translation column turns about the pivot; the axes turn alone)
    const px = col === 3 ? pivot[0] : 0,
      py = col === 3 ? pivot[1] : 0,
      pz = col === 3 ? pivot[2] : 0;
    const dx = x - px,
      dy = y - py,
      dz = z - pz;
    m[col * 4] = R[0]! * dx + R[1]! * dy + R[2]! * dz + px;
    m[col * 4 + 1] = R[3]! * dx + R[4]! * dy + R[5]! * dz + py;
    m[col * 4 + 2] = R[6]! * dx + R[7]! * dy + R[8]! * dz + pz;
  }
}
