import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { contrast } from "./lib/contrast";

// The interface's transverse checks (audit §16.7, wave S5): every visible text readable over the
// worst view behind it (T7), the controls without a test id only fewer (T9, a ratchet), no leak
// across 30 openings (T4), and every size and density laid out (T6).

/** The bright accretion disc: the worst view behind the interface (audit §13.4). */
const DISC: [number, number, number] = [230, 170, 110];
const RATCHET = new URL("./golden/testid-ratchet.json", import.meta.url).pathname;

/** The visible controls without a data-testid, as "tag.class: name" (each counted once per state). */
const UNTESTED = `(() => [...document.querySelectorAll("button, input, select, textarea")]
  .filter((e) => e.getClientRects().length && e.type !== "hidden" && !e.closest("[data-testid]") && !e.dataset.testid)
  .map((e) => e.tagName.toLowerCase() + "." + [...e.classList].slice(0, 2).join(".") + ": " + (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 20)))()`;

describe.skipIf(!E2E)("s5: the interface for every eye, size and session", () => {
  let app: App;
  const untested: Record<string, number> = {};
  const look = async (state: string) => {
    expect({ state, bad: await app.js<string[]>(contrast(DISC)) }).toEqual({ state, bad: [] });
    untested[state] = (await app.js<string[]>(UNTESTED)).length;
  };

  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await Bun.sleep(1500);
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("T7: every visible text readable over the bright disc (WCAG AA)", async () => {
    await look("flight");
    await app.press("KeyM");
    await Bun.sleep(1200);
    await look("map");
    await app.press("KeyM");
    await app.press("Escape");
    await Bun.sleep(600);
    await look("pause");
    await app.click("[data-testid=pause-controls]");
    await Bun.sleep(500);
    await look("controls");
    await app.press("Escape");
    await Bun.sleep(300);
    await app.press("Escape");
    await Bun.sleep(300);
    await app.press("KeyK", "K", { shift: true });
    await app.waitFor("!__bh.camera.piloting");
    await Bun.sleep(600);
    await look("foot");
    for (const [state, opener] of [
      ["settings", ".sp-opener"],
      ["camera", "#btn-camera"],
      ["sky", "#btn-sky"],
      ["scenes", "#btn-scenes"],
      ["help", "#btn-help"],
    ] as const) {
      await app.click(opener);
      await Bun.sleep(700);
      await look(state);
      await app.press("Escape");
      await Bun.sleep(300);
    }
  });

  test("T9: the controls without a data-testid are only ever fewer (a ratchet)", async () => {
    if (process.env.RATCHET === "update" || !(await Bun.file(RATCHET).exists()))
      await Bun.write(RATCHET, `${JSON.stringify(untested, null, 1)}\n`);
    const base: Record<string, number> = await Bun.file(RATCHET).json();
    for (const [state, n] of Object.entries(untested)) {
      expect({ state, n: Math.min(n, base[state] ?? n) }).toEqual({ state, n });
      if (n < (base[state] ?? n)) console.log(`ratchet: ${state} ${base[state]} → ${n} (RATCHET=update to lower it)`);
    }
  });

  test("T4: 30 openings of the settings and the pause leak neither nodes nor listeners", async () => {
    const counters = async () => {
      await app.cdp.send("HeapProfiler.collectGarbage");
      return app.cdp.send<{ nodes: number; jsEventListeners: number }>("Memory.getDOMCounters");
    };
    const cycle = async () => {
      await app.click(".sp-opener");
      await Bun.sleep(80);
      await app.press("Escape");
      await app.press("Escape");
      await Bun.sleep(80);
      await app.press("Escape");
      await Bun.sleep(30);
    };
    // (a first round: what is made once — the panel's DOM, the pause menu — is not a leak)
    for (let i = 0; i < 3; i++) await cycle();
    const a = await counters();
    for (let i = 0; i < 30; i++) await cycle();
    const b = await counters();
    expect(b.nodes).toBeLessThanOrEqual(a.nodes * 1.02 + 50);
    expect(b.jsEventListeners).toBeLessThanOrEqual(a.jsEventListeners + 10);
  }, 120_000);

  test("T6: every size and density laid out — no sideways scroll, the toolbar within reach", async () => {
    const sizes: [number, number, number][] = [
      [1280, 720, 1],
      [2560, 1440, 1],
      [1440, 900, 2],
      [390, 844, 3],
      [844, 390, 3],
    ];
    for (const [w, h, dpr] of sizes) {
      await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: w < 900 });
      await Bun.sleep(700);
      const r = await app.js<{ sideways: boolean; canvas: boolean; out: string[] }>(`(() => {
        const cv = document.querySelector("#view"), b = cv.getBoundingClientRect();
        const out = [...document.querySelectorAll("#toolbar button, #tp-dock button")].filter((e) => e.getClientRects().length)
          .map((e) => e.getBoundingClientRect()).filter((q) => q.right > innerWidth + 1 || q.bottom > innerHeight + 1 || q.left < -1)
          .map((q) => Math.round(q.left) + "," + Math.round(q.top));
        return { sideways: document.documentElement.scrollWidth > innerWidth + 1, canvas: Math.abs(b.width - innerWidth) < 2 && Math.abs(b.height - innerHeight) < 2 && cv.width > 0, out };
      })()`);
      expect({ size: `${w}×${h}@${dpr}`, ...r }).toEqual({ size: `${w}×${h}@${dpr}`, sideways: false, canvas: true, out: [] });
    }
    await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
