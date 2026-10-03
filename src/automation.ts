// The automation handle, globalThis.__bh: what the devtools, the end-to-end tests (tests/e2e), the
// benchmark and the scripts (scripts/*.ts) drive the app with — the scenes, the settings, the
// simulation frozen and stepped, offline renders and videos posted to the dev server, the bench.
//   __bh.settings.spin = 0.5; __bh.touch()
//   __bh.game.help()
import type { CameraController } from "./controls";
import type { FrameStats, OfflineOptions, Renderer } from "./renderer";
import { defaultSettings, presets, QUALITY, type Settings, type Target } from "./settings";
import type { Simulation } from "./sim";
import type { GameTools } from "./game/tools";
import { BENCH_SCENES, type KerrBench } from "./bench/runner";
import { vram } from "./bench/vram";
import type { Mission } from "./mission";
import type { CockpitScreens } from "./ui/cockpitscreens";
import type { SoundDirector } from "./audio/director";
import { sound } from "./audio/engine";
import { VideoWriter } from "./video";
import { CONSTELLATIONS, NAMED_STARS, type ChartFrame } from "./skychart";
import { issElements, issOrbit, issStart, issTrack, station } from "./system/iss";
import { rangerHull, stationHulls } from "./system/collide";
import { fleet } from "./fleet";
import { ourState } from "./system/our-side";
import { bodyState } from "./system/ephemeris";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { cameraFrame, homePosition, setHolePose, setHomePose } from "./camera";
import { mouth } from "./wormhole";
import { bodyLook, type Body } from "./targeting";
import { setDateNow } from "./util/now";
import { advanceFrameClock } from "./frameclock";

export interface BhContext {
  settings: Settings;
  renderer: Renderer;
  camera: CameraController;
  sim: Simulation;
  tools: GameTools;
  bench: KerrBench;
  mission: Mission;
  cockpitScreens: CockpitScreens;
  audio: SoundDirector;
  skyLoading: Promise<unknown>;
  touch(): void;
  resize(): void;
  refreshGui(): void;
  applyPreset(name: string): void;
  goTo(b: Target): string | null;
  skyGoTo(kind: "constellation" | "star", index: number): unknown;
  updateChart(force?: boolean): void;
  chart(): ChartFrame | null;
  lastStats(): FrameStats | null;
  /** Freezes the loop's own simulation (the automation steps it). */
  freeze(on: boolean): void;
}

