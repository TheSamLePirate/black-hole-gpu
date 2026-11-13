import { expect, test } from "bun:test";
import { defaultSettings } from "../src/settings";
import { simStateOf, VIEW_POSE_KEYS, viewPoseOf } from "../src/game/view-pose";

// The frame's two descriptions (src/game/view-pose.ts; audit AR-07, wave 4.3): the view's pose and the flight's accepted state, made
// once a frame and frozen — a reader cannot write them, the simulation's arrays are not handed out.

test("the view's pose: the view's own settings and the frame's figures, frozen; the lens's field when given", () => {
  const s = defaultSettings();
  s.yaw = 0.3;
  s.fov = 70;
  const p = viewPoseOf(s, { time: 12.5, width: 1280, height: 800, scale: 0.75, frame: 9 });
  for (const k of VIEW_POSE_KEYS) expect(p[k]).toEqual(s[k]);
  expect([p.time, p.width, p.height, p.scale, p.frame]).toEqual([12.5, 1280, 800, 0.75, 9]);
  expect(Object.isFrozen(p)).toBe(true);
  expect(() => {
    (p as { yaw: number }).yaw = 1;
  }).toThrow();
  // (only the view's keys: no preference, no scene setting rides along)
  expect(Object.keys(p).sort()).toEqual([...VIEW_POSE_KEYS, "time", "width", "height", "scale", "frame"].sort());
  expect(viewPoseOf(s, { time: 0, width: 1, height: 1, scale: 1, frame: 0, fov: 120 }).fov).toBe(120);
  // (the settings changed after: the pose made before unchanged)
  s.yaw = 2;
  expect(p.yaw).toBe(0.3);
});

test("the flight's accepted state: its vectors copied and frozen", () => {
  const X = new Float64Array([1, 2, 3]);
  const st = simStateOf({
    time: 5,
    frame: 2,
    gen: 3,
    held: null,
    craft: {
      id: "f35",
      X,
      V: [0, 1, 0],
      ax: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
  });
  X[0] = 99;
  expect(st.craft!.X).toEqual([1, 2, 3]);
  expect(Object.isFrozen(st) && Object.isFrozen(st.craft) && Object.isFrozen(st.craft!.X) && Object.isFrozen(st.craft!.ax[0])).toBe(true);
  expect(simStateOf({ time: 0, frame: 0, gen: 0, held: "paused", craft: null }).craft).toBeNull();
});
