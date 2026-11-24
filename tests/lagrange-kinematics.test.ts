// Lagrange points and their orbits at real dates (review of 07021ba5, 2026-11-24): the Halo's phase no longer runs on the
// day's angular rate times the time from 2067 (1.6 km/s off at Sun–Earth L2, 28 km/s at Earth–Moon L2 on 2026-11-24),
// but on the pair's synodic angle; velocity and acceleration are the exact derivatives of the position (checked against
// central differences, with DE440 loaded as in the game); the L4/L5 loops are the libration eigen-modes; the crew console
// draws the game's own pairs and loops; JWST's tracker is moved by its one writer.
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { addEphemeris } from "../src/system/de440";
import {
  defaultHaloAzM,
  haloAzOf,
  haloAzRangeM,
  haloPhase0At,
  haloState,
  LAGRANGE_SECONDARIES,
  lagrangeState,
} from "../src/system/lagrange";
import {
  HALO_AZ_DIM,
  librationModel,
  librationOffset,
  PAIR_PERIOD_DAYS,
  richardsonCoeffs,
  collinearGamma,
  triangularMode,
} from "../src/system/lagrange-math";
import { JWST_HALO, JwstTracker, jwstOrbit } from "../src/system/jwst";
import { EPOCH_DATE, M_METRES, M_SECONDS, SOLAR_BODIES, solarBody, solarState } from "../src/system/solar";
import { systemScene } from "../src/crew/sys3d/scene";
import type { InstrumentSnapshot } from "../src/net/instruments";
import { C_MPS } from "../src/units";
import { len, sub } from "../src/math/vec3";
import type { Vec3 } from "../src/physics";

// (N-body planning and century sweeps take seconds alone, tens of seconds on a loaded Mac or a parallel CI runner: 60 s, not the 5 s default)
setDefaultTimeout(60_000);

const tOf = (ms: number) => (ms - EPOCH_DATE) / 1000 / M_SECONDS;
const NOW = tOf(Date.UTC(2026, 10, 24));
const DAY = 86400 / M_SECONDS;
const ACC = C_MPS ** 2 / M_METRES; // c²/M → m/s²
const diff = (a: Vec3, b: Vec3) => len(sub(a, b));

beforeAll(async () => {
  const dir = new URL("../assets/ephemeris/", import.meta.url).pathname;
  for (const f of ["de440.bin", "jup365.bin"]) addEphemeris(await Bun.file(dir + f).arrayBuffer());
});

/** |vel − d pos/dt| [m/s] and |acc − d vel/dt| [m/s²] by central differences over `hs` seconds. */
function derivErrors(f: (t: number) => { pos: Vec3; vel: Vec3; acc: Vec3 }, t: number, hs = 60) {
  const h = hs / M_SECONDS;
  const a = f(t),
    p = f(t + h),
    m = f(t - h);
  const v = a.pos.map((_, i) => (p.pos[i]! - m.pos[i]!) / (2 * h)) as Vec3;
  const g = a.vel.map((_, i) => (p.vel[i]! - m.vel[i]!) / (2 * h)) as Vec3;
  return { vel: diff(v, a.vel) * C_MPS, acc: diff(g, a.acc) * ACC, speed: len(a.vel) * C_MPS, accel: len(a.acc) * ACC };
}

/** The raw ephemeris's own consistency there (its velocity against its positions' difference) [m/s]: a date where it
 *  jumps (a model handing over to DE440/JUP365) says nothing of ours. */
function ephemerisSmooth(t: number): boolean {
  const h = 60 / M_SECONDS;
  for (const id of ["sun", "earth", "moon", "jupiter", "io"]) {
    const p = solarState(id, t + h).pos,
      m = solarState(id, t - h).pos,
      v = solarState(id, t).vel;
    const e = diff(p.map((x, i) => (x - m[i]!) / (2 * h)) as Vec3, v) * C_MPS;
    if (e > 0.05) return false;
  }
  return true;
}

describe("the pairs' constants", () => {
  test("PAIR_PERIOD_DAYS agrees with solar.ts for every body with a parent (one owner, checked)", () => {
    for (const b of SOLAR_BODIES) {
      if (!b.parent) continue;
      const P = PAIR_PERIOD_DAYS[b.id];
      expect(P).toBeDefined();
      const ref = b.elements ? (360 * 36525) / b.elements[1][3]! : b.circle ? b.circle.period : 27.321661;
      expect(Math.abs(P! / ref - 1)).toBeLessThan(1e-7);
    }
  });

  test("Richardson's Halo family exists over the whole amplitude range for every pair shown (no silent fallback)", () => {
    for (const sec of LAGRANGE_SECONDARIES) {
      const b = solarBody(sec)!;
      const p = solarBody(b.parent!)!;
      const mu = b.mass / (b.mass + p.mass);
      for (const idx of [1, 2, 3] as const)
        for (const az of [HALO_AZ_DIM[0], 0.2, HALO_AZ_DIM[1]]) {
          const C = richardsonCoeffs(mu, idx, collinearGamma(mu, idx), az);
          expect(C.noFamily).toBe(false);
          expect(C.clamped).toBe(false);
        }
    }
  });
});

