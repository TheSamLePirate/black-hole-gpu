import { poseData } from "./cockpit/controls";
import { GEARS } from "./gear";
import { ControlTravel, controlStates } from "./cockpit/state";
import { cockpitAct, controlTip, type CockpitDeps } from "./cockpit/actions";
import { Chrono } from "./cockpit/chrono";
import { CockpitInput } from "./cockpit/input";
import { cockpitTarget } from "./cockpit/pointer";
import { CockpitTip } from "./ui/cockpit-tip";
import { cockpitHull } from "./system/collide";
import { prefetchSkyAssets, Renderer, type FrameStats } from "./renderer";
import { swappable } from "./util/swappable";
import { downloadGpuDiagnostic, globalErrorRouter, gpuDiagnostics } from "./gpu-diagnostics";
import { horizon, isco } from "./physics";
import { cameraFrame, repPose, setHolePose, setHomePose, switchAnchor } from "./camera";
import { bodyView, earthGround, earthStart, ourState, referenceBody, saturnDeparture, tiltAway } from "./system/our-side";
import { toBodyFixed } from "./system/our-surface";
import { theirFlightPose, theirGroundPose, theirOrbitPose, universeOf } from "./game/place";
import { CameraController, isTyping } from "./controls";
import { effectiveBindings, freeCameraKeys } from "./input/bindings";
import { matchKey, type KeyAction } from "./input/keymap";
import { installBh } from "./automation";
import { installPwa } from "./pwa";
import { PauseMenu } from "./ui/pause";
import { ControlsScreen } from "./ui/controls-screen";
import { PadsScreen } from "./ui/pads-screen";
import { TitleScreen } from "./ui/title";
import { MissionSelect } from "./ui/missions";
import { PlacePanel } from "./ui/placepanel";
import { TimePanel } from "./ui/timepanel";
import { WeatherPanel } from "./ui/weatherpanel";
import { MetarFeed, nearestStation } from "./metar";
import { MISSIONS } from "./game/missions";
import { KeyHints } from "./ui/keyhints";
import { MenuPad } from "./ui/padnav";
import { RadialWheel, type WheelItem } from "./ui/wheel";
import { Tablet } from "./ui/tablet";
import { PhotoMode } from "./ui/photo";
import { readPrefs, writePrefs } from "./game/prefs";
import { events } from "./game/events";
import { phaseOf, phaseText, PhaseWatcher } from "./game/phase";
import { BODY_NAMES, bodyLook, craftRadius, onOurSide, type Body } from "./targeting";
import { HidPads } from "./gamepad";
import { MOUNT_KEYS, MOUNTS, setMountVessel, shipToCamera, type Mount } from "./mounts";
import { fleet, fleetSpinStart, fleetStart } from "./fleet";
import { recorder } from "./game/recorder";
import { shownSpeed } from "./ui/hud/model";
import { CockpitScreens, tabAt } from "./ui/cockpitscreens";
import { VESSELS } from "./vessels";
import { FlightHud } from "./ui/flighthud";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "./pilot";
import { Mission } from "./mission";
import { physicalReadouts } from "./readouts";
import {
  aimAngles,
  buildChart,
  chartOn,
  chartOptions,
  CONSTELLATIONS,
  horizonAt,
  lookOf,
  NAMED_STARS,
  pickChart,
  type ChartFrame,
} from "./skychart";
import { drawChartLabels } from "./ui/skylabels";
import { SkyPanel } from "./ui/skypanel";
import { defaultSettings, presets, QUALITY, settingKeys, type Settings, type Target } from "./settings";
import { SettingsPanel } from "./ui/panel";
import { SCHEMA, SCHEMA_BY_KEY } from "./ui/schema";
import { loadFromUrl } from "./urlstate";
import { setupRenderDialog } from "./renderdialog";
import { fmtDate, GameTools } from "./game/tools";
import { rangerStatus, type RangerStatus } from "./game/status";
import { GameToolsWindow, rangerView } from "./ui/gametools";
import { applyTuning } from "./game/tuning";
import { demotionEligible, dynamicResolutionOn, promotionEligible } from "./quality-policy";
import { adapterId, cappedRatio, demoted, promoted, rememberLevel } from "./tier";
import { cpuProf } from "./perf";
import { visibleTimeout } from "./util/visible-timeout";
import { gameLog } from "./game/log";
import { autosave, saveFromHash, type GameSave } from "./game/save";
import { CraftLost } from "./ui/craftlost";
import { FlightComputer } from "./ui/fc/computer";
import { sitesOf, SITES } from "./game/sites";
import { Splash } from "./ui/splash";
import { SceneGallery } from "./ui/scenes";
import { SoundDirector } from "./audio/director";
import { sound } from "./audio/engine";
import { Speech } from "./audio/voice";
import { synthesize } from "./audio/formant";
import { phonemes } from "./audio/g2p";
import { Subtitles } from "./ui/subtitles";
import { Callouts } from "./game/callouts";
import { Capcom } from "./game/capcom";
import { Music } from "./audio/music";
import { ScoreDirector } from "./audio/score";
import { Tars, type TarsMoment, type TarsState } from "./game/tars";
import { TarsPanel, type TarsPanelHost } from "./ui/tars-panel";
import { AGENT_MODELS, connect as orConnect, finishFromFragment, OpenRouter, openRouterKey } from "./ai/openrouter";
import { TarsOnline } from "./ai/tars-online";
import { TarsAgent, runOrders } from "./ai/tars-agent";
import { orderReply, parseOrders } from "./ai/offline-orders";
import { TarsMemory, TARS_MEMORY_KEY, type MemoryData } from "./ai/memory";
import type { Tool } from "./ai/agent";
import { gameTools, SCREENS } from "./ai/game-tools";
import { TarsDisplay } from "./ui/tars/display";
import { PushToTalk } from "./ai/listen";
import { Triggers, TARS_TRIGGERS_KEY, wakeText, type GameEvent, type Trigger } from "./ai/triggers";
import { Budget } from "./ai/budget";
import { runSubagents } from "./ai/subagents";
import { AttitudeSampler } from "./ai/telemetry";
import { complete, MODES, parseCommand, TARS_MODE_KEY, TARS_SKILLS_KEY, unmention, type Mode, type Skill } from "./ai/commands";
import { runCommand } from "./ai/tars-commands";
import { closeTop } from "./ui/keys";
import { RUNWAY_DH } from "./game/procedures";
import { Simulation } from "./sim";
import { TransportBar } from "./ui/transport";
import { Take, type TakeState } from "./take";
import { BODY_COLOURS, CameraPanel, fmtHeight, VIEW_HELP, VIEW_LABEL, VIEWS, type View } from "./ui/camerapanel";
import { defaultAltKm, ourMouthPose, ourOrbitPose } from "./game/place";
import { solarBody, M_METRES } from "./system/solar";
import { C_MPS, M_SECONDS } from "./units";
import { mouth, setSceneTime } from "./wormhole";
import { fmtWarp, realTimeSpeed, stepWarp, warpLadder } from "./clock";
import { loading } from "./loading";
import { preventPageZoom } from "./ui/nozoom";
import { watchMobile } from "./ui/mobile";
import { TouchFlight } from "./ui/touchflight";
import { ViewOverlay } from "./ui/overlay";
import { gameTimeOf, issAxes, issStart, issTrack } from "./system/iss";
import { loadEphemerides } from "./system/de440";
import { ephemerisUrls, JOVIAN } from "./system/ephemeris-files";
import { store } from "./util/storage";
import { caught, DEV, DEV_TOOLS } from "./debug";
import { advanceFrameClock, frameNow } from "./frameclock";
import { dateNow } from "./util/now";
import { KerrBench } from "./bench/runner";
import { installVramHook } from "./bench/vram";
import { BenchScreen } from "./ui/bench";
import { setSteady } from "./ui/clock";
import { applyPalette } from "./ui/hudkit";
import { lang, t, tf, tr } from "./i18n";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
preventPageZoom();
watchMobile();
const overlay = $<HTMLCanvasElement>("overlay");
const errorEl = $("error");

