// Saturn's rings' fine radial profile (PLAN-PLANETES-AAA P9 G3): Cassini's radio occultation of 2005 May 3, its normal
// optical depth every kilometre from 69 800 to 140 900 km (scripts/build-ring-profile.py: u16, τ × 10 000, 65 535 none),
// into the tracer's tables (gpu-tables.ts TABLE_RING; trace.wgsl ringTauFine) as floats, −1 where none was measured.

import ringTauUrl from "../../assets/planets/saturn-rings-tau.bin";
import { RING_N } from "../gpu-tables";

/** The profile as the tracer's table takes it (RING_N floats); null if it will not load. */
export async function loadRingProfile(): Promise<Float32Array<ArrayBuffer> | null> {
  try {
    const r = await fetch(ringTauUrl);
    if (!r.ok) return null;
    const u = new Uint16Array(await r.arrayBuffer());
    if (u.length !== RING_N) return null;
    const f = new Float32Array(RING_N);
    for (let i = 0; i < RING_N; i++) f[i] = u[i] === 65535 ? -1 : u[i]! / 10000;
    return f;
  } catch {
    return null;
  }
}
