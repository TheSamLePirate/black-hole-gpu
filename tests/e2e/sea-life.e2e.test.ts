import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The sea's own life (Sam, 6 Nov 2026: « meilleurs bateaux, la vie sur la mer » — game/seasim.ts): an F-35 at 300 m over the
// sea where the AIS shows no ship (SL_AT, the Bay of Biscay offshore by default), the made-up traffic about it — its ships by
// kind —; each of the nearest ones of different kinds framed from a few hundred metres (the craft put there, its nose on it, the
// cockpit's view) and shot,
// the frame rate with them. Then the same place twenty seconds on: each ship moved by its speed (no jump).
//   SL_AT ("45.6,-3.2") · SL_OUT · SL_HOUR (UTC, 13)
// Output: remote-results/sea-life/NN-kind.jpg, ships.json. Done when: ships of at least two kinds within 30 km, each shot,
// no GPU error. Duration: ~2 min.
const OUT = process.env.SL_OUT ?? "remote-results/sea-life";
const [LAT, LON] = (process.env.SL_AT ?? "45.6,-3.2").split(",").map(Number) as [number, number];
const HOUR = Number(process.env.SL_HOUR ?? 13);
afterAll(stopServer);

const SHIPS = `(() => {
  const g = __bh.camera.geoNow();
  return __bh.camera.seaNow().map((c) => {
    const r = Math.hypot(...c.p);
    // (geodetic, WGS84 — the place's latitude from its geocentric one: 0.19° off at 45°, the craft put 21 km from the ship)
    const lat = Math.atan(Math.tan(Math.asin(c.p[2] / r)) / (1 - 0.00669437999014)) * 180 / Math.PI, lon = Math.atan2(c.p[1], c.p[0]) * 180 / Math.PI;
    const d = Math.hypot((lat - g.lat) * 111320, (lon - g.lon) * 111320 * Math.cos(g.lat * Math.PI / 180));
    const hdg = Math.atan2(c.fwd[0] * -Math.sin(lon * Math.PI / 180) + c.fwd[1] * Math.cos(lon * Math.PI / 180),
      -c.fwd[0] * Math.sin(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180) - c.fwd[1] * Math.sin(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180) + c.fwd[2] * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
    return { id: c.id, name: c.name, kind: c.kind, mesh: c.mesh, len: Math.round(c.len), sog: +c.sog.toFixed(1), lat, lon, d: Math.round(d), hdg: Math.round(hdg) };
  }).sort((a, b) => a.d - b.d);
})()`;

