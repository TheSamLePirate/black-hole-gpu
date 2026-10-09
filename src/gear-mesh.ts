// The Ranger's landing gear, drawn (PLAN-COCKPIT K4a): each leg of gear.ts GEARS.ranger — a strut from the
// hull down to its wheels' axle, the oleo's chromed piston sliding in it, the wheels (the nose's one, the
// mains' twin), a drag brace, its bay's two doors open beside it. Generated at the legs' places, in the
// hull's vertex layout (ship.ts STRIDE: position, normal, material, ambient occlusion, uv — none here). The material's fraction
// says the leg and the part's role (ship.wgsl gearPos): 0 still (the strut, the brace), 1 sliding with the
// oleo's compression (the piston, the wheels), 2 a door — so the shader moves them.

import { GEARS, type Leg } from "./gear";

type V3 = [number, number, number];

/** The gear's materials (ship.wgsl): the struts' and pistons' steel, the tyres' rubber, the hubs and the
 *  bays; the doors are the hull's plating (0). */
export const GEAR_MAT = { steel: 5, tyre: 6, hub: 7, door: 0 } as const;
/** a part's role: still, sliding with its leg's oleo, a door */
export const ROLE = { still: 0, oleo: 1, door: 2 } as const;

/** The material number with its leg and role in its fraction (decoded by ship.wgsl gearPart). */
export const gearMat = (mat: number, leg: number, role: number) => mat + 0.04 + 0.12 * leg + 0.03 * role;

