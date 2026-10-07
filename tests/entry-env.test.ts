import { expect, test } from "bun:test";
import { envOf } from "../src/entry-env";
import { gameTimeOf, issOrbit } from "../src/system/iss";
import { coastHome } from "../src/system/our-coast";
import { M_METRES, M_SECONDS, solarState } from "../src/system/solar";
import { C_MPS } from "../src/units";
import { sub } from "../src/math/vec3";
import type { V3 } from "../src/aero";

// An entry's frame on our side: the deorbit planner's coast is the flight's own (rails, the air's drag,
// every body's pull) — days of orbits on, gravity and the oblateness alone are hundreds of km off it.

const t = gameTimeOf(Date.UTC(2026, 9, 1, 12));
const E = solarState("earth", t);
const iss = issOrbit(t)!;
const env = envOf({ universe: "ours", body: "earth", t, massSolar: 1e8 })!;
const s0 = { x: sub(iss.X, E.pos).map((c) => c * M_METRES) as V3, v: sub(iss.V, E.vel).map((c) => c * C_MPS) as V3 };

test("the planner's coast is the flight's: a day of the station's orbit, the same place to a metre", () => {
  const dt = 86400;
  const tM = dt / M_SECONDS;
  let S = { X: iss.X, V: iss.V, t };
  while (S.t < t + tM - 1e-12) S = coastHome(S.X, S.V, S.t, t + tM - S.t);
  const B = solarState("earth", S.t);
  const want = sub(S.X, B.pos).map((c) => c * M_METRES);
  const got = env.coast!(s0, 0, dt);
  expect(Math.hypot(...got.x.map((c, i) => c - want[i]!))).toBeLessThan(1);
});

test("six days of the station's orbit: gravity alone runs hundreds of km off the flight's coast", () => {
  const dt = 6 * 86400;
  const a = env.coast!(s0, 0, dt);
  let x = s0.x,
    v = s0.v;
  const h = 10;
  for (let k = 0; k < dt / h; k++) {
    const g1 = env.gravity(x, v);
    const vm = v.map((c, i) => c + (g1[i]! * h) / 2) as V3;
    const xm = x.map((c, i) => c + (v[i]! * h) / 2) as V3;
    const g2 = env.gravity(xm, vm);
    x = x.map((c, i) => c + vm[i]! * h) as V3;
    v = v.map((c, i) => c + g2[i]! * h) as V3;
  }
  // (the air's drag over six days: the pass a minute late — at Kennedy's latitude the ground 30 km on)
  expect(Math.hypot(...a.x.map((c, i) => c - x[i]!)) / 1e3).toBeGreaterThan(200);
}, 60000);
