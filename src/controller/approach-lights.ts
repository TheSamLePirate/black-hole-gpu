// The approach lights' structures about the view (src/world/approach-lights.ts): each runway end within ALS_REACH of the eye that carries
// them, its mesh made once its relief is known — and again when the world's ground under it has changed, at most every 10 s —, drawn by
// the craft's pass as an instance (renderer.combatOthers: hidden behind what the scene holds nearer, as the traffic's).

import { EARTH_RUNWAYS } from "../game/sites";
import { bodyFixedOf, groundRelief, reliefKnown } from "../system/our-surface";
import { geoidDeg } from "../system/geoid-grid";
import { type AlsEnd, alsAxes, alsEnds, alsMesh, alsOriginHeight, geodeticOf } from "../world/approach-lights";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";
import type { ShipMeshId } from "../ship";
import { earthView } from "./netcraft";
import { ilsAt } from "../world/approaches";

/** the ends drawn within this of the eye [m] */
export const ALS_REACH = 8000;
/** the ends' meshes made: their key's stamp — the world's ground's when made, when */
const made = new Map<string, { ground: unknown; at: number }>();

/** what the controller asks of the craft's pass: its dynamic meshes (ship.ts setDynamicMesh) */
export interface AlsMeshes {
  hasDynamic(key: string): boolean;
  setDynamicMesh(key: string, verts: Float32Array, idx: Uint32Array): void;
}

/** The structures' instances about the view: their mesh's key as their id, their origin and axes on the view's camera. `ground`: the
 *  world's ground's revision (renderer.groundStamp — finer relief arrived: the feet made again); `now` [ms]. */
export function approachLights(view: CameraController, meshes: AlsMeshes, ground: unknown, now: number) {
  const E = earthView(view);
  if (!E || !reliefKnown("earth")) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const out: { id: ShipMeshId; rel: Vec3; axes: [Vec3, Vec3, Vec3]; hidden: boolean; far: boolean }[] = [];
  for (const e of alsEnds(EARTH_RUNWAYS, ilsAt)) {
    if (e.frame.world?.measuring) continue;
    const A = alsAxes(e);
    const d = Math.hypot(A.origin[0] - E.p0[0], A.origin[1] - E.p0[1], A.origin[2] - E.p0[2]);
    if (d > ALS_REACH + 1000) continue;
    const key = `als:${e.key}`;
    const m = made.get(key);
    if (!meshes.hasDynamic(key) || (m && m.ground !== ground && now - m.at > 10_000)) {
      build(e, key, meshes);
      made.set(key, { ground, at: now });
    }
    if (!meshes.hasDynamic(key)) continue;
    const g = geodeticOf(A.origin);
    const h = alsOriginHeight(e, geoidDeg(g.lat, g.lon));
    const o = A.origin.map((v, i) => v + A.up[i]! * h - E.p0[i]!);
    // (a dynamic mesh's key as the instance's id — ship.ts setDynamicMesh)
    out.push({ id: key as ShipMeshId, rel: cam(o), axes: [cam(A.left), cam(A.up), cam(A.fwd)], hidden: false, far: true });
  }
  return out;
}

/** An end's mesh: its feet on the relief over the sea (the world's contact ground there, less the geoid). */
function build(e: AlsEnd, key: string, meshes: AlsMeshes) {
  const { verts, idx } = alsMesh(e, (p) => {
    const g = geodeticOf(p);
    const h = groundRelief("earth", bodyFixedOf("earth", g.lat, g.lon, 0));
    return Number.isFinite(h) ? h - geoidDeg(g.lat, g.lon) : null;
  });
  meshes.setDynamicMesh(key, verts, idx);
}
