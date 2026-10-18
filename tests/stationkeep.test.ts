import { afterEach, expect, test } from "bun:test";
import { KEEP, keepSpeed, lvlhFrame } from "../src/controller/stationkeep";
import { translateKeys } from "../src/controller/spaceassist";
import { CameraController } from "../src/controls";
import { fleet, fleetSpinStart, fleetStart } from "../src/fleet";
import { lin } from "../src/math/vec3";
import { defaultSettings, presets } from "../src/settings";
import { C_MPS, M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// PLAN-VAISSEAUX X1a: station keeping — the craft held where it is against a craft near, in the target's orbital frame,
// on the thrusters; docked, the same key undocks and backs off 30 m, then holds; the RCS translation mode's keys.

afterEach(() => fleetStart(0, "ranger"));

test("the target's orbital frame: unit, orthogonal, right-handed, its turn the orbit's rate", () => {
  const F = lvlhFrame([7000, 0, 0], [0, 7.5, 0.5]);
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  for (const v of [F.R, F.T, F.N]) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  expect(dot(F.R, F.T)).toBeCloseTo(0, 12);
  expect(dot(F.T, F.N)).toBeCloseTo(0, 12);
  expect(F.T[1]).toBeGreaterThan(0.99);
  expect(Math.hypot(...F.w)).toBeCloseTo(Math.hypot(7.5, 0.5) / 7000, 12);
  expect(keepSpeed(1000)).toBe(KEEP.vmax);
  expect(keepSpeed(1)).toBeCloseTo(0.1, 12);
});

test("the RCS translation mode: W S up · down, A D left · right, the throttle keys forward · back, the roll kept", () => {
  const k = translateKeys({ pitch: -1, yaw: 1, roll: 0.5, tx: 0, ty: 0, tz: 0, throttle: 1 });
  expect(k).toEqual({ pitch: 0, yaw: 0, roll: 0.5, tx: 1, ty: 1, tz: 1, throttle: 0 });
});

/** The Ranger off the Endurance's fore port (not turning), drifting across at `drift` m/s. */
function nearEndurance(rangerM: number, drift: number) {
  setSceneTime(0);
  const starts = fleetSpinStart(0, { rpm: 0, rangerM });
  fleet.active = "ranger";
  const preset = presets["Earth: the Endurance tumbling, 300 km up"]!;
  const s = { ...defaultSettings(), ...preset, vessel: "ranger" as const, timeSpeed: 1 / M_SECONDS, animate: true, autoWarp: true };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  // (headless: the fleet's flown craft is this controller's — its assembly's places from it)
  fleet.activePose = () => c.activePoseNow();
  const msgs: string[] = [];
  c.onPilotMessage = (m) => msgs.push(m);
  c.time = 0;
  c.setPilot(true);
  c.newFlight();
  const r = starts.ranger;
  c.flyFrom({ ...r, V: lin(r.V, 1, r.ax[0], drift / C_MPS) });
  c.settleMount();
  c.sync();
  c.pilot.auto = "none";
  const fly = (seconds: number, until?: () => boolean) => {
    for (let i = 0; i < seconds * 30; i++) {
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
      if (until?.()) return i / 30;
    }
    return seconds;
  };
  return { c, msgs, fly, s };
}

test("station keeping: a 0.3 m/s drift caught, the craft brought back and held where it was engaged", () => {
  const { c, fly, msgs } = nearEndurance(150, 0.3);
  const r0 = c.dockGeometry()!.range;
  expect(c.keepKey()).toMatch(/station keeping/);
  fly(240);
  const g = c.dockGeometry()!;
  const off = (c.hubNote as { off?: number }).off ?? 99;
  console.log(
    `  ${msgs.find((m) => /Station keeping/.test(m))} · after 240 s: ${off.toFixed(2)} m off, ${Math.hypot(...g.vrel).toFixed(3)} m/s, range ${r0.toFixed(1)} → ${g.range.toFixed(1)} m`,
  );
  expect(c.pilot.auto).toBe("keep");
  expect(off).toBeLessThan(1);
  expect(Math.hypot(...g.vrel)).toBeLessThan(0.02);
  expect(Math.abs(g.range - r0)).toBeLessThan(2);
}, 180_000);

test("docked: ⇧8 undocks, backs off 30 m, then holds", () => {
  const { c, fly, msgs, s } = nearEndurance(15, 0);
  s.target = "endurance";
  c.pilot.setAuto("dock");
  fly(240, () => msgs.some((m) => /^Docked to /.test(m)));
  expect(msgs.some((m) => /^Docked to /.test(m))).toBe(true);
  fly(1);
  const r0 = c.dockGeometry()?.range ?? 0;
  expect(c.keepKey()).toMatch(/backing off 30 m/);
  fly(300);
  const g = c.dockGeometry()!;
  console.log(`  docked (${r0.toFixed(1)} m port to port) → backed off: ${g.range.toFixed(1)} m, ${Math.hypot(...g.vrel).toFixed(3)} m/s`);
  expect(c.pilot.auto).toBe("keep");
  expect(g.range).toBeGreaterThan(25);
  expect(g.range).toBeLessThan(40);
  expect(Math.hypot(...g.vrel)).toBeLessThan(0.03);
}, 240_000);
