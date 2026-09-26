import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { defaultSettings, presets } from "../src/settings";
import { GARGANTUA_SYSTEM } from "../src/system/bodies";
import { ourPatch } from "../src/system/local-patch";
import { gravityHome, homeOf, homeToRep, ourGravity, ourState, repOf, repToHomeVec } from "../src/system/our-side";
import { M_SECONDS, solarState } from "../src/system/solar";
import { flyDneg, mouth, radius } from "../src/wormhole";

// Our universe, beyond our end of the wormhole: the solar system pulls the ship (Newton), and the
// local patch draws a body where the traced rays meet it.

const s = Object.assign(defaultSettings(), presets["Gargantua system (10⁸ M☉, a* = 0.998)"]);
const w = mouth(s).w;
const saturn = GARGANTUA_SYSTEM.bodies.find((b) => b.id === "saturn")!;
const earth = GARGANTUA_SYSTEM.bodies.find((b) => b.id === "earth")!;
const S = ourState("saturn", 0).pos;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("the solar system to scale: the Earth at 1 AU from the Sun, Saturn 0.7 AU from our mouth", () => {
  const AU = 1.495978707e11 / 1.476625e11;
  const sun = ourState("sun", 0).pos;
  expect(dist(ourState("earth", 0).pos, sun) / AU).toBeGreaterThan(0.98);
  expect(dist(ourState("earth", 0).pos, sun) / AU).toBeLessThan(1.02);
  // (0.7 AU along an eccentric orbit: 0.67 – 0.74)
  expect(Math.hypot(...S) / AU).toBeGreaterThan(0.66);
  expect(Math.hypot(...S) / AU).toBeLessThan(0.75);
  // the Moon 384 000 km from the Earth, one turn in 27.3 days
  const em = dist(ourState("moon", 0).pos, ourState("earth", 0).pos) * 1.476625e8;
  expect(em).toBeGreaterThan(356e3);
  expect(em).toBeLessThan(407e3);
  // the Earth moves at ~30 km/s around the Sun (the frame's own motion taken off: ~10 km/s of it)
  const day = 86400 / M_SECONDS;
  const a = solarState("earth", 0).pos, b = solarState("earth", day).pos;
  const sa = solarState("sun", 0).pos, sb = solarState("sun", day).pos;
  const v = (dist([b[0] - sb[0], b[1] - sb[1], b[2] - sb[2]], [a[0] - sa[0], a[1] - sa[1], a[2] - sa[2]]) * 1.476625e8) / 86400;
  expect(v).toBeGreaterThan(29);
  expect(v).toBeLessThan(31);
});

test("the pull near Saturn and near the Earth (Newton, towards them)", () => {
  const u = S.map((x) => x / Math.hypot(...S)) as Vec3;
  const d = 17 * saturn.radius;
  const X: Vec3 = [S[0] + d * u[0], S[1] + d * u[1], S[2] + d * u[2]];
  const p = repOf(w, X);
  const g = ourGravity(w, p.l, p.n, 0);
  const aSat = saturn.mass / (d * d);
  expect(Math.hypot(...g.acc) / aSat).toBeGreaterThan(0.95);
  expect(Math.hypot(...g.acc) / aSat).toBeLessThan(1.05);
  expect(g.inside).toBe(null);
  // 400 km above the Earth: g ≈ 8.7 m/s²
  const E = ourState("earth", 0).pos;
  const r = earth.radius + 400e3 / 1.476625e11;
  const Y: Vec3 = [E[0] + r, E[1], E[2]];
  const ge = gravityHome(Y, 0);
  const si = (Math.hypot(...ge.acc) * 299792458 ** 2) / 1.476625e11;
  expect(si).toBeGreaterThan(8.5);
  expect(si).toBeLessThan(8.9);
});

test("rep ↔ home vectors round trip", () => {
  const p = repOf(w, [0.3, -0.5, 0.2]);
  const v: Vec3 = [0.1, 0.2, -0.3];
  const u = repToHomeVec(w, p.l, p.n, homeToRep(w, p.l, p.n, v));
  for (let i = 0; i < 3; i++) expect(u[i]!).toBeCloseTo(v[i]!, 12);
  const X = homeOf(w, p.l, p.n);
  expect(X[0]).toBeCloseTo(0.3, 9);
});

test("a circular orbit around Saturn closes after one period (Dneg geodesics + Newton)", () => {
  const d = 20 * saturn.radius;
  const X: Vec3 = [S[0], S[1], S[2] + d];
  const vc = Math.sqrt(saturn.mass / d);
  const T = (2 * Math.PI * d) / vc;
  const V0 = ourState("saturn", 0).vel;
  let { l, n } = repOf(w, X);
  let v = homeToRep(w, l, n, [V0[0] + vc, V0[1], V0[2]]);
  const N = 4000;
  const dt = T / N;
  let minD = Infinity;
  for (let i = 0; i < N; i++) {
    const g = ourGravity(w, l, n, i * dt).acc;
    v = v.map((x, k) => x + g[k]! * dt) as Vec3;
    const sp = Math.hypot(...v);
    const q = flyDneg(w, l, n, v.map((x) => x / sp) as Vec3, [], sp * dt);
    l = q.l; n = q.n; v = q.dir.map((x) => x * sp) as Vec3;
    minD = Math.min(minD, dist(homeOf(w, l, n), ourState("saturn", (i + 1) * dt).pos));
  }
  const Y = homeOf(w, l, n);
  const S1 = ourState("saturn", T).pos;
  expect(minD / d).toBeGreaterThan(0.95);
  expect(dist(Y, [S1[0], S1[1], S1[2] + d]) / d).toBeLessThan(0.08);
});

test("the local patch puts Saturn where it is, seen from our side", () => {
  const u = S.map((x) => x / Math.hypot(...S)) as Vec3;
  const d = 17 * saturn.radius;
  const X: Vec3 = [S[0] + d * u[0], S[1] + d * u[1], S[2] + d * u[2]];
  const p = repOf(w, X);
  const cam = { region: "throat" as const, r: radius(w, p.l)[0], ell: p.l, n: p.n, beta: [0, 0, 0] as Vec3 };
  const sun = ourState("sun", 0).pos;
  const list = [
    { id: "sun", pos: sun, radius: 0.0047, light: -1, where: 2, pole: [0, 0, 1] as Vec3 },
    { id: "saturn", pos: S, radius: saturn.radius, light: 0, where: 4, rings: saturn.rings, pole: saturn.pole, spin: 0.3 },
  ];
  const lp = ourPatch(cam as never, list as never, radius(w, p.l)[1])!;
  expect(lp.index).toBe(1);
  expect(Math.hypot(...lp.centre)).toBeGreaterThan(17 * 0.99);
  expect(Math.hypot(...lp.centre)).toBeLessThan(17 * 1.02);
  expect(Math.hypot(...lp.axes[2])).toBeCloseTo(1, 9);
});
