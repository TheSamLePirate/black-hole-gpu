// The air-to-air refuelling's meshes (src/game/aar.ts), in the craft's mesh format for ship.ts ("TRFC", as the traffic's —
// scripts/build-airliners.ts): the tanker (the A320's mesh painted a military grey — ship.wgsl material 43 — with
// two hose-and-drogue pods under its wings, as an A330 MRTT's or a Voyager's: their pylons, their ram-air turbines);
// the hose and its drogue (its origin the pod's tail, the hose trailing along −z: the basket's coupling at
// `AAR.hose` back, its canopy behind it), drawn as its own instance so the reel takes it in as a probe pushes the
// basket forward; the F-35's refuelling probe (the F-35B's and C's, on the right of the forward fuselage — its
// tip where the basket is met); the pods' lights (red, amber, green — each its own mesh, the one lit drawn).
//   bun scripts/build-tanker.ts
// Every part is flat (ship.wgsl material 90: its sRGB colour packed in its UV, 91 the same glowing), but the
// A320's own skin (40 → 43).

import { AAR } from "../src/game/aar";

const out = "assets/traffic";
type V3 = [number, number, number];

interface Mesh {
  pos: number[];
  nrm: number[];
  uv: number[];
  part: number[];
  idx: number[];
}
const mesh = (): Mesh => ({ pos: [], nrm: [], uv: [], part: [], idx: [] });

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(...a);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A flat colour (sRGB 0–255) as material 90's UV (ship.wgsl: r + 256 g in u, b / 255 in v). */
const flat = (r: number, g: number, b: number): [number, number] => [r + 256 * g, b / 255];

function vert(m: Mesh, p: V3, n: V3, part: number, uv: [number, number]) {
  m.pos.push(...p);
  m.nrm.push(...unit(n));
  m.uv.push(...uv);
  m.part.push(part);
  return m.pos.length / 3 - 1;
}

/**
 * A surface of revolution along `a` → `b`: its profile `prof` (t along 0…1, its radius [m]), `seg` sides; closed
 * at its ends when their radius is not nil (a disc); seen from both sides when `twoSided` (the basket's canopy).
 */
function lathe(m: Mesh, a: V3, b: V3, prof: [number, number][], seg: number, part: number, uv: [number, number], twoSided = false) {
  const ax = unit(sub(b, a));
  const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross(ax, ref));
  const w = cross(ax, u);
  const L = len(sub(b, a));
  const ring = (t: number, r: number, dr: number, flip: boolean) => {
    const out: number[] = [];
    const c = add(a, mul(ax, t * L));
    for (let k = 0; k <= seg; k++) {
      const th = (2 * Math.PI * k) / seg;
      const d = add(mul(u, Math.cos(th)), mul(w, Math.sin(th)));
      // (the normal: out of the surface, leaning with its slope)
      const n = unit(add(d, mul(ax, -dr)));
      out.push(vert(m, add(c, mul(d, r)), flip ? mul(n, -1) : n, part, uv));
    }
    return out;
  };
  for (const flip of twoSided ? [false, true] : [false]) {
    const rings = prof.map(([t, r], i) => {
      const [t0, r0] = prof[Math.max(i - 1, 0)]!;
      const [t1, r1] = prof[Math.min(i + 1, prof.length - 1)]!;
      return ring(t, r, (r1 - r0) / Math.max((t1 - t0) * L, 1e-6), flip);
    });
    for (let i = 0; i + 1 < rings.length; i++)
      for (let k = 0; k < seg; k++) {
        const p = rings[i]!,
          q = rings[i + 1]!;
        if (flip) m.idx.push(p[k]!, p[k + 1]!, q[k]!, p[k + 1]!, q[k + 1]!, q[k]!);
        else m.idx.push(p[k]!, q[k]!, p[k + 1]!, p[k + 1]!, q[k]!, q[k + 1]!);
      }
  }
  // (the ends: a disc where the radius is not nil)
  for (const [t, r, sgn] of [
    [prof[0]![0], prof[0]![1], -1],
    [prof[prof.length - 1]![0], prof[prof.length - 1]![1], 1],
  ] as const) {
    if (r < 1e-4 || twoSided) continue;
    const c = add(a, mul(ax, t * L));
    const n = mul(ax, sgn);
    const mid = vert(m, c, n, part, uv);
    const rim: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const th = (2 * Math.PI * k) / seg;
      rim.push(vert(m, add(c, mul(add(mul(u, Math.cos(th)), mul(w, Math.sin(th))), r)), n, part, uv));
    }
    for (let k = 0; k < seg; k++) sgn > 0 ? m.idx.push(mid, rim[k]!, rim[k + 1]!) : m.idx.push(mid, rim[k + 1]!, rim[k]!);
  }
}

