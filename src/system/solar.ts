// The solar system, to scale, on our side of the wormhole (Newtonian): the Sun, the planets (JPL
// mean Keplerian elements, J2000 ecliptic, E. M. Standish, "Keplerian Elements for Approximate
// Positions of the Major Planets"), Ceres and Pluto, and the major moons (the Moon on its mean
// ecliptic orbit, the others on circles in their planet's equatorial plane).
//
// Frame: our universe's home frame — the J2000 ecliptic axes, the origin at our mouth of the
// wormhole, which co-orbits Saturn 0.7 AU behind it (ANALYSE-INTEGRATION.md §3.9). Positions in M
// (10⁸ M☉: 1 M = 0.98706 AU), time t in M of the scene's clock, t = 0 on EPOCH_DATE.

import type { Vec3 } from "../physics";

/** The scene's t = 0 (the Endurance's year, in the film's chronology) */
export const EPOCH_DATE = Date.UTC(2067, 0, 1);
const J2000 = Date.UTC(2000, 0, 1, 12);
/** metres per M, seconds per M, metres per AU (10⁸ M☉) */
export const M_METRES = 1.476625e11;
export const M_SECONDS = 492.5490947;
const AU = 1.495978707e11;
const DEG = Math.PI / 180;
/** km³/s² → GM in M */
const gm = (km3s2: number) => (km3s2 * 1e9) / (299792458 ** 2 * M_METRES);
const km = (x: number) => (x * 1e3) / M_METRES;

/** days since J2000 at the scene's time t */
export const daysOf = (t: number) => (EPOCH_DATE - J2000) / 86400e3 + (t * M_SECONDS) / 86400;

export type MapName =
  | "mercury" | "venus" | "earth" | "moon" | "mars" | "phobos" | "deimos" | "ceres" | "jupiter" | "io" | "europa"
  | "ganymede" | "callisto" | "saturn" | "mimas" | "enceladus" | "tethys" | "dione" | "rhea" | "titan" | "uranus"
  | "neptune" | "pluto";

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
  atmosphere?: { rho0: number; H: number };
  rings?: { inner: number; outer: number };
  /** heliocentric elements [a AU, e, I°, L°, ϖ°, Ω°] and their rates per Julian century */
  elements?: [number[], number[]];
  /** a moon: its orbit around the parent (radius km, period days, phase at J2000 °; < 0 period:
   *  retrograde), in the parent's equatorial plane */
  circle?: { a: number; period: number; phase: number };
}

const planet = (
  id: string, name: string, gmKm: number, rKm: number, rotation: number, pole: [number, number], albedo: number,
  surface: SolarBody["surface"], map: MapName | undefined, elements: [number[], number[]], extra: Partial<SolarBody> = {},
): SolarBody => ({ id, name, kind: "planet", parent: "sun", mass: gm(gmKm), radius: km(rKm), rotation, pole, albedo, surface, map, elements, ...extra });

const moon = (
  id: string, name: string, parent: string, gmKm: number, rKm: number, a: number, period: number, phase: number,
  albedo: number, surface: SolarBody["surface"], map?: MapName, extra: Partial<SolarBody> = {},
): SolarBody => ({
  id, name, kind: "planet", parent, mass: gm(gmKm), radius: km(rKm), rotation: Math.abs(period) * 24 * Math.sign(period), pole: [0, 90],
  albedo, surface, map, circle: { a, period, phase }, ...extra,
});

