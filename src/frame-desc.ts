// The frame's frozen description (docs/PLAN-J1-OPAQUE-FORWARD.md J1-1; strategy §7.3): what a frame is — its id, its clocks, its
// camera now and the frame before's — built once at the start of renderer.frame() and read by the encoding instead of the wall's
// clock or the settings while it encodes. Its time domains are kept apart: the frame's real clock (the renderer's fades, its
// freshness tests, its animation clocks: one reading a frame, the same for every pass of it), the flight's clock (frameclock.ts —
// stepped with the flight) and the scene's clock (sim.time). Pure.

import type { CameraFrame } from "./camera";
import type { Vec3 } from "./math/vec3";

/** a camera as the frame sees it: its axes and its field */
export interface FrameCamera {
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  /** tan of the half vertical field */
  tanHalf: number;
}

export interface FrameDesc {
  /** the renderer's frames counted from 1 */
  id: number;
  /** the frame's real clock [ms] — performance.now(), read once at its start */
  realMs: number;
  /** since the frame before [ms] (0 for the first) */
  dtRealMs: number;
  /** the flight's clock [ms] (frameclock.ts frameNow) */
  flightMs: number;
  /** the scene's clock (sim.time, as renderer.frame() received it) */
  simTime: number;
  camera: FrameCamera;
  /** the frame before's camera (null for the first) */
  prev: FrameCamera | null;
  /** the camera's whole frame as the tracer reads it (camera.ts cameraFrame at simTime: its place, ZAMO frame, velocity, region) —
   *  computed once a frame, the live image's one authority (writeParams, the light probe's schedule); shared, not copied: read only */
  view?: CameraFrame;
  /** PLAN-J2 J2-1: the Earth's tile pages this image reads — the table's version once the image's publication is done
   *  (EarthTiles.publish, at the frame's start), the pages still queued after it; set by the renderer after the description */
  pages?: { version: number; waiting: number };
}

export interface FrameInput {
  realMs: number;
  flightMs: number;
  simTime: number;
  camera: FrameCamera;
  view?: CameraFrame;
}

/** The next frame's description from the last one and this frame's readings (copies: the frame's is not shared). */
export function nextFrameDesc(last: FrameDesc | null, input: FrameInput): FrameDesc {
  const copy = (c: FrameCamera): FrameCamera => ({ right: [...c.right], up: [...c.up], fwd: [...c.fwd], tanHalf: c.tanHalf });
  return {
    id: (last?.id ?? 0) + 1,
    realMs: input.realMs,
    dtRealMs: last ? Math.max(input.realMs - last.realMs, 0) : 0,
    flightMs: input.flightMs,
    simTime: input.simTime,
    camera: copy(input.camera),
    prev: last ? copy(last.camera) : null,
    ...(input.view ? { view: input.view } : {}),
  };
}
