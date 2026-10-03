// The game's events, typed: what happened, for whoever listens (the journal, the sound, the HUD, the
// screens) — instead of one callback per pair of modules.

import type { FlightPhase } from "./phase";

export interface GameEvents {
  /** the flight's phase changed (game/phase.ts) */
  phase: { from: FlightPhase | null; to: FlightPhase; t: number };
  /** the craft entered a world's air (a point kept to resume from) */
  airEntry: { t: number };
  /** the craft lost past the air's limits */
  craftLost: { why: string; t: number };
  /** a message from the pilot's systems (the autopilots, the warnings) */
  pilotMessage: { text: string; t: number };
}

type Listener<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private listeners = new Map<keyof E, Set<Listener<never>>>();

  /** Listens to one kind of event; returns the unsubscribe. */
  on<K extends keyof E>(kind: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(kind);
    if (!set) this.listeners.set(kind, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  emit<K extends keyof E>(kind: K, payload: E[K]) {
    for (const fn of this.listeners.get(kind) ?? []) (fn as Listener<E[K]>)(payload);
  }
}

/** The game's bus. */
export const events = new EventBus<GameEvents>();
