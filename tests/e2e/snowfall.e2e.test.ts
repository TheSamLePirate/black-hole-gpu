import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q8 C8 — the falling snow (controller/piloting.ts rainView: snow where the air at the camera is under 1 °C — the report's or
// the model's air, else the climatology's (weather.ts climateT2m) cooled with the height —; display.wgsl rainStreaks: flakes
// ~5 mm, falling ~1 m/s, white, no wet glass): the weather "rain" over the Chamonix valley, the F-35 slow and low (300 m over the
// ground, still — faster than ~40 m/s the falling drops and flakes are not drawn, a blur the eye does not see), the cockpit looking ahead, on 15 January (snow) and 15 July (rain), frozen once placed; the precipitation's
// kind and strength the renderer was given, and a shot of each.
// SF_OUT: the shots (remote-results/snowfall).
// Duration: ~3 min on this Mac.
// Done when: both shots taken, January's snow and July's rain read from the renderer, no GPU error.
const OUT = process.env.SF_OUT ?? "remote-results/snowfall";
afterAll(stopServer);
test.skipIf(!E2E)(
  "C8: snow falls in a January rain over the Alps, rain in July",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); __bh.game.set("weather", "rain"); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (the weather's rain set in first, the world running: frozen at once, the first place had none)
      await app.js(`(() => { __bh.game.flyAt(45.92, 6.87, 300, 60, 70); return 1; })()`);
      await app
        .waitFor(`(__bh.touch(), __bh.renderer.rain !== null)`, 30_000)
        .catch(() => console.warn("  no precipitation after 30 s of the world running"));
      for (const [k, iso] of [
        // (a first place not read: whatever came first had no precipitation handed to the image — unexplained in this harness,
        // the warm-up above notwithstanding; each later one has it)
        ["warm", "2026-07-15T11:00:00Z"],
        ["july", "2026-07-15T11:00:00Z"],
        ["january", "2026-01-15T11:00:00Z"],
      ] as const) {
        await app.js(
          `(() => { __bh.freeze(false); __bh.game.setDate("${iso}"); __bh.game.flyAt(45.92, 6.87, 300, 60, 0); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        // (held where it was put — slow, the jet pitched up into the deck before the shot —: frozen once the mount is set)
        await app.js(`new Promise((q) => setTimeout(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`);
        await app.settled(120_000);
        // (the precipitation handed to the image — the weather's rain under its deck: given within 30 s, else said)
        await app
          .waitFor(`(__bh.touch(), __bh.renderer.rain !== null)`, 30_000)
          .catch(() => console.warn(`  ${k}: no precipitation handed to the image after 30 s`));
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        const r = await app.js<{ rain: number; snow: boolean; dust: boolean } | null>(
          `(() => { const r = __bh.renderer.rain; return r ? { rain: +r.rain.toFixed(3), snow: !!r.snow, dust: !!r.dust } : null; })()`,
        );
        if (k === "warm") continue;
        await app.shot(`${OUT}/${k}.png`);
        out[k] = r;
        console.log(`  ${k}: ${JSON.stringify(r)}`);
      }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/snowfall.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect((out.january as { snow: boolean } | null)?.snow).toBe(true);
    expect((out.july as { snow: boolean } | null)?.snow).toBe(false);
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
