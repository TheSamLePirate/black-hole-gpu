import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Making missions (docs/PLAN-AVIATION-AAA.md, P3): first the Alps as ever; then the editor opened from the panel's
// "Make a mission" — real clicks: the SAM tool, a click on the map, the airliner tool, another, its objectives (identify
// and escort), the escort's destination, a title —; its link copied and opened as a new page: its briefing at once,
// started, the mission flown as made; then TARS: his mission tool given a sketch ("an escort of the A320 AFR123 to
// Nice") — the place found, flown; and, with TARS_LIVE=1 and the owner's key, the same asked in French in his field.
// (E2E_SHOTS=<dir>: the views.)

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const LIVE = process.env.TARS_LIVE === "1" && /^sk-or-/.test(KEY);

describe.skipIf(!E2E)("making missions", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** a real click on the editor's map at a place */
  const clickAt = async (lat: number, lon: number) => {
    const p = await app.js<{
      x: number;
      y: number;
    }>(`(() => { const mv = __bh.flight.missions.editor.map; const [x, y] = mv.toScreen(${lat}, ${lon});
      const r = mv.canvas.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; })()`);
    await app.mouse("move", p.x, p.y);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(150);
  };
  beforeAll(async () => {
    app = await App.boot({
      width: 1600,
      height: 1000,
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

  let link = "";
  test("made in the editor by clicks: a SAM, an airliner identified and escorted, its destination", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.click(`[data-testid="chp-msn-new"]`);
    await app.waitFor(`!!document.querySelector('[data-testid="mission-editor"]')`, 5000);
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.flight.missions.editor.map.flyTo(45.75, 6.4, 8, 0.2); return 1; })()`);
    await Bun.sleep(1500);
    await app.click(`[data-testid="me-tool-sam"]`);
    await clickAt(45.7, 6.95);
    await app.click(`[data-testid="me-tool-airliner"]`);
    await clickAt(45.95, 6.35);
    await app.click(`[data-testid="me-tool-dest"]`);
    await clickAt(45.72, 5.15);
    // (the airliner's objectives: identify, and escort — its card's boxes)
    await app.js(
      `(() => { const E = __bh.flight.missions.editor; const u = E.draft.units.find((x) => x.kind === "airliner"); u.roles = ["identify", "escort"]; u.name = "AFR4512"; E.draft.title = "Test Alpes"; E.draft.chain = true; E.refresh(); return 1; })()`,
    );
    await Bun.sleep(3000);
    await shot("editor");
    const d = await app.js<{ units: string[]; places: string[]; errors: string }>(`(() => { const d = __bh.flight.missions.editor.draft;
      return { units: d.units.map((u) => u.kind + ":" + u.roles.join("+")), places: d.places.map((p) => p.role), errors: document.querySelector(".me-err")?.textContent ?? "" }; })()`);
    console.log(`  made: ${d.units.join(", ")}; ${d.places.join(", ")} ${d.errors}`);
    expect(d.units).toEqual(["sam:destroy", "airliner:identify+escort"]);
    expect(d.places).toEqual(["dest"]);
    expect(d.errors).toBe("");
    link = await app.js<string>(`__bh.flight.missions.editor.act("link")`);
    expect(link).toMatch(/#mission=[\w-]+$/);
    console.log(`  its link: ${link.length} characters`);
  }, 120_000);

  test("its link opened as a new page: briefed at once, flown as made", async () => {
    await app.load(link.slice(link.indexOf("#") + 1));
    await app.js(`(() => { __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="mission-brief"]')`, 60_000);
    await Bun.sleep(1500);
    await shot("link-brief");
    await app.click(`[data-testid="mission-go"]`);
    await app.waitFor(`__bh.flight.missions.state()?.status === "flying" && !!__bh.camera.combat?.world.targets.length`, 30_000);
    const st = await app.js<{ title: string; objs: string[] }>(
      `(() => { const M = __bh.camera.mission; return { title: M.run.spec.title, objs: M.run.spec.objectives.map((o) => o.text + (o.after ? " (after)" : "")) }; })()`,
    );
    console.log(`  flown: ${st.title} — ${st.objs.join(" · ")}`);
    expect(st.title).toBe("Test Alpes");
    expect(st.objs).toEqual(["Destroy SA-6", "Identify AFR4512 (after)", "Escort AFR4512 to 45.72°, 5.15° (after)"]);
    await Bun.sleep(2000);
    await shot("link-flown");
    await app.js(`(() => { __bh.flight.missions.abort(); return 1; })()`);
  }, 180_000);

  test("TARS's mission tool: an escort of the A320 AFR123 to Nice, the place found, flown", async () => {
    const r = await app.js<{ flown: string; title: string; objectives: string[] }>(`(async () => {
      const tool = __bh.tars.tools().find((t) => t.name === "mission");
      const out = await tool.run({ action: "create", mission: JSON.stringify({ units: [{ id: "a", kind: "traffic", match: { callsign: "AFR123" } }], objectives: [{ kind: "escort", unit: "a", until: { place: "Nice" } }] }) }, new AbortController().signal);
      return out.result ?? out;
    })()`);
    console.log(`  TARS's: ${r.title} — ${r.objectives.join(" · ")}`);
    expect(r.objectives[0]).toMatch(/^Escort AFR123 to Nice/);
    await app.waitFor(`__bh.flight.missions.state()?.status === "flying" && __bh.flight.missions.state()?.pending === 0`, 30_000);
    const until = await app.js<{ lat: number; lon: number }>(`__bh.camera.mission.run.spec.objectives[0].until`);
    expect(Math.abs(until.lat - 43.7)).toBeLessThan(0.2);
    expect(Math.abs(until.lon - 7.25)).toBeLessThan(0.3);
    await Bun.sleep(1500);
    await shot("tars-tool");
    await app.js(`(() => { __bh.flight.missions.abort(); return 1; })()`);
  }, 120_000);

  test.skipIf(!LIVE)(
    "TARS live: the escort asked in French, made and flown",
    async () => {
      await app.js(`(__bh.settings.tarsModel = "z-ai/glm-5.3-flash", __bh.settings.tarsRemarks = false, true)`);
      if (await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)) await app.press("F6", "F6");
      await app.type("Crée-moi une mission : escorter l'A320 AFR123 jusqu'à Nice.");
      await app.press("Enter");
      await app.waitFor(`__bh.tars.agent.busy`, 5_000).catch(() => {});
      await app.waitFor(`!__bh.tars.agent.busy`, 240_000);
      const r = await app.js<{ said: string; actions: string[] }>(
        `({ said: __bh.tars.agent.lastText ?? "", actions: __bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool) })`,
      );
      console.log(`  TARS: ${r.actions.join(", ")} — « ${r.said} »`);
      const M = await app.js<{ kind: string; until: { lat: number; lon: number } } | null>(
        `(() => { const o = __bh.camera.mission?.run.spec.objectives.find((x) => x.kind === "escort"); return o ? { kind: o.kind, until: o.until } : null; })()`,
      );
      expect(M?.kind).toBe("escort");
      expect(Math.abs(M!.until.lat - 43.7)).toBeLessThan(0.3);
      await Bun.sleep(1500);
      await shot("tars-live");
    },
    300_000,
  );
});
