// The missiles' meshes (src/game/missile-models.ts), in the craft's mesh format for ship.ts ("TRFC", as the traffic's —
// scripts/build-tanker.ts): the AIM-120C, the AIM-9X, the 9M38 (SA-11) and the JSM — procedural (no licence to carry): their
// bodies lathed (the radome's ogive, the IR dome, the boat-tail, the nozzle), their wings and fins closed plates, their
// markings (a live warhead's yellow band, a live motor's brown one) rings of paint, their rail lugs.
//   bun scripts/build-missiles.ts
// Materials (ship.wgsl): 92 the body's paint (its sRGB colour packed in the UV, as 90), 93–96 the control fins k = 0…3 (the
// same paint, turned about their hinge by the deflection the renderer gives), 97 the seeker's dome (glass), 98 the nozzle.

import { MISSILE_SHAPES, type MissileMeshId } from "../src/game/missile-models";

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
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A flat colour (sRGB 0–255) as material 90's — and 92's — UV (ship.wgsl: r + 256 g in u, b / 255 in v). */
const flat = (r: number, g: number, b: number): [number, number] => [r + 256 * g, b / 255];

function vert(m: Mesh, p: V3, n: V3, part: number, uv: [number, number]) {
  m.pos.push(...p);
  m.nrm.push(...unit(n));
  m.uv.push(...uv);
  m.part.push(part);
  return m.pos.length / 3 - 1;
}

/**
 * A surface of revolution about z from z0 to z1: its profile (t along 0…1, its radius [m]), `seg` sides (6: the JSM's facets,
 * flat-shaded), closed at its ends where the radius is not nil. Its triangles counter-clockwise seen from outside (the pass's
 * front faces: wound the other way, its far inside wall and its end discs were what showed — 6 Nov 2026).
 */
function lathe(m: Mesh, z0: number, z1: number, prof: [number, number][], seg: number, part: number, uv: [number, number], facets = false) {
  const L = z1 - z0;
  const dir = (th: number): V3 => [Math.cos(th), Math.sin(th), 0];
  const rings: number[][] = [];
  prof.forEach(([t, r], i) => {
    const [t0, r0] = prof[Math.max(i - 1, 0)]!;
    const [t1, r1] = prof[Math.min(i + 1, prof.length - 1)]!;
    const dr = (r1 - r0) / Math.max((t1 - t0) * L, 1e-6);
    const ring: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const th = (2 * Math.PI * k) / seg + (facets ? Math.PI / seg : 0);
      const d = dir(th);
      ring.push(vert(m, [d[0] * r, d[1] * r, z0 + t * L], add(d, [0, 0, -dr]), part, uv));
    }
    rings.push(ring);
  });
  for (let i = 0; i + 1 < rings.length; i++)
    for (let k = 0; k < seg; k++) {
      const p = rings[i]!,
        q = rings[i + 1]!;
      if (facets) {
        // (a facet flat: its own four corners, its own normal)
        const P = [p[k]!, q[k]!, p[k + 1]!, q[k + 1]!].map((j) => [m.pos[3 * j]!, m.pos[3 * j + 1]!, m.pos[3 * j + 2]!] as V3);
        const mid = (2 * Math.PI * (k + 0.5)) / seg + Math.PI / seg;
        const n = unit(add(dir(mid), [0, 0, -(prof[i + 1]![1] - prof[i]![1]) / Math.max((prof[i + 1]![0] - prof[i]![0]) * L, 1e-6)]));
        const c = P.map((x) => vert(m, x, n, part, uv));
        m.idx.push(c[0]!, c[2]!, c[1]!, c[2]!, c[3]!, c[1]!);
      } else m.idx.push(p[k]!, p[k + 1]!, q[k]!, p[k + 1]!, q[k + 1]!, q[k]!);
    }
  for (const [t, r, sgn] of [
    [prof[0]![0], prof[0]![1], -1],
    [prof[prof.length - 1]![0], prof[prof.length - 1]![1], 1],
  ] as const) {
    if (r < 1e-4) continue;
    const c: V3 = [0, 0, z0 + t * L];
    const n: V3 = [0, 0, sgn];
    const mid = vert(m, c, n, part, uv);
    const rim: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const d = dir((2 * Math.PI * k) / seg + (facets ? Math.PI / seg : 0));
      rim.push(vert(m, [d[0] * r, d[1] * r, c[2]], n, part, uv));
    }
    for (let k = 0; k < seg; k++) sgn > 0 ? m.idx.push(mid, rim[k]!, rim[k + 1]!) : m.idx.push(mid, rim[k + 1]!, rim[k]!);
  }
}

