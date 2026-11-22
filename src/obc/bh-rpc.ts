// Universal __bh & TARS RPC Bridge for the embedded Linux OBC.
// Exposes the entire live `window.__bh` API and all 73 TARS tools to Linux CLI, TUI, and graphical apps
// over AF_VSOCK:4747 (async JSONL) and 9p `/obc/rpc_req` -> `/obc/rpc_res`, with safe cycle-free
// bounded serialization so no circular DOM/WebGPU reference ever breaks JSON transport.

import type { Tool } from "../ai/agent";
import { checkArgs, type Args } from "../ai/tool-schema";

export interface BhRpcRequest {
  id?: string | number;
  op: "ls" | "get" | "set" | "call" | "tools" | "tool" | "search" | "eval" | "mcdu";
  path?: string;
  value?: unknown;
  args?: unknown[];
  name?: string;
  toolArgs?: Record<string, unknown>;
  query?: string;
  expr?: string;
  depth?: number;
  refresh?: boolean;
  /** For op === "mcdu": A320 Captain/FO MCDU & Lower ECAM actions */
  action?: "screen" | "page" | "lsk" | "type" | "button" | "arrow" | "ecam";
  side?: 0 | 1;
  page?: string;
  lskSide?: "L" | "R";
  lskNum?: number;
  text?: string;
  dir?: "left" | "right" | "up" | "down";
  ecam?: string;
}

export interface BhRpcResponse {
  id?: string | number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function getBhRoot(): Record<string, unknown> | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as unknown as { __bh?: Record<string, unknown> };
  return g.__bh ?? null;
}

function getTarsTools(root: Record<string, unknown>): Tool[] {
  try {
    const tars = root.tars as { tools?: () => Tool[] } | undefined;
    if (typeof tars?.tools === "function") return tars.tools();
  } catch {
    // ignore
  }
  return [];
}

/** Cycle-free, bounded JSON-safe serializer for arbitrary live simulator objects. */
export function safeSerialize(val: unknown, maxDepth = 4, maxKeys = 64, maxArr = 48): unknown {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v ?? null;
    const t = typeof v;
    if (t === "boolean" || t === "string") return t === "string" && (v as string).length > 4000 ? `${(v as string).slice(0, 4000)}…` : v;
    if (t === "number") return Number.isFinite(v) ? v : String(v);
    if (t === "bigint") return v.toString();
    if (t === "symbol") return String(v);
    if (t === "function") return `[Function ${(v as { name?: string }).name || "anonymous"}/${(v as { length?: number }).length ?? 0}]`;
    if (t !== "object") return String(v);

    const obj = v as object;
    if (seen.has(obj)) return "[Circular]";
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof Error) return { error: obj.message, name: obj.name };
    if (typeof Element !== "undefined" && obj instanceof Element) return `[DOM <${obj.tagName.toLowerCase()}>]`;
    if (typeof EventTarget !== "undefined" && obj instanceof EventTarget && !(obj instanceof Map) && !(obj instanceof Set)) {
      const ctor = (obj as { constructor?: { name?: string } }).constructor?.name ?? "EventTarget";
      if (ctor.includes("Canvas") || ctor.includes("GPU") || ctor.includes("Audio") || ctor.includes("Window")) {
        return `[${ctor}]`;
      }
    }
    if (ArrayBuffer.isView(obj)) {
      const ta = obj as unknown as { length: number; [i: number]: number };
      const n = Math.min(ta.length ?? 0, 24);
      const sample: number[] = [];
      for (let i = 0; i < n; i++) sample.push(Number(ta[i]));
      return ta.length > n ? { type: obj.constructor.name, length: ta.length, head: sample } : sample;
    }
    if (obj instanceof Map) {
      if (depth <= 0) return `[Map(${obj.size})]`;
      seen.add(obj);
      const out: Record<string, unknown> = {};
      let i = 0;
      for (const [k, mv] of obj.entries()) {
        if (i++ >= maxKeys) {
          out["…"] = `(+${obj.size - maxKeys} more)`;
          break;
        }
        out[String(k)] = walk(mv, depth - 1);
      }
      return out;
    }
    if (obj instanceof Set) {
      if (depth <= 0) return `[Set(${obj.size})]`;
      seen.add(obj);
      const out: unknown[] = [];
      let i = 0;
      for (const sv of obj.values()) {
        if (i++ >= maxArr) break;
        out.push(walk(sv, depth - 1));
      }
      return out;
    }
    if (Array.isArray(obj)) {
      if (depth <= 0) return `[Array(${obj.length})]`;
      seen.add(obj);
      const out = obj.slice(0, maxArr).map((item) => walk(item, depth - 1));
      if (obj.length > maxArr) out.push(`…(+${obj.length - maxArr} more)`);
      return out;
    }

    if (depth <= 0) {
      const ctor = (obj as { constructor?: { name?: string } }).constructor?.name;
      const keys = Object.keys(obj);
      return `[${ctor && ctor !== "Object" ? ctor : "Object"}(${keys.length})]`;
    }
    seen.add(obj);
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const lim = Math.min(keys.length, maxKeys);
    for (let i = 0; i < lim; i++) {
      const k = keys[i]!;
      try {
        out[k] = walk((obj as Record<string, unknown>)[k], depth - 1);
      } catch {
        out[k] = "[Unreadable]";
      }
    }
    if (keys.length > maxKeys) out["…"] = `(+${keys.length - maxKeys} more keys)`;
    return out;
  };
  return walk(val, maxDepth);
}

