import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { secularRates, secularZonal, ZONAL, zonalAccelAbout, type Zonal } from "../src/system/geopotential";
import { gravityHome } from "../src/system/our-side";
import { solarBody, solarState } from "../src/system/solar";
import { M_METRES, M_SECONDS } from "../src/units";

// The oblate bodies' pull (audit P2): the harmonics' acceleration against Vallado's closed form and the
// potential's gradient; an orbit integrated with it regresses its node as the theory says (the ISS's
// −5° a day, a sun-synchronous orbit's +0.9856°); the rails' secular drift follows the integrated one.

const MU = 3.986004418e14,
  RE = 6378137;
const EARTH: Zonal = { R: RE, J: ZONAL.earth!.J };
const Z: Vec3 = [0, 0, 1];
const D = Math.PI / 180;

test("J2 alone: Vallado's closed form", () => {
  const J2: Zonal = { R: RE, J: [EARTH.J[0], 0, 0] };
  for (const d of [
    [7e6, 0, 0],
    [3e6, -4e6, 5e6],
    [-1e6, 2e6, -6.8e6],
  ] as Vec3[]) {
    const r = Math.hypot(...d),
      u2 = (d[2] / r) ** 2;
    const k = (-1.5 * J2.J[0] * MU * RE ** 2) / r ** 5;
    const want = [k * d[0] * (1 - 5 * u2), k * d[1] * (1 - 5 * u2), k * d[2] * (3 - 5 * u2)];
    const got = zonalAccelAbout(MU, J2, Z, d);
    for (let i = 0; i < 3; i++) expect(got[i]!).toBeCloseTo(want[i]!, 12);
  }
});

test("J2–J4: minus the gradient of the potential's terms", () => {
  const P = [
    (u: number) => (3 * u * u - 1) / 2,
    (u: number) => (5 * u ** 3 - 3 * u) / 2,
    (u: number) => (35 * u ** 4 - 30 * u * u + 3) / 8,
  ];
  const phi = (d: Vec3) => {
    const r = Math.hypot(...d),
      u = d[2] / r;
    return EARTH.J.reduce((s, J, i) => s + (MU * J * RE ** (i + 2) * P[i]!(u)) / r ** (i + 3), 0);
  };
  const d: Vec3 = [2.1e6, -3.3e6, 5.4e6];
  const got = zonalAccelAbout(MU, EARTH, Z, d);
  const h = 1;
  for (let i = 0; i < 3; i++) {
    const a = [...d] as Vec3,
      b = [...d] as Vec3;
    a[i]! += h;
    b[i]! -= h;
    expect(got[i]!).toBeCloseTo(-(phi(a) - phi(b)) / (2 * h), 9);
  }
});

/** An orbit integrated a day about a point mass with the Earth's harmonics: its node's drift [°/day]. */
function nodeDrift(alt: number, incl: number, days = 1) {
  const r0 = RE + alt,
    v0 = Math.sqrt(MU / r0);
  let X: Vec3 = [r0, 0, 0];
  let V: Vec3 = [0, v0 * Math.cos(incl), v0 * Math.sin(incl)];
  const acc = (x: Vec3): Vec3 => {
    const r = Math.hypot(...x),
      z = zonalAccelAbout(MU, EARTH, Z, x);
    return [(-MU * x[0]) / r ** 3 + z[0], (-MU * x[1]) / r ** 3 + z[1], (-MU * x[2]) / r ** 3 + z[2]];
  };
  const node = (x: Vec3, v: Vec3) => {
    const h = [x[1] * v[2] - x[2] * v[1], x[2] * v[0] - x[0] * v[2]];
    return Math.atan2(h[0]!, -h[1]!);
  };
  const n0 = node(X, V);
  const dt = 5;
  let a = acc(X);
  for (let t = 0; t < days * 86400; t += dt) {
    V = [V[0] + (a[0] * dt) / 2, V[1] + (a[1] * dt) / 2, V[2] + (a[2] * dt) / 2];
    X = [X[0] + V[0] * dt, X[1] + V[1] * dt, X[2] + V[2] * dt];
    a = acc(X);
    V = [V[0] + (a[0] * dt) / 2, V[1] + (a[1] * dt) / 2, V[2] + (a[2] * dt) / 2];
  }
  let dn = node(X, V) - n0;
  if (dn > Math.PI) dn -= 2 * Math.PI;
  if (dn < -Math.PI) dn += 2 * Math.PI;
  return { drift: dn / D / days, X, V };
}

