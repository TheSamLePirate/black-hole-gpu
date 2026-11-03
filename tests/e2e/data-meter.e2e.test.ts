import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS, sceneryReady } from "./lib/plan-views";

// The loading indicator (Settings › Render › Show the data's loading): the F-35 put at Chamonix, then over the Mont Blanc,
// then Paris, with nothing loaded yet. Watch the line at the top centre: the relief's tiles counted down, the photographs',
// the scenery's steps (land cover → roads and water → buildings n/N → forest → assembling), then gone. A shot at each new step.
// Done when: each place's tiles and scenery are in and the indicator has been gone 3 s (150 s at most a place), then it is
// checked hidden under hide-ui and with the setting off.
// Duration: ~1.5 min (this Mac, in a window).
const OUT = "remote-results/data-meter";
afterAll(stopServer);

type Sample = { t: number; hidden: boolean; state: string; segs: { kind: string; text: string }[] };
const READ = `(() => { const m = document.querySelector('[data-testid="data-meter"]');
  return { t: performance.now(), hidden: !m || m.hidden, state: m?.dataset.state ?? "none",
    segs: m ? [...m.children].map((e) => ({ kind: e.dataset.kind, text: e.textContent })) : [] }; })()`;

test.skipIf(!E2E)(
  "the data's loading: the tiles, the scenery's steps shown while they come, gone once in",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const t0 = performance.now();
    const step = (what: string) => console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)} s] ${what}`);
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const samples: (Sample & { at: string })[] = [];
    const shots: { file: string; at: string; text: string; s: number }[] = [];
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, showLoading: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      // (each place: the meter followed until the tiles and the scenery are in — 150 s at most —, a shot at each new segment or step)
      const follow = async (name: string, at: number[], date: string) => {
        const place = `__bh.game.flyAt(${at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(date)}); ${place} __bh.freeze(true); return 1; })()`);
        const seen = new Set<string>();
        const start = performance.now();
        let idleFor = 0;
        while (performance.now() - start < 150_000) {
          await app.js(`(() => { __bh.touch(); return 1; })()`);
          const s = await app.js<Sample>(READ);
          samples.push({ ...s, at: name });
          const sc = s.segs.find((x) => x.kind === "scenery");
          const keys = [...s.segs.map((x) => x.kind), ...(sc ? [sc.text.replace(/\s\d+\/\d+$/, "")] : [])];
          const fresh = keys.filter((k) => !seen.has(k));
          if (fresh.length) {
            for (const k of fresh) seen.add(k);
            const file = `${name}-${shots.filter((x) => x.at === name).length}.png`;
            await app.shot(`${OUT}/${file}`);
            const text = s.segs.map((x) => x.text).join(" · ");
            shots.push({ file, at: name, text, s: +((performance.now() - start) / 1000).toFixed(1) });
            step(`${name}: ${text}`);
          }
          const scenery = await app.js<{ status: string }>(`(() => __bh.renderer.earthScenery.stats())()`);
          // (done: the meter idle 3 s running with the scenery in — its status ready, or degraded and said)
          idleFor = s.hidden && (scenery.status === "ready" || scenery.status === "degraded") ? idleFor + 0.5 : 0;
          if (idleFor >= 3) break;
          await Bun.sleep(500);
        }
        const sc = await sceneryReady(app, 1000);
        step(`${name}: ${idleFor >= 3 ? "all in" : "NOT all in after 150 s"} ${JSON.stringify(sc)}`);
        await app.shot(`${OUT}/${name}-done.png`);
        shots.push({ file: `${name}-done.png`, at: name, text: "(idle)", s: +((performance.now() - start) / 1000).toFixed(1) });
        return { done: idleFor >= 3, seen: [...seen], scenery: sc };
      };
      const cham = await follow("chamonix", [45.9, 6.85, 450, 90, 120], "2026-07-10T09:30:00Z");
      const mb = await follow("montblanc", [45.86, 6.75, 5200, 60, 120], "2026-07-10T09:30:00Z");
      // (the meter under hide-ui and with the setting off: hidden — the tiles made to come again by a jump to Paris)
      await app.js(
        `(() => { __bh.game.flyAt(48.85, 2.27, 300, 70, 120); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return 1; })()`,
      );
      await app.waitFor(`(() => { const m = document.querySelector('[data-testid="data-meter"]'); return m && !m.hidden; })()`, 30_000);
      const shown = await app.js<Sample>(READ);
      await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
      const hideUi = await app.js<boolean>(
        `(() => getComputedStyle(document.querySelector('[data-testid="data-meter"]')).display === "none")()`,
      );
      await app.js(`(() => { document.body.classList.remove("hide-ui"); __bh.settings.showLoading = false; return 1; })()`);
      await Bun.sleep(1200);
      const off = await app.js<Sample>(READ);
      await app.js(`(() => { __bh.settings.showLoading = true; return 1; })()`);
      step(`Paris: ${shown.segs.map((x) => x.text).join(" · ")}; hide-ui hides it ${hideUi}; setting off hides it ${off.hidden}`);
      const gpuErrors = await app.js<number>(`(() => __bh.renderer.gpuErrors)()`);
      writeFileSync(
        `${OUT}/data-meter.json`,
        JSON.stringify({ cham, mb, shots, samples, hideUi, offHidden: off.hidden, gpuErrors }, null, 1),
      );
      expect(gpuErrors).toBe(0);
      expect(cham.seen).toContain("relief");
      expect(cham.seen).toContain("scenery");
      expect([...cham.seen, ...mb.seen].some((k) => /buildings|bâtiments/.test(k))).toBe(true);
      expect(cham.done, "Chamonix: the meter still showing after 150 s").toBe(true);
      expect(hideUi).toBe(true);
      expect(off.hidden).toBe(true);
    } finally {
      app.close();
    }
  },
  8 * 60_000,
);
