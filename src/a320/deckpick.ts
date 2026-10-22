// What the pointer is on in the A320's flight deck (docs/PLAN-A320.md, A6): a pixel's ray (ship.ts cabinRay) cast
// against the deck as it is posed now — each part's triangles in a tree of their own at rest (system/collide.ts
// TriBVH), the ray taken into the part's rest frame by the inverse of its map (src/a320/rig.ts rigMatrices); hidden
// parts (a light off: a zero map) skipped, the glass and the integral lighting's overlay seen through. → the nearest
// triangle's object (a click's target: deck.ts objects), the point, and on a display's screen where on it.

import { TriBVH } from "../system/collide";
import type { DeckMesh } from "./deck";

type V3 = [number, number, number];

export interface DeckHit {
  /** the distance from the eye [m], the point (the ship's frame) */
  t: number;
  p: V3;
  /** the triangle's object (DeckMesh.objects) and its material */
  object: string;
  mat: number;
  /** on a display: its name (DeckMesh.screens: PFD1, MCDU1…) and the point on it, 0…1 (v down) */
  screen?: { name: string; u: number; v: number };
}

/** the materials the pointer goes through: the windows, the HUD's combiner, the displays' glass, the overlay, the
 *  texts' quads */
const CLEAR = new Set([122, 127, 128, 129, 134]);

export class DeckPicker {
  private parts: { bvh: TriBVH; tris: Uint32Array }[] | null = null;
  private ctlObj: Set<number> | null = null;

  constructor(private m: DeckMesh) {}

  /** the trees, built at the first pick (≈ 0.3 s for the 440 k triangles) */
  private build() {
    const m = this.m;
    const nt = m.idx.length / 3;
    const count = new Map<number, number>();
    const partOf = new Int32Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = m.idx[3 * t]!;
      const mat = Math.round(m.verts[10 * a + 6]!);
      if (CLEAR.has(mat)) {
        partOf[t] = -1;
        continue;
      }
      const p = Math.floor(m.verts[10 * a + 7]!);
      partOf[t] = p;
      count.set(p, (count.get(p) ?? 0) + 1);
    }
    const lists = new Map<number, Uint32Array>();
    const fill = new Map<number, number>();
    for (const [p, n] of count) {
      lists.set(p, new Uint32Array(n));
      fill.set(p, 0);
    }
    for (let t = 0; t < nt; t++) {
      const p = partOf[t]!;
      if (p < 0) continue;
      const k = fill.get(p)!;
      lists.get(p)![k] = t;
      fill.set(p, k + 1);
    }
    // (each part's tree over its own vertices: the triangles' corners copied, three a triangle)
    this.parts = [];
    for (const [p, tris] of lists) {
      const pos = new Float32Array(tris.length * 9);
      const ix = new Uint32Array(tris.length * 3);
      tris.forEach((t, i) => {
        for (let c = 0; c < 3; c++) {
          const v = m.idx[3 * t + c]!;
          pos.set([m.verts[10 * v]!, m.verts[10 * v + 1]!, m.verts[10 * v + 2]!], 9 * i + 3 * c);
          ix[3 * i + c] = 3 * i + c;
        }
      });
      this.parts[p] = { bvh: new TriBVH(pos, ix), tris };
    }
  }

  /** The first face along the ray (o, unit d) within `far` metres, the deck posed by `mats` (rows of 3 × 4 a part;
   *  none: at rest). */
  pick(o: V3, d: V3, mats: Float32Array | null, far = 3): DeckHit | null {
    if (!this.parts) this.build();
    const m = this.m;
    const e: V3 = [o[0] + d[0] * far, o[1] + d[1] * far, o[2] + d[2] * far];
    type Hit = { t: number; tri: number; u: number; v: number };
    let best = null as Hit | null;
    // (the nearest control's face too: a button flush with its panel — FlightGear's APU MASTER and START sit 0.6 mm
    // under the overhead's face — is the one seen and clicked when within 3 mm behind a face no control's)
    let ctl = null as Hit | null;
    const ctlObj = (this.ctlObj ??= new Set(m.controls.flatMap((c) => c.objects.map((o) => m.objects.indexOf(o)))));
    this.parts!.forEach((P, p) => {
      if (!P) return;
      let a = o,
        b = e;
      if (mats) {
        const inv = invert(mats, 12 * p);
        if (!inv) return;
        a = apply(inv, o);
        b = apply(inv, e);
      }
      const h = P.bvh.segment(a, b);
      if (!h) return;
      const hit = { t: h.t, tri: P.tris[h.tri]!, u: h.u, v: h.v };
      if (!best || h.t < best.t) best = hit;
      if (ctlObj.has(m.triObj[hit.tri]!) && (!ctl || h.t < ctl.t)) ctl = hit;
    });
    if (!best) return null;
    let B: Hit = best;
    const C = ctl as Hit | null;
    if (C && !ctlObj.has(m.triObj[B.tri]!) && (C.t - B.t) * far < 0.003) B = C;
    const t = B.t * far;
    const i0 = m.idx[3 * B.tri]!,
      i1 = m.idx[3 * B.tri + 1]!,
      i2 = m.idx[3 * B.tri + 2]!;
    const mat = Math.round(m.verts[10 * i0 + 6]!);
    const out: DeckHit = {
      t,
      p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t],
      object: m.objects[m.triObj[B.tri]!] ?? "",
      mat,
    };
    // (a display's screen, 126: its UV in the displays' atlas — its cell's place over it)
    if (mat === 126) {
      const w0 = 1 - B.u - B.v;
      const at = (k: number) => w0 * m.verts[10 * i0 + k]! + B.u * m.verts[10 * i1 + k]! + B.v * m.verts[10 * i2 + k]!;
      const x = at(8),
        y = at(9);
      for (const [name, [u0, v0, w, h]] of Object.entries(m.screens))
        if (x >= u0 && x <= u0 + w && y >= v0 && y <= v0 + h) {
          out.screen = { name, u: (x - u0) / w, v: (y - v0) / h };
          break;
        }
    }
    return out;
  }
}

