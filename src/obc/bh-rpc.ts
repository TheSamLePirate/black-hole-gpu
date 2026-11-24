// Universal __bh & TARS RPC Bridge for the embedded Linux OBC.
// Exposes the entire live `window.__bh` API and all 73 TARS tools to Linux CLI, TUI, and graphical apps
// over AF_VSOCK:4747 (async JSONL) and 9p `/obc/rpc_req` -> `/obc/rpc_res`, with safe cycle-free
// bounded serialization so no circular DOM/WebGPU reference ever breaks JSON transport.
//
// Guest privileges (review of 24 Nov 2026): whatever runs in the guest — including a package's install script — can
// write to this bridge, so it is NOT the page. Every property step (paths, `eval` chains, assignments) goes through
// `rpcStep`, which:
// - follows only the explicit roots of `RPC_ROOTS` from `__bh` (a new `__bh` member is not reachable until added);
// - refuses `__proto__`, `constructor`, `prototype` and the other prototype/Function-internals keys (no pollution, no
//   Function constructor), and keys named like secrets (api keys, tokens, passwords, cookies);
// - refuses walking into or calling page objects: Window/Document/DOM nodes, every EventTarget (workers, sockets, audio,
//   GPU devices), Storage, Location, Navigator, GPU*/WebGL*/Canvas* objects, and the page's `fetch`/`eval`/`Function`/
//   timers. `get` renders such a value as a `[Ctor]` tag, never its fields.
// Incoming values (`set`, call arguments, tool arguments) lose their `__proto__`/`constructor`/`prototype` keys, and
// serialized results have secret-named fields and the player's stored API keys redacted.

import type { Tool } from "../ai/agent";
import { checkArgs, type Args } from "../ai/tool-schema";
import { store } from "../util/storage";

/** The `__bh` roots the guest may reach (everything else, present or future, is refused). */
export const RPC_ROOTS: ReadonlySet<string> = new Set([
  // reading the simulation and flying
  "settings",
  "refresh",
  "touch",
  "preset",
  "presets",
  "camera",
  "cam",
  "flight",
  "fleet",
  "sim",
  "simState",
  "ourState",
  "viewPose",
  "time",
  "setTime",
  "setDate",
  "step",
  "freeze",
  "held",
  "phase",
  "mode",
  "mission",
  "game",
  "hud",
  "sys",
  "mapView",
  "radar",
  "relief",
  "sky",
  "skyLoading",
  "iss",
  "issCamera",
  "issCameras",
  "jwst",
  "lagrange",
  "goTo",
  "voyage",
  "tour",
  "touring",
  "spectate",
  "viewAt",
  "scenes",
  "recorder",
  "mx",
  // cockpits, screens and crew voices
  "a320Mcdu",
  "a320DeckAt",
  "cockpitScreens",
  "cockpitControlAt",
  "cockpitScreenPoint",
  "cabinPick",
  "pcd",
  "voice",
  "capcom",
  "music",
  "sound",
  "audio",
  "tars",
  // menus and diagnostics
  "intro",
  "entry",
  "menu",
  "bench",
  "graphicsDiagnostic",
  "videoState",
]);
// (left out on purpose: renderer, gpu — raw GPU objects —; obc — the guest reconfiguring its own host, e.g. its Wisp relay —;
// net, netLight — the player's multiplayer identity —; pwa; snapshot, render, video, captureScenes — dev POSTs and heavy
// captures —; boot, resize.)

/** Keys never followed nor assigned: prototype pollution, the Function constructor, legacy accessors. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "caller",
  "callee",
  "arguments",
]);

const SECRET_KEY_SUFFIXES = [
  "apikey",
  "secret",
  "password",
  "passwd",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "authorization",
  "token",
  "privatekey",
];

/** Whether a property name reads like a secret (`apiKey`, `OPENROUTER_API_KEY`, `accessToken`, `password`…). */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k === "bearer" || SECRET_KEY_SUFFIXES.some((s) => k.endsWith(s));
}

// (the browser's own class names, whole — a game class such as `ScreenStack` or `AudioBus` is not one; most of these are
// EventTargets anyway, caught by instanceof)
const PAGE_CTOR_RE =
  /^(GPU[A-Z][A-Za-z0-9]*|WebGL[A-Za-z0-9]*|HTML[A-Za-z]*Element|HTMLDocument|SVG[A-Za-z]*Element|Canvas(RenderingContext2D|Gradient|Pattern)|OffscreenCanvas(RenderingContext2D)?|ImageBitmap(RenderingContext)?|CSSStyleDeclaration|CSSStyleSheet|Window|Document|Location|History|Navigator|Screen|Storage|StorageManager|IDB[A-Z][A-Za-z]*|Cache|CacheStorage|ServiceWorker[A-Za-z]*|Worker|SharedWorker|WebSocket|XMLHttpRequest|EventSource|BroadcastChannel|MessagePort|MessageChannel|(Offline)?AudioContext|AudioWorkletNode|MediaStream[A-Za-z]*|MediaRecorder|RTC[A-Z][A-Za-z]*|CookieStore|Clipboard|Crypto|SubtleCrypto|FileSystem[A-Za-z]*Handle|Notification)$/;

