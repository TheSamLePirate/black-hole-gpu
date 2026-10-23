// The A320's MCDUs' screens (docs/PLAN-A320.md, A9): each MCDU's page (src/a320/mcdu) drawn on its display's canvas —
// the top 1024 × 864 of it: its cell in the displays' atlas —, five times a second, once the game's monospaced font is
// there.

import type { Mcdu } from "../mcdu/mcdu";
import type { DuData } from "./data";
import { type Ctx, Display } from "./display";

let fontAsked = false;

export class McduDisplay extends Display {
  override hz = 5;
  constructor(private mcdu: Mcdu) {
    super(mcdu.side, null);
    // (JetBrains Mono — src/fonts.css —: loaded at its first use; asked once, so the first pages are in it)
    if (!fontAsked && typeof document !== "undefined" && document.fonts) {
      fontAsked = true;
      void document.fonts.load('600 56px "JetBrains Mono"').catch(() => {});
    }
  }

  draw(ctx: Ctx, _d: DuData, _t: number) {
    this.mcdu.render(ctx, 1024, 864);
  }
}
