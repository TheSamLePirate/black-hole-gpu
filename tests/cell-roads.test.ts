import { expect, test } from "bun:test";
import trace from "../src/shaders/trace.wgsl" with { type: "text" };
import { catenaryMasts, cellRoadSurfaces } from "../src/system/cell-roads";
import {
  encodeStreetCell,
  NEXT_NONE,
  type RoadSegmentRecord,
  SegmentFlag,
  type SegmentSurface,
  SurfaceFlag,
} from "../src/system/street-cells";

// PLAN-J8 J8-RP RP2 — the scene's roads in France from the street cells (src/system/cell-roads.ts): a cell's segments as surface
// segments at their measured width, their markings and pavement from the cell's surfaces, none on a bridge nor in a tunnel.

const seg = (a: [number, number], b: [number, number], extra: Partial<RoadSegmentRecord> = {}): RoadSegmentRecord => ({
  a,
  b,
  width: 9,
  lanes: 2,
  cls: "secondary",
  flags: SegmentFlag.Urban,
  level: 0,
  speed: 14,
  s0: 0,
  roadId: 1,
  ...extra,
});

test("RP2: a cell's roads as surface segments — measured width, the cell's markings and pavement, no bridge, no tunnel", () => {
  const segs = [
    seg([0, 0], [100, 0]),
    seg([100, 0], [200, 0], { flags: SegmentFlag.Urban | SegmentFlag.Bridge }),
    seg([0, 50], [80, 50], { roadId: 2, width: 4, flags: SegmentFlag.OnewayAlong | SegmentFlag.InferredWidth }),
    seg([0, 90], [80, 90], { roadId: 3, flags: SegmentFlag.Tunnel }),
  ];
  const next = segs.map(() => ({ a: NEXT_NONE, b: NEXT_NONE }));
  const surfaces: SegmentSurface[] = [
    { flags: SurfaceFlag.CentreDashed | SurfaceFlag.Kerb, laneLines: 0, pavement: 3, bridge: 0xff },
    { flags: SurfaceFlag.CentreDashed, laneLines: 0, pavement: 0, bridge: 0 },
    { flags: 0, laneLines: 0, pavement: 0, bridge: 0xff },
    { flags: 0, laneLines: 0, pavement: 0, bridge: 0xff },
  ];
  const buf = encodeStreetCell({ z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 }, [], segs, [], [], 0, next, [], surfaces);
  const out = cellRoadSurfaces(buf, (e, n) => [e + 1000, n - 500, 0]);
  expect(out.length).toBe(2);
  const [main, lane] = out as [(typeof out)[0], (typeof out)[0]];
  // (the main road: 9 m, its frame moved; its dashed centre and kerb with 3 m pavements — its record widened to 4.5 + 3)
  expect(main.data.slice(0, 4)).toEqual([1000, -500, 1100, -500]);
  expect(main.data[5]).toBe(1);
  expect(main.data[7]).toBe(-4.5);
  expect(main.data[4]).toBe(7.5);
  const pk = main.data[6]!;
  expect(pk & 15).toBe(SurfaceFlag.CentreDashed | SurfaceFlag.Kerb);
  expect(pk >> 9).toBe(30);
  // (the one way: its bit, its 4 m)
  expect(lane.data[6]! & 16).toBe(16);
  expect(lane.data[7]).toBe(2);
});

test("RP9 (KSC5): a railway's segment — its tracks as the scene's rails, 4.5 m apart, no marking", () => {
  const segs = [seg([0, 0], [100, 0], { cls: "rail", lanes: 2, width: 7.5, flags: 0 })];
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 },
    [],
    segs,
    [],
    [],
    0,
    [{ a: NEXT_NONE, b: NEXT_NONE }],
    [],
    [{ flags: 0, laneLines: 0, pavement: 0, bridge: 0xff }],
  );
  const out = cellRoadSurfaces(buf, (e, n) => [e, n, 0]);
  expect(out.length).toBe(2);
  for (const p of out) {
    expect(p.data[5]).toBe(2);
    expect(p.data[4]).toBe(1.5);
  }
  expect(Math.abs(out[0]!.data[1]! - out[1]!.data[1]!)).toBeCloseTo(4.5, 6);
});

