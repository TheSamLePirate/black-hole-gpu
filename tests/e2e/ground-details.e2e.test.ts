import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";
// Loaded Earth: independent character/ship depths, a hull shadow receiver, local map at zoom 18 and real zoom gestures.
afterAll(stopServer);
test.skipIf(!E2E)(
  "landed explorer, vessel depth and shadow, local map at zoom 18",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    try {
      await app.js(
        `(()=>{__bh.freeze(true);__bh.game.setDate('2021-06-21T15:00:00Z');Object.assign(__bh.settings,{earthScenery:'balanced',earthTerrain:true,earthSurface:'materials',earthGrass:'off',earthClouds:0,volumetricClouds:false,dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:false});__bh.game.land('earth',44.2,4.15);__bh.step(0);__bh.touch();return true;})()`,
      );
      await app.waitFor("__bh.renderer.earthMaps.tier==='high' && __bh.renderer.earthScenery.stats().status==='ready'", 180000);
      const result = await app.js("__bh.camera.character.disembark()");
      expect(result).toBeNull();
      await app.js(
        `(()=>{const c=__bh.camera.character;const d=__bh.camera.activePoseNow().X.map((x,i)=>x-c.world(c.q)[i]);const h=c.worldVector(c.heading),u=c.worldVector(c.up());const right=h.map((_,i)=>h[(i+1)%3]*u[(i+2)%3]-h[(i+2)%3]*u[(i+1)%3]);const dot=a=>a.reduce((sum,x,i)=>sum+x*d[i],0);c.yaw=Math.atan2(dot(right),dot(h));for(let i=0;i<120;i++)__bh.step(1/60);__bh.touch();return true;})()`,
      );
      await captureLoadedCharacter(app, "ground-depth-shadow");
      expect(await app.js<number>("__bh.renderer.paramsF[65*4+3]")).toBeGreaterThan(0);
      const overlap = async (onlyCharacter = true) =>
        app.js<number>(`(async()=>{const r=__bh.renderer,d=r.device,t=r.live;const ch=(r.characterRenderer.occluder??globalThis.__occ).depth,ship=r.ship.targets.get(t.hdr).resolved;const rect=r.ship.rectFor(t.hdr);
    const code='@group(0) @binding(0) var c:texture_2d<f32>;@group(0) @binding(1) var s:texture_2d<f32>;@group(0) @binding(2) var<storage,read_write> out:atomic<u32>;@compute @workgroup_size(8,8) fn run(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(c))||id.x<'+rect[0]+'u||id.y<'+rect[1]+'u||id.x>='+ (rect[0]+rect[2]) +'u||id.y>='+ (rect[1]+rect[3]) +'u){return;}let p=vec2i(id.xy);if(${onlyCharacter ? "textureLoad(c,p,0).g>.5&&" : ""}textureLoad(s,p,0).a>.2){atomicAdd(&out,1u);}}';
    const pipeline=d.createComputePipeline({layout:'auto',compute:{module:d.createShaderModule({code}),entryPoint:'run'}});const out=d.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});const bind=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:ch.createView()},{binding:1,resource:ship.createView()},{binding:2,resource:{buffer:out}}]});const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(Math.ceil(t.width/8),Math.ceil(t.height/8));p.end();e.copyBufferToBuffer(out,0,read,0,4);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const n=new Uint32Array(read.getMappedRange())[0];read.unmap();read.destroy();out.destroy();return n;})()`);
      const correct = await overlap();
      await app.js(
        "(()=>{const r=__bh.renderer,c=r.characterRenderer;globalThis.__occ=c.occluder;Object.defineProperty(c,'occluder',{get:()=>null,configurable:true});__bh.touch();return true;})()",
      );
      const n = await app.js<number>("__bh.renderer.completedFrames");
      await app.waitFor(`__bh.renderer.completedFrames>${n + 30}`, 10000);
      // Sample the astronaut's own occluder: the A/B disables its use by the ship only.
      const missing = await overlap();
      const hullPixels = await overlap(false);
      expect(hullPixels).toBeGreaterThan(500);
      await app.js("(()=>{delete __bh.renderer.characterRenderer.occluder;return true;})()");
      await Bun.write("remote-results/ground-depth-ab.json", JSON.stringify({ correct, missing }, null, 2));
      expect(correct).toBeLessThanOrEqual(missing + 5);
      // A controlled foreground occluder at 1 m proves the ship reads it even when this
      // vessel pose happens to overlap only foreground gear (which must remain visible).
      await app.js(
        `(()=>{const r=__bh.renderer,d=r.device;const w=r.live.width,h=r.live.height;const depth=d.createTexture({size:[w,h],format:'rg16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});const e=d.createCommandEncoder();const p=e.beginRenderPass({colorAttachments:[{view:depth.createView(),clearValue:[1,1,0,0],loadOp:'clear',storeOp:'store'}]});p.end();d.queue.submit([e.finish()]);globalThis.__occlusionTestDepth=depth;Object.defineProperty(r.characterRenderer,'occluder',{get:()=>({depth,rect:[0,0,w,h]}),configurable:true});__bh.touch();return true;})()`,
      );
      const foregroundFrame = await app.js<number>("__bh.renderer.completedFrames");
      await app.waitFor(`__bh.renderer.completedFrames>${foregroundFrame + 30}`, 10000);
      const foreground = await overlap(false);
      expect(foreground).toBeLessThan(hullPixels / 10);
      await app.js("(()=>{delete __bh.renderer.characterRenderer.occluder;__bh.touch();return true;})()");
      await Bun.write("remote-results/ground-depth-ab.json", JSON.stringify({ correct, missing, foreground, hullPixels }, null, 2));
      await app.js("__bh.touch()");
      await app.press("KeyM", "m");
      await app.waitFor(
        "document.querySelector('[data-testid=local-ground-map]') && !document.querySelector('[data-testid=local-ground-map]').hidden",
        10000,
      );
      expect(await app.js<string>("document.querySelector('[data-testid=local-ground-map]').textContent")).toContain("z18.0");
      await captureLoadedCharacter(app, "ground-local-map");
      await app.mouse("wheel", 480, 270, { deltaY: -200 });
      await app.waitFor("document.querySelector('[data-testid=local-ground-map]').textContent.includes('z19.0')", 10000);
      await app.click("[data-testid=local-ground-map] .local-map-controls button");
      await app.waitFor("document.querySelector('[data-testid=local-ground-map]').textContent.includes('z18.0')", 10000);
      await app.press("KeyM", "m");
      expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
      await app.js("(()=>{__bh.game.glideTo('Le Bourget',8,1,200);__bh.step(0);__bh.touch();return true;})()");
      await app.waitFor("__bh.renderer.streamingState.leadM>600 && !__bh.renderer.onFoot", 10000);
      expect(await app.js<number>("__bh.renderer.streamingState.leadM")).toBeCloseTo(650, 2);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600000,
);
