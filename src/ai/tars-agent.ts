// TARS the agent in the game (PLAN-TARS-AGENT A3): a question → a turn of the agent (agent.ts) with the game's
// tools (game-tools.ts), his character and the flight's state in the prompt, his memory (memory.ts) before
// the question; his words said on the way and at the end, his actions shown as they happen; the turn kept
// in his memory, the oldest summarized when it grows. One turn at a time: a new question stops the one
// running, and so do "stop", Escape. Null when the model fails: the caller answers offline.

import type { Personality, TarsState } from "../game/tars";
import { Agent, actionLine, resultShort, type Action, type Tool } from "./agent";
import { checkArgs } from "./tool-schema";
import { summaryPrompt, type TarsMemory } from "./memory";
import type { OpenRouter } from "./openrouter";
import { systemPrompt } from "./tars-online";
import { parseOrders } from "./offline-orders";
import type { Proposal } from "./game-tools";

export interface TarsAgentDeps {
  or: OpenRouter;
  tools: () => Tool[];
  memory: TarsMemory;
  personality(): Personality;
  lang(): "fr" | "en";
  flight(): TarsState;
  /** a line said (his voice, subtitled) */
  say(text: string): void;
  /** an action begun */
  onCall?(tool: string, args: Record<string, unknown>): void;
  /** an action done, as it ends: what it came back with (short), whether it went, its full line, its tool */
  onAction(result: string, ok: boolean, full: string, tool: string): void;
  onBusy(busy: boolean): void;
}

/** What makes TARS an agent, after his character (tars-online.ts systemPrompt). */
export function agentPrompt(p: Personality, lang: "fr" | "en"): string {
  return [
    systemPrompt(p, lang),
    "You are also the ship's agent: you can do anything in the game with your tools — fly (autopilots, holds, controls), navigate (target, manoeuvres, missions), the time, the camera and views, the interface, teleport the ship, the date, saves and scenes, every setting, any key.",
    "Two kinds of requests. ORDERS ('land us', 'target Mars', 'pose-nous', 'vise', 'mets…'): do them with the tools straight away — never ask for confirmation, never just explain how; chain the tools a task needs (target, then plan_mission; a site, then the entry autopilot; warp, then wait). PROPOSALS ('propose-moi un plan pour…', 'que proposes-tu', 'suggest a plan', 'what would you do'): do not act — gather real figures (read tools; plan_mission or plan_maneuver with execute: false), then call propose_plan once; the pilot accepts or refuses on screen, and only if accepted are you asked to carry it out.",
    "To show the pilot something — a graph, the telemetry, figures, a comparison, a screen — use show_chart (the flight's channels live, or series you computed), show_card (a card of figures), show_screen (the map, the tablet's pages, a cockpit display, the flight report); hide_display closes them. Prefer showing over reciting numbers.",
    "Read the state (get_state) when you need figures you were not given; use list_places, find_settings, list_keys to find names. If a tool returns an error, correct the call or try another way; say plainly what could not be done.",
    "Teleporting (place_ship) is instant; flying there (plan_mission, autopilots) takes the game's time: when the pilot says 'take us', 'fly', 'go' choose a real flight; 'put us', 'teleport', 'directly' a teleport.",
    "For long tasks only, say a short line before waiting (say), warp time with `time` and `wait` for the outcome when it matters; otherwise answer once the action is engaged. Never use say for your final answer.",
    "After a teleport, a load, a date change or a scene, the previous state is saved as 'Before TARS' (saves action undo goes back).",
    "Your memory: whenever the pilot tells you something about themselves (their name, a preference, a goal) or asks you to remember, call memory with action remember and a short note; forget when asked; clear everything only if the pilot asks you to forget all.",
    "You know the flight in depth: get_telemetry gives the attitude (bank, pitch, AoA…), the air, the controls, what each autopilot commands (the entry's commanded bank and AoA, the approach's profile and PAPI, the burn's cue), the hub's current step and its deviations — read it during manoeuvres, entries and landings rather than guessing. show_screen hub_graph / entry_corridor shows the live corridor; camera shipView brings the ship's view back.",
    "You can wake yourself: schedule a rule (on an autopilot change, a phase, a hub step, an entry phase, an alert, a deviation, a landing, every N minutes, at a game time) when the pilot asks you to watch, remind or react. Your reflexes already wake you at the key moments; when woken, act or speak only if it is worth it.",
    "For analyses that need several looks or comparisons, spawn_agents runs copies of you in parallel (they read and compute only); then you decide and act.",
    "Never say you did something unless a tool call in this turn did it.",
    "Your final answer is spoken: one or two short sentences, plain text.",
  ].join(" ");
}

const UNACTED =
  "(Check: you answered without calling any tool, but the pilot gave an order — nothing has been done in the game. Do it now with the tools (to cancel or go back: saves with action undo), then answer. If it truly needs no action, repeat your answer.)";
const YES =
  /^\s*(oui|ouais|ok|okay|d'accord|vas[- ]y|go|accepte|j'accepte|on y va|c'est parti|yes|yep|do it|accept(ed)?|approved?|let's go)\b/i;
const NO = /^\s*(non|nan|refuse|je refuse|pas question|no|nope|refused?|reject(ed)?|cancel)\b/i;
const STOP = /^\s*(stop|halt|cancel|arr[eê]te|stoppe|annule (le|ce) tour|tais[- ]toi)\b/i;

