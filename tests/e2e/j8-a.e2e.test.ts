import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { J8A_TRACKS } from "../../src/system/j8a-tracks";
import { corridorDisc, turnRadiusFor } from "../../src/system/zones";
import { App, E2E, stopServer } from "./lib/app";
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
// J8A_NEAR [m, default 0]: the near scene / far layer junction (renderer.farNearOnlyM — J8-5; Sam's decision of 16 Nov 2026: 0).
// J8A_CELLS=1: the near buildings from their mesh cells (renderer.nearCellsOn — J8-8 lots 2–4, the scene without its buildings): their
// cells within reach resident before the take-off too.
// J8A_BUDGET [MiB, default 72]: the far layer's pool (renderer.farBudgetMiB — all Paris resident; the default since Sam's « ok 72 »).
// J8A_OFFLINE=1 (with J8A_TRACK_READY; the approaches' session, agreed 17 Nov 2026): each track flown with the network cut — its zone
// made online, then the network cut and the page loaded again (the zone and the Service Worker kept in the profile), its settings set
// again, ready, flown; the network back before the next track's zone. Strict: the Service Worker's network requests over each flight
// 0 too (__bh.pwa.stats().served.network — counted before the fetch: every attempt), the map's tiles apart (OpenStreetMap's, the
// cockpit's tactical map: no zone holds them — their usage policy forbids bulk fetching —, told in swKinds).
// Duration: ~16 min on kerr-mini (two tracks, day and night, ~3 min of flight each, the preload from the disk).
// Done when: every track flown by day and by night, j8-a.json written.
afterAll(stopServer);
const MACHINE = process.env.J8A_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J8A_OUT ?? `remote-results/j8-a/${MACHINE}`;
const TRACKS = J8A_TRACKS.filter((t) => !process.env.J8A_TRACKS || process.env.J8A_TRACKS.split(",").includes(t.name));
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
  at: unknown;
};
test.skipIf(!E2E)(
  "J8-A: Paris and Toulon-Hyères flown by day and by night, everything loaded before — no request, no quick scene, the buildings drawn",
  async () => {
    mkdirSync(OUT, { recursive: true });
    // (J8A_TRACK_READY: the Service Worker on — the track's corridor zone made in this profile, from the e2e's disk)
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true, sw: TRACK_READY });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), machine: MACHINE, flights: {} };
    try {
      // (the far layer's pool for the whole of Paris — 24 MiB holds a quarter of it, never « all loaded »: 72 MiB, the default since
      // Sam's « ok 72 »; J8A_BUDGET [MiB])
      // (the run's settings — set again after J8A_OFFLINE's reload)
      const setup = async () => {
        await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
          __bh.renderer.farBudgetMiB = ${Number(process.env.J8A_BUDGET ?? 72)};
          __bh.renderer.farNearOnlyM = ${Number(process.env.J8A_NEAR ?? 0)}; __bh.renderer.nearCellsOn = ${!!process.env.J8A_CELLS}; return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      };
      await setup();
      for (const t of TRACKS) {
        // (J8A_TRACK_READY: the track's corridor zone — j8-zone-paris's: the airfield's levels along it, « overflight » in its disc, the far
        // cells to 20 km — made here, in this profile (a zone lives in the Service Worker's storage: another run's is not this one's), its
        // chains read from the e2e's disk (the corridor's on kerr-mini's since 17 Nov 2026) — kept if a ready one covers the track already;
        // its progress said every minute, 10 min without a move or 60 min: fails)
        if (TRACK_READY) {
          await app.scenario(`${t.label} — la zone du couloir`);
          await app.waitFor("!!__bh.pwa.zones", 30_000);
          // (its sharp turns' discs from the track's speed — a whole turn at 25° of bank and 500 m: Paris's U-turn at Bercy went out 3.3 km,
          // past the 2 500 m default, 17 Nov 2026)
          const corridor = {
            points: t.points.map((p) => [p[0], p[1]] as [number, number]),
            halfWidthM: t.halfWidthM,
            turnRadiusM: turnRadiusFor(t.speedMps),
          };
          const d = corridorDisc(corridor);
          const zone = { name: `J8-A ${t.name} (e2e)`, lat: d.lat, lon: d.lon, radiusKm: d.radius / 1000, profile: "overflight", corridor };
          const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(zone)})`);
          if (!id) throw new Error(`${t.name}: the corridor zone refused`);
          const z0 = Date.now();
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
              if (z.state !== "ready") throw new Error(`${t.name}: the corridor zone ${z.state}: ${JSON.stringify(z)}`);
              break;
            }
            if ((z?.cursor ?? 0) !== last) {
              last = z?.cursor ?? 0;
              moved = Date.now();
            }
            if (Date.now() - moved > 600_000 || Date.now() - z0 > 3_600_000)
              throw new Error(
                `${t.name}: the corridor zone not in after ${Math.round((Date.now() - z0) / 60_000)} min: ${JSON.stringify(z)}`,
              );
            if (k % 30 === 0)
              console.log(`  … ${t.name}: the corridor zone ${z?.cursor}/${z?.total} chains, ${((z?.bytes ?? 0) / 1e6).toFixed(0)} MB`);
            await app.js(`new Promise((q) => setTimeout(q, 2000))`);
          }
          // (J8A_OFFLINE: the network cut, the page loaded again in the same profile — its zone and Service Worker kept —, its settings
          // set again)
          if (OFFLINE) {
            await app.scenario(`${t.label} — le réseau coupé`);
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
          await app.scenario(`${t.label} — ${hour === "day" ? "de jour" : "de nuit"} : le chargement`);
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
                // (J8A_CELLS: the mesh cells within reach resident too — near-meshes.ts)
                const n = __bh.renderer.nearCells(), cells = ${!!process.env.J8A_CELLS} && (!n || n.missing > 0) ? [\`near mesh cells: \${n ? n.missing : "none yet"} missing\`] : [];
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
            if (Date.now() - changed > 120_000 || Date.now() - t0 > 600_000)
              throw new Error(`${name}: not loaded after ${Math.round((Date.now() - t0) / 1000)} s — ${r.why}`);
            await app.js(`new Promise((q) => setTimeout(q, 5000))`);
          }
          const preloadS = (Date.now() - t0) / 1000;
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
          await app.scenario(`${t.label} — ${hour === "day" ? "de jour" : "de nuit"} : le vol`);
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
              const t0 = performance.now();
              while (performance.now() - t0 < 120000) {
                const now = await f(); gapMax = Math.max(gapMax, now - last); last = now; frames++;
                if (R.completedFrames !== done) { done = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); }
                if (R.earthScenery.stats().quick) quick++;
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
              return { name: "leg-" + ${i}, frames, gapMax: +gapMax.toFixed(1), gpu, quick, requests: req,
                near: sc.bdtopoBuildings + sc.overtureBuildings, far: far?.inView ?? null,
                at: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), gs: Math.round(g.gs ?? 0),
                  paused: document.body.classList.contains("paused"), ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null } }; })()`);
          const legs: Leg[] = [];
          for (let i = 1; i < t.points.length; i++) {
            const l = await leg(i);
            legs.push(l);
            const g = [...l.gpu].sort((a, b) => a - b);
            console.log(
              `  ${name} ${l.name}: ${l.frames} images, gap max ${l.gapMax} ms, GPU p50 ${g[g.length >> 1] ?? "-"} ms, quick ${l.quick}, requests ${l.requests}, near ${l.near}, far ${JSON.stringify(l.far)} — ${JSON.stringify(l.at)}`,
            );
            if ((l.at as { paused?: boolean } | null)?.paused) throw new Error(`${name}: paused in flight — ${JSON.stringify(l.at)}`);
            // (rule 13: the craft as flown after each leg)
            expectFlight(await flightState(app), `${name} ${l.name}`, { ...CRUISE, aglMin: 100, bankMax: 45 });
            await app.shot(`${OUT}/${name}-${i}.png`);
          }
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
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/j8-a.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  // (J8A_TRACK_READY: a zone not on the disk yet comes from the network — Toulon-Hyères's, 46 347 chains: ~1 h)
  TRACK_READY ? 7_200_000 : 3_600_000,
);
