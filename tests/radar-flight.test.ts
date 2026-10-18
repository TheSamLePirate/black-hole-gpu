import { afterEach, describe, expect, test } from "bun:test";
import { ourGroundPoseOn } from "../src/game/place";
import { SCENARIOS } from "../src/game/scenarios";
import { add, scale } from "../src/math/vec3";
import { groundVelocity } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The F-35's radar in the controller (docs/PLAN-AVIATION-AAA.md, C1; controller/radar.ts): a fight's targets swept
// at its start, the lock on Tab its world's lock too; its picture for the HUD (heading up) and the TSD.

afterEach(resetFlights);

const D = Math.PI / 180;

/** The F-35 at a scenario's start (its anchor's east, north offsets), flying its heading at its speed. */
function atStart(id: string) {
  const sc = SCENARIOS.find((x) => x.id === id)!;
  const lat = sc.anchor.lat + sc.start.n / (D * 6_371_008.8);
  const lon = sc.anchor.lon + sc.start.e / (D * 6_371_008.8 * Math.cos(sc.anchor.lat * D));
  const g = ourGroundPoseOn("earth", lat, lon, 0, null, sc.start.hdg);
  const X = add(g.X, scale(g.up, (sc.start.agl + 800) / M_METRES));
  const run = flight(
    { ...g, X, vel: add(groundVelocity("earth", X, 0), scale(g.fwd, sc.start.speed / C_MPS)), landed: undefined },
    false,
    "f35",
  );
  run.c.s.flightMode = "plane";
  run.c.pilot.throttle = run.c.pilot.engineNow = 0.85;
  run.fly(0.5);
  run.c.combatStart(sc);
  return { ...run, sc };
}

describe("the F-35's radar in a fight", () => {
  test("the drone hunt: its drones before the nose swept at once — tracked, hostile", () => {
    const { c, fly } = atStart("drones");
    fly(0.2);
    const tracks = [...c.radar.tracks.values()].filter((T) => T.id.startsWith("cmb:"));
    console.log(
      `  ${tracks.length} tracks: ${tracks.map((T) => `${T.name} ${(Math.hypot(...T.r) / 1000).toFixed(1)} km ${T.iff}`).join(", ")}`,
    );
    expect(tracks.length).toBeGreaterThanOrEqual(3);
    expect(tracks.every((T) => T.iff === "hostile")).toBe(true);
    // (the world's seen: the radar's own tracks)
    expect(c.combat!.world.seen.length).toBe(tracks.length);
  });

  test("Tab: the nearest locked — the world's lock too; again, the next", () => {
    const { c, fly } = atStart("drones");
    fly(0.2);
    const said = c.combatTrigger("lock")!;
    const W = c.combat!.world;
    console.log(`  ${said}`);
    expect(c.radar.lock?.startsWith("cmb:")).toBe(true);
    expect(W.lock).toBe(Number(c.radar.lock!.slice(4)));
    const first = c.radar.lock;
    c.combatTrigger("lock");
    expect(c.radar.lock).not.toBe(first);
    fly(0.5);
    expect(W.lock).toBe(Number(c.radar.lock!.slice(4)));
  });

  test("Tab before any contact (the fight's first sweep not yet done): searching — the first contact locked as it comes", () => {
    const { c, fly } = atStart("drones");
    // (as at a match's start: its craft placed, nothing swept yet)
    c.radar.reset();
    c.radarSweep = false;
    const said = c.combatTrigger("lock")!;
    console.log(`  ${said}`);
    expect(said).toMatch(/searching/);
    expect(c.radar.lock).toBeNull();
    fly(0.5);
    expect(c.radar.lock?.startsWith("cmb:")).toBe(true);
    expect(c.combat!.world.lock).toBe(Number(c.radar.lock!.slice(4)));
    expect(c.radarLockWant).toBeUndefined();
  });

  test("its picture: heading up, the lock's range and closure", () => {
    const { c, fly } = atStart("drones");
    fly(0.2);
    c.combatTrigger("lock");
    const P = c.radarHud()!;
    const L = P.lock!;
    const C = P.contacts.find((x) => x.locked)!;
    console.log(`  ${P.mode} · lock ${L.name} ${(L.range / 1000).toFixed(1)} km, closing ${L.closure.toFixed(0)} m/s`);
    expect(Math.hypot(C.x, C.y)).toBeCloseTo(Math.hypot(L.r[0], L.r[1]), 0);
    expect(L.range).toBeGreaterThan(1000);
    expect(P.mode).toBe("TWS");
  });
});
