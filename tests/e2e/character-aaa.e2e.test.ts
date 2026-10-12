// On foot, as a game would be judged: the astronaut drawn over the landed vessel (never hidden by its hull,
// never walking into it), lit by the light probe the vessel's hull is lit by (its key light and sky on every
// world: a black shadow on the Moon, a soft one under the Earth's sky, none at night), the vessel's shadow
// read on foot, the jump's buffer and the landing's give with real keys, and the scenery waited for after a
// teleport (the settled frame never shows a place without its forests and buildings). Captures for review
// in remote-results/character-aaa-*.png (with their readiness JSON).
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { captureLoadedCharacter } from "./lib/character-ready";

afterAll(stopServer);

const SETUP = `__bh.freeze(true);Object.assign(__bh.settings,{dynamicResolution:false,realtimeSubsampling:2,pixelRatio:1,temporalReprojection:false,earthClouds:0,volumetricClouds:false});__bh.game.setDate('2021-06-21T12:00:00Z');`;

/** The mean absolute difference [0–255] between two screenshots of the same clip (decoded in the page). */
async function patchDiff(app: App, a: string, b: string) {
  return app.js<number>(`(async () => {
    const px = async (s) => {
      const i = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
      const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d');
      g.drawImage(i, 0, 0);
      return g.getImageData(0, 0, i.width, i.height).data;
    };
    const x = await px(${JSON.stringify(a)}), y = await px(${JSON.stringify(b)});
    let s = 0, n = 0;
    for (let k = 0; k < x.length; k += 4) { s += Math.abs(x[k] - y[k]) + Math.abs(x[k + 1] - y[k + 1]) + Math.abs(x[k + 2] - y[k + 2]); n += 3; }
    return s / n;
  })()`);
}

/** A clip of the screen around a point of the astronaut's (metres up from his feet), after a few drawn frames. */
async function shotAt(app: App, heightM: number, half = 6) {
  await app.js("(()=>{__bh.step(0);__bh.touch();return true;})()");
  const frame = await app.js<number>("__bh.renderer.completedFrames");
  await app.waitFor(`__bh.renderer.completedFrames >= ${frame + 6}`, 30_000);
  const at = await app.js<{ x: number; y: number }>(`(() => {
    const f = __bh.camera.character.frame(), s = __bh.camera.viewSettings();
    const p = f.origin.map((v, i) => v + f.axes[1][i] * ${heightM});
    const t = Math.tan(s.fov * Math.PI / 360), w = innerWidth, h = innerHeight;
    return { x: (0.5 + 0.5 * p[0] / (p[2] * t * w / h)) * w, y: (0.5 - 0.5 * p[1] / (p[2] * t)) * h };
  })()`);
  const r = await app.cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.round(at.x - half), y: Math.round(at.y - half), width: 2 * half, height: 2 * half, scale: 1 },
  });
  return r.data;
}