function ctorName(v: object): string {
  try {
    return (Object.getPrototypeOf(v) as { constructor?: { name?: unknown } } | null)?.constructor?.name?.toString() ?? "";
  } catch {
    return "";
  }
}

let pageFunctions: Set<unknown> | null = null;
function isPageFunction(v: unknown): boolean {
  if (!pageFunctions) {
    const g = globalThis as Record<string, unknown>;
    pageFunctions = new Set(
      ["fetch", "eval", "Function", "setTimeout", "setInterval", "open", "postMessage", "importScripts", "alert", "confirm", "prompt"]
        .map((n) => g[n])
        .filter((f) => typeof f === "function"),
    );
  }
  return pageFunctions.has(v);
}

/** A page object's tag (`Window`, `HTMLCanvasElement`, `GPUDevice`…), or null for an ordinary value. */
export function pageObjectTag(v: unknown): string | null {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return null;
  if (v === globalThis) return "Window";
  if (typeof v === "function") return isPageFunction(v) ? `native ${(v as { name?: string }).name || "function"}` : null;
  if (typeof EventTarget !== "undefined" && v instanceof EventTarget) return ctorName(v) || "EventTarget";
  if (typeof Storage !== "undefined" && v instanceof Storage) return "Storage";
  const name = ctorName(v);
  return PAGE_CTOR_RE.test(name) ? name : null;
}

/** Thrown for a step the guest may not take. */
export class RpcDenied extends Error {}

/**
 * One guarded property step: `holder[key]`, with `root` the `__bh` object. A root key outside `RPC_ROOTS` reads as
 * undefined when `__bh` has no such member, and is refused when it has one.
 */
export function rpcStep(root: unknown, holder: unknown, key: string, path: string): unknown {
  if (FORBIDDEN_KEYS.has(key)) throw new RpcDenied(`"${key}" is not reachable from the OBC (in "${path}")`);
  if (isSecretKey(key)) throw new RpcDenied(`"${key}" looks like a secret and is not reachable from the OBC (in "${path}")`);
  if (holder === null || holder === undefined || (typeof holder !== "object" && typeof holder !== "function")) {
    throw new Error(`Cannot read "${key}" of ${String(holder)} in "${path}"`);
  }
  const holderTag = pageObjectTag(holder);
  if (holderTag) throw new RpcDenied(`${holderTag} is a page object, not reachable from the OBC (in "${path}")`);
  if (holder === root && !RPC_ROOTS.has(key)) {
    if (key in (root as object)) throw new RpcDenied(`__bh.${key} is not exposed to the OBC`);
    return undefined;
  }
  const v = (holder as Record<string, unknown>)[key];
  const tag = pageObjectTag(v);
  if (tag) throw new RpcDenied(`"${path}" is a page object (${tag}), not reachable from the OBC`);
  return v;
}

/** A value from the guest with every `__proto__`/`constructor`/`prototype` key dropped (deep, bounded). */
export function sanitizeIncoming(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object" || depth > 32) return v;
  if (Array.isArray(v)) return v.map((x) => sanitizeIncoming(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = sanitizeIncoming((v as Record<string, unknown>)[k], depth + 1);
  }
  return out;
}

const KEY_PATTERN_RE = /\bsk-(?:or-v1-|or-|ant-|proj-)?[A-Za-z0-9_-]{20,}/g;
/** A string with the player's stored keys (OpenRouter, Deepgram) and anything shaped like an API key redacted. */
function redactString(s: string): string {
  let out = s.replace(KEY_PATTERN_RE, "[redacted]");
  for (const k of [store.get("kerr.openrouter.key"), store.get("kerr.deepgram.key")]) {
    if (k && k.length >= 8 && out.includes(k)) out = out.split(k).join("[redacted]");
  }
  return out;
}

export interface BhRpcRequest {
  id?: string | number;
  op: "ls" | "get" | "set" | "call" | "tools" | "tool" | "search" | "eval" | "mcdu" | "catalog";
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
    if (t === "boolean") return v;
    if (t === "string") return redactString((v as string).length > 4000 ? `${(v as string).slice(0, 4000)}…` : (v as string));
    if (t === "number") return Number.isFinite(v) ? v : String(v);
    if (t === "bigint") return v.toString();
    if (t === "symbol") return String(v);
    if (t === "function") return `[Function ${(v as { name?: string }).name || "anonymous"}/${(v as { length?: number }).length ?? 0}]`;
    if (t !== "object") return String(v);

    const obj = v as object;
    if (seen.has(obj)) return "[Circular]";
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof Error) return { error: redactString(obj.message), name: obj.name };
    if (typeof Element !== "undefined" && obj instanceof Element) return `[DOM <${obj.tagName.toLowerCase()}>]`;
    // (page objects — Window, DOM, EventTargets, Storage, GPU… — as a tag, never their fields)
    const pageTag = pageObjectTag(obj);
    if (pageTag) return `[${pageTag}]`;
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
        const mk = String(k);
        if (FORBIDDEN_KEYS.has(mk)) continue;
        out[mk] = isSecretKey(mk) ? "[redacted]" : walk(mv, depth - 1);
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
      if (FORBIDDEN_KEYS.has(k)) continue;
      if (isSecretKey(k)) {
        out[k] = "[redacted]";
        continue;
      }
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

/** `__bh` as the guest sees it: its `RPC_ROOTS` members only. */
export function rpcRootView(root: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RPC_ROOTS) if (k in root) out[k] = root[k];
  return out;
}

