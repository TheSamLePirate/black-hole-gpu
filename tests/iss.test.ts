import { test, expect } from "bun:test";
import { gunzipSync } from "node:zlib";
import { gameTimeOf, issAxes, issOrbit, issStart, jointAngles, rotAbout, station, type StationJoint } from "../src/system/iss";
import { solarState, M_METRES } from "../src/system/solar";

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// the station's joints as the build wrote them (scripts/build-iss.py)
async function joints(): Promise<StationJoint[]> {
  const buf = gunzipSync(new Uint8Array(await Bun.file("assets/iss/iss-lod0.bin").arrayBuffer()));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const u = new Uint32Array(ab, 0, 6);
  expect(new TextDecoder().decode(new Uint8Array(ab, 0, 4))).toBe("ISS1");
  const f = new Float32Array(ab, 24, u[4]! * 12);
  return Array.from({ length: u[4]! }, (_, k) => ({
    pivot: [f[12 * k]!, f[12 * k + 1]!, f[12 * k + 2]!],
    axis: [f[12 * k + 3]!, f[12 * k + 4]!, f[12 * k + 5]!],
    normal: [f[12 * k + 6]!, f[12 * k + 7]!, f[12 * k + 8]!],
    parent: Math.round(f[12 * k + 9]!),
    kind: Math.round(f[12 * k + 10]!),
  }));
}

test("the model's joints: two alpha joints, eight beta gimbals, two radiator joints", async () => {
  const J = await joints();
  expect(J.filter((j) => j.kind === 1).length).toBe(2);
  expect(J.filter((j) => j.kind === 2).length).toBe(8);
  expect(J.filter((j) => j.kind === 3).length).toBe(2);
  // (the truss along y — starboard —, the masts fore and aft, square to it)
  for (const j of J.filter((q) => q.kind === 2)) {
    expect(Math.abs(j.axis[0])).toBeGreaterThan(0.99);
    expect(Math.abs(dot(j.axis, j.normal))).toBeLessThan(0.05);
  }
});

test("the solar arrays face the Sun wherever it is; the radiators stand edge-on to it", async () => {
  const J = await joints();
  for (let k = 0; k < 200; k++) {
    // a direction all round (a deterministic spread)
    const z = 1 - (2 * (k + 0.5)) / 200,
      r = Math.sqrt(1 - z * z),
      ph = k * 2.399963;
    const sun: V = [r * Math.cos(ph), r * Math.sin(ph), z];
    // (the Sun along the truss: no turn can face it — the masts square to it both ways)
    if (Math.abs(sun[1]) > 0.98) continue;
    const a = jointAngles(J, sun);
    J.forEach((j, i) => {
      if (j.kind === 2) {
        const p = J[j.parent]!;
        // the blanket's normal: its own gimbal's turn, then its alpha joint's
        const n = rotAbout(rotAbout(j.normal, j.axis, a[i]!), p.axis, a[j.parent]!);
        expect(Math.abs(dot(n, sun))).toBeGreaterThan(0.999);
      } else if (j.kind === 3) {
        // (its panels' normal taken square to its axis: in the model it leans 0.4° along it)
        const k = dot(j.normal, j.axis);
        const n0: V = [j.normal[0] - k * j.axis[0], j.normal[1] - k * j.axis[1], j.normal[2] - k * j.axis[2]];
        const n = rotAbout(n0, j.axis, a[i]!);
        expect(Math.abs(dot(n, sun)) / Math.hypot(...n)).toBeLessThan(1e-6);
      }
    });
  }
});

test("the station now: 400 km up, flying +XVV, the Ranger's start 150 m out on IDA-2's axis", () => {
  const t = gameTimeOf(Date.UTC(2026, 9, 1, 12));
  const s = issOrbit(t)!;
  const E = solarState("earth", t);
  const r: V = [s.X[0] - E.pos[0], s.X[1] - E.pos[1], s.X[2] - E.pos[2]];
  const v: V = [s.V[0] - E.vel[0], s.V[1] - E.vel[1], s.V[2] - E.vel[2]];
  const h = (Math.hypot(...r) * M_METRES) / 1e3 - 6371;
  expect(h).toBeGreaterThan(380);
  expect(h).toBeLessThan(450);
  expect(Math.hypot(...v) * 299792.458).toBeCloseTo(7.66, 1);
  const [x, y, z] = issAxes(s.X, s.V, t);
  // (x along the velocity, z to the nadir, y the right hand of both)
  expect(dot(x, v) / Math.hypot(...v)).toBeGreaterThan(0.999);
  expect(dot(z, r) / Math.hypot(...r)).toBeLessThan(-0.999);
  expect(dot(y, [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]])).toBeGreaterThan(0.999);
  const st = issStart(t, 150)!;
  const port = station.ports[0]!;
  const P: V = [0, 1, 2].map((k) => s.X[k]! + (x[k]! * port.centre[0] + y[k]! * port.centre[1] + z[k]! * port.centre[2]) / M_METRES) as V;
  const d = Math.hypot(st.X[0] - P[0], st.X[1] - P[1], st.X[2] - P[2]) * M_METRES;
  expect(d).toBeGreaterThan(140);
  expect(d).toBeLessThan(165);
  expect(dot(st.fwd, x)).toBeGreaterThan(0.999); // (the nose along IDA-2's axis: forward)
});

test("the arrays as drawn (the parts' transforms): every blanket's vertices in a plane facing the Sun", async () => {
  const { partTransforms } = await import("../src/system/iss");
  const J = await joints();
  const buf = gunzipSync(new Uint8Array(await Bun.file("assets/iss/iss-lod0.bin").arrayBuffer()));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const u = new Uint32Array(ab, 0, 6);
  const nv = u[2]!,
    nj = u[4]!,
    np = u[5]!;
  const off = 24 + nj * 48 + np * 32;
  const f32 = new Float32Array(ab, off, (nv * 24) / 4);
  const u8 = new Uint8Array(ab, off, nv * 24);
  for (const sun of [
    [0.3, 0.2, -0.93],
    [-0.8, 0.1, 0.59],
    [0.1, -0.6, 0.79],
  ] as V[]) {
    const l = Math.hypot(...sun);
    const s: V = [sun[0] / l, sun[1] / l, sun[2] / l];
    const T = partTransforms(J, jointAngles(J, s));
    // each beta part's solar-cell vertices (kind 1): their spread along the Sun's direction is the
    // blanket's with its mast canister (2 m) and, on the wings that carry one, its roll-out array's
    // (IROSA: 19 m long on struts above it, canted 10°: 5 m in all); a wing edge-on to the Sun would
    // spread over its 11 m width, or its 35 m length
    for (let p = 0; p < nj; p++) {
      if (J[p]!.kind !== 2) continue;
      const M = T[p + 1]!;
      let lo = Infinity,
        hi = -Infinity,
        n = 0;
      for (let i = 0; i < nv; i++) {
        if (u8[24 * i + 20] !== p + 1 || u8[24 * i + 19] !== 1) continue;
        const x = f32[6 * i]!,
          y = f32[6 * i + 1]!,
          z = f32[6 * i + 2]!;
        const q: V = [0, 1, 2].map((k) => M[0][k]! * x + M[1][k]! * y + M[2][k]! * z + M[3][k]!) as V;
        const d = dot(q, s);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        n++;
      }
      expect(n).toBeGreaterThan(50);
      expect(hi - lo).toBeLessThan(7);
    }
  }
});
