// The app under test, driven as a player would: a production server of its own (no hot reload), real
// key and mouse events by the DevTools protocol — and every click proven to land on its element
// (an invisible overlay once swallowed the pointer while scripted .click() calls kept passing).
import { type Cdp, launch } from "./cdp";

const KEYCODES: Record<string, number> = {
  Escape: 27,
  F3: 114,
  F4: 115,
  Space: 32,
  Tab: 9,
  Enter: 13,
  ArrowDown: 40,
  ArrowUp: 38,
  F2: 113,
  F5: 116,
  F6: 117,
  F7: 118,
  F9: 120,
  Backspace: 8,
  Backquote: 192,
  Slash: 191,
  Comma: 188,
  Period: 190,
};
const vk = (code: string) =>
  code.startsWith("Key") ? code.charCodeAt(3) : code.startsWith("Digit") ? 48 + Number(code[5]) : (KEYCODES[code] ?? 0);

let server: { url: string; stop(): void; alive(): boolean } | null = null;

/**
 * A production server on a free port (E2E_URL: one already running). Proven up before a page is sent to it,
 * and started again if it died since the last test — a server gone left each boot waiting its full 180 s on a
 * page that could not load (Chrome's "address unreachable") instead of failing at once with the cause.
 */
async function serve() {
  if (process.env.E2E_URL) return { url: process.env.E2E_URL, stop() {}, alive: () => true };
  if (server?.alive()) return server;
  if (server) console.error("e2e: the app's server had died — started again");
  // (a port nothing listens on: tried before the server is started — macOS's media sharing holds 3689,
  // and a run cut short leaves its server behind)
  const free = (p: number) => {
    try {
      Bun.serve({ port: p, fetch: () => new Response("") }).stop(true);
      return true;
    } catch {
      return false;
    }
  };
  let port = 0;
  for (let k = 0; k < 100 && !port; k++) {
    const p = 3200 + Math.floor(Math.random() * 500);
    if (free(p)) port = p;
  }
  if (!port) throw new Error("e2e: no free port for the app's server (3200–3700 all taken?)");
  const proc = Bun.spawn(["bun", "server.ts"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "production", KERR_PARENT_PID: String(process.pid) },
    stdout: "ignore",
    stderr: "inherit",
  });
  let exited: number | null = null;
  void proc.exited.then((c) => {
    exited = c;
  });
  const url = `http://localhost:${port}/`;
  let up = false;
  for (let i = 0; i < 300 && !up && exited === null; i++) {
    up = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (!up) await Bun.sleep(100);
  }
  if (!up) {
    proc.kill();
    throw new Error(
      exited !== null
        ? `e2e: the app's server (bun server.ts, port ${port}) exited with code ${exited} before answering — its error is above`
        : `e2e: the app's server (bun server.ts, port ${port}) did not answer in 30 s`,
    );
  }
  server = { url, stop: () => proc.kill(), alive: () => exited === null };
  return server;
}

export class App {
  private constructor(
    readonly cdp: Cdp,
    readonly url: string,
  ) {}

