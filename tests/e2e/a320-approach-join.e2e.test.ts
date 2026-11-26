import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type IlsRunway, onRunway } from "../../src/game/ils";
import { App, E2E, stopServer } from "./lib/app";
import { MONITOR_INIT, MONITOR_STEP, type Monitor, monitorProblems } from "./lib/held";
import { placeLow } from "./lib/place";

// The A320's join (docs/PLAN-APPROCHES.md AP3, controller/a320ap.ts — its FCU along the join of game/approach-plan.ts) over real
// relief, the F-35's departures (approach-join.e2e.test.ts): the A320 placed around Nice — the sea to the south,
// the Alps' foothills to the north (1 000–2 500 m within 40 km) — on four sides, high and low, the ILS engaged by the field's
// name — its FMGC flies it: HDG and the FCU's altitude along the join, APPR armed, LOC, G/S, LAND, FLARE, ROLL OUT —; then flown
// to the stop in one call (fixed steps, the clock frozen: E2E-VOLS §3.2). Before 15 Nov 2026 the A320 flew straight to a fixed
// point 22 km out, 6 km aside: from beyond the field, over it.
//
// Done when: from each of the four departures, the join's plan is made (its entry, its points' heights over the relief said),
// LOC and G/S are captured before the final fix (9.3 km), never a round again, never nearer the field than 3 km before the
// final, never under 250 m over the ground on the join, down in the touchdown zone, graded over 14/20; the ND, once established, draws the missed approach (cyan).
// Duration: about 10 min (the boot, the A320 taken, four placings on the relief's tiles, four flights of 8–17 min of sim time, the ND's pictures — 621 s here).

interface Leg {
  name: string;
  /** flyAt: bearing from the field [°], distance [km], height over the ground [m], heading [°] */
  from: number;
  km: number;
  agl: number;
  hdg: number;
}

const LFMN = { lat: 43.6584, lon: 7.2159 };
const DEPARTURES: Leg[] = [
  { name: "south-west, low over the sea, in line", from: 225, km: 40, agl: 600, hdg: 45 },
  { name: "north, high over the mountains", from: 0, km: 40, agl: 2500, hdg: 180 },
  { name: "north-east, beyond the field over the relief", from: 45, km: 35, agl: 2000, hdg: 225 },
  { name: "south-east, low over the sea", from: 135, km: 40, agl: 600, hdg: 315 },
];