test("RP9: the catenary's masts — every 60 m along an electrified railway, beside its outer track, none on a plain one", () => {
  const segs = [
    seg([0, 0], [300, 0], { cls: "rail", lanes: 2, width: 7.5, flags: 0, roadId: 1 }),
    seg([0, 50], [300, 50], { cls: "rail", lanes: 1, width: 3, flags: 0, roadId: 2 }),
  ];
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 43, originLon: 6 },
    [],
    segs,
    [],
    [],
    0,
    segs.map(() => ({ a: NEXT_NONE, b: NEXT_NONE })),
    [],
    [
      { flags: SurfaceFlag.Electrified, laneLines: 0, pavement: 0, bridge: 0xff },
      { flags: 0, laneLines: 0, pavement: 0, bridge: 0xff },
    ],
  );
  const masts = catenaryMasts(buf, (e, n) => [e, n, 0]);
  expect(masts.length).toBe(5);
  for (const m of masts) {
    expect(Math.abs(m.foot[1])).toBeCloseTo(2.25 + 3.2, 6);
    expect(m.foot[0] % 60).toBeCloseTo(0, 6);
  }
});

// (24 Nov 2026, the campaign's « rings » — SFO's ramps, the Pont Alexandre III's approach: a road's markings drawn as chains of circles
// and closed loops.) A segment's strip ends in round caps (trace.wgsl scenerySurface clamps its distance to its ends); B2's bends cut a
// curve in pieces of 1–2 m, each piece's cap over its neighbours. The shader kept the FIRST segment met among equals (cover 1 = 1), so a
// piece's cap drew its markings at its own distance — an edge line's circle about each end, a lane line's stadium. The rule now: within
// a rank the deepest (size.x − distance) wins — the nearest axis: the markings follow the road's polyline. A CPU model of the shader's
// walk (its winner, its edge/centre/lane paint) over the cell's real pieces; the old rule its positive witness.

type Prim = ReturnType<typeof cellRoadSurfaces>[number];
/** trace.wgsl scenerySurface's road paint at `pt` (kind 1, foot 0.1 m): its winner by `rule`, its markings' cover m */
function paintModel(prims: readonly Prim[], pt: [number, number], rule: "first" | "deepest"): number {
  const aa = 0.12;
  const ss = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  let best = -1e9,
    bestCover = 0,
    out = 0;
  for (const p of prims) {
    const d = p.data;
    const lx = d[2]! - d[0]!,
      ly = d[3]! - d[1]!;
    const len = Math.max(Math.hypot(lx, ly), 0.001);
    const along = Math.min(1, Math.max(0, ((pt[0] - d[0]!) * lx + (pt[1] - d[1]!) * ly) / (len * len)));
    const distance = Math.hypot(pt[0] - d[0]! - lx * along, pt[1] - d[1]! - ly * along);
    const cover = 1 - ss(Math.max(0, d[4]! - aa), d[4]! + aa, distance);
    if (cover <= 0) continue;
    const crK = d[7] !== 0 ? Math.abs(d[7]!) : d[4]!;
    const key = distance <= crK ? 64 + crK - distance : d[4]! - distance;
    const mk = d[6]! & 32767;
    const cr = d[7] !== 0 ? Math.abs(d[7]!) : d[4]!;
    const s = along * len - d[11]!;
    let m = 0;
    if (distance <= cr) {
      if (mk & 1) m = Math.max(m, 1 - ss(0.075, 0.075 + aa, Math.abs(distance - (cr - 0.3))));
      const dash = 1 - ss(3 - aa, 3 + aa, s % 9);
      if (mk & 2) m = Math.max(m, (1 - ss(0.075, 0.075 + aa, distance)) * dash);
      const lanes = (mk >> 5) & 15;
      if (lanes > 0) {
        const ldash = 1 - ss(3 - aa, 3 + aa, s % 13);
        const one = (mk & 16) !== 0;
        const k = one ? lanes + 1 : Math.floor(lanes / 2) + 1;
        const w = (one ? 2 * cr : cr) / k;
        const f = (one ? distance + cr : distance) / w;
        const j = Math.round(f);
        if (j >= 1 && j <= k - 1) m = Math.max(m, (1 - ss(0.06, 0.06 + aa, Math.abs(f - j) * w)) * ldash);
      }
    }
    const wins = rule === "first" ? cover > bestCover : key > best;
    if (wins) {
      best = key;
      bestCover = cover;
      out = m;
    }
  }
  return out;
}

