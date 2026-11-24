import { afterEach, beforeEach, expect, test } from "bun:test";
import { evalSafeChain, handleBhRpc, safeSerialize } from "../src/obc/bh-rpc";

const g = globalThis as unknown as { __bh?: Record<string, unknown> };
let prevBh: Record<string, unknown> | undefined;

beforeEach(() => {
  prevBh = g.__bh;
});

afterEach(() => {
  g.__bh = prevBh;
});

function installMockBh() {
  let refreshed = 0;
  let sdPage = "cruisePage";
  const mcdu = {
    sp: "",
    pageId: "menu",
    message: null as string | null,
    current: {
      screen() {
        return {
          title: [{ t: mcdu.pageId === "obc" ? "OBC LINUX LINK" : "MCDU MENU" }],
          lines: [{ ls: [{ t: " STATE" }], l: [{ t: "<OBC LINK" }], rs: [{ t: "LINUX" }], r: [{ t: "READY" }] }],
        };
      },
    },
    open(id: string) {
      if (["menu", "obc", "fpln", "status"].includes(id)) this.pageId = id;
    },
    page(name: string) {
      if (name === "mcdu") this.pageId = "menu";
      if (name === "f-pln") this.pageId = "fpln";
    },
    lsk(side: "L" | "R", n: number) {
      if (side === "L" && n === 5) this.pageId = "obc";
      else this.message = `PRESSED ${side}${n}`;
    },
    type(txt: string) {
      this.sp += txt.toUpperCase();
    },
    button(k: string) {
      if (k === "CLR") this.sp = "";
    },
    arrow() {},
    host: {
      setSdPage(p: string) {
        sdPage = p;
      },
    },
  };

  g.__bh = {
    fleet: { active: "a320", list: ["ranger", "f35b", "a320"] },
    settings: { bloom: 0.4, exposure: 1.0 },
    refresh() {
      refreshed++;
    },
    camera: {
      add(a: number, b: number) {
        return a + b;
      },
      async pingAsync(tag: string) {
        return { pong: tag };
      },
    },
    a320Mcdu(side: 0 | 1) {
      return side === 0 ? mcdu : null;
    },
    tars: {
      tools() {
        return [
          {
            name: "approach",
            description: "List or engage ILS approaches at any airfield",
            params: {
              action: { type: "string", enum: ["list", "select", "engage"], description: "Operation mode" },
              field: { type: "string", description: "ICAO code" },
            },
            required: ["action"],
            run(args: Record<string, unknown>) {
              return { field: args.field ?? "LFPB", action: args.action };
            },
          },
        ];
      },
    },
  };
  return { getRefreshed: () => refreshed, getSdPage: () => sdPage, mcdu };
}

test("safeSerialize handles cycles, BigInt, TypedArrays, Map/Set, and depth limits", () => {
  const cyc: Record<string, unknown> = { a: 1, big: 42n, arr: new Float32Array([1, 2, 3]) };
  cyc.self = cyc;
  const out = safeSerialize(cyc, 3) as Record<string, unknown>;
  expect(out.a).toBe(1);
  expect(out.big).toBe("42");
  expect(out.arr).toEqual([1, 2, 3]);
  expect(out.self).toBe("[Circular]");

  const m = new Map([["k", new Set([1, 2])]]);
  expect(safeSerialize(m, 3)).toEqual({ k: [1, 2] });
});

test("handleBhRpc supports ls, get, set (with auto-refresh), call (sync+async), tools, tool, and search", async () => {
  const { getRefreshed } = installMockBh();

  const ls = await handleBhRpc({ id: 1, op: "ls" });
  expect(ls.ok).toBe(true);
  expect((ls.result as { name: string }[]).some((e) => e.name === "fleet")).toBe(true);

  const got = await handleBhRpc({ id: 2, op: "get", path: "fleet.active" });
  expect(got).toEqual({ id: 2, ok: true, result: "a320" });

  const setRes = await handleBhRpc({ id: 3, op: "set", path: "settings.bloom", value: 0.75 });
  expect(setRes).toEqual({ id: 3, ok: true, result: 0.75 });
  expect(getRefreshed()).toBe(1);

  const callSync = await handleBhRpc({ id: 4, op: "call", path: "camera.add", args: [19, 23] });
  expect(callSync).toEqual({ id: 4, ok: true, result: 42 });

  const callAsync = await handleBhRpc({ id: 5, op: "call", path: "camera.pingAsync", args: ["ok"] });
  expect(callAsync).toEqual({ id: 5, ok: true, result: { pong: "ok" } });

  const tools = await handleBhRpc({ id: 6, op: "tools" });
  expect(tools.ok).toBe(true);
  expect((tools.result as { name: string }[])[0]?.name).toBe("approach");

  const runTool = await handleBhRpc({ id: 7, op: "tool", name: "approach", toolArgs: { action: "list", field: "KSFO" } });
  expect(runTool).toEqual({ id: 7, ok: true, result: { field: "KSFO", action: "list" } });

  const badTool = await handleBhRpc({ id: 8, op: "tool", name: "approach", toolArgs: {} });
  expect(badTool.ok).toBe(false);

  const srch = await handleBhRpc({ id: 9, op: "search", query: "approach" });
  expect(srch.ok).toBe(true);
  expect((srch.result as { tools: { name: string }[] }).tools[0]?.name).toBe("approach");
});

