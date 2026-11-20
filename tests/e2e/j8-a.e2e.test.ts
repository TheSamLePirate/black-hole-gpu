import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { FOREST_NEAR_M, MESH_NEAR_M } from "../../src/system/building-cells";
import { J8A_LOW_TRACKS, J8A_TRACKS } from "../../src/system/j8a-tracks";
import { cellsAlong } from "../../src/system/zone-cells";
import { corridorDisc, turnRadiusFor } from "../../src/system/zones";
import { App, E2E, stopServer } from "./lib/app";
import { pageWitness } from "./lib/witness";
import { CRUISE, expectFlight, flightState } from "./lib/flight-state";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J8 J8-A — the plan's demonstration (Sam, 16 Nov 2026: « un vol au-dessus de Paris et au-dessus de Toulon-Hyères avec un max
// de buildings, tous chargés avant le vol, en jour et nuit ») on the shared tracks (src/system/j8a-tracks.ts — the corridor's zone is
// built on them). Per track (J8A_TRACKS: their names) and per hour (day, night — J8A_HOURS): the F-35 put in the air over the track's
// first point, the world frozen, everything loaded (__bh.sys.flightReady — the tiles, the near scene whole, the building cells, the far
// layer's cells all resident; said every 10 s, 10 min at most); then flown along the track under the autopilot (its heading set every
// second along the segment to the next point (a point 1.5 km ahead on it), the next a turn's lead before it; rule 13 after each leg: the holds, the engine, the airspeed, the attitude, gear up).
// All along: the page's gaps, the GPU time, the near scene's quick ones, the real network in flight (the e2e disk cache's misses; the page's requests apart),
// the buildings drawn (the near scene's, the far layer's boxes and quads); a cockpit shot at each point, a view from outside at the end.
// Not yet a pass/fail on « no request, no quick scene » (J8A_STRICT: asserted; J8A_TRACK_READY: flightReady over the whole track) — J8-5 and J8-8 still to finish; it fails on the
// flight itself (rule 13), a GPU error or the device lost. j8-a.json.
// J8A_REST_S [s]: a rest after each zone, the world frozen (the M1 Max cooled before its flight).
// The near buildings from their mesh cells (renderer.nearCellsOn — J8-8, on by default since Sam's decision of 17 Nov 2026; J8A_CELLS=0:
// off, the near scene's own as before): their cells within reach resident before the take-off too.
// J8A_LOW=1 (PLAN-J8 A6 criterion 8): the low tracks too (j8a-tracks.ts J8A_LOW_TRACKS — Toulon's centre, the Marais — 150 m then
// 50 m over the ground; rule 13's floor 25 m on them), for VB2–VB7's details. After each leg, criterion 4: the prepared building
// cells' census by ring round the craft (__bh.sys.census) against the cells drawn (__bh.sys.drawnCensus) — strict: 98 % or more drawn
// within 10 km. At each flight's last point, criterion 5: the near meshes' and the far layer's buildings' mean colours within 0.8–3.5 km
// (surfaceAt on a 32 × 18 grid of the lower half, the canvas's colours, the craft and the UI hidden) and their gap — said, not asserted.
// J8A_WITNESS=1: the page's witness (its JS heap asked every 30 s on its own timer, « NO ANSWER in 10 s » when it does not answer) —
// to date a page that stops answering (Toulon's zone after Paris's flights in one page, 17 Nov 2026).
// J8A_FOREST=0 (J8-8b lot 2 — on by default since 17 Nov 2026): the near scene's forest decided case by case again, not assembled from its prepared cells (renderer.forestCellsOn — the zone's, the forest
// pool's), each leg's last scene's cells said (forestPrepared: read, missing, cases covered).
// J8A_BUDGET [MiB, default 72]: the far layer's pool (renderer.farBudgetMiB — all Paris resident; the default since Sam's « ok 72 »).
// J8A_OFFLINE=1 (with J8A_TRACK_READY; the approaches' session, agreed 17 Nov 2026): each track flown with the network cut — its zone
// made online, then the network cut and the page loaded again (the zone and the Service Worker kept in the profile), its settings set
// again, ready, flown; the network back before the next track's zone. Strict: the Service Worker's network requests over each flight
// 0 too (__bh.pwa.stats().served.network — counted before the fetch: every attempt), the map's tiles apart (OpenStreetMap's, the
// cockpit's tactical map: no zone holds them — their usage policy forbids bulk fetching —, told in swKinds).
// Duration: ~16 min on kerr-mini without J8A_TRACK_READY (two tracks, day and night, ~3 min of flight each, the preload from the disk);
// with it ~15 min of zone per track and J8A_REST_S more (Paris by day on the M1 Max with a 600 s rest: ~40 min) — the run reckons its
// own (app.estimate: the banner's and the monitor's estimate) and declares its steps (app.steps: the zone, the rest, the loading,
// each leg), each with its progress (the zone's chains, then its mesh and forest cells; the rest's seconds; what the loading still
// waits for) and its result (app.stepDone).
// Done when: every track flown by day and by night, j8-a.json written.
afterAll(stopServer);
const MACHINE = process.env.J8A_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J8A_OUT ?? `remote-results/j8-a/${MACHINE}`;
// (J8A_LOW=1: the low tracks too — J8A_LOW_TRACKS, Toulon's centre and the Marais at 150 m then 50 m over the ground, PLAN-J8 A6
// criterion 8; J8A_TRACKS names any of either list)
const LOW = process.env.J8A_LOW === "1";
const TRACKS = [...J8A_TRACKS, ...(LOW || process.env.J8A_TRACKS ? J8A_LOW_TRACKS : [])].filter((t) =>
  process.env.J8A_TRACKS ? process.env.J8A_TRACKS.split(",").includes(t.name) : LOW || J8A_TRACKS.includes(t),
);
const isLow = (t: { name: string }) => J8A_LOW_TRACKS.some((k) => k.name === t.name);
/** J8A_TRACK_READY: flightReady over the whole track (its zone's corridor, its far and street cells — dd36cb80), not the start's view
 *  alone: the track's corridor zone made first in this run's profile (the Service Worker on; its chains from the e2e's disk — the
 *  corridor's put there by j8-zone-paris) */
