// Level 3 Native Browser-Speed Host Commands for Unkernel (`createKernel({ commands })`).
// Each registered command is linked automatically into `/run/kw/bin/<name>` (first on PATH)
// and executed directly on the browser's native V8/JS engine over AF_VSOCK:1020 with < 5 ms startup:
//   - `bh-host`  : Instant universal `__bh` & TARS CLI (zero Node.js startup, works even before Node is installed)
//   - `tars`     : Instant native TARS flight & simulator agent CLI (streams live replies & invokes all 73 tools)
//   - `ai`       : Instant native streaming LLM CLI (OpenRouter / Anthropic / OpenAI via native browser fetch(),
//                  bypassing aarch64 Node/Bun startup, guest OpenSSL TLS, and Wisp!)
//   - `hfetch`   : Native browser-host HTTPS fetcher (bypasses Wisp & guest TLS for CORS endpoints) — public HTTPS
//                  only, no cookies, never the page's own origin nor a private host (`hfetchRefusal`)
//   - `obc-bench`: Live SMP / SharedArrayBuffer / JIT / V8 cache / HostCommand performance diagnostic

import type { HostCommand, HostCommandContext } from "unkernel/web";
import { openRouterKey, TEXT_MODEL } from "../ai/openrouter";
import { parseOrders } from "../ai/offline-orders";
import { runOrders } from "../ai/tars-agent";
import type { Tool } from "../ai/agent";
import { handleBhRpc } from "./bh-rpc";
import type { ObcHostAdapter } from "./bridge";
import { isBlockedHost } from "../util/ip-guard";
import type { ObcKernelTelemetry, ObcStatus, ObcWarmupState } from "./types";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ObcHostCommandDeps {
  adapter: ObcHostAdapter;
  getStatus: () => ObcStatus;
  getKernelStats: () => ObcKernelTelemetry;
  getWarmupState: () => ObcWarmupState;
  getHostCommandNames: () => string[];
  fetchFn?: FetchLike;
}

export interface ResolvedAiProvider {
  kind: "openrouter" | "anthropic" | "openai";
  apiKey: string;
  model: string;
  endpoint: string;
}

/** The page's origin (the browser), or null (tests, workers without one). */
function pageOrigin(): string | null {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin && loc.origin !== "null" ? loc.origin : null;
}

/**
 * Why `hfetch` refuses a URL, or null: the guest's code runs it with the page's network position, so only public HTTPS,
 * never the page's own origin (its dev endpoints — `/__snapshot`, `/__deepgram`… — and its storage), never a private,
 * loopback, link-local or local-name host (src/util/ip-guard.ts), never credentials in the URL.
 */
export function hfetchRefusal(raw: string, origin: string | null): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "not a URL";
  }
  if (u.protocol !== "https:") return "https only";
  if (u.username || u.password) return "no credentials in the URL";
  if (origin) {
    try {
      const o = new URL(origin);
      if (u.origin === o.origin || u.hostname === o.hostname) return "the page's own origin";
    } catch {
      // (an unparsable origin: nothing to compare)
    }
  }
  if (isBlockedHost(u.hostname)) return "private, loopback or local host";
  return null;
}

/** Parse a CLI value token into JSON primitive/object/array (exact parity with bh-cli.mjs). */
export function parseCliVal(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]")) || (s.startsWith('"') && s.endsWith('"'))) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

/** Resolve the best available LLM API provider from guest env vars or the simulator's OpenRouter key. */
export function resolveAiProvider(
  env: Readonly<Record<string, string>>,
  modelOverride?: string,
  simOpenRouterKey?: string | null,
): ResolvedAiProvider | null {
  const orKey = env.OPENROUTER_API_KEY?.trim() || simOpenRouterKey?.trim() || "";
  const anthKey = env.ANTHROPIC_API_KEY?.trim() || "";
  const oaiKey = env.OPENAI_API_KEY?.trim() || "";

  // If the user explicitly asked for a Claude model and set ANTHROPIC_API_KEY (without slash), prefer Anthropic directly.
  if (anthKey && modelOverride && /^claude-/i.test(modelOverride) && !modelOverride.includes("/")) {
    return {
      kind: "anthropic",
      apiKey: anthKey,
      model: modelOverride,
      endpoint: "https://api.anthropic.com/v1/messages",
    };
  }
  if (orKey) {
    return {
      kind: "openrouter",
      apiKey: orKey,
      model: modelOverride || env.AI_MODEL || TEXT_MODEL,
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
    };
  }
  if (anthKey) {
    return {
      kind: "anthropic",
      apiKey: anthKey,
      model: modelOverride || env.AI_MODEL || "claude-sonnet-4-20250514",
      endpoint: "https://api.anthropic.com/v1/messages",
    };
  }
  if (oaiKey) {
    return {
      kind: "openai",
      apiKey: oaiKey,
      model: modelOverride || env.AI_MODEL || "gpt-4.1-mini",
      endpoint: "https://api.openai.com/v1/chat/completions",
    };
  }
  return null;
}

