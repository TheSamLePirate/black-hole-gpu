import { expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import {
  bakeRange,
  bakeTexel as bakeTexelAny,
  bakeTexelSteps,
  horizonSeenFrom,
  bakeTexelReference,
  capLattice,
  decodeHorizon,
  elevationSin,
  encodeHorizon,
  encodeHorizonByte,
  globalLattice,
  HORIZON_SIN_MAX,
  heightPyramid,
  horizonAt,
  type Lattice,
  latticePoint,
  latticeTangent,
  POLE_SECTORS,
  referenceHorizon,
  toHalf,
  sunAngle,
  capUV,
  sectorSeen,
  sunAbove,
  withHorizonMaps,
  HORIZON_BINDINGS,
  HORIZON_STEP,
} from "../src/system/horizon-maps";
import { TABLE_HORIZON } from "../src/gpu-tables";
// (the bake's geometry — its rays, steps, sectors, caps — tested on the ground's tops: every blocker caught, the reads'
// conservative bound; option (d)'s mean reads — the default since decision 37 — tested below)
const bakeTexel = (
  ...a: [
    Parameters<typeof bakeTexelAny>[0],
    Parameters<typeof bakeTexelAny>[1],
    Parameters<typeof bakeTexelAny>[2],
    number,
    number,
    number?,
  ]
) => bakeTexelAny(a[0], a[1], a[2], a[3], a[4], a[5], "top");

// H1 — the horizon maps' bake (src/system/horizon-maps.ts, its CPU reference of shaders/horizon.wgsl), on synthetic bodies
// of the Moon's radius: a DEM of 2048 × 1024 (5.3 km a texel), the map at half of it (1024 × 512).
const R = 1_737_400;
const W = 2048,
  H = 1024;
const deg = Math.PI / 180;
const flat = () => new Float32Array(W * H);
/** raises the DEM's texels within `radius` [m] of a point to h */
function bump(m: Float32Array, lat: number, lon: number, radius: number, h: number) {
  const c: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const dl = radius / R + (2 * Math.PI) / W;
  for (let y = 0; y < H; y++) {
    const la = (0.5 - (y + 0.5) / H) * Math.PI;
    if (Math.abs(la - lat) > dl * 1.5) continue;
    for (let x = 0; x < W; x++) {
      const lo = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      const p: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
      const a = Math.acos(Math.min(1, p[0] * c[0] + p[1] * c[1] + p[2] * c[2]));
      if (a * R <= radius) m[y * W + x] = Math.max(m[y * W + x]!, h);
    }
  }
}
/** the point an arc d [m] from (lat, lon) along an azimuth (clockwise from north) */
function destination(lat: number, lon: number, az: number, d: number) {
  const t = latticeTangent(globalLattice(W, H), lat, lon, az);
  const p: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const th = d / R;
  const q: Vec3 = [
    p[0] * Math.cos(th) + t[0] * Math.sin(th),
    p[1] * Math.cos(th) + t[1] * Math.sin(th),
    p[2] * Math.cos(th) + t[2] * Math.sin(th),
  ];
  return { lat: Math.asin(q[2]), lon: Math.atan2(q[1], q[0]), p, t };
}
const map = globalLattice(W / 2, H / 2);
const sinDeg = (s: number) => Math.asin(s) / deg;

test("the encoding: the signed root round trip, ~0.07° a step at half a degree, monotone", () => {
  for (let s = -HORIZON_SIN_MAX; s <= HORIZON_SIN_MAX; s += 0.001) {
    const u = encodeHorizonByte(s) / 255;
    // (the byte's half step either way)
    const lo = decodeHorizon(Math.max(0, u - 0.5 / 255)),
      hi = decodeHorizon(Math.min(1, u + 0.5 / 255));
    expect(s).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(s).toBeLessThanOrEqual(hi + 1e-9);
  }
  // (the step round 0.5° of elevation)
  const at = Math.sin(0.5 * deg);
  const b = encodeHorizonByte(at);
  const step = sinDeg(decodeHorizon((b + 1) / 255)) - sinDeg(decodeHorizon(b / 255));
  console.log(`  a byte's step at 0.5°: ${step.toFixed(3)}°`);
  expect(step).toBeLessThan(0.08);
  let last = -1;
  for (let b2 = 0; b2 < 256; b2++) {
    const v = decodeHorizon(b2 / 255);
    expect(v).toBeGreaterThan(last);
    last = v;
  }
  expect(encodeHorizon(0)).toBe(0.5);
  expect(decodeHorizon(0.5)).toBe(0);
  // (the half floats the GPU holds the heights in)
  expect(toHalf(1000)).toBe(1000);
  expect(toHalf(8191)).toBe(8192);
  expect(toHalf(-3001)).toBe(-3000);
});

test("the bare sphere: the horizon at −D/2R — its first step's (the convention), every sector, any latitude", () => {
  const src = heightPyramid(flat(), W, H);
  const r = bakeRange(map, src, R, 1000);
  for (const j of [256, 100, 30]) {
    const v = bakeTexel(map, src, r, 300, j);
    for (const s of v) expect(s).toBeCloseTo(-Math.sin(r.D0 / (2 * R)), 9);
  }
  console.log(`  D_bake ${(r.D0 / 1000).toFixed(1)} km, reach ${(r.Dmax / 1000).toFixed(0)} km, ${r.steps} steps`);
});

test("a block 4 km high 50 km north: its elevation from its near edge, the other sectors the bare sphere's", () => {
  const m = flat();
  const i = 300,
    j = 256;
  const { lat, lon } = latticePoint(map, i, j);
  const c = destination(lat, lon, 0, 50_000);
  bump(m, c.lat, c.lon, 12_000, 4000);
  const src = heightPyramid(m, W, H);
  const r = bakeRange(map, src, R, 4000);
  const v = bakeTexel(map, src, r, i, j);
  // (the truth: the block's near edge, seen from the receiver's own ground, along the exact azimuth, a texel's step)
  const truth = referenceHorizon(m, W, H, R, c.p, c.t, 0, r.D0, r.Dmax, 0.25);
  console.log(`  north: baked ${sinDeg(v[0]!).toFixed(3)}°, truth ${sinDeg(truth).toFixed(3)}°`);
  expect(Math.abs(sinDeg(v[0]!) - sinDeg(truth))).toBeLessThan(0.35);
  expect(v[4]!).toBeCloseTo(-Math.sin(r.D0 / (2 * R)), 9);
});

test("a narrow peak between two rays: caught by the reads widening with the distance — over by a few tenths (an estimate, plan §2.5)", () => {
  const i = 300,
    j = 256;
  const { lat, lon } = latticePoint(map, i, j);
  const out: Record<string, number> = {};
  for (const az of [0, 7.5]) {
    const m = flat();
    const c = destination(lat, lon, az * deg, 100_000);
    bump(m, c.lat, c.lon, 3000, 6000);
    const src = heightPyramid(m, W, H);
    const r = bakeRange(map, src, R, 6000);
    const baked = bakeTexel(map, src, r, i, j)[0]!;
    const t = destination(lat, lon, az * deg, 1).t;
    const truth = referenceHorizon(m, W, H, R, c.p, t, 0, r.D0, r.Dmax, 0.25);
    out[`baked ${az}°`] = sinDeg(baked);
    out[`truth ${az}°`] = sinDeg(truth);
  }
  console.log(`  ${JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(3)])))}`);
  // (on a ray and between two — 13 km aside of each at 100 km —: caught, the 2 × 2 read round a step there 10–20 km wide; its
  // height taken at the step's distance, a little nearer than the peak's: over by up to ~0.4°)
  for (const az of [0, 7.5]) {
    expect(out[`baked ${az}°`]!).toBeGreaterThan(out[`truth ${az}°`]! - 0.35);
    expect(out[`baked ${az}°`]!).toBeLessThan(out[`truth ${az}°`]! + 0.6);
  }
});

test("the Sun's azimuth across a sector's edge: the horizon read continuous (the two neighbours interpolated), round the north", () => {
  const v = [0.01, 0.05, -0.02, 0.03, 0.0, 0.02, -0.01, 0.04];
  for (let k = 0; k < 8; k++) {
    const a = (k * 45 + 45) * deg;
    expect(Math.abs(horizonAt(v, a - 1e-7) - horizonAt(v, a + 1e-7))).toBeLessThan(1e-6);
    expect(horizonAt(v, k * 45 * deg)).toBeCloseTo(v[k]!, 12);
  }
  expect(horizonAt(v, -1e-9)).toBeCloseTo(v[0]!, 6);
  expect(horizonAt(v, 2 * Math.PI - 1e-9)).toBeCloseTo(v[0]!, 6);
  expect(horizonAt(v, 22.5 * deg)).toBeCloseTo(0.03, 12);
});

test("the receiver's height and the dominant blocker: a near ridge for a low receiver, a far range for a high one", () => {
  const m = flat();
  const i = 300,
    j = 256;
  const { lat, lon } = latticePoint(map, i, j);
  const near = destination(lat, lon, 90 * deg, 30_000),
    far = destination(lat, lon, 90 * deg, 150_000);
  bump(m, near.lat, near.lon, 6000, 1200);
  bump(m, far.lat, far.lon, 20_000, 9000);
  const src = heightPyramid(m, W, H);
  const r = bakeRange(map, src, R, 9000);
  const low = bakeTexel(map, src, r, i, j, 0)[2]!,
    high = bakeTexel(map, src, r, i, j, 1500)[2]!;
  // (each blocker's elevation from its near edge)
  const eNear0 = elevationSin(R, 0, 1200, 24_000 / R),
    eFar0 = elevationSin(R, 0, 9000, 130_000 / R);
  const eNear1 = elevationSin(R, 1500, 1200, 24_000 / R),
    eFar1 = elevationSin(R, 1500, 9000, 130_000 / R);
  console.log(
    `  low receiver: ${sinDeg(low).toFixed(2)}° (ridge ${sinDeg(eNear0).toFixed(2)}°, range ${sinDeg(eFar0).toFixed(2)}°); high: ${sinDeg(high).toFixed(2)}° (ridge ${sinDeg(eNear1).toFixed(2)}°, range ${sinDeg(eFar1).toFixed(2)}°)`,
  );
  // (low: the ridge dominates; high: the range — the map from the texel's top sees the high receiver's horizon, lower than
  // the low one's: the bias the pilot measures — under-shadowing, never over)
  expect(eNear0).toBeGreaterThan(eFar0);
  expect(eFar1).toBeGreaterThan(eNear1);
  expect(Math.abs(sinDeg(low) - sinDeg(eNear0))).toBeLessThan(0.6);
  expect(Math.abs(sinDeg(high) - sinDeg(eFar1))).toBeLessThan(0.6);
  expect(high).toBeLessThan(low);
});

test("the bake against the reference at a texel's step, no mips: ±0.3° (5–95 %) on a cratered body — the plan's 0.1° not met", () => {
  // (a rough body: craters of every size, their rims raised, their floors sunk — a seeded random field)
  const m = flat();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 400; n++) {
    const lat = (rnd() - 0.5) * 0.6,
      lon = (rnd() - 0.5) * 1.2;
    const rad = 4000 + 60_000 * rnd() ** 3;
    bump(m, lat, lon, rad, 300 + 3000 * rnd());
  }
  const src = heightPyramid(m, W, H);
  const r = bakeRange(map, src, R, 3300);
  const errs: number[] = [];
  for (let n = 0; n < 24; n++) {
    const i = 512 + Math.floor((rnd() - 0.5) * 80),
      j = 256 + Math.floor((rnd() - 0.5) * 40);
    const a = bakeTexel(map, src, r, i, j),
      b = bakeTexelReference(map, src, r, i, j);
    for (let k = 0; k < 8; k++) errs.push(sinDeg(a[k]!) - sinDeg(b[k]!));
  }
  errs.sort((x, y) => x - y);
  const q = (f: number) => errs[Math.floor(f * (errs.length - 1))]!;
  console.log(
    `  bake − reference over ${errs.length} sectors: median ${q(0.5).toFixed(3)}°, 5 % ${q(0.05).toFixed(3)}°, 95 % ${q(0.95).toFixed(3)}°, worst ${errs[0]!.toFixed(3)}° / ${errs.at(-1)!.toFixed(3)}°`,
  );
  // (the steps ×1.25 read the mips' highest round each step — no blocker slips between two —, its height taken at the step's
  // distance: a blocker a little nearer reads lower, a little farther higher — ±0.3° either way at 5 and 95 %, measured
  // 2 Nov 2026; the plan aimed at 0.1°: finer steps or two reads a step cost ×2 — the pilot's gate)
  expect(Math.abs(q(0.5))).toBeLessThan(0.05);
  expect(q(0.05)).toBeGreaterThan(-0.4);
  expect(q(0.95)).toBeLessThan(0.45);
});

