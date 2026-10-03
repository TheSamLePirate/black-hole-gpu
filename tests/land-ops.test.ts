import { test, expect } from "bun:test";
import { alignOverSite, firstReachable, sitePasses, type SiteTrack } from "../src/fc/land-ops";
import { afterBurns, type FcContext } from "../src/fc/ops";
import { elements, type V3 } from "../src/fc/kepler";

// An Earth: its GM, its radius, turning about z once a sidereal day.
const mu = 3.986004418e14, R = 6371e3, w = 7.2921159e-5;
const D = Math.PI / 180;
/** a circular orbit at h, inclined i, its node on +x, the craft at the argument of latitude u */
function orbit(h: number, i: number, u: number): FcContext {
  const r = R + h, v = Math.sqrt(mu / r);
  const pos: V3 = [r * Math.cos(u), r * Math.sin(u) * Math.cos(i), r * Math.sin(u) * Math.sin(i)];
  const vel: V3 = [-v * Math.sin(u), v * Math.cos(u) * Math.cos(i), v * Math.cos(u) * Math.sin(i)];
  return { mu, R, r: pos, v: vel, pole: [0, 0, 1] };
}
/** a site at a latitude and longitude (at dt = 0), turning with the Earth */
const site = (lat: number, lon: number, reach = 600e3): SiteTrack => ({
  name: "the site", reach,
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