test("handleBhRpc eval is 100% CSP-safe (no eval/new Function) and handles chains, indexing, optional chaining & assignments", async () => {
  const { getRefreshed } = installMockBh();

  expect(await evalSafeChain(g.__bh!, "bh.fleet.list[2]")).toBe("a320");
  expect(await evalSafeChain(g.__bh!, 'bh.camera.pingAsync("hi")')).toEqual({ pong: "hi" });
  expect(await evalSafeChain(g.__bh!, "bh.missing?.deep?.prop")).toBeUndefined();

  const ev = await handleBhRpc({ id: 10, op: "eval", expr: "bh.settings.exposure = 1.3" });
  expect(ev).toEqual({ id: 10, ok: true, result: 1.3 });
  expect(getRefreshed()).toBe(1);
});

test("handleBhRpc op:mcdu controls Captain MCDU screen, page, lsk, type, button, and Lower ECAM SD", async () => {
  const { getSdPage } = installMockBh();

  const scr1 = await handleBhRpc({ id: 11, op: "mcdu", action: "screen" });
  expect(scr1.ok).toBe(true);
  expect((scr1.result as { title: string }).title).toBe("MCDU MENU");

  const pg = await handleBhRpc({ id: 12, op: "mcdu", action: "page", page: "obc" });
  expect(pg.ok).toBe(true);
  expect((pg.result as { pageId: string; title: string }).pageId).toBe("obc");
  expect((pg.result as { title: string }).title).toBe("OBC LINUX LINK");

  const typed = await handleBhRpc({ id: 13, op: "mcdu", action: "type", text: "lfpb" });
  expect(typed.ok).toBe(true);
  expect((typed.result as { scratchpad: string }).scratchpad).toBe("LFPB");

  const lsk = await handleBhRpc({ id: 14, op: "mcdu", action: "lsk", lskSide: "R", lskNum: 1 });
  expect(lsk.ok).toBe(true);
  expect((lsk.result as { message: string }).message).toBe("PRESSED R1");

  const ecam = await handleBhRpc({ id: 15, op: "mcdu", action: "ecam", ecam: "obcPage" });
  expect(ecam).toEqual({ id: 15, ok: true, result: { ecam: "obcPage" } });
  expect(getSdPage()).toBe("obcPage");
});

test("handleBhRpc op:catalog indexes nested __bh members with fnParams and rich TARS paramSpecs", async () => {
  installMockBh();
  const res = await handleBhRpc({ id: 16, op: "catalog" });
  expect(res.ok).toBe(true);
  const cat = res.result as {
    members: { path: string; kind: string; fnParams?: string[] }[];
    tools: { name: string; paramSpecs: { name: string; required: boolean; enum?: string[] }[] }[];
  };
  const addFn = cat.members.find((m) => m.path === "camera.add");
  expect(addFn?.kind).toBe("fn");
  expect(addFn?.fnParams).toEqual(["a", "b"]);
  expect(cat.members.some((m) => m.path === "settings.bloom" && m.kind === "num")).toBe(true);
  const approach = cat.tools.find((t) => t.name === "approach");
  expect(approach?.paramSpecs[0]?.name).toBe("action");
  expect(approach?.paramSpecs[0]?.required).toBe(true);
  expect(approach?.paramSpecs[0]?.enum).toEqual(["list", "select", "engage"]);
});

// ── Guest privileges (review of 24 Nov 2026): the guest is not the page ──
// Each refusal next to its negative witness: the same mock lets the legitimate path through.

/** Stand-ins for page objects (no DOM in bun test): classes named like the browser's, a real EventTarget, globalThis. */
class HTMLCanvasElement {
  ownerDocument = { defaultView: globalThis };
}
class GPUCanvasContext {
  canvas = new HTMLCanvasElement();
}

const FAKE_KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";

function installHostileBh() {
  const target: Record<string, unknown> = { level: 1 };
  g.__bh = {
    settings: { bloom: 0.4, openrouterApiKey: FAKE_KEY, note: `key ${FAKE_KEY}` },
    renderer: { context: new GPUCanvasContext() },
    camera: {
      add: (a: number, b: number) => a + b,
      canvas: new HTMLCanvasElement(),
      ev: new EventTarget(),
      win: globalThis,
      fetcher: globalThis.fetch,
      ctx: new GPUCanvasContext(),
      merge(patch: Record<string, unknown>) {
        Object.assign(target, patch);
        return { level: target.level };
      },
      echo: (v: unknown) => v,
    },
    obc: { setWispUrl: () => "changed" },
  };
  return { target };
}

type Req = Parameters<typeof handleBhRpc>[0];
const outcome = async (req: Req) => ({ req: req.path ?? req.expr, ok: (await handleBhRpc(req)).ok });

