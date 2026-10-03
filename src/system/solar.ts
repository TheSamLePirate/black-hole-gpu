// The solar system, to scale, on our side of the wormhole (Newtonian): the Sun, the planets, Ceres and
// Pluto, the major moons — where NASA/JPL's DE440 puts them (1990 – 2150; JUP365: the Galilean moons,
// 2040 – 2100: de440.ts), else on models: the planets on their mean Keplerian elements (J2000 ecliptic,
// E. M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets"), the Moon on its
// mean elements and main inequalities (~0.1°), the other moons on JPL's mean elements in their Laplace
// planes. The planets' centres: their systems' barycentres less their moons' pull. Their turning: the
// IAU models (orientation.ts), the Earth's to its precession and nutation, the moons facing their planet.
//
// Frame: our universe's home frame — the J2000 ecliptic axes, the origin at our mouth of the
// wormhole, which co-orbits Saturn 0.7 AU behind it (ANALYSE-INTEGRATION.md §3.9). Positions in M
// (10⁸ M☉: 1 M = 0.98706 AU), time t in M of the scene's clock, t = 0 on EPOCH_DATE.

import type { Vec3 } from "../physics";
import type { Atmosphere } from "../aero";
import { deState, ephemerisVersion } from "./de440";
import { earthAxes, eclDir, eclOf, iauAxes, iauRate } from "./orientation";
import { tdbOf } from "./timescale";
import { AU_M, C_MPS, DEG, M_METRES, M_SECONDS } from "../units";
import { add, dot, sub } from "../math/vec3";

/** The scene's t = 0 (the Endurance's year, in the film's chronology) */
export const EPOCH_DATE = Date.UTC(2067, 0, 1);
const J2000 = Date.UTC(2000, 0, 1, 12);
// (metres and seconds per M: units.ts, re-exported for the modules that took them from here)
export { M_METRES, M_SECONDS };
const AU = AU_M;
/** km³/s² → GM in M */
const gm = (km3s2: number) => (km3s2 * 1e9) / (C_MPS ** 2 * M_METRES);
const km = (x: number) => (x * 1e3) / M_METRES;

/** days since J2000 at the scene's time t */
export const daysOf = (t: number) => (EPOCH_DATE - J2000) / 86400e3 + (t * M_SECONDS) / 86400;

export type MapName =
  | "mercury"
  | "venus"
  | "earth"
  | "moon"
  | "mars"
  | "phobos"
  | "deimos"
  | "ceres"
  | "jupiter"
  | "io"
  | "europa"
  | "ganymede"
  | "callisto"
  | "saturn"
  | "mimas"
  | "enceladus"
  | "tethys"
  | "dione"
  | "rhea"
  | "titan"
  | "uranus"
  | "neptune"
  | "pluto";

export interface SolarBody {
  id: string;
  name: string;
  kind: "star" | "planet";
  /** the body it orbits ("sun" for the planets) */
  parent: string | null;
  /** GM [M], mean radius [M] */
  mass: number;
  radius: number;
  /** rotation period [h] (< 0: retrograde); pole: right ascension, declination (J2000, degrees) */
  rotation: number;
  pole: [number, number];
  /** geometric albedo (planets), temperature (the Sun) */
  albedo: number;
  temperature?: number;
  map?: MapName;
  surface: "ocean" | "ice" | "rock" | "gas";
  atmosphere?: Atmosphere;
  rings?: { inner: number; outer: number };
  /** heliocentric elements [a AU, e, I°, L°, ϖ°, Ω°] and their rates per Julian century */
  elements?: [number[], number[]];
  /** a moon: its orbit's size [km] and sidereal period [days] (< 0: retrograde) */
  circle?: { a: number; period: number; phase: number };
  /**
   * a moon's mean elements (JPL SSD, epoch J2000 TDB) in its Laplace plane (pole: J2000 RA, Dec [°]; the
   * node counted from that plane's node on the ICRF equator): e, ω, M, i, Ω [°], the apsides' and the
   * node's precession periods [years] (0: none)
   */
  orbit?: { laplace: [number, number]; e: number; w: number; M: number; i: number; node: number; Pw: number; Pnode: number };
}

const planet = (
  id: string,
  name: string,
  gmKm: number,
  rKm: number,
  rotation: number,
  pole: [number, number],
  albedo: number,
  surface: SolarBody["surface"],
  map: MapName | undefined,
  elements: [number[], number[]],
  extra: Partial<SolarBody> = {},
): SolarBody => ({
  id,
  name,
  kind: "planet",
  parent: "sun",
  mass: gm(gmKm),
  radius: km(rKm),
  rotation,
  pole,
  albedo,
  surface,
  map,
  elements,
  ...extra,
});

