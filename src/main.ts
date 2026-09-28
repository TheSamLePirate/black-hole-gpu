import { Renderer, type FrameStats, type OfflineOptions } from "./renderer";
import { horizon, isco } from "./physics";
import { cameraFrame, homePosition, setHolePose, setHomePose, switchAnchor } from "./camera";
import { earthGround, earthStart, earthView, saturnDeparture } from "./system/our-side";
import { mouth, setSceneTime } from "./wormhole";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { bodyState } from "./system/ephemeris";
import { CameraController, FLIGHT_KEYS, isTyping } from "./controls";
import { BODY_NAMES, bodyLook, type Body } from "./targeting";
import { HidPads } from "./gamepad";
import { MOUNTS, type Mount } from "./mounts";
import { FlightHud } from "./ui/flighthud";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "./pilot";
import { Mission } from "./mission";
import { physicalReadouts } from "./readouts";
import { criticalCurveDirections, projectLook } from "./shadow";
import { defaultSettings, presets, QUALITY, type Settings, type Target } from "./settings";
import { SettingsPanel } from "./ui/panel";
import { SCHEMA, SCHEMA_BY_KEY } from "./ui/schema";
import { loadFromUrl } from "./urlstate";
import { setupRenderDialog } from "./renderdialog";
import { GameTools } from "./game/tools";
import { rangerStatus, type RangerStatus } from "./game/status";
import { GameToolsWindow } from "./ui/gametools";
import { applyTuning } from "./game/tuning";
import { cpuProf } from "./perf";
import { gameLog } from "./game/log";
import { autosave, saveFromHash, type GameSave } from "./game/save";
import { Splash } from "./ui/splash";
import { SceneGallery } from "./ui/scenes";
import { SoundDirector } from "./audio/director";
import { sound } from "./audio/engine";
import { VideoWriter } from "./video";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const overlay = $<HTMLCanvasElement>("overlay");
const errorEl = $("error");

const settings: Settings = sanitize({ ...defaultSettings(), ...loadFromUrl(defaultSettings()) });

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
/** Rendering / performance choices survive preset changes. */
const KEEP_ON_PRESET: (keyof Settings)[] = [
  "pixelRatio", "realtimeSubsampling", "realtimeBudget", "realtimeEps", "realtimeSteps", "qualityEps", "qualitySteps",
  "targetSpp", "denoise", "denoiseStrength", "quality", "tonemap", "hdr", "hdrPeak", "bloom", "dof", "dofAperture", "dofFocus", "lensFlare", "exposure", "animate", "timeSpeed", "bgIntensity", "starSize", "starBrightness", "skyL", "skyB", "skyRoll",
  "massSolar", "cinematicSpeed", "rotation", "cinematic", "waterRipples", "waterMirror", "waterSpeed", "waterGlow", "waterColor", "waterDensity", "waterGlowColor", "ship", "shipMount", "shipAlbedo", "shipMetal", "shipRough", "shipLight", "shipCoat",
  "turnRate", "turnAccel", "rcsFraction", "crashSpeed", "ballistic", "autosave", "autosaveEvery", "rangerStatus", "soiRings", "pathInView",
  "sound", "soundVolume", "soundBeeps", "soundEngines", "soundAmbience", "soundUi",
];

let changed = true; // scene (camera / parameters) changed since the last rendered frame
let timeDirty = false; // simulation time advanced since the last rendered frame
let displayChanged = true;
let simTime = 0;

let firstFrame = false;

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
  el.addEventListener("wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth + 1) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
    const before = el.scrollLeft;
    el.scrollLeft += e.deltaY * k;
    if (el.scrollLeft !== before) e.preventDefault();
  }, { passive: false });
}

