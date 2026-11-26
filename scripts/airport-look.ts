// The airport view looked at (PLAN-AEROPORT-AAA): the game booted, an airport's view started, a picture every few seconds with its
// state (the queues, the shot, the caption) — a quick look, not a test.
//
//   bun scripts/airport-look.ts <out-dir> [ICAO=KLAX] [shots=8] [every=6]
import { mkdirSync } from "node:fs";
import { App, stopServer } from "../tests/e2e/lib/app";

const out = process.argv[2] ?? "airport-look";
const code = process.argv[3] ?? "KLAX";
const n = Number(process.argv[4] ?? 8);
const every = Number(process.argv[5] ?? 6);
mkdirSync(out, { recursive: true });
const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  console.log("start:", await app.js(`__bh.airport.start(${JSON.stringify(code)}, "auto")`));
  await app.settled(120_000).catch(() => console.log("settled: timed out (going on)"));
  for (let k = 0; k < n; k++) {
    await Bun.sleep(every * 1000);
    const st = await app.js<unknown>(
      `(() => { const S = __bh.airport.state(); return S && { shot: S.shot, current: S.current, q: S.queue.map((x) => x.cs + (x.dep ? "↗" : "↘") + Math.round(x.eta)).join(" "), cap: __bh.airport.caption() }; })()`,
    );
    console.log(`${k}: ${JSON.stringify(st)}`);
    await app.shot(`${out}/shot-${String(k).padStart(2, "0")}.png`);
  }
} finally {
  app.close();
  stopServer();
}
process.exit(0);