/** Resolve a dot-separated path (optionally prefixed with `__bh.`) returning parent, key, and value. */
function resolvePath(
  root: Record<string, unknown>,
  rawPath: string | undefined,
): { parent: Record<string, unknown> | null; key: string; value: unknown } {
  const clean = (rawPath ?? "").trim().replace(/^__bh\.?/, "");
  if (!clean) return { parent: null, key: "", value: root };
  const parts = clean.split(".").filter(Boolean);
  let cur: unknown = root;
  let parent: Record<string, unknown> | null = null;
  let key = "";
  for (const part of parts) {
    if (cur === null || cur === undefined || (typeof cur !== "object" && typeof cur !== "function")) {
      throw new Error(`Cannot read "${part}" of ${String(cur)} in path "${clean}"`);
    }
    parent = cur as Record<string, unknown>;
    key = part;
    cur = parent[part];
  }
  return { parent, key, value: cur };
}

interface LsEntry {
  name: string;
  kind: "fn" | "obj" | "arr" | "num" | "str" | "bool" | "null";
  preview: string;
  arity?: number;
}

function listMembers(target: unknown): LsEntry[] {
  if (target === null || target === undefined || typeof target !== "object") return [];
  const obj = target as Record<string, unknown>;
  const names = new Set<string>();
  for (const k of Object.keys(obj)) names.add(k);
  const proto = Object.getPrototypeOf(obj);
  if (proto && proto !== Object.prototype && proto !== Array.prototype) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      if (k !== "constructor" && !k.startsWith("_")) names.add(k);
    }
  }
  const entries: LsEntry[] = [];
  for (const name of [...names].sort().slice(0, 160)) {
    let val: unknown;
    try {
      val = obj[name];
    } catch {
      entries.push({ name, kind: "null", preview: "[getter error]" });
      continue;
    }
    if (val === null || val === undefined) {
      entries.push({ name, kind: "null", preview: String(val) });
    } else if (typeof val === "function") {
      entries.push({ name, kind: "fn", preview: `fn(${val.length})`, arity: val.length });
    } else if (Array.isArray(val)) {
      entries.push({ name, kind: "arr", preview: `Array(${val.length})` });
    } else if (typeof val === "object") {
      const ctor = (val as { constructor?: { name?: string } }).constructor?.name;
      const n = Object.keys(val).length;
      entries.push({ name, kind: "obj", preview: `${ctor && ctor !== "Object" ? ctor : "Object"}(${n})` });
    } else if (typeof val === "number") {
      entries.push({ name, kind: "num", preview: Number.isFinite(val) ? String(Math.round(val * 10000) / 10000) : String(val) });
    } else if (typeof val === "boolean") {
      entries.push({ name, kind: "bool", preview: String(val) });
    } else {
      const s = String(val);
      entries.push({ name, kind: "str", preview: s.length > 44 ? `${s.slice(0, 44)}…` : s });
    }
  }
  return entries;
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return v !== null && (typeof v === "object" || typeof v === "function") && typeof (v as { then?: unknown }).then === "function";
}

