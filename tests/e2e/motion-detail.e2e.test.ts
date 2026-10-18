import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The "Sharpness in motion" setting (settings.motionDetail; renderer motionBlock — docs/PLAN-RENDU-PERF.md 13.): found by
// the settings' search in French, its three choices named, the one clicked (a real click) taken; the shot of it.
// E2E_SHOTS=<dir>: the panel with it.

describe.skipIf(!E2E)("the sharpness in motion's setting", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis" });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("searched in French, its choices named, « En virage et en vol bas » clicked and taken", async () => {
    expect(await app.js<string>("__bh.settings.motionDetail")).toBe("off");
    await app.click("[data-testid=topbar-settings]");
    await app.waitFor(`!document.getElementById("panel").classList.contains("collapsed")`);
    await app.click(".sp-search input");
    await app.type("netteté en mouvement");
    await app.waitFor(`document.getElementById("panel").textContent.includes("Netteté en mouvement")`, 10_000);
    const choices = await app.js<string[]>(`(() => {
      // (the segmented control holding this setting's values)
      const seg = [...document.querySelectorAll("#panel .sp-seg")].find((x) => x.querySelector('button[data-value="turns"]') && x.querySelector('button[data-value="low"]'));
      const bs = [...(seg?.querySelectorAll("button") ?? [])];
      const low = bs.find((b) => b.dataset.value === "low");
      if (low) low.dataset.testid = "motion-detail-low";
      return bs.map((b) => b.textContent.trim());
    })()`);
    console.log(`  the choices: ${choices.join(" · ")}`);
    if (!choices.length) console.log(`  the panel: ${(await app.js<string>(`document.getElementById("panel").innerText`)).slice(0, 1500)}`);
    expect(choices).toEqual(expect.arrayContaining(["Désactivé", "En virage", "En virage et en vol bas"]));
    await app.click("[data-testid=motion-detail-low]");
    await app.waitFor(`__bh.settings.motionDetail === "low"`, 5_000);
    if (process.env.E2E_SHOTS) {
      await Bun.$`mkdir -p ${process.env.E2E_SHOTS}`;
      await app.shot(`${process.env.E2E_SHOTS}/motion-detail.png`);
    }
    await app.js(`(() => { __bh.settings.motionDetail = "off"; return 1; })()`);
  }, 120_000);
});
