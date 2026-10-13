import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";
// Planetary contacts, the licensed skinned astronaut, real boarding keys and fully loaded Earth grass.
afterAll(stopServer);
test.skipIf(!E2E)(
  "planetary explorer renders and returns to a landed vessel",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: false });
    try {
      await app.js(
        `(()=>{__bh.freeze(true);__bh.settings.earthScenery='off';__bh.settings.dynamicResolution=false;__bh.settings.realtimeSubsampling=2;__bh.settings.temporalReprojection=false;__bh.game.setDate('2021-06-21T12:00:00Z');return true;})()`,
      );
      for (const body of ["moon", "earth", "mars"]) {
        const result = await app.js(`__bh.camera.character.start('${body}',${body === "earth" ? 44.2 : 0},${body === "earth" ? 4.15 : 0})`);
        expect(result).toBeNull();
        await app.js(`(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()`);
        await app.waitFor("__bh.renderer.characterRenderer.model.ready || __bh.renderer.characterRenderer.model.error", 120000);
        expect(await app.js<string | null>("__bh.renderer.characterRenderer.model.error")).toBeNull();
        await app.js("(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()");
        await app.waitFor("__bh.renderer.characterRenderer.ready", 60000);
        await app.waitFor("__bh.renderer.variantReady && __bh.renderer.calibrationReady && !__bh.renderer.hdLoading", 240000);
        if (body !== "earth") await captureLoadedCharacter(app, `character-${body}`);
        expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
        expect(await app.js<boolean>("__bh.camera.character.state().grounded")).toBe(true);
        await app.js(`(()=>{__bh.camera.character.stop();__bh.touch();return true;})()`);
      }
      await app.js(`(()=>{__bh.game.land('moon',0,0);__bh.step(0);return true;})()`);
      const vessel = await app.js("JSON.stringify(__bh.camera.ourLanded)");
      await app.press("KeyK", "K", { shift: true });
      expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
      expect(await app.js<number>("__bh.camera.character.accessDistance()")).toBeLessThan(3);
      const saved = await app.js("__bh.game.snapshot('explorer-test')");
      await app.press("KeyK", "K", { shift: true });
      expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
      expect(await app.js("JSON.stringify(__bh.camera.ourLanded)")).toBe(vessel);
      await app.js(`__bh.game.load(${JSON.stringify(saved)}, {quiet:true})`);
      expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
      await app.press("Space", " ");
      await app.js("(()=>{for(let i=0;i<12;i++)__bh.step(1/60);return true;})()");
      expect(await app.js<number>("__bh.camera.character.height()")).toBeGreaterThan(0.1);
      await app.js("(()=>{for(let i=0;i<660;i++)__bh.step(1/120);return true;})()");
      expect(await app.js<boolean>("__bh.camera.character.grounded")).toBe(true);
      await app.press("KeyK", "K", { shift: true });
      expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  300000,
);

test.skipIf(!E2E)(
  "real WorldCover grass runs only on foot, casts character shadows and stays bounded",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    try {
      await app.js(
        `(()=>{__bh.freeze(true);__bh.game.setDate('2021-06-21T12:00:00Z');Object.assign(__bh.settings,{earthScenery:'balanced',earthTerrain:true,earthSurface:'materials',earthGrass:'balanced',earthClouds:0,volumetricClouds:false,dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:false});const error=__bh.camera.character.start('earth',44.2,4.15);__bh.step(0);__bh.touch();return error;})()`,
      );
      await app.waitFor("__bh.renderer.earthScenery.contact && !__bh.renderer.earthScenery.pending", 120000);
      const place = await app.js<{ lat: number; lon: number } | null>(
        `(()=>{const c=__bh.renderer.earthScenery.contact,b=c.reply.bounds,f=c.f,u=c.u;const offset=f[2]*4,N=512;for(let radius=0;radius<200;radius+=2)for(let k=0;k<64;k++){const angle=k/64*Math.PI*2,x=Math.floor(256+Math.cos(angle)*radius),y=Math.floor(256+Math.sin(angle)*radius);if((u[offset+y*N+x]>>>24)!==30)continue;const lat=b[3]-(y+.5)/N*(b[3]-b[1]),lon=b[0]+(x+.5)/N*(b[2]-b[0]);const err=__bh.camera.character.start('earth',lat,lon);if(!err&&c.grass(__bh.camera.character.q))return {lat,lon};}return null;})()`,
      );
      expect(place).not.toBeNull();
      await app.waitFor("__bh.renderer.earthTiles.pending===0 && __bh.renderer.variantReady", 240000);
      await app.js("(()=>{__bh.step(0);__bh.touch();return true;})()");
      await app.js(
        `(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.renderer.prof.enabled=true;__bh.renderer.prof.reset();__bh.touch();return true;})()`,
      );
      await app.waitFor("__bh.renderer.characterRenderer.stats().roots>1000 && __bh.renderer.characterRenderer.model.ready", 120000);
      await app.waitFor("__bh.renderer.prof.frames>=90 && __bh.renderer.variantReady", 240000);
      await captureLoadedCharacter(app, "character-grass");
      const stats = await app.js("__bh.game.perf()");
      const submissions = await app.js("__bh.renderer.frameTelemetry");
      await app.js("document.body.classList.add('hide-ui')");
      await captureLoadedCharacter(app, "character-grass-clean");
      await app.js("document.body.classList.remove('hide-ui')");
      await Bun.write("remote-results/character-grass-performance.json", JSON.stringify({ place, stats, submissions }, null, 2));
      // Same frozen view and traced background: isolate near-field cost without moving the camera.
      const measure = async () => {
        const frame = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${frame + 150}`, 30000);
        return app.js("({perf:__bh.game.perf(),submissions:__bh.renderer.frameTelemetry.durationsMs.slice(-120)})");
      };
      const all = await measure();
      await app.js(
        "(()=>{globalThis.__characterEncoder=__bh.renderer.encodeCharacter;__bh.renderer.encodeCharacter=()=>{};return true;})()",
      );
      const background = await measure();
      await app.js(
        "(()=>{__bh.renderer.encodeCharacter=globalThis.__characterEncoder;__bh.settings.earthGrass='off';__bh.touch();return true;})()",
      );
      await app.waitFor("__bh.renderer.characterRenderer.stats().reason==='off'", 30000);
      const avatar = await measure();
      await Bun.write("remote-results/character-ab-performance.json", JSON.stringify({ place, all, background, avatar }, null, 2));
      await app.js("(()=>{__bh.settings.earthGrass='balanced';__bh.touch();return true;})()");
      await app.waitFor("__bh.renderer.characterRenderer.stats().roots>1000 && !__bh.renderer.characterRenderer.stats().pending", 30000);
      expect(await app.js<number>("__bh.renderer.characterRenderer.stats().roots")).toBeLessThanOrEqual(65536);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      await app.js(`(()=>{__bh.camera.character.start('moon',0,0);__bh.step(0);__bh.touch();return true;})()`);
      await app.waitFor("__bh.renderer.characterRenderer.stats().reason==='other-planet'", 30000);
      expect(await app.js<number>("__bh.renderer.characterRenderer.stats().roots")).toBe(0);
      await app.js(`(()=>{__bh.camera.character.stop();__bh.step(0);__bh.touch();return true;})()`);
      await app.waitFor("!__bh.renderer.characterRenderer.stats().active", 30000);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600000,
);