/**
 * Execute a universal `__bh` or TARS tool RPC request from Linux.
 * Returns synchronously whenever the target operation is synchronous (so 9p `/obc/rpc_req` -> `/obc/rpc_res`
 * completes with zero guest polling latency), and returns a Promise only when the invoked method/tool is async.
 */
export function handleBhRpcMaybeSync(req: BhRpcRequest): BhRpcResponse | Promise<BhRpcResponse> {
  const id = req.id;
  const root = getBhRoot();
  if (!root) return { id, ok: false, error: "__bh is not mounted on globalThis" };

  try {
    switch (req.op) {
      case "ls": {
        const { value } = resolvePath(root, req.path);
        return { id, ok: true, result: listMembers(value) };
      }
      case "get": {
        const { value } = resolvePath(root, req.path);
        const depth = Math.max(1, Math.min(6, Number(req.depth ?? 3) || 3));
        return { id, ok: true, result: safeSerialize(value, depth) };
      }
      case "set": {
        if (!req.path) return { id, ok: false, error: "set requires path" };
        const { parent, key } = resolvePath(root, req.path);
        if (!parent || !key) return { id, ok: false, error: "cannot assign to __bh root" };
        parent[key] = req.value;
        if (req.refresh !== false && req.path.replace(/^__bh\.?/, "").startsWith("settings.")) {
          const ref = root.refresh;
          if (typeof ref === "function") (ref as () => void)();
        }
        return { id, ok: true, result: safeSerialize(parent[key], 2) };
      }
      case "call": {
        if (!req.path) return { id, ok: false, error: "call requires path" };
        const { parent, value } = resolvePath(root, req.path);
        if (typeof value !== "function") return { id, ok: false, error: `${req.path} is not a function` };
        const args = Array.isArray(req.args) ? req.args : [];
        const depth = Math.max(1, Math.min(6, Number(req.depth ?? 4) || 4));
        const ret = (value as (...a: unknown[]) => unknown).apply(parent ?? root, args);
        if (isPromiseLike(ret)) {
          return Promise.resolve(ret).then(
            (v) => ({ id, ok: true, result: safeSerialize(v, depth) }),
            (e) => ({ id, ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
        }
        return { id, ok: true, result: safeSerialize(ret, depth) };
      }
      case "tools": {
        const tools = getTarsTools(root).map((t) => ({
          name: t.name,
          description: String(t.description ?? "").slice(0, 140),
          params: Object.keys(t.params ?? {}),
          required: t.required ?? [],
        }));
        return { id, ok: true, result: tools };
      }
      case "tool": {
        const name = String(req.name ?? "").trim();
        if (!name) return { id, ok: false, error: "tool requires name" };
        const tool = getTarsTools(root).find((t) => t.name === name);
        if (!tool) return { id, ok: false, error: `unknown TARS tool "${name}"` };
        const chk = checkArgs(tool, (req.toolArgs ?? {}) as Args);
        if (!chk.ok) return { id, ok: false, error: chk.error };
        const res = tool.run(chk.args, new AbortController().signal);
        if (isPromiseLike(res)) {
          return Promise.resolve(res).then(
            (v) => ({ id, ok: true, result: safeSerialize(v, 4) }),
            (e) => ({ id, ok: false, error: e instanceof Error ? e.message : String(e) }),
          );
        }
        return { id, ok: true, result: safeSerialize(res, 4) };
      }
      case "search": {
        const q = String(req.query ?? "")
          .trim()
          .toLowerCase();
        if (!q) return { id, ok: true, result: { paths: [], tools: [] } };
        const paths: { path: string; kind: string; preview: string }[] = [];
        for (const top of listMembers(root)) {
          if (top.name.toLowerCase().includes(q)) {
            paths.push({ path: top.name, kind: top.kind, preview: top.preview });
          }
          if (top.kind === "obj" && paths.length < 60) {
            try {
              const sub = root[top.name];
              for (const child of listMembers(sub)) {
                const full = `${top.name}.${child.name}`;
                if (full.toLowerCase().includes(q)) {
                  paths.push({ path: full, kind: child.kind, preview: child.preview });
                  if (paths.length >= 60) break;
                }
              }
            } catch {
              // ignore unreadable subtree
            }
          }
        }
        const tools = getTarsTools(root)
          .filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
          .slice(0, 30)
          .map((t) => ({ name: t.name, description: t.description.slice(0, 100) }));
        return { id, ok: true, result: { paths, tools } };
      }
      case "eval": {
        const expr = String(req.expr ?? "").trim();
        if (!expr) return { id, ok: false, error: "eval requires expr" };
        // CSP-safe chain & assignment evaluator (no eval / new Function):
        // supports bh.foo.bar(1, "x", {a: true})[0]?.baz and `bh.path = value`.
        const depth = Math.max(1, Math.min(6, Number(req.depth ?? 4) || 4));
        return evalSafeChain(root, expr).then(
          (ret) => ({ id, ok: true, result: safeSerialize(ret, depth) }),
          (e) => ({ id, ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      }
      case "mcdu": {
        const side: 0 | 1 = req.side === 1 ? 1 : 0;
        const getter = root.a320Mcdu as ((s: 0 | 1) => McduLike | null) | undefined;
        const m = typeof getter === "function" ? getter(side) : null;
        if (!m) return { id, ok: false, error: "A320 MCDU not active (switch craft to a320 first)" };
        const act = req.action ?? "screen";
        const textOf = (runs?: { t: string }[]) => (runs ?? []).map((x) => x.t).join("");
        const snap = () => {
          const s = m.current.screen(m);
          return {
            pageId: m.pageId,
            title: textOf(s.title),
            scratchpad: m.sp ?? "",
            message: m.message ?? null,
            lines: (s.lines ?? []).map((ln) => ({
              l: textOf(ln.l),
              r: textOf(ln.r),
              c: textOf(ln.c),
              ls: textOf(ln.ls),
              rs: textOf(ln.rs),
              cs: textOf(ln.cs),
            })),
          };
        };
        if (act === "screen") return { id, ok: true, result: snap() };
        if (act === "page") {
          const p = String(req.page ?? "menu")
            .trim()
            .toLowerCase();
          const before = m.pageId;
          m.open(p);
          if (m.pageId === before && p !== before) m.page(p);
          return { id, ok: true, result: snap() };
        }
        if (act === "lsk") {
          const ls = req.lskSide === "R" ? "R" : "L";
          const num = Math.max(1, Math.min(6, Number(req.lskNum ?? 1) || 1));
          m.lsk(ls, num);
          return { id, ok: true, result: snap() };
        }
        if (act === "type") {
          m.type(String(req.text ?? ""));
          return { id, ok: true, result: { pageId: m.pageId, scratchpad: m.sp ?? "", message: m.message ?? null } };
        }
        if (act === "button") {
          m.button(String(req.text ?? "CLR"));
          return { id, ok: true, result: { pageId: m.pageId, scratchpad: m.sp ?? "", message: m.message ?? null } };
        }
        if (act === "arrow") {
          m.arrow(req.dir ?? "down");
          return { id, ok: true, result: snap() };
        }
        if (act === "ecam") {
          const ecam = String(req.ecam ?? "obcPage").trim();
          if (typeof m.host?.setSdPage !== "function") return { id, ok: false, error: "A320 ECAM setSdPage unavailable" };
          m.host.setSdPage(ecam);
          return { id, ok: true, result: { ecam } };
        }
        return { id, ok: false, error: `unknown mcdu action "${String(act)}"` };
      }
      default:
        return { id, ok: false, error: `unknown op "${String((req as { op?: unknown }).op)}"` };
    }
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Async wrapper around `handleBhRpcMaybeSync` for AF_VSOCK & unit tests. */
export async function handleBhRpc(req: BhRpcRequest): Promise<BhRpcResponse> {
  return await Promise.resolve(handleBhRpcMaybeSync(req));
}

interface McduRunLike {
  t: string;
}
interface McduLineLike {
  l?: McduRunLike[];
  r?: McduRunLike[];
  c?: McduRunLike[];
  ls?: McduRunLike[];
  rs?: McduRunLike[];
  cs?: McduRunLike[];
}
interface McduLike {
  sp: string;
  pageId: string;
  message: string | null;
  current: { screen(m: McduLike): { title?: McduRunLike[]; lines?: McduLineLike[] } };
  open(id: string): void;
  page(name: string): void;
  lsk(side: "L" | "R", n: number): void;
  type(text: string): void;
  button(k: string): void;
  arrow(dir: "left" | "right" | "up" | "down"): void;
  host?: { setSdPage?(page: string): void };
}

/** Parse a single JSON-like argument literal or nested `bh.*` expression (CSP-safe, no eval/Function). */
function parseArgToken(root: Record<string, unknown>, raw: string): Promise<unknown> | unknown {
  const s = raw.trim();
  if (!s) return undefined;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (s === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    if (s.startsWith("'")) return s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    return JSON.parse(s);
  }
  if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
    return JSON.parse(s);
  }
  return evalSafeChain(root, s);
}

/** Split top-level comma-separated argument list honoring quotes and nested brackets/parens. */
function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Find a top-level `=` assignment operator (excluding `==`, `!=`, `<=`, `>=`, `=>`). */
function findTopLevelAssign(src: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "=" && depth === 0) {
      const prev = src[i - 1] ?? "";
      const next = src[i + 1] ?? "";
      if (prev !== "=" && prev !== "!" && prev !== "<" && prev !== ">" && next !== "=" && next !== ">") {
        return i;
      }
    }
  }
  return -1;
}

/**
 * 100% CSP-safe evaluator for `__bh` property chains, method calls, bracket indexing,
 * optional chaining (`?.`), and simple assignments (`bh.settings.bloom = 0.4`).
 */
export async function evalSafeChain(root: Record<string, unknown>, rawExpr: string): Promise<unknown> {
  const expr = rawExpr.trim().replace(/;+$/, "");
  if (!expr) return undefined;

  // Handle top-level assignment: `bh.settings.bloom = 0.5`
  const assignIdx = findTopLevelAssign(expr);
  if (assignIdx > 0) {
    const lhs = expr
      .slice(0, assignIdx)
      .trim()
      .replace(/^(?:window\.)?(?:__bh|bh)\.?/, "");
    const rhs = expr.slice(assignIdx + 1).trim();
    const val = await parseArgToken(root, rhs);
    const { parent, key } = resolvePath(root, lhs);
    if (!parent || !key) throw new Error(`Cannot assign to "${lhs}"`);
    parent[key] = val;
    if (lhs.startsWith("settings.") && typeof root.refresh === "function") {
      (root.refresh as () => void)();
    }
    return parent[key];
  }

  let s = expr;
  if (s === "bh" || s === "__bh" || s === "window.__bh") return root;
  s = s.replace(/^(?:window\.)?(?:__bh|bh)(?=\.|\[|\?\.|$)/, "");

  let cur: unknown = root;
  let parent: unknown = root;
  let i = 0;

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;

    let optional = false;
    if (s.startsWith("?.", i)) {
      optional = true;
      i += 2;
      if (cur === null || cur === undefined) return undefined;
    } else if (s[i] === ".") {
      i++;
    }

    if (s[i] === "[") {
      let depth = 1;
      let quote: string | null = null;
      const start = i + 1;
      i++;
      while (i < s.length && depth > 0) {
        const ch = s[i]!;
        if (quote) {
          if (ch === "\\") i++;
          else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "[") depth++;
        else if (ch === "]") depth--;
        i++;
      }
      const keyVal = await parseArgToken(root, s.slice(start, i - 1));
      if (cur === null || cur === undefined) {
        if (optional) return undefined;
        throw new Error(`Cannot index ${String(cur)}`);
      }
      parent = cur;
      cur = (cur as Record<string, unknown>)[String(keyVal)];
      continue;
    }

    if (s[i] === "(") {
      let depth = 1;
      let quote: string | null = null;
      const start = i + 1;
      i++;
      while (i < s.length && depth > 0) {
        const ch = s[i]!;
        if (quote) {
          if (ch === "\\") i++;
          else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      if (typeof cur !== "function") {
        if (optional) return undefined;
        throw new Error(`Value in "${expr}" is not callable`);
      }
      const rawArgs = splitArgs(s.slice(start, i - 1));
      const argVals: unknown[] = [];
      for (const a of rawArgs) argVals.push(await parseArgToken(root, a));
      cur = await Promise.resolve((cur as (...a: unknown[]) => unknown).apply(parent ?? root, argVals));
      parent = cur;
      continue;
    }

    // Identifier segment
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
    if (!m) throw new Error(`Unexpected token near "${s.slice(i, i + 20)}" in "${expr}"`);
    const key = m[0];
    i += key.length;
    if (cur === null || cur === undefined) {
      if (optional) return undefined;
      throw new Error(`Cannot read "${key}" of ${String(cur)}`);
    }
    parent = cur;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
