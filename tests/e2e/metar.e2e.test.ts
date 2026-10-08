import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-METEO W7: the real weather. "Real" chosen by a real click in the Weather panel, the craft at Le
// Bourget: its station's METAR fetched (metar.vatsim.net — answered here by the page's own stand-in, a fog
// report, no network needed), decoded, in force for the flight and the image; the panel shows it.

const REPORT = "LFPB 080600Z 03003KT 0300 FG VV002 08/08 Q1025 NOSIG";

describe.skipIf(!E2E)("the real weather: an airfield's METAR", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({
      width: 1440,
      height: 900,
      hash: "scene=game:artemis",
      initScript: `(() => {
        globalThis.__metarAsked = [];
        const original = globalThis.fetch;
        globalThis.fetch = function (input, options) {
          const url = String(input);
          if (url.startsWith("https://metar.vatsim.net/")) {
            globalThis.__metarAsked.push(url);
            return Promise.resolve(new Response(${JSON.stringify(`${REPORT}\n`)}, { status: 200, headers: { "content-type": "text/plain" } }));
          }
          return original.call(this, input, options);
        };
      })()`,
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("at Le Bourget, Real chosen: its METAR in force — fog, LIFR —, for the flight and the image", async () => {
    await app.js(`(__bh.game.land("earth", 48.955, 2.43), true)`);
    await app.waitFor(`!!__bh.renderer.earthMaps?.tier`, 90_000);
    await app.click("[data-testid=hud-weather]");
    await app.waitFor(`!!document.querySelector("[data-testid=weather-panel]")`, 5000);
    await app.click("[data-testid=weather-real]");
    await app.waitFor(`__bh.camera.weatherReal?.report?.startsWith("LFPB") === true`, 10_000);
    const st = await app.js<{ asked: string[]; kind: string; vis: number; wx: number }>(`(() => ({
      asked: __metarAsked,
      kind: __bh.camera.weatherReal.kind,
      vis: __bh.camera.weatherReal.visibility,
      wx: __bh.renderer.weatherReal?.visibility ?? -1,
    }))()`);
    expect(st.asked[0]).toContain("id=LFPB");
    expect(st.kind).toBe("fog");
    expect(st.vis).toBe(300);
    expect(st.wx).toBe(300);
    await app.waitFor(`document.querySelector("[data-testid=weather-category]").dataset.category === "LIFR"`, 3000);
    await app.waitFor(`document.querySelector(".wx-says").textContent.includes("LFPB 080600Z")`, 3000);
    // (the image: the tracer's fog from it — its extinction, 3.912 / 300 m)
    await Bun.sleep(1500);
    expect(await app.js<number>(`(() => { const f = __bh.renderer.paramsF; return f[f.length - 18]; })()`)).toBeCloseTo(3.912 / 300, 5);
    await app.press("Escape");
  }, 150_000);
});