/** a quad, its triangles both ways (seen from either side whatever the pass's culling): corners in order, its normal */
function quad(m: Mesh, q: V3[], n: V3, part: number, uv: [number, number]) {
  const a = q.map((p) => vert(m, p, n, part, uv));
  const b = q.map((p) => vert(m, p, mul(n, -1), part, uv));
  m.idx.push(a[0]!, a[1]!, a[2]!, a[0]!, a[2]!, a[3]!);
  m.idx.push(b[0]!, b[2]!, b[1]!, b[0]!, b[3]!, b[2]!);
}

/**
 * A wing or a fin at roll `roll` about z: a closed plate from the body (radius r0) out `span`, its root from zLE to zTE, its
 * tip from tLE to tTE; `thick` [m], thinning to 60 % at the tip; its edges closed.
 */
function plate(
  m: Mesh,
  roll: number,
  r0: number,
  span: number,
  zLE: number,
  zTE: number,
  tLE: number,
  tTE: number,
  thick: number,
  part: number,
  uv: [number, number],
) {
  const d: V3 = [Math.cos(roll), Math.sin(roll), 0];
  const n: V3 = [-Math.sin(roll), Math.cos(roll), 0];
  const at = (r: number, z: number, side: number, tip: boolean): V3 =>
    add(add(mul(d, r), [0, 0, z]), mul(n, (side * thick * (tip ? 0.6 : 1)) / 2));
  const R1 = r0 + span;
  const top = [at(r0, zLE, 1, false), at(r0, zTE, 1, false), at(R1, tTE, 1, true), at(R1, tLE, 1, true)];
  const bot = [at(r0, zLE, -1, false), at(r0, zTE, -1, false), at(R1, tTE, -1, true), at(R1, tLE, -1, true)];
  quad(m, top, n, part, uv);
  quad(m, bot, mul(n, -1), part, uv);
  // (the edges: the leading, the tip, the trailing — each its outward normal)
  const cen = mul(add(add(top[0]!, top[2]!), add(bot[0]!, bot[2]!)), 0.25);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const e = [top[i]!, top[j]!, bot[j]!, bot[i]!];
    let s = unit(cross(sub(top[j]!, top[i]!), n));
    if (dot(s, sub(top[i]!, cen)) < 0) s = mul(s, -1);
    quad(m, e, s, part, uv);
  }
}

/** a small box at roll `roll` on the body (radius r), centred at z: a rail lug, a hanger, an intake */
function lug(m: Mesh, roll: number, r: number, z: number, w: number, h: number, l: number, part: number, uv: [number, number]) {
  const d: V3 = [Math.cos(roll), Math.sin(roll), 0];
  const n: V3 = [-Math.sin(roll), Math.cos(roll), 0];
  const c = add(mul(d, r + h / 2), [0, 0, z]);
  const ax: [V3, number][] = [
    [d, h / 2],
    [n, w / 2],
    [[0, 0, 1], l / 2],
  ];
  for (let f = 0; f < 3; f++)
    for (const sg of [1, -1]) {
      const [A, ha] = ax[f]!,
        [B, hb] = ax[(f + 1) % 3]!,
        [C, hc] = ax[(f + 2) % 3]!;
      const o = add(c, mul(A, sg * ha));
      quad(
        m,
        [
          add(o, add(mul(B, -hb), mul(C, -hc))),
          add(o, add(mul(B, hb), mul(C, -hc))),
          add(o, add(mul(B, hb), mul(C, hc))),
          add(o, add(mul(B, -hb), mul(C, hc))),
        ],
        mul(A, sg),
        part,
        uv,
      );
    }
}

