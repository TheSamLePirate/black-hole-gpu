// The approach lights' structures (coordinator's lot of 25 Nov 2026 — SFO's 28L/28R approach-light pier in the bay seen flat, its lights
// and pylons only in the photograph): the steel that carries an ALSF approach-light system, standing in the world — a pylon under each
// barrette, every 30 m from 30 to 900 m before the threshold, the barrette's bar and its five lamp heads, the crossbar 300 m out with its
// 21 heads and three pylons — where trace.wgsl runwayLights lights them at night (the same places: its barrettes of five a metre apart,
// its crossbar's heads every 1.5 m over ±15 m). Their tops on the approach's light plane, the runway's level half a metre up, their feet
// on the ground or the water under them (its relief over the sea, never under the sea's surface) — the light plane kept over a rising
// ground: the head half a metre over it.
// Which ends: those with a precision approach — an ILS in the approaches' data (world/approaches.ts ilsAt: the FAA's CIFP, nav.dat),
// where an approach-light system is the rule (a CAT I ILS's MALSR or ALSF-1, a CAT II/III's ALSF-2) — of a world runway lit and paved;
// and the game's own runways (their ILS). The system drawn is the ALSF's whole for all of them — a MALSR's shorter run not told apart.
// One mesh an end (ship.ts setDynamicMesh: material 90, flat colours), ~2 900 triangles, drawn by the craft's pass as an instance
// (controller/approach-lights.ts). Pure.

import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import type { RunwayFrame } from "../game/sites";

/** the barrettes: every ALS_STEP from ALS_STEP to ALS_LEN before the threshold [m]; the crossbar at ALS_CROSS */
export const ALS_STEP = 30;
export const ALS_LEN = 900;
export const ALS_CROSS = 300;
/** the light plane over the runway's level [m] */
export const ALS_PLANE = 0.5;

/** An end with structures: its runway's frame, which end (0 the frame's threshold, 1 the far one — landed the other way), its key. */
export interface AlsEnd {
  key: string;
  frame: RunwayFrame;
  end: 0 | 1;
}

/** Whether a runway's frame may carry approach-light structures: a game site's runway, or a world runway lit and paved (trace.wgsl
 *  runwayFlags: 16 a world one, 32 lit, its surface's class << 1 — 0 paved). */
export function alsRunway(f: RunwayFrame): boolean {
  if ((f.flags & 16) === 0) return true;
  return (f.flags & 32) !== 0 && ((f.flags >> 1) & 7) === 0;
}

/** an end's precision approach: true, false, or null not known yet (its data's tile not in) — world/approaches.ts ilsAt */
export type IlsAt = (field: string, end: string, lat: number, lon: number) => boolean | null;

/** The ends with structures among runway frames: a game site's both ends; a world runway's ends with an ILS (`ils`). */
export function alsEnds(frames: readonly RunwayFrame[], ils: IlsAt): AlsEnd[] {
  const out: AlsEnd[] = [];
  for (const f of frames) {
    if (!alsRunway(f)) continue;
    for (const end of [0, 1] as const) {
      if (f.world) {
        const des = f.site.des?.[end];
        if (!des) continue;
        const p = end === 0 ? f.origin : (f.origin.map((o, i) => o + f.along[i]! * f.len) as [number, number, number]);
        const g = geodeticOf(p);
        if (ils(f.world.field, des, g.lat, g.lon) !== true) continue;
      }
      out.push({ key: `${f.site.name}#${end}`, frame: f, end });
    }
  }
  return out;
}

type V3 = [number, number, number];
/** An end's local frame: its threshold on the ellipsoid (body-fixed [m]), the landing direction, its left, its up (the frame's
 *  geodetic normal). */
export function alsAxes(e: AlsEnd): { origin: V3; fwd: V3; left: V3; up: V3 } {
  const f = e.frame;
  const s = e.end === 0 ? 1 : -1;
  const origin = (e.end === 0 ? f.origin : f.origin.map((o, i) => o + f.along[i]! * f.len)) as V3;
  return {
    origin,
    fwd: f.along.map((v) => v * s) as V3,
    left: f.across.map((v) => -v * s) as V3,
    up: [...f.p] as V3,
  };
}

/** a vertex's colour for material 90 (ship.wgsl: r and g packed in u, b in v — sRGB) */
const colour = (r: number, g: number, b: number): [number, number] => [Math.round(r * 255) + 256 * Math.round(g * 255), b];
const STEEL = colour(0.62, 0.62, 0.6);
const HEAD = colour(0.12, 0.12, 0.13);

