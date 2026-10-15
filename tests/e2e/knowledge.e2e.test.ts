import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// TARS's aviation knowledge (docs/PLAN-AVIATION-AAA.md, I1): first the Alps as ever; the knowledge tool in the page
// (the pages bundled); then, with TARS_LIVE=1 and the owner's key, TARS asked in French about the F-35's corner speed
// and about the carrier's Case III — his knowledge searched, his answers from it. (E2E_SHOTS=<dir>: the views.)

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const LIVE = process.env.TARS_LIVE === "1" && /^sk-or-/.test(KEY);

describe.skipIf(!E2E)("TARS's aviation knowledge", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const ask = async (q: string) => {
    if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
    await app.type(q);
    await app.press("Enter");
    await app.waitFor(`__bh.tars.agent.busy`, 5_000).catch(() => {});
    await app.waitFor(`!__bh.tars.agent.busy`, 240_000);
    return app.js<{ said: string; actions: string[] }>(
      `({ said: __bh.tars.agent.lastText ?? "", actions: __bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool + " " + JSON.stringify(a.args)) })`,
    );
  };
  beforeAll(async () => {
    app = await App.boot({
      width: 1600,
      height: 1000,
      lang: "fr",
      hash: "scene=game:artemis",
      tiles: true,
      initScript: LIVE
        ? `try { localStorage.setItem("kerr.openrouter.key", ${JSON.stringify(KEY)}); localStorage.removeItem("kerr.tars.memory"); } catch {}`
        : undefined,
    });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the knowledge tool in the page: the pages bundled, searched in French", async () => {
    const r = await app.js<{ section: string }[]>(`(async () => {
      const tool = __bh.tars.tools().find((t) => t.name === "knowledge");
      const out = await tool.run({ action: "search", query: "vitesse de coin", lang: "fr" }, new AbortController().signal);
      return out.result ?? out;
    })()`);
    console.log(`  ${r.map((x) => x.section).join(" | ")}`);
    expect(r[0]!.section).toBe("L'énergie — La vitesse de coin");
  }, 60_000);

  test.skipIf(!LIVE)(
    "TARS live: the corner speed and Case III, from his knowledge",
    async () => {
      await app.js(`(__bh.settings.tarsModel = "z-ai/glm-5.3-flash", __bh.settings.tarsRemarks = false, true)`);
      const a = await ask("Quelle est la vitesse de coin du F-35, et pourquoi elle compte en combat ?");
      console.log(`  ${a.actions.join(" · ")}\n  « ${a.said} »`);
      expect(a.actions.some((x) => x.includes("knowledge"))).toBe(true);
      expect(a.said).toMatch(/3[34]0|17[05]|180/);
      await shot("corner");
      const b = await ask("Explique-moi le cas III à l'appontage.");
      console.log(`  ${b.actions.join(" · ")}\n  « ${b.said} »`);
      expect(b.actions.some((x) => x.includes("knowledge"))).toBe(true);
      expect(b.said).toMatch(/marshal/i);
      await shot("case3");
    },
    400_000,
  );
});