/** an ogive's profile from its base (t 0, radius R) to its tip (t 1, radius tip) — a tangent ogive's curve, n samples */
const ogive = (R: number, tip: number, n = 10): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [t, tip + (R - tip) * Math.sqrt(Math.max(0, 1 - t * t)) ** 0.9 * (1 - 0.15 * t * t)] as [number, number];
  });

function write(name: MissileMeshId, m: Mesh) {
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
      `${name}: ${nv} vertices, ${ni / 3} triangles, ${(hi[0]! - lo[0]!).toFixed(2)} × ${(hi[1]! - lo[1]!).toFixed(2)} × ${(hi[2]! - lo[2]!).toFixed(2)} m`,
    ),
  );
}

const BODY = 92,
  FIN = 93,
  DOME = 97,
  NOZZLE = 98;
const WHITE = flat(222, 222, 216);
const RADOME = flat(236, 234, 226);
const YELLOW = flat(214, 170, 30);
const BROWN = flat(112, 72, 40);
const DARK = flat(44, 44, 46);
const SEG = 28;

/** the body: a boat-tail, the paint, its two bands, the nozzle — from z0 (the tail) to zN (where the nose begins) */
function body(
  m: Mesh,
  R: number,
  z0: number,
  zN: number,
  bands: [number, [number, number]][],
  paint: [number, number],
  nozzleR: number,
  seg = SEG,
  facets = false,
) {
  const L = zN - z0;
  const tailL = Math.min(0.12, 0.05 * L);
  lathe(
    m,
    z0,
    z0 + tailL,
    [
      [0, R * 0.86],
      [1, R],
    ],
    seg,
    BODY,
    paint,
    facets,
  );
  // (the paint between the bands, the bands a hair proud of it)
  const cuts = [z0 + tailL, ...bands.flatMap(([z]) => [z - 0.025, z + 0.025]), zN].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i += 2)
    lathe(
      m,
      cuts[i]!,
      cuts[i + 1]!,
      [
        [0, R],
        [1, R],
      ],
      seg,
      BODY,
      paint,
      facets,
    );
  for (const [z, c] of bands)
    lathe(
      m,
      z - 0.025,
      z + 0.025,
      [
        [0, R * 1.004],
        [1, R * 1.004],
      ],
      seg,
      BODY,
      c,
      facets,
    );
  // (the nozzle: its lip, its dark throat)
  lathe(
    m,
    z0 - 0.04,
    z0 + 0.005,
    [
      [0, nozzleR],
      [1, R * 0.8],
    ],
    seg,
    NOZZLE,
    DARK,
  );
  lathe(
    m,
    z0 + 0.0,
    z0 + 0.06,
    [
      [0, nozzleR * 0.95],
      [1, nozzleR * 0.4],
    ],
    seg,
    NOZZLE,
    flat(20, 20, 22),
  );
}

/** the four control fins (FIN + k), at the shape's roll — their hinge about its station */
function fins(
  m: Mesh,
  id: MissileMeshId,
  span: number,
  zLE: number,
  zTE: number,
  tLE: number,
  tTE: number,
  thick: number,
  paint: [number, number],
) {
  const S = MISSILE_SHAPES[id];
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, span, zLE, zTE, tLE, tTE, thick, FIN + k, paint);
}

// ---- AIM-120C (3.66 m, Ø 178 mm): the radome's ogive, clipped mid wings, tail control fins in an X, two rail lugs
{
  const id: MissileMeshId = "msl-aim120";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const zt = -S.len / 2,
    zn = S.len / 2 - 0.55;
  body(
    m,
    S.radius,
    zt,
    zn,
    [
      [0.62, YELLOW],
      [-0.35, BROWN],
    ],
    WHITE,
    S.nozzleR,
  );
  lathe(m, zn, S.len / 2, ogive(S.radius, 0.006), SEG, BODY, RADOME);
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, 0.2, 0.3, -0.2, -0.04, -0.17, 0.008, BODY, WHITE);
  fins(m, id, 0.21, -1.4, -1.78, -1.58, -1.8, 0.007, WHITE);
  // (the lugs on its top — the launcher's rail, the bay's ejector)
  for (const z of [0.55, -0.6]) lug(m, Math.PI / 2, S.radius, z, 0.03, 0.02, 0.07, BODY, flat(160, 160, 156));
  await write(id, m);
}