const TRACK_READY = !!process.env.J8A_TRACK_READY;
/** J8A_OFFLINE: each track flown with the network cut, from its zone alone (needs J8A_TRACK_READY) */
const OFFLINE = TRACK_READY && !!process.env.J8A_OFFLINE;
const HOURS = (process.env.J8A_HOURS ?? "day,night").split(",") as ("day" | "night")[];
const D = Math.PI / 180;
/** the data's hosts — a request to one in flight: not all loaded before */
const HOSTS = "geopf|openfreemap|overturemaps|elevation-tiles|eox|earthdata|mapterhorn|terrascope";
type Leg = {
  name: string;
  frames: number;
  gapMax: number;
  gpu: number[];
  quick: number;
  requests: number;
  near: number;
  far: { boxes: number; quads: number } | null;
  /** (PLAN-J8 A6 criterion 4) each ring's buildings: prepared (the cells' census), drawn (the cells drawn now), their share */
  census?: { km: number; census: number; drawn: number; share: number }[];
  /** (J8A_FOREST) the last scene's forest cells: read, missing, cases covered (null: not asked) */
  forest: { cells: number; missing: number; cases: number } | null;
  /** the near scene's own preparations in the leg: their worker's times [ms] (full, quick) and how often « a fast flight » held */
  scenes: { full: number[]; quick: number[]; fastFlight: number };
  at: unknown;
};
test.skipIf(!E2E)(
  "J8-A: Paris and Toulon-Hyères flown by day and by night, everything loaded before — no request, no quick scene, the buildings drawn",
  async () => {
    mkdirSync(OUT, { recursive: true });
    // (J8A_TRACK_READY: the Service Worker on — the track's corridor zone made in this profile, from the e2e's disk)
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true, sw: TRACK_READY });
    // (J8A_WITNESS=1: the page's witness — a Runtime.evaluate of its JS heap every 30 s on its own timer, 10 s to answer —, the time
    // a page stops answering dated to 30 s: the freeze of Toulon's zone after Paris's flights in one page, 17 Nov 2026; the
    // approaches session's pageWitness, lib/witness.ts)
    const witness = process.env.J8A_WITNESS === "1" ? pageWitness(app) : () => {};
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, flights: {} };
    try {
      // (the far layer's pool for the whole of Paris — 24 MiB holds a quarter of it, never « all loaded »: 72 MiB, the default since
      // Sam's « ok 72 »; J8A_BUDGET [MiB])
      // (the run's settings — set again after J8A_OFFLINE's reload)
      const setup = async () => {
        await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
          __bh.renderer.farBudgetMiB = ${Number(process.env.J8A_BUDGET ?? 72)};
          __bh.renderer.nearCellsOn = ${process.env.J8A_CELLS !== "0"};
          __bh.renderer.forestCellsOn = ${process.env.J8A_FOREST !== "0"}; return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      };
      await setup();
      // (the run's whole time as reckoned from what it runs — the banner and the monitor's estimate, Sam's rule of 16 Nov 2026: per track
      // its zone (~15 min on the M1 Max for Paris, ~10 for Toulon-Hyères on kerr-mini), its rest, and per hour ~1 min of loading and a
      // leg at most 2 min each)
      const REST_S = Number(process.env.J8A_REST_S ?? 0);
      const estimateS = TRACKS.reduce(
        (s, t) => s + (TRACK_READY ? 900 + REST_S : 0) + HOURS.length * (60 + (t.points.length - 1) * 120 + (OFFLINE ? 60 : 0)),
        30,
      );
      app.estimate(estimateS);
      // (the steps, all known from the start: « Étape k/n » right from the first — docs/E2E.md, the banner, point 6)
      const hourOf = (h: "day" | "night") => (h === "day" ? "de jour" : "de nuit");
      app.steps(
        TRACKS.flatMap((t) => [
          ...(TRACK_READY ? [`${t.name} : la zone du couloir`] : []),
          ...(TRACK_READY && REST_S > 0 ? [`${t.name} : le repos`] : []),
          ...(OFFLINE ? [`${t.name} : le réseau coupé`] : []),
          ...HOURS.flatMap((h) => [
            `${t.name} ${hourOf(h)} : le chargement`,
            ...t.points.slice(1).map((_, i) => `${t.name} ${hourOf(h)} : tronçon ${i + 1}/${t.points.length - 1}`),
          ]),
        ]),
      );
      const runStart = Date.now();
      const left = () => `· ~${Math.max(1, Math.round((estimateS - (Date.now() - runStart) / 1000) / 60))} min restantes (estimé)`;
      for (const t of TRACKS) {
        // (J8A_TRACK_READY: the track's corridor zone — j8-zone-paris's: the airfield's levels along it, « overflight » in its disc, the far
        // cells to 20 km — made here, in this profile (a zone lives in the Service Worker's storage: another run's is not this one's), its
        // chains read from the e2e's disk (the corridor's on kerr-mini's since 17 Nov 2026) — kept if a ready one covers the track already;
        // its progress said every minute, 10 min without a move or 60 min: fails)
        if (TRACK_READY) {
          await app.step(`${t.name} : la zone du couloir`);
          await app.waitFor("!!__bh.pwa.zones", 30_000);
          // (its sharp turns' discs from the track's speed — a whole turn at 25° of bank and 500 m: Paris's U-turn at Bercy went out 3.3 km,
          // past the 2 500 m default, 17 Nov 2026)
          const corridor = {
            points: t.points.map((p) => [p[0], p[1]] as [number, number]),
            halfWidthM: t.halfWidthM,
            turnRadiusM: turnRadiusFor(t.speedMps),
          };
          const d = corridorDisc(corridor);
          // The zone classifies its terrain once at creation. Before the geoid and coarse relief load,
          // an inland corridor is treated as coastal and fetches the extra RGE ALTI grids.
          await app.waitProgress(
            `(() => {
              const n = __bh.sys.geoid(${d.lat}, ${d.lon}), h = __bh.sys.groundAt(${d.lat}, ${d.lon});
              return Math.abs(n) > 1 && Number.isFinite(h) && h !== 0;
            })()`,
            `${t.name}: geoid and coarse ground before classifying the zone`,
            { maxMs: 120_000 },
          );
          const zone = { name: `J8-A ${t.name} (e2e)`, lat: d.lat, lon: d.lon, radiusKm: d.radius / 1000, profile: "overflight", corridor };
          const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(zone)})`);
          if (!id) throw new Error(`${t.name}: the corridor zone refused`);
          const z0 = Date.now();
          const meshCells = cellsAlong(corridor.points, MESH_NEAR_M).length,
            forestCells = cellsAlong(corridor.points, FOREST_NEAR_M).length;
          let lastCells = -1;
          let last = -1,
            moved = Date.now();
          for (let k = 0; ; k++) {
            const z = await app.js<{ state: string; cursor: number; total: number; failed: number; bytes: number } | null>(
              `(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}) ?? null)()`,
            );
            if (z && z.state !== "downloading") {
              console.log(
                `  ${t.name}: the corridor zone ${z.state} in ${((Date.now() - z0) / 60_000).toFixed(1)} min — ${JSON.stringify(z)}`,
              );
              const zf = z as { forests?: { count: number; ms: number }; meshes?: { count: number } };
              await app.stepDone(
                `zone ${z.state} en ${((Date.now() - z0) / 60_000).toFixed(1)} min · maillages ${zf.meshes?.count ?? "-"} · forêt ${zf.forests?.count ?? "-"}`,
                z.state === "ready",
              );
              if (z.state !== "ready") throw new Error(`${t.name}: the corridor zone ${z.state}: ${JSON.stringify(z)}`);
              break;
            }
            if ((z?.cursor ?? 0) !== last) {
              last = z?.cursor ?? 0;
              moved = Date.now();
            }
            // (its chains all in, the zone still making its cells — streets, meshes, forest: minutes on the M1 Max — their caches' count
            // the progress: the stall's guard read the chains alone and stopped a zone alive at its cells, 17 Nov 2026)
            if (z && z.cursor >= z.total && k % 5 === 0) {
              // (the count bounded to 5 s, -1 past it: a Cache Storage read waited behind the zone's worker's writes — Toulon's cells after
              // Paris's flights, 17 Nov 2026: the page answered the witness in 0–2 ms all along, the test's call never came back)
              const cells = await app.js<number>(`Promise.race([(async () => { let k = 0;
                for (const name of await caches.keys()) if (/^kerr-(street|mesh|forest)-/.test(name)) k += (await (await caches.open(name)).keys()).length;
                return k; })(), new Promise((q) => setTimeout(() => q(-1), 5000))])`);
              // (a count past its 5 s said — a keys() hung for minutes would be the game's defect too: flightReady, the stores read them)
              if (cells < 0)
                console.log(`  … ${t.name}: the caches' count did not answer in 5 s (Cache Storage slow under the zone's writes)`);
              if (cells >= 0 && cells !== lastCells) {
                lastCells = cells;
                moved = Date.now();
              }
            }
            if (Date.now() - moved > 600_000 || Date.now() - z0 > 3_600_000)
              throw new Error(
                `${t.name}: the corridor zone not in after ${Math.round((Date.now() - z0) / 60_000)} min: ${JSON.stringify(z)}`,
              );
            if (k % 30 === 0)
              console.log(`  … ${t.name}: the corridor zone ${z?.cursor}/${z?.total} chains, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB`);
            // (the banner every 10 s: the chains, then — all in, the zone still making — its cells: the meshes, the forest, counted in
            // their caches against the track's (cellsAlong: ~ the zone's own choice))
            if (k % 5 === 0) {
              const min = ((Date.now() - z0) / 60_000).toFixed(1);
              if (z && z.cursor < z.total)
                await app.progress(
                  `chaînes ${z.cursor.toLocaleString("fr-FR")} / ${z.total.toLocaleString("fr-FR")}, ${((z.bytes ?? 0) / 1e6).toFixed(0)} Mo (${min} min) ${left()}`,
                );
              else {
                // (bounded to 5 s as above: -1 when the caches did not answer in time)
                const c = await app.js<{ mesh: number; forest: number }>(`Promise.race([(async () => { const n = async (p) => { let k = 0;
                  for (const name of await caches.keys()) if (name.startsWith(p)) k += (await (await caches.open(name)).keys()).length; return k; };
                  return { mesh: await n("kerr-mesh-"), forest: await n("kerr-forest-") }; })(), new Promise((q) => setTimeout(() => q({ mesh: -1, forest: -1 }), 5000))])`);
                await app.progress(
                  `cellules : maillages ${c.mesh} / ~${meshCells}, forêt ${c.forest} / ~${forestCells} (${min} min) ${left()}`,
                );
              }
            }
            await app.js(`new Promise((q) => setTimeout(q, 2000))`);
          }
          // (J8A_REST_S: a rest after the zone, the world frozen — its download heats the M1 Max to « Heavy »; the flight measured cold,
          // Sam's demand of 17 Nov 2026 — said every minute)
          if (REST_S > 0) await app.step(`${t.name} : le repos`);
          for (let r = 0; r < REST_S; r += 10) {
            if (r % 60 === 0) console.log(`  … ${t.name}: resting after the zone, ${r} / ${REST_S} s`);
            await app.progress(`repos ${r} / ${REST_S} s, le monde figé ${left()}`);
            await app.js(`(() => { __bh.freeze(true); return new Promise((q) => setTimeout(q, 10000)); })()`);
          }
          if (REST_S > 0) await app.stepDone(`repos ${REST_S} s`);
          // (J8A_OFFLINE: the network cut, the page loaded again in the same profile — its zone and Service Worker kept —, its settings
          // set again)
          if (OFFLINE) {
            await app.step(`${t.name} : le réseau coupé`);
            await app.offline(true);
            await app.load("scene=game:artemis");
            await setup();
            await app.waitFor("!!__bh.pwa.zones", 30_000);
          }
        }
        for (const hour of HOURS) {
          const name = `${t.name}-${hour === "day" ? "jour" : "nuit"}`;
          const [p0, p1] = [t.points[0]!, t.points[1]!];
          const hdg0 = Math.atan2(Math.sin((p1[1] - p0[1]) * D) * Math.cos(p1[0] * D), (p1[0] - p0[0]) * D) / D;
          // (rule 13: frozen while the data load — the craft in the air over the first point, its heading to the second —, the date the
          // hour's; flyAt over the ground: the track's height over the sea less ~50 m of ground, the autopilot holds the sea's height)
          await app.step(`${t.name} ${hourOf(hour)} : le chargement`);
          await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("${hour === "day" ? t.dates.day : t.dates.night}");
            __bh.game.set("weather", "fair"); __bh.game.flyAt(${p0[0]}, ${p0[1]}, ${Math.max(p0[2] - 50, 150)}, ${hdg0.toFixed(1)}, ${t.speedMps});
            __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`);
          const t0 = Date.now();
          // (everything loaded: flightReady every 5 s, what is missing said every 10 s; 120 s without a change of « why » or 600 s: fails)
          // (ready twice in a row, 5 s apart: just after a jump the view has asked nothing yet — a first « ready » passed before its
          // tiles were even pending, the session of the approaches' j8-zone-paris, 17 Nov 2026)
          let why = "",
            changed = Date.now(),
            readyOnce = false;
          for (;;) {
            const r = await app.js<{ ready: boolean; why: string; notes: string }>(
              `(async () => { __bh.touch(); const r = await __bh.sys.flightReady(${TRACK_READY ? `{ track: { points: ${JSON.stringify(t.points)} } }` : ""});
                // (the mesh cells within reach resident too — near-meshes.ts; J8A_CELLS=0: none)
                const n = __bh.renderer.nearCells(), cells = ${process.env.J8A_CELLS !== "0"} && (!n || n.missing > 0) ? [\`near mesh cells: \${n ? n.missing : "none yet"} missing\`] : [];
                return { ready: r.ready && !cells.length, why: String([r.why, ...cells].filter(Boolean)), notes: String(r.notes ?? "") }; })()`,
            );
            // (what does not hold the flight but is said — the far cells past the budget, Sam's decision of 17 Nov 2026: 72 MiB, told apart)
            if (r.ready && readyOnce) {
              if (r.notes) console.log(`  ${name}: ready — ${r.notes}`);
              break;
            }
            readyOnce = r.ready;
            if (r.ready) {
              await app.js(`new Promise((q) => setTimeout(q, 5000))`);
              continue;
            }
            if (r.why !== why) {
              why = r.why;
              changed = Date.now();
            }
            if ((Date.now() - t0) % 10_000 < 5_000) console.log(`  … ${name}: not ready — ${r.why}`);
            await app.progress(`${Math.round((Date.now() - t0) / 1000)} s — encore : ${r.why.slice(0, 120)} ${left()}`);
            if (Date.now() - changed > 120_000 || Date.now() - t0 > 600_000)
              throw new Error(`${name}: not loaded after ${Math.round((Date.now() - t0) / 1000)} s — ${r.why}`);
            await app.js(`new Promise((q) => setTimeout(q, 5000))`);
          }
          const preloadS = (Date.now() - t0) / 1000;
          await app.stepDone(`chargé en ${preloadS.toFixed(0)} s`);
          // (the real network in flight: the e2e disk cache's misses — what it had not and fetched — before and after; the requests the
          // page made, served by the disk or the Service Worker too, apart)
          const missesBefore = app.earth?.counts.misses ?? 0;
          // (the Service Worker's network requests — every attempt, counted before the fetch —: its zone's and cache's misses)
          const swStats = () =>
            app.js<{ network: number; kinds: Record<string, { network: number }>; recent: string[] }>(
              "(async () => { const s = (await __bh.pwa.stats())?.served; return { network: s?.network ?? 0, kinds: s?.kinds ?? {}, recent: s?.recent ?? [] }; })()",
            );
          const sw0 = TRACK_READY ? await swStats() : null;
          const swBefore = sw0?.network ?? 0;
          // (the harness's request log — 20 000 at most, filled by a zone's download — emptied: the flight's own requests named in it)
          if (app.earth) app.earth.counts.log.length = 0;
          const flownFrom = Date.now();
          await app.settled(90_000);
          await app.js(`(() => { performance.clearResourceTimings(); performance.setResourceTimingBufferSize(100000);
            __bh.camera.apSet({ ap: true, athr: true, alt: ${p0[2]}, hdg: ${hdg0.toFixed(2)} * Math.PI / 180, spd: ${t.speedMps} });
            __bh.freeze(false); return 1; })()`);
          // (a leg: along the segment to point i — its heading set every second towards a point 1.5 km ahead on the segment (no wandering
          // off the corridor's 1 km), the next leg taken a turn's lead before point i (the turn's radius at the speed and a 25° bank:
          // a 90° corner at 150 m/s is ~5 km round — aimed at the point itself and done within 700 m, the craft circled off the corridor
          // at Toulon, 17 Nov 2026); 120 s at most)
          const leg = (i: number) =>
            app.js<Leg>(`(async () => {
              const R = __bh.renderer, c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
              const PTS = ${JSON.stringify(t.points)}, P = PTS[${i}], Pp = PTS[${i} - 1], Pn = PTS[${i} + 1] ?? null, D = Math.PI / 180;
              const cosL = Math.cos(P[0] * D), en = (q) => [(q[1] - P[1]) * 111320 * cosL, (q[0] - P[0]) * 111320];
              const A = en(Pp), B = en(Pn ?? P), L = Math.hypot(A[0], A[1]) || 1, u = [-A[0] / L, -A[1] / L];
              const turn = Pn ? Math.acos(Math.max(-1, Math.min(1, (u[0] * B[0] + u[1] * B[1]) / (Math.hypot(B[0], B[1]) || 1)))) : 0;
              // (the lead: a turn of up to 100° flown round its corner — its radius × tan(half the turn), no more than 0.9 of the shorter
              // leg —; a sharper one (Paris's U-turn at Bercy, ~150°: a lead of ~12 km cut the V off the corridor, 17 Nov 2026) the point
              // overflown first, then the turn)
              const Ln = Pn ? Math.hypot(B[0], B[1]) : 0;
              const lead = Pn && turn <= 100 * D
                ? Math.max(700, Math.min((${t.speedMps} ** 2 / (9.81 * Math.tan(25 * D))) * Math.tan(turn / 2) + 200, 0.9 * Math.min(L, Ln)))
                : 700;
              // (into a turn sharper than 100° slowed to 80 m/s at most, as a pilot would: the jet's autopilot banks 30° at most — jet.ts —,
              // at 120 m/s a 2.5 km radius, its circle out to ~5 km from the point (Paris's U-turn at Bercy: an orthophoto 4.6 km off,
              // 17 Nov 2026); at 80 m/s ~1.1 km, within its zone's disc)
              const spd = Pn && turn > 100 * D ? Math.min(${t.speedMps}, 80) : ${t.speedMps};
              const gpu = []; let gapMax = 0, frames = 0, quick = 0, last = performance.now(), done = R.completedFrames, steerAt = 0;
              const scFull = [], scQuick = []; let lastWorker = R.earthScenery.stats().workerMs, fast = 0;
              const t0 = performance.now();
              while (performance.now() - t0 < 120000) {
                const now = await f(); gapMax = Math.max(gapMax, now - last); last = now; frames++;
                if (R.completedFrames !== done) { done = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); }
                const sst = R.earthScenery.stats();
                if (sst.quick) quick++;
                // (each new scene's worker time, by kind; whether the scene judged the flight too fast for a full one — T8m)
                if (sst.workerMs && sst.workerMs !== lastWorker) { lastWorker = sst.workerMs; (sst.quick ? scQuick : scFull).push(Math.round(sst.workerMs)); }
                if (R.earthScenery.fastFlight()) fast++;
                const g = c.geoNow();
                const X = en([g.lat, g.lon]);
                // (along the segment: how far before point i (its along-distance, ≤ 0 past it), the aim 1.5 km ahead on the segment)
                const before = -(X[0] * u[0] + X[1] * u[1]);
                if (before < lead || Math.hypot(X[0], X[1]) < 700) break;
                const s = Math.max(0, Math.min(L, L - before + 1500));
                const aim = [A[0] + u[0] * s, A[1] + u[1] * s];
                if (now - steerAt > 1000) { steerAt = now; c.apSet({ ap: true, athr: true, alt: P[2], hdg: Math.atan2(aim[0] - X[0], aim[1] - X[1]), spd }); }
              }
              const req = performance.getEntriesByType("resource").filter((e) => /${HOSTS}/.test(e.name)).length;
              const sc = R.earthScenery.stats(), far = await R.farBuildings(), g = c.geoNow();
              return { name: "leg-" + ${i}, frames, gapMax: +gapMax.toFixed(1), gpu, quick, requests: req, scenes: { full: scFull, quick: scQuick, fastFlight: fast },
                near: sc.bdtopoBuildings + sc.overtureBuildings, far: far?.inView ?? null, forest: sc.forestPrepared,
                at: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), gs: Math.round(g.gs ?? 0),
                  paused: document.body.classList.contains("paused"), ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null } }; })()`);
          const legs: Leg[] = [];
          for (let i = 1; i < t.points.length; i++) {
            await app.step(`${t.name} ${hourOf(hour)} : tronçon ${i}/${t.points.length - 1}`);
            const l = await leg(i);
            legs.push(l);
            const g = [...l.gpu].sort((a, b) => a - b);
            await app.stepDone(
              `tronçon ${i} : GPU p50 ${g[g.length >> 1] ?? "-"} ms · rapides ${l.quick} · écart max ${l.gapMax} ms`,
              l.quick === 0 || !process.env.J8A_STRICT,
            );
            console.log(
              `  ${name} ${l.name}: ${l.frames} images, gap max ${l.gapMax} ms, GPU p50 ${g[g.length >> 1] ?? "-"} ms, quick ${l.quick} (scenes ${JSON.stringify(l.scenes)}), requests ${l.requests}, near ${l.near}, far ${JSON.stringify(l.far)}, forest cells ${JSON.stringify(l.forest)} — ${JSON.stringify(l.at)}`,
            );
            if ((l.at as { paused?: boolean } | null)?.paused) throw new Error(`${name}: paused in flight — ${JSON.stringify(l.at)}`);
            // (rule 13: the craft as flown after each leg)
            // (a low track: 50 m over the ground at its lowest — its heights cleared by 15 m over the BD TOPO's tops, j8a-tracks.ts)
            expectFlight(await flightState(app), `${name} ${l.name}`, { ...CRUISE, aglMin: isLow(t) ? 25 : 100, bankMax: 45 });
            await app.shot(`${OUT}/${name}-${i}.png`);
            // (PLAN-J8 A6 criterion 4 — all the view's buildings: the prepared cells' census by ring round the craft against the cells
            // drawn now — the far layer's and the near meshes' —, each ring's share drawn; strict: 98 % or more within 10 km)
            const cz = await app.js<{
              census: { rings: { outerM: number; buildings: number }[]; missing: number };
              drawn: { rings: { outerM: number; buildings: number }[] };
            }>(
              `(async () => {
                const { lat, lon } = __bh.camera.geoNow();
                const [census, drawn] = await Promise.all([__bh.sys.census(lat, lon), __bh.sys.drawnCensus(lat, lon)]);
                return { census, drawn };
              })()`,
            );
            const share = cz.census.rings.map((r, k) => ({
              km: r.outerM / 1000,
              census: r.buildings,
              drawn: cz.drawn.rings[k]?.buildings ?? 0,
              share: r.buildings ? +((cz.drawn.rings[k]?.buildings ?? 0) / r.buildings).toFixed(3) : 1,
            }));
            l.census = share;
            console.log(
              `  ${name} ${l.name} census (km: drawn / prepared): ${share.map((r) => `${r.km} ${r.drawn}/${r.census}`).join(" · ")}`,
            );
            await app.progress(
              `tronçon ${i} : bâtiments dessinés ${share.map((r) => `${r.km} km ${Math.round(100 * r.share)} %`).join(", ")}`,
            );
            if (process.env.J8A_STRICT)
              for (const r of share.filter((r) => r.km <= 10 && r.census > 50))
                if (r.share < 0.98)
                  throw new Error(`${name} ${l.name}: ${r.drawn} of the ${r.census} buildings prepared within ${r.km} km drawn (< 98 %)`);
          }
          // (PLAN-J8 A6 criterion 5 — the least difference between the qualities: frozen at the last point, the craft and the UI hidden,
          // the image converged; a 32 × 18 grid of its lower half read (surfaceAt: a near mesh's building, or a far one's — its
          // visibility's g negative —, its distance), the image's colours there (the canvas); each layer's mean colour within 0.8–2.5 km
          // of the eye — round the junction, the near meshes' reach — and their gap: the mean channels' difference, the luminance's
          // ratio. Said, not asserted (Sam judges with the shots); no normal there: roofs and walls together)
          await app.js(
            `(() => { __bh.freeze(true); __bh.renderer.debugSkipShip = true; document.body.classList.add("hide-ui"); __bh.touch(); return 1; })()`,
          );
          await app.settled();
          await app.js(`new Promise((q) => setTimeout(q, 3000))`);
          const gap = await app.js<{ near: number[] | null; far: number[] | null; nN: number; nF: number; ms: number }>(`(async () => {
            const t0 = performance.now(), R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
            for (let i = 0; i < 5; i++) { __bh.touch(); await f(); }
            const cv = document.querySelector("canvas");
            // (read back after a frame drawn, again while it reads black — a frozen, untouched canvas can: Paris's colours came back
            // [0, 0, 0] once, 17 Nov 2026 — air-tlut's way)
            let b, img, mx = 0;
            for (let t = 0; t < 20 && mx === 0; t++) {
              __bh.touch(); await f(); __bh.touch();
              b = await new Promise((q) => requestAnimationFrame(() => q(createImageBitmap(cv))));
              const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
              img = g.getImageData(0, 0, b.width, b.height).data;
              for (let i = 0; i < img.length; i += 4096) mx = Math.max(mx, img[i], img[i + 1], img[i + 2]);
            }
            const acc = { near: [0, 0, 0, 0], far: [0, 0, 0, 0] };
            // (17 Nov 2026: 64 × 36 from the upper third read the sky first and its 45 s ran out before a building — the diagnostic
            // over Paris: near meshes to ~2.5 km, the far layer past ~2.1 km)
            for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) {
              if (performance.now() - t0 > 90000) break;
              const x = (i + 0.5) / 32, y = 0.45 + ((j + 0.5) / 18) * 0.55;
              const s = await R.surfaceAt(x, y);
              if (!s || s.craft !== null || (s.kind !== "building" && s.kind !== "box")) continue;
              const d = s.nearest ?? s.ground ?? 0;
              if (d < 800 || d > 3500) continue;
              const k = (s.vis?.[1] ?? 0) < 0 ? "far" : "near";
              const px = Math.min(b.width - 1, Math.floor(x * b.width)), py = Math.min(b.height - 1, Math.floor(y * b.height)), at = 4 * (py * b.width + px);
              acc[k][0] += img[at]; acc[k][1] += img[at + 1]; acc[k][2] += img[at + 2]; acc[k][3]++;
            }
            const mean = (a) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]].map((v) => +v.toFixed(1)) : null);
            return { near: mean(acc.near), far: mean(acc.far), nN: acc.near[3], nF: acc.far[3], ms: Math.round(performance.now() - t0) };
          })()`);
          await app.js(
            // (the world let go again: a mount set while frozen is not applied — the view from outside below shot the canopy's frame from
            // inside, the big e2e of 17 Nov 2026)
            `(() => { __bh.renderer.debugSkipShip = false; document.body.classList.remove("hide-ui"); __bh.freeze(false); __bh.touch(); return 1; })()`,
          );
          const lum = (c: number[] | null) => (c ? 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! : null);
          const junction = {
            ...gap,
            diff: gap.near && gap.far ? gap.near.map((v, k) => +(v - gap.far![k]!).toFixed(1)) : null,
            lumRatio: gap.near && gap.far ? +((lum(gap.far) ?? 0) / Math.max(1, lum(gap.near) ?? 1)).toFixed(3) : null,
          };
          console.log(`  ${name} criterion 5 (the junction's colours, 0.8–3.5 km, sRGB 0–255): ${JSON.stringify(junction)}`);
          await app.stepDone(
            junction.lumRatio === null
              ? `jonction : pas assez de bâtiments des deux couches (${gap.nN} proches, ${gap.nF} lointains)`
              : `jonction : écart ${JSON.stringify(junction.diff)}, luminance lointaine / proche ${junction.lumRatio}`,
          );
          // (the view from outside at the end: 80 m behind, a little above — the city round the craft)
          await app.js(`(async () => { __bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset();
            Object.assign(__bh.camera.outside, { yaw: 160, pitch: 10, dist: 80 });
            for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
          await app.shot(`${OUT}/${name}-dehors.png`);
          await app.js(`(() => { __bh.settings.shipMount = "cockpit"; __bh.refresh(); return 1; })()`);
          const all = legs.flatMap((l) => l.gpu).sort((a, b) => a - b);
          const flight = {
            preloadS,
            legs,
            junction,
            gpuP50: all[all.length >> 1] ?? null,
            gpuP95: all[Math.floor(all.length * 0.95)] ?? null,
            gapMax: Math.max(...legs.map((l) => l.gapMax)),
            quickImages: legs.reduce((s, l) => s + l.quick, 0),
            requests: legs[legs.length - 1]?.requests ?? 0,
            networkMisses: (app.earth?.counts.misses ?? 0) - missesBefore,
            ...(await (async () => {
              if (!TRACK_READY) return { swNetwork: null, swData: null };
              const s = await swStats();
              // (what the Service Worker asked of the network in flight: by kind, its last URLs — what the zone does not hold)
              const kinds = Object.fromEntries(
                Object.entries(s.kinds)
                  .map(([k, v]) => [k, v.network - (sw0?.kinds[k]?.network ?? 0)] as const)
                  .filter(([, n]) => n > 0),
              );
              // (the map's tiles — OpenStreetMap's, the cockpit's tactical map — apart: no zone holds them, their usage policy forbids
              // fetching them in bulk ahead; offline the map goes without them)
              return {
                swNetwork: s.network - swBefore,
                swData: s.network - swBefore - (kinds.map ?? 0),
                swKinds: kinds,
                swRecent: s.network > swBefore ? s.recent.slice(-12) : [],
              };
            })()),
            offline: OFFLINE,
            // (what went to the network in flight — its host's kind, a few of its URLs: what the zone does not hold)
            missed: (() => {
              const m = (app.earth?.counts.log ?? []).filter((r) => !r.hit && (r.at ?? 0) >= flownFrom);
              const by: Record<string, number> = {};
              for (const r of m) {
                const k = new URL(r.url).hostname + new URL(r.url).pathname.split("/").slice(0, 3).join("/");
                by[k] = (by[k] ?? 0) + 1;
              }
              return { by, first: m.slice(0, 8).map((r) => r.url.slice(0, 200)) };
            })(),
          };
          (out.flights as Record<string, unknown>)[name] = flight;
          console.log(`  ${name}: ${JSON.stringify({ ...flight, legs: undefined })}`);
          if (process.env.J8A_STRICT) {
            expect(flight.networkMisses).toBe(0);
            expect(flight.quickImages).toBe(0);
            if (OFFLINE) expect(flight.swData).toBe(0);
          }
          await app.js(`(() => { __bh.freeze(true); return 1; })()`);
        }
        // (J8A_OFFLINE: the network back for the next track's zone)
        if (OFFLINE) await app.offline(false);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      const lost = await app.js<unknown[]>(
        `(__bh.graphicsDiagnostic().events ?? []).filter((e) => String(e.kind).startsWith("device-lost"))`,
      );
      expect(lost).toEqual([]);
    } finally {
      witness();
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-a.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  // (J8A_TRACK_READY: a zone not on the disk yet comes from the network — Toulon-Hyères's, 46 347 chains: ~1 h)
  TRACK_READY ? 7_200_000 : 3_600_000,
);
