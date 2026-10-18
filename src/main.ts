import { SceneryHitboxes } from "./ui/scenery-hitboxes";
import { planetFrame, toLocal } from "./landing";
import { cartToGeodetic, flatteningOf, WGS84_A, WGS84_F } from "./system/ellipsoid";
import { setSceneryContact } from "./system/scenery-contact";
import { setDrawnRefractivity } from "./system/refraction";
import { projectLook } from "./shadow";
import { groundVelocity } from "./system/our-surface";
import { CharacterHud } from "./ui/characterhud";
import { FootHud, type CompassMark } from "./ui/foothud";
import { AtlasPage, type AtlasAction, type AtlasPlace } from "./ui/atlas";
import { azAltAt } from "./eclipse/earth-moon";
import { LiveCapture } from "./ui/livecapture";
import { lensMm } from "./photo/skyevents";
import { SkyEventsPage, type SkyPlace } from "./ui/skyevents";
import { POIS, searchPois } from "./game/pois";
import { geocode, parseCoords } from "./game/geocode";
import { LANDSCAPES } from "./system/landscapes";
import type { MapBody } from "./ui/mapview";
import { poseData } from "./cockpit/controls";
import { GEARS } from "./gear";
import { JetPoser } from "./f35/pose";
import { Pcd } from "./f35/pcd";
import { pcdData } from "./f35/cockpit";
import { alertsOf } from "./ui/hud/alerts";
import { dateOf } from "./game/tools";
import { ControlTravel, controlStates } from "./cockpit/state";
import { cockpitAct, controlTip, type CockpitDeps } from "./cockpit/actions";
import { Chrono } from "./cockpit/chrono";
import { CockpitInput } from "./cockpit/input";
import { cockpitTarget } from "./cockpit/pointer";
import { CockpitTip } from "./ui/cockpit-tip";
import { cockpitHull } from "./system/collide";
import { afterSkyPrefetch, prefetchSkyAssets, Renderer, type FrameStats, type OfflineStatus } from "./renderer";
import { swappable } from "./util/swappable";
import { bootMark, bootReport, bootWatchStop } from "./boot-timeline";
import { Intro, introBuild } from "./intro/intro";
import { downloadGpuDiagnostic, globalErrorRouter, gpuDiagnostics } from "./gpu-diagnostics";
import { horizon, isco } from "./physics";
import { cameraFrame, repPose, setHolePose, setHomePose, switchAnchor } from "./camera";
import { bodyView, earthGround, earthStart, ourState, referenceBody, saturnDeparture, tiltAway } from "./system/our-side";
import { fromBodyFixed, toBodyFixed } from "./system/our-surface";
import { lin as lin3, sub as sub3 } from "./math/vec3";
import { theirFlightPose, theirGroundPose, theirOrbitPose, universeOf } from "./game/place";
import { CameraController, isTyping } from "./controls";
import { effectiveBindings, freeCameraKeys } from "./input/bindings";
import { matchKey, type KeyAction } from "./input/keymap";
import { installBh } from "./automation";
import { netParams } from "./net/load";
import { NetPanel } from "./ui/netpanel";
import { NetMatch } from "./ui/netmatch";
import { NetSession } from "./ui/netsession";
import { NetVoice } from "./ui/netvoice";
import type { JetInputs } from "./f35/pose";
import { installPwa } from "./pwa";
import { PauseMenu } from "./ui/pause";
import { ControlsScreen } from "./ui/controls-screen";
import { PadsScreen } from "./ui/pads-screen";
import { TitleScreen } from "./ui/title";
import { MissionSelect } from "./ui/missions";
import { PlacePanel } from "./ui/placepanel";
import { RoutePanel } from "./ui/routepanel";
import { CHALLENGES } from "./game/challenges";
import { SCENARIOS } from "./game/scenarios";
import { bests as challengeBests } from "./controller/challenge";
import { type Layer as MusicLayer, LAYERS as MUSIC_LAYERS, THEMES as MUSIC_THEMES } from "./audio/music/themes";
import { FLIGHT_HOURS, FLIGHT_STARTS, FLIGHT_WEATHER, FlightHub, flightFields, type HubHost, prepareFlight } from "./ui/flighthub";
import { keepMission, MissionEditor, missionLink, myMissions } from "./ui/missioneditor";
import { missionFromHash } from "./game/missionedit";
import { MODES as JET_MODES } from "./game/jetmodes";
import { closeDebrief, debriefInstr, flightSchool, type InstructorHost, InstructorPanel } from "./ui/instructor";
import { type LessonId, LESSONS } from "./game/lessons";
import { fromRunway } from "./game/ils";
import { VIEWS as EXCEPTIONAL_VIEWS, viewSpec } from "./game/views";
import { openViews, type ViewsHost } from "./ui/views";
import { ROLE_VOICE, roleOfLine } from "./game/radio";
import { threatRole } from "./game/threats";
import { findRunway, runwayOf } from "./controller/ils";
import { MissionMap } from "./ui/missionmap";
import { briefMission, debriefMission, flyMission, MissionHud } from "./ui/airmission";
import { AIR_MISSIONS } from "./game/airmissions";
import { checkMission, type MissionSpec } from "./game/mission";
import { ChallengePanel, type ChallengeHost, flyChallenge, flyFight, flyFigure } from "./ui/challengepanel";
import { aeroBests } from "./controller/aerobatics";
import { FIGURE_ORDER, FIGURES, type FigureId } from "./game/aerobatics";
import { TimePanel } from "./ui/timepanel";
import { WeatherPanel } from "./ui/weatherpanel";
import { RealWeather } from "./realweather";
import { EclipsePage } from "./ui/eclipses";
import { type MxHost, runExposures } from "./photo/multiexposure";
import {
  analemmaMarks,
  analemmaPlan,
  eclipseLayout,
  eclipsePlan,
  type EclipseSeqOptions,
  type Framing,
  MX_EV,
  outsideView,
  placeFrames,
  skyMarks,
} from "./photo/plans";
import { type MoonPathOptions, moonPathPlan, type TrailsOptions, trailsPlan } from "./photo/sky-series";
import { drawIssTrail, issPasses, issPhotoPlan, issSight } from "./photo/iss-pass";
import { transits } from "./eclipse/moons";
import { type MxKind, MultiExposureDialog } from "./ui/multiexposure";
import { findObservable, ObservePage } from "./ui/observe";
import { nextSeen, type Observable, seenWindows, spotOf } from "./system/observing";
import { bestPlace } from "./eclipse/details";
import type { EclipseEvent } from "./eclipse/search";
import { skyNow } from "./system/sky-now";
import { MISSIONS } from "./game/missions";
import { KeyHints } from "./ui/keyhints";
import { MenuPad } from "./ui/padnav";
import { RadialWheel, type WheelItem } from "./ui/wheel";
import { Tablet } from "./ui/tablet";
import { PhotoMode } from "./ui/photo";
import { TB_ICONS, TopBar, modeName } from "./ui/topbar";
import { fmtLatLon, greatCircle } from "./game/geo";
import { hudKindName, nextHudKind } from "./game/hudkind";
import { GAME_MODES, baseMode, modeOf, planMode, type GameMode, type ModeState, type ModeStep } from "./game/modes";
import { POSE_KEYS } from "./controller/util";
import { readPrefs, writePrefs } from "./game/prefs";
import { events } from "./game/events";
import { phaseOf, phaseText, PhaseWatcher } from "./game/phase";
import { BODY_NAMES, bodyLook, craftRadius, isCraft, onOurSide, type Body } from "./targeting";
import { HidPads } from "./gamepad";
import { MOUNT_KEYS, MOUNTS, mountPose, setMountVessel, shipToCamera, type Mount } from "./mounts";
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
  altAzOf,
  buildChart,
  chartOn,
  chartOptions,
  CONSTELLATIONS,
  horizonAt,
  horizonOf,
  lookOf,
  NAMED_STARS,
  pickChart,
  type ChartFrame,
} from "./skychart";
import { drawChartLabels } from "./ui/skylabels";
import { SkyPanel } from "./ui/skypanel";
import { defaultSettings, presets, QUALITY, settingKeys, type Preset, type Settings, type Target } from "./settings";
import { SettingsPanel } from "./ui/panel";
import { type ChoiceDef, SCHEMA, SCHEMA_BY_KEY } from "./ui/schema";
import { loadFromUrl } from "./urlstate";
import { setupRenderDialog } from "./renderdialog";
import { VideoPreview } from "./ui/videopreview";
import { h } from "./ui/kit";
import { SHOTS as SHOT_IDS, type Shot } from "./photo/videoplan";
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
import { applyF35Variant } from "./f35/variant";
import { FlightComputer } from "./ui/fc/computer";
import { sitesOf, SITES } from "./game/sites";
import { SceneGallery } from "./ui/scenes";
import { SoundDirector } from "./audio/director";
import { haptics } from "./input/haptics";
import type { TravelGoal } from "./controller/travel";
import type { Vec3 } from "./physics";
import { sound } from "./audio/engine";
import { Speech, voiceScore } from "./audio/voice";
import { synthesize } from "./audio/formant";
import { phonemes } from "./audio/g2p";
import { Subtitles } from "./ui/subtitles";
import { Callouts } from "./game/callouts";
import { gpwsOf } from "./game/gpws";
import { Capcom } from "./game/capcom";
import { Music } from "./audio/music";
import { MusicPanel } from "./ui/musicpanel";
import { type Context, flightIntensity, type Moment, ScoreDirector } from "./audio/score";
import { Tars, type TarsMoment, type TarsState } from "./game/tars";
import { TarsPanel, type TarsPanelHost } from "./ui/tars-panel";
import { AGENT_MODELS, connect as orConnect, finishFromFragment, OpenRouter, openRouterKey } from "./ai/openrouter";
import { TarsOnline } from "./ai/tars-online";
import { TarsAgent, runOrders } from "./ai/tars-agent";
import { orderReply, parseOrders } from "./ai/offline-orders";
import { TarsMemory, TARS_MEMORY_KEY, type MemoryData } from "./ai/memory";
import { actionLine, resultShort, type Action, type Tool } from "./ai/agent";
import { checkArgs } from "./ai/tool-schema";
import { gameTools, keyCatalog, SCREENS } from "./ai/game-tools";
import { TarsDisplay } from "./ui/tars/display";
import { PushToTalk } from "./ai/listen";
import { DeepgramEar, earState, earTarget, probeRelay } from "./ai/deepgram";
import { DeepgramVoice, VOICE_RATE } from "./audio/deepgram-voice";
import { AURA_VOICES } from "./audio/aura-voices";
import { earKeyLine } from "./ui/ear-key";
import { Triggers, TARS_TRIGGERS_KEY, wakeText, type GameEvent, type Trigger } from "./ai/triggers";
import { Budget } from "./ai/budget";
import { READ_TOOLS, runSubagents } from "./ai/subagents";
import { AttitudeSampler } from "./ai/telemetry";
import { complete, MODES, parseCommand, TARS_MODE_KEY, TARS_SKILLS_KEY, unmention, type Mode, type Skill } from "./ai/commands";
import { runCommand } from "./ai/tars-commands";
import { gameCall, type GameCtx } from "./ai/game-commands";
import { closeTop } from "./ui/keys";
import { RUNWAY_DH } from "./game/procedures";
import { Simulation } from "./sim";
import { TransportBar } from "./ui/transport";
import { Take, type TakeState } from "./take";
import { EV, enuToEcef, FlightTape, type TapeBoom, type TapeSample } from "./game/replay";
import { type ContrailSnap, type ContrailStep, Contrails, MAX_SEGMENTS, SEG_FLOATS } from "./contrails";
import { ReplayPlayer } from "./ui/replay";
import { BODY_COLOURS, CameraPanel, fmtHeight, VIEW_HELP, VIEW_LABEL, VIEWS, type View } from "./ui/camerapanel";
import { defaultAltKm, ourMouthPose, ourOrbitPose } from "./game/place";
import { bodyAxes, EPOCH_DATE, solarBody, solarState, M_METRES, utcOf } from "./system/solar";
import { plan } from "./system/plan-client";
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
import { ORDERS, type OrderId } from "./game/orders";
import { FORMATION_IDS, FORMATIONS } from "./game/formations";
import { TrafficFeed } from "./traffic/feed";
import { unitsFor } from "./ui/unitsys";