test.skipIf(!E2E)(
  "life at sea: the made-up ships over the water, by kind, framed and shot; moving on smoothly",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    let gpuErrors = -1;
    const report: Record<string, unknown> = {};
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { lookProfile: "neutral", motionBlur: 0, dof: false, seaLife: true });
        __bh.game.setDate("2026-06-20T${String(HOUR).padStart(2, "0")}:00:00Z"); __bh.game.set("weather", "fair");
        return 1; })()`);
      // (the F-35 in first — switched to after the place was set, it was lined up at Le Bourget —, then over the sea)
      await app.waitProgress(`__bh.fleet.active === "f35"`, "the F-35");
      await app.js(`(() => { __bh.game.flyAt(${LAT}, ${LON}, 300, 90, 150); __bh.freeze(true); return 1; })()`);
      await app.dataSettled("the sea");
      const ships =
        await app.js<
          { id: string; name: string; kind: string; len: number; sog: number; lat: number; lon: number; d: number; hdg: number }[]
        >(SHIPS);
      console.log(
        `  ${ships.length} ships within 30 km: ${JSON.stringify(ships.reduce((m: Record<string, number>, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {}))}`,
      );
      report.ships = ships;
      // (the nearest of each kind, four at most: framed from 2.5 lengths + 120 m off its quarter, a little above it)
      const picked = [...new Map(ships.map((s) => [s.kind, s])).values()].slice(0, 4);
      // (the time let run and the kernels the sea needs compiled before the first shot — frozen, the boot's frame was shot)
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 60_000);
      let i = 0;
      for (const s of picked) {
        const off = 3 * s.len + 300;
        // (its starboard quarter, ahead: 35° off its bow on its right)
        const br = ((s.hdg + 35) * Math.PI) / 180;
        const la = s.lat + (off * Math.cos(br)) / 111320,
          lo = s.lon + (off * Math.sin(br)) / (111320 * Math.cos((s.lat * Math.PI) / 180));
        // (the craft's nose on the ship: the bearing from where it is put to the ship)
        const back = ((((Math.atan2((s.lon - lo) * Math.cos((s.lat * Math.PI) / 180), s.lat - la) * 180) / Math.PI) % 360) + 360) % 360;
        // (low over the sea, the gear down — gear up so low, the Auto-GCAS pulled the nose up (Sam) —, the autopilot holding
        // its height)
        const alt = 40 + 0.2 * s.len;
        // (the craft itself put there — over the sea, its nose on the ship, the time running: frozen, the view is not drawn
        // again and the shot showed the boot's frame —: the view the cockpit's, the HUD hidden,
        // the look lowered onto it; the ships' own clock runs on)
        const said = await app.js<string | null>(
          `(() => { __bh.game.flyAt(${la}, ${lo}, ${alt}, ${back}, 110); __bh.camera.gearDown = true; __bh.freeze(false); __bh.settings.shipMount = "cockpit";
            document.body.classList.add("hide-ui");
            __bh.camera.setLook(0, ${-((Math.atan2(alt, off) * 180) / Math.PI + 3).toFixed(1)}); return null; })()`,
        );
        // (its autopilot as a pilot sets it — the MCP's: the height and heading held, the autothrottle at 85 m/s —, once the jet
        // flies in plane mode after the placing)
        await Bun.sleep(300);
        const ap = await app.js<string>(`__bh.camera.apSet({ ap: true, athr: true, spd: 110 })`);
        console.log(`  autopilot: ${ap}`);
        // (the look lowered onto the ship by its depression and the jet's angle of attack — its nose above its path)
        await app.js(`(() => { const a = (__bh.camera.airFlight?.last?.out?.alpha ?? 0) * 180 / Math.PI;
          __bh.camera.setLook(0, -(${((Math.atan2(alt, off) * 180) / Math.PI).toFixed(1)} + a + 2)); return 1; })()`);
        if (said) console.log(`  view: ${said}`);
        await Bun.sleep(1500);
        await app.shot(`${OUT}/${String(i).padStart(2, "0")}-${s.kind}.png`);
        console.log(`  shot ${s.kind} "${s.name}" ${s.len} m at ${s.sog} m/s, from ${Math.round(off)} m`);
        i++;
      }
      report.perf = await app.js(`__bh.game.perf({ gpu: true })`);
      // (twenty seconds of the clock on: each moved by its speed, none jumped)
      // (the ships as they are now — the list above was read before the shots —, their clock with them: the traffic's, which
      // after a pause catches the wall clock up half again as fast — the wall clock's 20 s were 30 of theirs)
      const t0 = await app.js<number>(`__bh.camera.trafficClock?.() ?? __bh.camera.trafficT ?? Date.now() / 1000`);
      const before = await app.js<typeof ships>(SHIPS);
      await Bun.sleep(20_000);
      const t1 = await app.js<number>(`__bh.camera.trafficClock?.() ?? __bh.camera.trafficT ?? Date.now() / 1000`);
      const later = await app.js<typeof ships>(SHIPS);
      const moved = before
        .map((s) => {
          const q = later.find((x) => x.id === s.id);
          return q
            ? {
                kind: s.kind,
                sog: s.sog,
                d: Math.hypot((q.lat - s.lat) * 111320, (q.lon - s.lon) * 111320 * Math.cos((s.lat * Math.PI) / 180)),
              }
            : null;
        })
        .filter((x) => x !== null);
      report.moved = { dt: t1 - t0, moved };
      for (const m of moved)
        if (m!.d > m!.sog * (t1 - t0) * 1.15 + 40) console.log(`  jumped: ${JSON.stringify(m)} in ${(t1 - t0).toFixed(1)} s`);
      for (const m of moved) expect(m!.d).toBeLessThanOrEqual(m!.sog * (t1 - t0) * 1.15 + 40);
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      expect(new Set(ships.map((s) => s.kind)).size).toBeGreaterThanOrEqual(2);
    } finally {
      await Bun.write(`${OUT}/ships.json`, JSON.stringify(report, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  5 * 60_000,
);
