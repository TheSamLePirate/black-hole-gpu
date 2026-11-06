// The planets' magnetic fields — one source of truth for the auroras, the magnetospheres' diagram, the instruments, TARS and
// the tests (docs/PLAN-AURORES-MAGNETOSPHERES.md AM0; § 7.1 for what is taken from Alex's vr-solar-system, MagneticFields.cs).
//
// Each body's internal field: Schmidt semi-normalised spherical harmonics g_n^m, h_n^m [nT] about a reference radius, in the
// body's frame (x its prime meridian, y 90° east, z its north pole; right-handed, east longitudes), positions in the body's
// equatorial radii, optionally about an offset centre (Mercury's). Jupiter's adds the CON2020 magnetodisc. Field lines traced
// by RK4 along the field's direction, stopped on the body's real figure — the Earth's WGS84 ellipsoid, the giants' 1-bar
// ellipsoids (Alex stops on the equatorial sphere: ~3 900 km off at 65° on Jupiter) —; footprints sought in the dipole's
// hemisphere (Uranus's "north" foot often lies south of its equator).
//
// Pure: no GPU, no DOM; heavy tracing belongs in a worker (a whole oval, the moons' footprints: tens of ms) — the renderer reads
// the tables it makes, never harmonics per pixel.
//
// The Earth's model is IGRF-14 at 2025.0 to degree 3, frozen: its secular variation is not applied yet (its coefficients to be
// taken from the NOAA/IAGA file, not from memory); a scene's date beyond 2030 can only be a declared scenario (§ 0, AM0).

export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const D = Math.PI / 180;

/** A body's internal field: its harmonics to a degree, about a reference radius [equatorial radii] and a centre. */
export class FieldModel {
  readonly g: Float64Array;
  readonly h: Float64Array;
  /** an external current sheet's field added (Jupiter's magnetodisc: CON2020) */
  sheet: CurrentSheet | null = null;
  constructor(
    readonly degree: number,
    readonly refRadius: number,
    readonly offset: V3,
    coefficients: [number, number, number, number][],
  ) {
    const N = degree + 1;
    this.g = new Float64Array(N * N);
    this.h = new Float64Array(N * N);
    for (const [n, m, g, h] of coefficients) {
      if (n < 1 || n > degree || m < 0 || m > n) throw new Error(`coefficient (${n}, ${m})`);
      this.g[n * N + m] = g;
      this.h[n * N + m] = h;
    }
  }
  G(n: number, m: number) {
    return this.g[n * (this.degree + 1) + m]!;
  }
  H(n: number, m: number) {
    return this.h[n * (this.degree + 1) + m]!;
  }
  /** the dipole's equatorial surface field [nT] */
  get dipoleField() {
    return Math.hypot(this.G(1, 0), this.G(1, 1), this.H(1, 1));
  }
  /** the dipole axis's northern end (unit, body frame) */
  get dipoleNorth(): V3 {
    const m: V3 = [this.G(1, 1), this.H(1, 1), this.G(1, 0)];
    const l = len(m) || 1;
    const u = mul(m, 1 / l);
    return u[2] >= 0 ? u : mul(u, -1);
  }
  /** +1 when the field leaves the northern hemisphere (Jupiter, Saturn), −1 when it enters it (the Earth) */
  get northPolarity() {
    return this.G(1, 0) * (this.dipoleNorth[2] >= 0 ? 1 : -1) >= 0 ? 1 : -1;
  }
  /** the dipole's tilt from the spin axis [°] */
  get dipoleTilt() {
    return Math.acos(Math.min(1, Math.abs(this.dipoleNorth[2]))) / D;
  }

  /** the field [nT] at p [equatorial radii, body frame] */
  field(p: V3): V3 {
    const b = this.internal(p);
    return this.sheet ? add(b, this.sheet.field(p)) : b;
  }