async function writeOut(stream: WritableStream<Uint8Array | string>, data: string | Uint8Array): Promise<void> {
  const writer = stream.getWriter();
  try {
    await writer.write(data);
  } catch {
    // guest closed pipe or exited
  } finally {
    try {
      writer.releaseLock();
    } catch {}
  }
}

async function readStdinText(ctx: HostCommandContext, maxBytes = 256 * 1024): Promise<string> {
  if (ctx.isTTY.stdin) return "";
  const reader = ctx.stdin.getReader();
  const dec = new TextDecoder();
  let out = "";
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        out += dec.decode(value, { stream: true });
      }
    }
    out += dec.decode();
  } catch {
    // aborted or closed
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  return out;
}

function getLiveBh(): Record<string, unknown> | null {
  const g = globalThis as unknown as { __bh?: Record<string, unknown> };
  return g.__bh ?? null;
}

/** Stream an OpenAI-compatible (OpenRouter / OpenAI) or Anthropic SSE/JSON completion straight to stdout. */
async function streamLlmReply(
  provider: ResolvedAiProvider,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  opts: { stream: boolean; signal: AbortSignal; fetchFn: FetchLike; onToken: (delta: string) => Promise<void> },
): Promise<string> {
  if (provider.kind === "anthropic") {
    const sys = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const nonSys = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await opts.fetchFn(provider.endpoint, {
      method: "POST",
      signal: opts.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 2048,
        ...(sys ? { system: sys } : {}),
        messages: nonSys,
        stream: opts.stream,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 240)}`);
    }
    if (!opts.stream || !res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const j = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      const text = (j.content ?? []).map((c) => c.text ?? "").join("");
      if (text) await opts.onToken(text);
      return text;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (raw && raw !== "[DONE]") {
              try {
                const ev = JSON.parse(raw) as { type?: string; delta?: { type?: string; text?: string } };
                if (ev.type === "content_block_delta" && ev.delta?.text) {
                  full += ev.delta.text;
                  await opts.onToken(ev.delta.text);
                }
              } catch {}
            }
          }
          nl = buf.indexOf("\n");
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
    return full;
  }

  // OpenRouter or OpenAI Chat Completions API
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.kind === "openrouter") {
    headers["HTTP-Referer"] = typeof location !== "undefined" ? location.origin : "https://samlepirate.org";
    headers["X-Title"] = "Kerr OBC Terminal";
  }
  const res = await opts.fetchFn(provider.endpoint, {
    method: "POST",
    signal: opts.signal,
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: opts.stream,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`${provider.kind} HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }
  if (!opts.stream || !res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content ?? "";
    if (text) await opts.onToken(text);
    return text;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) {
          const raw = line.slice(5).trim();
          if (raw && raw !== "[DONE]") {
            try {
              const ev = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
              const delta = ev.choices?.[0]?.delta?.content;
              if (delta) {
                full += delta;
                await opts.onToken(delta);
              }
            } catch {}
          }
        }
        nl = buf.indexOf("\n");
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  return full;
}