// ---- AIM-9X (3.02 m, Ø 127 mm): the IR dome, small fixed fins forward, tail control fins
{
  const id: MissileMeshId = "msl-aim9x";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const zt = -S.len / 2,
    zd = S.len / 2 - S.radius;
  body(
    m,
    S.radius,
    zt,
    zd - 0.12,
    [
      [0.95, YELLOW],
      [-0.4, BROWN],
    ],
    WHITE,
    S.nozzleR,
  );
  // (the seeker's housing narrowing to the dome, the dome a hemisphere of glass)
  lathe(
    m,
    zd - 0.12,
    zd,
    [
      [0, S.radius],
      [1, S.radius * 0.97],
    ],
    SEG,
    BODY,
    WHITE,
  );
  lathe(
    m,
    zd,
    S.len / 2,
    Array.from({ length: 9 }, (_, i) => [i / 8, S.radius * 0.97 * Math.cos((i / 8) * Math.PI * 0.5)] as [number, number]),
    SEG,
    DOME,
    flat(30, 34, 40),
  );
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, 0.045, 1.12, 0.92, 1.0, 0.92, 0.005, BODY, WHITE);
  fins(m, id, 0.11, -1.15, -1.46, -1.32, -1.48, 0.006, WHITE);
  for (const z of [0.6, -0.55]) lug(m, Math.PI / 2, S.radius, z, 0.025, 0.018, 0.06, BODY, flat(160, 160, 156));
  await write(id, m);
}

// ---- 9M38 (SA-11, 5.55 m, Ø 400 mm): a long ogive, long low wings, tail control fins in a +
{
  const id: MissileMeshId = "msl-sam";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const paint = flat(206, 210, 198);
  const zt = -S.len / 2,
    zn = S.len / 2 - 0.95;
  body(m, S.radius, zt, zn, [[0.9, flat(150, 40, 36)]], paint, S.nozzleR);
  lathe(m, zn, S.len / 2, ogive(S.radius, 0.012, 12), SEG, BODY, paint);
  for (let k = 0; k < 4; k++) plate(m, S.roll0 + (k * Math.PI) / 2, S.radius * 0.98, 0.26, 1.0, -1.6, -0.6, -1.62, 0.014, BODY, paint);
  fins(m, id, 0.36, -2.0, -2.7, -2.32, -2.74, 0.012, paint);
  await write(id, m);
}

// ---- JSM (4 m): a faceted body (six sides), a chisel nose, two wings folded out, tail fins in an X, its intake under it
{
  const id: MissileMeshId = "msl-jsm";
  const S = MISSILE_SHAPES[id];
  const m = mesh();
  const paint = flat(96, 102, 106);
  const zt = -S.len / 2,
    zn = S.len / 2 - 0.8;
  body(m, S.radius, zt, zn, [], paint, S.nozzleR, 6, true);
  lathe(
    m,
    zn,
    S.len / 2,
    [
      [0, S.radius],
      [0.5, S.radius * 0.7],
      [1, 0.02],
    ],
    6,
    BODY,
    paint,
    true,
  );
  for (const roll of [0, Math.PI]) plate(m, roll, S.radius * 0.95, 0.62, 0.35, -0.35, -0.22, -0.52, 0.016, BODY, paint);
  fins(m, id, 0.3, -1.42, -1.92, -1.7, -1.96, 0.012, paint);
  lug(m, -Math.PI / 2, S.radius * 0.9, -0.3, 0.16, 0.07, 0.5, BODY, flat(60, 64, 66));
  await write(id, m);
}
