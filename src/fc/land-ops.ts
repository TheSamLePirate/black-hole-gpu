// Landing at a chosen site from orbit (the flight computer's LAND tab): when the orbit passes near it —
// the body turning under the orbit's plane, each pass a ground track that misses it by some distance
// across —, and the plane change that puts a pass over it.
//
// A pass's distance across: the least distance on the ground between the point under the craft and the
// site along that pass (where the track is abeam of it). The entry reaches a site within the craft's
// crossrange (the lift turning the fall sideways: the Ranger ~600 km, the Lander ~150 km); beyond it the
// orbit must be turned first.
//
// The plane change: at a burn point r_b the velocity turned about r_b (its speed kept, its radial part
// kept) into the plane through r_b and the site where the site will be when the craft gets there — the
// arrival found by iterating the angle flown in the new plane (and whole turns more: the arrival a few
// orbits later, the body having turned the site under it). Every burn point along the next orbit and
// every arrival within the span: the cheapest kept — Δv = 2 v_t sin(Δi / 2) the impulse, v_t Δi as the
// autopilot flies it (along the turning orbital frame: kepler.ts followDv).

import { add, cross, dot, elements, followDv, len, propagate, scale, toPNR, unit, type V3 } from "./kepler";
import type { FcContext, OpResult } from "./ops";

/** A site to come down on, as the computer sees it. */
export interface SiteTrack {
  name: string;
  /** the site's place [m, the context's axes, from the body's centre] at dt seconds from now (the body
   *  turning under it) */
  at(dt: number): V3;
  /** how far across its track the craft can still reach a site [m] (the entry's crossrange) */
  reach: number;
}

/** A pass near the site: when [s from now], how far across [m], going north or south. */
export interface Pass {
  t: number;
  across: number;
  north: boolean;
}

const angle = (a: V3, b: V3) => Math.atan2(len(cross(a, b)), dot(a, b));

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;
};
const km = (m: number) => (m >= 1e4 ? `${Math.round(m / 1e3).toLocaleString("en-US")} km` : `${(m / 1e3).toFixed(1)} km`);

/**
 * The passes near a site over the coming orbits (span: so many of them, 16 — about a day in a low Earth
 * orbit): each one's time, its distance across, its sense; the orbit sampled a few hundred times a turn
 * (Kepler), each pass's closest point refined (a golden-section search between the samples about it). None on
 * an unbound orbit, nor one through the ground.
 */
export function sitePasses(c: FcContext, site: SiteTrack, o: { orbits?: number; perOrbit?: number } = {}): Pass[] {
  const el = elements(c.mu, c.r, c.v, c.pole ?? [0, 0, 1]);
  // (none on an orbit through the ground: on it, or in the air — a fall, not passes)
  if (!(el.e < 1) || !Number.isFinite(el.T) || el.rp < c.R) return [];
  const per = o.perOrbit ?? 180;
  const N = Math.ceil((o.orbits ?? 16) * per);
  const h = el.T / per;
  const pole = c.pole ?? ([0, 0, 1] as V3);
  let s = { r: c.r, v: c.v };
  const d: number[] = [], north: boolean[] = [], states: { r: V3; v: V3 }[] = [];
  for (let i = 0; i <= N; i++) {
    if (i) s = propagate(c.mu, s.r, s.v, h);
    states.push(s);
    d.push(angle(s.r, site.at(i * h)));
    north.push(dot(s.v, pole) > 0);
  }
  const out: Pass[] = [];
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let i = 1; i < N; i++) {
    if (!(d[i]! <= d[i - 1]! && d[i]! < d[i + 1]!) || d[i]! > Math.PI / 2) continue;
    // (the closest moment between the samples about it: a golden-section search on the orbit itself —
    // the distance there is a V, its bottom between two samples hundreds of km apart)
    const s0 = states[i - 1]!, t0 = (i - 1) * h;
    const f = (t: number) => angle(propagate(c.mu, s0.r, s0.v, t - t0).r, site.at(t));
    let a = t0, b = (i + 1) * h;
    let x1 = b - gr * (b - a), x2 = a + gr * (b - a), f1 = f(x1), f2 = f(x2);
    for (let k = 0; k < 40 && b - a > 0.05; k++) {
      if (f1 < f2) (b = x2), (x2 = x1), (f2 = f1), (x1 = b - gr * (b - a)), (f1 = f(x1));
      else (a = x1), (x1 = x2), (f1 = f2), (x2 = a + gr * (b - a)), (f2 = f(x2));
    }
    const tm = (a + b) / 2;
    out.push({ t: tm, across: f(tm) * c.R, north: north[i]! });
  }
  return out;
}

/** The first pass within the craft's reach, if any. */
export const firstReachable = (passes: Pass[], reach: number) => passes.find((p) => p.across <= reach) ?? null;

/**
 * The plane change that puts a pass over the site: the cheapest burn — its point along the next orbit,
 * the arrival within the span — turning the velocity into the plane through the burn point and the site
 * where it will be. Previewed like the other operations; after it, the entry autopilot finds the pass.
 */