  /** the internal (harmonic) field alone [nT] */
  internal(p: V3): V3 {
    const q = sub(p, this.offset);
    const r = len(q);
    if (r < 1e-9) return [0, 0, 0];
    const c = Math.min(Math.max(q[2] / r, -1), 1),
      s = Math.sqrt(Math.max(1 - c * c, 0));
    const phi = Math.atan2(q[1], q[0]);
    const sSafe = Math.max(s, 1e-9);
    const N = this.degree,
      W = N + 1;
    const P = new Float64Array(W * W),
      dP = new Float64Array(W * W);
    const cm = new Float64Array(W),
      sm = new Float64Array(W);
    for (let m = 0; m <= N; m++) {
      cm[m] = Math.cos(m * phi);
      sm[m] = Math.sin(m * phi);
    }
    // (Schmidt semi-normalised Legendre functions and their θ derivatives, by the usual recurrences)
    P[0] = 1;
    dP[0] = 0;
    for (let n = 1; n <= N; n++)
      for (let m = 0; m <= n; m++) {
        const i = n * W + m;
        if (m === n) {
          const j = (n - 1) * W + (n - 1);
          const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
          P[i] = k * s * P[j]!;
          dP[i] = k * (c * P[j]! + s * dP[j]!);
        } else {
          const j1 = (n - 1) * W + m;
          const a = Math.sqrt(n * n - m * m);
          const b = n - 2 >= m ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
          const p2 = n - 2 >= m ? P[(n - 2) * W + m]! : 0,
            d2 = n - 2 >= m ? dP[(n - 2) * W + m]! : 0;
          P[i] = ((2 * n - 1) * c * P[j1]! - b * p2) / a;
          dP[i] = ((2 * n - 1) * (c * dP[j1]! - s * P[j1]!) - b * d2) / a;
        }
      }
    let br = 0,
      bt = 0,
      bp = 0;
    const ratio = this.refRadius / r;
    let power = ratio * ratio;
    for (let n = 1; n <= N; n++) {
      power *= ratio;
      let sr = 0,
        st = 0,
        sp = 0;
      for (let m = 0; m <= n; m++) {
        const i = n * W + m;
        const gc = this.g[i]! * cm[m]! + this.h[i]! * sm[m]!;
        sr += gc * P[i]!;
        st += gc * dP[i]!;
        if (m > 0) sp += m * (this.g[i]! * sm[m]! - this.h[i]! * cm[m]!) * P[i]!;
      }
      br += (n + 1) * power * sr;
      bt -= power * st;
      bp += (power * sp) / sSafe;
    }
    const cp = Math.cos(phi),
      sp2 = Math.sin(phi);
    return [br * s * cp + bt * c * cp - bp * sp2, br * s * sp2 + bt * c * sp2 + bp * cp, br * c - bt * s];
  }
}

/**
 * Jupiter's magnetodisc: the CON2020 current sheet (Connerney et al. 2020, JGR 125) — azimuthal current μ0I/2 = 139.6 nT from
 * 7.8 to 51.4 R_J, 3.6 R_J half-thick, tilted 9.3° towards 155.8° E; radial current 16.7 MA — in Edwards et al. 2001's analytic
 * form (eqs 9 and 13, blended by tanh over 1 R_J), the outer edge's sheet subtracted (the con2020 package, Wilson et al. 2023;
 * Alex's port, MagneticFields.cs). Positions in R_J, System III right-handed; field [nT].
 */
export class CurrentSheet {
  muI2 = 139.6;
  iRhoMA = 16.7;
  inner = 7.8;
  outer = 51.4;
  halfThickness = 3.6;
  tiltDeg = 9.3;
  tiltLonDeg = 155.8;
  deltaRho = 1.0;

