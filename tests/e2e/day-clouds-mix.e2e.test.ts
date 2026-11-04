import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Q5 C5 — the day's clouds dated (system/day-clouds.ts dayCloudsPair; renderer.dayCloudsOf, dayCloudsMixOn): the real weather on
// the evening of 1 November 2026 (19:00 UTC), the Earth from the free camera 2 000 km over the Bay of Biscay looking west:
// the two days' mosaics (1 and 2 November, NASA GIBS) mixed region by region by the time after each one's pass near 13:30 local
// solar time — Europe 5–6 h after its pass, the Atlantic nearer its own —, against the 1st's alone. Shots both ways, the
// pair in force, the mix's key moving with the clock (an hour later). MX_OUT: the shots (remote-results/day-clouds-mix).
// Done when: both mosaics in, both ways shot, no GPU error. Duration: ~2 min (two 2 MB mosaics).
const OUT = process.env.MX_OUT ?? "remote-results/day-clouds-mix";
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5 C5: the day's clouds between two days' passes, region by region",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { Object.assign(__bh.settings, { weather: "real", earthClouds: 1, lookProfile: "neutral", motionBlur: 0, dof: false }); document.body.classList.add("hide-ui"); return 1; })()`,
      );
      const iso = "2026-11-01T19:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.viewAt(45, -5, { altM: 2e6, heading: 270, pitch: -35, fov: 50 }); return 1; })()`,
      );
      out.pair = await app
        .waitFor(`__bh.renderer.dayCloudsOf?.next === "2026-11-02"`, 60_000)
        .then(() => app.js(`__bh.renderer.dayCloudsOf`))
        .catch(() => "the pair not in after 60 s");
      console.log(`  pair: ${JSON.stringify(out.pair)}`);
      await app.js(`(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); return 1; })()`);
      await app.settled(120_000);
      for (const [k, on] of [
        ["mix", true],
        ["first", false],
      ] as const) {
        await app.js(`(async () => { const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)); r.dayCloudsMixOn = ${on};
          for (let i = 0; i < 180; i++) { __bh.touch(); await f(); } return 1; })()`);
        out[`${k}-key`] = await app.js(`__bh.renderer.dayCloudsOf?.key`);
        await app.shot(`${OUT}/${k}.png`);
        console.log(`  ${k}: ${out[`${k}-key`]}`);
      }
      await app.js(`(() => { __bh.renderer.dayCloudsMixOn = true; __bh.game.setDate("2026-11-01T20:00:00Z"); return 1; })()`);
      out.laterKey = await app
        .waitFor(`(__bh.touch(), __bh.renderer.dayCloudsOf?.key === "2026-11-01|2026-11-02|20")`, 30_000)
        .then(() => app.js(`__bh.renderer.dayCloudsOf?.key`))
        .catch(() => app.js(`__bh.renderer.dayCloudsOf?.key`));
      console.log(`  an hour later: ${out.laterKey}`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/mix.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
    expect(typeof out.pair).toBe("object");
    expect(out["mix-key"]).not.toBe(out["first-key"]);
    expect(out.laterKey).toBe("2026-11-01|2026-11-02|20");
  },
  5 * 60_000,
);
