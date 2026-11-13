// A flight flown frame by frame by the controller itself, no page (tests of the autopilots, the gear, the
// touchdown): a craft put at a pose of our universe, the frames of 1/30 s flown by flyShip (the warp the
// autopilots ask applies), the pilot's messages kept.
import { setHomePose } from "../../src/camera";
import { CameraController } from "../../src/controls";
import { advanceFrameClock } from "../../src/frameclock";
import { fleet } from "../../src/fleet";
import { setMountVessel } from "../../src/mounts";
import { ourGroundPose, type Pose } from "../../src/game/place";
import { add, scale } from "../../src/math/vec3";
import { defaultSettings, presets } from "../../src/settings";
import { groundVelocity, setGroundHeights } from "../../src/system/our-surface";
import { M_METRES, M_SECONDS } from "../../src/units";
import type { VesselId } from "../../src/vessels";
import { setSceneTime } from "../../src/wormhole";

export interface Run {
  c: CameraController;
  msgs: string[];
  /** frames of 1/30 s for so many seconds of wall time, until … (the seconds it took) */
  fly(seconds: number, until?: () => boolean): number;
  /** where the craft is now (home frame) and the scene's time */
  here(): { q: [number, number, number]; t: number };
}

export const TRANQUILITY = { lat: 0.674, lon: 23.473 };

/** A craft at a pose (the hover engaged if asked), the scene's clock at 0. */
export function flight(pose: Pose, hover: boolean, vessel: VesselId = "ranger"): Run {
  setSceneTime(0);
  fleet.active = vessel;
  // (the camera's mounts as these flights were tuned with — the module's default, the Ranger's —, whatever a test before left: a
  // module's state, left on the Endurance by craftpanel.test.ts's flyFrom, put an F-35 on its trim off by half a degree, its heavy-sea
  // qualification graded 2.00 in the full suite against 3.50 alone — 13 Nov 2026. This helper places the camera and the craft follows
  // through the mounts: with the craft's own — as the game has them — its trims shift (the F-35's high-alpha pass marked 15/20 for
  // 19.4): placing the craft itself is the helper's next step, not this fix's)
  setMountVessel("ranger");
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Blue Marble"]!,
    timeSpeed: 1 / M_SECONDS,
    vessel,
    flightMode: vessel === "ranger" ? ("plane" as const) : ("rocket" as const),
  };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const msgs: string[] = [];
  c.onPilotMessage = (m) => msgs.push(m);
  setHomePose(s, pose.X, pose.fwd, pose.up, pose.vel);
  s.anchor = "wormhole";
  s.motion = "geodesic";
  c.setPilot(true);
  c.newFlight();
  c.setOurLanded(pose.landed ?? null);
  c.sync();
  if (hover) {
    c.pilot.auto = "none";
    c.pilot.setAuto("hover");
  }
  const fly = (seconds: number, until?: () => boolean) => {
    const n = Math.round(seconds * 30);
    for (let i = 0; i < n; i++) {
      // (the flight's clock moved by the step, as __bh.step does — frameclock.ts: the decisions that wait "20 s" read it;
      // left still here, they waited for ever — the landing's report once per flight, 13 Nov 2026 — or, on the wall's clock
      // before audit 4.2, as long as the machine's load made the test last)
      advanceFrameClock(1000 / 30);
      c.flyShip(1 / 30, null as never);
      if (Number.isFinite(c.shipTime)) c.time = c.shipTime;
      if (until?.()) return i / 30;
    }
    return seconds;
  };
  const here = () => ({ q: c.activePoseNow()!.X as [number, number, number], t: c.nowTime() });
  return { c, msgs, fly, here };
}

/** A craft `altKm` over a place, at rest over it (carried by the ground) — hovering, or not. */
export function overPlace(body: string, lat: number, lon: number, altKm: number, hover = true, vessel: VesselId = "ranger"): Run {
  const g = ourGroundPose(body, lat, lon, 0);
  const X = add(g.X, scale(g.up, (altKm * 1e3) / M_METRES));
  return flight({ ...g, X, vel: groundVelocity(body, X, 0), landed: undefined }, hover, vessel);
}

/** Ground distance between two body-fixed points [m]. */
export function apart(a: number[], b: number[]) {
  const la = Math.hypot(...a),
    lb = Math.hypot(...b);
  return Math.hypot(a[0]! / la - b[0]! / lb, a[1]! / la - b[1]! / lb, a[2]! / la - b[2]! / lb) * lb * M_METRES;
}

/** The touchdown said: its sink and drift [m/s] (null: none, or not on the gear). */
export function touchdown(msgs: string[]) {
  const td = msgs.find((m) => /Touchdown|Hard landing|crash|collapsed|tipped/i.test(m)) ?? null;
  const m = td && /Touchdown on .* · ([\d.]+) m\/s down, ([\d.]+) m\/s along/.exec(td);
  if (process.env.TRACE) console.log(msgs.join("\n"));
  return { said: td, sink: m ? Number(m[1]) : null, drift: m ? Number(m[2]) : null };
}

/** The state these flights leave shared: the flown craft, the reliefs a test set (the Moon's craters back). */
export function resetFlights() {
  fleet.active = "ranger";
  // (the crafts other tests left parked — fleet.free: the Endurance, the Lander… — not carried into the next file's flights: injected
  // into the heavy-sea carrier qualification alone, they changed its grades — 13 Nov 2026; not that test's whole failure in the suite)
  for (const k of Object.keys(fleet.free)) delete (fleet.free as Record<string, unknown>)[k];
  // (a fight's stores: their mass off the jet)
  fleet.payload.f35 = 0;
  for (const b of ["moon", "earth", "mars"]) setGroundHeights(b, null);
}
