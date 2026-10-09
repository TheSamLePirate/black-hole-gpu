import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS-AGENT: TARS the agent on the REAL OpenRouter — the owner's key from .env (OPENROUTER_API_KEY), put in
// the page's storage, never printed. Only with TARS_LIVE=1 (each run costs a few tenths of a cent). Orders
// typed in French in his field; what they did read back from the game, not from his words.
//   TARS_LIVE=1 E2E=1 bun test tests/e2e/tars-agent-live.e2e.test.ts --timeout 600000

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const LIVE = E2E && process.env.TARS_LIVE === "1" && /^sk-or-/.test(KEY);
const MODEL = process.env.TARS_MODEL ?? "z-ai/glm-5.3-flash";

describe.skipIf(!LIVE)("TARS the agent, live", () => {
  let app: App;
  const log: string[] = [];
  /** a question typed, his turn waited for: his words, his actions */
  const ask = async (q: string) => {
    await app.js(`(document.querySelector("[data-testid=tars-panel]").hidden && __bh.tars, true)`);
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type(q);
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.busy`, 5_000).catch(() => {});
    await app.waitFor(`!__bh.tars.agent.busy`, 240_000);
    await Bun.sleep(300);
    const r = await app.js<{ said: string; actions: string[]; spent: number }>(`({
      said: __bh.tars.agent.lastText ?? "",
      actions: __bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool + " " + JSON.stringify(a.args)),
    })`);
    const st = await app.js<string>(
      `(() => { const s = __bh.game.status(); return s.soiName + " · " + s.label + " · " + s.altKm.toFixed(0) + " km · " + __bh.game.pilotState(); })()`,
    );
    log.push(`> ${q}\n  ${r.actions.join("\n  ")}\n  « ${r.said} »\n  [jeu : ${st}]`);
    return r;
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
    console.log(`\n${MODEL}\n${log.join("\n")}`);
    await app?.shot("remote-results/tars-agent-live.png").catch(() => {});
    app?.close();
    stopServer();
  });

  test("a flight to the Moon planned and flown; a teleport to its orbit, a target, the time", async () => {
    await ask("Emmène-nous en orbite autour de la Lune.");
    // (the flight under way, or flown already — the hub's warp may take it there within the turn)
    expect(
      await app.js<boolean>(
        `!!__bh.camera.fcPlan()?.executing || ["node", "burns", "transfer"].includes(__bh.camera.pilot.auto) || __bh.game.status().soi === "moon"`,
      ),
    ).toBe(true);
    await ask("Finalement, téléporte-nous directement en orbite de 100 km autour de la Lune.");
    expect(await app.js<string>(`__bh.game.status().soi`)).toBe("moon");
    expect(await app.js<number>(`__bh.game.status().altKm`)).toBeLessThan(400);
    await ask("Vise Mars, puis passe le temps à 100 fois.");
    expect(await app.js<string>(`String(__bh.settings.target)`)).toBe("mars");
    const x = await app.js<number>(`__bh.settings.timeSpeed * 4.925490947e-6 * __bh.settings.massSolar`);
    expect(Math.round(x)).toBe(100);
  }, 300_000);

  test("a setting found by words, the view, his memory kept and recalled", async () => {
    await ask("Coupe la musique et mets la vue cockpit.");
    expect(await app.js<boolean>(`__bh.settings.music`)).toBe(false);
    expect(await app.js<string>(`__bh.settings.shipMount`)).toBe("cockpit");
    await ask("Je m'appelle Cooper. Souviens-t'en.");
    expect(await app.js<string>(`__bh.tars.memory.notes.join(" ")`)).toMatch(/Cooper/i);
    const r = await ask("Comment je m'appelle ?");
    expect(r.said).toMatch(/Cooper/i);
  }, 300_000);
});