test("RPC refuses page objects, globals, fetch, Function and roots outside RPC_ROOTS — and still serves the legitimate paths", async () => {
  installHostileBh();
  const refusals: Req[] = [
    { op: "get", path: "renderer" },
    { op: "get", path: "renderer.context" },
    { op: "call", path: "obc.setWispUrl", args: ["wss://evil.example/"] },
    { op: "get", path: "camera.canvas" },
    { op: "get", path: "camera.canvas.ownerDocument.defaultView" },
    { op: "get", path: "camera.win.localStorage" },
    { op: "get", path: "camera.ctx.canvas" },
    { op: "get", path: "camera.ev" },
    { op: "call", path: "camera.fetcher", args: ["https://example.com/"] },
    { op: "call", path: "camera.ev.dispatchEvent", args: [] },
    { op: "eval", expr: 'bh.camera.win.localStorage.getItem("kerr.openrouter.key")' },
    { op: "eval", expr: "bh.camera.canvas.ownerDocument.defaultView.document.cookie" },
    { op: "eval", expr: "bh.renderer.context.canvas.ownerDocument.defaultView.localStorage" },
    { op: "eval", expr: 'bh.camera.add.constructor("return globalThis")()' },
    { op: "eval", expr: 'bh.camera["constructor"]' },
    { op: "eval", expr: "bh.camera.echo(bh.camera.win)" },
    { op: "eval", expr: "bh.camera.echo(bh)" },
    { op: "eval", expr: "bh.camera.add.call.constructor" },
  ];
  for (const req of refusals) expect(await outcome(req)).toEqual({ req: req.path ?? req.expr, ok: false });

  // the root as the guest sees it: RPC_ROOTS only
  const names = ((await handleBhRpc({ op: "ls" })).result as { name: string }[]).map((e) => e.name);
  expect(names).toContain("camera");
  expect(names).not.toContain("renderer");
  expect(names).not.toContain("obc");
  const root = (await handleBhRpc({ op: "get", path: "", depth: 1 })).result as Record<string, unknown>;
  expect(Object.keys(root)).not.toContain("renderer");
  const camLs = (await handleBhRpc({ op: "ls", path: "camera" })).result as { name: string; preview: string }[];
  expect(camLs.find((e) => e.name === "win")?.preview).toContain("not reachable");

  // negative witnesses: the same mock's legitimate paths
  expect((await handleBhRpc({ op: "call", path: "camera.add", args: [2, 3] })).result).toBe(5);
  expect((await handleBhRpc({ op: "eval", expr: "bh.camera.add.call(null, 4, 5)" })).result).toBe(9);
  expect((await handleBhRpc({ op: "get", path: "settings.bloom" })).result).toBe(0.4);
  // (a missing root still reads as undefined)
  expect((await handleBhRpc({ op: "eval", expr: "bh.missing?.deep" })).ok).toBe(true);
});

test("RPC refuses prototype pollution through set, eval and call arguments", async () => {
  const { target } = installHostileBh();
  const proto = Object.prototype as Record<string, unknown>;
  const refusals: Req[] = [
    { op: "set", path: "settings.__proto__.polluted", value: 1 },
    { op: "set", path: "settings.constructor.prototype.polluted", value: 1 },
    { op: "set", path: "camera", value: {} },
    { op: "eval", expr: "bh.settings.__proto__.polluted = 1" },
    { op: "eval", expr: 'bh.settings["__proto__"]["polluted"] = 1' },
  ];
  for (const req of refusals) expect(await outcome(req)).toEqual({ req: req.path ?? req.expr, ok: false });
  // a JSON argument carrying __proto__ reaches the function without it
  const viaCall = await handleBhRpc({ op: "call", path: "camera.merge", args: [JSON.parse('{"__proto__": {"polluted": 1}, "level": 2}')] });
  expect(viaCall.ok).toBe(true);
  const viaEval = await handleBhRpc({ op: "eval", expr: 'bh.camera.merge({"__proto__": {"polluted": 1}, "level": 3})' });
  expect(viaEval.ok).toBe(true);
  expect(proto.polluted).toBeUndefined();
  expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  expect(target.level).toBe(3);
  // negative witness: an ordinary assignment still works
  expect(await handleBhRpc({ op: "set", path: "settings.bloom", value: 0.9 })).toEqual({ id: undefined, ok: true, result: 0.9 });
});

test("RPC never returns secrets: secret-named fields redacted and unreachable, key-shaped strings masked", async () => {
  installHostileBh();
  expect((await handleBhRpc({ op: "get", path: "settings.openrouterApiKey" })).ok).toBe(false);
  const s = (await handleBhRpc({ op: "get", path: "settings" })).result as Record<string, unknown>;
  expect(s.openrouterApiKey).toBe("[redacted]");
  expect(String(s.note)).not.toContain(FAKE_KEY);
  expect(s.bloom).toBe(0.4);
  const ls = (await handleBhRpc({ op: "ls", path: "settings" })).result as { name: string }[];
  expect(ls.map((e) => e.name)).not.toContain("openrouterApiKey");
});
