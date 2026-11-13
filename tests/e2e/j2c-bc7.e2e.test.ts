import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J2 J2-C, the study (Sam's decision 4, 12 Nov 2026: « BC7 étudiée après J2-1 », no new dependency): what block compression of
// the imagery's pages would keep and cost. J0's scene (the F-35's cockpit, 500 m over the Rade d'Hyères), frozen, its tiles in; then
// earthTiles.bc7Study() over land (J2C_PLACE, default the Gapeau's plain 300 m — J0's sea has no orthophoto): the 1024² imagery texture's layers holding pages (the orthophotos' levels, the relief's imagery), each copied
// with its mips, compressed to BC7 by the GPU encoder already in the code (bc-encode.ts), timed, both read back through the hardware's
// decoding — the PSNR of each mip, the bytes before and after. J2C_OUT (remote-results/j2c-bc7/<machine>).
// Duration: ~3 min (boot, the place's tiles, the study ~10 s).
// Done when: the feature said, every layer studied (or none without the feature), results.json written, no GPU error.

const MACHINE = process.env.J2C_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J2C_OUT ?? `remote-results/j2c-bc7/${MACHINE}`;
// (over land: J0's view is over the sea, where the IGN has no orthophoto — its pages uniform or empty; default the Gapeau's plain)
const PLACE = (process.env.J2C_PLACE ?? "43.12,6.13,300,20,140").split(",").map(Number) as [number, number, number, number, number];
afterAll(stopServer);

test.skipIf(!E2E)(
  "J2-C: the imagery's pages in BC7 — their PSNR, the encoder's time, the memory",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1440, height: 810, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const [lat, lon, agl, hdg, v] = PLACE;
      await app.js(`(async () => { __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
        for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app.dataSettled("J2-C: J0", { maxMs: 60_000 }).catch((e) => console.log(`  (data not settled: ${String(e).slice(0, 120)})`));
      const r = await app.js<{
        feature: boolean;
        layers: { layer: number; kind: string; encodeMs: number; psnrByMip: number[]; rgbaBytes: number; bc7Bytes: number }[];
        textureRgbaBytes: number;
      } | null>(`__bh.renderer.earthTiles.bc7Study(16)`);
      console.log(`  feature texture-compression-bc: ${r?.feature}`);
      for (const l of r?.layers ?? [])
        console.log(
          `  ${l.kind} (layer ${l.layer}): PSNR by mip ${JSON.stringify(l.psnrByMip)} dB, encode ${l.encodeMs} ms, ${l.rgbaBytes} → ${l.bc7Bytes} B`,
        );
      const gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      await Bun.write(`${OUT}/results.json`, JSON.stringify({ machine: MACHINE, study: r, gpuErrors }, null, 1));
      console.log(`  J2-C: ${OUT}/results.json`);
      expect(r).not.toBeNull();
      expect(gpuErrors).toBe(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