export function installBh(c: BhContext) {
  const { settings, renderer, camera, sim, tools, bench, mission, cockpitScreens, audio, skyLoading } = c;
  const { touch, resize, applyPreset, goTo, skyGoTo, updateChart } = c;
  const refreshGui = () => c.refreshGui();
  const snapshot = async (name = "snapshot") =>
    fetch(`/__snapshot?name=${encodeURIComponent(name)}`, { method: "POST", body: await renderer.exportPNG(settings) });
  /**
   * Automation: renders a scene offline and saves it through the dev server (snapshots/<name>.png).
   * __bh.render("hero", "Kerr a=0.94, near edge-on", { exposure: 0.3 }, { width: 1920, spp: 128 })
   */
  const render = async (
    name: string,
    preset: string | null,
    patch: Partial<Settings> = {},
    o: Partial<OfflineOptions> & { time?: number } = {},
  ) => {
    renderer.cancelOffline();
    if (preset) applyPreset(preset);
    Object.assign(settings, { animate: false, exposure: 0, renderMode: "physical" }, patch);
    refreshGui();
    // (the Earth's maps and terrain tiles in first — up to half a minute —, and a camera on the ground
    // raised onto it: the live frames ask for them and carry the camera)
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 3; i++) await frame();
    for (let w = performance.now(); !renderer.earthSettled && performance.now() - w < 30000; ) await frame();
    for (let i = 0; i < 3; i++) await frame();
    const t0 = performance.now();
    renderer.startOffline(settings, o.time ?? sim.time, {
      width: 1920,
      height: 1080,
      spp: 128,
      tolerance: 1e-6,
      eps: 0.02,
      maxSteps: 12000,
      noiseThreshold: 0.004,
      minSpp: 16,
      shutter: 0,
      budgetMs: 250,
      ...o,
    });
    while (!renderer.offlineState?.done) {
      await new Promise((r) => setTimeout(r, 500));
      if (!renderer.offlineActive) return "cancelled";
    }
    await snapshot(`${name}.png`);
    return `${name}: ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  };
  /**
   * Automation: a video of the current view — offline frames at the scene's time advancing by `rate` M
   * per second of video (the camera still, or moved by `path(u)`, u from 0 to 1: settings for the
   * frame), H.264 in an MP4 saved through the dev server (snapshots/<name>.mp4). Progress in
   * __bh.videoState.
   * __bh.video("pass", { seconds: 10, fps: 30, rate: 8, width: 1920, height: 1080, spp: 24,
   *   path: (u) => ({ azimuth: 40 + 12 * u }) })
   */
  const videoState = { frame: 0, frames: 0, started: 0, done: false, result: "" };
  const video = async (
    name: string,
    o: Partial<OfflineOptions> & { seconds?: number; fps?: number; rate?: number; path?: (u: number) => Partial<Settings> } = {},
  ) => {
    const { seconds = 10, fps = 30, rate = settings.timeSpeed, path, ...off } = o;
    const opts: OfflineOptions = {
      width: 1920,
      height: 1080,
      spp: 24,
      tolerance: 1e-5,
      eps: 0.03,
      maxSteps: 6000,
      noiseThreshold: 0.01,
      minSpp: 8,
      shutter: 0,
      budgetMs: 250,
      ...off,
    };
    opts.width &= ~1;
    opts.height &= ~1;
    const cfg = await VideoWriter.supported(opts.width, opts.height, fps);
    if (!cfg) return (videoState.result = `H.264 at ${opts.width}×${opts.height} not supported`);
    const writer = new VideoWriter(cfg, fps);
    renderer.cancelOffline();
    const t0 = sim.time;
    Object.assign(videoState, { frame: 0, frames: Math.round(seconds * fps), started: performance.now(), done: false, result: "" });
    const n = videoState.frames;
    // (a path: the camera set frame by frame, the time at the rate; else the scene goes on as live —
    // the simulation's step, the user's inputs left out)
    settings.timeSpeed = rate;
    let clock = 0;
    for (let i = 0; i < n; i++) {
      if (path) Object.assign(settings, path(n > 1 ? i / (n - 1) : 0));
      else {
        camera.scripted = true;
        const tf = i / fps;
        while (clock < tf - 1e-9) {
          const dt = Math.min(1 / 60, tf - clock);
          sim.step(dt);
          clock += dt;
        }
        sim.applyRender(camera.piloting && !camera.cinematic ? camera.flightInfo() : null);
        camera.scripted = false;
      }
      renderer.startOffline(settings, path ? t0 + (i / fps) * rate : sim.time, opts);
      while (!renderer.offlineState?.done) {
        await new Promise((r) => setTimeout(r, 20));
        if (!renderer.offlineActive) return (videoState.result = "cancelled");
      }
      updateChart(true);
      const px = await renderer.exportRGBA(settings);
      await writer.addFrame(px.data, px.width, px.height);
      videoState.frame = i + 1;
    }
    await fetch(`/__snapshot?name=${encodeURIComponent(name)}.mp4`, { method: "POST", body: await writer.finish() });
    renderer.cancelOffline();
    videoState.done = true;
    return (videoState.result = `${name}.mp4: ${videoState.frames} frames in ${((performance.now() - videoState.started) / 1000).toFixed(0)} s`);
  };
  Object.assign(globalThis, {
    __bh: {
      /** the game's tools: __bh.game.help() */
      game: tools,
      /** the Kerr Bench: __bh.bench.run({ mode: "quick" }) → its report; scene(name) one scene's */
      bench: {
        run: (o: Parameters<KerrBench["run"]>[0]) => bench.run(o),
        scene: (name: string, quick = false) =>
          bench.scene(
            name,
            quick ? { warm: 2500, auto: 4000, fixedWarm: 1500, fixed: 3000 } : { warm: 4000, auto: 8000, fixedWarm: 2500, fixed: 5000 },
          ),
        scenes: BENCH_SCENES,
        vram,
      },
      settings,
      renderer,
      camera,
      touch,
      snapshot,
      render,
      video,
      videoState,
      resize,
      preset: applyPreset,
      presets,
      refresh: refreshGui,
      skyLoading,
      /** the space station: its orbit (SGP4), the tracker the game flies it with, its elements, its geometry */
      iss: {
        orbit: issOrbit,
        track: issTrack,
        elements: issElements,
        station,
        start: issStart,
        hulls: { ranger: rangerHull, station: stationHulls },
      },
      /** the free camera to a target (the camera panel's Go to) */
      goTo,
      /** the fleet: the craft, where they are, their dockings (fleet.ts) */
      fleet,
      /** our side's bodies: place and velocity at a time (home frame) */
      ourState,
      /** the sky chart: turn to a constellation or star by name, rebuild it (a video frame), what it drew */
      sky: {
        goTo: (name: string) => {
          const n = name.toLowerCase();
          const c = CONSTELLATIONS.findIndex((k) => k.name.toLowerCase() === n || k.abbr.toLowerCase() === n);
          if (c >= 0) return skyGoTo("constellation", c);
          const st = NAMED_STARS.findIndex((k) => k.name.toLowerCase() === n);
          if (st >= 0) return skyGoTo("star", st);
          throw new Error(`no constellation or star named ${name}`);
        },
        update: () => updateChart(true),
        chart: () => c.chart(),
      },
      /** the sound: __bh.sound.play("sas-on"), __bh.sound.ctx */
      sound,
      audio,
      /** the cabin's screens: their picture (canvas: 4 × 2 slots of 512 px, the PFD first) */
      cockpitScreens,
      /** the built-in scenes' names (for __bh.preset) */
      scenes: () => Object.keys(presets),
      /** the scene gallery's pictures: each scene applied, left to converge, cropped to 16:9, 640 × 360,
       *  posted to snapshots/scene-<slug>.webp (then: bun scripts/scene-thumbs.ts) */
      captureScenes: async (names = Object.keys(presets), maxMs = 14000) => {
        const slug = (n: string) =>
          n
            .normalize("NFKD")
            .replace(/[^\w]+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase()
            .slice(0, 60);
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const pixelRatio = settings.pixelRatio;
        for (const name of names) {
          // (from the defaults, as a first visit would show it: no ship or exposure carried over)
          Object.assign(settings, defaultSettings(), QUALITY.high, { quality: "high", pixelRatio });
          applyPreset(name);
          // (a scene with no time of its own at 0 — not wherever the clock stood: the same picture each time)
          if (presets[name]!.time === undefined) sim.setTime(0);
          // (still scenes are frozen and left to converge; flights and missions get a while)
          const moving = !!presets[name]!.ship || !!presets[name]!.mission;
          if (!moving) settings.animate = false;
          touch();
          const t0 = performance.now();
          await wait(2500);
          // (the Earth's maps and terrain tiles in first: up to half a minute more)
          while (!renderer.earthSettled && performance.now() - t0 < 30000) await wait(250);
          const t1 = performance.now();
          while (performance.now() - t1 < (moving ? 9000 : maxMs) && !(c.lastStats()?.phase === "converged" && !moving)) await wait(250);
          const img = await createImageBitmap(await renderer.exportPNG(settings));
          const W = 640,
            H = 360;
          const sw = Math.min(img.width, (img.height * W) / H),
            sh = (sw * H) / W;
          const cv = new OffscreenCanvas(W, H);
          const ctx = cv.getContext("2d")!;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
          const out = await cv.convertToBlob({ type: "image/webp", quality: 0.82 });
          await fetch(`/__snapshot?name=scene-${slug(name)}.webp`, { method: "POST", body: out });
        }
        return names.length;
      },
      time: () => sim.time,
      mission,
      /** a system's bodies (ephemeris) and camera placement, for automation */
      sys: {
        bodyState: (id: string, t: number) => bodyState(GARGANTUA_SYSTEM, id, t),
        setHolePose,
        mouth: (t?: number) => mouth(settings, t),
        /** our universe (home frame, our mouth at the origin) */
        setHomePose: (
          X: [number, number, number],
          fwd: [number, number, number],
          up?: [number, number, number],
          vel?: [number, number, number],
        ) => setHomePose(settings, X, fwd, up, vel),
        homePosition: () => homePosition(settings),
        /** where the camera sees a body (CPU geodesics, retarded, aberrated): a look direction */
        look: (id: string) => bodyLook(settings, cameraFrame(settings), id as Body, sim.time).look,
      },
      /** Freezes the loop's own simulation; step(dt) then advances it (camera, mission, time) by dt. */
      freeze: (on: boolean) => c.freeze(on),
      /** the calendar's "now" for the scenes of the real time (the station, the fleet): fixed by tests */
      setDate: setDateNow,
      step: (dt: number) => {
        advanceFrameClock(dt * 1000);
        sim.step(dt);
        sim.applyRender(camera.piloting && !camera.cinematic ? camera.flightInfo() : null);
        sim.timeDirty = true;
        touch();
        return sim.time;
      },
      setTime: (t: number) => sim.setTime(t),
      /** the simulation (sim.ts): its clocks, its step */
      sim,
    },
  });
}
