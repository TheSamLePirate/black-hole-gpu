// R6a-ciel — the mirages' tables traced off the frame (system/mirage.ts mirageTables: ~1 s a forced profile, a duct's ~7 s):
// asked by the renderer (renderer.ts updateMirage) when the profile or the eye's height changes, its answer copied into the
// tracer's table (gpu-tables.ts TABLE_MIR). R4 — the ground's lift table for the eye (system/refraction-lift.ts liftTable, 3–25 ms)
// in the same script, its own instance (renderer.ts updateLift): {lift: the R2 table, hE}. R5 — the near body's limb-bending table
// (refraction-planets.ts planetRefractionTable, ~40 ms): {planet, index}.
import { type MirageKind, mirageTables } from "./mirage";
import type { AirState } from "./refraction-layered";
import { liftTable } from "./refraction-lift";
import { type PlanetAir, planetRefractionTable } from "./refraction-planets";

type Ask =
  | { id: number; kind: MirageKind; state: AirState; h0: number; strength?: number; lift?: undefined }
  | { id: number; lift: Float32Array; hE: number; kind?: undefined }
  | { id: number; planet: PlanetAir; index: number; lift?: undefined; kind?: undefined };
self.onmessage = (e: MessageEvent<Ask>) => {
  const a = e.data;
  const f =
    "planet" in a
      ? planetRefractionTable(a.planet, a.index)
      : a.lift
        ? liftTable(a.lift, a.hE)
        : mirageTables(a.kind!, a.state, a.h0, a.strength ?? 1);
  (self as unknown as Worker).postMessage({ id: a.id, f }, [f.buffer]);
};
