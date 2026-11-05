import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { fromRunway } from "../../src/game/ils";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T8 — the finest relief near the ground on an approach (Sam, 5 Nov 2026: « quand on s'approche du sol, en approche ou près
// d'une colline, le relief de qualité max se charge trop tard »): the F-35 put on the final of an ILS from AD_KM out (cold
// tiles, the start's data waited for as at a launch), the approach flown live to the runway; every AD_EVERY ms a shot and, at points on the ground ahead along the track
// (200 m, 500 m, 1 km, 2 km) and aside (45°, 90° either way at 500 m and 1 km: `side`, their mean), the level the pixel's footprint there asks (up to z 17 over the IGN's France, 14 elsewhere)
// against the finest drawn there: the levels missing — 0 the relief at its best, 1 a level short (twice too coarse)…
//   AD_RWY: "LFTH:13" (field:runway) · AD_KM (12) · AD_EVERY (2000) · AD_BURST ("45-80": a shot every 600 ms then) · AD_OUT
// Output: remote-results/approach-detail/NN.jpg, series.json. Done when: the touchdown or 150 s, no GPU error.
// Duration: ~3 min.
const OUT = process.env.AD_OUT ?? "remote-results/approach-detail";
const [FIELD, RWY] = (process.env.AD_RWY ?? "LFTH:13").split(":") as [string, string];
const KM = Number(process.env.AD_KM ?? 12);
const EVERY = Number(process.env.AD_EVERY ?? 2000);
afterAll(stopServer);

const AHEAD = `(() => {
  const t = __bh.renderer.earthTiles, g = __bh.camera.geoNow(), G = __bh.sys.geodetic();
  if (!g || !G) return null;
  const R = 6378137, TAU = 2 * Math.PI, D = Math.PI / 180;
  const agl = Math.max(G.altM - __bh.sys.groundAt(g.lat, g.lon), 2);
  const vf = ((__bh.settings.fov ?? 60) * Math.PI) / 180, pix = (2 * Math.tan(vf / 2)) / innerHeight;
  const zMax = t.nationalAt === "ign" ? 17 : 14;
  const merc = (sl, n) => (0.5 - Math.atanh(Math.min(Math.max(sl, -0.999999), 0.999999)) / TAU) * n;
  const inR = (r, x, y) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  const out = {};
  // (ahead along the track, then aside — 45° and 90° either way at 500 m and 1 km: a hill passed beside the final)
  const pts = [[0, 200], [0, 500], [0, 1000], [0, 2000], [-45, 500], [-45, 1000], [-90, 500], [-90, 1000], [45, 500], [45, 1000], [90, 500], [90, 1000]];
  let side = 0, sideN = 0;
  for (const [b, d] of pts) {
    const az = g.track + b * D;
    const lat = g.lat * D + (d * Math.cos(az)) / R, lon = g.lon * D + (d * Math.sin(az)) / (R * Math.cos(g.lat * D));
    const dep = Math.atan(agl / d), foot = (Math.hypot(d, agl) * pix) / Math.sin(Math.max(dep, 0.01));
    const want = Math.min(Math.floor(Math.log2((TAU * R * Math.cos(lat)) / (256 * foot)) + 0.5), zMax);
    let have = 5;
    for (const L of t.levels) {
      const x = (lon / TAU + 0.5) * L.n, y = merc(Math.sin(lat), L.n);
      if (L.valid && inR(L.valid, x, y)) have = Math.max(have, L.z);
    }
    if (b === 0) {
      out["m" + d] = Math.max(0, want - have);
      out["z" + d] = have + "/" + want;
    } else {
      side += Math.max(0, want - have);
      sideN++;
    }
  }
  out.side = +(side / Math.max(sideN, 1)).toFixed(2);
  // (the scenery — its trees on the hills: its state, its step, how many trees, its centre's distance)
  const sc = __bh.renderer.earthScenery?.stats?.();
  const deg = (v) => (Math.abs(v) > 1.6 ? v : (v * 180) / Math.PI);
  const scD = sc && sc.lat !== null ? Math.round(Math.hypot((deg(sc.lat) - g.lat) * 111320, (deg(sc.lon) - g.lon) * 111320 * Math.cos(g.lat * D))) : null;
  const scenery = sc ? { st: sc.status, step: sc.progress?.step ?? null, trees: sc.trees, dM: scD } : null;
  return { agl: Math.round(agl), pending: t.pending, ...out, phase: __bh.camera.ilsInfo()?.phase ?? null, scenery };
})()`;

test.skipIf(!E2E)(
  `T8: the finest relief ahead on the final — ${FIELD} ${RWY}, the F-35 from ${KM} km, cold`,
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const series: Record<string, unknown>[] = [];
    let gpuErrors = -1;
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, traffic: false }); return 1; })()`,
      );
      await app.waitProgress(`__bh.fleet.active === "f35"`, "the F-35");
      // (the runway's threshold and heading as the game knows them — its tile in first, from a place over the sea near)
      const ends = await (async () => {
        // (first put near the final's start as the airfield's chart gives it — AD_NEAR "lat,lon" (LFTH 13's by default) —: its
        // runways read there, the scenery and the relief asked where the flight begins, not 16 km off — the first run built
        // its trees there, the hill passed bare until a scene 40 s long came)
        const near = (process.env.AD_NEAR ?? "43.17,6.03").split(",").map(Number);
        await app.js(
          `(() => { __bh.game.setDate("2026-11-05T12:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.flyAt(${near[0]}, ${near[1]}, 650, 133, 95); __bh.freeze(true); return 1; })()`,
        );
        await app.waitProgress(`(__bh.camera.ilsRunways(${JSON.stringify(FIELD)})?.ends.length ?? 0) >= 2`, `${FIELD}'s runways`);
        return app.js<{ id: string; lat: number; lon: number; hdg: number; elev: number }[]>(
          `__bh.camera.ilsRunways(${JSON.stringify(FIELD)}).ends.map((e) => ({ id: e.id, lat: e.rwy.lat, lon: e.rwy.lon, hdg: e.rwy.hdg, elev: e.rwy.elev }))`,
        );
      })();
      const E = ends.find((e) => e.id === RWY)!;
      const R = { name: FIELD, lat: E.lat, lon: E.lon, hdg: E.hdg, elev: E.elev, len: 2000 };
      const p = fromRunway(R, -KM * 1000, 0);
      const h = Math.round((KM * 1000 + 300) * Math.tan((3 * Math.PI) / 180));
      await app.js(`(() => { __bh.game.flyAt(${p.lat}, ${p.lon}, ${h}, ${E.hdg}, 95); __bh.camera.gearDown = true;
        __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); __bh.freeze(true); return 1; })()`);
      // (the flight's start ready as a player's launch has it — its relief, scenery and kernels in, on their progress —: what
      // is seen coming in after is the streaming in flight)
      await app.dataSettled("the final's start");
      await app.js(`new Promise((q) => { __bh.freeze(false); setTimeout(() => { __bh.camera.setLook(0, -4); q(1); }, 300); })`);
      const said = await app.js<string>(`__bh.camera.ilsStart(${JSON.stringify(FIELD)}, { runway: ${JSON.stringify(RWY)} })`);
      console.log(`  ${said}`);
      const t0 = Date.now();
      for (let i = 0; Date.now() - t0 < 150_000; i++) {
        const t = +((Date.now() - t0) / 1000).toFixed(1);
        const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 });
        await Bun.write(`${OUT}/${String(i).padStart(2, "0")}.jpg`, Buffer.from(a.data, "base64"));
        const m = await app.js<Record<string, unknown> | null>(AHEAD);
        series.push({ i, t, ...m });
        console.log(`  ${t}s: ${JSON.stringify(m)}`);
        if (m && (m.phase === "rollout" || m.phase === "done" || (m.agl as number) < 3)) break;
        // (AD_BURST "a-b": a shot every 600 ms between a and b s — the hill passed beside the final, near frame by frame)
        const [b0, b1] = (process.env.AD_BURST ?? "").split("-").map(Number);
        await Bun.sleep(b1 && t >= b0! && t <= b1 ? 600 : EVERY);
      }
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/series.json`, JSON.stringify(series, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  6 * 60_000,
);
