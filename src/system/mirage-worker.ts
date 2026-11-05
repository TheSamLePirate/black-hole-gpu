// R6a-ciel — the mirages' tables traced off the frame (system/mirage.ts mirageTables: ~1 s a forced profile, a duct's ~7 s):
// asked by the renderer (renderer.ts updateMirage) when the profile or the eye's height changes, its answer copied into the
// tracer's table (gpu-tables.ts TABLE_MIR).
import { type MirageKind, mirageTables } from "./mirage";
import type { AirState } from "./refraction-layered";

self.onmessage = (e: MessageEvent<{ id: number; kind: MirageKind; state: AirState; h0: number }>) => {
  const { id, kind, state, h0 } = e.data;
  const f = mirageTables(kind, state, h0);
  (self as unknown as Worker).postMessage({ id, f }, [f.buffer]);
};
