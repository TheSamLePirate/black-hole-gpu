// Builds the solar system's ephemerides from NASA/JPL's kernels (bun scripts/build-ephemeris.ts):
//
//   assets/kernels/de440s.bsp   — DE440 (short): the Sun, the planets' barycentres, the Earth and the Moon
//   assets/nasaSolar/kernels/jup365.bsp (optional) — Jupiter's centre and the Galilean moons
//   assets/kernels/pck00010.tpc — the IAU rotation models (poles, prime meridians, the Moon's librations)
//   assets/kernels/naif0012.tls — the leap seconds
//
// The kernels' Chebyshev records (millimetre precision, 33 MB and 1.1 GB) are refitted here for the app:
// each body relative to what it is seen from (the planets from the Sun, the Moon from the Earth, the
// Galilean moons from Jupiter's centre), on J2000 ecliptic axes, its own interval and degree — the
// cheapest that keeps it within its tolerance (the Moon 50 m: an eclipse's shadow; the planets 0.5 – 10 km, the Galilean moons 10
// km). Each record: its constant term in float64, the others in float32 (relative: metres at most).
// Out: assets/ephemeris/de440.bin (1990 – 2150) and src/system/iau-data.ts (rotations, leap seconds).

const ROOT = new URL("..", import.meta.url).pathname;
const K = (p: string) => `${ROOT}assets/${p}`;

import { evalSeg, readSpk, type Seg } from "./spk";

const segs: Seg[] = [...(await readSpk(K("kernels/de440s.bsp")))];
const JUP = K("nasaSolar/kernels/jup365.bsp");
const haveJup = await Bun.file(JUP).exists();
if (haveJup) segs.push(...(await readSpk(JUP)).filter((s) => s.target > 500 && s.target < 600));

/** target relative to its segment's centre at et (the segment covering et) */
function rel(target: number, et: number): { v: [number, number, number]; center: number } {
  const s = segs.find((q) => q.target === target && et >= q.et0 && et <= q.et1);
  if (!s) throw new Error(`no segment for ${target} at ${et}`);
  return { v: evalSeg(s, et), center: s.center };
}
/** target relative to the solar system barycentre */
function ssb(target: number, et: number): [number, number, number] {
  let p: [number, number, number] = [0, 0, 0];
  for (let t = target; t !== 0; ) {
    const r = rel(t, et);
    p = [p[0] + r.v[0], p[1] + r.v[1], p[2] + r.v[2]];
    t = r.center;
  }
  return p;
}
// J2000 equatorial → J2000 ecliptic (SPICE's ECLIPJ2000: ε = 84381.448″)
const EPS = (84381.448 / 3600) * (Math.PI / 180);
const ecl = (v: number[]): [number, number, number] => [
  v[0]!,
  v[1]! * Math.cos(EPS) + v[2]! * Math.sin(EPS),
  -v[1]! * Math.sin(EPS) + v[2]! * Math.cos(EPS),
];
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);

// ------------------------------------------------------------------------------------ the bodies
/**
 * What the app draws, from what it is seen (km, J2000 ecliptic), within tol [km], stored in float64
 * (prec 64) or with its constant term alone in float64 (prec 32: values of 10⁶ km at most — metres).
 * The Earth and Jupiter are not fitted: their systems' barycentres are (smooth), the planets' centres
 * found at run time from their moons (the Earth: the Moon and DE440's mass ratio; Jupiter: its
 * Galilean moons) — the Earth wobbling ±4 700 km about the barycentre each month cost 30 times more.
 */
