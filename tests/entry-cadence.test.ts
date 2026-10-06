import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { SITES } from "../src/game/sites";
import { add, scale } from "../src/math/vec3";
import { groundVelocity } from "../src/system/our-surface";
import { M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The entry's guidance updated on the fall's own clock: every 2 s of it, however fast the frames go — the
// flight lab's fixed steps, a slow machine, the player's — not once a second of the wall's (the lab flew
// 40 s of an entry between two banks, and overflew Edwards).

afterEach(resetFlights);

test("the guidance's banks every 2 s of the fall, frames flown faster than the wall", async () => {
  const site = SITES.find((s) => s.name.startsWith("Edwards"))!;
  const g = ourGroundPose("earth", site.lat - 8, site.lon, 0);
  const X = add(g.X, scale(g.up, 55e3 / M_METRES));
  const vel = add(groundVelocity("earth", X, 0), scale(g.fwd, 5000 / 299792458));
  const { c } = flight({ ...g, X, fwd: g.fwd, up: g.up, vel, landed: undefined }, false);
  c.entrySite = site;
  c.pilot.auto = "none";
  c.pilot.setAuto("entry");
  let asked = 0,
    was = false;
  // (frames at 1/30 s flown as fast as the machine goes, the planner's answers let in between)
  for (let i = 0; i < 30 * 20; i++) {
    c.flyShip(1 / 30, null as never);
    if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    const p = !!c.entryRun?.pending;
    if (p && !was) asked++;
    was = p;
    await Promise.resolve();
  }
  // (20 s of frames at the entry's ×4: 80 s of the fall — some 40 banks, not one)
  expect(c.entryRun?.phase).toBe("entry");
  expect(asked).toBeGreaterThan(20);
}, 60_000);
