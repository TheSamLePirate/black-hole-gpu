import type { CameraFrame } from "../camera";
import { dot, type Vec3 } from "../math/vec3";
import type { LocalPatch } from "./local-patch";
import { geodeticToCart, WGS84_A, WGS84_F } from "./ellipsoid";
import { TABLE_TERRAIN } from "../gpu-tables";
import {
  TERRAIN_CACHE_HEADER,
  TERRAIN_CACHE_N,
  TERRAIN_CACHE_NODE_VEC4S,
  TERRAIN_CACHE_ROUNDS,
  type TerrainWindow,
} from "./terrain-cache-layout";

export type TerrainRasterView = "off" | "depth" | "normals" | "difference";
export const TERRAIN_RASTER_UNIFORM_BYTES = 8 * 16;
/** At most 32 MiB of attachments, plus one retired pair during resize. No allocation when off. */
export const TERRAIN_RASTER_MAX_PIXELS = 4_194_304;

/** A camera-relative WGS84 frame. No absolute million-metre float32 position is subtracted on the GPU. */
export function terrainRasterFrame(
  near: LocalPatch,
  camera: CameraFrame,
  window: TerrainWindow,
  level: number,
  image: { width: number; height: number },
  output: { width: number; height: number },
  view: TerrainRasterView,
  fovDegrees: number,
  mPerM: number,
): Float32Array<ArrayBuffer> {
  const round = TERRAIN_CACHE_ROUNDS[level];
  if (!round) throw new Error("terrain-raster: invalid cache level");
  const centre = (TERRAIN_CACHE_N - 1) / 2;
  const lon = ((window.i + centre) / round) * 2 * Math.PI;
  const lat = ((window.j + centre) / round) * 2 * Math.PI;
  const anchor = geodeticToCart(WGS84_A, WGS84_F, lat, lon, 0);
  const eye = near.axes.map((a) => -dot(near.centre, a) * WGS84_A) as Vec3;
  const origin = anchor.map((v, k) => v - eye[k]!) as Vec3;
  const body = (v: Vec3) => near.axes.map((a) => dot(a, v));
  const e2 = WGS84_F * (2 - WGS84_F);
  const root = Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const tanV = Math.tan((fovDegrees * Math.PI) / 360);
  const f = new Float32Array(TERRAIN_RASTER_UNIFORM_BYTES / 4);
  f.set([...origin, TABLE_TERRAIN + TERRAIN_CACHE_HEADER + level * TERRAIN_CACHE_NODE_VEC4S], 0);
  f.set([Math.cos(lon), Math.sin(lon), Math.sin(lat), Math.cos(lat)], 4);
  f.set([WGS84_A / root, e2, root, round / (2 * Math.PI)], 8);
  f.set([...body(camera.right), (tanV * image.width) / image.height], 12);
  f.set([...body(camera.up), tanV], 16);
  f.set([...body(camera.fwd), 0.25], 20);
  f.set([image.width, image.height, mPerM, view === "depth" ? 0 : view === "normals" ? 1 : 2], 24);
  f.set([output.width, output.height, 0, 0], 28);
  return f;
}
