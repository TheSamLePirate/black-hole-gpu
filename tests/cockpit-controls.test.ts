import { expect, test } from "bun:test";
import {
  CONTROLS,
  MAX_CONTROLS,
  PANELS,
  PART,
  POSE_VEC4,
  controlBox,
  controlFrame,
  controlMesh,
  controlPose,
  panelFrame,
  poseData,
  rayBox,
} from "../src/cockpit/controls";

// PLAN-COCKPIT K1: the cockpit's controls — their panels' frames, their generated mesh (the cabin's vertex
// layout, material 73), their moving parts' poses, the pointer's boxes.

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("the panels' frames: orthonormal, a to the pilot's right (−x), b up, n towards the pilot", () => {
  for (const P of Object.values(PANELS)) {
    const { a, b, n } = panelFrame(P);
    for (const v of [a, b, n]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    expect(Math.abs(dot(a, b)) + Math.abs(dot(b, n)) + Math.abs(dot(a, n))).toBeLessThan(1e-9);
    // (the ship's x is to the pilot's left; the pilot sits behind the dashboard: −z of it)
    expect(a[0]).toBeLessThan(-0.9);
    expect(b[1]).toBeGreaterThan(0.5);
    expect(n[2]).toBeLessThan(-0.5);
  }
});

test("the mesh: the cabin's layout, every index in range, normals unit, each vertex's control and part", () => {
  const { verts, idx } = controlMesh();
  const nv = verts.length / 10;
  expect(verts.length % 10).toBe(0);
  expect(idx.length % 3).toBe(0);
  for (const i of idx) expect(i).toBeLessThan(nv);
  const seen = new Set<number>();
  for (let v = 0; v < nv; v++) {
    expect(verts[10 * v + 6]).toBe(73);
    expect(Math.hypot(verts[10 * v + 3]!, verts[10 * v + 4]!, verts[10 * v + 5]!)).toBeCloseTo(1, 5);
    const k = Math.floor(verts[10 * v + 8]! + 0.002),
      part = Math.floor(verts[10 * v + 9]! + 0.002);
    expect(k).toBeLessThan(CONTROLS.length);
    expect(part).toBeLessThanOrEqual(PART.placard);
    // (a placard's place within its cell: 0…0.9)
    expect(verts[10 * v + 8]! - k).toBeLessThanOrEqual(0.9 + 1e-6);
    seen.add(k);
  }
  expect(seen.size).toBe(CONTROLS.length);
  expect(CONTROLS.length).toBeLessThanOrEqual(MAX_CONTROLS);
  // (the triangles wound counter-clockwise seen from their normal: the cabin's pipeline culls the back)
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const p = [0, 1, 2].map((j) => [0, 1, 2].map((c) => verts[10 * idx[t + j]! + c]!) as V3);
    const e1 = [0, 1, 2].map((c) => p[1]![c]! - p[0]![c]!) as V3,
      e2 = [0, 1, 2].map((c) => p[2]![c]! - p[0]![c]!) as V3;
    const cr: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const n = [3, 4, 5].map((c) => verts[10 * idx[t]! + c]!) as V3;
    if (Math.hypot(...cr) > 1e-12 && dot(cr, n) < 0) bad++;
  }
  expect(bad).toBe(0);
});

test("the controls apart: no two boxes overlap on a panel; each on its panel", () => {
  for (const c of CONTROLS) {
    const { o } = controlFrame(c);
    const P = PANELS[c.panel];
    // (its base on the panel's plane)
    expect(Math.abs(dot([o[0] - P.o[0], o[1] - P.o[1], o[2] - P.o[2]], P.n))).toBeLessThan(1e-9);
  }
  for (let i = 0; i < CONTROLS.length; i++)
    for (let j = i + 1; j < CONTROLS.length; j++) {
      const A = CONTROLS[i]!,
        B = CONTROLS[j]!;
      if (A.panel !== B.panel) continue;
      const ha = controlBox(A).half,
        hb = controlBox(B).half;
      const apart =
        Math.abs(A.at[0] - B.at[0]) >= ha[0] + hb[0] - 1e-9 ||
        Math.abs(A.at[1] - B.at[1]) >= Math.min(ha[1], 0.03) + Math.min(hb[1], 0.03) - 1e-9;
      expect(apart).toBe(true);
    }
});

test("the poses: a lever across its swing, the knob's 270°, a button pushed in; the uniform's layout", () => {
  const gear = CONTROLS.find((c) => c.id === "gear")!;
  expect(controlPose(gear, { pos: 0 }).angle).toBeCloseTo(gear.swing![0], 9);
  expect(controlPose(gear, { pos: 1 }).angle).toBeCloseTo(gear.swing![1], 9);
  // (up: the arm's tip up the panel)
  expect(controlPose(gear, { pos: 0 }).angle).toBeGreaterThan(0);
  const dim = CONTROLS.find((c) => c.id === "dimmer")!;
  expect(controlPose(dim, { pos: 1 }).angle - controlPose(dim, { pos: 0 }).angle).toBeCloseTo((270 * Math.PI) / 180, 9);
  const sas = CONTROLS.find((c) => c.id === "sas")!;
  expect(controlPose(sas, { pos: 0, pressed: true }).push).toBeLessThan(0);
  const k = CONTROLS.indexOf(sas);
  const u = poseData({ sas: { pos: 0, lit: 1, hover: true } });
  expect(u.length).toBe(MAX_CONTROLS * POSE_VEC4 * 4);
  // (the lamp: green × lit; the hover)
  expect(u[k * 16 + 13]).toBeCloseTo(1, 6);
  expect(u[k * 16 + 15]).toBe(1);
});

test("the pointer's boxes: a ray at a control's centre hits it; one beside it misses", () => {
  for (const c of CONTROLS) {
    const B = controlBox(c);
    const eye: V3 = [1.0, 1.45, 3.1];
    const d0 = [B.c[0] - eye[0], B.c[1] - eye[1], B.c[2] - eye[2]] as V3;
    const l = Math.hypot(...d0);
    const d = d0.map((x) => x / l) as V3;
    const t = rayBox(eye, d, B);
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(l);
    const off = B.axes[0].map((x, i) => B.c[i]! + x * 0.2 - eye[i]!) as V3;
    const lo = Math.hypot(...off);
    expect(rayBox(eye, off.map((x) => x / lo) as V3, B)).toBeNull();
  }
});
