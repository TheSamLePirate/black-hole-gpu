// The field to speak to TARS (PLAN-TARS T5b): opened by its key (F6), a question typed, Enter — his answer said
// and subtitled; Escape, or Enter on nothing, closes it. Its keys are its own while open (the flight's not
// triggered by typing).

import { t } from "../i18n";

export class TarsPanel {
  readonly el = document.createElement("div");
  private input = document.createElement("input");

  constructor(
    private ask: (q: string) => void,
    parent: HTMLElement = document.body,
  ) {
    this.el.className = "tars-panel";
    this.el.dataset.testid = "tars-panel";
    this.el.hidden = true;
    const who = document.createElement("small");
    who.textContent = "TARS";
    this.input.type = "text";
    this.input.dataset.testid = "tars-input";
    this.input.maxLength = 300;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", t("Ask TARS"));
    this.el.append(who, this.input);
    parent.append(this.el);
    this.input.addEventListener("keydown", (e) => {
      // (the field's keys stay in it: no flight, no menu)
      e.stopPropagation();
      if (e.key === "Escape") return this.close();
      if (e.key !== "Enter") return;
      const q = this.input.value.trim();
      this.input.value = "";
      if (!q) return this.close();
      this.ask(q);
    });
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    this.input.placeholder = t("Ask TARS — where are we, the fuel, what now… (Enter)");
    this.el.hidden = false;
    this.input.focus();
  }

  close() {
    this.el.hidden = true;
    this.input.blur();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }
}
