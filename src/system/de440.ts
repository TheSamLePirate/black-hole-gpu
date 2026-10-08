// The solar system's ephemerides from NASA/JPL's DE440 (and JUP365 for the Galilean moons), refitted by
// scripts/build-ephemeris.ts: per body, Chebyshev records over fixed intervals (J2000 ecliptic, km,
// TDB) relative to what it is seen from — the planets' and the Earth–Moon barycentre from the Sun,
// the Moon from the Earth, the Galilean moons from Jupiter's centre. Loaded before the first scene
// (main.ts); solar.ts reads them where they reach, its own models elsewhere (and before they load).

import type { Vec3 } from "../physics";

interface Body {
  id: string;
  center: string;
  /** start [TDB s], interval [s], degree, precision (64: all float64; 32: the constant term alone), records */
  et0: number;
  L: number;
  n: number;
  prec: number;
  count: number;
  data: DataView;
  rec: number;
}

const bodies = new Map<string, Body>();

/** Reads an ephemeris file (EPHM, version 1): its bodies join the ones known. */
/** Bumped by each ephemeris added: what was computed before it (the analytic models') is stale. */
export let ephemerisVersion = 0;

export function addEphemeris(buf: ArrayBuffer) {
  ephemerisVersion++;
  const dv = new DataView(buf);
  if (new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== "EPHM") throw new Error("not an ephemeris file");
  const hl = dv.getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))) as {
    version: number;
    bodies: Omit<Body, "data" | "rec">[] & { offset: number }[];
  };
  if (h.version !== 1) throw new Error(`ephemeris version ${h.version}`);
  const base = 8 + hl;
  for (const b of h.bodies as (Omit<Body, "data" | "rec"> & { offset: number })[]) {
    const rec = b.prec === 64 ? 24 * (b.n + 1) : 24 + 12 * b.n;
    bodies.set(b.id, { ...b, rec, data: new DataView(buf, base + b.offset, rec * b.count) });
  }
}

const loads = new Map<string, Promise<void>>();
/**
 * Fetches the ephemerides (each file once) from their URLs (ephemeris-files.ts: the page's; the planner's
 * worker, bundled apart, gets them from the page); resolves when they are in (or failed: the models stand
 * in). Asked again for a file already coming: the same wait.
 */
export function loadEphemerides(
  urls: string[],
  fetchUrl: (u: string) => Promise<ArrayBuffer> = (u) =>
    fetch(u).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${u}: ${r.status}`)))),
): Promise<void> {
  return Promise.all(
    urls.map((u) => {
      let p = loads.get(u);
      if (!p) {
        p = fetchUrl(u)
          .then(addEphemeris)
          .catch((e) => console.warn("Ephemerides unavailable, the analytic models stand in:", e));
        loads.set(u, p);
      }
      return p;
    }),
  ).then(() => undefined);
}

/** The ephemerides reach this body at this time */
export function covers(id: string, et: number): boolean {
  const b = bodies.get(id);
  return !!b && et >= b.et0 && et < b.et0 + b.L * b.count;
}

/**
 * A body's position [km] and velocity [km/s] relative to its centre (J2000 ecliptic) at et [TDB s past
 * J2000], or null out of reach.
 */
export function deState(id: string, et: number): { pos: Vec3; vel: Vec3 } | null {
  const b = bodies.get(id);
  if (!b) return null;
  const i = Math.floor((et - b.et0) / b.L);
  if (i < 0 || i >= b.count) return null;
  const x = (2 * (et - b.et0 - i * b.L)) / b.L - 1;
  const o = i * b.rec,
    n = b.n,
    d = b.data;
  const coef =
    b.prec === 64
      ? (c: number, k: number) => d.getFloat64(o + 8 * (c * (n + 1) + k), true)
      : (c: number, k: number) => (k === 0 ? d.getFloat64(o + 8 * c, true) : d.getFloat32(o + 24 + 4 * (c * n + k - 1), true));
  const pos: Vec3 = [0, 0, 0],
    vel: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    // Tₖ(x) by recurrence, and Tₖ′ = k Uₖ₋₁ (Uₖ by the same recurrence)
    let t0 = 1,
      t1 = x,
      u0 = 1,
      u1 = 2 * x;
    let p = coef(c, 0) + coef(c, 1) * x,
      v = coef(c, 1);
    for (let k = 2; k <= n; k++) {
      const t2 = 2 * x * t1 - t0;
      const ck = coef(c, k);
      p += ck * t2;
      v += ck * k * u1;
      t0 = t1;
      t1 = t2;
      const u2 = 2 * x * u1 - u0;
      u0 = u1;
      u1 = u2;
    }
    pos[c] = p;
    vel[c] = (v * 2) / b.L;
  }
  return { pos, vel };
}
