import { describe, expect, test } from "bun:test";
import { runwayFrame } from "../src/game/sites";
import { ALS_CROSS, ALS_LEN, ALS_PLANE, ALS_STEP, alsAxes, alsEnds, alsMesh, alsRunway, geodeticOf } from "../src/world/approach-lights";

// The approach lights' structures (src/world/approach-lights.ts — 25 Nov 2026): at the ends with an ILS of a world runway lit and
// paved (and the game's own), a pylon, a bar and its lamp heads every 30 m out to 900 m before the threshold, the crossbar 300 m out;
// their heads on the light plane, their feet on the ground or the water; each face wound with its normal.

/** SFO's 28L as world/runways3d.ts frames it (the le end 10R, landed the other way: 28L its far end) */
const sfo = () => {
  const f = runwayFrame(
    { body: "earth", name: "KSFO 10R", lat: 37.6263, lon: -122.39312, runway: true, rwy: 117.8, des: ["10R", "28L"], elev: 3 },
    3469,
    30.5,
    16 | 32,
  );
  f.world = { field: "KSFO", measuring: false };
  return f;
};

describe("the approach lights' structures", () => {
  test("which ends: a world runway lit and paved at its ends with an ILS; unlit or unpaved none; the game's own both", () => {
    const f = sfo();
    expect(alsRunway(f)).toBe(true);
    const ends = alsEnds([f], (field, end) => field === "KSFO" && end === "28L");
    expect(ends.map((e) => e.key)).toEqual(["KSFO 10R#1"]);
    expect(alsEnds([f], () => null)).toEqual([]);
    const unlit = { ...f, flags: 16 };
    expect(alsEnds([unlit], () => true)).toEqual([]);
    const grass = { ...f, flags: 16 | 32 | (1 << 1) };
    expect(alsEnds([grass], () => true)).toEqual([]);
    const site = { ...f, flags: 0, world: undefined };
    expect(alsEnds([site], () => false).length).toBe(2);
  });

  test("the far end's frame: its threshold the runway's length along, the landing direction reversed", () => {
    const f = sfo();
    const [e] = alsEnds([f], (_f, end) => end === "28L");
    const A = alsAxes(e!);
    const d = Math.hypot(...A.origin.map((v, i) => v - f.origin[i]!));
    expect(d).toBeCloseTo(3469, 0);
    expect(A.fwd.reduce((s, v, i) => s + v * f.along[i]!, 0)).toBeCloseTo(-1, 6);
    // (right-handed: left × up = the landing direction)
    const [l, u] = [A.left, A.up];
    const c = [l[1] * u[2] - l[2] * u[1], l[2] * u[0] - l[0] * u[2], l[0] * u[1] - l[1] * u[0]];
    expect(c.reduce((s, v, i) => s + v * A.fwd[i]!, 0)).toBeCloseTo(1, 6);
  });

  test("the mesh: thirty units, the crossbar's 21 heads, heads on the plane, feet on the water, every face wound with its normal", () => {
    const f = sfo();
    const [e] = alsEnds([f], (_f, end) => end === "28L");
    // (the bay at the sea's level, 3 m under the runway's)
    const m = alsMesh(e!, () => -2);
    const n = m.verts.length / 10;
    let heads = 0,
      minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = m.verts[10 * i + 1]!,
        z = m.verts[10 * i + 2]!;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      expect(m.verts[10 * i + 6]).toBe(90);
    }
    for (let i = 0; i < m.verts.length; i += 10) if (Math.abs(m.verts[i + 8]! - (31 + 256 * 31)) < 0.5) heads++;
    // (the water under them: 3 m + the plane's half metre below; the heads 0.28 m over the plane's bar at 0.4 over… the plane)
    expect(minY).toBeCloseTo(-(f.elev + ALS_PLANE), 1);
    expect(maxY).toBeLessThan(0.8);
    expect(maxZ).toBeLessThan(-ALS_STEP + 1);
    expect(minZ).toBeGreaterThan(-ALS_LEN - 1);
    // (29 barrettes of 5 heads, the crossbar's 21: 166 heads of 24 vertices)
    expect(heads / 24).toBe(29 * 5 + 21);
    expect(ALS_CROSS % ALS_STEP).toBe(0);
    let bad = 0;
    for (let t = 0; t < m.idx.length; t += 3) {
      const [a, b, c] = [m.idx[t]!, m.idx[t + 1]!, m.idx[t + 2]!].map((k) => k * 10);
      const e1 = [0, 1, 2].map((k) => m.verts[b! + k]! - m.verts[a! + k]!);
      const e2 = [0, 1, 2].map((k) => m.verts[c! + k]! - m.verts[a! + k]!);
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      if (cr[0]! * m.verts[a! + 3]! + cr[1]! * m.verts[a! + 4]! + cr[2]! * m.verts[a! + 5]! <= 0) bad++;
    }
    expect(bad).toBe(0);
    expect(m.tris).toBeLessThan(4000);
    // (its threshold on the ellipsoid where SFO's 28L is)
    const g = geodeticOf(alsAxes(e!).origin);
    expect(g.lat).toBeCloseTo(37.6, 1);
  });

  test("a ground over the light plane: the heads lifted over it, nothing under the ground", () => {
    const f = sfo();
    const [e] = alsEnds([f], (_f, end) => end === "28L");
    const m = alsMesh(e!, () => f.elev + 5);
    let minY = Infinity;
    for (let i = 1; i < m.verts.length; i += 10) minY = Math.min(minY, m.verts[i]!);
    // (the ground 4.5 m over the plane: the stands from it, the bars 0.4 m over it — nothing under it, nothing on the plane)
    expect(minY).toBeGreaterThanOrEqual(4.5 - 1e-5);
  });
});
