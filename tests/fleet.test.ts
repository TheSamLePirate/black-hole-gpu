import { test, expect } from "bun:test";
import { dockedFrame, VESSELS, type VesselId } from "../src/vessels";
import { fleet, fleetStart, type Pose } from "../src/fleet";
import { M_METRES, solarBody } from "../src/system/solar";
import { ourState } from "../src/system/our-side";
import { gameTimeOf } from "../src/system/iss";

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const on = (ax: [V, V, V], v: V): V => [0, 1, 2].map((i) => ax[0][i]! * v[0] + ax[1][i]! * v[1] + ax[2][i]! * v[2]) as V;

test("docked: the two rings together, the ports' axes facing, the guest's frame a rotation", () => {
  const pairs: [VesselId, number, VesselId, number][] = [
    ["ranger", 0, "endurance", 0],
    ["lander", 0, "endurance", 1],
    ["ranger", 0, "lander", 0],
    ["lander", 0, "ranger", 0],
  ];
  for (const [g, gp, hst, hp] of pairs) {
    const guest = VESSELS[g].ports[gp]!,
      host = VESSELS[hst].ports[hp]!;
    const { c, ax } = dockedFrame(guest, host, [0, 1, 0]);
    // the guest's port, in the host's frame: on the host's, its axis against it
    const ring = on(ax, guest.centre).map((x, i) => x + c[i]!) as V;
    for (let i = 0; i < 3; i++) expect(ring[i]!).toBeCloseTo(host.centre[i]!, 9);
    expect(dot(on(ax, guest.axis), host.axis)).toBeCloseTo(-1, 9);
    // (orthonormal, right-handed)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(dot(ax[i]!, ax[j]!)).toBeCloseTo(i === j ? 1 : 0, 9);
    const cr: V = [
      ax[0][1] * ax[1][2] - ax[0][2] * ax[1][1],
      ax[0][2] * ax[1][0] - ax[0][0] * ax[1][2],
      ax[0][0] * ax[1][1] - ax[0][1] * ax[1][0],
    ];
    expect(dot(cr, ax[2])).toBeCloseTo(1, 9);
  }
});

test("the fleet's start: the Endurance 800 km up, the Lander 500 km up, the Ranger on the Endurance's fore port", () => {
  const t = gameTimeOf(Date.UTC(2026, 9, 2, 12));
  const starts = fleetStart(t, "lander");
  const E = ourState("earth", t);
  const R = solarBody("earth")!.radius;
  const alt = (p: Pose) => ((Math.hypot(p.X[0] - E.pos[0], p.X[1] - E.pos[1], p.X[2] - E.pos[2]) - R) * M_METRES) / 1e3;
  expect(alt(starts.endurance)).toBeCloseTo(800, 3);
  expect(alt(starts.lander)).toBeCloseTo(500, 3);
  // (the Lander flown: the camera gives its place)
  fleet.activePose = () => ({ ...starts.lander, t });
  // the Ranger, docked on the Endurance (coasting as it): its rear ring on the hub's fore port
  const pe = fleet.pose("endurance", t)!,
    pr = fleet.pose("ranger", t)!;
  const ringR = on(pr.ax, VESSELS.ranger.ports[0]!.centre).map((x, i) => pr.X[i]! + x / M_METRES) as V;
  const portE = on(pe.ax, VESSELS.endurance.ports[0]!.centre).map((x, i) => pe.X[i]! + x / M_METRES) as V;
  expect(Math.hypot(ringR[0] - portE[0], ringR[1] - portE[1], ringR[2] - portE[2]) * M_METRES).toBeLessThan(1e-3);
  // coasting: a Kepler orbit — an orbit later, back where it was
  const mu = solarBody("earth")!.mass;
  const r = 6371e3 + 800e3;
  const T = 2 * Math.PI * Math.sqrt((r / M_METRES) ** 3 / mu);
  const later = fleet.pose("endurance", t + T)!;
  const E2 = ourState("earth", t + T);
  const d0: V = [pe.X[0] - E.pos[0], pe.X[1] - E.pos[1], pe.X[2] - E.pos[2]];
  const d1: V = [later.X[0] - E2.pos[0], later.X[1] - E2.pos[1], later.X[2] - E2.pos[2]];
  expect(Math.hypot(d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]) * M_METRES).toBeLessThan(500);
});

test("an assembly's mass, centre of mass and moment of inertia (the flown craft's frame)", () => {
  const t = gameTimeOf(Date.UTC(2026, 9, 2, 12));
  const starts = fleetStart(t, "endurance");
  fleet.activePose = () => ({ ...starts.endurance, t });
  const mp = fleet.massProps();
  expect(mp.mass).toBe(VESSELS.endurance.mass + VESSELS.ranger.mass);
  // (the Ranger forward of the hub: the centre of mass moved along +z, by its share)
  expect(mp.com[2]).toBeGreaterThan(0);
  expect(mp.com[2]).toBeLessThan(2);
  expect(mp.inertia).toBeGreaterThan(mp.own);
  // switching the craft flown leaves the docking where it was
  const pr = fleet.pose("ranger", t)!;
  fleet.active = "ranger";
  fleet.activePose = () => ({ ...pr, t });
  const pe = fleet.pose("endurance", t)!;
  expect(
    Math.hypot(pe.X[0] - starts.endurance.X[0], pe.X[1] - starts.endurance.X[1], pe.X[2] - starts.endurance.X[2]) * M_METRES,
  ).toBeLessThan(1e-3);
  for (let i = 0; i < 3; i++) expect(dot(pe.ax[i]!, starts.endurance.ax[i]!)).toBeCloseTo(1, 9);
});
