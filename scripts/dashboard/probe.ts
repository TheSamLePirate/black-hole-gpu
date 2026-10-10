// The dashboard's live page: the app booted in this Mac's test Chrome (the lock taken like any e2e — headless
// here), its picture streamed (DevTools screencast), driven from the dashboard — page expressions on __bh
// (a REPL: await, let, the last value), real keys and clicks, scenes, screenshots kept in remote-results/dash/shots/.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { App, stopServer } from "../../tests/e2e/lib/app";
import { DASH } from "./runs";

type Emit = (msg: Record<string, unknown>) => void;

export interface ProbeState {
  state: "off" | "starting" | "on" | "stopping";
  scene?: string;
  width: number;
  height: number;
  since?: number;
  error?: string;
  url?: string;
}

let app: App | null = null;
let state: ProbeState = { state: "off", width: 1280, height: 800 };
let frames = 0;
let stopCast: (() => void) | null = null;
let consoleOff: (() => void) | null = null;

export const probeState = () => state;

const set = (emit: Emit, s: Partial<ProbeState>) => {
  state = { ...state, ...s };
  emit({ t: "probe", state });
};

/** Boots the page (waits for this Mac's Chrome lock if another run holds it). */
export async function startProbe(emit: Emit, o: { scene?: string; width?: number; height?: number }) {
  if (state.state !== "off") throw new Error(`the live page is ${state.state}`);
  const width = Math.min(Math.max(o.width ?? 1280, 640), 2560),
    height = Math.min(Math.max(o.height ?? 800, 400), 1600);
  set(emit, { state: "starting", scene: o.scene ?? "game:artemis", width, height, error: undefined, since: Date.now() });
  try {
    process.env.KERR_LAB_LABEL = "e2e dashboard: live page";
    app = await App.boot({ hash: `scene=${o.scene ?? "game:artemis"}`, width, height });
    app.cdp.send("Runtime.enable").catch(() => {});
    consoleOff = app.cdp.on("Runtime.consoleAPICalled", (p) => {
      const args = (p.args as { value?: unknown; description?: string }[]).map((a) =>
        a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : a.description,
      );
      emit({ t: "pconsole", level: p.type, text: args.join(" ").slice(0, 4000), at: Date.now() });
    });
    await cast(emit);
    set(emit, { state: "on", url: app.url, since: Date.now() });
  } catch (e) {
    app?.close();
    app = null;
    stopServer();
    set(emit, { state: "off", error: String((e as Error).message ?? e) });
  }
}

async function cast(emit: Emit) {
  if (!app) return;
  const a = app;
  stopCast?.();
  const off = a.cdp.on("Page.screencastFrame", (p) => {
    frames++;
    emit({
      t: "frame",
      data: p.data,
      w: (p.metadata as { deviceWidth: number }).deviceWidth,
      h: (p.metadata as { deviceHeight: number }).deviceHeight,
    });
    a.cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await a.cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 72,
    maxWidth: state.width,
    maxHeight: state.height,
    everyNthFrame: 2,
  });
  stopCast = () => {
    off();
    a.cdp.send("Page.stopScreencast").catch(() => {});
  };
}

export async function stopProbe(emit: Emit) {
  if (!app) return;
  set(emit, { state: "stopping" });
  stopCast?.();
  consoleOff?.();
  stopCast = consoleOff = null;
  app.close();
  app = null;
  stopServer();
  set(emit, { state: "off", url: undefined });
}

/** A page expression, REPL style (top-level await, let; the last expression's value). */
export async function evalProbe(expr: string) {
  if (!app) throw new Error("no live page — start it first");
  const t0 = performance.now();
  const r = await app.cdp.send<{
    result?: { type: string; subtype?: string; value?: unknown; description?: string; className?: string };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  }>("Runtime.evaluate", { expression: expr, replMode: true, awaitPromise: true, returnByValue: true, userGesture: true }, 120);
  const ms = Math.round(performance.now() - t0);
  if (r.exceptionDetails) {
    const msg = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "error";
    // (a value that cannot travel as JSON — a class instance with cycles: shown by its description instead)
    if (/Object reference chain|could not be cloned|circular/i.test(msg)) {
      const d = await app.cdp.send<{ result?: { description?: string } }>("Runtime.evaluate", {
        expression: expr,
        replMode: true,
        awaitPromise: true,
      });
      return { ok: true, value: d.result?.description ?? "(not serialisable)", kind: "description", ms };
    }
    return { ok: false, error: msg, ms };
  }
  const res = r.result;
  return {
    ok: true,
    value: res?.type === "undefined" ? undefined : (res?.value ?? res?.description),
    kind: res?.subtype ?? res?.type,
    ms,
  };
}

/** Real input: a key by its physical code, a click or a wheel at page CSS px. */
export async function inputProbe(
  i:
    | { kind: "key"; code: string; shift?: boolean }
    | { kind: "click" | "wheel" | "down" | "up" | "move"; x: number; y: number; deltaY?: number; button?: "left" | "right" },
) {
  if (!app) throw new Error("no live page");
  if (i.kind === "key") return app.press(i.code, undefined, { shift: i.shift });
  if (i.kind === "click") {
    await app.mouse("move", i.x, i.y);
    await app.mouse("down", i.x, i.y, { button: i.button });
    await app.mouse("up", i.x, i.y, { button: i.button });
    return;
  }
  return app.mouse(i.kind, i.x, i.y, { deltaY: i.deltaY, button: i.button });
}

export async function sceneProbe(emit: Emit, scene: string) {
  if (!app) throw new Error("no live page");
  set(emit, { state: "starting", scene });
  try {
    await app.load(`scene=${scene}`);
    await cast(emit);
    set(emit, { state: "on" });
  } catch (e) {
    set(emit, { state: "on", error: String((e as Error).message) });
  }
}

/** A full-size PNG of the page, kept: its URL. */
export async function shotProbe(name?: string) {
  if (!app) throw new Error("no live page");
  const dir = join(DASH, "shots");
  mkdirSync(dir, { recursive: true });
  const d = new Date();
  const file = `${d.toISOString().replace(/[:.]/g, "-").slice(0, 19)}${name ? `-${name.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40)}` : ""}.png`;
  await app.shot(join(dir, file));
  return `/files/${dir}/${file}`;
}

export const probeErrors = () => app?.cdp.errors.slice(-50) ?? [];
export const probeFrames = () => frames;
