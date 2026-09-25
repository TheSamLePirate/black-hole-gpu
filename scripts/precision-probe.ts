/**
 * Reference data for the GPU precision probe: equatorial Kerr rays approaching the critical impact
 * parameter from outside (b = b_c + δ), integrated in float64 with a tight tolerance. Prints JSON
 * { a, r0, rEscape, rays: [{ delta, b, pr, phiInf }] } to feed __bh.precisionProbe() in the page.
 *
 * φ∞ is the asymptotic azimuth: the final φ continued along the weak-field hyperbola,
 * φ∞ = φ − asin(b/r) − (2/b)(1 − √(1 − b²/r²)), accurate to O(M²/r²).
 *
 * Inputs are rounded to float32 first, so the comparison isolates the integration error.
 *
 * usage: bun scripts/precision-probe.ts > snapshots/probe.json
 */
import { captureTolerance, criticalImpact, traceBackwardAdaptive, type State } from "../src/physics";

const a = 0.94;
const r0 = 60;
const rEscape = 1000;

export function equatorialRay(b: number, spin: number, r: number): State {
  const del = r * r - 2 * r + spin * spin;
  const W = r * r + spin * spin - spin * b;
  return { x: [r, Math.PI / 2, 0, 0], p: [Math.sqrt(Math.max(0, (W * W) / del - (b - spin) ** 2) / del), 0] };
}

export function phiInfinity(st: State, b: number): number {
  const r = st.x[0];
  const q = b / r;
  return st.x[2] - Math.asin(q) - (2 / b) * (1 - Math.sqrt(1 - q * q));
}

if (import.meta.main) {
  const bc = criticalImpact(a).pro;
  const rays = [];
  for (const delta of [1e-1, 3e-2, 1e-2, 3e-3, 1e-3, 3e-4, 1e-4]) {
    // the GPU receives float32 inputs: use exactly those values for the reference
    const b = Math.fround(bc + delta);
    const st = equatorialRay(b, a, r0);
    st.p[0] = Math.fround(st.p[0]);
    const ref = traceBackwardAdaptive(st, b, a, { tol: 1e-12, epsMax: 0.5, maxSteps: 2_000_000, rEscape, captureTol: captureTolerance(a) });
    if (ref.fate !== "escape") throw new Error(`reference ray δ=${delta} did not escape`);
    rays.push({ delta, b, pr: st.p[0], phiInf: phiInfinity(ref.state, b) });
  }
  console.log(JSON.stringify({ a, r0, rEscape, captureTol: captureTolerance(a), rays }));
}
