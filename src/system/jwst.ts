// The James Webb Space Telescope (JWST) on its Southern Halo orbit around Sun–Earth L2
// (assets/jwst/jwst.bin built by scripts/build-jwst.ts).
//
// Attitude: real thermal-protection geometry — the 5-layer Kapton sunshield (−Y in model frame)
// permanently faces the Sun to keep the 6.5 m gold-coated beryllium primary mirror (+Y cold side,
// optical boresight +Z) in cryogenic deep-space shadow.
//
// Dynamics: deterministic analytical Halo orbit afar (identical across all network peers & crew
// consoles: lagrange.ts haloState, its phase clocked by the Sun–EMB synodic angle — any date gives
// the same orbit); within 50 km of the player's spacecraft, integrated with the game's own full
// N-body `gravityHome` (velocity Verlet, same fall as the ship: zero relative drift during formation
// flight or station-keeping). The tracker has one writer, the simulation's step (controller/
// stationkeep.ts jwstFollow, from sim.ts); the renderer, the maps, the HUD and the station keeping
// read it with `peek`.

import type { Vec3 } from "../physics";
import { add, cross, dot, len, lin, scale, sub, unit } from "../math/vec3";
import { M_METRES, M_SECONDS, solarState } from "./solar";
import { gravityHome } from "./our-side";
import { haloOrbitLoop, haloState, type HaloParams } from "./lagrange";

/** JWST's bounding sphere half-span for framing, picking, and shadow map [m]. */
export const JWST_RADIUS_M = 12;

/** JWST's Southern Halo orbit around Sun–Earth L2 (A_z ≈ 260,000 km, A_y ≈ 750,000 km, period ≈ 178 days). */
export const JWST_HALO: HaloParams = {
  azM: 260_000e3,
  branch: -1,
  phase0: 0.45,
};

const C_KMS = 299792.458;
const M_S = M_METRES / (C_KMS * 1e3);

/** JWST's deterministic Halo orbit state at scene time `t` [M] in the home frame [M, c]. */
export function jwstOrbit(t: number): { X: Vec3; V: Vec3 } | null {
  const h = haloState("lag:earth:2", t, JWST_HALO);
  return h ? { X: h.pos, V: h.vel } : null;
}

/** Sampled closed 3D Halo orbit loop of JWST around Sun–Earth L2 at epoch `t0` [M] (for 3D maps). */
export function jwstHaloLoop(t0: number, n = 96): Vec3[] {
  return haloOrbitLoop("lag:earth:2", t0, JWST_HALO, n);
}

/**
 * JWST's real attitude in the home frame: [ex, ey, ez] (columns of model→home rotation).
 * Model frame (scripts/build-jwst.ts):
 *  - −Y faces the Sun (hot sunshield Layer 5 + spacecraft bus + solar array)
 *  - +Y faces away from the Sun (cold observatory side: 6.5 m gold primary mirror)
 *  - +Z is the primary mirror optical boresight (observing deep space perpendicular to the Sun): the primary's disc
 *    lies in x–y at z ≈ 1.8 m, the secondary on its struts in front of it at z ≈ 4.9 m (read from jwst.bin)
 *  - +X is the lateral kite wing axis (+Y × +Z = +X, right-handed)
 */
export function jwstAxes(X: Vec3, _V: Vec3, t: number): [Vec3, Vec3, Vec3] {
  const S = solarState("sun", t).pos;
  const toSun = unit(sub(S, X));
  // −Y toward Sun (with a subtle realistic 8° observatory pitch within JWST's 85°–135° solar elongation band)
  const eclN: Vec3 = [0, 0, 1];
  const tangent0 = cross(eclN, toSun);
  const tangent = len(tangent0) > 1e-6 ? unit(tangent0) : ([1, 0, 0] as Vec3);
  const north = cross(toSun, tangent);
  // Slow astronomical field-of-regard roll about the Sun line (~1°/day)
  const roll = ((t * M_SECONDS) / 86400) * (Math.PI / 180) * 0.6;
  const cr = Math.cos(roll),
    sr = Math.sin(roll);
  const lookPerp = unit(add(scale(north, cr), tangent, sr));
  // Cold side +Y points anti-Sun (−toSun), pitched 8° toward deep space so sunshield always shades the mirror
  const tilt = (8 * Math.PI) / 180;
  const ey = unit(add(scale(toSun, -Math.cos(tilt)), lookPerp, Math.sin(tilt)));
  // Optical boresight +Z looks along deep-space target perpendicular to +Y
  const bore = unit(sub(lookPerp, scale(ey, dot(lookPerp, ey))));
  const ez = bore;
  const ex = unit(cross(ey, ez));
  return [ex, ey, ez];
}