export class TarsAgent {
  private agent: Agent;
  private ctl: AbortController | null = null;
  busy = false;
  /** the last turn's actions and answer (the tests, the panel) */
  last: Action[] = [];
  lastText: string | null = null;

  constructor(private d: TarsAgentDeps) {
    this.agent = new Agent((m, fns, signal) => d.or.complete(m, fns, { signal }), d.tools);
  }

  /** a plan proposed and not yet answered (propose_plan) */
  pending: Proposal | null = null;

  static isYes(q: string) {
    return YES.test(q);
  }
  static isNo(q: string) {
    return NO.test(q);
  }

  /** The words that carry out an accepted plan (asked to the agent as the pilot's). */
  static acceptance(p: Proposal, lang: "fr" | "en") {
    const steps = p.steps.map((x, i) => `${i + 1}. ${x}`).join(" ");
    return lang === "fr"
      ? `J'accepte ton plan « ${p.title} » (${steps}). Exécute-le maintenant, en entier.`
      : `I accept your plan "${p.title}" (${steps}). Carry it out now, all of it.`;
  }

  /** whether the words only stop the turn running */
  static isStop(q: string) {
    return STOP.test(q);
  }

  stop() {
    this.ctl?.abort();
  }

  /** A question: his answer (said), or null — the model failed or there is no key: answer offline. */
  async ask(q: string): Promise<string | null> {
    this.stop();
    const ctl = new AbortController();
    this.ctl = ctl;
    this.busy = true;
    this.d.onBusy(true);
    const lang = this.d.lang();
    const flight = this.d.flight();
    try {
      const r = await this.agent.turn(
        [{ role: "system", content: agentPrompt(this.d.personality(), lang) }, ...this.d.memory.context()],
        `${this.d.memory.carry()}Flight data now: ${JSON.stringify(flight)}\nPilot: ${q}`,
        {
          signal: ctl.signal,
          onAction: (a) => this.d.onAction(resultShort(a), a.ok, actionLine(a), a.tool),
          onStep: (text) => this.d.say(text),
          onCall: (tool, args) => this.d.onCall?.(tool, args),
          // (an order — the words read as one offline — answered with no tool called: nothing was done; sent
          // back once to do it, rather than let him claim it)
          unacted: () => (parseOrders(q).length ? UNACTED : null),
        },
      );
      this.last = r.actions;
      this.lastText = r.text;
      // (stopped by a new question: that one answers)
      if (r.cut === "stopped") {
        this.keep(q, "", r.actions);
        return this.ctl === ctl ? "" : null;
      }
      // (a model copying a tool call's form into its words: the bracket dropped)
      if (r.text) r.text = r.text.replace(/^\s*\[(?:actions?|tools?)[^\]]*\]\s*/i, "").trim() || null;
      const text = r.text ?? (r.actions.length ? (r.cut === "steps" ? doneWord(lang, "steps") : doneWord(lang, "time")) : null);
      if (text === null) return null;
      this.keep(q, text, r.actions);
      return text;
    } finally {
      if (this.ctl === ctl) {
        this.ctl = null;
        this.busy = false;
        this.d.onBusy(false);
      }
    }
  }

  private keep(q: string, text: string, actions: Action[]) {
    this.d.memory.add({ at: Date.now(), user: q, tars: text, did: actions.map(actionLine) });
    if (this.d.memory.full)
      void this.d.memory.compact(async (prev, turns) =>
        this.d.or.chat(summaryPrompt(prev, turns), { maxTokens: 500, temperature: 0.2, timeoutMs: 30_000 }),
      );
  }
}

const doneWord = (lang: "fr" | "en", why: "steps" | "time") =>
  lang === "fr"
    ? why === "steps"
      ? "J'ai fait ce que j'ai pu, je m'arrête là."
      : "Ça prend trop de temps, je m'arrête là."
    : why === "steps"
      ? "I've done what I could; stopping there."
      : "That's taking too long; stopping there.";

/** Orders understood offline (offline-orders.ts) run by the same tools: what each did. */
export async function runOrders(
  orders: { tool: string; args: Record<string, unknown> }[],
  tools: Tool[],
  onAction: (result: string, ok: boolean, full: string, tool: string) => void,
  onCall?: (tool: string, args: Record<string, unknown>) => void,
): Promise<{ tool: string; ok: boolean; error?: string }[]> {
  const done: { tool: string; ok: boolean; error?: string }[] = [];
  for (const o of orders) {
    onCall?.(o.tool, o.args);
    const t = tools.find((x) => x.name === o.tool);
    const chk = t ? checkArgs(t, o.args) : null;
    let a: Action;
    if (!t || !chk) a = { tool: o.tool, args: o.args, ok: false, result: "no such tool" };
    else if (!chk.ok) a = { tool: o.tool, args: o.args, ok: false, result: chk.error };
    else
      try {
        a = { tool: o.tool, args: chk.args, ok: true, result: (await t.run(chk.args, new AbortController().signal)) ?? "done" };
      } catch (e) {
        a = { tool: o.tool, args: o.args, ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    onAction(resultShort(a), a.ok, actionLine(a), a.tool);
    done.push({ tool: a.tool, ok: a.ok, error: a.ok ? undefined : String(a.result) });
  }
  return done;
}
