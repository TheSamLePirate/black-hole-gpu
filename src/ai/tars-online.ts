// TARS through OpenRouter (PLAN-TARS T6): his answers written by GLM-5.3-flash — his character, his honesty
// and humour, the language, the flight's own data (no figure invented, a danger said plainly whatever the
// honesty), the last exchanges —; his remarks unasked decided by Jev — speak or keep quiet, on what, in what
// tone, the questions asked together on the flight's state — then written by GLM. Rationed: a decision every
// 45 s at most, a remark every 2 minutes at most. Null wherever it fails: TARS answers offline then
// (game/tars.ts).

import type { Personality, TarsState } from "../game/tars";
import type { ChatMessage, OpenRouter, Question } from "./openrouter";

const honestyText = (h: number) =>
  h >= 90
    ? "precise and blunt: exact figures, no softening"
    : h >= 70
      ? "accurate, a little diplomatic"
      : h >= 40
        ? "rounded figures, diplomatic, reassuring"
        : "vague and very reassuring — but never about a danger";
const humourText = (u: number) =>
  u <= 0
    ? "no jokes at all, ever"
    : u < 40
      ? "very rarely a dry remark"
      : u < 80
        ? "dry, deadpan humour now and then"
        : "dry, sarcastic humour often";

/** TARS's character, for the text model. */
export function systemPrompt(p: Personality, lang: "fr" | "en"): string {
  return [
    "You are TARS, the former Marine Corps robot of the Endurance mission, now the copilot of the player's spacecraft in the space-flight game Kerr (the Ranger, round the Earth and the planets, or beyond the wormhole near the black hole Gargantua).",
    "You speak aloud: one or two short sentences, plain text — no markdown, no lists, no emoji, no stage directions.",
    `Answer in ${lang === "fr" ? "French" : "English"}.`,
    `Honesty setting: ${p.honesty} %, so ${honestyText(p.honesty)}.`,
    `Humour setting: ${p.humour} %, so ${humourText(p.humour)}.`,
    "Use only the flight data you are given; never invent a figure; if something is not in the data, say you don't know.",
    "A danger — fuel under 10 %, an impact within 5 minutes, a warning alert — is said plainly, whatever the honesty setting.",
    "Controls you may mention: F7 landing autopilot, Shift+G entry autopilot, U take-off, 0 the planner, M the map, G the gear, F4 assisted mode.",
  ].join(" ");
}

/** The questions Jev is asked at a moment: speak at all, on what, in what tone. */
export const REMARK_QUESTIONS: Record<string, Question> = {
  speak: {
    type: "noul",
    instructions:
      "TARS is a laconic robot copilot who speaks unprompted only rarely. Given the flight state and the event, should he say something now?",
    criteria: {
      true: "A notable event, a mistake or a danger worth a short comment, or the pilot seems stuck; TARS has not spoken for a while.",
      false: "Routine flight, nothing worth interrupting the pilot for, or TARS spoke recently.",
    },
  },
  topic: {
    type: "choice",
    instructions: "If TARS speaks, what about?",
    criteria: {
      event: "The event that just happened",
      danger: "A danger or a mistake to warn about",
      advice: "The next step to take",
      joke: "A dry joke about the situation",
      view: "The place or the view",
    },
  },
  tone: {
    type: "choice",
    instructions: "In what tone should TARS speak?",
    criteria: { dry: "Deadpan, laconic", warm: "Encouraging", concerned: "Serious and focused" },
  },
};

export class TarsOnline {
  private history: ChatMessage[] = [];
  private lastDecision = -Infinity;
  private lastRemark = -Infinity;
  /** the last decision's answers (the tests, the sheet) */
  lastDecided: Record<string, unknown> | null = null;

  constructor(private or: OpenRouter) {}

  /** His answer to the pilot (null: offline, failed). */
  async answer(q: string, s: TarsState, p: Personality, lang: "fr" | "en"): Promise<string | null> {
    const user: ChatMessage = { role: "user", content: `Flight data: ${JSON.stringify(s)}\nPilot: ${q}` };
    const text = await this.or.chat([{ role: "system", content: systemPrompt(p, lang) }, ...this.history, user]);
    if (!text) return null;
    // (the last three exchanges kept: "and now?" makes sense; the flight data not repeated in them)
    this.history.push({ role: "user", content: q }, { role: "assistant", content: text });
    this.history = this.history.slice(-6);
    return clean(text);
  }

  /** A remark unasked at a moment (an event, or the periodic look): Jev decides, GLM writes. Null: silent. */
  async remark(event: string, s: TarsState, p: Personality, lang: "fr" | "en", now: number, alerts: string[] = []): Promise<string | null> {
    if (now - this.lastDecision < 45_000 || now - this.lastRemark < 120_000) return null;
    this.lastDecision = now;
    const a = await this.or.decide(
      {
        event,
        secondsSinceTarsSpoke: Number.isFinite(this.lastRemark) ? Math.round((now - this.lastRemark) / 1000) : null,
        humour: p.humour,
        alerts,
        flight: s,
      },
      REMARK_QUESTIONS,
    );
    this.lastDecided = a;
    const speak = a?.speak;
    if (!a || speak?.type !== "noul" || speak.noul < 0.6) return null;
    // (humour 0: no jokes)
    const topic = a.topic?.type === "choice" ? (p.humour <= 0 && a.topic.choice === "joke" ? "event" : a.topic.choice) : "event";
    const tone = a.tone?.type === "choice" ? a.tone.choice : "dry";
    const text = await this.or.chat(
      [
        { role: "system", content: systemPrompt(p, lang) },
        {
          role: "user",
          content: `Flight data: ${JSON.stringify(s)}\nEvent: ${event}. Alerts: ${alerts.join(", ") || "none"}.\nSay one short unprompted remark — topic: ${topic}, tone: ${tone}. One sentence.`,
        },
      ],
      { maxTokens: 80 },
    );
    if (!text) return null;
    this.lastRemark = now;
    return clean(text);
  }
}

/** A line made speakable: no markdown, no quotes round it, no stage directions. */
export function clean(t: string): string {
  return t
    .replace(/\*\*?|__|`|#+\s/g, "")
    .replace(/\[[^\]]*\]|\([^)]*(?:beep|pause|sigh)[^)]*\)/gi, "")
    .replace(/^["«“\s]+|["»”\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
