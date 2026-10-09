// The subtitles (PLAN-TARS T1): the line being said, its speaker named — "TOUR", "HOUSTON", "TARS" — over
// the HUD's lower third; shown while it is said (or its reading time, the voice off), gone after.

import { t } from "../i18n";
import type { Speaker, VoiceLine } from "../audio/voice";

const NAMES: Record<Speaker, () => string> = {
  callout: () => t("RANGER"),
  mission: () => t("MISSION CONTROL"),
  tower: () => t("TOWER"),
  tars: () => "TARS",
  computer: () => t("COMPUTER"),
};

export class Subtitles {
  readonly el = document.createElement("div");
  private who = document.createElement("small");
  private text = document.createElement("span");
  private hideAt = 0;
  private shown: VoiceLine | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.el.className = "subtitles";
    this.el.dataset.testid = "subtitles";
    this.el.setAttribute("aria-live", "polite");
    this.el.append(this.who, this.text);
    parent.append(this.el);
  }

  /** A line begins: shown (its speaker's colour). */
  show(l: VoiceLine, on: boolean) {
    this.shown = l;
    if (!on) return;
    this.who.textContent = NAMES[l.speaker]();
    this.text.textContent = l.text;
    this.el.dataset.speaker = l.speaker;
    this.el.classList.toggle("radio", !!l.radio);
    this.el.classList.add("on");
    this.hideAt = 0;
  }

  /** A line is over: kept a moment, then gone (unless another follows). */
  end(l: VoiceLine) {
    if (this.shown !== l) return;
    const at = performance.now() + 900;
    this.hideAt = at;
    setTimeout(() => {
      if (this.hideAt === at) this.el.classList.remove("on");
    }, 900);
  }

  hide() {
    this.shown = null;
    this.el.classList.remove("on");
  }
}
