import { describe, expect, test } from "bun:test";
import type { HostCommand, HostCommandContext } from "unkernel/web";
import { createObcHostCommands, type FetchLike, hfetchRefusal, parseCliVal, resolveAiProvider } from "../src/obc/host-commands";
import { emptyTelemetry } from "../src/obc/protocol";
import { DEFAULT_OBC_CONFIG, type ObcKernelTelemetry, type ObcStatus } from "../src/obc/types";

function makeCtx(
  name: string,
  args: string[],
  opts: { env?: Record<string, string>; stdinText?: string; isTTY?: boolean } = {},
): { ctx: HostCommandContext; getStdout: () => string; getStderr: () => string } {
  let stdoutText = "";
  let stderrText = "";
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const ctl = new AbortController();

  const mkWritable = (sink: (s: string) => void) =>
    new WritableStream<Uint8Array | string>({
      write(chunk) {
        sink(typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true }));
      },
    });

  const stdin = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.stdinText) controller.enqueue(enc.encode(opts.stdinText));
      controller.close();
    },
  });

  const isTTY = opts.isTTY ?? !opts.stdinText;
  const ctx: HostCommandContext = {
    name,
    args,
    env: opts.env ?? {},
    cwd: "/home/pilot",
    pid: 42,
    uid: 1000,
    gid: 1000,
    isTTY: { stdin: isTTY, stdout: isTTY, stderr: isTTY },
    cols: 100,
    rows: 26,
    stdin,
    stdout: mkWritable((s) => {
      stdoutText += s;
    }),
    stderr: mkWritable((s) => {
      stderrText += s;
    }),
    signal: ctl.signal,
  };

  return {
    ctx,
    getStdout: () => stdoutText,
    getStderr: () => stderrText,
  };
}

function makeDeps(fetchFn?: FetchLike) {
  const status: ObcStatus = {
    phase: "ready",
    bootMs: 1120,
    memoryMiB: 2048,
    distro: "alpine-3.24",
    arch: "aarch64",
    worker: true,
    transport: "sab",
    fbActive: false,
    fbWidth: 0,
    fbHeight: 0,
    fbFps: 0,
    hasSnapshot: false,
    wispUrl: "wss://code.samlepirate.org/",
    netEnabled: true,
    lastError: null,
    vsockClients: 1,
    commandsHandled: 5,
    consoleOpen: true,
    viewMode: "term",
    activeScript: null,
    config: { ...DEFAULT_OBC_CONFIG },
  };
  const kstats: ObcKernelTelemetry = {
    running: true,
    uptimeMs: 4200,
    compileMs: 180,
    cpus: 4,
    memoryMiB: 2048,
    memory64: false,
    cmdline: "console=hvc0",
    transport: "sab",
    crossOriginIsolated: true,
    cpuBlocker: null,
    activeWispUrl: "wss://code.samlepirate.org/",
    switches: 100,
    idles: 50,
    yields: 20,
    jit: { enabled: true, requested: true, compiled: 28, live: 28, maxLive: 28, freed: 0, failed: 0 },
    block: null,
    net: null,
    vsock: null,
    display: null,
    sound: null,
    shm: null,
  };
  return {
    adapter: {
      sampleTelemetry: () => ({
        ...emptyTelemetry(),
        vessel_id: "f35b",
        body: "earth",
      }),
      executeCommand: () => ({ ok: true, msg: "ok" }),
    },
    getStatus: () => status,
    getKernelStats: () => kstats,
    getWarmupState: () => "ready" as const,
    getHostCommandNames: () => ["bh-host", "tars", "ai", "hfetch", "obc-bench"],
    fetchFn,
  };
}

async function runHost(
  cmd: HostCommand,
  name: string,
  args: string[],
  opts?: { env?: Record<string, string>; stdinText?: string; isTTY?: boolean },
) {
  const { ctx, getStdout, getStderr } = makeCtx(name, args, opts);
  const code = await cmd(ctx);
  return { code, stdout: getStdout(), stderr: getStderr() };
}