// (the player's own settings as they left them — game/prefs.ts —, then a link's; the benchmark measures
// from the defaults)
const settings: Settings = sanitize({
  ...defaultSettings(),
  ...(/[#&]bench\b/.test(location.hash) ? {} : readPrefs()),
  ...loadFromUrl(defaultSettings()),
});

/** Replaces invalid enum values (e.g. from a hand-edited URL) by their defaults. */
function sanitize(s: Settings): Settings {
  const d = defaultSettings();
  const rec = s as unknown as Record<string, unknown>;
  for (const def of SCHEMA) {
    if (def.type === "choice" && !def.options.some((o) => o.value === rec[def.key])) rec[def.key] = d[def.key];
    if (def.type === "number" && typeof rec[def.key] === "number" && !Number.isFinite(rec[def.key] as number)) rec[def.key] = d[def.key];
    if (def.type === "color" && !/^#[0-9a-f]{6}$/i.test(String(rec[def.key]))) rec[def.key] = d[def.key];
  }
  if (!(s.quality in QUALITY)) s.quality = d.quality;
  return s;
}
/** The flight laws, as said when chosen. */
const FLIGHT_MODE_HELP: Record<Settings["flightMode"], string> = {
  rocket: t("a rocket — the stick turns it, the throttle pushes along the nose"),
  plane: t("a plane — the control surfaces; let go, the flight path is held (F: next)"),
  sf: t("the flight computer — the stick and throttle set the way and the speed, it flies them (⇧F: antigravity)"),
};

/** What survives a change of scene: the player's own and what they left carried (settings.ts SETTING_KIND). */
const KEEP_ON_PRESET = settingKeys("pref", "carried");

let changed = true; // scene (camera / parameters) changed since the last rendered frame
let displayChanged = true;
/** the transport bar (ui/transport.ts), once built */
let transport: TransportBar | null = null;

let firstFrame = false;
/** when the first image was on screen [performance.now() ms] */
let firstFrameAt: number | null = null;
/** the Kerr Bench's page (…/#bench): its GPU memory counted from the first allocation */
const benchPage = /[#&]bench\b/.test(location.hash);
if (benchPage) installVramHook();

/**
 * A row that overflows sideways scrolls with a plain (vertical) mouse wheel too — Windows mice have
 * no horizontal wheel, and a hidden scroll bar leaves no other way.
 */
function wheelScrollsSideways(el: HTMLElement) {
  const edges = () => {
    el.classList.toggle("more-l", el.scrollLeft > 1);
    el.classList.toggle("more-r", el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };
  el.addEventListener("scroll", edges, { passive: true });
  new ResizeObserver(edges).observe(el);
  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth + 1) return;
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY * k;
      if (el.scrollLeft !== before) e.preventDefault();
    },
    { passive: false },
  );
}

function fail(msg: string) {
  document.getElementById("loading")?.remove();
  errorEl.hidden = false;
  errorEl.textContent = msg;
  const diagnostic = document.createElement("button");
  diagnostic.textContent = t("Download graphics diagnostic");
  diagnostic.className = "error-reload";
  diagnostic.onclick = downloadGpuDiagnostic;
  const reload = document.createElement("button");
  reload.textContent = t("Reload");
  reload.className = "error-reload";
  reload.onclick = () => location.reload();
  errorEl.append(document.createElement("br"), diagnostic, reload);
}

async function main() {
  let appVersion = "dev";
  void fetch("version.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((v: { sha?: string } | null) => {
      if (v?.sha) appVersion = v.sha;
      gpuDiagnostics.setContext({ revision: appVersion });
    })
    .catch(() => {});
  gpuDiagnostics.setContext({
    browser: navigator.userAgent,
    secureContext: window.isSecureContext,
    webgpuAvailable: !!navigator.gpu,
    screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio },
  });
  let startupFailed = false;
  // (no first image after 180 s of the page seen — a hidden tab does not count: said, and noted in the
  // diagnostic, but the start goes on: a slow driver's compile (minutes on D3D12) cut short is never
  // cached, every reload starting it over. After 15 min: a diagnostic rather than an endless splash)
  const cancelSlow = visibleTimeout(180_000, () => {
    if (firstFrame || startupFailed) return;
    gpuDiagnostics.record("first-image-slow", `No first image after 180 s (${gpuDiagnostics.stage}): still waiting`);
    splash.slowStart();
  });
  const cancelHang = visibleTimeout(900_000, () => {
    if (firstFrame || startupFailed) return;
    startupFailed = true;
    const message = tf(
      "No first image after 15 min. Last graphics stage: {0}. The browser did not provide a precise cause.",
      gpuDiagnostics.stage,
    );
    gpuDiagnostics.record("first-image-timeout", message, true);
    fail(message);
  });
  const cancelWatchdog = () => (cancelSlow(), cancelHang());
  const reportFatal = (kind: string, error: unknown) => {
    startupFailed = true;
    cancelWatchdog();
    gpuDiagnostics.record(kind, error, true);
    fail(error instanceof Error ? error.message : String(error));
  };
  const globalError = globalErrorRouter({
    started: () => firstFrame,
    fatal: reportFatal,
    record: (kind, error) => gpuDiagnostics.record(kind, error),
    notify: () => {
      try {
        panel.toast(t("An unexpected error was recorded — the flight goes on (Pause › Download graphics diagnostic)"));
      } catch {
        /* (before the panel exists: the diagnostic has it) */
      }
    },
  });
  window.addEventListener("error", (event) => globalError("javascript-error", event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => globalError("unhandled-rejection", event.reason));
  const splash = new Splash($("loading") ?? document.createElement("div"));
  // (the HUD's and the overlays' fonts — fonts.css — loaded while the GPU starts: a canvas draws in
  // whatever is there at its first frame, and keeps it until redrawn)
  const fonts = Promise.all(
    [`600 12px Rajdhani`, `700 12px Rajdhani`, `500 12px "JetBrains Mono"`, `500 12px Inter`].map((f) => document.fonts.load(f)),
  ).catch(() => {});
  // the solar system's ephemerides and the sky's assets: downloading while the shaders compile, not
  // after them (plan §2.1-C). DE440 (3.3 MB) always, before the scene is placed; JUP365 (Jupiter's centre
  // and moons, 2040–2100: 4.1 MB) only where it may matter — a scene about Jupiter, a save (its place not
  // known here) —, else after the first image: at 20 Mbit/s it held every scene's first image back
  // (PLAN-MONDE M3)
  const ephemerisFetch = (u: string) =>
    loading.fetch(u, "ephemeris").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${u}: ${r.status}`))));
  const startScene = new URLSearchParams(location.hash.slice(1)).get("scene");
  const jovianFirst =
    /[#&]save=/.test(location.hash) ||
    (startScene ? !presets[startScene] || JOVIAN.test(JSON.stringify(presets[startScene])) : !!autosave.get());
  loading.stage("ephemeris", t("The solar system — NASA/JPL ephemerides (DE440)"), { weight: 2 });
  const ephemerides = loading.track("ephemeris", "", loadEphemerides(ephemerisUrls(jovianFirst ? ["de", "jup"] : ["de"]), ephemerisFetch));
  loading.stage("sky", t("Milky Way — the Gaia DR2 map"), { weight: 2 });
  loading.stage("stars", t("Stars — the Hipparcos & HYG catalogue"), { weight: 2 });
  prefetchSkyAssets((u, id) => loading.fetch(u, id));
  // (the renderer behind a handle: rebuilt on a new device after a loss, the page, the simulation and the
  // overlays keeping the handle they were given — PLAN-MONDE M2)
  let renderer: Renderer;
  let rendererSlot: ReturnType<typeof swappable<Renderer>>;
  try {
    rendererSlot = swappable(await Renderer.create(canvas));
    renderer = rendererSlot.proxy;
  } catch (e) {
    startupFailed = true;
    cancelWatchdog();
    gpuDiagnostics.record("startup-failure", e, true);
    fail(`${(e as Error).message}\n\n${t("Use a WebGPU-capable browser (Chrome/Edge 113+, Safari 26+, Firefox 141+).")}`);
    return;
  }
  if (startupFailed) return;
  gpuDiagnostics.setRuntime(() => ({
    adapter: renderer.adapter,
    tier: renderer.tier,
    quality: renderer.effectiveQuality(settings),
    pipelines: renderer.pipelineStatus,
    frames: renderer.frameTelemetry,
    gpuErrors: renderer.gpuErrors,
    lost: renderer.lost,
    canvas: { width: canvas.width, height: canvas.height },
    loading: loading.list(),
  }));

  // the device lost: the flight saved first, then the renderer made again on a new device — the flight
  // going on where it was (PLAN-MONDE M2); a third loss within a minute, or a device that will not come
  // back: the image frozen, a reload offered
  let recovering = false;
  const losses: number[] = [];
  const recoverGpu = async (why: string) => {
    if (recovering) return;
    recovering = true;
    let saved = false;
    try {
      if (settings.autosave) saved = tools.autosaveNow();
    } catch (error) {
      gpuDiagnostics.record("autosave-after-device-loss", error);
    }
    gpuDiagnostics.record("autosave-after-device-loss", saved ? "saved" : "not saved");
    const now = performance.now();
    while (losses.length && now - losses[0]! > 60_000) losses.shift();
    losses.push(now);
    const giveUp = (reason: string) => {
      startupFailed = true;
      cancelWatchdog();
      fail(
        `${tf("The graphics device was reset ({0}). Reload the page to go on.", reason)}\n\n${t(saved ? "Your flight was saved." : "Your flight could not be saved automatically.")}`,
      );
      document.body.classList.add("gpu-lost");
    };
    if (losses.length > 2) {
      giveUp(why);
      return;
    }
    document.body.classList.add("gpu-recovering");
    try {
      panel.toast(tf("The graphics device was reset ({0}) — restarting it", why));
    } catch {
      /* (before the panel exists) */
    }
    try {
      const fresh = await Renderer.create(canvas);
      fresh.adopt(rendererSlot.current());
      rendererSlot.swap(fresh);
      // (what the page sent the old one once: the maps' GPU, the sky, the chart, the image's size)
      flightHud.mapGpu = renderer.mapGpuSource();
      void renderer
        .loadSky()
        .then(() => touch())
        .catch((e) => console.warn("Real sky unavailable, using the procedural sky:", e));
      chartKey = "";
      resize();
      touch();
      displayChanged = true;
      // (its compile's stages said again by the new renderer: the first image's closed on its first frame —
      // the splash closes it only once, at the start)
      const firstFrame = () =>
        renderer.firstFrameDoneAt > 0 || renderer.lost ? loading.done("pipelines") : requestAnimationFrame(firstFrame);
      firstFrame();
      gpuDiagnostics.record("device-recovered", why);
      panel.toast(t("Graphics device restored — the flight goes on"));
    } catch (error) {
      gpuDiagnostics.record("device-recovery-failed", error, true);
      giveUp(`${why}; ${(error as Error).message}`);
    } finally {
      document.body.classList.remove("gpu-recovering");
      recovering = false;
    }
  };
  renderer.onLost = (why) => void recoverGpu(why);
  // (no tracer could be compiled — the scene's nor the general one: the start has failed, said with the
  // compiler's message; after a recovery, the image is frozen and a reload offered)
  renderer.onTracerFailure = (error) => {
    if (startupFailed) return;
    if (!firstFrame) reportFatal("startup-failure", new Error(tf("The ray tracer's pipelines failed to compile: {0}", error.message)));
    else {
      startupFailed = true;
      gpuDiagnostics.record("tracer-failure", error, true);
      fail(tf("The ray tracer's pipelines failed to compile: {0}", error.message));
    }
  };
  renderer.onGpuError = (m) => {
    try {
      panel.toast(tf("GPU error: {0}", m.split("\n")[0]!.slice(0, 140)));
    } catch {
      /* (before the panel exists: the console has it) */
    }
  };
  const touch = () => (changed = true);
  renderer.onAssets = () => touch();
  const touchDisplay = () => (displayChanged = true);
  const skyLoading = renderer
    .loadSky()
    .then(() => touch())
    .catch((e) => console.warn("Real sky unavailable, using the procedural sky:", e));
  let guiDirty = false; // GUI widgets need refreshing (camera moved)
  let previousTarget = settings.target; // (the panel's target choice is applied through the camera)

  /** the camera panel (ui/camerapanel.ts), once built */
  let camPanel: CameraPanel | null = null;
  const camera = new CameraController(canvas, settings, () => {
    syncCameraButton();
    syncButtons();
    camPanel?.refresh();
    touch();
    guiDirty = true;
  });
  /** the scene's time and the step that moves everything (sim.ts: the live loop, the automation, the video) */
  const sim = new Simulation(settings, camera, renderer);
  /** the take recorder (take.ts): the live view recorded, rendered afterwards as a video */
  const take = new Take();

  // -------------------------------------------------------------------- settings panel
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await renderer.setBackgroundImage(file);
    settings.background = "image";
    refreshGui();
    touch();
  };

  /** The accessibility settings, applied: the interface's scale, the markers' palette, the motion. */
  function applyAccess() {
    document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
    const still = settings.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.body.classList.toggle("reduce-motion", still);
    setSteady(still);
    applyPalette(settings.hudPalette);
  }
  applyAccess();

  /** Routes a settings change to what it affects (re-trace, resolve only, resize, nothing). */
  function onSettingsChange(keys: (keyof Settings)[]) {
    if (keys.some((k) => k === "uiScale" || k === "hudPalette" || k === "reduceMotion")) applyAccess();
    let scene = false;
    let resized = false;
    if (keys.includes("anchor")) {
      // keep the view: re-express the camera around the chosen object (impossible: stay)
      const want = settings.anchor;
      settings.anchor = want === "hole" ? "wormhole" : "hole";
      switchAnchor(settings, want);
      camera.sync();
      refreshGui();
    }
    if (keys.includes("rotation")) camera.setRotation(settings.rotation);
    if (keys.includes("target")) {
      const want = settings.target;
      settings.target = previousTarget;
      if (!camera.selectTarget(want)) panel.toast(tf("{0} is not in this universe", BODY_NAMES[want]));
      refreshGui();
    }
    for (const k of keys) {
      const effect = SCHEMA_BY_KEY.get(k)?.effect ?? (k === "quality" ? "none" : "scene");
      if (effect === "scene") scene = true;
      else if (effect === "display") touchDisplay();
      else if (effect === "resize") resized = true;
      if (k === "distance" || k === "whL") camera.sync();
    }
    if (keys.some((k) => k.startsWith("sound") || k === "haptics")) audio.applyMix();
    // (the voices off: the line being said stopped — its subtitle stays its reading time)
    if (keys.includes("voice") && !settings.voice) voice.cut();
    if (keys.includes("subtitles") && !settings.subtitles) subtitles.hide();
    if (scene) touch();
    if (resized) resize();
    syncButtons();
    scheduleUrlSave();
  }

  /** the scene applied last (the panel and the gallery show it) */
  let currentScene: string | null = null;
  /** the scene's clock when it was applied [M] */
  let sceneStart = 0;
  const panel = new SettingsPanel($("panel"), {
    settings,
    defaults: defaultSettings,
    onChange: onSettingsChange,
    applyPreset: (name) => applyPreset(name),
    presetNames: Object.keys(presets),
    currentScene: () => currentScene,
    openScenes: (q) => scenes.open(q),
    loadImage: () => fileInput.click(),
    connectController: HidPads.supported ? () => connectController() : undefined,
    shareUrl: () => tools.shareLink(),
  });
  // the offline cache and the install (PLAN-MONDE M1): off on the dev server's hot reload
  const pwa = installPwa({ toast: (m) => panel.toast(m), dev: DEV && !/[?&]sw=1/.test(location.search) });
  const audio = new SoundDirector(settings);
  // the voices (PLAN-TARS T1): who speaks in what order, the system's speech, the subtitles, the radio heard
  // round mission control's lines
  const subtitles = new Subtitles();
  const callouts = new Callouts();
  // mission control (PLAN-TARS T3): Houston and the tower on the flight's moments, the light's delay from the
  // Earth (measured every 2 s), the blackout's static; the last landing's grade for its word
  const capcom = new Capcom();
  const capcomDue: { line: import("./audio/voice").VoiceLine; at: number }[] = [];
  let lastGrade: string | null = null;
  let lastReport: import("./game/report").FlightReport | null = null;
  let earthLight = { s: 0, at: -1e9 };
  let staticOn = false;
  // the score (PLAN-TARS T4): silence, but at the flight's great moments
  const score = new ScoreDirector();
  const music = new Music(() => sound.musicOut());
  // TARS (PLAN-TARS T5b): asked by F6, answering from the flight's state; his remarks unasked
  const tars = new Tars(Math.floor(Math.random() * 2 ** 31));
  let tarsView: TarsState | null = null;
  let tarsMoment: string | null = null;
  let tarsFuelLow = false;
  let tarsDocked = false;
  let tarsLook = performance.now();
  const tarsPersonality = () => ({ honesty: settings.tarsHonesty, humour: settings.tarsHumour });
  // (through OpenRouter — T6 —: the player's own key; his remarks decided by Jev; the model of the setting)
  const openRouter = new OpenRouter(undefined, undefined, () => settings.tarsModel);
  const tarsOnline = new TarsOnline(openRouter);
  let tarsBusy = false;
  const tarsNow = (): TarsState =>
    tarsView ?? {
      body: null,
      altKm: null,
      status: null,
      landed: false,
      docked: false,
      speed: null,
      fuel: null,
      dv: null,
      target: null,
      next: null,
      stage: null,
      auto: camera.pilot.auto,
      dtau: null,
    };
  const online = () => settings.tarsOnline && !!openRouterKey.get() && navigator.onLine !== false;
  // TARS the agent (PLAN-TARS-AGENT): the whole game as his tools (built once everything is declared, below),
  // his memory kept in this browser
  let tarsTools: Tool[] = [];
  const tarsMemory = new TarsMemory({
    get: () => store.getJSON<MemoryData | null>(TARS_MEMORY_KEY, null),
    set: (d) => store.setJSON(TARS_MEMORY_KEY, d),
    clear: () => store.remove(TARS_MEMORY_KEY),
  });
  // his wakings (PLAN-TARS-AGENT B1): his reflexes and his rules, kept with his memory; his budget an hour
  const tarsTriggers = new Triggers({
    get: () => store.getJSON<Trigger[] | null>(TARS_TRIGGERS_KEY, null),
    set: (t) => store.setJSON(TARS_TRIGGERS_KEY, t),
    clear: () => store.remove(TARS_TRIGGERS_KEY),
  });
  const tarsBudget = new Budget(() => settings.tarsBudget);
  // (his own channels — the attitude, the commands —, sampled twice a second while flying: his charts — B2)
  const tarsSampler = new AttitudeSampler();
  setInterval(() => camera.piloting && tarsSampler.sample(sim.time * 4.925490947e-6 * settings.massSolar, camera), 500);
  // his mode (C3) and the pilot's skills (C5), kept in this browser
  let tarsMode: Mode = (["act", "plan", "watch"] as const).find((m) => m === store.get(TARS_MODE_KEY)) ?? "act";
  const tarsSkills: Skill[] = store.getJSON<Skill[]>(TARS_SKILLS_KEY, []);
  const saveSkill = (name: string, description: string, prompt: string) => {
    const i = tarsSkills.findIndex((k) => k.name === name);
    const k = { name, description, prompt, at: Date.now() };
    if (i >= 0) tarsSkills[i] = k;
    else tarsSkills.push(k);
    store.setJSON(TARS_SKILLS_KEY, tarsSkills);
  };
  const tarsAgent = new TarsAgent({
    or: openRouter,
    mode: () => tarsMode,
    tools: () => tarsTools,
    memory: tarsMemory,
    personality: () => tarsPersonality(),
    lang: () => lang,
    flight: () => tarsNow(),
    say: (text) => voice.say({ text, speaker: "tars", priority: 2 }),
    onCall: (tool, args) => {
      tarsPanel.begin(tool, args);
      tarsPanel.setState("acting");
    },
    onAction: (result, ok, full, tool) => {
      tarsPanel.action(result, ok, full, tool);
      if (tarsBusy) tarsPanel.setState("thinking");
    },
    onBusy: (b) => {
      tarsBusy = b;
      tarsPanel.setState(b ? "thinking" : voice.queue.current?.speaker === "tars" ? "speaking" : "idle");
      tarsPanel.refresh();
    },
  });
  // what TARS shows (PLAN-TARS-AGENT A8): his cards over the view; the live ones redrawn a few times a second
  const tarsDisplay = new TarsDisplay();
  setInterval(() => tarsDisplay.count && tarsDisplay.update(performance.now()), 250);
  /** a plan he proposed, answered: accepted, he carries it out; refused, it is dropped */
  const tarsAnswer = (yes: boolean) => {
    const p = tarsAgent.pending;
    if (!p) return;
    tarsAgent.pending = null;
    tarsPanel.propose(null);
    if (yes) return tarsPanelAsk(TarsAgent.acceptance(p, lang), `✓ ${tr({ fr: "Plan accepté", en: "Plan accepted" })} : ${p.title}`);
    const text = tr({ fr: "Compris. Plan abandonné.", en: "Understood. Plan dropped." });
    tarsMemory.add({
      at: Date.now(),
      user: tr({ fr: `Je refuse le plan « ${p.title} ».`, en: `I refuse the plan "${p.title}".` }),
      tars: text,
    });
    tarsPanel.answer(text);
    voice.say({ text, speaker: "tars", priority: 2 });
  };
  // what TARS started — an autopilot, a plan — followed to its end, its live line on his console and
  // presence, its outcome said (PLAN-TARS-AGENT A7)
  let tarsFollow: { auto: string; at: number } | null = null;
  const tarsFollowStart = () => {
    const a = camera.pilot.auto;
    // (the same autopilot still flying: followed since it began)
    tarsFollow = a === "none" ? null : tarsFollow?.auto === a ? tarsFollow : { auto: a, at: performance.now() };
    if (tarsFollow) tarsPanel.setState("acting");
  };
  setInterval(() => {
    if (!tarsFollow || tarsBusy) return;
    const a = camera.pilot.auto;
    const st = tools.status();
    if (a !== "none") {
      const s = Math.round((performance.now() - tarsFollow.at) / 1000);
      tarsPanel.progress(
        `${AUTO_NAMES[a as Auto] ?? a} · ${st.soiName} · ${st.label} · ${st.altKm < 100 ? st.altKm.toFixed(2) : Math.round(st.altKm).toLocaleString("en")} km · ${Math.round(st.speed).toLocaleString("en")} m/s · ${s} s`,
      );
      if (tarsPanel.currentState === "idle") tarsPanel.setState("acting");
      return;
    }
    // (done: what came of it, in a word)
    tarsFollow = null;
    tarsPanel.progress(null);
    const said = camera.docked
      ? tr({ fr: "Amarrés.", en: "Docked." })
      : camera.landed
        ? tr({ fr: `Posés. ${st.soiName}.`, en: `Down. ${st.soiName}.` })
        : st.status === "orbit" && st.orbit
          ? tr({
              fr: `En orbite autour de ${st.soiName} : ${Math.round(st.orbit.peKm)} par ${Math.round(st.orbit.apKm)} km.`,
              en: `In orbit about ${st.soiName}: ${Math.round(st.orbit.peKm)} by ${Math.round(st.orbit.apKm)} km.`,
            })
          : tr({ fr: "Autopilote terminé.", en: "Autopilot done." });
    if (tarsPanel.currentState === "acting") tarsPanel.setState("idle");
    // (online, his reflex says it in his own words — B1)
    if (tarsWakesOn() && tarsTriggers.match({ kind: "autopilot", to: "none" }).length) return;
    tarsPanel.answer(said);
    voice.say({ text: said, speaker: "tars", priority: 2 });
  }, 1000);
  // his wakings (B1): the game's changes heard each second, the rules they wake, his timed rules; each waking
  // one turn of his own initiative — when online, the wakings on, his budget not spent, no turn running
  const tarsWakesOn = () => online() && settings.tarsWake;
  // (one waking per event, every rule it woke in it; a waking left waiting more than 90 s let go: stale)
  const tarsWakeQueue: { rules: Trigger[]; e: GameEvent | null; at: number }[] = [];
  const tarsEvent = (e: GameEvent) => {
    const rules = tarsTriggers.match(e);
    if (!rules.length) return;
    tarsWakeQueue.push({ rules, e, at: performance.now() });
    tarsWakeQueue.splice(0, Math.max(0, tarsWakeQueue.length - 6));
  };
  let tarsSeen: {
    auto: string;
    entry: string;
    hub: string;
    alerts: Set<string>;
    soi: string;
    landed: boolean;
    docked: boolean;
    off: string;
    papi: string;
  } | null = null;
  let tarsSpentSeen = 0;
  setInterval(() => {
    // (what OpenRouter cost since: the budget's)
    tarsBudget.add(openRouter.spent - tarsSpentSeen);
    tarsSpentSeen = openRouter.spent;
    if (!camera.piloting) return void (tarsSeen = null);
    const st = tools.status();
    // (what he follows — B4: the hub's card mirrored on his console)
    const hub = camera.hubInfo?.() ?? null;
    tarsPanel.follow(
      hub
        ? {
            title: hub.title,
            step: hub.phase,
            progress: hub.bar,
            rows: hub.rows as [string, string, string?][],
            next: hub.next,
            callout: hub.say?.length ? hub.say.join(" · ") : null,
            verdict: hub.graph?.state ?? null,
            fix: hub.graph?.fix,
          }
        : null,
    );
    const now = {
      auto: camera.pilot.auto,
      entry: camera.entryRun?.phase ?? "",
      hub: hub?.phase ?? "",
      alerts: new Set(flightHud.alerts.map((a) => `${a.level}:${a.id}`)),
      soi: st.soi,
      landed: camera.landed && !camera.rolling,
      docked: camera.docked,
      // (the deviations: the hub's graph out of its corridor, the entry out of its own, the approach's PAPI all
      // white or all red on final)
      off: hub?.graph?.state === "off" ? `${hub.graph.kind}` : camera.entryRun?.inCorr === false ? "entry" : "",
      papi: (() => {
        const r = camera.runwayView?.();
        return r?.final && (r.papi === 0 || r.papi === 4) ? (r.papi === 0 ? "low" : "high") : "";
      })(),
    };
    const was = tarsSeen;
    tarsSeen = now;
    if (was) {
      if (now.auto !== was.auto) tarsEvent({ kind: "autopilot", from: was.auto, to: now.auto });
      if (now.entry !== was.entry && now.entry) tarsEvent({ kind: "entry_phase", from: was.entry, to: now.entry });
      if (now.hub !== was.hub && now.hub) tarsEvent({ kind: "hub_step", from: was.hub, to: now.hub, detail: hub?.title });
      for (const a of now.alerts) if (!was.alerts.has(a)) tarsEvent({ kind: "alert", to: a.split(":")[0], detail: a.split(":")[1] });
      if (now.soi !== was.soi) tarsEvent({ kind: "soi", from: was.soi, to: now.soi });
      if (now.landed && !was.landed) tarsEvent({ kind: "landed", to: st.soi });
      if (now.docked && !was.docked) tarsEvent({ kind: "docked" });
      if (now.off && now.off !== was.off) tarsEvent({ kind: "deviation", to: now.off, detail: hub?.graph?.fix ?? hub?.graph?.about });
      if (now.papi && now.papi !== was.papi)
        tarsEvent({ kind: "deviation", to: "approach", detail: `PAPI ${now.papi === "low" ? "all red: too low" : "all white: too high"}` });
    }
    for (const r of tarsTriggers.due(sim.time * 4.925490947e-6 * settings.massSolar))
      if (!tarsWakeQueue.some((q) => q.rules.includes(r))) {
        // (fired as queued: not due again meanwhile)
        tarsTriggers.fired(r.id);
        tarsWakeQueue.push({ rules: [r], e: null, at: performance.now() });
      }
    while (tarsWakeQueue.length && performance.now() - tarsWakeQueue[0]!.at > 90_000) tarsWakeQueue.shift();
    tarsPanel.budget(
      tarsWakesOn() ? `${tarsBudget.lastHour().toFixed(3)} / ${settings.tarsBudget.toFixed(2)} $·h` : null,
      tarsBudget.why() === "budget",
    );
    if (!tarsWakeQueue.length || !tarsWakesOn() || tarsAgent.busy || !tarsBudget.canWake()) return;
    const { rules, e } = tarsWakeQueue.shift()!;
    if (e) for (const r of rules) tarsTriggers.fired(r.id);
    tarsBudget.woke();
    void tarsWakeTurn(rules, e);
  }, 1000);
  /** A turn of his own initiative: shown as such, said unless he chose silence ("—"). */
  async function tarsWakeTurn(rules: Trigger[], e: GameEvent | null) {
    const r = rules[0]!;
    const label = `⚡ ${rules.every((x) => x.reflex) ? tr({ fr: "Réflexe", en: "Reflex" }) : tr({ fr: "Réveil", en: "Waking" })} · ${e ? `${e.kind}${e.to ? ` → ${e.to}` : ""}` : r.on.kind}`;
    tarsPanel.exchange(wakeText(rules, e), label);
    const a = await tarsAgent.ask(wakeText(rules, e));
    if (!a || a.trim() === "—" || a.trim() === "-") return tarsPanel.answer("—");
    tarsPanel.answer(a);
    voice.say({ text: a, speaker: "tars", priority: 3, ttl: 30_000 });
    tarsFollowStart();
  }
  const tarsPanelAsk = (q: string, shown?: string) => void tarsAsk(q, shown);
  const tarsPanelHost: TarsPanelHost = {
    ask: (q) => tarsPanelAsk(q),
    complete: (input) =>
      complete(input, {
        lang,
        models: AGENT_MODELS.map((m) => ({ id: m.id, name: m.name })),
        screens: SCREENS,
        bodies: tools.targets().map((id) => ({ id, name: (BODY_NAMES as Record<string, string>)[id] ?? id })),
        sites: SITES.map((x) => ({ name: x.name, body: x.body })),
        settings: SCHEMA.map((d) => ({ key: d.key, label: t(d.label) })),
        notes: tarsMemory.notes,
        skills: tarsSkills,
      }),
    mode: () => tarsMode,
    cycleMode: () => {
      tarsMode = MODES[(MODES.indexOf(tarsMode) + 1) % MODES.length]!;
      store.set(TARS_MODE_KEY, tarsMode);
    },
    link: () => ({
      hint: openRouterKey.hint(),
      online: settings.tarsOnline,
      spent: openRouter.spent,
      busy: tarsBusy,
      model: AGENT_MODELS.find((m) => m.id === settings.tarsModel)?.name ?? settings.tarsModel,
    }),
    connect: () =>
      void orConnect().then((k) => {
        tarsPanel.refresh(k ? t("Connected: TARS speaks through OpenRouter.") : t("Not connected."));
        if (k) voice.say({ text: t("Connected. I'm told I'll be smarter now. We'll see."), speaker: "tars", priority: 2 });
      }),
    paste: (k) => openRouterKey.set(k),
    disconnect: () => openRouterKey.clear(),
    memory: () => ({ turns: tarsMemory.turns.length, notes: tarsMemory.notes.length }),
    clearMemory: () => {
      tarsMemory.clear();
      tarsTriggers.clear();
    },
    wakes: () => ({
      rules: tarsTriggers.list().map((r) => ({
        id: r.id,
        kind: r.on.kind,
        to: r.on.to,
        minutes: r.on.minutes,
        prompt: r.prompt,
        enabled: r.enabled,
        reflex: r.reflex,
        fired: r.fired,
        firedAt: r.firedAt,
      })),
      on: settings.tarsWake,
      spent: tarsBudget.lastHour(),
      perHour: settings.tarsBudget,
      why: tarsBudget.why(),
    }),
    wakeToggle: (id, on) => void tarsTriggers.enable(id, on),
    wakeRemove: (id) => void tarsTriggers.remove(id),
    wakeAll: (on) => {
      settings.tarsWake = on;
      onSettingsChange(["tarsWake"]);
      refreshGui();
    },
    memoryContents: () => ({ notes: tarsMemory.notes, summary: tarsMemory.summary, turns: tarsMemory.turns }),
    forget: (note) => void tarsMemory.forget(note),
    stop: () => tarsAgent.stop(),
    talk: PushToTalk.supported ? () => (tarsTalk.listening ? tarsTalk.stop() : tarsTalk.start()) : null,
    talkKey: (e) => tarsKey(e),
  };
  const tarsPanel = new TarsPanel(tarsPanelHost);
  /** A question to TARS (typed, or spoken): the agent online; offline the orders, else his written answers. */
  async function tarsAsk(q: string, shown?: string) {
    // (the words "stop": the turn running stopped, nothing else)
    if (tarsAgent.busy && TarsAgent.isStop(q)) {
      tarsAgent.stop();
      return;
    }
    // (a plan proposed: "yes" carries it out, "no" drops it — anything else is a new question)
    if (tarsAgent.pending && (TarsAgent.isYes(q) || TarsAgent.isNo(q))) return tarsAnswer(TarsAgent.isYes(q));
    // (a "/" command, or one of the pilot's skills — C1, C5)
    const cmd = parseCommand(q, tarsSkills);
    if (cmd) return tarsCommand(cmd, q);
    if (q.startsWith("/")) {
      tarsPanel.exchange(q);
      return tarsPanel.answer(tr({ fr: "Commande inconnue — /help les liste.", en: "Unknown command — /help lists them." }));
    }
    // (the @mentions made plain for him — C2; shown as typed)
    shown ??= q;
    q = unmention(q);
    if (!q.startsWith("[")) tarsLastAsked = q;
    tarsPanel.exchange(q, shown);
    const st = tarsNow();
    const r = tars.answer(q, st, tarsPersonality());
    // (his settings said aloud: his own, at once — not the model's to decide)
    if (r.set) {
      if (r.set.honesty !== undefined) settings.tarsHonesty = r.set.honesty;
      if (r.set.humour !== undefined) settings.tarsHumour = r.set.humour;
      onSettingsChange(["tarsHonesty", "tarsHumour"]);
      refreshGui();
      tarsPanel.exchange(q, shown);
      tarsPanel.answer(r.text);
      voice.say({ text: r.text, speaker: "tars", priority: 2 });
      return;
    }
    let text: string | null = null;
    if (online()) {
      const a = await tarsAgent.ask(q);
      // ("": stopped — nothing to say; null: the model failed — the orders understood offline, his written line)
      if (a === "") return;
      text = a;
    }
    if (text === null) {
      // (offline: the common orders run by the same tools — PLAN-TARS-AGENT A4)
      const orders = parseOrders(q);
      if (orders.length) {
        const done = await runOrders(
          orders,
          tarsTools,
          (result, ok, full, tool) => tarsPanel.action(result, ok, full, tool),
          (tool, args) => tarsPanel.begin(tool, args),
        );
        text = orderReply(lang, done);
        tarsMemory.add({ at: Date.now(), user: q, tars: text, did: done.map((d) => `${d.tool} → ${d.ok ? "done" : d.error}`) });
      }
    }
    refreshGui();
    tarsPanel.answer(text ?? r.text);
    voice.say({ text: text ?? r.text, speaker: "tars", priority: 2 });
    // (an autopilot he engaged, or a plan: followed to its end)
    tarsFollowStart();
  }
  // the "/" commands (C1, C5: ai/tars-commands.ts)
  let tarsLastAsked = "";
  const tarsCommand = (c: { name: string; arg: string; skill?: Skill }, typed: string) => {
    tarsPanel.exchange(typed);
    void runCommand(
      {
        lang: () => lang,
        settings,
        camera,
        tools,
        or: openRouter,
        memory: tarsMemory,
        agentTools: () => tarsTools,
        skills: tarsSkills,
        saveSkills: () => store.setJSON(TARS_SKILLS_KEY, tarsSkills),
        lastAsked: () => tarsLastAsked,
        mode: () => tarsMode,
        setMode: (m) => {
          tarsMode = m;
          store.set(TARS_MODE_KEY, m);
          tarsPanel.syncMode();
        },
        budget: tarsBudget,
        changed: (keys) => {
          onSettingsChange(keys);
          refreshGui();
        },
        say: (text) => tarsPanel.answer(text),
        card: (title, rows, note) => tarsDisplay.show({ kind: "data", title, rows, note }),
        ask: (q, shown) => tarsPanelAsk(q, shown),
        stop: () => tarsAgent.stop(),
        tab: (x) => tarsPanel.setTab(x),
        history: () => tarsPanel.drawHistory(),
        dock: () => tarsPanel.setLook({ dock: true } as never),
        connect: () => tarsPanelHost.connect(),
        pasteKey: () => tarsPanel.pasteMode(),
        refresh: () => tarsPanel.refresh(),
      },
      c,
      typed,
    ).catch((e) => tarsPanel.answer(e instanceof Error ? e.message : String(e)));
  };
  // (his emblem moves with his voice: the robot's own measured on the voice bus; a system voice's guessed)
  tarsPanel.levels(
    () => {
      if (tarsPanel.currentState !== "speaking" || lang !== "en" || !settings.voice) return null;
      const db = sound.busLevels().voice ?? -Infinity;
      return Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 52) / 36)) : 0;
    },
    () => settings.reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // speaking to TARS (PLAN-TARS-AGENT A5): his key held listens, released sends; a tap is his field
  const tarsTalk = new PushToTalk({
    lang: () => lang,
    hearing: (text) => tarsPanel.hearing(text),
    heard: (text) => {
      if (!text) return tarsPanel.refresh(t("Nothing heard."));
      tarsPanel.hearing("");
      tarsPanelAsk(text);
    },
    failed: (why) =>
      tarsPanel.refresh(
        why === "denied"
          ? t("The microphone is not allowed (the browser's site settings).")
          : why === "network"
            ? t("Speech recognition needs the network.")
            : why === "none"
              ? t("Nothing heard.")
              : t("Speech recognition failed."),
      ),
    state: (on) => {
      tarsPanel.listening(on);
      tarsPanel.setState(on ? "listening" : tarsBusy ? "thinking" : "idle");
    },
  });
  /** his key (F6, or as bound) pressed: held, it listens; tapped, his field */
  function tarsKey(e: KeyboardEvent) {
    // (a controller's button — no key up to wait for —, or no recognition here: the field)
    if (!e.code || !PushToTalk.supported) return tarsPanel.toggle();
    if (e.repeat) return;
    tarsTalk.down();
    const code = e.code;
    const up = (u: KeyboardEvent) => {
      if (u.code !== code) return;
      removeEventListener("keyup", up, true);
      if (tarsTalk.up()) tarsPanel.toggle();
    };
    addEventListener("keyup", up, true);
  }
  // (a phone's way back from OpenRouter's sign-in: the code in the fragment)
  void finishFromFragment().then((k) => k && panel.toast(t("Connected: TARS speaks through OpenRouter.")));
  const voice = new Speech({
    lang: () => lang,
    volume: () => settings.soundVoice * settings.soundVolume,
    // (a test's page — ?e2e= —: silent, its lines timed and subtitled as without voices: a suite on a machine
    // with speakers does not talk through it)
    enabled: () => settings.voice && !/[?&]e2e=/.test(location.search),
    onStart: (l) => {
      // (his words already on his console when it is open: not subtitled twice)
      subtitles.show(l, settings.subtitles && !(l.speaker === "tars" && tarsPanel.open));
      if (l.speaker === "tars") tarsPanel.setState("speaking");
      if (l.radio && settings.sound) sound.radio(true);
    },
    onEnd: (l) => {
      subtitles.end(l);
      if (l.speaker === "tars" && tarsPanel.currentState === "speaking")
        tarsPanel.setState(tarsBusy ? "thinking" : tarsFollow ? "acting" : "idle");
      if (l.radio && settings.sound) sound.radio(false);
    },
    // (TARS in English: his own robot voice, synthesized here — PLAN-TARS T5a; in French the system's, the
    // owner's choice: the home-made French was not understood)
    robot: (l) =>
      l.speaker === "tars" && lang === "en" && settings.voice
        ? sound.playRobot(synthesize(phonemes(l.text)), 22050, settings.shipMount === "cockpit" || settings.shipMount === "cabin")
        : null,
    stopRobot: () => sound.stopRobot(),
  });
  const scenes = new SceneGallery({ names: Object.keys(presets), apply: (name) => panel.applyScene(name), current: () => currentScene });
  panel.holdToasts = splash.gone.then(() => void (panel.holdToasts = null));
  const refreshGui = () => {
    panel.refresh();
    syncButtons();
  };

  /**
   * A scene's look turned onto a body as the camera sees it (its mount and the aberration whatever they
   * are): a few frames of correction — the body's bearing and elevation in the image taken off the look
   * — then the scene's offset [yaw, pitch]° added (the ship keeps its attitude).
   */
  async function aimAt(id: string | null, off: [number, number]) {
    const deg = 180 / Math.PI;
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    await frame();
    // (the camera's frame and the body's place are computed, not rendered: no frame to wait for)
    for (let i = 0; id && i < 12; i++) {
      const cam = cameraFrame(settings);
      const L = bodyLook(settings, cam, id as Body, sim.time).look;
      const b = Math.atan2(dot(L, cam.right), dot(L, cam.fwd)) * deg;
      const e = Math.asin(Math.max(-1, Math.min(1, dot(L, cam.up)))) * deg;
      camera.setLook(settings.shipLookYaw + b, settings.shipLookPitch + e);
      if (Math.abs(b) < 0.005 && Math.abs(e) < 0.005) break;
    }
    camera.setLook(settings.shipLookYaw + off[0], settings.shipLookPitch + off[1]);
  }

  // (a preset exposed for our side — sunlit Saturn, ~21 EV above the disk — does not pass its exposure on)
  let exposedForOurSide = false;
  function applyPreset(name: string) {
    currentScene = presets[name] ? name : null;
    if (camera.spectating) setSpectator(false);
    renderer.resetTemporal(); // (another scene: no history carried into it)
    const { time, mission: withMission, pose, issDistance, issOffset, ...preset } = presets[name] ?? {};
    const kept = exposedForOurSide ? KEEP_ON_PRESET.filter((k) => k !== "exposure" && k !== "bgIntensity") : KEEP_ON_PRESET;
    const keep = Object.fromEntries(kept.map((k) => [k, settings[k]]));
    exposedForOurSide = pose !== undefined;
    mission.stop();
    // (a scene without the ship: the view is placed, not falling)
    if (!(preset.ship ?? settings.ship) && (camera.piloting || camera.gravity)) camera.setPilot(false);
    Object.assign(settings, defaultSettings(), keep, preset);
    // (the craft the scene flies: its attach points — fleetStart below places the others)
    fleet.active = settings.vessel;
    setMountVessel(settings.vessel);
    camera.settleMount();
    camera.newFlight();
    // (the last scene's voices let go, its callouts armed again)
    voice.stop();
    callouts.reset();
    capcom.reset();
    capcomDue.length = 0;
    score.reset();
    music.stop();
    lastGrade = null;
    camera.setOurLanded(null);
    if (typeof pose === "object" && universeOf(pose.body ?? "earth") === "gargantua" && pose.altKm === undefined) {
      // on the ground of one of Gargantua's worlds, Gargantua above the horizon: the nose level towards
      // it, the look raised to it (as the map has it: its light bent, the ship's speed, move it on the sky)
      const el = pose.holeEl ?? 20;
      const p = theirGroundPose(pose.body!, el, pose.holeAz ?? 0, time ?? sim.time, settings.spin, settings.massSolar);
      settings.shipLookYaw = settings.shipLookPitch = 0;
      setHolePose(settings, p.X, p.fwd, p.up, p.vel);
      settings.motion = "geodesic";
      const off = pose.off ?? [0, 0];
      void aimAt(null, [off[0], off[1] + el]);
    } else if (typeof pose === "object" && universeOf(pose.body ?? "earth") === "gargantua") {
      // a view of one of Gargantua's worlds: on an orbit about it, looking straight down, the way it
      // goes at the top of the image, then the look turned off it
      const at = { body: pose.body!, altKm: pose.altKm, nu: pose.nu, inc: pose.inc };
      settings.shipLookYaw = settings.shipLookPitch = 0;
      const off = pose.off ?? [0, 0];
      // (the ship flown, low in a world's air: in level flight there — an orbit's speed in the air broke
      // it up at once —, the look turned to the same view: off the nadir by the tilt, then by off)
      const fly = settings.ship ? theirFlightPose(at, time ?? sim.time, settings.spin, settings.massSolar) : null;
      if (fly) {
        setHolePose(settings, fly.X, fly.fwd, fly.up, fly.vel);
        settings.motion = "geodesic";
        void aimAt(null, [off[0], off[1] + (pose.tilt ?? 0) - 90]);
      } else {
        const p = theirOrbitPose(at, time ?? sim.time, settings.spin, settings.massSolar);
        const [fwd, up] = tiltAway([-p.up[0], -p.up[1], -p.up[2]], p.fwd, pose.tilt ?? 0);
        setHolePose(settings, p.X, fwd, up, p.vel);
        settings.motion = "geodesic";
        void aimAt(null, [off[0], off[1] + (pose.tilt ?? 0)]);
      }
    } else if (typeof pose === "object") {
      // a view of one of our bodies: placed, the look turned towards a body
      // (the camera placed along the ship's axes — the ship's attitude is the camera's less the look —
      // then the look turned)
      const v = bodyView(time ?? sim.time, pose);
      settings.shipLookYaw = settings.shipLookPitch = 0;
      setHomePose(settings, v.X, v.fwd, v.up, v.vel);
      settings.motion = "geodesic";
      camera.setOurLanded(v.landed ?? null);
      // (on the ground without the ship: the camera on its tripod there — the rotation a scene keeps,
      // "around" by default, circled the target: the Sun, the Earth left behind at 30 km/s)
      if (v.landed && !settings.ship && settings.rotation !== "tripod") {
        settings.rotation = "tripod";
        camera.setRotation("tripod");
      }
      void aimAt(pose.look ?? null, pose.off ?? [0, 0]);
    } else if (pose) {
      // (the station: at the real time now, unless the scene has its own)
      const now = pose === "iss" || pose === "fleet" || pose === "fleetSpin";
      const t = time ?? (now ? gameTimeOf(dateNow()) : sim.time);
      if (now && time === undefined) sim.setTime(t);
      const d =
        pose === "earthGround"
          ? earthGround(t)
          : pose === "iss"
            ? (issStart(t, issDistance, issOffset) ?? earthStart(t, 400))
            : pose === "earth" || pose === "earthMoon" || pose === "fleet" || pose === "fleetSpin"
              ? earthStart(t, 400, pose === "earthMoon")
              : saturnDeparture(t);
      setHomePose(settings, d.X, d.fwd, d.up, d.vel);
      settings.motion = "geodesic";
      camera.setOurLanded(pose === "earthGround" ? (d as ReturnType<typeof earthGround>).landed : null);
    }
    if (time !== undefined) sim.setTime(time);
    camera.setCinematic(null);
    camera.sync();
    if (settings.ship) camera.setPilot(true); // the Ranger starts afresh (on a circular orbit near the hole)
    // the fleet near the Earth (fleet.ts): the Endurance 800 km up, the Lander 500 km up; the craft flown
    // where the scene puts it — or, "fleet", where the fleet's start has it
    setMountVessel(settings.vessel);
    const starts = pose === "fleetSpin" ? fleetSpinStart(sim.time) : fleetStart(sim.time, settings.vessel);
    if ((pose === "fleet" || pose === "fleetSpin") && settings.ship) camera.flyFrom(starts[settings.vessel]);
    if (pose === "iss" && settings.ship) {
      // (the station's start gives the ship's own axes — its nose to the port's axis — not the view's:
      // the camera then where its mount is)
      const p = repPose(settings);
      camera.placeShipRep(p.l, p.n, p.vel, p.fwd, p.up);
    }

    if (withMission) mission.start();
    if (name === "game:artemis") {
      panel.toast(
        t("Artemis II · 400 km above the Earth, the Moon targeted. O: the planner → Free return → PLAN → EXECUTE (map M: the path)"),
      );
    }
    if (pose === "fleetSpin") {
      panel.toast(
        t(
          "The Endurance tumbles at 3 rpm, 300 km up: match its turn and dock to its hub (B: auto-dock) · then stop the turn (SAS) · then fly the Endurance ([ ]) up to a 400 km orbit",
        ),
      );
    }
    if (name === "game:interstellar") {
      panel.toast(
        t(
          "2067 · Kennedy Space Center. U: take off to orbit · then Saturn — the wormhole waits 0.7 AU behind it (map M, a click: target · 0: approach)",
        ),
      );
    }
    // (the scene's own start: the time panel's "start of the scene")
    sceneStart = sim.time;
    refreshGui();
    touch();
    touchDisplay();
    scheduleUrlSave();
  }

  // -------------------------------------------------------------------- toolbar & keys
  const toggleUi = () => {
    // (hidden: nothing on screen says how to come back — a word, before it goes)
    if (!document.body.classList.contains("hide-ui")) panel.toast(t("H: the interface back"));
    document.body.classList.toggle("hide-ui");
  };
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  const toggle = (key: "animate" | "shadowGuide" | "jet" | "cinematic" | "ship") => {
    settings[key] = !settings[key];
    refreshGui();
    if (key !== "shadowGuide") touch();
    syncButtons();
    scheduleUrlSave();
  };
  const actions: Record<string, () => void> = {
    "btn-tools": () => DEV_TOOLS && toolsWin.toggle(),
    "btn-scenes": () => scenes.toggle(),
    "btn-sound": () => toggleSound(),
    "btn-camera": () => {
      camPanel!.toggle();
      syncCameraButton();
    },
    "btn-guide": () => toggle("shadowGuide"),
    "btn-sky": () => {
      skyPanel.toggle();
      syncButtons();
    },
    "btn-jet": () => toggle("jet"),
    "btn-ship": () => {
      toggle("ship");
      panel.toast(settings.ship ? tf("Ranger: {0}", MOUNTS[settings.shipMount as Mount]?.label ?? "") : t("Ranger off"));
    },
    "btn-cinema": () => {
      toggle("cinematic");
      if (settings.cinematic && !settings.wormhole)
        panel.toast(
          t(
            "Cinematic mode: the liquid surface is on the wormhole's throat — turn the wormhole on, or pick “Cinematic: the liquid wormhole”",
          ),
        );
      else panel.toast(settings.cinematic ? t("Cinematic mode: liquid wormhole") : t("Cinematic mode off"));
    },
    "btn-shot": () => savePNG(),
    "btn-full": () => fullscreen(),
    "btn-hide": () => toggleUi(),
    "hud-toggle": () => setHudOpen(!$("hud").classList.contains("open")),
    "btn-photo": () => openPhoto(),
    "btn-help": () => panel.showShortcuts(),
    "btn-render": () => renderDialog.toggle(),
  };
  // (the dock's buttons — ui: Camera, Scenes, Sky, Photo, Help; the other actions are keys, the wheel's
  // sectors and the settings)
  for (const [id, fn] of Object.entries(actions)) document.getElementById(id)?.addEventListener("click", fn);
  wheelScrollsSideways($("toolbar"));
  /** Next / previous target, named in a toast (or why there is nothing else to pick). */
  function nextTarget(dir: 1 | -1) {
    const list = camera.availableTargets();
    if (list.length < 2) {
      panel.toast(tf("Only {0} here — turn on the companion star or the wormhole, or pick a scene", BODY_NAMES[settings.target]));
      return;
    }
    camera.cycleTarget(dir);
    camera.pad.rumble(0.1, 0.3, 50);
    panel.toast(tf("Target: {0}  ({1} / {2})", BODY_NAMES[settings.target], list.indexOf(settings.target) + 1, list.length));
  }
  // ---- the camera: its view (a placement, falling freely), the look, the cinematics — one set of commands
  // for the camera panel, the keys and the controller
  /** The camera's view without the ship: its placement, or falling freely. */
  const view = (): View => (camera.gravity ? "fall" : settings.rotation);
  /** Sets the view, from where the camera is (none of them moves it). */
  function setView(v: View, say = true) {
    if (settings.ship) return;
    if (v === "fall") {
      if (!camera.gravity) camera.setGravity(true);
    } else {
      if (camera.gravity) camera.setGravity(false);
      camera.setRotation(v);
    }
    if (say)
      panel.toast(
        tf("Camera: {0} — {1}", VIEW_LABEL[v], VIEW_HELP[v]) +
          (v === "fall" && !settings.animate ? ` ${t("(paused: Space runs time)")}` : ""),
      );
    refreshGui();
    touch();
  }
  /** The next view (V): the ship's attach points, else the placements. */
  function nextView(dir: 1 | -1) {
    if (settings.ship) {
      const keys = Object.keys(MOUNTS) as Mount[];
      return setMount(keys[(keys.indexOf(settings.shipMount as Mount) + dir + keys.length) % keys.length]!);
    }
    setView(VIEWS[(VIEWS.indexOf(view()) + dir + VIEWS.length) % VIEWS.length]!);
  }
  /** A cinematic on or off (the dive and the journey are the free camera's). */
  function cinematic(c: "orbit" | "dive" | "journey") {
    if (settings.ship && c !== "orbit") return panel.toast(t("The dive and the journey are the free camera's — leave the Ranger (⇧K)"));
    camera.setCinematic(camera.cinematic === c ? null : c);
    if (camera.cinematic && !settings.animate) panel.toast(t("Cinematics run with the time — Space runs it"));
    refreshGui();
    touch();
  }
  function toggleLookAt() {
    camera.setLookAt(!settings.lookAt);
    panel.toast(settings.lookAt ? tf("View locked on {0}", BODY_NAMES[settings.target]) : t("View free"));
    refreshGui();
    touch();
  }
  function toggleTelescope() {
    camera.setTelescope(!settings.telescope);
    panel.toast(
      settings.telescope
        ? tf("Telescope on {0} — the wheel zooms (to a 0.02° field), Y leaves", BODY_NAMES[settings.target])
        : t("Telescope off"),
    );
    refreshGui();
    touch();
  }
  /**
   * Takes the free camera to a body — anywhere in the world, through the wormhole too: in orbit around
   * it (a planet, a moon: a few radii up), around it. Why it cannot, or null.
   */
  function goTo(b: Target): string | null {
    if (settings.ship && !camera.spectating) return t("The Ranger flies there: the planner (O), the autopilot (0: approach)");
    // (a spectator out: it goes, the ship flies on — the view's settings and controller)
    const S = camera.viewSettings();
    const C = viewCamera();
    if (camera.spectating && b === "wormhole" && S.wormhole) {
      // (the spectator before our mouth, eight throat radii off, around it)
      const p = ourMouthPose(S, sim.time, 8 * mouth(S).w.rho);
      setHomePose(S, p.X, p.fwd, p.up, p.vel);
      C.sync();
      S.rotation = "orbit";
      C.selectTarget("wormhole", { focus: true });
      panel.toast(tf("Camera: around {0}", BODY_NAMES.wormhole));
      touch();
      return null;
    }
    if (b === "ranger" || b === "lander" || b === "endurance") {
      // a craft of the fleet: the C a few of its sizes off it — behind, to its side, above —, moving
      // with it, around it
      if (!(S.system === "gargantua" && S.wormhole))
        return t("The craft fly in our universe (through the wormhole of the Gargantua-system scenes)");
      const p = fleet.pose(b, sim.time);
      if (!p) return tf("The {0}: not known now", BODY_NAMES[b]);
      const R = craftRadius(b);
      const o = [1.1 * R, 0.8 * R, -1.9 * R];
      const X = [0, 1, 2].map((k) => p.X[k]! + (p.ax[0][k]! * o[0]! + p.ax[1][k]! * o[1]! + p.ax[2][k]! * o[2]!) / M_METRES) as [
        number,
        number,
        number,
      ];
      const d = [p.X[0] - X[0], p.X[1] - X[1], p.X[2] - X[2]];
      const l = Math.hypot(...d);
      C.setCinematic(null);
      if (C.gravity) C.setGravity(false);
      setHomePose(S, X, [d[0]! / l, d[1]! / l, d[2]! / l], p.ax[1], p.V);
      S.motion = "geodesic";
      C.setOurLanded(null);
      C.sync();
      S.rotation = "orbit";
      C.selectTarget(b, { focus: true });
      panel.toast(tf("Camera: around the {0}", BODY_NAMES[b]));
      refreshGui();
      touch();
      return null;
    }
    if (b === "iss") {
      // the space station: the C 110 m off it — behind, to starboard, above —, moving with it,
      // around it
      if (!(S.system === "gargantua" && S.wormhole && S.iss))
        return t("The space station flies in our universe (through the wormhole of the Gargantua-system scenes)");
      const st = issTrack.peek(sim.time);
      if (!st) return t("The space station: no orbit known at this date");
      const A = issAxes(st.X, st.V, sim.time);
      const o = [-70, 60, -55];
      const X = [0, 1, 2].map((k) => st.X[k]! + (A[0][k]! * o[0]! + A[1][k]! * o[1]! + A[2][k]! * o[2]!) / M_METRES) as [
        number,
        number,
        number,
      ];
      const d = [st.X[0] - X[0], st.X[1] - X[1], st.X[2] - X[2]];
      const l = Math.hypot(...d);
      C.setCinematic(null);
      if (C.gravity) C.setGravity(false);
      setHomePose(S, X, [d[0]! / l, d[1]! / l, d[2]! / l], [-A[2]![0]!, -A[2]![1]!, -A[2]![2]!], st.V);
      S.motion = "geodesic";
      C.setOurLanded(null);
      C.sync();
      S.rotation = "orbit";
      C.selectTarget("iss", { focus: true });
      panel.toast(t("Camera: around the ISS"));
      refreshGui();
      touch();
      return null;
    }
    const id = b === "hole" ? "gargantua" : b;
    const u = universeOf(id);
    C.setCinematic(null);
    if (!u || (u === "gargantua" && id !== "gargantua" && S.system !== "gargantua")) {
      if (!C.availableTargets().includes(b)) return tf("{0} is not in this world", BODY_NAMES[b]);
      setView("orbit", false);
      C.selectTarget(b, { frame: true });
      return null;
    }
    if (u === "ours" && !(S.system === "gargantua" && S.wormhole))
      return t("The solar system lies through the wormhole of the Gargantua-system scenes");
    try {
      const sb = u === "ours" ? solarBody(id) : null;
      const alt = sb ? Math.max(defaultAltKm(id), (2.2 * sb.radius * M_METRES) / 1e3) : undefined;
      const p =
        u === "ours"
          ? ourOrbitPose({ body: id, altKm: alt }, sim.time)
          : theirOrbitPose(
              { body: id, rM: id === "gargantua" ? 40 : undefined, altKm: id === "gargantua" ? undefined : 20000 },
              sim.time,
              S.spin,
              S.massSolar,
            );
      if (C.gravity) C.setGravity(false);
      if (p.frame === "ours") setHomePose(S, p.X, p.fwd, p.up, p.vel);
      else setHolePose(S, p.X, p.fwd, p.up, p.vel);
      S.motion = "geodesic";
      C.setOurLanded(null);
      C.sync();
      S.rotation = "orbit";
      C.selectTarget(b, { focus: true });
      panel.toast(tf("Camera: around {0}", BODY_NAMES[b]));
      refreshGui();
      touch();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  /** The camera set down on a world, on its tripod, looking at the horizon (⇧T; the camera panel). */
  function standOn(b?: Target): string | null {
    if (settings.ship) return t("The Ranger lands itself (the autopilot) — leave it (⇧K) to set the camera down");
    const why = camera.standOn(b as Parameters<typeof camera.standOn>[0]);
    if (why) return why;
    const on = camera.rigStatus()?.body;
    panel.toast(
      tf("Tripod on {0} — drag to look around, the keys walk it, V another view", on ? BODY_NAMES[on as Target] : t("the ground")),
    );
    refreshGui();
    touch();
    return null;
  }
  camPanel = new CameraPanel({
    settings,
    camera,
    view,
    setView: (v) => setView(v),
    setMount: (m) => setMount(m),
    cinematic,
    goTo,
    standOn,
    changed: (keys) => onSettingsChange(keys),
    toast: (t) => panel.toast(t),
  });

  // ------------------------------------------------------------------ the sky chart (skychart.ts)
  // our sky's constellations, named stars, grids — lines drawn by the renderer over the sky, words on the
  // overlay; rebuilt when the view, the time or the switches change
  const skyPanel = new SkyPanel({
    settings,
    changed: (keys) => {
      onSettingsChange(keys);
      panel.refresh();
    },
    where: () => {
      const cam = cameraFrame(settings);
      const ours = onOurSide(settings, cam);
      const hz = ours ? horizonAt(settings, cam, sim.time) : null;
      return { ours, horizon: hz ? (BODY_NAMES[hz.body as Body] ?? hz.body) : null };
    },
    goTo: (kind, index) => skyGoTo(kind, index),
  });
  /**
   * Turns the camera to a constellation or a named star in 0.9 s — level on a world's horizon —, the
   * view freed from the target (the "around" placement becomes the free one: it always faces its target).
   */
  function skyGoTo(kind: "constellation" | "star", index: number) {
    const name = kind === "star" ? NAMED_STARS[index]!.name : CONSTELLATIONS[index]!.name;
    let cam = cameraFrame(settings);
    if (!onOurSide(settings, cam)) return void panel.toast(t("Our constellations are on the other side of the wormhole"));
    const d = kind === "star" ? NAMED_STARS[index]!.v : CONSTELLATIONS[index]!.label;
    if (settings.ship) {
      // (the Ranger's views: its look turned — as onto a body, aimAt)
      if (settings.lookAt) toggleLookAt();
      const deg = 180 / Math.PI;
      for (let i = 0; i < 12; i++) {
        const c = cameraFrame(settings);
        const L = lookOf(settings, c, d);
        const b =
          Math.atan2(L[0] * c.right[0] + L[1] * c.right[1] + L[2] * c.right[2], L[0] * c.fwd[0] + L[1] * c.fwd[1] + L[2] * c.fwd[2]) * deg;
        const e = Math.asin(Math.max(-1, Math.min(1, L[0] * c.up[0] + L[1] * c.up[1] + L[2] * c.up[2]))) * deg;
        camera.setLook(settings.shipLookYaw + b, settings.shipLookPitch + e);
        if (Math.abs(b) < 0.01 && Math.abs(e) < 0.01) break;
      }
      touch();
      return void panel.toast(kind === "star" ? name : `${name} · ${CONSTELLATIONS[index]!.abbr}`);
    }
    if (settings.lookAt) toggleLookAt();
    if (settings.rotation === "orbit") setView("free");
    cam = cameraFrame(settings);
    const hz = horizonAt(settings, cam, sim.time);
    const to = aimAngles(settings, cam, d, hz?.zenith);
    const from = { yaw: settings.yaw, pitch: settings.pitch, roll: settings.roll };
    const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
    const t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / 900);
      const e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
      settings.yaw = from.yaw + wrap(to.yaw - from.yaw) * e;
      settings.pitch = from.pitch + (to.pitch - from.pitch) * e;
      settings.roll = from.roll + wrap(to.roll - from.roll) * e;
      touch();
      if (u < 1) requestAnimationFrame(step);
      else refreshGui();
    };
    requestAnimationFrame(step);
    panel.toast(kind === "star" ? `${name}` : `${name} · ${CONSTELLATIONS[index]!.abbr}`);
  }
  let chart: ChartFrame | null = null;
  let chartKey = "";
  let chartHover = -1;
  /** the offline image's height on the page [CSS px] (letterboxed in the canvas) */
  const displayedHeight = (off: { width: number; height: number }) =>
    Math.min(canvas.clientHeight, (canvas.clientWidth * off.height) / off.width);
  /** Builds the chart for the image about to be drawn (the offline render's scene while one runs). */
  function updateChart(force = false) {
    const o = chartOptions(settings, chartHover);
    const off = renderer.offlineScene;
    const s = off?.settings ?? camera.viewSettings();
    const t = off?.time ?? sim.time;
    const cam = cameraFrame(s);
    const aspect = off ? off.width / off.height : canvas.width / Math.max(canvas.height, 1);
    const key = chartOn(o)
      ? [
          cam.region,
          cam.ell,
          ...cam.n,
          ...cam.fwd,
          ...cam.up,
          ...cam.beta,
          s.fov,
          t,
          aspect,
          o.lines,
          o.names,
          o.stars,
          o.equatorial,
          o.horizontal,
          o.ecliptic,
          o.opacity,
          o.highlight,
          !!off,
        ].join()
      : "off";
    if (key === chartKey && !force) return;
    chartKey = key;
    chart = key === "off" ? null : buildChart(s, cam, t, o, aspect, off ? displayedHeight(off) : canvas.clientHeight);
    renderer.setChart(chart?.segs ?? null, chart?.count ?? 0);
  }
  // (an exported image — a PNG, a video's frame — carries the chart's words too, at its own scale: the
  // image's pixels per CSS pixel of it on the page)
  renderer.exportWords = (ctx, w, h) => {
    if (!chart) return;
    const off = renderer.offlineScene;
    const cssH = off ? displayedHeight(off) : canvas.clientHeight;
    drawChartLabels(ctx, chart.labels, w, h, h / Math.max(cssH, 1));
  };
  /** The sky under the pointer: the constellation lit up, the card of a star or a constellation. */
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons || !chart || renderer.offlineActive || document.body.classList.contains("hide-ui")) {
      if (!e.buttons) skyPanel.showCard(null);
      return;
    }
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1,
      y = 1 - ((e.clientY - r.top) / r.height) * 2;
    const what = pickChart(chart, x, y, (2 * 14) / r.height, r.width / r.height, sim.time);
    const hover = settings.skyLines ? what.constellationIndex : -1;
    if (hover !== chartHover) chartHover = hover;
    skyPanel.showCard(what.star || (what.constellation && settings.skyLines) ? { x: e.clientX, y: e.clientY } : null, what);
  });
  canvas.addEventListener("pointerleave", () => {
    chartHover = -1;
    skyPanel.showCard(null);
  });
  canvas.addEventListener("pointerdown", () => skyPanel.showCard(null));
  /** N: the constellations (figures and names) on / off; ⇧N the stars' names. U: the grids in turn. */
  function toggleConstellations(stars = false) {
    if (stars) settings.starNames = !settings.starNames;
    else settings.skyLines = settings.skyNames = !(settings.skyLines || settings.skyNames);
    onSettingsChange(stars ? ["starNames"] : ["skyLines", "skyNames"]);
    panel.refresh();
    panel.toast(
      stars
        ? settings.starNames
          ? t("Star names on")
          : t("Star names off")
        : settings.skyLines
          ? t("Constellations on")
          : t("Constellations off"),
    );
  }
  function cycleGrids() {
    const states: [boolean, boolean][] = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];
    const i = states.findIndex(([e, h]) => e === settings.gridEquatorial && h === settings.gridHorizontal);
    const [e, h] = states[(i + 1) % states.length]!;
    settings.gridEquatorial = e;
    settings.gridHorizontal = h;
    onSettingsChange(["gridEquatorial", "gridHorizontal"]);
    panel.refresh();
    const cam = cameraFrame(settings);
    const noHorizon = h && !horizonAt(settings, cam, sim.time);
    const grids = e && h ? t("Equatorial + Horizontal grids") : e ? t("Equatorial grid") : t("Horizontal grid");
    panel.toast(!e && !h ? t("Grids off") : `${grids}${noHorizon ? ` — ${t("no world under the camera")}` : ""}`);
  }

  /**
   * The spectator (controller/spectator.ts): a free camera away from the ship, anywhere, the ship flying
   * on — its autopilots, its plan; off: the view back on the ship as it was.
   */
  function setSpectator(on: boolean) {
    if (on === camera.spectating) return;
    if (on && !camera.startSpectator()) {
      panel.toast(t("The spectator leaves a ship flown: fly one first (K)"));
      return;
    }
    if (!on) camera.stopSpectator();
    renderer.resetTemporal(); // (a cut: no history across it)
    renderer.shipPlace = null;
    renderer.shipFocus = null;
    syncButtons();
    touch();
    panel.toast(
      on
        ? t("Spectator — a free camera: W A S D · Q E to move (⇧ faster), drag to turn; the ship flies on (F3 or V: back)")
        : t("Back on the ship"),
    );
  }

  /** The view's controller (the spectator's when one is out) — named apart: goTo shadows `camera`. */
  function viewCamera() {
    return camera.viewController();
  }

  /** The flown ship's body and its place on the body's axes [radii], its height [km] (the renderer keeps its ground streamed). */
  function shipFocus() {
    const p = camera.activePoseNow();
    if (!p) return null;
    const id = referenceBody(p.X, sim.time);
    const b = solarBody(id);
    if (!b || b.kind === "star") return null;
    const q = toBodyFixed(id, p.X, sim.time);
    const r = Math.hypot(...q);
    return { body: id, c: q.map((x) => x / b.radius) as [number, number, number], altKm: ((r - b.radius) * M_METRES) / 1e3 };
  }

  /** The autopilots: flying, or assisting (the pilot flies, the HUD's director shows their commands). */
  function toggleAssist() {
    camera.pilot.assist = !camera.pilot.assist;
    // (the throttle the pilot's from where the autopilot left it)
    if (camera.pilot.assist) camera.pilot.throttle = camera.pilot.engineNow;
    // (the autopilot flying again: it points the nose — the pilot's hold off)
    else if (camera.pilot.auto !== "none") camera.pilot.hold = "none";
    panel.toast(
      camera.pilot.assist
        ? t("Assisted: you fly — the director (the ring) shows where to point, the throttle to set; F4: the autopilot flies")
        : t("The autopilots fly again (F4: assisted)"),
    );
  }

  /** Next attach point of the camera on the Ranger (turns the ship on). */
  function nextMount() {
    if (!settings.ship) {
      settings.ship = true;
      syncButtons();
    }
    const keys = Object.keys(MOUNTS) as Mount[];
    setMount(keys[(keys.indexOf(settings.shipMount as Mount) + 1) % keys.length]!);
    touch();
  }
  /** The toolbar's camera button: the view and the target. */
  function syncCameraButton() {
    const btn = $("btn-camera");
    const v = settings.ship
      ? (MOUNTS[settings.shipMount as Mount]?.short ?? "Ranger")
      : camera.cinematic
        ? { orbit: t("Auto-orbit"), dive: t("Dive"), journey: t("Journey") }[camera.cinematic]
        : VIEW_LABEL[view()];
    btn.querySelector(".cam-mode")!.textContent = `${v}${settings.telescope ? " · 🔭" : ""}`;
    btn.querySelector(".cam-target")!.textContent = BODY_NAMES[settings.target];
    btn.classList.toggle("locked", settings.lookAt || (!settings.ship && view() === "orbit"));
    btn.style.setProperty("--body", `rgb(${BODY_COLOURS[settings.target] ?? "200, 200, 200"})`);
    btn.classList.toggle("active", camPanel?.open ?? false);
    previousTarget = settings.target;
  }
  function syncButtons() {
    transport?.update(true);
    $("btn-sky").classList.toggle(
      "active",
      settings.skyLines ||
        settings.skyNames ||
        settings.starNames ||
        settings.gridEquatorial ||
        settings.gridHorizontal ||
        settings.skyEcliptic,
    );
  }
  syncButtons();
  syncCameraButton();

  // -------------------------------------------------------------------- game controller
  // -------------------------------------------------------------------- piloting the Ranger
  // -------------------------------------------------------------------- time: play / pause, warp (every mode)
  /** Time warp one rung faster or slower (clock.ts: slow motion, real time's multiples, then the classic
   *  ladder — beyond 500 M/s the ship rides on rails). Paused, the warp is set for when time runs again. */
  function warp(dir: 1 | -1) {
    if (autoWarpHeld()) return;
    const next = stepWarp(settings, dir);
    if (next !== settings.timeSpeed) audio.cue(dir > 0 ? "warp-up" : "warp-down", warpLadder(settings).indexOf(next));
    else audio.cue("error");
    setWarp(next);
  }
  /** A manoeuvre executing under auto warp: the warp is the autopilot's (the pilot's once AUTO is off). */
  function autoWarpHeld() {
    if (camera.pilot.auto !== "none" && settings.autoWarp && camera.hubWarpLimit !== null) {
      audio.cue("error");
      panel.toast(t("Warp managed by the hub — use WARP on its card to take control"));
      return true;
    }
    if (camera.nodeWarp !== "auto" || !settings.autoWarp) return false;
    audio.cue("error");
    panel.toast(t("Auto warp: the manoeuvre sets the warp — AUTO on the time bar gives it to you"));
    return true;
  }
  function setWarp(speed: number) {
    if (autoWarpHeld()) return;
    camera.requestWarp(speed);
    refreshGui();
    scheduleUrlSave();
    touch();
    panel.toast(
      `${tf("Time warp {0}", fmtWarp(settings, false))}${settings.animate ? "" : ` — ${t("paused (Space runs it)")}`} · ${+settings.timeSpeed.toPrecision(3)} M/s`,
    );
  }
  function toggleAutoWarp() {
    camera.setWarpAuthority(!settings.autoWarp);
    refreshGui();
    scheduleUrlSave();
    touch();
    panel.toast(settings.autoWarp ? t("Warp managed by the hub") : t("Warp managed by you — never above the hub's limit (, and .)"));
  }
  /** Real time: 1 s of the scene per second. */
  function realTime() {
    setWarp(realTimeSpeed(settings));
  }
  /** Runs or pauses time — in every mode (paused: nothing the time drives moves, the image converges). */
  function playPause(on = !settings.animate) {
    if (settings.animate === on) return;
    settings.animate = on;
    refreshGui();
    syncButtons();
    touch();
    scheduleUrlSave();
  }
  function toggleSound() {
    settings.sound = !settings.sound;
    audio.applyMix();
    refreshGui();
    panel.toast(settings.sound ? t("Sound on") : t("Sound off"));
  }
  function togglePathInView() {
    settings.pathInView = !settings.pathInView;
    refreshGui();
    touch();
    panel.toast(settings.pathInView ? t("Future path shown in the view") : t("Future path hidden in the view (the map keeps it)"));
  }
  function pilotHold(h: Hold) {
    camera.pilot.setHold(h);
    panel.toast(camera.pilot.hold === "none" ? t("Attitude hold off") : tf("Hold: {0}", HOLD_NAMES[h]));
  }
  function pilotAuto(a: Auto) {
    if (a === "dock" && camera.docked) return panel.toast(t("Docked to the ISS — UNDOCK first"));
    camera.pilot.setAuto(a);
    panel.toast(camera.pilot.auto === "none" ? t("Autopilot off") : tf("Autopilot: {0}", AUTO_NAMES[a]));
  }
  /** The landing gear commanded (G, the cockpit's lever, a controller — PLAN-COCKPIT K4b): down or up, but
   *  not up on the ground, not at all on the belly; said when the setting or an autopilot holds it. */
  function setGear(down: boolean) {
    if (camera.onBelly) return panel.toast(t("Landing gear jammed: the craft is on its belly"));
    if (!down && (camera.rolling || camera.landed)) return panel.toast(t("Landing gear locked down on the ground"));
    const a = camera.pilot.auto;
    if (settings.autoGear || a === "entry" || a === "land" || a === "takeoff")
      return panel.toast(settings.autoGear ? t("Landing gear: by itself (the setting)") : t("Landing gear: the autopilot sets it"));
    if (camera.gearDown === down) return;
    camera.gearDown = down;
    panel.toast(down ? t("Gear down") : t("Gear up"));
  }
  function pilotSas() {
    camera.pilot.sas = !camera.pilot.sas;
    panel.toast(camera.pilot.sas ? t("SAS on") : t("SAS off"));
  }
  function pilotRoll() {
    camera.pilot.rollAlign = !camera.pilot.rollAlign;
    panel.toast(camera.pilot.rollAlign ? t("Roll alignment on — wings in the orbital plane") : t("Roll alignment off"));
  }
  function setMount(m: Mount) {
    // (a view on the ship: the spectator back)
    if (camera.spectating) setSpectator(false);
    if (settings.shipMount === m) return;
    settings.shipMount = m;
    refreshGui();
    scheduleUrlSave();
    const help = m === "around" ? t("drag to turn around the ship") : m === "free" ? t("fly the camera, the ship flies on") : "";
    panel.toast(help ? tf("Camera: {0} — {1}", MOUNTS[m].label, help) : tf("Camera: {0}", MOUNTS[m].label));
  }
  // (read live: a tablet's keyboard docked or a touch screen emulated after the start — audit B5)
  const coarse = matchMedia("(pointer: coarse)");
  const touchFlight = new TouchFlight({
    input: camera.touchInput,
    throttle: () => camera.pilot.throttle,
    setThrottle: (t) => {
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto); // taking the throttle ends the autopilot
      camera.pilot.throttle = t;
    },
  });
  document.body.append(touchFlight.el);
  // the Ranger's cockpit screens (the cabin's shader shows them)
  const cockpitScreens = new CockpitScreens();
  // (the cockpit's chronometer: its CHRONO button)
  const cockpitChrono = new Chrono();
  const cockpitTravel = new ControlTravel();
  const flightHud = new FlightHud(settings, {
    hold: pilotHold,
    auto: pilotAuto,
    sas: pilotSas,
    warp,
    mount: setMount,
    spectator: () => setSpectator(!camera.spectating),
    assist: () => toggleAssist(),
    hubWarp: toggleAutoWarp,
    spectatorGoTo: (b: Target) => {
      camera.setSpectatorFollow(false);
      const why = goTo(b);
      if (why) panel.toast(why);
    },
    spectatorFollow: (on: boolean) => {
      camera.setSpectatorFollow(on);
      panel.toast(
        camera.spectatorFollow
          ? t("Following the ship: the camera carried with it")
          : t("Free: the camera stays where it is — away to the planets (the keys' speed grows with the distance)"),
      );
    },
    roll: pilotRoll,
    sound: () => toggleSound(),
    vessel: (id) => {
      settings.vessel = id;
      refreshGui();
      scheduleUrlSave();
    },
    camera: () => {
      camPanel!.toggle();
      syncCameraButton();
    },
    addNodeAt: (t) => {
      camera.addNode(Math.max(t - sim.time, 1e-3));
      touch();
    },
    speedMode: () => {
      camera.speedMode = camera.speedMode === "orbit" ? "target" : "orbit";
      panel.toast(camera.speedMode === "target" ? tf("Speed relative to {0}", BODY_NAMES[settings.target]) : t("Speed in orbit"));
    },
    select: (b) => {
      if (camera.selectTarget(b as Target, { focus: false })) panel.toast(tf("Target: {0}", BODY_NAMES[settings.target]));
    },
    lookAhead: () => {
      panel.toast(camera.resetShipView());
      refreshGui();
    },
    undock: () => camera.undock(),
    throttle: (t) => {
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto); // taking the throttle ends the autopilot
      camera.pilot.throttle = t;
    },
    plan: (goal, r2, orbitStar) => panel.toast(camera.planTransfer(goal, r2, { orbitStar })),
    planOur: (kind, arrival, altKm, retKm) => {
      panel.toast(t("Planning… (aiming the n-body paths)"));
      void camera.planOurs(kind, arrival, altKm, retKm).then((m) => m && panel.toast(m));
    },
    align: (goal) => panel.toast(camera.planAlign(goal)),
    addNode: () => camera.addNode(),
    nudge: (i, dv, dt) => camera.nudgeNode(i, dv, dt),
    deleteNode: (i) => camera.deleteNode(i),
    clearPlan: () => camera.clearPlan(),
    pathInView: togglePathInView,
    tools: () => toolsWin.toggle(),
    execute: () => pilotAuto(camera.transfer || camera.pilot.auto === "transfer" ? "transfer" : "node"),
  });
  // the flight computer, over the full-screen map (ui/fc/computer.ts)
  let openMissions = () => {};
  const flightComputer = new FlightComputer({
    context: () => camera.fcContext(),
    kerr: () => {
      if (!camera.piloting || camera.fcContext()) return null;
      const cam = cameraFrame(settings);
      return cam.region === "hole" ? { r: cam.r, target: settings.target } : null;
    },
    kerrPlan: (kind, r) => {
      const m =
        kind === "circular"
          ? camera.planTransfer("orbit", r ?? 30)
          : kind === "align"
            ? camera.planAlign("orbit")
            : kind === "target"
              ? camera.planTransfer("star")
              : camera.planTransfer("wormhole");
      panel.toast(m);
      return null;
    },
    kerrInfo: () => camera.fcKerrInfo(),
    kerrOp: (kind, x) => camera.fcKerrOp(kind, x),
    preview: (burns, note) => camera.fcPreview(burns, note),
    setPlan: (burns, note) => camera.fcSetPlan(burns, note),
    execute: () => camera.fcExecute(),
    clear: () => camera.fcClear(),
    plan: () => camera.fcPlan(),
    budget: () => camera.fcBudget(),
    sites: () => {
      const c = camera.fcContext();
      return c ? sitesOf(c.body) : [];
    },
    site: () => camera.entrySite,
    siteTrack: (st) => camera.fcSiteTrack(st),
    setSite: (st) => (camera.entrySite = st),
    land: () => {
      if (camera.pilot.auto !== "entry") pilotAuto("entry");
      return null;
    },
    // (the hub's autopilots: engaged — never toggled off by a second engage —, the same code)
    engage: (a, now) => {
      // (circularize NOW: the trim where the ship is, not the burn at the next apsis)
      if (a === "circularize" && now) camera.ourCirc = { mode: "trim", spent0: camera.spent };
      if (camera.pilot.auto !== a) pilotAuto(a);
      return null;
    },
    disengage: () => {
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto);
    },
    autoState: (a) => ({
      on: camera.pilot.auto === a || (a === "circularize" && camera.pilot.auto === "node" && !!camera.ourCirc),
      why: flightHud.autoWhy(a),
    }),
    launch: (altKm, incDeg) => {
      camera.launchGoal = { altKm, incDeg };
      if (camera.pilot.auto !== "takeoff") pilotAuto("takeoff");
      return null;
    },
    launchGoal: () => ({ ...camera.launchGoal }),
    missionTargets: () => camera.missionTargets(),
    missionPlan: (spec) => camera.missionPlan(spec),
    missionCommit: () => camera.missionCommit(),
    target: () => String(settings.target),
    say: (t) => panel.toast(t),
  });
  flightHud.attach(flightComputer.root);
  // (the map's bodies drawn on the tracer's GPU, with its maps)
  flightHud.mapGpu = renderer.mapGpuSource();
  flightHud.future = (at) => camera.futureView(at);
  flightHud.runway = () => camera.runwayView();
  flightHud.kerrApsides = () => {
    const k = camera.fcKerrInfo();
    return k && { rp: k.o.rp, ra: k.o.ra, fate: k.o.fate };
  };
  // (the planner — its key, its button —: the map, the flight computer's MISSION tab)
  flightHud.onPlanner = () => openMissions();
  openMissions = () => {
    if (!flightHud.mapView) flightHud.toggleMapView();
    flightComputer.show(true);
    tablet.setPage("computer");
    flightComputer.openTab("mission");
  };
  // the tablet (ui/tablet.ts): the map's left panel, the computer's and the ship's, the camera's, the
  // sky's and the log's pages
  const tablet = new Tablet(flightComputer.panel, {
    ship: () => rangerView(tools),
    camera: camPanel!,
    sky: skyPanel,
    log: gameLog,
    dateOf: (t) => fmtDate(t),
    // (the runway in reach, the craft on it; else the site the entry flies to, its end in service)
    approach: () => {
      const rw = camera.runwayView();
      if (rw) return { site: rw.site, craft: { along: rw.along, across: rw.across, agl: rw.agl } };
      const s = camera.entryRun?.site ?? camera.entrySite;
      return s ? { site: s.runway ? camera.runwayInUse(s) : s, craft: null } : null;
    },
  });
  // the transport bar (ui/transport.ts): over the toolbar, in the mission bar while flying
  const tpDock = document.createElement("div");
  tpDock.id = "tp-dock";
  document.body.append(tpDock);
  transport = new TransportBar({
    settings,
    time: () => sim.time,
    playPause: () => playPause(),
    warp,
    setWarp,
    realTime,
    record: () => toggleTake(),
    recording: () => ({ on: take.recording, seconds: take.seconds, frames: take.length }),
    railsNote: () => camera.railsNote,
    nodeWarp: () => camera.nodeWarp || (camera.plan.nodes.length && settings.ship ? "plan" : ""),
    toggleAutoWarp,
    openTime: () => timePanel.open(),
  });
  transport.mount(tpDock, false);
  /** Starts or stops recording a take (● on the time bar). */
  function toggleTake() {
    if (renderer.offlineActive) return panel.toast(t("A render is running"));
    if (take.recording) {
      take.stop();
      renderDialog.takeChanged();
      panel.toast(tf("Take recorded · {0} s — Render › Video renders it at full quality", take.seconds.toFixed(1)));
    } else {
      take.start();
      panel.toast(t("Recording a take — fly, orbit, pause, warp as you like; ● again to stop"));
    }
    transport?.update(true);
  }
  // (the controller's news, onto the game's bus — game/events.ts — and from it to whoever shows them)
  camera.onPilotMessage = (text) => events.emit("pilotMessage", { text, t: sim.time });
  camera.onAirEntry = () => events.emit("airEntry", { t: sim.time });
  camera.onCraftLost = (why) => events.emit("craftLost", { why, t: sim.time });
  // (the flight's end graded — game/report.ts —: the HUD's card, a line in the journal)
  camera.onFlightReport = (r) => {
    flightHud.showReport(r);
    if (r) {
      lastReport = r;
      tarsEvent({ kind: "report", to: r.letter, detail: `${r.title} — ${r.score.toFixed(1)}/20` });
    }
    lastGrade = r?.letter ?? null;
    // (TARS's word on the landing, sometimes)
    if (r && settings.tarsRemarks && (r.letter === "A" || r.letter === "F")) {
      const w = tars.remark(r.letter === "A" ? "landed-A" : "landed-F", performance.now(), tarsPersonality());
      if (w) voice.say({ text: w, speaker: "tars", priority: 3, ttl: 20_000 });
    }
    if (!r) return;
    gameLog.add("info", `${r.title} — ${r.letter} (${r.score.toFixed(1)} / 20)`, sim.time);
  };
  events.on("pilotMessage", ({ text, t }) => {
    panel.toast(text);
    cockpitScreens.message(text);
    gameLog.add(/crash/i.test(text) ? "warn" : "pilot", text, t);
  });
  // the keys that matter now (ui/keyhints.ts), from the flight's phase
  const keyHints = new KeyHints();
  // the flight's phase (game/phase.ts): its changes in the journal
  const phaseWatch = new PhaseWatcher((from, to) => events.emit("phase", { from, to, t: sim.time }));
  events.on("phase", ({ from, to, t }) => {
    if (from) gameLog.add("phase", phaseText(to), t, { from, to });
    if (from && to?.stage && from.stage !== to.stage)
      tarsEvent({ kind: "phase", from: from.stage ?? "", to: to.stage, detail: phaseText(to) });
    flightHud.phase = to;
  });
  // the automatic Interstellar mission (a preset starts it; Esc hands the controls back)
  let hudDensity: number | null = null;
  const mission = new Mission(settings, camera, (t) => panel.toast(t));
  sim.mission = mission;
  mission.onEnd = () => {
    if (hudDensity !== null) flightHud.setDensity(hudDensity);
    hudDensity = null;
  };
  mission.onStart = () => {
    hudDensity = flightHud.density;
    flightHud.setDensity(2); // clean: the view, the captions, the warnings
  };
  const flying = () => camera.piloting && !camera.cinematic && !renderer.offlineActive;
  panel.flightKeys = (e) => flying() && (e.key === "m" || e.key === "M") && !e.shiftKey;
  camera.onPadAction = (a) => {
    if (renderer.offlineActive) return;
    if (flying()) {
      // in the Ranger: A SAS, B cut the engine, X prograde, Y retrograde, R3 look ahead
      const pa: Partial<Record<typeof a, () => void>> = {
        focus: pilotSas,
        gravity: () => (camera.pilot.throttle = 0),
        auto: () => pilotHold("prograde"),
        rotation: () => pilotHold("retrograde"),
        recentre: () => camera.setLook(0, 0),
        dpadUp: () => setMount(MOUNT_KEYS[(MOUNT_KEYS.indexOf(settings.shipMount as Mount) + 1) % MOUNT_KEYS.length]!),
        dpadDown: () =>
          setMount(MOUNT_KEYS[(MOUNT_KEYS.indexOf(settings.shipMount as Mount) + MOUNT_KEYS.length - 1) % MOUNT_KEYS.length]!),
      };
      if (pa[a]) {
        pa[a]!();
        touch();
        return;
      }
    }
    switch (a) {
      case "focus":
        // fly the view to the target (framed), like a double-click on it
        if (view() !== "orbit" && !camera.gravity) setView("orbit", false);
        camera.selectTarget(settings.target, { frame: !camera.gravity });
        break;
      case "gravity":
        setView(view() === "fall" ? "free" : "fall");
        break;
      case "auto":
        cinematic("orbit");
        break;
      case "rotation":
        nextView(1);
        break;
      case "prevTarget":
        nextTarget(-1);
        break;
      case "nextTarget":
        nextTarget(1);
        break;
      case "recentre":
        camera.resetView();
        break;
      case "time":
        playPause();
        break;
      case "settings":
        // (Start: the pause menu, as in any game — the settings are in it)
        (pauseMenu ??= makePauseMenu()).open();
        break;
    }
    touch();
  };
  // connection toasts only for real changes: Safari hands a pad over from one internal provider to
  // another (a disconnect immediately followed by a connect), which must not read as "disconnected"
  let padWas = camera.pad.connected;
  let padTimer = 0;
  const padChanged = () => {
    clearTimeout(padTimer);
    padTimer = window.setTimeout(() => {
      const now = camera.pad.connected;
      if (now === padWas) return;
      padWas = now;
      if (now) {
        const id = camera.pad.list()[0]?.id.replace(/\s*\(.*\)\s*$/, "") || t("gamepad");
        panel.toast(tf("Controller connected — {0} · ? for the buttons", id));
        camera.pad.rumble(0.2, 0.4, 120);
      } else panel.toast(t("Controller disconnected"));
      touch();
    }, 900);
  };
  addEventListener("gamepadconnected", padChanged);
  addEventListener("gamepaddisconnected", padChanged);
  camera.pad.hid.onChange = padChanged;
  async function connectController() {
    try {
      if (!(await camera.pad.hid.request())) panel.toast(t("No controller chosen"));
    } catch (e) {
      panel.toast(tf("Could not open the controller: {0}", (e as Error).message));
    }
  }

  // the pause menu (Escape with nothing open): the time held, the game's own (ui/pause.ts)
  const releaseControls = () => {
    mission.stop(t("Mission stopped — you have the controls"));
    camera.pilot.hold = "none";
    if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto);
    if (camera.cinematic) camera.setCinematic(null);
  };
  // the controls screen (ui/controls-screen.ts): from the pause menu, back to it
  const controlsScreen: ControlsScreen = new ControlsScreen({
    help: () => actions["btn-help"]!(),
    pads: () => padsScreen.open(),
    back: () => (pauseMenu ??= makePauseMenu()).open(),
    toast: (t) => panel.toast(t),
  });
  // the controllers screen (ui/pads-screen.ts — PLAN-HOTAS H4): from the controls screen, back to it
  const padsScreen = new PadsScreen({ pads: camera.padControls, back: () => controlsScreen.open(), toast: (t) => panel.toast(t) });
  // (made at its first opening: the game's tools are built further down)
  let pauseMenu: PauseMenu | null = null;
  const makePauseMenu = () =>
    new PauseMenu({
      tools,
      hold: (on) => {
        paused = on;
        touch();
      },
      engaged: () => mission.active || camera.pilot.hold !== "none" || camera.pilot.auto !== "none" || !!camera.cinematic,
      release: releaseControls,
      settings: () => panel.toggle(true),
      help: () => actions["btn-help"]!(),
      controls: () => controlsScreen.open(),
      photo: () => openPhoto(),
      place: () => placePanel.open(),
      time: () => timePanel.open(),
      weather: () => weatherPanel.open(),
      titleScreen: () => titleScreen?.open(),
      toast: (t) => panel.toast(t),
    });
  /** the title screen, once built (ui/title.ts) */
  let titleScreen: TitleScreen | null = null;
  const quickSave = () => {
    try {
      panel.toast(tf("Quick save — {0}", tools.save("Quick save")));
    } catch (e) {
      panel.toast((e as Error).message);
    }
  };
  const quickLoad = () => {
    try {
      panel.toast(tf("Quick load — {0}", tools.load("Quick save")));
    } catch {
      panel.toast(t("No quick save yet — F5 makes one"));
    }
  };

  // the keyboard: input/keymap.ts says which key does what (and draws the help); here, what it does
  const keyActions: Record<KeyAction, (e: KeyboardEvent, arg?: string) => void> = {
    tools: () => DEV_TOOLS && toolsWin.toggle(),
    // (held flight keys: translation, throttle — read each frame by the controller)
    held: () => {},
    throttleFull: () => {
      // (the free camera's and the cabin's own keys)
      if (camera.outsideView() === "free" || settings.shipMount === "cabin") return;
      // (on the entry autopilot's runway approach: TOGA — the missed approach flown — PLAN-AEROPORTS A5)
      if (camera.goAround()) return;
      camera.pilot.throttle = 1;
    },
    throttleCut: () => {
      if (camera.outsideView() !== "free" && settings.shipMount !== "cabin") camera.pilot.throttle = 0;
    },
    precision: () => {
      camera.pilot.precision = !camera.pilot.precision;
      panel.toast(camera.pilot.precision ? t("Precision controls") : t("Normal controls"));
    },
    sas: () => pilotSas(),
    roll: () => pilotRoll(),
    resetShipView: () => {
      panel.toast(camera.resetShipView()); // (the camera back to the attach points)
      refreshGui();
    },
    hold: (_, h) => pilotHold(h as Hold),
    auto: (_, a) => pilotAuto(a as Auto),
    map: () => flightHud.toggleMapView(),
    mount: (e) => {
      // (the views' cycle goes through the spectator: after the last of the ship's, before its first)
      const keys = Object.keys(MOUNTS) as Mount[];
      const i = keys.indexOf(settings.shipMount as Mount);
      const dir = e.shiftKey ? -1 : 1;
      if (camera.spectating) {
        setSpectator(false);
        setMount(keys[dir > 0 ? 0 : keys.length - 1]!);
      } else if ((dir > 0 && i === keys.length - 1) || (dir < 0 && i === 0)) setSpectator(true);
      else setMount(keys[(i + dir + keys.length) % keys.length]!);
    },
    spectator: () => setSpectator(!camera.spectating),
    assist: () => toggleAssist(),
    vessel: (_, d) => camera.cycleVessel(d === "1" ? 1 : -1), // (the craft flown: KSP's [ ])
    flightMode: () => {
      // the flight law in the air: rocket → plane → the sci-fi flight computer
      const V = VESSELS[fleet.active];
      if (!V.flies) panel.toast(tf("The {0} is no aircraft: it flies as a rocket", V.name));
      else {
        const order: Settings["flightMode"][] = ["rocket", "plane", "sf"];
        settings.flightMode = order[(order.indexOf(settings.flightMode) + 1) % 3]!;
        onSettingsChange(["flightMode"]);
        panel.toast(tf("{0}: flown as {1}", V.name, FLIGHT_MODE_HELP[settings.flightMode]));
      }
    },
    antigrav: () => {
      settings.antigrav = !settings.antigrav;
      onSettingsChange(["antigrav"]);
      panel.toast(
        settings.antigrav
          ? t("Antigravity on — the flight computer holds against gravity and the air for free")
          : t("Antigravity off — every hold costs thrust and propellant"),
      );
    },
    flaps: () => {
      const cfg = camera.airFlight.cfg;
      cfg.flaps = cfg.flaps === 0.5 ? 1 : cfg.flaps === 1 ? 0 : 0.5;
      panel.toast(cfg.flaps === 0 ? t("Flaps up") : cfg.flaps === 0.5 ? t("Flaps half") : t("Flaps full"));
    },
    airBrake: () => {
      camera.airBrake = camera.airBrake > 0 ? 0 : 1;
      panel.toast(camera.airBrake > 0 ? t("Air brake out") : t("Air brake in"));
    },
    gear: () => setGear(!camera.gearDown),
    tars: (e) => tarsKey(e),
    pathInView: () => togglePathInView(),
    hudDensity: () => panel.toast(flightHud.cycleDensity()),
    missions: () => openMissions(),
    stopFlight: () => releaseControls(),
    ack: () => flightHud.acknowledge(),
    pause: () => (pauseMenu ??= makePauseMenu()).open(),
    quickSave: () => quickSave(),
    quickLoad: () => quickLoad(),
    leaveShip: () => actions["btn-ship"]!(),
    // time, in every mode
    playPause: () => playPause(),
    warp: (_, d) => warp(d === "1" ? 1 : -1),
    realTime: () => realTime(),
    // the scene; the camera in every mode: V the next view, C the look locked on the target, Y the
    // telescope; the free camera's B falling freely, O T ⇧C its cinematics
    toggleUi: () => toggleUi(),
    nextView: (e) => {
      nextView(e.shiftKey ? -1 : 1);
      touch();
    },
    recentre: () => {
      camera.resetView();
      touch();
    },
    target: (e) => nextTarget(e.shiftKey ? -1 : 1),
    png: () => savePNG(),
    fullscreen: () => fullscreen(),
    lookAt: () => toggleLookAt(),
    telescope: () => toggleTelescope(),
    autoOrbit: () => cinematic("orbit"),
    dive: () => cinematic("dive"),
    journey: () => cinematic("journey"),
    standOn: () => {
      const why = standOn();
      if (why) panel.toast(why);
    },
    fall: () => setView(view() === "fall" ? "free" : "fall"),
    shadowGuide: () => toggle("shadowGuide"),
    constellations: (e) => toggleConstellations(e.shiftKey),
    grids: () => cycleGrids(),
    jet: () => toggle("jet"),
    cinema: () => actions["btn-cinema"]!(),
    ship: () => actions["btn-ship"]!(),
    nextMount: () => nextMount(),
    details: () => actions["hud-toggle"]!(),
    help: () => actions["btn-help"]!(),
    stopCinematic: () => camera.setCinematic(null),
    quality: (_, q) => {
      settings.quality = q as Settings["quality"];
      Object.assign(settings, QUALITY[settings.quality]);
      refreshGui();
      resize();
      touch();
    },
  };
  // (a controller's button bound to a keymap action — PLAN-HOTAS: the same as its key)
  camera.onPadKeyAction = (a, arg) => keyActions[a]?.(new KeyboardEvent("keydown"), arg);
  // the cockpit's controls under the pointer (PLAN-COCKPIT K2): the same actions as the keys', the lights'
  // settings, the chronometer; a tip beside the pointer
  const cockpitDeps: CockpitDeps = {
    settings,
    chrono: cockpitChrono,
    key: (a, arg) => keyActions[a]?.(new KeyboardEvent("keydown"), arg),
    setFlaps: (v) => {
      const cfg = camera.airFlight.cfg;
      if (cfg.flaps === v) return;
      cfg.flaps = v;
      panel.toast(v === 0 ? t("Flaps up") : v === 0.5 ? t("Flaps half") : t("Flaps full"));
    },
    setAirBrake: (v) => {
      const was = camera.airBrake;
      camera.airBrake = v;
      if (was > 0 !== v > 0) panel.toast(v > 0 ? t("Air brake out") : t("Air brake in"));
    },
    setGear: (down) => setGear(down),
    gearNow: () => ({ down: camera.gearDown, ext: camera.gearExt }),
    apOff: () => {
      camera.pilot.setAuto("none");
      camera.pilot.setHold("none");
      panel.toast(t("Autopilot and holds off"));
    },
    toast: (m) => panel.toast(m),
    changed: () => {
      refreshGui();
      scheduleUrlSave();
    },
  };
  const cockpitInput = new CockpitInput({
    target: (x, y) => {
      const r = renderer.ship.cabinRay(x, y);
      const H = cockpitHull.bvh && cockpitHull.verts ? { bvh: cockpitHull.bvh, verts: cockpitHull.verts } : null;
      return r ? cockpitTarget(r.o, r.d, H) : null;
    },
    value: (id) => controlStates(camera, settings, cockpitChrono)[id]?.pos ?? 0,
    act: (id, v) => cockpitAct(cockpitDeps, id, v),
    // (the screens' pages: their tabs over the screen under the pointer — PLAN-COCKPIT K3)
    screenHover: (slot, u, v) => cockpitScreens.hoverScreen(slot, u, v),
    screenTab: (_, u, v) => tabAt(u, v) !== null,
    screenClick: (slot, u, v) => {
      const p = cockpitScreens.clickScreen(slot, u, v);
      if (p === undefined) return;
      settings.cockpitPages = cockpitScreens.pagesSetting();
      scheduleUrlSave();
      panel.toast(p ? tf("Screen: {0}", p.toUpperCase()) : t("Screen: its own page, automatic"));
    },
  });
  const cockpitTip = new CockpitTip();
  camera.cockpit = {
    input: cockpitInput,
    active: () => camera.piloting && renderer.ship.cabinShown && !camera.spectating,
    tip: (id, x, y) => cockpitTip.show(id ? controlTip(id, controlStates(camera, settings, cockpitChrono)[id], cockpitDeps) : null, x, y),
  };
  // photo mode (ui/photo.ts): the view alone, one bar for the picture
  let photoMode: PhotoMode | null = null;
  const openPhoto = () =>
    (photoMode ??= new PhotoMode({
      settings,
      enter: () => {
        const was = settings.animate;
        playPause(false);
        return () => playPause(was);
      },
      changed: (keys) => {
        onSettingsChange(keys);
        refreshGui();
      },
      setFov: (deg) => camera.setFov(deg),
      playPause: (on) => playPause(on),
      png: () => void savePNG(),
      render: () => renderDialog.toggle(),
    })).open();

  // the radial wheel (ui/wheel.ts): Tab held opens it, released does the sector pointed at; a tap is
  // still the next target
  const wheel = new RadialWheel();
  const wheelItems = (): WheelItem[] => {
    const P = camera.pilot;
    if (flying())
      return [
        { label: { fr: "SAS", en: "SAS" }, key: "T", on: P.sas, run: pilotSas },
        { label: { fr: "Prograde", en: "Prograde" }, key: "1", on: P.hold === "prograde", run: () => pilotHold("prograde") },
        { label: { fr: "Rétrograde", en: "Retrograde" }, key: "2", on: P.hold === "retrograde", run: () => pilotHold("retrograde") },
        { label: { fr: "Vers la cible", en: "To the target" }, key: "7", on: P.hold === "target", run: () => pilotHold("target") },
        {
          label: { fr: "Autopilote", en: "Autopilot" },
          on: P.auto !== "none",
          sub: (
            [
              ["hover", { fr: "Stationnaire", en: "Hover" }, "8"],
              ["circularize", { fr: "Circulariser", en: "Circularize" }, "9"],
              ["approach", { fr: "Approche", en: "Approach" }, "0"],
              ["land", { fr: "Atterrir", en: "Land" }, "G"],
              ["takeoff", { fr: "Décoller", en: "Take off" }, "U"],
              ["dock", { fr: "Amarrer", en: "Dock" }, "B"],
              ["entry", { fr: "Rentrée", en: "Entry" }, "⇧G"],
            ] as const
          ).map(([a, label, key]) => ({ label, key, on: P.auto === a, run: () => pilotAuto(a) })),
        },
        { label: { fr: "Carte", en: "Map" }, key: "M", on: flightHud.mapView, run: () => flightHud.toggleMapView() },
        { label: { fr: "Placer", en: "Place" }, run: () => placePanel.open() },
        { label: { fr: "Vue", en: "View" }, key: "V", run: () => keyActions.mount(new KeyboardEvent("keydown")) },
        { label: { fr: "Photo", en: "Photo" }, run: openPhoto },
      ];
    return [
      { label: { fr: "Vue", en: "View" }, key: "V", run: () => nextView(1) },
      { label: { fr: "Regarder la cible", en: "Look at target" }, key: "C", on: settings.lookAt, run: toggleLookAt },
      { label: { fr: "Télescope", en: "Telescope" }, key: "Y", on: settings.telescope, run: toggleTelescope },
      {
        label: { fr: "Scène", en: "Scene" },
        sub: [
          { label: { fr: "Jet", en: "Jet" }, key: "J", on: settings.jet, run: () => toggle("jet") },
          { label: { fr: "Surface liquide", en: "Liquid surface" }, key: "L", on: settings.cinematic, run: () => actions["btn-cinema"]!() },
          { label: { fr: "Guide d'ombre", en: "Shadow guide" }, key: "G", on: settings.shadowGuide, run: () => toggle("shadowGuide") },
          { label: { fr: "Son", en: "Sound" }, on: settings.sound, run: () => toggleSound() },
          { label: { fr: "Plein écran", en: "Fullscreen" }, key: "F", on: !!document.fullscreenElement, run: () => void fullscreen() },
        ],
      },
      { label: { fr: "Piloter", en: "Fly" }, key: "K", run: () => actions["btn-ship"]!() },
      { label: { fr: "Placer le vaisseau", en: "Place the ship" }, run: () => placePanel.open() },
      {
        label: { fr: "Cinématique", en: "Cinematic" },
        on: !!camera.cinematic,
        sub: [
          { label: { fr: "Orbite auto", en: "Auto-orbit" }, key: "O", on: camera.cinematic === "orbit", run: () => cinematic("orbit") },
          { label: { fr: "Plongée", en: "Dive" }, key: "⇧C", on: camera.cinematic === "dive", run: () => cinematic("dive") },
          { label: { fr: "Voyage", en: "Journey" }, key: "T", on: camera.cinematic === "journey", run: () => cinematic("journey") },
          {
            label: { fr: "Chute libre", en: "Free fall" },
            key: "B",
            on: view() === "fall",
            run: () => setView(view() === "fall" ? "free" : "fall"),
          },
        ],
      },
      { label: { fr: "Ciel", en: "Sky" }, key: "N", run: () => actions["btn-sky"]!() },
      { label: { fr: "Photo", en: "Photo" }, run: openPhoto },
    ];
  };
  let tabTimer = 0;
  let tabShift = false;
  addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Tab" || e.repeat || isTyping(e) || titleScreen?.isOpen || paused) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    tabShift = e.shiftKey;
    clearTimeout(tabTimer);
    tabTimer = window.setTimeout(() => {
      tabTimer = 0;
      wheel.open(wheelItems(), flying() ? { fr: "Pilotage", en: "Flight" } : { fr: "Caméra", en: "Camera" });
    }, 220);
  });
  addEventListener("keyup", (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    if (tabTimer) {
      // (a tap: the next target)
      clearTimeout(tabTimer);
      tabTimer = 0;
      nextTarget(tabShift ? -1 : 1);
    } else if (wheel.isOpen) {
      if (wheel.selected >= 0) wheel.activate();
      else wheel.close();
    }
  });

  addEventListener("keydown", (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || titleScreen?.isOpen) return;
    // (Enter on a focused button presses it, not the game's binding)
    if (e.key === "Enter" && (e.target as HTMLElement | null)?.closest?.("button, a, [role=button]")) return;
    // (the keys as the player set them — input/bindings.ts)
    // (a spectator out: its keys move it — not the ship's flight keys)
    const camKey = e.code in freeCameraKeys();
    const b = matchKey(e, flying() && !(camera.spectating && camKey), camKey, effectiveBindings());
    if (!b) return;
    e.preventDefault();
    keyActions[b.do](e, b.arg);
  });

  async function savePNG() {
    download(await renderer.exportPNG(settings), `${fileStem()}.png`);
  }
  function fileStem() {
    const { width, height } = renderer.offlineActive ? renderDialog.size() : renderer.size;
    return `kerr-a${settings.spin.toFixed(3)}-i${settings.inclination.toFixed(0)}-r${settings.distance.toFixed(0)}-${width}x${height}`;
  }
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const renderDialog = setupRenderDialog({
    renderer,
    camera,
    // (what the view shows: a spectator's when one is out)
    get settings() {
      return camera.viewSettings();
    },
    sim,
    take,
    applyState: (st: TakeState) => {
      renderer.water.clock = st.water;
      renderer.shipPose = st.ship;
      renderer.shipThrust = st.thrust;
      renderer.shipPlasma = st.plasma;
      renderer.setCameraPath(st.path);
      renderer.autoExposureEV = st.ev;
      sim.time = st.time;
      setSceneTime(st.time);
    },
    // (the scene as it was: the flight — a saved game's state —, every setting, the clocks)
    snapshot: () => ({
      save: tools.snapshot("before the video"),
      settings: { ...settings },
      time: sim.time,
      water: renderer.water.clock,
      ev: renderer.autoExposureEV,
    }),
    restore: (x) => {
      const b = x as { save: GameSave; settings: Settings; time: number; water: number; ev: number };
      tools.load(b.save, { quiet: true });
      Object.assign(settings, b.settings);
      sim.setTime(b.time);
      renderer.water.clock = b.water;
      renderer.autoExposureEV = b.ev;
      camera.sync();
      refreshGui();
      touch();
      touchDisplay();
    },
    time: () => sim.time,
    download,
    fileStem,
    onActiveChange: (active) => {
      camera.enabled = !active;
      if (active) camera.setCinematic(null);
      document.body.classList.toggle("offline", active);
      touch();
      touchDisplay();
    },
  });

  // -------------------------------------------------------------------- saved state
  // (the URL no longer carries the scene: the game saves itself in the browser — game/save.ts; a
  // link is made on demand. Kept as a hook for what should save soon.)
  let saveSoon = false;
  function scheduleUrlSave() {
    saveSoon = true;
  }

  // -------------------------------------------------------------------- sizing
  // dynamic resolution: a fraction of the pixel ratio (1: as set), lowered when the GPU cannot keep
  // the frame budget with the subsampling already coarse, raised back when it has room. In motion only:
  // the camera held, the image refines at the full scale (the moving one kept for the next move)
  let renderScale = 1;
  let forcedScale: number | null = null; // (a scale held by the automation: the benches, the tests)
  let movingScale = 0; // (the scale the motion had, while the camera is held at the full one; 0: none)
  let heldFor = 0; // (how long the camera has been held [s]: a pause between two inputs is not)
  let movingFor = 0; // (how long it has moved again [s]: a resize's own fresh frame is not a move)
  let gpuEma = 0;
  let scaleTimer = 0;
  // the frame time measured at each scale (remembered 30 s, then tried again): a lower scale only when
  // it pays — the frame may be bound elsewhere (the browser's compositing), where a smaller image is
  // no faster, only blurrier
  const scaleMs = new Map<number, { ms: number; at: number }>();
  let scaleHeld = 0; // (how long the scale has held [s]: its first frames, the targets made anew, are not its measure)
  let measuredFrames = 0;
  let calibrationWasReady = false;
  let idleAtCap = 0; // (how long the GPU has idled with the image at the tier's pixel cap [s])
  let overAtFloor = 0; // (how long the GPU has been over budget at the coarsest block and smallest scale [s])
  let demotedAt = -Infinity; // (the last demotion [performance.now() ms]: no promotion for a minute after)
  function resize() {
    if (!dynamicResolutionOn(settings) && forcedScale === null) renderScale = 1;
    // (with the dynamic resolution — the Game quality turns it on, any quality may —, the image within
    // the hardware tier's pixel budget, then its scale; without it the ratio asked for: the still image
    // is the point)
    const ratio = dynamicResolutionOn(settings)
      ? cappedRatio(settings.pixelRatio, canvas.clientWidth, canvas.clientHeight, renderer.tier.capMpx)
      : settings.pixelRatio;
    // (the canvas at the display's size; the image rendered at its scale of it — upscaled by the display
    // pass, not by the browser: R10)
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const odpr = devicePixelRatio;
    overlay.width = Math.round(canvas.clientWidth * odpr);
    overlay.height = Math.round(canvas.clientHeight * odpr);
    renderer.resize(w * renderScale, h * renderScale);
    touch();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // -------------------------------------------------------------------- the game's tools (F2, __bh.game)
  const tools = new GameTools({
    settings,
    camera,
    renderer,
    time: () => sim.time,
    setTime: (t) => sim.setTime(t),
    preset: (name) => applyPreset(name),
    changed: (keys) => onSettingsChange(keys),
    refresh: () => {
      refreshGui();
      touch();
      touchDisplay();
      sim.timeDirty = true;
    },
    toast: (t) => panel.toast(t),
    fps: () => fps,
    renderScale: () => renderScale,
    scene: { get: () => currentScene, set: (n) => (currentScene = n && presets[n] ? n : null) },
  });
  const toolsWin = new GameToolsWindow(tools, settings);
  // placing the ship (ui/placepanel.ts): the HUD's Place button, the radial wheel, the pause menu — a
  // mission running ends (asked first); a scene without the game's world loads it
  const placePanel = new PlacePanel({
    tools,
    settings,
    mission: () => {
      const m = MISSIONS.find((q) => q.scene === currentScene);
      return m ? tr(m.title) : mission.active ? t("The Interstellar journey") : null;
    },
    endMission: () => {
      mission.stop(t("Mission ended — the ship placed"));
      currentScene = null;
    },
    ensureWorld: () => {
      if (!settings.wormhole || settings.system !== "gargantua") applyPreset("Earth: the Blue Marble");
    },
  });
  flightHud.onPlace = () => placePanel.open();
  // the date and time (ui/timepanel.ts): the transport bar's clock, the pause menu
  const timePanel = new TimePanel({ tools, settings, sceneStart: () => sceneStart, toast: (x) => panel.toast(x) });
  // the weather (ui/weatherpanel.ts, PLAN-METEO W2): the HUD's Weather button, the pause menu
  const weatherPanel = new WeatherPanel({
    settings,
    place: () => camera.weatherPlace(),
    real: () => camera.weatherReal,
    changed: () => {
      metarTick();
      touch();
      scheduleUrlSave();
    },
  });
  flightHud.onWeather = () => weatherPanel.open();
  // TARS's tools (PLAN-TARS-AGENT A2): the whole game — the closures above, the panels, every key
  tarsTools = gameTools({
    settings,
    camera,
    tools,
    flight: () => tarsNow(),
    phase: () => phaseWatch.current,
    alerts: () => flightHud.alerts,
    log: () => gameLog.events,
    report: () => lastReport,
    mission: () => ({
      active: mission.active,
      phase: mission.active ? String(mission.phase) : null,
      caption: mission.active ? mission.captionText.filter(Boolean).join(" — ") : null,
    }),
    scenes: () => Object.keys(presets),
    pilotAuto,
    pilotHold,
    autoWhy: (a) => flightHud.autoWhy(a),
    setGear,
    toggleAssist,
    releaseControls,
    setWarp,
    realTimeSpeed: () => realTimeSpeed(settings),
    playPause,
    setMount,
    setSpectator,
    setView: (v) => setView(v),
    cinematic: (c) => (c === null ? camera.setCinematic(null) : camera.cinematic !== c && cinematic(c)),
    lookAt: (on) => settings.lookAt !== on && toggleLookAt(),
    telescope: (on) => settings.telescope !== on && toggleTelescope(),
    goTo,
    standOn,
    skyGoTo: (kind, i) => void skyGoTo(kind, i),
    map: (on, tab) => {
      if (flightHud.mapView !== on) flightHud.toggleMapView();
      if (on && tab) flightHud.setMapTab(tab);
    },
    hudDensity: (n) => flightHud.setDensity(n),
    open: (p) => {
      const open: Record<typeof p, () => void> = {
        settings: () => panel.toggle(true),
        place: () => placePanel.open(),
        time: () => timePanel.open(),
        weather: () => weatherPanel.open(),
        scenes: () => scenes.open(),
        photo: () => openPhoto(),
        controls: () => controlsScreen.open(),
        help: () => actions["btn-help"]!(),
        pause: () => keyActions.pause(new KeyboardEvent("keydown")),
        planner: () => openMissions(),
        sky: () => actions["btn-sky"]!(),
        camera: () => actions["btn-camera"]!(),
      };
      open[p]();
    },
    close: () => void closeTop(),
    changed: (keys) => {
      onSettingsChange(keys);
      refreshGui();
    },
    key: (a, arg) => keyActions[a]?.(new KeyboardEvent("keydown"), arg),
    applyScene: (name) => panel.applyScene(name),
    screenshot: () => savePNG(),
    say: (text) => voice.say({ text, speaker: "tars", priority: 2 }),
    memory: tarsMemory,
    now: () => performance.now(),
    display: tarsDisplay,
    screen: (name, slot = 0) => {
      const map = (tab?: "orbit" | "globe" | "map") => {
        if (!flightHud.mapView) flightHud.toggleMapView();
        if (tab) flightHud.setMapTab(tab);
      };
      if (name.startsWith("map_")) {
        map(name === "map_3d" ? "orbit" : name === "map_globe" ? "globe" : "map");
        return `map: ${name.slice(4)}`;
      }
      const pages: Partial<Record<string, import("./ui/tablet").TabletPage>> = {
        telemetry: "telemetry",
        approach_chart: "charts",
        flight_computer: "computer",
        ship: "ship",
        log: "log",
      };
      const page = pages[name];
      if (page) {
        map();
        tablet.setPage(page);
        if (page === "computer") flightComputer.show(true);
        return `tablet: ${page}`;
      }
      if (name === "flight_report") {
        if (!lastReport) throw new Error("no flight report yet (a landing or a docking makes one)");
        flightHud.showReport(lastReport);
        return `report: ${lastReport.title} — ${lastReport.letter}`;
      }
      // (a cockpit display's page: the cockpit view, the page on that display)
      const id = name.slice("cockpit_".length) as import("./ui/cockpitscreens").PageId;
      cockpitScreens.setPage(slot, id);
      settings.cockpitPages = cockpitScreens.pagesSetting();
      if (settings.shipMount !== "cockpit" && settings.shipMount !== "cabin") setMount("cockpit");
      scheduleUrlSave();
      return `cockpit display ${slot}: ${id}`;
    },
    propose: (p) => {
      tarsAgent.pending = p;
      tarsPanel.propose(p, tarsAnswer);
    },
    progress: (text) => tarsPanel.progress(text),
    triggers: tarsTriggers,
    sampler: tarsSampler,
    todos: (items) => tarsPanel.todos(items),
    skills: { save: saveSkill },
    subagents: (tasks, signal) => {
      tarsPanel.clearSubagents();
      tarsPanel.setTab("agents");
      return runSubagents(tasks, (m, fns, sig) => openRouter.complete(m, fns, { signal: sig }), tarsTools, {
        lang,
        signal,
        context: [{ role: "system", content: `Flight data now: ${JSON.stringify(tarsNow())}` }],
        onUpdate: (u) => tarsPanel.subagent(u),
      });
    },
  });
  // the real weather (metar.ts, PLAN-METEO W7): with "Real" chosen, the METAR of the runway's station nearest
  // the camera over the Earth (within 600 km), checked every 15 s, fetched each half hour; none, no network:
  // the fair weather
  const metarFeed = new MetarFeed();
  const metarTick = () => {
    if (settings.weather !== "real") return;
    // (a state with no report — set by a script: the flight lab's, an e2e's — kept: the feed replaced it
    // with the station's real METAR within 15 s, the fog or the storm asked flown in the day's weather)
    if (camera.weatherReal && camera.weatherReal.report === undefined) return;
    const p = camera.weatherPlace();
    const st = p && p.body === "earth" ? nearestStation(p) : null;
    if (!st) {
      camera.weatherReal = renderer.weatherReal = null;
      return;
    }
    void metarFeed.weather(st.icao).then((w) => {
      if (settings.weather !== "real" || camera.weatherReal?.report === w?.report) return;
      camera.weatherReal = renderer.weatherReal = w;
      touch();
    });
  };
  window.setInterval(metarTick, 15000);
  // the Kerr Bench (bench/runner.ts): __bh.bench, and its screen on …/#bench
  const bench = new KerrBench({
    settings,
    renderer,
    canvas,
    presets,
    preset: (name) => applyPreset(name),
    resize,
    refresh: () => {
      refreshGui();
      touch();
      touchDisplay();
    },
    touch,
    renderScale: () => renderScale,
    gpuPasses: () => {
      if (!renderer.prof.enabled) (renderer.prof.enabled = true), renderer.prof.reset();
      return renderer.prof.table().map((p) => ({ pass: p.label, ms: Math.round(p.ms * 100) / 100 }));
    },
    resetPasses: () => {
      renderer.prof.enabled = true;
      renderer.prof.reset();
    },
    gpuFrameMs: () => (renderer.prof.frames ? Math.round(renderer.prof.frameMs * 100) / 100 : null),
    lastStats: () => lastStats,
    firstImageAt: () => firstFrameAt,
    get version() {
      return appVersion;
    },
    game: tools,
    autopilot: () => camera.pilot.auto,
  });
  if (benchPage) {
    // (a benchmark's scenes are not the player's flight: nothing autosaved on this page)
    settings.autosave = false;
    void splash.gone.then(
      () =>
        new BenchScreen(bench, {
          onStart: () => renderer.prof.reset(),
          onClose: () => {
            history.replaceState(null, "", location.pathname);
            location.reload();
          },
        }),
    );
  }
  // the air's limits (flightair.ts): a point kept as the craft enters the air, the craft lost past them
  let entryPoint: GameSave | null = null;
  const craftLost = new CraftLost();
  events.on("airEntry", () => {
    entryPoint = tools.snapshot("before the entry");
  });
  events.on("craftLost", ({ why }) => {
    settings.animate = false;
    camera.onPilotMessage?.(why);
    craftLost.show(why, {
      resume: entryPoint
        ? () => {
            tools.load(entryPoint!, { quiet: true });
            camera.airFlight.reset(fleet.active);
            settings.animate = true;
            onSettingsChange(["animate"]);
          }
        : null,
      undamaged: () => {
        settings.damage = false;
        camera.airFlight.failure = null;
        settings.animate = true;
        onSettingsChange(["damage", "animate"]);
        panel.toast(t("Damage off — the air's limits are alarms only (Settings › Game › Ground & air)"));
      },
      restart: currentScene ? () => applyPreset(currentScene!) : null,
    });
  });
  addEventListener("pagehide", (e) => {
    if (!benchPage) writePrefs(settings);
    if (settings.autosave && firstFrame) tools.autosaveNow();
    gpuDiagnostics.flush();
    // (the GPU's memory — the Earth's maps are hundreds of MB — freed now, not when the old page is
    // collected: reloads in a row would stack them)
    if (!(e as PageTransitionEvent).persisted) renderer.release();
  });

  // the automation handle (devtools, tests, scripts): debug/bh.ts
  installBh({
    settings,
    renderer,
    camera,
    sim,
    tools,
    bench,
    mission,
    cockpitScreens,
    audio,
    voice,
    capcom,
    music,
    tars: { agent: tarsAgent, memory: tarsMemory, tools: () => tarsTools, spent: () => openRouter.spent },
    skyLoading,
    touch,
    resize,
    refreshGui,
    applyPreset,
    goTo,
    skyGoTo,
    updateChart,
    chart: () => chart,
    lastStats: () => lastStats,
    phase: () => phaseWatch.current,
    mapView: () => flightHud.mapCamera(),
    freeze: (on: boolean) => (frozen = on),
    spectate: (on: boolean) => {
      setSpectator(on);
      return camera.spectating;
    },
    pwa,
    forceScale: (x: number | null) => {
      forcedScale = x === null ? null : Math.min(Math.max(x, 0.25), 1);
      if (forcedScale === null) renderScale = 1;
      resize();
    },
  });

  // -------------------------------------------------------------------- loop
  const viewOverlay = new ViewOverlay(overlay, settings, camera, renderer);
  let last = performance.now();
  const loopIv: number[] = [];
  let renderedAt = 0;
  const fpsMeter = Object.assign(document.createElement("div"), { className: "fps-meter", hidden: true });
  fpsMeter.dataset.testid = "fps-meter";
  document.body.append(fpsMeter);
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  let hudTimer = 0;
  let frozen = false;
  /** the pause menu (or the title screen) open: the simulation holds, the image refines */
  let paused = false;
  const menuPad = new MenuPad();
  let lastStats: FrameStats | null = null;
  let saveTimer = 0;

  const loop = (now: number) => {
    if (startupFailed) return;
    requestAnimationFrame(loop);
    cpuProf.begin();
    const dt = Math.min(0.1, (now - last) / 1000);
    // (the flight's clock: the frame's time while it runs — frozen, only the steps move it)
    if (!frozen && !paused) advanceFrameClock(dt * 1000);
    // (the display's refresh: the median of the loop's last intervals — the frame budget is fitted to it)
    loopIv.push(now - last);
    if (loopIv.length > 31) loopIv.shift();
    if (loopIv.length >= 15) renderer.refreshMs = [...loopIv].sort((a, b) => a - b)[loopIv.length >> 1]!;
    last = now;
    fpsAcc += dt;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
      // (the frame rate in its corner, when asked — Settings › Render › Show the frame rate)
      fpsMeter.hidden = !settings.showFps;
      if (settings.showFps) fpsMeter.textContent = fps > 0 ? `${fps.toFixed(0)} fps · ${(1000 / fps).toFixed(1)} ms` : "— fps";
    }
    // (frozen: an automation steps the simulation itself, frame by frame — see __bh.step)
    // (frozen: an automation steps the simulation itself — __bh.step; an offline render or a video: the
    // scene held, or stepped by the video itself)
    // (a menu holding the game — the title, the pause, the missions: the pad moves in it, the flight
    // does not read it meanwhile)
    if (paused) menuPad.tick(camera.pad.poll(), now);
    if (!frozen && !paused && !renderer.offlineActive) {
      if (cpuProf.time("flight (camera.update)", () => sim.step(dt))) {
        changed = true;
        guiDirty = true;
      }
    }
    // what the renderer draws of the flight (the ship, its flames, the predicted path) — an offline job
    // or a video holds its own
    const pil = flying();
    const info = pil ? cpuProf.time("flight figures (flightInfo)", () => camera.flightInfo()) : null;
    if (!renderer.offlineActive && cpuProf.time("free-fall prediction", () => sim.applyRender(info))) changed = true;
    // (a take records what the view shows: the settings, the clocks, what the renderer draws of the flight)
    if (take.recording && !renderer.offlineActive) {
      const ok = take.capture(camera.viewSettings(), {
        time: sim.time,
        water: renderer.water.clock,
        ev: renderer.autoExposureEV,
        ship: renderer.shipPose,
        thrust: renderer.shipThrust,
        plasma: renderer.shipPlasma,
        path: renderer.cameraPath,
      });
      if (!ok) {
        renderDialog.takeChanged();
        panel.toast(tf("Take stopped at {0} s (10 minutes at most) — Render › Video renders it", take.seconds.toFixed(0)));
        transport?.update(true);
      }
    }
    // (the frame rate cap: no new image before its interval — less a refresh's fraction for the jitter)
    const capped =
      settings.fpsCap > 0 && !renderer.offlineActive && now - renderedAt < 1000 / settings.fpsCap - 0.25 * (renderer.refreshMs || 4);
    if (!capped) cpuProf.time("sky chart", () => updateChart());
    skyPanel.refresh();
    renderer.shipFocus = camera.spectating ? shipFocus() : null;
    renderer.rain = camera.rainView();
    const st = capped
      ? null
      : cpuProf.time("render (encode, submit)", () =>
          renderer.frame(camera.viewSettings(), sim.time, changed, sim.timeDirty, displayChanged),
        );
    if (!firstFrame && renderer.firstFrameDoneAt > 0) {
      firstFrame = true;
      firstFrameAt = renderer.firstFrameDoneAt;
      cancelWatchdog();
      gpuDiagnostics.ready();
      splash.firstImage();
      // (Jupiter's moons' ephemeris, when the start did not wait for it: now, the first image drawn)
      if (!jovianFirst) setTimeout(() => void loadEphemerides(ephemerisUrls(["jup"])), 2000);
    }
    if (st) {
      renderedAt = now;
      fpsN++;
      changed = false;
      sim.timeDirty = false;
      displayChanged = false;
      lastStats = st;
      if (st.offline) renderDialog.update(st.offline);
      if (renderer.completedFrames !== measuredFrames) {
        measuredFrames = renderer.completedFrames;
        gpuEma = gpuEma ? 0.9 * gpuEma + 0.1 * renderer.lastGpuMs : renderer.lastGpuMs;
      }
    }
    // (a compile or a stream begun or ended: the timings measured afresh — the image untouched)
    const calibrationReady = renderer.calibrationReady;
    if (calibrationReady !== calibrationWasReady) {
      calibrationWasReady = calibrationReady;
      gpuEma = 0;
      scaleHeld = idleAtCap = overAtFloor = 0;
      scaleMs.clear();
      renderer.resetQualityTiming();
    }
    // (the camera held for 0.4 s: the full scale, the image refined there; moving again: the motion's)
    const held = lastStats?.phase === "converging" || lastStats?.phase === "converged";
    heldFor = held ? heldFor + dt : 0;
    movingFor = held ? 0 : movingFor + dt;
    const dynOn = dynamicResolutionOn(settings) && !renderer.offlineActive && forcedScale === null;
    if (forcedScale !== null && renderScale !== forcedScale) {
      renderScale = forcedScale;
      resize();
    }
    if (dynOn && heldFor > 0.4 && renderScale < 1) {
      movingScale = renderScale;
      renderScale = 1;
      gpuEma = 0;
      scaleHeld = 0;
      resize();
    } else if (movingFor > 0.15 && movingScale > 0) {
      if (dynOn && renderScale !== movingScale) {
        renderScale = movingScale;
        gpuEma = 0;
        scaleHeld = 0;
        resize();
      }
      movingScale = 0;
    }
    // (every 1.5 s in motion, by eighths, between half the pixel ratio and all of it)
    scaleTimer += dt;
    if (scaleTimer > 1.5) {
      scaleTimer = 0;
      const on = dynOn && !held;
      const block = renderer.realtimeBlockNow;
      const now = performance.now();
      scaleHeld += 1.5;
      const settled = scaleHeld >= 3;
      if (on && settled && gpuEma > 0) scaleMs.set(renderScale, { ms: gpuEma, at: now });
      const known = (x: number) => {
        const m = scaleMs.get(x);
        return m && now - m.at < 30000 ? m.ms : undefined;
      };
      const lower = Math.max(0.5, renderScale - 0.125),
        higher = Math.min(1, renderScale + 0.125);
      const kl = known(lower),
        kh = known(higher);
      const budget = renderer.frameBudget(settings);
      let want = renderScale;
      if (forcedScale !== null) want = forcedScale;
      else if (!dynOn) want = 1;
      else if (held) want = renderScale;
      else if (!settled) want = renderScale;
      // (down once the blocks are coarse: at the same rays a finer block on a smaller image is no better in
      // motion — measured, equal on Kerr, 2.6 dB worse on Saturn's stars and edges —, the full scale kept)
      else if (gpuEma > 1.2 * budget && block >= 4 && (kl === undefined || kl < 0.9 * gpuEma)) want = lower;
      // (up when the larger scale was measured within the budget, or no slower; not measured lately, when
      // the frame grown as the pixels would stay within it)
      else if (
        higher > renderScale &&
        (kh !== undefined ? kh <= Math.max(0.85 * budget, 1.1 * gpuEma) : gpuEma * (higher / renderScale) ** 2 < 0.85 * budget)
      )
        want = higher;
      if (want !== renderScale) {
        renderScale = want;
        gpuEma = 0; // (measured afresh at the new scale)
        scaleHeld = 0;
        resize();
      }
      // (the hardware's tier measured, not guessed: at full scale, fine blocks, the GPU's work under half
      // the budget for 12 s while the tier holds something back — the image's pixels, the precision, or
      // a weak tier's Earth maps — one tier up, its caps raised and remembered for this adapter; the
      // scale governor above brings it down again if the larger image does not fit. Never while a Kerr
      // Bench runs: quality-policy.ts)
      const capped =
        on && cappedRatio(settings.pixelRatio, canvas.clientWidth, canvas.clientHeight, renderer.tier.capMpx) < settings.pixelRatio - 1e-3;
      // (block ≤ 4, not ≤ 2: on a fast GPU in a heavy scene the blocks can settle at 3–4 with the
      // GPU idle — the promotion would never fire; and a minute's cooldown after a demotion)
      idleAtCap = promotionEligible({
        automatic: on,
        benching: bench.running,
        stable: renderer.calibrationReady && settled,
        pixelCapped: capped,
        precisionCapped: renderer.effectiveQuality(settings).capped,
        tier: renderer.tier,
        scale: renderScale,
        block,
        sinceDemotionMs: now - demotedAt,
        measuredMs: gpuEma,
        budgetMs: budget,
      })
        ? idleAtCap + 1.5
        : 0;
      if (idleAtCap >= 12) {
        const up = promoted(renderer.tier);
        idleAtCap = 0;
        if (up) {
          renderer.setTier(up);
          scaleMs.clear();
          gpuEma = 0;
          scaleHeld = 0;
          resize();
          if (renderer.adapter) rememberLevel(adapterId(renderer.adapter), up);
        }
      }
      // (and the other way — the promotion's missing half (plan §3.4): over the budget and a half
      // at the coarsest block and the smallest scale, for 12 s — one tier down, its cap lowered)
      overAtFloor = demotionEligible({
        automatic: on,
        benching: bench.running,
        stable: renderer.calibrationReady && settled,
        scale: renderScale,
        block,
        measuredMs: gpuEma,
        budgetMs: budget,
      })
        ? overAtFloor + 1.5
        : 0;
      if (overAtFloor >= 12) {
        const down = demoted(renderer.tier);
        overAtFloor = 0;
        if (down) {
          renderer.setTier(down);
          scaleMs.clear();
          gpuEma = 0;
          scaleHeld = 0;
          demotedAt = now;
          resize();
          if (renderer.adapter) rememberLevel(adapterId(renderer.adapter), down);
        }
      }
    }
    cpuProf.time("overlay (guide, marker)", () => viewOverlay.draw(chart && !renderer.offlineActive ? chart : null, chartKey));
    applyTuning(settings);
    cpuProf.time("game tools window", () => toolsWin.tick());
    saveTimer += dt;
    // (a setting changed: the player's own kept two seconds on, the game saved with them)
    const soon = saveSoon && saveTimer > 2;
    if (soon && !benchPage) writePrefs(settings); // (a benchmark's settings are not the player's)
    if (settings.autosave && firstFrame && !renderer.offlineActive && (saveTimer > settings.autosaveEvery || soon)) {
      saveTimer = 0;
      cpuProf.time("autosave", () => tools.autosaveNow());
    }
    if (soon) saveSoon = false;
    if (flightHud.visible !== pil) {
      flightHud.show(pil);
      transport!.mount(pil ? flightHud.transportSlot : tpDock, pil);
    }
    // (a touch screen: the stick, the throttle, roll — outside, free, the fingers move the camera; the
    // map open, they move the map — the stick would sit on the flight computer's panel)
    touchFlight.update(
      pil &&
        coarse.matches &&
        camera.outsideView() !== "free" &&
        !flightHud.planning &&
        !flightHud.mapView &&
        !document.body.classList.contains("hide-ui"),
    );
    let status: RangerStatus | null = null;
    if (pil && info) {
      // the Ranger's status (the telemetry; its changes go to the journal)
      try {
        status = cpuProf.time("Ranger status", () => rangerStatus(settings, camera, info, sim.time));
        tools.watch(status);
      } catch (e) {
        caught("Ranger status", e);
      }
    }
    phaseWatch.update(
      phaseOf({
        piloting: camera.piloting,
        cinematic: camera.cinematic,
        offline: renderer.offlineActive,
        landed: !!info?.landed,
        docked: !!info?.links.length,
        hold: camera.pilot.hold,
        auto: camera.pilot.auto,
        entry: camera.entryRun?.phase ?? null,
        inAir: !!info?.air?.inAir,
        status: status?.status ?? null,
      }),
      frameNow() / 1000,
    );
    // (the keys that matter now: not over a menu, a clean HUD or a hidden interface)
    keyHints.update(
      settings.keyHints && !paused && !document.body.classList.contains("hide-ui") && (!pil || flightHud.density < 2)
        ? phaseWatch.current
        : null,
      now,
    );
    if (pil && info) {
      // the cockpit's screens: the telemetry, drawn (a few times a second, while the cabin is seen)
      if (
        renderer.ship.cabinShown &&
        cockpitScreens.draw({
          info,
          status,
          settings,
          time: sim.time,
          runway: camera.runwayView(),
          chrono:
            cockpitChrono.running || cockpitChrono.seconds() > 0 ? { s: cockpitChrono.seconds(), running: cockpitChrono.running } : null,
        })
      ) {
        renderer.ship.updateScreens(cockpitScreens.canvas);
        renderer.cockpitGlow = cockpitScreens.glow;
      }
      // the cockpit's dashboard: the local up and the motion on the ship's axes, the speed, the height
      {
        const S = info.S as number[][];
        const toShip = (v: number[] | null | undefined) =>
          v ? ([0, 1, 2].map((i) => S[0]![i]! * v[0]! + S[1]![i]! * v[1]! + S[2]![i]! * v[2]!) as [number, number, number]) : null;
        const up = toShip(info.dirs.radialOut as number[] | null),
          fwd = toShip(info.dirs.prograde as number[] | null);
        renderer.cockpitDash = {
          up: up ?? [0, 1, 0],
          fwd: fwd ?? [0, 0, 1],
          speed: (status?.speed ?? 0) / 1000,
          alt: status?.altKm ?? 0,
          time: performance.now() / 1000,
        };
        // (the Ranger's landing gear, drawn when out — its oleos as the gear's physics has them)
        {
          const legs = GEARS.ranger!.legs;
          const gl = camera.gearLast?.legs;
          renderer.shipGear = {
            ext: settings.vessel === "ranger" ? camera.gearExt : 0,
            comp: legs.map((L, k) => Math.min(Math.max(gl?.[k]?.comp ?? 0, 0), L.stroke)),
          };
        }
        // (the cockpit's controls: each where the flight has it, lit by its mode — PLAN-COCKPIT)
        // (each moving part travelling there: a lever moved by a key or an autopilot seen going — K5)
        if (renderer.ship.cabinShown)
          renderer.cockpitControls = poseData(
            cockpitTravel.step(
              controlStates(camera, settings, cockpitChrono, {
                hover: camera.cockpit?.input.hover ?? null,
                pressed: camera.cockpit?.input.pressed ?? null,
              }),
              dt,
            ),
          );
      }
      // (drawn with the image: on the loop's turns that rendered one — the markers then match the view
      // shown, not a pose one or two frames ahead of it)
      // (the benchmark measures the image alone: the HUD hidden and not drawn)
      if ((st || !flightHud.drawn) && !bench.running)
        cpuProf.time(
          "flight HUD (total)",
          () => (
            (flightHud.spectating = camera.spectating ? { at: renderer.shipPlace?.t ?? null, follow: camera.spectatorFollow } : null),
            flightHud.update({ ...info, probe: renderer.planetProbes.get(settings.target) ?? null, status }, sim.time)
          ),
        );
      // (the landing's callouts — PLAN-TARS T2 —: the radio heights, minimums, sink rate, the warnings said)
      if (settings.ship && camera.piloting && !camera.spectating) {
        const sf = info.surface;
        const app = camera.entryRun?.app;
        for (const l of callouts.update({
          inAir: !!sf && !sf.landed && !sf.rolling,
          agl: sf?.alt ?? Number.NaN,
          vz: sf?.vVert ?? 0,
          final: !!app?.final,
          hp: app?.hp,
          dh: RUNWAY_DH,
          alerts: flightHud.alerts,
          now: performance.now(),
          auto: camera.pilot.auto,
        }))
          voice.say(l);
      }
      // (mission control — PLAN-TARS T3 —: its lines on the flight's moments, each when it arrives)
      if (settings.ship && camera.piloting && !camera.spectating && status) {
        const wall = performance.now();
        const Msec = 4.925490947e-6 * settings.massSolar;
        if (wall - earthLight.at > 2000) {
          const nav = status.side === "ours" ? camera.ourNav(cameraFrame(settings)) : null;
          const E = nav ? ourState("earth", nav.t).pos : null;
          earthLight = {
            s: nav && E ? Math.hypot(nav.X[0] - E[0], nav.X[1] - E[1], nav.X[2] - E[2]) * Msec : 0,
            at: wall,
          };
        }
        const A = info.air;
        const rv = camera.entryRun?.app?.final ? camera.runwayView() : null;
        const ph = phaseWatch.current;
        capcomDue.push(
          ...capcom.update({
            now: wall,
            side: status.side,
            stage: ph?.stage ?? null,
            mode: ph?.mode ?? null,
            callsign: VESSELS[fleet.active].name,
            orbit: status.orbit ? { apKm: status.orbit.apKm, peKm: status.orbit.peKm } : null,
            entry: camera.entryRun?.phase ?? null,
            site: camera.entryRun?.site?.name ?? null,
            final: rv ? { rwy: rv.rwy, wind: rv.wind ? { from: rv.wind.from, u10: rv.wind.u10 } : null } : null,
            plasma: A?.inAir ? Math.min(Math.max((Math.log10(Math.max(A.heat, 1)) - 4.6) / 1.7, 0), 1) : 0,
            stopped: !!camera.ourLanded && !camera.rolling,
            docked: !!info.links.length,
            grade: lastGrade,
            failed: !!camera.airFlight.failure,
            lightS: earthLight.s,
            warp: settings.timeSpeed * Msec,
          }),
        );
        for (let k = capcomDue.length - 1; k >= 0; k--) if (capcomDue[k]!.at <= wall) voice.say(capcomDue.splice(k, 1)[0]!.line);
        // (the score: the moment's piece — none: silence)
        const ph2 = phaseWatch.current;
        const moment = score.moment({
          now: wall / 1000,
          mode: ph2?.mode ?? null,
          stage: ph2?.stage ?? null,
          side: status.side,
          plasma: A?.inAir ? Math.min(Math.max((Math.log10(Math.max(A.heat, 1)) - 4.6) / 1.7, 0), 1) : 0,
          final: !!camera.entryRun?.app?.final,
          agl: info.surface?.alt ?? Number.POSITIVE_INFINITY,
          r: info.region === "hole" ? info.r : Number.POSITIVE_INFINITY,
          body: status.soi ?? null,
        });
        music.update(settings.sound && settings.music ? moment : null);
        // (TARS — PLAN-TARS T5b —: what he knows of the flight, for when he is asked; his remarks unasked)
        const fuel = info.engine.fuel;
        tarsView = {
          body: status.soiName ?? null,
          altKm: Number.isFinite(status.altKm) ? status.altKm : null,
          status: status.label ?? null,
          landed: !!camera.ourLanded,
          docked: !!info.links.length,
          speed: Number.isFinite(status.speed) ? status.speed : null,
          fuel: fuel ? fuel.fraction : null,
          dv: fuel ? fuel.dvLeft * C_MPS : null,
          target: status.target ? { name: status.target.name, distKm: status.target.distKm } : null,
          next: status.next ? { kind: status.next.kind, name: status.next.name, inS: status.next.inS } : null,
          stage: ph2?.stage ?? null,
          auto: camera.pilot.auto,
          dtau: status.side === "gargantua" ? ((info as { dtau?: number }).dtau ?? null) : null,
        };
        const said = (m: TarsMoment | null) => {
          if (!m || !settings.tarsRemarks) return;
          // (online: Jev decides whether it is worth saying, GLM says it; offline: his written lines)
          if (online()) {
            const st = tarsView!;
            void tarsOnline
              .remark(
                m,
                st,
                tarsPersonality(),
                lang,
                wall,
                flightHud.alerts.map((a) => a.id),
              )
              .then((r) => r && voice.say({ text: r, speaker: "tars", priority: 3, ttl: 20_000 }));
            return;
          }
          const r = tars.remark(m, wall, tarsPersonality());
          if (r) voice.say({ text: r, speaker: "tars", priority: 3, ttl: 20_000 });
        };
        // (online, every two minutes of flight: a look — the pilot stuck, a mistake — Jev deciding)
        if (online() && settings.tarsRemarks && wall - tarsLook > 120_000 && ph2?.mode === "flight") {
          tarsLook = wall;
          void tarsOnline
            .remark(
              "routine look",
              tarsView!,
              tarsPersonality(),
              lang,
              wall,
              flightHud.alerts.map((a) => a.id),
            )
            .then((r) => r && voice.say({ text: r, speaker: "tars", priority: 3, ttl: 20_000 }));
        }
        if (moment !== tarsMoment) {
          said(moment === "liftoff" || moment === "wormhole" || moment === "gargantua" || moment === "miller" ? moment : null);
          tarsMoment = moment;
        }
        if (fuel && fuel.fraction < 0.15 && !tarsFuelLow) said("fuel-low");
        tarsFuelLow = !!fuel && fuel.fraction < 0.15;
        if (info.links.length && !tarsDocked) said("docked");
        tarsDocked = !!info.links.length;
        // (the blackout: the static on the radio while it lasts)
        if (capcom.blackout !== staticOn && settings.sound) sound.radioNoise((staticOn = capcom.blackout) ? 1 : 0);
      }
      // (the flight's recorder — game/recorder.ts —: the tablet's TELEMETRY page, its CSV)
      if (settings.ship && camera.piloting && status && info.region !== "hole") {
        const A = info.air;
        recorder.push({
          t: sim.time * M_SECONDS,
          alt: status.altKm * 1000,
          speed: shownSpeed(info).v * C_MPS,
          vz: status.vVert,
          g: A?.g ?? 0,
          q: A?.q ?? 0,
          mach: A?.mach ?? 0,
          heat: A?.heat ?? 0,
          throttle: info.throttle,
          dv: camera.spent * C_MPS,
          fuel: info.engine.fuel ? info.engine.fuel.fraction : null,
        });
      }
      flightComputer.show(flightHud.mapView);
      tablet.setVisible(flightHud.mapView);
      tablet.tick(now);
      flightComputer.update();
      cpuProf.time("sound", () =>
        // (a spectator far from the ship: its engines, its air out of earshot — two kilometres)
        audio.update(dt, {
          flying: !camera.spectating || (renderer.shipPlace?.dist ?? Infinity) < 2000,
          live: settings.animate && !frozen,
          info,
          status,
          fired: camera.pilot.fired,
          // (the camera's pose on the ship — or the spectator's view of it —: the engine placed, S1)
          pose: camera.spectating
            ? renderer.shipPlace
            : renderer.shipPose
              ? shipToCamera(renderer.shipPose, settings.shipLookYaw, settings.shipLookPitch)
              : null,
          spectator: camera.spectating,
          thrust: renderer.shipThrust,
          gear: camera.gearLast,
          groundWind: camera.weatherNow?.wind.u10 ?? 0,
        }),
      );
    } else {
      flightComputer.show(false);
      tablet.setVisible(false);
      audio.update(dt, { flying: false, live: false, info: null, status: null, fired: camera.pilot.fired });
    }
    hudTimer += dt;
    if (hudTimer > 0.15 && lastStats) {
      hudTimer = 0;
      document.body.classList.toggle("glass-blur", settings.glassBlur);
      camPanel!.refresh();
      syncCameraButton();
      transport!.update();
      cpuProf.time("panel & readouts", () => {
        updateHUD(lastStats!, fps);
        if (guiDirty) {
          refreshGui();
          guiDirty = false;
          scheduleUrlSave();
        }
      });
    }
    cpuProf.end(!!st);
  };
  // at start: a shared moment (#save=…), a scene named in the URL (#scene=game:interstellar), else the
  // flight saved last time; then the URL is left clean (settings from an old link were read above) —
  // once the ephemerides are in (a ship placed near a planet before would find it moved under it)
  await ephemerides;
  {
    const hash = location.hash;
    const scene = new URLSearchParams(hash.slice(1)).get("scene");
    let shared: GameSave | null = null;
    try {
      shared = saveFromHash(hash);
    } catch (e) {
      panel.toast(tf("That link's saved game could not be read: {0}", (e as Error).message));
    }
    const last = autosave.get();
    // (the flight saved last loaded behind the title screen: Continue only lifts it)
    let resumed: string | null = null;
    try {
      if (shared) panel.toast(tf("Shared flight: {0}", tools.load(shared)));
      else if (scene && presets[scene]) applyPreset(scene);
      else if (hash.length <= 1 && last && settings.autosave) {
        tools.load(last, { quiet: true });
        resumed = last.summary;
      }
    } catch (e) {
      console.warn("Could not restore the saved game:", e);
    }
    // the title screen (ui/title.ts), unless the link named a scene, a moment or the benchmark
    // the missions (ui/missions.ts): from the title screen; back, the title again
    const missionSelect = new MissionSelect({
      launch: (scene) => {
        paused = false;
        started = true;
        panel.applyScene(scene);
      },
      back: () => titleScreen?.open(),
    });
    // (Continue: the flight resumed behind the screen at launch; later — the screen opened from the
    // pause menu — the game left there)
    let started = false;
    titleScreen = new TitleScreen({
      saved: () => (started ? tools.snapshot("now").summary : resumed),
      continue: () => (started = true),
      hold: (on) => {
        paused = on;
        touch();
      },
      missions: () => {
        paused = true; // (the scene behind held while one chooses)
        missionSelect.open();
      },
      explore: () => {
        started = true;
        scenes.open();
      },
      photo: () => {
        started = true;
        openPhoto();
      },
      settings: () => {
        started = true;
        panel.toggle(true);
      },
      bench: () => {
        location.hash = "bench";
        location.reload();
      },
      version: () => appVersion,
    });
    // (after the title, the game's own state: a flight resumed or not, the same)
    if (!shared && !(scene && presets[scene]) && !benchPage) {
      titleScreen.open();
      void splash.gone.then(() => titleScreen?.focusFirst());
    } else started = true;
    if (hash.length > 1) history.replaceState(null, "", location.pathname + location.search);
  }
  // (the first frame once the fonts are in — at most a second and a half: a slow network draws in the
  // fallbacks, then redraws; not awaited, the rest of the set-up runs now)
  void Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => {
    last = performance.now(); // (the first frame's step: from now, not from the set-up)
    requestAnimationFrame(loop);
  });

  /** Camera position for the HUD: distance to the hole, or ℓ through the wormhole. */
  function where() {
    if (!settings.wormhole || settings.anchor === "hole") return `r = ${settings.distance.toFixed(2)} M`;
    const side = settings.whL < 0 ? t("our side") : t("Gargantua side");
    return `ℓ = ${settings.whL.toFixed(2)} M (${side})`;
  }

  // -------------------------------------------------------------------- HUD
  const statusEl = $("status");
  const statsEl = $("stats");
  const readoutEl = $("readouts");
  const progressEl = $("hud-progress");
  const HUD_KEY = "kerr.hud";
  function setHudOpen(open: boolean) {
    $("hud").classList.toggle("open", open);
    $("hud-toggle").setAttribute("aria-expanded", String(open));
    store.set(HUD_KEY, open ? "1" : "0");
    if (open && lastStats) updateHUD(lastStats, fps);
  }
  if (store.get(HUD_KEY) === "1") setHudOpen(true);

  /** Compact status (phase, what the camera does) and, unfolded, the details and readouts. */
  function updateHUD(st: FrameStats, fpsNow: number) {
    let phase: string;
    let progress = 0;
    if (st.phase === "offline" && st.offline) {
      phase = `<span class="phase cv">${tf("Rendering {0} %", (st.offline.progress * 100).toFixed(0))}</span>`;
      progress = st.offline.progress;
    } else if (st.phase === "realtime") {
      // (the frame rate is a developer's figure: on the dev server only — F2 › Perf has it everywhere)
      phase = `<span class="phase rt">${t("Live")}${DEV || settings.showFps ? ` · ${fpsNow.toFixed(0)} fps` : ""}</span>`;
    } else if (st.phase === "converging") {
      phase = `<span class="phase cv">${tf("Refining · {0} / {1}", Math.floor(st.spp), st.targetSpp ?? settings.targetSpp)}</span>`;
      progress = st.spp / (st.targetSpp ?? settings.targetSpp);
    } else {
      phase = `<span class="phase ok">${t("Converged")}</span>`;
      progress = 1;
    }
    const chips: string[] = [];
    if (camera.cinematic)
      chips.push(
        `<span class="chip hot">${camera.cinematic === "orbit" ? t("Auto-orbit") : camera.cinematic === "dive" ? t("Dive") : t("Journey")}</span>`,
      );
    if (camera.flyMode) chips.push(`<span class="chip hot">${tf("Fly ×{0}", camera.flySpeed.toFixed(1))}</span>`);
    else if (!settings.ship) {
      const rs = camera.rigStatus();
      const carried = rs ? ` · ${tf("on {0}, {1}", BODY_NAMES[rs.body], fmtHeight(rs.h * 1476.625 * settings.massSolar))}` : "";
      const v = view();
      const glyph = { orbit: "↻", free: "✦", follow: "⇢", tripod: "⊥", fall: "↓" }[v];
      const aimed = v === "orbit" || settings.lookAt ? ` ${BODY_NAMES[settings.target]}` : "";
      chips.push(
        `<span class="chip${v === "fall" ? " hot" : ""}">${glyph} ${v === "fall" && camera.landed ? t("Landed") : VIEW_LABEL[v]}${aimed}${carried}</span>`,
      );
    }
    if (settings.telescope)
      chips.push(
        `<span class="chip">🔭 ${settings.fov < 1 ? `${(settings.fov * 60).toFixed(settings.fov < 0.1 ? 1 : 0)}′` : `${settings.fov.toFixed(1)}°`}</span>`,
      );
    if (camera.pad.connected) chips.push(`<span class="chip" title="${t("Game controller")}">🎮</span>`);
    // (the quality kernel failed: the image refines on fixed steps — the error control unavailable)
    if (st.qualityError) chips.push(`<span class="chip hot">⚠ ${t("Fixed-step refinement (error control unavailable)")}</span>`);
    statusEl.title = st.qualityError ?? "";
    statusEl.innerHTML = phase + chips.join("");
    progressEl.firstElementChild!.setAttribute("style", `width:${(Math.min(progress, 1) * 100).toFixed(1)}%`);
    progressEl.classList.toggle("done", progress >= 1 && st.phase !== "offline");

    if (!$("hud").classList.contains("open")) return;
    const lines = [
      `<b>${st.width}×${st.height}</b>${renderer.hdr ? " · HDR" : ""} · gpu ${st.gpuMs.toFixed(1)} ms · ` +
        (st.phase === "realtime" ? `1 ray / ${st.block}×${st.block} px` : `${st.spp.toFixed(1)} spp`),
      `${where()} · θ = ${settings.inclination.toFixed(1)}° · t = ${sim.time.toFixed(0)} M${settings.animate ? "" : ` (${t("paused")})`}`,
    ];
    if (st.phase === "offline" && st.offline)
      lines.unshift(
        `${t("offline")} ${st.offline.width}×${st.offline.height} · ${st.offline.spp.toFixed(1)} / ${st.offline.targetSpp} spp`,
      );
    if (camera.gravity) {
      const v = Math.hypot(settings.velR, settings.velT, settings.velP);
      lines.push(`${t("free fall")} · v = ${v.toFixed(3)} c · τ = ${camera.properTime.toFixed(1)} M`);
    } else if (camera.riding > 0.01) lines.push(`${t("co-moving with the star")} · β = ${Math.abs(settings.velP).toFixed(3)} c`);
    else if (settings.motion === "barycentric") lines.push(t("at rest in the centre-of-mass frame"));
    for (const g of camera.pad.list())
      lines.push(tf("controller: {0} · {1} · {2} buttons", g.id, g.mapping || t("no mapping"), g.buttons.length));
    statsEl.innerHTML = lines.join("<br>");
    const cam = cameraFrame(settings);
    readoutEl.innerHTML = physicalReadouts(settings.spin, settings.massSolar, cam)
      .map((r) => `<div class="row"${r.hint ? ` title="${r.hint}"` : ""}><span>${r.label}</span><span>${r.value}</span></div>`)
      .join("");
    $("spin-badge").textContent =
      `a = ${settings.spin.toFixed(3)} · r₊ = ${horizon(settings.spin).toFixed(3)} M · ISCO = ${isco(settings.spin).toFixed(3)} M`;
  }

  // -------------------------------------------------------------------- tooltips (toolbar, HUD)
  const tip = $("tip");
  let tipTimer = 0;
  const showTip = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || matchMedia("(hover: none)").matches) return;
    const key = el.dataset.key;
    tip.innerHTML = "";
    tip.append(text);
    void key; // (no keys shown on the HUD: the help lists them)
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const above = r.top > innerHeight / 2;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
    tip.style.top = `${above ? r.top - t.height - 8 : r.bottom + 8}px`;
    tip.classList.add("show");
  };
  const hideTip = () => {
    clearTimeout(tipTimer);
    tip.classList.remove("show");
    tip.hidden = true;
  };
  // (delegated: the panels built later — the transport bar, the camera panel — have theirs too; the
  // flight HUD shows its own)
  for (const el of document.querySelectorAll<HTMLElement>("[data-tip]"))
    if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", el.dataset.tip!);
  let tipEl: HTMLElement | null = null;
  // (clicked: no tip for that element until the pointer leaves it — a button redrawn under the
  // pointer, its label changed, would otherwise bring its tip back over what it opened)
  let tipClicked: HTMLElement | null = null;
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
    if (el === tipEl) return;
    hideTip();
    if (el !== tipClicked) tipClicked = null;
    tipEl = el && el !== tipClicked && !el.closest(".fl-root") ? el : null;
    if (!tipEl) return;
    if (!tipEl.getAttribute("aria-label")) tipEl.setAttribute("aria-label", tipEl.dataset.tip!);
    const target = tipEl;
    tipTimer = window.setTimeout(() => target.isConnected && showTip(target), 280);
  });
  document.addEventListener("pointerdown", (e) => {
    hideTip();
    tipClicked = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
    tipEl = null;
  });

  // -------------------------------------------------------------------- first-run hint
  const HINT_KEY = "kerr.hint-seen";
  const hintSeen = store.get(HINT_KEY) === "1";
  if (!hintSeen && !matchMedia("(hover: none)").matches) {
    const hint = $("hint");
    const dismiss = () => {
      hint.classList.add("gone");
      setTimeout(() => (hint.hidden = true), 700);
      store.set(HINT_KEY, "1");
      canvas.removeEventListener("pointerdown", dismiss);
      canvas.removeEventListener("wheel", dismiss);
    };
    setTimeout(() => (hint.hidden = false), 1200);
    setTimeout(dismiss, 12000);
    canvas.addEventListener("pointerdown", dismiss);
    canvas.addEventListener("wheel", dismiss);
  }
}

main();
