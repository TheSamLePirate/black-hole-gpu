/**
 * Reference data for the GPU precision probe (Renderer.precisionProbe, the `probe` entry point of
 * trace.wgsl). Prints JSON with two sets of rays, all with float32-rounded initial conditions so that
 * the comparison isolates the integration:
 *
 *  - "deflection": equatorial rays approaching the critical impact parameter from outside
 *    (b = b_c + δ), integrated in float64 with a tight tolerance; φ∞ is the asymptotic azimuth,
 *    the final φ continued along the weak-field hyperbola φ∞ = φ − asin(b/r) − (2/b)(1 − √(1 − b²/r²)).
 *  - "crossings": rays seen by an observer at r = 60 M, θ = 80°, with the radii of their first three
 *    equatorial crossings — where a thin disk would be hit — from the closed-form solution
 *    (src/analytic.ts, Gralla & Lupsasca 2020): generic rays and rays 10⁻²…10⁻⁴ outside the critical
 *    curve (photon-ring images n = 1, 2).
 *
 * usage: bun scripts/precision-probe.ts > snapshots/probe.json
 */
import { equatorialCrossings } from "../src/analytic";
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
  const f = Math.fround;
  const deflection = [];
  const bc = criticalImpact(a).pro;
  for (const delta of [1e-1, 3e-2, 1e-2, 3e-3, 1e-3, 3e-4, 1e-4]) {
    const b = f(bc + delta);
    const st = equatorialRay(b, a, r0);
    st.p[0] = f(st.p[0]);
    const ref = traceBackwardAdaptive(st, b, a, { tol: 1e-12, epsMax: 0.5, maxSteps: 2_000_000, rEscape, captureTol: captureTolerance(a) });
    if (ref.fate !== "escape") throw new Error(`reference ray δ=${delta} did not escape`);
    deflection.push({ delta, r: r0, theta: Math.PI / 2, L: b, pr: st.p[0], pth: 0, phiInf: phiInfinity(ref.state, b) });
  }

  // crossings seen from θo = 80°
  const thetaO = f((80 * Math.PI) / 180);
  const R = (r: number, lam: number, eta: number) => (r * r + a * a - a * lam) ** 2 - (r * r - 2 * r + a * a) * (eta + (lam - a) ** 2);
  const crossings = [];
  const add = (lam0: number, eta0: number, toward: boolean, kind: string) => {
    const lam = f(lam0);
    const Th = eta0 + a * a * Math.cos(thetaO) ** 2 - (lam * lam) / Math.tan(thetaO) ** 2;
    if (Th <= 0) return;
    const pth = f((toward ? -1 : 1) * Math.sqrt(Th)); // θo < π/2: towards the equator = θ increasing backwards
    const eta = pth * pth - a * a * Math.cos(thetaO) ** 2 + (lam * lam) / Math.tan(thetaO) ** 2;
    const del = r0 * r0 - 2 * r0 + a * a;
    const pr = f(Math.sqrt(R(r0, lam, eta)) / del);
    const ref = equatorialCrossings({ a, ro: r0, thetaO, lambda: lam, eta, towardEquator: toward }, 3);
    if (!ref) return;
    crossings.push({ kind, r: r0, theta: thetaO, L: lam, pr, pth, ref });
  };
  // generic rays (deterministic pseudo-random sample)
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 400; i++) add(-8 + 16 * rnd(), 0.5 + 40 * rnd(), rnd() < 0.5, "generic");
  // just outside Bardeen's critical curve (spherical photon orbit radius rp)
  const lamC = (r: number) => -(r ** 3 - 3 * r * r + a * a * r + a * a) / (a * (r - 1));
  const etaC = (r: number) => (r ** 3 * (4 * a * a - r * (r - 3) ** 2)) / (a * a * (r - 1) ** 2);
  for (let k = 0; k <= 40; k++) {
    const rp = 1.6 + (2.3 * k) / 40;
    if (etaC(rp) <= 0.5) continue;
    for (const eps of [1e-2, 1e-3, 1e-4]) add(lamC(rp), etaC(rp) * (1 + eps), true, `critical ${eps}`);
  }
  console.log(JSON.stringify({ a, rEscape, captureTol: captureTolerance(a), deflection, crossings }));
}
