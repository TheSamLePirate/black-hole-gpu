// The frame's two descriptions, produced once and frozen (audit 2026-11-10, AR-07; strategy §19.12; wave 4.3 — Sam's choice of
// 13 Nov 2026: this side produces them, the render session moves the renderer onto ViewPose). Settings held at once the player's
// preferences, the scene, the simulated state and the view's pose — one mutable object written by the simulation, the interface,
// TARS, __bh, the scenes and the saves, handed to the renderer as the view's description: no "state at frame N", no "final pose",
// any reader could see a half-written state.
// - ViewPose: the view's own settings (its place, its look, its lens, its target — VIEW_POSE_KEYS, the one list: the spectator's
//   own keys too), the scene's time it is drawn at, the canvas, the render scale, the frame's number;
// - SimState: the flight's accepted state at the end of the frame's steps — the time, the frame, the flight's generation, what
//   holds the flight, the craft flown (its place, velocity and axes in the home frame).
// Both frozen: a reader cannot write them; the next frame makes new ones.

import type { Settings } from "../settings";
import type { Holder } from "./session";

/** The settings that are the view's own (its place, its look, its lens, its target): the rest follows the ship's. */
export const VIEW_POSE_KEYS = [
  "anchor",
  "whL",
  "distance",
  "inclination",
  "azimuth",
  "yaw",
  "pitch",
  "roll",
  "velR",
  "velT",
  "velP",
  "motion",
  "rotation",
  "target",
  "lookAt",
  "telescope",
  "fov",
  "ship",
  "shipMount",
  "shipLookYaw",
  "shipLookPitch",
] as const satisfies readonly (keyof Settings)[];

export type ViewPoseKey = (typeof VIEW_POSE_KEYS)[number];

export type ViewPose = Readonly<Pick<Settings, ViewPoseKey>> & {
  /** the scene's time it is drawn at [M] */
  readonly time: number;
  /** the canvas [px] and the render scale (the image's share of it) */
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** the frame's number (the loop's) */
  readonly frame: number;
};

/** The view's pose for a frame, from the settings the renderer draws (camera.viewSettings()), frozen. */
export function viewPoseOf(
  s: Settings,
  o: { time: number; width: number; height: number; scale: number; frame: number; fov?: number },
): ViewPose {
  const p: Record<string, unknown> = {};
  for (const k of VIEW_POSE_KEYS) p[k] = s[k];
  if (o.fov !== undefined) p.fov = o.fov;
  return Object.freeze({ ...p, time: o.time, width: o.width, height: o.height, scale: o.scale, frame: o.frame }) as ViewPose;
}

export interface SimState {
  /** the scene's time accepted at the end of the frame's steps [M] */
  readonly time: number;
  /** the frame's number (the loop's) */
  readonly frame: number;
  /** the flight's generation (camera.flightGen: a new flight, a load, a teleport) */
  readonly gen: number;
  /** what held the flight's step this frame (game/session.ts), null when it ran */
  readonly held: Holder | null;
  /** the craft flown — its place and velocity in the home frame, its axes (right, up, forward) — null when none */
  readonly craft: Readonly<{ id: string; X: readonly number[]; V: readonly number[]; ax: readonly (readonly number[])[] }> | null;
}

/** The flight's accepted state for a frame, frozen (its vectors copied: the simulation's own arrays never handed out). */
export function simStateOf(o: {
  time: number;
  frame: number;
  gen: number;
  held: Holder | null;
  craft: { id: string; X: ArrayLike<number>; V: ArrayLike<number>; ax: ArrayLike<number>[] } | null;
}): SimState {
  const c = o.craft;
  return Object.freeze({
    time: o.time,
    frame: o.frame,
    gen: o.gen,
    held: o.held,
    craft: c
      ? Object.freeze({
          id: c.id,
          X: Object.freeze(Array.from(c.X)),
          V: Object.freeze(Array.from(c.V)),
          ax: Object.freeze(c.ax.map((a) => Object.freeze(Array.from(a)))),
        })
      : null,
  });
}