/** Resolve a dot-separated path (optionally prefixed with `__bh.`) returning parent, key, and value — every step guarded. */
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
    parent = cur as Record<string, unknown>;
    key = part;
    cur = rpcStep(root, parent, part, clean);
  }
  return { parent, key, value: cur };
}

/** Assign `value` at `parent[key]` (guarded): never a `__bh` root, a forbidden or secret key, nor onto a page object. */
function assignGuarded(root: Record<string, unknown>, parent: Record<string, unknown> | null, key: string, value: unknown, path: string) {
  if (!parent || !key || parent === root) throw new RpcDenied(`cannot assign to __bh root ("${path}")`);
  if (FORBIDDEN_KEYS.has(key) || isSecretKey(key)) throw new RpcDenied(`"${key}" cannot be assigned from the OBC`);
  if (pageObjectTag(parent)) throw new RpcDenied(`cannot assign onto a page object ("${path}")`);
  parent[key] = sanitizeIncoming(value);
}

interface LsEntry {
  name: string;
  kind: "fn" | "obj" | "arr" | "num" | "str" | "bool" | "null";
  preview: string;
  arity?: number;
  fnParams?: string[];
}

interface RichParamSpec {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
}

/** Extract JS parameter names from a function's source for interactive TUI call forms. */
function extractFnParams(fn: (...a: unknown[]) => unknown): string[] {
  try {
    const src = Function.prototype.toString
      .call(fn)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .trim();
    const m = /^[^(]*\(([^)]*)\)/.exec(src) ?? /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(src);
    if (!m?.[1]?.trim()) return [];
    return splitArgs(m[1])
      .map((p) =>
        p
          .split("=")[0]!
          .trim()
          .replace(/^\.\.\./, "…"),
      )
      .filter((p) => p.length > 0 && p.length <= 32)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function serializeParamSpecs(t: Tool): RichParamSpec[] {
  const req = new Set(t.required ?? []);
  return Object.entries(t.params ?? {}).map(([name, spec]) => {
    const out: RichParamSpec = {
      name,
      type: spec.type,
      required: req.has(name),
    };
    if (spec.description) out.description = String(spec.description).slice(0, 140);
    if (spec.type === "string" && spec.enum) out.enum = [...spec.enum];
    if (spec.type === "number") {
      if (spec.minimum !== undefined) out.min = spec.minimum;
      if (spec.maximum !== undefined) out.max = spec.maximum;
      if (spec.integer) out.integer = true;
    }
    return out;
  });
}

function serializeToolSummary(t: Tool) {
  return {
    name: t.name,
    description: String(t.description ?? "").slice(0, 220),
    params: Object.keys(t.params ?? {}),
    required: t.required ?? [],
    paramSpecs: serializeParamSpecs(t),
  };
}

function buildCatalog(root: Record<string, unknown>) {
  const members: { path: string; kind: LsEntry["kind"]; preview: string; arity?: number; fnParams?: string[] }[] = [];
  const deepRoots = new Set(["settings", "obc", "fleet", "camera", "flight", "lagrange", "jwst", "tars", "cockpitScreens", "audio"]);
  const MAX_MEMBERS = 500;

  const pushEntry = (path: string, entry: LsEntry) => {
    if (members.length >= MAX_MEMBERS) return;
    const rec: { path: string; kind: LsEntry["kind"]; preview: string; arity?: number; fnParams?: string[] } = {
      path,
      kind: entry.kind,
      preview: entry.preview,
    };
    if (entry.arity !== undefined) rec.arity = entry.arity;
    if (entry.fnParams && entry.fnParams.length > 0) rec.fnParams = entry.fnParams;
    members.push(rec);
  };

  for (const top of listMembers(root, root)) {
    pushEntry(top.name, top);
    if (top.kind !== "obj" || members.length >= MAX_MEMBERS) continue;
    let sub: unknown;
    try {
      sub = rpcStep(root, root, top.name, top.name);
    } catch {
      continue;
    }
    if (!sub || typeof sub !== "object") continue;
    const subObj = sub as Record<string, unknown>;
    for (const child of listMembers(subObj)) {
      const p2 = `${top.name}.${child.name}`;
      pushEntry(p2, child);
      if (child.kind === "obj" && deepRoots.has(top.name) && members.length < MAX_MEMBERS) {
        try {
          const grand = subObj[child.name];
          if (grand && typeof grand === "object" && !Array.isArray(grand)) {
            for (const g of listMembers(grand).slice(0, 40)) {
              pushEntry(`${p2}.${g.name}`, g);
            }
          }
        } catch {
          // ignore unreadable subtree
        }
      }
    }
  }
  const tools = getTarsTools(root).map(serializeToolSummary);
  return { members, tools };
}

function listMembers(target: unknown, root?: unknown): LsEntry[] {
  if (target === null || target === undefined || typeof target !== "object") return [];
  if (pageObjectTag(target)) return [];
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
  const visible = [...names].filter((n) => !FORBIDDEN_KEYS.has(n) && !isSecretKey(n) && (target !== root || RPC_ROOTS.has(n)));
  for (const name of visible.sort().slice(0, 160)) {
    let val: unknown;
    try {
      val = obj[name];
    } catch {
      entries.push({ name, kind: "null", preview: "[getter error]" });
      continue;
    }
    const tag = pageObjectTag(val);
    if (tag) {
      entries.push({ name, kind: "null", preview: `[${tag}] (page object, not reachable)` });
      continue;
    }
    if (val === null || val === undefined) {
      entries.push({ name, kind: "null", preview: String(val) });
    } else if (typeof val === "function") {
      const fnParams = extractFnParams(val as (...a: unknown[]) => unknown);
      entries.push({
        name,
        kind: "fn",
        preview: fnParams.length > 0 ? `fn(${fnParams.join(", ")})` : `fn(${val.length})`,
        arity: val.length,
        fnParams,
      });
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
        return { id, ok: true, result: listMembers(value, root) };
      }
      case "get": {
        const { value } = resolvePath(root, req.path);
        const depth = Math.max(1, Math.min(6, Number(req.depth ?? 3) || 3));
        return { id, ok: true, result: safeSerialize(value === root ? rpcRootView(root) : value, depth) };
      }
      case "set": {
        if (!req.path) return { id, ok: false, error: "set requires path" };
        const { parent, key } = resolvePath(root, req.path);
        assignGuarded(root, parent, key, req.value, req.path);
        if (!parent) return { id, ok: false, error: "cannot assign to __bh root" };
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
        const args = Array.isArray(req.args) ? (sanitizeIncoming(req.args) as unknown[]) : [];
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
        return { id, ok: true, result: getTarsTools(root).map(serializeToolSummary) };
      }
      case "catalog": {
        return { id, ok: true, result: buildCatalog(root) };
      }
      case "tool": {
        const name = String(req.name ?? "").trim();
        if (!name) return { id, ok: false, error: "tool requires name" };
        const tool = getTarsTools(root).find((t) => t.name === name);
        if (!tool) return { id, ok: false, error: `unknown TARS tool "${name}"` };
        const chk = checkArgs(tool, sanitizeIncoming(req.toolArgs ?? {}) as Args);
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
        for (const top of listMembers(root, root)) {
          if (top.name.toLowerCase().includes(q)) {
            paths.push({ path: top.name, kind: top.kind, preview: top.preview });
          }
          if (top.kind === "obj" && paths.length < 60) {
            try {
              const sub = rpcStep(root, root, top.name, top.name);
              for (const child of listMembers(sub, root)) {
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
          (ret) => ({ id, ok: true, result: safeSerialize(ret === root ? rpcRootView(root) : ret, depth) }),
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
    return sanitizeIncoming(JSON.parse(s));
  }
  // (a nested chain's value becomes an argument or a key: never a page object, nor `__bh` itself)
  return Promise.resolve(evalSafeChain(root, s)).then((v) => {
    const tag = v === root ? "__bh" : pageObjectTag(v);
    if (tag) throw new RpcDenied(`${tag} cannot be passed as an argument from the OBC`);
    return v;
  });
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
    assignGuarded(root, parent, key, val, lhs);
    if (!parent) throw new Error(`Cannot assign to "${lhs}"`);
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
      cur = rpcStep(root, cur, String(keyVal), expr);
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
    cur = rpcStep(root, cur, key, expr);
  }
  return cur;
}