/** a 3 × 4 affine map's inverse (rows), or null (a hidden part's zero map) */
function invert(M: Float32Array, o: number): number[] | null {
  const a = M[o]!,
    b = M[o + 1]!,
    c = M[o + 2]!,
    d = M[o + 4]!,
    e = M[o + 5]!,
    f = M[o + 6]!,
    g = M[o + 8]!,
    h = M[o + 9]!,
    i = M[o + 10]!;
  const A = e * i - f * h,
    B = f * g - d * i,
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;
  const k = 1 / det;
  const R = [
    A * k,
    (c * h - b * i) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    (c * d - a * f) * k,
    C * k,
    (b * g - a * h) * k,
    (a * e - b * d) * k,
  ];
  const tx = M[o + 3]!,
    ty = M[o + 7]!,
    tz = M[o + 11]!;
  return [
    R[0]!,
    R[1]!,
    R[2]!,
    -(R[0]! * tx + R[1]! * ty + R[2]! * tz),
    R[3]!,
    R[4]!,
    R[5]!,
    -(R[3]! * tx + R[4]! * ty + R[5]! * tz),
    R[6]!,
    R[7]!,
    R[8]!,
    -(R[6]! * tx + R[7]! * ty + R[8]! * tz),
  ];
}
const apply = (N: number[], p: V3): V3 => [
  N[0]! * p[0] + N[1]! * p[1] + N[2]! * p[2] + N[3]!,
  N[4]! * p[0] + N[5]! * p[1] + N[6]! * p[2] + N[7]!,
  N[8]! * p[0] + N[9]! * p[1] + N[10]! * p[2] + N[11]!,
];
