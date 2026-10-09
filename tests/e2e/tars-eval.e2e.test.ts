import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS-AGENT A6: flights and tasks directed by TARS on the REAL OpenRouter (the owner's key from .env,
// never printed), each judged by the game's state — not by his words: a landing from a hover on the Moon, a
// docking to the station, the interface, a teleport undone, a plan proposed then accepted. TARS engages and
// answers; the game is then given its time (`settle`) to bring the outcome — judged then. Each turn's
// actions, words, time and cost written to remote-results/tars-eval-<model>.json. Only with TARS_LIVE=1 (a
// run costs about a cent); the long flights (a take-off to orbit, an entry to Edwards) with TARS_LONG=1 too.
//   TARS_LIVE=1 E2E=1 [TARS_MODEL=anthropic/claude-haiku-5.5] bun test tests/e2e/tars-eval.e2e.test.ts --timeout 7200000

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const LIVE = E2E && process.env.TARS_LIVE === "1" && /^sk-or-/.test(KEY);
const LONG = process.env.TARS_LONG === "1";
const MODEL = process.env.TARS_MODEL ?? "z-ai/glm-5.3-flash";

interface Run {
  task: string;
  ok: boolean;
  why: string;
  seconds: number;
  usd: number;
  actions: string[];
  said: string;
}

describe.skipIf(!LIVE)(`TARS directs the flight (${MODEL})`, () => {
  let app: App;
  const runs: Run[] = [];

  /** a scene set up, a question asked, his turn waited for; the game given `settleMs` to bring the outcome,
   *  judged by `check` */
  const task = async (name: string, setup: string, q: string, check: string, settleMs = 0, turnMs = 600_000) => {
    await app.js(`(async () => { ${setup} })()`);
    await Bun.sleep(2500);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    const spent0 = await app.js<number>(`__bh.tars.spent()`);
    const t0 = Date.now();
    await app.type(q);
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.busy`, 10_000).catch(() => {});
    await app.waitFor(`!__bh.tars.agent.busy`, turnMs);
    await Bun.sleep(1500);
    const judge = () =>
      app.js<{ ok: boolean; why: string }>(
        `(async () => { try { return await (async () => { ${check} })(); } catch (e) { return { ok: false, why: "check: " + e.message }; } })()`,
      );
    let r = await judge();
    for (const end = Date.now() + settleMs; !r.ok && Date.now() < end; r = await judge()) await Bun.sleep(2000);
    const run: Run = {
      task: name,
      ...r,
      seconds: Math.round((Date.now() - t0) / 1000),
      usd: +((await app.js<number>(`__bh.tars.spent()`)) - spent0).toFixed(5),
      actions: await app.js<string[]>(`__bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool + " " + JSON.stringify(a.args))`),
      said: await app.js<string>(`__bh.tars.agent.lastText ?? ""`),
    };
    runs.push(run);
    console.log(
      `\n[${run.ok ? "OK" : "FAIL"}] ${name} — ${run.seconds} s, $${run.usd}\n  > ${q}\n  ${run.actions.join("\n  ")}\n  « ${run.said} »\n  ${run.why}`,
    );
    return run;
  };

  beforeAll(async () => {
    app = await App.boot({
      width: 1280,
      height: 800,
      lang: "fr",
      hash: "scene=game:artemis",
      initScript: `try { localStorage.setItem("kerr.openrouter.key", ${JSON.stringify(KEY)}); localStorage.removeItem("kerr.tars.memory"); } catch {}`,
    });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.tarsModel = ${JSON.stringify(MODEL)}, __bh.settings.tarsRemarks = false, true)`);
  }, 240_000);
  afterAll(async () => {
    const ok = runs.filter((r) => r.ok).length;
    const out = {
      model: MODEL,
      at: new Date().toISOString(),
      ok,
      of: runs.length,
      usd: +runs.reduce((a, r) => a + r.usd, 0).toFixed(4),
      runs,
    };
    await Bun.write(`remote-results/tars-eval-${MODEL.replace(/\W+/g, "-")}.json`, JSON.stringify(out, null, 2));
    console.log(`\n${MODEL}: ${ok}/${runs.length} — $${out.usd}`);
    app?.close();
    stopServer();
  });

  test("a landing from a hover over Tranquility", async () => {
    const r = await task(
      "posé sur la Lune",
      `__bh.game.hoverOver("moon", 0.674, 23.473, 1.5);`,
      "Pose-nous en douceur.",
      `const s = __bh.game.status(); return { ok: __bh.camera.landed && s.soi === "moon", why: s.soiName + " · " + s.label + " · " + s.altKm.toFixed(2) + " km · " + __bh.game.pilotState() };`,
      180_000,
    );
    expect(r.ok).toBe(true);
  }, 900_000);

  test("a docking to the station", async () => {
    const r = await task(
      "amarrage à l'ISS",
      `__bh.preset("Earth: docking to the ISS");`,
      "Amarre-nous à la station.",
      `return { ok: __bh.camera.docked, why: "docked " + __bh.camera.docked + " · " + __bh.game.pilotState() };`,
      600_000,
    );
    expect(r.ok).toBe(true);
  }, 1_300_000);

  test("the interface: quality, constellations", async () => {
    const r = await task(
      "interface",
      `__bh.preset("game:artemis");`,
      "Passe la qualité en mode jeu et montre les constellations.",
      `const s = __bh.settings; return { ok: s.quality === "game" && s.skyLines === true, why: "quality " + s.quality + " · skyLines " + s.skyLines };`,
    );
    expect(r.ok).toBe(true);
  }, 700_000);

  test("a teleport, then undone", async () => {
    await task(
      "téléportation",
      ``,
      "Téléporte-nous près de Jupiter.",
      `const s = __bh.game.status(); return { ok: s.soi === "jupiter", why: s.soiName + " · " + s.label };`,
    );
    const r = await task(
      "annuler",
      ``,
      "Finalement non, annule.",
      `const s = __bh.game.status(); return { ok: s.soi === "earth", why: s.soiName + " · " + s.label };`,
    );
    expect(r.ok).toBe(true);
  }, 1_300_000);

  test("a plan proposed, nothing done; accepted, carried out", async () => {
    await task(
      "proposition",
      `__bh.preset("game:artemis"); await new Promise((r) => setTimeout(r, 3000)); __bh.game.target("mars");`,
      "Propose-moi un plan pour viser la Lune et passer le temps à 50 fois.",
      `const p = document.querySelector("[data-testid=tars-proposal]"); return { ok: !p.hidden && String(__bh.settings.target) === "mars", why: "proposal " + !p.hidden + " · target " + __bh.settings.target };`,
    );
    await app.click("[data-testid=tars-accept]");
    await app.waitFor(`__bh.tars.agent.busy`, 10_000).catch(() => {});
    await app.waitFor(`!__bh.tars.agent.busy`, 300_000);
    const x = await app.js<{ target: string; soi: string; flying: boolean }>(
      `({ target: String(__bh.settings.target), soi: __bh.game.status().soi, flying: !!__bh.camera.fcPlan()?.executing || ["node", "burns", "transfer"].includes(__bh.camera.pilot.auto) })`,
    );
    // (accepted: the mission under way, or flown already — the warp asked only for its transit)
    const ok = x.target === "moon" && (x.flying || x.soi === "moon");
    runs.push({
      task: "plan accepté",
      ok,
      why: JSON.stringify(x),
      seconds: 0,
      usd: 0,
      actions: [],
      said: await app.js<string>(`__bh.tars.agent.lastText ?? ""`),
    });
    expect(ok).toBe(true);
  }, 700_000);

  test.skipIf(!LONG)(
    "a take-off from Kennedy to a 300 km orbit",
    async () => {
      const r = await task(
        "décollage vers 300 km",
        `__bh.game.land("earth", 28.573, -80.649);`,
        "Décolle et mets-nous en orbite à 300 km.",
        `const s = __bh.game.status(); const o = s.orbit; return { ok: s.status === "orbit" && !!o && o.peKm > 200 && o.apKm < 420, why: s.soiName + " · " + s.label + " · Pe " + (o?.peKm ?? 0).toFixed(0) + " · Ap " + (o?.apKm ?? 0).toFixed(0) + " km" };`,
        1_800_000,
      );
      expect(r.ok).toBe(true);
    },
    2_500_000,
  );

  test.skipIf(!LONG)(
    "an entry to Edwards from orbit, landed",
    async () => {
      const r = await task(
        "rentrée et posé à Edwards",
        `__bh.preset("game:artemis"); await new Promise((r) => setTimeout(r, 3000)); __bh.game.orbit("earth", { altKm: 400, inc: 40 });`,
        "Ramène-nous sur Terre, pose-nous à Edwards.",
        `const c = __bh.camera, s = __bh.game.status(); return { ok: c.landed && /Edwards/.test(c.entrySite?.name ?? ""), why: "auto " + c.pilot.auto + " · site " + (c.entrySite?.name ?? "none") + " · " + s.label + " " + s.altKm.toFixed(1) + " km" };`,
        4_500_000,
      );
      expect(r.ok).toBe(true);
    },
    5_000_000,
  );
});
