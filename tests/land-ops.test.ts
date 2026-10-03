import { test, expect } from "bun:test";
import { alignOverSite, firstReachable, sitePasses, type SiteTrack } from "../src/fc/land-ops";
import { afterBurns, type FcContext } from "../src/fc/ops";
import { add, elements, followDv, fromPNR, len, propagate, scale, unit, type V3 } from "../src/fc/kepler";

// An Earth: its GM, its radius, turning about z once a sidereal day.
const mu = 3.986004418e14,
  R = 6371e3,
  w = 7.2921159e-5;
const D = Math.PI / 180;
/** a circular orbit at h, inclined i, its node on +x, the craft at the argument of latitude u */
function orbit(h: number, i: number, u: number): FcContext {
  const r = R + h,
    v = Math.sqrt(mu / r);
  const pos: V3 = [r * Math.cos(u), r * Math.sin(u) * Math.cos(i), r * Math.sin(u) * Math.sin(i)];
  const vel: V3 = [-v * Math.sin(u), v * Math.cos(u) * Math.cos(i), v * Math.cos(u) * Math.sin(i)];
  return { mu, R, r: pos, v: vel, pole: [0, 0, 1] };
}
/** a site at a latitude and longitude (at dt = 0), turning with the Earth */
const site = (lat: number, lon: number, reach = 600e3): SiteTrack => ({
  name: "the site",
  reach,
  at: (dt) => {
    const l = lon * D + w * dt;
    return [R * Math.cos(lat * D) * Math.cos(l), R * Math.cos(lat * D) * Math.sin(l), R * Math.sin(lat * D)];
  },
});

test("an orbit inclined 23.9° never passes within reach of a site at 55° N", () => {
  const c = orbit(400e3, 23.9 * D, 0);
  const p = sitePasses(c, site(55, 30));
  expect(p.length).toBeGreaterThan(5);
  // (the closest it gets: the latitudes apart, ~31° of arc)
  expect(Math.min(...p.map((q) => q.across))).toBeGreaterThan(3000e3);
  expect(firstReachable(p, 600e3)).toBeNull();
});

test("a site under the orbit's latitudes: a pass within reach in a day, northbound and southbound ones", () => {
  const c = orbit(400e3, 51.6 * D, 0);
  const p = sitePasses(c, site(20, 40));
  // (one pass an orbit, its track shifted ~22.5° west each time by the Earth's turn)
  expect(p.length).toBeGreaterThan(12);
  expect(firstReachable(p, 600e3)).not.toBeNull();
  expect(new Set(p.map((q) => q.north)).size).toBe(2);
});

test("aligning over a site out of reach: one plane change, then a pass over it within a few km", () => {
  const c = orbit(400e3, 23.9 * D, 0);
  const st = site(55, 30, 150e3);
  const r = alignOverSite(c, st);
  expect(r.ok).toBe(true);
  expect(r.burns.length).toBe(1);
  // (the plane turned to at least the site's latitude: inclined ≥ 55°)
  expect((r.after!.i * 180) / Math.PI).toBeGreaterThanOrEqual(54.5);
  // the burn mostly normal (a plane change), its speed kept
  const b = r.burns[0]!;
  expect(Math.abs(b.dv[1])).toBeGreaterThan(Math.abs(b.dv[0]));
  // after it, a pass over the site within a few km
  const s = afterBurns(c, r.burns);
  const passes = sitePasses({ ...c, r: s.r, v: s.v }, { ...st, at: (dt) => st.at(dt + s.t) });
  const hit = firstReachable(passes, 30e3);
  expect(hit).not.toBeNull();
  // the plane change's cost: about 2 v sin(Δi/2)
  const v = Math.sqrt(mu / (R + 400e3));
  const di = elements(mu, s.r, s.v).i - 23.9 * D;
  expect(r.dvTotal).toBeGreaterThan(2 * v * Math.sin(Math.abs(di) / 2) * 0.8);
});

test("a site already near the track: a small trim, the note says it is in reach", () => {
  const c = orbit(400e3, 51.6 * D, 0);
  const r = alignOverSite(c, site(20, 40));
  expect(r.ok).toBe(true);
  expect(r.note).toContain("In reach already");
  expect(r.dvTotal).toBeLessThan(800);
});

test("followDv: a small Δv itself; a plane change flown as an arc, the speed kept", () => {
  const v = 7670;
  const small = followDv([3, 2, -1], v);
  expect(Math.abs(small[0] - 3)).toBeLessThan(0.01);
  expect(Math.abs(small[1] - 2)).toBeLessThan(0.01);
  // (a Hohmann's: untouched)
  expect(followDv([-120, 0, 0], v)).toEqual([-120, 0, 0]);
  // (a plane change of 25°: the chord's −9 % along the prograde becomes nothing, its normal the arc v·Δi)
  const di = 25 * D;
  const f = followDv([v * (Math.cos(di) - 1), v * Math.sin(di), 0], v);
  expect(Math.abs(f[0])).toBeLessThan(1e-6);
  expect(f[1]).toBeCloseTo(v * di, 3);
});

test("the alignment flown as the autopilot flies it — a finite burn along the orbital frame — still in orbit, over the site", () => {
  // (the Paris case: 400 km at 23.9°, a site at 49° N — the plane turned ~25°)
  const c = orbit(400e3, 23.9 * D, 0);
  const st = site(48.96, 2.44, 600e3);
  const r = alignOverSite(c, st, { lead: 300 });
  expect(r.ok).toBe(true);
  const b = r.burns[0]!;
  // the flight: Kepler to the burn's start, then the burn (RK4, 1 s steps) at 15 m/s² along the frame
  const a = 15;
  const at0 = propagate(mu, c.r, c.v, b.t);
  const fdv = followDv(b.dv, len(at0.v));
  const total = len(fdv),
    burnT = total / a;
  let s = propagate(mu, c.r, c.v, b.t - burnT / 2);
  const acc = (x: V3, v: V3): V3 => add(scale(x, -mu / len(x) ** 3), scale(unit(fromPNR(x, v, fdv)), a));
  let done = 0;
  while (done < total) {
    const h = Math.min(1, (total - done) / a);
    const k1v = acc(s.r, s.v),
      k1x = s.v;
    const k2v = acc(add(s.r, k1x, h / 2), add(s.v, k1v, h / 2)),
      k2x = add(s.v, k1v, h / 2);
    const k3v = acc(add(s.r, k2x, h / 2), add(s.v, k2v, h / 2)),
      k3x = add(s.v, k2v, h / 2);
    const k4v = acc(add(s.r, k3x, h), add(s.v, k3v, h)),
      k4x = add(s.v, k3v, h);
    s = { r: add(s.r, add(add(k1x, k4x), add(k2x, k3x), 2), h / 6), v: add(s.v, add(add(k1v, k4v), add(k2v, k3v), 2), h / 6) };
    done += a * h;
  }
  const tEnd = b.t + burnT / 2;
  const el = elements(mu, s.r, s.v, [0, 0, 1]);
  // (in orbit still: the chord's prograde flown along the turning frame left the periapsis ~250 km under the ground)
  expect(el.rp - R).toBeGreaterThan(330e3);
  expect(Math.abs(el.i - r.after!.i)).toBeLessThan(0.5 * D);
  // (a pass over the site in reach of the entry)
  const after = { ...c, r: s.r, v: s.v };
  const passes = sitePasses(after, { ...st, at: (dt) => st.at(dt + tEnd) });
  expect(firstReachable(passes, 600e3)).not.toBeNull();
  expect(Math.min(...passes.map((p) => p.across))).toBeLessThan(150e3);
});
