// The A320's rig (src/a320/rig.ts) against FlightGear's animations as SimGear evaluates them
// (scripts/a320/fgrig.py → tests/data/a320-rig.json, scripts/a320/rig-fixture.py): every node's map, for the gear
// down, in transit and up, the flaps and slats out, a spoiler up, the reversers deployed, a door open.
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { nodeValue, parseA320, partCount, rigMatrices, type A320Mesh } from "../src/a320/rig";

const load = async (): Promise<A320Mesh> => {
  const z = new Uint8Array(await Bun.file("assets/a320/a320.bin").arrayBuffer());
  const b = gunzipSync(z);
  return parseA320(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const fixture = async () => (await Bun.file("tests/data/a320-rig.json").json()) as { props: Record<string, number>; maps: number[][] }[];

describe("A320 rig", () => {
  test("the mesh: its size, its parts, its lamps", async () => {
    const m = await load();
    expect(m.hi[0] - m.lo[0]).toBeCloseTo(35.76, 1); // span
    expect(m.hi[2] - m.lo[2]).toBeCloseTo(37.6, 1); // length
    expect(partCount(m)).toBe(m.nodes.length + 1);
    // (every vertex's part a node or the airframe)
    let maxPart = 0;
    for (let i = 0; i < m.verts.length; i += 10) maxPart = Math.max(maxPart, Math.floor(m.verts[i + 7]!));
    expect(maxPart).toBeLessThan(partCount(m));
    expect(m.lamps.filter((l) => l.kind === "beacon")).toHaveLength(2);
  });

  test("every node's map as SimGear's", async () => {
    const m = await load();
    for (const set of await fixture()) {
      const out = rigMatrices(m, set.props, {}, undefined, 6);
      let worst = 0;
      set.maps.forEach((want, i) => {
        for (let k = 0; k < 12; k++) worst = Math.max(worst, Math.abs(out[(i + 1) * 12 + k]! - want[k]!));
      });
      expect(worst).toBeLessThan(1e-3);
    }
  });

  test("the gear's linkages stay joined in transit", async () => {
    const m = await load();
    // (each two-link chain's end — the slave's map on the target's rest centre — on the target's posed centre)
    for (const g of [1, 0.6, 0.3, 0]) {
      const props = { "gear/gear[0]/position-norm": g, "gear/gear[1]/position-norm": g, "gear/gear[2]/position-norm": g };
      const M = rigMatrices(m, props);
      const ap = (j: number, p: number[]) =>
        [0, 1, 2].map(
          (r) => M[j * 12 + r * 4]! * p[0]! + M[j * 12 + r * 4 + 1]! * p[1]! + M[j * 12 + r * 4 + 2]! * p[2]! + M[j * 12 + r * 4 + 3]!,
        );
      m.nodes.forEach((n, i) => {
        if (n.type !== "locked-track" || n.slave! < 0 || n.target! < 0) return;
        const end = ap(n.slave! + 1, n.targetCenter!);
        const tgt = ap(n.target! + 1, n.targetCenter!);
        expect(Math.hypot(end[0]! - tgt[0]!, end[1]! - tgt[1]!, end[2]! - tgt[2]!)).toBeLessThan(0.02);
        void i;
      });
    }
  });

  test("a node's value: its table, its factor", () => {
    expect(
      nodeValue(
        {
          type: "rotate",
          parent: -1,
          objects: [],
          prop: "x",
          table: [
            [0.2, 90],
            [0.8, 0],
          ],
        },
        { x: 0.5 },
      ),
    ).toBeCloseTo(45);
    expect(nodeValue({ type: "rotate", parent: -1, objects: [], prop: "x", factor: -40, offset: 0 }, { x: 0.5 })).toBeCloseTo(-20);
  });
});
