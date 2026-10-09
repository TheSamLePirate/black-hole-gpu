// The automation handle, globalThis.__bh: what the devtools, the end-to-end tests (tests/e2e), the
// benchmark and the scripts (scripts/*.ts) drive the app with — the scenes, the settings, the
// simulation frozen and stepped, offline renders and videos posted to the dev server, the bench.
//   __bh.settings.spin = 0.5; __bh.touch()
//   __bh.game.help()
import { bodyFixedOf, groundRelief, toBodyFixed } from "./system/our-surface";
import { cartToGeodetic, flatteningOf } from "./system/ellipsoid";
import { M_METRES, M_SECONDS, solarBody } from "./system/solar";
import { gpuDiagnostics } from "./gpu-diagnostics";
import type { CameraController } from "./controls";
import type { FrameStats, OfflineOptions, Renderer } from "./renderer";
import { cockpitHull } from "./system/collide";
import { cabinHitOf } from "./cockpit/pick";
import { CONTROLS, controlBox } from "./cockpit/controls";
import { tabAt } from "./ui/cockpitscreens";
import { defaultSettings, presets, QUALITY, type Settings, type Target } from "./settings";
import type { Simulation } from "./sim";
import type { GameTools } from "./game/tools";
import { BENCH_SCENES, estimateSeconds, type KerrBench } from "./bench/runner";
import { BENCH_ITEMS } from "./bench/suites";
import type { BenchMode, SuiteId } from "./bench/report";
import { vram } from "./bench/vram";
import type { Mission } from "./mission";
import type { CockpitScreens } from "./ui/cockpitscreens";
import type { SoundDirector } from "./audio/director";
import { sound } from "./audio/engine";
import type { Speech } from "./audio/voice";
import { VideoWriter } from "./video";
import { CONSTELLATIONS, NAMED_STARS, type ChartFrame } from "./skychart";
import { issElements, issOrbit, issStart, issTrack, station } from "./system/iss";
import { rangerHull, stationHulls } from "./system/collide";
import { fleet } from "./fleet";
import { ourState, referenceBody } from "./system/our-side";
import { predictOurs } from "./system/our-predict";
import { recorder } from "./game/recorder";
import { drawn as hudDrawn, panels as hudPanels, remeasure as remeasureHud } from "./ui/hud/layout";
import { bodyState } from "./system/ephemeris";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { cameraFrame, homePosition, setHolePose, setHomePose } from "./camera";
import { mouth } from "./wormhole";
import { bodyLook, type Body } from "./targeting";
import { setDateNow } from "./util/now";
import { advanceFrameClock } from "./frameclock";
import type { FlightPhase } from "./game/phase";
import type { Pwa } from "./pwa";

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
  /** the voices (PLAN-TARS): say(line), what was said, the queue */
  voice: Speech;
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
  /** the flight's phase (game/phase.ts) */
  phase(): FlightPhase | null;
  /** the 3D map's view (its camera's goal: the gestures' effect), when the flight HUD has one */
  mapView(): { dist: number; yaw: number; pitch: number; focus: number[] } | null;
  /** Freezes the loop's own simulation (the automation steps it). */
  freeze(on: boolean): void;
  /** Holds the render scale (0.25 … 1; null: the governor's again) — the benches, the tests */
  forceScale(x: number | null): void;
  /** the spectator out (a free camera, the ship flying on) or back; whether it is out */
  spectate(on: boolean): boolean;
  /** the PWA (src/pwa.ts): the worker's state, the caches' figures */
  pwa: Pwa;
}

