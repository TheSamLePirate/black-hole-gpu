// The A320's sound's contract (docs/PLAN-A320.md, A12): FlightGear's sound files (Sounds/cfm56-sound.xml,
// A320-common-sound.xml — their volume and pitch laws, conditions, places) evaluated on the systems' bag each frame
// (model.ts) give the voices heard; the audio engine (src/audio/samples.ts) plays them — FlightGear's recordings, in
// Opus (assets/a320/sounds/), looped or once, placed about the ear (HRTF), heard through the cabin or outside.

/** A voice of the craft this frame. */
export interface CraftVoice {
  /** its key (the same voice from frame to frame: its nodes kept, its gain and rate eased) */
  id: string;
  /** the recording's URL (an imported asset) */
  url: string;
  /** looped (an engine's hum, the wind) or played once from its start (a gear's clunk, a callout) */
  loop: boolean;
  /** a one-shot: played again each time this count changes (FlightGear's mode "once" on its condition's rising edge) */
  shot?: number;
  /** its gain 0… (FlightGear's volume, its factors' product) and its playback rate (FlightGear's pitch) */
  gain: number;
  rate: number;
  /** where it is in the ship's frame [m] (x left, y up, z nose — the deck's): none: in the head (the cockpit's own
   *  sounds as FlightGear plays them without a position); its reference and maximum distances [m] */
  pos: [number, number, number] | null;
  refDist?: number;
  maxDist?: number;
  /** FlightGear's internal/external split: heard only from inside the cockpit, only outside, or both */
  where: "inside" | "outside" | "both";
}