function fail(msg: string) {
  document.getElementById("loading")?.remove();
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

async function main() {
  const splash = new Splash($("loading") ?? document.createElement("div"));
  let renderer: Renderer;
  try {
    renderer = await Renderer.create(canvas);
  } catch (e) {
    fail(`${(e as Error).message}\n\nUse a WebGPU-capable browser (Chrome/Edge 113+, Safari 26+, Firefox 141+).`);
    return;
  }

  const touch = () => (changed = true);
  renderer.onAssets = () => touch();
  const touchDisplay = () => (displayChanged = true);
  const skyLoading = renderer
    .loadSky()
    .then(() => touch())
    .catch((e) => console.warn("Real sky unavailable, using the procedural sky:", e));
  let guiDirty = false; // GUI widgets need refreshing (camera moved)
  let previousTarget = settings.target; // (the panel's target choice is applied through the camera)

  const camera = new CameraController(canvas, settings, (mode) => {
    $("btn-orbit").classList.toggle("active", mode === "orbit");
    $("btn-dive").classList.toggle("active", mode === "dive");
    $("btn-journey").classList.toggle("active", mode === "journey");
    $("btn-fly").classList.toggle("active", camera.flyMode);
    $("btn-gravity").classList.toggle("active", camera.gravity);
    syncRotationButtons();
    syncButtons();
    touch();
    guiDirty = true;
  });

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

  /** Routes a settings change to what it affects (re-trace, resolve only, resize, nothing). */
  function onSettingsChange(keys: (keyof Settings)[]) {
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
      if (!camera.selectTarget(want)) panel.toast(`${BODY_NAMES[want]} is not in this universe`);
      refreshGui();
    }
    for (const k of keys) {
      const effect = SCHEMA_BY_KEY.get(k)?.effect ?? (k === "quality" ? "none" : "scene");
      if (effect === "scene") scene = true;
      else if (effect === "display") touchDisplay();
      else if (effect === "resize") resized = true;
      if (k === "distance" || k === "whL") camera.sync();
    }
    if (keys.some((k) => k.startsWith("sound"))) audio.applyMix();
    if (scene) touch();
    if (resized) resize();
    syncButtons();
    scheduleUrlSave();
  }

  /** the scene applied last (the panel and the gallery show it) */
  let currentScene: string | null = null;
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
  const audio = new SoundDirector(settings);
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
      const L = bodyLook(settings, cam, id as Body, simTime).look;
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
    const { time, mission: withMission, pose, ...preset } = presets[name] ?? {};
    const kept = exposedForOurSide ? KEEP_ON_PRESET.filter((k) => k !== "exposure" && k !== "bgIntensity") : KEEP_ON_PRESET;
    const keep = Object.fromEntries(kept.map((k) => [k, settings[k]]));
    exposedForOurSide = pose !== undefined;
    mission.stop();
    // (a scene without the ship: the view is placed, not falling)
    if (!(preset.ship ?? settings.ship) && (camera.piloting || camera.gravity)) camera.setPilot(false);
    Object.assign(settings, defaultSettings(), keep, preset);
    camera.setOurLanded(null);
    if (typeof pose === "object") {
      // a view of the Earth: placed, the look turned towards its body
      // (the camera placed along the ship's axes — the ship's attitude is the camera's less the look —
      // then the look turned)
      const v = earthView(time ?? simTime, pose);
      settings.shipLookYaw = settings.shipLookPitch = 0;
      setHomePose(settings, v.X, v.fwd, v.up, v.vel);
      settings.motion = "geodesic";
      camera.setOurLanded(v.landed ?? null);
      void aimAt(pose.look ?? null, pose.off ?? [0, 0]);
    } else if (pose) {
      const t = time ?? simTime;
      const d = pose === "earthGround" ? earthGround(t) : pose === "earth" || pose === "earthMoon" ? earthStart(t, 400, pose === "earthMoon") : saturnDeparture(t);
      setHomePose(settings, d.X, d.fwd, d.up, d.vel);
      settings.motion = "geodesic";
      camera.setOurLanded(pose === "earthGround" ? (d as ReturnType<typeof earthGround>).landed : null);
    }
    if (time !== undefined) {
      simTime = time;
      timeDirty = true;
    }
    camera.setCinematic(null);
    camera.sync();
    if (settings.ship) camera.setPilot(true); // the Ranger starts afresh (on a circular orbit near the hole)

    if (withMission) mission.start();
    if (name === "game:artemis") {
      panel.toast("Artemis II · 400 km above the Earth, the Moon targeted. O: the planner → Free return → PLAN → EXECUTE (map M: the path)");
    }
    if (name === "game:interstellar") {
      panel.toast("2067 · Kennedy Space Center. U: take off to orbit · then Saturn — the wormhole waits 0.7 AU behind it (map M, a click: target · 0: approach)");
    }
    refreshGui();
    touch();
    touchDisplay();
    scheduleUrlSave();
  }

  // -------------------------------------------------------------------- toolbar & keys
  const toggleUi = () => document.body.classList.toggle("hide-ui");
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  const toggle = (key: "animate" | "shadowGuide" | "jet" | "cinematic" | "ship") => {
    settings[key] = !settings[key];
    refreshGui();
    if (key !== "shadowGuide") touch();
    syncButtons();
    scheduleUrlSave();
  };
  const actions: Record<string, () => void> = {
    "btn-tools": () => toolsWin.toggle(),
    "btn-scenes": () => scenes.toggle(),
    "btn-sound": () => toggleSound(),
    "btn-orbit": () => camera.setCinematic(camera.cinematic === "orbit" ? null : "orbit"),
    "btn-dive": () => camera.setCinematic(camera.cinematic === "dive" ? null : "dive"),
    "btn-fly": () => camera.setFlyMode(!camera.flyMode),
    "btn-gravity": () => {
      camera.setGravity(!camera.gravity);
      refreshGui();
      touch();
    },
    "btn-rotation": () => camera.setRotation(settings.rotation === "orbit" ? "free" : "orbit"),
    "btn-target": () => nextTarget(1),
    "btn-journey": () => {
      camera.setCinematic(camera.cinematic === "journey" ? null : "journey");
      refreshGui();
    },
    "btn-play": () => toggle("animate"),
    "btn-guide": () => toggle("shadowGuide"),
    "btn-jet": () => toggle("jet"),
    "btn-ship": () => {
      toggle("ship");
      panel.toast(settings.ship ? `Ranger: ${MOUNTS[settings.shipMount as Mount]?.label ?? ""} — ⇧K: next attach point` : "Ranger off");
    },
    "btn-cinema": () => {
      toggle("cinematic");
      if (settings.cinematic && !settings.wormhole) panel.toast("Cinematic mode: the liquid surface is on the wormhole's throat — turn the wormhole on, or pick “Cinematic: the liquid wormhole”");
      else panel.toast(settings.cinematic ? "Cinematic mode: liquid wormhole" : "Cinematic mode off");
    },
    "btn-shot": () => savePNG(),
    "btn-full": () => fullscreen(),
    "btn-hide": () => toggleUi(),
    "hud-toggle": () => setHudOpen(!$("hud").classList.contains("open")),
    "btn-help": () => panel.showShortcuts(),
    "btn-render": () => renderDialog.toggle(),
  };
  for (const [id, fn] of Object.entries(actions)) $(id).addEventListener("click", fn);
  wheelScrollsSideways($("toolbar"));
  /** Next / previous target, named in a toast (or why there is nothing else to pick). */
  function nextTarget(dir: 1 | -1) {
    const list = camera.availableTargets();
    if (list.length < 2) {
      panel.toast(`Only ${BODY_NAMES[settings.target]} here — turn on the companion star or the wormhole, or pick a scene`);
      return;
    }
    camera.cycleTarget(dir);
    camera.pad.rumble(0.1, 0.3, 50);
    panel.toast(`Target: ${BODY_NAMES[settings.target]}  (${list.indexOf(settings.target) + 1} / ${list.length})`);
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
  function syncRotationButtons() {
    const orbit = settings.rotation === "orbit";
    const btn = $("btn-rotation");
    btn.classList.toggle("free", !orbit);
    btn.querySelector("span")!.textContent = orbit ? "Around" : "Free";
    btn.dataset.tip = orbit
      ? "Rotation around the target — drag orbits it (switch to free)"
      : "Free rotation — drag looks around, right-drag rolls (switch to around the target)";
    const tb = $("btn-target");
    tb.querySelector("span")!.textContent = BODY_NAMES[settings.target];
    tb.dataset.body = settings.target;
    previousTarget = settings.target;
  }
  function syncButtons() {
    $("btn-play").classList.toggle("active", settings.animate);
    $("btn-guide").classList.toggle("active", settings.shadowGuide);
    $("btn-jet").classList.toggle("active", settings.jet);
    $("btn-cinema").classList.toggle("active", settings.cinematic);
    $("btn-ship").classList.toggle("active", settings.ship);
    $("btn-sound").classList.toggle("muted", !settings.sound);
  }
  syncButtons();
  syncRotationButtons();

  // -------------------------------------------------------------------- game controller
  // -------------------------------------------------------------------- piloting the Ranger
  // beyond 500 M/s: "rails" (engine off; the controller brings it down near bodies)
  const WARPS = [0.25, 0.5, 1, 2, 3, 6, 12, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  function warp(dir: 1 | -1) {
    // (below the classic warps: real time and its first multiples — a climb, a landing)
    const rt = 1 / (4.925490947e-6 * settings.massSolar);
    const list = [...[1, 2, 5, 10, 25, 50].map((k) => k * rt).filter((w) => w < 0.9 * WARPS[0]!), ...WARPS];
    const i = list.findIndex((w) => w >= settings.timeSpeed * (1 - 1e-6));
    const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? list.length - 1 : i) + dir));
    if (list[j] !== settings.timeSpeed) audio.cue(dir > 0 ? "warp-up" : "warp-down", j);
    else audio.cue("error");
    settings.timeSpeed = list[j]!;
    if (!settings.animate) toggle("animate");
    refreshGui();
    const x = settings.timeSpeed / rt;
    panel.toast(`Time warp: ×${x < 100 ? Math.round(x) : x.toPrecision(3)} (${+settings.timeSpeed.toPrecision(3)} M/s)`);
  }
  function toggleSound() {
    settings.sound = !settings.sound;
    audio.applyMix();
    refreshGui();
    panel.toast(settings.sound ? "Sound on" : "Sound off");
  }
  function togglePathInView() {
    settings.pathInView = !settings.pathInView;
    refreshGui();
    touch();
    panel.toast(settings.pathInView ? "Future path shown in the view [Y]" : "Future path hidden in the view (the map keeps it) [Y]");
  }
  function pilotHold(h: Hold) {
    camera.pilot.setHold(h);
    panel.toast(camera.pilot.hold === "none" ? "Attitude hold off" : `Hold: ${HOLD_NAMES[h]}`);
  }
  function pilotAuto(a: Auto) {
    camera.pilot.setAuto(a);
    panel.toast(camera.pilot.auto === "none" ? "Autopilot off" : `Autopilot: ${AUTO_NAMES[a]}`);
  }
  function pilotSas() {
    camera.pilot.sas = !camera.pilot.sas;
    panel.toast(`SAS ${camera.pilot.sas ? "on" : "off"}`);
  }
  function pilotRoll() {
    camera.pilot.rollAlign = !camera.pilot.rollAlign;
    panel.toast(`Roll alignment ${camera.pilot.rollAlign ? "on — wings in the orbital plane" : "off"}`);
  }
  function setMount(m: Mount) {
    if (settings.shipMount === m) return;
    settings.shipMount = m;
    refreshGui();
    scheduleUrlSave();
    panel.toast(`Camera: ${MOUNTS[m].label}`);
  }
  const flightHud = new FlightHud(settings, {
    hold: pilotHold, auto: pilotAuto, sas: pilotSas, warp, mount: setMount, roll: pilotRoll, sound: () => toggleSound(),
    addNodeAt: (t) => {
      camera.addNode(Math.max(t - simTime, 1e-3));
      touch();
    },
    speedMode: () => {
      camera.speedMode = camera.speedMode === "orbit" ? "target" : "orbit";
      panel.toast(camera.speedMode === "target" ? `Speed relative to ${BODY_NAMES[settings.target]}` : "Speed in orbit");
    },
    select: (b) => {
      if (camera.selectTarget(b as Target, { focus: false })) panel.toast(`Target: ${BODY_NAMES[settings.target]}`);
    },
    lookAhead: () => camera.setLook(0, 0),
    throttle: (t) => {
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto); // taking the throttle ends the autopilot
      camera.pilot.throttle = t;
    },
    plan: (goal, r2, orbitStar) => panel.toast(camera.planTransfer(goal, r2, { orbitStar })),
    planOur: (kind, arrival, altKm, retKm) => {
      panel.toast("Planning… (aiming the n-body paths)");
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
  camera.onPilotMessage = (t) => {
    panel.toast(t);
    gameLog.add(/crash/i.test(t) ? "warn" : "pilot", t, simTime);
  };
  // the automatic Interstellar mission (a preset starts it; Esc hands the controls back)
  let hudDensity: number | null = null;
  const mission = new Mission(settings, camera, (t) => panel.toast(t));
  mission.onEnd = () => {
    if (hudDensity !== null) flightHud.setDensity(hudDensity);
    hudDensity = null;
  };
  mission.onStart = () => {
    hudDensity = flightHud.density;
    flightHud.setDensity(2); // clean: the view, the captions, the warnings
  };
  const flying = () => camera.piloting && !camera.cinematic && !renderer.offlineActive;
  panel.flightKeys = (e) => flying() && (e.code === "Slash" || e.key === "/" || ((e.key === "m" || e.key === "M") && !e.shiftKey));
  /** Pilot keys (by physical position where it matters); true when handled. */
  function pilotKey(e: KeyboardEvent) {
    const holds: Record<string, Hold> = { Digit1: "prograde", Digit2: "retrograde", Digit3: "radialOut", Digit4: "radialIn", Digit5: "normal", Digit6: "antinormal", Digit7: "target" };
    const autos: Record<string, Auto> = { Digit8: "hover", Digit9: "circularize", Digit0: "approach", KeyG: "land", KeyU: "takeoff" };
    // (held flight keys: translation, throttle — read each frame by the controller)
    if (["KeyI", "KeyJ", "KeyK", "KeyL", "KeyH", "KeyN", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"].includes(e.code) && !(e.code === "KeyK" && e.shiftKey)) {
      e.preventDefault();
      return true;
    }
    if (holds[e.code]) pilotHold(holds[e.code]!);
    else if (autos[e.code]) pilotAuto(autos[e.code]!);
    else if (e.code === "KeyT") pilotSas();
    else if (e.code === "KeyR") pilotRoll();
    else if (e.code === "KeyY") togglePathInView();
    else if (e.code === "KeyZ") camera.pilot.throttle = 1;
    else if (e.code === "KeyX") camera.pilot.throttle = 0;
    else if (e.code === "CapsLock") {
      camera.pilot.precision = !camera.pilot.precision;
      panel.toast(camera.pilot.precision ? "Precision controls" : "Normal controls");
    } else if (e.code === "Backquote") panel.toast(flightHud.cycleDensity());
    else if (e.code === "KeyK" && e.shiftKey) actions["btn-ship"]!(); // leave the Ranger
    else if (e.key.toLowerCase() === "m" && !e.shiftKey) flightHud.toggleMapView();
    else if (e.code === "Slash") {
      // back to real time (1 s = 1 s)
      settings.timeSpeed = 1 / (4.925490947e-6 * settings.massSolar);
      settings.animate = true;
      panel.toast("Real time");
    } else if (e.code === "KeyO") flightHud.togglePlanner();
    else if (e.code === "KeyV") {
      const keys = Object.keys(MOUNTS) as Mount[];
      const i = keys.indexOf(settings.shipMount as Mount);
      setMount(keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]!);
    } else if (e.code === "Comma") warp(-1);
    else if (e.code === "Period") warp(1);
    else if (e.code === "Escape") {
      mission.stop("Mission stopped — you have the controls");
      camera.pilot.hold = "none";
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto);
    } else if (e.key.toLowerCase() === "b") panel.toast("Gravity is always on in the Ranger (Shift+K leaves it)");
    else if (e.code === "ArrowUp" || e.code === "ArrowDown") e.preventDefault(); // throttle (held)
    else return false;
    e.preventDefault();
    return true;
  }

  camera.onPadAction = (a) => {
    if (renderer.offlineActive) return;
    if (flying()) {
      // in the Ranger: A SAS, B cut the engine, X prograde, Y retrograde, R3 look ahead
      const pa: Partial<Record<typeof a, () => void>> = {
        focus: pilotSas, gravity: () => (camera.pilot.throttle = 0), auto: () => pilotHold("prograde"), rotation: () => pilotHold("retrograde"),
        recentre: () => camera.setLook(0, 0),
        dpadUp: () => setMount((Object.keys(MOUNTS) as Mount[])[((Object.keys(MOUNTS) as Mount[]).indexOf(settings.shipMount as Mount) + 1) % 6]!),
        dpadDown: () => setMount((Object.keys(MOUNTS) as Mount[])[((Object.keys(MOUNTS) as Mount[]).indexOf(settings.shipMount as Mount) + 5) % 6]!),
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
        if (settings.rotation !== "orbit") camera.setRotation("orbit");
        camera.selectTarget(settings.target, { frame: !camera.gravity });
        break;
      case "gravity":
        actions["btn-gravity"]!();
        break;
      case "auto":
        actions["btn-orbit"]!();
        break;
      case "rotation":
        actions["btn-rotation"]!();
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
        actions["btn-play"]!();
        break;
      case "settings":
        panel.toggle();
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
        const id = camera.pad.list()[0]?.id.replace(/\s*\(.*\)\s*$/, "") || "gamepad";
        panel.toast(`Controller connected — ${id} · ? for the buttons`);
        camera.pad.rumble(0.2, 0.4, 120);
      } else panel.toast("Controller disconnected");
      touch();
    }, 900);
  };
  addEventListener("gamepadconnected", padChanged);
  addEventListener("gamepaddisconnected", padChanged);
  camera.pad.hid.onChange = padChanged;
  async function connectController() {
    try {
      if (!(await camera.pad.hid.request())) panel.toast("No controller chosen");
    } catch (e) {
      panel.toast(`Could not open the controller: ${(e as Error).message}`);
    }
  }

  addEventListener("keydown", (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    if (e.code === "F2") {
      e.preventDefault();
      toolsWin.toggle();
      return;
    }
    if (flying() && pilotKey(e)) return;
    if (e.code in FLIGHT_KEYS) return; // flight keys fly, nothing else
    const k = e.key.toLowerCase();
    if (e.code === "Space") {
      e.preventDefault();
      toggle("animate");
    } else if (k === "h") toggleUi();
    else if (k === "r") {
      if (e.shiftKey) camera.resetView();
      else actions["btn-rotation"]!();
      touch();
    } else if (e.key === "Tab") {
      e.preventDefault();
      nextTarget(e.shiftKey ? -1 : 1);
    } else if (k === "p") savePNG();
    else if (k === "f") fullscreen();
    else if (k === "o") actions["btn-orbit"]!();
    else if (k === "c") actions["btn-dive"]!();
    else if (k === "t") actions["btn-journey"]!();
    else if (k === "v") actions["btn-fly"]!();
    else if (k === "b") actions["btn-gravity"]!();
    else if (k === "g") toggle("shadowGuide");
    else if (k === "j") toggle("jet");
    else if (k === "l") actions["btn-cinema"]!();
    else if (k === "k") {
      if (e.shiftKey) nextMount();
      else actions["btn-ship"]!();
    }
    else if (k === "i") actions["hud-toggle"]!();
    else if (e.key === "?") actions["btn-help"]!();
    else if (e.key === "Escape") camera.setCinematic(null);
    else if (/^[1-6]$/.test(e.key)) {
      settings.quality = (["low", "medium", "high", "ultra", "realtime", "game"] as const)[Number(k) - 1]!;
      Object.assign(settings, QUALITY[settings.quality]);
      refreshGui();
      resize();
      touch();
    }
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
    settings,
    time: () => simTime,
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
  // the frame budget with the subsampling already coarse, raised back when it has room
  let renderScale = 1;
  let gpuEma = 0;
  let scaleTimer = 0;
  function resize() {
    const dpr = settings.pixelRatio * renderScale;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const odpr = devicePixelRatio;
    overlay.width = Math.round(canvas.clientWidth * odpr);
    overlay.height = Math.round(canvas.clientHeight * odpr);
    renderer.resize(w, h);
    touch();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // debug / automation handle (devtools): __bh.settings.spin = 0.5; __bh.touch()
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
    const t0 = performance.now();
    renderer.startOffline(settings, o.time ?? simTime, {
      width: 1920, height: 1080, spp: 128, tolerance: 1e-6, eps: 0.02, maxSteps: 12000, noiseThreshold: 0.004,
      minSpp: 16, shutter: 0, budgetMs: 250, ...o,
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
      width: 1920, height: 1080, spp: 24, tolerance: 1e-5, eps: 0.03, maxSteps: 6000, noiseThreshold: 0.01,
      minSpp: 8, shutter: 0, budgetMs: 250, ...off,
    };
    opts.width &= ~1;
    opts.height &= ~1;
    const cfg = await VideoWriter.supported(opts.width, opts.height, fps);
    if (!cfg) return (videoState.result = `H.264 at ${opts.width}×${opts.height} not supported`);
    const writer = new VideoWriter(cfg, fps);
    renderer.cancelOffline();
    const t0 = simTime;
    Object.assign(videoState, { frame: 0, frames: Math.round(seconds * fps), started: performance.now(), done: false, result: "" });
    const n = videoState.frames;
    for (let i = 0; i < n; i++) {
      if (path) Object.assign(settings, path(n > 1 ? i / (n - 1) : 0));
      renderer.startOffline(settings, t0 + (i / fps) * rate, opts);
      while (!renderer.offlineState?.done) {
        await new Promise((r) => setTimeout(r, 20));
        if (!renderer.offlineActive) return (videoState.result = "cancelled");
      }
      const px = await renderer.exportRGBA(settings);
      await writer.addFrame(px.data, px.width, px.height);
      videoState.frame = i + 1;
    }
    await fetch(`/__snapshot?name=${encodeURIComponent(name)}.mp4`, { method: "POST", body: await writer.finish() });
    renderer.cancelOffline();
    videoState.done = true;
    return (videoState.result = `${name}.mp4: ${videoState.frames} frames in ${((performance.now() - videoState.started) / 1000).toFixed(0)} s`);
  };
  // -------------------------------------------------------------------- the game's tools (F2, __bh.game)
  const tools = new GameTools({
    settings, camera, renderer,
    time: () => simTime,
    setTime: (t) => {
      simTime = t;
      timeDirty = true;
      setSceneTime(t);
    },
    preset: (name) => applyPreset(name),
    changed: (keys) => onSettingsChange(keys),
    refresh: () => {
      refreshGui();
      touch();
      touchDisplay();
      timeDirty = true;
    },
    toast: (t) => panel.toast(t),
    fps: () => fps,
    renderScale: () => renderScale,
    scene: { get: () => currentScene, set: (n) => (currentScene = n && presets[n] ? n : null) },
  });
  const toolsWin = new GameToolsWindow(tools);
  addEventListener("pagehide", (e) => {
    if (settings.autosave && firstFrame) tools.autosaveNow();
    // (the GPU's memory — the Earth's maps are hundreds of MB — freed now, not when the old page is
    // collected: reloads in a row would stack them)
    if (!(e as PageTransitionEvent).persisted) renderer.release();
  });

  Object.assign(globalThis, {
    __bh: {
      /** the game's tools: __bh.game.help() */
      game: tools,
      settings, renderer, camera, touch, snapshot, render, video, videoState, resize, preset: applyPreset, refresh: refreshGui, skyLoading,
      /** the sound: __bh.sound.play("sas-on"), __bh.sound.ctx */
      sound, audio,
      /** the built-in scenes' names (for __bh.preset) */
      scenes: () => Object.keys(presets),
      /** the scene gallery's pictures: each scene applied, left to converge, cropped to 16:9, 640 × 360,
       *  posted to snapshots/scene-<slug>.webp (then: bun scripts/scene-thumbs.ts) */
      captureScenes: async (names = Object.keys(presets), maxMs = 14000) => {
        const slug = (n: string) => n.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const pixelRatio = settings.pixelRatio;
        for (const name of names) {
          // (from the defaults, as a first visit would show it: no ship or exposure carried over)
          Object.assign(settings, defaultSettings(), QUALITY.high, { quality: "high", pixelRatio });
          applyPreset(name);
          // (still scenes are frozen and left to converge; flights and missions get a while)
          const moving = !!presets[name]!.ship || !!presets[name]!.mission;
          if (!moving) settings.animate = false;
          touch();
          const t0 = performance.now();
          await wait(2500);
          while (performance.now() - t0 < (moving ? 9000 : maxMs) && !(lastStats?.phase === "converged" && !moving)) await wait(250);
          const img = await createImageBitmap(await renderer.exportPNG(settings));
          const W = 640, H = 360;
          const sw = Math.min(img.width, (img.height * W) / H), sh = (sw * H) / W;
          const cv = new OffscreenCanvas(W, H);
          const ctx = cv.getContext("2d")!;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
          const out = await cv.convertToBlob({ type: "image/webp", quality: 0.82 });
          await fetch(`/__snapshot?name=scene-${slug(name)}.webp`, { method: "POST", body: out });
        }
        return names.length;
      },
      time: () => simTime,
      mission,
      /** a system's bodies (ephemeris) and camera placement, for automation */
      sys: {
        bodyState: (id: string, t: number) => bodyState(GARGANTUA_SYSTEM, id, t), setHolePose, mouth: (t?: number) => mouth(settings, t),
        /** our universe (home frame, our mouth at the origin) */
        setHomePose: (X: [number, number, number], fwd: [number, number, number], up?: [number, number, number], vel?: [number, number, number]) => setHomePose(settings, X, fwd, up, vel),
        homePosition: () => homePosition(settings),
        /** where the camera sees a body (CPU geodesics, retarded, aberrated): a look direction */
        look: (id: string) => bodyLook(settings, cameraFrame(settings), id as Body, simTime).look,
      },
      /** Freezes the loop's own simulation; step(dt) then advances it (camera, mission, time) by dt. */
      freeze: (on: boolean) => (frozen = on),
      step: (dt: number) => {
        setSceneTime(simTime);
        camera.update(dt, simTime);
        mission.update(dt);
        if (settings.animate && settings.timeSpeed > 0) simTime = camera.shipClock() ?? simTime + dt * settings.timeSpeed;
        timeDirty = true;
        changed = true;
        return simTime;
      },
      setTime: (t: number) => ((simTime = t), (timeDirty = true)),
    },
  });

  // -------------------------------------------------------------------- loop
  let last = performance.now();
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  let hudTimer = 0;
  let frozen = false;
  let lastStats: FrameStats | null = null;
  let guideKey = "";
  let saveTimer = 0;

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    cpuProf.begin();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fpsAcc += dt;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    // (frozen: an automation steps the simulation itself, frame by frame — see __bh.step)
    if (!frozen) {
      setSceneTime(simTime); // (an orbiting wormhole mouth: where it is now)
      if (cpuProf.time("flight (camera.update)", () => camera.update(dt, simTime))) {
        changed = true;
        guiDirty = true;
      }
      cpuProf.time("mission", () => mission.update(dt));
      if (settings.animate && settings.timeSpeed > 0 && !renderer.offlineActive) {
        simTime = camera.shipClock() ?? simTime + dt * settings.timeSpeed;
        timeDirty = true;
      }
    }
    // the liquid throat's waves run on their own clock (they move even with the scene's time paused)
    if (settings.cinematic && settings.wormhole && settings.waterSpeed > 0 && !renderer.offlineActive) {
      renderer.water.clock += dt * settings.waterSpeed;
      timeDirty = true;
    }
    // the camera's predicted free fall, drawn (lensed) by the tracer
    const path = camera.gravity ? cpuProf.time("free-fall prediction", () => camera.predictPath()) : null;
    if (renderer.setCameraPath(settings.showGeodesic && settings.pathInView ? path : null)) changed = true;
    const st = cpuProf.time("render (encode, submit)", () => renderer.frame(settings, simTime, changed, timeDirty, displayChanged));
    if (st) {
      if (!firstFrame) {
        // the first image is on screen: the loading screen lifts once the scene's assets are in
        firstFrame = true;
        splash.firstImage();
      }
      fpsN++;
      changed = false;
      timeDirty = false;
      displayChanged = false;
      lastStats = st;
      if (st.offline) renderDialog.update(st.offline);
      gpuEma = gpuEma ? 0.9 * gpuEma + 0.1 * renderer.lastGpuMs : renderer.lastGpuMs;
    }
    // (every 1.5 s, by eighths, between half the pixel ratio and all of it)
    scaleTimer += dt;
    if (scaleTimer > 1.5) {
      scaleTimer = 0;
      const on = settings.dynamicResolution && settings.realtimeSubsampling === "auto" && !renderer.offlineActive;
      const block = renderer.realtimeBlockNow;
      let want = renderScale;
      if (!on) want = 1;
      else if (gpuEma > 1.2 * settings.realtimeBudget && block >= 4) want = Math.max(0.5, renderScale - 0.125);
      else if (gpuEma < 0.65 * settings.realtimeBudget && block <= 2) want = Math.min(1, renderScale + 0.125);
      if (want !== renderScale) {
        renderScale = want;
        resize();
      }
    }
    cpuProf.time("overlay (guide, marker)", drawGuide);
    applyTuning(settings);
    cpuProf.time("game tools window", () => toolsWin.tick());
    saveTimer += dt;
    if (settings.autosave && firstFrame && !renderer.offlineActive && (saveTimer > settings.autosaveEvery || (saveSoon && saveTimer > 2))) {
      saveTimer = 0;
      saveSoon = false;
      cpuProf.time("autosave", () => tools.autosaveNow());
    }
    renderer.shipPose = settings.ship ? camera.shipPose() : null;
    const pil = flying();
    if (flightHud.visible !== pil) flightHud.show(pil);
    if (pil) {
      const info = cpuProf.time("flight figures (flightInfo)", () => camera.flightInfo());
      // (re-entry glow on the Ranger)
      const pl = info.surface?.plasma;
      renderer.shipPlasma = pl && pl.level > 0 ? [...pl.flow, pl.level] : [0, 0, 1, 0];
      // the thrusters' flames (what the flight computer fired on its last step)
      const fired = camera.pilot.fired;
      const firing = performance.now() - fired.at < 300 && (fired.throttle > 0.01 || fired.rcs > 0.03 || fired.turn > 0.05);
      const was = renderer.shipThrust !== null;
      renderer.shipThrust = firing
        ? { throttle: fired.throttle, force: fired.force, torque: fired.torque, air: Math.min((info.surface?.air ?? 0) / 1.225, 1), time: performance.now() / 1000 }
        : null;
      if (firing || was) changed = true;
      // the Ranger's status (the telemetry; its changes go to the journal)
      let status: RangerStatus | null = null;
      try {
        status = cpuProf.time("Ranger status", () => rangerStatus(settings, camera, info, simTime));
        tools.watch(status);
      } catch {
        /* (between two frames of a jump) */
      }
      cpuProf.time("flight HUD (total)", () => flightHud.update({ ...info, probe: renderer.planetProbes.get(settings.target) ?? null, status }, simTime));
      cpuProf.time("sound", () => audio.update(dt, { flying: true, live: settings.animate && !frozen, info, status, fired: camera.pilot.fired }));
    } else {
      renderer.shipThrust = null;
      audio.update(dt, { flying: false, live: false, info: null, status: null, fired: camera.pilot.fired });
    }
    hudTimer += dt;
    if (hudTimer > 0.15 && lastStats) {
      hudTimer = 0;
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
  // flight saved last time; then the URL is left clean (settings from an old link were read above)
  {
    const hash = location.hash;
    const scene = new URLSearchParams(hash.slice(1)).get("scene");
    let shared: GameSave | null = null;
    try {
      shared = saveFromHash(hash);
    } catch (e) {
      panel.toast(`That link's saved game could not be read: ${(e as Error).message}`);
    }
    const last = autosave.get();
    try {
      if (shared) panel.toast(`Shared flight: ${tools.load(shared)}`);
      else if (scene && presets[scene]) applyPreset(scene);
      else if (hash.length <= 1 && last && last.settings.autosave !== false) panel.toast(`Resumed: ${tools.load(last)} (F2: saves)`);
    } catch (e) {
      console.warn("Could not restore the saved game:", e);
    }
    if (hash.length > 1) history.replaceState(null, "", location.pathname + location.search);
  }
  requestAnimationFrame(loop);

  // -------------------------------------------------------------------- overlays
  function drawGuide() {
    const cam = cameraFrame(settings);
    const guide = settings.shadowGuide && cam.region === "hole";
    const marker = targetMarker();
    const hover = camera.hover;
    const key = guide || camera.flyMode || marker || hover
      ? [settings.spin, cam.r, cam.theta, cam.phi, settings.yaw, settings.pitch, settings.roll, settings.fov, cam.speed, overlay.width, overlay.height, camera.flyMode, marker?.key, hover?.body, hover?.x, hover?.y].join()
      : "off";
    if (key === guideKey) return;
    guideKey = key;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (key === "off") return;
    if (camera.flyMode) drawCrosshair(ctx);
    if (marker) drawMarker(ctx, marker);
    if (hover && hover.body !== marker?.body) drawHover(ctx, hover);
    if (!guide) return;
    const tanH = Math.tan((settings.fov * Math.PI) / 360);
    const aspect = overlay.width / overlay.height;
    const W = overlay.width;
    const H = overlay.height;
    ctx.lineWidth = Math.max(1.2, devicePixelRatio * 1.1);
    ctx.strokeStyle = "rgba(90, 255, 160, 0.9)";
    ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
    for (const line of criticalCurveDirections(cam, settings.spin)) {
      ctx.beginPath();
      let pen = false;
      for (const d of line) {
        const p = projectLook(cam, d, tanH, aspect);
        if (!p) {
          pen = false;
          continue;
        }
        const x = ((p[0] + 1) / 2) * W;
        const y = ((1 - p[1]) / 2) * H;
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(90, 255, 160, 0.9)";
    ctx.font = `${11 * devicePixelRatio}px ui-monospace, Menlo, monospace`;
    ctx.fillText("critical curve (analytic)", 16 * devicePixelRatio, H - 16 * devicePixelRatio);
  }

  // ------------------------------------------------------------------ target marker
  const BODY_COLOURS: Record<Target, string> = {
    hole: "255, 179, 92", star: "255, 217, 138", wormhole: "159, 184, 255", barycentre: "235, 240, 255",
    miller: "140, 210, 220", mann: "220, 232, 245", k2: "255, 190, 120", edmunds: "220, 170, 120",
    sun: "255, 236, 170", mercury: "190, 180, 170", venus: "240, 220, 170", earth: "120, 180, 255", moon: "210, 210, 210",
    mars: "240, 130, 90", phobos: "170, 150, 130", deimos: "170, 150, 130", ceres: "180, 180, 180", jupiter: "230, 200, 160",
    io: "240, 220, 120", europa: "220, 210, 190", ganymede: "190, 180, 170", callisto: "160, 150, 140", saturn: "235, 215, 160",
    mimas: "210, 210, 210", enceladus: "240, 245, 255", tethys: "220, 220, 220", dione: "210, 210, 210", rhea: "210, 210, 210",
    titan: "235, 170, 90", iapetus: "200, 190, 170", uranus: "160, 220, 230", neptune: "110, 150, 255", triton: "220, 210, 220",
    pluto: "220, 190, 160", charon: "190, 190, 190",
  };
  /**
   * The target's marker: corner brackets around its apparent image (lensed and light-delayed), or an
   * arrow at the edge of the view when it is off-screen. Shown while the camera is handled, then fades.
   */
  function targetMarker() {
    if (renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const idle = (performance.now() - camera.activity) / 1000;
    const alpha = idle < 1.6 ? 1 : Math.max(0, 1 - (idle - 1.6) / 0.8);
    if (alpha <= 0) return null;
    const info = camera.targetInfo();
    if (!info) return null;
    const W = overlay.width;
    const H = overlay.height;
    const tanH = Math.tan((settings.fov * Math.PI) / 360);
    const { cam, look } = info;
    const f = look[0] * cam.fwd[0] + look[1] * cam.fwd[1] + look[2] * cam.fwd[2];
    const x = look[0] * cam.right[0] + look[1] * cam.right[1] + look[2] * cam.right[2];
    const y = look[0] * cam.up[0] + look[1] * cam.up[1] + look[2] * cam.up[2];
    let px = NaN;
    let py = NaN;
    let onScreen = false;
    if (f > 1e-3) {
      px = ((x / f / (tanH * (W / H)) + 1) / 2) * W;
      py = ((1 - y / f / tanH) / 2) * H;
      onScreen = px > 0 && px < W && py > 0 && py < H;
    }
    const radius = Math.max(14 * devicePixelRatio, (Math.tan(info.ang) / tanH) * (H / 2) * 1.25);
    const riding = info.body === "star" ? camera.riding : 0;
    const label = `${settings.rotation === "orbit" ? "↻ " : ""}${info.name.toUpperCase()} · ${info.dist < 1e4 ? info.dist.toFixed(info.dist < 10 ? 2 : 1) : "∞"} M${riding > 0.5 ? " · co-moving" : ""}`;
    const dir = Math.atan2(-y, x); // screen direction of the target (off-screen arrow)
    return {
      body: info.body, px, py, radius, onScreen, dir, alpha, label,
      key: [info.body, px.toFixed(1), py.toFixed(1), radius.toFixed(1), onScreen, dir.toFixed(3), alpha.toFixed(2), label].join(),
    };
  }

  function drawMarker(ctx: CanvasRenderingContext2D, m: NonNullable<ReturnType<typeof targetMarker>>) {
    const k = devicePixelRatio;
    const c = BODY_COLOURS[m.body];
    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.strokeStyle = `rgba(${c}, 0.9)`;
    ctx.fillStyle = `rgba(${c}, 0.95)`;
    ctx.lineWidth = 1.4 * k;
    ctx.font = `600 ${10.5 * k}px ui-sans-serif, system-ui, sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4 * k;
    if (m.onScreen && m.body === "barycentre") {
      // a point: ⊕
      const r = 9 * k;
      ctx.beginPath();
      ctx.arc(m.px, m.py, r, 0, 2 * Math.PI);
      ctx.moveTo(m.px - 1.6 * r, m.py);
      ctx.lineTo(m.px + 1.6 * r, m.py);
      ctx.moveTo(m.px, m.py - 1.6 * r);
      ctx.lineTo(m.px, m.py + 1.6 * r);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(m.label, m.px, Math.min(m.py + 2.4 * r + 8 * k, overlay.height - 8 * k));
    } else if (m.onScreen) {
      const r = m.radius;
      const l = Math.min(r * 0.45, 12 * k);
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(m.px + sx * r, m.py + sy * (r - l));
        ctx.lineTo(m.px + sx * r, m.py + sy * r);
        ctx.lineTo(m.px + sx * (r - l), m.py + sy * r);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m.px, m.py, 1.6 * k, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillText(m.label, m.px, Math.min(m.py + r + 15 * k, overlay.height - 8 * k));
    } else {
      // arrow on an ellipse inset from the edges, pointing at the target
      const W = overlay.width;
      const H = overlay.height;
      const ax = W / 2 + Math.cos(m.dir) * (W / 2 - 36 * k);
      const ay = H / 2 + Math.sin(m.dir) * (H / 2 - 36 * k);
      ctx.translate(ax, ay);
      ctx.rotate(m.dir);
      ctx.beginPath();
      ctx.moveTo(12 * k, 0);
      ctx.lineTo(-6 * k, -8 * k);
      ctx.lineTo(-2 * k, 0);
      ctx.lineTo(-6 * k, 8 * k);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-m.dir);
      ctx.textAlign = Math.cos(m.dir) > 0.3 ? "right" : Math.cos(m.dir) < -0.3 ? "left" : "center";
      const tx = Math.cos(m.dir) > 0.3 ? -16 * k : Math.cos(m.dir) < -0.3 ? 16 * k : 0;
      const ty = Math.sin(m.dir) > 0.3 ? -16 * k : 20 * k;
      ctx.fillText(m.label, tx, ty);
    }
    ctx.restore();
  }

  /** Name of the body under the pointer (click: select, double-click: fly to it). */
  function drawHover(ctx: CanvasRenderingContext2D, h: NonNullable<typeof camera.hover>) {
    const k = devicePixelRatio;
    const c = BODY_COLOURS[h.body];
    ctx.save();
    ctx.font = `600 ${10.5 * k}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = `rgba(${c}, 0.95)`;
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 4 * k;
    ctx.textAlign = "left";
    const hint = h.body === settings.target ? "double-click: fly to" : "click: target";
    ctx.fillText(`${BODY_NAMES[h.body]}`, (h.x + 14) * k, (h.y + 22) * k);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `${9.5 * k}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(hint, (h.x + 14) * k, (h.y + 35) * k);
    ctx.restore();
  }

  /** Camera position for the HUD: distance to the hole, or ℓ through the wormhole. */
  function where() {
    if (!settings.wormhole || settings.anchor === "hole") return `r = ${settings.distance.toFixed(2)} M`;
    const side = settings.whL < 0 ? "our side" : "Gargantua side";
    return `ℓ = ${settings.whL.toFixed(2)} M (${side})`;
  }

  function drawCrosshair(ctx: CanvasRenderingContext2D) {
    const x = overlay.width / 2;
    const y = overlay.height / 2;
    const k = devicePixelRatio;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx! * 5 * k, y + dy! * 5 * k);
      ctx.lineTo(x + dx! * 12 * k, y + dy! * 12 * k);
    }
    ctx.stroke();
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
    try {
      localStorage.setItem(HUD_KEY, open ? "1" : "0");
    } catch {
      // private mode: not remembered
    }
    if (open && lastStats) updateHUD(lastStats, fps);
  }
  try {
    if (localStorage.getItem(HUD_KEY) === "1") setHudOpen(true);
  } catch {
    // storage unavailable
  }

  /** Compact status (phase, what the camera does) and, unfolded, the details and readouts. */
  function updateHUD(st: FrameStats, fpsNow: number) {
    let phase: string;
    let progress = 0;
    if (st.phase === "offline" && st.offline) {
      phase = `<span class="phase cv">Rendering ${(st.offline.progress * 100).toFixed(0)} %</span>`;
      progress = st.offline.progress;
    } else if (st.phase === "realtime") {
      phase = `<span class="phase rt">Live · ${fpsNow.toFixed(0)} fps</span>`;
    } else if (st.phase === "converging") {
      phase = `<span class="phase cv">Refining · ${Math.floor(st.spp)} / ${settings.targetSpp}</span>`;
      progress = st.spp / settings.targetSpp;
    } else {
      phase = `<span class="phase ok">Converged</span>`;
      progress = 1;
    }
    const chips: string[] = [];
    if (camera.cinematic) chips.push(`<span class="chip hot">${camera.cinematic === "orbit" ? "Auto-orbit" : camera.cinematic === "dive" ? "Dive" : "Journey"}</span>`);
    if (camera.flyMode) chips.push(`<span class="chip hot">Fly ×${camera.flySpeed.toFixed(1)}</span>`);
    else chips.push(`<span class="chip">${settings.rotation === "orbit" ? `↻ ${BODY_NAMES[settings.target]}` : "Free look"}</span>`);
    if (camera.gravity) chips.push(`<span class="chip hot">${camera.landed ? "On the star" : "Gravity"}</span>`);
    if (camera.pad.connected) chips.push(`<span class="chip" title="Game controller">🎮</span>`);
    statusEl.innerHTML = phase + chips.join("");
    progressEl.firstElementChild!.setAttribute("style", `width:${(Math.min(progress, 1) * 100).toFixed(1)}%`);
    progressEl.classList.toggle("done", progress >= 1 && st.phase !== "offline");

    if (!$("hud").classList.contains("open")) return;
    const lines = [
      `<b>${st.width}×${st.height}</b>${renderer.hdr ? " · HDR" : ""} · gpu ${st.gpuMs.toFixed(1)} ms · ` +
        (st.phase === "realtime" ? `1 ray / ${st.block}×${st.block} px` : `${st.spp.toFixed(1)} spp`),
      `${where()} · θ = ${settings.inclination.toFixed(1)}° · t = ${simTime.toFixed(0)} M${settings.animate ? "" : " (paused)"}`,
    ];
    if (st.phase === "offline" && st.offline) lines.unshift(`offline ${st.offline.width}×${st.offline.height} · ${st.offline.spp.toFixed(1)} / ${st.offline.targetSpp} spp`);
    if (camera.gravity) {
      const v = Math.hypot(settings.velR, settings.velT, settings.velP);
      lines.push(`free fall · v = ${v.toFixed(3)} c · τ = ${camera.properTime.toFixed(1)} M`);
    } else if (camera.riding > 0.01) lines.push(`co-moving with the star · β = ${Math.abs(settings.velP).toFixed(3)} c`);
    else if (settings.motion === "barycentric") lines.push("at rest in the centre-of-mass frame");
    for (const g of camera.pad.list()) lines.push(`controller: ${g.id} · ${g.mapping || "no mapping"} · ${g.buttons.length} buttons`);
    statsEl.innerHTML = lines.join("<br>");
    const cam = cameraFrame(settings);
    readoutEl.innerHTML = physicalReadouts(settings.spin, settings.massSolar, cam)
      .map((r) => `<div class="row"${r.hint ? ` title="${r.hint}"` : ""}><span>${r.label}</span><span>${r.value}</span></div>`)
      .join("");
    $("spin-badge").textContent = `a = ${settings.spin.toFixed(3)} · r₊ = ${horizon(settings.spin).toFixed(3)} M · ISCO = ${isco(settings.spin).toFixed(3)} M`;
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
    if (key) {
      const k = document.createElement("kbd");
      k.textContent = key;
      tip.append(k);
    }
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
  for (const el of document.querySelectorAll<HTMLElement>("[data-tip]")) {
    if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", el.dataset.tip!);
    el.addEventListener("pointerenter", () => {
      clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => showTip(el), 280);
    });
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("pointerdown", hideTip);
  }

  // -------------------------------------------------------------------- first-run hint
  const HINT_KEY = "kerr.hint-seen";
  let hintSeen = false;
  try {
    hintSeen = localStorage.getItem(HINT_KEY) === "1";
  } catch {
    // storage unavailable: show it
  }
  if (!hintSeen && !matchMedia("(hover: none)").matches) {
    const hint = $("hint");
    const dismiss = () => {
      hint.classList.add("gone");
      setTimeout(() => (hint.hidden = true), 700);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        // not remembered
      }
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
