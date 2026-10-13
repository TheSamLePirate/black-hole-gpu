// Landed and on foot on Gargantua's worlds (Mann, Miller, Edmunds): the ship set down level, the astronaut out
// (⇧K) on the ground beside it — the ship's ground and the walker's within 15 m, his feet on it, the hatch within
// reach —, back aboard, then __bh.game.walk and the placement panel's "On foot" path to Miller; no GPU error.
// Captures and measures: remote-results/gargantua-ground-*.png, gargantua-ground-<world>.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";

afterAll(stopServer);
test.skipIf(!E2E)(
  "Gargantua landed placement and disembarkation keep ship, walker and terrain together",
  async () => {
    const app = await App.boot({ hash: "scene=game%3Ainterstellar", width: 960, height: 540, tiles: false });
    try {
      await app.js(
        `(()=>{__bh.freeze(true);Object.assign(__bh.settings,{dynamicResolution:false,realtimeSubsampling:2,temporalReprojection:false,earthGrass:'off',earthScenery:'off'});return true;})()`,
      );
      for (const body of ["mann", "miller", "edmunds"]) {
        await app.js(`(()=>{__bh.game.land('${body}',0,180);__bh.step(0);__bh.touch();return true;})()`);
        expect(await app.js<boolean>(`__bh.camera.landed && __bh.camera.local.F.id==='${body}' && __bh.camera.local.L.landed`)).toBe(true);
        const level = await app.js<number>(
          `(()=>{const c=__bh.camera,F=c.local.F,w=c.rigWorld();return w.fwd.reduce((s,x,i)=>s+x*w.up[i],0);})()`,
        );
        expect(Math.abs(level)).toBeLessThan(0.001);
        await app.press("KeyK", "K", { shift: true });
        expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
        await app.js(`(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()`);
        await app.js(
          `(()=>{const c=__bh.camera.character,f=c.frame(),v=__bh.renderer.shipPlace;if(v){const d=v.t.map((x,i)=>x-f.origin[i]),dot=a=>a.reduce((s,x,i)=>s+x*d[i],0);c.yaw=Math.atan2(dot(f.axes[0]),dot(f.axes[2]));}for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()`,
        );
        await captureLoadedCharacter(app, `gargantua-ground-${body}`);
        const state = await app.js<{ gapM: number; heightM: number; accessM: number; landed: boolean; shipDistanceM: number }>(
          `(()=>{const c=__bh.camera.character,n=__bh.renderer.lastNear;return {gapM:(Math.hypot(...n.centre)-1)*n.radius*c.metres()-(Math.hypot(...c.q)-n.radius*c.metres()),heightM:c.height(),accessM:c.accessDistance(),landed:__bh.camera.local.L.landed,shipDistanceM:__bh.renderer.shipPlace?.dist??Infinity};})()`,
        );
        await Bun.write(`remote-results/gargantua-ground-${body}.json`, JSON.stringify(state, null, 2));
        expect(Math.abs(state.gapM)).toBeLessThan(15);
        expect(Math.abs(state.heightM)).toBeLessThan(0.1);
        expect(state.accessM).toBeLessThan(3);
        expect(state.landed).toBe(true);
        expect(state.shipDistanceM).toBeLessThan(40);
        await app.press("KeyK", "K", { shift: true });
        expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
        // The placement panel's On foot path uses exactly this method.
        await app.js(`(()=>{__bh.game.walk('${body}',15,45);__bh.step(0);__bh.touch();return true;})()`);
        expect(
          await app.js<boolean>(`__bh.camera.character.active && __bh.camera.character.body==='${body}' && __bh.camera.local.L.landed`),
        ).toBe(true);
        await app.js("(()=>{__bh.camera.character.stop();__bh.touch();return true;})()");
      }
      await app.waitFor(`!document.body.classList.contains("on-foot")`);
      await app.click("[data-testid=hud-place]");
      await app.waitFor(`!!document.querySelector('[data-testid="place-walk"]')`);
      await app.click("[data-testid=place-walk]");
      expect(await app.js<boolean>(`document.querySelector('[data-testid="place-body-miller"]').disabled`)).toBe(false);
      await app.click("[data-testid=place-body-miller]");
      await app.js(`(document.querySelector('[data-testid="place-go"]').scrollIntoView({block:"center"}),true)`);
      await app.click("[data-testid=place-go]");
      if (await app.js<boolean>(`!!document.querySelector('[data-testid="place-confirm"]')`)) {
        await app.js(`(document.querySelector('[data-testid="place-confirm"]').scrollIntoView({block:"center"}),true)`);
        await app.click("[data-testid=place-confirm]");
      }
      const placementError = await app.js<string>(`document.querySelector('.pp-err')?.textContent ?? ''`);
      expect(placementError).toBe("");
      await app.waitFor(`__bh.camera.character.active && __bh.camera.character.body==='miller'`);
      expect(await app.js<boolean>("__bh.camera.local.L.landed")).toBe(true);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300000,
);
