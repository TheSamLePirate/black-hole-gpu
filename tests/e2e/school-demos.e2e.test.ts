import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight school's demonstrations, each watched whole in the real game (docs/PLAN-AVIATION-AAA.md A4/I3), started
// by real clicks (the school › the lesson's card › Watch the demonstration): TARS flies the whole lesson — the pilot's
// part too — and each must reach its end: the first flight's seven steps; the circuit at Edwards and the landing and the
// ILS down to a stop on the runway; Case I on the Ford to a wire; the rejoin and a minute in the slot; the intercept to
// its tail; the guns to the kill; each aerobatic figure flown. A watchdog every 2 s (__bh.flight.school.state()): the
// step must come nearer its end (its measure — a distance, the deviations, the range — never stalled 45 s), none of
// its steps left at its time at most, no debrief screen over a demonstration, no page error; a stall dumps the state
// and a view. In real time, the cockpit view. DEMOS=landing,circuit runs only those; E2E_SHOTS=<dir> (default
// remote-results/school-demos) keeps the views and summary.json.

const ALL = [
  "first",
  "landing",
  "circuit",
  "ils",
  "case1",
  "formation",
  "intercept",
  "guns",
  "loop",
  "immelmann",
  "splitS",
  "aileronRoll",
  "barrelRoll",
  "cuban8",
  "inverted",
  "highAlpha",
  "reversal",
  "spin",
];
const ASKED = (process.env.DEMOS ?? "").split(",").filter(Boolean);
const DEMOS = ASKED.length ? ALL.filter((x) => ASKED.includes(x)) : ALL;
/** a step not nearer its end this long fails the demonstration [s] (the game gives up at 90) */
const STALL = 45;

/** What each demonstration must have done at its end (read in the page), at most so long [s]. */
const END: Record<string, { ok: string; max: number }> = {
  first: { ok: `true`, max: 260 },
  // (down and stopped on the runway, graded)
  landing: { ok: `!!c.ilsLast && !c.ilsRun && (c.ilsLast.score ?? 0) > 12 && (c.geoNow()?.gs ?? 99) < 5`, max: 160 },
  circuit: { ok: `!!c.ilsLast && !c.ilsRun && (c.ilsLast.score ?? 0) > 12 && (c.geoNow()?.gs ?? 99) < 5`, max: 240 },
  ils: { ok: `!!c.ilsLast && !c.ilsRun && (c.ilsLast.score ?? 0) > 12 && (c.geoNow()?.gs ?? 99) < 5`, max: 260 },
  // (a wire caught)
  case1: { ok: `(c.trapLast?.wire ?? 0) > 0`, max: 320 },
  formation: { ok: `true`, max: 300 },
  intercept: { ok: `true`, max: 600 },
  guns: { ok: `!!c.combat && c.combat.world.targets.some((q) => q.name === "BQM-7" && !q.alive)`, max: 330 },
};
const FIGURE = { ok: `(c.aero?.result?.score ?? 0) > 12`, max: 220 };

interface Row {
  id: string;
  ok: boolean;
  wall: number;
  t: number;
  late: string[];
  failed?: string;
  why?: string;
}

