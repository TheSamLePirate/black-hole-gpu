import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// TARS's orbs (ui/tars/orb.ts): every one of his animations a thinking orb. His state set on his console
// (__bh.tars.panel), each shown — the console's head, the top bar, the presence pill while closed — and the small
// marks of what runs (a step, his wait, a sub-agent, a to-do, the microphone listening). Screenshots in
// docs/progress/tars-orbs/ (the whole view, and the orbs zoomed). Their loop: idle when none is moving on screen.

const DIR = "docs/progress/tars-orbs";
const STATES = ["idle", "listening", "thinking", "acting", "speaking", "error"] as const;

describe.skipIf(!E2E)("TARS's orbs", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(DIR, { recursive: true });
    // (a Retina screen's pixels: the orbs as most players see them)
    const o = { width: 1440, height: 900, dpr: 2, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: false };
    app = await App.boot(o);
    await app.js(`(__bh.freeze(true), __bh.settings.ship = false, __bh.touch(), true)`);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** a region of the page, zoomed */
  const zoom = async (file: string, sel: string, pad = 6, scale = 2) => {
    const r = await app.js<{ x: number; y: number; w: number; h: number } | null>(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    expect(r).not.toBeNull();
    const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      clip: { x: Math.max(0, r!.x - pad), y: Math.max(0, r!.y - pad), width: r!.w + 2 * pad, height: r!.h + 2 * pad, scale },
    });
    await Bun.write(`${DIR}/${file}`, Buffer.from(shot.data, "base64"));
  };
  /** the whole view (a JPEG at 1440 × 900: the repository's weight; the zooms are at the screen's pixels) */
  const view = async (file: string) => {
    await app.settled();
    const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: 85,
      clip: { x: 0, y: 0, width: 1440, height: 900, scale: 0.5 },
    });
    await Bun.write(`${DIR}/${file}`, Buffer.from(shot.data, "base64"));
  };
  const frames = (n = 20) =>
    app.js(`new Promise((r) => { let n = 0; const f = () => (++n >= ${n} ? r(1) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);

  test("his orb in each state: the console's head, the top bar, the presence", async () => {
    // (a voice's level that moves, for listening and speaking)
    await app.js(`(__bh.tars.panel.levels(() => 0.5 + 0.5 * Math.sin(performance.now() / 120), () => false), true)`);
    for (const [i, s] of STATES.entries()) {
      await app.js(`(__bh.tars.panel.show(), __bh.tars.panel.setState(${JSON.stringify(s)}), true)`);
      await frames();
      const st = await app.js<{ head: string; top: string; drawn: boolean }>(`(() => {
        const head = document.querySelector(".tp-head .tars-orb"), top = document.querySelector(".tb-tars .tars-orb");
        // (drawn: some pixel lit on the head's canvas)
        const d = head.getContext("2d").getImageData(0, 0, head.width, head.height).data;
        let lit = false; for (let k = 3; k < d.length; k += 4) if (d[k] > 40) { lit = true; break; }
        return { head: head.dataset.state, top: top.dataset.state, drawn: lit };
      })()`);
      expect(st).toEqual({ head: s, top: s, drawn: true });
      await view(`${i + 1}-${s}.jpg`);
      await zoom(`${i + 1}-${s}-console.png`, ".tp-head", 8, 1.5);
      await zoom(`${i + 1}-${s}-topbar.png`, ".tb-tars", 4, 3);
      if (s !== "idle") {
        await app.js(`(__bh.tars.panel.close(), true)`);
        await frames();
        await zoom(`${i + 1}-${s}-presence.png`, ".tars-presence", 6, 2);
      }
    }
  }, 120_000);

  test("the marks of what runs: a step, his wait, a sub-agent, a to-do, the microphone", async () => {
    await app.js(`(() => {
      const p = __bh.tars.panel;
      p.show(); p.setState("acting");
      p.exchange("Où en est-on ?");
      p.begin("get_state", {});
      p.action("ok", true, "ok", "get_state");
      p.begin("autopilot", { mode: "prograde" });
      p.progress("Waiting for the burn — 42 s");
      p.todos([{ text: "Read the situation", status: "done" }, { text: "Plan the burn", status: "active" }, { text: "Report", status: "pending" }]);
      p.listening(true);
      return true;
    })()`);
    await frames();
    const marks = await app.js<number>(`document.querySelectorAll(".tars-panel .tars-orb").length`);
    expect(marks).toBeGreaterThanOrEqual(5);
    await view("7-marks.jpg");
    await zoom("7-marks-console.png", ".tars-panel", 4, 1);
    await app.js(`(() => {
      const p = __bh.tars.panel;
      p.listening(false);
      p.subagent({ name: "scout", state: "running", line: "Looking at the weather at Edwards" });
      p.subagent({ name: "planner", state: "done", line: "Burn of 12 m/s at the apoapsis" });
      document.querySelector('[data-testid="tars-tab-agents"]').click();
      return true;
    })()`);
    await frames();
    await zoom("8-subagents.png", ".tars-panel", 4, 1);
  }, 60_000);

  test("the bar hidden: his orb in its handle", async () => {
    // (the frame-rate meter off: it sits over the handle)
    await app.js(`(__bh.settings.showFps = false, __bh.tars.panel.setState("thinking"), __bh.tars.panel.close(), true)`);
    await app.click('[data-testid="topbar-hide"]');
    await frames();
    await zoom("9-handle-thinking.png", '[data-testid="topbar-handle"]', 4, 3);
    await app.click('[data-testid="topbar-handle"]');
  }, 30_000);
});