/** Decodes it: the material, the leg, the role (null: not the gear's). */
export function gearPartOf(m: number): { mat: number; leg: number; role: number } | null {
  const mat = Math.round(m);
  const f = m - mat;
  if (f < 0.02) return null;
  const leg = Math.floor((f - 0.04 + 0.005) / 0.12);
  return { mat, leg, role: Math.max(Math.round((f - 0.04 - 0.12 * leg) / 0.03), 0) };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

class Out {
  v: number[] = [];
  i: number[] = [];
  vert(p: V3, n: V3, m: number, ao: number) {
    this.v.push(...p, ...n, m, ao, 0, 0);
    return this.v.length / 10 - 1;
  }
  tri(a: number, b: number, c: number, n: V3) {
    const P = (k: number): V3 => [this.v[10 * k]!, this.v[10 * k + 1]!, this.v[10 * k + 2]!];
    const pa = P(a);
    const cr = cross(add(P(b), mul(pa, -1)), add(P(c), mul(pa, -1)));
    // (counter-clockwise seen from outside: the hull's pipeline culls the back faces)
    if (dot(cr, n) < 0) this.i.push(a, c, b);
    else this.i.push(a, b, c);
  }
  /** a cylinder from a to b, radius r, its caps */
  cyl(a: V3, b: V3, r: number, seg: number, m: number, ao = 1) {
    const ax = norm(add(b, mul(a, -1)));
    const e1 = norm(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const e2 = cross(ax, e1);
    const ring = (k: number): V3 => {
      const t = (2 * Math.PI * k) / seg;
      return add(mul(e1, Math.cos(t)), mul(e2, Math.sin(t)));
    };
    for (let k = 0; k < seg; k++) {
      const d0 = ring(k),
        d1 = ring(k + 1);
      const q = [this.vert(add(a, mul(d0, r)), d0, m, ao), this.vert(add(a, mul(d1, r)), d1, m, ao), this.vert(add(b, mul(d1, r)), d1, m, ao), this.vert(add(b, mul(d0, r)), d0, m, ao)];
      const mid = norm(add(d0, d1));
      this.tri(q[0]!, q[1]!, q[2]!, mid);
      this.tri(q[0]!, q[2]!, q[3]!, mid);
      for (const [c, s] of [
        [a, -1],
        [b, 1],
      ] as [V3, number][]) {
        const n = mul(ax, s);
        this.tri(this.vert(c, n, m, ao), this.vert(add(c, mul(d0, r)), n, m, ao), this.vert(add(c, mul(d1, r)), n, m, ao), n);
      }
    }
  }
  /** a box: centre, half-extent vectors */
  box(c: V3, ex: V3, ey: V3, ez: V3, m: number, ao = 1) {
    for (const [u, v, w] of [
      [ex, ey, ez],
      [ey, ez, ex],
      [ez, ex, ey],
    ] as [V3, V3, V3][])
      for (const s of [1, -1]) {
        const f = add(c, mul(w, s));
        const n = norm(mul(w, s));
        const k = [
          this.vert(add(f, add(mul(u, -1), mul(v, -1))), n, m, ao),
          this.vert(add(f, add(u, mul(v, -1))), n, m, ao),
          this.vert(add(f, add(u, v)), n, m, ao),
          this.vert(add(f, add(mul(u, -1), v)), n, m, ao),
        ];
        this.tri(k[0]!, k[1]!, k[2]!, n);
        this.tri(k[0]!, k[2]!, k[3]!, n);
      }
  }
}

/** Where the hull is above a leg: its underside's height there [m, ship frame] — the belly along the
 *  centreline, the wings' underside out on them (ranger.bin: ≈ 0.1 m under the fuselage, 0.25 m the wings). */
const hullAbove = (x: number, z: number) => (Math.abs(x) > 3 ? 0.25 : z > 7 ? 0.2 : 0.1);

/** Each leg's hinge on the hull (where its strut meets it: it folds forwards about it, gear up) and its
 *  doors' offset across from it [m]. */
export const GEAR_HINGES: { at: V3; door: number }[] = GEARS.ranger!.legs.map((L) => ({
  at: [L.at[0], hullAbove(L.at[0], L.at[2]), L.at[2]],
  door: L.steers ? 0.32 : 0.45,
}));

/** The wheels' radii: the nose's, the mains' [m]. */
export const WHEEL = { nose: 0.36, main: 0.5 } as const;

/** The gear's mesh (gear down, every oleo at full extension), and its bounds. */
export function gearMesh(legs: Leg[] = GEARS.ranger!.legs): { verts: Float32Array<ArrayBuffer>; idx: Uint32Array<ArrayBuffer>; lo: V3; hi: V3 } {
  const o = new Out();
  legs.forEach((L, k) => {
    const nose = !!L.steers;
    const r = nose ? WHEEL.nose : WHEEL.main;
    const [x, y0, z] = L.at;
    const axle: V3 = [x, y0 + r, z];
    const top: V3 = [x, hullAbove(x, z), z];
    const len = top[1] - axle[1];
    const S = (m: number) => gearMat(m, k, ROLE.still),
      O = (m: number) => gearMat(m, k, ROLE.oleo),
      Dr = (m: number) => gearMat(m, k, ROLE.door);
    // the strut (its upper, fixed half) and the piston sliding out of it to the axle
    const rs = nose ? 0.075 : 0.1;
    o.cyl(top, [x, top[1] - 0.55 * len, z], rs, 14, S(GEAR_MAT.steel), 0.85);
    o.cyl([x, top[1] - 0.45 * len, z], [x, axle[1] + 0.12, z], rs * 0.65, 12, O(GEAR_MAT.steel));
    // the axle's fork, a drag brace aft up to the hull
    o.box([x, axle[1] + 0.12, z], [nose ? 0.16 : 0.34, 0, 0], [0, 0.07, 0], [0, 0, 0.07], O(GEAR_MAT.hub));
    o.cyl([x, top[1] - 0.5 * len, z], [x, top[1], z - (nose ? 0.7 : 1.0)], rs * 0.45, 8, S(GEAR_MAT.steel), 0.9);
    // the wheels: the nose's two small ones close together, the mains' two either side of the strut
    const off = nose ? 0.15 : 0.3;
    const wid = nose ? 0.11 : 0.15;
    for (const s of [-1, 1]) {
      const c: V3 = [x + s * off, axle[1], z];
      o.cyl([c[0] - wid, c[1], c[2]], [c[0] + wid, c[1], c[2]], r, 24, O(GEAR_MAT.tyre));
      // (the hub: a disc proud of the tyre's outer face)
      o.cyl([c[0] + s * (wid - 0.01), c[1], c[2]], [c[0] + s * (wid + 0.015), c[1], c[2]], r * 0.55, 16, O(GEAR_MAT.hub));
    }
    // the bay's doors, open: hanging either side of the strut, along the craft
    const dl = nose ? 1.0 : 1.4,
      dh = nose ? 0.55 : 0.7;
    for (const s of [-1, 1])
      o.box([x + s * (nose ? 0.32 : 0.45), top[1] - dh / 2, z + (nose ? 0.1 : 0)], [0.015, 0, 0], [0, dh / 2, 0], [0, 0, dl / 2], Dr(GEAR_MAT.door), 0.8);
  });
  const lo: V3 = [Infinity, Infinity, Infinity],
    hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < o.v.length; i += 10)
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c]!, o.v[i + c]!);
      hi[c] = Math.max(hi[c]!, o.v[i + c]!);
    }
  return { verts: new Float32Array(o.v), idx: new Uint32Array(o.i), lo, hi };
}