export const SOLAR_BODIES: SolarBody[] = [
  { id: "sun", name: "Sun", kind: "star", parent: null, mass: gm(1.32712440018e11), radius: km(695700), rotation: 609.12, pole: [286.13, 63.87], albedo: 0, temperature: 5772, surface: "gas" },
  planet("mercury", "Mercury", 22031.78, 2439.7, 1407.6, [281.01, 61.41], 0.142, "rock", "mercury",
    [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]]),
  planet("venus", "Venus", 324858.59, 6051.8, -5832.5, [272.76, 67.16], 0.689, "gas", "venus",
    [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
    { atmosphere: { rho0: 65, H: 15900 } }),
  planet("earth", "Earth", 398600.44, 6371, 23.9345, [0, 90], 0.434, "ocean", "earth",
    [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
    { atmosphere: { rho0: 1.225, H: 8500 } }),
  planet("mars", "Mars", 42828.37, 3389.5, 24.6229, [317.68, 52.89], 0.17, "rock", "mars",
    [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
    { atmosphere: { rho0: 0.02, H: 11100 } }),
  planet("ceres", "Ceres", 62.6, 469.7, 9.074, [291.42, 66.76], 0.09, "rock", "ceres",
    [[2.7675, 0.0785, 10.59, 153.6, 153.9, 80.3], [0, 0, 0, 7824.7, 0, 0]]),
  planet("jupiter", "Jupiter", 126686534, 69911, 9.925, [268.057, 64.495], 0.538, "gas", "jupiter",
    [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]]),
  planet("saturn", "Saturn", 37931187, 58232, 10.656, [40.589, 83.537], 0.499, "gas", "saturn",
    [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
    // (the ring map's span, C ring to beyond A: 69 800 – 140 900 km)
    { rings: { inner: 69.8e3 / 58232, outer: 140.9e3 / 58232 } }),
  planet("uranus", "Uranus", 5793939, 25362, -17.24, [257.311, -15.175], 0.488, "gas", "uranus",
    [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]]),
  planet("neptune", "Neptune", 6836529, 24622, 16.11, [299.36, 43.46], 0.442, "gas", "neptune",
    [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]]),
  planet("pluto", "Pluto", 869.6, 1188.3, -153.29, [132.99, -6.16], 0.52, "ice", "pluto",
    [[39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482]]),
  // the Moon: mean elements on the ecliptic (its node and perigee turn: 18.6 and 8.85 years)
  { id: "moon", name: "Moon", kind: "planet", parent: "earth", mass: gm(4902.8), radius: km(1737.4), rotation: 655.72, pole: [266.86, 65.64], albedo: 0.12, surface: "rock", map: "moon" },
  moon("phobos", "Phobos", "mars", 7.1e-4, 11.1, 9376, 0.31891, 20, 0.07, "rock", "phobos"),
  moon("deimos", "Deimos", "mars", 9.6e-5, 6.2, 23463, 1.26244, 200, 0.07, "rock", "deimos"),
  moon("io", "Io", "jupiter", 5959.9, 1821.6, 421700, 1.769138, 106, 0.63, "rock", "io"),
  moon("europa", "Europa", "jupiter", 3202.7, 1560.8, 671034, 3.551181, 176, 0.67, "ice", "europa"),
  moon("ganymede", "Ganymede", "jupiter", 9887.8, 2634.1, 1070412, 7.154553, 121, 0.43, "ice", "ganymede"),
  moon("callisto", "Callisto", "jupiter", 7179.3, 2410.3, 1882709, 16.689018, 85, 0.22, "rock", "callisto"),
  moon("mimas", "Mimas", "saturn", 2.5, 198.2, 185539, 0.942422, 14, 0.96, "ice", "mimas"),
  moon("enceladus", "Enceladus", "saturn", 7.2, 252.1, 237948, 1.370218, 300, 1.37, "ice", "enceladus"),
  moon("tethys", "Tethys", "saturn", 41.2, 531.1, 294619, 1.887802, 244, 1.23, "ice", "tethys"),
  moon("dione", "Dione", "saturn", 73.1, 561.4, 377396, 2.736915, 290, 1.0, "ice", "dione"),
  moon("rhea", "Rhea", "saturn", 153.9, 763.8, 527108, 4.518212, 32, 0.95, "ice", "rhea"),
  moon("titan", "Titan", "saturn", 8978.1, 2574.7, 1221870, 15.945, 163, 0.22, "gas", "titan", { atmosphere: { rho0: 5.3, H: 21000 } }),
  moon("iapetus", "Iapetus", "saturn", 120.5, 734.5, 3560820, 79.3215, 271, 0.6, "rock"),
  moon("triton", "Triton", "neptune", 1427.6, 1353.4, 354759, -5.876854, 63, 0.76, "ice"),
  moon("charon", "Charon", "pluto", 106.1, 606, 19591, 6.387221, 131, 0.35, "ice"),
];

export const solarBody = (id: string) => SOLAR_BODIES.find((b) => b.id === id);

const OBLIQUITY = 23.43928 * DEG;
/** J2000 equatorial (right ascension, declination) → ecliptic unit vector */
export function eclipticOf(ra: number, dec: number): Vec3 {
  const x = Math.cos(dec * DEG) * Math.cos(ra * DEG), y = Math.cos(dec * DEG) * Math.sin(ra * DEG), z = Math.sin(dec * DEG);
  return [x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)];
}

/** Keplerian ellipse → heliocentric ecliptic position [AU] and velocity [AU/day] */
function kepler(a: number, e: number, I: number, M: number, w: number, O: number, n: number) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 20; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  const cE = Math.cos(E), sE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const xp = a * (cE - e), yp = b * sE;
  const Ed = n / (1 - e * cE);
  const vx = -a * sE * Ed, vy = b * cE * Ed;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  const rot = (x: number, y: number): Vec3 => [
    (cw * cO - sw * sO * cI) * x + (-sw * cO - cw * sO * cI) * y,
    (cw * sO + sw * cO * cI) * x + (-sw * sO + cw * cO * cI) * y,
    sw * sI * x + cw * sI * y,
  ];
  return { pos: rot(xp, yp), vel: rot(vx, vy) };
}

const GM_SUN_AU = 2.9591220828559e-4; // AU³/day²
const EARTH_MOON = 0.0121505856; // m_moon / (m_earth + m_moon)

interface State { pos: Vec3; vel: Vec3 }
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];

/** The Moon relative to the Earth [AU, AU/day] (mean elements, J2000 ecliptic) */
function moonGeo(d: number): State {
  const a = 384400e3 / AU;
  const n = 13.0649929509 * DEG;
  const O = (125.1228 - 0.0529538083 * d) * DEG;
  const w = (318.0634 + 0.1643573223 * d) * DEG;
  const M = (115.3654 + 13.0649929509 * d) * DEG;
  return kepler(a, 0.0549, 5.1454 * DEG, M, w, O, n);
}

