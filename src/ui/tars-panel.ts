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
// The agent's console (PLAN-TARS-AGENT B6): moved by its grip (top right; its place kept, a double click
// docks it back), larger or smaller, folded to its head; its tabs — the exchange (and the past ones), his
// sub-agents at work, his wakings (reflexes and rules, each switched on or off, the hour's budget), his
// memory (his notes, each forgotten by its ×, the summary).

import { t, tf, tr, type Text } from "../i18n";
import { store } from "../util/storage";
import { TarsEmblem, type EmblemState } from "./tars/emblem";
import type { Proposal } from "../ai/game-tools";
import { MODE_WORDS, type Mode, type Suggestion } from "../ai/commands";

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
  /** his wakings (B1): the rules, whether they are on, the hour's cost and ceiling, why he waits */
  wakes?(): { rules: WakeRow[]; on: boolean; spent: number; perHour: number; why: string | null };
  wakeToggle?(id: string, on: boolean): void;
  wakeRemove?(id: string): void;
  wakeAll?(on: boolean): void;
  /** his memory's contents (the Memory tab), a note forgotten */
  memoryContents?(): { notes: readonly string[]; summary: string; turns: readonly { at: number; user: string; tars: string }[] };
  forget?(note: string): void;
  /** what completes the field as typed (C1–C2) */
  complete?(input: string): Suggestion[];
  /** his mode (C3) and the next one */
  mode?(): Mode;
  cycleMode?(): void;
}

/** A waking as the console lists it. */
export interface WakeRow {
  id: string;
  kind: string;
  to?: string;
  minutes?: number;
  prompt: string;
  enabled: boolean;
  reflex?: boolean;
  fired?: number;
  firedAt?: number;
}

type Tab = "talk" | "agents" | "wakes" | "memory";

const TABS: [Tab, Text][] = [
  ["talk", { fr: "Échange", en: "Exchange" }],
  ["agents", { fr: "Agents", en: "Agents" }],
  ["wakes", { fr: "Réveils", en: "Wakings" }],
  ["memory", { fr: "Mémoire", en: "Memory" }],
];

const KIND_WORDS: Record<string, Text> = {
  autopilot: { fr: "Autopilote", en: "Autopilot" },
  phase: { fr: "Phase du vol", en: "Flight phase" },
  hub_step: { fr: "Étape du hub", en: "Hub step" },
  entry_phase: { fr: "Phase de rentrée", en: "Entry phase" },
  alert: { fr: "Alerte", en: "Alert" },
  soi: { fr: "Sphère d'influence", en: "Sphere of influence" },
  landed: { fr: "Posé", en: "Landed" },
  docked: { fr: "Amarré", en: "Docked" },
  report: { fr: "Rapport", en: "Report" },
  deviation: { fr: "Écart", en: "Deviation" },
  every: { fr: "Toutes les", en: "Every" },
  at: { fr: "À l'heure du jeu", en: "At game time" },
  in: { fr: "Dans", en: "In" },
};

const POS_KEY = "kerr.tars.console";
/** the questions asked, for ↑ ↓ (C2) */
const HISTORY_KEY = "kerr.tars.asked";
const HISTORY_MAX = 60;

