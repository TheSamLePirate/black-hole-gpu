import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// TARS the copilot's hands (docs/PLAN-AVIATION-AAA.md, I2): first the Alps as ever; then a fight (two bandits from
// the north) — TARS calling them by their BRAA as the radar finds them; with TARS_LIVE=1 and the owner's key, asked
// to lock one and fire an AMRAAM, the threats called as they come —; then the real traffic about Paris — « quels
// avions autour ? », one intercepted by its callsign —; a mission modified by a sentence. (E2E_SHOTS=<dir>: the views.)

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const LIVE = process.env.TARS_LIVE === "1" && /^sk-or-/.test(KEY);

describe.skipIf(!E2E)("TARS the copilot: threats, weapons, traffic, missions", () => {
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
    const r = await app.js<{ said: string; actions: string[] }>(
      `({ said: __bh.tars.agent.lastText ?? "", actions: __bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool + " " + JSON.stringify(a.args)) })`,
    );
    console.log(`  ${r.actions.join(" · ")}\n  « ${r.said} »`);
    // (the panel closed again: the view seen)
    if (!(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`))) await app.press("F6", "F6");
    return r;
  };
  const calls = () => app.js<string[]>(`__bh.voice.said.filter((l) => l.speaker === "tars").map((l) => l.text)`);
  const tool = (name: string, args: object) =>
    app.js<unknown>(`(async () => { const t = __bh.tars.tools().find((x) => x.name === ${JSON.stringify(name)});
      const o = await t.run(${JSON.stringify(args)}, new AbortController().signal); return o.result ?? o; })()`);

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
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; __bh.settings.tarsModel = "z-ai/glm-5.3-flash"; __bh.settings.tarsRemarks = false; return 1; })()`,
    );
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

  test("a fight: the two bandits called by their BRAA as the radar finds them", async () => {
    await app.js(`(() => { Object.assign(__bh.settings, { f35Invulnerable: true, f35ThreatCalls: true }); return 1; })()`);
    await tool("f35", { action: "fly", id: "bvr" });
    await app.waitFor(`__bh.camera.combat?.status === "run"`, 30_000);
    await app.waitFor(`__bh.voice.said.some((l) => l.speaker === "tars" && /bandit/i.test(l.text))`, 30_000);
    const c = await calls();
    console.log(`  TARS: ${c.filter((x) => /bandit/i.test(x)).join(" | ")}`);
    expect(c.some((x) => /^2 bandits, le plus proche \d{3}, \d+ km, \d+ m, de face$/.test(x))).toBe(true);
    await Bun.sleep(1500);
    await shot("bandits");
  }, 120_000);

  test.skipIf(!LIVE)(
    "TARS live: a bandit locked and an AMRAAM fired on the order; the threats called as they come",
    async () => {
      const a = await ask("Verrouille BANDIT 1 et tire un AMRAAM.");
      expect(a.actions.some((x) => x.startsWith("✓ weapons") && x.includes("fire"))).toBe(true);
      expect(await app.js<number>(`__bh.camera.combat.world.stores.aim120`)).toBeLessThan(4);
      await shot("fox3");
      // (the bandits' missiles, a kill — whichever comes first)
      await app.waitFor(`__bh.voice.said.some((l) => l.speaker === "tars" && /missile|tapis|SAM/i.test(l.text))`, 150_000);
      await Bun.sleep(800);
      await shot("threat");
      const c = await calls();
      console.log(`  TARS: ${c.filter((x) => /missile|tapis|touch|bandit/i.test(x)).join(" | ")}`);
      const b = await ask("Quelle est la menace ?");
      expect(b.actions.some((x) => x.includes("weapons") && x.includes("threats"))).toBe(true);
    },
    400_000,
  );

  test.skipIf(!LIVE)(
    "TARS live: the real traffic about Paris listed, one intercepted by its callsign",
    async () => {
      await app.js(`(() => { __bh.camera.missionAbort?.(); __bh.camera.combat && (__bh.camera.combat.status = "lost"); return 1; })()`);
      await app.js(`(() => { __bh.settings.traffic = true; __bh.game.flyAt(48.95, 2.2, 3500, 90, 200); return 1; })()`);
      await app.waitFor(`__bh.camera.trafficNow().filter((c) => !c.gnd).length >= 5`, 90_000);
      await Bun.sleep(4000);
      const a = await ask("Quels avions autour de nous ?");
      expect(a.actions.some((x) => x.startsWith("✓ traffic") && x.includes("list"))).toBe(true);
      // (one in the air within 40 km, its callsign said)
      const cs = await app.js<string>(
        `__bh.camera.aircraftAround(40000).find((x) => x.source === "trf" && !x.gnd && /^[A-Z]{3}[0-9]/.test(x.name))?.name ?? ""`,
      );
      expect(cs.length).toBeGreaterThan(3);
      const b = await ask(`Intercepte le ${cs}.`);
      expect(b.actions.some((x) => x.startsWith("✓ traffic") && x.includes("intercept"))).toBe(true);
      expect(await app.js<string>(`__bh.camera.icpt?.name ?? ""`)).toBe(cs);
      await Bun.sleep(6000);
      await shot("intercept");
    },
    400_000,
  );

  test.skipIf(!LIVE)(
    "TARS live: a mission modified by a sentence",
    async () => {
      const a = await ask("Modifie la mission de frappe en Corse : mets une tempête et enlève le camion. Ne la lance pas.");
      expect(a.actions.some((x) => x.startsWith("✓ mission") && x.includes("modify"))).toBe(true);
      const mine = await app.js<{ id: string; weather?: { preset?: string }; units: { id: string }[] }[]>(
        `JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("missions.mine")) ?? "") || "[]")`,
      );
      const m = mine.find((x) => x.id.startsWith("corsica-strike"));
      console.log(`  kept: ${m?.id} · ${m?.weather?.preset} · ${m?.units.map((u) => u.id).join(", ")}`);
      expect(m?.weather?.preset).toBe("storm");
      expect(m?.units.some((u) => u.id === "truck")).toBe(false);
    },
    400_000,
  );
});
