// TARS as an agent (PLAN-TARS-AGENT): a turn is the pilot's words, then the model's calls to the game's tools
// — each checked against its schema, run, its result handed back — until it answers in words, or the turn's
// bounds (the steps, the wall time) are reached. Tools that wait (an autopilot to finish, a burn, a phase)
// hold the turn while the game runs on. A turn can be stopped (Escape, a new question, "stop"); its calls
// are listed as they happen (the panel shows them), and only its words and a line per action are kept in
// the memory (memory.ts) — never the tool messages, whose ids would dangle.

import type { ChatMessage } from "./openrouter";
import { checkArgs, toFunction, type Args, type ToolSpec } from "./tool-schema";

export interface Tool extends ToolSpec {
  /** runs it: a result for the model (an object, kept short), or throws — the error said back to the model */
  run(args: Args, signal: AbortSignal): unknown;
}

export interface ToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}

/** A message of the agent's conversation: the chat's, plus the assistant's calls and the tools' results. */
export type AgentMessage =
  | ChatMessage
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** The model's reply: its words and its calls (null: failed). */
export type Complete = (
  messages: AgentMessage[],
  tools: ReturnType<typeof toFunction>[],
  signal: AbortSignal,
) => Promise<{ content: string | null; tool_calls?: ToolCall[] } | null>;

/** One action of a turn: the tool, its arguments, what came back. */
export interface Action {
  tool: string;
  args: Args;
  ok: boolean;
  /** the result (short) or the error */
  result: unknown;
}

export interface TurnResult {
  /** his words (null: the model failed — offline then) */
  text: string | null;
  actions: Action[];
  /** why the turn ended early: "stopped", "steps", "time"; null: answered */
  cut: "stopped" | "steps" | "time" | null;
}

export const MAX_STEPS = 24;
/** a turn's wall time, waits included [ms] */
export const MAX_TURN_MS = 40 * 60_000;
/** a tool's result as said to the model, at most [characters] */
const RESULT_CHARS = 4000;

const short = (v: unknown) => {
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v ?? { ok: true });
  } catch {
    s = String(v);
  }
  return s.length > RESULT_CHARS ? `${s.slice(0, RESULT_CHARS)}… (cut)` : s;
};

export class Agent {
  constructor(
    private complete: Complete,
    private tools: () => Tool[],
    private now: () => number = () => performance.now(),
  ) {}

  /**
   * A turn: `context` the conversation so far (the system prompt first, the memory), `user` the pilot's words.
   * `onAction` hears each action as it ends; `onStep` each step's words said on the way ("Engaging…").
   */
  async turn(
    context: AgentMessage[],
    user: string,
    o: {
      signal?: AbortSignal;
      onAction?: (a: Action) => void;
      onStep?: (text: string) => void;
      /** a call about to run: its tool and arguments (as sent) */
      onCall?: (tool: string, args: Args) => void;
      /** the model answers having done nothing: words to send it back to work (null: the answer stands) —
       *  once a turn (an order answered "done" with no tool called) */
      unacted?: (text: string) => string | null;
      maxSteps?: number;
    } = {},
  ): Promise<TurnResult> {
    const signal = o.signal ?? new AbortController().signal;
    const tools = this.tools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    const fns = tools.map(toFunction);
    const messages: AgentMessage[] = [...context, { role: "user", content: user }];
    const actions: Action[] = [];
    const t0 = this.now();
    const maxSteps = o.maxSteps ?? MAX_STEPS;
    let nudged = false;
    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) return { text: null, actions, cut: "stopped" };
      if (this.now() - t0 > MAX_TURN_MS) return { text: null, actions, cut: "time" };
      const r = await this.complete(messages, fns, signal);
      if (signal.aborted) return { text: null, actions, cut: "stopped" };
      if (!r) return { text: null, actions, cut: null };
      const calls = r.tool_calls ?? [];
      if (!calls.length) {
        const text = r.content?.trim() || null;
        const back = !actions.length && !nudged && text ? (o.unacted?.(text) ?? null) : null;
        if (!back) return { text, actions, cut: null };
        nudged = true;
        messages.push({ role: "assistant", content: text } as ChatMessage, { role: "user", content: back });
        continue;
      }
      if (r.content?.trim()) o.onStep?.(r.content.trim());
      messages.push({ role: "assistant", content: r.content ?? null, tool_calls: calls });
      // (the calls of one reply in their order: a gear then a landing autopilot, not both at once)
      for (const c of calls) {
        if (o.onCall) {
          let args: Args = {};
          try {
            args = JSON.parse(c.function.arguments || "{}") as Args;
          } catch {
            /* shown without its arguments; the call says why */
          }
          o.onCall(c.function.name, args);
        }
        const a = await this.call(byName.get(c.function.name), c, signal);
        actions.push(a);
        o.onAction?.(a);
        messages.push({ role: "tool", tool_call_id: c.id, content: short(a.ok ? a.result : { error: a.result }) });
        if (signal.aborted) return { text: null, actions, cut: "stopped" };
      }
    }
    return { text: null, actions, cut: "steps" };
  }

  private async call(t: Tool | undefined, c: ToolCall, signal: AbortSignal): Promise<Action> {
    const name = c.function.name;
    if (!t) return { tool: name, args: {}, ok: false, result: `no tool named ${name}` };
    const chk = checkArgs(t, c.function.arguments);
    if (!chk.ok) return { tool: name, args: {}, ok: false, result: chk.error };
    try {
      const result = await t.run(chk.args, signal);
      return { tool: name, args: chk.args, ok: true, result: result ?? { ok: true } };
    } catch (e) {
      return { tool: name, args: chk.args, ok: false, result: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** What an action came back with, short, as the console shows it after its step: its note or result, not
 *  its JSON ("3.09 km/s burn in 1.6 h…"); the error when it failed. */
export function resultShort(a: Action): string {
  if (!a.ok) return String(a.result);
  const r = a.result as { note?: unknown; result?: unknown } | string | null;
  const said =
    typeof r === "string" ? r : r && typeof r === "object" ? String(r.note ?? (typeof r.result === "string" ? r.result : "")) : "";
  return said === "done" ? "" : said;
}

/** An action in a line, for the memory and the panel: "autopilot(mode=land, site=Edwards) → engaged". */
export function actionLine(a: Action): string {
  const args = Object.entries(a.args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
  const res = a.ok ? (typeof a.result === "string" ? a.result : short(a.result)) : `error: ${String(a.result)}`;
  return `${a.tool}(${args}) → ${res.length > 140 ? `${res.slice(0, 140)}…` : res}`;
}
