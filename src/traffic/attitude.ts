/** Displayed crab angle [rad], driven by reported heading minus track. Ground path stays unchanged.
 * Three-second response, bounded to 2°/s; decrab over the final 15 m, then settle on the runway. */
export function crabStep(angle: number, targetDeg: number, over: number, grounded: boolean, dt: number): number {
  const h = Math.min(1, Math.max(0, (over - 1) / 14));
  const blend = grounded ? 0 : h * h * (3 - 2 * h);
  const target = ((Math.max(-20, Math.min(20, targetDeg)) * Math.PI) / 180) * blend;
  const step = Math.min(0.25, Math.max(0, dt));
  const delta = (target - angle) * -Math.expm1(-step / (grounded ? 1.5 : 3));
  const limit = ((2 * Math.PI) / 180) * step;
  return angle + Math.max(-limit, Math.min(limit, delta));
}
