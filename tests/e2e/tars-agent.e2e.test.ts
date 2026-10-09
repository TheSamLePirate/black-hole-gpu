import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS-AGENT A3: TARS the agent in the game, the model simulated in the page (openrouter.ai answered by a
// script: tool calls, then words). Real typing in his field: his calls run on the game (the target, the
// gear, a setting refused then corrected), shown as they happen (✓ / ✗), his words said; Escape stopping a
// turn that waits; his memory kept across a reload, then cleared by its button; F6 held: spoken words (A5).

const MODEL = `(() => {
  window.__or = [];
  const real = window.fetch.bind(window);
  const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  window.fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith("https://openrouter.ai/")) return real(url, init);
    const body = init?.body ? JSON.parse(init.body) : null;
    window.__or.push({ u, body });
    if (!u.endsWith("/chat/completions")) return Response.json({ answers: { speak: { type: "noul", noul: 0 } } });
    const msgs = body.messages;
    const q = [...msgs].reverse().find((m) => m.role === "user").content.split("Pilot: ").at(-1);
    const tools = msgs.filter((m) => m.role === "tool");
    const reply = (m) => Response.json({ choices: [{ message: m }], usage: { cost: 0.0001 } });
    if (/Vise Mars/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("a", "set_target", { name: "Mars" }), call("b", "set_settings", { changes: [{ key: "wind", value: "9" }] })] });
      if (tools.length === 2) return reply({ content: null, tool_calls: [call("c", "set_settings", { changes: [{ key: "wind", value: "2" }] })] });
      return reply({ content: "Mars en cible, vent modéré." });
    }
    if (/Attends/.test(q)) {
      if (!tools.length) return reply({ content: "J'attends.", tool_calls: [call("w", "wait", { until: "landed", maxSeconds: 600 })] });
      return reply({ content: "Fini d'attendre." });
    }
    if (/Cooper/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("m", "memory", { action: "remember", note: "Le pilote s'appelle Cooper" })] });
      return reply({ content: "Noté, Cooper." });
    }
    return reply({ content: "Rien à signaler." });
  };
  return true;
})()`;

describe.skipIf(!E2E)("TARS the agent", () => {
  let app: App;
  const openField = async () => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
  };
  const boot = async () => {
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.voice = false, __bh.settings.tarsRemarks = false, true)`);
    await app.js(MODEL);
  };
  beforeAll(async () => {
    app = await App.boot({
      width: 1280,
      height: 800,
      lang: "fr",
      hash: "scene=game:artemis",
      // (the browser's speech recognition stood in for: the words given by the test while the key is held)
      initScript: `window.SpeechRecognition = class { constructor() { window.__rec = this; } start() { this.on = true; } stop() { this.on = false; setTimeout(() => this.onend && this.onend(), 30); } abort() {} };
      try { if (!sessionStorage.getItem("booted")) { sessionStorage.setItem("booted", "1"); localStorage.setItem("kerr.openrouter.key", "sk-or-v1-simulated000000042"); localStorage.removeItem("kerr.tars.memory"); } } catch {}`,
    });
    await boot();
  }, 240_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("an order: his calls run on the game, an error corrected, shown as they happen; his words said", async () => {
    await openField();
    await app.type("Vise Mars et mets un vent modéré.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Mars en cible, vent modéré."`, 15_000);
    expect(await app.js<string>(`String(__bh.settings.target)`)).toBe("mars");
    expect(await app.js<number>(`__bh.settings.wind`)).toBe(2);
    const lines = await app.js<string[]>(`[...document.querySelectorAll("[data-testid=tars-actions] li")].map((l) => l.textContent)`);
    expect(lines[0]).toBe("✓ set_target · Mars → Target: Mars");
    // (the wind 9 refused by the schema: said to the model, which set 2 — the full line in the tooltip)
    expect(lines[1]).toMatch(/^✓ set_settings · \[\{"key":"wind","value":"9"\}\]/);
    expect(await app.js<string>(`document.querySelectorAll("[data-testid=tars-actions] li")[1].title`)).toContain("wind must be one of");
    expect(await app.js<string>(`document.querySelectorAll("[data-testid=tars-actions] li")[2].title`)).toContain('"wind":2');
    await app.waitFor(`__bh.voice.said.some((l) => l.speaker === "tars" && l.text === "Mars en cible, vent modéré.")`, 15_000);
    // (the agent's request: the tools, the model of the setting, the flight data)
    const req = await app.js<{ model: string; tools: string[]; user: string }>(
      `(() => { const r = window.__or.find((x) => x.u.endsWith("/chat/completions")); return { model: r.body.model, tools: r.body.tools.map((t) => t.function.name), user: r.body.messages.at(-1).content }; })()`,
    );
    expect(req.model).toBe("z-ai/glm-5.3-flash");
    expect(req.tools).toContain("plan_mission");
    expect(req.tools).toContain("press_key");
    expect(req.tools.length).toBeGreaterThan(25);
    expect(req.user).toContain("Pilot: Vise Mars");
  }, 60_000);

  test("Escape, or the word stop, stops a turn that waits", async () => {
    await openField();
    for (const how of ["escape", "word"]) {
      await app.type("Attends qu'on soit posés.");
      await app.press("Enter");
      await app.waitFor(`__bh.tars.agent.busy`, 10_000);
      await Bun.sleep(800);
      expect(await app.js<string>(`document.querySelector("[data-testid=tars-link]").textContent`)).toContain("Échap");
      // (Escape given to the field itself: through CDP it would also leave the browser's full screen, the page
      // hidden — its frames held)
      if (how === "escape")
        await app.js(
          `(document.querySelector("[data-testid=tars-input]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })), true)`,
        );
      else {
        await app.type("stop");
        await app.press("Enter");
      }
      await app.waitFor(`!__bh.tars.agent.busy`, 5_000);
      expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)).toBe(false);
    }
  }, 60_000);

  test("his memory: kept across a reload, then cleared", async () => {
    await openField();
    await app.type("Je m'appelle Cooper.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Noté, Cooper."`, 15_000);
    expect(await app.js<string[]>(`__bh.tars.memory.notes`)).toEqual(["Le pilote s'appelle Cooper"]);
    // (a new visit: the same memory, its count under his field)
    await app.load("scene=game:artemis");
    await boot();
    expect(await app.js<number>(`__bh.tars.memory.turns.length`)).toBe(4);
    expect(await app.js<string[]>(`__bh.tars.memory.notes`)).toEqual(["Le pilote s'appelle Cooper"]);
    await openField();
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-memory]").textContent`)).toBe(
      "mémoire : 4 échanges · notes : 1",
    );
    // (his next question carries what he remembers)
    await app.type("Ça va ?");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Rien à signaler."`, 15_000);
    const sent = await app.js<string>(`JSON.stringify(window.__or.at(-1).body.messages)`);
    expect(sent).toContain("- Le pilote s'appelle Cooper");
    expect(sent).toContain("Vise Mars et mets un vent modéré.");
    await app.click("[data-testid=tars-clear]");
    expect(await app.js<boolean>(`__bh.tars.memory.empty`)).toBe(true);
    expect(await app.js<string | null>(`localStorage.getItem("kerr.tars.memory")`)).toBeNull();
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=tars-memory]")`)).toBe(false);
  }, 240_000);

  test("push-to-talk: F6 held listens, the words shown, released they are asked; tapped, the field", async () => {
    if (!(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`))) await app.press("F6", "F6");
    await app.hold("F6", 600, async () => {
      expect(
        await app.js<boolean>(`!!window.__rec?.on && document.querySelector("[data-testid=tars-panel]").classList.contains("listening")`),
      ).toBe(true);
      await app.js(
        `(window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "Ça va " }], { isFinal: true }), Object.assign([{ transcript: "là-haut ?" }], { isFinal: false })] }), true)`,
      );
      expect(await app.js<string>(`document.querySelector("[data-testid=tars-input]").value`)).toBe("Ça va là-haut ?");
    });
    await app.waitFor(
      `__bh.tars.agent.lastText === "Rien à signaler." && __bh.tars.memory.turns.at(-1)?.user === "Ça va là-haut ?"`,
      15_000,
    );
    expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").classList.contains("listening")`)).toBe(false);
    // (a tap: the field toggles, nothing heard)
    const before = await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`);
    await app.press("F6", "F6");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)).toBe(!before);
  }, 60_000);

  test("offline: the common orders run by the same tools (A4)", async () => {
    await app.js(`(__bh.settings.tarsOnline = false, true)`);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type("Vise Jupiter et passe le temps à 10 fois.");
    await app.press("Enter");
    await app.waitFor(`String(__bh.settings.target) === "jupiter"`, 5_000);
    expect(Math.round(await app.js<number>(`__bh.settings.timeSpeed * 4.925490947e-6 * __bh.settings.massSolar`))).toBe(10);
    const lines = await app.js<string[]>(`[...document.querySelectorAll("[data-testid=tars-actions] li")].map((l) => l.textContent)`);
    expect(lines[0]).toMatch(/^✓ set_target · jupiter/);
    expect(lines[1]).toMatch(/^✓ time · 10/);
    await app.waitFor(`__bh.voice.said.some((l) => l.speaker === "tars" && l.text === "C'est fait, tout.")`, 10_000);
    await app.js(`(__bh.settings.tarsOnline = true, true)`);
  }, 30_000);
});