const moon = (
  id: string,
  name: string,
  parent: string,
  gmKm: number,
  rKm: number,
  a: number,
  period: number,
  orbit: NonNullable<SolarBody["orbit"]>,
  albedo: number,
  surface: SolarBody["surface"],
  map?: MapName,
  extra: Partial<SolarBody> = {},
): SolarBody => ({
  id,
  name,
  kind: "planet",
  parent,
  mass: gm(gmKm),
  radius: km(rKm),
  rotation: Math.abs(period) * 24 * Math.sign(period),
  pole: orbit.laplace,
  albedo,
  surface,
  map,
  circle: { a, period, phase: 0 },
  orbit,
  ...extra,
});
/** JPL's mean elements: Laplace pole, e, ω, M, i, Ω, Pω, PΩ */
const el = (laplace: [number, number], e: number, w: number, M: number, i: number, node: number, Pw = 0, Pnode = 0) => ({
  laplace,
  e,
  w,
  M,
  i,
  node,
  Pw,
  Pnode,
});

export const SOLAR_BODIES: SolarBody[] = [
  {
    id: "sun",
    name: "Sun",
    kind: "star",
    parent: null,
    mass: gm(1.32712440018e11),
    radius: km(695700),
    rotation: 609.12,
    pole: [286.13, 63.87],
    albedo: 0,
    temperature: 5772,
    surface: "gas",
  },
  planet("mercury", "Mercury", 22031.78, 2439.7, 1407.6, [281.01, 61.41], 0.142, "rock", "mercury", [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ]),
  planet(
    "venus",
    "Venus",
    324858.59,
    6051.8,
    -5832.5,
    [272.76, 67.16],
    0.689,
    "gas",
    "venus",
    [
      [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
      [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
    ],
    { atmosphere: { rho0: 65, H: 15900, T: 737, gas: "co2", model: "venus" } },
  ),
  planet(
    "earth",
    "Earth",
    398600.44,
    6378.137,
    23.9345,
    [0, 90],
    0.434,
    "ocean",
    "earth",
    [
      [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
      [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
    ],
    { atmosphere: { rho0: 1.225, H: 8500, model: "us76" } },
  ),
  planet(
    "mars",
    "Mars",
    42828.37,
    3389.5,
    24.6229,
    [317.68, 52.89],
    0.17,
    "rock",
    "mars",
    [
      [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    ],
    { atmosphere: { rho0: 0.0146, H: 11100, T: 210, gas: "co2", model: "mars" } },
  ),
  planet("ceres", "Ceres", 62.6, 469.7, 9.074, [291.42, 66.76], 0.09, "rock", "ceres", [
    [2.7675, 0.0785, 10.59, 153.6, 153.9, 80.3],
    [0, 0, 0, 7824.7, 0, 0],
  ]),
  planet("jupiter", "Jupiter", 126686534, 69911, 9.925, [268.057, 64.495], 0.538, "gas", "jupiter", [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ]),
  planet(
    "saturn",
    "Saturn",
    37931187,
    58232,
    10.656,
    [40.589, 83.537],
    0.499,
    "gas",
    "saturn",
    [
      [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
      [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    ],
    // (the ring map's span, C ring to beyond A: 69 800 – 140 900 km)
    { rings: { inner: 69.8e3 / 58232, outer: 140.9e3 / 58232 } },
  ),
  planet("uranus", "Uranus", 5793939, 25362, -17.24, [257.311, -15.175], 0.488, "gas", "uranus", [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ]),
  planet("neptune", "Neptune", 6836529, 24622, 16.11, [299.36, 43.46], 0.442, "gas", "neptune", [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ]),
  planet("pluto", "Pluto", 869.6, 1188.3, -153.29, [132.99, -6.16], 0.52, "ice", "pluto", [
    [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  ]),
  // the Moon: mean elements on the ecliptic (its node and perigee turn: 18.6 and 8.85 years)
  {
    id: "moon",
    name: "Moon",
    kind: "planet",
    parent: "earth",
    mass: gm(4902.8),
    radius: km(1737.4),
    rotation: 655.72,
    pole: [266.86, 65.64],
    albedo: 0.12,
    surface: "rock",
    map: "moon",
  },
  moon(
    "phobos",
    "Phobos",
    "mars",
    7.087e-4,
    11.1,
    9376,
    0.31891023,
    el([317.7, 52.9], 0.015, 216.3, 189.7, 1.1, 169.2, 1.1, 2.3),
    0.07,
    "rock",
    "phobos",
  ),
  moon(
    "deimos",
    "Deimos",
    "mars",
    9.62e-5,
    6.2,
    23457,
    1.26244,
    el([316.6, 53.5], 0.0002, 0, 205.0, 1.8, 54.3, 0, 56.2),
    0.07,
    "rock",
    "deimos",
  ),
  moon(
    "io",
    "Io",
    "jupiter",
    5959.916,
    1821.6,
    421800,
    1.769137786,
    el([268.1, 64.5], 0.004, 49.1, 330.9, 0.0, 0.0, 1.333),
    0.63,
    "rock",
    "io",
  ),
  moon(
    "europa",
    "Europa",
    "jupiter",
    3202.739,
    1560.8,
    671100,
    3.551181041,
    el([268.1, 64.5], 0.009, 45.0, 345.4, 0.5, 184.0, 1.394, 30.202),
    0.67,
    "ice",
    "europa",
  ),
  moon(
    "ganymede",
    "Ganymede",
    "jupiter",
    9887.834,
    2634.1,
    1070400,
    7.15455296,
    el([268.2, 64.6], 0.001, 198.3, 324.8, 0.2, 58.5, 68.301, 137.812),
    0.43,
    "ice",
    "ganymede",
  ),
  moon(
    "callisto",
    "Callisto",
    "jupiter",
    7179.289,
    2410.3,
    1882700,
    16.6890184,
    el([268.7, 64.8], 0.007, 43.8, 87.4, 0.3, 309.1, 277.921, 577.264),
    0.22,
    "rock",
    "callisto",
  ),
  moon(
    "mimas",
    "Mimas",
    "saturn",
    2.503,
    198.2,
    186000,
    0.942421959,
    el([40.6, 83.5], 0.02, 160.4, 275.3, 1.6, 66.2, 0.493, 0.986),
    0.96,
    "ice",
    "mimas",
  ),
  moon(
    "enceladus",
    "Enceladus",
    "saturn",
    7.211,
    252.1,
    238400,
    1.370218,
    el([40.6, 83.5], 0.005, 119.5, 57.0, 0.0, 0.0, 2.916),
    1.37,
    "ice",
    "enceladus",
  ),
  moon(
    "tethys",
    "Tethys",
    "saturn",
    41.21,
    531.1,
    295000,
    1.887802,
    el([40.6, 83.5], 0.001, 335.3, 0.0, 1.1, 273.0, 0, 4.982),
    1.23,
    "ice",
    "tethys",
  ),
  moon(
    "dione",
    "Dione",
    "saturn",
    73.11,
    561.4,
    377700,
    2.736915,
    el([40.6, 83.5], 0.002, 116.0, 212.0, 0.0, 0.0, 11.698),
    1.0,
    "ice",
    "dione",
  ),
  moon(
    "rhea",
    "Rhea",
    "saturn",
    153.94,
    763.8,
    527200,
    4.518212,
    el([40.6, 83.5], 0.001, 44.3, 31.5, 0.3, 133.7, 33.939, 35.775),
    0.95,
    "ice",
    "rhea",
  ),
  moon(
    "titan",
    "Titan",
    "saturn",
    8978.14,
    2574.7,
    1221900,
    15.945421,
    el([36.4, 84.0], 0.029, 78.3, 11.7, 0.3, 78.6, 346.68, 687.37),
    0.22,
    "gas",
    "titan",
    { atmosphere: { rho0: 5.43, H: 21000, T: 94, gas: "n2ch4", model: "titan" } },
  ),
  moon(
    "iapetus",
    "Iapetus",
    "saturn",
    120.52,
    734.5,
    3561700,
    79.3215,
    el([288.7, 78.9], 0.028, 254.5, 74.8, 7.6, 86.5, 1662.9, 3130.302),
    0.6,
    "rock",
  ),
  // (Triton: retrograde — its inclination on its Laplace plane over 90°)
  moon(
    "triton",
    "Triton",
    "neptune",
    1428.5,
    1353.4,
    354800,
    -5.876854,
    el([299.8, 43.1], 0.000016, 0, 63.0, 157.3, 178.1, 0, 340.379),
    0.76,
    "ice",
  ),
  // (Charon: in Pluto's equator, facing it — the IAU pole)
  moon("charon", "Charon", "pluto", 106.1, 606, 19596, 6.3872273, el([132.993, -6.163], 0.0002, 0, 304.1, 0, 0), 0.35, "ice"),
];

const BY_ID = new Map(SOLAR_BODIES.map((b) => [b.id, b]));
export const solarBody = (id: string) => BY_ID.get(id);

/** J2000 equatorial (right ascension, declination) → ecliptic unit vector */
export function eclipticOf(ra: number, dec: number): Vec3 {
  return eclDir(ra, dec);
}

/**
 * A Keplerian state [AU, AU/day]: n the mean anomaly's rate, dw and dO the turning of the periapsis
 * and of the node [rad/day] — the velocity the exact rate of the place (the mean elements drift).
 */
function kepler(a: number, e: number, I: number, M: number, w: number, O: number, n: number, dw = 0, dO = 0) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 20; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  const cE = Math.cos(E),
    sE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const xp = a * (cE - e),
    yp = b * sE;
  const Ed = n / (1 - e * cE);
  const vx = -a * sE * Ed,
    vy = b * cE * Ed;
  const cw = Math.cos(w),
    sw = Math.sin(w),
    cO = Math.cos(O),
    sO = Math.sin(O),
    cI = Math.cos(I),
    sI = Math.sin(I);
  const rot = (x: number, y: number): Vec3 => [
    (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y,
    (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y,
    sw * sI * x + cw * sI * y,
  ];
  const pos = rot(xp, yp);
  const vel = rot(vx, vy);
  // (the ellipse turning: about the orbit's normal by dw, about the ecliptic pole by dO)
  const h: Vec3 = [sO * sI, -cO * sI, cI];
  return {
    pos,
    vel: <Vec3>[
      vel[0] + dw * (h[1] * pos[2] - h[2] * pos[1]) - dO * pos[1],
      vel[1] + dw * (h[2] * pos[0] - h[0] * pos[2]) + dO * pos[0],
      vel[2] + dw * (h[0] * pos[1] - h[1] * pos[0]),
    ],
  };
}

/** DE440's Earth / Moon mass ratio */
const EMRAT = 81.30056822149722;
const KM_AU = 1e3 / AU,
  KMS_AUD = (86400 * 1e3) / AU;

export interface State {
  pos: Vec3;
  vel: Vec3;
}
/** A state whose velocity is worked out on first use (then kept) */
class LazyState implements State {
  private v: Vec3 | null = null;
  constructor(
    public pos: Vec3,
    private f: () => Vec3,
  ) {}
  get vel(): Vec3 {
    return (this.v ??= this.f());
  }
}
const lazy = (pos: Vec3, vel: () => Vec3): State => new LazyState(pos, vel);

/**
 * The Moon relative to the Earth [AU, AU/day] where DE440 does not reach: its mean elements (P.
 * Schlyter's — their day 0 is 1999-12-31 0h, J2000 − 1.5 d: the 20° this model once lost) and its
 * main inequalities (evection, variation, annual equation…: ~2′), from the equinox of date to J2000's.
 */
function moonGeo(d: number): State {
  const at = (dd: number): Vec3 => {
    const ds = dd + 1.5;
    const N = (125.1228 - 0.0529538083 * ds) * DEG,
      i = 5.1454 * DEG,
      w = (318.0634 + 0.1643573223 * ds) * DEG;
    const M = (115.3654 + 13.0649929509 * ds) * DEG,
      e = 0.0549;
    let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
    for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xv = Math.cos(E) - e,
      yv = Math.sqrt(1 - e * e) * Math.sin(E);
    const v = Math.atan2(yv, xv);
    let r = 60.2666 * Math.hypot(xv, yv); // [Earth radii]
    let lon = Math.atan2(Math.sin(v + w) * Math.cos(i), Math.cos(v + w)) + N;
    let lat = Math.asin(Math.sin(v + w) * Math.sin(i));
    // the Sun's and the Moon's mean longitudes, the elongation, the argument of latitude
    const Ms = (356.047 + 0.9856002585 * ds) * DEG,
      ws = (282.9404 + 4.70935e-5 * ds) * DEG;
    const Ls = Ms + ws,
      Lm = M + w + N,
      Dl = Lm - Ls,
      F = Lm - N;
    lon +=
      DEG *
      (-1.274 * Math.sin(M - 2 * Dl) +
        0.658 * Math.sin(2 * Dl) -
        0.186 * Math.sin(Ms) -
        0.059 * Math.sin(2 * M - 2 * Dl) -
        0.057 * Math.sin(M - 2 * Dl + Ms) +
        0.053 * Math.sin(M + 2 * Dl) +
        0.046 * Math.sin(2 * Dl - Ms) +
        0.041 * Math.sin(M - Ms) -
        0.035 * Math.sin(Dl) -
        0.031 * Math.sin(M + Ms) -
        0.015 * Math.sin(2 * F - 2 * Dl) +
        0.011 * Math.sin(M - 4 * Dl));
    lat +=
      DEG *
      (-0.173 * Math.sin(F - 2 * Dl) -
        0.055 * Math.sin(M - F - 2 * Dl) -
        0.046 * Math.sin(M + F - 2 * Dl) +
        0.033 * Math.sin(F + 2 * Dl) +
        0.017 * Math.sin(2 * M + F));
    r += -0.58 * Math.cos(M - 2 * Dl) - 0.46 * Math.cos(2 * Dl);
    // (to J2000's equinox: the general precession since)
    lon -= 3.82394e-5 * dd * DEG;
    const R = (r * 6378.14e3) / AU;
    return [R * Math.cos(lat) * Math.cos(lon), R * Math.cos(lat) * Math.sin(lon), R * Math.sin(lat)];
  };
  const p = at(d);
  return lazy(p, () => {
    const h = 0.01;
    return add(at(d + h), at(d - h), -1).map((x) => x / (2 * h)) as Vec3;
  });
}

// (the states of recent instants, reused: the pull on the ship asks for every body at the same time,
// and the HUD's marks of the future, the light-time to each body and the map ask again and again for
// the same few instants — one instant kept, they were recomputed tens of thousands of times a second)
const MEMO_INSTANTS = 64;
const memos = new Map<number, Map<string, State>>();
let memoVersion = -1;
function memoAt(d: number) {
  // (an ephemeris come in since: the states kept were the analytic models')
  if (memoVersion !== ephemerisVersion) {
    memoVersion = ephemerisVersion;
    memos.clear();
  }
  let m = memos.get(d);
  if (!m) {
    if (memos.size >= MEMO_INSTANTS) memos.delete(memos.keys().next().value as number);
    memos.set(d, (m = new Map()));
  }
  return m;
}
function helio(b: SolarBody, d: number): State {
  const memo = memoAt(d);
  const hit = memo.get(b.id);
  if (hit) return hit;
  const st = helioNow(b, d);
  memo.set(b.id, st);
  return st;
}

/** TDB [s past J2000] at d (UTC days past J2000) */
const etOfDays = (d: number) => tdbOf(J2000 + d * 86400e3);
/** DE440's state of a body (relative to its centre) in AU, AU/day, or null */
function de(id: string, d: number): State | null {
  const s = deState(id, etOfDays(d));
  return (
    s && { pos: [s.pos[0] * KM_AU, s.pos[1] * KM_AU, s.pos[2] * KM_AU], vel: [s.vel[0] * KMS_AUD, s.vel[1] * KMS_AUD, s.vel[2] * KMS_AUD] }
  );
}

/** The moons each planet's centre is pulled about by (its barycentre less their share) */
const MOONS_OF = new Map<string, SolarBody[]>();
/** A moon relative to its planet [AU, AU/day]: DE440 / JUP365 where they reach, else its elements */
function moonRel(b: SolarBody, d: number): State {
  if (b.id === "moon") return de("moon", d) ?? moonGeo(d);
  return de(b.id, d) ?? orbitState(b, d);
}

/** A body's heliocentric state [AU, AU/day] — the planets' centres, not their barycentres */
function helioNow(b: SolarBody, d: number): State {
  if (b.id === "sun") return { pos: [0, 0, 0], vel: [0, 0, 0] };
  if (b.parent && b.parent !== "sun") {
    const p = helio(solarBody(b.parent)!, d);
    const c = moonRel(b, d);
    return lazy(add(p.pos, c.pos), () => add(p.vel, c.vel));
  }
  // the system's barycentre (the Earth's: the Earth–Moon barycentre)
  const bary = de(b.id === "earth" ? "emb" : b.id, d) ?? standish(b, d);
  const moons = MOONS_OF.get(b.id) ?? [];
  if (!moons.length) return bary;
  // (the centre: the barycentre less the moons' mass-weighted offsets)
  const mTot = b.mass + moons.reduce((m, q) => m + q.mass, 0);
  const rel = moons.map((q) => ({ k: q.mass / mTot, s: moonRel(q, d) }));
  const pos = rel.reduce((p, r) => add(p, r.s.pos, -r.k), bary.pos);
  return lazy(pos, () => rel.reduce((v, r) => add(v, r.s.vel, -r.k), bary.vel));
}

/** A planet's (a system's barycentre's) heliocentric state from its mean elements (Standish). */
function standish(b: SolarBody, d: number): State {
  const [el, rt] = b.elements!;
  const T = d / 36525;
  const at = (i: number) => el[i]! + rt[i]! * T;
  const a = at(0),
    e = at(1),
    I = at(2) * DEG,
    L = at(3) * DEG,
    wb = at(4) * DEG,
    O = at(5) * DEG;
  // (the rates of the mean elements, per day: the mean anomaly L − ϖ, ω = ϖ − Ω, Ω)
  const k = DEG / 36525;
  const k0 = kepler(a, e, I, L - wb, wb - O, O, (rt[3]! - rt[4]!) * k, (rt[4]! - rt[5]!) * k, rt[5]! * k);
  // (and the ellipse's slow change of size, shape and tilt — ~0.3 m/s at Saturn: its place across a
  // day of the drift, the angles held; the velocity only when asked: the pull on a ship needs places)
  const dd = 1 / 36525;
  return lazy(k0.pos, () => {
    const kp = kepler(a + rt[0]! * dd, e + rt[1]! * dd, I + rt[2]! * k, L - wb, wb - O, O, 0).pos;
    const km = kepler(a - rt[0]! * dd, e - rt[1]! * dd, I - rt[2]! * k, L - wb, wb - O, O, 0).pos;
    return add(k0.vel, sub(kp, km), 0.5);
  });
}

/** A moon's Laplace plane: axes x (its node on the ICRF equator), y, z (its pole) — ecliptic */
const laplaceAxes = new Map<string, [Vec3, Vec3, Vec3]>();
function laplaceOf(b: SolarBody): [Vec3, Vec3, Vec3] {
  let A = laplaceAxes.get(b.id);
  if (!A) {
    const [ra, dec] = b.orbit!.laplace;
    const z = eclDir(ra, dec);
    const x = eclOf([-Math.sin(ra * DEG), Math.cos(ra * DEG), 0]);
    A = [x, [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], z];
    laplaceAxes.set(b.id, A);
  }
  return A;
}

/** A moon relative to its planet from its mean elements [AU, AU/day]: its ellipse, turning (apsides, node) */
function orbitState(b: SolarBody, d: number): State {
  const o = b.orbit!,
    c = b.circle!;
  const P = Math.abs(c.period);
  const yr = d / 365.25;
  const dW = o.Pnode ? -360 / (o.Pnode * 365.25) : 0; // (the node regresses)
  const dVarpi = o.Pw ? 360 / (o.Pw * 365.25) : 0; // (the apsides advance)
  const node = o.node + dW * d;
  const varpi = o.node + o.w + dVarpi * d;
  const lambda = o.node + o.w + o.M + (360 / P) * d;
  void yr;
  const a = (c.a * 1e3) / AU;
  const n = (2 * Math.PI) / P;
  const k = kepler(
    a,
    o.e,
    o.i * DEG,
    (lambda - varpi) * DEG,
    (varpi - node) * DEG,
    node * DEG,
    n - dVarpi * DEG,
    (dVarpi - dW) * DEG,
    dW * DEG,
  );
  const [ex, ey, ez] = laplaceOf(b);
  const to = (v: Vec3): Vec3 => [0, 1, 2].map((i) => v[0] * ex[i]! + v[1] * ey[i]! + v[2] * ez[i]!) as Vec3;
  return { pos: to(k.pos), vel: to(k.vel) };
}
for (const b of SOLAR_BODIES) if (b.parent && b.parent !== "sun") MOONS_OF.set(b.parent, [...(MOONS_OF.get(b.parent) ?? []), b]);
// (the Earth's centre from the Earth–Moon barycentre: the Moon's pull, DE440's mass ratio)
MOONS_OF.set(
  "earth",
  MOONS_OF.get("earth")!.map((m) => (m.id === "moon" ? { ...m, mass: (solarBody("earth")!.mass * 1) / EMRAT } : m)),
);

/** Axes with z along a pole, x in the ecliptic plane (the tracer's poleAxes) */
export function poleAxes(N: Vec3): [Vec3, Vec3, Vec3] {
  let ex: Vec3 = [N[1], -N[0], 0];
  const l = Math.hypot(...ex);
  ex = l < 1e-4 ? [1, 0, 0] : [ex[0] / l, ex[1] / l, 0];
  const ey: Vec3 = [N[1] * ex[2] - N[2] * ex[1], N[2] * ex[0] - N[0] * ex[2], N[0] * ex[1] - N[1] * ex[0]];
  return [ex, ey, N];
}

/** Our mouth: on Saturn's orbit, 0.7 AU behind it (the same heliocentric turn, backwards) */
const MOUTH_LAG = 2 * Math.asin(0.7 / (2 * 9.537));
function mouthHelio(d: number): State {
  const hit = memoAt(d).get("#mouth");
  if (hit) return hit;
  const s = helio(solarBody("saturn")!, d);
  const c = Math.cos(-MOUTH_LAG),
    sn = Math.sin(-MOUTH_LAG);
  const rz = (v: Vec3): Vec3 => [c * v[0] - sn * v[1], sn * v[0] + c * v[1], v[2]];
  const st = lazy(rz(s.pos), () => rz(s.vel));
  memoAt(d).set("#mouth", st);
  return st;
}

const toM = AU / M_METRES; // AU → M
const perDayToPerM = M_SECONDS / 86400; // (AU/day → AU per M of time)

/** A solar-system body's state in the home frame (our mouth at the origin, ecliptic axes) at t [M]. */
export function solarState(id: string, t: number): State {
  const d = daysOf(t);
  const b = solarBody(id)!;
  const s = helio(b, d);
  const m = mouthHelio(d);
  return lazy([(s.pos[0] - m.pos[0]) * toM, (s.pos[1] - m.pos[1]) * toM, (s.pos[2] - m.pos[2]) * toM], () => [
    (s.vel[0] - m.vel[0]) * toM * perDayToPerM,
    (s.vel[1] - m.vel[1]) * toM * perDayToPerM,
    (s.vel[2] - m.vel[2]) * toM * perDayToPerM,
  ]);
}

/**
 * A body as it is seen from a place of the home frame at t: where it was when the light now arriving
 * there left it (light runs straight in the Sun's frame, not in the home frame, which moves with our
 * mouth: the retarded place taken there, then brought into the home frame of now), and the time then —
 * its turning seen as it was. Light-time [M] is the distance [M] (c = 1). Without it the Sun sits 20″
 * off the Moon (the aberration of its light): an eclipse's shadow passed 40 s late, 40 km off.
 */
export function seenFrom(id: string, t: number, obs: Vec3): { pos: Vec3; vel: Vec3; t: number } {
  // (one step: the delay from the place of now — off by v/c of itself, a quarter second at Jupiter)
  const now = solarState(id, t).pos;
  const tr = t - Math.hypot(now[0] - obs[0], now[1] - obs[1], now[2] - obs[2]);
  const st = solarState(id, tr);
  // (the home frame's origin then and now, in the Sun's frame: the shift between)
  const m0 = mouthHelio(daysOf(tr)).pos,
    m1 = mouthHelio(daysOf(t)).pos;
  const pos: Vec3 = [st.pos[0] + (m0[0] - m1[0]) * toM, st.pos[1] + (m0[1] - m1[1]) * toM, st.pos[2] + (m0[2] - m1[2]) * toM];
  return { pos, vel: st.vel, t: tr };
}

/** The share of a disk of angular radius rs left uncovered by one of radius rm, their centres d apart [rad]. */
export function diskShare(rs: number, rm: number, d: number): number {
  if (d >= rs + rm) return 1;
  // A fully covered disk has exactly zero light; dividing its area back out can leave roundoff.
  if (d <= Math.abs(rm - rs)) return rm >= rs ? 0 : 1 - (rm / rs) ** 2;
  const k1 = Math.min(Math.max((d * d + rs * rs - rm * rm) / (2 * d * rs), -1), 1);
  const k2 = Math.min(Math.max((d * d + rm * rm - rs * rs) / (2 * d * rm), -1), 1);
  const k3 = Math.max((-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm), 0);
  const a = rs * rs * Math.acos(k1) + rm * rm * Math.acos(k2) - 0.5 * Math.sqrt(k3);
  return Math.min(Math.max(1 - a / (Math.PI * rs * rs), 0), 1);
}

/** The share of the Sun's disk the Moon leaves uncovered, seen from a place of the home frame at t (the light's delays in). */
export function sunShare(obs: Vec3, t: number): number {
  const S = seenFrom("sun", t, obs).pos,
    Mn = seenFrom("moon", t, obs).pos;
  const s = sub(S, obs),
    m = sub(Mn, obs);
  const ds = Math.hypot(...s),
    dm = Math.hypot(...m);
  const c = dot(s, m) / (ds * dm);
  if (c < 0.999) return 1;
  const d = Math.asin(
    Math.min(Math.hypot(...[s[1] * m[2] - s[2] * m[1], s[2] * m[0] - s[0] * m[2], s[0] * m[1] - s[1] * m[0]]) / (ds * dm), 1),
  );
  return diskShare(Math.asin(Math.min(SOLAR_BODIES[0]!.radius / ds, 1)), Math.asin(Math.min(solarBody("moon")!.radius / dm, 1)), d);
}

/**
 * The home frame's own acceleration [M/M²]: our mouth is Saturn's centre turned about the Sun (same
 * distance, 0.7 AU behind), so it falls as Saturn's centre does — pulled by the Sun, the planets and
 * Saturn's own moons (Titan's tug) — turned the same way; and the Sun's frame itself falls about the
 * barycentre (Jupiter's pull on the Sun): a = R (a_Saturn − a_Sun) + a_Sun. With the Sun's pull alone
 * the ship and the bodies drifted apart by ~6·10⁻⁶ m/s² (≈ 100 km over a lunar transfer).
 */
export function mouthAccel(t: number): Vec3 {
  const d = daysOf(t);
  const sat = helio(solarBody("saturn")!, d).pos;
  const aSat: Vec3 = [0, 0, 0],
    aSun: Vec3 = [0, 0, 0];
  for (const b of SOLAR_BODIES) {
    const P = helio(b, d).pos;
    if (b.id !== "saturn") {
      const dx = (P[0] - sat[0]) * toM,
        dy = (P[1] - sat[1]) * toM,
        dz = (P[2] - sat[2]) * toM;
      const k = b.mass / Math.hypot(dx, dy, dz) ** 3;
      (aSat[0] += k * dx), (aSat[1] += k * dy), (aSat[2] += k * dz);
    }
    if (b.id !== "sun") {
      const dx = P[0] * toM,
        dy = P[1] * toM,
        dz = P[2] * toM;
      const k = b.mass / Math.hypot(dx, dy, dz) ** 3;
      (aSun[0] += k * dx), (aSun[1] += k * dy), (aSun[2] += k * dz);
    }
  }
  const c = Math.cos(-MOUTH_LAG),
    sn = Math.sin(-MOUTH_LAG);
  const x = aSat[0] - aSun[0],
    y = aSat[1] - aSun[1];
  return [c * x - sn * y + aSun[0], sn * x + c * y + aSun[1], aSat[2]];
}

// ------------------------------------------------------------------------------------ turning
/** the scene's UTC instant [ms] at t [M] */
export const utcOf = (t: number) => EPOCH_DATE + t * M_SECONDS * 1e3;

let axesT = NaN;
const axesMemo = new Map<string, [Vec3, Vec3, Vec3]>();
/**
 * A body's own axes at t (columns: its prime meridian — its map's centre —, 90° east, its pole), home
 * frame. The Earth: precession, nutation, sidereal time; the moons: facing their planet (a mean pole,
 * their prime meridian towards it — the Moon: its IAU model, the librations with it); the rest: IAU.
 */
export function bodyAxes(b: SolarBody, t: number): [Vec3, Vec3, Vec3] {
  if (t !== axesT) {
    axesT = t;
    axesMemo.clear();
  }
  const hit = axesMemo.get(b.id);
  if (hit) return hit;
  const utc = utcOf(t),
    et = tdbOf(utc);
  let A: [Vec3, Vec3, Vec3] | null = null;
  if (b.id === "earth") A = earthAxes(utc, et);
  else if (b.parent && b.parent !== "sun" && b.id !== "moon") {
    // (a moon whose place is modelled: its prime meridian where its planet is — no drift between the two)
    const z = unit(iauAxes(b.id, et)?.[2] ?? eclipticOf(b.pole[0], b.pole[1]));
    const toP = unit(sub(solarState(b.parent, t).pos, solarState(b.id, t).pos));
    const x = unit(sub(toP, z.map((c) => c * dot(toP, z)) as Vec3));
    A = [x, [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], z];
  } else A = iauAxes(b.id, et);
  if (!A) {
    // (no model: turning uniformly about its pole)
    const [ex, ey, ez] = poleAxes(eclipticOf(b.pole[0], b.pole[1]));
    const hours = (daysOf(t) * 24) / b.rotation,
      W = 2 * Math.PI * (hours - Math.floor(hours));
    const c = Math.cos(W),
      s = Math.sin(W);
    A = [
      [c * ex[0] + s * ey[0], c * ex[1] + s * ey[1], c * ex[2] + s * ey[2]],
      [-s * ex[0] + c * ey[0], -s * ex[1] + c * ey[1], -s * ex[2] + c * ey[2]],
      ez,
    ];
  }
  axesMemo.set(b.id, A);
  return A;
}

/** A body's pole now (home frame) — the tracer's pole, its spin measured from its node on the ecliptic. */
export function bodyPole(b: SolarBody, t: number): Vec3 {
  return bodyAxes(b, t)[2];
}

/**
 * The rotation angle of a body about its pole now (radians): its prime meridian from the node of its
 * equator on the ecliptic (poleAxes' x) — with bodyPole, what the tracer turns its map by.
 */
export function spinAngle(b: SolarBody, t: number): number {
  const [x, , z] = bodyAxes(b, t);
  const [ex, ey] = poleAxes(z);
  return Math.atan2(dot(x, ey), dot(x, ex));
}

/**
 * A body's rotation (home frame) [rad per M of time]: at t, its pole of now times its turning rate then
 * (the Earth's pole of date, the Moon's librating rate: its IAU model's); without t, its mean spin
 * about its J2000 pole.
 */
const spinMemo = new Map<string, Vec3>();
const EARTH_RATE = (2 * Math.PI) / ((23.9344696 * 3600) / M_SECONDS);
export function spinVector(b: SolarBody, t?: number): Vec3 {
  if (t !== undefined) {
    const N = bodyAxes(b, t)[2];
    let w: number;
    if (b.id === "earth") w = EARTH_RATE;
    else if (b.parent && b.parent !== "sun" && b.id !== "moon") w = (2 * Math.PI) / ((Math.abs(b.circle!.period) * 86400) / M_SECONDS);
    else {
      const r = iauRate(b.id, tdbOf(utcOf(t)));
      w = r !== null ? (r * DEG * M_SECONDS) / 86400 : (2 * Math.PI) / ((b.rotation * 3600) / M_SECONDS);
    }
    return [N[0] * w, N[1] * w, N[2] * w];
  }
  let v = spinMemo.get(b.id);
  if (!v) {
    const w = (2 * Math.PI) / (((b.id === "earth" ? 23.9344696 : b.rotation) * 3600) / M_SECONDS);
    const N = b.id === "earth" ? earthAxes(J2000, 0)[2] : (iauAxes(b.id, 0)?.[2] ?? eclipticOf(b.pole[0], b.pole[1]));
    v = [N[0] * w, N[1] * w, N[2] * w];
    spinMemo.set(b.id, v);
  }
  return v;
}

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The maps on the GPU: large ones (2048 × 1024) then small ones (1024 × 512), in two texture arrays */
export const MAPS_HI: MapName[] = ["earth", "moon", "mars", "mercury", "jupiter", "saturn"];
export const MAPS_LO: MapName[] = [
  "venus",
  "ceres",
  "phobos",
  "deimos",
  "io",
  "europa",
  "ganymede",
  "callisto",
  "mimas",
  "enceladus",
  "tethys",
  "dione",
  "rhea",
  "titan",
  "uranus",
  "neptune",
  "pluto",
];
/** A map's index: < MAPS_HI.length in the large array, then the small one */
export function mapIndex(m: MapName): number {
  const i = MAPS_HI.indexOf(m);
  return i >= 0 ? i : MAPS_HI.length + MAPS_LO.indexOf(m);
}
