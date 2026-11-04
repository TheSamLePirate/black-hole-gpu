import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// Q6 I8 — the GoPro lens (decision 38; src/lens.ts, display.wgsl): outside the cockpit, the view as an action camera films it —
// rectilinear within 28°, compressed past it, 100° across, a 2.39:1 band, the HUD hidden; rendered wider and 1.2 × larger.
// The F-35 over Tarifa from its quarter view, frozen: the same view with the rectilinear lens then the GoPro one — each a shot
// and its GPU time over 3 s —; the band's black margins, the picture between them, the HUD's canvas hidden, the cost's ratio.
// Then the minimal HUD (decision 32 (6)): none by default; asked, its line in the band's lower margin, in the units shown.
// Output: remote-results/gopro/{standard,gopro,gopro-hud}.png (GP_OUT).
// Done when: both lenses shot and timed, the band and the minimal HUD checked, no GPU error.
// Duration: ~1.5 min (the tiles, two shots, 2 × 3 s timed).
const OUT = process.env.GP_OUT ?? "remote-results/gopro";
afterAll(stopServer);

const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
type Png = ReturnType<typeof png>;
/** mean luminance of rows y0 … y0 + h over the image's left half (the page's own panels — the tactical map, the credits — sit
 *  over the canvas's lower right and bottom, outside what the lens draws) */
function mean(a: Png, y0: number, h: number) {
  let s = 0;
  const w = Math.floor(a.width / 2);
  for (let y = y0; y < y0 + h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * a.width + x) * a.channels;
      s += 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
    }
  return s / (w * h);
}

test.skipIf(!E2E)(
  "Q6 I8: the GoPro lens — the band, the picture bent within it, the HUD hidden, its cost",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.flyAt(36.08, -5.6, 700, 20, 200);
        __bh.settings.shipMount = "quarter"; __bh.refresh(); return 1; })()`);
      await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 90_000).catch(() => {});
      await app.js(`(() => { __bh.freeze(true); document.body.classList.add("hide-ui"); return 1; })()`);
      await app.settled(60_000);
      const rows: Record<string, unknown> = {};
      for (const lens of ["standard", "gopro"]) {
        await app.js(`(() => { __bh.settings.cameraLens = "${lens}"; __bh.touch(); return 1; })()`);
        await app.js(
          `new Promise((r) => { let n = 0; const f = () => { __bh.touch(); (++n >= 30 ? r(1) : requestAnimationFrame(f)); }; requestAnimationFrame(f); })`,
        );
        await app.settled(60_000);
        await app.exposureSettled();
        const t = await app.js<{ gpuMs: number; target: number[]; canvas: number[]; overlay: string; lens: boolean }>(`(async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          __bh.game.perf(); r.prof.enabled = true; const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
          const p = __bh.game.perf(); r.prof.enabled = false; const cv = document.querySelector("canvas");
          return { gpuMs: +p.gpuFrameMs.toFixed(2), target: [r.live?.width ?? 0, r.live?.height ?? 0], canvas: [cv.width, cv.height],
            overlay: document.getElementById("overlay").style.visibility, lens: r.lens }; })()`);
        await app.shot(`${OUT}/${lens}.png`);
        rows[lens] = t;
      }
      const g = png(`${OUT}/gopro.png`);
      const band = Math.round(g.width / 2.39);
      const top = Math.round((g.height - band) / 2);
      // (the bottom margin above the credits' line, 24 px)
      const margins = [mean(g, 0, Math.max(top - 4, 1)), mean(g, top + band + 4, Math.max(g.height - top - band - 28, 1))];
      const middle = mean(g, Math.round(g.height / 2) - 40, 80);
      const st = rows.standard as { gpuMs: number },
        gp = rows.gopro as { gpuMs: number; overlay: string; lens: boolean };
      const out = {
        ...rows,
        margins: margins.map((m) => +m.toFixed(1)),
        middle: +middle.toFixed(1),
        costRatio: +(gp.gpuMs / st.gpuMs).toFixed(2),
      };
      console.log(`  gopro: ${JSON.stringify(out)}`);
      expect(gp.lens).toBe(true);
      expect(gp.overlay).toBe("hidden");
      expect(Math.max(...margins)).toBeLessThan(3);
      expect(middle).toBeGreaterThan(20);
      // (the minimal HUD — decision 32 (6) —: none by default; asked, a line in the band's lower margin, the units shown)
      const hudOff = await app.js<string>(
        `(() => { const e = document.getElementById("gopro-hud"); return e ? e.style.display : "none"; })()`,
      );
      expect(hudOff).toBe("none");
      await app.js(`(() => { __bh.settings.goproHud = "minimal"; __bh.touch(); return 1; })()`);
      await app.js(
        `new Promise((r) => { let n = 0; const f = () => { __bh.touch(); (++n >= 20 ? r(1) : requestAnimationFrame(f)); }; requestAnimationFrame(f); })`,
      );
      const hud = await app.js<{ text: string; display: string; y: number; bandBottom: number; h: number }>(`(() => {
        const e = document.getElementById("gopro-hud"), r = document.querySelector("canvas").getBoundingClientRect(), b = e.getBoundingClientRect();
        return { text: e.textContent, display: e.style.display, y: b.top + b.height / 2, bandBottom: r.top + (r.height + r.width / 2.39) / 2, h: r.bottom }; })()`);
      await app.shot(`${OUT}/gopro-hud.png`);
      console.log(`  gopro hud: ${JSON.stringify(hud)}`);
      expect(hud.display).toBe("");
      expect(hud.text).toMatch(/M\/S .* M .*°/);
      expect(hud.y).toBeGreaterThan(hud.bandBottom);
      expect(hud.y).toBeLessThan(hud.h);
      await app.js(`(() => { __bh.settings.goproHud = "off"; return 1; })()`);
      expect(await app.js<number>(`__bh.renderer.gpuErrors`)).toBe(0);
      await app.js(
        `(() => { __bh.settings.cameraLens = "standard"; __bh.freeze(false); document.body.classList.remove("hide-ui"); return 1; })()`,
      );
    } finally {
      await app.close();
    }
  },
  300_000,
);
