import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

test.skipIf(!E2E)(
  "the live browser flight crosses both Dneg/Kerr gluing events with a populated map",
  async () => {
    const app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    try {
      await app.js(`__bh.freeze(true)`);
      await app.press("KeyM");
      await app.js(`(()=>{const c=__bh.camera,s=__bh.settings;c.pilot.auto="none";c.pilot.throttle=0;c.tunnelEntry="ours";
      Object.assign(s,{anchor:"wormhole",whOrbit:false,whL:-0.001,inclination:90,azimuth:0,motion:"geodesic",velR:-0.01,velT:0,velP:0});
      c.sync();for(let j=0;j<300 && c.flightInfo().region!=='hole';j++)c.fall(0.5,[0,0,0],false);
      __bh.sim.setTime(c.nowTime());__bh.step(0);})()`);
      await app.waitFor(`__bh.camera.flightInfo().region==='hole' && document.querySelector('.m3-stage')?.dataset.universe==='gargantua'`);
      expect(await app.js<number>(`Number(document.querySelector('.m3-stage').dataset.bodies)`)).toBeGreaterThanOrEqual(6);
      await app.js(`(()=>{const c=__bh.camera,s=__bh.settings;s.velR=-s.velR;s.velT=-s.velT;s.velP=-s.velP;c.sync();
      for(let j=0;j<400;j++){c.fall(0.5,[0,0,0],false);const i=c.flightInfo();if(i.region==='throat'&&i.ell < -0.001)break;}
      __bh.sim.setTime(c.nowTime());__bh.step(0);})()`);
      await app.waitFor(`document.querySelector('.m3-stage')?.dataset.universe==='ours'`);
      expect(await app.js<number>(`Number(document.querySelector('.m3-stage').dataset.bodies)`)).toBeGreaterThan(10);
      expect(await app.js<string>(`__bh.camera.flightInfo().region`)).toBe("throat");
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180_000,
);

test.skipIf(!E2E)(
  "a narrow screen keeps the tunnel map populated when its GPU pipelines fail",
  async () => {
    const app = await App.boot({
      hash: "scene=Earth: the Blue Marble",
      width: 390,
      height: 844,
      initScript: `const create = GPUDevice.prototype.createRenderPipeline;
      GPUDevice.prototype.createRenderPipeline = function(d) {
        if (d.label?.startsWith('map:')) throw new Error('Injected map pipeline failure');
        return create.call(this,d);
      };`,
    });
    try {
      await app.js(`__bh.freeze(true)`);
      await app.press("KeyM");
      await app.js(`(()=>{const c=__bh.camera,s=__bh.settings;c.pilot.auto="none";c.tunnelEntry="ours";
      Object.assign(s,{anchor:"wormhole",whOrbit:false,whL:0,inclination:90,azimuth:0,motion:"geodesic",velR:0,velT:0,velP:0});
      c.sync();__bh.step(0);})()`);
      await app.waitFor(`document.querySelector('.m3-stage')?.dataset.tunnel==='true'`);
      expect(await app.js<number>(`Number(document.querySelector('.m3-stage').dataset.bodies)`)).toBeGreaterThan(10);
      expect(await app.js<boolean>(`document.querySelector('.m3-stage').classList.contains('gpu')`)).toBe(false);
      expect(await app.js<boolean>(`__bh.camera.flightInfo().map.X.every(Number.isFinite)`)).toBe(true);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180_000,
);

test.skipIf(!E2E)(
  "the map stays populated through the physical tunnel, resets previews and menus, and matches flight",
  async () => {
    const app = await App.boot({ hash: "scene=Earth: the Blue Marble", width: 1280, height: 900 });
    try {
      await app.js(`__bh.freeze(true)`);
      await app.press("KeyM");
      await app.js(`(()=>{const c=__bh.camera,s=__bh.settings;c.pilot.auto="none";c.pilot.throttle=0;c.tunnelEntry=null;
      Object.assign(s,{anchor:"wormhole",whOrbit:false,whL:-0.001,inclination:90,azimuth:0,motion:"geodesic",velR:-0.01,velT:0,velP:0});
      c.sync();__bh.step(0);})()`);
      await app.waitFor(`document.querySelector('.m3-stage')?.dataset.universe==='ours'`);
      await app.waitFor(`__bh.camera.wormholePath?.events.length >= 3`, 30_000);
      await app.click(".m3-play");
      await app.waitFor(`document.querySelector('.m3-time')?.classList.contains('on')`);
      await app.click(".m3-focus");
      await app.waitFor(`document.querySelector('.m3-menu')?.classList.contains('open')`);
      const predicted = await app.js<number>(`__bh.camera.wormholePath.events.find(e=>e.kind==='exit').t`);
      const initial = await app.js<number>(`__bh.camera.nowTime()`);
      // Actual ship integrator, with small physical steps; no position teleport at the boundaries.
      await app.js(
        `(()=>{const c=__bh.camera;for(let j=0;j<7;j++)c.fall(0.02,[0,0,0],false);__bh.sim.setTime(c.nowTime());__bh.step(0);})()`,
      );
      await app.waitFor(`document.querySelector('.m3-stage')?.dataset.universe==='gargantua'`);
      expect(predicted - initial).toBeCloseTo(0.125, 5);
      expect(await app.js<number>(`__bh.settings.whL`)).toBeCloseTo(0.0004, 6);
      expect(await app.js<boolean>(`__bh.camera.flightInfo().map.tunnel.inside`)).toBe(false);
      expect(await app.js<string>(`__bh.camera.flightInfo().region`)).toBe("throat");
      expect(await app.js<number>(`Number(document.querySelector('.m3-stage').dataset.bodies)`)).toBeGreaterThanOrEqual(6);
      expect(await app.js<string>(`document.querySelector('.m3-crumbs').textContent`)).toContain("Gargantua");
      expect(await app.js<string>(`document.querySelector('.m3-menu').textContent`)).toContain("Miller");
      expect(await app.js<string>(`document.querySelector('.m3-menu').textContent`)).not.toContain("Mercury");
      expect(await app.js<string>(`document.querySelector('.m3-play').textContent`)).toBe("▶");
      expect(await app.js<boolean>(`document.querySelector('.m3-time').classList.contains('on')`)).toBe(false);

      // Reverse inside the positive flare. Stop at the centre: the map and physical progress remain available.
      await app.js(`(()=>{const c=__bh.camera;__bh.settings.velR=-0.01;c.sync();c.fall(0.04,[0,0,0],false);
      __bh.settings.velR=0;c.sync();__bh.sim.setTime(c.nowTime());__bh.step(0);})()`);
      await app.waitFor(`document.querySelector('.m3-stage')?.dataset.tunnel==='true'`);
      const centre = await app.js<{ progress: number; X: number[]; length: number }>(
        `(()=>{const m=__bh.camera.flightInfo().map;return {progress:m.tunnel.progress,X:m.X,length:m.tunnel.length};})()`,
      );
      expect(centre.progress).toBeCloseTo(0.5, 5);
      expect(centre.length).toBe(0.0005);
      expect(centre.X.every(Number.isFinite)).toBe(true);
      expect(
        await app.js<string>(`(()=>{const g=__bh.game.snapshot("in the tunnel");const side=g.ship.tunnelEntry;
      __bh.game.load(g,{quiet:true});__bh.step(0);return side;})()`),
      ).toBe("gargantua");
      await app.waitFor(`document.querySelector('.m3-stage')?.dataset.universe==='gargantua'`);

      // Resume backwards and leave through the actual entrance, well before leaving the Dneg envelope.
      await app.js(
        `(()=>{const c=__bh.camera;__bh.settings.velR=__bh.settings.whL>=0?-0.01:0.01;c.sync();for(let j=0;j<3;j++)c.fall(0.02,[0,0,0],false);__bh.sim.setTime(c.nowTime());__bh.step(0);})()`,
      );
      await app.waitFor(
        `document.querySelector('.m3-stage')?.dataset.universe==='ours' && document.querySelector('.m3-stage').dataset.tunnel==='false'`,
      );
      expect(await app.js<string>(`document.querySelector('.m3-crumbs').textContent`)).toContain("Sun");
      expect(await app.js<string>(`document.querySelector('.m3-menu').textContent`)).toContain("Mercury");
      expect(app.cdp.errors).toEqual([]);
      const shot = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await Bun.write("/tmp/wormhole-map.png", Buffer.from(shot.data, "base64"));
    } finally {
      app.close();
    }
  },
  180_000,
);
