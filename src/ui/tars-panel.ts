// The field to speak to TARS (PLAN-TARS T5b): opened by its key (F6), a question typed, Enter — his answer said
// and subtitled; Escape, or Enter on nothing, closes it. Its keys are its own while open (the flight's not
// triggered by typing). Under it, his link to OpenRouter (T6): offline (his written lines) or connected (the
// key's end, what the session has cost); "Sign in with OpenRouter", a key pasted (the field hidden then),
// disconnect.

import { t, tf } from "../i18n";

export interface TarsPanelHost {
  /** a question asked */
  ask(q: string): void;
  /** the link: the key's end (null: none), whether online is on, what the session has cost [USD] */
  link(): { hint: string | null; online: boolean; spent: number; busy: boolean };
  connect(): void;
  /** a key pasted: kept (false: not an OpenRouter key) */
  paste(k: string): boolean;
  disconnect(): void;
}

export class TarsPanel {
  readonly el = document.createElement("div");
  private input = document.createElement("input");
  private status = document.createElement("div");
  private keyMode = false;

  constructor(
    private host: TarsPanelHost,
    parent: HTMLElement = document.body,
  ) {
    this.el.className = "tars-panel";
    this.el.dataset.testid = "tars-panel";
    this.el.hidden = true;
    const row = document.createElement("div");
    row.className = "tars-row";
    const who = document.createElement("small");
    who.textContent = "TARS";
    this.input.type = "text";
    this.input.dataset.testid = "tars-input";
    this.input.maxLength = 300;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", t("Ask TARS"));
    row.append(who, this.input);
    this.status.className = "tars-link";
    this.status.dataset.testid = "tars-link";
    this.el.append(row, this.status);
    parent.append(this.el);
    this.input.addEventListener("keydown", (e) => {
      // (the field's keys stay in it: no flight, no menu)
      e.stopPropagation();
      if (e.key === "Escape") return this.keyMode ? this.setKeyMode(false) : this.close();
      if (e.key !== "Enter") return;
      const q = this.input.value.trim();
      this.input.value = "";
      if (this.keyMode) {
        const ok = q ? this.host.paste(q) : false;
        this.setKeyMode(false);
        this.refresh(ok ? t("Key kept in this browser only.") : q ? t("That is not an OpenRouter key (sk-or-…).") : "");
        return;
      }
      if (!q) return this.close();
      this.host.ask(q);
    });
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    this.setKeyMode(false);
    this.el.hidden = false;
    this.refresh();
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

  private setKeyMode(on: boolean) {
    this.keyMode = on;
    this.input.type = on ? "password" : "text";
    this.input.value = "";
    this.input.placeholder = on
      ? t("Paste your OpenRouter key (sk-or-…) — Enter")
      : t("Ask TARS — where are we, the fuel, what now… (Enter)");
    this.input.focus();
  }

  /** The link's line, a note after it. */
  refresh(note = "") {
    const L = this.host.link();
    this.status.replaceChildren();
    const text = document.createElement("span");
    const btn = (label: string, id: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sp-link";
      b.dataset.testid = id;
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    if (L.hint) {
      text.textContent = L.busy
        ? t("TARS is thinking…")
        : L.online
          ? tf("OpenRouter {0} · this session {1} $", L.hint, L.spent < 0.01 ? L.spent.toFixed(4) : L.spent.toFixed(2))
          : tf("OpenRouter {0} — off in the settings: his written lines", L.hint);
      this.status.append(
        text,
        btn(t("disconnect"), "tars-disconnect", () => {
          this.host.disconnect();
          this.refresh();
        }),
      );
    } else {
      text.textContent = t("Offline: his written lines.");
      this.status.append(
        text,
        btn(t("Sign in with OpenRouter"), "tars-connect", () => this.host.connect()),
        btn(t("paste a key"), "tars-paste", () => this.setKeyMode(true)),
      );
    }
    if (note) {
      const n = document.createElement("em");
      n.textContent = note;
      this.status.append(n);
    }
  }
}