export function alignOverSite(c: FcContext, site: SiteTrack, o: { orbits?: number; lead?: number } = {}): OpResult {
  const fail = (note: string): OpResult => ({ ok: false, note, burns: [], dvTotal: 0 });
  const el = elements(c.mu, c.r, c.v, c.pole ?? [0, 0, 1]);
  if (!(el.e < 1)) return fail("A bound orbit first (circularize)");
  if (el.rp < c.R) return fail("The orbit meets the ground — raise the periapsis first");
  const orbits = o.orbits ?? 16;
  const T = el.T, nMean = (2 * Math.PI) / T, span = orbits * T;
  const nOld = unit(cross(c.r, c.v));
  const now = sitePasses(c, site, { orbits });
  const already = firstReachable(now, site.reach);
  // the burn points along the next turn
  const steps = 96;
  let s = { r: c.r, v: c.v };
  let best: { tb: number; ta: number; r: V3; v: V3; vNew: V3; dv: number; di: number } | null = null;
  // (the burn no sooner than the lead: time to turn the craft to it, half the burn before its centre)
  const lead = o.lead ?? 150;
  s = propagate(c.mu, s.r, s.v, lead);
  for (let i = 0; i < steps; i++) {
    const tb = lead + (i * T) / steps;
    if (i) s = propagate(c.mu, s.r, s.v, T / steps);
    const rb = unit(s.r);
    const vr = dot(s.v, rb);
    const vt = len(add(s.v, rb, -vr));
    for (let k = 0; k < orbits; k++) {
      // the arrival: the angle flown in the new plane, a few passes refined (the site moves meanwhile)
      let theta = Math.PI, nNew: V3 = nOld, ta = 0;
      for (let it = 0; it < 5; it++) {
        ta = tb + (theta + 2 * Math.PI * k) / nMean;
        const sd = unit(site.at(ta));
        let nn = cross(rb, sd);
        if (len(nn) < 1e-9) break;
        nn = unit(nn);
        // (the motion's sense kept: the new pole on the old one's side)
        if (dot(nn, nOld) < 0) nn = scale(nn, -1);
        nNew = nn;
        theta = Math.atan2(dot(cross(rb, sd), nNew), dot(rb, sd));
        if (theta < 0) theta += 2 * Math.PI;
      }
      if (ta > span) break;
      const di = angle(nOld, nNew);
      const vNew = add(scale(rb, vr), scale(unit(cross(nNew, rb)), vt));
      const dv = len(add(vNew, s.v, -1));
      // (the cheapest; a little for waiting: a day's wait worth a few m/s)
      const cost = dv + ta / 3600 * 0.2;
      if (!best || cost < best.dv + best.ta / 3600 * 0.2) best = { tb, ta, r: s.r, v: s.v, vNew, dv, di };
    }
  }
  if (!best) return fail(`No plane through ${site.name} within ${orbits} orbits`);
  // refined: the pass the new orbit really makes (Kepler, not the mean motion) gives the arrival — the
  // site where it is then — and the plane through it again, a few times
  const rb = unit(best.r);
  const vr = dot(best.v, rb), vt = len(add(best.v, rb, -vr));
  for (let it = 0; it < 4; it++) {
    const trial = { ...c, r: best.r, v: best.vNew };
    const ps = sitePasses(trial, { ...site, at: (dt) => site.at(dt + best!.tb) }, { orbits: Math.ceil((best.ta - best.tb) / T) + 1, perOrbit: 360 });
    const near = ps.reduce<Pass | null>((a, p) => (!a || Math.abs(p.t + best!.tb - best!.ta) < Math.abs(a.t + best!.tb - best!.ta) ? p : a), null);
    if (!near || near.across < 1e3) break;
    const ta: number = near.t + best.tb;
    let nNew = unit(cross(rb, unit(site.at(ta))));
    if (dot(nNew, nOld) < 0) nNew = scale(nNew, -1);
    const vNew = add(scale(rb, vr), scale(unit(cross(nNew, rb)), vt));
    best = { ...best, ta, vNew, dv: len(add(vNew, best.v, -1)), di: angle(nOld, nNew) };
  }
  const dvVec = add(best.vNew, best.v, -1);
  const burns = [{ t: best.tb, dv: toPNR(best.r, best.v, dvVec), label: "plane" }];
  // the passes after the burn: the one it was aimed at, how close
  const after = { ...c, r: best.r, v: best.vNew };
  const passes = sitePasses(after, { ...site, at: (dt) => site.at(dt + best!.tb) }, { orbits }).map((p) => ({ ...p, t: p.t + best!.tb }));
  const hit = passes.reduce<Pass | null>((a, p) => (!a || Math.abs(p.t - best!.ta) < Math.abs(a.t - best!.ta) ? p : a), null);
  const pre = already ? `In reach already (a pass in ${fmt(already.t)}, ${km(already.across)} off) — this lines it up: ` : "";
  const note = `${pre}over ${site.name}: the plane turned ${((best.di * 180) / Math.PI).toFixed(2)}° in ${fmt(best.tb)}, the pass over it in ${fmt(hit?.t ?? best.ta)}${hit ? `, ${km(hit.across)} off` : ""}`;
  // (the cost as the autopilot flies it: the velocity turned along the orbital frame — the arc v·Δi,
  // a little more than the chord)
  return { ok: true, note, burns, dvTotal: len(followDv(burns[0]!.dv, len(best.v))), after: elements(c.mu, best.r, best.vNew, c.pole ?? [0, 0, 1]) };
}
