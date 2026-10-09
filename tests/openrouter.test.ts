import { beforeEach, expect, test } from "bun:test";
import { authUrl, DECISION_MODEL, exchangeCode, OpenRouter, openRouterKey, pkce, TEXT_MODEL } from "../src/ai/openrouter";
import { clean, REMARK_QUESTIONS, systemPrompt, TarsOnline } from "../src/ai/tars-online";
import type { TarsState } from "../src/game/tars";

// PLAN-TARS T6: OpenRouter for TARS — the key (kept, checked, hinted), PKCE (the S256 challenge), the code's
// exchange, the chat and Jev calls (their bodies, their cost counted), TARS's prompt and his remarks' rationing.
// The network simulated.

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
beforeEach(() => mem.clear());

/** A fetch answering by URL, the requests kept. */
function net(routes: Record<string, (body: unknown) => unknown>) {
  const sent: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const k = Object.keys(routes).find((r) => url.endsWith(r));
    if (!k) return new Response("no", { status: 404 });
    return Response.json(routes[k]!(body));
  };
  return { f, sent };
}

const S: TarsState = {
  body: "Earth",
  altKm: 412,
  status: "In orbit",
  landed: false,
  docked: false,
  speed: 7668,
  fuel: 0.6,
  dv: 2100,
  target: null,
  next: null,
  stage: "orbit",
  auto: "none",
  dtau: null,
};

test("the key: an OpenRouter one only, kept, hinted by its end, cleared", () => {
  expect(openRouterKey.get()).toBeNull();
  expect(openRouterKey.set("hello")).toBe(false);
  expect(openRouterKey.set("  sk-or-v1-0123456789abcdef  ")).toBe(true);
  expect(openRouterKey.get()).toBe("sk-or-v1-0123456789abcdef");
  expect(openRouterKey.hint()).toBe("…cdef");
  openRouterKey.clear();
  expect(openRouterKey.get()).toBeNull();
});

test("PKCE: the challenge is the verifier's SHA-256, base64url; the authorization URL calls back to this site", async () => {
  const { verifier, challenge } = await pkce();
  expect(verifier).toMatch(/^[\w-]{43}$/);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  expect(challenge).toBe(Buffer.from(h).toString("base64url"));
  const u = new URL(authUrl(challenge, "https://samlepirate.org/test/?x=1#scene"));
  expect(u.origin + u.pathname).toBe("https://openrouter.ai/auth");
  expect(u.searchParams.get("callback_url")).toBe("https://samlepirate.org/test/openrouter.html");
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");
});

test("the code exchanged: the verifier sent, the key kept; refused: none", async () => {
  const ok = net({ "/api/v1/auth/keys": () => ({ key: "sk-or-v1-abcdefghijklmnop" }) });
  expect(await exchangeCode("CODE", "VER", ok.f)).toBe("sk-or-v1-abcdefghijklmnop");
  expect(ok.sent[0]!.body).toEqual({ code: "CODE", code_verifier: "VER", code_challenge_method: "S256" });
  expect(openRouterKey.get()).toBe("sk-or-v1-abcdefghijklmnop");
  openRouterKey.clear();
  expect(await exchangeCode("CODE", "VER", net({}).f)).toBeNull();
  expect(openRouterKey.get()).toBeNull();
});

test("the calls: GLM's chat and Jev's decisions — their models, the key in the header, their cost counted; no key: none", async () => {
  const n = net({
    "/api/v1/chat/completions": () => ({ choices: [{ message: { content: "  We're fine.  " } }], usage: { cost: 0.00002 } }),
    "/api/alpha/decisions": () => ({ answers: { speak: { type: "noul", noul: 0.8 } }, usage: { cost: 0.00001 } }),
  });
  const or = new OpenRouter(() => "sk-or-v1-key", n.f);
  expect(await or.chat([{ role: "user", content: "hi" }])).toBe("We're fine.");
  expect(await or.decide({ a: 1 }, { speak: REMARK_QUESTIONS.speak! })).toEqual({ speak: { type: "noul", noul: 0.8 } });
  expect((n.sent[0]!.body as { model: string }).model).toBe(TEXT_MODEL);
  expect((n.sent[1]!.body as { model: string }).model).toBe(DECISION_MODEL);
  expect(n.sent[0]!.headers.Authorization).toBe("Bearer sk-or-v1-key");
  expect(or.spent).toBeCloseTo(0.00003, 10);
  expect(or.calls).toBe(2);
  const none = new OpenRouter(() => null, n.f);
  expect(await none.chat([])).toBeNull();
  expect(n.sent.length).toBe(2);
});

test("Jev's pinned version refused (retired): its alias asked, kept for the session", async () => {
  const models: string[] = [];
  const f = async (_u: string, init?: RequestInit) => {
    const m = JSON.parse(String(init!.body)).model as string;
    models.push(m);
    return m.startsWith("~")
      ? Response.json({ answers: { speak: { type: "noul", noul: 0.5 } } })
      : new Response("model not found", { status: 400 });
  };
  const or = new OpenRouter(() => "sk-or-v1-key", f);
  expect(await or.decide({}, { speak: REMARK_QUESTIONS.speak! })).toEqual({ speak: { type: "noul", noul: 0.5 } });
  await or.decide({}, { speak: REMARK_QUESTIONS.speak! });
  expect(models).toEqual(["typesafe/jev-1.13", "~typesafe/jev-latest", "~typesafe/jev-latest"]);
});

test("TARS online: his prompt (the language, the settings, no invented figure); his remarks — Jev says no: silent; yes: written; rationed", async () => {
  const sp = systemPrompt({ honesty: 30, humour: 0 }, "fr");
  expect(sp).toContain("Answer in French");
  expect(sp).toContain("never invent a figure");
  expect(sp).toContain("no jokes at all");
  expect(sp).toContain("never about a danger");
  let speak = 0.2;
  const n = net({
    "/api/alpha/decisions": () => ({
      answers: {
        speak: { type: "noul", noul: speak },
        topic: { type: "choice", choice: "joke", confidence: 0.6, probabilities: {} },
        tone: { type: "choice", choice: "dry", confidence: 0.7, probabilities: {} },
      },
    }),
    "/api/v1/chat/completions": () => ({ choices: [{ message: { content: '"**Wheels up.** Again."' } }] }),
  });
  const tars = new TarsOnline(new OpenRouter(() => "sk-or-v1-key", n.f));
  expect(await tars.remark("liftoff", S, { honesty: 90, humour: 75 }, "en", 0)).toBeNull();
  speak = 0.9;
  // (within 45 s of the last decision: not even asked)
  expect(await tars.remark("liftoff", S, { honesty: 90, humour: 75 }, "en", 30_000)).toBeNull();
  expect(n.sent.length).toBe(1);
  expect(await tars.remark("liftoff", S, { honesty: 90, humour: 75 }, "en", 50_000)).toBe("Wheels up. Again.");
  // (humour 0: the joke asked becomes the event)
  expect((n.sent.at(-1)!.body as { messages: { content: string }[] }).messages[1]!.content).toContain("topic: joke");
  expect(await tars.remark("liftoff", S, { honesty: 90, humour: 0 }, "en", 200_000)).not.toBeNull();
  expect((n.sent.at(-1)!.body as { messages: { content: string }[] }).messages[1]!.content).toContain("topic: event");
  // (two minutes since the last remark not yet passed)
  expect(await tars.remark("liftoff", S, { honesty: 90, humour: 75 }, "en", 260_000)).toBeNull();
  expect(clean("[beeps] TARS: *fine*")).toBe("TARS: fine");
});
