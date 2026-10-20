import { afterEach, expect, test } from "bun:test";
import { cameraFrame, setHomePose } from "../src/camera";
import { CameraController } from "../src/controls";
import { ourGroundPose } from "../src/game/place";
import { defaultSettings, presets } from "../src/settings";
import { heightOverGround, setGroundRelief, toBodyFixed } from "../src/system/our-surface";
import type { Vec3 } from "../src/physics";
import { setSceneTime } from "../src/wormhole";
import { apart, flight, resetFlights } from "./helpers/flight";

// A scene set down on the Earth's ground without a craft (a landscape's tripod): its rest — where it was set down —
// is the view's only while the view stands there. Walked off it, the relief's next tiles (main.ts: groundChanged at
// each change of renderer.groundStamp) took the view back to its start — a fall's step of no time from that rest.
// A craft flown and set down keeps its rest: raised onto the finer heights as they come.

afterEach(() => {
  resetFlights();
  setGroundRelief("earth", null);
});

const CANYON = { lat: 36.06, lon: -112.14 };

/** A scene's tripod on the ground, no craft: the view set down there (applyPreset's bodyView pose, its rest). */
function tripodScene() {
  setSceneTime(0);
  const s = { ...defaultSettings(), ...presets["Earth: the Blue Marble"]!, ship: false, animate: false };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const g = ourGroundPose("earth", CANYON.lat, CANYON.lon, 0);
  setHomePose(s, g.X, g.fwd, g.up, g.vel);
  s.anchor = "wormhole";
  s.motion = "geodesic";
  c.newFlight();
  c.setOurLanded(g.landed!);
  s.rotation = "tripod";
  c.setRotation("tripod");
  c.sync();
  c.padFrame = null;
  // (where the view is, on the Earth's own axes [M])
  const at = (): Vec3 => {
    const n = c.ourNav(cameraFrame(c.s))!;
    return toBodyFixed("earth", n.X, n.t);
  };
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) c.update(1 / 30, 0);
  };
  return { c, s, at, frames, start: g.landed!.q };
}

/** The relief's tiles come in (main.ts at a change of the ground stamp): the hook, and the old one's own test. */
function tilesIn(c: CameraController, reliefM: number) {
  setGroundRelief("earth", () => reliefM);
  c.groundChanged();
  if (c.ourLanded && !c.character.active) c.fall(0, [0, 0, 0], false);
}

test("a scene's tripod walked 300 m off its start: the relief's tiles coming in leave it where it is, on its new ground", () => {
  setGroundRelief("earth", () => 0);
  const { c, at, frames, start } = tripodScene();
  frames(5);
  // (unmoved: still resting where the scene set it down)
  expect(c.ourLanded).not.toBeNull();
  c.codes.add("KeyW");
  c.codes.add("ShiftLeft");
  let n = 0;
  while (apart(at(), start) < 300 && n++ < 3000) frames(1);
  c.codes.clear();
  frames(60);
  const walked = at();
  expect(apart(walked, start)).toBeGreaterThan(300);

  // the finer heights: the ground 40 m higher — the tripod set back on it at its own height, where it stands
  tilesIn(c, 40);
  frames(10);
  expect(apart(at(), walked)).toBeLessThan(1);
  expect(apart(at(), start)).toBeGreaterThan(300);
  expect(heightOverGround("earth", at())).toBeCloseTo(1.7, 0);
  // (walked off: the rest no longer the view's)
  expect(c.ourLanded).toBeNull();
  // (and again: nothing takes it back)
  tilesIn(c, 10);
  frames(10);
  expect(apart(at(), walked)).toBeLessThan(1);
});

test("a scene's tripod turned on gravity after a walk: it falls where it stands, not back at the scene's start", () => {
  setGroundRelief("earth", () => 0);
  const { c, at, frames, start } = tripodScene();
  frames(5);
  c.codes.add("KeyD");
  c.codes.add("ShiftLeft");
  let n = 0;
  while (apart(at(), start) < 200 && n++ < 3000) frames(1);
  c.codes.clear();
  frames(60);
  const walked = at();
  c.setGravity(true);
  c.fall(0, [0, 0, 0], false);
  expect(apart(at(), walked)).toBeLessThan(1);
});

test("a tripod left where the scene set it down keeps its rest (a craft boarded there starts landed)", () => {
  setGroundRelief("earth", () => 0);
  const { c, frames } = tripodScene();
  frames(30);
  expect(c.ourLanded?.body).toBe("earth");
  // (its tiles: the rig's own height over the ground, the rest not applied to the view)
  tilesIn(c, 25);
  frames(10);
  expect(c.ourLanded?.body).toBe("earth");
});

test("a craft set down on the ground: raised onto the finer heights as the relief's tiles come in", () => {
  setGroundRelief("earth", () => 0);
  const g = ourGroundPose("earth", CANYON.lat, CANYON.lon, 0);
  const { c, here } = flight(g, false, "lander");
  expect(c.piloting).toBe(true);
  // (set on the ground as it is known: its own height over it — its gear's)
  c.groundChanged();
  const h0 = heightOverGround("earth", c.ourLanded!.q);
  expect(h0).toBeGreaterThan(1);
  expect(h0).toBeLessThan(10);
  const q0 = toBodyFixed("earth", here().q, here().t);
  expect(heightOverGround("earth", q0)).toBeCloseTo(h0, 1);
  // (the canyon's rim read back: 60 m above the coarse ground — the craft inside it, raised onto it)
  setGroundRelief("earth", () => 60);
  expect(heightOverGround("earth", q0)).toBeCloseTo(h0 - 60, 1);
  c.groundChanged();
  expect(c.ourLanded).not.toBeNull();
  expect(heightOverGround("earth", c.ourLanded!.q)).toBeCloseTo(h0, 1);
  const q1 = toBodyFixed("earth", here().q, here().t);
  expect(heightOverGround("earth", q1)).toBeCloseTo(h0, 1);
  // (raised along its up, not moved along the ground)
  expect(apart(q1, q0)).toBeLessThan(0.1);
});