  field(p: V3): V3 {
    const d = this.halfThickness;
    const shift = (this.tiltLonDeg - 180) * D,
      cosxp = Math.cos(shift),
      sinxp = Math.sin(shift);
    const tilt = this.tiltDeg * D,
      cosxt = Math.cos(tilt),
      sinxt = Math.sin(tilt);
    const rho0 = Math.hypot(p[0], p[1]);
    const cosp = rho0 > 0 ? p[0] / rho0 : 1,
      sinp = rho0 > 0 ? p[1] / rho0 : 0;
    const x = rho0 * (cosp * cosxp + sinp * sinxp);
    const y1 = rho0 * (sinp * cosxp - cosp * sinxp);
    const x1 = x * cosxt + p[2] * sinxt;
    const z1 = p[2] * cosxt - x * sinxt;
    const rho1 = Math.hypot(x1, y1),
      absZ = Math.abs(z1);
    const a = this.edwards(rho1, z1, d, this.inner);
    const o = this.edwards(rho1, z1, d, this.outer);
    const brho = a[0] - o[0],
      bz = a[1] - o[1];
    let bphi = 0;
    if (rho1 > 0) {
      bphi = (2.7975 * this.iRhoMA) / rho1;
      if (absZ < d) bphi *= absZ / d;
      if (z1 > 0) bphi = -bphi;
    }
    let bx1 = 0,
      by1 = 0;
    if (rho1 > 0) {
      const c1 = x1 / rho1,
        s1 = y1 / rho1;
      bx1 = brho * c1 - bphi * s1;
      by1 = brho * s1 + bphi * c1;
    }
    const bx = bx1 * cosxt - bz * sinxt;
    const bz0 = bx1 * sinxt + bz * cosxt;
    return [bx * cosxp - by1 * sinxp, by1 * cosxp + bx * sinxp, bz0];
  }

  /** a semi-infinite sheet from radius a: [Bρ, Bz] — the small-ρ (9a, 9b) and large-ρ (13a, 13b) forms blended */
  private edwards(rho: number, z: number, d: number, a: number): [number, number] {
    const zpd = z + d,
      zmd = z - d,
      a2 = a * a,
      mui2 = this.muI2;
    const zmd2 = zmd * zmd,
      zpd2 = zpd * zpd;
    const f1 = Math.sqrt(zmd2 + a2),
      f2 = Math.sqrt(zpd2 + a2);
    const f1c = f1 ** 3,
      f2c = f2 ** 3;
    const rhoov2 = rho / 2,
      rho2ov4 = rhoov2 * rhoov2,
      rho3ov16 = (rho2ov4 * rhoov2) / 2;
    const f3 = (a2 - 2 * zmd2) / f1 ** 5,
      f4 = (a2 - 2 * zpd2) / f2 ** 5;
    const brhoS = mui2 * (rhoov2 * (1 / f1 - 1 / f2) + rho3ov16 * (f3 - f4));
    const bzS = mui2 * (Math.log((zpd + f2) / (zmd + f1)) + rho2ov4 * (zpd / f2c - zmd / f1c));
    const t = Math.tanh((rho - a) / this.deltaRho);
    const wS = (1 - t) / 2,
      wL = (1 + t) / 2;
    let brho = brhoS * wS,
      bz = bzS * wS;
    if (rho > 1e-6 && wL > 0) {
      const rho2 = rho * rho;
      const g1 = Math.sqrt(zmd2 + rho2),
        g2 = Math.sqrt(zpd2 + rho2);
      const g1c = g1 ** 3,
        g2c = g2 ** 3;
      const brhoL = mui2 * ((g1 - g2) / rho + ((rho * a2) / 4) * (1 / g2c - 1 / g1c) + (2 / rho) * Math.min(Math.max(z, -d), d));
      const den = zmd + g1;
      const logTerm = den === 0 ? 0 : Math.log((zpd + g2) / den);
      const bzL = mui2 * (logTerm + (a2 / 4) * (zpd / g2c - zmd / g1c));
      brho += brhoL * wL;
      bz += bzL * wL;
    }
    return [brho, bz];
  }
}