interface Fit {
  id: string;
  of: (et: number) => number[];
  tol: number;
  prec: 32 | 64;
  from: number;
  to: number;
}
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const etOf = (y: number) => (Date.UTC(y, 0, 1) - J2000_MS) / 1000;
const helio = (t: number) => (et: number) => ecl(sub(ssb(t, et), ssb(10, et)));
const FITS: Fit[] = [
  { id: "mercury", of: helio(199), tol: 1, prec: 64, from: 1990, to: 2150 },
  { id: "venus", of: helio(299), tol: 1, prec: 64, from: 1990, to: 2150 },
  { id: "emb", of: helio(3), tol: 0.05, prec: 64, from: 1990, to: 2150 },
  { id: "mars", of: helio(4), tol: 1, prec: 64, from: 1990, to: 2150 },
  { id: "jupiter", of: helio(5), tol: 2, prec: 64, from: 1990, to: 2150 },
  // (the barycentres: solar.ts takes the centres off by the moons it draws — Titan, Triton, Charon…)
  { id: "saturn", of: helio(6), tol: 5, prec: 64, from: 1990, to: 2150 },
  { id: "uranus", of: helio(7), tol: 5, prec: 64, from: 1990, to: 2150 },
  { id: "neptune", of: helio(8), tol: 5, prec: 64, from: 1990, to: 2150 },
  { id: "pluto", of: helio(9), tol: 5, prec: 64, from: 1990, to: 2150 },
  { id: "moon", of: (et) => ecl(sub(ssb(301, et), ssb(399, et))), tol: 0.02, prec: 64, from: 1990, to: 2150 },
];
// (the Galilean moons from Jupiter's centre, from 1990 — the eclipse calculator's present, PLAN-CIEL C5 — to 2100: Io turns in 1.8 days — 160 years
// of it would weigh megabytes)
const JUP_FITS: Fit[] = haveJup
  ? (
      [
        ["io", 501],
        ["europa", 502],
        ["ganymede", 503],
        ["callisto", 504],
      ] as const
    ).map(([id, n]) => ({ id, of: (et: number) => ecl(sub(ssb(n, et), ssb(599, et))), tol: 5, prec: 32 as const, from: 1990, to: 2100 }))
  : [];

/**
 * Chebyshev coefficients of f on [a, b], degree n, through its values at the Lobatto nodes cos(πj/n) —
 * the ends included: a fit meets the next one where the body is (no jump from one interval to the next)
 */
function chebFit(f: (et: number) => number[], a: number, b: number, n: number): number[][] {
  const vals = Array.from({ length: n + 1 }, (_, j) => f((a + b) / 2 + ((b - a) / 2) * Math.cos((Math.PI * j) / n)));
  return [0, 1, 2].map((c) =>
    Array.from({ length: n + 1 }, (_, k) => {
      let s = 0;
      for (let j = 0; j <= n; j++) s += (j === 0 || j === n ? 0.5 : 1) * vals[j]![c]! * Math.cos((Math.PI * k * j) / n);
      return ((k === 0 || k === n ? 1 : 2) / n) * s;
    }),
  );
}
const chebEval = (cs: number[], x: number) => {
  let t0 = 1,
    t1 = x,
    s = cs[0]! + (cs.length > 1 ? cs[1]! * x : 0);
  for (let k = 2; k < cs.length; k++) {
    const t2 = 2 * x * t1 - t0;
    s += cs[k]! * t2;
    t0 = t1;
    t1 = t2;
  }
  return s;
};
const f32 = (x: number) => Math.fround(x);
const stored = (F: Fit, cs: number[][]) => (F.prec === 64 ? cs : cs.map((c) => c.map((x, i) => (i === 0 ? x : f32(x)))));
const recBytes = (F: Fit, n: number) => (F.prec === 64 ? 24 * (n + 1) : 24 + 12 * n);

/** The error of a fit (interval L days, degree n) of a body: its worst over sampled intervals and points [km]. */
function fitError(F: Fit, L: number, n: number, samples = 24) {
  let worst = 0;
  const e0 = etOf(F.from),
    e1 = etOf(F.to);
  for (let k = 0; k < samples; k++) {
    const a = e0 + ((e1 - e0 - L * 86400) * (k + 0.37)) / samples;
    const b = a + L * 86400;
    const cs = stored(F, chebFit(F.of, a, b, n));
    for (let j = 0; j <= 24; j++) {
      const x = -1 + (2 * j) / 24;
      const truth = F.of((a + b) / 2 + ((b - a) / 2) * x);
      worst = Math.max(worst, Math.hypot(...cs.map((c, i) => chebEval(c, x) - truth[i]!)));
    }
  }
  return worst;
}