/** The craft lost to the air's screen (ui/craftlost.ts) — made at once: a placing hides it. */
const craftLost = new CraftLost();

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
// (#slowboot=N — PLAN-TITRE-AAA E0: the graphics' start held N s more, a slow driver's compile played on any
// machine, to try what is usable while the game starts; taken out of the hash at once, the rest read as before)
const slowBootS = (() => {
  const m = /(^#|&)slowboot=(\d+(?:\.\d+)?)/.exec(location.hash);
  if (!m) return 0;
  const rest = location.hash
    .replace(/(^#|&)slowboot=[\d.]+/, "$1")
    .replace(/^#&/, "#")
    .replace(/&$/, "");
  history.replaceState(null, "", location.pathname + location.search + (rest.length > 1 ? rest : ""));
  return Math.min(Number(m[2]), 600);
})();
if (benchPage) installVramHook();

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
  bootMark("main");
  let appVersion = "dev";
  void fetch("version.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((v: { sha?: string } | null) => {
      if (v?.sha) {
        appVersion = v.sha;
        // (a new build: its first start plays the intro whole)
        introBuild(v.sha);
      }
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
  // the intro (src/intro/intro.ts): its sequence already playing in CSS, its Worker started here
  const splash = new Intro($("loading") ?? document.createElement("div"));
  void splash.gone.then(() => {
    bootMark("splash-lifted");
    setTimeout(bootWatchStop, 2000);
  });
  // (the HUD's and the overlays' fonts — fonts.css — loaded while the GPU starts: a canvas draws in
  // whatever is there at its first frame, and keeps it until redrawn)
  const fonts = Promise.all(
    [`600 12px Rajdhani`, `700 12px Rajdhani`, `500 12px "JetBrains Mono"`, `500 12px Inter`].map((f) => document.fonts.load(f)),
  ).catch(() => {});
  // the solar system's ephemerides and the sky's assets: downloading while the shaders compile, not
  // after them (plan §2.1-C). DE440 (3.3 MB) always, before the scene is placed; JUP365 (Jupiter's centre
  // and moons, 2040–2100: 7.5 MB) only where it may matter — a scene about Jupiter, a save naming Jupiter or its
  // moons (its target, its reference body, its ground), a shared moment (not read yet) —, else after the first
  // image: at 20 Mbit/s it held every scene's first image back (PLAN-MONDE M3), and every returning player's —
  // the autosave, wherever it was, took 7.5 MB before DE440's 3.3 (PLAN-TITRE-AAA E0)
  const ephemerisFetch = (u: string) =>
    loading.fetch(u, "ephemeris").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${u}: ${r.status}`))));
  const startScene = new URLSearchParams(location.hash.slice(1)).get("scene");
  const jovianFirst =
    /[#&]save=/.test(location.hash) ||
    (startScene ? !presets[startScene] || JOVIAN.test(JSON.stringify(presets[startScene])) : JOVIAN.test(JSON.stringify(autosave.get())));
  loading.stage("ephemeris", t("The solar system — NASA/JPL ephemerides (DE440)"), { weight: 2 });
  const ephemerides = loading.track("ephemeris", "", loadEphemerides(ephemerisUrls(jovianFirst ? ["de", "jup"] : ["de"]), ephemerisFetch));
  loading.stage("sky", t("Milky Way — the Gaia DR2 map"), { weight: 2 });
  loading.stage("stars", t("Stars — the Hipparcos & HYG catalogue"), { weight: 2 });
  // (the sky after the ephemerides, not beside them: DE440 is what the scene needs first — sharing the link it
  // came last, at 9.8 s at 20 Mbit/s, holding the title and the first image; the sky is not needed for that
  // image — PLAN-TITRE-AAA E0)
  prefetchSkyAssets((u, id) => loading.fetch(u, id), ephemerides);
  // (the renderer behind a handle: rebuilt on a new device after a loss, the page, the simulation and the
  // overlays keeping the handle they were given — PLAN-MONDE M2)
  let renderer: Renderer;
  let rendererSlot: ReturnType<typeof swappable<Renderer>>;
  try {
    const [created] = await Promise.all([Renderer.create(canvas), new Promise((r) => setTimeout(r, slowBootS * 1000))]);
    rendererSlot = swappable(created);
    renderer = rendererSlot.proxy;
    bootMark("renderer");
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
  const characterHud = new CharacterHud(camera, (text) => panel.toast(text));
  const sceneryHitboxes = new SceneryHitboxes();
  /** the take recorder (take.ts): the live view recorded, rendered afterwards as a video */
  const take = new Take();
  /** the replay's tape (game/replay.ts, S3): the last minutes flown, kept each frame — what is drawn again */
  type ReplayData = {
    pose: Partial<Settings>;
    time: number;
    water: number;
    exp: number;
    thrust: Renderer["shipThrust"];
    plasma: Renderer["shipPlasma"];
    jet: Renderer["jetPose"];
    others: Renderer["combatOthers"];
    wakes: Renderer["seaWakes"];
    /** the trails' step this frame (none out of the air), and every 1.5 s their state (the replay plays them from it) */
    trail: ContrailStep | null;
    trailSnap?: ContrailSnap;
    /** a fight's explosions seen then (ECEF), their age */
    booms: TapeBoom[];
  };
  const tape = new FlightTape<ReplayData>();
  /** The others' craft from the camera's axes to the craft's own, or from the craft's to a camera's (the replay's) —
   *  what the tape keeps is the craft's: any camera draws them where they were. (The wakes are the Earth's: as they are.) */
  type M3r = [Vec3r, Vec3r, Vec3r];
  type Vec3r = [number, number, number];
  const mulS = (S: M3r, v: readonly number[]): Vec3r => [
    S[0][0] * v[0]! + S[0][1] * v[1]! + S[0][2] * v[2]!,
    S[1][0] * v[0]! + S[1][1] * v[1]! + S[1][2] * v[2]!,
    S[2][0] * v[0]! + S[2][1] * v[1]! + S[2][2] * v[2]!,
  ];
  const mulSt = (S: M3r, v: readonly number[]): Vec3r => [
    S[0][0] * v[0]! + S[1][0] * v[1]! + S[2][0] * v[2]!,
    S[0][1] * v[0]! + S[1][1] * v[1]! + S[2][1] * v[2]!,
    S[0][2] * v[0]! + S[1][2] * v[1]! + S[2][2] * v[2]!,
  ];
  /** The others between two frames (u: 0 … 1) — the same craft in the same order: their places and axes
   *  interpolated; else the first frame's. */
  function othersBetween(a: Renderer["combatOthers"], b: Renderer["combatOthers"], u: number): Renderer["combatOthers"] {
    if (u <= 0 || a.length !== b.length || a.some((x, k) => x.id !== b[k]!.id)) return a;
    return a.map((x, k) => {
      const y = b[k]!;
      return {
        ...x,
        rel: lerp3(x.rel, y.rel, u),
        // (their lengths kept: the traffic's axes carry its size)
        axes: [0, 1, 2].map((k) => {
          const v = unit3(lerp3(x.axes[k]!, y.axes[k]!, u)),
            l = Math.hypot(...x.axes[k]!);
          return [v[0] * l, v[1] * l, v[2] * l];
        }) as [Vec3r, Vec3r, Vec3r],
      };
    });
  }
  function othersTo(o: Renderer["combatOthers"], f: (v: readonly number[]) => Vec3r): Renderer["combatOthers"] {
    return o.map((x) => ({ ...x, rel: f(x.rel), axes: [f(x.axes[0]), f(x.axes[1]), f(x.axes[2])] }));
  }
  /** The camera's axes now on the craft's (the live view's mount and look). */
  const camAxesNow = (): M3r | null =>
    renderer.shipPose ? (shipToCamera(renderer.shipPose, settings.shipLookYaw, settings.shipLookPitch).S as M3r) : null;

  /** What the replay's lens looks at this frame (game/replay.ts "target"): the fight's focus — our missile's target,
   *  what was shot down, falling, crashed, a ship sinking (controller/combat.ts combatFocus) — where it is (ECEF). */
  function replayFocus(smp: TapeSample): [number, number, number] | undefined {
    const F = camera.combatFocus();
    const P = camera.combat?.last;
    // (the lock alone is no event: the lens is for a shot, a fall, a crash, a sinking)
    return F && P && F.kind !== "lock" ? enuToEcef(smp, [F.p[0] - P.p[0], F.p[1] - P.p[1], F.p[2] - P.p[2]]) : undefined;
  }
  /** the trails' state kept every … [s of the tape] (a seek in the replay plays them on from the last: 90 steps at most) */
  const TRAIL_SNAP_S = 1.5;
  /** the longest rebuild of the replay's trails since it was last asked (__bh.flight.replay.tape()) [ms] */
  let replayTrailMs = 0;
  /** when the trails' state was kept last [the tape's s] */
  let trailSnapAt = -1e9;
  /** the replay's trails, played again up to the tape's frame `replayTrailI` */
  let replayTrails: Contrails | null = null,
    replayTrailI = -1;
  const replayTrailBuf = new Float32Array(MAX_SEGMENTS * SEG_FLOATS);
  /** The trails as they were at the tape's frame i: from the last state kept before it (or the tape's start), played on
   *  through each frame's step; seen from the craft there. */
  function trailsAt(i: number, u = 0): { data: Float32Array<ArrayBuffer>; n: number } | null {
    const t0 = performance.now();
    try {
      return trailsAtNow(i, u);
    } finally {
      replayTrailMs = Math.max(replayTrailMs, performance.now() - t0);
    }
  }
  /** the replay's trails stepped up to this scene time (a step is never taken back) */
  let replayTrailNow = Number.NEGATIVE_INFINITY;
  const lerp3 = (a: readonly number[], b: readonly number[], u: number): [number, number, number] => [
    a[0]! + (b[0]! - a[0]!) * u,
    a[1]! + (b[1]! - a[1]!) * u,
    a[2]! + (b[2]! - a[2]!) * u,
  ];
  const unit3 = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  function trailsAtNow(i: number, u: number): { data: Float32Array<ArrayBuffer>; n: number } | null {
    const F = tape.frames;
    let k = i;
    while (k >= 0 && k > replayTrailI && !F[k]!.data.trailSnap) k--;
    // (back in time, or a state kept on the way: begun again from the last state kept)
    if (!replayTrails || i < replayTrailI || (k > replayTrailI && F[k]?.data.trailSnap)) {
      if (i < replayTrailI || !replayTrails) {
        k = i;
        while (k >= 0 && !F[k]!.data.trailSnap) k--;
      }
      replayTrails = new Contrails();
      const snap = k >= 0 ? F[k]!.data.trailSnap : undefined;
      if (snap) replayTrails.restore(snap);
      replayTrailI = snap ? k : -1;
      replayTrailNow = snap ? snap.tLast : Number.NEGATIVE_INFINITY;
    }
    for (let j = replayTrailI + 1; j <= i; j++) {
      const st = F[j]!.data.trail;
      if (st && st.now > replayTrailNow) {
        replayTrails.step(st.now, st.body, st.carry, st.src);
        replayTrailNow = st.now;
      }
    }
    replayTrailI = i;
    const a = F[i]?.data.trail;
    if (!a) return null;
    // (between this frame and the next: a step of its own at the very time shown — the sources where they were then
    // —, seen from the craft there: the smoke's head on what makes it, whatever the replay's rate)
    const b = F[i + 1]?.data.trail;
    let now = a.now,
      x = a.x,
      ax = a.ax;
    if (b && u > 0 && b.body === a.body) {
      now = a.now + (b.now - a.now) * u;
      if (now > replayTrailNow) {
        const src = a.src.map((q) => {
          const r = b.src.find((z) => z.key === q.key);
          return r ? { ...q, p: lerp3(q.p, r.p, u), str: q.str + (r.str - q.str) * u } : q;
        });
        replayTrails.step(now, a.body, a.carry, src);
        replayTrailNow = now;
      }
      x = lerp3(a.x, b.x, u);
      ax = [unit3(lerp3(a.ax[0], b.ax[0], u)), unit3(lerp3(a.ax[1], b.ax[1], u)), unit3(lerp3(a.ax[2], b.ax[2], u))];
    }
    const n = replayTrails.view(now, x, ax, replayTrailBuf);
    return n ? { data: replayTrailBuf, n } : null;
  }
  /** what the tape keeps of the settings: the craft's place, attitude, motion */
  const REPLAY_KEYS: (keyof Settings)[] = [...POSE_KEYS, "velR", "velT", "velP", "motion", "rotation"];
  /** The craft's settings between two frames of the tape (u: 0 … 1): its numbers interpolated — its angles the short
   *  way round —, the same place's (its anchor, its throat's side, its motion) else the first frame's as it was. */
  const REPLAY_ANGLES = new Set<string>(["yaw", "pitch", "roll", "azimuth", "inclination"]);
  function poseBetween(a: Partial<Settings>, b: Partial<Settings>, u: number): Partial<Settings> {
    const A = a as Record<string, unknown>,
      B = b as Record<string, unknown>;
    if (u <= 0 || A.anchor !== B.anchor || A.whL !== B.whL || A.motion !== B.motion || A.rotation !== B.rotation) return a;
    const out: Record<string, unknown> = { ...A };
    for (const k of REPLAY_KEYS) {
      const x = A[k],
        y = B[k];
      if (typeof x !== "number" || typeof y !== "number" || k === "whL") continue;
      let d = y - x;
      if (REPLAY_ANGLES.has(k)) d = ((((d + 180) % 360) + 360) % 360) - 180;
      out[k] = x + d * u;
    }
    return out as Partial<Settings>;
  }
  /** the fight's events this frame, for the tape (a launch of ours, an explosion near) */
  let replayEv = 0;

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

  /** TARS's settings tab told of a change (set once his console is made) */
  let tarsSettingsChanged: (() => void) | null = null;
  /** Routes a settings change to what it affects (re-trace, resolve only, resize, nothing). */
  function onSettingsChange(keys: (keyof Settings)[]) {
    tarsSettingsChanged?.();
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
    // (under "TARS's ear": his Deepgram key — pasted, tried, changed, forgotten)
    controlExtra: (key) => (key === "tarsEar" ? earKeyLine({ testid: "settings-ear-key", changed: () => tarsPanel?.refresh() }) : null),
  });
  // the offline cache and the install (PLAN-MONDE M1): off on the dev server's hot reload
  const pwa = installPwa({ toast: (m) => panel.toast(m), dev: DEV && !/[?&]sw=1/.test(location.search) });
  // (the flight's jolts felt by the camera too — Cinemachine's impulses: controller/camrig.ts)
  haptics.onImpulse = (kind, k) => {
    const J = {
      wheel: [0.35, 0.25, 12],
      joint: [0.08, 0.15, 14],
      boom: [0.6, 0.5, 7],
      transonic: [0.45, 0.8, 9],
      dock: [0.4, 0.4, 8],
      undock: [0.25, 0.3, 8],
      crash: [1, 0.9, 6],
    }[kind];
    if (J) camera.camImpulse(J[0]! * k, J[1], J[2]);
  };
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
  /** the music's cue this frame (the flight's moment, context and intensity — set where they are known) */
  let musicCue: { m: Moment | null; context: Context | null; intensity: number } = { m: null, context: null, intensity: 0.5 };
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
  // (what he knows in every mode: the flight while one is flown, the mode's own situation always — PLAN-MODES-AAA M2)
  const tarsNow = (): TarsState => ({
    ...((camera.piloting ? tarsView : null) ?? {
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
    }),
    ...tarsSituation(),
  });
  /** The mode's situation for TARS: on foot the place, the free camera where it is and what it looks at, the photo
   *  mode and a render running. */
  function tarsSituation(): Partial<TarsState> {
    const mode = gameMode();
    const r1 = (v: number, k = 1) => Math.round(v * 10 ** k) / 10 ** k;
    const out: Partial<TarsState> = { mode, foot: null, view: null, photo: null };
    const p = camera.character.place();
    if (p) {
      const v = flightHud.ground.localPlace?.()?.vessel ?? null;
      const g = v ? greatCircle(p.lat, p.lon, v.lat, v.lon, p.radiusM) : null;
      out.foot = {
        body: p.body,
        lat: r1(p.lat, 5),
        lon: r1(p.lon, 5),
        altM: Math.round(p.altM),
        aglM: r1(p.aglM),
        viewDeg: Math.round(p.viewDeg),
        speedMs: r1(p.speedMs),
        craft: g ? { distM: Math.round(g.dist), bearingDeg: Math.round(g.bearingDeg) } : null,
      };
    } else if (mode !== "ship") {
      const vc = camera.viewController();
      const vs = camera.viewSettings();
      const w = vc.rigWorld();
      const n = w ? vc.rigNearest(w.ours, w.X, vc.nowTime()) : null;
      const mPerUnit = w?.ours ? M_METRES : 1476.625 * settings.massSolar;
      out.view = {
        near: n ? (BODY_NAMES[n.id as Target] ?? n.id) : null,
        altKm: n && w ? r1(((Math.hypot(w.X[0] - n.C[0], w.X[1] - n.C[1], w.X[2] - n.C[2]) - n.R) * mPerUnit) / 1e3, 1) : null,
        target: BODY_NAMES[vs.target] ?? vs.target,
        lookAt: vs.lookAt,
        telescope: vs.telescope,
        fovDeg: r1(vs.fov),
        cinematic: camera.cinematic ?? null,
        spectator: camera.spectating,
      };
    }
    const video = renderDialog.videoState();
    const live = liveCapture.state();
    if (mode === "photo" || renderer.offlineActive || video || live)
      out.photo = {
        open: mode === "photo",
        over: mode === "photo" ? baseMode(modeState()) : null,
        render:
          renderer.offlineActive && lastOffline && !video
            ? { progress: r1(lastOffline.progress, 3), width: lastOffline.width, height: lastOffline.height, done: lastOffline.done }
            : null,
        video: video
          ? {
              shot: video.shot,
              draft: video.draft,
              frame: video.frame + 1,
              frames: video.frames,
              leftS: Number.isFinite(video.etaS) ? Math.round(video.etaS) : null,
            }
          : null,
        live,
      };
    return out;
  }
  /** the offline render's last status (the render dialog's; TARS's) */
  let lastOffline: OfflineStatus | null = null;
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
  camera.character.contact = () => (settings.earthTerrain && renderer.earthScenery.supported ? renderer.earthScenery.contact : null);
  // (the same scenery for a tripod's stand: controller/rig.ts)
  setSceneryContact(() => camera.character.contact());
  // (the air's bending as the frame draws it, for the telescope's aim)
  setDrawnRefractivity(() => (settings.refraction ? renderer.refractivity(camera.viewSettings()) : 0));
  camera.character.terrainRevision = () => renderer.earthTiles.stamp;
  camera.character.surface = (body, q) => body !== "earth" || renderer.earthLandAt(q);
  camera.character.hullBounds = () => renderer.ship.hullBound(settings.vessel);
  camera.character.obstacles = (q, r) => renderer.characterRenderer.stoneBlocks(q, r);
  camera.character.onEvent = (to, detail) => tarsEvent({ kind: "character", to, detail });
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
    eclipse: string;
    surface: string;
    scenery: string;
    grass: string;
  } | null = null;
  let tarsMapSeen: string | null = null;
  let tarsModeSeen: GameMode | null = null;
  let tarsRenderSeen = "";
  /** the last video ended with its file (not stopped): its end told as done */
  let tarsVideoDone = false;
  let tarsSpentSeen = 0;
  setInterval(() => {
    // (what OpenRouter cost since: the budget's)
    tarsBudget.add(openRouter.spent - tarsSpentSeen);
    tarsSpentSeen = openRouter.spent;
    const mapKey = `${flightHud.mapView}:${flightHud.ground.localMap.zoom}`;
    if (tarsMapSeen !== null && mapKey !== tarsMapSeen) tarsEvent({ kind: "map", from: tarsMapSeen, to: mapKey });
    tarsMapSeen = mapKey;
    // (every mode: the mode's changes, a render's end — PLAN-MODES-AAA M2)
    const modeNow = gameMode();
    if (tarsModeSeen !== null && modeNow !== tarsModeSeen) tarsEvent({ kind: "mode", from: tarsModeSeen, to: modeNow });
    tarsModeSeen = modeNow;
    // (a video's frames are renders each: its end alone is told — "video" to "done" or "stopped")
    const renderNow = renderDialog.videoState() ? "video" : renderer.offlineActive ? (lastOffline?.done ? "done" : "running") : "";
    if (tarsRenderSeen === "running" && renderNow !== "running")
      tarsEvent({ kind: "render", from: "running", to: renderNow === "done" || lastOffline?.done ? "done" : "stopped" });
    else if (tarsRenderSeen === "video" && renderNow !== "video")
      tarsEvent({ kind: "render", from: "video", to: tarsVideoDone ? "done" : "stopped" });
    if (renderNow === "video") tarsVideoDone = false;
    tarsRenderSeen = renderNow;
    // (the flight's own, while one is flown)
    if (!camera.piloting) {
      // (his console's hub card cleared once the flight is left)
      if (tarsSeen) tarsPanel.follow(null);
      tarsSeen = null;
    } else {
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
        surface: `${renderer.earthSurface.stats().region ?? "none"}:${renderer.earthSurface.stats().status}`,
        grass: renderer.characterRenderer.stats().reason,
        scenery: `${renderer.earthScenery.stats().lat ?? "none"}:${renderer.earthScenery.stats().lon ?? "none"}:${renderer.earthScenery.stats().status}:${settings.earthSceneryShadows}`,
        // (the deviations: the hub's graph out of its corridor, the entry out of its own, the approach's PAPI all
        // white or all red on final)
        off: hub?.graph?.state === "off" ? `${hub.graph.kind}` : camera.entryRun?.inCorr === false ? "entry" : "",
        papi: (() => {
          const r = camera.runwayView?.();
          return r?.final && (r.papi === 0 || r.papi === 4) ? (r.papi === 0 ? "low" : "high") : "";
        })(),
        // (an eclipse at the camera's place: its phase — PLAN-CIEL C11)
        eclipse:
          (camera as unknown as { skyInfo?: () => { eclipse?: { phase: string } } | null })
            .skyInfo?.()
            ?.eclipse?.phase.replace("none", "") ?? "",
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
        if (now.surface !== was.surface) tarsEvent({ kind: "surface", from: was.surface, to: now.surface });
        if (now.grass !== was.grass) tarsEvent({ kind: "grass", from: was.grass, to: now.grass });
        if (now.scenery !== was.scenery) tarsEvent({ kind: "scenery", from: was.scenery, to: now.scenery });
        if (now.off && now.off !== was.off) tarsEvent({ kind: "deviation", to: now.off, detail: hub?.graph?.fix ?? hub?.graph?.about });
        if (now.eclipse !== was.eclipse)
          tarsEvent({
            kind: "eclipse",
            from: was.eclipse || "none",
            to: now.eclipse || "end",
            detail: now.eclipse ? `an eclipse phase here: ${now.eclipse}` : `the eclipse here is over (${was.eclipse})`,
          });
        if (now.papi && now.papi !== was.papi)
          tarsEvent({
            kind: "deviation",
            to: "approach",
            detail: `PAPI ${now.papi === "low" ? "all red: too low" : "all white: too high"}`,
          });
      }
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
    // (his settings' tab: the settings panel's own values, set through it)
    settingsTab: {
      settings,
      set: (key, value) => panel.setValue(key, value),
      tryVoice: async (who) => {
        const text =
          who === "tars"
            ? tr({
                fr: "Ici TARS. Honnêteté à quatre-vingt-dix pour cent, Cooper.",
                en: "This is TARS. Honesty setting ninety percent, Cooper.",
              })
            : tr({ fr: "Ranger, ici Houston. Nous vous recevons cinq sur cinq.", en: "Ranger, Houston. We read you loud and clear." });
        voice.say({
          id: `try-${who}-${Date.now()}`,
          text,
          speaker: who === "tars" ? "tars" : "mission",
          priority: 1,
          radio: who === "radio",
        });
        return voiceNow(who);
      },
      voiceNow: (who) => voiceNow(who),
      mics: async () =>
        (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === "audioinput" && d.deviceId !== "default")
          .map((d) => ({ id: d.deviceId, label: d.label })),
      mic: () => store.get(MIC_KEY) ?? "",
      setMic: (id) => (id ? store.set(MIC_KEY, id) : store.remove(MIC_KEY)),
      testEar: (h) => earTest(h),
    },
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
        game: tarsGameCtx(),
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
  tarsSettingsChanged = () => tarsPanel.settingsChanged();
  // (the system's voices, listed by the browser late: the choice of TARS's filled with them — the language's first)
  const fillSystemVoices = () => {
    if (typeof speechSynthesis === "undefined") return;
    const list = speechSynthesis.getVoices().filter((v) => /^(fr|en)/i.test(v.lang));
    if (!list.length) return;
    const mine = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase().startsWith(lang) ? 0 : 1);
    list.sort((a, b) => mine(a) - mine(b) || voiceScore(b, lang) - voiceScore(a, lang) || a.name.localeCompare(b.name));
    const def = SCHEMA_BY_KEY.get("tarsSystemVoice") as ChoiceDef | undefined;
    if (!def) return;
    def.options = [
      { value: "", label: "Automatic", hint: "The best for the language" },
      ...list.map((v) => ({ value: v.name, label: v.name, hint: v.lang })),
    ];
    tarsPanel.redrawSettings();
    panel.redraw();
  };
  if (typeof speechSynthesis !== "undefined") {
    fillSystemVoices();
    speechSynthesis.addEventListener?.("voiceschanged", fillSystemVoices);
  }
  // (his ear's way known early: the dev server's relay, said in his console)
  void probeRelay().then((r) => r && tarsPanel.refresh());
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
    // (a game command: his tool run at once, no model — C6)
    const g = q.startsWith("/")
      ? gameCall(
          q,
          tarsTools,
          SITES.map((x) => x.name),
        )
      : null;
    if (g) return void tarsGameCommand(g, q);
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
  // the game's "/" commands (C6: ai/game-commands.ts): their values, their run
  const tarsGameCtx = (): GameCtx => ({
    bodies: tools.targets().map((id) => {
      const name = (BODY_NAMES as Record<string, string>)[id] ?? id;
      return { value: name, hint: name === id ? undefined : id };
    }),
    sites: SITES.map((x) => ({ value: x.name, hint: x.body })),
    mounts: (Object.keys(MOUNTS) as Mount[]).map((m) => ({ value: m, hint: MOUNTS[m].short })),
    screens: [...SCREENS],
    scenes: Object.keys(presets),
    saves: tools.saves().map((x) => x.name),
    settings: SCHEMA.map((d) => ({
      key: d.key,
      label: t(d.label),
      values: d.type === "choice" ? d.options.map((o) => String(o.value)) : d.type === "toggle" ? ["true", "false"] : undefined,
    })),
    sky: [...CONSTELLATIONS.map((c) => c.name), ...NAMED_STARS.map((x) => x.name)],
    keys: keyCatalog().map((k) => ({ value: k.id, hint: k.key })),
    tools: tarsTools,
  });
  const tarsGameCommand = async (g: { tool: string; args: Record<string, unknown> } | { error: string }, typed: string) => {
    tarsPanel.exchange(typed);
    if ("error" in g) return tarsPanel.answer(g.error);
    const tool = tarsTools.find((x) => x.name === g.tool);
    if (!tool) return tarsPanel.answer(g.tool);
    tarsPanel.begin(g.tool, g.args);
    const chk = checkArgs(tool, g.args);
    let a: Action;
    if (!chk.ok) a = { tool: g.tool, args: g.args, ok: false, result: chk.error };
    else
      try {
        a = { tool: g.tool, args: chk.args, ok: true, result: (await tool.run(chk.args, new AbortController().signal)) ?? "done" };
      } catch (e) {
        a = { tool: g.tool, args: chk.args, ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    const short = resultShort(a);
    tarsPanel.action(short, a.ok, actionLine(a), a.tool);
    tarsPanel.answer(a.ok ? short || tr({ fr: "Fait.", en: "Done." }) : String(a.result));
    // (a reading: its result on a card)
    if (a.ok && READ_TOOLS.has(a.tool) && a.result && typeof a.result === "object") {
      const rows = (Array.isArray(a.result) ? a.result : Object.entries(a.result as object).map(([k, v]) => ({ k, v })))
        .slice(0, 16)
        .map((r: Record<string, unknown>) =>
          "k" in r
            ? { label: String(r.k), value: typeof r.v === "object" ? JSON.stringify(r.v) : String(r.v) }
            : {
                label: String(r.name ?? r.id ?? Object.values(r)[0]),
                value: Object.entries(r)
                  .filter(([k]) => k !== "name")
                  .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`)
                  .join(" · "),
              },
        );
      tarsDisplay.show({ kind: "data", title: typed, rows });
    }
    refreshGui();
    tarsFollowStart();
  };
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
        pasteKey: (which) => tarsPanel.pasteMode(which),
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
  // his voices by Deepgram (Aura-2) and the microphone chosen for his ear (this browser's)
  const deepgramVoice = new DeepgramVoice();
  const MIC_KEY = "kerr.tars.mic";
  // speaking to TARS (PLAN-TARS-AGENT A5): his key held listens, released sends; a tap is his field
  const tarsTalk = new PushToTalk(
    {
      lang: () => lang,
      hearing: (text) => tarsPanel.hearing(text),
      heard: (text) => {
        if (!text) return tarsPanel.refresh(t("Nothing heard."));
        tarsPanel.hearing("");
        tarsPanelAsk(text);
      },
      failed: (why, code) => (
        console.warn("[TARS microphone]", why, code, tarsTalk.trail.join(" · ")),
        tarsPanel.refresh(
          why === "denied"
            ? t("The microphone is not allowed (the browser's site settings).")
            : code === "unsupported"
              ? t("No speech recognition in this browser: paste a Deepgram key (/deepgram), or use Chrome or Safari.")
              : code === "deepgram-none"
                ? t("TARS's ear is set to Deepgram: paste a Deepgram key (/deepgram).")
                : code === "deepgram-key"
                  ? t("Deepgram refused the key (/deepgram to paste another).")
                  : why === "network"
                    ? t(
                        "This browser's speech recognition does not work (Arc, Brave, Opera): paste a Deepgram key (/deepgram), or use Chrome or Safari.",
                      )
                    : why === "none"
                      ? t("Nothing heard.")
                      : `${t("Speech recognition failed.")}${code ? ` (${code})` : ""}`,
        )
      ),
      state: (on) => {
        tarsPanel.listening(on);
        tarsPanel.setState(on ? "listening" : tarsBusy ? "thinking" : "idle");
      },
    },
    undefined,
    undefined,
    // (Deepgram's ear when it is within reach: a key pasted, or the dev server's relay)
    async () => {
      if (settings.tarsEar === "browser") return null;
      const target = await earTarget({ lang, model: settings.tarsEarModel, language: settings.tarsEarLang });
      if (!target && settings.tarsEar === "deepgram") throw new Error("deepgram-none");
      return target ? new DeepgramEar(target, store.get(MIC_KEY) ?? "") : null;
    },
  );
  /** his key (F6, or as bound) pressed: held, it listens; tapped, his field — or (the setting) pressed to start
   *  listening and again to end */
  function tarsKey(e: KeyboardEvent) {
    // (a controller's button — no key up to wait for —, or no recognition here: the field)
    if (!e.code || !PushToTalk.supported) return tarsPanel.toggle();
    if (e.repeat) return;
    if (settings.tarsTalkMode === "toggle") return void (tarsTalk.listening ? tarsTalk.stop() : tarsTalk.start());
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
    // (the game's own voices, played by its audio: Deepgram's Aura-2 — TARS's through his grit, the radio's
    // through its band —, or TARS's robot in English — PLAN-TARS T5a; null: the system's speaks it)
    robot: (l) => ownVoice(l),
    stopRobot: () => sound.stopRobot(),
    // (TARS's system voice as chosen, its pace and pitch)
    systemVoice: (l) =>
      l.speaker === "tars"
        ? { name: settings.tarsSystemVoice || undefined, rate: settings.tarsVoiceRate, pitch: settings.tarsVoicePitch }
        : roleSystemVoice(l.speaker),
  });
  /** the radio's roles' system voices (I4): another of the language's voices for each, when there are several */
  function roleSystemVoice(sp: string): { name?: string } | null {
    const k = ["wingman", "awacs", "mother", "lso"].indexOf(sp);
    if (k < 0 || typeof speechSynthesis === "undefined") return null;
    const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    return vs.length > 1 ? { name: vs[(k + 1) % vs.length]!.name } : null;
  }
  /** what speaks a line, of the game's own (null: the system's): Deepgram when chosen and within reach, the robot (English) */
  function ownVoice(l: import("./audio/voice").VoiceLine): Promise<void> | null {
    if (!settings.voice) return null;
    const inside = settings.shipMount === "cockpit" || settings.shipMount === "cabin";
    // (an e2e page never reaches Deepgram — no network, no key —: its robot voice speaks, as a player's offline)
    const reach = earState().by !== "browser" && !/[?&]e2e=/.test(location.search);
    if (l.speaker === "tars") {
      const e = settings.tarsVoiceEngine;
      if (e === "deepgram" || (e === "auto" && reach))
        return deepgramSay(l.text, lang === "fr" ? settings.tarsVoiceFr : settings.tarsVoiceEn, inside, settings.tarsVoiceEffect, () =>
          lang === "en" ? sound.playRobot(synthesize(phonemes(l.text)), 22050, inside) : null,
        );
      if ((e === "robot" || e === "auto") && lang === "en") return sound.playRobot(synthesize(phonemes(l.text)), 22050, inside);
      return null;
    }
    if (l.speaker === "mission" || l.speaker === "tower") {
      const e = settings.radioVoiceEngine;
      if (e === "deepgram" || (e === "auto" && reach))
        return deepgramSay(l.text, lang === "fr" ? settings.radioVoiceFr : settings.radioVoiceEn, false, "radio", () => null);
    }
    // (the radio's roles — I4 —: a voice of their own each)
    if (l.speaker === "wingman" || l.speaker === "awacs" || l.speaker === "mother" || l.speaker === "lso") {
      const e = settings.radioVoiceEngine;
      if (e === "deepgram" || (e === "auto" && reach)) return deepgramSay(l.text, ROLE_VOICE[l.speaker][lang], false, "radio", () => null);
    }
    return null;
  }
  /** a line said by a Deepgram voice (its sound asked, then played by the game's audio); out of reach or
   *  refused: the fallback's, else said silently (its subtitle) */
  /** What speaks his lines now (or the radio's), in words — the settings' tab. */
  function voiceNow(who: "tars" | "radio"): string {
    const reach = earState().by !== "browser";
    const aura = (id: string) => AURA_VOICES.find((v) => v.id === id)?.name ?? id;
    if (who === "radio") {
      const e = settings.radioVoiceEngine;
      return e === "deepgram" || (e === "auto" && reach)
        ? tf("Deepgram · {0} · radio", aura(lang === "fr" ? settings.radioVoiceFr : settings.radioVoiceEn))
        : t("The system's voice, by radio");
    }
    const e = settings.tarsVoiceEngine;
    if (e === "deepgram" || (e === "auto" && reach)) {
      const fx = { robot: t("Robot"), clean: t("Clean"), radio: t("Radio") }[settings.tarsVoiceEffect];
      return reach
        ? tf("Deepgram · {0} · {1}", aura(lang === "fr" ? settings.tarsVoiceFr : settings.tarsVoiceEn), fx)
        : t("Deepgram is out of reach: paste a key below");
    }
    if ((e === "robot" || e === "auto") && lang === "en") return t("The game's robot");
    const sys = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
    const name = settings.tarsSystemVoice || [...sys].sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang))[0]?.name || "—";
    return tf("System voice · {0}", name);
  }
  /** His ear tried (the settings' tab): Deepgram's, the level and the words as they come, 6 s at most. */
  function earTest(h: { level(v: number): void; words(text: string): void; done(note: string): void }): () => void {
    let ear: DeepgramEar | null = null;
    let finals = "",
      over = false;
    const finish = (note: string) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      void ear?.end().then(() => h.done(note || (finals ? "" : t("Nothing heard."))));
      if (!ear) h.done(note);
    };
    const timer = setTimeout(() => finish(""), 6000);
    void (async () => {
      const target =
        settings.tarsEar === "browser" ? null : await earTarget({ lang, model: settings.tarsEarModel, language: settings.tarsEarLang });
      if (over) return;
      if (!target) return finish(t("The test listens through Deepgram: paste a key (or hold F6 to try the browser's ear)."));
      ear = new DeepgramEar(target, store.get(MIC_KEY) ?? "");
      await ear.start({
        level: h.level,
        interim: (x) => h.words(`${finals}${x}`.trim()),
        final: (x) => {
          finals += `${x} `;
          h.words(finals.trim());
        },
        error: (code) =>
          finish(
            code === "not-allowed" ? t("The microphone is not allowed (the browser's site settings).") : tf("The ear failed ({0}).", code),
          ),
      });
    })();
    return () => finish("");
  }
  async function deepgramSay(
    text: string,
    model: string,
    inside: boolean,
    effect: "robot" | "clean" | "radio",
    fallback: () => Promise<void> | null,
  ): Promise<void> {
    const pcm = await deepgramVoice.synth(text, model);
    if (!pcm) return (await fallback()) ?? undefined;
    return (await sound.playRobot(pcm, VOICE_RATE, inside, effect)) ?? undefined;
  }
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
    // (a scene is a cut: its view placed as it is, not turned to from the one before)
    camera.rig.cut = true;
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
    if ((pose === "fleet" || pose === "fleetSpin") && settings.ship && settings.vessel !== "f35") camera.flyFrom(starts[settings.vessel]);
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
    "btn-music": () => musicPanel.toggle(),
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
    "btn-help": () => panel.showShortcuts(),
    "btn-render": () => renderDialog.toggle(),
  };
  // (the dock's buttons — ui: Camera, Scenes, Sky, Photo, Help; the other actions are keys, the wheel's
  // sectors and the settings)
  for (const [id, fn] of Object.entries(actions)) document.getElementById(id)?.addEventListener("click", fn);
  /** Next / previous target, named in a toast (or why there is nothing else to pick). */
  /** A fight's trigger's answer said (controller/combat.ts). */
  function combatSay(s: string | null) {
    if (s) panel.toast(s);
  }

  function nextTarget(dir: 1 | -1) {
    const vc = camera.viewController();
    const list = vc.availableTargets();
    if (list.length < 2) {
      panel.toast(tf("Only {0} here — turn on the companion star or the wormhole, or pick a scene", BODY_NAMES[vc.s.target]));
      return;
    }
    vc.cycleTarget(dir);
    camera.pad.rumble(0.1, 0.3, 50);
    panel.toast(tf("Target: {0}  ({1} / {2})", BODY_NAMES[vc.s.target], list.indexOf(vc.s.target) + 1, list.length));
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
    if (settings.ship && c !== "orbit") return panel.toast(t("The dive and the journey are the free camera's — K puts the Ranger away"));
    camera.setCinematic(camera.cinematic === c ? null : c);
    if (camera.cinematic && !settings.animate) panel.toast(t("Cinematics run with the time — Space runs it"));
    refreshGui();
    touch();
  }
  // (the view's own: a spectator's — the tripod, the free camera while a ship flies on — has its target, its lock and
  // its lens; they were the ship's, the tripod's Y and C turning the ship's view the player did not see)
  function toggleLookAt() {
    const vc = camera.viewController();
    vc.setLookAt(!vc.s.lookAt);
    panel.toast(vc.s.lookAt ? tf("View locked on {0}", BODY_NAMES[vc.s.target]) : t("View free"));
    refreshGui();
    touch();
  }
  function toggleTelescope() {
    // (on foot: the tripod set where he stands, at his eyes, then the telescope on it)
    if (camera.character.active && !settings.telescope) {
      const why = tripodHere();
      if (why) return void panel.toast(why);
    }
    const vc = camera.viewController();
    vc.rig.star = null;
    vc.setTelescope(!vc.s.telescope);
    panel.toast(
      vc.s.telescope ? tf("Telescope on {0} — the wheel zooms (to a 0.02° field), Y leaves", BODY_NAMES[vc.s.target]) : t("Telescope off"),
    );
    refreshGui();
    touch();
  }
  /**
   * Takes the free camera to a body — anywhere in the world, through the wormhole too: in orbit around
   * it (a planet, a moon: a few radii up), around it. Why it cannot, or null.
   */
  /**
   * The view travelled to a goal (controller/travel.ts) — the spectator's, or the free camera's, placed at once
   * when it cannot (another universe) —, then around it.
   */
  /** A spectator placed elsewhere (a tripod, a travel, a place on the Atlas): no longer following the ship —
   *  else the next frame put it back at the ship and its offset. */
  function releaseFollow() {
    if (camera.spectating && camera.spectatorFollow) camera.setSpectatorFollow(false);
  }

  function travelTo(goal: (time: number) => TravelGoal, then: () => void): string | null {
    releaseFollow();
    const S = camera.viewSettings();
    const C = viewCamera();
    C.setCinematic(null);
    if (C.gravity) C.setGravity(false);
    C.setOurLanded(null);
    const finish = () => {
      S.motion = "geodesic";
      C.setOurLanded(null);
      C.sync();
      S.rotation = "orbit";
      then();
      refreshGui();
      touch();
    };
    if (!camera.spectating && C.startTravel(goal, finish)) {
      touch();
      return null;
    }
    const g = goal(sim.time);
    setHomePose(S, g.X, g.fwd, g.up, g.V);
    finish();
    return null;
  }

  function goTo(b: Target): string | null {
    releaseFollow();
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
    if (isCraft(b)) {
      // a craft of the fleet: the C a few of its sizes off it — behind, to its side, above —, moving
      // with it, around it
      if (!(S.system === "gargantua" && S.wormhole))
        return t("The craft fly in our universe (through the wormhole of the Gargantua-system scenes)");
      if (!fleet.pose(b, sim.time)) return tf("The {0}: not known now", BODY_NAMES[b]);
      const R = craftRadius(b);
      const o = [1.1 * R, 0.8 * R, -1.9 * R];
      const goal = (time: number): TravelGoal => {
        const p = fleet.pose(b, time) ?? fleet.pose(b, sim.time)!;
        const X = [0, 1, 2].map((k) => p.X[k]! + (p.ax[0][k]! * o[0]! + p.ax[1][k]! * o[1]! + p.ax[2][k]! * o[2]!) / M_METRES) as Vec3;
        const d = [p.X[0] - X[0], p.X[1] - X[1], p.X[2] - X[2]];
        const l = Math.hypot(...d);
        return { X, fwd: [d[0]! / l, d[1]! / l, d[2]! / l], up: p.ax[1], V: p.V, C: p.X };
      };
      return travelTo(goal, () => {
        C.selectTarget(b, { focus: true });
        panel.toast(tf("Camera: around the {0}", BODY_NAMES[b]));
      });
    }
    if (b === "iss") {
      // the space station: the C 110 m off it — behind, to starboard, above —, moving with it,
      // around it
      if (!(S.system === "gargantua" && S.wormhole && S.iss))
        return t("The space station flies in our universe (through the wormhole of the Gargantua-system scenes)");
      if (!issTrack.peek(sim.time)) return t("The space station: no orbit known at this date");
      const o = [-70, 60, -55];
      const goal = (time: number): TravelGoal => {
        const st = issTrack.peek(time) ?? issTrack.peek(sim.time)!;
        const A = issAxes(st.X, st.V, time);
        const X = [0, 1, 2].map((k) => st.X[k]! + (A[0][k]! * o[0]! + A[1][k]! * o[1]! + A[2][k]! * o[2]!) / M_METRES) as Vec3;
        const d = [st.X[0] - X[0], st.X[1] - X[1], st.X[2] - X[2]];
        const l = Math.hypot(...d);
        return { X, fwd: [d[0]! / l, d[1]! / l, d[2]! / l], up: [-A[2]![0]!, -A[2]![1]!, -A[2]![2]!], V: st.V, C: st.X };
      };
      return travelTo(goal, () => {
        C.selectTarget("iss", { focus: true });
        panel.toast(t("Camera: around the ISS"));
      });
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
      // (our worlds: travelled to — controller/travel.ts —, Gargantua's: placed)
      if (p.frame === "ours" && u === "ours") {
        const goal = (time: number): TravelGoal => {
          const q = ourOrbitPose({ body: id, altKm: alt }, time);
          return { X: q.X, fwd: q.fwd, up: q.up, V: q.vel, C: ourState(id, time).pos };
        };
        return travelTo(goal, () => {
          C.selectTarget(b, { focus: true });
          panel.toast(tf("Camera: around {0}", BODY_NAMES[b]));
        });
      }
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
    // (the spectator's camera stands where it is; the Ranger flown lands itself)
    if (settings.ship && !camera.spectating)
      return t("The Ranger lands itself (the autopilot: 7); landed, ⇧K takes you out on foot and ⇧T sets the tripod there");
    releaseFollow();
    const vc = camera.viewController();
    const why = vc.standOn(b as Parameters<typeof vc.standOn>[0]);
    if (why) return why;
    const on = vc.rigStatus()?.body;
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
    const o = { ...chartOptions(settings, chartHover), refractivity: renderer.refractivity(settings) };
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
    if (camera.character.active) {
      if (!on) {
        const err = camera.character.board();
        if (err) panel.toast(err);
      }
      return;
    }
    if (on === camera.spectating) return;
    if (on && !camera.startSpectator()) {
      panel.toast(t("The spectator leaves a ship flown: fly one first (K)"));
      return;
    }
    if (!on) camera.stopSpectator();
    // (no cut: the view glides out of the ship and is carried back onto it — controller/spectator.ts — the
    // image's history kept across)
    renderer.shipPlace = null;
    renderer.shipFocus = null;
    syncButtons();
    touch();
    panel.toast(
      on
        ? t("Spectator — a free camera: W A S D · Q E to move (⇧ faster), drag to turn; the ship flies on (F1 or V: back)")
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
        ? t("Assisted: you fly — the director (the ring) shows where to point, the throttle to set; ⇧F4: the autopilot flies")
        : t("The autopilots fly again (⇧F4: assisted)"),
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
    // (in a room, a faster warp asked by another: warping up accepts it — docs/PLAN-RESEAU.md R6)
    if (dir > 0 && netSession.acceptWarp()) {
      audio.cue("warp-up", 0);
      return;
    }
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
    // (the F-35B's landing near a carrier: on its deck — controller/deckland.ts)
    if (a === "land" && fleet.active === "f35") {
      const said = camera.deckLand();
      if (said) return panel.toast(said);
    }
    // (the F-35B's take-off from a carrier's deck: a short one — controller/deckland.ts)
    if (a === "takeoff" && fleet.active === "f35") {
      const said = camera.deckTakeoff();
      if (said) return panel.toast(said);
    }
    if (a === "dock" && camera.docked)
      return panel.toast(camera.netDocked ? t("Docked to another's craft — UNDOCK first") : t("Docked to the ISS — UNDOCK first"));
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
  /** the F-35's moving parts, eased at their actuators' rates (src/f35/pose.ts) */
  const jetPoser = new JetPoser();
  /** the F-35's flight controls' inputs this frame (the network sends its commands — ui/netsession.ts) */
  let jetIn: JetInputs | null = null;
  /** the F-35's panoramic cockpit display (src/f35/pcd.ts) */
  const jetPcd = new Pcd();
  let pcdWarm = false;
  /** the display's parts drawn, not yet sent to its texture; when it was last sent [ms] */
  const pcdPending: import("./f35/pcd").PcdRect[] = [];
  let pcdSentAt = -Infinity;
  /** its CPU cost each frame it is shown (__bh.pcd.stats): the data, the drawing, the upload */
  const pcdStats = {
    frames: 0,
    draws: 0,
    ms: 0,
    max: 0,
    /** of which the upload (the copy, the mips), the data read (the alerts, pcdData) */
    up: 0,
    read: 0,
    reset() {
      this.frames = this.draws = this.ms = this.max = this.up = this.read = 0;
    },
  };
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
    hudKind: () => keyActions.hudKind(new KeyboardEvent("keydown")),
    execute: () => pilotAuto(camera.transfer || camera.pilot.auto === "transfer" ? "transfer" : "node"),
  });
  flightHud.ground.localPlace = () => {
    const ch = camera.character;
    const body = ch.active ? ch.body : (camera.ourLanded?.body ?? (camera.landed ? camera.local?.F.id : null));
    if (!body) return null;
    const geo = (q: [number, number, number]) => {
      const g = cartToGeodetic(WGS84_A, body === "earth" ? WGS84_F : 0, q);
      return { lat: (g.lat * 180) / Math.PI, lon: (g.lon * 180) / Math.PI };
    };
    const sb = solarBody(body);
    const frame = sb ? null : planetFrame(body, sim.time, settings.spin, settings.massSolar);
    const pose = camera.activePoseNow();
    const ship =
      pose && (camera.ourLanded?.body === body || camera.local?.F.id === body)
        ? geo(
            frame
              ? (toLocal(frame, pose.X, [0, 0, 0]).xi.map((v) => v * frame.mPerM) as [number, number, number])
              : (toBodyFixed(body, pose.X, sim.time).map((v) => v * M_METRES) as [number, number, number]),
          )
        : null;
    const radiusM = sb ? sb.radius * M_METRES : frame!.R * frame!.mPerM;
    const point = ch.active ? geo(ch.q) : (ship ?? (camera.local ? geo(camera.local.L.xi) : null));
    return point
      ? { body, radiusM, ...point, vessel: ch.active ? ship : null, contact: body === "earth" ? renderer.earthScenery.contact : null }
      : null;
  };
  let localMapAt = 0;
  // the on-foot HUD (ui/foothud.ts, PLAN-MODES-AAA M5): the compass, the place, the minimap
  const footHud = new FootHud({
    place: () => camera.character.place(),
    craft: () => flightHud.ground.localPlace?.()?.vessel ?? null,
    marks: () => {
      const ch = camera.character;
      const out: CompassMark[] = [];
      const time = camera.nowTime();
      const sky = (id: string, label: string, col: string) => {
        if (id === ch.body || !solarBody(id)) return;
        const a = ch.skyAzEl(ourState(id, time).pos);
        if (a) out.push({ id, label, az: a.az, col, below: a.el < 0 });
      };
      sky("sun", t("SUN"), "#ffe08a");
      if (ch.body === "earth") sky("moon", t("MOON"), "#dfe6f0");
      if (settings.target !== "sun" && settings.target !== "moon")
        sky(settings.target, (BODY_NAMES[settings.target] ?? settings.target).toUpperCase(), "#7cd6ff");
      return out;
    },
    local: () => {
      const p = flightHud.ground.localPlace?.();
      return p ? { ...p, ...(p.body === "earth" && p.contact ? {} : flightHud.ground.atlas(p.body)) } : null;
    },
    bodyName: (id) => BODY_NAMES[id as Target] ?? id,
    openMap: () => {
      if (!flightHud.mapView) flightHud.toggleMapView();
    },
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
  // the top bar (ui/topbar.ts, PLAN-MODES-AAA M1): the app's one bar in every mode — the modes, the mode's
  // group (the ship's: the flight HUD's chips, clocks, craft and views), the time, the actions, TARS
  const topBar = new TopBar({ setMode: (m) => void setGameMode(m), tars: () => tarsPanel.toggle() });
  for (const e of topBar.emblems) tarsPanel.mirror(e);
  topBar.shipModes.append(flightHud.bar.modes);
  topBar.shipClocks.append(flightHud.bar.clocks);
  topBar.shipActs.append(flightHud.bar.acts);
  // the transport bar (ui/transport.ts): the time, in the top bar (compact flying: the HUD's clocks beside it)
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
  transport.mount(topBar.time, false);
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
  // (the flight's radio: a leader's orders heard, the wingmen's answers — F2, F3)
  // (its roles — I4 —: each in its voice, named in the subtitles — a wingman, Darkstar, Mother, Paddles —; ours about our
  // own craft heard by the room's pilots too)
  camera.onRadio = (text, role) => {
    if (settings.f35RadioRoles === false) return voice.say({ text, speaker: "tower", priority: 2 });
    const r = role ? { role, text } : roleOfLine(text);
    voice.say({ text: r.text, speaker: r.role, priority: r.role === "lso" ? 1 : 2, radio: r.role !== "tower" });
    netSession.radio(r.role, r.text);
  };
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
  const flying = () => camera.piloting && !camera.cinematic && !renderer.offlineActive && !camera.character.active;
  panel.flightKeys = (e) => (flying() || camera.character.active) && (e.key === "m" || e.key === "M") && !e.shiftKey;
  camera.onPadAction = (a) => {
    if (renderer.offlineActive) return;
    if (camera.character.active) {
      if (a === "focus") camera.character.jump();
      else if (a === "rotation") {
        const error = camera.character.board();
        if (error) panel.toast(error);
      } else if (a === "settings") (pauseMenu ??= makePauseMenu()).open();
      else if (a === "recentre") camera.character.yaw = 0;
      else if (a === "dpadUp") camera.character.zoom(-120);
      else if (a === "dpadDown") camera.character.zoom(120);
      touch();
      return;
    }
    if (a === "rotation" && (camera.ourLanded || camera.landed)) {
      const error = camera.character.disembark();
      if (error) panel.toast(error);
      touch();
      return;
    }
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
      photo: () => void setGameMode("photo"),
      capture: () => {
        const why = renderDialog.capture();
        if (why) panel.toast(why);
      },
      render: () => renderDialog.toggle(true),
      atlas: () => atlas.open(),
      skyEvents: () => void skyEventsToggle(),
      multiExposure: () => openMultiExposure(),
      observe: () => openObserve(),
      network: () => openNetwork(),
      networkShown: () => settings.netMenu,
      networkState: () => {
        const r = netPanel.net?.room;
        return r ? tf("In room {0} · {1} aboard", r.code, r.members.length) : null;
      },
      place: () => placePanel.open(),
      time: () => timePanel.open(),
      weather: () => weatherPanel.open(),
      eclipses: () => eclipses.open(),
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
  /** The F-35 flown: a rocket's functions (orbital holds, roll alignment, the orbital autopilots, the
   *  antigravity) are not its own — said, not done. */
  const jetOnly = () => {
    if (!camera.piloting || fleet.active !== "f35") return false;
    panel.toast(t("Not on the F-35: a spacecraft's function"));
    return true;
  };
  const keyActions: Record<KeyAction, (e: KeyboardEvent, arg?: string) => void> = {
    // (the flight's leader: the orders' wheel — F2)
    orders: (e) => {
      if (!e.repeat && flying()) wheel.open(orderItems(), { fr: "Patrouille", en: "Flight" });
    },
    tools: () => DEV_TOOLS && toolsWin.toggle(),
    gameMode: (e, m) => {
      if (!e.repeat) setGameMode(m as GameMode);
    },
    atlas: () => (atlas.isOpen ? atlas.hide() : atlas.open()),
    skyEvents: () => void skyEventsToggle(),
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
    roll: () => (jetOnly() ? undefined : pilotRoll()),
    resetShipView: () => {
      panel.toast(camera.resetShipView()); // (the camera back to the attach points)
      refreshGui();
    },
    hold: (_, h) => (jetOnly() ? undefined : pilotHold(h as Hold)),
    // (the F-35: its own take-off and landing; the orbital autopilots are a rocket's)
    auto: (_, a) => (a !== "takeoff" && a !== "land" && jetOnly() ? undefined : pilotAuto(a as Auto)),
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
      // (the F-35: a fighter, flown by its own flight control laws — no rocket's, no sci-fi computer's)
      else if (fleet.active === "f35") {
        if (settings.flightMode !== "plane") {
          settings.flightMode = "plane";
          onSettingsChange(["flightMode"]);
        }
        panel.toast(t("The F-35 flies by its own flight control laws"));
      } else {
        const order: Settings["flightMode"][] = ["rocket", "plane", "sf"];
        settings.flightMode = order[(order.indexOf(settings.flightMode) + 1) % 3]!;
        onSettingsChange(["flightMode"]);
        panel.toast(tf("{0}: flown as {1}", V.name, FLIGHT_MODE_HELP[settings.flightMode]));
      }
    },
    antigrav: () => {
      if (jetOnly()) return;
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
    cineShot: () => {
      // (the Director view's shot — the view itself put on if another was)
      if (settings.shipMount !== "director") setMount("director");
      else panel.toast(camera.cineNextShot());
    },
    jetSystem: (_, a) =>
      panel.toast(
        a === "stovl"
          ? camera.stovlToggle()
          : a === "recover"
            ? camera.recoverStart()
            : a === "nav"
              ? camera.navToggle()
              : camera.jetToggle(a === "ab" ? "ab" : a === "athr" ? "athr" : "ap"),
      ),
    route: () => routePanel.open(),
    airBrake: () => {
      camera.airBrake = camera.airBrake > 0 ? 0 : 1;
      panel.toast(camera.airBrake > 0 ? t("Air brake out") : t("Air brake in"));
    },
    gear: () => setGear(!camera.gearDown),
    tars: (e) => tarsKey(e),
    pathInView: () => togglePathInView(),
    hudDensity: () => panel.toast(flightHud.cycleDensity()),
    hudKind: () => {
      settings.hudKind = nextHudKind(settings.hudKind);
      onSettingsChange(["hudKind"]);
      refreshGui();
      panel.toast(tf("HUD: {0}", hudKindName(settings.hudKind)));
    },
    missions: () => openMissions(),
    stopFlight: () => releaseControls(),
    ack: () => (camera.combat?.status === "run" ? combatSay(camera.combatTrigger("fire")) : flightHud.acknowledge()),
    combat: (_, a) => {
      if (a === "padlock") {
        camera.padlock = !camera.padlock;
        // (let go: the head back ahead — the lens the view's own again)
        if (!camera.padlock) camera.setLook(0, 0);
        panel.toast(camera.padlock ? t("Head locked on the target — it follows the shot, the fall, the crash") : t("Head free"));
        return;
      }
      combatSay(camera.combatTrigger(a === "cm" ? "cm" : "weapon"));
    },
    pause: () => (pauseMenu ??= makePauseMenu()).open(),
    quickSave: () => quickSave(),
    quickLoad: () => quickLoad(),
    leaveShip: (e) => {
      if (e.repeat || !camera.enabled) return;
      // (in a room: aboard another's craft or off it — docs/PLAN-RESEAU.md R5)
      const aboard = netSession.boardToggle();
      if (aboard !== undefined) {
        panel.toast(aboard);
        touch();
        syncButtons();
        return;
      }
      const error = camera.character.toggle();
      if (error) panel.toast(error);
      else {
        touch();
        syncButtons();
      }
    },
    characterJump: (e) => {
      if (!e.repeat && camera.enabled) camera.character.jump();
    },
    // time, in every mode (in a fight Space is the gun's trigger: the pause on Esc)
    playPause: () => {
      if (camera.combat?.status === "run" && camera.piloting) return;
      playPause();
    },
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
    target: (e) =>
      camera.combat?.status === "run"
        ? combatSay(camera.combatTrigger("lock"))
        : camera.piloting && fleet.active === "f35"
          ? undefined
          : nextTarget(e.shiftKey ? -1 : 1),
    png: () => savePNG(),
    fullscreen: () => fullscreen(),
    lookAt: () => toggleLookAt(),
    telescope: () => toggleTelescope(),
    observe: () => openObserve(),
    autoOrbit: () => cinematic("orbit"),
    dive: () => cinematic("dive"),
    journey: () => cinematic("journey"),
    standOn: () => {
      // (on foot: the tripod where the walker stands, looking where the view looked — PLAN-MODES-AAA M7)
      const why = camera.character.active ? tripodHere() : standOn();
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
  // the F-35's pad layout (input/jetpad.ts): its keymap actions, and its own — Y's lock (the fight's, else the
  // radar's next) and its hold the intercept, Menu held the settings
  camera.onJetPadAction = (a, arg) => {
    if (renderer.offlineActive) return;
    if (a === "lock") {
      if (camera.combat?.status === "run") combatSay(camera.combatTrigger("lock"));
      else panel.toast(camera.radarLockNext());
      camera.pad.rumble(0.05, 0.25, 40);
    } else if (a === "intercept") panel.toast(camera.icptStart());
    else if (a === "settings") (pauseMenu ??= makePauseMenu()).open();
    else keyActions[a as KeyAction]?.(new KeyboardEvent("keydown"), arg);
  };
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
  /** the view of exception flown last (S2 — its photograph framed when the photo mode opens in it: S3) */
  let sceneView: string | null = null;
  /** The photo mode opened: in a view of exception still flown (its mission or its challenge), framed as the scene
   *  says once — the camera about the craft, the field, the exposure, the bloom, the depth of field. */
  const openPhoto = () => {
    const v = sceneView ? EXCEPTIONAL_VIEWS.find((x) => x.id === sceneView) : undefined;
    const flown = v && (v.challengeId ? camera.chal?.status === "run" : camera.mission?.run.spec.id === v.id);
    if (v && flown && !replay.active && camera.piloting) {
      const P = v.photo;
      // (the view "around" takes its angle from where the view was on its first step: the scene's set after it)
      const frame = () => (camera.outside = { ...camera.outside, yaw: P.yaw, pitch: P.pitch, dist: P.dist });
      if (settings.shipMount !== "around") {
        setMount("around");
        setTimeout(frame, 250);
      } else frame();
      camera.setFov(P.fov);
      Object.assign(settings, { exposure: P.exposure, bloom: P.bloom, dof: !!P.dof });
      onSettingsChange(["exposure", "bloom", "dof"]);
      panel.toast(tf("Photo of the scene: {0}", P.note));
      sceneView = null;
    }
    openPhotoMode();
  };
  const openPhotoMode = () =>
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
      multi: () => openMultiExposure(),
      video: {
        shots: () => renderDialog.shots(),
        start: (o) => renderDialog.startVideo(o),
        stop: () => renderDialog.stopVideo(),
        state: () => renderDialog.videoState(),
      },
      toast: (x) => panel.toast(x),
    })).open();

  /** The replay opened (or its trailer): why not said. */
  const replayOpen = (trailer: boolean) => {
    const why = replay.open({ trailer });
    if (why) panel.toast(why);
    return why;
  };
  // ---- the replay and its trailer (ui/replay.ts, S3): the tape drawn again under the replay's cameras, the flight held
  /** the field when the replay opened (its cameras' when they have none of their own); a photo over it: the photo's */
  let replayFov = 60,
    replayPhoto = false;
  const replay = new ReplayPlayer<ReplayData>({
    tape,
    blocked: () =>
      netPanel.net?.room
        ? t("In a room the others fly on: no replay")
        : renderer.offlineActive
          ? t("A render is running: wait for it")
          : !camera.piloting
            ? t("Fly a craft first (F1)")
            : null,
    enter: () => {
      if (camera.spectating) setSpectator(false);
      photoMode?.close();
      const was = { settings: { ...settings }, time: sim.time, water: renderer.water.clock };
      replayFov = settings.fov;
      replayTrails = null;
      replayTrailI = -1;
      return () => {
        photoMode?.close();
        Object.assign(settings, was.settings);
        sim.setTime(was.time);
        renderer.water.clock = was.water;
        camera.sync();
        refreshGui();
        touch();
        touchDisplay();
      };
    },
    apply: (f, pose, next, u) => {
      const d = f.data;
      Object.assign(settings, poseBetween(d.pose, next.data.pose, u));
      settings.shipMount = pose.up ? "director" : "cockpit";
      settings.shipLookYaw = 0;
      settings.shipLookPitch = 0;
      if (!replayPhoto) settings.fov = pose.fov ?? replayFov;
      renderer.shipPose = { eye: pose.eye, aim: pose.aim, up: pose.up };
      renderer.shipPlace = null;
      renderer.shipThrust = d.thrust;
      renderer.shipPlasma = d.plasma;
      renderer.jetPose = d.jet;
      // (the others where they were, on this camera's axes)
      const S = shipToCamera({ eye: pose.eye, aim: pose.aim, up: pose.up }, 0, 0).S as M3r;
      renderer.combatOthers = othersTo(othersBetween(d.others, next.data.others, u), (v) => mulS(S, v));
      renderer.seaWakes = d.wakes;
      renderer.shipContrails = trailsAt(tape.index(f.t), u);
      renderer.shipReentry = null;
      renderer.shake = [0, 0];
      renderer.water.clock = d.water + (next.data.water - d.water) * u;
      sim.time = d.time + (next.data.time - d.time) * u;
      sim.timeDirty = true;
      setSceneTime(sim.time);
    },
    cockpit: () => mountPose("cockpit"),
    booms: (f) => f.data.booms,
    fov: () => settings.fov,
    photo: (onClose) => {
      replayPhoto = true;
      openPhoto();
      if (photoMode)
        photoMode.onClosed = () => {
          replayPhoto = false;
          onClose();
        };
    },
    video: (frames, fps, draft) => {
      replayTrails = null;
      replayTrailI = -1;
      const out = frames.map((x, i) => ({
        t: i / fps,
        settings: {
          ...poseBetween(x.f.data.pose, x.next.data.pose, x.u),
          shipMount: x.pose.up ? "director" : "cockpit",
          shipLookYaw: 0,
          shipLookPitch: 0,
          fov: x.pose.fov ?? replayFov,
        } as Partial<Settings>,
        state: {
          time: x.f.data.time + (x.next.data.time - x.f.data.time) * x.u,
          water: x.f.data.water + (x.next.data.water - x.f.data.water) * x.u,
          ev: x.f.data.exp,
          ship: { eye: x.pose.eye, aim: x.pose.aim, up: x.pose.up },
          thrust: x.f.data.thrust,
          plasma: x.f.data.plasma,
          path: null,
          others: othersTo(othersBetween(x.f.data.others, x.next.data.others, x.u), (v) =>
            mulS(shipToCamera({ eye: x.pose.eye, aim: x.pose.aim, up: x.pose.up }, 0, 0).S as M3r, v),
          ),
          jet: x.f.data.jet,
          wakes: x.f.data.wakes,
          // (the trails as they were: played again up to this frame, copied — the buffer is the replay's)
          contrails: ((c) => c && { data: c.data.slice(0, c.n * SEG_FLOATS), n: c.n })(trailsAt(tape.index(x.f.t), x.u)),
        } as TakeState,
      }));
      // (the scene put back first: the video's own snapshot is then the flight's)
      replay.close();
      take.load(out, { ...settings });
      renderDialog.takeChanged();
      return renderDialog.startVideo({ shot: "take", fps, draft });
    },
    title: () => {
      const g = camera.geoNow();
      const where =
        camera.mission?.run.spec.title ??
        (g ? `${Math.abs(g.lat).toFixed(2)}° ${g.lat >= 0 ? "N" : "S"} · ${Math.abs(g.lon).toFixed(2)}° ${g.lon >= 0 ? "E" : "W"}` : "");
      return {
        craft: VESSELS[fleet.active].name,
        place: where,
        date: dateOf(sim.time).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }),
      };
    },
    caption: (m) => {
      const u = unitsFor(settings);
      const parts = [u.fSpd(m.speed)];
      if (m.agl < 1000) parts.push(tf("{0} over the ground", u.fAlt(m.agl)));
      if (m.nz > 4) parts.push(`${m.nz.toFixed(1)} g`);
      return parts.join(" · ");
    },
    toast: (x) => panel.toast(x),
  });

  // ---- the four modes (game/modes.ts, PLAN-MODES-AAA M1): the ship, on foot, the free camera, photo — read from
  // the state each frame, changed by the top bar's tabs, F1–F4, TARS (set_mode) and __bh.mode
  /** the mode the photo mode was opened over (it goes back to it) */
  let photoOver: Exclude<GameMode, "photo"> | null = null;
  function modeState(ground = false): ModeState {
    const pil = camera.piloting;
    return {
      ship: settings.ship,
      piloting: pil,
      spectating: camera.spectating && !camera.character.active,
      onFoot: camera.character.active,
      photo: !!photoMode?.isOpen,
      photoOver,
      landedStill: pil && !!(camera.ourLanded || camera.landed) && (camera.airInfo?.()?.speed ?? 0) <= 0.5,
      groundBelow: ground && !camera.character.active ? (camera.viewController().groundBelow()?.body ?? null) : null,
      rendering: renderer.offlineActive,
    };
  }
  const gameMode = (): GameMode => modeOf(modeState());
  /** The walk left for the ship or the free camera: with a ship flown, the walker's camera stays out as the
   *  spectator (carried back onto the ship for the Ship mode); without one, the free camera where it stood. */
  function leaveWalk(to: "ship" | "free") {
    const ch = camera.character;
    if (camera.piloting) {
      ch.stop({ keepView: true });
      if (to === "ship") camera.stopSpectator();
    } else {
      const v = camera.spectator?.s;
      if (v) {
        for (const k of [...POSE_KEYS, "velR", "velT", "velP", "motion"] as const)
          (settings as unknown as Record<string, unknown>)[k] = v[k];
        settings.rotation = "free";
        settings.lookAt = false;
      }
      ch.stop();
      camera.sync();
    }
    syncButtons();
    touch();
  }
  /** One step of a change of mode (`below`: the ground under the view when the change began); why it failed, or null. */
  function runModeStep(step: ModeStep, from: ModeState, below: ReturnType<CameraController["groundBelow"]>): string | null {
    switch (step) {
      case "openPhoto":
        photoOver = baseMode(from);
        openPhoto();
        return null;
      case "closePhoto":
        photoMode?.close();
        photoOver = null;
        return null;
      case "startSpectator":
        setSpectator(true);
        return camera.spectating ? null : t("The spectator leaves a ship flown: fly one first (K)");
      case "stopSpectator":
        setSpectator(false);
        return null;
      case "board":
        return camera.character.board();
      case "stopWalking":
        leaveWalk(planned === "ship" ? "ship" : "free");
        return null;
      case "disembark": {
        if (camera.spectating) setSpectator(false);
        const err = camera.character.disembark();
        if (!err) touch(), syncButtons();
        return err;
      }
      case "walkHere": {
        // (a spectator out: its view becomes the walker's — character.ts prepare)
        if (!below) return t("On foot: no ground near the camera — the Atlas puts the explorer anywhere");
        const err = camera.character.start(below.body, below.lat, below.lon);
        if (!err) touch(), syncButtons();
        return err;
      }
      case "shipOn":
      case "shipOff":
        if (settings.ship !== (step === "shipOn")) actions["btn-ship"]!();
        return null;
    }
  }
  let planned: GameMode | null = null;
  /** The game into a mode (the steps of game/modes.ts planMode); why not, or null. */
  function setGameMode(to: GameMode, quiet = false): string | null {
    const below = camera.character.active ? null : camera.viewController().groundBelow();
    const from = { ...modeState(), groundBelow: below?.body ?? null };
    const p = planMode(from, to, { hatch: camera.character.active && camera.character.accessDistance() <= 3 });
    if ("refused" in p) {
      const why = t(p.refused);
      if (!quiet) panel.toast(why);
      return why;
    }
    planned = to;
    try {
      for (const step of p.steps) {
        const err = runModeStep(step, from, below);
        if (err) {
          if (!quiet) panel.toast(err);
          return err;
        }
      }
    } finally {
      planned = null;
    }
    syncMode();
    if (p.steps.length && !quiet && to !== "photo") panel.toast(tf("Mode: {0}", modeName(to)));
    return null;
  }
  /** The top bar in the mode now: its tab, its groups, the time's bar (compact flying: the HUD's clocks). */
  let shownMode: GameMode | null = null;
  let modeLineAt = 0;
  function syncMode(now = performance.now()) {
    const m = gameMode();
    if (m !== shownMode) {
      shownMode = m;
      topBar.setMode(m);
      transport!.mount(topBar.time, m === "ship");
      if (m !== "photo") photoOver = null;
    }
    if (now - modeLineAt < 250) return;
    modeLineAt = now;
    // (the mode's line: on foot, the world and the place; photo, the way back)
    if (m === "foot") {
      const p = flightHud.ground.localPlace?.();
      // (the place as the on-foot HUD's card writes it: five decimals, the longitude wrapped)
      topBar.setContext(
        p ? (BODY_NAMES[p.body as Target] ?? p.body) : t("On foot"),
        p ? fmtLatLon(p.lat, p.lon, 5, [t("N"), t("S"), t("E"), t("W")]) : "",
      );
    } else if (m === "photo") topBar.setContext(t("Photo"), tf("Esc: back to {0}", modeName(baseMode(modeState()))));
    else topBar.setContext("");
    topBar.setIcon("btn-sound", settings.sound ? TB_ICONS.sound : TB_ICONS.mute, !settings.sound);
    // (the tabs a change would refuse now: dimmed, the reason in their tips)
    const st = modeState(true);
    // (the hatch near: once for every tab)
    const hatch = camera.character.active && camera.character.accessDistance() <= 3;
    for (const k of GAME_MODES) {
      const p = k === m ? null : planMode(st, k, { hatch });
      topBar.setAvailable(k, p && "refused" in p ? t(p.refused) : null);
    }
  }

  // the radial wheel (ui/wheel.ts): Tab held opens it, released does the sector pointed at; a tap is
  // still the next target
  const wheel = new RadialWheel();
  /** The F-35's wheel: its own systems — no rocket's holds, no flight computer's autopilots, no planets. */
  const jetWheel = (): WheelItem[] => {
    const M = camera.jetModes;
    const C = camera.combat?.status === "run" ? camera.combat : null;
    const say = (s: string | null) => s && panel.toast(s);
    return [
      {
        label: { fr: "Pilote auto", en: "Autopilot" },
        on: M.alt !== null || M.hdg !== null || M.spd !== null || camera.nav.on.l,
        sub: [
          {
            label: { fr: "Altitude et cap", en: "Altitude & heading" },
            key: "'",
            on: M.alt !== null,
            run: () => say(camera.jetToggle("ap")),
          },
          { label: { fr: "Auto-manette", en: "Autothrottle" }, key: "⇧'", on: M.spd !== null, run: () => say(camera.jetToggle("athr")) },
          {
            label: { fr: "NAV (plan de vol)", en: "NAV (flight plan)" },
            key: "⇧M",
            on: camera.nav.on.l,
            run: () => say(camera.navToggle()),
          },
          {
            label: { fr: "Décollage auto", en: "Auto take-off" },
            key: "U",
            on: camera.pilot.auto === "takeoff",
            run: () => pilotAuto("takeoff"),
          },
        ],
      },
      { label: { fr: "Postcombustion", en: "Afterburner" }, key: "⇧W", on: M.ab, run: () => say(camera.jetToggle("ab")) },
      { label: { fr: "STOVL", en: "STOVL" }, key: "⇧B", on: camera.stovl.on, run: () => say(camera.stovlToggle()) },
      {
        label: { fr: "Train, volets", en: "Gear, flaps" },
        sub: [
          { label: { fr: "Train", en: "Gear" }, key: "G", on: camera.gearDown, run: () => setGear(!camera.gearDown) },
          {
            label: { fr: "Volets", en: "Flaps" },
            key: "P",
            on: (camera.airFlight.cfg.flaps ?? 0) > 0,
            run: () => keyActions.flaps(new KeyboardEvent("keydown")),
          },
          {
            label: { fr: "Aérofreins", en: "Air brake" },
            key: "⇧P",
            on: camera.airBrake > 0,
            run: () => keyActions.airBrake(new KeyboardEvent("keydown")),
          },
        ],
      },
      ...(C
        ? [
            {
              label: { fr: "Armes", en: "Weapons" },
              sub: [
                { label: { fr: "Arme suivante", en: "Next weapon" }, key: "=", run: () => say(camera.combatTrigger("weapon")) },
                { label: { fr: "Verrouiller", en: "Lock" }, key: "Tab", run: () => say(camera.combatTrigger("lock")) },
                { label: { fr: "Leurres", en: "Decoys" }, key: "−", run: () => say(camera.combatTrigger("cm")) },
                { label: { fr: "Fin du combat", en: "End the fight" }, run: () => camera.combatEnd() },
              ],
            },
          ]
        : []),
      // (the F-35's radar, always on: its lock, its mode — controller/radar.ts)
      {
        label: { fr: "Radar", en: "Radar" },
        sub: [
          { label: { fr: "Verrou suivant", en: "Next lock" }, key: "Tab", run: () => say(camera.radarLockNext()) },
          { label: { fr: `Mode (${camera.radar.mode})`, en: `Mode (${camera.radar.mode})` }, run: () => say(camera.radarMode()) },
          { label: { fr: "Lâcher le verrou", en: "Drop the lock" }, run: () => (camera.radar.unlock(), say(t("Lock dropped"))) },
          { label: { fr: "Intercepter", en: "Intercept" }, key: "⇧Tab", on: !!camera.icpt, run: () => say(camera.icptStart()) },
          // (in formation with the airliner locked — the real traffic: controller/traffic.ts)
          { label: { fr: "Formation sur la cible", en: "Formation on the lock" }, run: () => say(camera.trafficForm()) },
        ],
      },
      // (the flight: the leader's orders, the AI wingmen, a room player's wing — controller/orders.ts, ui/netsession.ts)
      { label: { fr: "Patrouille", en: "Flight" }, on: !!camera.form, sub: orderItems() },
      // (the ways flown: the plan, the approach, the autopilot's modes — A3)
      {
        label: { fr: "Navigation", en: "Navigation" },
        on: camera.nav.on.l || !!camera.ilsRun,
        sub: [
          { label: { fr: "Plan de vol", en: "Flight plan" }, key: "⇧O", on: camera.nav.on.l, run: () => routePanel.open() },
          {
            label: { fr: "Approche ILS", en: "ILS approach" },
            hint: { fr: "La piste la plus proche, face au vent", en: "The nearest runway, into the wind" },
            on: !!camera.ilsRun,
            run: () => panel.toast(camera.ilsRun ? (camera.ilsOff(), t("ILS approach off")) : camera.ilsStart()),
          },
          { label: { fr: "Modes du pilote automatique", en: "Autopilot modes" }, sub: modeItems() },
          { label: { fr: "Carte", en: "Map" }, key: "M", on: flightHud.mapView, run: () => flightHud.toggleMapView() },
          { label: { fr: "Carte de mission", en: "Mission map" }, on: !!camera.mission, run: () => missionMap.open() },
          { label: { fr: "Préparer un vol", en: "Prepare a flight" }, run: () => flightHub.open() },
        ],
      },
      // (what to fly: the school, the challenges and fights, the views of exception)
      {
        label: { fr: "Leçons et défis", en: "Lessons & challenges" },
        on: !!C || camera.chal?.status === "run" || !!camera.mission || !!camera.course,
        sub: [
          {
            label: { fr: "École de vol", en: "Flight school" },
            hint: { fr: "Démonstrations, leçons guidées, essais notés", en: "Demonstrations, guided lessons, graded tries" },
            on: !!camera.course,
            run: () => flightSchool(instrHost),
          },
          {
            label: { fr: "Défis, combats, missions", en: "Challenges, fights, missions" },
            on: !!C || camera.chal?.status === "run" || !!camera.mission,
            run: () => challengePanel.open(),
          },
          { label: { fr: "Vues d'exception", en: "Views of exception" }, run: () => openViews(viewsHost) },
        ],
      },
      // (the camera: the view, a photo, the replay and its trailer)
      {
        label: { fr: "Caméra", en: "Camera" },
        sub: [
          { label: { fr: "Vue suivante", en: "Next view" }, key: "V", run: () => keyActions.mount(new KeyboardEvent("keydown")) },
          { label: { fr: "Photo", en: "Photo" }, run: openPhoto },
          { label: { fr: "Replay", en: "Replay" }, run: () => replayOpen(false) },
          { label: { fr: "Bande-annonce", en: "Trailer" }, run: () => replayOpen(true) },
        ],
      },
    ];
  };

  /** The leader's orders as a wheel (F2): each to the room's wingmen and the AI's; the formations a wheel of their own. */
  /** The F-35's autopilot modes (A3 — controller/jetmodes.ts): the orbit, the hold, the terrain following, the tanker,
   *  the ILS, a point flown to on the map, the aerobatics' demonstrations. */
  const modeItems = (): WheelItem[] => {
    const say = (s: string | null) => s && panel.toast(s);
    const g = () => camera.geoNow();
    return [
      {
        label: { fr: "Orbite ici (droite)", en: "Orbit here (right)" },
        on: !!camera.orbitMode,
        run: () => say(camera.orbitStart({ dir: 1 })),
      },
      { label: { fr: "Orbite ici (gauche)", en: "Orbit here (left)" }, run: () => say(camera.orbitStart({ dir: -1 })) },
      {
        label: { fr: "Hippodrome ici", en: "Hold here" },
        on: !!camera.holdPat,
        run: () => {
          const p = g();
          if (p) say(camera.holdStart({ lat: p.lat, lon: p.lon }, p.track));
        },
      },
      {
        label: { fr: "Suivi de terrain", en: "Terrain following" },
        on: camera.tfAgl != null,
        sub: [
          ...JET_MODES.tfHeights.map((h) => ({
            label: { fr: `${h} m`, en: `${h} m` },
            on: camera.tfAgl === h,
            run: () => say(camera.tfStart(h)),
          })),
          { label: { fr: "Coupé", en: "Off" }, run: () => say(camera.tfStart(null)) },
        ],
      },
      { label: { fr: "Ravitailleur", en: "Tanker" }, on: !!camera.icpt?.slot, run: () => say(camera.tankerStart()) },
      { label: { fr: "Approche ILS", en: "ILS approach" }, on: !!camera.ilsRun, run: () => say(camera.ilsStart()) },
      { label: { fr: "Voler vers… (carte)", en: "Fly to… (map)" }, run: () => missionMap.open() },
      { label: { fr: "Voltige (démonstration)", en: "Aerobatics (demonstration)" }, run: () => challengePanel.open() },
      { label: { fr: "Modes coupés", en: "Modes off" }, run: () => say(camera.modesOff()) },
    ];
  };
  const orderItems = (): WheelItem[] => {
    const say = (s: string | null) => s && panel.toast(s);
    const order = (id: OrderId, arg?: string) => say(camera.flightOrder(id, arg));
    const item = (id: OrderId): WheelItem => ({ label: { fr: ORDERS[id].fr, en: ORDERS[id].en }, run: () => order(id) });
    // (in a room: a wingman's place on each player flying — the formation flown for us, the first place free on
    // his wing —; again on him, or Leave: off)
    const wings: WheelItem[] = netSession.leaders().map((p) => ({
      label: { fr: `Ailier de ${p.name}`, en: `${p.name}'s wingman` },
      hint: { fr: "Formation automatique sur son aile", en: "The formation flown on his wing for you" },
      on: camera.form?.slot === p.slot,
      run: () => say(netSession.formation(p.slot)),
    }));
    if (camera.form)
      wings.push({
        label: { fr: "Quitter la formation", en: "Leave the formation" },
        run: () => {
          camera.formOff();
          say(t("Formation off — altitude, heading and speed held"));
        },
      });
    return [
      ...wings,
      // (the AI wingmen: none to three, in turn — controller/wingmen.ts)
      {
        label: { fr: `Ailiers IA (${settings.wingmen})`, en: `AI wingmen (${settings.wingmen})` },
        on: settings.wingmen > 0,
        run: () => {
          settings.wingmen = (settings.wingmen + 1) % 4;
          say(settings.wingmen ? tf("AI wingmen: {0}", settings.wingmen) : t("AI wingmen: none"));
        },
      },
      item("rejoin"),
      {
        label: { fr: "Formation", en: "Formation" },
        sub: FORMATION_IDS.map((id) => ({
          label: { fr: FORMATIONS[id].fr, en: FORMATIONS[id].en },
          on: settings.formShape === id,
          run: () => order("shape", id),
        })),
      },
      item("breakL"),
      item("breakR"),
      // (the fight's orders, the flight's others: wheels of their own — the main one kept to a glance)
      {
        label: { fr: "Ordres de combat", en: "Combat orders" },
        sub: [item("attack"), item("engage"), item("cover")],
      },
      {
        label: { fr: "Autres ordres", en: "More orders" },
        sub: [
          item("tighten"),
          item("loosen"),
          item("hold"),
          item("rtb"),
          // (the pass for the spectators: the tight diamond, the camera standing ahead on the way — the fly-by's)
          {
            label: { fr: ORDERS.show.fr, en: ORDERS.show.en },
            run: () => {
              order("show");
              setTimeout(() => (settings.shipMount = "flyby"), 4000);
            },
          },
        ],
      },
    ];
  };
  const wheelItems = (): WheelItem[] => {
    const P = camera.pilot;
    if (flying() && fleet.active === "f35") return jetWheel();
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
              ["land", { fr: "Atterrir", en: "Land" }, "F7"],
              ["takeoff", { fr: "Décoller", en: "Take off" }, "U"],
              ["dock", { fr: "Amarrer", en: "Dock" }, "B"],
              ["entry", { fr: "Rentrée", en: "Entry" }, "⇧G"],
            ] as const
          ).map(([a, label, key]) => ({ label, key, on: P.auto === a, run: () => pilotAuto(a) })),
        },
        // (the ways flown and the places, then the camera: wheels of their own — the main one kept to a glance)
        {
          label: { fr: "Navigation", en: "Navigation" },
          on: flightHud.mapView || camera.nav.on.l || !!camera.ilsRun,
          sub: [
            { label: { fr: "Carte", en: "Map" }, key: "M", on: flightHud.mapView, run: () => flightHud.toggleMapView() },
            { label: { fr: "Placer", en: "Place" }, run: () => placePanel.open() },
            ...(VESSELS[fleet.active].flies
              ? [
                  { label: { fr: "Plan de vol", en: "Flight plan" }, key: "⇧O", on: camera.nav.on.l, run: () => routePanel.open() },
                  { label: { fr: "Carte de mission", en: "Mission map" }, on: !!camera.mission, run: () => missionMap.open() },
                  {
                    label: { fr: "Approche ILS", en: "ILS approach" },
                    on: !!camera.ilsRun,
                    run: () => panel.toast(camera.ilsRun ? (camera.ilsOff(), t("ILS approach off")) : camera.ilsStart()),
                  },
                  { label: { fr: "Préparer un vol", en: "Prepare a flight" }, run: () => flightHub.open() },
                  { label: { fr: "Défis", en: "Challenges" }, on: camera.chal?.status === "run", run: () => challengePanel.open() },
                ]
              : []),
          ],
        },
        {
          label: { fr: "Caméra", en: "Camera" },
          sub: [
            { label: { fr: "Vue suivante", en: "Next view" }, key: "V", run: () => keyActions.mount(new KeyboardEvent("keydown")) },
            { label: { fr: "Photo", en: "Photo" }, run: openPhoto },
            { label: { fr: "Replay", en: "Replay" }, run: () => replayOpen(false) },
            { label: { fr: "Bande-annonce", en: "Trailer" }, run: () => replayOpen(true) },
          ],
        },
      ];
    return [
      { label: { fr: "Vue", en: "View" }, key: "V", run: () => nextView(1) },
      { label: { fr: "Regarder la cible", en: "Look at target" }, key: "C", on: settings.lookAt, run: toggleLookAt },
      { label: { fr: "Télescope", en: "Telescope" }, key: "Y", on: settings.telescope, run: toggleTelescope },
      ...(framedView()
        ? [
            { label: { fr: "Le ciel d'ici", en: "The sky from here" }, key: "⇧F8", run: () => void skyEventsToggle() },
            { label: { fr: "Observatoire", en: "Observatory" }, key: "⇧Y", run: () => openObserve() },
            { label: { fr: "Surimpression", en: "Multiple exposure" }, run: () => openMultiExposure() },
          ]
        : []),
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
      { label: { fr: "Voler en F-35", en: "Fly the F-35" }, run: () => flightHub.open() },
      ...(settings.netMenu ? [{ label: { fr: "Réseau", en: "Network" }, run: openNetwork }] : []),
      { label: { fr: "Défis F-35", en: "F-35 challenges" }, run: () => challengePanel.open() },
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
  /** when Tab went down (its event's time): a release within the hold's 220 ms is a tap, even if a slow frame let
   *  the wheel's timer fire first */
  let tabDownTs = 0;
  addEventListener("keydown", (e: KeyboardEvent) => {
    // (held: the key's repeats swallowed — they went on to the bindings and stepped through the targets while
    // the wheel opened)
    if (e.key === "Tab" && e.repeat && !isTyping(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key !== "Tab" || e.repeat || isTyping(e) || titleScreen?.isOpen || paused) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    tabShift = e.shiftKey;
    tabDownTs = e.timeStamp;
    clearTimeout(tabTimer);
    tabTimer = window.setTimeout(() => {
      tabTimer = 0;
      wheel.open(wheelItems(), flying() ? { fr: "Pilotage", en: "Flight" } : { fr: "Caméra", en: "Camera" });
    }, 220);
  });
  addEventListener("keyup", (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    // (released within the hold's time — the wheel opened only because a long frame held the page —: a tap)
    if (!tabTimer && wheel.isOpen && wheel.selected < 0 && e.timeStamp - tabDownTs < 220) {
      wheel.close();
      tabTimer = -1;
    }
    if (tabTimer) {
      // (a tap: the next target — in a fight, the radar's next lock)
      clearTimeout(tabTimer);
      tabTimer = 0;
      // (⇧Tab in the F-35: the INTERCEPT autopilot on the lock — controller/intercept.ts)
      if (tabShift && camera.piloting && fleet.active === "f35") panel.toast(camera.icptStart());
      else if (camera.combat?.status === "run" && camera.piloting) combatSay(camera.combatTrigger("lock"));
      // (the F-35 flown: no planets to step through — its Tab the radar's next lock)
      else if (camera.piloting && fleet.active === "f35") panel.toast(camera.radarLockNext());
      else nextTarget(tabShift ? -1 : 1);
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
    // (a spectator on its tripod: an observer — the view's keys (Y, ⇧Y, C, Tab…), not the craft's it left)
    const observer = camera.spectating && camera.viewController().s.rotation === "tripod";
    const b = matchKey(e, flying() && !observer && !(camera.spectating && camKey), camKey, effectiveBindings(), camera.character.active);
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
      if (st.others) renderer.combatOthers = st.others;
      if (st.jet) renderer.jetPose = st.jet;
      if (st.wakes) renderer.seaWakes = st.wakes;
      if (st.contrails !== undefined) renderer.shipContrails = st.contrails;
      setSceneTime(st.time);
    },
    // (the scene as it was: the flight — a saved game's state —, every setting, the clocks)
    snapshot: () => ({
      save: tools.snapshot("before the video"),
      settings: { ...settings },
      time: sim.time,
      water: renderer.water.clock,
      ev: renderer.autoExposureEV,
      view: viewHold(),
    }),
    restore: (x) => {
      const b = x as { save: GameSave; settings: Settings; time: number; water: number; ev: number; view: ReturnType<typeof viewHold> };
      tools.load(b.save, { quiet: true });
      Object.assign(settings, b.settings);
      sim.setTime(b.time);
      renderer.water.clock = b.water;
      renderer.autoExposureEV = b.ev;
      camera.sync();
      if (b.view) viewBack(b.view);
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
    // (the director's cameras: the ship flown, its Director view put on — the scene's snapshot puts the view back)
    director: {
      available: () => settings.ship && camera.piloting && !camera.spectating,
      set: () => {
        const was = settings.shipMount as Mount;
        setMount("director");
        return () => {
          if (settings.shipMount === "director" && was !== "director") setMount(was);
        };
      },
    },
    // (a draft: seen at once; a final: saved, then seen)
    onVideo: (v) => {
      tarsVideoDone = true;
      if (!v.draft) {
        download(v.blob, v.name);
        panel.toast(tf("Video saved · {0}", v.name));
      }
      videoPreview.show(v);
    },
    // (a live capture grabs the view each exposure: one user of the renderer's export at a time)
    busy: () => (liveCapture.running ? t("A live capture is running: stop it first") : null),
  });
  const videoPreview = new VideoPreview({
    download: (b, name) => download(b, name),
    final: (v) => renderDialog.startVideo({ ...v.job, draft: false }),
    shotName: (v) => renderDialog.shots().find((x) => x.id === v.shot)?.label ?? v.shot,
    finalSize: () => renderDialog.size(),
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
  // the gamepad's rumble in flight (docs/PLAN-AVIATION-AAA.md, V5): the wing's buffet, a touchdown, at most every 150 ms
  let padFeltAt = 0;
  let padTouch = -1;
  const padFeel = (nowMs: number) => {
    if (!camera.pad.connected || !camera.piloting || nowMs - padFeltAt < 150) return;
    const L = camera.airFlight.last;
    const buffet = L ? (L.out.buffet ?? 0) * Math.min(L.out.q / 4000, 1) : 0;
    const touch = camera.lastTouch && camera.lastTouch.n !== padTouch ? camera.lastTouch : null;
    if (camera.lastTouch) padTouch = camera.lastTouch.n;
    const strong = Math.max(0.6 * buffet, touch ? Math.min(touch.sink / 3, 1) : 0);
    if (strong < 0.05) return;
    padFeltAt = nowMs;
    camera.pad.rumble(strong, 0.4 * buffet, touch ? 220 : 170);
  };
  // (the F-35 chosen: on the runway nearest the craft flown — docs/PLAN-F35.md)
  // (a click in the F-35's cockpit: its panoramic display touched — cockpit/pick.ts, material 36)
  camera.onJetTouch = (nx, ny) => {
    if (settings.vessel !== "f35" || !(settings.shipMount === "cockpit" || settings.shipMount === "cabin")) return false;
    const h = renderer.ship.jetPick(nx, ny);
    if (!h?.screen) return false;
    const what = jetPcd.touch(h.screen.u, h.screen.v);
    if (what) panel.toast(`PCD · ${what}`);
    return true;
  };
  // (what the panoramic display's keys ask of the craft — never a shot: the weapon, the radar's mode, its lock, the
  // countermeasures — through the controller's own calls, as the crew's backseater's)
  // (and the autopilot's: its selectors and LNAV / VNAV by the controller's calls, its modes by the game's tools —
  // the crew's MCP's —, their answer toasted when it comes)
  const pcdTool = (name: string, args: Record<string, unknown>) => {
    void Promise.resolve()
      .then(() => tarsTools.find((x) => x.name === name)?.run(args as never, new AbortController().signal))
      .then((r) => {
        const v = r && typeof r === "object" && "result" in r ? (r as { result: unknown }).result : r;
        const line =
          typeof v === "string"
            ? v
            : v && typeof v === "object"
              ? String((v as Record<string, unknown>).note ?? (v as Record<string, unknown>).result ?? "")
              : "";
        if (line) panel.toast(`PCD · ${line.slice(0, 120)}`);
      })
      .catch((e) => panel.toast(`PCD · ${String((e as Error).message ?? e)}`));
    return null;
  };
  jetPcd.act = (a) => {
    switch (a.kind) {
      case "weapon":
        return camera.weaponSelect(a.w);
      case "radar":
        return camera.radarModeSet(a.mode);
      case "lock":
        return camera.lockOnName();
      case "cm":
        return camera.combat?.status === "run"
          ? (camera.combatTrigger("cm") ?? t("Flares and chaff out"))
          : t("No fight running: the weapons are live in a fight or a mission");
      case "ap":
        return camera.apSet(a.set);
      case "nav":
        return camera.navSet({ ...(a.l !== undefined ? { l: a.l } : {}), ...(a.v !== undefined ? { v: a.v } : {}) });
      case "apMode":
        return a.mode === "ils"
          ? pcdTool("approach", { action: "ils" })
          : a.mode === "ilsOff"
            ? pcdTool("approach", { action: "off" })
            : a.mode === "goAround"
              ? pcdTool("flight_action", { action: "go_around" })
              : a.mode === "tf"
                ? pcdTool("jet_mode", { action: "tf", aglM: 150 })
                : pcdTool("jet_mode", { action: a.mode });
    }
  };
  camera.onJetStart = () => {
    try {
      tools.lineUp();
    } catch (e) {
      panel.toast(String((e as Error).message ?? e));
    }
  };
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
    place: (f) => placeShip(f),
  });
  flightHud.onPlace = () => placePanel.open();
  // a plane's flight plan (ui/routepanel.ts, PLAN-F35 F8): its waypoints on the map, NAV flying it
  const routePanel = new RoutePanel({ camera, toast: (s) => panel.toast(s) });
  // a flight prepared (ui/flighthub.ts): the F-35 at an airfield, its hour, its weather, its fuel, its plan
  const hubHost: HubHost = {
    tools,
    settings,
    camera,
    weatherChanged: () => {
      metarTick();
      touch();
      scheduleUrlSave();
    },
    toast: (s) => panel.toast(s),
    openRoute: () => routePanel.open(),
  };
  const flightHub = new FlightHub(hubHost);
  // the F-35's challenges (ui/challengepanel.ts, PLAN-F35 F9): gate courses, graded landings, aerobatics
  const challengeHost: ChallengeHost = { tools, camera, toast: (s) => panel.toast(s), editMission: (spec) => missionEditor.open(spec) };
  const challengePanel = new ChallengePanel(challengeHost);
  // a mission (ui/airmission.ts — PLAN-AVIATION-AAA P1): its words said and shown, its objectives on screen, its debrief
  // the instructor (A4 — ui/instructor.ts): its panel, its calls said by TARS, its debrief; the flight school's lessons
  // flown — demonstrated by the autopilot or tried by hand
  /** The F-35's variant set now — its figures, its tanks — not at the next frame's render (sim.ts): the carrier's
   *  autopilot, begun at once, was dropped by its first step as the B's (no hook) */
  const setVariant = (v: "B" | "C") => {
    tools.set("f35Variant", v);
    if (applyF35Variant(v)) fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
  };
  const lessonPlace = (id: LessonId, how: boolean | "guided"): string =>
    placeShip(() => {
      // (guided — I3 —: TARS flies first, then hands over; a demonstration TARS's whole lesson — the pilot's part
      // too —; a try the pilot's part alone)
      const guided = how === "guided";
      const demo = how === true || guided;
      const mode = guided ? "guided" : how ? "demo" : "try";
      // (a lesson begun from a paused game — the pause menu's, the instructor's Explain —: flown at once)
      if (pauseMenu?.isOpen) pauseMenu.close();
      paused = false;
      camera.courseOff();
      // (the last lesson's autopilots let go: its carrier pass, its deck recovery, its figure, its intercept, its
      // formation, its holds — a new lesson begins clean)
      camera.trapRun = null;
      camera.deckRun = null;
      camera.aeroStop();
      if (camera.icpt) camera.icptOff();
      if (camera.form) camera.formOff();
      Object.assign(camera.jetModes, { alt: null, hdg: null, spd: null, bankMax: undefined });
      camera.gunTrigger = false;
      // (each placing below in flight with its engine running — flyAt leaves the throttle where it was: at idle after
      // the last lesson's landing, the jet slowing from the start)
      if (fleet.active !== "f35") tools.set("vessel", "f35");
      if (camera.mission) camera.missionAbort();
      if (camera.combat) camera.combatEnd();
      camera.ilsOff();
      if (id === "ils") {
        // (Edwards's runway 22, 12 km out on its glideslope, the gear down; the ILS flown or only shown)
        setVariant("B");
        const K = SITES.find((x) => x.icao === "KEDW")!;
        const hd = (K.rwy! * Math.PI) / 180;
        const back = 12_000;
        const lat = K.lat - (back * Math.cos(hd)) / 111_195;
        const lon = K.lon - (back * Math.sin(hd)) / (111_195 * Math.cos((K.lat * Math.PI) / 180));
        tools.flyAt(lat, lon, Math.round((300 + back) * Math.tan((3 * Math.PI) / 180)), K.rwy!, 95);
        camera.pilot.throttle = camera.pilot.engineNow = 0.65;
        camera.gearDown = true;
        fleet.fuel.f35 = 3000;
        const said = camera.ilsStart("KEDW");
        if (!demo && camera.ilsRun) camera.ilsRun.manual = true;
        // (every demonstration a course of TARS's: its steps followed, its progress watched)
        if (demo) {
          camera.courseStart("ils", mode);
          return said;
        }
        return t("ILS 22 at Edwards, 12 km out: yours — the needles and the instructor with you");
      }
      if (id === "case1") {
        // (the F-35C off the Ford in the Mediterranean: 7 km astern for Case I, else on its final to fly the ball)
        setVariant("C");
        camera.carrierClear();
        tools.flyAt(42.75, 6.1, 300, 0, 150);
        camera.pilot.throttle = camera.pilot.engineNow = 0.65;
        camera.carrierSpawn("ford", { lat: 42.8, lon: 6.1, heading: 0 });
        fleet.fuel.f35 = 3000;
        if (demo) {
          const { P, sp } = camera.carrierNow()[0]!;
          const D2 = Math.PI / 180;
          tools.flyAt(
            P.lat - (7000 * Math.cos(sp.heading)) / 111_195,
            P.lon - (7000 * Math.sin(sp.heading)) / (111_195 * Math.cos(P.lat * D2)),
            245,
            sp.heading / D2,
            180,
          );
          camera.pilot.throttle = camera.pilot.engineNow = 0.65;
          const said = camera.trapLand("ford", { case: "I" }) ?? "";
          camera.courseStart("case1", mode);
          return said;
        }
        camera.carrierFinal("ford", 2500, 75);
        camera.gearDown = true;
        return t("The Ford's final, 2.5 km out: yours — the ball, the LSO and the instructor with you");
      }
      if (id === "first" || id === "formation" || id === "intercept" || id === "guns") {
        // (over the Mojave: the first flight at 2 500 m, the formation's leader at 5 000 m, the unknown from the
        // north at 6 000 m, the drone at 4 000 m — the lesson's craft made at its first frame)
        setVariant("B");
        const at = { first: [2500, 90, 200], formation: [5000, 90, 180], intercept: [6000, 0, 250], guns: [4000, 0, 200] }[id];
        tools.flyAt(id === "intercept" ? 35.2 : 34.9, id === "intercept" ? -117.9 : -117.6, at[0]!, at[1]!, at[2]!);
        camera.pilot.throttle = camera.pilot.engineNow = 0.65;
        camera.gearDown = false;
        fleet.fuel.f35 = 5000;
        return camera.courseStart(id, mode);
      }
      if (id === "circuit" || id === "landing") {
        // (Edwards's runway 22: the downwind abeam, 300 m over the field; or 6 km out on the final)
        setVariant("B");
        const site = findRunway(camera, "KEDW");
        if (!site) return t("ILS: no runway called KEDW");
        const W = runwayOf(camera, site);
        fleet.fuel.f35 = 3000;
        camera.gearDown = true;
        if (id === "circuit") {
          const p = fromRunway(W, 1500, 1800);
          // (flyAt's height is over the ground: 300 m over the field — not its elevation added: 700 m too high, the
          // approach's autopilot never established)
          tools.flyAt(p.lat, p.lon, 300, (W.hdg + 180) % 360, 100);
          camera.pilot.throttle = camera.pilot.engineNow = 0.65;
          return camera.courseStart("circuit", mode, { rwy: W });
        }
        const p = fromRunway(W, -6000, 0);
        tools.flyAt(p.lat, p.lon, Math.round(6300 * Math.tan((3 * Math.PI) / 180)), W.hdg, 85);
        camera.pilot.throttle = camera.pilot.engineNow = 0.65;
        camera.ilsStart("KEDW");
        return camera.courseStart("landing", mode);
      }
      flyFigure(challengeHost, id, demo ? "demo" : "judge");
      if (demo) camera.courseStart(id, mode);
      if (guided) return t("TARS flies first, then hands over to you");
      return demo ? tf("{0}: the demonstration", t(FIGURES[id].name)) : tf("{0}: yours — the instructor watching", t(FIGURES[id].name));
    });
  const instrHost: InstructorHost = {
    camera,
    toast: (s) => panel.toast(s),
    hold: (on) => {
      paused = on;
      touch();
    },
    demo: (id) => lessonPlace(id, true),
    tryIt: (id) => lessonPlace(id, false),
    guided: (id) => lessonPlace(id, "guided"),
  };
  const instructorPanel = new InstructorPanel(instrHost);
  camera.onInstrCall = (text, fix) => {
    voice.say({ text, speaker: "tars", priority: 2 });
    if ((settings.f35Instructor ?? "full") === "calls") panel.toast(`${text} — ${fix}`);
  };
  // (a guided lesson — I3 —: TARS's words said; the figure set up again for the pilot)
  camera.onCourseSay = (text) => voice.say({ text, speaker: "tars", priority: 2, ttl: 20_000 });
  camera.onCourseFigure = (id) => flyFigure(challengeHost, id as FigureId, "judge");
  camera.onInstrDebrief = (last) => {
    // (a demonstration — the autopilot all along —: its mark said, no debrief to read)
    if (last.auto) panel.toast(tf("Demonstration: {0}/20", last.debrief.score.toFixed(1)));
    else if ((settings.f35Instructor ?? "full") === "full") debriefInstr(instrHost, last);
    else panel.toast(tf("Instructor: {0}/20", last.debrief.score.toFixed(1)));
  };
  const missionMap = new MissionMap({ camera, toast: (s) => panel.toast(s) });
  // (made, edited — P3)
  const missionEditor = new MissionEditor({
    camera,
    toast: (s) => panel.toast(s),
    fly: (spec) => briefMission(spec, () => airMissions.fly(spec)),
  });
  const missionHud = new MissionHud(camera, () => missionMap.open());
  camera.onMissionSay = (text) => {
    panel.toast(text);
    // (a mission's line in a role's words — "Darkstar: …", "Mother: …" — said in that role's voice: I4, S1)
    const r = settings.f35RadioRoles !== false ? roleOfLine(text) : null;
    if (r && r.role !== "tower") voice.say({ text: r.text, speaker: r.role, priority: 2, radio: true });
    else voice.say({ text, speaker: "tower", priority: 2 });
  };
  camera.onMissionEnd = (last) => {
    debriefMission(last);
    tarsEvent({ kind: "report", to: last.brief.letter, detail: `${last.spec.title} — ${last.brief.twenty.toFixed(1)}/20` });
  };
  const missionSpec = (x: string | unknown) => {
    if (typeof x === "string") {
      const m = AIR_MISSIONS.find((d) => d.id === x)?.make() ?? viewSpec(x, utcOf(sim.time)) ?? myMissions().find((d) => d.id === x);
      if (!m) throw new Error(`no mission "${x}" — ${[...AIR_MISSIONS.map((d) => d.id), ...myMissions().map((d) => d.id)].join(", ")}`);
      return m;
    }
    const { spec, errors } = checkMission(x);
    if (!spec) throw new Error(errors.join("; "));
    return spec;
  };
  // the views of exception (S2 — ui/views.ts): a mission made for its hour, or the challenge it is
  const viewsHost: ViewsHost = {
    toast: (s) => panel.toast(s),
    fly: (id) => {
      const v = EXCEPTIONAL_VIEWS.find((x) => x.id === id);
      if (!v) throw new Error(`no view "${id}" — ${EXCEPTIONAL_VIEWS.map((x) => x.id).join(", ")}`);
      sceneView = id;
      const c = v.challengeId ? CHALLENGES.find((d) => d.id === v.challengeId) : undefined;
      if (c) {
        placeShip(() => (flyChallenge(challengeHost, c), ""));
        return tf("{0}: started", tr(c.title));
      }
      return airMissions.fly(id);
    },
  };
  const airMissions = {
    list: () => AIR_MISSIONS.map((d) => ({ id: d.id, title: d.make().title })),
    spec: (x: string | unknown) => missionSpec(x),
    fly: (x: string | unknown, o: { lead?: boolean; side?: number; role?: number } = {}) =>
      placeShip(() => flyMission(challengeHost, missionSpec(x), o)),
    brief: (x: string | unknown) => {
      const spec = missionSpec(x);
      briefMission(spec, () => airMissions.fly(spec));
    },
    abort: () => camera.missionAbort(),
    state: () => {
      const M = camera.mission;
      return M
        ? { id: M.run.spec.id, t: M.run.t, state: { ...M.run.state }, status: M.run.status, deck: M.deckStart, pending: M.pending.length }
        : null;
    },
    last: () => camera.missionLast ?? null,
    map: missionMap,
    editor: missionEditor,
    /** a mission's link (the page's address with it) */
    link: (x: string | unknown) => missionLink(missionSpec(x)),
    mine: () => myMissions(),
  };
  // playing together (ui/netpanel.ts, docs/PLAN-RESEAU.md): the network loaded only when a room is asked for
  // (a room's clock in the scene's seconds — sim.time is in M)
  const netPanel = new NetPanel({
    time: () => sim.time * M_SECONDS,
    build: "",
    toast: (s) => panel.toast(s),
    crewActions: {
      get: () => settings.netCrewActions !== false,
      set: (on) => {
        settings.netCrewActions = on;
        onSettingsChange(["netCrewActions"]);
      },
    },
  });
  const openNetwork = () => (settings.netMenu ? netPanel.open() : panel.toast(t("The network's menu is off (Settings › Network)")));
  const netSession = new NetSession({
    camera,
    renderer,
    settings,
    tools,
    panel: netPanel,
    toast: (s) => panel.toast(s),
    jetIn: () => jetIn,
    sceneTime: () => sim.time * M_SECONDS,
    // (the crew's orders: through the game's tools, called directly — docs/PLAN-CREW-ACTIONS.md)
    crewTools: () => tarsTools,
    // (a mid-air collision: in a match's fight, shot down; else the craft destroyed — the room's way: craftLost)
    onCollide: (slot, name) => collide(slot, name),
    // (another's radio roles — I4 —: heard, his name before)
    radioHeard: (role, text, name) => {
      if (settings.f35RadioRoles !== false) voice.say({ text: `${name} — ${text}`, speaker: role, priority: 2, radio: true, ttl: 15_000 });
    },
    // (another's mission: flown with him, 80 m off the start, on his right)
    missionJoin: (spec, from, name) => {
      panel.toast(tf("{0}'s mission: {1}", name, spec.title));
      // (a team mission — S1 —: the leader's the first role, ours the next by our place among the room's others)
      const me = netPanel.net?.room?.slot ?? 0;
      const slots = [me, ...netSession.others().map((o) => o.slot)].filter((x) => x !== from).sort((a, b) => a - b);
      const role = spec.roles?.length ? Math.min(1 + slots.indexOf(me), spec.roles.length - 1) : undefined;
      airMissions.fly(spec, { lead: false, side: role !== undefined && spec.roles?.[role]?.start ? 0 : 80, role });
    },
  });
  netPanel.session = netSession;
  // a match in the room (ui/netmatch.ts — docs/PLAN-RESEAU.md R3): fights, teams, races, landings together
  const netMatch = new NetMatch({
    camera,
    tools,
    panel: netPanel,
    session: netSession,
    toast: (s) => panel.toast(s),
    collide: (slot, name) => collide(slot, name),
  });
  /** the other craft we went through (said with our loss: his side goes down too) */
  let collidedWith: number | null = null;
  /** A mid-air collision (either side's finding): in a match's fight, shot down; else the craft destroyed, whatever
   *  the damage setting — two craft through each other. */
  const collide = (slot: number, name: string) => {
    if (netMatch.inFight()) return netMatch.collision(slot);
    if (camera.airFlight.failure) return;
    collidedWith = slot;
    const why = tf("Mid-air collision with {0}", name);
    camera.airFlight.failure = why;
    camera.onCraftLost?.(why);
  };
  netPanel.match = netMatch;
  // the players' voices (ui/netvoice.ts — docs/PLAN-RESEAU.md R2)
  const netVoice = new NetVoice(netPanel, (s) => panel.toast(s));
  netPanel.voice = netVoice;
  // the Atlas (ui/atlas.ts, PLAN-MODES-AAA M6): the Earth, the Moon and Mars as maps, their destinations, the
  // addresses — the game put there (in orbit, landed, on foot, the free camera, a tripod)
  const ATLAS_ORBIT_KM: Record<MapBody, number> = { earth: 400, moon: 100, mars: 300 };
  /** The game ready for a placement on our worlds: a mission ended (said), our universe loaded, the walk left. */
  function atlasReady() {
    const m = MISSIONS.find((q) => q.scene === currentScene);
    if (m || mission.active) {
      mission.stop(t("Mission ended — the ship placed"));
      currentScene = null;
    }
    if (!settings.wormhole || settings.system !== "gargantua") applyPreset("Earth: the Blue Marble");
  }
  /**
   * The ship placed — the Place panel, the Atlas, TARS: one way. A mission running ended, the game's world loaded,
   * the walker back aboard; then the placement, the panels redrawn. Its note.
   */
  function placeShip(f: () => string): string {
    atlasReady();
    if (camera.character.active) camera.character.stop();
    // (the manoeuvre the instructor watched left behind: not judged — its debrief, if shown, closed)
    camera.instr = null;
    closeDebrief();
    // (the craft lost — its screen up, the time stopped —: a new place is a new flight)
    if (craftLost.shown) {
      craftLost.hide();
      camera.airFlight.failure = null;
      settings.animate = true;
      onSettingsChange(["animate"]);
    }
    const note = f();
    refreshGui();
    touch();
    return note;
  }
  /**
   * The free camera above a place (a spectator when a ship flies — it flies on): `altKm` up, south of it, looking at
   * it 30° down, carried with the ground; or `ground`: on its tripod there, looking along `heading` (north by
   * default), `pitch` up from the horizon. Why not, or null.
   */
  function cameraAt(
    body: string,
    lat: number,
    lon: number,
    o: { altKm?: number; ground?: boolean; heading?: number; pitch?: number } = {},
  ): string | null {
    atlasReady();
    if (camera.character.active) leaveWalk("free");
    if (settings.ship && camera.piloting && !camera.spectating) {
      setSpectator(true);
      if (!camera.spectating) return t("The spectator leaves a ship flown: fly one first (K)");
    }
    releaseFollow();
    const vc = camera.viewController();
    const time = vc.viewTime();
    const alt = o.ground ? 0.03 : (o.altKm ?? (body === "earth" ? 3 : 8));
    const R = (solarBody(body)!.radius * M_METRES) / 1e3;
    const back = o.ground ? 0 : (alt / Math.tan((30 * Math.PI) / 180) / R) * (180 / Math.PI);
    const v = bodyView(
      time,
      o.ground
        ? { body, at: [lat, lon], altKm: alt, heading: o.heading ?? 0 }
        : { body, at: [Math.max(-89.9, lat - back), lon], altKm: alt, aim: [lat, lon] },
    );
    vc.setCinematic(null);
    if (vc.gravity) vc.setGravity(false);
    vc.setOurLanded(null);
    vc.s.lookAt = false;
    vc.s.telescope = false;
    vc.setRotation("free");
    vc.rigPlace(true, v.X, v.fwd, v.up, groundVelocity(body, v.X, time));
    if (o.ground) {
      const why = vc.standOn(body as Body);
      if (why) return why;
      // (the look raised off the horizon: the tripod then holds it, fixed on the ground)
      const w = o.pitch ? vc.rigWorld() : null;
      if (w) {
        const a = (o.pitch! * Math.PI) / 180;
        const fwd = w.fwd.map((f, i) => f * Math.cos(a) + w.up[i]! * Math.sin(a)) as Vec3;
        const up = w.up.map((u, i) => u * Math.cos(a) - w.fwd[i]! * Math.sin(a)) as Vec3;
        vc.rigPlace(w.ours, w.X, fwd, up, groundVelocity(body, w.X, time));
      }
    }
    refreshGui();
    touch();
    return null;
  }
  /** The tripod where the walker stands, looking where the view looked (PLAN-MODES-AAA M7): why not, or null. */
  function tripodHere(): string | null {
    const ch = camera.character;
    const p = ch.place();
    if (!p) return t("Tripod here: walk on a world first (F2)");
    if (!ch.ours) return t("The tripod stands on our worlds: the Earth, the Moon, Mars and the others");
    // (looking as his camera looked: its height over the horizon kept, not levelled)
    const why = cameraAt(p.body, p.lat, p.lon, { ground: true, heading: p.viewDeg, pitch: framedView()?.alt });
    if (!why)
      panel.toast(
        tf("Tripod on {0}, looking {1}° — the sky's events from here (⇧F8)", BODY_NAMES[p.body as Target] ?? p.body, Math.round(p.viewDeg)),
      );
    return why;
  }
  const atlas = new AtlasPage({
    lang: () => lang,
    subsolar: (body) => {
      const time = camera.nowTime();
      const q = toBodyFixed(body, ourState("sun", time).pos, time);
      const r = Math.hypot(...q);
      return r > 0 ? { lat: (Math.asin(q[2] / r) * 180) / Math.PI, lon: (Math.atan2(q[1], q[0]) * 180) / Math.PI } : null;
    },
    here: () => {
      const out: { body: string; lat: number; lon: number; who: "craft" | "walker" | "camera" }[] = [];
      const time = camera.viewTime();
      const sub = (body: string, X: Vec3) => {
        const q = toBodyFixed(body, X, time);
        // (the craft's nadir: its own geodetic latitude, at its height — WGS84 on the Earth)
        const g = cartToGeodetic(solarBody(body)!.radius, flatteningOf(body), q);
        return { lat: (g.lat * 180) / Math.PI, lon: (g.lon * 180) / Math.PI };
      };
      const ours = ["earth", "moon", "mars"];
      const p = camera.character.place();
      if (p && ours.includes(p.body)) out.push({ body: p.body, lat: p.lat, lon: p.lon, who: "walker" });
      if (settings.ship && camera.piloting) {
        const st = tools.status();
        const pose = camera.activePoseNow();
        if (pose && st.side === "ours" && ours.includes(st.soi)) out.push({ body: st.soi, ...sub(st.soi, pose.X as Vec3), who: "craft" });
      }
      if (!p && (!settings.ship || camera.spectating)) {
        const g = camera.viewController().groundBelow(40);
        if (g && ours.includes(g.body)) out.push({ body: g.body, lat: g.lat, lon: g.lon, who: "camera" });
      }
      return out;
    },
    marks: () => [
      ...SITES.filter((x) => x.body === "earth" || x.body === "moon" || x.body === "mars").map((x) => ({
        body: x.body as MapBody,
        lat: x.lat,
        lon: x.lon,
        name: x.name,
        detail: x.icao ? `${x.icao}${x.runway ? ` · ${t("runway")} ${x.rwy ?? ""}` : ""}` : t("Landing site"),
        elevM: x.elev,
        source: "site" as const,
      })),
      ...LANDSCAPES.map((l) => ({
        body: "earth" as MapBody,
        lat: l.at[0],
        lon: l.at[1],
        name: t(l.title),
        detail: t(l.description),
        scene: l.scene,
        source: "view" as const,
      })),
    ],
    go: (to, p) => atlasGo(to, p),
    mission: () => {
      const m = MISSIONS.find((q) => q.scene === currentScene);
      return m ? tr(m.title) : mission.active ? t("The Interstellar journey") : null;
    },
    ask: (q) => {
      tarsPanel.show();
      tarsPanelAsk(q);
    },
    view: (scene) => applyPreset(scene),
  });
  /** The game put at a place of the Atlas: why not, or null. */
  function atlasGo(to: AtlasAction, p: AtlasPlace): string | null {
    try {
      if (to === "camera" || to === "tripod") return cameraAt(p.body, p.lat, p.lon, { ground: to === "tripod" });
      placeShip(() =>
        to === "orbit"
          ? tools.orbitOver(p.body, p.lat, p.lon, { altKm: ATLAS_ORBIT_KM[p.body] })
          : to === "land"
            ? tools.land(p.body, p.lat, p.lon)
            : tools.walk(p.body, p.lat, p.lon),
      );
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  // the date and time (ui/timepanel.ts): the transport bar's clock, the pause menu
  const timePanel = new TimePanel({ tools, settings, sceneStart: () => sceneStart, toast: (x) => panel.toast(x) });
  // the weather (ui/weatherpanel.ts, PLAN-METEO W2): the HUD's Weather button, the pause menu
  const weatherPanel = new WeatherPanel({
    settings,
    place: () => camera.weatherPlace(),
    real: () => camera.weatherReal,
    realInfo: () => realWeather.last.info,
    changed: () => {
      metarTick();
      touch();
      scheduleUrlSave();
    },
  });
  flightHud.onWeather = () => weatherPanel.open();
  // the eclipse calculator (ui/eclipses.ts, PLAN-CIEL C7): the HUD's Eclipses button, the pause menu, TARS
  const eclipses = new EclipsePage({
    now: () => utcOf(sim.time),
    place: () => {
      const p = camera.weatherPlace();
      return p && p.body === "earth" ? { lat: p.lat, lon: p.lon } : null;
    },
    search: (q) => plan({ kind: "eclipses", q }),
    detail: (e, place) => plan({ kind: "eclipseDetail", e, place }),
    moonsView: (planet, t) => plan({ kind: "moonsView", planet, t }),
    goSee: (e, place) => goSeeEclipse(e, place),
    // (its phases from the place if it is seen there, else from where it is best)
    photo: (e, place) => {
      if (e.kind !== "solar" && e.kind !== "lunar") return;
      const where = e.here?.seen && place ? place : bestPlace(e);
      eclipses.hide();
      void mxDialog.open({ kind: "eclipse", fill: { eclipse: e.kind, date: e.t, lat: where.lat, lon: where.lon } });
    },
    ask: (q) => {
      tarsPanel.show();
      tarsPanelAsk(q);
    },
  });
  flightHud.onEclipses = () => eclipses.open();
  // the sky's events from here (ui/skyevents.ts, PLAN-MODES-AAA M7): from where one stands on the Earth (walking, on
  // the tripod, the free camera over the ground) and the way one looks — each event gone to (the tripod set, the
  // time, the aim), lived (its exposures taken and stacked in the game: ui/livecapture.ts) or rendered
  /**
   * The view framed on the Earth's ground — on foot (his shoulder's camera), on the tripod, the free camera near the
   * ground —: where it stands (its own place, geodetic), the way it looks (the screen's centre: azimuth from the north,
   * altitude [°]) and its vertical field [°]; null elsewhere (flying a ship, off the Earth). What a multiple exposure
   * takes "from this view", the sky's events "from here".
   */
  function framedView(): { lat: number; lon: number; az: number; alt: number; fov: number } | null {
    if (settings.ship && camera.piloting && !camera.spectating && !camera.character.active) return null;
    const vc = camera.viewController();
    const g = vc.groundBelow(0.02);
    if (!g || g.body !== "earth") return null;
    // (the view's place and look on the home axes — the camera's own frame is the wormhole's representation)
    const w = vc.rigWorld();
    const hz = w?.ours ? horizonOf(w.X, vc.viewTime()) : null;
    if (!w || !hz) return null;
    const [alt, az] = altAzOf(hz, w.fwd);
    return { lat: g.lat, lon: g.lon, az, alt, fov: camera.viewSettings().fov };
  }
  /** Where one stands on the Earth's ground and the way the view looks (null: not there). */
  function skyPlace(): SkyPlace | null {
    const v = framedView();
    if (!v) return null;
    // (on foot: from where he stands, facing as he faces — his camera is over his shoulder)
    const p = camera.character.place();
    if (p) return p.body === "earth" ? { lat: p.lat, lon: p.lon, view: { az: p.viewDeg, alt: v.alt } } : null;
    return { lat: v.lat, lon: v.lon, view: { az: v.az, alt: v.alt } };
  }
  /**
   * The telescope taken to a thing of the sky from where one stands on the Earth's ground (on foot: the tripod set
   * where he stands first), the clock at `at` [ms UTC] when given: a body, the ISS, the wormhole — the target, held
   * (the lock) and framed (the telescope); a star — tracked at the view's centre through a two-degree field. Why not,
   * or null.
   */
  function observeAt(o: Observable, at?: number): string | null {
    if (camera.character.active) {
      const why = tripodHere();
      if (why) return why;
    } else if (!framedView())
      return t("The telescope from the Earth: stand on its ground first — walking, on the tripod, or the free camera over it");
    if (at !== undefined) tools.setDate(new Date(at).toISOString());
    const vc = camera.viewController();
    // (on its ground: the tripod, the view held there)
    if (vc.s.rotation !== "tripod") {
      const why = vc.standOn("earth" as Body);
      if (why) return why;
    }
    if (o.kind === "star") {
      if (vc.s.telescope) vc.setTelescope(false);
      if (vc.s.lookAt) vc.setLookAt(false);
      vc.rig.star = [...o.v] as Vec3;
      // (its look not yet the player's: not let go at the first frame for a turn it did not make)
      vc.rig.lookKey = "";
      vc.setFov(2);
      panel.toast(tf("{0} — held at the centre as the sky turns; drag to let it go", o.name));
    } else {
      vc.rig.star = null;
      const id = (o.kind === "body" ? o.id : o.kind) as Target;
      if (vc.s.target !== id && !vc.selectTarget(id, { focus: false })) return tf("{0} is not in this universe", BODY_NAMES[id] ?? id);
      if (!vc.s.lookAt) vc.setLookAt(true);
      // (framed again for this one: its size, not the last one's)
      if (vc.s.telescope) vc.setTelescope(false);
      vc.setTelescope(true);
      panel.toast(tf("Telescope on {0} — the wheel zooms, Y leaves", BODY_NAMES[id] ?? id));
    }
    refreshGui();
    touch();
    return null;
  }
  const observePage = new ObservePage({
    place: () => {
      const p = skyPlace();
      return p ? { lat: p.lat, lon: p.lon } : null;
    },
    now: () => utcOf(sim.time),
    aim: (o, at) => observeAt(o, at),
  });
  /**
   * The telescope's spot meter (its option, on by default): where the target's disc is in the image — its centre
   * (fractions of the width and the height) and its radius (a fraction of the height; the mouth's for a body beyond
   * the wormhole, a little round a point) —; null: the image's own meter (no telescope, the option off, the target
   * out of the view).
   */
  function telescopeSpot(): { x: number; y: number; r: number; key: string } | null {
    const vs = camera.viewSettings();
    if (!vs.telescope || !vs.telescopeSpot || !vs.autoExposure) return null;
    const info = camera.viewController().targetInfo();
    if (!info) return null;
    const tanH = Math.tan((vs.fov * Math.PI) / 360);
    const ndc = projectLook(info.cam, info.look, tanH, canvas.width / Math.max(canvas.height, 1));
    if (!ndc) return null;
    const r = Math.min(Math.max(Math.tan(info.seen) / tanH / 2, 0.02), 0.5);
    const x = (ndc[0] + 1) / 2,
      y = (1 - ndc[1]) / 2;
    return x + r < 0 || x - r > 1 || y + r < 0 || y - r > 1 ? null : { x, y, r, key: String(vs.target) };
  }
  /** The observatory opened (a search typed), or why not. */
  function openObserve(query = "") {
    if (observePage.isOpen) return void observePage.hide();
    const why = observePage.open(query);
    if (why) panel.toast(why);
  }
  /** The tripod at a place of the Earth, the clock at a time, looking at (az, alt) through a field [°]: why not, or null. */
  function skyAim(lat: number, lon: number, o: { ms: number; az: number; alt: number; fov: number }): string | null {
    try {
      tools.setDate(new Date(o.ms).toISOString());
    } catch (e) {
      return (e as Error).message;
    }
    const why = cameraAt("earth", lat, lon, { ground: true, heading: o.az, pitch: o.alt });
    if (why) return why;
    camera.setFov(o.fov);
    touch();
    return null;
  }
  const liveCapture = new LiveCapture({
    at: async (ms, first) => {
      tools.setDate(new Date(ms).toISOString());
      await mxHost.settle(first);
    },
    grab: () => renderer.exportRGBA(settings),
    download: (b, name) => download(b, name),
    hold: () => {
      const was = settings.animate;
      playPause(false);
      return was;
    },
    release: (was) => playPause(was as boolean),
  });
  const skyEvents = new SkyEventsPage({
    place: skyPlace,
    now: () => utcOf(sim.time),
    azAlt: (id, lat, lon, ms) => azAltAt(id, (lat * Math.PI) / 180, (lon * Math.PI) / 180, 0, ms),
    iss: (lat, lon, ms) => issSight(lat, lon, ms),
    issPasses: (lat, lon, from, days) => issPasses(lat, lon, from, days),
    search: async (q) => {
      const r = (await plan({ kind: "eclipses", q })) as { events: EclipseEvent[] } | { error: string };
      if ("error" in r) throw new Error(r.error);
      return r;
    },
    aim: (o) => {
      const p = skyPlace();
      const why = p && skyAim(p.lat, p.lon, o);
      if (why) panel.toast(why);
    },
    live: (o) => {
      const p = skyPlace();
      if (!p) return;
      if (renderer.offlineActive || renderDialog.videoState()) return void panel.toast(t("A render is running"));
      const why = skyAim(p.lat, p.lon, { ms: o.times[0]!, az: o.az, alt: o.alt, fov: o.fov });
      if (why) return void panel.toast(why);
      // (the station: its streak since the last exposure, as a long exposure catches it — the scene does not draw it
      // from the ground)
      const view = { az: o.az, alt: o.alt, fov: o.fov };
      const overlay = o.iss
        ? (data: Uint8Array, w: number, h: number, i: number) => {
            const to = o.times[i]!;
            const from = i > 0 ? o.times[i - 1]! : to - 1e3;
            const track = Array.from({ length: 41 }, (_, k) => issSight(p.lat, p.lon, from + ((to - from) * k) / 40)).filter(
              (x): x is NonNullable<typeof x> => !!x,
            );
            drawIssTrail(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w, h, view, track, { dark: o.iss === "dark" });
          }
        : undefined;
      void liveCapture.run({ title: o.title, times: o.times, stem: o.stem, render: o.render, overlay });
    },
    render: (kind, fill) => void mxDialog.open({ kind, fill }),
    fromView: () => openMultiExposure(),
    observe: () => openObserve(),
  });
  /** The sky's events from here, opened or closed: why not, or null. */
  function skyEventsToggle(): string | null {
    if (skyEvents.isOpen) return skyEvents.hide(), null;
    const why = skyEvents.open();
    if (why) panel.toast(why);
    return why;
  }
  // (the music panel — ui/musicpanel.ts —: the toolbar's Music, the flight HUD's)
  const musicPanel = new MusicPanel({
    music,
    settings,
    changed: (keys) => onSettingsChange(keys),
    // (listening: the sound and the music on — the click itself starts the audio context)
    startSound: () => {
      if (settings.sound && settings.music) return;
      settings.sound = true;
      settings.music = true;
      audio.applyMix();
      onSettingsChange(["sound", "music"]);
    },
  });
  flightHud.onMusic = () => musicPanel.toggle();
  // the top bar's actions (ui/topbar.ts): the page's toolbar buttons moved in with their ids, the bar's own —
  // the least used go first into its ⋯ menu when the window is narrow
  {
    const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
    // (the page's buttons moved in: their tooltips in the interface's language)
    btn("btn-camera").dataset.tip = t("Camera — placement, look at the target, lens & telescope, target, cinematics");
    $("hud-toggle").dataset.tip = t("Details and physical readouts");
    topBar.freeSlot.append(btn("btn-camera"));
    topBar.add({
      id: "btn-atlas",
      label: t("Atlas: the Earth, the Moon and Mars — destinations, addresses; go there"),
      icon: TB_ICONS.atlas,
      key: "F8",
      run: () => atlas.open(),
      prio: 1,
      testid: "topbar-atlas",
    });
    topBar.add({
      id: "btn-tripod",
      label: t("Tripod: the camera set down on the ground — on foot, where you stand, looking the same way"),
      icon: TB_ICONS.tripod,
      key: "⇧T",
      run: () => keyActions.standOn(new KeyboardEvent("keydown")),
      modes: ["foot", "free"],
      prio: 3,
      testid: "topbar-tripod",
    });
    topBar.add({
      id: "btn-skyevents",
      label: t("The sky's events from here: trails, analemma, the Moon, the ISS, eclipses — go there, live it, render it"),
      icon: TB_ICONS.skyEvents,
      key: "⇧F8",
      run: () => void skyEventsToggle(),
      prio: 3,
      testid: "topbar-skyevents",
    });
    topBar.add({
      id: "btn-observe",
      label: t("The observatory: what to see from here and when — the telescope taken to it"),
      icon: TB_ICONS.observe,
      key: "⇧Y",
      run: () => openObserve(),
      modes: ["foot", "free", "photo"],
      prio: 3,
      testid: "topbar-observe",
    });
    topBar.add({
      id: "btn-multiexposure",
      label: t("Multiple exposure from this view: an analemma, star trails, the Moon's way, an eclipse, the ISS — framed as you framed it"),
      icon: TB_ICONS.multiExposure,
      run: () => openMultiExposure(),
      modes: ["foot", "free", "photo"],
      prio: 3,
      testid: "topbar-multiexposure",
    });
    topBar.add({
      id: "btn-place",
      label: t("Place: in orbit, on a ground, on foot, beside a body"),
      icon: TB_ICONS.place,
      run: () => placePanel.open(),
      prio: 2,
      testid: "hud-place",
    });
    topBar.add({
      id: "btn-scenes",
      label: t("Scenes"),
      tip: t("Scenes — every black hole, the wormhole, Gargantua and the game's missions"),
      button: btn("btn-scenes"),
      prio: 4,
    });
    topBar.add({
      id: "btn-weather",
      label: t("The weather"),
      icon: TB_ICONS.weather,
      run: () => weatherPanel.open(),
      prio: 6,
      testid: "hud-weather",
    });
    topBar.add({
      id: "btn-eclipses",
      label: t("Eclipses"),
      icon: TB_ICONS.eclipse,
      run: () => eclipses.open(),
      prio: 6,
      testid: "hud-eclipses",
    });
    topBar.add({
      id: "btn-sky",
      label: t("Sky chart"),
      tip: t("Sky chart — constellations, star names, equatorial & horizontal grids (U: grids)"),
      button: btn("btn-sky"),
      key: "N",
      prio: 5,
    });
    topBar.add({
      id: "btn-music",
      label: t("Music"),
      tip: t("Music — the themes, listen, the mode, the mixer, which theme when"),
      button: btn("btn-music"),
      prio: 3,
    });
    topBar.add({
      id: "btn-sound",
      label: t("Sound on / off"),
      icon: TB_ICONS.sound,
      run: () => toggleSound(),
      prio: 3,
      testid: "topbar-sound",
    });
    topBar.add({
      id: "btn-capture",
      label: t("Capture: this view rendered offline, saved as a PNG once converged"),
      icon: TB_ICONS.capture,
      run: () => {
        const why = renderDialog.capture();
        if (why) panel.toast(why);
      },
      prio: 3,
      testid: "topbar-capture",
    });
    topBar.add({
      id: "btn-render",
      label: t("Offline render: a picture or a video"),
      icon: TB_ICONS.render,
      run: () => renderDialog.toggle(),
      prio: 5,
    });
    topBar.add({
      id: "btn-info",
      label: t("Details and physical readouts"),
      icon: TB_ICONS.info,
      key: "I",
      run: () => actions["hud-toggle"]!(),
      prio: 8,
    });
    topBar.add({ id: "btn-help", label: t("Keyboard & mouse"), button: btn("btn-help"), key: "?", prio: 7 });
    topBar.add({
      id: "btn-settings",
      label: t("Settings"),
      icon: TB_ICONS.settings,
      key: "M",
      run: () => panel.toggle(),
      prio: 1,
      testid: "topbar-settings",
    });
    if (DEV_TOOLS)
      topBar.add({ id: "btn-tools", label: t("Game tools"), icon: TB_ICONS.tools, key: "F10", run: () => toolsWin.toggle(), prio: 9 });
    // the ship's least used controls (ui/flighthud.ts): the ⋯ menu takes them when narrow, like the actions
    topBar.overflowable(flightHud.barPieces);
    // (the page's bar, emptied)
    document.getElementById("toolbar")?.remove();
  }
  // multiple exposures (photo/multiexposure.ts, PLAN-CIEL C8–C10): a tripod's series rendered offline and
  // blended — the analemma, an eclipse's phases, the stars' trails; the game put back after
  /**
   * The view as the player framed it on the Earth's ground — a tripod, the free camera, a spectator's — its place
   * and its look on the Earth's own axes, how it is held, its lens: given back as it was after a series or a video
   * (the walker is the save's own). Null: none framed there.
   */
  function viewHold() {
    if (camera.character.active || !framedView()) return null;
    const vc = camera.viewController();
    const w = vc.rigWorld();
    if (!w?.ours) return null;
    const t = vc.viewTime();
    const q = toBodyFixed("earth", w.X, t);
    const dir = (v: Vec3) => sub3(toBodyFixed("earth", lin3(w.X, 1, v, 1e-6), t), q);
    const s = vc.s;
    return {
      spectating: camera.spectating,
      q,
      f: dir(w.fwd),
      u: dir(w.up),
      rotation: s.rotation,
      standH: vc.rig.standH,
      fov: s.fov,
      lookAt: s.lookAt,
      telescope: s.telescope,
      target: s.target,
    };
  }
  /** A view held, given back at the scene's clock as restored. */
  function viewBack(h: NonNullable<ReturnType<typeof viewHold>>) {
    if (h.spectating && !camera.spectating) setSpectator(true);
    const vc = camera.viewController();
    const t = vc.viewTime();
    const X = fromBodyFixed("earth", h.q, t);
    const to = (d: Vec3): Vec3 => {
      const v = sub3(fromBodyFixed("earth", lin3(h.q, 1, d, 1), t), X);
      const l = Math.hypot(...v);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    vc.rig.cut = true;
    vc.rigPlace(true, X, to(h.f), to(h.u), groundVelocity("earth", X, t));
    Object.assign(vc.s, { rotation: h.rotation, fov: h.fov, lookAt: h.lookAt, telescope: h.telescope, target: h.target });
    vc.rig.key = "";
    vc.rig.standH = h.standH;
  }
  const mxSnapshot = () => ({
    save: tools.snapshot("before the multiple exposure"),
    settings: { ...settings },
    time: sim.time,
    ev: renderer.autoExposureEV,
    view: viewHold(),
  });
  const mxHost: MxHost = {
    settings,
    apply: (p) => {
      presets["Multiple exposure"] = p;
      applyPreset("Multiple exposure");
    },
    settle: async (first = true) => {
      // (the scene's frames drawn, its Earth's maps and tiles in — a minute at most)
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
      // (the ground too: its finer tiles come in waves, the tripod's height and the hills about it with them —
      // the series on one ground: settled two seconds running at its first frame, then its tiles all in)
      for (let i = 0, calm = 0; i < 600 && calm < (first ? 20 : 3); i++) {
        touch();
        await new Promise((r) => setTimeout(r, 100));
        calm = renderer.earthSettled ? calm + 1 : 0;
      }
      // (the meter's: come to its reading — eased, a totality's twilight ten stops under the day the game was
      // in takes seconds; frames drawn meanwhile: a still view draws none, and the meter reads only what is drawn)
      if (settings.autoExposure)
        for (let i = 0, calm = 0; i < 200 && (i < (first ? 10 : 2) || calm < (first ? 5 : 2)); i++) {
          touch();
          await new Promise((r) => setTimeout(r, 100));
          calm = renderer.meterSettled ? calm + 1 : 0;
        }
    },
    render: async (o) => {
      renderer.startOffline(settings, sim.time, {
        width: o.width,
        height: o.height,
        spp: o.spp,
        tolerance: 0,
        eps: 0.02,
        maxSteps: 6000,
        noiseThreshold: 0,
        minSpp: Math.min(o.spp, 16),
        shutter: 0,
        budgetMs: 80,
      });
      while (!renderer.offlineState?.done) {
        if (renderer.offlineState?.error) throw new Error(renderer.offlineState.error);
        if (!renderer.offlineActive) throw new Error("Render cancelled");
        await new Promise((r) => setTimeout(r, 20));
      }
      const px = await renderer.exportRGBA(settings);
      renderer.cancelOffline();
      return px.data;
    },
    snapshot: mxSnapshot,
    restore: (x) => {
      const b = x as ReturnType<typeof mxSnapshot>;
      tools.load(b.save, { quiet: true });
      Object.assign(settings, b.settings);
      sim.setTime(b.time);
      renderer.autoExposureEV = b.ev;
      camera.sync();
      // (the view as it was framed: its tripod, its look, its lens)
      if (b.view) viewBack(b.view);
      refreshGui();
      touch();
      touchDisplay();
    },
    active: (on) => {
      // (the player's hands off the view, the game's on it: each frame's tripod set and aimed by the rig)
      camera.enabled = !on;
      camera.placedByGame = on;
      if (on) {
        camera.keys.clear();
        camera.codes.clear();
      }
      document.body.classList.toggle("offline", on);
      touch();
    },
  };
  /** What a framing of the player's own leaves out of the image: how many of the subject's places (the Suns, the
   *  phases, the Moons, the station's way), of how many — none asked when the series framed itself. */
  const framedOut = (asked: Framing | undefined, view: Framing, pts: { az: number; alt: number }[], aspect: number) =>
    asked ? { n: outsideView(view, pts, aspect), of: pts.length } : undefined;
  /** An analemma planned (its options as the dialog gives them; the place and the date default to the game's). */
  const planAnalemma = (o: Partial<Omit<Parameters<typeof analemmaPlan>[0], "template">> & { width?: number; height?: number }) => {
    const p = camera.weatherPlace();
    return analemmaPlan({
      lat: o.lat ?? (p?.body === "earth" ? p.lat : 48.86),
      lon: o.lon ?? (p?.body === "earth" ? p.lon : 2.35),
      minutesUtc: o.minutesUtc ?? 12 * 60,
      start: o.start ?? utcOf(sim.time),
      cadence: o.cadence ?? 7,
      count: o.count,
      base: o.base ?? "dusk",
      aspect: (o.width ?? 1200) / (o.height ?? 1600),
      template: mxTemplate(),
      sunEV: o.sunEV ?? 9,
      view: o.view,
    });
  };
  /** An analemma made (its options as the dialog gives them; the place and the date default to the game's). */
  const runAnalemma = (
    o: Partial<Omit<Parameters<typeof analemmaPlan>[0], "template">> & { width?: number; height?: number; spp?: number; mask?: boolean },
    progress: (p: { done: number; total: number; label: string }) => void = () => {},
    signal = { stop: false },
  ) => {
    const width = o.width ?? 1200,
      height = o.height ?? 1600;
    const plan = planAnalemma(o);
    const marks = analemmaMarks(plan.suns, plan.view, width, height);
    const outside = framedOut(
      o.view,
      plan.view,
      plan.suns.filter((x) => x.alt > -1),
      width / height,
    );
    const frames = o.mask === false ? plan.frames : placeFrames(plan.frames, marks, 2);
    return runExposures(mxHost, frames, { width, height, spp: o.spp ?? 2, baseSpp: 32 }, progress, signal).then((r) => ({
      ...r,
      view: plan.view,
      marks,
      outside,
    }));
  };
  /** An eclipse's sequence planned (PLAN-CIEL C9): the nearest solar or lunar eclipse to a date, from a place. */
  type EclipseRun = Partial<Omit<EclipseSeqOptions, "template" | "aspect">> & {
    width?: number;
    height?: number;
    spp?: number;
    sky?: "game" | "clear";
    /** false: each frame laid whole (its sky too), not its disc alone */
    mask?: boolean;
    insets?: boolean;
    /** the tripod's sky (default), the phases in a row, the Moons about the Earth's shadow, a transit's way */
    layout?: "sky" | "strip" | "shadow" | "transit";
    planet?: "mercury" | "venus";
  };
  const planEclipse = (o: EclipseRun) => {
    const p = camera.weatherPlace();
    const width = o.width ?? 1920,
      height = o.height ?? 1080;
    const kind = o.kind ?? "solar";
    return eclipsePlan({
      kind,
      date: o.date ?? utcOf(sim.time),
      lat: o.lat ?? (p?.body === "earth" ? p.lat : 48.86),
      lon: o.lon ?? (p?.body === "earth" ? p.lon : 2.35),
      before: o.before ?? 5,
      after: o.after ?? 5,
      base: o.base ?? "central",
      framing: o.framing ?? "landscape",
      aspect: width / height,
      template: mxTemplate(o.sky ?? "clear"),
      phaseEV: o.phaseEV ?? (kind === "solar" ? MX_EV.sun : MX_EV.moon),
      centralComp: o.centralComp ?? MX_EV.central,
      insets: o.insets,
      view: o.view,
    });
  };
  /** An eclipse's sequence made. */
  const runEclipse = (
    o: EclipseRun,
    progress: (p: { done: number; total: number; label: string }) => void = () => {},
    signal = { stop: false },
  ) => {
    const width = o.width ?? 1920,
      height = o.height ?? 1080;
    if (o.layout && o.layout !== "sky") {
      const p = camera.weatherPlace();
      const kind = o.layout === "transit" ? "transit" : (o.kind ?? "solar");
      // (a transit's planet unnamed: the one whose transit is nearer the date)
      const date = o.date ?? utcOf(sim.time);
      const gap = (pl: "mercury" | "venus") =>
        Math.min(...transits(pl, date - 400 * 864e5, date + 400 * 864e5).map((x) => Math.abs(x.t - date)));
      const planet = o.planet ?? (kind === "transit" ? (gap("mercury") <= gap("venus") ? "mercury" : "venus") : undefined);
      const lay = eclipseLayout({
        kind,
        layout: o.layout,
        planet,
        date,
        lat: o.lat ?? (p?.body === "earth" ? p.lat : 48.86),
        lon: o.lon ?? (p?.body === "earth" ? p.lon : 2.35),
        before: o.before ?? 5,
        after: o.after ?? 5,
        aspect: width / height,
        width,
        height,
        template: mxTemplate("clear"),
        phaseEV: o.phaseEV ?? (kind === "lunar" ? MX_EV.moon : MX_EV.sun),
        centralComp: o.centralComp ?? MX_EV.central,
      });
      if (!lay)
        return Promise.reject(
          new Error(kind === "transit" ? "No transit near that date" : "No such eclipse seen from there near that date"),
        );
      return runExposures(mxHost, lay.frames, { width, height, spp: o.spp ?? 4 }, progress, signal).then((r) => ({
        ...r,
        // (a row's discs where they were laid, those behind the hills left out)
        marks: lay.marks.map((m) => {
          const p = r.placed.find((q) => q.ms === m.ms);
          return p ? { ...m, x: p.x, y: p.y } : m;
        }),
        guides: lay.guides,
        eclipse: lay.eclipse,
      }));
    }
    const plan = planEclipse(o);
    if (!plan)
      return Promise.reject(
        new Error((o.kind ?? "solar") === "solar" ? "No solar eclipse seen from there near that date" : "No lunar eclipse near that date"),
      );
    const marks = skyMarks(plan.moments, plan.view, width, height).map(({ of, ...m }) => ({
      ...m,
      hidden: of.hidden,
      central: of.central,
    }));
    const frames = o.mask === false ? plan.frames : placeFrames(plan.frames, marks);
    const outside = framedOut(o.view, plan.view, plan.moments, width / height);
    return runExposures(mxHost, frames, { width, height, spp: o.spp ?? 4, baseSpp: 32 }, progress, signal).then((r) => ({
      ...r,
      view: plan.view,
      eclipse: plan.eclipse,
      marks,
      outside,
    }));
  };
  /** The star trails made (PLAN-CIEL C10): hours of a night's frames from the tripod. */
  const runTrails = (
    o: Partial<Omit<TrailsOptions, "template" | "aspect">> & { width?: number; height?: number; spp?: number; sky?: "game" | "clear" },
    progress: (p: { done: number; total: number; label: string }) => void = () => {},
    signal = { stop: false },
  ) => {
    const p = camera.weatherPlace();
    const width = o.width ?? 1920,
      height = o.height ?? 1080;
    const plan = trailsPlan({
      lat: o.lat ?? (p?.body === "earth" ? p.lat : 48.86),
      lon: o.lon ?? (p?.body === "earth" ? p.lon : 2.35),
      date: o.date ?? utcOf(sim.time),
      hours: o.hours ?? 3,
      count: o.count ?? 240,
      toward: o.toward ?? "pole",
      fov: o.fov ?? 70,
      aspect: width / height,
      template: mxTemplate(o.sky ?? "clear"),
      comp: o.comp ?? -1.5,
      comet: o.comet ?? false,
      view: o.view,
    });
    if (!plan) return Promise.reject(new Error("No dark night there then (the Sun never goes 12° under the horizon)"));
    return runExposures(mxHost, plan.frames, { width, height, spp: o.spp ?? 2 }, progress, signal).then((r) => ({
      ...r,
      view: plan.view,
      span: { from: plan.from, to: plan.to },
    }));
  };
  /** The Moon's way made (PLAN-CIEL C10): over a night, at the same time each day, each lunar day. */
  const runMoonPath = (
    o: Partial<Omit<MoonPathOptions, "template" | "aspect">> & { width?: number; height?: number; spp?: number; sky?: "game" | "clear" },
    progress: (p: { done: number; total: number; label: string }) => void = () => {},
    signal = { stop: false },
  ) => {
    const width = o.width ?? 1920,
      height = o.height ?? 1080;
    const plan = planMoonPath(o);
    if (!plan) return Promise.reject(new Error("The Moon is not up then"));
    const marks = skyMarks(plan.moments, plan.view, width, height).map(({ of, ...m }) => ({ ...m, hidden: of.lit }));
    const outside = framedOut(o.view, plan.view, plan.moments, width / height);
    return runExposures(mxHost, placeFrames(plan.frames, marks), { width, height, spp: o.spp ?? 4, baseSpp: 32 }, progress, signal).then(
      (r) => ({ ...r, view: plan.view, marks, outside }),
    );
  };
  /** The Moon's way planned. */
  const planMoonPath = (
    o: Partial<Omit<MoonPathOptions, "template" | "aspect">> & { width?: number; height?: number; sky?: "game" | "clear" },
  ) => {
    const p = camera.weatherPlace();
    return moonPathPlan({
      mode: o.mode ?? "night",
      lat: o.lat ?? (p?.body === "earth" ? p.lat : 48.86),
      lon: o.lon ?? (p?.body === "earth" ? p.lon : 2.35),
      date: o.date ?? utcOf(sim.time),
      step: o.step,
      span: o.span,
      days: o.days,
      minutesUtc: o.minutesUtc,
      framing: o.framing ?? "landscape",
      base: o.base ?? ((o.mode ?? "night") === "night" ? "middle" : "none"),
      aspect: (o.width ?? 1920) / (o.height ?? 1080),
      template: mxTemplate(o.sky ?? "clear"),
      comp: o.comp ?? 0,
      view: o.view,
    });
  };
  /** The station's passes seen from a place over days (PLAN-CIEL C10). */
  const issPassesHere = (lat: number, lon: number, from: number, days = 10) => issPasses(lat, lon, from, days);
  /** An ISS pass planned: the pass nearest the date asked (those of the day before to ten days on), its photograph. */
  const planIss = (o: {
    lat?: number;
    lon?: number;
    date?: number;
    framing?: "landscape" | "sky";
    width?: number;
    height?: number;
    sky?: "game" | "clear";
    view?: Framing;
  }) => {
    const p = camera.weatherPlace();
    const lat = o.lat ?? (p?.body === "earth" ? p.lat : 48.86),
      lon = o.lon ?? (p?.body === "earth" ? p.lon : 2.35);
    const at = o.date ?? utcOf(sim.time);
    const passes = issPasses(lat, lon, at - 86400e3, 11);
    if (!passes.length) throw new Error("No ISS pass seen from there in those days");
    const pass = passes.reduce((a, b) => (Math.abs(b.top - at) < Math.abs(a.top - at) ? b : a));
    const plan = issPhotoPlan({
      lat,
      lon,
      pass,
      framing: o.framing ?? "landscape",
      aspect: (o.width ?? 1920) / (o.height ?? 1080),
      template: mxTemplate(o.sky ?? "clear"),
      comp: -2,
      view: o.view,
    });
    return { plan, pass };
  };
  /** An ISS pass photographed: the landscape at its middle, its trail laid over it. */
  const runIss = async (
    o: {
      lat?: number;
      lon?: number;
      date?: number;
      framing?: "landscape" | "sky";
      dashes?: boolean;
      exposure?: number;
      width?: number;
      height?: number;
      spp?: number;
      sky?: "game" | "clear";
      view?: Framing;
    },
    progress: (p: { done: number; total: number; label: string }) => void = () => {},
    signal = { stop: false },
  ) => {
    const width = o.width ?? 1920,
      height = o.height ?? 1080;
    const { plan, pass } = planIss(o);
    const r = await runExposures(mxHost, plan.frames, { width, height, spp: o.spp ?? 4, baseSpp: 32 }, progress, signal);
    drawIssTrail(r.data, width, height, plan.view, plan.track, { dashes: o.dashes, exposure: o.exposure });
    // (its ends and its highest, for the labels)
    const pick = [plan.track[0]!, plan.track.reduce((a, b) => (b.alt > a.alt ? b : a)), plan.track.at(-1)!];
    const marks = skyMarks(pick, plan.view, width, height).map(({ of: _, ...m }) => ({ ...m, r: 3 }));
    const outside = framedOut(o.view, plan.view, plan.track, width / height);
    return { ...r, view: plan.view, marks, pass, outside };
  };
  /** The multiple exposure's dialog — the photo bar, the top bar, the wheel, the pause menu, the sky's events —: taken
   *  "from this view" when one is framed on the Earth's ground. */
  function openMultiExposure(kind?: MxKind) {
    void mxDialog.open(kind ? { kind } : {});
  }
  const mxDialog = new MultiExposureDialog({
    place: () => {
      const p = camera.weatherPlace();
      return p && p.body === "earth" ? { lat: p.lat, lon: p.lon } : null;
    },
    view: () => framedView(),
    // (before a series is run from the player's framing: what of its subject that framing leaves out)
    outside: async (r) => {
      if (!r.view) return null;
      const o = { ...r, base: undefined, sky: r.sky };
      const aspect = r.width / r.height;
      if (r.kind === "analemma") {
        const p = planAnalemma({ ...o, minutesUtc: r.minutesUtc, start: r.start, cadence: r.cadence });
        return (
          framedOut(
            r.view,
            p.view,
            p.suns.filter((x) => x.alt > -1),
            aspect,
          ) ?? null
        );
      }
      if (r.kind === "eclipse") {
        const p = planEclipse({
          kind: r.eclipse === "lunar" ? "lunar" : "solar",
          date: r.date,
          lat: r.lat,
          lon: r.lon,
          before: r.before,
          after: r.after,
          width: r.width,
          height: r.height,
          view: r.view,
        });
        return p ? (framedOut(r.view, p.view, p.moments, aspect) ?? null) : null;
      }
      if (r.kind === "moon") {
        const p = planMoonPath({ ...o, mode: r.mode, base: undefined });
        return p ? (framedOut(r.view, p.view, p.moments, aspect) ?? null) : null;
      }
      if (r.kind === "iss") {
        const { plan: p } = planIss(o);
        return framedOut(r.view, p.view, p.track, aspect) ?? null;
      }
      return null;
    },
    now: () => utcOf(sim.time),
    run: (r, progress, signal) => {
      if (r.kind === "analemma")
        return runAnalemma({ ...r, base: r.base === "central" || r.base === "middle" ? "dusk" : r.base }, progress, signal);
      if (r.kind === "eclipse")
        return runEclipse(
          {
            kind: r.eclipse === "lunar" ? "lunar" : "solar",
            date: r.date,
            lat: r.lat,
            lon: r.lon,
            before: r.before,
            after: r.after,
            framing: r.framing,
            base: r.base === "same" ? "dusk" : r.base === "middle" ? "central" : r.base,
            sky: r.sky,
            layout: r.layout,
            planet: r.planet,
            width: r.width,
            height: r.height,
            spp: r.spp,
            view: r.view,
          },
          progress,
          signal,
        );
      if (r.kind === "trails")
        return runTrails(
          {
            lat: r.lat,
            lon: r.lon,
            date: r.date,
            hours: r.hours,
            count: r.count,
            toward: r.toward,
            fov: r.fov,
            comet: r.comet,
            sky: r.sky,
            width: r.width,
            height: r.height,
            spp: r.spp,
            view: r.view,
          },
          progress,
          signal,
        );
      if (r.kind === "moon")
        return runMoonPath(
          {
            mode: r.mode,
            lat: r.lat,
            lon: r.lon,
            date: r.date,
            step: r.step,
            span: r.span,
            days: r.days,
            minutesUtc: r.minutesUtc,
            framing: r.framing,
            base: r.base === "middle" || r.base === "dusk" || r.base === "none" ? r.base : "middle",
            sky: r.sky,
            width: r.width,
            height: r.height,
            spp: r.spp,
            view: r.view,
          },
          progress,
          signal,
        );
      if (r.kind === "iss")
        return runIss(
          {
            lat: r.lat,
            lon: r.lon,
            date: r.date,
            framing: r.framing,
            dashes: r.dashes,
            exposure: r.exposure,
            sky: r.sky,
            width: r.width,
            height: r.height,
            spp: r.spp,
            view: r.view,
          },
          progress,
          signal,
        );
      return Promise.reject(new Error(`${r.kind}: not yet`));
    },
    issPasses: async (lat, lon, from) => issPasses(lat, lon, from, 10),
    eclipses: async (kind, lat, lon, around) => {
      const YEAR = 365.25 * 86400e3;
      // (the transits: seen from the whole day side, over a century and a half)
      if (kind === "transit") {
        const t = (await plan({
          kind: "eclipses",
          q: { from: around - 30 * YEAR, to: around + 120 * YEAR, kinds: ["transit"], place: null },
        })) as { events: EclipseEvent[] } | { error: string };
        if ("error" in t) throw new Error(t.error);
        return t.events.map((e) => ({ t: (e as { t: number }).t, type: (e as { planet: string }).planet }));
      }
      const r = (await plan({
        kind: "eclipses",
        q: { from: around - 10 * YEAR, to: around + 40 * YEAR, kinds: [kind], place: { lat, lon } },
      })) as { events: EclipseEvent[] } | { error: string };
      if ("error" in r) throw new Error(r.error);
      return r.events
        .filter((e) => e.here?.seen)
        .map((e) => ({ t: (e as { t: number }).t, type: e.here?.type ?? (e as { type: string }).type, magnitude: e.here?.magnitude }));
    },
    download: (b, name) => download(b, name),
  });
  /** The template of a ground view for a multiple exposure (no ship, the Earth's sky). */
  const mxTemplate = (sky: "game" | "clear" = "game"): Preset => ({
    ...presets["Earth: total eclipse over Burgos, 12 Aug 2026"]!,
    earthClouds: sky === "clear" ? 0 : settings.earthClouds,
    weather: sky === "clear" ? "fair" : settings.weather,
    // (the base's glow — the scene has none of its own: undefined, it blackened the image)
    bloom: presets["Earth: total eclipse over Burgos, 12 Aug 2026"]!.bloom ?? settings.bloom,
  });
  /**
   * Taken to see an eclipse (PLAN-CIEL C7): a scene made for it — a solar or a lunar one from the place
   * asked if it is seen there, else from where it is best (the greatest point, the Moon at the zenith), a
   * few minutes before its greatest there, looking at the Sun or the Moon; a transit from where the Sun is
   * high; a moon's phenomenon or another world's eclipse from that world's sky in orbit, when it is there
   * (the light's delay from the Earth taken off).
   */
  function goSeeEclipse(e: EclipseEvent, place: { lat: number; lon: number } | null) {
    const base = presets["Earth: total eclipse over Burgos, 12 Aug 2026"]!;
    const tOfMs = (ms: number) => (ms - EPOCH_DATE) / 1000 / M_SECONDS;
    let preset: Preset;
    if (e.kind === "solar" || e.kind === "lunar") {
      const seen = e.here?.seen && place ? place : null;
      const where = seen ?? bestPlace(e);
      const lunar = e.kind === "lunar";
      const at = lunar ? e.t - 3 * 60e3 : (e.here?.seen ? e.t : e.t) - 2 * 60e3;
      preset = {
        ...base,
        target: lunar ? "moon" : "sun",
        fov: lunar ? 2.5 : 8,
        earthClouds: settings.weather === "real" ? settings.earthClouds : 0,
        time: tOfMs(at),
        pose: { at: [where.lat, where.lon], look: lunar ? "moon" : "sun", off: [0, 0] },
      };
    } else if (e.kind === "transit") {
      preset = { ...base, target: "sun", fov: 1.2, time: tOfMs(e.t), pose: { at: [0, 0], look: "sun", off: [0, 0] } };
    } else {
      const world = e.kind === "phenomenon" ? e.planet : (e as { world: string }).world;
      const t = e.kind === "phenomenon" ? (Number.isFinite(e.start) ? e.start : e.end) + 60e3 : (e as { t: number }).t;
      const delay =
        (Math.hypot(...solarState(world, tOfMs(t)).pos.map((x, i) => x - solarState("earth", tOfMs(t)).pos[i]!)) * M_METRES) / 299792458;
      const R = (solarBody(world)!.radius * M_METRES) / 1000;
      preset = {
        ...presets["Jupiter: from orbit"]!,
        target: world as Target,
        fov: 30,
        time: tOfMs(t - (e.kind === "phenomenon" ? delay * 1000 : 0)),
        pose: { tilt: 20, body: world, altKm: Math.max(R * 4, 2000), phase: 10, look: world },
      };
    }
    presets["Eclipse"] = preset;
    eclipses.hide();
    applyPreset("Eclipse");
    touch();
  }
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
    replay: (what, shot) => {
      if (what === "close") return replay.close(), null;
      if (what === "video")
        return replay.active || !replayOpen(false) ? replay.video(false) : t("Nothing to replay yet: fly a little first");
      const why = replay.active && what === "open" ? null : replayOpen(what === "trailer");
      if (!why && shot) replay.setMode(shot as "auto");
      return why;
    },
    skyGoTo: (kind, i) => void skyGoTo(kind, i),
    map: (on, tab) => {
      if (flightHud.mapView !== on) flightHud.toggleMapView();
      if (on && tab) flightHud.setMapTab(tab);
    },
    localMap: {
      state: () => flightHud.ground.localMap.state(),
      zoom: (value) => {
        if (!flightHud.ground.localPlace()) throw new Error("The local map requires an explorer or a landed craft");
        flightHud.drawLocalMap();
        return flightHud.ground.localMap.setZoom(value);
      },
    },
    hudDensity: (n) => flightHud.setDensity(n),
    open: (p) => {
      const open: Record<typeof p, () => void> = {
        settings: () => panel.toggle(true),
        place: () => placePanel.open(),
        time: () => timePanel.open(),
        weather: () => weatherPanel.open(),
        eclipses: () => eclipses.open(),
        scenes: () => scenes.open(),
        photo: () => void setGameMode("photo"),
        controls: () => controlsScreen.open(),
        help: () => actions["btn-help"]!(),
        pause: () => keyActions.pause(new KeyboardEvent("keydown")),
        planner: () => openMissions(),
        sky: () => actions["btn-sky"]!(),
        camera: () => actions["btn-camera"]!(),
        music: () => musicPanel.toggle(true),
        render: () => renderDialog.toggle(true),
        atlas: () => atlas.open(),
        skyevents: () => void skyEvents.open(),
        observe: () => openObserve(),
        multiexposure: () => openMultiExposure(),
        flighthub: () => flightHub.open(),
        route: () => routePanel.open(),
        challenges: () => challengePanel.open(),
        title: () => titleScreen?.open(),
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
    dayClouds: () => renderer.dayCloudsOf,
    mode: { get: () => gameMode(), set: (m) => setGameMode(m), hideBar: (on) => topBar.hide(on) },
    video: {
      start: (o) => {
        if (!(SHOT_IDS as readonly string[]).includes(o.shot)) return `no shot "${o.shot}" — ${SHOT_IDS.join(", ")}`;
        return renderDialog.startVideo({ ...o, shot: o.shot as Shot });
      },
      state: () => renderDialog.videoState(),
      stop: () => renderDialog.stopVideo(),
      shots: () => renderDialog.shots(),
    },
    skyEvents: {
      list: async () =>
        (await skyEvents.events())?.map((e) => ({
          id: e.id,
          title: e.title,
          when: e.when ? new Date(e.when).toISOString() : null,
          detail: e.detail,
          look: {
            azDeg: Math.round(e.view.az),
            altDeg: Math.round(e.view.alt),
            fovDeg: +e.view.fov.toFixed(1),
            lensMm: Math.round(lensMm(e.view.fov)),
          },
          render: !!e.render,
          ...(e.highlight && e.id.startsWith("iss-") ? { transit: true } : {}),
        })) ?? null,
      take: (id, way) => skyEvents.take(id, way),
      open: () => skyEvents.open(),
      stopLive: () => {
        if (!liveCapture.running) return "no live capture running";
        liveCapture.close();
        return null;
      },
    },
    atlas: {
      search: async (q, body) => {
        const out: { name: string; body: string; lat: number; lon: number; kind: string; detail?: string }[] = [];
        const c = parseCoords(q);
        if (c) out.push({ name: q, body: body ?? "earth", ...c, kind: "coordinates" });
        for (const p of searchPois(q, POIS, body))
          out.push({ name: p.name[lang], body: p.body, lat: p.lat, lon: p.lon, kind: p.kind, detail: p.about[lang] });
        for (const x of SITES)
          if ((!body || x.body === body) && x.name.toLowerCase().includes(q.toLowerCase()))
            out.push({ name: x.name, body: x.body, lat: x.lat, lon: x.lon, kind: "site" });
        if ((!body || body === "earth") && !c && out.length < 3)
          for (const g of await geocode(q, { lang, fallback: true }).catch(() => []))
            out.push({ name: g.name, body: "earth", lat: g.lat, lon: g.lon, kind: g.kind || "address", detail: g.detail });
        return out;
      },
      go: (to, p) => atlasGo(to, { ...p }),
      open: (o) => atlas.open(o),
    },
    capture: {
      start: (o) => renderDialog.capture(o),
      state: () => {
        const r = renderDialog.state();
        const st = renderer.offlineActive ? lastOffline : null;
        return { ...r, active: renderer.offlineActive, progress: st ? st.progress : null, done: !!st?.done };
      },
      stop: () => renderDialog.stop(),
      save: (k) => renderDialog.save(k),
    },
    utcNow: () => utcOf(sim.time),
    multiExposure: (r) => mxDialog.open({ kind: r.kind, run: r }),
    lessons: {
      list: () => LESSONS.map((L) => ({ id: L.id, title: t(L.title) })),
      demo: (id) => {
        if (!LESSONS.some((L) => L.id === id)) throw new Error(`no lesson "${id}" — lesson list`);
        return lessonPlace(id as LessonId, true);
      },
      tryIt: (id) => {
        if (!LESSONS.some((L) => L.id === id)) throw new Error(`no lesson "${id}" — lesson list`);
        return lessonPlace(id as LessonId, false);
      },
      guided: (id) => {
        if (!LESSONS.some((L) => L.id === id)) throw new Error(`no lesson "${id}" — lesson list`);
        return lessonPlace(id as LessonId, "guided");
      },
      open: () => flightSchool(instrHost),
    },
    missions: {
      list: () => [
        ...AIR_MISSIONS.map((d) => ({ id: d.id, title: d.make().title, mine: false })),
        ...myMissions().map((m) => ({ id: m.id, title: m.title, mine: true })),
        // (the views of exception — S2 —: their challenge in their title)
        ...EXCEPTIONAL_VIEWS.map((v) => ({ id: v.id, title: `${v.title} — ${v.challenge}`, mine: false })),
      ],
      spec: (id) => missionSpec(id),
      fly: (x) => (typeof x === "string" && EXCEPTIONAL_VIEWS.some((v) => v.id === x) ? viewsHost.fly(x) : airMissions.fly(x)),
      state: () => airMissions.state(),
      abort: () => camera.missionAbort(),
      map: () => missionMap.open(),
      edit: (spec) => missionEditor.open(spec),
      keep: (spec) => keepMission(spec),
      link: (spec) => missionLink(spec),
    },
    f35: {
      fields: () => flightFields(),
      prepare: (o) => {
        const start = o.start as (typeof FLIGHT_STARTS)[number] | undefined;
        const hour = o.hour as (typeof FLIGHT_HOURS)[number] | undefined;
        const weather = o.weather as (typeof FLIGHT_WEATHER)[number] | undefined;
        if (start && !FLIGHT_STARTS.includes(start)) throw new Error(`start: ${FLIGHT_STARTS.join(", ")}`);
        if (hour && !FLIGHT_HOURS.includes(hour)) throw new Error(`hour: ${FLIGHT_HOURS.join(", ")}`);
        if (weather && !FLIGHT_WEATHER.includes(weather)) throw new Error(`weather: ${FLIGHT_WEATHER.join(", ")}`);
        const note = placeShip(() => prepareFlight(hubHost, { field: o.field, start, hour, weather, fuel: o.fuel, dest: o.dest }));
        return note;
      },
      challenges: () => {
        const B = challengeBests();
        return CHALLENGES.map((d) => ({
          id: d.id,
          title: tr(d.title),
          kind: d.kind,
          par: d.par,
          best: B[d.id] ? { score: B[d.id]!.score, medal: B[d.id]!.medal ?? null } : null,
        }));
      },
      fights: () => SCENARIOS.map((d) => ({ id: d.id, title: tr(d.title) })),
      fly: (id) => {
        const c = CHALLENGES.find((d) => d.id === id);
        const f = SCENARIOS.find((d) => d.id === id);
        if (!c && !f) throw new Error(`no challenge or fight "${id}" — f35 challenges lists them`);
        placeShip(() => {
          if (c) flyChallenge(challengeHost, c);
          else flyFight(challengeHost, f!);
          return "";
        });
        return `${tr((c ?? f)!.title)}: started`;
      },
      figures: () => {
        const B = aeroBests();
        return FIGURE_ORDER.map((id) => {
          const F = FIGURES[id];
          return { id, name: t(F.name), brief: t(F.brief), entry: F.entry, best: B[id] ?? null };
        });
      },
      figure: (id, mode) => {
        if (id !== "box" && !FIGURE_ORDER.includes(id as FigureId)) throw new Error(`no figure "${id}" — f35 figures lists them`);
        placeShip(() => {
          flyFigure(challengeHost, id as FigureId | "box", mode === "watch" ? "demo" : "judge");
          return "";
        });
        return id === "box"
          ? "the aerobatic box: armed — five figures"
          : `${t(FIGURES[id as FigureId].name)}: ${mode === "watch" ? "flown by the autopilot" : "armed for the player"}`;
      },
      abort: () => {
        if (camera.aero) {
          camera.aeroStop();
          return "the figure given up";
        }
        if (camera.combat) {
          camera.combatEnd();
          return "the fight given up";
        }
        if (camera.chal) {
          camera.challengeAbort();
          return "the challenge given up";
        }
        return "none running";
      },
    },
    music: {
      state: () => ({ ...music.state(), intensitySet: music.prefs.intensity, mix: music.prefs.mix, muted: music.prefs.muted }),
      themes: () => MUSIC_THEMES.map((x) => ({ id: x.id, name: x.name })),
      set: (o) => {
        const P = music.prefs;
        const said: string[] = [];
        if (o.mode) {
          if (!["moments", "adaptive", "playlist"].includes(o.mode)) throw new Error("mode: moments, adaptive, playlist");
          P.mode = o.mode as typeof P.mode;
          said.push(`mode ${o.mode}`);
        }
        if (o.listen !== undefined) {
          if (o.listen && !MUSIC_THEMES.some((x) => x.id === o.listen)) throw new Error(`no theme "${o.listen}" — music themes lists them`);
          music.listen(o.listen);
          said.push(o.listen ? `listening to ${o.listen}` : "the game's choice");
        }
        if (o.intensity !== undefined) {
          P.intensity = o.intensity;
          said.push(o.intensity === null ? "intensity: the flight's" : `intensity ${o.intensity}`);
        }
        if (o.layer) {
          if (o.layer !== "master" && !(MUSIC_LAYERS as string[]).includes(o.layer))
            throw new Error(`layer: master, ${MUSIC_LAYERS.join(", ")}`);
          if (o.level !== undefined) (P.mix as unknown as Record<string, number>)[o.layer] = o.level;
          if (o.mute !== undefined && o.layer !== "master")
            P.muted = o.mute ? [...new Set([...P.muted, o.layer as MusicLayer])] : P.muted.filter((l) => l !== o.layer);
          said.push(`${o.layer}${o.level !== undefined ? ` ${o.level}` : ""}${o.mute !== undefined ? (o.mute ? " muted" : " heard") : ""}`);
        }
        music.save();
        if (!settings.music) {
          settings.music = true;
          onSettingsChange(["music"]);
        }
        return said.join(", ") || "nothing changed";
      },
    },
    framedView: () => framedView(),
    observe: {
      when: (q, o) => {
        const it = findObservable(q);
        if (!it) return `nothing called "${q}" to look at — a planet, a moon, a star, the ISS, the wormhole`;
        const p = skyPlace();
        if (!p) return "not on the Earth's ground: walk, set the tripod, or take the free camera near the ground first";
        const from = o.from ?? utcOf(sim.time);
        const days = o.days ?? (it.o.kind === "iss" ? 10 : 14);
        return { name: it.name, now: spotOf(it.o, p.lat, p.lon, utcOf(sim.time)), windows: seenWindows(it.o, p.lat, p.lon, from, days) };
      },
      look: (q, at) => {
        const it = findObservable(q);
        if (!it) return `nothing called "${q}" to look at`;
        if (at !== "best") return observeAt(it.o, at);
        const p = skyPlace();
        if (!p) return "not on the Earth's ground";
        const w = nextSeen(it.o, p.lat, p.lon, utcOf(sim.time), 60);
        return w ? observeAt(it.o, w.best) : `${it.name} is not seen from here for two months`;
      },
      open: (q) => openObserve(q ?? ""),
    },
    issPasses: (lat, lon, from, days) => issPasses(lat, lon, from, days),
    seeEclipse: async (kind, t, place) => {
      const r = await plan<{ events: EclipseEvent[] } | { error: string }>({
        kind: "eclipses",
        q: { from: t - 3 * 86400e3, to: t + 3 * 86400e3, kinds: [kind], place },
      });
      const e = "error" in r ? undefined : r.events[0];
      if (!e) return null;
      goSeeEclipse(e, place);
      return e.id;
    },
    display: tarsDisplay,
    screen: (name, slot = 0) => {
      if (name === "crew_console") {
        if (!settings.netMenu) return t("The network's menu is off (Settings › Network)");
        return netPanel.showCrew() ?? "Join or create a room to share the crew console.";
      }
      const map = (tab?: "orbit" | "globe" | "map") => {
        if (!flightHud.mapView) flightHud.toggleMapView();
        if (tab) flightHud.setMapTab(tab);
      };
      if (name === "character") {
        characterHud.show();
        return "character HUD";
      }
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
      if (name === "eclipses") {
        eclipses.open();
        return "the eclipse calculator";
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
  // the real weather (realweather.ts, PLAN-METEO W7, PLAN-CIEL C1): with "Real" chosen, at the camera's place and
  // the game's date — the METAR of a runway's station within 60 km when the date is now, else Open-Meteo's model
  // anywhere on the Earth (its forecast, its archive since 1940), out of their reach a plausible draw; checked
  // every 3 s (the requests cached: one per cell and day), redrawn when it changes
  const realWeather = new RealWeather();
  const metarTick = () => {
    if (settings.weather !== "real") return;
    // (a state set by a script — the flight lab's, an e2e's — kept: the fog or the storm asked flown as it is)
    if (camera.weatherReal && !realWeather.owns(camera.weatherReal)) return;
    const p = camera.weatherPlace();
    if (!p) return;
    const { state, info } = realWeather.at(p, settings.wind);
    camera.weatherRealInfo = info;
    if (state === camera.weatherReal) return;
    camera.weatherReal = renderer.weatherReal = state;
    touch();
  };
  realWeather.onUpdate = metarTick;
  // (the sky in figures for TARS's telemetry: system/sky-now.ts)
  (camera as unknown as { skyInfo: () => unknown }).skyInfo = () => skyNow(settings, sim.time, renderer.refractivity(settings));
  // (the map's weather layer: the real weather's own — the day's clouds, each station's)
  flightHud.mapWeather = {
    real: () => camera.weatherReal,
    mosaic: () => renderer.dayCloudsMosaic(),
    at: (lat, lon) => {
      const p = camera.weatherPlace();
      return p ? realWeather.modelAt(lat, lon, p.days) : null;
    },
  };
  window.setInterval(metarTick, 3000);
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
  events.on("airEntry", () => {
    entryPoint = tools.snapshot("before the entry");
  });
  events.on("craftLost", ({ why }) => {
    // (in a room: no pause, no going back in time — the others fly on —: said to them, set down again on the
    // nearest runway a few seconds later)
    const net = netPanel.net;
    if (net?.room) {
      netMatch.log.push(`${net.roomNow().toFixed(1)} lost: ${why}`);
      camera.onPilotMessage?.(why);
      panel.toast(tf("{0} — back on the nearest runway in 4 s", why));
      net.event({ kind: "crash", why, with: collidedWith });
      collidedWith = null;
      // (placed again meanwhile — beside another, the Place panel, the atlas —: that place kept, no runway)
      const placed = tools.placings;
      setTimeout(() => {
        if (tools.placings !== placed) return;
        try {
          tools.lineUp();
          camera.airFlight.reset(fleet.active);
        } catch (e) {
          panel.toast(String((e as Error).message ?? e));
        }
      }, 4000);
      return;
    }
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
    boot: () => bootReport(firstFrame ? firstFrameAt : null),
    intro: () => splash.status(),
    settings,
    renderer,
    camera,
    sim,
    tools,
    bench,
    mission,
    cockpitScreens,
    pcd: { pcd: jetPcd, stats: pcdStats },
    flight: {
      hub: flightHub,
      route: routePanel,
      challenges: challengePanel,
      missions: airMissions,
      views: { open: () => openViews(viewsHost), fly: (id: string) => viewsHost.fly(id), list: () => EXCEPTIONAL_VIEWS.map((v) => v.id) },
      /** the replay (S3): opened, its trailer, a camera held ("auto", "chase", "orbit", "flyby", "cockpit"), sought (s from
       *  the tape's end, ≤ 0), played or paused, its trailer as a video, closed; where it is */
      replay: {
        open: () => replayOpen(false),
        trailer: () => replayOpen(true),
        shot: (m: "auto" | "chase" | "orbit" | "flyby" | "cockpit" | "target") => replay.setMode(m),
        seek: (s: number) => replay.at(tape.end + s),
        play: (on: boolean) => {
          replay.playing = on;
        },
        video: (draft = true) => replay.video(draft),
        close: () => replay.close(),
        state: () => replay.state(),
        tape: () => {
          const trailMs = replayTrailMs;
          replayTrailMs = 0;
          return { seconds: tape.length, frames: tape.frames.length, end: tape.end, trailMs };
        },
        /** the trailer's video: rendering (its frame, of how many), stopped */
        videoState: () => renderDialog.videoState(),
        videoStop: () => renderDialog.stopVideo(),
      },
      school: {
        open: () => flightSchool(instrHost),
        demo: (id: LessonId) => lessonPlace(id, true),
        tryIt: (id: LessonId) => lessonPlace(id, false),
        guided: (id: LessonId) => lessonPlace(id, "guided"),
        /** the lesson flown now: its step, its time, what is left of it, how long stalled; the last one's end */
        state: () => camera.courseState(),
      },
    },
    net: netPanel,
    audio,
    voice,
    capcom,
    music,
    tars: {
      agent: tarsAgent,
      memory: tarsMemory,
      tools: () => tarsTools,
      spent: () => openRouter.spent,
      earTrail: () => tarsTalk.trail,
      // (a line's Deepgram sound asked: its length in samples — the tests)
      voiceSynth: async (text: string, model: string) => (await deepgramVoice.synth(text, model))?.length ?? 0,
    },
    skyLoading,
    mx: {
      runAnalemma,
      runEclipse,
      runTrails,
      runMoonPath,
      runIss,
      issPasses: issPassesHere,
      planEclipse,
      host: mxHost,
      dialog: mxDialog,
      /** the view framed on the Earth's ground ("from this view"), or null */
      framedView,
    },
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
    mode: {
      get: () => gameMode(),
      set: (m: GameMode) => setGameMode(m, true),
      state: () => modeState(true),
      bar: () => ({ mode: topBar.mode, hidden: topBar.hidden }),
      hideBar: (on: boolean) => topBar.hide(on),
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
  const sceneryCredit = Object.assign(document.createElement("div"), { className: "scenery-credit", hidden: true });
  const creditLink = (label: string, href: string) =>
    Object.assign(document.createElement("a"), { textContent: label, href, target: "_blank", rel: "noopener" });
  sceneryCredit.append(
    "© ESA WorldCover / Copernicus 2021 · ",
    creditLink("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    " · © OpenMapTiles · ",
    creditLink("© OpenStreetMap", "https://www.openstreetmap.org/copyright"),
    " · ",
    creditLink("OpenFreeMap", "https://openfreemap.org"),
  );
  document.body.append(sceneryCredit);
  // (the real traffic — traffic/feed.ts, T1 —: asked of the relay about the flown craft, its sources credited)
  const trafficFeed = new TrafficFeed();
  camera.traffic = trafficFeed;
  const trafficCredit = Object.assign(document.createElement("div"), { className: "scenery-credit traffic-credit", hidden: true });
  trafficCredit.dataset.testid = "traffic-credit";
  document.body.append(trafficCredit);
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  let hudTimer = 0;
  let frozen = false;
  /** the ground's heights last seen (renderer.groundStamp) */
  let groundSeen = "";
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
    if (!frozen && !paused && !replay.active) advanceFrameClock(dt * 1000);
    // (the rain's: only while the time runs — paused, the drops stand still)
    if (!frozen && !paused && settings.animate) renderer.rainClock += dt;
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
    if (!frozen && !paused && !renderer.offlineActive && !replay.active) {
      // (the flight plan's guidance speaking: a waypoint passed, its end, the bingo)
      if (camera.nav.say) {
        panel.toast(camera.nav.say);
        camera.nav.say = null;
      }
      if (camera.chal?.say) {
        panel.toast(camera.chal.say);
        camera.chal.say = null;
      }
      // (an aerobatic figure: its cues, its marks)
      if (camera.aero?.say) {
        panel.toast(camera.aero.say);
        camera.aero.say = null;
      }
      // (the gamepad felt in the hands — V5: the buffet's shaking, a touchdown's jolt; six times a second at most)
      padFeel(now);
      // (a fight: what it says, what is heard — the gun, the launches, the explosions at their distance, the
      // missile warning)
      const CB = camera.combat;
      if (CB) {
        if (CB.say) {
          panel.toast(CB.say);
          CB.say = null;
        }
        sound.combatFrame(
          CB.world.firing && CB.world.stores.gun > 0,
          CB.world.missiles.some((m) => m.alive && m.owner === "red" && m.target === -1),
        );
        for (const e of CB.events) {
          if (e.kind === "launch") {
            sound.combatCue(e.who === "blue" ? "launch" : "enemyLaunch");
            if (e.who === "blue") replayEv |= EV.LAUNCH;
          } else if (e.kind === "explode" && CB.last) {
            const d = Math.hypot(e.p[0] - CB.last.p[0], e.p[1] - CB.last.p[1], e.p[2] - CB.last.p[2]);
            if (d < 8000) replayEv |= EV.BOOM;
            sound.combatCue("explode", { dist: d, size: e.size });
          } else if (e.kind === "hit" && e.on === "player") sound.combatCue("hit");
        }
        // (TARS as the backseater — I2 —: the missiles at us, the bandits by their BRAA, a hit, a kill called)
        if (settings.f35ThreatCalls && camera.piloting)
          for (const c of camera.threatsStep()) {
            // (the picture Darkstar's — I4 —, the missiles at us TARS's)
            const awacs = settings.f35RadioRoles !== false && threatRole(c.kind) === "awacs";
            voice.say({
              text: c.text,
              speaker: awacs ? "awacs" : "tars",
              priority: c.priority,
              ttl: c.priority === 1 ? 6000 : 12_000,
              radio: awacs,
            });
          }
        CB.events = [];
      } else sound.combatFrame(false, false);
      if (cpuProf.time("flight (camera.update)", () => sim.step(dt))) {
        changed = true;
        guiDirty = true;
      }
    }
    // what the renderer draws of the flight (the ship, its flames, the predicted path) — an offline job
    // or a video holds its own
    characterHud.update(now);
    footHud.show(camera.character.active && !flightHud.mapView);
    footHud.update(now);
    sceneryHitboxes.update(
      now,
      camera.character,
      renderer.earthScenery.contact,
      settings.fov,
      settings.sceneryHitboxes && !flightHud.mapView,
      canvas,
    );
    const pil = flying();
    const info = pil ? cpuProf.time("flight figures (flightInfo)", () => camera.flightInfo()) : null;
    // (flying together: ours sent, the others placed — before the render's figures: their contrails come with ours — ui/netsession.ts)
    netSession.frame(dt);
    missionHud.tick();
    instructorPanel.tick();
    // (the real traffic about us: asked when due — off by the setting, offline, far from the Earth)
    trafficFeed.tick(now / 1000, settings.traffic && camera.piloting ? camera.geoNow() : null, settings.traffic);
    {
      const live =
        trafficFeed.status === "live" && trafficFeed.attribution.length > 0 && (trafficFeed.planes.size > 0 || trafficFeed.ships.size > 0);
      const txt = live ? trafficFeed.attribution.join(" · ") : "";
      if (trafficCredit.textContent !== txt) trafficCredit.textContent = txt;
      trafficCredit.hidden = !live;
    }
    netMatch.frame();
    netVoice.frame();
    // (who speaks: a mark before his name)
    // (the real traffic's labels and lights — controller/traffic.ts)
    viewOverlay.trafficMarks =
      camera.piloting && !replay.active
        ? [
            ...(settings.traffic ? [...camera.trafficOverlay(unitsFor(settings).fAlt), ...camera.seaOverlay(unitsFor(settings).fSpd)] : []),
            ...camera.carrierOverlay(unitsFor(settings).fSpd),
          ]
        : [];
    viewOverlay.netTags = netSession.tags.map((g) => (netVoice.speaking(g.slot) ? { ...g, name: `◉ ${g.name}` } : g));
    if (netSession.ships.length) changed = true;
    if (!renderer.offlineActive && !replay.active && cpuProf.time("free-fall prediction", () => sim.applyRender(info))) changed = true;
    // (another player followed: his flame as the flown craft's — ui/netsession.ts)
    netSession.afterRender();
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
    // (the flown ship's ground, kept for its gear — a spectator's too, the view gone thousands of km: the Moon's
    // finer maps pinned, the Earth's tiles round it when the view is off the Earth. What is drawn on the Earth —
    // tiles, surface, scenery, their shadows — follows the camera whenever it is there; the streaming's lead, the
    // camera's own motion: renderer.ts)
    renderer.shipFocus = camera.piloting && !camera.character.active ? shipFocus() : null;
    const ridden = renderer.shipFocus?.body === "earth" && !camera.spectating ? camera.activePoseNow() : null;
    if (ridden) {
      const ground = groundVelocity("earth", ridden.X, sim.time);
      renderer.carrierVelocity = bodyAxes(solarBody("earth")!, sim.time).map((a) =>
        a.reduce((sum, v, i) => sum + v * (ridden.V[i]! - ground[i]!) * 299792458, 0),
      ) as [number, number, number];
    } else renderer.carrierVelocity = null;
    renderer.onFoot = camera.character.active;
    // (finer heights come in under what stands on the ground — a scene's tripod placed on the coarse relief, inside
    // the Grand Canyon's rim: set on them at once, the clock held or not — a step of no time, as the flight's own)
    const groundNow = renderer.groundStamp;
    if (groundNow !== groundSeen) {
      groundSeen = groundNow;
      if (camera.ourLanded && !camera.character.active) camera.fall(0, [0, 0, 0], false);
    }
    // (the rain where the view is: the spectator's camera away from the ship — in orbit, under another sky —
    // has its own, or none)
    const viewer = camera.viewController();
    viewer.weatherReal = camera.weatherReal;
    renderer.rain = viewer.rainView();
    renderer.meterSpot = telescopeSpot();
    // (the replay — S3 —: its frame drawn again under its camera; else the flight kept on the tape, while it runs)
    if (replay.active && !renderer.offlineActive) {
      replay.frame(dt);
      changed = true;
    } else if (!frozen && !paused && !renderer.offlineActive && settings.animate && camera.piloting && !camera.spectating) {
      tape.tick(dt);
      const smp = camera.replaySample();
      if (smp) {
        // (the trails' state kept every 5 s, and at the tape's start)
        const snap = tape.clock - trailSnapAt >= TRAIL_SNAP_S || !tape.frames.length;
        const kept = tape.push(
          smp,
          camera.replayEvents() | replayEv,
          {
            pose: Object.fromEntries(REPLAY_KEYS.map((k) => [k, settings[k]])) as Partial<Settings>,
            time: sim.time,
            water: renderer.water.clock,
            exp: renderer.autoExposureEV,
            thrust: renderer.shipThrust,
            plasma: renderer.shipPlasma,
            jet: renderer.jetPose && { ...renderer.jetPose },
            ...((S) =>
              S
                ? {
                    others: othersTo(renderer.combatOthers.slice(0, 24), (v) => mulSt(S, v)),
                  }
                : { others: [] })(camAxesNow()),
            wakes: renderer.seaWakes,
            trail: camera.contrailStep,
            trailSnap: snap ? camera.contrails.snapshot() : undefined,
            booms: ((C) =>
              C?.last && C.booms.length
                ? C.booms.map((b) => ({
                    w: enuToEcef(smp, [b.p[0] - C.last!.p[0], b.p[1] - C.last!.p[1], b.p[2] - C.last!.p[2]]),
                    age: C.t - b.t,
                    size: b.size,
                  }))
                : [])(camera.combat),
          },
          replayFocus(smp),
        );
        if (kept && snap) trailSnapAt = tape.clock;
      }
      // (a craft set elsewhere — a scene, a jump —: the tape begun afresh)
      else if (tape.frames.length) tape.clear();
    }
    replayEv = 0;
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
      bootMark("first-image");
      splash.firstImage();
      // (Jupiter's moons' ephemeris, when the start did not wait for it: now, the first image drawn and the sky
      // in — not sharing the link with it)
      if (!jovianFirst) void afterSkyPrefetch(2000).then(() => loadEphemerides(ephemerisUrls(["jup"])));
    }
    if (st) {
      renderedAt = now;
      fpsN++;
      changed = false;
      sim.timeDirty = false;
      displayChanged = false;
      lastStats = st;
      if (st.offline) renderDialog.update((lastOffline = st.offline));
      if (renderer.completedFrames !== measuredFrames) {
        measuredFrames = renderer.completedFrames;
        // (a frame of the motion's denser rays — Sharpness in motion, a turn —: not this scale's time; counted, a long
        // turn lowered the scale, and its 30 s memory then held it down after the turn)
        if (!renderer.lastFrameDense) gpuEma = gpuEma ? 0.9 * gpuEma + 0.1 * renderer.lastGpuMs : renderer.lastGpuMs;
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
    const hideSceneryCredit = !renderer.earthScenery.active;
    if (sceneryCredit.hidden !== hideSceneryCredit) sceneryCredit.hidden = hideSceneryCredit;
    applyTuning(settings);
    cpuProf.time("game tools window", () => toolsWin.tick());
    saveTimer += dt;
    // (a setting changed: the player's own kept two seconds on, the game saved with them)
    const soon = saveSoon && saveTimer > 2;
    // (a benchmark's settings are not the player's; a replay's poses not the flight's)
    if (soon && !benchPage && !replay.active) writePrefs(settings);
    if (settings.autosave && firstFrame && !renderer.offlineActive && !replay.active && (saveTimer > settings.autosaveEvery || soon)) {
      saveTimer = 0;
      cpuProf.time("autosave", () => tools.autosaveNow());
    }
    if (soon) saveSoon = false;
    const hudVisible = (pil && !replay.active) || (camera.character.active && flightHud.mapView);
    if (flightHud.visible !== hudVisible) flightHud.show(hudVisible);
    syncMode(now);
    topBar.fit();
    if (camera.character.active && flightHud.mapView && now - localMapAt > 50) {
      flightHud.drawLocalMap();
      localMapAt = now;
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
      settings.keyHints &&
        !camera.character.active &&
        !paused &&
        !document.body.classList.contains("hide-ui") &&
        (!pil || flightHud.density < 2)
        ? phaseWatch.current
        : null,
      now,
      fleet.active === "f35" ? (camera.combat?.status === "run" ? "fight" : "plane") : null,
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
        // (the F-35's moving parts: its control surfaces as its flight controls move them, its gear, its
        // nozzle, its canopy — src/f35/pose.ts)
        if (settings.vessel === "f35") {
          const gl = camera.gearLast?.legs;
          const legs = GEARS.f35!.legs;
          const th = renderer.shipThrust;
          const L = camera.airFlight.last;
          const onGround = !!camera.gearLast && camera.gearLast.contact > 0;
          const speed = status?.speed ?? 0;
          renderer.jetPose = jetPoser.step(
            (jetIn = {
              dt,
              // (the pilot's: the roll left-positive — pilot.ts —; here right-positive)
              torque: th ? [th.torque[0], th.torque[1], -th.torque[2]] : [0, 0, 0],
              rates: ((r) => [camera.pilot.omega[0] / r[0], camera.pilot.omega[1] / r[1], -camera.pilot.omega[2] / r[2]])(
                VESSELS.f35.fbw!.rates,
              ) as [number, number, number],
              throttle: th?.throttle ?? 0,
              afterburner: (th?.boost ?? 1) > 1.01,
              alpha: L?.out.alpha ?? 0,
              flaps: camera.airFlight.cfg.flaps ?? 0,
              brake: camera.airFlight.cfg.brake ?? 0,
              gear: camera.gearExt,
              comp: legs.map((Lg, k) => Math.min(Math.max(gl?.[k]?.comp ?? 0, 0), Lg.stroke)) as [number, number, number],
              onGround,
              groundSpeed: speed,
              steer: onGround ? (th?.torque[1] ?? 0) : 0,
              parked: onGround && speed < 0.5 && (th?.throttle ?? 0) <= 0.02 && !camera.stovl.on,
              stovl: camera.stovl.conv,
              nozzle: camera.stovl.swivel,
              fan: camera.stovl.fan,
            }),
          );
          // (another player followed: his surfaces, his gear, his nozzle — ui/netsession.ts)
          if (netSession.followJet) renderer.jetPose = netSession.followJet;
        } else jetIn = null;
        // (the F-35 chosen: its display's fonts, canvas and mips readied while the browser idles — no stall at the
        // cockpit's first look)
        if (settings.vessel === "f35" && !pcdWarm) {
          pcdWarm = true;
          (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(() => {
            jetPcd.warm();
            renderer.ship.warmJetScreen(jetPcd.canvas);
          });
        }
        // (the F-35's panoramic display, seen from its seat: drawn at 10 Hz, onto the dashboard)
        if (settings.vessel === "f35" && (settings.shipMount === "cockpit" || settings.shipMount === "cabin")) {
          const t0 = performance.now();
          // (its data read every 100 ms, its parts drawn in turn — one a frame —, only those uploaded)
          const parts = jetPcd.frame(t0, () => {
            const al = alertsOf({ ...info, status, animate: settings.animate, fmtM: () => "" }).map((a) => ({
              text: a.text,
              level: a.level,
            }));
            const d = pcdData(camera, settings, renderer.jetPose, al, dateOf(sim.time));
            pcdStats.read += performance.now() - t0;
            return d;
          });
          renderer.pcdLook = jetPcd.look(t0, settings.f35PcdBrightness, settings.f35PcdStyle === "cinematic");
          // (the parts drawn gathered and sent together — one copy of their union, one pass of mips — every 66 ms at
          // most, at once after a touch: a third of the uploads, a delay no eye sees)
          pcdPending.push(...parts);
          const touched = (jetPcd.lastTouch?.at ?? -Infinity) > pcdSentAt;
          if (pcdPending.length && (touched || t0 - pcdSentAt >= 66)) {
            const t1 = performance.now();
            const x0 = Math.min(...pcdPending.map((r) => r.x)),
              y0 = Math.min(...pcdPending.map((r) => r.y));
            const x1 = Math.max(...pcdPending.map((r) => r.x + r.w)),
              y1 = Math.max(...pcdPending.map((r) => r.y + r.h));
            renderer.ship.updateJetScreen(jetPcd.canvas, [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }]);
            pcdPending.length = 0;
            pcdSentAt = t0;
            pcdStats.draws++;
            pcdStats.up += performance.now() - t1;
          }
          const dt = performance.now() - t0;
          pcdStats.frames++;
          pcdStats.ms += dt;
          pcdStats.max = Math.max(pcdStats.max, dt);
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
          gpws: gpwsOf(info, settings.groundAlerts),
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
        // (another's craft ours — a spectator's, a passenger's —: his flight, not ours to call)
        if (camera.puppet) capcom.reset();
        else
          capcomDue.push(
            ...capcom.update({
              units: settings.units,
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
        const plasmaNow = A?.inAir ? Math.min(Math.max((Math.log10(Math.max(A.heat, 1)) - 4.6) / 1.7, 0), 1) : 0;
        const soiR = status.soi ? solarBody(status.soi)?.radius : undefined;
        const scoreIn = {
          now: wall / 1000,
          mode: ph2?.mode ?? null,
          stage: ph2?.stage ?? null,
          side: status.side,
          plasma: plasmaNow,
          final: !!camera.entryRun?.app?.final,
          agl: info.surface?.alt ?? Number.POSITIVE_INFINITY,
          r: info.region === "hole" ? info.r : Number.POSITIVE_INFINITY,
          body: status.soi ?? null,
          docking: !!camera.dockAuto || (!!info.dock && !info.dock.docked && info.dock.range < 300),
          inAir: !!A?.inAir,
          airspeed: A?.inAir ? A.speed : 0,
          nearWorld: soiR !== undefined && Number.isFinite(status.altKm) && status.altKm < (7 * soiR * M_METRES) / 1e3,
        };
        const moment = score.moment(scoreIn);
        musicCue = {
          m: moment,
          context: score.context(scoreIn),
          intensity: flightIntensity({
            throttle: camera.pilot.engineNow,
            plasma: plasmaNow,
            mach: A?.inAir ? A.mach : 0,
            agl: info.surface?.alt ?? Number.POSITIVE_INFINITY,
            g: A?.inAir ? (A.g ?? 1) : 1,
            alarm: flightHud.alerts.some((a) => a.level === "warning"),
          }),
        };
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
      netSession.instruments(info, status ?? null);
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
          standing: camera.cine.shot === "pass" || camera.cine.shot === "tracking",
          thrust: renderer.shipThrust,
          gear: camera.gearLast,
          groundWind: camera.weatherNow?.wind.u10 ?? 0,
          // (the F-35's turbofan: its spool, its thrust over its full wet thrust, its afterburner, its lift fan)
          jet:
            settings.vessel === "f35"
              ? {
                  spool: camera.pilot.engineNow,
                  thrust: (camera.pilot.engineNow * camera.jetThrust()) / 1.47,
                  ab: camera.abLevel,
                  fan: camera.stovl.clutch * camera.pilot.engineNow,
                }
              : null,
          // (the rain heard where it falls — none held with the time)
          rain: renderer.rain && !renderer.rain.dust && settings.animate && !frozen && !paused ? renderer.rain.rain : 0,
        }),
      );
    } else {
      flightComputer.show(false);
      tablet.setVisible(false);
      audio.update(dt, {
        flying: false,
        live: false,
        info: null,
        status: null,
        fired: camera.pilot.fired,
        rain: renderer.rain && !renderer.rain.dust && settings.animate && !frozen && !paused ? renderer.rain.rain : 0,
      });
    }
    // (the music — audio/music.ts —: every frame, whatever is flown or not: the flight's cue when it is known,
    // walking on a world, else none — the panel's listening over it)
    if (camera.character.active) musicCue = { m: null, context: "onFoot", intensity: 0.4 };
    else if (!(settings.ship && camera.piloting && !camera.spectating)) musicCue = { m: null, context: null, intensity: 0.5 };
    music.update(musicCue.m, { context: musicCue.context, intensity: musicCue.intensity, enabled: settings.sound && settings.music });
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
  bootMark("ephemerides");
  {
    const hash = location.hash;
    const scene = new URLSearchParams(hash.slice(1)).get("scene");
    let shared: GameSave | null = null;
    try {
      shared = saveFromHash(hash);
    } catch (e) {
      panel.toast(tf("That link's saved game could not be read: {0}", (e as Error).message));
    }
    // (a shared mission — P3: #mission=…, in our worlds, briefed at once)
    let linked: MissionSpec | null = null;
    try {
      linked = missionFromHash(hash);
    } catch (e) {
      panel.toast(tf("That link's mission could not be read: {0}", (e as Error).message));
    }
    const last = autosave.get();
    // (the flight saved last loaded behind the title screen: Continue only lifts it)
    let resumed: string | null = null;
    try {
      if (shared) panel.toast(tf("Shared flight: {0}", tools.load(shared)));
      else if (linked) {
        applyPreset(scene && presets[scene] ? scene : "game:artemis");
        const spec = linked;
        void splash.gone.then(() => briefMission(spec, () => airMissions.fly(spec)));
      } else if (scene && presets[scene]) applyPreset(scene);
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
        setGameMode("photo");
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
    // (a room's link: straight into the game, the room joined)
    const joinCode = netParams.get("join");
    if (joinCode && settings.netMenu) {
      started = true;
      // (the panel shown while joining, closed once in: the keys back to the flight)
      netPanel.open();
      const role = netParams.get("role");
      void netPanel
        .join(joinCode, role === "spectator" || role === "instruments" ? role : "pilot")
        .then(() => netPanel.net?.room && netPanel.closePanel());
    } else if (!shared && !linked && !(scene && presets[scene]) && !benchPage) {
      titleScreen.open();
      bootMark("title");
      // (the intro's name glides onto the title's logo when its sequence ends, or now if it has)
      splash.dockTo = () => (titleScreen?.isOpen ? document.querySelector<HTMLElement>(".ts-logo") : null);
      splash.dock();
      void splash.played.then(() => titleScreen?.focusFirst());
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
  // (a tip changed later — a mode's tab refused, its reason in it —: the name read out follows, where it was the tip)
  new MutationObserver((ms) => {
    for (const m of ms) {
      const el = m.target as HTMLElement;
      if (el.dataset.tip && el.getAttribute("aria-label") === m.oldValue) el.setAttribute("aria-label", el.dataset.tip);
    }
  }).observe(document.body, { subtree: true, attributeFilter: ["data-tip"], attributeOldValue: true });
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
    // (in the interface's language)
    hint.replaceChildren(
      ...[
        [t("Drag"), t("to orbit")],
        [t("Wheel"), t("to zoom")],
        [t("Click"), t("a body to target it")],
      ].map(([k, what]) => h("span", {}, h("b", {}, k!), ` ${what}`)),
      h("span", {}, h("kbd", {}, "?"), ` ${t("all shortcuts")}`),
    );
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