test("the caps: a block seen alike from the cap and from the map at 79°, a peak at the pole seen in all 16 directions, no NaN", () => {
  // (a) a block 120 km east of a point at 79° N, from the map and from the cap's texel nearest it
  {
    const m = flat();
    const i = 300,
      j = Math.round((0.5 - 79 / 180) * (H / 2) - 0.5);
    const { lat, lon, p } = latticePoint(map, i, j);
    const c = destination(lat, lon, 90 * deg, 120_000);
    bump(m, c.lat, c.lon, 25_000, 3000);
    const src = heightPyramid(m, W, H);
    const cap = capLattice(1);
    // (the cap's texel nearest the map's)
    const r2 = 2 * Math.tan((Math.PI / 2 - lat) / 2);
    const ci = Math.round(((r2 * Math.cos(lon)) / cap.rmax + 1) * (cap.N / 2) - 0.5),
      cj = Math.round(((r2 * Math.sin(lon)) / cap.rmax + 1) * (cap.N / 2) - 0.5);
    const cp = latticePoint(cap, ci, cj);
    const off = Math.acos(Math.min(1, cp.p[0] * p[0] + cp.p[1] * p[1] + cp.p[2] * p[2])) * R;
    const fromMap = horizonAt(bakeTexel(map, src, bakeRange(map, src, R, 3000), i, j), 90 * deg);
    // (the cap's grid angle of the east: β − λ = atan2(sin α, −cos α))
    const beta = cp.lon + Math.atan2(1, 0);
    const fromCap = horizonAt(bakeTexel(cap, src, bakeRange(cap, src, R, 3000), ci, cj), beta);
    console.log(
      `  79° N, east: the map ${sinDeg(fromMap).toFixed(3)}°, the cap ${sinDeg(fromCap).toFixed(3)}° (its texel ${(off / 1000).toFixed(1)} km off)`,
    );
    expect(Math.abs(sinDeg(fromMap) - sinDeg(fromCap))).toBeLessThan(0.3);
  }
  // (b) a peak on the south pole, seen from 60 km off in each of the cap's 16 directions (an odd grid: a texel on the pole)
  {
    const m = flat();
    for (let y = H - 2; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = 3000;
    const src = heightPyramid(m, W, H);
    const cap = { ...capLattice(-1), N: 255 };
    const r = bakeRange(cap, src, R, 3000);
    const seen: number[] = [];
    const off: number[] = [];
    const texel = (2 * cap.rmax) / 255;
    for (let k = 0; k < POLE_SECTORS; k++) {
      // (the receiver opposite the direction, 60 km from the pole: looking along the grid angle k · 22.5° it faces the pole)
      const b = (k * 2 * Math.PI) / POLE_SECTORS + Math.PI;
      const rr = 60_000 / R;
      const ci = Math.round(127 + (rr * Math.cos(b)) / texel),
        cj = Math.round(127 + (rr * Math.sin(b)) / texel);
      const v = bakeTexel(cap, src, r, ci, cj);
      for (const x of v) expect(Number.isFinite(x)).toBe(true);
      seen.push(v[k]!);
      // (what it should see: the peak's edge — the DEM's last two rows, 10.6 km round the pole — from its own distance)
      const pt = latticePoint(cap, ci, cj);
      const dist = (Math.PI / 2 + pt.lat) * R;
      off.push(sinDeg(v[k]!) - sinDeg(elevationSin(R, 0, 3000, (dist - (2 * Math.PI * R) / W) / R)));
      // (and away from the pole, nothing: the opposite sector the bare sphere's)
      expect(sinDeg(v[(k + 8) % 16]!)).toBeLessThan(0);
    }
    console.log(
      `  the pole's peak from ~60 km, 16 directions: ${Math.min(...seen.map(sinDeg)).toFixed(2)}° … ${Math.max(...seen.map(sinDeg)).toFixed(2)}°, against each one's own: ${Math.min(...off).toFixed(2)}° … ${Math.max(...off).toFixed(2)}°`,
    );
    // (the same reads' error: −0.2° … +0.6° at 60 km for a 3 km peak)
    for (const o of off) expect(Math.abs(o)).toBeLessThan(0.7);
    // (and the whole row through the pole: finite)
    for (let i = 0; i < 255; i += 3) for (const x of bakeTexel(cap, src, r, i, 127)) expect(Number.isFinite(x)).toBe(true);
  }
});

test("a local lat/lon grid (the Earth's cache, H5): the same horizons as the global lattice's texel at the same place", () => {
  const m = flat();
  const i = 300,
    j = 200;
  const { lat, lon } = latticePoint(map, i, j);
  const c = destination(lat, lon, 135 * deg, 80_000);
  bump(m, c.lat, c.lon, 15_000, 2500);
  const src = heightPyramid(m, W, H);
  const g = map as Extract<Lattice, { kind: "latlon" }>;
  // (a window of 64 × 64 texels whose (10, 20) is the global (300, 200))
  const local: Lattice = {
    kind: "latlon",
    W: 64,
    H: 64,
    lon0: g.lon0 + (i - 10) * g.dlon,
    lat0: g.lat0 - (j - 20) * g.dlat,
    dlon: g.dlon,
    dlat: g.dlat,
  };
  const a = bakeTexel(map, src, bakeRange(map, src, R, 2500), i, j);
  const b = bakeTexel(local, src, bakeRange(local, src, R, 2500), 10, 20);
  for (let k = 0; k < 8; k++) expect(b[k]!).toBeCloseTo(a[k]!, 9);
  expect(sinDeg(a[3]!)).toBeGreaterThan(0.3);
});

test("option (d): the dominant blocker's step kept — a block 4 km high 50 km north at its own distance, the bare sphere's first step elsewhere", () => {
  const m = flat();
  const i = 300,
    j = 256;
  const { lat, lon } = latticePoint(map, i, j);
  const c = destination(lat, lon, 0, 50_000);
  bump(m, c.lat, c.lon, 12_000, 4000);
  const src = heightPyramid(m, W, H);
  const r = bakeRange(map, src, R, 4000);
  const v = bakeTexelSteps(map, src, r, i, j);
  const d = r.D0 * 1.25 ** v.step[0]!;
  console.log(`  north: blocker at step ${v.step[0]} — ${(d / 1000).toFixed(1)} km (the block's near edge 38 km, its centre 50 km)`);
  // (its distance among the block's: its near edge to its far one, a step either side)
  expect(d).toBeGreaterThan(38_000 / 1.25);
  expect(d).toBeLessThan(62_000 * 1.25);
  // (no blocker south: the bare sphere's first step)
  expect(v.step[4]).toBe(0);
  // (the mean's reads never see higher than the tops')
  const top = bakeTexelAny(map, src, r, i, j, undefined, "top");
  for (let k = 0; k < 8; k++) expect(v.sin[k]!).toBeLessThanOrEqual(top[k]! + 1e-9);
});

test("option (d): the horizon seen again from the receiver's own height — the blocker kept — as baked from that height, within 0.05°", () => {
  const m = flat();
  const i = 300,
    j = 256;
  const { lat, lon } = latticePoint(map, i, j);
  const ridge = destination(lat, lon, 90 * deg, 60_000);
  bump(m, ridge.lat, ridge.lon, 10_000, 3000);
  const src = heightPyramid(m, W, H);
  const r = bakeRange(map, src, R, 3000);
  // (baked from 1 500 m — a texel's top —; the receiver on its floor at 0 m)
  const fromTop = bakeTexelSteps(map, src, r, i, j, 1500);
  const fromFloor = bakeTexelSteps(map, src, r, i, j, 0);
  const d = r.D0 * 1.25 ** fromTop.step[2]!;
  const seen = horizonSeenFrom(fromTop.sin[2]!, 1500, 0, d);
  console.log(
    `  east: from the top ${sinDeg(fromTop.sin[2]!).toFixed(3)}°, seen again from the floor ${sinDeg(seen).toFixed(3)}°, baked from the floor ${sinDeg(fromFloor.sin[2]!).toFixed(3)}°`,
  );
  expect(fromTop.step[2]).toBe(fromFloor.step[2]);
  expect(Math.abs(sinDeg(seen) - sinDeg(fromFloor.sin[2]!))).toBeLessThan(0.05);
  // (and higher than the top's: the floor's receiver more shadowed — the faux éclairage the pilot measured, corrected)
  expect(seen).toBeGreaterThan(fromTop.sin[2]!);
});

// H2 — the tracer's reader (trace.wgsl horizonLight, its CPU mirror here): the Sun's angle on each lattice, the caps' texture
// coordinates, a sector decoded and seen again from the point's height, the Sun's disc's share above the horizon.
test("H2: the Sun's angle on a lattice is latticeTangent's inverse — the map's azimuth, both caps' grid angles", () => {
  const cases: [Lattice, number, number][] = [
    [globalLattice(1024, 512), 0.3, -2.1],
    [globalLattice(1024, 512), -1.2, 0.7],
    [capLattice(1), (82 * Math.PI) / 180, 1.9],
    [capLattice(-1), (-85 * Math.PI) / 180, -0.4],
    [capLattice(-1), (-79 * Math.PI) / 180, 3.0],
  ];
  for (const [l, lat, lon] of cases)
    for (let k = 0; k < 24; k++) {
      const ang = (k * 2 * Math.PI) / 24 + 0.05;
      const t = latticeTangent(l, lat, lon, ang);
      const sl = Math.sin(lat),
        cl = Math.cos(lat),
        so = Math.sin(lon),
        co = Math.cos(lon);
      const north = -sl * co * t[0] - sl * so * t[1] + cl * t[2];
      const east = -so * t[0] + co * t[1];
      const back = sunAngle(l, lon, north, east);
      const diff = Math.atan2(Math.sin(back - ang), Math.cos(back - ang));
      expect(Math.abs(diff)).toBeLessThan(1e-9);
    }
});

test("H2: a cap's texture coordinates are its texels' centres (latticePoint's inverse), both poles", () => {
  for (const pole of [1, -1] as const) {
    const l = capLattice(pole);
    for (const [i, j] of [
      [3, 7],
      [128, 128],
      [200, 31],
      [255, 0],
    ] as [number, number][]) {
      const { lat, lon } = latticePoint(l, i, j);
      const [u, v] = capUV(l, lat, lon);
      expect(u * l.N - 0.5).toBeCloseTo(i, 6);
      expect(v * l.N - 0.5).toBeCloseTo(j, 6);
    }
  }
});

test("H2: a sector decoded and seen again — the bake's own height gives its byte back; lower, a higher horizon by dh/d", () => {
  const D0 = 10_660;
  for (const sin of [-0.02, 0.0, 0.01, 0.05, 0.2]) {
    const u = encodeHorizonByte(sin) / 255;
    const n = 12;
    const stepU = n / 255;
    const d = D0 * HORIZON_STEP ** n;
    // (seen from the bake's own height: the byte's decoded sine)
    expect(sectorSeen(u, stepU, D0, 0)).toBeCloseTo(decodeHorizon(u), 9);
    // (500 m lower than the bake's receiver: tan e' = tan e + 500/d)
    const e = decodeHorizon(u);
    const t = e / Math.sqrt(1 - e * e) + 500 / d;
    expect(sectorSeen(u, stepU, D0, 500)).toBeCloseTo(t / Math.sqrt(1 + t * t), 9);
    expect(sectorSeen(u, stepU, D0, 500)).toBeGreaterThan(decodeHorizon(u));
  }
});

test("H2: the Sun's disc's share above the horizon — half at its centre on it, all a radius above, none a radius below", () => {
  const r = 0.00465;
  const h = Math.sin(0.01);
  expect(sunAbove(h, h, r)).toBeCloseTo(0.5, 9);
  expect(sunAbove(Math.sin(0.01 + r), h, r)).toBeCloseTo(1, 9);
  expect(sunAbove(Math.sin(0.01 - r), h, r)).toBeCloseTo(0, 9);
  expect(sunAbove(Math.sin(0.01 + 0.5 * r), h, r)).toBeGreaterThan(0.8);
});

test("H2: the tracer's reader — the two maps bound at 42 and 43, the table's offset, the stub without them", () => {
  const stub =
    "a\n// BEGIN_HORIZON_MAPS x\nfn horizonLight(q: vec3f, Lb: vec3f, sunR: f32, foot: f32) -> f32 { return 1.0; }\n// END_HORIZON_MAPS\nb";
  expect(withHorizonMaps(stub, false)).toBe(stub);
  const on = withHorizonMaps(stub, true);
  expect(HORIZON_BINDINGS).toEqual([42, 43]);
  expect(on).toContain(`@binding(42) var horizonMap: texture_2d_array<f32>;`);
  expect(on).toContain(`@binding(43) var horizonCaps: texture_2d_array<f32>;`);
  expect(on).toContain(`const HZ_OFF = ${TABLE_HORIZON}u;`);
  expect(on).toContain("fn horizonLight(q: vec3f, Lb: vec3f, sunR: f32, foot: f32) -> f32 {");
  expect(on).not.toContain("BEGIN_HORIZON_MAPS");
  expect(() => withHorizonMaps("nothing", true)).toThrow();
});