/** A box between two corners (the pylons): its six faces. */
function box(m: Mesh, lo: V3, hi: V3, part: number, uv: [number, number]) {
  const faces: [V3, V3, V3][] = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ];
  const c = mul(add(lo, hi), 0.5);
  const h = mul(sub(hi, lo), 0.5);
  for (const [n, s, t] of faces) {
    const corner = (i: number, j: number): V3 =>
      [0, 1, 2].map((k) => c[k]! + h[k]! * (n[k]! + (i ? 1 : -1) * s[k]! + (j ? 1 : -1) * t[k]!)) as V3;
    const q = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)].map((p) => vert(m, p, n, part, uv));
    m.idx.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!);
  }
}

/** A wing-like plate (the ram-air turbine's blades, the pylon's fairing): a thin box along `a` → `b`. */
function blade(m: Mesh, a: V3, b: V3, chord: V3, thick: number, part: number, uv: [number, number]) {
  const ax = sub(b, a);
  const n = unit(cross(ax, chord));
  const corners: V3[] = [a, add(a, chord), add(b, chord), b];
  const quad = (o: V3, nn: V3, rev: boolean) => {
    const q = corners.map((p) => vert(m, add(p, o), nn, part, uv));
    if (rev) m.idx.push(q[0]!, q[2]!, q[1]!, q[0]!, q[3]!, q[2]!);
    else m.idx.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!);
  };
  quad(mul(n, thick / 2), n, false);
  quad(mul(n, -thick / 2), mul(n, -1), true);
}

function write(name: string, m: Mesh) {
  const nv = m.pos.length / 3,
    ni = m.idx.length;
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, m.pos[3 * i + k]!);
      hi[k] = Math.max(hi[k]!, m.pos[3 * i + k]!);
    }
  const buf = new ArrayBuffer(40 + nv * 40 + ni * 4);
  new Uint8Array(buf, 0, 4).set(new TextEncoder().encode("TRFC"));
  const u = new Uint32Array(buf, 0, 4);
  u[1] = 1;
  u[2] = nv;
  u[3] = ni;
  new Float32Array(buf, 16, 6).set([...lo, ...hi]);
  const v = new Float32Array(buf, 40, nv * 10);
  for (let i = 0; i < nv; i++)
    v.set(
      [
        m.pos[3 * i]!,
        m.pos[3 * i + 1]!,
        m.pos[3 * i + 2]!,
        m.nrm[3 * i]!,
        m.nrm[3 * i + 1]!,
        m.nrm[3 * i + 2]!,
        m.part[i]!,
        1,
        m.uv[2 * i]!,
        m.uv[2 * i + 1]!,
      ],
      i * 10,
    );
  new Uint32Array(buf, 40 + nv * 40, ni).set(m.idx);
  return Bun.write(`${out}/${name}.bin`, buf).then(() =>
    console.log(
      `${name}: ${nv} vertices, ${ni / 3} triangles, ${(hi[0]! - lo[0]!).toFixed(1)} × ${(hi[1]! - lo[1]!).toFixed(1)} × ${(hi[2]! - lo[2]!).toFixed(1)} m`,
    ),
  );
}

// ---- the tanker: the A320's mesh, its skin grey (43), the pods added
const GREY = flat(118, 122, 126);
const DARK = flat(40, 42, 45);
const tanker = mesh();
{
  const buf = await Bun.file(`${out}/a320.bin`).arrayBuffer();
  const u = new Uint32Array(buf, 0, 4);
  const nv = u[2]!,
    ni = u[3]!;
  const v = new Float32Array(buf, 40, nv * 10);
  for (let i = 0; i < nv; i++) {
    const o = i * 10;
    tanker.pos.push(v[o]!, v[o + 1]!, v[o + 2]!);
    tanker.nrm.push(v[o + 3]!, v[o + 4]!, v[o + 5]!);
    tanker.part.push(v[o + 6] === 40 ? 43 : v[o + 6]!);
    tanker.uv.push(v[o + 8]!, v[o + 9]!);
  }
  tanker.idx.push(...new Uint32Array(buf, 40 + nv * 40, ni));
}
for (const side of [1, -1]) {
  const P = AAR.pod;
  const x = side * P.x;
  // (the pod: a body of revolution — a rounded nose, its ram-air turbine ahead, a tapered tail with the hose's exit)
  const nose: V3 = [x, P.y, P.z + P.len / 2];
  const tail: V3 = [x, P.y, P.z - P.len / 2];
  lathe(
    tanker,
    tail,
    nose,
    [
      [0, 0.16],
      [0.12, 0.26],
      [0.3, P.r],
      [0.8, P.r],
      [0.93, 0.27],
      [1, 0.08],
    ],
    20,
    90,
    GREY,
  );
  // (the hose's exit: a dark ring at the tail)
  lathe(
    tanker,
    add(tail, [0, 0, -0.05]),
    add(tail, [0, 0, 0.02]),
    [
      [0, 0.15],
      [1, 0.15],
    ],
    16,
    90,
    DARK,
  );
  // (the ram-air turbine: its hub and four blades)
  const hub = add(nose, [0, 0, 0.12]);
  lathe(
    tanker,
    add(nose, [0, 0, -0.05]),
    add(hub, [0, 0, 0.12]),
    [
      [0, 0.07],
      [0.6, 0.07],
      [1, 0],
    ],
    12,
    90,
    DARK,
  );
  for (let k = 0; k < 4; k++) {
    const th = (k * Math.PI) / 2 + 0.4;
    const d: V3 = [Math.cos(th), Math.sin(th), 0];
    blade(tanker, add(hub, mul(d, 0.06)), add(hub, mul(d, 0.42)), [0, 0, -0.07], 0.012, 90, DARK);
  }
  // (the pylon: from the wing's underside to the pod's back)
  box(tanker, [x - 0.07, P.y + P.r * 0.6, P.z - 0.9], [x + 0.07, P.wingY + 0.15, P.z + 0.6], 90, GREY);
}
await write("mrtt", tanker);

