import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The ship's three HUDs and where they show (PLAN-MODES-AAA M4 — game/hudkind.ts, ui/hud/kindhud.ts): in orbit the
// Space HUD and its orbit block; forced to Approach, its radar altitude box; ⇧² cycles the kind; the whole HUD in
// the chase view, only the warnings and the cards in the cockpit (its own screens) and the film's views; every
// view with "HUD in the views: everywhere"; the speed effects' canvas kept; no console error.

describe.skipIf(!E2E)("the three HUDs, in the chase and dorsal views", () => {
  let app: App;
  const boxes = () => app.js<{ id?: string }[]>("__bh.hud.boxes()").then((b) => b.map((x) => x.id ?? ""));
  const settle = () => app.js("(()=>{for(let i=0;i<20;i++)__bh.step(1/30);__bh.touch();return true;})()").then(() => Bun.sleep(600));
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(
      `(__bh.settings.hudKind = "auto", __bh.settings.hudViews = "chaseDorsal", __bh.settings.shipMount = "chase", __bh.touch(), true)`,
    );
    await settle();
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("in orbit, the chase view: the whole HUD, the Space kind and its orbit block", async () => {
    expect(await app.js<string>(`document.querySelector(".fl-root").dataset.view`)).toBe("full");
    await app.waitFor(`document.querySelector(".fl-root").dataset.kind === "space"`, 5_000);
    await app.waitFor(`__bh.hud.boxes().some((b) => b.id === "space")`, 5_000);
    expect(await boxes()).toContain(".fl-tel");
  }, 30_000);

  test("forced to Approach: its box; ⇧² cycles the kinds back to automatic", async () => {
    await app.js(`(__bh.settings.hudKind = "approach", true)`);
    await settle();
    expect(await app.js<string>(`document.querySelector(".fl-root").dataset.kind`)).toBe("approach");
    await app.waitFor(`__bh.hud.boxes().some((b) => b.id === "approach")`, 5_000);
    await app.press("Backquote", "~", { shift: true });
    expect(await app.js<string>("__bh.settings.hudKind")).toBe("auto");
    await app.press("Backquote", "~", { shift: true });
    expect(await app.js<string>("__bh.settings.hudKind")).toBe("atmo");
    await app.js(`(__bh.settings.hudKind = "auto", true)`);
  }, 30_000);

  test("the cockpit and the film's views: the warnings and the cards only; everywhere when asked", async () => {
    for (const m of ["cockpit", "quarter"]) {
      await app.js(`(__bh.settings.shipMount = ${JSON.stringify(m)}, __bh.touch(), true)`);
      await settle();
      expect(await app.js<string>(`document.querySelector(".fl-root").dataset.view`)).toBe("bare");
      const ids = await boxes();
      expect(ids).not.toContain(".fl-tel");
      expect(ids).not.toContain("space");
    }
    await app.js(`(__bh.settings.hudViews = "all", __bh.touch(), true)`);
    await settle();
    expect(await app.js<string>(`document.querySelector(".fl-root").dataset.view`)).toBe("full");
    expect(await boxes()).toContain(".fl-tel");
    await app.js(`(__bh.settings.hudViews = "chaseDorsal", __bh.settings.shipMount = "dorsal", __bh.touch(), true)`);
    await settle();
    expect(await app.js<string>(`document.querySelector(".fl-root").dataset.view`)).toBe("full");
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
