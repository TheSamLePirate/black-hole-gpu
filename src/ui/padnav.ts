// The game controller in the menus (the title screen, the pause, the missions — the time held, so the
// flight does not read the pad meanwhile): the D-pad or the left stick moves between the items, A
// chooses, B goes back, Start leaves the pause. They become the keys the menus already answer — the arrows,
// Enter, Escape — sent to the focused item. In the menus' screens (ui/menu/router.ts, `full`) the rest too:
// left and right, LB / RB the tabs (Page ↑ / ↓), X and Y (the keys X and R) — ui/menu/actions.ts reads them.

import type { PadState } from "../gamepad";
import { noteInput } from "./menu/glyphs";

/** How long a stick held one way waits before it repeats [ms]. */
const REPEAT_MS = 260;

type Key = { key: string; code: string };
const K = (key: string, code = key): Key => ({ key, code });
const UP = K("ArrowUp"),
  DOWN = K("ArrowDown"),
  LEFT = K("ArrowLeft"),
  RIGHT = K("ArrowRight");

export class MenuPad {
  private heldDir: Key | null = null;
  private heldSince = 0;
  private lastRepeat = 0;
  private shoulders = [false, false];

  /**
   * A frame with a menu open: the pad's state (null: none) at `now` [ms]. `full`: a menu screen that reads
   * every direction and the other buttons (the older menus: up, down, A and B only — the rest would reach
   * the game's keys under them).
   */
  tick(pad: PadState | null, now: number, full = false) {
    if (!pad) return;
    if (pad.active) noteInput("pad", pad.id);
    for (const a of pad.actions) {
      if (a === "dpadUp") this.key(UP);
      else if (a === "dpadDown") this.key(DOWN);
      else if (a === "focus") this.key(K("Enter"));
      else if (a === "gravity" || a === "settings") this.key(K("Escape"));
      else if (!full) continue;
      else if (a === "prevTarget") this.key(LEFT);
      else if (a === "nextTarget") this.key(RIGHT);
      else if (a === "auto") this.key(K("x", "KeyX"));
      else if (a === "rotation") this.key(K("r", "KeyR"));
    }
    if (full) {
      // (LB, RB: edges of the buttons held — not actions of their own, they roll the craft in flight)
      for (const [i, key] of [
        [4, K("PageUp")],
        [5, K("PageDown")],
      ] as const) {
        const on = !!pad.held?.[i];
        if (on && !this.shoulders[i - 4]) this.key(key);
        this.shoulders[i - 4] = on;
      }
    }
    // (the left stick: a push moves once, held it repeats; its stronger axis decides)
    const [y, x] = pad.move;
    const dir = Math.abs(y) >= Math.abs(x) || !full ? (y > 0.6 ? UP : y < -0.6 ? DOWN : null) : x > 0.6 ? RIGHT : x < -0.6 ? LEFT : null;
    if (dir !== this.heldDir) {
      this.heldDir = dir;
      this.heldSince = this.lastRepeat = now;
      if (dir) this.key(dir);
    } else if (dir && now - this.heldSince > REPEAT_MS * 1.6 && now - this.lastRepeat > REPEAT_MS) {
      this.lastRepeat = now;
      this.key(dir);
    }
  }

  /** A key, as if typed on the focused item (Escape to the window: the Escape stack's listener). */
  private key({ key, code }: Key) {
    const target = key === "Escape" ? window : (document.activeElement ?? document.body);
    target.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }));
  }
}
