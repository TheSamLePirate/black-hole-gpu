import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";

/** Docked to the Endurance: in the flown craft's assembly (a link of the fleet's). */
const docked = () => fleet.assembly(fleet.active).includes(fleet.active === "endurance" ? "ranger" : "endurance");
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// PLAN-VAISSEAUX X2c: the Endurance on Gargantua's side, a mothership — the Ranger put 150 m off its fore port at its
// speed stays there (its orbit is the scene's, exact), drifts in on its thrusters, is captured, held on the port as
// the orbit carries both, and undocks on the springs.

// (the fleet's flown craft handed to a test's headless controller — given back after)
const activePose = fleet.activePose;
afterEach(() => {
  fleet.activePose = activePose;
  fleetStart(0, "ranger");
});

function byEndurance() {
  const P = presets["Gargantua: the Ranger by the Endurance"]!;
  setSceneTime(P.time ?? 0);
  fleet.active = "ranger";
  const s = { ...defaultSettings(), ...P, timeSpeed: 1 / M_SECONDS, animate: true };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const msgs: string[] = [];
  c.onPilotMessage = (m) => msgs.push(m);
  c.time = P.time ?? 0;
  c.setPilot(true);
  c.newFlight();
  c.sync();
  expect(c.placeByHoleEndurance(150)).toMatch(/150 m/);
  const fly = (sec: number, until?: () => boolean) => {
    for (let i = 0; i < sec * 30; i++) {
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
      // (the scene's clock on the flight's, as the page keeps it: the view's time — viewTime — reads it)
      setSceneTime(c.time);
      if (until?.()) return i / 30;
    }
    return sec;
  };
  return { c, msgs, fly, s };
}

test("placed 150 m off its fore port at its speed: the panel reads 150 m, and it stays there", () => {
  const { c, fly } = byEndurance();
  fly(0.2);
  const d0 = c.holeDock!;
  expect(d0).toBeTruthy();
  expect(d0.title).toBe("Endurance");
  // (150 m on the map; in the rest frame of a craft at a quarter of light's speed by the hole, 3 % longer)
  expect(Math.abs(d0.range - 150)).toBeLessThan(8);
  expect(d0.angle).toBeLessThan(2);
  fly(60);
  const d1 = c.holeDock!;
  console.log(
    `  ${d0.range.toFixed(2)} m → after 60 s ${d1.range.toFixed(2)} m, closing ${d1.closing.toFixed(3)} m/s, ${d1.lateral.toFixed(2)} m across`,
  );
  expect(Math.abs(d1.range - d0.range)).toBeLessThan(3);
  // (the renderer reads it on the view's clock: the scene's, which the page keeps on the flight's)
  setSceneTime(c.nowTime());
  expect(c.holeCraft()).toBeTruthy();
}, 120_000);

test("closing at 0.2 m/s on the RCS: captured on the port, held as the orbit carries it, undocked on the springs", () => {
  const { c, fly, msgs } = byEndurance();
  fly(0.2);
  // (the RCS pushing the craft back along its axis — its rear hatch to the port — until it closes at ~0.2 m/s, then let go)
  const back = "KeyN";
  c.codes.add(back);
  fly(12, () => (c.holeDock?.closing ?? 0) > 0.2);
  c.codes.delete(back);
  const trace: string[] = [];
  let k = 0;
  const t = fly(900, () => {
    if (k++ % 300 === 0)
      trace.push(
        `${(k / 30).toFixed(0)}s ${c.holeDock ? `${c.holeDock.range.toFixed(1)}m ${c.holeDock.closing.toFixed(2)} ${c.holeDock.lateral.toFixed(2)} ${c.holeDock.angle.toFixed(1)}°` : "—"}`,
      );
    return docked();
  });
  if (!docked()) console.log(trace.join(" | "));
  console.log(`  ${msgs.filter((m) => /Docked|Undocked/.test(m)).join(" · ")} after ${t.toFixed(0)} s`);
  expect(docked()).toBe(true);
  expect(msgs.some((m) => /^Docked to the Endurance/.test(m))).toBe(true);
  fly(30);
  expect(docked()).toBe(true);
  c.undock();
  expect(docked()).toBe(false);
  fly(10);
  const d = c.holeDock!;
  console.log(`  undocked: ${d.range.toFixed(2)} m, closing ${d.closing.toFixed(3)} m/s`);
  expect(d.closing).toBeLessThan(-0.03);
}, 300_000);

