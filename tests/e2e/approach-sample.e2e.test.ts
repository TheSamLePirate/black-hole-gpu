import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The campaign's sample flown (docs/PLAN-APPROCHES.md AP10b): the ends scripts/approach-campaign.ts picked — one per category, a
// typical one whose slope is clear (docs/progress/approches/ap10-sample.json): a real ILS, an LDA, a renumbered runway, a built
// approach, an approximate runway, an unpaved one, a high field, one ringed by mountains, a short one — flown by the craft the
// sample names (APS_CRAFT: f35, the default, or a320), the relief the world map's (no tiles: the campaign's own judge). Each: placed
// 25 km out, 60° off the final, 900 m over the ground, heading for the field; the approach engaged on that end (its field and
// runway named); flown in fixed steps, the clock held (E2E-VOLS §3.2) — two frames drawn every 5 s, the world's runways measured as in
// play —, to the stop or a missed approach.
//
// Done when: every end of the sample engaged on its own runway, its join flown clear of the ground (never under 150 m over it before
// the final), down on the runway (touched past its threshold) and graded — or refused with its reason (an end the craft cannot use, a built
// approach the game's relief refuses); the table printed.
// Duration: the F-35 about 4 min (nine flights), the A320 about 6 min (five) — the A320 better sent to kerr-mini (remote.ts).

interface Pick {
  cat: string;
  craft: "f35" | "a320";
  field: string;
  end: string;
  kind: string;
  source: string;
  len: number;
  elev: number;
}

const CRAFT = (process.env.APS_CRAFT ?? "f35") as "f35" | "a320";
// (APS_ONLY=FIELD:END — e.g. SLCB:05 —: that end alone, flown by the craft named, its category « asked »)
const ONLY = process.env.APS_ONLY?.split(":");
const SAMPLE = ONLY
  ? [{ cat: "asked", craft: CRAFT, field: ONLY[0]!, end: ONLY[1]!, kind: "?", source: "?", len: 0, elev: 0 } as Pick]
  : ((await Bun.file("docs/progress/approches/ap10-sample.json").json()) as Pick[]).filter((p) => p.craft === CRAFT);