/** Build the complete Level 3 native HostCommand map registered into Unkernel (`createKernel({ commands })`). */
export function createObcHostCommands(deps: ObcHostCommandDeps): Record<string, HostCommand> {
  const fetchFn = deps.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  // ── 1. bh-host: Native V8-speed universal __bh & TARS CLI (< 3 ms, zero Node.js) ──
  const bhHost: HostCommand = async (ctx) => {
    const rawFlag = ctx.args.includes("--raw");
    const jsonFlag = ctx.args.includes("--json");
    const stdinFlag = ctx.args.includes("--stdin");
    const cleanArgs = ctx.args.filter((a) => a !== "--raw" && a !== "--json" && a !== "--stdin");
    const cmd = cleanArgs[0] ?? "help";

    const printRpc = async (res: { ok: boolean; result?: unknown; error?: string }, rawMode = false): Promise<number> => {
      if (!res.ok) {
        await writeOut(ctx.stderr, `\x1b[1;31mERROR:\x1b[0m ${res.error ?? "unknown error"}\n`);
        return 1;
      }
      if (rawMode && typeof res.result === "string") {
        await writeOut(ctx.stdout, `${res.result}\n`);
      } else {
        await writeOut(ctx.stdout, `${JSON.stringify(res.result, null, 2)}\n`);
      }
      return 0;
    };

    switch (cmd) {
      case "help":
      case "-h":
      case "--help": {
        await writeOut(
          ctx.stdout,
          `\x1b[1;36m╔══════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[1;36m║\x1b[1;37m   bh — NATIVE HOST-SPEED __bh API & TARS CLI (~3 ms!)      \x1b[1;36m║\x1b[0m
\x1b[1;36m╚══════════════════════════════════════════════════════════════╝\x1b[0m
  bh ls [path]                   List members of __bh (or nested path)
  bh get <path> [--depth N]      Read any value as JSON (pipeable)
  bh set <path> <val|--stdin>    Set any property (auto-refreshes settings.*)
  bh call <path> [args...]       Call any __bh method (sync or async)
  bh tools [filter]              List all 73 TARS tools
  bh tool <name> [k=v...|--stdin] Run any TARS tool (key=val, JSON, or --stdin)
  bh search <query>              Search __bh paths & TARS tools
  bh catalog                     Full indexed catalog of __bh & TARS features
  bh eval "<expr>"               Evaluate CSP-safe __bh chain/assignment
  bh watch <path> [ms] [count]   Stream live NDJSON updates of a path
  bh telemetry | status          Instant live telemetry or OBC status JSON
  bh tui                         Open full interactive __bh Explorer TUI\n`,
        );
        return 0;
      }

      case "telemetry": {
        await writeOut(ctx.stdout, `${JSON.stringify(deps.adapter.sampleTelemetry(), null, 2)}\n`);
        return 0;
      }

      case "status": {
        await writeOut(ctx.stdout, `${JSON.stringify(deps.getStatus(), null, 2)}\n`);
        return 0;
      }

      case "ls": {
        const path = cleanArgs[1] ?? "";
        const res = await handleBhRpc({ op: "ls", path });
        if (!res.ok) return printRpc(res);
        if (jsonFlag || !ctx.isTTY.stdout) {
          await writeOut(ctx.stdout, `${JSON.stringify(res.result, null, 2)}\n`);
          return 0;
        }
        const entries = (res.result ?? []) as Array<{ name: string; kind: string; preview: string }>;
        const kindColor: Record<string, string> = { fn: "36", obj: "33", arr: "35", num: "32", bool: "32", str: "37", null: "90" };
        let out = `\x1b[1;36m__bh${path ? `.${path}` : ""}\x1b[0m (${entries.length} members)\n`;
        for (const e of entries) {
          const c = kindColor[e.kind] ?? "37";
          out += `  \x1b[${c}m${e.kind.padEnd(4)}\x1b[0m ${e.name.padEnd(28)} \x1b[2m${e.preview}\x1b[0m\n`;
        }
        await writeOut(ctx.stdout, out);
        return 0;
      }

      case "get": {
        const path = cleanArgs[1] ?? "";
        const di = cleanArgs.indexOf("--depth");
        const depth = di >= 0 && cleanArgs[di + 1] ? Number(cleanArgs[di + 1]) : 3;
        return printRpc(await handleBhRpc({ op: "get", path, depth }), rawFlag);
      }

      case "set": {
        const path = cleanArgs[1];
        if (!path) {
          await writeOut(ctx.stderr, "Usage: bh set <path> <value>\n");
          return 1;
        }
        const rawVal = cleanArgs.length >= 3 ? cleanArgs.slice(2).join(" ") : (await readStdinText(ctx)).trim();
        if (!rawVal) {
          await writeOut(ctx.stderr, "Usage: bh set <path> <value> (or pipe with --stdin)\n");
          return 1;
        }
        return printRpc(await handleBhRpc({ op: "set", path, value: parseCliVal(rawVal) }), rawFlag);
      }

      case "call": {
        const path = cleanArgs[1];
        if (!path) {
          await writeOut(ctx.stderr, "Usage: bh call <path> [args...]\n");
          return 1;
        }
        let callArgs = cleanArgs.slice(2).map(parseCliVal);
        if (callArgs.length === 0 && stdinFlag) {
          const stdinText = (await readStdinText(ctx)).trim();
          if (stdinText) {
            const parsed = parseCliVal(stdinText);
            callArgs = Array.isArray(parsed) ? parsed : [parsed];
          }
        }
        return printRpc(await handleBhRpc({ op: "call", path, args: callArgs }), rawFlag);
      }

      case "tools": {
        const filter = (cleanArgs[1] ?? "").toLowerCase();
        const res = await handleBhRpc({ op: "tools" });
        if (!res.ok) return printRpc(res);
        const list = ((res.result ?? []) as Array<{ name: string; description: string; params: string[] }>).filter(
          (t) => !filter || t.name.toLowerCase().includes(filter) || t.description.toLowerCase().includes(filter),
        );
        if (jsonFlag || !ctx.isTTY.stdout) {
          await writeOut(ctx.stdout, `${JSON.stringify(list, null, 2)}\n`);
          return 0;
        }
        let out = `\x1b[1;36mTARS TOOLS\x1b[0m (${list.length})\n`;
        for (const t of list) {
          out += `  \x1b[1;32m${t.name.padEnd(20)}\x1b[0m [${t.params.slice(0, 6).join(", ")}]\n`;
        }
        await writeOut(ctx.stdout, out);
        return 0;
      }

      case "tool": {
        const name = cleanArgs[1];
        if (!name) {
          await writeOut(ctx.stderr, "Usage: bh tool <name> [key=val ... | JSON | --stdin]\n");
          return 1;
        }
        const toolArgs: Record<string, unknown> = {};
        if (stdinFlag) {
          const stdinText = (await readStdinText(ctx)).trim();
          if (stdinText.startsWith("{")) {
            try {
              Object.assign(toolArgs, JSON.parse(stdinText));
            } catch (e) {
              await writeOut(ctx.stderr, `Invalid JSON on stdin: ${e instanceof Error ? e.message : String(e)}\n`);
              return 1;
            }
          }
        }
        for (const tok of cleanArgs.slice(2)) {
          if (tok.startsWith("{") && tok.endsWith("}")) {
            try {
              Object.assign(toolArgs, JSON.parse(tok));
            } catch (e) {
              await writeOut(ctx.stderr, `Invalid JSON arg: ${e instanceof Error ? e.message : String(e)}\n`);
              return 1;
            }
          } else {
            const eq = tok.indexOf("=");
            if (eq > 0) toolArgs[tok.slice(0, eq)] = parseCliVal(tok.slice(eq + 1));
          }
        }
        return printRpc(await handleBhRpc({ op: "tool", name, toolArgs }), rawFlag);
      }

      case "search": {
        const q = cleanArgs.slice(1).join(" ");
        const res = await handleBhRpc({ op: "search", query: q });
        if (!res.ok) return printRpc(res);
        if (jsonFlag || !ctx.isTTY.stdout) {
          await writeOut(ctx.stdout, `${JSON.stringify(res.result, null, 2)}\n`);
          return 0;
        }
        const { paths = [], tools = [] } = (res.result ?? {}) as {
          paths?: Array<{ kind: string; path: string; preview: string }>;
          tools?: Array<{ name: string; description: string }>;
        };
        let out = `\x1b[1;36m__bh paths matching "${q}" (${paths.length}):\x1b[0m\n`;
        for (const p of paths.slice(0, 30)) out += `  ${p.kind.padEnd(4)} __bh.${p.path.padEnd(32)} \x1b[2m${p.preview}\x1b[0m\n`;
        out += `\x1b[1;32mTARS tools matching "${q}" (${tools.length}):\x1b[0m\n`;
        for (const t of tools) out += `  ${t.name.padEnd(20)} \x1b[2m${t.description}\x1b[0m\n`;
        await writeOut(ctx.stdout, out);
        return 0;
      }

      case "catalog": {
        return printRpc(await handleBhRpc({ op: "catalog" }), rawFlag);
      }

      case "eval": {
        const expr = cleanArgs.slice(1).join(" ") || (await readStdinText(ctx)).trim();
        if (!expr) {
          await writeOut(ctx.stderr, 'Usage: bh eval "<expression with bh>"\n');
          return 1;
        }
        return printRpc(await handleBhRpc({ op: "eval", expr }), rawFlag);
      }

      case "watch": {
        const path = cleanArgs[1] ?? "";
        const ms = Math.max(50, Number(cleanArgs[2] ?? 500) || 500);
        const maxCount = Math.max(0, Number(cleanArgs[3] ?? 0) || 0);
        let n = 0;
        while (!ctx.signal.aborted) {
          const r = await handleBhRpc({ op: "get", path, depth: 2 });
          if (r.ok) await writeOut(ctx.stdout, `${JSON.stringify(r.result)}\n`);
          n++;
          if (maxCount > 0 && n >= maxCount) break;
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, ms);
            const onAbort = () => {
              clearTimeout(t);
              resolve();
            };
            ctx.signal.addEventListener("abort", onAbort, { once: true });
          });
        }
        return 0;
      }

      default:
        await writeOut(ctx.stderr, `Unknown subcommand "${cmd}". Run: bh help\n`);
        return 1;
    }
  };

  // ── 2. tars: Instant native TARS CLI (0 ms VM startup, live TARS agent + 73 tools) ──
  const tarsCmd: HostCommand = async (ctx) => {
    const t0 = performance.now();
    const args = [...ctx.args];
    const first = args[0] ?? "";

    if (first === "-h" || first === "--help" || (args.length === 0 && ctx.isTTY.stdin)) {
      await writeOut(
        ctx.stdout,
        `\x1b[1;36mTARS — Instant Native Host CLI (< 5 ms startup, all 73 tools)\x1b[0m
  tars <question or flight order>   Ask live TARS (online LLM + offline orders)
  tars --status                     Show TARS online state, model & tools count
  tars --tools [filter]             List all 73 TARS tools
  tars --tool <name> [k=v...]       Invoke any TARS tool directly
  echo "land on KSFO" | tars        Pipe a prompt or order from stdin\n`,
      );
      return 0;
    }

    const bh = getLiveBh();
    const tarsObj = bh?.tars as
      | {
          agent?: { ask: (q: string, o?: { sentence?: (s: string) => void }) => Promise<string | null>; failure?: string | null };
          tools?: () => Tool[];
          spent?: () => number;
        }
      | undefined;

    if (first === "--status") {
      const toolsCount = tarsObj?.tools?.().length ?? 0;
      const keyHint = openRouterKey.hint();
      const spent = typeof tarsObj?.spent === "function" ? tarsObj.spent() : 0;
      const ms = (performance.now() - t0).toFixed(1);
      await writeOut(
        ctx.stdout,
        `\x1b[1;36mTARS Native Host Bridge\x1b[0m (${ms} ms)\n` +
          `  OpenRouter Key : ${keyHint ? `\x1b[32mconfigured (${keyHint})\x1b[0m` : "\x1b[33moffline (offline flight orders active)\x1b[0m"}\n` +
          `  Live Agent     : ${tarsObj?.agent ? "\x1b[32mattached\x1b[0m" : "\x1b[33mheadless/RPC-only\x1b[0m"}\n` +
          `  Tools          : ${toolsCount}\n` +
          `  Session Spent  : $${spent.toFixed(4)}\n`,
      );
      return 0;
    }

    if (first === "--tools") {
      return bhHost({ ...ctx, args: ["tools", ...args.slice(1)] });
    }
    if (first === "--tool") {
      return bhHost({ ...ctx, args: ["tool", ...args.slice(1)] });
    }

    const stdinPrompt = !ctx.isTTY.stdin ? (await readStdinText(ctx)).trim() : "";
    const prompt = [args.join(" "), stdinPrompt].filter(Boolean).join("\n").trim();
    if (!prompt) {
      await writeOut(ctx.stderr, "Usage: tars <question or flight order>\n");
      return 1;
    }

    // 1. Prefer live simulator TARS agent when attached & OpenRouter is configured
    if (tarsObj?.agent && openRouterKey.get()) {
      let streamed = false;
      const reply = await tarsObj.agent.ask(prompt, {
        sentence: (s) => {
          streamed = true;
          void writeOut(ctx.stdout, `${s} `);
        },
      });
      if (reply) {
        if (!streamed) await writeOut(ctx.stdout, `${reply}\n`);
        else await writeOut(ctx.stdout, "\n");
        return 0;
      }
    }

    // 2. Offline direct order execution via TARS's own offline parser + 73 tools
    const tools = tarsObj?.tools?.() ?? [];
    const orders = parseOrders(prompt);
    if (orders.length > 0 && tools.length > 0) {
      const results = new Map<string, string>();
      const done = await runOrders(orders, tools, (result, _ok, _full, tool) => {
        results.set(tool, result);
      });
      for (const d of done) {
        const badge = d.ok ? "\x1b[1;32mOK\x1b[0m" : "\x1b[1;31mERR\x1b[0m";
        await writeOut(ctx.stdout, `[${badge}] ${d.tool}: ${d.ok ? (results.get(d.tool) ?? "done") : (d.error ?? "failed")}\n`);
      }
      return done.every((d) => d.ok) ? 0 : 1;
    }

    await writeOut(
      ctx.stderr,
      "TARS is offline (no OpenRouter key configured) and prompt did not match an offline flight order.\n" +
        "Set OPENROUTER_API_KEY / ANTHROPIC_API_KEY or sign in via Settings › TARS, or run `tars --tools`.\n",
    );
    return 1;
  };

  // ── 3. ai: Instant native browser-host streaming LLM CLI (< 5 ms startup!) ──
  const aiCmd: HostCommand = async (ctx) => {
    let modelOverride: string | undefined;
    let systemPrompt =
      "You are a concise, expert Linux, aerospace, and software engineering assistant running inside the Kerr Black Hole GPU On-Board Computer (OBC). Answer crisply in plain terminal markdown.";
    let includeSim = false;
    let stream = true;
    const promptParts: string[] = [];

    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]!;
      if (a === "-h" || a === "--help") {
        await writeOut(
          ctx.stdout,
          `\x1b[1;36mai — Instant Native Browser-Host LLM CLI (< 5 ms startup, zero Node/Bun!)\x1b[0m
  ai "<prompt>"                 Stream an answer via native browser fetch()
  cat file | ai "explain this"  Pipe any file, diff, or log into the prompt
  ai -m <model> "<prompt>"      Override model (OpenRouter / Anthropic / OpenAI)
  ai -s "<system>" "<prompt>"   Custom system prompt
  ai --sim "<prompt>"           Include live spacecraft/aircraft WGS84 telemetry
  ai --no-stream "<prompt>"     Wait for full response before printing
  ai                            Interactive zero-latency REPL (when in TTY)

Credentials auto-detected (in order):
  1. OPENROUTER_API_KEY env or Simulator Settings › TARS OpenRouter key
  2. ANTHROPIC_API_KEY env (direct browser access)
  3. OPENAI_API_KEY env\n`,
        );
        return 0;
      } else if ((a === "-m" || a === "--model") && ctx.args[i + 1]) {
        modelOverride = ctx.args[++i];
      } else if ((a === "-s" || a === "--system") && ctx.args[i + 1]) {
        systemPrompt = ctx.args[++i]!;
      } else if (a === "--sim") {
        includeSim = true;
      } else if (a === "--no-stream") {
        stream = false;
      } else {
        promptParts.push(a);
      }
    }

    const provider = resolveAiProvider(ctx.env, modelOverride, openRouterKey.get());
    if (!provider) {
      await writeOut(
        ctx.stderr,
        "\x1b[1;33mNo LLM API key found.\x1b[0m Sign in to OpenRouter in Settings › TARS, or export OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY.\n",
      );
      return 1;
    }

    const buildSystem = () => {
      if (!includeSim) return systemPrompt;
      const tel = deps.adapter.sampleTelemetry();
      return `${systemPrompt}\n\nLive OBC Telemetry: ${JSON.stringify({
        vessel: tel.vessel_id,
        body: tel.body,
        lat: Number(tel.position.lat_deg.toFixed(4)),
        lon: Number(tel.position.lon_deg.toFixed(4)),
        alt_m: Math.round(tel.position.altitude_msl_m),
        agl_m: Math.round(tel.position.height_over_ground_m),
        tas_mps: Math.round(tel.flight.true_airspeed_mps),
        mach: Number(tel.flight.mach.toFixed(2)),
        hdg_deg: Math.round(tel.attitude.heading_deg),
        dtau_dt: Number(tel.dtau_dt.toFixed(4)),
      })}`;
    };

    // Single-shot mode (args and/or piped stdin)
    const piped = !ctx.isTTY.stdin ? (await readStdinText(ctx)).trim() : "";
    const joined = promptParts.join(" ").trim();
    if (joined || piped) {
      const userContent = joined && piped ? `${joined}\n\n\`\`\`\n${piped}\n\`\`\`` : joined || piped;
      try {
        await streamLlmReply(
          provider,
          [
            { role: "system", content: buildSystem() },
            { role: "user", content: userContent },
          ],
          {
            stream,
            signal: ctx.signal,
            fetchFn,
            onToken: (delta) => writeOut(ctx.stdout, delta),
          },
        );
        await writeOut(ctx.stdout, "\n");
        return 0;
      } catch (e) {
        await writeOut(ctx.stderr, `\x1b[1;31mAI error:\x1b[0m ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      }
    }

    // Interactive TTY REPL (zero cold start!)
    await writeOut(
      ctx.stdout,
      `\x1b[1;36mKerr OBC Native AI REPL\x1b[0m · ${provider.kind} (${provider.model}) · \x1b[2m/sim /clear /quit\x1b[0m\n`,
    );
    const history: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    const reader = ctx.stdin.getReader();
    const dec = new TextDecoder();
    let lineBuf = "";
    try {
      await writeOut(ctx.stdout, "\x1b[1;32mai>\x1b[0m ");
      while (!ctx.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += dec.decode(value, { stream: true });
        let nl = lineBuf.indexOf("\n");
        while (nl >= 0) {
          const line = lineBuf.slice(0, nl).replace(/\r$/, "").trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (line === "/quit" || line === "/exit" || line === "exit") {
            return 0;
          } else if (line === "/clear") {
            history.length = 0;
            await writeOut(ctx.stdout, "\x1b[2m(history cleared)\x1b[0m\n");
          } else if (line === "/sim") {
            includeSim = !includeSim;
            await writeOut(ctx.stdout, `\x1b[2m(live telemetry injection: ${includeSim ? "ON" : "OFF"})\x1b[0m\n`);
          } else if (line) {
            history.push({ role: "user", content: line });
            try {
              const reply = await streamLlmReply(provider, [{ role: "system", content: buildSystem() }, ...history.slice(-16)], {
                stream,
                signal: ctx.signal,
                fetchFn,
                onToken: (delta) => writeOut(ctx.stdout, delta),
              });
              await writeOut(ctx.stdout, "\n");
              if (reply) history.push({ role: "assistant", content: reply });
            } catch (e) {
              history.pop();
              await writeOut(ctx.stderr, `\x1b[1;31mAI error:\x1b[0m ${e instanceof Error ? e.message : String(e)}\n`);
            }
          }
          await writeOut(ctx.stdout, "\x1b[1;32mai>\x1b[0m ");
          nl = lineBuf.indexOf("\n");
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
    return 0;
  };

  // ── 4. hfetch: Native browser-host HTTP/HTTPS fetcher (bypasses Wisp & guest TLS!) ──
  const hfetchCmd: HostCommand = async (ctx) => {
    let method = "GET";
    let showHeaders = false;
    let body: string | undefined;
    const headers: Record<string, string> = {};
    let url = "";

    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]!;
      if (a === "-h" || a === "--help") {
        await writeOut(
          ctx.stdout,
          `hfetch — Native browser-host HTTPS fetcher (bypasses Wisp & guest TLS; public HTTPS only, no cookies, never the page's own origin or a private host)\nUsage: hfetch [-i] [-X METHOD] [-H "Key: Value"] [-d DATA] https://<url>\n`,
        );
        return 0;
      } else if (a === "-i") {
        showHeaders = true;
      } else if (a === "-X" && ctx.args[i + 1]) {
        method = ctx.args[++i]!.toUpperCase();
      } else if (a === "-H" && ctx.args[i + 1]) {
        const kv = ctx.args[++i]!;
        const sep = kv.indexOf(":");
        if (sep > 0) headers[kv.slice(0, sep).trim()] = kv.slice(sep + 1).trim();
      } else if (a === "-d" && ctx.args[i + 1]) {
        body = ctx.args[++i]!;
        if (method === "GET") method = "POST";
      } else if (!a.startsWith("-")) {
        url = a;
      }
    }

    if (!url) {
      await writeOut(ctx.stderr, "Usage: hfetch [-i] [-X METHOD] [-H 'K: V'] [-d DATA] https://...\n");
      return 1;
    }
    const refusal = hfetchRefusal(url, pageOrigin());
    if (refusal) {
      await writeOut(ctx.stderr, `hfetch: refused — ${refusal}\n`);
      return 2;
    }

    try {
      // (never the page's cookies or HTTP auth; the final URL after redirects checked again before anything is shown)
      const res = await fetchFn(url, { method, headers, body, signal: ctx.signal, credentials: "omit", mode: "cors" });
      const finalRefusal = res.url ? hfetchRefusal(res.url, pageOrigin()) : null;
      if (finalRefusal) {
        await writeOut(ctx.stderr, `hfetch: refused after redirect to ${res.url} — ${finalRefusal}\n`);
        return 2;
      }
      if (showHeaders) {
        let hdr = `HTTP ${res.status} ${res.statusText}\n`;
        res.headers.forEach((v, k) => {
          hdr += `${k}: ${v}\n`;
        });
        hdr += "\n";
        await writeOut(ctx.stdout, hdr);
      }
      if (res.body) {
        const reader = res.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) await writeOut(ctx.stdout, value);
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {}
        }
      } else {
        await writeOut(ctx.stdout, new Uint8Array(await res.arrayBuffer()));
      }
      return res.ok ? 0 : 1;
    } catch (e) {
      await writeOut(ctx.stderr, `hfetch error: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  };

  // ── 5. obc-bench: Instant Performance & Speedup Telemetry Diagnostic ──
  const obcBenchCmd: HostCommand = async (ctx) => {
    const t0 = performance.now();
    const st = deps.getStatus();
    const ks = deps.getKernelStats();
    const warmup = deps.getWarmupState();
    const hostCmds = deps.getHostCommandNames();
    const elapsedMs = (performance.now() - t0).toFixed(2);

    const okBadge = (b: boolean, yes: string, no: string) => (b ? `\x1b[1;32m${yes}\x1b[0m` : `\x1b[1;33m${no}\x1b[0m`);
    const v8Cache = ctx.env.NODE_COMPILE_CACHE || "(unset)";
    const tmpCache = ctx.env.XDG_CACHE_HOME || "(unset)";
    const lines = [
      `\x1b[1;36m╔════════════════════════════════════════════════════════════════╗\x1b[0m`,
      `\x1b[1;36m║\x1b[1;37m    KERR OBC · UNKERNEL AAA PERFORMANCE DIAGNOSTIC (L1+L2+L3)   \x1b[1;36m║\x1b[0m`,
      `\x1b[1;36m╚════════════════════════════════════════════════════════════════╝\x1b[0m`,
      `  \x1b[1m[L2] Cross-Origin Isolation\x1b[0m : ${okBadge(ks.crossOriginIsolated, "ACTIVE (COOP + COEP: credentialless)", "OFF (reload once SW active)")}`,
      `  \x1b[1m[L2] SMP vCPUs\x1b[0m              : ${okBadge(ks.cpus > 1, `${ks.cpus} vCPUs SMP active`, `${ks.cpus} vCPU UP${ks.cpuBlocker ? ` (${ks.cpuBlocker})` : ""}`)}`,
      `  \x1b[1m[L2] Worker Transport\x1b[0m       : ${okBadge(ks.transport === "sab" || ks.transport === "shared", `SharedArrayBuffer (${ks.transport})`, ks.transport)}`,
      `  \x1b[1m[L1] Wasm JIT\x1b[0m               : ${ks.jit ? okBadge(ks.jit.enabled, `ON (${ks.jit.compiled} compiled · ${ks.jit.live} live blocks)`, "OFF") : "n/a"}`,
      `  \x1b[1m[L1] V8 Bytecode Cache\x1b[0m      : ${okBadge(Boolean(ctx.env.NODE_COMPILE_CACHE), v8Cache, "disabled")}`,
      `  \x1b[1m[L1] RAM tmpfs Caches\x1b[0m       : ${okBadge(tmpCache.startsWith("/tmp"), `TMPDIR=${ctx.env.TMPDIR || "/tmp"} · XDG=${tmpCache}`, tmpCache)}`,
      `  \x1b[1m[L1] Page-Cache Pre-Warm\x1b[0m    : ${okBadge(warmup === "ready", "WARM (0 IndexedDB reads for cached bins)", warmup.toUpperCase())}`,
      `  \x1b[1m[L3] Native Host Commands\x1b[0m   : \x1b[1;32m${hostCmds.join(", ")}\x1b[0m`,
      `  \x1b[1m[L3] HostCommand Latency\x1b[0m    : \x1b[1;36m${elapsedMs} ms\x1b[0m (native V8 · 0 aarch64 emulation)`,
      `  \x1b[1m     Guest / Boot\x1b[0m           : ${st.distro} · ${ks.memoryMiB} MiB · boot ${st.bootMs ?? 0} ms`,
      ``,
      `  \x1b[2mTips: Use \x1b[0m\x1b[1;36mai "question"\x1b[0m\x1b[2m or \x1b[0m\x1b[1;36mtars "order"\x1b[0m\x1b[2m for <5 ms native AI, or open a dedicated +Claude/+Pi tab to keep them warm!\x1b[0m`,
    ];
    await writeOut(ctx.stdout, `${lines.join("\n")}\n`);
    return 0;
  };

  return {
    "bh-host": bhHost,
    tars: tarsCmd,
    ai: aiCmd,
    hfetch: hfetchCmd,
    "obc-bench": obcBenchCmd,
  };
}