test("B by Gargantua: the docking autopilot takes the Ranger from 150 m to the Endurance's port", () => {
  const { c, fly, msgs } = byEndurance();
  fly(0.2);
  c.pilot.setAuto("dock");
  const phases = new Set<string>();
  const t = fly(900, () => {
    if (c.dockAuto?.phase) phases.add(c.dockAuto.phase);
    return docked();
  });
  console.log(`  ${[...phases].join(" → ")} · ${msgs.filter((m) => /Docked/.test(m)).join("")} after ${t.toFixed(0)} s`);
  expect(docked()).toBe(true);
  expect(c.pilot.auto).toBe("none");
}, 300_000);

test("Mann, the film's docking: the Endurance tumbling at 3 rpm — B matches its turn and docks", () => {
  const P = presets["Mann: the tumbling Endurance"]!;
  setSceneTime(P.time ?? 0);
  fleet.active = "ranger";
  const s = { ...defaultSettings(), ...P, timeSpeed: 1 / M_SECONDS, animate: true };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const msgs: string[] = [];
  c.onPilotMessage = (m) => msgs.push(m);
  c.time = P.time ?? 0;
  c.setPilot(true);
  c.newFlight();
  c.sync();
  c.placeByHoleEndurance(150);
  const fly = (sec: number, until?: () => boolean) => {
    for (let i = 0; i < sec * 30; i++) {
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
      // (the scene's clock on the flight's, as the page keeps it: the view's time — viewTime — reads it)
      setSceneTime(c.time);
      if (until?.()) return i / 30;
    }
    return sec;
  };
  fly(0.2);
  const spin0 = c.holeDock!.spin;
  c.pilot.setAuto("dock");
  let worstSpin = 0;
  const trace: string[] = [];
  let k = 0;
  const t = fly(900, () => {
    if ((c.holeDock?.along ?? 99) < 12) worstSpin = Math.max(worstSpin, c.holeDock?.spin ?? 0);
    if (k++ % 900 === 0) {
      const g = c.holeDock;
      trace.push(
        `${Math.round(k / 30)}s ${c.dockAuto?.phase ?? "-"} ${g ? `${g.range.toFixed(1)}m a${g.along.toFixed(1)} l${g.lateral.toFixed(2)} ${g.angle.toFixed(1)}° spin${g.spin.toFixed(1)} cl${g.closing.toFixed(2)}` : "—"} local:${!!c.local}`,
      );
    }
    return docked();
  });
  if (!docked()) console.log(trace.join("\n"));
  void k;
  console.log(
    `  turns apart at the start ${spin0.toFixed(1)}°/s · ${msgs.filter((m) => /Docked/.test(m)).join("")} after ${t.toFixed(0)} s · the last 12 m at most ${worstSpin.toFixed(2)}°/s apart`,
  );
  expect(spin0).toBeGreaterThan(15);
  expect(docked()).toBe(true);
  expect(worstSpin).toBeLessThan(3);
}, 300_000);

test("docked by Gargantua: [ flies the Endurance (the Ranger with it), undock leaves the Ranger coasting beside it, [ back to the Ranger, B docks again", () => {
  const { c, fly, msgs } = byEndurance();
  fly(0.2);
  c.pilot.setAuto("dock");
  fly(900, () => docked());
  expect(docked()).toBe(true);
  // the Endurance flown, the Ranger docked to it
  expect(c.switchVessel("endurance")).toBeNull();
  expect(fleet.active).toBe("endurance");
  expect(fleet.assembly("endurance")).toContain("ranger");
  fly(5);
  const items = c.holeCraft()!.items.map((q) => q.id);
  expect(items).toContain("ranger");
  expect(c.holeCraft()!.hideCinematic).toBe(true);
  // a push of its engines: the assembly moves (the Ranger with it)
  c.pilot.throttle = 0.3;
  fly(3);
  c.pilot.throttle = 0;
  // (its engines spooled down — 1.5 s a time constant — before letting go)
  fly(10);
  // the Ranger let go: it coasts on its own geodesic, 5 cm/s off
  c.undock();
  expect(fleet.hole.ranger).toBeTruthy();
  fly(20);
  const d1 = c.holeDock!;
  console.log(
    `  flying the Endurance, the Ranger undocked: ${d1.range.toFixed(2)} m, opening at ${(-d1.closing).toFixed(3)} m/s · ${msgs.filter((m) => /Flying|Undocked/.test(m)).join(" · ")}`,
  );
  expect(d1.target).toBe("ranger");
  expect(d1.closing).toBeLessThan(-0.03);
  // back to the Ranger: the Endurance left coasting beside it
  expect(c.switchVessel("ranger")).toBeNull();
  expect(fleet.active).toBe("ranger");
  expect(fleet.hole.endurance).toBeTruthy();
  fly(30);
  const d2 = c.holeDock!;
  expect(d2.target).toBe("endurance");
  expect(d2.range).toBeLessThan(10);
  c.pilot.setAuto("dock");
  const tr: string[] = [];
  let kk = 0;
  const t = fly(600, () => {
    if (kk++ % 900 === 0) {
      const g = c.holeDock;
      tr.push(
        `${Math.round(kk / 30)}s ${c.pilot.auto} ${c.dockAuto?.phase ?? "-"} ${g ? `a${g.along.toFixed(2)} l${g.lateral.toFixed(2)} ${g.angle.toFixed(1)}° lr${g.lateralRate.toFixed(3)} cl${g.closing.toFixed(3)} sp${g.spin.toFixed(2)}` : "—"}`,
      );
    }
    return docked();
  });
  if (!docked()) console.log(tr.join("\n"), msgs.slice(-3));
  console.log(`  back on the Ranger, ${d2.range.toFixed(2)} m off: docked again after ${t.toFixed(0)} s`);
  expect(docked()).toBe(true);
}, 600_000);