test.skipIf(!E2E)(
  "in front of the landed vessel: drawn over its hull, stopped by it, lit by its probe, its shadow read",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: false });
    try {
      await app.js(`(()=>{${SETUP}__bh.game.land('moon',0,0);__bh.step(0);return true;})()`);
      await app.waitFor("__bh.renderer.ship.ready", 120_000);
      await app.press("KeyK", "K", { shift: true });
      expect(await app.js<boolean>("__bh.camera.character.active")).toBe(true);
      await app.js("(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()");
      await app.waitFor("__bh.renderer.characterRenderer.model.ready || __bh.renderer.characterRenderer.model.error", 120_000);
      expect(await app.js<string | null>("__bh.renderer.characterRenderer.model.error")).toBeNull();
      // (on foot the probe round the camera runs: the astronaut lit as the hull is; the vessel's shadow map read)
      await app.waitFor("__bh.renderer.characterRenderer.stats().probe && __bh.renderer.characterRenderer.stats().shipShadow", 60_000);
      expect(await app.js<boolean>("!!__bh.renderer.characterRenderer.occluder")).toBe(true);
      const hull = await app.js<{ distanceM: number; half: number[] } | null>("__bh.camera.character.state().hull");
      expect(hull).not.toBeNull();
      expect(hull!.distanceM).toBeGreaterThan(0.3);
      // (ten seconds towards the hull's centre: stopped against it, never inside)
      const walk = await app.js<{ closest: number; inside: number }>(`(() => {
        const c = __bh.camera.character, h = c.vesselHull(), up = c.up();
        const d = h.centre.map((v, i) => v - c.q[i]), k = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
        const flat = d.map((v, i) => v - up[i] * k), n = Math.hypot(...flat);
        c.heading = flat.map((v) => v / n); c.yaw = 0; c.pitch = 0.12;
        c.move(1, 0, 10);
        let closest = Infinity, inside = 0;
        for (let i = 0; i < 1200; i++) {
          __bh.step(1 / 120);
          const s = c.state().hull;
          closest = Math.min(closest, s.distanceM);
          if (s.distanceM < 0.29) inside++;
        }
        c.move(0, 0, 0);
        return { closest, inside };
      })()`);
      expect(walk.inside).toBe(0);
      expect(walk.closest).toBeLessThan(1.5);
      // (the camera behind him, the hull beyond: the hull covers his chest's pixels, he is drawn over it)
      await app.js("(()=>{const c=__bh.camera.character;c.yaw=0;c.pitch=0.12;for(let i=0;i<60;i++)__bh.step(1/60);return true;})()");
      const all = await shotAt(app, 1.1);
      await app.js("(()=>{globalThis.__enc=__bh.renderer.encodeCharacter;__bh.renderer.encodeCharacter=()=>{};return true;})()");
      const shipOnly = await shotAt(app, 1.1);
      await app.js("(()=>{globalThis.__ship=__bh.renderer.ship.encodeShip;__bh.renderer.ship.encodeShip=()=>{};return true;})()");
      const groundOnly = await shotAt(app, 1.1);
      await app.js(
        "(()=>{__bh.renderer.encodeCharacter=globalThis.__enc;__bh.renderer.ship.encodeShip=globalThis.__ship;__bh.touch();return true;})()",
      );
      const hullThere = await patchDiff(app, shipOnly, groundOnly);
      const astronautThere = await patchDiff(app, all, shipOnly);
      await Bun.write("remote-results/character-aaa-occlusion.json", JSON.stringify({ hull, walk, hullThere, astronautThere }, null, 2));
      expect(hullThere).toBeGreaterThan(8);
      expect(astronautThere).toBeGreaterThan(8);
      await captureLoadedCharacter(app, "character-aaa-vessel-moon");
      // (boarding from where he stands: within reach of the hatch, or not — the key answers either way, no error)
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  420_000,
);

