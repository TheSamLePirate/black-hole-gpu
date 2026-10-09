// OpenRouter for TARS (PLAN-TARS T6): the player's own key — got by "Sign in with OpenRouter" (OAuth with
// PKCE, no server: a popup, the callback page pwa/openrouter.html hands the code back, exchanged here) or
// pasted —, kept in this browser's storage only (never in the settings, a save, an export, the code); the
// text by z-ai/glm-5.3-flash (chat completions), the typed decisions by Jev (typesafe/jev, the alpha
// decisions endpoint: yes/no, choice and score questions answered with probabilities, in parallel); what
// the session has cost, from the responses' own usage. Every call bounded in time; a failure is null — TARS
// answers offline then.

import { store } from "../util/storage";

const BASE = "https://openrouter.ai";
export const TEXT_MODEL = "z-ai/glm-5.3-flash";
export const DECISION_MODEL = "typesafe/jev-1.13";
/** the alias that follows Jev's releases: asked if the pinned one is refused (retired) */
export const DECISION_ALIAS = "~typesafe/jev-latest";
const KEY = "kerr.openrouter.key";
const VERIFIER = "kerr.openrouter.verifier";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The key: this browser's (none: offline). */
export const openRouterKey = {
  get(): string | null {
    const k = store.get(KEY);
    return k && /^sk-or-/.test(k) ? k : null;
  },
  set(k: string): boolean {
    const v = k.trim();
    if (!/^sk-or-[\w-]{8,}$/.test(v)) return false;
    return store.set(KEY, v);
  },
  clear() {
    store.remove(KEY);
  },
  /** its end, to show it is there without showing it */
  hint(): string | null {
    const k = this.get();
    return k ? `…${k.slice(-4)}` : null;
  },
};

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** PKCE: a verifier (32 random bytes) and its S256 challenge. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/** The authorization page's URL, its callback this site's pwa/openrouter.html. */
export function authUrl(challenge: string, here: string): string {
  const cb = new URL("openrouter.html", here).href;
  return `${BASE}/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${challenge}&code_challenge_method=S256&key_label=${encodeURIComponent("Kerr · TARS")}`;
}

/** The code exchanged for a key (kept). Null: refused. */
export async function exchangeCode(code: string, verifier: string, fetchFn: Fetch = fetch): Promise<string | null> {
  try {
    const r = await fetchFn(`${BASE}/api/v1/auth/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { key?: string };
    return j.key && openRouterKey.set(j.key) ? j.key : null;
  } catch {
    return null;
  }
}

/** "Sign in with OpenRouter": a popup to its authorization; resolves with the key once exchanged (null:
 *  cancelled, refused, the popup blocked). The verifier kept for the tab (a phone's redirect comes back to it). */
export async function connect(win: Window = window, fetchFn: Fetch = fetch): Promise<string | null> {
  const { verifier, challenge } = await pkce();
  try {
    sessionStorage.setItem(VERIFIER, verifier);
  } catch {}
  const pop = win.open(authUrl(challenge, win.location.href), "openrouter", "width=520,height=720");
  if (!pop) {
    // (no popup: the page itself goes, and comes back with the code — finishFromFragment)
    win.location.href = authUrl(challenge, win.location.href);
    return null;
  }
  return new Promise((done) => {
    const on = async (e: MessageEvent) => {
      if (e.origin !== win.location.origin || (e.data as { type?: string })?.type !== "kerr-openrouter") return;
      win.removeEventListener("message", on);
      done(await exchangeCode(String((e.data as { code: string }).code), verifier, fetchFn));
    };
    win.addEventListener("message", on);
    // (the popup closed without a code: given up)
    const watch = setInterval(() => {
      if (pop.closed) {
        clearInterval(watch);
        setTimeout(() => {
          win.removeEventListener("message", on);
          done(null);
        }, 1500);
      }
    }, 500);
  });
}

/** A phone's way back (no popup): the code in the page's fragment, exchanged with the tab's verifier. */
export async function finishFromFragment(win: Window = window, fetchFn: Fetch = fetch): Promise<string | null> {
  const m = /[#&]openrouter-code=([^&]+)/.exec(win.location.hash);
  if (!m) return null;
  history.replaceState(null, "", win.location.pathname + win.location.search);
  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER);
  } catch {}
  return verifier ? exchangeCode(decodeURIComponent(m[1]!), verifier, fetchFn) : null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A Jev question: yes/no, a choice among options (each described), a score on an ordered scale. */
export type Question =
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number };

/** The calls, the session's cost. */
export class OpenRouter {
  /** what the session has cost [USD], and the calls made */
  spent = 0;
  calls = 0;
  /** the reasoning switched off in the chat's request (dropped if refused) */
  private noReasoning = true;
  /** Jev's model asked (the pinned one; its alias once refused) */
  decisionModel = DECISION_MODEL;

  constructor(
    private key: () => string | null = () => openRouterKey.get(),
    private fetchFn: Fetch = (u, i) => fetch(u, i),
  ) {}

  private headers(k: string) {
    return {
      Authorization: `Bearer ${k}`,
      "Content-Type": "application/json",
      "HTTP-Referer": typeof location !== "undefined" ? location.origin : "https://samlepirate.org",
      "X-Title": "Kerr",
    };
  }

  /** A chat completion's text (null: no key, a failure, the time out). */
  async chat(messages: ChatMessage[], o: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): Promise<string | null> {
    const k = this.key();
    if (!k) return null;
    try {
      const ask = () =>
        this.fetchFn(`${BASE}/api/v1/chat/completions`, {
          method: "POST",
          headers: this.headers(k),
          body: JSON.stringify({
            model: TEXT_MODEL,
            messages,
            max_tokens: o.maxTokens ?? 160,
            temperature: o.temperature ?? 0.7,
            // (its cost in the response's usage; no reasoning: a short spoken line, now)
            usage: { include: true },
            ...(this.noReasoning ? { reasoning: { enabled: false } } : {}),
          }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 12_000),
        });
      let r = await ask();
      // (the reasoning switch refused: asked without it, for the session)
      if (r.status === 400 && this.noReasoning) {
        this.calls++;
        this.noReasoning = false;
        r = await ask();
      }
      this.calls++;
      if (!r.ok) return null;
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number } };
      this.spent += j.usage?.cost ?? 0;
      const text = j.choices?.[0]?.message?.content?.trim();
      return text ? text : null;
    } catch {
      return null;
    }
  }

  /** Jev's typed answers to questions on a state (null: no key, a failure). */
  async decide(state: object, questions: Record<string, Question>, timeoutMs = 8_000): Promise<Record<string, Answer> | null> {
    const k = this.key();
    if (!k) return null;
    try {
      const ask = (model: string) =>
        this.fetchFn(`${BASE}/api/alpha/decisions`, {
          method: "POST",
          headers: this.headers(k),
          body: JSON.stringify({ model, state, questions }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      let r = await ask(this.decisionModel);
      this.calls++;
      // (the pinned version refused — retired —: the alias that follows Jev's releases, kept for the session)
      if ((r.status === 400 || r.status === 404) && this.decisionModel !== DECISION_ALIAS) {
        this.decisionModel = DECISION_ALIAS;
        r = await ask(this.decisionModel);
        this.calls++;
      }
      if (!r.ok) return null;
      const j = (await r.json()) as { answers?: Record<string, Answer>; usage?: { cost?: number } };
      this.spent += j.usage?.cost ?? 0;
      return j.answers ?? null;
    } catch {
      return null;
    }
  }
}
