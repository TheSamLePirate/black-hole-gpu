import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J1 J1-6 — the live image's complete colour exported (renderer.sceneColor, sceneColorEXR): J0's scene (Toulon-Hyères, the
// F-35 500 m over the Rade d'Hyères, the coast ahead), frozen, from the cockpit and from behind. For each: the scene's colour read
// back (pre-exposed linear radiance before the optics), the screen shot as shown (the UI hidden), the two compared block by block
// (48 × 27 blocks: the export's luminance × its exposure against the shot's linear luminance — Spearman's rank correlation: the same
// image, the display's curve and bloom aside), the half-float OpenEXR written (SC_OUT/<view>.exr), the export shown with a plain
// curve beside the shot (SC_OUT/board.jpg — ImageMagick: made where it is). SC_OUT (remote-results/scene-color).
// Duration: ~2 min (boot, the place's tiles, two views).
// Done when: both views exported, compared and written; no GPU error.

const OUT = process.env.SC_OUT ?? "remote-results/scene-color";
afterAll(stopServer);

test.skipIf(!E2E)(
  "the live image's colour exported: the scene before the optics, the same image as shown",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1440, height: 810, lang: "fr", hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const [lat, lon, agl, hdg, v] = J0_SCENE.start;
      const place = `__bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
        __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
      await app.settled(180_000);
      await app
        .dataSettled("scene colour: Toulon-Hyères", { maxMs: 60_000 })
        .catch((e) => console.log(`  (data not settled: ${String(e).slice(0, 160)})`));
      await app.exposureSettled?.();
      const out: Record<string, unknown> = {};
      for (const mount of ["cockpit", "chase"] as const) {
        // (the mount set with the clock running — set frozen from the placing on, the craft kept the chase view —, 40 frames flown,
        // then frozen again)
        await app.js(`(async () => { __bh.freeze(false); __bh.settings.shipMount = "${mount}"; __bh.refresh(); __bh.camera.viewReset();
          const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 40; i++) await f();
          __bh.freeze(true); return 1; })()`);
        console.log(`  ${mount}: the mount ${await app.js<string>("__bh.settings.shipMount")}`);
        await app.settled(60_000);
        await app.exposureSettled?.();
        // (the shot first, the UI hidden — then the export, the view frozen: the same image)
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 30 ? q(1) : requestAnimationFrame(f)); f(); })`);
        const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
        const png = new Uint8Array(Buffer.from(shot.data, "base64"));
        await Bun.write(`${OUT}/${mount}-shot.png`, png);
        const r = await app.js<{
          width: number;
          height: number;
          exposure: number;
          source: string;
          ms: number;
          grid: number[];
          preview: string;
          exr: string;
          finite: number;
        }>(`(async () => {
          const R = __bh.renderer, t0 = performance.now();
          const c = await R.sceneColor(__bh.settings);
          const ms = performance.now() - t0;
          const GX = 48, GY = 27, grid = new Array(GX * GY).fill(0), cnt = new Array(GX * GY).fill(0);
          let finite = 0;
          const cv = document.createElement("canvas"); cv.width = c.width; cv.height = c.height;
          const g = cv.getContext("2d"), img = g.createImageData(c.width, c.height);
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
            const i = 4 * (y * c.width + x), r = c.data[i] * c.exposure, gg = c.data[i + 1] * c.exposure, b = c.data[i + 2] * c.exposure;
            if (Number.isFinite(r + gg + b)) finite++;
            const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
            const k = Math.min(GY - 1, Math.floor((y * GY) / c.height)) * GX + Math.min(GX - 1, Math.floor((x * GX) / c.width));
            grid[k] += L; cnt[k]++;
            // (a plain curve for the eye: x / (1 + x), sRGB)
            const s = (v) => { const m = Math.max(v, 0) / (1 + Math.max(v, 0)); return 255 * (m <= 0.0031308 ? 12.92 * m : 1.055 * m ** (1 / 2.4) - 0.055); };
            img.data[i] = s(r); img.data[i + 1] = s(gg); img.data[i + 2] = s(b); img.data[i + 3] = 255;
          }
          g.putImageData(img, 0, 0);
          const blob = await R.sceneColorEXR(__bh.settings);
          const exr = await new Promise((q) => { const f = new FileReader(); f.onload = () => q(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
          return { width: c.width, height: c.height, exposure: c.exposure, source: c.source, ms: +ms.toFixed(1), finite: finite / (c.width * c.height),
            grid: grid.map((v, k) => v / Math.max(cnt[k], 1)), preview: cv.toDataURL("image/png").split(",")[1], exr };
        })()`);
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        await Bun.write(`${OUT}/${mount}-export.png`, Buffer.from(r.preview, "base64"));
        await Bun.write(`${OUT}/${mount}.exr`, Buffer.from(r.exr, "base64"));
        // (the shot's linear luminance on the same blocks)
        const S = readPng(png);
        const GX = 48,
          GY = 27;
        const sg = new Array(GX * GY).fill(0),
          sc = new Array(GX * GY).fill(0);
        const lin = (v: number) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        for (let y = 0; y < S.height; y++)
          for (let x = 0; x < S.width; x++) {
            const i = S.channels * (y * S.width + x);
            const k = Math.min(GY - 1, Math.floor((y * GY) / S.height)) * GX + Math.min(GX - 1, Math.floor((x * GX) / S.width));
            sg[k] += 0.2126 * lin(S.data[i]!) + 0.7152 * lin(S.data[i + 1]!) + 0.0722 * lin(S.data[i + 2]!);
            sc[k]++;
          }
        const shotGrid = sg.map((v, k) => v / Math.max(sc[k], 1));
        const rank = (a: number[]) => {
          const o = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
          const r = new Array(a.length);
          o.forEach(([, i], k) => {
            r[i] = k;
          });
          return r as number[];
        };
        const ra = rank(r.grid),
          rb = rank(shotGrid);
        const n = ra.length;
        let d2 = 0;
        for (let i = 0; i < n; i++) d2 += (ra[i]! - rb[i]!) ** 2;
        const spearman = 1 - (6 * d2) / (n * (n * n - 1));
        const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
        out[mount] = {
          width: r.width,
          height: r.height,
          source: r.source,
          exposure: r.exposure,
          readMs: r.ms,
          finite: r.finite,
          spearman: +spearman.toFixed(4),
          exportMedian: +med(r.grid).toFixed(4),
          shotMedian: +med(shotGrid).toFixed(4),
        };
        console.log(`  ${mount}: ${JSON.stringify(out[mount])}`);
        expect(r.finite).toBeGreaterThan(0.999);
        expect(spearman).toBeGreaterThan(0.9);
      }
      await Bun.write(`${OUT}/results.json`, JSON.stringify(out, null, 1));
      const lab = (f: string, t: string) => [
        "(",
        f,
        "-resize",
        "960x",
        "-gravity",
        "north",
        "-fill",
        "white",
        "-undercolor",
        "#000a",
        "-pointsize",
        "22",
        "-annotate",
        "+0+8",
        t,
        ")",
      ];
      const args: string[] = [];
      for (const m of ["cockpit", "chase"])
        args.push(
          "(",
          ...lab(`${OUT}/${m}-shot.png`, `${m} — l'image affichée`),
          ...lab(`${OUT}/${m}-export.png`, `${m} — la couleur exportée (avant l'optique, courbe simple)`),
          "+append",
          ")",
        );
      const made = await $`magick ${[...args, "-append", "-quality", "84", `${OUT}/board.jpg`]}`.nothrow().quiet();
      console.log(made.exitCode ? `  the board not made here (ImageMagick)` : `  board: ${OUT}/board.jpg`);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  360_000,
);