const LS = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];
interface Plan {
  F: Fit;
  L: number;
  n: number;
  err: number;
  bytesPerYear: number;
}
function plan(F: Fit): Plan {
  let best: Plan | null = null;
  for (const L of LS) {
    for (let n = 3; n <= 20; n++) {
      const bytes = (365.25 / L) * recBytes(F, n);
      if (best && bytes >= best.bytesPerYear) break;
      const err = fitError(F, L, n);
      if (err <= F.tol) {
        best = { F, L, n, err, bytesPerYear: bytes };
        break;
      }
    }
  }
  if (!best) throw new Error(`${F.id}: no fit within ${F.tol} km`);
  console.log(
    `${F.id.padEnd(9)} ${String(best.L).padStart(5)} d  degree ${String(best.n).padStart(2)}  ${(best.err * 1000).toFixed(0).padStart(5)} m  ${(best.bytesPerYear / 1024).toFixed(1)} KB/yr  ${F.from}–${F.to}`,
  );
  return best;
}

// ------------------------------------------------------------------------------------ writing
/** One file: "EPHM", the header's length, the header (JSON), then each body's records. */
async function write(file: string, fits: Fit[], source: string) {
  const plans = fits.map(plan);
  const header = {
    format: "EPHM",
    version: 1,
    source,
    frame: "J2000 ecliptic, km",
    time: "TDB seconds past J2000",
    bodies: [] as { id: string; center: string; et0: number; L: number; n: number; prec: number; count: number; offset: number }[],
  };
  const CENTER: Record<string, string> = { moon: "earth", io: "jupiter", europa: "jupiter", ganymede: "jupiter", callisto: "jupiter" };
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  for (const { F, L, n } of plans) {
    const len = L * 86400;
    const e0 = etOf(F.from);
    const count = Math.floor((etOf(F.to) - e0) / len); // (whole intervals: DE440s ends on 2150-01-22)
    const rec = recBytes(F, n);
    const buf = new ArrayBuffer(count * rec);
    const dv = new DataView(buf);
    for (let i = 0; i < count; i++) {
      const a = e0 + i * len;
      const cs = chebFit(F.of, a, a + len, n);
      const o = i * rec;
      for (let c = 0; c < 3; c++) {
        if (F.prec === 64) for (let k = 0; k <= n; k++) dv.setFloat64(o + 8 * (c * (n + 1) + k), cs[c]![k]!, true);
        else {
          dv.setFloat64(o + 8 * c, cs[c]![0]!, true);
          for (let k = 1; k <= n; k++) dv.setFloat32(o + 24 + 4 * (c * n + k - 1), cs[c]![k]!, true);
        }
      }
    }
    header.bodies.push({ id: F.id, center: CENTER[F.id] ?? "sun", et0: e0, L: len, n, prec: F.prec, count, offset });
    chunks.push(buf);
    offset += buf.byteLength;
  }
  const hj = new TextEncoder().encode(JSON.stringify(header));
  const pad = (8 - ((8 + hj.length) % 8)) % 8;
  const head = new Uint8Array(8 + hj.length + pad);
  head.set(new TextEncoder().encode("EPHM"), 0);
  new DataView(head.buffer).setUint32(4, hj.length + pad, true);
  head.set(hj, 8);
  head.fill(32, 8 + hj.length);
  await Bun.write(K(`ephemeris/${file}`), new Blob([head, ...chunks]));
  console.log(`→ assets/ephemeris/${file}: ${((head.length + offset) / 1048576).toFixed(2)} MB`);
}
await write("de440.bin", FITS, "DE440s (NASA/JPL NAIF), refitted");
if (JUP_FITS.length) await write("jup365.bin", JUP_FITS, "JUP365 (NASA/JPL NAIF), refitted");

