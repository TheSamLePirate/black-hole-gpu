import { describe, expect, test } from "bun:test";
import { MESH } from "../src/game/airtypes";
import {
  foldAngle,
  foldScale,
  GEAR_MAT,
  gearObject,
  gearUniform,
  isGearMat,
  legFold,
  legOfAo,
  mirrorLeg,
  readTrfc,
  trianglesInBoxes,
  type Trfc,
  type V3,
} from "../src/traffic/airliner-gear";

// The traffic's plain airliners' landing gear (scripts/build-traffic-gear.ts — PROBLEMES « le train des avions dessinés sans
// gréement », 24 Nov 2026): baked into assets/traffic/{a320,crj900}.bin from the game's A320, each leg where game/airtypes.ts MESH
// says, the wheels on the ground the traffic is placed on (MESH.wheels), retracted into its bay by its gear position (ship.wgsl
// trafficGearPos — legFold the same).

const load = async (name: string) => readTrfc(await Bun.file(`assets/traffic/${name}.bin`).arrayBuffer());
const legs = (m: Trfc) => {
  const out = [0, 1, 2].map(() => ({ n: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
  let other = Infinity;
  for (let i = 0; i < m.verts.length / 10; i++) {
    const v = m.verts.subarray(10 * i, 10 * i + 10);
    if (!isGearMat(v[6]!)) {
      other = Math.min(other, v[1]!);
      continue;
    }
    const L = out[legOfAo(v[7]!)]!;
    L.n++;
    for (let k = 0; k < 3; k++) {
      L.lo[k] = Math.min(L.lo[k]!, v[k]!);
      L.hi[k] = Math.max(L.hi[k]!, v[k]!);
    }
  }
  return { legs: out, other };
};

describe("the plain airliners' gear: baked, placed, retracted", () => {
  for (const [file, id] of [
    ["a320", "a320t"],
    ["crj900", "crj900"],
  ] as const) {
    test(`${id}: three legs of the four finishes, their wheels on the ground MESH places it on, each hinge over its leg`, async () => {
      const m = await load(file);
      const mats = new Set<number>();
      for (let i = 0; i < m.verts.length / 10; i++) if (isGearMat(m.verts[10 * i + 6]!)) mats.add(m.verts[10 * i + 6]!);
      expect([...mats].sort()).toEqual([GEAR_MAT.paint, GEAR_MAT.chrome, GEAR_MAT.tyre, GEAR_MAT.hub]);
      const { legs: L, other } = legs(m);
      const M = MESH[id];
      // (each leg there: the nose on the axis ahead, the left main at x > 0, the right at x < 0 — mirrored)
      expect(L.every((l) => l.n > 200)).toBe(true);
      expect(Math.abs(L[0]!.lo[0]! + L[0]!.hi[0]!)).toBeLessThan(0.1);
      expect(L[0]!.lo[2]!).toBeGreaterThan(L[1]!.hi[2]!);
      expect(L[1]!.lo[0]!).toBeGreaterThan(0.5);
      expect(L[2]!.hi[0]!).toBeLessThan(-0.5);
      expect(Math.abs(L[1]!.lo[0]! + L[2]!.hi[0]!)).toBeLessThan(0.05);
      // (the mains' wheels on the ground the traffic stands on — its origin MESH.wheels over it —, the nose's within 5 cm of it)
      expect(Math.abs(Math.min(L[1]!.lo[1]!, L[2]!.lo[1]!) + M.wheels)).toBeLessThan(0.02);
      expect(Math.abs(L[0]!.lo[1]! + M.wheels)).toBeLessThan(0.05);
      // (nothing else of the airframe lower than its gear's wheels: the CRJ's stubs of its old gear cut out, the A320's engines over the ground)
      expect(other).toBeGreaterThan(-M.wheels + 0.3);
      if (id === "crj900") expect(other).toBeGreaterThan(-1.2);
      // (each hinge inside its leg's box: over its wheels, not over its top — the nose's drag strut reaches higher —, in plan about its middle)
      const H = [M.gear.nose, M.gear.main, mirrorLeg(M.gear.main)];
      H.forEach((h, k) => {
        expect(h.at[1]).toBeGreaterThan(L[k]!.lo[1]! + 0.8);
        expect(h.at[1]).toBeLessThan(L[k]!.hi[1]! + 0.05);
        expect(Math.abs(h.at[2] - (L[k]!.lo[2]! + L[k]!.hi[2]!) / 2)).toBeLessThan(1.2);
      });
    });
  }

  test("a leg's fold: as built down, its wheels turned towards its bay and shrunk on the way up, a point at 0", () => {
    const M = MESH.a320t.gear;
    const wheelL: V3 = [3.87, -2.7, -0.9];
    const wheelN: V3 = [0, -2.9, 11.2];
    expect(legFold(wheelL, M.main, 1)).toEqual(wheelL);
    expect(foldAngle(1)).toBe(0);
    expect(foldScale(1)).toBe(1);
    // (half up: the left main's wheel inboard and up — under the fuselage, x towards 0 —, the nose's forward and up)
    const l = legFold(wheelL, M.main, 0.3);
    expect(l[0]).toBeLessThan(wheelL[0] - 1);
    expect(l[1]).toBeGreaterThan(wheelL[1] + 1);
    const n = legFold(wheelN, M.nose, 0.3);
    expect(n[2]).toBeGreaterThan(wheelN[2] + 0.5);
    expect(n[1]).toBeGreaterThan(wheelN[1] + 1);
    // (the right main mirrors the left)
    const r = legFold([-wheelL[0], wheelL[1], wheelL[2]], mirrorLeg(M.main), 0.3);
    expect(r[0]).toBeCloseTo(-l[0], 5);
    expect(r[1]).toBeCloseTo(l[1], 5);
    expect(r[2]).toBeCloseTo(l[2], 5);
    // (up: every vertex at its hinge — nothing drawn)
    const up = legFold(wheelL, M.main, 0);
    for (let k = 0; k < 3; k++) expect(up[k]).toBeCloseTo(M.main.at[k]!, 6);
  });

  test("the shader's table: by mesh, by leg, the hinge and the angle up in radians, the axis unit; the right mirrored", () => {
    const U = gearUniform(MESH);
    expect(U.length).toBe(48);
    // (the CRJ's left main: its hinge, −81.11° up)
    expect([...U.subarray(6 * 4 + 8, 6 * 4 + 11)]).toEqual([...MESH.crj900.gear.main.at].map((x) => Math.fround(x)));
    expect(U[6 * 4 + 11]).toBeCloseTo((-81.11 * Math.PI) / 180, 5);
    expect(Math.hypot(U[12]!, U[13]!, U[14]!)).toBeCloseTo(1, 5);
    // (the A320's right main: x mirrored)
    expect(U[16]).toBeCloseTo(-MESH.a320t.gear.main.at[0], 5);
  });

  test("the rig's gear objects: the legs, struts, links and wheels by their leg, not the doors", () => {
    expect(gearObject("NLGFitting")).toBe("nose");
    expect(gearObject("NLGWheels")).toBe("nose");
    expect(gearObject("MLGWheelsL")).toBe("main");
    expect(gearObject("SideStayR2")).toBe("main");
    expect(gearObject("MLGFittingL.Placards")).toBe("main");
    expect(gearObject("MLGGearDoorL")).toBeNull();
    expect(gearObject("NLGForewardDoorR.Inner")).toBeNull();
    expect(gearObject("FlapL1")).toBeNull();
  });

  test("the stubs cut by their parts' boxes: a part wholly inside goes, one crossing out stays", () => {
    // (two triangles: one inside the box, one crossing it)
    const v = (x: number, y: number, z: number) => [x, y, z, 0, 1, 0, 41, 1, 0, 0];
    const m: Trfc = {
      verts: new Float32Array([...v(0, 0, 0), ...v(0.2, 0, 0), ...v(0, 0.2, 0), ...v(0, 0, 5), ...v(3, 0, 5), ...v(0, 0.2, 5)]),
      idx: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    expect([
      ...trianglesInBoxes(m, [
        [
          [-1, -1, -1],
          [1, 1, 6],
        ],
      ]),
    ]).toEqual([1, 0]);
  });
});
