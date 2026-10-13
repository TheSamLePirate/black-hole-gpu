// The living ground on foot, in real WorldCover places: a meadow dense (tens of thousands of blades drawn), bounded
// (each level under its capacity), cheap (its GPU passes and the frame with and without it measured), the other
// kinds where the scenery raster has them near (crops, wetland reeds, scrub, forest floor), footprints pressed by
// a real walk and rising again, no GPU error. Captures for review: remote-results/grass-aaa-*.png (+ readiness),
// the measures in remote-results/grass-aaa-*.json.
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";

afterAll(stopServer);

// (frozen: the view goes where the walker starts only when stepped — hence a step after each start)
const SETUP = `__bh.freeze(true);__bh.game.setDate('2021-06-21T10:00:00Z');Object.assign(__bh.settings,{earthScenery:'balanced',earthTerrain:true,earthSurface:'materials',earthGrass:'balanced',earthGrassDensity:1,earthGrassReach:28,earthClouds:0,volumetricClouds:false,dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:false});`;

/** In the scenery raster round the astronaut, the place nearest the middle with the class (null: none within 2 km). */
const FIND = (cls: number) => `(()=>{
  const c=__bh.renderer.earthScenery.contact,b=c.reply.bounds,u=c.u,f=c.f,offset=f[2]*4,N=512;
  for(let radius=0;radius<200;radius+=2)for(let k=0;k<96;k++){
    const a=k/96*Math.PI*2,x=Math.floor(256+Math.cos(a)*radius),y=Math.floor(256+Math.sin(a)*radius);
    if(x<0||y<0||x>=N||y>=N||(u[offset+y*N+x]>>>24)!==${cls})continue;
    // (a block of the class: three pixels each side the same — not a stray pixel at a field's edge)
    let ok=true;for(let j=-3;j<=3&&ok;j++)for(let i=-3;i<=3&&ok;i++){const xx=x+i,yy=y+j;if(xx<0||yy<0||xx>=N||yy>=N||(u[offset+yy*N+xx]>>>24)!==${cls})ok=false;}
    if(!ok)continue;
    const lat=b[3]-(y+.5)/N*(b[3]-b[1]),lon=b[0]+(x+.5)/N*(b[2]-b[0]);
    const err=__bh.camera.character.start('earth',lat,lon);
    if(!err&&c.vegetation(__bh.camera.character.q).cover===${cls})return {lat,lon};
  }
  return null;
})()`;

async function settle(app: App) {
  await app.js("(()=>{__bh.step(0);__bh.touch();return true;})()");
  // (a place FIND chose up to 400 px away: the scenery asked there anew — the grass waits for it)
  await app.waitFor("__bh.renderer.earthScenery.contact && !__bh.renderer.earthScenery.pending", 180_000);
  const grassIn = "__bh.renderer.characterRenderer.stats().reason!=='loading' && !__bh.renderer.characterRenderer.stats().pending";
  await app.waitFor(grassIn, 120_000);
  await app.waitFor("__bh.renderer.variantReady && __bh.renderer.calibrationReady", 240_000);
  const frame = await app.js<number>("__bh.renderer.completedFrames");
  await app.waitFor(`__bh.renderer.completedFrames >= ${frame + 20}`, 60_000);
  // (the grass's ground is built over frames and begun again when the scenery refreshes — after the kernel's
  // compile, after those frames: in again, last)
  await app.waitFor(grassIn, 120_000);
}

