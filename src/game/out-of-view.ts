// The game out of view — the tab put aside, the window minimised (audit 2026-11-10, AR-02, NET-14, TA-06; strategy §19.3;
// wave 4.2; Sam's choice of 13 Nov 2026). The browser stops the page's frames while it is hidden: nothing of the flight
// runs, and nothing is caught up at the return (the loop's step stays bounded). What the game does about it, in one place:
// - as it goes out of view, the game saved (a hidden page may be thrown away by the browser — the last moment it is sure
//   to run) and the preferences written;
// - alone, a flight under way paused (the pause menu, as Esc), and at the return the pause says how long it was out of
//   view: the player takes it back when ready — a landing left at 50 ft is not resumed under his hands;
// - in a room nothing stops — the clock is the room's —: the others told he is out of view (his ask of the room's pace not
//   holding it meanwhile, server/rooms.ts), and at the return his scene set on the room's hour, said (ui/netsession.ts).

export interface OutOfViewDeps {
  /** in a network room (its clock does not stop) */
  inRoom(): boolean;
  /** a flight, a scene being played — not the title, not an automation's frozen scene, not a render, not already paused */
  playing(): boolean;
  /** the game saved and the preferences written (as the page goes) */
  save(): void;
  /** the pause menu opened, its out-of-view line `why` */
  pause(why: string): void;
  /** the pause menu's out-of-view line changed (the return: how long) — false when the menu is no longer up */
  repause(why: string): boolean;
  /** the room told we are out of view, or back (`awayS`: how long we were) */
  presence(away: boolean, awayS: number): void;
}

/** a duration in words: "45 s", "3 min 05 s", "1 h 02 min" */
export function awayWords(s: number): string {
  const n = Math.max(0, Math.round(s));
  if (n < 60) return `${n} s`;
  if (n < 3600) return `${Math.floor(n / 60)} min ${String(n % 60).padStart(2, "0")} s`;
  return `${Math.floor(n / 3600)} h ${String(Math.floor((n % 3600) / 60)).padStart(2, "0")} min`;
}

export interface OutOfViewText {
  /** the pause's line while out of view */
  away: string;
  /** at the return: "{0}" the duration */
  back: string;
}

export class OutOfView {
  /** when it went out of view [ms of `now`], null while in view */
  hiddenAt: number | null = null;
  /** the last stretch out of view [s] (0: none yet) */
  lastS = 0;
  /** the pause this made (its line updated at the return; not one the player had opened) */
  private paused = false;

  constructor(
    private d: OutOfViewDeps,
    private text: () => OutOfViewText,
    private now: () => number = () => performance.now(),
  ) {}

  /** The page's visibility changed (`hidden`: document.hidden). */
  change(hidden: boolean) {
    if (hidden) {
      if (this.hiddenAt !== null) return;
      this.hiddenAt = this.now();
      this.d.save();
      if (this.d.inRoom()) this.d.presence(true, 0);
      else if (this.d.playing()) {
        this.d.pause(this.text().away);
        this.paused = true;
      }
      return;
    }
    if (this.hiddenAt === null) return;
    const s = (this.now() - this.hiddenAt) / 1000;
    this.hiddenAt = null;
    this.lastS = s;
    if (this.d.inRoom()) this.d.presence(false, s);
    if (this.paused) {
      this.paused = false;
      this.d.repause(this.text().back.replace("{0}", awayWords(s)));
    }
  }

  /** Listens to a page's visibility (the game's: `document`). The listener's removal. */
  watch(page: {
    hidden: boolean;
    addEventListener(t: "visibilitychange", f: () => void): void;
    removeEventListener(t: "visibilitychange", f: () => void): void;
  }) {
    const f = () => this.change(page.hidden);
    page.addEventListener("visibilitychange", f);
    return () => page.removeEventListener("visibilitychange", f);
  }
}
