// TARS's console (PLAN-TARS T5b, PLAN-TARS-AGENT A3–A8): not a chat box — his presence on the HUD.
//   - his emblem (ui/tars/emblem.ts), its slabs moving with what he does, and the word for it (ready,
//     listening, thinking, acting, speaking);
//   - the exchange: the pilot's words, his answer;
//   - the task: each action as he does it — its icon, what it did, running then done (✓) or refused (✗),
//     the full line in its tooltip —, and while he waits on the game, the wait's live line;
//   - the field (F6 tapped; F6 held: he listens, the words shown as they come; the 🎙 button), Escape
//     stopping a turn that runs, then closing;
//   - his link: offline or OpenRouter (the key's end, the model, what the session has cost), sign in, paste a
//     key, disconnect; his memory (exchanges, notes) and its eraser.
// Closed while he acts or speaks, a small presence stays: the emblem and what he is doing.

import { t, tf, tr, type Text } from "../i18n";
import { TarsEmblem, type EmblemState } from "./tars/emblem";
import type { Proposal } from "../ai/game-tools";

export interface TarsPanelHost {
  /** a question asked */
  ask(q: string): void;
  /** the link: the key's end (null: none), whether online is on, what the session has cost [USD], the model */
  link(): { hint: string | null; online: boolean; spent: number; busy: boolean; model?: string };
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

/** the tools whose result is for him, not the pilot: their step shown without it */
const QUIET = new Set([
  "show_chart",
  "show_card",
  "show_screen",
  "hide_display",
  "propose_plan",
  "say",
  "memory",
  "find_settings",
  "get_state",
  "get_log",
  "list_places",
  "list_bodies",
  "list_keys",
  "list_saves_and_scenes",
  "get_weather",
  "get_flight_report",
]);

/** the steps shown at most */
const STEPS = 7;

const STATE_WORD: Record<EmblemState, Text> = {
  idle: { fr: "Prêt", en: "Ready" },
  listening: { fr: "À l'écoute", en: "Listening" },
  thinking: { fr: "Réfléchit", en: "Thinking" },
  acting: { fr: "Agit", en: "Acting" },
  speaking: { fr: "Parle", en: "Speaking" },
  error: { fr: "Problème", en: "Trouble" },
};

/** Each tool in words, and its mark. */
export const TOOL_WORDS: Record<string, { w: Text; i: string }> = {
  get_state: { w: { fr: "Situation lue", en: "Situation read" }, i: "◉" },
  list_places: { w: { fr: "Sites", en: "Sites" }, i: "⌖" },
  list_bodies: { w: { fr: "Corps", en: "Bodies" }, i: "◍" },
  get_weather: { w: { fr: "Météo", en: "Weather" }, i: "☁" },
  find_settings: { w: { fr: "Réglages cherchés", en: "Settings found" }, i: "⚙" },
  list_saves_and_scenes: { w: { fr: "Sauvegardes et scènes", en: "Saves and scenes" }, i: "▤" },
  get_log: { w: { fr: "Journal", en: "Log" }, i: "▤" },
  get_flight_report: { w: { fr: "Rapport de vol", en: "Flight report" }, i: "★" },
  list_keys: { w: { fr: "Touches", en: "Keys" }, i: "⌨" },
  autopilot: { w: { fr: "Autopilote", en: "Autopilot" }, i: "✈" },
  hold: { w: { fr: "Maintien", en: "Hold" }, i: "⊕" },
  controls: { w: { fr: "Commandes", en: "Controls" }, i: "⇵" },
  flight_action: { w: { fr: "Manœuvre", en: "Action" }, i: "↻" },
  set_craft: { w: { fr: "Appareil", en: "Craft" }, i: "⛭" },
  set_target: { w: { fr: "Cible", en: "Target" }, i: "◎" },
  plan_maneuver: { w: { fr: "Manœuvre planifiée", en: "Manoeuvre planned" }, i: "⤴" },
  plan_mission: { w: { fr: "Mission planifiée", en: "Mission planned" }, i: "☄" },
  manage_plan: { w: { fr: "Plan de vol", en: "Flight plan" }, i: "☰" },
  time: { w: { fr: "Temps", en: "Time" }, i: "⏱" },
  set_date: { w: { fr: "Date", en: "Date" }, i: "◷" },
  camera: { w: { fr: "Caméra", en: "Camera" }, i: "◫" },
  sky: { w: { fr: "Ciel", en: "Sky" }, i: "✦" },
  interface: { w: { fr: "Interface", en: "Interface" }, i: "▣" },
  place_ship: { w: { fr: "Téléportation", en: "Teleport" }, i: "⇢" },
  saves: { w: { fr: "Sauvegarde", en: "Save" }, i: "⬇" },
  start_scene: { w: { fr: "Scène", en: "Scene" }, i: "▶" },
  set_settings: { w: { fr: "Réglages", en: "Settings" }, i: "⚙" },
  press_key: { w: { fr: "Touche", en: "Key" }, i: "⌨" },
  wait: { w: { fr: "Attente", en: "Waiting" }, i: "⧗" },
  say: { w: { fr: "Annonce", en: "Said" }, i: "❝" },
  memory: { w: { fr: "Mémoire", en: "Memory" }, i: "✎" },
  show_chart: { w: { fr: "Graphe", en: "Chart" }, i: "∿" },
  show_card: { w: { fr: "Fiche", en: "Card" }, i: "▦" },
  show_screen: { w: { fr: "Écran", en: "Screen" }, i: "▣" },
  hide_display: { w: { fr: "Affichage fermé", en: "Display closed" }, i: "▢" },
  propose_plan: { w: { fr: "Plan proposé", en: "Plan proposed" }, i: "☷" },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class TarsPanel {
  readonly el = el("div", "tars-panel");
  /** the small presence while the console is closed */
  readonly presence = el("button", "tars-presence");
  readonly emblem = new TarsEmblem(30);
  private miniEmblem = new TarsEmblem(20);
  private input = el("input");
  private status = el("div", "tars-link");
  private stateWord = el("span", "tp-state");
  private youLine = el("p", "tp-you");
  private tarsLine = el("p", "tp-tars");
  private actions = el("ol", "tars-actions");
  private waitLine = el("div", "tp-wait");
  private presenceText = el("span", "tp-presence-text");
  private proposalEl = el("section", "tp-proposal");
  private keyMode = false;
  private state: EmblemState = "idle";
  private running: HTMLLIElement | null = null;

  constructor(
    private host: TarsPanelHost,
    parent: HTMLElement = document.body,
  ) {
    this.el.dataset.testid = "tars-panel";
    this.el.hidden = true;
    // (the head: his emblem, his name, what he is doing)
    const head = el("div", "tp-head");
    const who = el("div", "tp-who");
    who.append(el("small", "", "TARS"), this.stateWord);
    this.stateWord.dataset.testid = "tars-state";
    head.append(this.emblem.el, who);
    // (the exchange)
    const thread = el("div", "tp-thread");
    thread.dataset.testid = "tars-thread";
    thread.append(this.youLine, this.tarsLine);
    // (the task: his actions, his wait)
    const task = el("div", "tp-task");
    this.actions.dataset.testid = "tars-actions";
    this.actions.setAttribute("aria-live", "polite");
    this.waitLine.dataset.testid = "tars-wait";
    this.waitLine.hidden = true;
    task.append(this.actions, this.waitLine);
    // (the field)
    const row = el("div", "tars-row");
    this.input.type = "text";
    this.input.dataset.testid = "tars-input";
    this.input.maxLength = 300;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", t("Ask TARS"));
    row.append(this.input);
    // (the microphone: a click listens, another sends — the key held does the same)
    if (host.talk) {
      const mic = el("button", "tars-mic", "🎙");
      mic.type = "button";
      mic.dataset.testid = "tars-mic";
      mic.title = t("Speak to TARS (or hold F6)");
      mic.setAttribute("aria-label", t("Speak to TARS (or hold F6)"));
      mic.addEventListener("click", (e) => {
        e.stopPropagation();
        host.talk!();
      });
      row.append(mic);
    }
    this.status.dataset.testid = "tars-link";
    this.proposalEl.dataset.testid = "tars-proposal";
    this.proposalEl.hidden = true;
    this.el.append(head, thread, this.proposalEl, task, row, this.status);
    // (the presence: his emblem and his current doing, while the console is closed — a click opens it)
    this.presence.type = "button";
    this.presence.dataset.testid = "tars-presence";
    this.presence.hidden = true;
    this.presence.append(this.miniEmblem.el, this.presenceText);
    this.presence.addEventListener("click", (e) => {
      e.stopPropagation();
      this.show();
    });
    parent.append(this.el, this.presence);
    // (the subtitles kept above the console while it is open: his words not hidden behind his actions)
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
    this.setState("idle");
  }

  get open() {
    return !this.el.hidden;
  }

  show() {
    this.setKeyMode(false);
    this.el.hidden = false;
    this.syncPresence();
    this.refresh();
    this.input.focus();
  }

  close() {
    this.el.hidden = true;
    this.input.blur();
    this.syncPresence();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  /** What he is doing: the emblem, the word, the presence. */
  setState(s: EmblemState) {
    this.state = s;
    this.el.dataset.state = s;
    this.presence.dataset.state = s;
    this.emblem.set(s);
    this.miniEmblem.set(s);
    this.stateWord.textContent = tr(STATE_WORD[s]);
    this.syncPresence();
  }

  get currentState() {
    return this.state;
  }

  /** the emblems' voice level (0…1, null: unknown) and whether motion is reduced */
  levels(level: () => number | null, still: () => boolean) {
    for (const e of [this.emblem, this.miniEmblem]) {
      e.level = level;
      e.still = still;
    }
  }

  private syncPresence() {
    this.presence.hidden = this.open || this.state === "idle";
    if (this.presence.hidden) return;
    const step = this.running?.querySelector(".tp-what")?.textContent;
    const wait = this.waitLine.hidden ? "" : this.waitLine.textContent;
    this.presenceText.textContent = [tr(STATE_WORD[this.state]), wait || step].filter(Boolean).join(" · ");
  }

  /** A new question (`shown`: how it is written on the console, if not as asked): the exchange begun, the last
   *  task cleared. */
  exchange(q: string, shown = q) {
    this.youLine.textContent = shown;
    this.tarsLine.textContent = "";
    this.clearActions();
  }

  /** His answer. */
  answer(text: string) {
    this.tarsLine.textContent = text;
  }

  clearActions() {
    this.actions.replaceChildren();
    this.running = null;
    this.progress(null);
  }

  /** An action begun: its step, running. */
  begin(tool: string, args: Record<string, unknown>) {
    this.running = this.step(tool, args);
    this.emblem.flash();
    this.miniEmblem.flash();
    this.syncPresence();
  }

  /** An action ended — what it came back with (short), the full line in the tooltip: its step done or refused. */
  action(result: string, ok: boolean, full = result, tool?: string) {
    let li = this.running;
    if (!li || (tool && li.dataset.tool !== tool)) li = this.step(tool ?? "", {});
    li.className = ok ? "ok" : "no";
    li.querySelector(".tp-mark")!.textContent = ok ? "✓" : "✗";
    if (result && !QUIET.has(li.dataset.tool ?? "")) {
      const r = el("span", "tp-res", result.length > 90 ? `${result.slice(0, 90)}…` : result);
      li.append(r);
    }
    li.title = full;
    this.running = null;
    this.progress(null);
  }

  private step(tool: string, args: Record<string, unknown>): HTMLLIElement {
    const li = el("li", "run");
    li.dataset.tool = tool;
    const w = TOOL_WORDS[tool];
    // (its arguments: the values, a switch by its name when on — never "true", never the "execute" flag)
    const arg = Object.entries(args)
      .filter(([k, v]) => v !== null && v !== false && typeof v !== "object" && k !== "execute" && k !== "maxSeconds")
      .map(([k, v]) => (v === true ? k : String(v)))
      .join(" · ");
    li.append(
      el("span", "tp-mark", "◌"),
      el("span", "tp-icon", w?.i ?? "•"),
      el("span", "tp-what", w ? `${tr(w.w)}${arg ? ` · ${arg}` : ""}` : tool),
    );
    this.actions.append(li);
    while (this.actions.children.length > STEPS) this.actions.firstElementChild!.remove();
    return li;
  }

  /** A plan he proposes (null: none): its steps and figures, Accept and Refuse — `answer` hears which. */
  propose(p: Proposal | null, answer?: (yes: boolean) => void) {
    this.proposalEl.replaceChildren();
    this.proposalEl.hidden = !p;
    this.el.classList.toggle("proposing", !!p);
    if (!p) return;
    if (!this.open) this.show();
    const head = el("header");
    head.append(el("small", "", tr({ fr: "Proposition", en: "Proposal" })), el("h3", "", p.title));
    const sum = el("p", "tp-sum", p.summary);
    const ol = el("ol", "tp-steps");
    for (const s of p.steps) ol.append(el("li", "", s));
    this.proposalEl.append(head, sum, ol);
    if (p.figures?.length) {
      const dl = el("dl", "tp-figs");
      for (const f of p.figures) dl.append(el("dt", "", f.label), el("dd", "", f.value));
      this.proposalEl.append(dl);
    }
    const bar = el("div", "tp-choose");
    const yes = el("button", "tp-yes", tr({ fr: "Accepter", en: "Accept" }));
    yes.type = "button";
    yes.dataset.testid = "tars-accept";
    const no = el("button", "tp-no", tr({ fr: "Refuser", en: "Refuse" }));
    no.type = "button";
    no.dataset.testid = "tars-refuse";
    const hint = el("span", "tp-hint", tr({ fr: "ou dites « oui » / « non »", en: 'or say "yes" / "no"' }));
    for (const [b, v] of [
      [yes, true],
      [no, false],
    ] as const)
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        answer?.(v);
      });
    bar.append(yes, no, hint);
    this.proposalEl.append(bar);
  }

  /** The wait's live line (null: none). */
  progress(text: string | null) {
    this.waitLine.textContent = text ?? "";
    this.waitLine.hidden = !text;
    this.syncPresence();
  }

  /** Listening (A5): the console says so; the words heard shown as they come. */
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
    const text = el("span");
    const btn = (label: string, id: string, fn: () => void) => {
      const b = el("button", "sp-link", label);
      b.type = "button";
      b.dataset.testid = id;
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
      this.status.append(text);
      if (L.model && L.online) this.status.append(el("span", "tp-model", L.model));
      this.status.append(
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
      const mem = el("span", "tp-mem");
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
    if (note) this.status.append(el("em", "", note));
  }
}
