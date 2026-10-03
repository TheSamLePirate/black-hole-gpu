// The app under test, driven as a player would: a production server of its own (no hot reload), real
// key and mouse events by the DevTools protocol — and every click proven to land on its element
// (an invisible overlay once swallowed the pointer while scripted .click() calls kept passing).
import { type Cdp, launch } from "./cdp";

const KEYCODES: Record<string, number> = {
  Escape: 27,
  Space: 32,
  Tab: 9,
  Enter: 13,
  ArrowDown: 40,
  ArrowUp: 38,
  F2: 113,
  F5: 116,
  F9: 120,
  Backspace: 8,
  Backquote: 192,
  Slash: 191,
  Comma: 188,
  Period: 190,
};
const vk = (code: string) =>
  code.startsWith("Key") ? code.charCodeAt(3) : code.startsWith("Digit") ? 48 + Number(code[5]) : (KEYCODES[code] ?? 0);

let server: { url: string; stop(): void } | null = null;

/** A production server on a free port (E2E_URL: one already running). */
async function serve() {
  if (process.env.E2E_URL) return { url: process.env.E2E_URL, stop() {} };
  if (server) return server;
  const port = 3200 + Math.floor(Math.random() * 500);
  const proc = Bun.spawn(["bun", "server.ts"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdout: "ignore",
    stderr: "inherit",
  });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 200; i++) {
    if (
      await fetch(url)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await Bun.sleep(100);
  }
  server = { url, stop: () => proc.kill() };
  return server;
}

export class App {
  private constructor(
    readonly cdp: Cdp,
    readonly url: string,
  ) {}

  /** A fresh page on the app (a scene by #scene=…, or a hash), loaded and settled. */
  static async boot(o: { hash?: string; width?: number; height?: number; lang?: "fr" | "en" } = {}) {
    const s = await serve();
    const cdp = await launch(o);
    const app = new App(cdp, s.url);
    // (offline from the world: the station's latest elements (CelesTrak) and the relief's tiles (S3)
    // change from day to day — the app falls back on its bundled ones, the same every run)
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: ["*celestrak.org*", "*s3.amazonaws.com*"] });
    // (the first-visit hint already seen: it would sit over what the tests look at)
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("kerr.hint-seen", "1"); localStorage.setItem("kerr.lang", "${o.lang ?? "en"}"); } catch {}`,
    });
    await app.load(o.hash ?? "");
    return app;
  }

  async load(hash: string) {
    await this.cdp.send("Page.navigate", { url: `${this.url}?e2e=${Math.random()}${hash ? `#${hash}` : ""}` });
    await this.waitFor(`typeof __bh !== "undefined" && !!__bh.renderer && !document.querySelector("#loading:not(.done)")`, 180_000);
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
