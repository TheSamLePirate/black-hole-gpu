// The flight's phase — one value for what the camera and the craft are doing: no ship (the free
// camera), a cinematic, an offline render, or the craft flown — landed, docked, or in flight, by hand,
// holding a direction or on an autopilot — and the stage of the flight (on the ground, in the air, the
// entry, the approach, in orbit…). Derived each frame from the controller's state; its changes are
// the game's events (events.ts: "phase"), the journal's lines and, for the HUD, what to show.

export type Mode = "free" | "cinematic" | "offline" | "landed" | "docked" | "flight";
export type Control = "manual" | "hold" | "auto";
export type Stage = "ground" | "air" | "entry" | "approach" | "suborbital" | "orbit" | "escape" | "docking" | "kerr" | "throat" | "space";

export interface FlightPhase {
  mode: Mode;
  /** who flies (the craft flown only) */
  control: Control | null;
  /** what the flight is at (the craft flown only) */
  stage: Stage | null;
  /** the hold or the autopilot engaged ("" none) */
  detail: string;
}

/** What the phase is derived from (the controller's state, the status of the craft). */
export interface PhaseInput {
  piloting: boolean;
  cinematic: string | null;
  offline: boolean;
  landed: boolean;
  /** docked to something (the craft's own links) */
  docked: boolean;
  hold: string;
  auto: string;
  /** the entry autopilot's phase (piloting.ts entryRun), null: none */
  entry: string | null;
  /** in a world's air (above a trace of it) */
  inAir: boolean;
  /** the orbit's status (game/status.ts), null: unknown */
  status: string | null;
}

export function phaseOf(x: PhaseInput): FlightPhase {
  const none = { control: null, stage: null, detail: "" };
  if (x.offline) return { mode: "offline", ...none };
  if (x.cinematic) return { mode: "cinematic", ...none, detail: x.cinematic };
  if (!x.piloting) return { mode: "free", ...none };
  const control: Control = x.auto !== "none" ? "auto" : x.hold !== "none" ? "hold" : "manual";
  const detail = x.auto !== "none" ? x.auto : x.hold !== "none" ? x.hold : "";
  if (x.landed) return { mode: "landed", control, stage: "ground", detail };
  if (x.docked) return { mode: "docked", control, stage: "docking", detail };
  return { mode: "flight", control, stage: stageOf(x), detail };
}

function stageOf(x: PhaseInput): Stage {
  if (x.auto === "dock") return "docking";
  if (x.entry === "glide") return "approach";
  if (x.entry === "entry" || (x.entry && x.inAir)) return "entry";
  if (x.inAir || x.status === "flight") return "air";
  switch (x.status) {
    case "suborbital":
      return "suborbital";
    case "orbit":
      return "orbit";
    case "escape":
    case "hyperbolic":
      return "escape";
    case "plunge":
    case "bound":
    case "unbound":
      return "kerr";
    case "throat":
      return "throat";
    case "landed":
      return "ground";
    default:
      return "space";
  }
}

export const samePhase = (a: FlightPhase | null, b: FlightPhase) =>
  !!a && a.mode === b.mode && a.control === b.control && a.stage === b.stage && a.detail === b.detail;

const STAGE_TEXT: Record<Stage, string> = {
  ground: "on the ground",
  air: "in the air",
  entry: "entering the air",
  approach: "on the approach",
  suborbital: "on a suborbital arc",
  orbit: "in orbit",
  escape: "escaping",
  docking: "docking",
  kerr: "about Gargantua",
  throat: "in the wormhole's throat",
  space: "in space",
};

/** The phase in words (the journal's line). */
export function phaseText(p: FlightPhase): string {
  switch (p.mode) {
    case "free":
      return "Free camera";
    case "cinematic":
      return `Cinematic: ${p.detail}`;
    case "offline":
      return "Offline render";
    default: {
      const who = p.control === "auto" ? `autopilot ${p.detail}` : p.control === "hold" ? `holding ${p.detail}` : "by hand";
      const where = p.mode === "landed" ? "landed" : p.mode === "docked" ? "docked" : STAGE_TEXT[p.stage ?? "space"];
      return `${where[0]!.toUpperCase()}${where.slice(1)} — ${who}`;
    }
  }
}

/**
 * Follows the phase frame by frame: a change of stage is emitted once it has held for `settle` seconds
 * of the flight (a status flickering at a boundary — the air's top, a periapsis grazing it — is not a
 * phase). The mode (boarding, landing, docking, a cinematic) and who flies change at once.
 */
export class PhaseWatcher {
  current: FlightPhase | null = null;
  private pending: FlightPhase | null = null;
  private since = 0;
  constructor(
    private emit: (from: FlightPhase | null, to: FlightPhase) => void,
    private settle = 1,
  ) {}

  /** The frame's phase, at the flight's time `now` [s]. */
  update(p: FlightPhase, now: number) {
    if (samePhase(this.current, p)) {
      this.pending = null;
      return;
    }
    if (!samePhase(this.pending, p)) {
      this.pending = p;
      this.since = now;
    }
    // (who flies changes by the pilot's own action — at once; only the stage, read off the orbit, waits)
    const c = this.current;
    if (c === null || c.mode !== p.mode || c.control !== p.control || c.detail !== p.detail || now - this.since >= this.settle) {
      const from = this.current;
      this.current = p;
      this.pending = null;
      this.emit(from, p);
    }
  }
}