/** the tools whose result is for him, not the pilot: their step shown without it */
const QUIET = new Set([
  "update_todos",
  "schedule",
  "list_schedules",
  "spawn_agents",
  "get_telemetry",
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
  schedule: { w: { fr: "Réveil réglé", en: "Waking set" }, i: "⏲" },
  list_schedules: { w: { fr: "Réveils lus", en: "Wakings read" }, i: "⏲" },
  cancel_schedule: { w: { fr: "Réveil changé", en: "Waking changed" }, i: "⏲" },
  spawn_agents: { w: { fr: "Sous-agents", en: "Sub-agents" }, i: "⑂" },
  get_telemetry: { w: { fr: "Télémétrie lue", en: "Telemetry read" }, i: "≋" },
  update_todos: { w: { fr: "Liste de tâches", en: "Task list" }, i: "☑" },
  save_skill: { w: { fr: "Savoir-faire gardé", en: "Skill saved" }, i: "★" },
};

const wrap = (inner: HTMLElement) => {
  const p = document.createElement("div");
  p.className = "tp-pane";
  p.append(inner);
  return p;
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
  private tab: Tab = "talk";
  private panes = new Map<Tab, HTMLElement>();
  private tabBtns = new Map<Tab, HTMLButtonElement>();
  private history = el("ol", "tp-history");
  private agentsEl = el("div", "tp-agents");
  private wakesEl = el("div", "tp-wakes");
  private memoryEl = el("div", "tp-memory");
  private budgetEl = el("span", "tp-budget");
  private followEl = el("section", "tp-follow");
  private todosEl = el("ol", "tp-todos");
  private suggestEl = el("ul", "tp-suggest");
  private sugs: Suggestion[] = [];
  private sugAt = 0;
  private asked: string[] = store.getJSON<string[]>(HISTORY_KEY, []);
  private askedAt = -1;
  private draft = "";
  private modeEl = el("button", "tp-mode");
  private subs = new Map<string, { state: string; line: string; at: number; el: HTMLElement }>();

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
    head.append(this.emblem.el, who, this.budgetEl);
    this.budgetEl.dataset.testid = "tars-budget";
    // (its controls, top right: larger, folded, closed — and the grip that moves it)
    const ctl = el("div", "tp-ctl");
    const cbtn = (glyph: string, title: Text, id: string, fn: () => void) => {
      const b = el("button", "tp-cbtn", glyph);
      b.type = "button";
      b.title = tr(title);
      b.setAttribute("aria-label", tr(title));
      b.dataset.testid = id;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    const grip = el("span", "tp-grip", "⠿");
    grip.title = tr({ fr: "Déplacer (double clic : remettre en place)", en: "Move (double click: back in place)" });
    grip.dataset.testid = "tars-grip";
    ctl.append(
      cbtn("⤢", { fr: "Plus grand / plus petit", en: "Larger / smaller" }, "tars-size", () =>
        this.setLook({ large: !this.el.classList.contains("large") }),
      ),
      cbtn("–", { fr: "Replier", en: "Fold" }, "tars-fold", () => this.setLook({ folded: !this.el.classList.contains("folded") })),
      cbtn("×", { fr: "Fermer (F6)", en: "Close (F6)" }, "tars-close", () => this.close()),
      grip,
    );
    head.append(ctl);
    this.grip(grip);
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
    // (his mode before the field: a click, or Shift+Tab in it, turns it — C3)
    this.modeEl.type = "button";
    this.modeEl.dataset.testid = "tars-mode";
    this.modeEl.title = tr({ fr: "Mode — Maj+Tab : Agir · Proposer · Observer", en: "Mode — Shift+Tab: Act · Propose · Observe" });
    this.modeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.host.cycleMode?.();
      this.syncMode();
    });
    this.suggestEl.dataset.testid = "tars-suggest";
    this.suggestEl.setAttribute("role", "listbox");
    this.suggestEl.hidden = true;
    row.append(this.suggestEl, this.modeEl, this.input);
    this.input.addEventListener("input", () => this.suggest());
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
    // (the tabs, and their panes: the exchange and its task; his sub-agents; his wakings; his memory)
    const tabs = el("div", "tp-tabs");
    tabs.setAttribute("role", "tablist");
    for (const [id, label] of TABS) {
      const b = el("button", "tp-tab", tr(label));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.testid = `tars-tab-${id}`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setTab(id);
      });
      this.tabBtns.set(id, b);
      tabs.append(b);
    }
    const talk = el("div", "tp-pane");
    this.history.dataset.testid = "tars-history";
    this.followEl.dataset.testid = "tars-follow";
    this.followEl.hidden = true;
    this.todosEl.dataset.testid = "tars-todos";
    this.todosEl.hidden = true;
    talk.append(this.history, thread, this.proposalEl, this.followEl, this.todosEl, task);
    this.agentsEl.dataset.testid = "tars-agents";
    this.wakesEl.dataset.testid = "tars-wakes";
    this.memoryEl.dataset.testid = "tars-memory-tab";
    for (const [id, pane] of [
      ["talk", talk],
      ["agents", wrap(this.agentsEl)],
      ["wakes", wrap(this.wakesEl)],
      ["memory", wrap(this.memoryEl)],
    ] as const)
      this.panes.set(id, pane);
    const body = el("div", "tp-body");
    body.append(...this.panes.values());
    this.el.append(head, tabs, body, row, this.status);
    this.clearSubagents();
    this.setTab("talk");
    // (as left last time: its place, its size, folded or not)
    const kept = store.getJSON<{ x?: number; y?: number; large?: boolean; folded?: boolean } | null>(POS_KEY, null);
    if (kept) this.setLook(kept, false);
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
      // (Shift+Tab: his mode turned — C3)
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        this.host.cycleMode?.();
        return this.syncMode();
      }
      // (the completions: ↑ ↓ to choose, Tab or Enter to take, Escape to close — C1)
      if (this.sugs.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this.sugAt = (this.sugAt + (e.key === "ArrowDown" ? 1 : this.sugs.length - 1)) % this.sugs.length;
          return this.drawSuggest();
        }
        if (e.key === "Tab" || (e.key === "Enter" && this.sugs[this.sugAt]!.text.trim() !== this.input.value.trim())) {
          e.preventDefault();
          const t = this.sugs[this.sugAt]!.text;
          this.input.value = t;
          this.suggest();
          // (a whole command, nothing more to type: done at once with Enter)
          if (e.key === "Enter" && !t.endsWith(" ")) return this.submit();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          return this.closeSuggest();
        }
      }
      // (↑ ↓: the questions asked before — C2)
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !this.keyMode && this.asked.length) {
        const up = e.key === "ArrowUp";
        if (this.askedAt < 0 && !up) return;
        if (this.askedAt < 0) this.draft = this.input.value;
        e.preventDefault();
        this.askedAt = up ? Math.min(this.asked.length - 1, this.askedAt + 1) : this.askedAt - 1;
        this.input.value = this.askedAt < 0 ? this.draft : this.asked[this.asked.length - 1 - this.askedAt]!;
        return;
      }
      if (e.key === "Escape") {
        if (this.keyMode) return this.setKeyMode(false);
        // (a turn running: Escape stops it first)
        if (this.host.link().busy) return this.host.stop();
        return this.close();
      }
      if (e.key !== "Enter") return;
      this.submit();
    });
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
    this.syncMode();
    this.setState("idle");
  }

  /** The field sent: a key pasted, or a question (kept for ↑). */
  private submit() {
    const q = this.input.value.trim();
    this.input.value = "";
    this.closeSuggest();
    this.askedAt = -1;
    if (this.keyMode) {
      const ok = q ? this.host.paste(q) : false;
      this.setKeyMode(false);
      this.refresh(ok ? t("Key kept in this browser only.") : q ? t("That is not an OpenRouter key (sk-or-…).") : "");
      return;
    }
    if (!q) return this.close();
    if (this.asked.at(-1) !== q) {
      this.asked.push(q);
      this.asked.splice(0, Math.max(0, this.asked.length - HISTORY_MAX));
      store.setJSON(HISTORY_KEY, this.asked);
    }
    this.host.ask(q);
  }

  /** The completions for what is typed (C1–C2). */
  private suggest() {
    this.sugs = this.keyMode ? [] : (this.host.complete?.(this.input.value) ?? []);
    this.sugAt = 0;
    this.drawSuggest();
  }

  private closeSuggest() {
    this.sugs = [];
    this.drawSuggest();
  }

  private drawSuggest() {
    this.suggestEl.hidden = !this.sugs.length;
    this.suggestEl.replaceChildren(
      ...this.sugs.map((sg, i) => {
        const li = el("li", `${sg.kind}${i === this.sugAt ? " on" : ""}`);
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === this.sugAt));
        li.append(el("b", "", sg.label), el("span", "", sg.hint ?? ""));
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.input.value = sg.text;
          this.suggest();
          this.input.focus();
        });
        return li;
      }),
    );
  }

  /** His mode shown (C3). */
  syncMode() {
    const m = this.host.mode?.() ?? "act";
    this.modeEl.hidden = !this.host.mode;
    this.modeEl.dataset.mode = m;
    this.modeEl.textContent = tr(MODE_WORDS[m]);
    this.el.dataset.mode = m;
  }

  /** His task list (C4): each item to do, under way, done; null: none. */
  todos(items: { text: string; status: "pending" | "active" | "done" }[] | null) {
    this.todosEl.hidden = !items?.length;
    this.todosEl.replaceChildren(
      ...(items ?? []).map((t) => {
        const li = el("li", t.status);
        li.append(el("span", "tp-todo-mark", t.status === "done" ? "✓" : t.status === "active" ? "◌" : "○"), el("span", "", t.text));
        return li;
      }),
    );
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

  /** A tab shown (its pane drawn afresh). */
  setTab(id: Tab) {
    this.tab = id;
    for (const [k, b] of this.tabBtns) {
      b.classList.toggle("on", k === id);
      b.setAttribute("aria-selected", String(k === id));
    }
    for (const [k, p] of this.panes) p.hidden = k !== id;
    if (id === "wakes") this.drawWakes();
    if (id === "memory") this.drawMemory();
    if (id === "talk") this.drawHistory();
  }

  /** Its look: moved to (x, y), larger, folded — kept for the next visit. */
  setLook(o: { x?: number; y?: number; large?: boolean; folded?: boolean }, keep = true) {
    if (o.large !== undefined) this.el.classList.toggle("large", o.large);
    if (o.folded !== undefined) this.el.classList.toggle("folded", o.folded);
    if (o.x !== undefined && o.y !== undefined) {
      const r = this.el.getBoundingClientRect();
      const x = Math.min(Math.max(0, o.x), Math.max(0, innerWidth - Math.max(r.width, 260)));
      const y = Math.min(Math.max(0, o.y), Math.max(0, innerHeight - 60));
      this.el.classList.add("floating");
      this.el.style.left = `${x}px`;
      this.el.style.top = `${y}px`;
    }
    if (o.x === undefined && o.y === undefined && keep && "dock" in o) {
      this.el.classList.remove("floating");
      this.el.style.left = this.el.style.top = "";
    }
    if (!keep) return;
    const floating = this.el.classList.contains("floating");
    store.setJSON(POS_KEY, {
      ...(floating ? { x: Number.parseFloat(this.el.style.left), y: Number.parseFloat(this.el.style.top) } : {}),
      large: this.el.classList.contains("large"),
      folded: this.el.classList.contains("folded"),
    });
  }

  /** The grip: dragged, the console follows; a double click docks it back. */
  private grip(g: HTMLElement) {
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = this.el.getBoundingClientRect();
      const dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      g.setPointerCapture(e.pointerId);
      this.el.classList.add("dragging");
      const move = (m: PointerEvent) => this.setLook({ x: m.clientX - dx, y: m.clientY - dy }, false);
      const up = (u: PointerEvent) => {
        g.releasePointerCapture(u.pointerId);
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        this.el.classList.remove("dragging");
        this.setLook({ x: u.clientX - dx, y: u.clientY - dy });
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
    });
    g.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.setLook({ dock: true } as never);
    });
  }

  /** A sub-agent's news (B5): its card made or updated in the Agents tab, its badge. */
  subagent(u: { name: string; state: "running" | "done" | "failed"; line: string }) {
    let s = this.subs.get(u.name);
    if (!s) {
      const card = el("div", "tp-sub");
      card.dataset.testid = "tars-sub";
      this.agentsEl.querySelector(".tp-empty")?.remove();
      this.agentsEl.append(card);
      s = { state: u.state, line: u.line, at: performance.now(), el: card };
      this.subs.set(u.name, s);
    }
    s.state = u.state;
    s.line = u.line;
    s.el.className = `tp-sub ${u.state}`;
    s.el.replaceChildren(
      el("span", "tp-sub-mark", u.state === "running" ? "◌" : u.state === "done" ? "✓" : "✗"),
      el("b", "", u.name),
      // (its conclusion as text: a model's markdown marks dropped)
      el("p", "", u.line.replace(/\*\*|__|`/g, "").replace(/^\s*[-*]\s+/gm, "• ")),
    );
    this.badge("agents", [...this.subs.values()].filter((x) => x.state === "running").length);
  }

  /** The sub-agents' cards let go (a new batch). */
  clearSubagents() {
    this.subs.clear();
    this.agentsEl.replaceChildren(
      el(
        "p",
        "tp-empty",
        tr({
          fr: "Aucun sous-agent en cours. Demandez-lui une analyse en parallèle.",
          en: "No sub-agent at work. Ask him for analyses in parallel.",
        }),
      ),
    );
    this.badge("agents", 0);
  }

  private badge(id: Tab, n: number) {
    const b = this.tabBtns.get(id);
    if (b) b.dataset.badge = n ? String(n) : "";
  }

  /** The Wakings tab: the hour's budget, all on or off, each rule. */
  drawWakes() {
    const w = this.host.wakes?.();
    this.wakesEl.replaceChildren();
    if (!w) return;
    const head = el("div", "tp-wakes-head");
    const all = el("label", "tp-switch");
    const box = el("input");
    box.type = "checkbox";
    box.checked = w.on;
    box.dataset.testid = "tars-wake-all";
    box.addEventListener("change", () => {
      this.host.wakeAll?.(box.checked);
      this.drawWakes();
    });
    all.append(box, el("span", "", tr({ fr: "Réveils actifs", en: "Wakings on" })));
    const meter = el("div", "tp-meter");
    const f = w.perHour > 0 ? Math.min(1, w.spent / w.perHour) : 1;
    meter.style.setProperty("--f", String(f));
    meter.title = tr({ fr: "Coût de la dernière heure / plafond", en: "The last hour's cost / ceiling" });
    const mtext = el("span", "tp-meter-text", `${w.spent.toFixed(4)} / ${w.perHour.toFixed(2)} $ · ${tr({ fr: "h", en: "h" })}`);
    head.append(all, meter, mtext);
    if (w.why)
      head.append(
        el(
          "em",
          "",
          w.why === "budget"
            ? tr({ fr: "plafond atteint : en veille", en: "ceiling reached: waiting" })
            : tr({ fr: "pause entre deux réveils", en: "gap between two wakings" }),
        ),
      );
    const list = el("ul", "tp-rules");
    for (const r of w.rules) {
      const li = el("li", `tp-rule${r.enabled ? "" : " off"}${r.reflex ? " reflex" : ""}`);
      li.dataset.testid = "tars-rule";
      li.dataset.id = r.id;
      const sw = el("input");
      sw.type = "checkbox";
      sw.checked = r.enabled;
      sw.setAttribute("aria-label", r.prompt);
      sw.addEventListener("change", () => {
        this.host.wakeToggle?.(r.id, sw.checked);
        this.drawWakes();
      });
      const when = `${tr(KIND_WORDS[r.kind] ?? { fr: r.kind, en: r.kind })}${r.kind === "every" ? ` ${r.minutes ?? 10} min` : r.to ? ` · ${r.to}` : ""}`;
      const txt = el("div", "tp-rule-text");
      txt.append(el("b", "", `${r.reflex ? "⚡ " : "⏲ "}${when}`), el("p", "", r.prompt));
      const meta = el("span", "tp-rule-meta", r.fired ? `×${r.fired}` : "");
      li.append(sw, txt, meta);
      if (!r.reflex) {
        const x = el("button", "tp-x", "×");
        x.type = "button";
        x.title = tr({ fr: "Supprimer", en: "Delete" });
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          this.host.wakeRemove?.(r.id);
          this.drawWakes();
        });
        li.append(x);
      }
      list.append(li);
    }
    const hint = el(
      "p",
      "tp-hint",
      tr({
        fr: "Demandez-lui : « toutes les 10 minutes, vérifie le carburant », « à chaque étape du hub, annonce-la »…",
        en: 'Ask him: "every 10 minutes, check the fuel", "at each hub step, call it out"…',
      }),
    );
    this.wakesEl.append(head, list, hint);
    this.badge("wakes", w.rules.filter((r) => r.enabled && !r.reflex).length);
  }

  /** The Memory tab: his notes (each forgotten by its ×), the summary, all cleared. */
  drawMemory() {
    const m = this.host.memoryContents?.();
    this.memoryEl.replaceChildren();
    if (!m) return;
    const notes = el("ul", "tp-notes");
    for (const n of m.notes) {
      const li = el("li");
      const x = el("button", "tp-x", "×");
      x.type = "button";
      x.title = tr({ fr: "Oublier", en: "Forget" });
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        this.host.forget?.(n);
        this.drawMemory();
        this.refresh();
      });
      li.append(el("span", "", n), x);
      notes.append(li);
    }
    if (!m.notes.length)
      notes.append(
        el(
          "li",
          "tp-empty",
          tr({
            fr: "Aucune note. Il en prend quand vous lui dites qui vous êtes ou ce que vous préférez.",
            en: "No notes. He takes some when you tell him who you are or what you like.",
          }),
        ),
      );
    this.memoryEl.append(el("h4", "", tr({ fr: "Ses notes", en: "His notes" })), notes);
    if (m.summary)
      this.memoryEl.append(
        el("h4", "", tr({ fr: "Résumé des échanges anciens", en: "Older exchanges, summarized" })),
        el("p", "tp-summary", m.summary),
      );
    this.memoryEl.append(el("p", "tp-hint", tf("memory: {0} exchanges", m.turns.length)));
  }

  /** The past exchanges, above the current one (the last ones, small). */
  drawHistory() {
    const m = this.host.memoryContents?.();
    this.history.replaceChildren();
    if (!m) return;
    for (const t of m.turns.slice(-7, -1)) {
      const li = el("li");
      // (a waking of his own: what woke him, not his instruction to himself)
      const woke = /^\[Woken by your [^—]*— (.*?)\. No pilot/.exec(t.user);
      li.append(el("span", "tp-h-you", woke ? `⚡ ${woke[1]}` : t.user), el("span", "tp-h-tars", t.tars || "—"));
      this.history.append(li);
    }
    this.history.scrollTop = this.history.scrollHeight;
  }

  /** What he follows (B4): the hub's card mirrored — its step, its progress, its rows, its callout, its graph's
   *  verdict (in the corridor, out of it: its fix) —; null: nothing to follow. */
  follow(
    h: {
      title: string;
      step: string;
      progress: number | null;
      rows: [string, string, string?][];
      next: string | null;
      callout: string | null;
      verdict: "on" | "off" | "wait" | null;
      fix?: string;
    } | null,
  ) {
    this.followEl.hidden = !h;
    if (!h) return;
    const key = JSON.stringify(h);
    if (this.followEl.dataset.key === key) return;
    this.followEl.dataset.key = key;
    this.followEl.replaceChildren();
    const head = el("header");
    const v = el(
      "span",
      `tp-verdict ${h.verdict ?? "none"}`,
      h.verdict === "on"
        ? tr({ fr: "dans le couloir", en: "in corridor" })
        : h.verdict === "off"
          ? tr({ fr: "hors couloir", en: "off corridor" })
          : h.verdict === "wait"
            ? tr({ fr: "pas encore", en: "not yet" })
            : "",
    );
    head.append(el("small", "", tr({ fr: "Suivi", en: "Following" })), el("b", "", h.title), v);
    const step = el("p", "tp-step", h.step);
    this.followEl.append(head, step);
    if (h.progress !== null) {
      const bar = el("div", "tp-bar");
      bar.style.setProperty("--f", String(Math.min(1, Math.max(0, h.progress))));
      this.followEl.append(bar);
    }
    if (h.rows.length) {
      const dl = el("dl", "tp-rows");
      for (const [k, val, tone] of h.rows.slice(0, 6)) {
        const dd = el("dd", "", val);
        if (tone) dd.dataset.tone = tone;
        dl.append(el("dt", "", k), dd);
      }
      this.followEl.append(dl);
    }
    if (h.callout) this.followEl.append(el("p", "tp-callout", h.callout));
    if (h.verdict === "off" && h.fix) this.followEl.append(el("p", "tp-fix", h.fix));
    if (h.next) this.followEl.append(el("p", "tp-next", h.next));
  }

  /** The hour's budget in the head (null: none). */
  budget(text: string | null, warn = false) {
    this.budgetEl.textContent = text ?? "";
    this.budgetEl.hidden = !text;
    this.budgetEl.classList.toggle("warn", warn);
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
    if (this.tab !== "talk") this.setTab("talk");
    else this.drawHistory();
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
    // (its buttons in sight, the console scrolled to them)
    requestAnimationFrame(() => bar.scrollIntoView({ block: "nearest" }));
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

  /** The field ready for a key (/key). */
  pasteMode() {
    if (!this.open) this.show();
    this.setKeyMode(true);
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
