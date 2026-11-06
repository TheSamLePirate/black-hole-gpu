// The procedural meshes' kit (scripts/build-missiles.ts, scripts/build-ground-units.ts): the craft's mesh format for ship.ts
// ("TRFC": position, normal, material, AO, UV — scripts/build-tanker.ts), surfaces of revolution, closed plates, boxes, and
// a placing transform for what was built along another axis. Every face's triangles wound counter-clockwise seen from outside
// (the pass's front faces) — a quad's both ways where it may be seen from either side.

export type V3 = [number, number, number];

export interface Mesh {
  pos: number[];
  nrm: number[];
  uv: number[];
  part: number[];
  idx: number[];
}
export const mesh = (): Mesh => ({ pos: [], nrm: [], uv: [], part: [], idx: [] });
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A flat colour (sRGB 0–255) as material 90's — and 92's — UV (ship.wgsl: r + 256 g in u, b / 255 in v). */
export const flat = (r: number, g: number, b: number): [number, number] => [r + 256 * g, b / 255];

export function vert(m: Mesh, p: V3, n: V3, part: number, uv: [number, number]) {
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
export function lathe(
  m: Mesh,
  z0: number,
  z1: number,
  prof: [number, number][],
  seg: number,
  part: number,
  uv: [number, number],
  facets = false,
) {
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
export function quad(m: Mesh, q: V3[], n: V3, part: number, uv: [number, number]) {
  const a = q.map((p) => vert(m, p, n, part, uv));
  const b = q.map((p) => vert(m, p, mul(n, -1), part, uv));
  m.idx.push(a[0]!, a[1]!, a[2]!, a[0]!, a[2]!, a[3]!);
  m.idx.push(b[0]!, b[2]!, b[1]!, b[0]!, b[3]!, b[2]!);
}

/**
 * A wing or a fin at roll `roll` about z: a closed plate from the body (radius r0) out `span`, its root from zLE to zTE, its
 * tip from tLE to tTE; `thick` [m], thinning to 60 % at the tip; its edges closed.
 */
export function plate(
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
export function lug(m: Mesh, roll: number, r: number, z: number, w: number, h: number, l: number, part: number, uv: [number, number]) {
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
export const ogive = (R: number, tip: number, n = 10): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [t, tip + (R - tip) * Math.sqrt(Math.max(0, 1 - t * t)) ** 0.9 * (1 - 0.15 * t * t)] as [number, number];
  });

export function write(name: string, m: Mesh, out = "assets/traffic") {
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

/** the vertices added since `from` moved: each point by `f`, each normal by `g` (a rotation's: the same without the shift) */
export function transform(m: Mesh, from: number, f: (p: V3) => V3, g: (n: V3) => V3) {
  for (let i = from; i < m.pos.length / 3; i++) {
    const p = f([m.pos[3 * i]!, m.pos[3 * i + 1]!, m.pos[3 * i + 2]!]);
    const n = unit(g([m.nrm[3 * i]!, m.nrm[3 * i + 1]!, m.nrm[3 * i + 2]!]));
    m.pos.splice(3 * i, 3, ...p);
    m.nrm.splice(3 * i, 3, ...n);
  }
}
/** the vertex count now (a transform's start) */
export const mark = (m: Mesh) => m.pos.length / 3;

/** an axis-aligned box from `lo` to `hi`: its six faces, each a quad seen from both sides */
export function box(m: Mesh, lo: V3, hi: V3, part: number, uv: [number, number]) {
  const [x0, y0, z0] = lo,
    [x1, y1, z1] = hi;
  quad(
    m,
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [1, 0, 0],
    part,
    uv,
  );
  quad(
    m,
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    [-1, 0, 0],
    part,
    uv,
  );
  quad(
    m,
    [
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
    ],
    [0, 1, 0],
    part,
    uv,
  );
  quad(
    m,
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [0, -1, 0],
    part,
    uv,
  );
  quad(
    m,
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 0, 1],
    part,
    uv,
  );
  quad(
    m,
    [
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y0, z0],
    ],
    [0, 0, -1],
    part,
    uv,
  );
}

/** a box whose top is narrower than its bottom (a hull's sloped sides, a turret's): `inset` [m] in on x and z at the top */
export function frustum(m: Mesh, lo: V3, hi: V3, inset: number, part: number, uv: [number, number]) {
  const [x0, y0, z0] = lo,
    [x1, y1, z1] = hi;
  const b: V3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
  ];
  const t: V3[] = [
    [x0 + inset, y1, z0 + inset],
    [x1 - inset, y1, z0 + inset],
    [x1 - inset, y1, z1 - inset],
    [x0 + inset, y1, z1 - inset],
  ];
  quad(m, t, [0, 1, 0], part, uv);
  quad(m, b, [0, -1, 0], part, uv);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const n = unit(cross(sub(b[j]!, b[i]!), sub(t[i]!, b[i]!)));
    const c = mul(add(add(b[0]!, b[2]!), add(t[0]!, t[2]!)), 0.25);
    const out = dot(n, sub(b[i]!, c)) < 0 ? mul(n, -1) : n;
    quad(m, [b[i]!, b[j]!, t[j]!, t[i]!], out, part, uv);
  }
}

