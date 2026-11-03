// The patch's mesh cut along the runways (terrain-raster-mesh.ts), made off the frame loop: for the window the relief cache
// will move to next (TerrainCache.upcomingWindow), so the mesh is ready when the window moves — made in the frame, a 257-node
// patch's cut cost 15–30 ms in Chrome, a hitch about once a second low over a runway. Built on its own (server.ts,
// scripts/build-pages.ts, package.json) as terrain-mesh-worker.js.
import type { TerrainWindow } from "./terrain-cache-layout";
import { type RasterMesh, terrainRasterMesh } from "./terrain-raster-mesh";

export interface MeshRequest {
  key: string;
  level: number;
  window: TerrainWindow;
  runways: Float32Array;
}
export interface MeshReply {
  key: string;
  mesh: RasterMesh;
  ms: number;
}

const g = globalThis as unknown as {
  onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
  postMessage(m: MeshReply, transfer: Transferable[]): void;
};
g.onmessage = (e) => {
  const q = e.data;
  const t0 = performance.now();
  const m = terrainRasterMesh(q.window, q.level, q.runways);
  // (copies: the plain grid is shared, cached in this worker — its buffers not to be handed over)
  const mesh = { ...m, vertices: m.vertices.slice(), indices: m.indices.slice() };
  g.postMessage({ key: q.key, mesh, ms: performance.now() - t0 }, [mesh.vertices.buffer, mesh.indices.buffer]);
};