export type MagBody = "mercury" | "earth" | "jupiter" | "saturn" | "uranus" | "neptune" | "ganymede";

/** A magnetosphere: its field, its figure (the stopping surface), its boundaries, its oval, its moons' footprints. */
export interface Magnetosphere {
  body: MagBody;
  model: FieldModel;
  /** the body's figure: its flattening (the surface a field line stops on — the 1-bar level of a giant) */
  flattening: number;
  /** the typical subsolar magnetopause, bow shock [radii]; Shue et al.'s flaring */
  standoff: number;
  shock: number;
  flaring: number;
  /** the main oval's field lines' equatorial reach [radii] (0: none), its width [° latitude], fixed to the Sun or the body */
  ovalL: number;
  ovalWidthDeg: number;
  ovalSunFixed: boolean;
  /** the moons whose flux tubes light a footprint, at their orbits' radii [radii] */
  footprints: { moon: string; r: number }[];
  /** what its model is (TARS says it) */
  note: string;
}

/** IGRF-14's 2025.0 main field to degree 3 [nT] (IAGA/NOAA; reference 6 371.2 km) — frozen: its secular variation not applied */
const IGRF14_2025: [number, number, number, number][] = [
  [1, 0, -29350.0, 0],
  [1, 1, -1410.3, 4545.5],
  [2, 0, -2556.2, 0],
  [2, 1, 2950.9, -3133.6],
  [2, 2, 1648.7, -814.2],
  [3, 0, 1360.9, 0],
  [3, 1, -2404.2, -56.9],
  [3, 2, 1243.8, 237.6],
  [3, 3, 453.4, -549.6],
];

/** JRM33 (Connerney et al. 2022) to degree 13, its recommended truncation: libinternalfield's jrm33.dat as Alex holds it */
// biome-ignore format: a table
const JRM33: [number, number, number, number][] = [
  [1,0,410993.4,0],[1,1,-71305.9,20958.4],[2,0,11796.7,0],[2,1,-56972.4,-42549.0],[2,2,48250.2,20221.5],
  [3,0,2799.3,0],[3,1,-37488.4,-32890.6],[3,2,15396.8,42518.4],[3,3,-1489.8,-27397.7],[4,0,-34402.0,0],
  [4,1,-8080.8,32452.4],[4,2,-2440.5,27438.6],[4,3,-10848.3,-501.4],[4,4,-17919.1,-1325.1],[5,0,-18265.7,0],
  [5,1,4221.8,45363.1],[5,2,16599.5,-826.2],[5,3,-17345.8,6000.6],[5,4,-2544.5,10568.8],[5,5,-4987.7,10091.5],
  [6,0,-20968.0,0],[6,1,9887.6,14016.9],[6,2,12192.4,-10119.1],[6,3,-12548.7,-294.9],[6,4,2742.2,13948.3],
  [6,5,1557.6,-3686.9],[6,6,8018.2,4783.1],[7,0,59.9,0],[7,1,5366.1,-7654.8],[7,2,-7099.5,-11398.6],
  [7,3,-1533.4,2171.0],[7,4,-7055.7,5301.6],[7,5,3060.6,-6618.1],[7,6,-2488.3,-1933.8],[7,7,3700.8,-5802.9],
  [8,0,10849.5,0],[8,1,1323.8,-2297.4],[8,2,-6952.2,-12833.5],[8,3,-95.0,10019.6],[8,4,-4746.6,-1725.6],
  [8,5,-1301.7,2387.1],[8,6,-4284.6,-3237.1],[8,7,-1436.7,906.1],[8,8,-3024.6,-3178.3],[9,0,8914.4,0],
  [9,1,-3506.7,-7899.6],[9,2,288.1,-1328.3],[9,3,773.6,6566.5],[9,4,3592.7,-1275.3],[9,5,-3170.8,3617.1],
  [9,6,1406.3,-194.8],[9,7,-1526.6,1960.3],[9,8,1313.3,956.9],[9,9,-2314.6,1831.7],[10,0,-2516.5,0],
  [10,1,1883.2,-5689.8],[10,2,2836.1,5570.3],[10,3,4259.4,-2541.6],[10,4,3776.7,-1795.2],[10,5,764.4,-217.8],
  [10,6,2112.3,-628.3],[10,7,724.8,-1619.6],[10,8,2496.3,454.6],[10,9,840.1,-840.0],[10,10,1179.4,1581.4],
  [11,0,1311.6,0],[11,1,3056.9,549.1],[11,2,-2060.6,4527.6],[11,3,3550.1,-4223.0],[11,4,589.7,-2761.9],
  [11,5,194.8,-476.0],[11,6,-1073.3,-2714.4],[11,7,-521.7,-1349.2],[11,8,685.3,-1649.0],[11,9,350.2,-1471.5],
  [11,10,-326.6,-583.0],[11,11,1088.8,-499.8],[12,0,2300.5,0],[12,1,1688.4,4204.2],[12,2,-291.7,2228.0],
  [12,3,483.2,-1901.1],[12,4,-581.9,-1271.2],[12,5,-818.4,1073.4],[12,6,-1095.6,-1111.9],[12,7,-1987.8,872.9],
  [12,8,484.5,-837.9],[12,9,-1473.1,-462.8],[12,10,-666.5,-22.0],[12,11,-755.4,110.3],[12,12,-220.8,-712.7],
  [13,0,751.5,0],[13,1,-456.4,4125.6],[13,2,1160.4,-44.0],[13,3,-2307.8,-455.4],[13,4,-77.1,2160.6],
  [13,5,-16.9,255.4],[13,6,594.8,1105.1],[13,7,-950.7,1214.2],[13,8,1042.3,196.1],[13,9,-641.8,-207.7],
  [13,10,41.6,1195.7],[13,11,-229.1,472.4],[13,12,-40.3,721.6],[13,13,-287.8,51.3],
];

