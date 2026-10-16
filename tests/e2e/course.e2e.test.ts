import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The guided lessons (docs/PLAN-AVIATION-AAA.md, I3): first the Alps as ever; the flight school's new cards; the first
// flight guided by a real click — TARS levels, turns and climbs, his steps on the panel, then "your controls"; a
// steady pilot (the holds standing for his hands) flies the rest, the instructor watching — its debrief; then, with
// TARS_LIVE=1 and the owner's key, TARS asked to teach formation flying: the rejoin on LEAD to the echelon right, the
// handover in the slot. (E2E_SHOTS=<dir>: the views.)

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const LIVE = process.env.TARS_LIVE === "1" && /^sk-or-/.test(KEY);

describe.skipIf(!E2E)("the guided lessons", () => {
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
    if (!(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`))) await app.press("F6", "F6");
    return r;
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
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Instructor: "full", tarsModel: "z-ai/glm-5.3-flash", tarsRemarks: false }); return 1; })()`,
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

  test("the first flight guided: TARS's steps, the handover, a steady pilot, the debrief", async () => {
    await app.js(`(() => { __bh.flight.school.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="lesson-first"]')`, 5000);
    await Bun.sleep(400);
    await shot("school");
    await app.click(`[data-testid="lesson-first"]`);
    await app.waitFor(`!!document.querySelector('[data-testid="lesson-guided"]')`, 5000);
    await app.click(`[data-testid="lesson-guided"]`);
    await app.waitFor(`!!__bh.camera.course?.run`, 30_000);
    // (TARS's turn: his panel)
    await app.waitFor(`__bh.camera.course?.run?.i === 1`, 30_000);
    await Bun.sleep(6000);
    await shot("tars-turn");
    expect(await app.js<string>(`document.querySelector('[data-testid="course-panel"]')?.textContent ?? ""`)).toContain("TARS");
    // (a steady pilot from the handover: each step as asked)
    await app.js(`(() => { window.__at = -1; window.__pilot = setInterval(() => {
      const c = __bh.camera, S = c.course?.run; if (!S) return; const s = S.steps[S.i];
      if (!s || s.who !== "you" || window.__at === S.i) return; window.__at = S.i; const T = s.target;
      c.jetModes.alt = S.alt0 + T.dAlt; c.jetModes.hdg = (((S.hdg0 + T.dHdg) % 360) * Math.PI) / 180; c.jetModes.spd = T.spd;
      c.jetModes.bankMax = T.bank ? (Math.abs(T.bank) * Math.PI) / 180 : undefined; }, 300); return 1; })()`);
    await app.waitFor(`__bh.camera.course?.run?.steps[__bh.camera.course.run.i]?.who === "you"`, 150_000);
    await Bun.sleep(4000);
    await shot("handover");
    expect(await app.js<string>(`document.querySelector('[data-testid="course-panel"]')?.textContent ?? ""`)).toContain("À VOUS");
    await app.waitFor(`!!document.querySelector('[data-testid="instructor-debrief"]')`, 300_000);
    await Bun.sleep(600);
    await shot("debrief");
    const s = await app.js<number>(`__bh.camera.instrLast.debrief.score`);
    console.log(`  the first flight's debrief: ${s}/20`);
    expect(s).toBeGreaterThan(12);
    await app.js(`(() => { clearInterval(window.__pilot); return 1; })()`);
    await app.press("Escape");
  }, 400_000);

  test("formation guided: the rejoin on LEAD to the echelon right, the handover in the slot", async () => {
    await app.js(`(() => { __bh.flight.school.guided("formation"); return 1; })()`);
    await app.waitFor(`__bh.camera.course?.id === "formation" && !!__bh.camera.course.run`, 30_000);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.waitFor(`__bh.camera.course?.run?.steps[__bh.camera.course.run.i]?.who === "you"`, 240_000);
    await Bun.sleep(3000);
    await shot("formation");
    const v = await app.js<Record<string, number>>(`__bh.camera.courseSample()?.v ?? {}`);
    console.log(`  in the slot: ${JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x)])))}`);
    expect(Math.abs(v.fwd ?? 99)).toBeLessThan(25);
    expect(Math.abs(v.right ?? 99)).toBeLessThan(25);
  }, 400_000);

  test.skipIf(!LIVE)(
    "TARS live: « apprends-moi une interception » — the guided lesson started, left to fly itself",
    async () => {
      const a = await ask("Apprends-moi à faire une interception.");
      expect(a.actions.some((x) => x.startsWith("✓ lesson") && x.includes("guided") && x.includes("intercept"))).toBe(true);
      await app.waitFor(`__bh.camera.course?.id === "intercept" && !!__bh.camera.course.run`, 30_000);
      await Bun.sleep(20_000);
      // (TARS's steps flying: the intercept engaged, nothing else meddling)
      expect(await app.js<boolean>(`!!__bh.camera.icpt && __bh.camera.course?.run?.i === 0`)).toBe(true);
      expect(a.actions.some((x) => /flight_lead|schedule|jet_mode/.test(x))).toBe(false);
      await shot("intercept");
    },
    400_000,
  );
});
