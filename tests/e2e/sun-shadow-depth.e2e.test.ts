// Refuse les récepteurs hors profondeur sans supprimer les ombres valides sur Terre et Lune.
// Restaure la vue exacte de Sam, compare les cartes actives/désactivées et exécute le lecteur WGSL sur des cas contrôlés.
// Duration: ~2 min sur ce Mac, suivant les compilations des deux mondes.
// Done when: les cas GPU, leurs témoins, Monument Valley et les deux vues lunaires passent sans erreur.
import { expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng, type Pixels } from "./lib/png";
import { SQUARE_SHADOW_TIME, SQUARE_SHADOW_VIEW } from "./lib/square-shadow-view";
import { shadowDepthCases, shadowDepthProbeJs } from "./lib/sun-shadow-depth";

const OUT = process.env.SHADOW_DEPTH_OUT ?? "remote-results/sun-shadow-depth";
const waitFrames = `new Promise(resolve => { let n=0; const f=()=> ++n>=30 ? resolve(true) : requestAnimationFrame(f); requestAnimationFrame(f); })`;
type Probe = Record<string, { name: string; value: number[] }[]>;

function changed(a: Pixels, b: Pixels) {
  let count = 0;
  let pixels = 0;
  // Exclude the toolbar, FPS and status indicators; all captures have the same viewport.
  for (let y = 80; y < a.height; y++) {
    for (let x = 35; x < a.width; x++) {
      const i = (y * a.width + x) * a.channels;
      const j = (y * b.width + x) * b.channels;
      const d =
        0.2126 * (a.data[i]! - b.data[j]!) + 0.7152 * (a.data[i + 1]! - b.data[j + 1]!) + 0.0722 * (a.data[i + 2]! - b.data[j + 2]!);
      if (Math.abs(d) > 8) count++;
      pixels++;
    }
  }
  return { count, pixels, fraction: count / pixels };
}