function jupiterModel() {
  const m = new FieldModel(13, 1, [0, 0, 0], JRM33);
  m.sheet = new CurrentSheet();
  return m;
}

/**
 * The magnetospheres (§ 3 of the plan; the boundaries Bagenal et al.'s orders of magnitude). Mars and Venus have none of
 * their own (a crustal field, an induced one: AM6), Io, Europa and Callisto none (their auroras ride Jupiter's).
 */
export const MAGNETOSPHERES: Record<MagBody, Magnetosphere> = {
  mercury: {
    body: "mercury",
    model: new FieldModel(1, 1, [0, 0, 0.196], [[1, 0, -190, 0]]),
    flattening: 0,
    standoff: 1.45,
    shock: 1.9,
    flaring: 0.5,
    ovalL: 0,
    ovalWidthDeg: 0,
    ovalSunFixed: true,
    footprints: [],
    note: "offset dipole (MESSENGER, Anderson et al. 2011), 0.196 R north",
  },
  earth: {
    body: "earth",
    model: new FieldModel(3, 6371.2 / 6378.137, [0, 0, 0], IGRF14_2025),
    flattening: 1 / 298.257223563,
    standoff: 10,
    shock: 13,
    flaring: 0.58,
    ovalL: 7,
    ovalWidthDeg: 4,
    ovalSunFixed: true,
    footprints: [],
    note: "IGRF-14 2025.0 to degree 3, frozen (no secular variation)",
  },
  jupiter: {
    body: "jupiter",
    model: jupiterModel(),
    flattening: 0.06487,
    standoff: 63,
    shock: 80,
    flaring: 0.5,
    ovalL: 25,
    ovalWidthDeg: 1.2,
    ovalSunFixed: false,
    footprints: [
      { moon: "io", r: 5.9 },
      { moon: "europa", r: 9.4 },
      { moon: "ganymede", r: 15.0 },
      { moon: "callisto", r: 26.3 },
    ],
    note: "JRM33 to degree 13 (Connerney et al. 2022) + CON2020 disc",
  },
  saturn: {
    body: "saturn",
    model: new FieldModel(
      3,
      1,
      [0, 0, 0],
      [
        [1, 0, 21140.2, 0],
        [2, 0, 1581.1, 0],
        [3, 0, 2260.1, 0],
      ],
    ),
    flattening: 0.09796,
    standoff: 22,
    shock: 27,
    flaring: 0.55,
    ovalL: 15,
    ovalWidthDeg: 2,
    ovalSunFixed: true,
    footprints: [{ moon: "enceladus", r: 3.95 }],
    note: "Cassini 11, axisymmetric to degree 3 (Dougherty et al. 2018)",
  },
  uranus: {
    body: "uranus",
    model: new FieldModel(
      2,
      1,
      [0, 0, 0],
      [
        [1, 0, 11893, 0],
        [1, 1, 11579, -15684],
        [2, 0, -6030, 0],
        [2, 1, -12587, 6116],
        [2, 2, 196, 4759],
      ],
    ),
    flattening: 0.02293,
    standoff: 18,
    shock: 23.7,
    flaring: 0.55,
    ovalL: 7,
    ovalWidthDeg: 4,
    ovalSunFixed: false,
    footprints: [],
    note: "Q3 to degree 2 (Connerney et al. 1987)",
  },
  neptune: {
    body: "neptune",
    model: new FieldModel(
      3,
      1,
      [0, 0, 0],
      [
        [1, 0, 9732, 0],
        [1, 1, 3220, -9889],
        [2, 0, 7448, 0],
        [2, 1, 664, 11230],
        [2, 2, 4499, -70],
        [3, 0, -6592, 0],
        [3, 1, 4098, -3669],
        [3, 2, -3581, 1791],
        [3, 3, 484, -770],
      ],
    ),
    flattening: 0.01708,
    standoff: 26.5,
    shock: 34.9,
    flaring: 0.55,
    ovalL: 9,
    ovalWidthDeg: 5,
    ovalSunFixed: false,
    footprints: [],
    note: "O8 to degree 3 (Connerney et al. 1991)",
  },
  ganymede: {
    body: "ganymede",
    model: new FieldModel(
      1,
      1,
      [0, 0, 0],
      [
        [1, 0, -711.5, 0],
        [1, 1, 46.8, 22.9],
      ],
    ),
    flattening: 0,
    standoff: 2,
    shock: 0,
    flaring: 0.4,
    ovalL: 1.7,
    ovalWidthDeg: 5,
    ovalSunFixed: false,
    footprints: [],
    note: "intrinsic dipole (Kivelson et al. 2002), in Jupiter's ~100 nT (not yet added)",
  },
};

