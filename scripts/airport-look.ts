// The airport view looked at (PLAN-AEROPORT-AAA): the game booted, an airport's view started, a picture every few seconds with its
// state (the queues, the shot, the caption) — a quick look, not a test.
//
//   bun scripts/airport-look.ts <out-dir> [ICAO=KLAX] [shots=8] [every=6] [mode=cinema]
import { mkdirSync } from "node:fs";
import { App, stopServer } from "../tests/e2e/lib/app";

const out = process.argv[2] ?? "airport-look";
const code = process.argv[3] ?? "KLAX";
const n = Number(process.argv[4] ?? 8);
const every = Number(process.argv[5] ?? 6);
const mode = process.argv[6] ?? "cinema";
mkdirSync(out, { recursive: true });
const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  console.log("start:", await app.js(`__bh.airport.start(${JSON.stringify(code)}, ${JSON.stringify(mode)})`));
  await app.settled(120_000).catch(() => console.log("settled: timed out (going on)"));
  for (let k = 0; k < n; k++) {
    await Bun.sleep(every * 1000);
    const st = await app.js<unknown>(
      `(() => { const S = __bh.airport.state(); if (!S) return null;
        // (the traffic on the ground or low, by its phase: what the departures' detection sees)
        const ph = {}; for (const c of __bh.camera.trafficNow()) if (c.gnd || c.over < 600) ph[c.phase] = (ph[c.phase] ?? 0) + 1;
        // (where the eye is against the one filmed: its geodetic place, the craft's, their distance — LOOK_DEBUG)
        let dbg = null;
        const cur = S.current && __bh.camera.trafficNow().find((c) => c.id === S.current);
        const eye = __bh.camera.viewController().geoNow();
        if (cur && eye) { const R = 6371000, D = Math.PI / 180; const lat = Math.asin(cur.p[2] / Math.hypot(...cur.p)) / D, lon = Math.atan2(cur.p[1], cur.p[0]) / D;
          dbg = { eye: [eye.lat.toFixed(5), eye.lon.toFixed(5), Math.round(eye.alt)], craft: [lat.toFixed(5), lon.toFixed(5), Math.round(cur.alt)], dKm: (Math.hypot((eye.lat - lat) * D * R, (eye.lon - lon) * D * R * Math.cos(lat * D)) / 1000).toFixed(3) }; }
        const radio = __bh.voice.asked.filter((x) => x.speaker === "tower" || x.speaker === "pilot").slice(-2).map((x) => x.text);
        const fx = __bh.camera.trafficFx?.size ?? 0;
        const own = __bh.settings.vessel + " " + (__bh.camera.geoNow() ? __bh.camera.geoNow().lat.toFixed(3) + "," + __bh.camera.geoNow().lon.toFixed(3) : "");
        return { own, fx, shot: S.shot, q: S.queue.map((x) => x.cs + (x.dep ? "↗" : "↘") + Math.round(x.eta)).join(" "), cap: __bh.airport.caption()?.title, ph }; })()`,
    );
    console.log(`${k}: ${JSON.stringify(st)}`);
    await app.shot(`${out}/shot-${String(k).padStart(2, "0")}.png`);
  }
} finally {
  app.close();
  stopServer();
}
process.exit(0);
