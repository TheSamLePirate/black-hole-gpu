import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-AEROPORTS A5: the approach procedures. Edwards's runway 22 on the entry autopilot's final, 9 km out
// (stepped at fixed steps, as the landing e2e): the runway view carries its chart's fixes still ahead (the
// pull-up, the minima, the touchdown — the HUD marks them); the map's tablet, its CHARTS page opened by a
// real click, draws the chart — runway 22, the fixes' table, the craft on the plan and on the profile.
// Then on 3 km out, full throttle (TOGA): the missed approach flown — climbed out ahead to 1 500 m on the
// engines, turned back left, climbed to 3 km —, the approach's legs again, a new final, landed.

describe.skipIf(!E2E)("the approach charts", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Edwards 22, 9 km out: the fixes ahead, the chart on the tablet", async () => {
    const r = await app.js<{ final: boolean; along: number; fixes: { id: string; h: number; r: number; z: number }[] }>(`(() => {
      __bh.freeze(true);
      __bh.game.glideTo("Edwards");
      const c = __bh.camera;
      for (let i = 0; i < 30 * 170; i++) {
        __bh.step(1 / 30);
        const A = c.entryRun?.app;
        if (A?.final && A.along > -9000) break;
      }
      c.runwayCache = null;
      const v = c.runwayView();
      return { final: !!c.entryRun?.app?.final, along: v?.along ?? NaN,
        fixes: (v?.fixes ?? []).map((f) => ({ id: f.id, h: f.h, r: f.r, z: f.d[2] })) };
    })()`);
    expect(r.final).toBe(true);
    expect(r.along).toBeGreaterThan(-9500);
    // (the fixes still ahead, in order, in front of the eye: the pull-up at 90 m, the minima at 60 m, the touchdown)
    expect(r.fixes.map((f) => f.id)).toEqual(["PU", "DH", "TD"]);
    expect(r.fixes.map((f) => f.h)).toEqual([90, 60, 0]);
    for (const f of r.fixes) expect(f.z).toBeGreaterThan(0);
    expect(r.fixes[0]!.r).toBeLessThan(r.fixes[2]!.r);

    await app.press("KeyM");
    await app.click("[data-testid=tablet-charts]");
    await app.waitFor(`!!document.querySelector("[data-testid=charts-page] svg")`, 5000);
    await Bun.sleep(400);
    const page = await app.js<{ head: string; rows: string[]; crafts: string[]; svgs: number[] }>(`(() => {
      const p = document.querySelector("[data-testid=charts-page]");
      return {
        head: p.querySelector("[data-testid=charts-head]").textContent,
        rows: [...p.querySelectorAll("[data-testid=charts-fixes] td:first-child")].map((t) => t.textContent.split(" ")[0]),
        crafts: [...p.querySelectorAll(".ch-craft")].map((g) => (g.style.display === "none" ? "hidden" : g.getAttribute("transform") ?? "")),
        svgs: [...p.querySelectorAll("svg")].map((s) => Math.round(s.getBoundingClientRect().height)),
      };
    })()`);
    expect(page.head).toContain("RWY 22");
    expect(page.head).toContain("Edwards");
    expect(page.rows).toEqual(["IAF", "FAF", "PU", "DH", "TD", "MA", "MAHF"]);
    expect(page.svgs.length).toBe(2);
    for (const h of page.svgs) expect(h).toBeGreaterThan(100);
    // (the craft drawn on both: placed, not waiting at the origin)
    expect(page.crafts.length).toBe(2);
    for (const t of page.crafts) expect(t).toMatch(/^translate\(\d/);
    if (process.env.SHOT) await app.shot(process.env.SHOT);
    await app.press("KeyM");
  }, 120_000);

  test("TOGA 3 km out: the missed approach flown, a new approach, landed", async () => {
    const r = await app.js<{
      dhs: { across: number; dh: number; ga: boolean }[];
      toga: boolean;
      phases: string[];
      legs: string[];
      turnH: number;
      topH: number;
      maxThr: number;
      released: boolean;
      fixesInGa: string[];
      landed: boolean;
      fail: string | null;
      stop: { along: number; across: number } | null;
      log: string[];
      t: number;
    }>(`(() => {
      const c = __bh.camera;
      let i = 0;
      for (; i < 30 * 60; i++) {
        __bh.step(1 / 30);
        if ((c.entryRun?.app?.along ?? -1e9) > -3000) break;
      }
      // (full throttle on the autopilot's approach: TOGA — the key's own path)
      const toga = c.goAround();
      const phases = [], legs = [];
      const dhs = [];
      let turnH = 0, topH = 0, maxThr = 0, released = false, fixesInGa = [];
      for (i = 0; i < 30 * 900; i++) {
        __bh.step(1 / 30);
        const R = c.entryRun;
        if (c.ourLanded || c.airFlight.failure) break;
        // (touched down: the autopilot's run over, the rollout to the stop)
        if (!R) continue;
        const ph = R.ga?.phase ?? "-";
        if (phases[phases.length - 1] !== ph) {
          phases.push(ph);
          if (ph === "turn") turnH = R.app?.agl ?? 0;
          if (ph === "climb") { c.runwayCache = null; fixesInGa = (c.runwayView()?.fixes ?? []).map((f) => f.id); }
        }
        if (R.ga) { topH = Math.max(topH, R.app?.agl ?? 0); maxThr = Math.max(maxThr, c.pilot.fired?.throttle ?? 0); }
        if (phases.includes("back") && !R.ga) released = true;
        if (legs[legs.length - 1] !== R.leg) legs.push(R.leg);
        if (R.dhCheck && dhs.length < 4 && (!dhs.length || dhs[dhs.length - 1] !== R.dhCheck)) dhs.push(R.dhCheck);
        if (c.ourLanded || c.airFlight.failure) break;
      }
      __bh.freeze(false);
      c.runwayCache = null;
      const v = c.runwayView();
      return { dhs: dhs.map((d) => ({ ...d })), toga, phases, legs, turnH, topH, maxThr, released, fixesInGa, landed: !!c.ourLanded, fail: c.airFlight.failure,
        stop: v ? { along: v.along, across: v.across } : null, t: i / 30,
        log: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text).slice(-12) };
    })()`);
    expect(r.toga).toBe(true);
    expect(r.phases.slice(0, 5)).toEqual(["climb", "turn", "up", "back", "-"]);
    expect(r.fixesInGa).toEqual(["MA", "MAHF"]);
    expect(r.maxThr).toBeGreaterThan(0.3);
    expect(r.turnH).toBeGreaterThan(1450);
    expect(r.topH).toBeGreaterThan(2800);
    expect(r.released).toBe(true);
    expect(r.log.some((l) => l.startsWith("Go-around"))).toBe(true);
    // (round again and down: a new final, stabilised at the minima, landed on the runway)
    expect(r.dhs[0]?.ga).toBe(false);
    expect(r.legs.lastIndexOf("final")).toBeGreaterThan(r.legs.indexOf("missed"));
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    expect(Math.abs(r.stop!.across)).toBeLessThan(15);
    expect(r.stop!.along).toBeGreaterThan(0);
    expect(r.stop!.along).toBeLessThan(4500);
  }, 600_000);
});