/** inside the body's figure: an ellipsoid of the equatorial radius 1 and the polar 1 − f */
const inside = (p: V3, f: number) => p[0] * p[0] + p[1] * p[1] + (p[2] * p[2]) / ((1 - f) * (1 - f)) < 1;

const dir = (model: FieldModel, p: V3): V3 => {
  const b = model.field(p);
  const l = len(b);
  return l > 0 ? mul(b, 1 / l) : [0, 0, 0];
};

/**
 * A field line from `start` [radii] along the field (sign +1) or against it (−1): RK4 steps of `step` of the distance, until
 * the body's figure (the last point on it, by bisection of the step), beyond rMax, or maxSteps. Its points; whether it came
 * back to the body (closed).
 */
export function trace(
  M: Magnetosphere,
  start: V3,
  sign: number,
  o: { rMax?: number; maxSteps?: number; step?: number } = {},
): { points: V3[]; closed: boolean } {
  const model = M.model;
  const f = M.flattening;
  const rMax = o.rMax ?? 4 * len(start) + 4;
  const maxSteps = o.maxSteps ?? 600;
  const frac = o.step ?? 0.02;
  const points: V3[] = [start];
  let p = start;
  for (let k = 0; k < maxSteps; k++) {
    const r = len(p);
    const ds = Math.max(frac * r, 1e-3) * sign;
    const k1 = dir(model, p);
    const k2 = dir(model, add(p, mul(k1, 0.5 * ds)));
    const k3 = dir(model, add(p, mul(k2, 0.5 * ds)));
    const k4 = dir(model, add(p, mul(k3, ds)));
    const next = add(p, mul(add(add(k1, mul(k2, 2)), add(mul(k3, 2), k4)), ds / 6));
    if (inside(next, f)) {
      // (the figure met within the step: bisected to it)
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inside(add(p, mul(sub(next, p), mid)), f)) hi = mid;
        else lo = mid;
      }
      points.push(add(p, mul(sub(next, p), lo)));
      return { points, closed: true };
    }
    points.push(next);
    if (len(next) > rMax) return { points, closed: false };
    p = next;
  }
  return { points, closed: false };
}

