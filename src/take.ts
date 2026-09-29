// A take: the live view recorded frame by frame — what the camera did, where the ship was, the scene's
// clock, what the renderer drew of the flight — to be rendered afterwards as a video at full quality
// (renderdialog.ts). The user flies, orbits, pauses and warps as they like; the video replays exactly
// that, at its own frame rate (each video frame takes the recorded frame nearest its time).
//
// The settings are kept as the first frame's and then each frame's changes only (a frame changes a
// few pose values): minutes of recording stay small.

import type { Settings } from "./settings";
import type { MountPose } from "./mounts";
import type { Thrust } from "./ship";

type Path = Parameters<import("./renderer").Renderer["setCameraPath"]>[0];

/** What a frame of the take holds besides the settings. */
export interface TakeState {
  /** the scene's time [M] */
  time: number;
  /** the liquid throat's wave clock */
  water: number;
  /** the auto exposure's value then [EV] */
  ev: number;
  ship: MountPose | null;
  thrust: Thrust | null;
  plasma: [number, number, number, number];
  path: Path;
}

interface Frame extends TakeState {
  /** seconds from the take's start */
  t: number;
  /** the settings that changed since the previous frame (all of them in the first) */
  diff: Partial<Settings>;
}

/** Ten minutes at most (a take is for a shot, not a flight's log). */
const MAX_SECONDS = 600;

export class Take {
  private frames: Frame[] = [];
  private last: Settings | null = null;
  private t0 = 0;
  recording = false;

  get seconds() {
    return this.recording ? (performance.now() - this.t0) / 1000 : (this.frames.at(-1)?.t ?? 0);
  }
  get length() {
    return this.frames.length;
  }
  /** a take is there to render */
  get ready() {
    return !this.recording && this.frames.length > 1;
  }

  start() {
    this.frames = [];
    this.last = null;
    this.t0 = performance.now();
    this.recording = true;
  }

  stop() {
    this.recording = false;
    this.last = null;
  }

  /** Records the live view's frame (called once per frame, after the step). False: the take is full. */
  capture(s: Settings, st: TakeState): boolean {
    if (!this.recording) return false;
    const t = (performance.now() - this.t0) / 1000;
    if (t > MAX_SECONDS) {
      this.stop();
      return false;
    }
    const diff: Partial<Settings> = {};
    const rec = diff as Record<string, unknown>;
    const src = s as unknown as Record<string, unknown>;
    const prev = this.last as unknown as Record<string, unknown> | null;
    for (const k in src) if (!prev || prev[k] !== src[k]) rec[k] = src[k];
    this.last = { ...s };
    this.frames.push({
      t, diff, time: st.time, water: st.water, ev: st.ev, plasma: [...st.plasma],
      ship: st.ship && { eye: [...st.ship.eye], aim: [...st.ship.aim] },
      thrust: st.thrust && { ...st.thrust, force: [...st.thrust.force], torque: [...st.thrust.torque] },
      path: st.path,
    });
    return true;
  }

  /**
   * The frames for a video at `fps`: for each of its frames, the settings to apply (the full set, built
   * from the changes) and the state, in order.
   */
  *play(fps: number): Generator<{ i: number; n: number; settings: Settings; state: TakeState }> {
    const f = this.frames;
    if (f.length < 2) return;
    const n = Math.max(1, Math.round(f.at(-1)!.t * fps));
    const cur = {} as Settings;
    let k = -1;
    for (let i = 0; i < n; i++) {
      const u = i / fps;
      // (the recorded frame nearest the video frame's time: forwards only)
      while (k + 1 < f.length && (k < 0 || Math.abs(f[k + 1]!.t - u) <= Math.abs(f[k]!.t - u))) Object.assign(cur, f[++k]!.diff);
      yield { i, n, settings: cur, state: f[k]! };
    }
  }
}
