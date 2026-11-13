// What the game keeps of itself (audit 2026-11-10, AR-12 — main() cut by responsibility, wave 4.8, its first lot; AR-05):
// the player's preferences and the autosave, out of main.ts's loop. One owner for when they are written:
// - every `autosaveEvery` seconds of the loop (Settings › Game › Saved games), and after a setting changed — the preferences
//   with it —, two seconds after the last write at the soonest (changes in a row: one write);
// - as the page goes or goes out of view (`leaving`: pagehide, src/game/out-of-view.ts) — the last moment it is sure to run;
// - never a benchmark's settings as the player's, never a render's or a replay's state as the flight's (`busy`).
// An autosave the browser refuses (storage full, blocked) is said once, and again only after one has taken.

export interface PersistenceDeps {
  /** the autosave on (settings.autosave) and its period [s] (settings.autosaveEvery) */
  autosave(): { on: boolean; every: number };
  /** the autosave written now (tools.autosaveNow): false when the browser refused it */
  autosaveNow(): boolean;
  /** the player's preferences written (game/prefs.ts writePrefs) */
  writePrefs(): void;
  /** the preferences are the player's — not a benchmark page's (`#bench`) */
  ownPrefs: boolean;
  /** the game has drawn its first image (before: nothing of a flight to keep) */
  started(): boolean;
  /** an offline render or a replay running: the scene is not the flight's */
  busy(): boolean;
  /** an autosave refused: said (once) */
  refused(): void;
  /** a cost measured by its label (the CPU profiler's `time`), or run as is */
  time?<T>(label: string, f: () => T): T;
}

export class Persistence {
  /** the loop's time since the last autosave [s] */
  private sinceSave = 0;
  /** a setting changed: the preferences and the game written, two seconds after the last write at the soonest */
  private soon = false;
  /** an autosave refused and said: not said again until one has taken */
  private refusedTold = false;

  constructor(private d: PersistenceDeps) {}

  /** A setting changed: written at the next frame, two seconds after the last write at the soonest (changes in a row: one write). */
  changed() {
    this.soon = true;
  }

  /** The loop's frame (`dt`: its step [s]): the preferences and the autosave when due. */
  tick(dt: number) {
    const d = this.d;
    this.sinceSave += dt;
    // (a render or a replay running: nothing of its scene — nor of the settings it holds — written; a change kept for after)
    if (d.busy()) return;
    const soon = this.soon && this.sinceSave > 2;
    if (soon && d.ownPrefs) d.writePrefs();
    const a = d.autosave();
    if (a.on && d.started() && (this.sinceSave > a.every || soon)) {
      this.sinceSave = 0;
      this.save();
    }
    if (soon) this.soon = false;
  }

  /** The page going, or going out of view: the preferences and the game written now. */
  leaving() {
    const d = this.d;
    if (d.ownPrefs) d.writePrefs();
    if (d.autosave().on && d.started() && !d.busy()) this.save();
  }

  private save() {
    const d = this.d;
    const ok = d.time ? d.time("autosave", () => d.autosaveNow()) : d.autosaveNow();
    if (!ok && !this.refusedTold) d.refused();
    this.refusedTold = !ok;
  }
}