test.skipIf(!E2E)(
  "cascades : profondeur valide, Terre exacte et Lune",
  async () => {
    let app: App | undefined;
    try {
      app = await App.boot({
        hash: `scene=${encodeURIComponent("Earth: Monument Valley's Mittens")}`,
        width: 2225,
        height: 863,
        tiles: true,
      });
      app.steps(["Contrat GPU et témoins", "Monument Valley", "Lune haute", "Ombres lunaires", "Vérifications"]);
      await app.step("Contrat GPU et témoins");
      const probe = await app.js<Probe>(shadowDepthProbeJs);
      await Bun.write(`${OUT}/gpu-cases.json`, JSON.stringify(probe, null, 2));
      for (const [i, c] of shadowDepthCases.entries()) {
        expect(probe.fixed![i]!.value[0]!, c.name).toBeCloseTo(c.expected, 5);
      }
      expect(probe.repeat).toEqual(probe.fixed);
      const caught = shadowDepthCases.filter((c, i) => Math.abs(probe.legacy![i]!.value[0]! - c.expected) > 1e-5).map((c) => c.name);
      expect(caught).toContain("earth-far");
      expect(caught).toContain("moon-far");
      expect(caught).toContain("invalid-blend");
      expect(caught).toContain("next-cascade");
      console.log("GPU", JSON.stringify({ cases: shadowDepthCases.length, caught }));
      await app.stepDone(`${shadowDepthCases.length} cas GPU, A/A exact, ancien lecteur réfuté`);

      async function shot(name: string, on: boolean) {
        await app!.scenario(name);
        await app!.js(`(() => { __bh.renderer.sunShadowOn=${on}; __bh.touch(); return true; })()`);
        await app!.js(waitFrames);
        await app!.shot(`${OUT}/${name}.png`);
        return readPng(new Uint8Array(await Bun.file(`${OUT}/${name}.png`).arrayBuffer()));
      }
      await app.step("Monument Valley");
      await app.js(`(() => {
      __bh.freeze(true);
      const saved=__bh.game.snapshot('ombre-carree'); Object.assign(saved.settings,${JSON.stringify(SQUARE_SHADOW_VIEW)});
      saved.time=${SQUARE_SHADOW_TIME};saved.camera={gravity:false};saved.ship.piloting=false;saved.ship.landed=null;saved.character=null;
      __bh.game.load(saved,{quiet:true});
      Object.assign(__bh.settings,{dynamicResolution:false,pixelRatio:1});__bh.forceScale(0.75);__bh.step(0);__bh.touch();return true;
    })()`);
      await app.dataSettled("Monument Valley — pose exacte");
      await app.exposureSettled();
      const position = await app.js<{ lat: number; lon: number; altM: number }>("__bh.sys.geodetic()");
      expect(position.lat).toBeCloseTo(36.876883648196284, 5);
      expect(position.lon).toBeCloseTo(-110.51352643813274, 5);
      expect(position.altM).toBeCloseTo(19829.09353049848, 0);
      expect(await app.js<boolean>("__bh.renderer.sunDrawn")).toBe(true);
      const earth = await shot("earth-fixed", true);
      const earthRepeat = await shot("earth-repeat", true);
      const earthOff = await shot("earth-off", false);
      const earthDelta = changed(earth, earthOff);
      const earthNoise = changed(earth, earthRepeat);
      expect(earthDelta.fraction).toBeLessThan(0.02);
      await app.stepDone(`Sans carré : ${earthDelta.count} pixels / ${earthDelta.pixels} différents sans carte`);

      const lunar: Record<string, unknown> = {};
      for (const view of [
        { tag: "moon-high", phase: 15, altKm: 30, off: [0, 0], step: "Lune haute" },
        { tag: "moon-low", phase: 75, altKm: 5, off: [0, 35], step: "Ombres lunaires" },
      ]) {
        await app.step(view.step);
        await app.scenario(view.tag);
        await app.js(`(() => {
        __bh.presets['shadow depth moon']={...__bh.presets['Moon: Earthrise'], ship:false, fov:50, temporalBlend:1,
          pose:{body:'moon',altKm:${view.altKm},phase:${view.phase},look:'moon',off:${JSON.stringify(view.off)}}};
        __bh.game.preset('shadow depth moon');__bh.freeze(true);__bh.step(0);
        __bh.renderer.sunShadowOn=true;__bh.touch();return true;
      })()`);
        await app.dataSettled(view.tag);
        await app.waitFor("__bh.renderer.moonTiles.pending === 0", 60_000);
        await app.waitProgress("__bh.renderer.horizonMaps.state === 'done'", `${view.tag} — horizons lunaires`);
        await app.exposureSettled();
        // Hold the measured exposure across the lighting A/B; disable sub-pixel jitter for the lunar shadow witness.
        const exposure = await app.js<number>(`(async () => {
          const r=__bh.renderer,s=__bh.settings,c=await r.sceneColor(s),l=[];
          for(let i=0;i<c.data.length;i+=64)l.push((0.2126*c.data[i]+0.7152*c.data[i+1]+0.0722*c.data[i+2])*c.exposure);
          l.sort((a,b)=>a-b);
          s.exposure=r.ev(s)+Math.log2(0.18/Math.max(l[l.length>>1],1e-10));
          s.autoExposure=false;__bh.touch();return s.exposure;
        })()`);
        await app.waitFor("__bh.renderer.bodyRasterNow && __bh.renderer.sunDrawn", 30_000);
        const state = await app.js(
          "({position:__bh.sys.geodetic(),sun:Array.from(__bh.renderer.sunTable),cascades:Array.from(__bh.renderer.sunCascadeRows)})",
        );
        const on = await shot(`${view.tag}-on`, true);
        const levels: number[] = [];
        for (let y = 80; y < on.height; y += 8) {
          for (let x = 35; x < on.width; x += 8) {
            const i = (y * on.width + x) * on.channels;
            levels.push(0.2126 * on.data[i]! + 0.7152 * on.data[i + 1]! + 0.0722 * on.data[i + 2]!);
          }
        }
        levels.sort((a, b) => a - b);
        const medianLuma = levels[levels.length >> 1]!;
        expect(medianLuma).toBeGreaterThan(10);
        expect(medianLuma).toBeLessThan(220);
        const repeat = await shot(`${view.tag}-repeat`, true);
        const off = await shot(`${view.tag}-off`, false);
        const delta = changed(on, off),
          noise = changed(on, repeat);
        lunar[view.tag] = { state, exposure, medianLuma, delta, noise };
        console.log(view.tag, JSON.stringify(lunar[view.tag]));
        if (view.tag === "moon-high") expect(delta.fraction).toBeLessThan(0.02);
        else {
          // Disabling the map resumes the lunar relief march, which should preserve real shadows.
          // Remove ALL relief shadows for the positive control, rather than mistaking that fallback for no shadow.
          await app.js("(__bh.renderer.liteSkip=4, true)");
          const noShadow = await shot("moon-low-no-relief-shadow", true);
          const shadowDelta = changed(on, noShadow);
          lunar[view.tag] = { state, exposure, medianLuma, delta, noise, shadowDelta };
          expect(shadowDelta.count).toBeGreaterThan(Math.max(1000, noise.count * 3));
          await app.js("(__bh.renderer.liteSkip=0, true)");
        }
        await app.stepDone(`${view.tag} : ${delta.count} pixels d'ombre, bruit A/A ${noise.count}`);
      }
      await app.step("Vérifications");
      const gpuErrors = await app.js<number>("__bh.renderer.gpuErrors");
      const result = { position, earthDelta, earthNoise, lunar, gpuErrors, errors: app.cdp.errors };
      await Bun.write(`${OUT}/results.json`, JSON.stringify(result, null, 2));
      console.log("RESULT", JSON.stringify(result));
      expect(gpuErrors).toBe(0);
      expect(app.cdp.errors).toEqual([]);
      await app.stepDone("Cartes actives, ombres conservées, aucune erreur GPU/page");
    } finally {
      app?.close();
      stopServer();
    }
  },
  600_000,
);
