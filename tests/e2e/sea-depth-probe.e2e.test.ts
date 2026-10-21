// A probe of the sea's depths under the near tiles (docs/PLAN-NUAGES-AAA.md N6): the cached tiles' heights' range off Tarifa
// and the sea's state the shader gets. Not a pass/fail test.
import { afterAll, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

test.skipIf(!E2E)(
  "the sea's depths under the tiles",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 600, tiles: true });
    try {
      await app.js(`(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.flyAt(36.06, -5.74, 250, 115, 200); return 1; })()`);
      await Bun.sleep(30000);
      const info = await app.js(`(() => { const t = __bh.renderer.earthTiles; const out = [];
        const q = (la, lo) => { const a = la * Math.PI / 180, b = lo * Math.PI / 180; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; };
        for (const [la, lo] of [[36.03, -5.65], [36.02, -5.63], [36.0, -5.6], [35.98, -5.6], [35.95, -5.6], [36.05, -5.72], [36.1, -5.6]]) {
          const s = t.heightAt(q(la, lo), 30); out.push([la, lo, Math.round(s.h * 10) / 10, Math.round(s.rem * 100) / 100]); }
        return { tiles: out, sea: __bh.renderer.seaHere, hs: __bh.renderer.seaHs, state: __bh.renderer.seaState }; })()`);
      console.log(JSON.stringify(info));
    } finally {
      await app.close();
    }
  },
  300_000,
);