/** a wheel: a cylinder about x at `c`, its radius and width [m], `seg` sides */
export function wheel(m: Mesh, c: V3, r: number, w: number, part: number, uv: [number, number], seg = 14) {
  const at = mark(m);
  lathe(
    m,
    -w / 2,
    w / 2,
    [
      [0, r],
      [1, r],
    ],
    seg,
    part,
    uv,
  );
  // (built about z: turned onto x, put at c)
  transform(
    m,
    at,
    (p) => [c[0] + p[2], c[1] + p[1], c[2] - p[0]],
    (n) => [n[2], n[1], -n[0]],
  );
}

/**
 * A closed solid between two rings of as many points (`bot`, `top`, in order round it — the same way): its sides quads, each
 * its outward normal, and its two ends fans (convex) — a glacis, a turret's cheeks, any slab with sloped faces.
 */
export function solid(m: Mesh, bot: V3[], top: V3[], part: number, uv: [number, number]) {
  const n = bot.length;
  const c = mul(
    [...bot, ...top].reduce((a, p) => add(a, p), [0, 0, 0] as V3),
    1 / (2 * n),
  );
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const q = [bot[i]!, bot[j]!, top[j]!, top[i]!];
    let nn = unit(cross(sub(q[1]!, q[0]!), sub(q[3]!, q[0]!)));
    if (dot(nn, sub(mul(add(add(q[0]!, q[1]!), add(q[2]!, q[3]!)), 0.25), c)) < 0) nn = mul(nn, -1);
    quad(m, q, nn, part, uv);
  }
  for (const ring of [bot, top]) {
    const rc = mul(
      ring.reduce((a, p) => add(a, p), [0, 0, 0] as V3),
      1 / n,
    );
    let nn = unit(cross(sub(ring[1]!, ring[0]!), sub(ring[2]!, ring[0]!)));
    if (dot(nn, sub(rc, c)) < 0) nn = mul(nn, -1);
    for (let i = 1; i + 1 < n; i++) {
      const a = vert(m, ring[0]!, nn, part, uv),
        b = vert(m, ring[i]!, nn, part, uv),
        d = vert(m, ring[i + 1]!, nn, part, uv);
      const a2 = vert(m, ring[0]!, mul(nn, -1), part, uv),
        b2 = vert(m, ring[i]!, mul(nn, -1), part, uv),
        d2 = vert(m, ring[i + 1]!, mul(nn, -1), part, uv);
      m.idx.push(a, b, d, a2, d2, b2);
    }
  }
}

/** a profile in the y–z plane (a side view: [y, z] points, convex, in order) extruded across x from x0 to x1 */
export function extrudeX(m: Mesh, prof: [number, number][], x0: number, x1: number, part: number, uv: [number, number]) {
  solid(
    m,
    prof.map(([y, z]) => [x0, y, z] as V3),
    prof.map(([y, z]) => [x1, y, z] as V3),
    part,
    uv,
  );
}

/** a plan's outline (an [x, z] polygon, convex, in order) extruded up from y0 to y1, its top inset by `inset` [m] towards its centre */
export function extrudeY(m: Mesh, plan: [number, number][], y0: number, y1: number, part: number, uv: [number, number], inset = 0) {
  const cx = plan.reduce((a, p) => a + p[0], 0) / plan.length,
    cz = plan.reduce((a, p) => a + p[1], 0) / plan.length;
  const shrink = ([x, z]: [number, number]): V3 => {
    const d = Math.hypot(x - cx, z - cz) || 1;
    const k = Math.max(0, 1 - inset / d);
    return [cx + (x - cx) * k, y1, cz + (z - cz) * k];
  };
  solid(
    m,
    plan.map(([x, z]) => [x, y0, z] as V3),
    plan.map(shrink),
    part,
    uv,
  );
}
