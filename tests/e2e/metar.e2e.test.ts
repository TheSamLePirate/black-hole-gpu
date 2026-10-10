import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import burgos from "../data/openmeteo-2026-08-12-burgos.json";

// PLAN-METEO W7, PLAN-CIEL C1: the real weather. "Real" chosen by a real click in the Weather panel, the craft
// at Le Bourget, the game's date now: its station's METAR fetched (metar.vatsim.net — answered here by the
// page's own stand-in, a fog report, no network needed), decoded, in force for the flight and the image; the
// panel shows it. Another day, at Burgos: Open-Meteo's model (its answer saved for the 2026 eclipse); in 2067,
// out of its reach: a plausible draw, said so.

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
        globalThis.__modelAsked = [];
        const original = globalThis.fetch;
        globalThis.fetch = function (input, options) {
          const url = String(input);
          if (url.startsWith("https://metar.vatsim.net/")) {
            globalThis.__metarAsked.push(url);
            return Promise.resolve(new Response(${JSON.stringify(`${REPORT}\n`)}, { status: 200, headers: { "content-type": "text/plain" } }));
          }
          if (url.includes("open-meteo.com/")) {
            globalThis.__modelAsked.push(url);
            return Promise.resolve(new Response(${JSON.stringify(JSON.stringify(burgos))}, { status: 200, headers: { "content-type": "application/json" } }));
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
    await app.js(`(__bh.game.land("earth", 48.955, 2.43), __bh.game.setDate(new Date().toISOString()), true)`);
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
    // (wx[0].z, the weather block the params' last six vec4s)
    expect(await app.js<number>(`(() => { const f = __bh.renderer.paramsF; return f[f.length - 24 + 2]; })()`)).toBeCloseTo(3.912 / 300, 5);
    await app.press("Escape");
  }, 150_000);

  test("another day, at Burgos: Open-Meteo's model; in 2067, a plausible draw — the panel says which", async () => {
    await app.js(`(__bh.game.land("earth", 42.5, -2.5), __bh.game.setDate("2026-08-12T18:30:00Z"), true)`);
    await app.waitFor(`__bh.camera.weatherReal?.source === "model"`, 20_000);
    const st = await app.js<{ asked: string[]; why: string; layers: number; T: number }>(`(() => ({
      asked: __modelAsked,
      why: __bh.camera.weatherRealInfo?.why,
      layers: __bh.camera.weatherReal.layers.length,
      T: __bh.camera.weatherReal.model.T,
    }))()`);
    expect(st.asked.some((u) => u.includes("api.open-meteo.com/v1/forecast?latitude=42.50&longitude=-2.50&start_date=2026-08-12"))).toBe(
      true,
    );
    expect(st.why).toBe("model");
    expect(st.layers).toBe(0);
    expect(st.T).toBeGreaterThan(30);
    await app.click("[data-testid=hud-weather]");
    await app.waitFor(`document.querySelector(".wx-says")?.textContent.includes("Open-Meteo")`, 5000);
    await app.press("Escape");
    await app.js(`(__bh.game.setDate("2067-06-01T12:00:00Z"), true)`);
    await app.waitFor(`__bh.camera.weatherRealInfo?.why === "out-of-range" && __bh.camera.weatherReal?.source === "random"`, 10_000);
    await app.click("[data-testid=hud-weather]");
    await app.waitFor(`/1940/.test(document.querySelector(".wx-says")?.textContent ?? "")`, 5000);
    await app.press("Escape");
  }, 120_000);
});
