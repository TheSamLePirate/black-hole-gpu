// A probe of a storm's lightning (docs/PLAN-NUAGES-AAA.md N5): a flash struck, what the tracer's weather block holds of it.
// Not a pass/fail test.
import { afterAll, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

test.skipIf(!E2E)(
  "a flash in the weather block",
  async () => {
    const app = await App.boot({ width: 960, height: 600, lang: "fr", hash: "scene=game:artemis", tiles: false });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, autosave: false, f35Invulnerable: true });
        window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        __bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.set("weather", "storm"); __bh.game.flyAt(36.08, -5.6, 900, 20, 220);
        __bh.renderer.lightning.strike(2052, 5638, true); return 1; })()`);
      for (let i = 0; i < 3; i++) {
        await Bun.sleep(300);
        console.log(
          JSON.stringify(
            await app.js(
              `(() => { const b = __bh.renderer.weatherBlock; return { wx5: [...b.slice(20, 24)], wx6: [...b.slice(24, 28)], wx7: [...b.slice(28, 32)], key: __bh.renderer.featureKey & 1024 }; })()`,
            ),
          ),
        );
      }
    } finally {
      await app.close();
    }
  },
  300_000,
);
