import { beforeAll, describe, expect, test } from "bun:test";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { gunzipSync } from "node:zlib";
import { parseA320 } from "../src/a320/rig";
import { buildLods, groupOf, type LodLevel, pickLod, type Simplify } from "../src/ship-lod";

// The traffic's levels of detail (src/ship-lod.ts — perf lot of 25 Nov 2026): the plain airliners', the container ship's and the rigged
// A320's meshes simplified by material, coarser and coarser, each level's triangles over the mesh's own vertices, every triangle within one
// material and one moving part (a gear leg, a rig's node), the A320's opaque triangles first and its glass after; the level drawn the
// coarsest under half a pixel.

const simplify: Simplify = (ix, pos, e, prune) =>
  MeshoptSimplifier.simplify(ix, pos, 3, 0, e, prune ? ["LockBorder", "ErrorAbsolute", "Prune"] : ["LockBorder", "ErrorAbsolute"]);

async function trafficMesh(name: string) {
  const buf = await Bun.file(`assets/traffic/${name}.bin`).arrayBuffer();
  expect(new TextDecoder().decode(new Uint8Array(buf, 0, 4))).toBe("TRFC");
  const u = new Uint32Array(buf, 0, 4);
  const nv = u[2]!,
    ni = u[3]!;
  return { verts: new Float32Array(buf, 40, nv * 10), idx: new Uint32Array(buf, 40 + nv * 40, ni), nv };
}

const group = (verts: Float32Array, v: number) => groupOf(verts, v);

/** each level checked: indices in range, coarser than the one before, its error growing, every triangle within one group, its opaque
 *  triangles first (none of the glass's before `solid`, none of the opaque's after) */
function checkLevels(name: string, verts: Float32Array, idx: Uint32Array, nv: number, lods: LodLevel[], glass?: (v: number) => boolean) {
  let last = idx.length / 3;
  let lastErr = 0;
  for (const l of lods) {
    expect(l.idx.length % 3).toBe(0);
    expect(l.idx.length / 3).toBeLessThanOrEqual(0.75 * last);
    expect(l.error).toBeGreaterThanOrEqual(lastErr);
    for (let i = 0; i < l.idx.length; i++) if (l.idx[i]! >= nv) throw new Error(`${name}: index ${i} out of range`);
    for (let t = 0; t < l.idx.length / 3; t++) {
      const g = group(verts, l.idx[3 * t]!);
      if (group(verts, l.idx[3 * t + 1]!) !== g || group(verts, l.idx[3 * t + 2]!) !== g)
        throw new Error(`${name}: triangle ${t} spans groups`);
      if (glass && glass(l.idx[3 * t]!) !== 3 * t >= l.solid) throw new Error(`${name}: triangle ${t} on the wrong side of solid`);
    }
    last = l.idx.length / 3;
    lastErr = l.error;
  }
}

describe("the traffic's levels of detail", () => {
  beforeAll(async () => {
    await MeshoptSimplifier.ready;
  });

  for (const name of ["a320", "crj900", "cargo"])
    test(`${name}: coarser levels, each over the mesh's vertices, every triangle within one material`, async () => {
      const { verts, idx, nv } = await trafficMesh(name);
      const t0 = performance.now();
      const lods: LodLevel[] = buildLods(verts, idx, simplify);
      const ms = performance.now() - t0;
      console.log(
        `  ${name}: ${idx.length / 3} triangles → ${lods.map((l) => `${l.idx.length / 3} (${(l.error * 100).toFixed(1)} cm)`).join(", ")} in ${ms.toFixed(0)} ms`,
      );
      expect(lods.length).toBeGreaterThanOrEqual(2);
      checkLevels(name, verts, idx, nv, lods);
      for (const l of lods) expect(l.solid).toBe(l.idx.length);
      // (the coarsest under 40 % of the whole — the container ship, its boxes already minimal, 32 % at 10 m; the airliners 4–16 %)
      expect(lods.at(-1)!.idx.length).toBeLessThan(0.4 * idx.length);
    });

  test("the rigged A320: its parts apart, its glass after its opaque triangles", async () => {
    let b: Uint8Array = new Uint8Array(await Bun.file("assets/a320/a320.bin").arrayBuffer());
    if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
    const m = parseA320(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const glass = (v: number) => {
      const k = Math.round(m.verts[10 * v + 6]!);
      return (k >= 106 && k <= 109) || k === 115;
    };
    // (as ship.ts loadA320 orders them: the opaque triangles first)
    const idx = new Uint32Array(m.idx.length);
    let o = 0,
      solid = 0;
    for (const g of [false, true])
      for (let t = 0; t < m.idx.length / 3; t++)
        if (glass(m.idx[3 * t]!) === g) {
          idx.set(m.idx.subarray(3 * t, 3 * t + 3), 3 * o++);
          if (!g) solid = 3 * o;
        }
    const t0 = performance.now();
    const lods = buildLods(m.verts, idx, simplify, solid);
    console.log(
      `  a320 (rigged): ${idx.length / 3} triangles → ${lods.map((l) => `${l.idx.length / 3} (${(l.error * 100).toFixed(1)} cm)`).join(", ")} in ${(performance.now() - t0).toFixed(0)} ms`,
    );
    expect(lods.length).toBeGreaterThanOrEqual(2);
    checkLevels("a320", m.verts, idx, m.verts.length / 10, lods, glass);
  });

  test("the level drawn: the coarsest whose error stays under the pixels allowed", () => {
    const e = [0.04, 0.16, 0.64, 2.56];
    // (an airliner 200 m off on a 750 px image at 50°: ~2 px a metre — 0.16 m is 0.32 px)
    expect(pickLod(e, 2, 0.5)).toBe(1);
    expect(pickLod(e, 0.05, 0.5)).toBe(3);
    expect(pickLod(e, 50, 0.5)).toBe(-1);
    expect(pickLod([], 1, 0.5)).toBe(-1);
  });
});