  /** A fresh page on the app (a scene by #scene=…, or a hash), loaded and settled. */
  static async boot(
    o: {
      hash?: string;
      width?: number;
      height?: number;
      lang?: "fr" | "en";
      tiles?: boolean;
      sw?: boolean;
      initScript?: string;
      startupFailure?: boolean;
      /** Chrome's own flags for this run (a fake microphone: --use-file-for-fake-audio-capture…) */
      args?: string[];
    } = {},
  ) {
    const s = await serve();
    const cdp = await launch(o);
    const app = new App(cdp, s.url);
    // (offline from the world: the station's latest elements (CelesTrak) and the relief's tiles (S3)
    // change from day to day — the app falls back on its bundled ones, the same every run)
    await cdp.send("Network.enable");
    // (the terrain tiles and their imagery (GIBS) off unless asked: a test does not wait on the network)
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", ...(o.tiles ? [] : ["*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"])],
    });
    // (the first-visit hint already seen: it would sit over what the tests look at)
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("kerr.hint-seen", "1"); localStorage.setItem("kerr.lang", "${o.lang ?? "en"}"); } catch {}`,
    });
    if (o.initScript) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: o.initScript });
    app.sw = !!o.sw;
    await app.load(o.hash ?? "", !!o.startupFailure);
    return app;
  }

  /** the Service Worker wanted (`sw=1`: the page registers it despite the e2e flag) */
  sw = false;

  /** the last load's navigation → splash-lifted wall time [ms] */
  lastLoadMs = 0;

  async load(hash: string, startupFailure = false) {
    if (server && !server.alive()) throw new Error("e2e: the app's server has died (its error is in the log above) — the page cannot load");
    const t0 = performance.now();
    const previousOrigin = await this.js<number>("performance.timeOrigin");
    await this.cdp.send("Page.navigate", { url: `${this.url}?e2e=${Math.random()}${this.sw ? "&sw=1" : ""}${hash ? `#${hash}` : ""}` });
    await this.waitFor(
      `performance.timeOrigin !== ${previousOrigin} && ${startupFailure ? 'document.querySelector("#error")?.hidden === false' : 'typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0 && !document.querySelector("#loading:not(.done)")'}`,
      180_000,
    );
    this.lastLoadMs = performance.now() - t0;
    await Bun.sleep(1500);
  }

  close() {
    this.cdp.close();
  }

  // biome-ignore lint/suspicious/noExplicitAny: what the page's code returns, typed at the call when it matters
  async js<T = any>(expr: string): Promise<T> {
    const r = await this.cdp.send<{ result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
      "Runtime.evaluate",
      { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true, userGesture: true },
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value as T;
  }

  async waitFor(expr: string, timeout = 10_000) {
    const t0 = Date.now();
    let last: unknown;
    while (Date.now() - t0 < timeout) {
      try {
        if ((last = await this.js(expr))) return last;
      } catch (e) {
        last = e;
      }
      await Bun.sleep(100);
    }
    throw new Error(`waitFor(${expr}): ${timeout} ms, last ${String(last)}`);
  }

  /** A key by its physical code (QWERTY's key text unless given). */
  async press(code: string, key?: string, o: { shift?: boolean } = {}) {
    const k =
      key ?? (code.startsWith("Key") ? code[3]!.toLowerCase() : code.startsWith("Digit") ? code[5]! : code === "Backquote" ? "`" : code);
    // (Enter types a carriage return, as a keyboard does: what activates a focused button)
    const text = k.length === 1 ? k : code === "Enter" ? "\r" : undefined;
    const ev = { code, key: k, windowsVirtualKeyCode: vk(code), nativeVirtualKeyCode: vk(code), modifiers: o.shift ? 8 : 0 };
    await this.cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...ev, text });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev });
    await Bun.sleep(60);
  }

  /** A key held down for a while (`during` runs while it is down: a push-to-talk's words), then released. */
  async hold(code: string, ms: number, during?: () => Promise<void>) {
    const ev = { code, key: code, windowsVirtualKeyCode: vk(code), nativeVirtualKeyCode: vk(code), modifiers: 0 };
    await this.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ev });
    await Bun.sleep(ms);
    await during?.();
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev });
    await Bun.sleep(60);
  }

  /** Text typed into the focused field (as an input method gives it: no key events for the flight). */
  async type(text: string) {
    await this.cdp.send("Input.insertText", { text });
    await Bun.sleep(60);
  }

  /** The element's centre, proven to receive the pointer there (else: the elements in the way). */
  async hit(selector: string): Promise<{ x: number; y: number }> {
    const r = await this.js<{ ok: boolean; x: number; y: number; stack: string[] }>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, x: 0, y: 0, stack: ["(absent)"] };
      const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      const top = document.elementFromPoint(x, y);
      const d = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).join(".") : "");
      return { ok: b.width > 0 && !!top && (top === el || el.contains(top)), x, y, stack: document.elementsFromPoint(x, y).slice(0, 5).map(d) };
    })()`);
    if (!r.ok) throw new Error(`${selector} is not clickable: ${r.stack.join(" > ")}`);
    return r;
  }

  async click(selector: string) {
    const { x, y } = await this.hit(selector);
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await Bun.sleep(100);
  }

  /** A raw mouse event at (x, y) [CSS px] — moved, pressed, released (left or right), the wheel. */
  async mouse(
    type: "move" | "down" | "up" | "wheel",
    x: number,
    y: number,
    o: { button?: "left" | "right"; deltaY?: number; shift?: boolean } = {},
  ) {
    const button = o.button ?? "left";
    const buttons = button === "left" ? 1 : 2;
    const modifiers = o.shift ? 8 : 0;
    if (type === "move")
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        modifiers,
        ...(this.mouseDown ? { button: this.mouseDown, buttons: this.mouseDown === "left" ? 1 : 2 } : {}),
      });
    else if (type === "down") {
      this.mouseDown = button;
      await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons, clickCount: 1, modifiers });
    } else if (type === "up") {
      this.mouseDown = null;
      await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers });
    } else await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: o.deltaY ?? 100, modifiers });
    await Bun.sleep(30);
  }
  private mouseDown: "left" | "right" | null = null;

  /**
   * Fingers on the screen (CSS px): each step, every finger's point; the first step puts them down, the
   * last lifts them (Chrome turns the touches into pointer events of type "touch").
   */
  async touch(steps: { x: number; y: number }[][], stepMs = 16) {
    await this.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const pts = (s: { x: number; y: number }[]) => s.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }));
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(steps[0]!) });
    for (const s of steps.slice(1)) {
      await Bun.sleep(stepMs);
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(s) });
    }
    await Bun.sleep(stepMs);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await Bun.sleep(100);
  }

  async shot(file: string) {
    const r = await this.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    await Bun.write(file, Buffer.from(r.data, "base64"));
  }
}

/** Stops the server the tests started. */
export function stopServer() {
  server?.stop();
  server = null;
}

export const E2E = process.env.E2E === "1";