/** A planet's heliocentric state (the Earth: from the Earth–Moon barycentre) */
function helio(b: SolarBody, d: number): State {
  if (b.id === "sun") return { pos: [0, 0, 0], vel: [0, 0, 0] };
  if (b.id === "moon") {
    const e = helio(solarBody("earth")!, d);
    const m = moonGeo(d);
    return { pos: add(e.pos, m.pos), vel: add(e.vel, m.vel) };
  }
  if (b.circle) {
    const p = helio(solarBody(b.parent!)!, d);
    const c = circleState(b, d);
    return { pos: add(p.pos, c.pos), vel: add(p.vel, c.vel) };
  }
  const [el, rt] = b.elements!;
  const T = d / 36525;
  const at = (i: number) => el[i]! + rt[i]! * T;
  const a = at(0), e = at(1), I = at(2) * DEG, L = at(3) * DEG, wb = at(4) * DEG, O = at(5) * DEG;
  const n = Math.sqrt(GM_SUN_AU / a ** 3);
  const s = kepler(a, e, I, L - wb, wb - O, O, n);
  if (b.id === "earth") {
    const m = moonGeo(d);
    return { pos: add(s.pos, m.pos, -EARTH_MOON), vel: add(s.vel, m.vel, -EARTH_MOON) };
  }
  return s;
}

/** A moon on its circle in the parent's equatorial plane, relative to the parent [AU, AU/day] */
function circleState(b: SolarBody, d: number): State {
  const c = b.circle!;
  const p = solarBody(b.parent!)!;
  const [ex, ey, ez] = poleAxes(eclipticOf(p.pole[0], p.pole[1]));
  const w = (2 * Math.PI) / c.period;
  const ph = c.phase * DEG + w * d;
  const r = (c.a * 1e3) / AU;
  const cs = Math.cos(ph), sn = Math.sin(ph);
  void ez;
  return {
    pos: [r * (cs * ex[0] + sn * ey[0]), r * (cs * ex[1] + sn * ey[1]), r * (cs * ex[2] + sn * ey[2])],
    vel: [r * w * (-sn * ex[0] + cs * ey[0]), r * w * (-sn * ex[1] + cs * ey[1]), r * w * (-sn * ex[2] + cs * ey[2])],
  };
}

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
  const s = helio(solarBody("saturn")!, d);
  const c = Math.cos(-MOUTH_LAG), sn = Math.sin(-MOUTH_LAG);
  const rz = (v: Vec3): Vec3 => [c * v[0] - sn * v[1], sn * v[0] + c * v[1], v[2]];
  return { pos: rz(s.pos), vel: rz(s.vel) };
}

const toM = AU / M_METRES; // AU → M
const perDayToPerM = M_SECONDS / 86400; // (AU/day → AU per M of time)

/** A solar-system body's state in the home frame (our mouth at the origin, ecliptic axes) at t [M]. */
export function solarState(id: string, t: number): State {
  const d = daysOf(t);
  const b = solarBody(id)!;
  const s = helio(b, d);
  const m = mouthHelio(d);
  return {
    pos: [(s.pos[0] - m.pos[0]) * toM, (s.pos[1] - m.pos[1]) * toM, (s.pos[2] - m.pos[2]) * toM],
    vel: [(s.vel[0] - m.vel[0]) * toM * perDayToPerM, (s.vel[1] - m.vel[1]) * toM * perDayToPerM, (s.vel[2] - m.vel[2]) * toM * perDayToPerM],
  };
}

/** The home frame's own acceleration (our mouth falls around the Sun like Saturn) [M/M²]. */
export function mouthAccel(t: number): Vec3 {
  const d = daysOf(t);
  const p = mouthHelio(d).pos.map((x) => x * toM) as Vec3;
  const r = Math.hypot(...p);
  const k = -SOLAR_BODIES[0]!.mass / r ** 3;
  return [k * p[0], k * p[1], k * p[2]];
}

/** Rotation angle of a body about its pole at t (radians; its map's prime meridian) */
export function spinAngle(b: SolarBody, t: number): number {
  const hours = (daysOf(t) * 24) / b.rotation;
  return 2 * Math.PI * (hours - Math.floor(hours));
}

/** The maps on the GPU: large ones (2048 × 1024) then small ones (1024 × 512), in two texture arrays */
export const MAPS_HI: MapName[] = ["earth", "moon", "mars", "mercury", "jupiter", "saturn"];
export const MAPS_LO: MapName[] = [
  "venus", "ceres", "phobos", "deimos", "io", "europa", "ganymede", "callisto", "mimas", "enceladus", "tethys", "dione", "rhea",
  "titan", "uranus", "neptune", "pluto",
];
/** A map's index: < MAPS_HI.length in the large array, then the small one */
export function mapIndex(m: MapName): number {
  const i = MAPS_HI.indexOf(m);
  return i >= 0 ? i : MAPS_HI.length + MAPS_LO.indexOf(m);
}
