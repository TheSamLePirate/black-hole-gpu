import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The photo mode's films (PLAN-MODES-AAA M8 — renderdialog.ts, ui/photo.ts, ui/videopreview.ts, video.ts): F4, the
// bar's video row — an orbit's draft of one second, played in the preview (its length read back from the file), its
// progress shown meanwhile; TARS's video tool: the shots (the director's refused without a ship flown), a live
// draft; the render dialog built in the interface's language; no console error.

describe.skipIf(!E2E)("the photo mode's films", () => {
  let app: App;
  const settle = () => app.js("(()=>{for(let i=0;i<20;i++)__bh.step(1/30);__bh.touch();return true;})()");
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, tiles: false });
    await app.js(`(__bh.freeze(true), __bh.settings.ship = false, __bh.touch(), true)`);
    await settle();
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const playerDuration = () =>
    app.js<number>(`(async () => {
      const v = document.querySelector("[data-testid=video-preview-player]");
      if (!v) return -1;
      if (!(v.readyState >= 1)) await new Promise((r) => { v.onloadedmetadata = r; setTimeout(r, 5000); });
      return v.duration;
    })()`);

  test("F4: an orbit's draft from the bar, its progress, then played", async () => {
    await app.press("F4", "F4");
    await app.waitFor(`!!document.querySelector("[data-testid=photo-shot]")`, 5_000);
    await app.js(`(() => {
      const s = document.querySelector("[data-testid=photo-shot]"); s.value = "orbit"; s.dispatchEvent(new Event("change"));
      const n = document.querySelector("[data-testid=photo-seconds]"); n.value = "1"; n.dispatchEvent(new Event("input"));
      return true;
    })()`);
    await app.click("[data-testid=photo-draft]");
    await app.waitFor(`/\\d+ \\/ 24/.test(document.querySelector("[data-testid=photo-video-progress]")?.textContent ?? "")`, 30_000);
    await app.waitFor(`!!document.querySelector("[data-testid=video-preview]")`, 180_000);
    expect(await playerDuration()).toBeCloseTo(1, 1);
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=video-preview-final]")`)).toBe(true);
    await app.click("[data-testid=video-preview-close]");
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=video-preview]")`)).toBe(true);
  }, 240_000);

  test("TARS: the shots, the director's refused without a ship, a live draft", async () => {
    const run = (args: string) =>
      app.js<{ ok: boolean; error?: string; shots?: { id: string; available: boolean }[] }>(
        `Promise.resolve(__bh.tars.tools().find((t) => t.name === "video").run(${args}, new AbortController().signal)).then((r) => r.result ?? r)`,
      );
    const shots = (await run(`{ action: "shots" }`)).shots!;
    expect(shots.map((s) => s.id)).toEqual(["live", "take", "orbit", "dive", "journey", "director"]);
    expect(shots.find((s) => s.id === "director")!.available).toBe(false);
    expect((await run(`{ action: "start", shot: "director", draft: true }`)).ok).toBe(false);
    expect((await run(`{ action: "start", shot: "live", seconds: 1, fps: 24, draft: true }`)).ok).toBe(true);
    await app.waitFor(`!!document.querySelector("[data-testid=video-preview]")`, 180_000);
    expect(await playerDuration()).toBeCloseTo(1, 1);
    await app.click("[data-testid=video-preview-close]");
  }, 240_000);

  test("the render dialog: built, its video section's draft and format", async () => {
    expect(
      await app.js<boolean>(
        `!!document.querySelector("[data-testid=render] #v-draft") && !!document.querySelector("#v-format option[value=webm]")`,
      ),
    ).toBe(true);
    await app.press("Escape", "Escape");
    expect(app.cdp.errors).toEqual([]);
  }, 30_000);
});