describe("exact kinematics at the present date and over ±50 years", () => {
  const ids = [
    "lag:earth:1",
    "lag:earth:2",
    "lag:earth:4",
    "lag:moon:1",
    "lag:moon:2",
    "lag:moon:4",
    "lag:moon:5",
    "lag:jupiter:4",
    "lag:mars:2",
  ];

  test("2026-11-24: vel and acc of the points and of their default orbits are the derivatives of pos", () => {
    for (const id of ids) {
      const L = derivErrors((t) => lagrangeState(id, t)!, NOW);
      const H = derivErrors((t) => haloState(id, t)!, NOW);
      console.log(
        `  ${id}: point ${L.vel.toExponential(1)} m/s, ${L.acc.toExponential(1)} m/s² · orbit ${H.vel.toExponential(1)} m/s (of ${H.speed.toFixed(0)}), ${H.acc.toExponential(1)} m/s² (of ${H.accel.toExponential(1)})`,
      );
      // (the Earth–Moon pairs: the Moon's ephemeris itself agrees with its positions to ~1 mm/s over 60 s)
      expect(L.vel).toBeLessThan(5e-3);
      expect(H.vel).toBeLessThan(5e-3);
      expect(L.acc).toBeLessThan(1e-6 + 1e-6 * L.accel);
      expect(H.acc).toBeLessThan(1e-6 + 1e-6 * H.accel);
    }
  });

  test("40 dates drawn over 1976–2076: the same agreement (no 2π jump of the clock, no drift with the epoch)", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let n = 0;
    for (let k = 0; k < 40; k++) {
      const t = NOW + (rnd() * 2 - 1) * 50 * 365.25 * DAY;
      if (!ephemerisSmooth(t)) continue;
      n++;
      for (const id of ["lag:earth:2", "lag:moon:2", "lag:moon:4"]) {
        const H = derivErrors((s) => haloState(id, s)!, t);
        expect(H.vel).toBeLessThan(5e-3);
        expect(H.acc).toBeLessThan(1e-6 + 1e-6 * H.accel);
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  test("the clock runs at its mean rate across 100 years: day-to-day phase steps all near ν n̄ (no jump)", () => {
    for (const id of ["lag:earth:2", "lag:moon:2"]) {
      const h0 = haloState(id, NOW)!;
      const rate = (2 * Math.PI) / h0.periodM; // ν n̄ [rad/M]
      let worst = 0;
      for (let k = -50 * 73; k < 50 * 73; k++) {
        const t = NOW + k * 5 * DAY;
        const a = haloState(id, t)!.phase,
          b = haloState(id, t + DAY)!.phase;
        worst = Math.max(worst, Math.abs((b - a) / (rate * DAY) - 1));
      }
      console.log(`  ${id}: day-to-day phase step within ${(worst * 100).toFixed(1)} % of the mean rate over 1976–2076`);
      // (the true anomaly's rate: ±2e about the mean — 3.4 % for the Earth, 11 % for the Moon, plus its inequalities)
      expect(worst).toBeLessThan(id === "lag:moon:2" ? 0.3 : 0.05);
    }
  });
});

describe("Halo orbits: period, envelope, amplitudes", () => {
  test("Sun–Earth L2, A_z 260,000 km: the Halo's period ≈ 178–180 days", () => {
    const h = haloState("lag:earth:2", NOW, JWST_HALO)!;
    console.log(`  SE-L2 Halo period ${h.periodDays.toFixed(2)} d`);
    expect(h.periodDays).toBeGreaterThan(174);
    expect(h.periodDays).toBeLessThan(184);
    // (the Earth–Moon L2 one, 12,000 km: ~15 days)
    const em = haloState("lag:moon:2", NOW)!;
    expect(em.periodDays).toBeGreaterThan(13);
    expect(em.periodDays).toBeLessThan(16);
  });

  test("JWST stays within its Halo's envelope for a year from 2026-11-24 (and moves continuously)", () => {
    let minKm = Infinity,
      maxKm = 0,
      maxZ = 0,
      maxStepKm = 0;
    let prev: Vec3 | null = null;
    for (let d = 0; d <= 365; d++) {
      const t = NOW + d * DAY;
      const o = jwstOrbit(t)!;
      const L = lagrangeState("lag:earth:2", t)!;
      const h = haloState("lag:earth:2", t, JWST_HALO)!;
      const km = (diff(o.X, L.pos) * M_METRES) / 1e3;
      minKm = Math.min(minKm, km);
      maxKm = Math.max(maxKm, km);
      maxZ = Math.max(maxZ, Math.abs(h.synM[2]) / 1e3);
      // (its step relative to L2 in a day: below its speed about L2 × 1 day)
      const rel = sub(o.X, L.pos);
      if (prev) maxStepKm = Math.max(maxStepKm, (diff(rel, prev) * M_METRES) / 1e3);
      prev = rel;
    }
    console.log(
      `  JWST from L2: ${minKm.toFixed(0)}–${maxKm.toFixed(0)} km, |z| ≤ ${maxZ.toFixed(0)} km, ≤ ${maxStepKm.toFixed(0)} km a day`,
    );
    expect(minKm).toBeGreaterThan(200_000);
    expect(maxKm).toBeLessThan(900_000);
    // (A_z is Richardson's first-order amplitude: the 2nd/3rd-order terms and the pair's ±1.7 % breathing add ≲ 15 %)
    expect(maxZ).toBeGreaterThan(260_000 * 0.95);
    expect(maxZ).toBeLessThan(260_000 * 1.15);
    expect(maxStepKm).toBeLessThan(60_000);
  });

  test("amplitudes: a range per point, a request beyond it flown at its edge and said (haloAzOf)", () => {
    const r = haloAzRangeM("lag:earth:2")!;
    expect(r.minM).toBeLessThan(defaultHaloAzM("lag:earth:2"));
    expect(r.maxM).toBeGreaterThan(defaultHaloAzM("lag:earth:2"));
    const big = haloAzOf("lag:earth:2", 5e12);
    expect(big.clamped).toBe(true);
    expect(Math.abs(big.azM / r.maxM - 1)).toBeLessThan(1e-9);
    const ok = haloAzOf("lag:earth:2", 300_000e3);
    expect(ok.clamped).toBe(false);
    expect(Math.abs(ok.azM / 300_000e3 - 1)).toBeLessThan(1e-9);
    // (none asked: the point's default)
    expect(haloAzOf("lag:moon:2").azM).toBeCloseTo(12_000e3, -2);
    // the orbit flown is the one said: its vertical amplitude ≈ A_z (Richardson's z = Az cos τ + 2nd/3rd order)
    let maxZ = 0;
    const p0 = haloPhase0At("lag:earth:2", NOW, 0, { azM: 300_000e3 });
    for (let k = 0; k < 64; k++) {
      const h = haloState("lag:earth:2", NOW, { azM: 300_000e3, phase0: p0 + (k / 64) * 2 * Math.PI })!;
      maxZ = Math.max(maxZ, Math.abs(h.synM[2]));
    }
    expect(Math.abs(maxZ / 300_000e3 - 1)).toBeLessThan(0.15);
  });

  test("defaults are constants of the point (no day's distance in them: one orbit asked at two instants)", () => {
    for (const id of ["lag:jupiter:4", "lag:mars:2", "lag:moon:3"])
      expect(defaultHaloAzM(id, NOW)).toBe(defaultHaloAzM(id, NOW + 100 * DAY));
  });
});

describe("L4/L5: the libration eigen-modes", () => {
  test("the in-plane loop solves the linearised CR3BP at L4 (Earth–Moon, Sun–Earth, Sun–Jupiter)", () => {
    for (const mu of [0.0121505856, 3.0404e-6, 0.00095388]) {
      const m = librationModel(mu, 4, 1e-4);
      const eta = Math.sqrt(3) / 2;
      const Uxx = 0.75,
        Uxy = ((3 * Math.sqrt(3)) / 4) * (1 - 2 * mu);
      const Uyy = 2.25;
      let worst = 0;
      for (let k = 0; k < 12; k++) {
        const th = k * 0.5;
        const o = librationOffset(m, -1, 0.3, th);
        const x = o.u[0] - m.xi,
          y = o.u[1] - eta;
        // ẍ − 2ẏ = Uxx x + Uxy y, ÿ + 2ẋ = Uxy x + Uyy y; z̈ = −z (θ the dimensionless time)
        const r1 = o.ddu[0] - 2 * o.du[1] - (Uxx * x + Uxy * y);
        const r2 = o.ddu[1] + 2 * o.du[0] - (Uxy * x + Uyy * y);
        const r3 = o.ddu[2] + o.u[2];
        worst = Math.max(worst, Math.abs(r1), Math.abs(r2), Math.abs(r3));
      }
      expect(worst).toBeLessThan(1e-12);
    }
  });

  test("the short-period mode at Sun–Earth L4 is the epicycle: a 2:1 ellipse, its long axis along the local tangent", () => {
    const mu = 3.0404e-6;
    const m = triangularMode(mu, 4);
    expect(m.stable).toBe(true);
    // the ellipse's axes in the point's radial / tangential frame (radial: from the barycentre through L4)
    const er = [0.5 - mu, Math.sqrt(3) / 2];
    const rl = Math.hypot(er[0]!, er[1]!);
    const r = [er[0]! / rl, er[1]! / rl];
    const tg = [-r[1]!, r[0]!];
    let rMax = 0,
      tMax = 0;
    for (let k = 0; k < 360; k++) {
      const tau = (k * Math.PI) / 180;
      const x = m.a[0] * Math.cos(tau) - m.a[1] * Math.sin(tau);
      const y = m.b[0] * Math.cos(tau) - m.b[1] * Math.sin(tau);
      rMax = Math.max(rMax, Math.abs(x * r[0]! + y * r[1]!));
      tMax = Math.max(tMax, Math.abs(x * tg[0]! + y * tg[1]!));
    }
    expect(tMax / rMax).toBeGreaterThan(1.9);
    expect(tMax / rMax).toBeLessThan(2.1);
    expect(tMax).toBeCloseTo(1, 3);
  });

  test("Pluto–Charon (μ above Routh's): no oscillating mode — a forced loop, flagged", () => {
    expect(triangularMode(0.1087, 4).stable).toBe(false);
  });
});

describe("one owner for the game and the crew console", () => {
  test("the console's Sun–Earth L2 and its Halo loop are the game's: JWST's mark sits on the loop", () => {
    const KM = M_METRES / 1e3;
    const KMS = C_MPS / 1e3;
    const ids = ["sun", "earth", "moon"];
    const bodies = ids.map((id) => {
      const b = solarBody(id)!;
      const s = solarState(id, NOW);
      return {
        id,
        r: s.pos.map((x) => x * KM) as Vec3,
        v: s.vel.map((x) => x * KMS) as Vec3,
        mu: b.mass * M_METRES * C_MPS * C_MPS * 1e-9,
        radius: b.radius * KM,
        parent: b.parent ?? "",
      };
    });
    const jw = jwstOrbit(NOW)!;
    const snap = {
      v: 1,
      t: 0,
      body: "sun",
      metrics: {},
      bodies,
      jwst: jw.X.map((x) => x * KM) as Vec3,
    } as unknown as InstrumentSnapshot;
    const scene = systemScene(snap, "sun", 0)!;
    const L2 = scene.marks.find((m) => m.id === "lag:earth:2")!;
    const gameL2 = lagrangeState("lag:earth:2", NOW)!.pos.map((x) => x * KM) as Vec3;
    const l2Km = diff(L2.pos as Vec3, gameL2);
    // the loop: the dashed line drawn about it (the longest dashed line near L2)
    const loop = scene.lines
      .filter((l) => l.dashed && l.pts.length === 65)
      .sort((a, b) => diff(a.pts[0] as Vec3, gameL2) - diff(b.pts[0] as Vec3, gameL2))[0]!;
    const J = snap.jwst as Vec3;
    let onKm = Infinity;
    for (let i = 0; i + 1 < loop.pts.length; i++) {
      const a = loop.pts[i] as Vec3,
        b = loop.pts[i + 1] as Vec3;
      const ab = sub(b, a);
      const s = Math.min(1, Math.max(0, ((J[0] - a[0]) * ab[0] + (J[1] - a[1]) * ab[1] + (J[2] - a[2]) * ab[2]) / (len(ab) ** 2 || 1)));
      onKm = Math.min(onKm, diff(J, [a[0] + s * ab[0], a[1] + s * ab[1], a[2] + s * ab[2]]));
    }
    // (the polyline's chords: 64 segments of a ~4 M km loop sag by ≲ 2,000 km)
    console.log(`  console L2 vs game ${l2Km.toFixed(1)} km; JWST ${onKm.toFixed(0)} km from the console's loop`);
    expect(l2Km).toBeLessThan(5);
    expect(onKm).toBeLessThan(3_000);
  });
});

describe("JWST's tracker: one writer", () => {
  test("peek never moves it: a far look leaves the near state as it was", () => {
    const tr = new JwstTracker();
    const o = jwstOrbit(NOW)!;
    const ship: Vec3 = [o.X[0] + 1000 / M_METRES, o.X[1], o.X[2]];
    tr.state(NOW, ship);
    expect(tr.near).toBe(true);
    const before = tr.last();
    // a renderer's look from far away, later
    tr.peek(NOW + 10 / M_SECONDS);
    tr.peek(NOW + 3 * DAY);
    expect(tr.near).toBe(true);
    expect(tr.last()).toBe(before);
    expect(tr.anchors).toBe(1);
  });
});