describe.skipIf(!E2E)(`the campaign's sample flown — ${CRAFT}`, () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const table: string[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: false });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "${CRAFT}", traffic: false, damage: false, weather: "fair", wind: 0, sound: false }); __bh.game.setDate("2026-07-10T11:00:00Z"); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "${CRAFT}"`, 30_000);
  }, 180_000);
  afterAll(() => {
    console.log(
      `\n  | category | end | approach | engaged | least over the ground | landed | grade |\n  |---|---|---|---|---:|---|---:|\n${table.join("\n")}`,
    );
    app?.close();
    stopServer();
  });

  for (const P of SAMPLE)
    test(`${P.cat}: ${P.field} ${P.end} (${P.kind}, ${P.source})`, async () => {
      // (its approaches in: the field's tile)
      const ids = await app.js<string[]>(`__bh.sys.approaches(${JSON.stringify(P.field)}).then((l) => l.map((a) => a.id))`);
      const a = await app.js<{ crs: number; thr: { lat: number; lon: number } } | null>(
        `__bh.sys.approaches(${JSON.stringify(P.field)}).then((l) => { const a = l.find((x) => x.rwy === ${JSON.stringify(P.end)}); return a ? { crs: a.crs, thr: a.thr } : null; })`,
      );
      expect(a).not.toBeNull();
      // (25 km out, 60° off the final's back course, heading for the threshold)
      await app.js(`(async () => { const D = Math.PI / 180, R = 6371000, a = ${JSON.stringify(a)};
        const b = (a.crs + 180 + 60) * D, d = 25000 / R, la = a.thr.lat * D, lo = a.thr.lon * D;
        const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
        const lon = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
        const hdg = (Math.atan2(Math.sin(lo - lon) * Math.cos(la), Math.cos(lat) * Math.sin(la) - Math.sin(lat) * Math.cos(la) * Math.cos(lo - lon)) / D + 360) % 360;
        // (the relief under the place in before it is placed — flyAt reckons its height over the relief known: at Cochabamba, 2 548 m, the
        // F-35 was put at 853 m inside the mountain, the relief not in yet — E2E-VOLS §7): placed, the relief waited for (its height there
        // steady 1 s, 15 s at most), placed again
        const fly = () => { __bh.game.flyAt(lat / D, lon / D, 900, hdg, ${CRAFT === "f35" ? 150 : 120}); __bh.settings.shipMount = "cockpit"; };
        const frame = () => new Promise((q) => requestAnimationFrame(q));
        __bh.camera.ilsOff(); __bh.freeze(false); fly();
        const t0 = performance.now(); let h = NaN, since = performance.now();
        while (performance.now() - t0 < 15000) { __bh.touch(); await frame(); const g = __bh.sys.groundAt(lat / D, lon / D);
          if (Math.abs(g - h) > 1) { h = g; since = performance.now(); } else if (performance.now() - since > 1000 && g !== 0) break; }
        fly(); __bh.freeze(true); for (let i = 0; i < 3; i++) __bh.step(1 / 30); return 1; })()`);
      if (CRAFT === "f35")
        await app.js(`(() => { __bh.fleet.fuel.f35 = 3500; __bh.camera.pilot.throttle = __bh.camera.pilot.engineNow = 0.6; return 1; })()`);
      else
        await app.js(
          `(() => { __bh.camera.pilot.throttle = 0.62; __bh.camera.gearDown = false; for (let i = 0; i < 30 * 7; i++) __bh.step(1 / 30); return 1; })()`,
        );
      // (the last flight's grade cleared: OIFK once read OETN's)
      await app.js(`(() => { __bh.camera.ilsLast = null; return 1; })()`);
      const said = await app.js<string>(`__bh.camera.ilsStart(${JSON.stringify(P.field)}, { runway: ${JSON.stringify(P.end)} })`);
      console.log(`  ${P.field} ${P.end} (${ids.join(" ")}): ${said}`);
      const engaged = await app.js<boolean>(`!!(__bh.camera.ilsRun || __bh.camera.a320App)`);
      const free = P.cat === "not paved" || P.cat.startsWith("short");
      if (!engaged) {
        table.push(`  | ${P.cat} | ${P.field} ${P.end} | ${P.kind} | no — ${said} | — | — | — |`);
        // (refused with its reason: an end the craft cannot land on, or a built approach whose slope meets the game's relief — finer
        // than the campaign's map: a refusal understood, said; a real approach is never refused — any other: a failure)
        // (the end's approach built: none real there — its ids « C05 » only — when the sample does not say)
        const built =
          P.source === "built" || (P.source === "?" && !ids.some((id) => !id.startsWith("C") && id.slice(1).replace(/-.*$/, "") === P.end));
        expect(free || (built && /relief|relief/.test(said))).toBe(true);
        return;
      }
      // the flight, in fixed steps: the least height over the ground before the final, down and graded
      const r = await app.js<{
        minAgl: number;
        landed: boolean;
        score: number | null;
        touch: { along: number; across: number; vs: number } | null;
        missed: number;
        phase: string;
        t: number;
        rwy: string;
        trace: string[];
      }>(`(async () => {
        const c = __bh.camera, S = __bh.sys, F = __bh.fleet, frame = () => new Promise((q) => requestAnimationFrame(q));
        let minAgl = 1e9, missed = 0, t = 0, rwy = "", trace = [], ga = false;
        for (let i = 0; i < 30 * 1200; i++) {
          __bh.step(1 / 30); t += 1 / 30;
          // (every 5 s of flight two frames drawn: the world's runways measured as the craft nears them — runways3d —, the approach's
          // level following theirs, as in play; one synchronous loop never drew a frame: the F-35 aimed at the data's level and met the
          // relief before OEKF's threshold)
          if (i % 150 === 0) { __bh.touch(); await frame(); await frame(); }
          const R = c.ilsRun, A = c.a320App;
          if (!R && !A) break;
          rwy = (R ?? A).rwy.des ?? "";
          missed = Math.max(missed, R?.missed ?? 0);
          // (the least height counted on the way in only: a go-around's climb over the runway — a bounce's — is not a join)
          if (c.a320Fmgc?.phase === "go around") ga = true;
          const final = ga || (R ? R.phase === "final" || R.phase === "flare" || R.phase === "rollout" || R.missed > 0 : A.leg === "final");
          if (!final) { const pose = F.pose(F.active, __bh.sim.time); minAgl = Math.min(minAgl, S.heightOverGround("earth", pose.X, __bh.sim.time)); }
          if (missed > 1) break;
          if (i % (A && (A.leg === "final" || ga) ? 150 : 1800) === 0) { const g = c.geoNow(), M = c.a320Fmgc;
            trace.push(Math.round(t) + " s " + (R ? R.phase : A.leg + " " + M?.lat + "/" + M?.vert) + " alt " + (g?.alt ?? NaN).toFixed(0) + " gs " + (g?.gs ?? NaN).toFixed(0) + " agl " + S.heightOverGround("earth", F.pose(F.active, __bh.sim.time).X, __bh.sim.time).toFixed(0) + (A ? " lever " + c.pilot.throttle.toFixed(2) + " n1 " + (c.a320FmgcIn?.n1.now ?? NaN).toFixed(0) + " thr " + M?.thrust + " ra " + c.a320FmgcIn?.ra + " gnd " + c.a320FmgcIn?.onGround + " ap " + M?.ap + " fpa " + (c.a320FmgcIn?.fpa ?? NaN).toFixed(1) + " fcu " + M?.alt + " join " + (A.join ? A.join.plan.entry + "/" + A.join.i + ":" + A.join.plan.pts.map((q) => q.name + Math.round(q.alt) + "f" + Math.round(q.floor)).join(",") : "") + " along " + Math.round(S.onRunwayOf ? 0 : ((g.lat - A.rwy.lat) * 111320 * Math.cos(A.rwy.hdg * Math.PI / 180) + (g.lon - A.rwy.lon) * 111320 * Math.cos(g.lat * Math.PI / 180) * Math.sin(A.rwy.hdg * Math.PI / 180))) + " altFt " + A.altFt : "")); }
        }
        const L = c.ilsLast;
        return { minAgl, landed: !!L, score: L?.score ?? null, touch: L?.touch ?? null, missed, phase: String(c.ilsRun?.phase ?? c.a320App?.leg ?? "done"), t, rwy, trace };
      })()`);
      console.log(
        `  flown ${r.t.toFixed(0)} s: least ${r.minAgl.toFixed(0)} m over the ground before the final, ${r.landed ? `down, ${r.score}/20, ${r.touch ? `${r.touch.along.toFixed(0)} m in, ${r.touch.across.toFixed(1)} m off, ${r.touch.vs.toFixed(2)} m/s` : ""}` : `not down (${r.phase})`}, missed ${r.missed}`,
      );
      if (!r.landed) console.log(`  the flight, every 60 s:\n    ${r.trace.join("\n    ")}`);
      table.push(
        `  | ${P.cat} | ${P.field} ${P.end} | ${P.kind} (${P.source}) | ${r.rwy} | ${r.minAgl.toFixed(0)} m | ${r.landed ? "yes" : `no (${r.phase})`} | ${r.score ?? "—"} |`,
      );
      if (shots) {
        await Bun.$`mkdir -p ${shots}`;
        await app.js(
          `(async () => { __bh.freeze(false); const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 10; i++) await f(); __bh.freeze(true); return 1; })()`,
        );
        await app.shot(`${shots}/sample-${CRAFT}-${P.field}-${P.end}.png`);
      }
      expect(r.rwy).toBe(P.end);
      expect(r.minAgl).toBeGreaterThan(150);
      expect(r.landed).toBe(true);
      expect(r.touch!.along).toBeGreaterThan(0);
      expect(r.score!).toBeGreaterThanOrEqual(10);
    }, 240_000);
});
