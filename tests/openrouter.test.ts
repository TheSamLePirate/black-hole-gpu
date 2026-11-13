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

test("a refusal is told by its cause — the key, the credit, the rate, the network — not a silent null (audit TA-05)", async () => {
  const at = (status: number) => async () => new Response("{}", { status });
  const cases: [() => Promise<Response>, string][] = [
    [at(401), "key"],
    [at(402), "credit"],
    [at(429), "rate"],
    [at(503), "server"],
    [
      async () => {
        throw new TypeError("Failed to fetch");
      },
      "network",
    ],
  ];
  for (const [f, why] of cases) {
    const or = new OpenRouter(() => "sk-test", f as never);
    expect(await or.complete([{ role: "user", content: "hi" }], [])).toBeNull();
    expect([why, or.lastFailure?.why]).toEqual([why, why]);
  }
});

test("an answer cut by the token limit (TA-12): asked again once with room, a tool call's arguments whole", async () => {
  const asked: number[] = [];
  const f = async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { max_tokens: number };
    asked.push(b.max_tokens);
    const cut = asked.length === 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: cut ? "length" : "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "mission", arguments: cut ? '{"action":"create","spec":{"na' : '{"action":"create"}' },
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const or = new OpenRouter(() => "sk-test", f as never);
  const r = await or.complete([{ role: "user", content: "make a mission" }], [{ type: "function" }]);
  console.log(`  asked with max_tokens ${asked.join(" then ")}; arguments ${r?.tool_calls?.[0]?.function.arguments}`);
  expect(asked.length).toBe(2);
  expect(asked[1]!).toBeGreaterThan(asked[0]!);
  expect(() => JSON.parse(r!.tool_calls![0]!.function.arguments)).not.toThrow();
});

test("TARS's model retired by OpenRouter (TA-20): the default asked instead, for the session, and said — not a silent failure", async () => {
  const asked: string[] = [];
  const f = async (_url: string, init: { body: string }) => {
    const model = (JSON.parse(init.body) as { model: string }).model;
    asked.push(model);
    if (model === "old/retired-model")
      return new Response(JSON.stringify({ error: { message: "old/retired-model is not a valid model ID", code: 400 } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Orbite stable." } }] }), { status: 200 });
  };
  const or = new OpenRouter(
    () => "sk-or-v1-key",
    f as never,
    () => "old/retired-model",
  );
  const said: string[] = [];
  or.onModelGone = (gone, used) => said.push(`${gone} → ${used}`);
  const r = await or.complete([{ role: "user", content: "état ?" }], []);
  expect(r?.content).toBe("Orbite stable.");
  expect(or.lastFailure).toBeNull();
  expect(said).toEqual([`old/retired-model → ${TEXT_MODEL}`]);
  // (asked once under its retired name, not twice: its refusal not read as one of the brief reasoning)
  expect(asked).toEqual(["old/retired-model", TEXT_MODEL]);
  // the session asks the default at once, the change said once
  await or.chat([{ role: "user", content: "et maintenant ?" }]);
  expect(asked.slice(-1)).toEqual([TEXT_MODEL]);
  expect(said.length).toBe(1);
  // a refusal of the brief reasoning (« this model … ») is no retirement: the model kept
  let n = 0;
  const reasoning = new OpenRouter(
    () => "sk-or-v1-key",
    (async (_u: string, init: { body: string }) =>
      n++ === 0 && (JSON.parse(init.body) as { reasoning?: unknown }).reasoning
        ? new Response(JSON.stringify({ error: { message: "Reasoning is not supported by this model: some/model" } }), { status: 400 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })) as never,
    () => "some/model",
  );
  const gone2: string[] = [];
  reasoning.onModelGone = (g) => gone2.push(g);
  expect((await reasoning.complete([], []))?.content).toBe("ok");
  expect(gone2).toEqual([]);
  expect(reasoning.model()).toBe("some/model");
  // a key refused stays a key refused (no model swap)
  const k = new OpenRouter(
    () => "sk-or-v1-key",
    (async () => new Response("{}", { status: 401 })) as never,
    () => "old/retired-model",
  );
  expect(await k.complete([], [])).toBeNull();
  expect(k.lastFailure?.why).toBe("key");
});

test("TARS's steps sent in one session (TA-04): its id the same on every call — the provider's cache kept warm —, the cached tokens counted; Claude marked for caching", async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
        usage: { cost: 0.0005, prompt_tokens: 22777, prompt_tokens_details: { cached_tokens: 22720 } },
      }),
      { status: 200 },
    );
  };
  let model = TEXT_MODEL as string;
  const or = new OpenRouter(
    () => "sk-or-v1-key",
    f as never,
    () => model,
  );
  await or.complete([{ role: "user", content: "a" }], []);
  await or.complete([{ role: "user", content: "b" }], []);
  await or.chat([{ role: "user", content: "c" }]);
  const ids = bodies.map((b) => b.session_id);
  expect(typeof ids[0]).toBe("string");
  expect((ids[0] as string).length).toBeGreaterThan(8);
  expect(new Set(ids).size).toBe(1);
  expect(or.promptTokens).toBe(3 * 22777);
  expect(or.cachedTokens).toBe(3 * 22720);
  // (no cache marker for a model that caches by itself)
  expect(bodies[0]!.cache_control).toBeUndefined();
  model = "anthropic/claude-haiku-5.5";
  await or.complete([{ role: "user", content: "d" }], []);
  expect(bodies.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
  // another game (another OpenRouter): another session
  const or2 = new OpenRouter(() => "sk-or-v1-key", f as never);
  await or2.complete([], []);
  expect(bodies.at(-1)!.session_id).not.toBe(ids[0]);
});