describe("OBC Level 1+2+3 Performance & Native Host Commands", () => {
  test("DEFAULT_OBC_CONFIG requests 4-vCPU auto-SMP with JIT enabled", () => {
    expect(DEFAULT_OBC_CONFIG.cpus).toBe(4);
    expect(DEFAULT_OBC_CONFIG.jit).toBe(true);
    expect(DEFAULT_OBC_CONFIG.profile).toBe(false);
  });

  test("parseCliVal parses primitives, objects, and arrays accurately", () => {
    expect(parseCliVal("true")).toBe(true);
    expect(parseCliVal("false")).toBe(false);
    expect(parseCliVal("null")).toBeNull();
    expect(parseCliVal("42.5")).toBe(42.5);
    expect(parseCliVal('{"a":1}')).toEqual({ a: 1 });
    expect(parseCliVal("[1,2]")).toEqual([1, 2]);
    expect(parseCliVal("f35b")).toBe("f35b");
  });

  test("resolveAiProvider prioritizes OpenRouter / Anthropic / OpenAI correctly", () => {
    const p1 = resolveAiProvider({ OPENROUTER_API_KEY: "sk-or-test" });
    expect(p1?.kind).toBe("openrouter");

    const p2 = resolveAiProvider({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(p2?.kind).toBe("anthropic");

    const p3 = resolveAiProvider({ OPENAI_API_KEY: "sk-oai-test" });
    expect(p3?.kind).toBe("openai");

    // Explicit claude-* model with ANTHROPIC_API_KEY routes directly to Anthropic
    const p4 = resolveAiProvider({ OPENROUTER_API_KEY: "sk-or-test", ANTHROPIC_API_KEY: "sk-ant-test" }, "claude-sonnet-4-20250514");
    expect(p4?.kind).toBe("anthropic");

    expect(resolveAiProvider({}, undefined, null)).toBeNull();
  });

  test("Level 3 HostCommand: obc-bench reports SMP, SAB, JIT, V8 cache, and host commands", async () => {
    const cmds = createObcHostCommands(makeDeps());
    const res = await runHost(cmds["obc-bench"]!, "obc-bench", [], {
      env: {
        NODE_COMPILE_CACHE: "/home/pilot/.cache/v8-compile-cache",
        TMPDIR: "/tmp",
        XDG_CACHE_HOME: "/tmp/.cache",
      },
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("4 vCPUs SMP active");
    expect(res.stdout).toContain("SharedArrayBuffer (sab)");
    expect(res.stdout).toContain("/home/pilot/.cache/v8-compile-cache");
    expect(res.stdout).toContain("WARM");
    expect(res.stdout).toContain("bh-host, tars, ai, hfetch, obc-bench");
  });

  test("Level 3 HostCommand: bh-host executes telemetry, status, and live __bh queries natively", async () => {
    const g = globalThis as unknown as { __bh?: Record<string, unknown> };
    const prev = g.__bh;
    g.__bh = {
      fleet: { active: "f35b", count: 6 },
      // (an RPC root — src/obc/bh-rpc.ts RPC_ROOTS: a member outside them is not reachable from the guest)
      camera: { ping: (x: number) => x * 2 },
      ping: (x: number) => x * 2,
    };
    try {
      const cmds = createObcHostCommands(makeDeps());
      const tel = await runHost(cmds["bh-host"]!, "bh-host", ["telemetry"]);
      expect(tel.code).toBe(0);
      expect(JSON.parse(tel.stdout).vessel_id).toBe("f35b");

      const got = await runHost(cmds["bh-host"]!, "bh-host", ["get", "fleet.active", "--raw"]);
      expect(got.code).toBe(0);
      expect(got.stdout.trim()).toBe("f35b");

      const called = await runHost(cmds["bh-host"]!, "bh-host", ["call", "camera.ping", "21"]);
      expect(called.code).toBe(0);
      expect(JSON.parse(called.stdout)).toBe(42);
      // (the same function at a root outside RPC_ROOTS: refused)
      const outside = await runHost(cmds["bh-host"]!, "bh-host", ["call", "ping", "21"]);
      expect(outside.code).not.toBe(0);
    } finally {
      g.__bh = prev;
    }
  });

  test("Level 3 HostCommand: ai streams SSE tokens directly via native fetch with --sim telemetry", async () => {
    let seenBody = "";
    const mockFetch: FetchLike = async (_url, init) => {
      seenBody = String(init?.body ?? "");
      const sse = [
        'data: {"choices":[{"delta":{"content":"Mach "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"1.6 ready."}}]}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    const cmds = createObcHostCommands(makeDeps(mockFetch));
    const res = await runHost(cmds.ai!, "ai", ["--sim", "status?"], {
      env: { OPENROUTER_API_KEY: "sk-or-unit-test" },
      stdinText: "log line 1",
      isTTY: false,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("Mach 1.6 ready.\n");
    const parsed = JSON.parse(seenBody) as { messages: Array<{ content: string }> };
    expect(parsed.messages[0]!.content).toContain('"vessel":"f35b"');
    expect(parsed.messages[1]!.content).toContain("log line 1");
  });

  test("Level 3 HostCommand: hfetch fetches HTTP content natively bypassing Wisp", async () => {
    const mockFetch: FetchLike = async () => new Response("hello-native-host", { status: 200, headers: { "x-test": "ok" } });
    const cmds = createObcHostCommands(makeDeps(mockFetch));
    const res = await runHost(cmds.hfetch!, "hfetch", ["-i", "https://example.com/test"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("HTTP 200");
    expect(res.stdout).toContain("x-test: ok");
    expect(res.stdout).toContain("hello-native-host");
  });

  test("hfetch: public HTTPS only, no cookies; the page's origin, private hosts, http and redirects to them refused", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    let redirectTo = "";
    const mockFetch: FetchLike = async (url, init) => {
      seen.push({ url: String(url), init });
      const res = new Response("body", { status: 200 });
      if (redirectTo) Object.defineProperty(res, "url", { value: redirectTo });
      return res;
    };
    const cmds = createObcHostCommands(makeDeps(mockFetch));
    const g = globalThis as unknown as { location?: unknown };
    const prevLoc = g.location;
    g.location = { origin: "https://samlepirate.org" };
    try {
      for (const url of [
        "http://example.com/",
        "https://samlepirate.org/__snapshot",
        "https://localhost:3000/__deepgram",
        "https://127.0.0.1/",
        "https://[::ffff:7f00:1]/",
        "https://169.254.169.254/latest/meta-data/",
        "https://10.0.0.1/",
        "https://2130706433/",
        "https://user:pass@example.com/",
        "file:///etc/passwd",
      ]) {
        const r = await runHost(cmds.hfetch!, "hfetch", [url]);
        expect({ url, code: r.code, refused: r.stderr.includes("refused") }).toEqual({ url, code: 2, refused: true });
      }
      expect(seen.length).toBe(0);
      expect(hfetchRefusal("https://samlepirate.org/x", "https://samlepirate.org")).toBe("the page's own origin");

      // negative witness: a public HTTPS URL goes, without credentials
      const ok = await runHost(cmds.hfetch!, "hfetch", ["https://api.github.com/zen"]);
      expect(ok.code).toBe(0);
      expect(ok.stdout).toBe("body");
      expect(seen[0]?.init?.credentials).toBe("omit");

      // a redirect landing on the page's own origin: nothing shown
      redirectTo = "https://samlepirate.org/__snapshots/x";
      const red = await runHost(cmds.hfetch!, "hfetch", ["https://example.com/r"]);
      expect(red.code).toBe(2);
      expect(red.stdout).toBe("");
    } finally {
      g.location = prevLoc;
    }
  });
});
