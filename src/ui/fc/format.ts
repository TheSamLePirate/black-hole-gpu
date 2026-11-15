// The flight computer's figures and its porkchop's transfer (audit 2026-11-10, QA-10: src/ui/fc/computer.ts — 1 232 lines — never
// imported by a test): a distance, a duration, a speed, a burn's part, a radius about the hole; a transfer flown at a chosen
// departure and flight time. Moved out of computer.ts as they were; tested in tests/fc-format.test.ts.

import type { Burn, FcContext, OpResult } from "../../fc/ops";
import * as kep from "../../fc/kepler";
import { t, tf } from "../../i18n";
import { AU_M, C_MPS } from "../../units";

/** A distance: m, km (one decimal under 1 000 km), AU from a million km. */
export const km = (m: number) =>
  !Number.isFinite(m)
    ? "∞"
    : Math.abs(m) >= 1e9
      ? `${(m / AU_M).toFixed(3)} AU`
      : Math.abs(m) >= 1e6
        ? `${(m / 1e3).toFixed(0)} km`
        : Math.abs(m) >= 1e4
          ? `${(m / 1e3).toFixed(1)} km`
          : `${m.toFixed(0)} m`;

/** A duration: s, min s, h min, days; signed. */
export const dur = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  const sg = s < 0 ? "−" : "";
  if (a < 60) return `${sg}${a.toFixed(0)} s`;
  if (a < 3600)
    return `${sg}${Math.floor(a / 60)} min ${Math.round(a % 60)
      .toString()
      .padStart(2, "0")} s`;
  if (a < 86400)
    return `${sg}${Math.floor(a / 3600)} h ${Math.round((a % 3600) / 60)
      .toString()
      .padStart(2, "0")} min`;
  return `${sg}${(a / 86400).toFixed(a < 864000 ? 1 : 0)} d`;
};

/** A speed: m/s, km/s, fractions of c. */
export const ms = (v: number) =>
  !Number.isFinite(v)
    ? "∞"
    : Math.abs(v) >= 3e6
      ? `${(v / C_MPS).toFixed(4)} c`
      : Math.abs(v) >= 1000
        ? `${(v / 1000).toFixed(2)} km/s`
        : `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)} m/s`;

/** A burn's part: m/s, or km/s for the hole's (fractions of c). */
export const part = (v: number, big: boolean) => (big ? (v / 1000).toFixed(0) : v.toFixed(1));

/** A radius about the hole: in M, and its distance. */
export const rM = (r: number, Mm: number) => (!Number.isFinite(r) ? "∞" : `${r.toFixed(2)} M · ${km(r * Mm)}`);

/** A transfer flown at a chosen departure and flight time (a porkchop's cell). */
export function transferAt(c: FcContext, dep: number, tof: number, rendezvous: boolean): OpResult | null {
  const T = c.target;
  if (!T) return null;
  const { lambertBest, propagate, toPNR, add, unit, cross, len } = kep;
  const s = propagate(c.mu, c.r, c.v, dep);
  const tg = propagate(c.mu, T.r, T.v, dep + tof);
  const L = lambertBest(c.mu, s.r, tg.r, tof, unit(cross(c.r, c.v)), s.v, rendezvous ? tg.v : null);
  if (!L) return null;
  const burns: Burn[] = [{ t: dep, dv: toPNR(s.r, s.v, add(L.v1, s.v, -1)), label: t("departure") }];
  if (rendezvous) burns.push({ t: dep + tof, dv: toPNR(tg.r, L.v2, add(tg.v, L.v2, -1)), label: t("match") });
  return {
    ok: true,
    note: rendezvous
      ? tf("Rendezvous with {0}: departing in {1}, {2} of flight", T.name, dur(dep), dur(tof))
      : tf("Intercept with {0}: departing in {1}, {2} of flight", T.name, dur(dep), dur(tof)),
    burns,
    dvTotal: burns.reduce((a, b) => a + len(b.dv), 0),
  };
}
