// Who holds the flight (audit 2026-11-10, AR-02 and AR-12 — main() cut by responsibility, wave 4.8's second lot; strategy §19.3):
// the session's states in one place, asked by the loop instead of the same condition copied four times. The flight's own step
// (sim.step, the network's frame, the jitter probe) runs only when nothing holds it:
// - `frozen` — an automation steps the flight itself (__bh.freeze; __bh.step is then the only stepper);
// - `paused` — a menu holds the game (the pause, the title, the missions; in a network room the pause holds nothing);
// - `gpuHeld` — from a GPU device's loss to the new renderer's first image (the flight never runs without an image);
// - a render — an offline still or a video steps the scene itself;
// - a replay — the tape plays its own frames.
// `moving` (the rain, the camera's motion blur): held by the automation and the menus only.
// (13 Nov 2026: the flight clock and the replay's tape still read their own mixes of these — the clock runs during an offline
// render, the tape records while the GPU is made again: noticed, kept as they were — not reproduced, not changed here)

export type Holder = "frozen" | "paused" | "gpu" | "render" | "replay";

export interface SessionDeps {
  /** an offline render or a video running (renderer.offlineActive) */
  rendering(): boolean;
  /** a replay playing (ReplayPlayer.active) */
  replaying(): boolean;
}

export class Session {
  /** an automation steps the flight itself (__bh.freeze) */
  frozen = false;
  /** a menu holds the game (the pause, the title, the missions) — not in a room */
  paused = false;
  /** from a GPU device's loss to the new renderer's first image */
  gpuHeld = false;

  constructor(private d: SessionDeps) {}

  /** what holds the flight's step this frame — the first of them —, null when it runs */
  holder(): Holder | null {
    if (this.frozen) return "frozen";
    if (this.paused) return "paused";
    if (this.gpuHeld) return "gpu";
    if (this.d.rendering()) return "render";
    if (this.d.replaying()) return "replay";
    return null;
  }

  /** the flight's own step runs this frame */
  get runs(): boolean {
    return this.holder() === null;
  }

  /** the world's motion shown (the rain's clock, the motion blur): held by the automation and the menus */
  get moving(): boolean {
    return !this.frozen && !this.paused;
  }
}