describe.skipIf(!E2E)("the flight school's demonstrations, each whole, watched for a stall", () => {
  let app: App;
  const dir = process.env.E2E_SHOTS ?? "remote-results/school-demos";
  const rows: Row[] = [];
  const shot = async (name: string) => {
    await Bun.$`mkdir -p ${dir}`;
    await app.shot(`${dir}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35Instructor: "full", tarsRemarks: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (first the Alps, their relief: the image sound)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T17:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 150); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    // (held level meanwhile: the Alps' peaks not met while the tracer compiles)
    await app.waitFor(`!!__bh.camera.jetFigures?.()`, 20_000);
    await app.js(
      `(() => { const c = __bh.camera, f = c.jetFigures(); Object.assign(c.jetModes, { alt: Math.round(__bh.camera.geoNow().alt), hdg: f.hdg, spd: 150 }); return 1; })()`,
    );
    await app.waitFor(`__bh.renderer.tracerSettled`, 120_000).catch(() => {});
    await shot("00-alps");
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${dir}/summary.json`, JSON.stringify(rows, null, 2)).catch(() => {});
    console.log(
      rows.map((r) => `  ${r.ok ? "✓" : "✗"} ${r.id.padEnd(12)} ${String(Math.round(r.wall)).padStart(4)} s  ${r.why ?? ""}`).join("\n"),
    );
    app?.close();
    stopServer();
  });

  for (const id of DEMOS) {
    const E = END[id] ?? FIGURE;
    test(
      `${id}: the demonstration flown whole, never stalled`,
      async () => {
        // (by real clicks: the school, the lesson's card, its demonstration)
        // (nothing over the game: a screen left open closed by its own button — never Escape, which pauses)
        for (const sel of ['[data-testid="instructor-debrief"]', '[data-testid="pause"]'])
          if (await app.js<boolean>(`!!document.querySelector('${sel}')`)) await app.click(`${sel} .k-modal-head button`).catch(() => {});
        await app.js(`(() => { window.__said = []; const c = __bh.camera;
        if (!c.__sayWrap) { const o = c.onCourseSay; c.onCourseSay = (s) => { window.__said.push(s); o?.(s); }; c.__sayWrap = 1; }
        c.ilsLast = null; c.trapLast = null; __bh.flight.school.open(); return 1; })()`);
        await app.waitFor(`!!document.querySelector('[data-testid="lesson-${id}"]')`, 5000);
        await app.click(`[data-testid="lesson-${id}"]`);
        await app.waitFor(`!!document.querySelector('[data-testid="lesson-demo"]')`, 5000);
        await app.click(`[data-testid="lesson-demo"]`);
        await app.waitFor(`__bh.flight.school.state().id === ${JSON.stringify(id)}`, 30_000);
        await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
        const t0 = Date.now();
        const wall = () => (Date.now() - t0) / 1000;
        let last = "";
        let shotMid = false;
        let why: string | undefined;
        // (the watchdog: every 2 s the lesson's state; its line printed when it changes)
        for (;;) {
          await Bun.sleep(2000);
          const s = await app.js<{
            st: {
              id: string | null;
              step: number;
              steps: number;
              name: string | null;
              stepT: number;
              stepMax: number | null;
              left: number | null;
              stalled: number;
              last: Row | null;
            };
            line: string;
            debrief: boolean;
            paused: boolean;
            lost: boolean;
          }>(`(() => { const c = __bh.camera, f = c.jetFigures?.(), st = __bh.flight.school.state();
          return { st, debrief: !!document.querySelector('[data-testid="instructor-debrief"]'), paused: document.body.classList.contains("paused"), lost: !!document.querySelector(".craft-lost"),
            line: [st.id ? st.step + "/" + st.steps + " " + st.name : "", c.ilsRun ? "ILS " + c.ilsRun.phase : "",
              c.trapRun ? "TRAP " + c.trapRun.phase + (c.trapRun.leg ? "/" + c.trapRun.leg : "") : "", c.aero ? "FIG " + c.aero.status : "",
              c.icpt ? "ICPT " + c.icpt.phase : "", f ? Math.round(f.h) + " m " + Math.round(f.V) + " m/s" : "ground " + Math.round(c.airFlight.last?.speed ?? 0) + " m/s",
              st.left !== null ? "left " + Math.round(st.left) : ""].filter(Boolean).join(" · ") }; })()`);
          if (s.line !== last)
            console.log(
              `  [${id} ${Math.round(wall())} s] ${s.line}${s.st.stalled > 10 ? ` — stalled ${Math.round(s.st.stalled)} s` : ""}`,
            );
          last = s.line;
          if (!shotMid && wall() > E.max / 3) {
            shotMid = true;
            await shot(`${id}-1-flight`);
          }
          if (s.debrief) why = "a debrief screen over the demonstration";
          else if (s.paused) why = "the game paused during the demonstration";
          else if (s.lost) why = "the craft lost during the demonstration";
          else if (s.st.stalled > STALL)
            why = `stalled ${Math.round(s.st.stalled)} s at step ${s.st.step}/${s.st.steps} « ${s.st.name} » (left ${Math.round(s.st.left ?? 0)})`;
          else if (wall() > E.max) why = `still flying after ${E.max} s at step ${s.st.step}/${s.st.steps} « ${s.st.name} »`;
          else if (!s.st.id && s.st.last) {
            // (its end: then the craft let settle a little — a landing's roll-out to its stop)
            if (id === "landing" || id === "circuit" || id === "ils") await app.waitFor(`!__bh.camera.ilsRun`, 60_000).catch(() => {});
            break;
          }
          if (why) break;
        }
        const r = await app.js<{ last: Row | null; ok: boolean; said: string[]; ils: unknown; trap: unknown; fig: unknown }>(`(() => {
        const c = __bh.camera;
        return { last: c.courseLast ?? null, ok: !!(${E.ok}), said: window.__said, ils: c.ilsLast,
          trap: c.trapLast ? { grade: c.trapLast.grade, wire: c.trapLast.wire } : null, fig: c.aero?.result ? { score: c.aero.result.score } : null }; })()`);
        await shot(why ? `${id}-STALL` : `${id}-2-end`);
        if (why) {
          const dump =
            await app.js(`(() => { const c = __bh.camera; return { state: __bh.flight.school.state(), ils: c.ilsRun ? { phase: c.ilsRun.phase, t: c.ilsRun.t, missed: c.ilsRun.missed } : null,
          trap: c.trapRun ? { phase: c.trapRun.phase, leg: c.trapRun.leg, now: c.trapRun.now } : null, icpt: c.icpt ? { phase: c.icpt.phase, last: c.icpt.last } : null,
          aero: c.aero ? { status: c.aero.status, t: c.aero.t } : null, geo: c.geoNow(), jet: c.jetFigures?.(), modes: c.jetModes }; })()`);
          await Bun.write(`${dir}/${id}-STALL.json`, JSON.stringify(dump, null, 2));
          console.log(`  ✗ ${id}: ${why}\n${JSON.stringify(dump).slice(0, 1500)}`);
        }
        if (!why && !r.last) why = "no end of the lesson";
        if (!why && r.last?.failed) why = `given up at « ${r.last.failed} »`;
        if (!why && r.last?.late.length) why = `steps left at their time at most: ${r.last.late.join(", ")}`;
        if (!why && !r.ok) why = "its end not reached (not landed and stopped, no wire, no kill, no figure judged)";
        console.log(
          `  ${id}: ${r.said.join(" | ")}\n  ils ${JSON.stringify(r.ils)} trap ${JSON.stringify(r.trap)} fig ${JSON.stringify(r.fig)}`,
        );
        rows.push({ id, ok: !why, wall: wall(), t: r.last?.t ?? 0, late: r.last?.late ?? [], failed: r.last?.failed, why });
        expect(why).toBeUndefined();
      },
      (E.max + 120) * 1000,
    );
  }

  test("no page error", () => {
    expect(app.cdp.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  });
});
