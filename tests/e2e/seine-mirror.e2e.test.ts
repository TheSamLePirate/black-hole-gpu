import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { gpuTimes, showView } from "./lib/bridge-views";

// (25 Nov 2026 — PROBLEMES « les reflets de la Seine ») The Seine's reflections with the near cells' buildings mirrored (trace.wgsl nearMirror): the
// view of Grenelle, the lever on and off (shots), the GPU's time per image in A B B A A B B A (profiler off), the water's passes profiled.
// Duration: ~1.5 min a view (this Mac).
// Done when: the shots, the series and the table.
const OUT = process.env.SM_OUT ?? "remote-results/seine-mirror";
const VIEWS = (process.env.SM_VIEWS ?? "grenelle").split(",");
const PLACES: Record<string, { at: [number, number]; aglM: number; look: [number, number]; lookAglM: number }> = {
  grenelle: { at: [48.8484, 2.2771], aglM: 12, look: [48.8503, 2.28], lookAglM: 8 },
  "alexandre-iii": { at: [48.8628, 2.3122], aglM: 8, look: [48.8642, 2.3135], lookAglM: 6 },
};
const frames = (n: number) =>
  `(async () => { for (let i = 0; i < ${n}; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); } return 1; })()`;
describe.skipIf(!E2E)("the Seine's mirror of the near buildings", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: true });
    app.steps(VIEWS);
    app.estimate(300);
  }, 900_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("on, off, cost", async () => {
    for (const key of VIEWS) {
      await app.step(key);
      const P = PLACES[key]!;
      const v = await showView(app, { key, ...P, holds: "sc.cellBridges > 0" });
      // (25 Nov 2026: every wanted cell resident and mirrored before measuring — the first kerr-mini run at Alexandre III measured 7 of
      // its 21: bounded, its count shown every 10 s, the test failing with what is missing)
      const full = `(() => { const s = __bh.renderer.nearCells(); return !!s && s.wanted > 0 && s.missing === 0 && s.mirrorCells >= s.cells; })()`;
      const t0 = Date.now();
      let st = "",
        shown = -10;
      for (;;) {
        st = await app.js<string>(`JSON.stringify(__bh.renderer.nearCells())`);
        if (await app.js<boolean>(full)) break;
        const s = JSON.parse(st ?? "null") ?? {};
        const waited = Math.round((Date.now() - t0) / 1000);
        if (waited >= 120)
          throw new Error(
            `${key}: near cells not all resident and mirrored in 120 s — ${s.cells} resident, ${s.missing} of ${s.wanted} missing, ${s.mirrorCells} mirrored (${st})`,
          );
        if (waited - shown >= 10) {
          shown = waited;
          console.log(`  ${key} cells ${s.cells}/${s.wanted}, missing ${s.missing}, mirrored ${s.mirrorCells} · ${waited} s / 120`);
        }
        await Bun.sleep(2000);
      }
      console.log(`  ${key} near cells (all resident, ${Math.round((Date.now() - t0) / 1000)} s): ${st}`);
      for (const on of [true, false]) {
        await app.js(`(() => { __bh.renderer.nearMirrorOn = ${on}; __bh.touch(); return 1; })()`);
        await app.js(frames(30));
        await Bun.sleep(1500);
        await app.shot(`${OUT}/${key}-${on ? "on" : "off"}.png`);
      }
      for (const on of [true, false, false, true, true, false, false, true]) {
        await app.js(`(() => { __bh.renderer.nearMirrorOn = ${on}; return 1; })()`);
        await app.js(frames(20));
        console.log(`  ${key} gpu mirror ${on ? "on " : "off"}: ${JSON.stringify(await gpuTimes(app))}`);
      }
      await app.js(`(() => { __bh.renderer.nearMirrorOn = true; return 1; })()`);
      const t = await app.js(`(async () => {
        const p = __bh.renderer.prof; p.enabled = true; p.every = 1; p.reset();
        for (let i = 0; i < 90; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); }
        const rows = p.table(60).filter((r) => /water|lite/i.test(r.label)).map((r) => r.label + ': ' + r.ms.toFixed(2));
        p.enabled = false; return JSON.stringify(rows); })()`);
      console.log(`  ${key} profiler (mirror on): ${t}`);
      await app.stepDone(key, v.ready);
      expect(v.ready).toBe(true);
    }
  }, 1_200_000);
});