// ------------------------------------------------------------------------------------ rotations, leap seconds
/** a text kernel's data (inside \begindata blocks only) */
async function textKernel(path: string): Promise<Map<string, (number | string)[]>> {
  const txt = await Bun.file(path).text();
  const out = new Map<string, (number | string)[]>();
  let data = "";
  for (const part of txt.split(/\\begindata/).slice(1)) data += part.split(/\\begintext/)[0] + "\n";
  const re = /([A-Z0-9_/]+)\s*(\+?=)\s*(\([^)]*\)|'[^']*'|@\S+|[-+.\dDE]+)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(data)); ) {
    const raw = m[3]!.replace(/^\(|\)$/g, "");
    const vals = (raw.match(/'[^']*'|@\S+|[-+]?[\d.]+(?:[DE][-+]?\d+)?/g) ?? []).map((v) =>
      v.startsWith("'") || v.startsWith("@") ? v.replace(/'/g, "") : Number(v.replace("D", "E")),
    );
    if (m[2] === "+=") out.set(m[1]!, [...(out.get(m[1]!) ?? []), ...vals]);
    else out.set(m[1]!, vals);
  }
  return out;
}
const pck = await textKernel(K("kernels/pck00010.tpc"));
const tls = await textKernel(K("kernels/naif0012.tls"));
const NAIF: Record<string, number> = {
  sun: 10,
  mercury: 199,
  venus: 299,
  earth: 399,
  moon: 301,
  mars: 499,
  phobos: 401,
  deimos: 402,
  ceres: 2000001,
  jupiter: 599,
  io: 501,
  europa: 502,
  ganymede: 503,
  callisto: 504,
  saturn: 699,
  mimas: 601,
  enceladus: 602,
  tethys: 603,
  dione: 604,
  rhea: 605,
  titan: 606,
  iapetus: 608,
  uranus: 799,
  neptune: 899,
  triton: 801,
  pluto: 999,
  charon: 901,
};
const rot: Record<string, unknown> = {};
const systems: Record<number, number[]> = {};
for (const [id, n] of Object.entries(NAIF)) {
  const g = (k: string) => pck.get(`BODY${n}_${k}`) as number[] | undefined;
  const ra = g("POLE_RA"),
    dec = g("POLE_DEC"),
    pm = g("PM");
  if (!ra || !dec || !pm) continue;
  const sys = n < 1000 && n % 100 !== 99 ? Math.floor(n / 100) : n < 1000 ? Math.floor(n / 100) : 0;
  const nut = { ra: g("NUT_PREC_RA"), dec: g("NUT_PREC_DEC"), pm: g("NUT_PREC_PM") };
  if ((nut.ra || nut.dec || nut.pm) && sys && !systems[sys]) systems[sys] = pck.get(`BODY${sys}_NUT_PREC_ANGLES`) as number[];
  rot[id] = {
    ra,
    dec,
    pm,
    ...(nut.ra ? { nra: nut.ra } : {}),
    ...(nut.dec ? { ndec: nut.dec } : {}),
    ...(nut.pm ? { npm: nut.pm } : {}),
    ...(sys && (nut.ra || nut.dec || nut.pm) ? { sys } : {}),
  };
}
// the leap seconds: [UTC ms at which TAI − UTC becomes …, its value]
const MON: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const dat = tls.get("DELTET/DELTA_AT")!;
const leaps: [number, number][] = [];
for (let i = 0; i < dat.length; i += 2) {
  const [y, mo, d] = String(dat[i + 1])
    .replace("@", "")
    .split("-");
  leaps.push([Date.UTC(Number(y), MON[mo!]!, Number(d)), dat[i] as number]);
}
const ts = `// Generated by scripts/build-ephemeris.ts from NASA/JPL NAIF's pck00010.tpc and naif0012.tls — do not edit.
//
// The IAU rotation models (the IAU WG on cartographic coordinates, 2009): for each body, its pole's
// right ascension and declination [°, °/century] and its prime meridian W [°, °/day, °/day²] (J2000,
// TDB), and their periodic terms (the sines of the system's angles for RA and W, their cosines for the
// declination), the angles' [°, °/century]. And the leap seconds: from [UTC ms], TAI − UTC [s].

export interface IauRotation { ra: number[]; dec: number[]; pm: number[]; nra?: number[]; ndec?: number[]; npm?: number[]; sys?: number }

export const IAU_ROTATION: Record<string, IauRotation> = ${JSON.stringify(rot, null, 0).replace(/\},"/g, '},\n  "').replace(/^\{/, "{\n  ").replace(/\}$/, ",\n}")};

export const IAU_ANGLES: Record<number, number[]> = ${JSON.stringify(systems).replace(/\],"/g, '],\n  "').replace(/^\{/, "{\n  ").replace(/\}$/, ",\n}")};

export const LEAP_SECONDS: [number, number][] = ${JSON.stringify(leaps)};
`;
await Bun.write(`${ROOT}src/system/iau-data.ts`, ts);
console.log(
  `src/system/iau-data.ts: ${Object.keys(rot).length} bodies, ${Object.keys(systems).length} systems of angles, ${leaps.length} leap seconds`,
);