test("through the wormhole docked: the Endurance with the Ranger on its hub, from the Earth to Gargantua and back — the link kept, drawn, undocked there", async () => {
  const { setHolePose, setHomePose } = await import("../src/camera");
  const { zamoBeta } = await import("../src/landing");
  const { sphericalFrame } = await import("../src/wormhole");
  // our side: the Endurance flown, the Ranger docked to its fore port (the fleet's start)
  setSceneTime(0);
  const starts = fleetStart(0, "endurance");
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Endurance, 800 km up"]!,
    vessel: "endurance" as const,
    timeSpeed: 1 / M_SECONDS,
    animate: true,
  };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  fleet.activePose = () => c.activePoseNow();
  const step = (sec: number) => {
    for (let i = 0; i < sec * 30; i++) {
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
      setSceneTime(c.time);
    }
  };
  c.time = 0;
  c.setPilot(true);
  c.newFlight();
  c.flyFrom(starts.endurance);
  c.settleMount();
  c.sync();
  step(0.2);
  expect(fleet.assembly("endurance")).toContain("ranger");
  // across: the assembly put on a circle about Gargantua (18 M, equatorial), as a crossing leaves it
  const r = 18;
  const X: [number, number, number] = [r, 0, 0];
  const om = 1 / (r ** 1.5 + s.spin);
  const b = zamoBeta(X, [0, r * om, 0], s.spin);
  const f = sphericalFrame(X);
  const v = [0, 1, 2].map((k) => f.er[k]! * b[0] + f.et[k]! * b[1] + f.ep[k]! * b[2]) as [number, number, number];
  setHolePose(s, X, [0, 1, 0], [0, 0, 1], v);
  s.motion = "geodesic";
  c.sync();
  step(1);
  expect(fleet.assembly("endurance")).toContain("ranger");
  const drawn = c.holeCraft()!.items.find((q) => q.id === "ranger");
  console.log(
    `  by Gargantua, docked: the Ranger drawn ${drawn ? `${Math.hypot(...drawn.rel).toFixed(1)} m from the Endurance's origin` : "—"}`,
  );
  expect(drawn).toBeTruthy();
  // undocked there: the Ranger coasts on its own geodesic beside it
  c.undock();
  expect(fleet.hole.ranger).toBeTruthy();
  step(10);
  expect(c.holeDock?.target).toBe("ranger");
  expect(c.holeDock!.closing).toBeLessThan(-0.03);
  // back to our side docked: dock again by Gargantua (the Ranger flown, B), then the assembly put back near the Earth
  expect(c.switchVessel("ranger")).toBeNull();
  step(1);
  c.pilot.setAuto("dock");
  for (let i = 0; i < 600 && !fleet.assembly("ranger").includes("endurance"); i++) step(1);
  expect(fleet.assembly("ranger")).toContain("endurance");
  setHomePose(s, starts.ranger.X, starts.ranger.ax[2], starts.ranger.ax[1], starts.ranger.V);
  c.sync();
  step(1);
  const E = fleet.pose("endurance", c.nowTime());
  console.log(`  back by the Earth, docked: the Endurance ${E ? "carried with the Ranger" : "lost"}`);
  expect(E).toBeTruthy();
}, 600_000);
