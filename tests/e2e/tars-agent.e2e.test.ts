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
    // (the tools a mode allows, seen by the model)
    if (!msgs[0].content.includes("sub-agent of TARS")) window.__lastTools = (body.tools ?? []).map((t) => t.function.name);
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
    if (/Montre/.test(q)) {
      if (!tools.length)
        return reply({
          content: null,
          tool_calls: [
            call("c1", "show_chart", { title: "Altitude et vitesse", channels: ["alt", "speed"], seconds: 600 }),
            call("c2", "show_chart", { title: "Budget Δv", series: [{ label: "Δv", unit: "m/s", points: [[0, 3900], [1, 3100], [2, 800], [3, 0]] }], xLabel: "étape" }),
            call("c3", "show_card", { title: "Bilan", rows: [{ label: "Carburant", value: "60 %", tone: "good" }, { label: "Δv", value: "2,1 km/s", tone: "caution" }], note: "Assez pour la Lune." }),
            call("c4", "show_screen", { screen: "telemetry" }),
          ],
        });
      return reply({ content: "Voilà." });
    }
    if (/Propose/.test(q)) {
      if (!tools.length)
        return reply({
          content: null,
          tool_calls: [
            call("p1", "propose_plan", {
              title: "Cap sur Mars",
              summary: "Vise Mars puis accélère le temps.",
              steps: ["Viser Mars", "Temps ×100"],
              figures: [{ label: "Δv", value: "0 m/s" }],
            }),
          ],
        });
      return reply({ content: "Je vous propose ce plan." });
    }
    if (/J'accepte ton plan/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("e1", "set_target", { name: "Mars" }), call("e2", "time", { warp: 100 })] });
      return reply({ content: "Plan exécuté." });
    }
    if (/Fais la liste/.test(q)) {
      if (!tools.length)
        return reply({
          content: null,
          tool_calls: [call("t1", "update_todos", { items: [{ text: "Viser la Lune", status: "done" }, { text: "Planifier", status: "active" }, { text: "Exécuter", status: "pending" }] })],
        });
      return reply({ content: "Liste faite." });
    }
    // (a sub-agent's own request: its conclusion at once)
    if (msgs[0].content.includes("sub-agent of TARS")) return reply({ content: "Conclusion: " + q });
    if (/Surveille/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("s1", "schedule", { on: "every", minutes: 10, prompt: "Vérifie le carburant." })] });
      return reply({ content: "Réglé." });
    }
    if (/Analyse/.test(q)) {
      if (!tools.length)
        return reply({
          content: null,
          tool_calls: [call("a1", "spawn_agents", { tasks: [{ name: "carburant", question: "le carburant ?" }, { name: "mars", question: "le Δv vers Mars ?" }] })],
        });
      return reply({ content: "Analyses faites." });
    }
    if (/Télémétrie/.test(q)) {
      if (!tools.length) return reply({ content: null, tool_calls: [call("g1", "get_telemetry", { groups: ["attitude", "controls"] })] });
      window.__telemetry = JSON.parse(tools[0].content);
      return reply({ content: "Lue." });
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
    const steps = await app.js<{ tool: string; cls: string; what: string; res: string; title: string }[]>(
      `[...document.querySelectorAll("[data-testid=tars-actions] li")].map((l) => ({ tool: l.dataset.tool, cls: l.className, what: l.querySelector(".tp-what").textContent, res: l.querySelector(".tp-res")?.textContent ?? "", title: l.title }))`,
    );
    // (each step in words, its result after it, its whole line in the tooltip)
    expect(steps[0]).toMatchObject({ tool: "set_target", cls: "ok", what: "Cible · Mars", res: "Target: Mars" });
    // (the wind 9 refused by the schema: said to the model, which set 2 — the full line in the tooltip)
    expect(steps[1]).toMatchObject({ tool: "set_settings", cls: "ok", what: "Réglages" });
    expect(steps[1]!.title).toContain("wind must be one of");
    expect(steps[2]!.title).toContain('"wind":2');
    // (the exchange on the console: his words under the pilot's)
    expect(await app.js<string>(`document.querySelector(".tp-you").textContent`)).toBe("Vise Mars et mets un vent modéré.");
    expect(await app.js<string>(`document.querySelector(".tp-tars").textContent`)).toBe("Mars en cible, vent modéré.");
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
    // (the browser's recognition, faked here — not Deepgram's ear, which a key in .env would bring: tars-ear.e2e)
    await app.js(`(__bh.settings.tarsEar = "browser", true)`);
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

  test("his ear's key: the line in his console and under the setting; a key Deepgram refuses is not kept", async () => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    const line = () => app.js<string>(`document.querySelector("[data-testid=tars-ear-key]").textContent`);
    expect(await line()).toMatch(/Deepgram/);
    await app.click("[data-testid=tars-ear-key] [data-testid=ek-paste], [data-testid=tars-ear-key] [data-testid=ek-change]");
    await app.click("[data-testid=tars-ear-key] [data-testid=ek-input]");
    await app.type("abcdefabcdefabcdefabcdefabcdef0123456789");
    await app.press("Enter");
    await app.waitFor(`document.querySelector("[data-testid=tars-ear-key]").textContent.includes("refuse")`, 15_000);
    expect(await app.js<string | null>(`localStorage.getItem("kerr.deepgram.key")`)).toBeNull();
    // (not a key's shape: said at once)
    await app.click("[data-testid=tars-ear-key] [data-testid=ek-paste], [data-testid=tars-ear-key] [data-testid=ek-change]");
    await app.click("[data-testid=tars-ear-key] [data-testid=ek-input]");
    await app.type("abc");
    await app.press("Enter");
    await app.waitFor(`document.querySelector("[data-testid=tars-ear-key]").textContent.includes("pas une clé Deepgram")`, 5_000);
    // (back to his field for what follows)
    await app.click("[data-testid=tars-input]");
  }, 60_000);

  test("offline: the common orders run by the same tools (A4)", async () => {
    await app.js(`(__bh.settings.tarsOnline = false, true)`);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type("Vise Jupiter et passe le temps à 10 fois.");
    await app.press("Enter");
    await app.waitFor(`String(__bh.settings.target) === "jupiter"`, 5_000);
    expect(Math.round(await app.js<number>(`__bh.settings.timeSpeed * 4.925490947e-6 * __bh.settings.massSolar`))).toBe(10);
    const steps = await app.js<{ tool: string; cls: string; what: string }[]>(
      `[...document.querySelectorAll("[data-testid=tars-actions] li")].map((l) => ({ tool: l.dataset.tool, cls: l.className, what: l.querySelector(".tp-what").textContent, res: l.querySelector(".tp-res")?.textContent ?? "", title: l.title }))`,
    );
    expect(steps[0]).toMatchObject({ tool: "set_target", cls: "ok", what: "Cible · jupiter" });
    expect(steps[1]).toMatchObject({ tool: "time", cls: "ok", what: "Temps · 10" });
    await app.waitFor(`__bh.voice.said.some((l) => l.speaker === "tars" && l.text === "C'est fait, tout.")`, 10_000);
    await app.js(`(__bh.settings.tarsOnline = true, true)`);
  }, 30_000);

  test("he shows: live charts, a chart of his own, a card of figures, a real screen (A8)", async () => {
    await app.js(`(__bh.tars.memory.clear(), true)`);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type("Montre-moi l'altitude, le budget et la télémétrie.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Voilà."`, 15_000);
    const cards = await app.js<{ kind: string; title: string }[]>(
      `[...document.querySelectorAll("[data-testid=tars-card]")].map((c) => ({ kind: c.dataset.kind, title: c.querySelector("h3").textContent }))`,
    );
    // (three at most, the newest on top)
    expect(cards).toEqual([
      { kind: "data", title: "Bilan" },
      { kind: "chart", title: "Budget Δv" },
      { kind: "chart", title: "Altitude et vitesse" },
    ]);
    expect(
      await app.js<string>(`document.querySelector("[data-testid=tars-card][data-kind=data] dd[data-tone=caution]").textContent`),
    ).toBe("2,1 km/s");
    // (a chart drawn: its canvas not blank)
    expect(
      await app.js<boolean>(
        `(() => { const cv = document.querySelectorAll("[data-testid=tars-card] canvas")[0]; const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })()`,
      ),
    ).toBe(true);
    // (the real screen: the map and its tablet on the telemetry page)
    await app.waitFor(`!!document.querySelector("[data-testid=telemetry-page]")?.offsetParent`, 5_000);
    // (closed by its ×)
    await app.click("[data-testid=tars-card] .tc-x");
    await app.waitFor(`document.querySelectorAll("[data-testid=tars-card]").length === 2`, 3_000);
  }, 60_000);

  test("a plan proposed: nothing done until accepted, then carried out; refused, dropped", async () => {
    await app.js(`(__bh.settings.target = "moon", __bh.game.target("moon"), true)`);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type("Propose-moi un plan pour aller vers Mars.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Je vous propose ce plan."`, 15_000);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-proposal]").hidden`)).toBe(false);
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-proposal] h3").textContent`)).toBe("Cap sur Mars");
    expect(await app.js<string[]>(`[...document.querySelectorAll(".tp-steps li")].map((l) => l.textContent)`)).toEqual([
      "Viser Mars",
      "Temps ×100",
    ]);
    // (nothing done yet)
    expect(await app.js<string>(`String(__bh.settings.target)`)).toBe("moon");
    await app.click("[data-testid=tars-accept]");
    await app.waitFor(`__bh.tars.agent.lastText === "Plan exécuté."`, 15_000);
    expect(await app.js<string>(`String(__bh.settings.target)`)).toBe("mars");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-proposal]").hidden`)).toBe(true);
    // (another, refused by the words)
    await app.type("Propose-moi un plan pour aller vers Mars.");
    await app.press("Enter");
    await app.waitFor(`!document.querySelector("[data-testid=tars-proposal]").hidden && !__bh.tars.agent.busy`, 15_000);
    await app.type("non");
    await app.press("Enter");
    await app.waitFor(`document.querySelector("[data-testid=tars-proposal]").hidden`, 5_000);
    expect(await app.js<string>(`document.querySelector(".tp-tars").textContent`)).toBe("Compris. Plan abandonné.");
  }, 60_000);

  test("closed while he works: his presence shows what he does", async () => {
    if (!(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`))) await app.press("F6", "F6");
    await app.js(`(__bh.tars.agent.ask("Attends qu'on soit posés."), true)`);
    await app.waitFor(`!document.querySelector("[data-testid=tars-presence]").hidden`, 5_000);
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-presence]").dataset.state`)).toMatch(/thinking|acting/);
    await app.js(`(__bh.tars.agent.stop(), true)`);
    await app.waitFor(`!__bh.tars.agent.busy`, 5_000);
  }, 30_000);

  test("the agent's console: its grip moves it (its place kept), its tabs; his wakings, a rule he sets; sub-agents; telemetry (B1–B6)", async () => {
    await app.js(`(__bh.settings.tarsOnline = true, true)`);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    // (the grip, dragged: the console follows, its place kept)
    const g = await app.hit("[data-testid=tars-grip]");
    await app.mouse("move", g.x, g.y);
    await app.mouse("down", g.x, g.y);
    for (let i = 1; i <= 5; i++) await app.mouse("move", g.x - 60 * i, g.y - 40 * i);
    await app.mouse("up", g.x - 300, g.y - 200);
    const moved = await app.js<{ floating: boolean; kept: { x: number; y: number } }>(
      `({ floating: document.querySelector("[data-testid=tars-panel]").classList.contains("floating"), kept: JSON.parse(localStorage.getItem("kerr.tars.console")) })`,
    );
    expect(moved.floating).toBe(true);
    expect(moved.kept.x).toBeGreaterThan(0);
    // (a rule he sets himself, listed with his reflexes)
    await app.type("Surveille le carburant toutes les 10 minutes.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Réglé."`, 15_000);
    await app.click("[data-testid=tars-tab-wakes]");
    const rules = await app.js<string[]>(`[...document.querySelectorAll("[data-testid=tars-rule]")].map((r) => r.dataset.id)`);
    // (his reflexes: the autopilot's end, the entry, a warning, a deviation, an eclipse, a report)
    expect(rules.filter((r) => r.startsWith("reflex-")).length).toBe(6);
    expect(rules.length).toBe(7);
    // (sub-agents, in parallel, shown at work then done)
    await app.click("[data-testid=tars-tab-talk]");
    await app.type("Analyse le carburant et Mars en parallèle.");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Analyses faites."`, 15_000);
    const subs = await app.js<string[]>(
      `[...document.querySelectorAll("[data-testid=tars-sub]")].map((s) => s.className + " " + s.textContent)`,
    );
    expect(subs.length).toBe(2);
    expect(subs.every((s) => s.includes("done") && s.includes("Conclusion"))).toBe(true);
    // (the telemetry: the attitude, the controls)
    await app.click("[data-testid=tars-tab-talk]");
    await app.type("Télémétrie ?");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Lue."`, 15_000);
    const tm = await app.js<{ attitude?: { bankDeg?: number }; controls?: { sas?: boolean } }>(`window.__telemetry`);
    expect(typeof tm.attitude?.bankDeg).toBe("number");
    expect(typeof tm.controls?.sas).toBe("boolean");
  }, 90_000);

  test("the field: / and @ completed, the mode (Shift+Tab, /mode), /help, ↑ the history, his task list, a skill kept and run (C1–C5)", async () => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.click("[data-testid=tars-tab-talk]");
    const sug = () => app.js<string[]>(`[...document.querySelectorAll("[data-testid=tars-suggest] li b")].map((b) => b.textContent)`);
    // ("/mo": model, mode, the Moon's way; ↓ then Tab takes mode; its values; Enter on "plan")
    await app.type("/mo");
    expect(await sug()).toEqual(["/model <modèle>", "/mode act|plan|watch", "/moonpath <mode> <date>"]);
    await app.press("ArrowDown", "ArrowDown");
    await app.press("Tab", "Tab");
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-input]").value`)).toBe("/mode ");
    await app.type("pl");
    expect(await sug()).toEqual(["plan"]);
    await app.press("Enter");
    await app.waitFor(`document.querySelector("[data-testid=tars-mode]").dataset.mode === "plan"`, 3_000);
    // (in plan mode his acting tools are gone)
    await app.type("Fais la liste");
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.lastText === "Liste faite."`, 15_000);
    const tools = await app.js<string[]>(`window.__lastTools`);
    expect(tools).toContain("propose_plan");
    expect(tools).not.toContain("autopilot");
    expect(await app.js<string[]>(`[...document.querySelectorAll("[data-testid=tars-todos] li")].map((l) => l.className)`)).toEqual([
      "done",
      "active",
      "pending",
    ]);
    // (Shift+Tab: observe; again: act)
    await app.press("Tab", "Tab", { shift: true });
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-mode]").dataset.mode`)).toBe("watch");
    await app.press("Tab", "Tab", { shift: true });
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-mode]").dataset.mode`)).toBe("act");
    // ("@lu": the Moon)
    await app.type("vise @lu");
    expect(await sug()).toContain("Lune");
    await app.press("Tab", "Tab");
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-input]").value`)).toBe("vise @Lune ");
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
    // (/help: a card of the commands)
    await app.type("/help");
    await app.press("Enter");
    await app.waitFor(
      `[...document.querySelectorAll("[data-testid=tars-card] h3")].some((h) => h.textContent === "Commandes de TARS")`,
      3_000,
    );
    // (↑: the last question again)
    await app.press("ArrowUp", "ArrowUp");
    expect(await app.js<string>(`document.querySelector("[data-testid=tars-input]").value`)).toBe("/help");
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
    // (a skill: the last request kept, run by its name, offered by the completion)
    await app.type("/skill save liste");
    await app.press("Enter");
    await app.type("/lis");
    expect(await sug()).toContain("/liste");
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "/liste", true)`);
    await app.press("Enter");
    await app.waitFor(
      `__bh.tars.agent.lastText === "Liste faite." && document.querySelector(".tp-you").textContent === "★ /liste"`,
      15_000,
    );
  }, 90_000);

  test("every game action as a / command, run at once, completed as typed (C6)", async () => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    const sug = () => app.js<string[]>(`[...document.querySelectorAll("[data-testid=tars-suggest] li b")].map((b) => b.textContent)`);
    const value = () => app.js<string>(`document.querySelector("[data-testid=tars-input]").value`);
    const run = async (line: string) => {
      await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
      await app.type(line);
      // (a whole line: Enter sends it, its completion already as typed)
      await app.press("Enter");
      await Bun.sleep(400);
    };
    const calls = await app.js<number>(`window.__or.length`);
    // (the view, by its own command)
    await run("/cockpit");
    expect(await app.js<string>(`__bh.settings.shipMount`)).toBe("cockpit");
    // (the target: completed, then run)
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
    await app.type("/target Ma");
    expect(await sug()).toContain("Mars");
    await app.press("Tab", "Tab");
    expect(await value()).toBe("/target Mars ");
    await app.press("Enter");
    await app.waitFor(`String(__bh.settings.target) === "mars"`, 3_000);
    // (a teleport: its mode and place completed)
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
    await app.type("/teleport orbit Lu");
    expect(await sug()).toContain("Lune");
    await run("/teleport orbit Lune 100");
    await app.waitFor(`__bh.game.status().soi === "moon"`, 5_000);
    // (a setting, the time, any tool by name)
    await run("/set music off");
    expect(await app.js<boolean>(`__bh.settings.music`)).toBe(false);
    await run("/warp 100");
    expect(Math.round(await app.js<number>(`__bh.settings.timeSpeed * 4.925490947e-6 * __bh.settings.massSolar`))).toBe(100);
    await run("/tool camera shipView=true mount=chase");
    expect(await app.js<string>(`__bh.settings.shipMount`)).toBe("chase");
    // (a reading: its card)
    await run("/places Lune");
    expect(
      await app.js<boolean>(`[...document.querySelectorAll("[data-testid=tars-card] h3")].some((h) => h.textContent === "/places Lune")`),
    ).toBe(true);
    // (none of them asked the model)
    expect(await app.js<number>(`window.__or.length`)).toBe(calls);
  }, 60_000);
});
