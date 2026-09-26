import { expect, test } from "bun:test";
import { ourGravity } from "../src/system/our-side";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { GARGANTUA_SYSTEM } from "../src/system/bodies";
import { bodyState } from "../src/system/ephemeris";
import { ellOfR, flyDneg, mouth, radius, sidePosition } from "../src/wormhole";
import { ourPatch } from "../src/system/local-patch";

// Our universe, beyond our end of the wormhole: the Sun and Saturn pull the ship (Newton), and the
// local patch draws Saturn where the Dneg-traced rays meet it.

const s = Object.assign(defaultSettings(), presets["Gargantua system (10⁸ M☉, a* = 0.998)"]);
const w = mouth(s).w;
const saturn = GARGANTUA_SYSTEM.bodies.find((b) => b.id === "saturn")!;
const S = bodyState(GARGANTUA_SYSTEM, "saturn", 0).pos;
const sun = GARGANTUA_SYSTEM.bodies.find((b) => b.id === "sun")!;
const Sun = bodyState(GARGANTUA_SYSTEM, "sun", 0).pos;

/** home point → (ℓ < 0, n) */
function toRep(X: Vec3) {
  const r = Math.hypot(...X);
  return { l: -ellOfR(w, r), n: sidePosition(-1, [X[0] / r, X[1] / r, X[2] / r]) };
}
const home = (l: number, n: Vec3): Vec3 => {
  const r = radius(w, l)[0];
  return [r * n[0], -r * n[1], r * n[2]];
};

test("the Sun and Saturn pull a ship on our side (Newton, towards them)", () => {
  // 17 Saturn radii out, on the side away from the mouth
  const u = S.map((x) => x / Math.hypot(...S)) as Vec3;
  const d = 17 * saturn.radius;
  const X: Vec3 = [S[0] + d * u[0], S[1] + d * u[1], S[2] + d * u[2]];
  const p = toRep(X);
  const g = ourGravity(w, p.l, p.n);
  const aSat = saturn.mass / (d * d);
  const toSun = Math.hypot(Sun[0] - X[0], Sun[1] - X[1], Sun[2] - X[2]);
  const aSun = sun.mass / (toSun * toSun);
  // (Saturn dominates 50 : 1 here; rep radial components are proper lengths, within 2 % of home ones)
  expect(aSat / aSun).toBeGreaterThan(20);
  expect(Math.hypot(...g.acc) / aSat).toBeGreaterThan(0.95);
  expect(Math.hypot(...g.acc) / aSat).toBeLessThan(1.05);
  // towards Saturn: after a short fall from rest the ship is closer
  let l = p.l, n = p.n, v: Vec3 = [0, 0, 0];
  const dt = 0.5;
  for (let i = 0; i < 40; i++) {
    v = v.map((x, k) => x + ourGravity(w, l, n).acc[k]! * dt) as Vec3;
    const sp = Math.hypot(...v);
    const q = flyDneg(w, l, n, v.map((x) => x / sp) as Vec3, [], sp * dt);
    l = q.l; n = q.n; v = q.dir.map((x) => x * sp) as Vec3;
  }
  const Y = home(l, n);
  expect(Math.hypot(Y[0] - S[0], Y[1] - S[1], Y[2] - S[2])).toBeLessThan(d * 0.999);
  expect(g.inside).toBe(false);
});

test("a circular orbit around Saturn closes after one period", () => {
  const d = 20 * saturn.radius;
  const X: Vec3 = [S[0], S[1], S[2] + d]; // over its pole
  const vc = Math.sqrt(saturn.mass / d);
  const T = (2 * Math.PI * d) / vc;
  // (velocity along home x, turned into rep components: tangential here → unchanged apart from the mirror)
  let { l, n } = toRep(X);
  const N = 4000;
  const dt = T / N;
  const vx: Vec3 = [vc, 0, 0];
  // home → rep for a vector at n (sideToRep(−1), radial part proper)
  const nh: Vec3 = [n[0], -n[1], n[2]];
  const vr = vx[0] * nh[0] + vx[1] * nh[1] + vx[2] * nh[2];
  let v: Vec3 = [vx[0] - 2 * vr * nh[0], -(vx[1] - 2 * vr * nh[1]), vx[2] - 2 * vr * nh[2]];
  // (that is sideToRep(−1, n, vx) for a unit radial scale; |r′| ≈ 1 this far out)
  let minD = Infinity;
  for (let i = 0; i < N; i++) {
    const g = ourGravity(w, l, n).acc;
    v = v.map((x, k) => x + g[k]! * dt) as Vec3;
    const sp = Math.hypot(...v);
    const q = flyDneg(w, l, n, v.map((x) => x / sp) as Vec3, [], sp * dt);
    l = q.l; n = q.n; v = q.dir.map((x) => x * sp) as Vec3;
    const Y = home(l, n);
    minD = Math.min(minD, Math.hypot(Y[0] - S[0], Y[1] - S[1], Y[2] - S[2]));
  }
  const Y = home(l, n);
  // (the Sun's tide and the Dneg's slight curvature: a few per cent)
  expect(minD / d).toBeGreaterThan(0.95);
  expect(Math.hypot(Y[0] - X[0], Y[1] - X[1], Y[2] - X[2]) / d).toBeLessThan(0.08);
});

test("the local patch puts Saturn where it is, seen from our side", () => {
  const u = S.map((x) => x / Math.hypot(...S)) as Vec3;
  const d = 17 * saturn.radius;
  const X: Vec3 = [S[0] + d * u[0], S[1] + d * u[1], S[2] + d * u[2]];
  const p = toRep(X);
  const cam = { region: "throat" as const, r: radius(w, p.l)[0], ell: p.l, n: p.n, beta: [0, 0, 0] as Vec3 };
  const list = [
    { id: "sun", pos: Sun, radius: sun.radius, light: -1, where: 2 },
    { id: "saturn", pos: S, radius: saturn.radius, light: 0, where: 2, rings: saturn.rings },
  ];
  const lp = ourPatch(cam as never, list as never, radius(w, p.l)[1])!;
  expect(lp.index).toBe(1);
  // 17 radii away (the radial part in proper length: within 2 %)
  expect(Math.hypot(...lp.centre)).toBeGreaterThan(17 * 0.99);
  expect(Math.hypot(...lp.centre)).toBeLessThan(17 * 1.02);
  // the rings' pole and the sunlight: unit vectors, the Sun on the lit face seen from here
  expect(Math.hypot(...lp.axes[2])).toBeCloseTo(1, 9);
  const dn = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view: Vec3 = [-lp.centre[0], -lp.centre[1], -lp.centre[2]];
  expect(dn(lp.axes[2], view) * dn(lp.axes[2], lp.light)).toBeGreaterThan(0);
});
