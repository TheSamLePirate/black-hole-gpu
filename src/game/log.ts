// The game's journal: what happened in a flight (the pilot's messages, changes of sphere of influence
// and of status, placements, saves, audits, errors), with the wall clock and the scene's time. The
// game tools show it; it can be copied or downloaded for a report.

export type LogKind = "info" | "pilot" | "phase" | "soi" | "status" | "place" | "save" | "audit" | "warn" | "error";

export interface LogEvent {
  /** Date.now() */
  at: number;
  /** the scene's time [M] */
  t: number;
  kind: LogKind;
  text: string;
  data?: unknown;
}

export class GameLog {
  readonly events: LogEvent[] = [];
  private listeners = new Set<(e: LogEvent) => void>();
  constructor(private max = 2000) {}

  add(kind: LogKind, text: string, t = NaN, data?: unknown) {
    const e: LogEvent = { at: Date.now(), t, kind, text, data };
    this.events.push(e);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
    this.listeners.forEach((f) => f(e));
    return e;
  }
  on(f: (e: LogEvent) => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  clear() {
    this.events.length = 0;
  }
  /** One line per event: wall clock, scene date, kind, text. */
  text(dateOf?: (t: number) => string) {
    return this.events
      .map(
        (e) =>
          `${new Date(e.at).toISOString().slice(11, 19)}  ${dateOf && Number.isFinite(e.t) ? dateOf(e.t) + "  " : ""}${e.kind.padEnd(6)}  ${e.text}`,
      )
      .join("\n");
  }
}

export const gameLog = new GameLog();
