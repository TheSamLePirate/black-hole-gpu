// The keys a screen that takes the keyboard (a 3D cockpit screen captured, the HUD OBC console) may type: a key
// pressed while it owns the keyboard, not the auto-repeat of a key already held before it took it — a flight key
// (ZQSD/AE/WX by physical code) held through the click or the F11 keeps flying the craft, it does not type
// "zzzz" in the terminal. Its release always reaches the game (controls.ts drops it from its held keys): the
// screens never stop a keyup.

export class KeyHoldGate {
  private down = new Set<string>();

  /** The screen took the keyboard: only the keys pressed from now on are its to type. */
  reset() {
    this.down.clear();
  }

  /** Whether a keydown is the screen's: a fresh press, or the auto-repeat of one pressed since it took the keyboard. */
  accept(e: Pick<KeyboardEvent, "code" | "repeat">): boolean {
    if (!e.repeat) {
      if (e.code) this.down.add(e.code);
      return true;
    }
    return !e.code || this.down.has(e.code);
  }

  /** A key let go (seen, never stopped). */
  release(e: Pick<KeyboardEvent, "code">) {
    if (e.code) this.down.delete(e.code);
  }
}
