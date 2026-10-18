import { afterEach, expect, test } from "bun:test";
import { driftHold, SPACE_ASSIST, spaceRateLaw } from "../src/controller/spaceassist";
import { unitOf } from "../src/controller/motion";
import { overPlace, resetFlights, TRANQUILITY } from "./helpers/flight";
import { CameraController } from "../src/controls";
import { fleet, fleetSpinStart, fleetStart } from "../src/fleet";
import { lin } from "../src/math/vec3";
import { defaultSettings, presets } from "../src/settings";
import { C_MPS, M_SECONDS } from "../src/units";
import { setSceneTime } from "../src/wormhole";

// PLAN-VAISSEAUX X0: a spacecraft's levels of assistance — manual (no SAS: a turn kept), realistic (the pilot's SAS),
// assisted and beginner (the SAS always on, the drift held near a craft) — and back to a stable craft at a key (⇧X):
// over a ground a hover at once, in space the turn stopped, then prograde held.

afterEach(() => {
  resetFlights();
  fleetStart(0, "ranger");
});

const D = Math.PI / 180;
const turn = (w: number[]) => Math.hypot(...w);

test("the levels' rate laws: manual direct, assisted damped, beginner damped and gentler, realistic the pilot's", () => {
  expect(spaceRateLaw("manual")).toEqual({ law: "direct", scale: 1 });
  expect(spaceRateLaw("realistic")).toBeNull();
  expect(spaceRateLaw("assisted")).toEqual({ law: "damped", scale: 1 });
  expect(spaceRateLaw("beginner")).toEqual({ law: "damped", scale: SPACE_ASSIST.beginnerRate });
});

test("the drift held: the RCS pushes against the relative velocity, full at 0.1 m/s, nothing in the dead band", () => {
  // (the ship's axes: x left, y up, z the nose — here the frame's own)
  const ax: [number, number, number][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  // drifting forward and up: pushed back and down
  const a = driftHold([0, 0.05, 0.2], ax);
  expect(a.tz).toBe(-1);
  expect(a.ty).toBeCloseTo(-0.5, 9);
  expect(a.tx).toBeCloseTo(0, 9);
  // drifting to the ship's left (+x): pushed to its right (tx > 0)
  expect(driftHold([0.03, 0, 0], ax).tx).toBeCloseTo(0.3, 9);
  expect(driftHold([0.001, 0, 0.001], ax)).toEqual({ tx: 0, ty: 0, tz: 0 });
});

test("a denormal thrust's direction stays finite (docs/ERRORS-TO-FIX.md E1)", () => {
  const d = unitOf([1.2e-311, 1.0e-313, 1.6e-312])!;
  expect(d.every(Number.isFinite)).toBe(true);
  expect(Math.hypot(...d)).toBeCloseTo(1, 12);
  expect(unitOf([0, 0, 0])).toBeNull();
  expect(unitOf([Number.NaN, 0, 1])).toBeNull();
});

test("manual: no SAS — a turn let go is kept; realistic: the pilot's SAS stops it; assisted: stopped even with it off", () => {
  const { c, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 100, false);
  c.pilot.omega = [0.1, 0, 0];
  c.s.spaceAssist = "manual";
  fly(2);
  expect(turn(c.pilot.omega)).toBeGreaterThan(0.09);
  c.s.spaceAssist = "realistic";
  c.pilot.sas = true;
  fly(3);
  expect(turn(c.pilot.omega)).toBeLessThan(0.002);
  c.pilot.omega = [0, 0.1, 0];
  c.pilot.sas = false;
  fly(2);
  expect(turn(c.pilot.omega)).toBeGreaterThan(0.09);
  c.s.spaceAssist = "assisted";
  fly(3);
  expect(turn(c.pilot.omega)).toBeLessThan(0.002);
  // (the HUD's SAS shown as the level flies it)
  expect(c.flightInfo().sas).toBe(true);
  expect(c.flightInfo().spaceAssist).toBe("assisted");
}, 60_000);

test("⇧X in space: the turn stopped (SAS off, tumbling at 20°/s), then prograde held", () => {
  const { c, fly, msgs } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 100, false);
  c.pilot.sas = false;
  c.pilot.omega = [12 * D, 10 * D, 8 * D];
  expect(c.recoverStart()).toMatch(/stopping the turn/);
  const t = fly(30, () => !c.spaceRecover);
  console.log(`  tumbling at ${(turn([12, 10, 8])).toFixed(0)}°/s: stopped in ${t.toFixed(1)} s · ${msgs.at(-1)}`);
  expect(c.spaceRecover).toBeFalsy();
  expect(t).toBeLessThan(15);
  expect(c.pilot.hold).toBe("prograde");
  expect(msgs.at(-1)).toMatch(/prograde held/);
}, 60_000);

test("⇧X over a ground: the Lander hovers at once, held over its place", () => {
  const { c, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 1.5, false, "lander");
  // (falling, tilted a little)
  fly(3);
  c.pilot.omega = [0.05, 0, 0.03];
  expect(c.recoverStart()).toMatch(/hovering/);
  expect(c.pilot.auto).toBe("hover");
  fly(25);
  const h = c.hubNote as { drift?: number } | null;
  expect(c.landed).toBeFalsy();
  expect(h?.drift ?? 99).toBeLessThan(2);
}, 60_000);

test("assisted near a craft: the RCS let go holds the drift against it at nothing; realistic leaves it", () => {
  // (the Ranger 150 m off the Endurance's fore port, the Endurance not turning; the Ranger given 0.3 m/s across)
  const fly = (level: "assisted" | "realistic") => {
    setSceneTime(0);
    const starts = fleetSpinStart(0, { rpm: 0 });
    fleet.active = "ranger";
    const preset = presets["Earth: the Endurance tumbling, 300 km up"]!;
    const s = { ...defaultSettings(), ...preset, vessel: "ranger" as const, timeSpeed: 1 / M_SECONDS, animate: true, spaceAssist: level };
    const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
    c.time = 0;
    c.setPilot(true);
    c.newFlight();
    const r = starts.ranger;
    c.flyFrom({ ...r, V: lin(r.V, 1, r.ax[0], 0.3 / C_MPS) });
    c.settleMount();
    c.sync();
    c.pilot.auto = "none";
    const v0 = Math.hypot(...c.dockGeometry()!.vrel);
    for (let i = 0; i < 30 * 20; i++) {
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
    }
    return { v0, v1: Math.hypot(...c.dockGeometry()!.vrel), held: c.flightInfo().spaceDrift };
  };
  const a = fly("assisted");
  const r = fly("realistic");
  console.log(`  drift ${a.v0.toFixed(2)} m/s → assisted ${a.v1.toFixed(3)} m/s, realistic ${r.v1.toFixed(3)} m/s`);
  expect(a.v0).toBeGreaterThan(0.25);
  expect(a.v1).toBeLessThan(0.01);
  expect(r.v1).toBeGreaterThan(0.2);
}, 120_000);