test.skipIf(!E2E)(
  "the light on foot is the world's: black shadows on the Moon, softer under the Earth's and Mars's skies, none at night",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    try {
      await app.js(`(()=>{${SETUP}return true;})()`);
      const light: Record<string, { key: number; sky: number; cosine: number; shadowDepth: number }> = {};
      // (the light where he stands, the probe settled: a few of its refreshes)
      const measure = async (body: string, lat: number, lon: number) => {
        const error = await app.js<string | null>(`__bh.camera.character.start('${body}', ${lat}, ${lon})`);
        expect(error).toBeNull();
        await app.js("(()=>{for(let i=0;i<30;i++)__bh.step(1/60);__bh.touch();return true;})()");
        await app.waitFor("__bh.renderer.characterRenderer.model.ready && __bh.renderer.characterRenderer.stats().probe", 180_000);
        await app.waitFor("__bh.renderer.variantReady && __bh.renderer.calibrationReady", 240_000);
        const frame = await app.js<number>("__bh.renderer.completedFrames");
        await app.waitFor(`__bh.renderer.completedFrames >= ${frame + 30}`, 60_000);
        const l = await app.js<{ key: number; sky: number; cosine: number; shadowDepth: number } | null>("__bh.renderer.characterLight()");
        expect(l).not.toBeNull();
        expect(Object.values(l!).every(Number.isFinite)).toBe(true);
        return l!;
      };
      // (the Moon and Mars: the first longitude of the equator with the Sun well up at that date; the Earth's
      // Cévennes at noon, and its antipode at midnight)
      for (const [name, body, lat, lons] of [
        ["moon", "moon", 0, [0, 90, 180, 270]],
        ["mars", "mars", 0, [0, 90, 180, 270]],
        ["earth", "earth", 44.2, [4.15]],
        ["earth-night", "earth", -44.2, [-175.85]],
      ] as const) {
        for (const lon of lons) {
          light[name] = await measure(body, lat, lon);
          if (light[name]!.cosine > 0.3 || body === "earth") break;
          await app.js("(()=>{__bh.camera.character.stop();__bh.step(0);return true;})()");
        }
        if (name !== "earth-night") await captureLoadedCharacter(app, `character-aaa-${name}`);
        await app.js("(()=>{__bh.camera.character.stop();__bh.step(0);return true;})()");
      }
      await Bun.write("remote-results/character-aaa-light.json", JSON.stringify(light, null, 2));
      // (sunlit everywhere by day, a sky only where there is air: the Moon's shadows the deepest)
      for (const name of ["moon", "mars", "earth"]) expect(light[name]!.key).toBeGreaterThan(0);
      expect(light.moon!.shadowDepth).toBeGreaterThan(0.8);
      expect(light.moon!.shadowDepth).toBeGreaterThan(light.earth!.shadowDepth);
      expect(light.earth!.shadowDepth).toBeGreaterThan(0.3);
      expect(light.earth!.shadowDepth).toBeLessThan(0.97);
      // (the sky's share of the light, relative to the Sun's: the Earth's air above the Moon's none)
      expect(light.earth!.sky / light.earth!.key).toBeGreaterThan(light.moon!.sky / light.moon!.key);
      // (midnight: no key light left, no shadow to cast)
      expect(light["earth-night"]!.shadowDepth).toBeLessThan(0.05);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  900_000,
);

test.skipIf(!E2E)(
  "the jump with real keys: asked just before landing it is made on landing, the legs give, the stride held in the air",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: false });
    try {
      await app.js(
        `(()=>{${SETUP}const c=__bh.camera.character;const e=c.start('moon',0,0);globalThis.__jumps=0;const o=c.onEvent;c.onEvent=(k,d)=>{if(k==='jump')globalThis.__jumps++;o(k,d);};return e;})()`,
      );
      await app.press("Space", " ");
      await app.js("(()=>{__bh.step(1/120);return true;})()");
      expect(await app.js<number>("__bh.camera.character.vertical")).toBeGreaterThan(0);
      // (falling, about 0.08 s from the lunar ground: Space again)
      await app.js(
        `(()=>{const c=__bh.camera.character;for(let i=0;i<4000;i++){if(c.vertical<0&&c.height()<-c.vertical*0.08+0.81*0.0064)break;__bh.step(1/120);}return c.height();})()`,
      );
      await app.press("Space", " ");
      const after = await app.js<{ jumps: number; deepest: number; airSpeed: number }>(`(()=>{
        const c=__bh.camera.character;let deepest=0,airSpeed=0;
        for(let i=0;i<240;i++){__bh.step(1/120);deepest=Math.min(deepest,c.frame().dip);if(!c.grounded)airSpeed=Math.max(airSpeed,c.speed);}
        return {jumps:globalThis.__jumps,deepest,airSpeed};
      })()`);
      expect(after.jumps).toBe(2);
      expect(after.deepest).toBeLessThan(-0.01);
      // (a jump in place: no gait — the speed along the ground stays nil in the air)
      expect(after.airSpeed).toBeLessThan(0.05);
      await app.js("(()=>{const c=__bh.camera.character;for(let i=0;i<4000&&!c.grounded;i++)__bh.step(1/120);c.stop();return true;})()");
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180_000,
);

test.skipIf(!E2E)(
  "after a teleport the settled frame waits for the new place's scenery: never settled on an empty place",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: true });
    try {
      await app.js(
        `(()=>{${SETUP}__bh.settings.earthScenery='balanced';__bh.settings.earthTerrain=true;return __bh.camera.character.start('earth',48.86,2.35);})()`,
      );
      await app.js("(()=>{__bh.step(0);__bh.touch();return true;})()");
      await app.waitFor("__bh.renderer.earthScenery.stats().status==='ready' && !__bh.renderer.earthScenery.pending", 180_000);
      // (22 km east, at once: sampled every 50 ms — from the second frame drawn there — until its scene is drawn)
      const seen = await app.js<{ settledEarly: number; samples: number; status: string; lon: number | null }>(`new Promise((ok) => {
        const r = __bh.renderer;
        const error = __bh.camera.character.start('earth', 48.86, 2.65);
        if (error) return ok({ settledEarly: -1, samples: 0, status: error, lon: null });
        __bh.step(0); __bh.touch();
        const from = r.completedFrames + 2, began = performance.now();
        let settledEarly = 0, samples = 0;
        const t = setInterval(() => {
          if (r.completedFrames < from) return;
          const s = r.earthScenery.stats(), here = s.status === 'ready' && s.lon !== null && Math.abs(s.lon - 2.65) < 0.05;
          samples++;
          if (r.earthSettled && !here) settledEarly++;
          if (here || performance.now() - began > 120000) {
            clearInterval(t);
            ok({ settledEarly, samples, status: s.status, lon: s.lon });
          }
        }, 50);
      })`);
      expect(seen.status).toBe("ready");
      expect(Math.abs(seen.lon! - 2.65)).toBeLessThan(0.05);
      expect(seen.samples).toBeGreaterThan(1);
      expect(seen.settledEarly).toBe(0);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  420_000,
);
