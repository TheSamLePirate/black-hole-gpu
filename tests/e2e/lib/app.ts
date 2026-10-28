// The app under test, driven as a player would: a production server of its own (no hot reload), real
// key and mouse events by the DevTools protocol — and every click proven to land on its element
// (an invisible overlay once swallowed the pointer while scripted .click() calls kept passing).
import { type Cdp, launch } from "./cdp";
import { recorder } from "./telemetry";

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
  F13: 124,
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
/** The ports Chrome will not load a page from (net/base/port_util.cc, kRestrictedPorts): ERR_UNSAFE_PORT. */
const CHROME_UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117,
  119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636,
  989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
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
    // (never one Chrome refuses to load — ERR_UNSAFE_PORT: 3659, apple-sasl, is in the range)
    if (!CHROME_UNSAFE_PORTS.has(p) && free(p)) port = p;
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

/** The page's daylight (App.load): __bh.game.flyAt and walk on the Earth first set the clock to the place's late morning
 *  when it is night or the sun is low there (local solar time outside 8:30–16:00), unless the test set a date itself
 *  or the page is in a network room (the room's one clock); the station's scene at a "now" it stays sunlit (a test's
 *  own now kept). */
const DAYLIGHT = `(() => {
  const G = __bh.game;
  if (!G || G.__e2eDaylight) return 1;
  G.__e2eDaylight = true;
  let chosen = false;
  const setDate = G.setDate.bind(G);
  G.setDate = (d) => ((chosen = true), setDate(d));
  const day = (lon) => {
    // (in a network room the clock is the room's — one for every page —: left alone)
    if (chosen || window.__e2eKeepTime || !Number.isFinite(lon) || __bh.net?.net?.room) return;
    const d = new Date(G.date().replace(" ", "T") + ":00Z");
    if (!Number.isFinite(d.getTime())) return;
    const solar = (((d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15) % 24) + 24) % 24;
    if (solar >= 8.5 && solar <= 16) return;
    setDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (11 - lon / 15) * 3600e3).toISOString());
  };
  const fly = G.flyAt.bind(G);
  G.flyAt = (lat, lon, ...a) => ((a[3] ?? "earth") === "earth" && day(lon), fly(lat, lon, ...a));
  const walk = G.walk.bind(G);
  G.walk = (body, lat = 0, lon = 0) => (body === "earth" && day(lon), walk(body, lat, lon));
  // (the station's scene — it takes the calendar's "now" — in the sun: a now when the station stays out of the Earth's
  // shadow 25 minutes at least, the first in the next two hours; a "now" or a date the test fixed, its own)
  const fixNow = __bh.setDate;
  __bh.setDate = (ms) => ((chosen = true), fixNow(ms));
  const ISS = "Earth: docking to the ISS";
  window.__e2eSunlitIss = () => {
    if (chosen || window.__e2eKeepTime || __bh.net?.net?.room) return null;
    const M = 1476.625 * __bh.settings.massSolar, Ms = 4.925490947e-6 * __bh.settings.massSolar;
    const d0 = Date.parse(G.date().replace(" ", "T") + ":00Z"), t0 = G.now();
    const tOf = (ms) => t0 + (ms - d0) / 1000 / Ms;
    const lit = (t) => {
      const o = __bh.iss.orbit(t);
      if (!o) return true;
      const S = __bh.ourState("sun", t).pos, E = __bh.ourState("earth", t).pos;
      const s = [0, 1, 2].map((k) => S[k] - E[k]), l = Math.hypot(...s), u = s.map((x) => x / l);
      const X = [0, 1, 2].map((k) => o.X[k] - E[k]);
      const a = X[0] * u[0] + X[1] * u[1] + X[2] * u[2];
      return a > 0 || Math.hypot(...X.map((x, k) => x - u[k] * a)) * M > 6378137;
    };
    const now = Date.now();
    for (let m = 0; m < 120; m += 2) {
      const ms = now + m * 60e3;
      let ok = true;
      for (let k = 0; k <= 25 && ok; k += 5) ok = lit(tOf(ms + k * 60e3));
      if (ok) return ms;
    }
    return null;
  };
  const sunlit = (name) => {
    if (name !== ISS) return;
    const ms = window.__e2eSunlitIss();
    if (ms !== null) fixNow(ms);
  };
  for (const host of [__bh, G])
    if (typeof host.preset === "function") {
      const p = host.preset.bind(host);
      host.preset = (name, ...a) => (sunlit(name), p(name, ...a));
    }
  return 1;
})()`;

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
      /** the crew console's language (crew/: its own, kerr.crew.lang) — French unless asked: its e2e read its French */
      crewLang?: "fr" | "en";
      tiles?: boolean;
      sw?: boolean;
      initScript?: string;
      startupFailure?: boolean;
      /** Chrome's own flags for this run (a fake microphone: --use-file-for-fake-audio-capture…) */
      args?: string[];
      /** Chrome's profile folder, kept after the close (default: a fresh one, removed) — a second boot on it is a
       *  returning player's launch: Chrome's shader cache in it */
      profile?: string;
      /** false: this page not recorded (tests/e2e/lib/telemetry.ts — on by default under `bun run e2e`) */
      telemetry?: boolean;
      /** the intro played whole, as on a first visit (otherwise its short version: it was seen) */
      fullIntro?: boolean;
      /** Independent crew page; no renderer readiness or simulator telemetry. */
      entry?: "crew";
    } = {},
  ) {
    // (the test file booting it, for its report's folder: E2E_FILE when one file runs, else the caller's frame)
    const file =
      process.env.E2E_FILE ?? new Error().stack?.match(/tests[\\/]e2e[\\/]([\w.-]+\.e2e\.test\.ts)/)?.[1] ?? "unknown.e2e.test.ts";
    const s = await serve();
    const cdp = await launch(o);
    const app = new App(cdp, s.url);
    app.entry = o.entry;
    // (offline from the world: the station's latest elements (CelesTrak) and the relief's tiles (S3)
    // change from day to day — the app falls back on its bundled ones, the same every run)
    await cdp.send("Network.enable");
    // (the terrain tiles and their imagery (GIBS) off unless asked: a test does not wait on the network)
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", ...(o.tiles ? [] : ["*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"])],
    });
    // (the first-visit hint already seen: it would sit over what the tests look at)
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      // (the intro seen: its short version, 1.5 s — tests/e2e/intro.e2e.test.ts plays it whole)
      source: `try { localStorage.setItem("kerr.hint-seen", "1"); localStorage.setItem("kerr.lang", "${o.lang ?? "en"}"); localStorage.setItem("kerr.crew.lang", "${o.crewLang ?? "fr"}"); if (!${!!o.fullIntro}) localStorage.setItem("kerr.intro.seen", "1"); } catch {}`,
    });
    if (o.initScript) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: o.initScript });
    app.sw = !!o.sw;
    app.file = file;
    app.recorded = !o.entry && o.telemetry !== false;
    // (a boot that fails — no first image in time — closes its Chrome: the test never had it to close)
    try {
      await app.load(o.hash ?? "", !!o.startupFailure);
    } catch (e) {
      cdp.close();
      throw e;
    }
    return app;
  }

  /** the Service Worker wanted (`sw=1`: the page registers it despite the e2e flag) */
  sw = false;

  /** the test file that booted it, and whether its telemetry is recorded */
  file = "";
  recorded = true;
  entry: "crew" | undefined;

  /** the last load's navigation → splash-lifted wall time [ms] */
  lastLoadMs = 0;

  async load(hash: string, startupFailure = false) {
    if (server && !server.alive()) throw new Error("e2e: the app's server has died (its error is in the log above) — the page cannot load");
    const t0 = performance.now();
    const previousOrigin = await this.js<number>("performance.timeOrigin");
    await this.cdp.send("Page.navigate", {
      url: `${this.url}${this.entry ? "crew/" : ""}?e2e=${Math.random()}${this.sw ? "&sw=1" : ""}${hash ? `#${hash}` : ""}`,
    });
    if (this.entry) {
      await this.waitFor(
        `performance.timeOrigin !== ${previousOrigin} && !!window.__crew && document.querySelector("#lobby")?.open`,
        30_000,
      );
      this.lastLoadMs = performance.now() - t0;
      return;
    }
    await this.waitFor(
      `performance.timeOrigin !== ${previousOrigin} && ${startupFailure ? 'document.querySelector("#error")?.hidden === false' : 'typeof __bh !== "undefined" && __bh.renderer.firstFrameDoneAt > 0 && !document.querySelector("#loading:not(.done)")'}`,
      180_000,
    );
    this.lastLoadMs = performance.now() - t0;
    // (the frame rate shown in its corner, the game's own meter — on every run, the screenshots too: who watches
    // sees how the test runs; a player's preference, kept across scenes. Not when the page failed to start)
    if (!startupFailure) await this.js("(__bh.settings.showFps = true, true)").catch(() => {});
    // (in the sun: a craft put over the Earth or someone set on foot there by a test that chose no date — at night or
    // with the sun low there — is put there at 11:00 local solar time of the same day; a date the test sets is its own
    // from then on. E2E_DAYLIGHT=0: the scene's clock as it is)
    if (!startupFailure && process.env.E2E_DAYLIGHT !== "0") {
      await this.js(DAYLIGHT).catch(() => {});
      // (a page booted on the station's scene: set again at a sunlit now — its first image in the Earth's shadow else
      // one time in three)
      if (/docking to the ISS/.test(decodeURIComponent(hash)))
        await this.js(`(() => { const ms = window.__e2eSunlitIss?.(); if (ms === null || ms === undefined || ms - Date.now() < 60e3) return 0;
          __bh.preset("Earth: docking to the ISS"); return 1; })()`).catch(() => {});
    }
    if (this.recorded && !startupFailure) await recorder.attach(this, this.file).catch((e) => console.error(`e2e telemetry: ${e}`));
    // (the scene's own ray tracer compiled before the test begins — not its stale first image)
    if (!startupFailure) await this.settled(120_000);
    await Bun.sleep(1500);
  }

  close() {
    recorder.detach(this);
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
    // (no nativeVirtualKeyCode: on macOS CDP reads it as a Mac key code — the Windows codes passed there were other
    // keys to Chrome, which acted on them when the page let a key through: an Escape in TARS's field opened
    // chrome://settings/help, the game's tab hidden behind it, its frames stopped)
    const ev = { code, key: k, windowsVirtualKeyCode: vk(code), modifiers: o.shift ? 8 : 0 };
    await this.cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...ev, text });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev });
    await Bun.sleep(60);
  }

  /** A key held down for a while (`during` runs while it is down: a push-to-talk's words), then released. */
  async hold(code: string, ms: number, during?: () => Promise<void>) {
    const ev = { code, key: code, windowsVirtualKeyCode: vk(code), modifiers: 0 };
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

  /** The element's centre, proven to receive the pointer there (else: the elements in the way) — tried again for up to
   *  3 s: a page still sliding in (a menu's transition, 9 frames a second on the mini) is not yet under the pointer; an
   *  overlay that swallows it for good still fails. */
  async hit(selector: string): Promise<{ x: number; y: number }> {
    const until = performance.now() + 3000;
    for (;;) {
      try {
        return await this.hitOnce(selector);
      } catch (e) {
        if (performance.now() > until) throw e;
        await Bun.sleep(150);
      }
    }
  }

  private async hitOnce(selector: string): Promise<{ x: number; y: number }> {
    const r = await this.js<{ ok: boolean; x: number; y: number; stack: string[] }>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, x: 0, y: 0, stack: ["(absent)"] };
      // (out of its scrolled box's view — a long panel's card —: scrolled to, as a player would)
      const b0 = el.getBoundingClientRect();
      // (… or in view but under its panel's own bar — a long list's row beneath the controls screen's buttons —: scrolled
      // to the middle too)
      const top0 = document.elementFromPoint(b0.left + b0.width / 2, b0.top + b0.height / 2);
      const covered = !!top0 && top0 !== el && !el.contains(top0);
      if (b0.bottom > innerHeight || b0.top < 0 || covered) el.scrollIntoView({ block: "center", behavior: "instant" });
      const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      const top = document.elementFromPoint(x, y);
      const d = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).join(".") : "");
      return { ok: b.width > 0 && !!top && (top === el || el.contains(top)), x, y, stack: document.elementsFromPoint(x, y).slice(0, 5).map(d) };
    })()`);
    if (!r.ok) throw new Error(`${selector} is not clickable: ${r.stack.join(" > ")}`);
    return r;
  }

  /**
   * A real mouse click at the element's centre. A bar action that does not fit the window's width is in the top
   * bar's ⋯ menu (ui/topbar.ts): the menu opens by a click on ⋯, and the action is clicked there.
   */
  async click(selector: string, tries = 3): Promise<void> {
    const action = await this.js<string | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el && el.classList.contains("tb-over") ? el.id : null;
    })()`);
    if (action) {
      if (await this.js<boolean>(`document.querySelector(".tb-menu").hidden`)) await this.click("[data-testid=topbar-more]");
      // (the bar laid out again meanwhile — a mode's buttons shown, a chip's text —: the button back in it, not in
      // the menu any more; the menu closed and the button looked for again)
      const inMenu = await this.js<boolean>(`!!document.querySelector('.tb-menu [data-action="${action}"]')`);
      if (!inMenu && tries > 0) {
        await this.js(
          `(() => { const m = document.querySelector(".tb-menu"); if (m && !m.hidden) document.querySelector("[data-testid=topbar-more]")?.click(); return 1; })()`,
        );
        await Bun.sleep(150);
        return this.click(selector, tries - 1);
      }
      await this.click(`.tb-menu [data-action="${action}"]`);
      return;
    }
    // (aimed at a still target: the top bar is centred, its buttons slide when its content's width changes — a
    // chip's text, a clock —; aimed once, the press could land on the neighbour (the mini: Place pressed, the
    // sky chart opened))
    let { x, y } = await this.hit(selector);
    for (let k = 0; k < 10; k++) {
      await Bun.sleep(40);
      const again = await this.hit(selector);
      if (Math.abs(again.x - x) < 1 && Math.abs(again.y - y) < 1) break;
      ({ x, y } = again);
    }
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

  /** Waits for the scene's own ray tracer — renderer.tracerSettled: compiled, none compiling ahead, the
   *  "Compiling the ray tracer" pill down —, then three frames drawn with it, so its image is the one on screen. */
  async settled(timeoutMs = 180_000) {
    const ok = await this.waitFor("__bh.renderer.tracerSettled", timeoutMs).then(
      () => true,
      () => false,
    );
    if (!ok) console.error("e2e: the scene's ray tracer still compiling — looked at anyway");
    await this.js(
      "new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r(1) : requestAnimationFrame(f)); requestAnimationFrame(f); })",
    );
  }

  /** A screenshot — once the scene's ray tracer is compiled (settled): never the stale image the pill covers. */
  async shot(file: string) {
    if (!this.entry) await this.settled();
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