/** the painted samples off every marking's offset from the road's polyline (its pieces' nearest distance) — the rings */
function strayPaint(prims: readonly Prim[], rule: "first" | "deepest", offsets: number[]): number {
  let stray = 0;
  const lo = [Math.min(...prims.map((p) => p.min[0]!)), Math.min(...prims.map((p) => p.min[1]!))];
  const hi = [Math.max(...prims.map((p) => p.max[0]!)), Math.max(...prims.map((p) => p.max[1]!))];
  for (let x = lo[0]!; x <= hi[0]!; x += 0.1)
    for (let y = lo[1]!; y <= hi[1]!; y += 0.1) {
      if (paintModel(prims, [x, y], rule) < 0.5) continue;
      let dl = Infinity;
      for (const p of prims) {
        const d = p.data;
        const lx = d[2]! - d[0]!,
          ly = d[3]! - d[1]!;
        const t = Math.min(1, Math.max(0, ((x - d[0]!) * lx + (y - d[1]!) * ly) / (lx * lx + ly * ly)));
        dl = Math.min(dl, Math.hypot(x - d[0]! - lx * t, y - d[1]! - ly * t));
      }
      if (offsets.every((o) => Math.abs(dl - o) > 0.2)) stray++;
    }
  return stray;
}

test("B2 rings (24 Nov 2026): a curve's markings follow its polyline — the deepest strip wins, not the first met", () => {
  // (a ramp: an arc of 30 m radius in 8 m segments — 15° a bend, each rounded in three pieces of ~1.3 m —, 9 m wide, its edge lines,
  // a dashed centre, two lane lines)
  const segs: RoadSegmentRecord[] = [];
  const R = 30,
    step = 8 / R;
  for (let k = 0; k < 8; k++) {
    const p = (t: number): [number, number] => [R * Math.sin(t), R - R * Math.cos(t)];
    segs.push(seg(p(k * step), p((k + 1) * step), { s0: k * 8, roadId: 7, flags: 0 }));
  }
  const next = segs.map((_, i) => ({ a: i > 0 ? i - 1 : NEXT_NONE, b: i < segs.length - 1 ? i + 1 : NEXT_NONE }));
  const surfaces: SegmentSurface[] = segs.map(() => ({
    flags: SurfaceFlag.EdgeLines | SurfaceFlag.CentreDashed,
    laneLines: 2,
    pavement: 0,
    bridge: 0xff,
  }));
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 37.6, originLon: -122.4 },
    [],
    segs,
    [],
    [],
    0,
    next,
    [],
    surfaces,
  );
  const prims = cellRoadSurfaces(buf, (e, n) => [e, n, 0]);
  // (the bends rounded: three pieces each, short)
  expect(prims.length).toBe(8 + 7 * 3);
  expect(Math.min(...prims.map((p) => Math.hypot(p.data[2]! - p.data[0]!, p.data[3]! - p.data[1]!)))).toBeLessThan(2);
  // (the markings' offsets: edge cr − 0.3, centre 0, the lane line between centre and edge: cr / 2)
  const offsets = [4.5 - 0.3, 0, 4.5 / 2];
  // (positive witness: the old rule — the first met among equals — paints rings, in the emission order and reversed: 7 263 and 7 136
  // stray samples of 1 dm² on 24 Nov 2026, against 0)
  expect(strayPaint(prims, "first", offsets)).toBeGreaterThan(50);
  expect(strayPaint([...prims].reverse(), "first", offsets)).toBeGreaterThan(50);
  // (the rule now: nothing off the markings, whatever the walk's order)
  expect(strayPaint(prims, "deepest", offsets)).toBe(0);
  expect(strayPaint([...prims].reverse(), "deepest", offsets)).toBe(0);
  // (the shader carries that rule — the model above mirrors it)
  const walk = trace.slice(trace.indexOf("fn scenerySurface("), trace.indexOf("fn sceneryMirror("));
  expect(walk).toContain("key=select(half-distance,64.0+crK-distance,distance<=crK);");
  expect(walk).toContain("rank==priority && key>best");
  expect(walk).not.toContain("cover>out.cover");
});