/**
 * Where the field line through `point` [radii] meets the body's figure in the dipole's hemisphere `north` (its northern end's
 * hemisphere, not the geographic one: Uranus's) — a moon's footprint, an oval's point. Null: it does not come back (open).
 */
export function footprint(M: Magnetosphere, point: V3, north: boolean): V3 | null {
  const sign = north ? -M.model.northPolarity : M.model.northPolarity;
  const t = trace(M, point, sign, { maxSteps: 1200, step: 0.01 });
  return t.closed ? t.points[t.points.length - 1]! : null;
}

/** a point's planetocentric latitude and east longitude [°] (body frame) */
export const latLon = (p: V3) => [Math.asin(p[2] / len(p)) / D, Math.atan2(p[1], p[0]) / D] as const;

/** the dipole's north pole (where its axis meets the sphere): latitude and east longitude [°] — the auroras' AUR_MAG */
export function dipolePole(body: MagBody) {
  const [lat, lon] = latLon(MAGNETOSPHERES[body].model.dipoleNorth);
  return { lat, lon };
}

/** the magnetopause's distance [radii] at `cosFromSun` from the subsolar point (Shue et al. 1998) */
export const magnetopause = (standoff: number, flaring: number, cosFromSun: number) =>
  standoff * (2 / Math.max(1 + cosFromSun, 1e-3)) ** flaring;

/**
 * The main oval's footprints round the dipole: field lines started at L = ovalL in the dipole's magnetic equator at `n`
 * magnetic longitudes, traced to each hemisphere's figure; each point's latitude and longitude [°] (null where a line does
 * not close). The table the auroras read (AM1, AM2) — a worker's work, tens of ms.
 */
export function ovalTable(body: MagBody, n = 72): { north: ([number, number] | null)[]; south: ([number, number] | null)[] } {
  const M = MAGNETOSPHERES[body];
  const z = M.model.dipoleNorth;
  // (the dipole's equator's frame: two axes perpendicular to its axis)
  const ref: V3 = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x0: V3 = [z[1] * ref[2] - z[2] * ref[1], z[2] * ref[0] - z[0] * ref[2], z[0] * ref[1] - z[1] * ref[0]];
  const lx = len(x0);
  const x = mul(x0, 1 / lx);
  const y: V3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const north: ([number, number] | null)[] = [],
    south: ([number, number] | null)[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const p = add(mul(x, M.ovalL * Math.cos(a)), mul(y, M.ovalL * Math.sin(a)));
    const fn = footprint(M, p, true),
      fs = footprint(M, p, false);
    north.push(fn ? ([...latLon(fn)] as [number, number]) : null);
    south.push(fs ? ([...latLon(fs)] as [number, number]) : null);
  }
  return { north, south };
}
