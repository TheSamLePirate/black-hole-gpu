// The game controller in the menus (the title screen, the pause, the missions — the time held, so the
// flight does not read the pad meanwhile): the D-pad or the left stick moves between the items, A
// chooses, B goes back, Start leaves the pause. They become the keys the menus already answer — ↑ ↓,
// Enter, Escape — sent to the focused item.

import type { PadState } from "../gamepad";

/** How long a stick held up or down waits before it repeats [ms]. */
const REPEAT_MS = 260;

export class MenuPad {
  private heldDir = 0;
  private heldSince = 0;
  private lastRepeat = 0;

  /** A frame with a menu open: the pad's state (null: none) at `now` [ms]. */
  tick(pad: PadState | null, now: number) {
    if (!pad) return;
    for (const a of pad.actions) {
      if (a === "dpadUp") this.key("ArrowUp");
      else if (a === "dpadDown") this.key("ArrowDown");
      else if (a === "focus") this.key("Enter");
      else if (a === "gravity" || a === "settings") this.key("Escape");
    }
    // (the left stick: a push moves once, held it repeats)
    const y = pad.move[0];
    const dir = y > 0.6 ? -1 : y < -0.6 ? 1 : 0;
    if (dir !== this.heldDir) {
      this.heldDir = dir;
      this.heldSince = this.lastRepeat = now;
      if (dir) this.key(dir > 0 ? "ArrowDown" : "ArrowUp");
    } else if (dir && now - this.heldSince > REPEAT_MS * 1.6 && now - this.lastRepeat > REPEAT_MS) {
      this.lastRepeat = now;
      this.key(dir > 0 ? "ArrowDown" : "ArrowUp");
    }
  }

  /** A key, as if typed on the focused item (Escape to the window: the Escape stack's listener). */
  private key(key: string) {
    const target = key === "Escape" ? window : (document.activeElement ?? document.body);
    target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
  }
}
