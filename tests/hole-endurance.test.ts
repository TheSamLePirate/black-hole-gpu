import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// PLAN-VAISSEAUX X2c: the Endurance on Gargantua's side, a mothership — the Ranger put 150 m off its fore port at its
// speed stays there (its orbit is the scene's, exact), drifts in on its thrusters, is captured, held on the port as
// the orbit carries both, and undocks on the springs.

afterEach(() => fleetStart(0, "ranger"));

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
    return !!c.holeDocked;
  });
  if (!c.holeDocked) console.log(trace.join(" | "));
  console.log(`  ${msgs.filter((m) => /Docked|Undocked/.test(m)).join(" · ")} after ${t.toFixed(0)} s`);
  expect(c.holeDocked).toBeTruthy();
  expect(c.docked).toBe(true);
  expect(msgs.some((m) => /^Docked to the Endurance/.test(m))).toBe(true);
  fly(30);
  expect(c.holeDocked).toBeTruthy();
  c.undock();
  expect(c.holeDocked).toBeFalsy();
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
    return !!c.holeDocked;
  });
  console.log(`  ${[...phases].join(" → ")} · ${msgs.filter((m) => /Docked/.test(m)).join("")} after ${t.toFixed(0)} s`);
  expect(c.holeDocked).toBeTruthy();
  expect(c.pilot.auto).toBe("none");
}, 300_000);