test("the ISS's node regresses about 5° a day, as the J2 theory says", () => {
  const { drift } = nodeDrift(408e3, 51.64 * D);
  const theory = (secularRates(MU, EARTH, RE + 408e3, 0, Math.cos(51.64 * D)).node * 86400) / D;
  expect(theory).toBeCloseTo(-5.0, 0);
  expect(Math.abs(drift - theory)).toBeLessThan(0.04 * Math.abs(theory));
});

test("an orbit at 98° and 700 km turns its node with the Sun (sun-synchronous, +0.9856°/day)", () => {
  // (the sun-synchronous inclination at 700 km: cos i = −Ω̇ₛ / (1.5 n J2 (R/a)²))
  const a = RE + 700e3;
  const k = 1.5 * Math.sqrt(MU / a ** 3) * EARTH.J[0] * (RE / a) ** 2;
  const i = Math.acos(-((0.9856 * D) / 86400) / k);
  expect(i / D).toBeCloseTo(98.2, 0);
  const { drift } = nodeDrift(700e3, i, 2);
  expect(drift).toBeCloseTo(0.9856, 1);
});

test("on rails, the secular drift follows the integrated orbit's node", () => {
  const incl = 51.64 * D,
    r0 = RE + 408e3,
    v0 = Math.sqrt(MU / r0);
  const { X } = nodeDrift(408e3, incl, 1);
  // (the rails: a Kepler orbit is periodic — the initial state, turned by a day's drift; in the game's
  // units, M of length and time, velocities in c)
  const C = 299792458;
  const muM = solarBody("earth")!.mass;
  const turned = secularZonal(
    "earth",
    muM,
    [r0 / M_METRES, 0, 0],
    [0, (v0 * Math.cos(incl)) / C, (v0 * Math.sin(incl)) / C],
    86400 / M_SECONDS,
    0,
    Z,
  );
  // (both planes: their normals within a few hundredths of a degree)
  const pole = (x: Vec3, v: Vec3) => {
    const h: Vec3 = [x[1] * v[2] - x[2] * v[1], x[2] * v[0] - x[0] * v[2], x[0] * v[1] - x[1] * v[0]];
    const l = Math.hypot(...h);
    return h.map((c) => c / l);
  };
  const hn = pole(turned.r, turned.v);
  // (the integrated one's node from its plane, the same way)
  const nInt = nodeDrift(408e3, incl, 1);
  const hi = pole(nInt.X, nInt.V);
  const ang =
    Math.acos(
      Math.min(
        1,
        hn.reduce((s, c, i) => s + c * hi[i]!, 0),
      ),
    ) / D;
  expect(ang).toBeLessThan(0.05);
  expect(Math.hypot(...X)).toBeGreaterThan(RE);
});

test("the flight's gravity near the Earth holds the J2 term (a thousandth of g, not the Moon's 10⁻⁷)", () => {
  const t = 0;
  const E = solarState("earth", t).pos;
  const muE = solarBody("earth")!.mass;
  // (a point 400 km over the equator of date's latitude 0: the J2 pull there, inwards, 1.5 J2 (R/r)² g)
  const r = (RE + 400e3) / M_METRES;
  const zAx = [0, 0, 1] as Vec3;
  const dir: Vec3 = [1, 0, 0];
  const X: Vec3 = [E[0] + r * dir[0], E[1] + r * dir[1], E[2] + r * dir[2]];
  const g = gravityHome(X, t).acc;
  // (the central pull and the J2 term apart: what is left is the harmonics' and the third bodies')
  const central = -muE / r ** 2;
  const along = g[0];
  const extra = Math.abs(along - central) / Math.abs(central);
  expect(extra).toBeGreaterThan(3e-4);
  expect(extra).toBeLessThan(3e-3);
  expect(zAx[2]).toBe(1);
  expect(M_SECONDS).toBeGreaterThan(0);
});
