// The field to speak to TARS (PLAN-TARS T5b): opened by its key (F6), a question typed, Enter — his answer said
// and subtitled; Escape, or Enter on nothing, closes it. Its keys are its own while open (the flight's not
// triggered by typing). Under it, his link to OpenRouter (T6): offline (his written lines) or connected (the
// key's end, what the session has cost); "Sign in with OpenRouter", a key pasted (the field hidden then),
// disconnect. The agent (PLAN-TARS-AGENT A3): his actions listed as he does them (✓ done, ✗ refused), Escape
// stopping a turn that runs; his memory (how many exchanges and notes) and its Clear button.

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
  /** his memory: its exchanges and notes */
  memory(): { turns: number; notes: number };
  clearMemory(): void;
  /** the turn running stopped */
  stop(): void;
  /** speaking (A5): the microphone's button pressed (null: no recognition here); its key pressed in the field */
  talk: (() => void) | null;
  talkKey(e: KeyboardEvent): void;
}

/** actions shown at most */
const ACTIONS = 6;

export class TarsPanel {
  readonly el = document.createElement("div");
  private input = document.createElement("input");
  private status = document.createElement("div");
  private actions = document.createElement("ol");
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
    // (the microphone: a click listens, another sends — the key held does the same)
    if (host.talk) {
      const mic = document.createElement("button");
      mic.type = "button";
      mic.className = "tars-mic";
      mic.dataset.testid = "tars-mic";
      mic.textContent = "🎙";
      mic.title = t("Speak to TARS (or hold F6)");
      mic.setAttribute("aria-label", t("Speak to TARS (or hold F6)"));
      mic.addEventListener("click", (e) => {
        e.stopPropagation();
        host.talk!();
      });
      row.append(mic);
    }
    this.actions.className = "tars-actions";
    this.actions.dataset.testid = "tars-actions";
    this.actions.setAttribute("aria-live", "polite");
    this.status.className = "tars-link";
    this.status.dataset.testid = "tars-link";
    this.el.append(row, this.actions, this.status);
    parent.append(this.el);
    // (the subtitles kept above the field while it is open: his words not hidden behind his actions)
    const clear = () =>
      document.documentElement.style.setProperty(
        "--tars-clear",
        this.el.hidden ? "0px" : `${Math.round(innerHeight - this.el.getBoundingClientRect().top + 10)}px`,
      );
    new ResizeObserver(clear).observe(this.el);
    new MutationObserver(clear).observe(this.el, { attributes: true, attributeFilter: ["hidden"] });
    addEventListener("resize", clear);
    this.input.addEventListener("keydown", (e) => {
      // (the field's keys stay in it: no flight, no menu — but its own key, held, speaks)
      e.stopPropagation();
      if (e.code === "F6") {
        e.preventDefault();
        return this.host.talkKey(e);
      }
      if (e.key === "Escape") {
        if (this.keyMode) return this.setKeyMode(false);
        // (a turn running: Escape stops it first)
        if (this.host.link().busy) return this.host.stop();
        return this.close();
      }
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

  /** Listening (A5): the field says so; the words heard shown as they come. */
  listening(on: boolean) {
    this.el.classList.toggle("listening", on);
    if (on) {
      if (!this.open) this.show();
      this.input.value = "";
      this.input.placeholder = t("Listening… (release to send)");
    } else this.input.placeholder = t("Ask TARS — where are we, the fuel, what now… (Enter)");
  }

  hearing(text: string) {
    this.input.value = text;
  }

  /** A new question: the last one's actions cleared. */
  clearActions() {
    this.actions.replaceChildren();
  }

  /** An action of his, as it ends (its full line in the tooltip). */
  action(line: string, ok: boolean, full = line) {
    const li = document.createElement("li");
    li.className = ok ? "ok" : "no";
    li.textContent = `${ok ? "✓" : "✗"} ${line}`;
    li.title = full;
    this.actions.append(li);
    while (this.actions.children.length > ACTIONS) this.actions.firstElementChild!.remove();
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
        ? t("TARS is working… (Esc: stop)")
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
    // (his memory: what he keeps of you, and its eraser)
    const m = this.host.memory();
    if (m.turns || m.notes) {
      const mem = document.createElement("span");
      mem.dataset.testid = "tars-memory";
      mem.textContent = `${m.turns === 1 ? t("memory: 1 exchange") : tf("memory: {0} exchanges", m.turns)} · ${tf("notes: {0}", m.notes)}`;
      this.status.append(
        mem,
        btn(t("clear"), "tars-clear", () => {
          this.host.clearMemory();
          this.clearActions();
          this.refresh(t("Memory cleared."));
        }),
      );
    }
    if (note) {
      const n = document.createElement("em");
      n.textContent = note;
      this.status.append(n);
    }
  }
}