/**
 * JWST tracker (mirrors IssTracker in iss.ts):
 * Deterministic Halo orbit afar; within 50 km of the player's craft, flown by velocity Verlet in
 * `gravityHome` so relative motion during rendezvous / station-keeping is exact.
 */
export class JwstTracker {
  private st: { t: number; X: Vec3; V: Vec3 } | null = null;
  near = false;
  anchors = 0;

  state(t: number, ship: Vec3 | null): { X: Vec3; V: Vec3 } | null {
    const h = jwstOrbit(t);
    if (!h) return null;
    const d = ship ? len(sub(ship, h.X)) * M_METRES : Infinity;
    if (d > (this.near ? 60e3 : 50e3)) {
      this.near = false;
      this.st = null;
      return h;
    }
    this.near = true;
    const st = this.st;
    if (st && t < st.t && (st.t - t) * M_S < 300) return this.flown(st, t);
    if (!st || t < st.t || (t - st.t) * M_S > 3600) {
      this.anchors++;
      this.st = { t, X: h.X, V: h.V };
      return this.st;
    }
    this.st = this.flown(st, t);
    return this.st;
  }

  last() {
    return this.st;
  }

  peek(t: number): { X: Vec3; V: Vec3 } | null {
    const st = this.st;
    if (this.near && st && Math.abs(t - st.t) * M_S < 3600) return this.flown(st, t);
    return jwstOrbit(t);
  }

  private flown(st: { t: number; X: Vec3; V: Vec3 }, t1: number) {
    const span = t1 - st.t;
    if (span === 0) return st;
    const n = Math.max(1, Math.ceil((Math.abs(span) * M_S) / 10));
    const h = span / n;
    let { X, V, t } = st;
    let a = gravityHome(X, t).acc;
    for (let i = 0; i < n; i++) {
      V = lin(V, 1, a, h / 2);
      X = lin(X, 1, V, h);
      t += h;
      a = gravityHome(X, t).acc;
      V = lin(V, 1, a, h / 2);
    }
    return { t: t1, X, V };
  }
}

export const jwstTrack = new JwstTracker();

/**
 * A dramatic hero start beside JWST (dist metres out along its mirror side & slightly sunward so
 * both the 6.5 m golden hexagonal mirror and the 5-layer Kapton sunshield are framed against deep space).
 */
export function jwstStart(t: number, dist = 42): { X: Vec3; fwd: Vec3; up: Vec3; vel: Vec3 } | null {
  const st = jwstOrbit(t);
  if (!st) return null;
  const A = jwstAxes(st.X, st.V, t);
  // Offset in JWST model axes: +X lateral 3/4, +Y cold gold mirror side, +Z in front of primary mirror & tripod
  const offModel = unit([0.56, 0.44, 0.7]);
  const offHome = add(add(scale(A[0], offModel[0] * dist), scale(A[1], offModel[1] * dist)), scale(A[2], offModel[2] * dist));
  const X = add(st.X, scale(offHome, 1 / M_METRES));
  const fwd = unit(sub(st.X, X));
  // Up aligned with observatory cold normal (+Y) orthogonalized to fwd
  const up = unit(sub(A[1], scale(fwd, dot(A[1], fwd))));
  return { X, fwd, up, vel: st.V };
}
