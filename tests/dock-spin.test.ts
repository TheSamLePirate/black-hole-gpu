import { afterEach, expect, test } from "bun:test";
import { qConj, qLog, qMul } from "../src/cine/follow";
import { len3 } from "../src/cine/rig";
import { CameraController } from "../src/controls";
import { fleet, fleetSpinStart, fleetStart } from "../src/fleet";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// The film's docking with the tumbling Endurance (3 rpm), flown frame by frame by the controller itself (no
// page): the docking autopilot from 150 m, the hatch camera — the warp steps it takes, the view's turn frame
// to frame (its jolts: the jerk the player saw), the capture.

afterEach(() => fleetStart(0, "ranger"));

test("docking with the spinning Endurance: no warp flicker, no jolt of the view, latched", () => {
  const preset = presets["Earth: the Endurance tumbling, 300 km up"];
  expect(preset).toBeDefined();
  const t0 = 0;
  setSceneTime(t0);
  const starts = fleetSpinStart(t0);
  fleet.active = "ranger";
  const s = { ...defaultSettings(), ...preset!, vessel: "ranger" as const, timeSpeed: 1 / M_SECONDS, autoWarp: true, animate: true };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const msgs: string[] = [];
  c.onPilotMessage = (m) => msgs.push(m);
  c.time = t0;
  c.setPilot(true);
  c.newFlight();
  c.flyFrom(starts.ranger);
  c.settleMount();
  c.sync();
  s.target = "endurance";
  c.pilot.auto = "none";
  c.pilot.setAuto("dock");
  const dt = 1 / 30;
  let warps = 0,
    lastWarp = Number.NaN as number,
    prevQ = c.viewWorld().q,
    prevW: number[] | null = null,
    worstJerk = 0,
    frames = 0;
  for (; frames < 30 * 600; frames++) {
    c.flyShip(dt, null as never);
    if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    c.stepMount(dt);
    // (the warp's steps by the range — the warp itself eased between them)
    const step = c.dockAuto?.warpStep ?? lastWarp;
    if (step !== lastWarp) warps++, (lastWarp = step);
    const q = c.viewWorld().q;
    const w = qLog(qMul(q, qConj(prevQ))).map((x) => x / dt);
    // (the view's turn rate's change in a frame [rad/s] — a jolt: the warp's steps, the latches' snap)
    if (prevW && frames > 30) worstJerk = Math.max(worstJerk, len3(w.map((x, i) => x - prevW![i]!) as [number, number, number]));
    prevW = w;
    prevQ = q;
    if (msgs.some((m) => /^Docked to /.test(m))) break;
  }
  if (process.env.TRACE) console.log({ frames, warps, worstJerk, last: msgs.slice(-4) });
  expect(msgs.some((m) => /^Docked to /.test(m))).toBe(true);
  // (each warp step once: no flicker on a threshold)
  expect(warps).toBeLessThanOrEqual(4);
  // (the view's turn rate never changes by more than ~1°/s in a frame — the warp's steps eased, the latches'
  // snap carried: before, 3°/s at each of four steps flickering on their thresholds)
  expect(worstJerk).toBeLessThan(0.015);
  // (not slower than three minutes: the warp kept to what the Ranger can turn with, not to real time)
  expect(frames / 30).toBeLessThan(180);
}, 300_000);