describe.skipIf(!E2E)("the A320's join over the relief (Nice)", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "a320", traffic: false, damage: false, weather: "fair", wind: 0 }); __bh.game.setDate("2026-07-10T11:00:00Z"); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    // (the field's approaches in before the first engagement: its real ILS taken, not a built one)
    const list = await app.js<{ id: string }[]>(`__bh.sys.approaches("LFMN")`);
    console.log(`  LFMN: ${list.map((a) => a.id).join(" ")}`);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  for (const L of DEPARTURES) {
    test(`${L.name}: established before the final fix, clear of the relief, down`, async () => {
      await app.scenario(`LFMN 22R · A320 · from ${L.name}`);
      const p = await app.js<{ lat: number; lon: number }>(`(() => {
        const D = Math.PI / 180, R = 6371000, d = ${L.km * 1000} / R, b = ${L.from} * D, la = ${LFMN.lat} * D, lo = ${LFMN.lon} * D;
        const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
        const lon = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
        __bh.camera.ilsOff(); return { lat: lat / D, lon: lon / D }; })()`);
      const placed = await placeLow(app, [p.lat, p.lon, L.agl, L.hdg, 125]);
      console.log(`  placed ${placed.agl} m over the ground (relief z ${placed.finest})`);
      // (the A320's autopilot engages 5 s after a lift-off — a placement is one —: 6 s flown as placed before the approach is asked, or
      // rule 13's monitor counted its first 148 steps without an autopilot — 26 Nov 2026)
      const said = await app.js<string>(
        `(() => { const c = __bh.camera; c.gearDown = false; c.pilot.throttle = 0.62; for (let i = 0; i < 30 * 6; i++) __bh.step(1 / 30); return c.ilsStart("LFMN"); })()`,
      );
      console.log(`  ${said}`);
      expect(said).toMatch(/LFMN/);
      // the join flown, one call: its plan, the least height over the ground on it, the nearest the field, the capture's place
      const j = await app.js<{
        rwy: IlsRunway;
        entry: string;
        pts: { name: string; alt: number; ground: number }[];
        minAgl: number;
        nearField: number;
        est: { lat: number; lon: number; alt: number } | null;
        phase: string;
        t: number;
        trace: string[];
      }>(`(() => {
        const c = __bh.camera, S = __bh.sys, F = __bh.fleet;
        const gnd = (lat, lon) => Math.max(S.groundAt(lat, lon) - S.geoid(lat, lon), 0);
        const A0 = c.a320App, W = A0.rwy;
        let minAgl = 1e9, nearField = 1e9, est = null, t = 0, entry = "?", pts = [], trace = [];
        // (the runway's middle — the threshold and half its length down it; flat offsets: a distance)
        const cos = Math.cos(W.lat * Math.PI / 180), h = W.hdg * Math.PI / 180;
        const mid = { lat: W.lat + Math.cos(h) * W.len / 2 / 111320, lon: W.lon + Math.sin(h) * W.len / 2 / (111320 * cos) };
        ${MONITOR_INIT}
        for (let i = 0; i < 30 * 900; i++) {
          __bh.step(1 / 30); t += 1 / 30;
          ${MONITOR_STEP}
          const R = c.a320App; if (!R) break;
          if (entry === "?") { entry = R.join.plan.entry; pts = R.join.plan.pts.map((q) => ({ name: q.name, alt: q.alt, ground: gnd(q.lat, q.lon) })); }
          const g = c.geoNow(); if (!g) continue;
          const M = c.a320Fmgc;
          if (i % 600 === 0) {
            const pose = F.pose(F.active, __bh.sim.time);
            trace.push(R.leg + " " + M.lat + "/" + M.vert + " fcu " + M.alt + " ft, agl " + S.heightOverGround("earth", pose.X, __bh.sim.time).toFixed(0) + " m, alt " + g.alt.toFixed(0) + " m, ias " + c.a320FmgcIn?.ias.toFixed(0) + ", floor " + (R.join.plan.floors.length ? "y" : "n"));
          }
          if (R.leg !== "final") {
            const pose = F.pose(F.active, __bh.sim.time);
            minAgl = Math.min(minAgl, S.heightOverGround("earth", pose.X, __bh.sim.time));
            nearField = Math.min(nearField, Math.hypot((g.lat - mid.lat) * 111320, (g.lon - mid.lon) * 111320 * cos));
          }
          if (!est && /^(LOC|LAND)/.test(M.lat) && M.vert.startsWith("G/S")) { est = { lat: g.lat, lon: g.lon, alt: g.alt }; break; }
        }
        return { rwy: W, entry, pts, minAgl, nearField, est, phase: c.a320Fmgc ? c.a320Fmgc.lat + "/" + c.a320Fmgc.vert : "none", t, trace };
      })()`);
      const at = j.est ? onRunway(j.rwy, j.est) : null;
      console.log(
        `  ${j.rwy.icao} ${j.rwy.des ?? ""} ${j.entry}: ${j.pts.map((q) => `${q.name} ${q.alt.toFixed(0)} m (ground ${q.ground.toFixed(0)})`).join(", ")}`,
      );
      console.log(
        `  established ${at ? (-at.along / 1000).toFixed(1) : "never"} km out after ${j.t.toFixed(0)} s, ${at ? at.across.toFixed(0) : "?"} m off; least ${j.minAgl.toFixed(0)} m over the ground on the join, the field ${(j.nearField / 1000).toFixed(1)} km at the nearest`,
      );
      if (!at) console.log(`  the flight, every 20 s:\n    ${j.trace.join("\n    ")}`);
      await shot(`a320-approach-join-${L.from}-established`);
      // (the ND — PLAN-APPROCHES AP3c —: the runway, its final course, the missed approach in cyan; its picture kept)
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      await app.waitFor(`!!__bh.renderer.a320Du`, 10_000);
      await Bun.sleep(1200);
      const nd = await app.js<{ cyan: number; png: string }>(`(async () => {
        const cv = __bh.renderer.a320Du.canvasOf("ND1");
        const x = cv.getContext("2d").getImageData(0, 0, 1024, 1024).data;
        // (in the middle only — x 300–724, y 300–950 —: the TRU and range labels, cyan too, are outside it)
        let k = 0;
        for (let y = 300; y < 950; y++) for (let X = 300; X < 724; X++) { const i = 4 * (y * 1024 + X); if (x[i] < 80 && x[i + 1] > 180 && x[i + 2] > 220) k++; }
        const b = await cv.convertToBlob({ type: "image/png" });
        const u = new Uint8Array(await b.arrayBuffer());
        let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
        __bh.freeze(true);
        return { cyan: k, png: btoa(s) };
      })()`);
      console.log(`  the ND: ${nd.cyan} cyan pixels (the missed approach)`);
      if (shots) await Bun.write(`${shots}/a320-approach-join-${L.from}-nd.png`, Buffer.from(nd.png, "base64"));
      // (about 500 at Nice, 15 Nov 2026: the missed approach's line — the cyan labels outside the window counted none)
      expect(nd.cyan).toBeGreaterThan(150);
      expect(j.phase).toMatch(/^(LOC|LAND).*\/G\/S/);
      expect(at!.along).toBeLessThan(-9300);
      expect(j.minAgl).toBeGreaterThan(250);
      expect(j.nearField).toBeGreaterThan(3000);
      for (const q of j.pts) expect(q.alt - q.ground).toBeGreaterThan(290);
      // then down: the final, the flare, the stop — graded
      const d = await app.js<{
        score: number;
        touch: { along: number; across: number; vs: number } | null;
        missed: number;
        t: number;
        mon: Monitor;
      }>(`(() => {
        const c = __bh.camera; let t = 0, missed = 0, last = "final";
        for (let i = 0; i < 30 * 400; i++) { __bh.step(1 / 30); t += 1 / 30; ${MONITOR_STEP} const R = c.a320App; if (!R) break;
          if (last === "final" && R.leg === "entry") missed++; last = R.leg; }
        __bh.freeze(false);
        return { score: c.ilsLast?.score ?? 0, touch: c.ilsLast?.touch ?? null, missed, t, mon: window.__mon };
      })()`);
      console.log(
        `  down in ${d.t.toFixed(0)} s: ${d.score}/20, touchdown ${d.touch?.along.toFixed(0)} m in, ${d.touch?.across.toFixed(1)} m off, ${d.touch?.vs.toFixed(2)} m/s; ${d.missed} missed`,
      );
      expect(d.missed).toBe(0);
      expect(d.touch!.along).toBeGreaterThan(150);
      expect(d.touch!.along).toBeLessThan(900);
      expect(d.score).toBeGreaterThan(14);
      // (rule 13 of E2E-VOLS: the whole flight watched step by step — held by its autopilot and autothrottle, never at idle with nobody on
      // the throttle, never near the stall, the gear down and locked at the touch)
      const prob = monitorProblems(d.mon, { landed: true });
      console.log(`  rule 13: ${JSON.stringify(d.mon)}${prob.length ? ` — ${prob.join("; ")}` : " — conforms"}`);
      expect(prob).toEqual([]);
      await shot(`a320-approach-join-${L.from}-stopped`);
    }, 300_000);
  }
});