export function installBh(c: BhContext) {
  const { settings, renderer, camera, sim, tools, bench, mission, cockpitScreens, audio, skyLoading, voice } = c;
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
      if (renderer.offlineState?.error) throw new Error(renderer.offlineState.error);
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
    const previousRate = settings.timeSpeed;
    try {
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
          if (renderer.offlineState?.error) throw new Error(renderer.offlineState.error);
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
    } catch (error) {
      videoState.result = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      writer.close();
      renderer.cancelOffline();
      camera.scripted = false;
      settings.timeSpeed = previousRate;
    }
  };
  Object.assign(globalThis, {
    __bh: {
      graphicsDiagnostic: () => gpuDiagnostics.report(),
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
        /** one suite's item (bench/suites.ts) by its id, at a depth: __bh.bench.item("final-edwards") */
        item: (id: string, mode: BenchMode = "quick") => {
          const it = BENCH_ITEMS.find((i) => i.id === id);
          if (!it) throw new Error(`no bench item "${id}" — ${BENCH_ITEMS.map((i) => i.id).join(", ")}`);
          return bench.item(it, mode);
        },
        items: BENCH_ITEMS.map((i) => `${i.suite}/${i.id} (${i.depth})`),
        estimate: (mode: BenchMode, suites: SuiteId[]) => estimateSeconds(mode, suites),
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
      /** the voices (PLAN-TARS): __bh.voice.say({ text, speaker, priority }), .said, .queue */
      voice,
      /** the cabin's screens: their picture (canvas: 4 × 2 slots of 512 px, the PFD first) */
      cockpitScreens,
      /** what a pixel shows in the Ranger's cabin (ndc −1…1, y up): the face hit — point, normal, material,
       *  a screen's display and uv — or null (cockpit/pick.ts) */
      /** where a cockpit control is in the view (its box's centre): ndc (y up), or null (cockpit/controls.ts ids) */
      cockpitControlAt: (id: string) => {
        const c = CONTROLS.find((x) => x.id === id);
        return c ? renderer.ship.cabinProject(controlBox(c).c) : null;
      },
      /** a point of the view (ndc) on a display's screen, on its tab for `page` (K3) — the view scanned; or
       *  null */
      cockpitScreenPoint: (slot: number, page: string) => {
        if (!cockpitHull.bvh || !cockpitHull.verts) return null;
        for (let y = 0.95; y > -0.95; y -= 0.012)
          for (let x = -0.95; x < 0.95; x += 0.012) {
            const ray = renderer.ship.cabinRay(x, y);
            const h = ray && cabinHitOf(ray.o, ray.d, cockpitHull.bvh, cockpitHull.verts);
            if (h?.screen?.slot === slot && tabAt(h.screen.u, h.screen.v) === page) return [x, y];
          }
        return null;
      },
      cabinPick: (ndcX: number, ndcY: number) => {
        const ray = renderer.ship.cabinRay(ndcX, ndcY);
        return ray && cockpitHull.bvh && cockpitHull.verts ? cabinHitOf(ray.o, ray.d, cockpitHull.bvh, cockpitHull.verts) : null;
      },
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
      /** the flight's phase: mode, control, stage (game/phase.ts) */
      phase: () => c.phase(),
      /** the 3D map's view: its distance and angles (the gestures' tests) */
      mapView: () => c.mapView(),
      mission,
      /** a system's bodies (ephemeris) and camera placement, for automation */
      /** the flight's recorder (game/recorder.ts): the tablet's telemetry, its CSV */
      recorder,
      /** the HUD's room (hud/layout.ts): the panels shown and the boxes the HUD's canvas drew this frame [CSS px] —
       *  the e2e "nothing overlaps" reads them */
      /** the GPU device (PLAN-MONDE M2): lost on purpose — its recovery tested —, how many frames since */
      gpu: {
        lose: () => renderer.simulateLoss(),
        /** the renderer's generation: one more for each made again after a loss */
        generation: () => renderer.generation,
        lost: () => renderer.lost,
        frames: () => renderer.frameTelemetry,
      },
      hud: {
        boxes: () => {
          remeasureHud();
          return [...hudPanels(), ...hudDrawn];
        },
      },
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
        /** the flown craft's navigation state, our side (controller ourNav: home frame [M, c], its reference
         *  body's place and velocity, the time [M]) — what the autopilots fly from; null elsewhere */
        nav: () => camera.ourNav(cameraFrame(settings)),
        /** the planner's own prediction (our-predict.ts predictOurs, no node) from the flown craft's state: its
         *  closest approach to a body within `days` — its height [km] and time [M]; the lab measures the
         *  planner's physics against the flight's with it (null: no state, or not within reach) */
        predictClosest: (id: string, days = 5) => {
          const nav = camera.ourNav(cameraFrame(settings));
          const b = solarBody(id);
          if (!nav || !b) return null;
          const path = predictOurs(nav.X, nav.V, nav.t, [], { tMax: (days * 86400) / M_SECONDS, maxSteps: 200000 });
          let best = { d: Infinity, i: -1 };
          for (let i = 0; i < path.pts.length; i++) {
            const P = ourState(id, path.times[i]!).pos;
            const d = Math.hypot(path.pts[i]![0] - P[0], path.pts[i]![1] - P[1], path.pts[i]![2] - P[2]);
            if (d < best.d) best = { d, i };
          }
          return best.i < 0 ? null : { km: ((best.d - b.radius) * M_METRES) / 1e3, t: path.times[best.i]!, steps: path.pts.length };
        },
        /** the planner's coast (predictOurs) from a state, with nodes ({t, dv: [P, N, R]}), to a time: the state
         *  there [M, c] (the lab: a burn as flown against the same burn as planned) */
        predictAt: (
          X: [number, number, number],
          V: [number, number, number],
          t: number,
          nodes: { t: number; dv: [number, number, number] }[],
          tAt: number,
        ) => {
          const path = predictOurs(X, V, t, nodes, { tMax: tAt - t + 1e-6, maxSteps: 200000, accel: camera.thrustMax() });
          const k = path.times.length - 1;
          return { X: path.pts[k]!, V: path.vels[k]!, t: path.times[k]! };
        },
        /** where the camera is over the body it is nearest, our side: its geodetic latitude, longitude [°]
         *  and height over the ellipsoid [m] (null: about the hole, or by the Sun alone) */
        geodetic: () => {
          const X = homePosition(settings);
          if (!X) return null;
          const t = sim.time;
          const id = referenceBody(X, t);
          const b = id === "sun" ? null : solarBody(id);
          if (!b) return null;
          const g = cartToGeodetic(b.radius, flatteningOf(id), toBodyFixed(id, X, t));
          return {
            body: id,
            lat: (g.lat * 180) / Math.PI,
            lon: (g.lon * 180) / Math.PI,
            altM: g.h * M_METRES,
            radiusM: b.radius * M_METRES,
          };
        },
        /** where the camera sees a body (CPU geodesics, retarded, aberrated): a look direction */
        look: (id: string) => bodyLook(settings, cameraFrame(settings), id as Body, sim.time).look,
      },
      /** Freezes the loop's own simulation; step(dt) then advances it (camera, mission, time) by dt. */
      freeze: (on: boolean) => c.freeze(on),
      /** holds the render scale (the image rendered at that share of the canvas, upscaled by the display); null: released */
      forceScale: (x: number | null) => c.forceScale(x),
      spectate: (on: boolean) => c.spectate(on),
      /** the offline cache: ready(), stats(), clearTiles(), update(), waiting */
      pwa: c.pwa,
      /** the calendar's "now" for the scenes of the real time (the station, the fleet): fixed by tests */
      setDate: setDateNow,
      /** the ground's height above a body's mean radius at latitude, east longitude [°] — the relief the
       *  craft stands on (the Earth's: its tiles, once in) [m] */
      relief: (body: string, lat: number, lon: number) => groundRelief(body, bodyFixedOf(body, lat, lon, 0)),
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
