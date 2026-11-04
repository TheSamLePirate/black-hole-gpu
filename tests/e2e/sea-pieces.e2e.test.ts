import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7 — relief sticking out of the sea while the world loads, and sometimes staying (Sam, 4 Nov 2026, watching the coast
// survey): the F-35 put over the sea near a coast with nothing loaded there yet (flyAt, the world running then frozen), the
// cockpit view looking a little down; a capture every SP_EVERY ms for SP_FOR s while the relief and the imagery stream in,
// each with the relief's state (tiles pending, the finest level, the cache's bakes); then one once all is in. The frames are
// looked at: the pieces, when they come, how long they stay.
//   SP_SITES: lat,lon,heading;… (the survey's Raz, Bonifacio, Étretat when unset)
// Output: remote-results/sea-pieces/<site>-NN.png, pieces.json (SP_OUT).
// Done when: each site's series and its final shot taken, no GPU error (their texts said). Duration: ~1 min a site.
const OUT = process.env.SP_OUT ?? "remote-results/sea-pieces";
afterAll(stopServer);
const EVERY = Number(process.env.SP_EVERY ?? 1500);
const FOR = Number(process.env.SP_FOR ?? 30);
const SITES = (process.env.SP_SITES ?? "48.035,-4.8,85;41.365,9.15,15;49.722,0.17,135")
  .split(";")
  .map((s, i) => ({ name: `s${i}`, at: s.split(",").map(Number) as [number, number, number] }));

test.skipIf(!E2E)(
  "T7: the relief out of the sea while it loads — frames from a craft just put over the sea",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const s of SITES) {
        const [lat, lon, hdg] = s.at;
        const utc = new Date(Date.UTC(2026, 6, 10) + (14 - lon / 15) * 3600e3).toISOString();
        await app.js(`(() => { __bh.freeze(false); __bh.game.setDate(${JSON.stringify(utc)}); __bh.game.set("weather", "fair");
          __bh.game.flyAt(${lat}, ${lon}, 300, ${hdg}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`);
        // (the rig applied while the world runs, then held: what streams in is all that changes)
        await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -6); __bh.freeze(true); q(1); }, 400))`);
        const series: unknown[] = [];
        const t0 = Date.now();
        for (let i = 0; Date.now() - t0 < FOR * 1000; i++) {
          await app.js(`new Promise((q) => { __bh.touch(); requestAnimationFrame(() => requestAnimationFrame(() => q(1))); })`);
          const f = `${OUT}/${s.name}-${String(i).padStart(2, "0")}.png`;
          const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
          await Bun.write(f, Buffer.from(data, "base64"));
          series.push({
            t: +((Date.now() - t0) / 1000).toFixed(1),
            ...(await app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer, t = r.earthTiles;
              return { pending: t.pending, finest: t.finest, ortho: t.orthoPending, phase: r.lastPhase }; })()`)),
          });
          await Bun.sleep(EVERY);
        }
        await app.settled(60_000);
        await app.js(
          `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 45) requestAnimationFrame(f); else q(1); }; f(); })`,
        );
        await app.shot(`${OUT}/${s.name}-final.png`);
        out[s.name] = { at: s.at, utc, series };
        console.log(`  ${s.name}: ${series.length} frames, last ${JSON.stringify(series.at(-1))}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/pieces.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
