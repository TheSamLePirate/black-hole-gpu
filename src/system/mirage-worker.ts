// R6a-ciel — the mirages' tables traced off the frame (system/mirage.ts mirageTables: ~1 s a forced profile, a duct's ~7 s):
// asked by the renderer (renderer.ts updateMirage) when the profile or the eye's height changes, its answer copied into the
// tracer's table (gpu-tables.ts TABLE_MIR). R4 — the ground's lift table for the eye (system/refraction-lift.ts liftTable, 3–25 ms)
// in the same script, its own instance (renderer.ts updateLift): {lift: the R2 table, hE}.
import { type MirageKind, mirageTables } from "./mirage";
import type { AirState } from "./refraction-layered";
import { liftTable } from "./refraction-lift";

type Ask =
  | { id: number; kind: MirageKind; state: AirState; h0: number; lift?: undefined }
  | { id: number; lift: Float32Array; hE: number };
self.onmessage = (e: MessageEvent<Ask>) => {
  const a = e.data;
  const f = a.lift ? liftTable(a.lift, a.hE) : mirageTables(a.kind, a.state, a.h0);
  (self as unknown as Worker).postMessage({ id: a.id, f }, [f.buffer]);
};
