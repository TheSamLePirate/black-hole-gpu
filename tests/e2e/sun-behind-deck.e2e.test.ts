import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C10 — the Sun hidden behind a thick deck (trace.wgsl main: a small disc's four rays each take the cloud pass's clouds —
// earthNear let them go after the first, the three others marched their own, lit otherwise: a pale square, the disc's
// rectangle, over the Sun behind an overcast). La Mancha, 17:00 UTC (the Sun ~29° up), the F-35's cockpit at 300 m under the
// "overcast" deck (600–2 000 m, cover 0.95), its heading the Sun's azimuth, the view at its height, frozen, the exposure
// locked, no bloom nor flare: the disc's rectangle against the ring round it (renderer.skyDiscs: where it is); then "fair" at
// the meter's exposure, the disc shown. SB_OUT: the shots (remote-results/sun-behind-deck).
// Duration: ~2 min on this Mac.
// Done when: under the deck the rectangle within 3 % of the ring round it, in fair weather the disc brighter (over 1.08), no GPU error.
const OUT = process.env.SB_OUT ?? "remote-results/sun-behind-deck";
afterAll(stopServer);
test.skipIf(!E2E)(
  "C10: the Sun behind an overcast deck leaves no trace of its disc's rectangle",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", lensFlare: 0, bloom: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T17:00:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.set("weather", "overcast"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, 300, 0, 140); return 1; })()`,
      );
      await Bun.sleep(500);
      const sun = await app.js<{ azDeg: number; apparentAltDeg: number }>(`__bh.camera.skyInfo().sun`);
      await app.js(
        `(() => { __bh.game.flyAt(39.42, -3.05, 300, ${sun.azDeg}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${Math.min(sun.apparentAltDeg, 80)}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
      );
      let locked = false;
      for (const [k, js] of [
        ["overcast", ""],
        // (the meter's own exposure again: the overcast's locked one blows the fair sky white round the disc)
        [
          "fair",
          `__bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0); __bh.settings.autoExposure = true; __bh.settings.exposure = 0;`,
        ],
      ] as const) {
        await app.js(`(() => { ${js} __bh.touch(); return 1; })()`);
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
        if (!locked) {
          await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          locked = true;
        }
        const d = await app.js<{ x: number; y: number; r: number } | null>(
          `(() => { const d = (__bh.renderer.skyDiscs ?? []).find((b) => !b.moon); return d ? { x: d.x, y: d.y, r: d.r } : null; })()`,
        );
        const file = `${OUT}/${k}.png`;
        await app.shot(file);
        expect(d, "the Sun's disc in view").not.toBeNull();
        const img = readPng(new Uint8Array(await Bun.file(file).arrayBuffer()));
        const cx = (0.5 + 0.5 * d!.x) * img.width;
        const cy = (0.5 - 0.5 * d!.y) * img.height;
        const rr = 0.5 * d!.r * img.height;
        // (the rectangle's inside — the disc and its margin — against a ring 2–4 radii out)
        let si = 0;
        let ni = 0;
        let so = 0;
        let no = 0;
        for (let y = Math.floor(cy - 4 * rr - 12); y <= cy + 4 * rr + 12; y++)
          for (let x = Math.floor(cx - 4 * rr - 12); x <= cx + 4 * rr + 12; x++) {
            if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
            const o = (y * img.width + x) * img.channels;
            const l = 0.2126 * img.data[o]! + 0.7152 * img.data[o + 1]! + 0.0722 * img.data[o + 2]!;
            const dd = Math.hypot(x - cx, y - cy);
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= rr + 2) {
              si += l;
              ni++;
            } else if (dd >= 2 * rr + 8 && dd <= 4 * rr + 12) {
              so += l;
              no++;
            }
          }
        const ratio = si / Math.max(ni, 1) / Math.max(so / Math.max(no, 1), 1e-3);
        out[k] = { ratio: +ratio.toFixed(3), disc: d, px: [Math.round(cx), Math.round(cy), +rr.toFixed(1)] };
        console.log(
          `  ${k}: the disc's rectangle / the ring round it ${ratio.toFixed(3)} (disc at ${Math.round(cx)}, ${Math.round(cy)}, r ${rr.toFixed(1)} px)`,
        );
      }
      await app.js(`(() => { __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/sun.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    const r = out as { overcast: { ratio: number }; fair: { ratio: number }; gpuErrors: number };
    expect(Math.abs(r.overcast.ratio - 1)).toBeLessThan(0.03);
    // (the ring 2–4 radii out already in the aureole, near white: the disc 1.125 times it measured)
    expect(r.fair.ratio).toBeGreaterThan(1.08);
    expect(r.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
