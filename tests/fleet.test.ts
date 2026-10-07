import { test, expect } from "bun:test";
import { dockedFrame, VESSELS, type VesselId } from "../src/vessels";
import { fleet, fleetStart, type Pose } from "../src/fleet";
import { M_METRES, M_SECONDS, solarBody } from "../src/system/solar";
import { coastHome } from "../src/system/our-coast";
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
  // coasting: as the flight flies it (the integrator, the rails' mean orbit) — an orbit later, its centre of
  // mass where the flight's own steps put it, turned by the node's regression and the periapsis's turn
  // (≈ 27 km along a 800 km orbit)
  const mu = solarBody("earth")!.mass;
  const r = solarBody("earth")!.radius * M_METRES + 800e3;
  const T = 2 * Math.PI * Math.sqrt((r / M_METRES) ** 3 / mu);
  const later = fleet.pose("endurance", t + T)!;
  const E2 = ourState("earth", t + T);
  const d0: V = [pe.X[0] - E.pos[0], pe.X[1] - E.pos[1], pe.X[2] - E.pos[2]];
  const d1: V = [later.X[0] - E2.pos[0], later.X[1] - E2.pos[1], later.X[2] - E2.pos[2]];
  const f = fleet.free.endurance!;
  const com = f.com ?? [0, 0, 0];
  const cm = (P: Pose) => on(P.ax, com).map((x, i) => P.X[i]! + x / M_METRES) as V;
  let S = { X: cm({ ...pe, ax: f.ax }), V: f.V },
    tt = f.t;
  while (tt < t + T - 1e-12) {
    const dt = Math.min(60 / M_SECONDS, t + T - tt);
    S = coastHome(S.X, S.V, tt, dt);
    tt += dt;
  }
  const c1 = cm(later);
  expect(Math.hypot(c1[0] - S.X[0], c1[1] - S.X[1], c1[2] - S.X[2]) * M_METRES).toBeLessThan(100);
  expect(Math.hypot(d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]) * M_METRES).toBeGreaterThan(5000);
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

test("a coasting craft's velocity is its place's own rate — the J2 drift's turn in", () => {
  // (the Endurance and the Lander coast on their mean orbits, turned by the oblateness's drift: their
  // velocity once missed that turn's share — 1.5 to 5 m/s in a low orbit —, and the docking autopilot,
  // matching it, drifted off a port it never reached)
  const start = fleetStart(109.6, "ranger");
  // (set free at a velocity, it keeps it: no jump where a craft is let go — a Ranger undocked from the
  // Endurance once met its port again at 4.4 m/s)
  for (const id of ["endurance", "lander"] as const) {
    const p = fleet.pose(id, 109.6)!;
    expect(Math.hypot(...[0, 1, 2].map((k) => p.V[k]! - start[id].V[k]!)) * 299792458).toBeLessThan(0.01);
  }
  for (const id of ["endurance", "lander"] as const)
    for (const t of [110, 140]) {
      const dt = 1e-3;
      const a = fleet.pose(id, t - dt)!,
        b = fleet.pose(id, t + dt)!,
        m = fleet.pose(id, t)!;
      const err = Math.hypot(...[0, 1, 2].map((k) => (b.X[k]! - a.X[k]!) / (2 * dt) - m.V[k]!)) * 299792458;
      // (its pose ahead on the rails' mean orbit: its velocity and its place's rate within the model's own
      // ~0.1 m/s — the drift's turn once missing was 1.5 to 5 m/s)
      expect(err).toBeLessThan(0.15);
    }
});

test("the tumbling Endurance (here 220 km up, in the air's reach): turning about its hub, the Lander on it; the map's path of it drawn in a blink", async () => {
  const { fleetSpinStart, SPIN_START } = await import("../src/fleet");
  const { ourTrack } = await import("../src/ui/map3d/scene");
  const t0 = gameTimeOf(Date.UTC(2026, 9, 1, 12));
  const P = fleetSpinStart(t0, { altKm: 220 });
  const E = ourState("earth", t0);
  const r = Math.hypot(...(P.endurance.X.map((x, i) => x - E.pos[i]!) as V)) * M_METRES;
  expect(Math.abs(r - solarBody("earth")!.radius * M_METRES - 220e3)).toBeLessThan(1e3);
  // (its turn: about its long axis, 3 rpm; the Lander turning with it, the Ranger not)
  const w = P.endurance.w!;
  expect((Math.hypot(...w) / M_SECONDS) * (60 / (2 * Math.PI))).toBeCloseTo(SPIN_START.rpm, 6);
  expect(Math.abs(dot(w as V, P.endurance.ax[2] as V)) / Math.hypot(...w)).toBeCloseTo(1, 9);
  expect(fleet.links.some((l) => l.a === "endurance" && l.b === "lander")).toBe(true);
  expect(fleet.pose("lander", t0)!.w).toEqual(w);
  // (the map's path of it — 400 samples over three hours: in the air's reach, no rails; each sample once
  // flown by the integrator from now, minutes of a frozen page — now the analytic coast, near the exact)
  const times = Array.from({ length: 400 }, (_, k) => t0 + ((k + 1) * 27) / M_SECONDS);
  const a = performance.now();
  const track = ourTrack("endurance", times);
  expect(performance.now() - a).toBeLessThan(1000);
  // (18 min on: 3 km from the flight's own — a dot on the map)
  const ex = fleet.pose("endurance", times[39]!)!.X;
  expect(Math.hypot(...(track[39]!.map((x, i) => x - ex[i]!) as V)) * M_METRES).toBeLessThan(5000);
  // (the scene's clock set far past its state — the place-and-time panel, a test's setSceneTime(0): 40
  // years on — a pose at once, not a million steps of the integrator)
  const b = performance.now();
  expect(fleet.pose("endurance", t0 + (40 * 365.25 * 86400) / M_SECONDS)).not.toBeNull();
  expect(performance.now() - b).toBeLessThan(200);
  // (the fleet as the other tests find it)
  fleetStart(t0, "ranger");
});
