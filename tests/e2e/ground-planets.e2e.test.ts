import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";

afterAll(stopServer);
test.skipIf(!E2E)(
  "on-foot planisphere follows Moon and Mars, loads their atlases and resets zoom on changing worlds",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: false });
    try {
      await app.js(
        `(()=>{__bh.freeze(true);Object.assign(__bh.settings,{earthScenery:'off',earthGrass:'off',dynamicResolution:false,realtimeSubsampling:2,temporalReprojection:false});return true;})()`,
      );
      for (const body of ["moon", "mars"]) {
        expect(await app.js(`__bh.camera.character.start('${body}',20,179.99)`)).toBeNull();
        await app.js(`(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()`);
        await app.press("KeyM", "m");
        await app.waitFor(
          `(()=>{const m=document.querySelector('[data-testid="local-ground-map"]');return m && m.dataset.body==='${body}' && m.dataset.source==='ready' && m.dataset.zoom==='18';})()`,
          120000,
        );
        expect(await app.js<boolean>(`document.querySelector('[data-testid="local-ground-map"]').textContent.includes('179.99000')`)).toBe(
          true,
        );
        await captureLoadedCharacter(app, `ground-planisphere-${body}-local`);
        // The existing atlas has global resolution: zoom out to inspect the actual world and the date-line seam.
        await app.js(
          `(()=>{const c=document.querySelector('[data-testid="local-ground-map"] canvas');c.dispatchEvent(new WheelEvent('wheel',{deltaY:3200,cancelable:true}));return true;})()`,
        );
        await app.waitFor(`document.querySelector('[data-testid="local-ground-map"]').dataset.zoom==='2'`);
        await captureLoadedCharacter(app, `ground-planisphere-${body}-global`);
        expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
        await app.press("KeyM", "m");
        expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
        await app.js(`(()=>{__bh.camera.character.stop();__bh.touch();return true;})()`);
      }
      expect(await app.js(`__bh.camera.character.start('mann',15,45)`)).toBeNull();
      await app.js(`(()=>{__bh.step(0);__bh.touch();return true;})()`);
      await app.press("KeyM", "m");
      await app.waitFor(
        `(()=>{const m=document.querySelector('[data-testid="local-ground-map"]');return m && m.dataset.body==='mann' && m.dataset.source==='unavailable' && m.dataset.zoom==='18';})()`,
      );
      expect(
        await app.js<boolean>(`document.querySelector('[data-testid="local-ground-map"]').textContent.includes('imagery unavailable')`),
      ).toBe(true);
      await captureLoadedCharacter(app, "ground-planisphere-mann-grid");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300000,
);