// ---- the hose and its drogue: the hose from the pod's tail back along −z, the coupling, the basket's canopy
const drogue = mesh();
{
  const L = AAR.hose;
  const RUBBER = flat(26, 26, 28);
  const STEEL = flat(150, 152, 156);
  const CANVAS = flat(205, 203, 196);
  lathe(
    drogue,
    [0, 0, 0],
    [0, 0, -L],
    [
      [0, 0.065],
      [1, 0.065],
    ],
    10,
    90,
    RUBBER,
  );
  // (the coupling: where the probe's nozzle locks — its throat at −L − 0.25)
  lathe(
    drogue,
    [0, 0, -L],
    [0, 0, -L - 0.55],
    [
      [0, 0.09],
      [0.2, 0.14],
      [0.8, 0.14],
      [1, 0.17],
    ],
    18,
    90,
    STEEL,
  );
  // (the canopy: a cone of cloth opening backwards, seen from both sides; its rim; its struts)
  const B = AAR.basket;
  lathe(
    drogue,
    [0, 0, -L - 0.5],
    [0, 0, -L - 0.5 - B.depth],
    [
      [0, 0.17],
      [0.35, 0.34],
      [0.75, B.r - 0.04],
      [1, B.r],
    ],
    24,
    90,
    CANVAS,
    true,
  );
  lathe(
    drogue,
    [0, 0, -L - 0.48 - B.depth],
    [0, 0, -L - 0.55 - B.depth],
    [
      [0, B.r + 0.03],
      [1, B.r + 0.03],
    ],
    24,
    90,
    RUBBER,
    true,
  );
  for (let k = 0; k < 12; k++) {
    const th = (2 * Math.PI * k) / 12;
    const d: V3 = [Math.cos(th), Math.sin(th), 0];
    lathe(
      drogue,
      add([0, 0, -L - 0.5], mul(d, 0.18)),
      add([0, 0, -L - 0.52 - B.depth], mul(d, B.r)),
      [
        [0, 0.012],
        [1, 0.012],
      ],
      4,
      90,
      STEEL,
    );
  }
}
await write("drogue", drogue);

// ---- the F-35's probe: from its door on the right of the forward fuselage, out and ahead to its nozzle
const probe = mesh();
{
  const [b, t] = [AAR.probe.base, AAR.probe.tip];
  const METAL = flat(96, 99, 104);
  const ax = unit(sub(t, b));
  lathe(
    probe,
    b,
    sub(t, mul(ax, 0.22)),
    [
      [0, 0.07],
      [0.15, 0.058],
      [1, 0.052],
    ],
    12,
    90,
    METAL,
  );
  lathe(
    probe,
    sub(t, mul(ax, 0.22)),
    t,
    [
      [0, 0.06],
      [0.5, 0.078],
      [0.85, 0.07],
      [1, 0.03],
    ],
    12,
    90,
    flat(170, 172, 176),
  );
  // (its door, open beside it)
  blade(probe, add(b, [0.03, 0.05, -0.15]), add(b, [0.03, 0.05, 0.95]), [0.02, 0.22, 0], 0.015, 90, GREY);
}
await write("probe", probe);

// ---- the pod's lights: red (stop), amber (ready), green (fuel flowing) — on the pod's tail, each its own mesh
const LAMPS: [string, [number, number, number]][] = [
  ["lamp-red", [255, 40, 30]],
  ["lamp-amber", [255, 170, 30]],
  ["lamp-green", [40, 255, 90]],
];
for (const [i, [name, rgb]] of LAMPS.entries()) {
  const m = mesh();
  // (in the drogue's frame — the pod's tail —: below it, one above the other — red on top)
  const y = -AAR.pod.r - 0.06 - 0.13 * i;
  lathe(
    m,
    [0, y, 0.25],
    [0, y, 0.05],
    [
      [0, 0.045],
      [1, 0.045],
    ],
    10,
    91,
    flat(...rgb),
  );
  await write(name, m);
}
