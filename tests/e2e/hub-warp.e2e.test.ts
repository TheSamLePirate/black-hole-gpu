import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { M_SECONDS } from "../../src/units";

afterAll(stopServer);

test.skipIf(!E2E)(
  "the hub warp button works in auto and assisted entry, retaining user warp below changing guidance limits",
  async () => {
    const app = await App.boot({ hash: "scene=Earth: the Blue Marble", width: 1280, height: 900 });
    try {
      await app.waitFor("__bh.camera.piloting", 30_000);
      await app.js(`__bh.game.orbit("earth", {peKm:400,apKm:400,inc:35})`);
      await app.press("KeyG", "G", { shift: true });
      await app.waitFor(`__bh.camera.entryRun?.phase === "wait"`, 60_000);
      await app.js(`__bh.freeze(true)`);
      await app.waitFor(`document.querySelector('[data-testid=hub-warp]')?.getAttribute('aria-pressed')==='true'`);
      for (const assist of [false, true]) {
        if ((await app.js<boolean>("__bh.camera.pilot.assist")) !== assist) await app.click("[data-testid=hub-assist]");
        await app.waitFor(
          `document.querySelector('[data-testid=hub-assist]')?.textContent === ${JSON.stringify(assist ? "ASSISTED" : "AUTO")}`,
        );
        await app.click("[data-testid=hub-warp]");
        await app.waitFor("!__bh.settings.autoWarp", 5_000);
        expect(await app.js<boolean>("__bh.settings.autoWarp")).toBe(false);
        expect(await app.js<boolean>("__bh.camera.pilot.assist")).toBe(assist);
        await app.press("Slash", "/");
        await app.js(`__bh.step(0.01)`);
        expect(await app.js<number>("__bh.settings.timeSpeed")).toBeCloseTo(1 / M_SECONDS, 8);
        // Shorten the guidance's countdown: the next frame must impose real time even if the user asks for more.
        await app.js(
          `(()=>{const c=__bh.camera;c.entryRun.tBurn=c.nowTime()*${M_SECONDS}+20;c.requestWarp(100/${M_SECONDS});__bh.step(0.01);})()`,
        );
        expect(await app.js<number>("__bh.settings.timeSpeed")).toBeCloseTo(1 / M_SECONDS, 8);
        expect(await app.js<number>("__bh.camera.hubWarpWant")).toBeCloseTo(100 / M_SECONDS, 8);
        await app.press("Period", ".");
        expect(await app.js<number>("__bh.settings.timeSpeed")).toBeLessThanOrEqual(1 / M_SECONDS + 1e-10);
        const requested = await app.js<number>("__bh.camera.hubWarpWant");
        expect(requested).toBeGreaterThan(1 / M_SECONDS);
        await app.js(`(()=>{const c=__bh.camera;c.entryRun.tBurn=c.nowTime()*${M_SECONDS}+800;__bh.step(0.01);})()`);
        expect(await app.js<number>("__bh.settings.timeSpeed")).toBeCloseTo(requested, 8);
        await app.click("[data-testid=hub-warp]");
        await app.waitFor("__bh.settings.autoWarp", 5_000);
        expect(await app.js<boolean>("__bh.settings.autoWarp")).toBe(true);
        // Restore a long coast to verify that auto warp resumes and that the next iteration can slow it again.
        await app.js(`(()=>{const c=__bh.camera;c.entryRun.tBurn=c.nowTime()*${M_SECONDS}+800;__bh.step(0.01);})()`);
        expect(await app.js<number>("__bh.settings.timeSpeed")).toBeGreaterThan(1 / M_SECONDS);
        await app.waitFor(`document.querySelector('[data-testid=hub-warp]')?.getAttribute('aria-pressed')==='true'`);
      }
      const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await Bun.write("/tmp/hub-warp.png", Buffer.from(shot.data, "base64"));
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300_000,
);
