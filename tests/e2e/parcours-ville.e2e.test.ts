import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { CRUISE, expectFlight, type FlightState, flightState } from "./lib/flight-state";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";
// PLAN-J6 J6-1 — the journey « take off then turn over a city » (strategy §19.13), played end to end in the main profile (raster, the
// cockpit): the F-35 lined up at Toulon-Hyères, the afternoon, fair weather; the automatic take-off by the real key U; then to
// Toulon's centre at 500 m (over the sea's level) and 150 m/s under the autopilot (its bearing set every 10 s), a turn over the city towards the harbour, the view back
// over the shoulder (outside, 60 m ahead looking back — j2-page-camera's view); then the cockpit again. At every image all along: the
// page's gaps (a frozen page), the F-35's panoramic display's age (ship.displayAges — J3-0's bound, p95 < 70 ms, asserted where it is seen: the cockpit's segments), the relief's
// cover under the camera (earthTiles.coverAt: a "hole", a level published without the camera's tile — recorded), the GPU's time.
// Over the city: the visibility's surface on a grid (renderer.surfaceAt: buildings, trees, ground by distance — buildings within
// 2 km on arriving, ahead, asserted present — PROBLEMES). Shots at each key state. Asserted: airborne within 20 s of U, no GCAS, the turn made over the city, the
// instruments' age, buildings ahead on arriving, no GPU error, the page never frozen over 1 s. Recorded (PLAN-J6 §3: thresholds still to read):
// the holes' share, the GPU time by segment.
// PV_QUICK_LEAD (default 2.5, the game's): renderer.sceneryQuickLead, the fast flight's scenery lead (a measure, PROBLEMES).
// Rule 13 (E2E-VOLS): frozen while the data load until lined up; climbing, then after every segment the craft as flown — autopilot,
// autothrottle, thrust applied, airspeed, attitude, gear up (lib/flight-state.ts).
// Duration: ~6 min on kerr-mini (the airfield's data, the take-off, ~2 min of flight, the city's turn, the view back).
// Done when: the view back held 15 s and the cockpit back, parcours-ville.json written.
afterAll(stopServer);
const OUT = process.env.PV_OUT ?? "remote-results/parcours-ville";
/** Toulon's centre (the turn's place) — the city west of the airfield */
const TOULON = { lat: 43.12, lon: 5.93 };
type Seg = { name: string; frames: number; gapMax: number; ages: number[]; gpu: number[]; holeImages: number; at: unknown };
test.skipIf(!E2E)(
  "J6-1: take off from Toulon-Hyères, turn low over Toulon — instruments' age, buildings near, the relief under the camera",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        __bh.renderer.sceneryQuickLead = ${Number(process.env.PV_QUICK_LEAD ?? 2.5)}; return 1; })()`);
      // (the craft switched first — asynchronous —, then lined up: E2E-VOLS §7)
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (the airfield's tile first — a world airfield, lined up by its code once its tile is in (game.lineUp): placed over J0's start,
      // next to it, the data waited for)
      // (rule 13 of E2E-VOLS: frozen while the data load — the craft does not glide at idle meanwhile —, until lined up and let go)
      await app.js(
        `(() => { __bh.freeze(true); __bh.game.setDate("2026-07-10T13:30:00Z"); __bh.game.flyAt(${J0_SCENE.start.join(", ")}); return 1; })()`,
      );
      await app
        .dataSettled("near Toulon-Hyères", { maxMs: 90_000 })
        .catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
      const rwy = "LFTH";
      const lineUp = `(() => { __bh.game.setDate("2026-07-10T13:30:00Z"); __bh.game.set("weather", "fair");
        const r = __bh.game.lineUp(${JSON.stringify(rwy)}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return r; })()`;
      out.lineUp = await app.js<string>(lineUp);
      await app.dataSettled("Toulon-Hyères", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
      out.lineUpAgain = await app.js<string>(lineUp);
      await app.settled(90_000);
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      await app.shot(`${OUT}/1-lined-up.png`);
      // (the take-off: the real key U, the clock running; airborne within 20 s)
      await app.js(`(() => { const c = __bh.camera; window.__said = []; if (!c.__saidHook) { const prev = c.onPilotMessage;
        c.onPilotMessage = (m) => { window.__said.push(String(m)); prev?.(m); }; c.__saidHook = 1; } return 1; })()`);
      await app.press("KeyU", "u");
      const off = await app.js<{
        off: number | null;
      }>(`(async () => { const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let off = null;
        while (performance.now() - t0 < 25000) { await f(); if (off === null && !c.rolling && !c.ourLanded) off = (performance.now() - t0) / 1000;
          if (off !== null && performance.now() - t0 > off * 1000 + 6000) break; }
        return { off }; })()`);
      console.log(`  take-off: ${JSON.stringify(off)}`);
      out.takeoff = off;
      expect(off.off ?? 99).toBeLessThan(20);
      // (rule 13: climbing — the engine at take-off thrust, the airspeed, the attitude of a climb)
      const climbing = await flightState(app);
      out.climbing = climbing;
      expectFlight(climbing, "climbing", { engineMin: 0.5, speedMin: 60, pitchMax: 25, bankMax: 20, aglMin: 10 });
      await app.shot(`${OUT}/2-climbing.png`);
      // (west towards Toulon, 500 m over the sea's level, 150 m/s: the autopilot and the autothrottle set — apSet, not the toggles)
      await app.js(`(() => { __bh.camera.apSet({ ap: true, athr: true, alt: 500, hdg: 270 * Math.PI / 180, spd: 150 }); return 1; })()`);
      // in the page: `ms` of images — each one's gap, the display's age, the GPU time, a hole under the camera —, the place at the end
      const seg = (name: string, ms: number, until = "false") =>
        app.js<Seg>(`(async () => {
          const R = __bh.renderer, t = R.earthTiles, c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
          const ages = [], gpu = []; let gapMax = 0, holeImages = 0, frames = 0, last = performance.now(), done = R.completedFrames;
          const t0 = performance.now();
          while (performance.now() - t0 < ${ms}) {
            const now = await f(); gapMax = Math.max(gapMax, now - last); last = now; frames++;
            const ag = R.ship?.displayAges?.(now).jet; if (ag != null) ages.push(+ag.toFixed(1));
            if (R.completedFrames !== done) { done = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); }
            const g = c.geoNow(); const v = t.coverAt(g ? { lat: g.lat, lon: g.lon } : undefined); if (v.holes.length) holeImages++;
            if (${until}) break;
          }
          const g = c.geoNow();
          return { name: ${JSON.stringify(name)}, frames, gapMax: +gapMax.toFixed(1), ages, gpu, holeImages,
            at: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), hdg: Math.round(((g.track ?? 0) * 180 / Math.PI + 360) % 360),
              gs: Math.round(g.gs ?? 0), mount: __bh.settings.shipMount,
              paused: document.body.classList.contains("paused"), ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null,
              // (the scenery — its scene's centre from the craft [km], its buildings, a quick first one, what it is doing)
              scenery: (() => { const q = R.earthScenery.stats(); const km = q.lat === null ? null
                : +(Math.hypot((q.lat - g.lat) * 111, (q.lon - g.lon) * 111 * Math.cos(g.lat * Math.PI / 180))).toFixed(1);
                return { centreKm: km, buildings: q.bdtopoBuildings + q.overtureBuildings, trees: q.trees, quick: q.quick, status: q.status,
                  progress: q.progress, corridorM: q.corridorM, phases: q.phases }; })() } }; })()`);
      // (the visibility's surface on a 48 × 27 grid — renderer.surfaceAt: kind and distance —, by kind and distance band)
      const surface = async (name: string) => {
        const grid = await app.js<{ kind: string; d: number }[]>(`(async () => {
          const pts = []; for (let j = 0; j < 27; j++) for (let i = 0; i < 48; i++) pts.push([(i + 0.5) / 48, (j + 0.5) / 27]);
          const res = [];
          for (let k = 0; k < pts.length; k += 256) {
            const part = await Promise.all(pts.slice(k, k + 256).map(([x, y]) => __bh.renderer.surfaceAt(x, y)));
            for (const r of part) res.push({ kind: r?.kind ?? "none", d: Math.round(r?.nearest ?? -1) });
          }
          return res; })()`);
        const bands: Record<string, number> = {};
        for (const p of grid) {
          const band = p.d < 0 ? "none" : p.d < 1000 ? "<1 km" : p.d < 2000 ? "1–2 km" : p.d < 5000 ? "2–5 km" : ">5 km";
          bands[`${p.kind} ${band}`] = (bands[`${p.kind} ${band}`] ?? 0) + 1;
        }
        console.log(`  ${name}, the surface by kind and distance: ${JSON.stringify(bands)}`);
        return { bands, buildingsNear: grid.filter((p) => /build/i.test(p.kind) && p.d >= 0 && p.d < 2000).length };
      };
      const segs: Seg[] = [];
      // (rule 13: after each segment, the craft as a pilot would leave it — its holds, its engine, its airspeed, its attitude, gear up)
      const flown: Record<string, FlightState> = {};
      const fly = async (name: string) => {
        flown[name] = await flightState(app);
        expectFlight(flown[name]!, name, { ...CRUISE, aglMin: 100, bankMax: 40 });
      };
      const say = (s: Seg) => {
        const a = [...s.ages].sort((x, y) => x - y);
        const g = [...s.gpu].sort((x, y) => x - y);
        console.log(
          `  ${s.name}: ${s.frames} images, gap max ${s.gapMax} ms, display age p95 ${a[Math.floor(a.length * 0.95)] ?? "-"} ms, GPU p50 ${g[g.length >> 1] ?? "-"} ms, holes ${s.holeImages} — ${JSON.stringify(s.at)}`,
        );
      };
      // (to the city: 10 s chunks, the heading set each chunk to Toulon's bearing, until within 1.5 km of its centre; 240 s at most)
      const steer = `(() => { const c = __bh.camera, g = c.geoNow(), D = Math.PI / 180;
        const y = Math.sin((${TOULON.lon} - g.lon) * D) * Math.cos(${TOULON.lat} * D);
        const x = Math.cos(g.lat * D) * Math.sin(${TOULON.lat} * D) - Math.sin(g.lat * D) * Math.cos(${TOULON.lat} * D) * Math.cos((${TOULON.lon} - g.lon) * D);
        c.apSet({ ap: true, athr: true, alt: 500, hdg: Math.atan2(y, x), spd: 150 }); return 1; })()`;
      const atCity = `Math.hypot((c.geoNow().lat - ${TOULON.lat}) * 111000, (c.geoNow().lon - ${TOULON.lon}) * 81000) < 1500`;
      for (let k = 0; k < 24; k++) {
        if (k > 0) await app.js(steer);
        const s = await seg(`cruise-${k}`, 10_000, atCity);
        segs.push(s);
        say(s);
        if (s.at && (s.at as { paused: boolean }).paused) throw new Error(`paused in flight — ${JSON.stringify(s.at)}`);
        await fly(`cruise-${k}`);
        if (await app.js<boolean>(`(() => { const c = __bh.camera; return ${atCity}; })()`)) break;
        if (k === 23) throw new Error(`not over Toulon after 240 s — ${JSON.stringify(s.at)}`);
      }
      await app.shot(`${OUT}/3-over-toulon.png`);
      const arrival = await surface("arriving over Toulon (the cockpit)");
      // (the turn over the city: left to 180°, towards the harbour)
      await app.js(`(() => { __bh.camera.apSet({ ap: true, athr: true, alt: 500, hdg: 180 * Math.PI / 180, spd: 150 }); return 1; })()`);
      const turn = await seg("turn", 30_000);
      segs.push(turn);
      say(turn);
      await fly("turn");
      await app.shot(`${OUT}/4-turning.png`);
      // (the view back over the shoulder: outside, 60 m ahead of the craft looking back — j2-page-camera's view)
      await app.js(`(async () => { __bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset();
        Object.assign(__bh.camera.outside, { yaw: 180, pitch: 8, dist: 60 }); for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      const back = await seg("view-back", 15_000);
      segs.push(back);
      say(back);
      await fly("view-back");
      await app.shot(`${OUT}/5-view-back.png`);
      const behind = await surface("the view back");
      out.surface = { arrival: arrival.bands, back: behind.bands };
      const buildingsNear = arrival.buildingsNear + behind.buildingsNear;
      await app.js(`(async () => { __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
        for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
      const again = await seg("cockpit-again", 8_000);
      segs.push(again);
      await fly("cockpit-again");
      out.flown = flown;
      say(again);
      await app.shot(`${OUT}/6-cockpit-again.png`);
      // (the instruments' age where they are seen — the cockpit's segments; outside, the display not drawn is not uploaded: its age grows)
      const all = segs
        .filter((s) => (s.at as { mount?: string } | null)?.mount === "cockpit")
        .flatMap((s) => s.ages)
        .sort((x, y) => x - y);
      const p95 = all[Math.floor(all.length * 0.95)] ?? 9e9;
      const gapMax = Math.max(...segs.map((s) => s.gapMax));
      const said = await app.js<string[]>(`window.__said ?? []`);
      const hdgEnd = (turn.at as { hdg: number } | null)?.hdg ?? -1;
      out.segments = segs.map((s) => {
        const g = [...s.gpu].sort((x, y) => x - y);
        const a = [...s.ages].sort((x, y) => x - y);
        return {
          name: s.name,
          frames: s.frames,
          gapMax: s.gapMax,
          ageP95: a[Math.floor(a.length * 0.95)] ?? null,
          gpuP50: g[g.length >> 1] ?? null,
          gpuP95: g[Math.floor(g.length * 0.95)] ?? null,
          holeShare: +(s.holeImages / Math.max(s.frames, 1)).toFixed(3),
          at: s.at,
        };
      });
      out.summary = { displayAgeP95: p95, gapMax, buildingsNear, gcas: said.some((m) => /GCAS/.test(m)), turnHdg: hdgEnd };
      console.log(`  summary: ${JSON.stringify(out.summary)}`);
      expect(said.some((m) => /GCAS/.test(m))).toBe(false);
      expect(p95).toBeLessThan(70);
      expect(gapMax).toBeLessThan(1000);
      // (buildings near — on arriving, ahead of the cockpit, within 2 km: before the fast flight's scenery lead was lengthened (15 Nov
      // 2026, renderer.sceneryQuickLead 1.2 → 2.5) none in 3 runs of 4; since 36–38 — PROBLEMES-A-REGLER, « Le décor ne suit pas un vol rapide »)
      expect(arrival.buildingsNear).toBeGreaterThan(0);
      expect(Math.abs(((((hdgEnd - 180) % 360) + 540) % 360) - 180)).toBeLessThan(60);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/parcours-ville.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
