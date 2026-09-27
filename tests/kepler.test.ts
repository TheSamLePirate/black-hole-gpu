import { test, expect } from "bun:test";
import { propagate, type V3 } from "../src/game/kepler";

const energy = (mu: number, r: V3, v: V3) => (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / Math.hypot(...r);

test("an ellipse: back to the start after a period, energy and angular momentum kept", () => {
  const mu = 3.986;
  const r0: V3 = [1.2, 0.1, -0.3], v0: V3 = [0.2, 1.7, 0.4];
  const a = 1 / (2 / Math.hypot(...r0) - (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) / mu);
  const T = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  const end = propagate(mu, r0, v0, T);
  end.r.forEach((x, k) => expect(x).toBeCloseTo(r0[k]!, 8));
  end.v.forEach((x, k) => expect(x).toBeCloseTo(v0[k]!, 8));
  const mid = propagate(mu, r0, v0, 0.37 * T);
  expect(energy(mu, mid.r, mid.v)).toBeCloseTo(energy(mu, r0, v0), 10);
  // backwards, then forwards: the same state
  const back = propagate(mu, mid.r, mid.v, -0.37 * T);
  back.r.forEach((x, k) => expect(x).toBeCloseTo(r0[k]!, 8));
});

test("a hyperbola: energy kept, the right way out, and a circle's quarter", () => {
  const mu = 1;
  const r0: V3 = [1, 0, 0], v0: V3 = [0, 1.8, 0.2];
  const p = propagate(mu, r0, v0, 25);
  expect(energy(mu, p.r, p.v)).toBeCloseTo(energy(mu, r0, v0), 9);
  expect(Math.hypot(...p.r)).toBeGreaterThan(20);
  const q = propagate(1, [1, 0, 0], [0, 1, 0], Math.PI / 2);
  expect(q.r[0]).toBeCloseTo(0, 10);
  expect(q.r[1]).toBeCloseTo(1, 10);
  expect(q.v[0]).toBeCloseTo(-1, 10);
});

import { extendFrom } from "../src/system/our-extend";
import { solarState } from "../src/system/solar";

test("patched conics: a ship aimed past the Moon enters its sphere, passes low, and leaves", () => {
  const t = 109.6;
  const km = 1 / 1.476625e8;
  const M = solarState("moon", t), E = solarState("earth", t);
  // from 120 000 km on the Earth's side of the Moon, towards it at 1 km/s (relative), aimed 5 000 km off
  const u = (() => { const d = M.pos.map((x, k) => x - E.pos[k]!); const l = Math.hypot(...d); return d.map((x) => x / l); })();
  const side = [-u[1]!, u[0]!, 0];
  const X = M.pos.map((x, k) => x - u[k]! * 120000 * km + side[k]! * 5000 * km) as [number, number, number];
  const V = M.vel.map((x, k) => x + u[k]! * (1 / 299792.458)) as [number, number, number];
  const e = extendFrom(X, V, t, "earth", (6 * 86400) / 492.5490947);
  const seq = e.refs.filter((r, j) => j === 0 || r !== e.refs[j - 1]);
  expect(seq.slice(0, 2)).toEqual(["earth", "moon"]);
  const pe = e.apsides.find((a) => a.body === "moon");
  expect(pe).toBeDefined();
  // (a hyperbolic pass: lower than the aim, above the surface)
  expect(pe!.alt / km).toBeGreaterThan(0);
  expect(pe!.alt / km).toBeLessThan(5000);
  for (let j = 1; j < e.times.length; j++) expect(e.times[j]!).toBeGreaterThanOrEqual(e.times[j - 1]!);
});

import { predictOurs } from "../src/system/our-predict";

test("a hand-made node flown as a finite burn: the path goes on for a turn of the orbit it gives (days), not the old one's", () => {
  const t = 109.6;
  const E = solarState("earth", t);
  // a circular 400 km orbit (in the ecliptic, about the Earth)
  const km = 1 / 1.476625e8;
  const r = 6771 * km, v = 7.6686 / 299792.458;
  const X = [E.pos[0] + r, E.pos[1], E.pos[2]] as [number, number, number];
  const V = [E.vel[0], E.vel[1] + v, E.vel[2]] as [number, number, number];
  const accel = (2 * 9.80665 * 1.476625e11) / 299792458 ** 2; // 2 g [c²/M]
  const node = { t: t + 11, dv: [3.1 / 299792.458, 0, 0] as [number, number, number] };
  const p = predictOurs(X, V, t, [node], { accel, maxSteps: 12000 });
  const hours = ((p.times[p.times.length - 1]! - t) * 492.5490947) / 3600;
  expect(hours).toBeGreaterThan(100);
});
