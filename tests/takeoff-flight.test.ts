import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { cross, dot, len, sub } from "../src/math/vec3";
import { ourState } from "../src/system/our-side";
import { solarBody } from "../src/system/solar";
import { M_METRES } from "../src/units";
import { flight, resetFlights, TRANQUILITY } from "./helpers/flight";

// The take-off autopilot flown frame by frame by the controller itself (no page): from the ground to the
// orbit its launch goal asks, then circularized there — judged on the orbit's height against the goal.

afterEach(resetFlights);

/** The craft's two-body orbit about a body now: its low and high points over the mean radius [km]. */
function apsides(c: ReturnType<typeof flight>["c"], body: string) {
  const P = c.activePoseNow() as unknown as { X: [number, number, number]; V: [number, number, number]; t: number };
  const B = ourState(body, P.t);
  const r = sub(P.X, B.pos),
    v = sub(P.V, B.vel);
  const sb = solarBody(body)!;
  const mu = sb.mass;
  const a = -mu / (2 * (dot(v, v) / 2 - mu / len(r)));
  const h = len(cross(r, v));
  const e = Math.sqrt(Math.max(1 - (h * h) / (mu * a), 0));
  const km = M_METRES / 1e3;
  return { pe: (a * (1 - e) - sb.radius) * km, ap: (a * (1 + e) - sb.radius) * km };
}

test("from Tranquility to a 100 km orbit: circular at the height asked, not 4 % above it", () => {
  const g = ourGroundPose("moon", TRANQUILITY.lat, TRANQUILITY.lon, 0);
  const { c, msgs, fly } = flight({ ...g, landed: g.landed }, false);
  c.launchGoal = { altKm: 100, incDeg: null };
  c.pilot.auto = "none";
  c.pilot.setAuto("takeoff");
  fly(3 * 3600, () => msgs.some((m) => /In orbit around/.test(m)));
  fly(3 * 3600, () => c.pilot.auto === "none");
  expect(msgs.some((m) => /Circular/.test(m))).toBe(true);
  const o = apsides(c, "moon");
  // (the climb aimed 4 % past its top coasted on to it: 104.7 × 105.6 km)
  expect(Math.abs(o.pe - 100)).toBeLessThan(2);
  expect(Math.abs(o.ap - 100)).toBeLessThan(2);
}, 120_000);