test.skipIf(!E2E)(
  "a meadow full of life: dense, bounded per level, cheap on the GPU, without error",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 1280, height: 720, tiles: true });
    try {
      await app.js(`(()=>{${SETUP}const e=__bh.camera.character.start('earth',44.2,4.15);__bh.step(0);__bh.touch();return e;})()`);
      await app.waitFor("__bh.renderer.earthScenery.contact && !__bh.renderer.earthScenery.pending", 180_000);
      const place = await app.js<{ lat: number; lon: number } | null>(FIND(30));
      expect(place).not.toBeNull();
      await settle(app);
      await app.waitFor(
        "__bh.renderer.characterRenderer.stats().reason==='grass' && __bh.renderer.characterRenderer.stats().roots>0",
        60_000,
      );
      const s = await app.js<{ blades: number[]; roots: number; lodCapacity: number[]; lattice: number; groundCells: number }>(
        "__bh.renderer.characterRenderer.stats()",
      );
      // (dense: tens of thousands drawn; each level under its capacity — none dropped)
      expect(s.roots).toBeGreaterThan(15000);
      s.blades.forEach((b, i) => expect(b).toBeLessThan(s.lodCapacity[i]!));
      expect(s.lattice).toBeGreaterThan(600);
      expect(s.groundCells).toBeGreaterThan(1000);
      await captureLoadedCharacter(app, "grass-aaa-meadow");
      // the cost: its passes, then the same frozen view with the grass off
      const measure = async () => {
        await app.js("(()=>{__bh.renderer.prof.enabled=true;__bh.renderer.prof.reset();__bh.touch();return true;})()");
        const frame = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${frame + 150}`, 60_000);
        return app.js<{ gpuFrameMs: number; gpu: { pass: string; ms: number }[] }>("__bh.game.perf()");
      };
      const on = await measure();
      await app.js("(()=>{__bh.settings.earthGrass='off';__bh.touch();return true;})()");
      await app.waitFor("__bh.renderer.characterRenderer.stats().reason==='off'", 30_000);
      const off = await measure();
      await app.js("(()=>{__bh.settings.earthGrass='balanced';__bh.touch();return true;})()");
      const pass = (p: typeof on, name: string) => p.gpu.find((x) => x.pass.startsWith(name))?.ms ?? 0;
      const cost = {
        blades: pass(on, "grass: shade, footprints, blades"),
        draw: pass(on, "character and grass HDR") - pass(off, "character HDR"),
        frameOn: on.gpuFrameMs,
        frameOff: off.gpuFrameMs,
      };
      await Bun.write("remote-results/grass-aaa-cost.json", JSON.stringify({ place, stats: s, cost, on, off }, null, 2));
      // (budgets on the Macs at 1280×720: the blades' compute, their draw, the whole frame's difference — the last one
      // scaled by the frame's own cost without grass, its pixels and its GPU together: 39 ms here at 1280×720 on the
      // M1 Max; 165 ms on the mini, whose kiosk draws 1920×1080 on 8 GPU cores — the grass ~10 % of both)
      expect(cost.blades).toBeLessThan(2.5);
      expect(cost.draw).toBeLessThan(4);
      expect(cost.frameOn - cost.frameOff).toBeLessThan(5 * Math.max(1, cost.frameOff / 40));
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  900_000,
);

test.skipIf(!E2E)(
  "every kind where it grows: crops in rows, wetland reeds, scrub, forest floor (those found within 2 km)",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 1280, height: 720, tiles: true });
    try {
      // (the Bourget's plain: fields; the Cévennes: scrub, forest — each kind looked for round both)
      const found: Record<string, unknown> = {};
      for (const [lat, lon] of [
        [48.95, 2.45],
        [44.2, 4.15],
      ] as const) {
        await app.js(`(()=>{${SETUP}const e=__bh.camera.character.start('earth',${lat},${lon});__bh.step(0);__bh.touch();return e;})()`);
        await app.js("(()=>{__bh.step(0);__bh.touch();return true;})()");
        await app.waitFor("__bh.renderer.earthScenery.contact && !__bh.renderer.earthScenery.pending", 180_000);
        for (const [name, cls] of [
          ["crop", 40],
          ["reeds", 90],
          ["scrub", 20],
          ["forest", 10],
        ] as const) {
          if (found[name]) continue;
          const place = await app.js<{ lat: number; lon: number } | null>(FIND(cls));
          if (!place) continue;
          await settle(app);
          const s = await app.js<{ reason: string; roots: number }>("__bh.renderer.characterRenderer.stats()");
          found[name] = { place, roots: s.roots, reason: s.reason };
          expect(s.reason).toBe("grass");
          // (the sparse kinds draw fewer: a forest floor a third of a meadow, scrub in tufts)
          expect(s.roots).toBeGreaterThan(name === "crop" || name === "reeds" ? 8000 : 1500);
          await captureLoadedCharacter(app, `grass-aaa-${name}`);
          await app.js(`(()=>{__bh.camera.character.start('earth',${lat},${lon});__bh.step(0);return true;})()`);
        }
      }
      await Bun.write("remote-results/grass-aaa-kinds.json", JSON.stringify(found, null, 2));
      // (at least the crops are there round Le Bourget)
      expect(found.crop).toBeDefined();
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  1_200_000,
);

test.skipIf(!E2E)(
  "footprints: a real walk presses the grass down behind the astronaut, and it rises again",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 1280, height: 720, tiles: true });
    try {
      await app.js(`(()=>{${SETUP}const e=__bh.camera.character.start('earth',44.2,4.15);__bh.step(0);__bh.touch();return e;})()`);
      await app.waitFor("__bh.renderer.earthScenery.contact && !__bh.renderer.earthScenery.pending", 180_000);
      expect(await app.js(FIND(30))).not.toBeNull();
      await settle(app);
      // (live time: the frames draw the steps; three seconds of walking)
      await app.js("(()=>{__bh.freeze(false);__bh.camera.character.move(1,0,3);return true;})()");
      await app.waitFor("__bh.camera.character.state().speedMs>1", 10_000);
      await app.waitFor("__bh.camera.character.state().speedMs<0.1", 15_000);
      const pressed = await app.js<{ cells: number; deepest: number; mean: number }>("__bh.renderer.characterRenderer.footprints()");
      expect(pressed.cells).toBeGreaterThan(40);
      expect(pressed.deepest).toBeGreaterThan(0.6);
      await captureLoadedCharacter(app, "grass-aaa-footprints");
      // (standing still twenty seconds: the walked path mostly risen — under the boots it stays pressed)
      await Bun.sleep(20_000);
      const later = await app.js<{ cells: number; deepest: number; mean: number }>("__bh.renderer.characterRenderer.footprints()");
      await Bun.write("remote-results/grass-aaa-footprints.json", JSON.stringify({ pressed, later }, null, 2));
      expect(later.cells).toBeLessThan(pressed.cells * 0.6);
      await app.js("(()=>{__bh.freeze(true);return true;})()");
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600_000,
);
