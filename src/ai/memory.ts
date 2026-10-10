// TARS's memory (PLAN-TARS-AGENT): one conversation kept across visits — in this browser's storage, never
// in a save, the settings or an export — and cleared on demand (the panel's button, "forget everything").
//   - the turns: the pilot's words, his answer, a line per action he took (not the tools' messages);
//   - the summary: once the turns grow past their budget, the oldest are summarized (by the model, or
//     trimmed when offline) into a few lines that stay;
//   - the notes: what TARS chose to remember (the pilot's name, a preference, a plan), each a line.
// What the model is given: its system prompt, then the summary and the notes, then the turns.

import type { AgentMessage } from "./agent";
import type { ChatMessage } from "./openrouter";

export interface Turn {
  /** when [ms since the epoch] */
  at: number;
  user: string;
  /** his answer (empty: none — offline, stopped) */
  tars: string;
  /** a line per action ("autopilot(mode=land) → engaged") */
  did?: string[];
}

export interface MemoryData {
  v: 1;
  summary: string;
  notes: string[];
  turns: Turn[];
}

export interface MemoryStore {
  get(): MemoryData | null;
  set(d: MemoryData): boolean;
  clear(): void;
}

/** where it is kept (this browser's storage; never in a save, the settings, an export) */
export const TARS_MEMORY_KEY = "kerr.tars.memory";

/** turns kept word for word; past it the oldest half summarized */
export const TURNS_KEPT = 24;
export const NOTES_MAX = 40;
const NOTE_CHARS = 200;
const SUMMARY_CHARS = 2400;

const empty = (): MemoryData => ({ v: 1, summary: "", notes: [], turns: [] });

export class TarsMemory {
  private d: MemoryData;

  constructor(private store: MemoryStore) {
    const got = store.get();
    this.d = got && got.v === 1 && Array.isArray(got.turns) ? { ...empty(), ...got } : empty();
  }

  get turns(): readonly Turn[] {
    return this.d.turns;
  }
  get notes(): readonly string[] {
    return this.d.notes;
  }
  get summary(): string {
    return this.d.summary;
  }
  get empty(): boolean {
    return !this.d.turns.length && !this.d.notes.length && !this.d.summary;
  }

  private save() {
    this.store.set(this.d);
  }

  add(t: Turn) {
    this.d.turns.push({ ...t, did: t.did?.length ? t.did.slice(0, 12) : undefined });
    this.save();
  }

  /** a note kept (the same not twice); false: empty or the notes full */
  remember(note: string): boolean {
    const n = note.trim().replace(/\s+/g, " ").slice(0, NOTE_CHARS);
    if (!n) return false;
    if (this.d.notes.some((x) => x.toLowerCase() === n.toLowerCase())) return true;
    if (this.d.notes.length >= NOTES_MAX) return false;
    this.d.notes.push(n);
    this.save();
    return true;
  }

  /** the notes containing these words dropped: how many */
  forget(about: string): number {
    const k = about.trim().toLowerCase();
    if (!k) return 0;
    const before = this.d.notes.length;
    this.d.notes = this.d.notes.filter((x) => !x.toLowerCase().includes(k));
    this.save();
    return before - this.d.notes.length;
  }

  clear() {
    this.d = empty();
    this.store.clear();
  }

  /** A new conversation (/clear): the exchanges and their summary gone, his notes kept. */
  clearTurns() {
    this.d = { ...this.d, turns: [], summary: "" };
    this.save();
  }

  /** whether the turns have outgrown their budget */
  get full(): boolean {
    return this.d.turns.length > TURNS_KEPT;
  }

  /** The oldest half of the turns folded into the summary: by `summarize` (the model; null: failed — the
   *  turns then simply dropped, their gist lost but the memory bounded). */
  async compact(summarize: ((previous: string, turns: Turn[]) => Promise<string | null>) | null, force = false) {
    if (!this.full && !(force && this.d.turns.length > 2)) return;
    // (forced — /compact —: all but the last two exchanges folded)
    const n = force ? this.d.turns.length - 2 : this.d.turns.length - Math.floor(TURNS_KEPT / 2);
    const old = this.d.turns.slice(0, n);
    const s = summarize ? await summarize(this.d.summary, old) : null;
    if (s) this.d.summary = s.trim().slice(0, SUMMARY_CHARS);
    this.d.turns = this.d.turns.slice(n);
    this.save();
  }

  /** The note of the last turn's actions, for the head of the question asked now. */
  carry(): string {
    const t = this.d.turns.at(-1);
    return t ? actionsNote(t) : "";
  }

  /** What the model is given after its system prompt: the summary and the notes, then the turns. */
  context(): AgentMessage[] {
    const out: AgentMessage[] = [];
    const head: string[] = [];
    if (this.d.summary) head.push(`Earlier conversations with this pilot (summary): ${this.d.summary}`);
    if (this.d.notes.length) head.push(`Your notes (things you chose to remember):\n${this.d.notes.map((n) => `- ${n}`).join("\n")}`);
    if (head.length) out.push({ role: "system", content: head.join("\n\n") });
    // (what he did, noted at the head of the pilot's next words — in his own words the model would copy its
    // form instead of calling the tools; a system message amid the turns not every provider takes)
    let note = "";
    for (const t of this.d.turns) {
      out.push({ role: "user", content: note + t.user });
      out.push({ role: "assistant", content: t.tars.trim() || "(no answer)" });
      note = actionsNote(t);
    }
    return out;
  }
}

/** The note of a turn's actions, put before the next words of the pilot. */
export const actionsNote = (t: Turn) => (t.did?.length ? `(Tools you called in your last answer: ${t.did.join("; ")})\n` : "");

/** The turns written out for the summarizer. */
export function turnsText(turns: Turn[]): string {
  return turns
    .map((t) => {
      const when = new Date(t.at).toISOString().slice(0, 16).replace("T", " ");
      const did = t.did?.length ? ` [did: ${t.did.join("; ")}]` : "";
      return `${when} Pilot: ${t.user}\nTARS: ${t.tars}${did}`;
    })
    .join("\n");
}

/** The summarizer's prompt: the previous summary and the turns, folded. */
export function summaryPrompt(previous: string, turns: Turn[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You keep the memory of TARS, a robot copilot in a space-flight game. Fold the previous summary and these exchanges into one new summary of at most 12 short lines: who the pilot is, what they asked for and liked, what was done (flights, places, landings, settings changed), what is still planned. Facts only, no chatter. Plain text.",
    },
    { role: "user", content: `Previous summary:\n${previous || "(none)"}\n\nExchanges:\n${turnsText(turns)}` },
  ];
}