/** An end's mesh in its local frame (x left, y up, z the landing direction — right-handed, as the traffic's meshes —; its origin the
 *  threshold on the light plane): `groundMsl` the ground's height over the sea at a body-fixed point [m] (the relief; null unknown —
 *  the light plane's 6 m under it then). Vertices of 10 floats (position, normal, material, occlusion, uv), triangles' winding with
 *  their normal (cross(b − a, c − a) along it). */
export function alsMesh(e: AlsEnd, groundMsl: (p: V3) => number | null): { verts: Float32Array; idx: Uint32Array; tris: number } {
  const A = alsAxes(e);
  const plane = e.frame.elev + ALS_PLANE;
  const v: number[] = [];
  const ix: number[] = [];
  const box = (cx: number, y0: number, y1: number, cz: number, sx: number, sz: number, c: [number, number]) => {
    const x0 = cx - sx / 2,
      x1 = cx + sx / 2,
      z0 = cz - sz / 2,
      z1 = cz + sz / 2;
    const faces: { n: V3; q: V3[] }[] = [
      {
        n: [1, 0, 0],
        q: [
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ],
      },
      {
        n: [-1, 0, 0],
        q: [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
      },
      {
        n: [0, 1, 0],
        q: [
          [x0, y1, z0],
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
        ],
      },
      {
        n: [0, -1, 0],
        q: [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
      },
      {
        n: [0, 0, 1],
        q: [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
      },
      {
        n: [0, 0, -1],
        q: [
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y0, z0],
        ],
      },
    ];
    for (const f of faces) {
      const b = v.length / 10;
      for (const p of f.q) v.push(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2], 90, 1, c[0], c[1]);
      // (wound with its normal: flipped where the quad's order runs the other way)
      const [a, q1, q2] = f.q as [V3, V3, V3];
      const e1 = [q1[0] - a[0], q1[1] - a[1], q1[2] - a[2]],
        e2 = [q2[0] - a[0], q2[1] - a[1], q2[2] - a[2]];
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const ok = cr[0]! * f.n[0] + cr[1]! * f.n[1] + cr[2]! * f.n[2] > 0;
      if (ok) ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
      else ix.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  };
  /** the ground's height in the local frame under a point (x left, z along) [m]: the relief over the sea, never under its surface */
  const groundAt = (x: number, z: number): number => {
    const p = [0, 1, 2].map((i) => A.origin[i]! + A.left[i]! * x + A.fwd[i]! * z) as V3;
    const g = groundMsl(p);
    return g === null ? -6 : Math.max(g, 0) - plane;
  };
  /** a barrette's head row: n heads `gap` apart across, on a bar, at z; its pylons at `feet` (x) */
  const unit = (z: number, n: number, gap: number, feet: number[]) => {
    const half = ((n - 1) * gap) / 2;
    let top = 0;
    for (const x of feet) top = Math.max(top, groundAt(x, z) + 0.4);
    // (the bar under the heads, the heads on it)
    box(0, top - 0.12, top, z, 2 * half + 0.4, 0.14, STEEL);
    for (let i = 0; i < n; i++) box(-half + i * gap, top, top + 0.28, z, 0.3, 0.34, HEAD);
    for (const x of feet) {
      const g = groundAt(x, z);
      if (top - 0.12 - g > 0.05) box(x, g, top - 0.12, z, 0.22, 0.22, STEEL);
    }
  };
  for (let k = 1; k * ALS_STEP <= ALS_LEN; k++) {
    const z = -k * ALS_STEP;
    if (k * ALS_STEP === ALS_CROSS) unit(z, 21, 1.5, [-14, 0, 14]);
    else unit(z, 5, 1, [0]);
  }
  return { verts: new Float32Array(v), idx: new Uint32Array(ix), tris: ix.length / 3 };
}

/** an end's light plane's height over the ellipsoid at its threshold [m] (the runway's level over the sea, the geoid N under it) */
export function alsOriginHeight(e: AlsEnd, geoidN: number): number {
  return e.frame.elev + ALS_PLANE + geoidN;
}

/** a body-fixed point's geodetic place [°] and height [m] */
export function geodeticOf(p: V3): { lat: number; lon: number; h: number } {
  const g = cartToGeodetic(WGS84_A, WGS84_F, p);
  return { lat: (g.lat * 180) / Math.PI, lon: (g.lon * 180) / Math.PI, h: g.h };
}
