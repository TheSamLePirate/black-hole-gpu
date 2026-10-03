import { Renderer, type FrameStats, type OfflineOptions } from "./renderer";
import { horizon, isco } from "./physics";
import { cameraFrame, homePosition, repPose, setHolePose, setHomePose, switchAnchor } from "./camera";
import { bodyView, earthGround, earthStart, ourState, saturnDeparture, tiltAway } from "./system/our-side";
import { theirGroundPose, theirOrbitPose, universeOf } from "./game/place";
import { mouth } from "./wormhole";
import { GARGANTUA_SYSTEM } from "./system/bodies";
import { bodyState } from "./system/ephemeris";
import { CameraController, FLIGHT_KEYS, isTyping } from "./controls";
import { BODY_NAMES, bodyLook, craftRadius, onOurSide, type Body } from "./targeting";
import { HidPads } from "./gamepad";
import { MOUNT_KEYS, MOUNTS, setMountVessel, shipToCamera, type Mount } from "./mounts";
import { fleet, fleetStart } from "./fleet";
import { CockpitScreens } from "./ui/cockpitscreens";
import { VESSELS } from "./vessels";
import { SOLAR_BODIES } from "./system/solar";
import { FlightHud } from "./ui/flighthud";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "./pilot";
import { Mission } from "./mission";
import { physicalReadouts } from "./readouts";
import { criticalCurveDirections, projectLook } from "./shadow";
import { aimAngles, buildChart, chartOn, chartOptions, CONSTELLATIONS, horizonAt, lookOf, NAMED_STARS, pickChart, type ChartFrame } from "./skychart";
import { drawChartLabels } from "./ui/skylabels";
import { SkyPanel } from "./ui/skypanel";
import { defaultSettings, presets, QUALITY, type Settings, type Target } from "./settings";
import { SettingsPanel } from "./ui/panel";
import { SCHEMA, SCHEMA_BY_KEY } from "./ui/schema";
import { loadFromUrl } from "./urlstate";
import { setupRenderDialog } from "./renderdialog";
import { GameTools } from "./game/tools";
import { rangerStatus, type RangerStatus } from "./game/status";
import { GameToolsWindow } from "./ui/gametools";
import { applyTuning } from "./game/tuning";
import { cappedRatio } from "./tier";
import { cpuProf } from "./perf";
import { gameLog } from "./game/log";
import { autosave, saveFromHash, type GameSave } from "./game/save";
import { CraftLost } from "./ui/craftlost";
import { FlightComputer } from "./ui/fc/computer";
import { sitesOf } from "./game/sites";
import { Splash } from "./ui/splash";
import { SceneGallery } from "./ui/scenes";
import { SoundDirector } from "./audio/director";
import { sound } from "./audio/engine";
import { VideoWriter } from "./video";
import { Simulation } from "./sim";
import { TransportBar } from "./ui/transport";
import { Take, type TakeState } from "./take";
import { drawTelescope, type TelescopeView } from "./ui/telescope";
import { BODY_COLOURS, CameraPanel, fmtHeight, VIEW_HELP, VIEW_LABEL, VIEWS, type View } from "./ui/camerapanel";
import { defaultAltKm, ourOrbitPose } from "./game/place";
import { solarBody, M_METRES } from "./system/solar";
import { setSceneTime } from "./wormhole";
import { fmtWarp, realTimeSpeed, stepWarp, warpFactor, warpLadder } from "./clock";
import { loading } from "./loading";
import { preventPageZoom } from "./ui/nozoom";
import { watchMobile } from "./ui/mobile";
import { TouchFlight } from "./ui/touchflight";
import { drawLock, lockKey } from "./ui/targethud";
import { gameTimeOf, issAxes, issElements, issOrbit, issStart, issTrack, station } from "./system/iss";
import { rangerHull, stationHulls } from "./system/collide";
import { loadEphemerides } from "./system/de440";
import { ephemerisUrls } from "./system/ephemeris-files";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
preventPageZoom();
watchMobile();
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
/** The flight laws, as said when chosen. */
const FLIGHT_MODE_HELP: Record<Settings["flightMode"], string> = {
  rocket: "a rocket — the stick turns it, the throttle pushes along the nose",
  plane: "a plane — the control surfaces; let go, the flight path is held (F: next)",
  sf: "the flight computer — the stick and throttle set the way and the speed, it flies them (⇧F: antigravity)",
};

/** Rendering / performance choices survive preset changes. */
const KEEP_ON_PRESET: (keyof Settings)[] = [
  "pixelRatio", "realtimeSubsampling", "realtimeBudget", "fpsCap", "glassBlur", "temporalReprojection", "farFieldLut", "volumetricClouds", "realtimeEps", "realtimeSteps", "qualityEps", "qualitySteps",
  "targetSpp", "denoise", "denoiseStrength", "quality", "tonemap", "hdr", "hdrPeak", "bloom", "dof", "dofAperture", "dofFocus", "lensFlare", "exposure", "bgIntensity", "starSize", "starBrightness", "skyL", "skyB", "skyRoll",
  "massSolar", "cinematicSpeed", "rotation", "lookAt", "cinematic", "waterRipples", "waterMirror", "waterSpeed", "waterGlow", "waterColor", "waterDensity", "waterGlowColor", "ship", "shipMount", "shipAlbedo", "shipMetal", "shipRough", "shipLight", "shipCoat",
  "turnRate", "turnAccel", "rcsFraction", "crashSpeed", "ballistic", "damage", "antigrav", "autosave", "autosaveEvery", "rangerStatus", "soiRings", "pathInView",
  "sound", "soundVolume", "soundBeeps", "soundEngines", "soundAmbience", "soundUi",
  "skyLines", "skyNames", "starNames", "gridEquatorial", "gridHorizontal", "skyEcliptic", "skyChartOpacity",
];

let changed = true; // scene (camera / parameters) changed since the last rendered frame
let displayChanged = true;
/** the transport bar (ui/transport.ts), once built */
let transport: TransportBar | null = null;

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

  // the device lost: the flight saved, the image frozen, a way back
  renderer.onLost = (why) => {
    try {
      if (settings.autosave) tools.autosaveNow();
    } catch {
      /* (nothing to save yet) */
    }
    fail("");
    document.body.classList.add("gpu-lost");
    const box = document.createElement("div");
    box.textContent = `The graphics device was reset (${why}).\n\nYour flight was saved. Reload the page to go on.\n`;
    const b = document.createElement("button");
    b.textContent = "Reload";
    b.className = "error-reload";
    b.onclick = () => location.reload();
    box.append(b);
    errorEl.append(box);
  };
  renderer.onGpuError = (m) => {
    try {
      panel.toast(`GPU error: ${m.split("\n")[0]!.slice(0, 140)}`);
    } catch {
      /* (before the panel exists: the console has it) */
    }
  };
  const touch = () => (changed = true);
  renderer.onAssets = () => touch();
  const touchDisplay = () => (displayChanged = true);
  // the solar system's ephemerides (DE440, JUP365: 7 MB) — in while the rest is built
  loading.stage("ephemeris", "The solar system — NASA/JPL ephemerides (DE440)", { weight: 2 });
  const ephemerides = loading.track("ephemeris", "", loadEphemerides(ephemerisUrls(), (u) => loading.fetch(u, "ephemeris").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${u}: ${r.status}`))))));
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
      const p = theirOrbitPose({ body: pose.body!, altKm: pose.altKm, nu: pose.nu, inc: pose.inc }, time ?? sim.time, settings.spin, settings.massSolar);
      settings.shipLookYaw = settings.shipLookPitch = 0;
      const [fwd, up] = tiltAway([-p.up[0], -p.up[1], -p.up[2]], p.fwd, pose.tilt ?? 0);
      setHolePose(settings, p.X, fwd, up, p.vel);
      settings.motion = "geodesic";
      const off = pose.off ?? [0, 0];
      void aimAt(null, [off[0], off[1] + (pose.tilt ?? 0)]);
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
      const now = pose === "iss" || pose === "fleet";
      const t = time ?? (now ? gameTimeOf(Date.now()) : sim.time);
      if (now && time === undefined) sim.setTime(t);
      const d = pose === "earthGround" ? earthGround(t) : pose === "iss" ? issStart(t, issDistance, issOffset) ?? earthStart(t, 400) : pose === "earth" || pose === "earthMoon" || pose === "fleet" ? earthStart(t, 400, pose === "earthMoon") : saturnDeparture(t);
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
    const starts = fleetStart(sim.time, settings.vessel);
    if (pose === "fleet" && settings.ship) camera.flyFrom(starts[settings.vessel]);
    if (pose === "iss" && settings.ship) {
      // (the station's start gives the ship's own axes — its nose to the port's axis — not the view's:
      // the camera then where its mount is)
      const p = repPose(settings);
      camera.placeShipRep(p.l, p.n, p.vel, p.fwd, p.up);
    }

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
      panel.toast(settings.ship ? `Ranger: ${MOUNTS[settings.shipMount as Mount]?.label ?? ""}` : "Ranger off");
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
    if (say) panel.toast(`Camera: ${VIEW_LABEL[v]} — ${VIEW_HELP[v]}${v === "fall" && !settings.animate ? " (paused: Space runs time)" : ""}`);
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
    if (settings.ship && c !== "orbit") return panel.toast("The dive and the journey are the free camera's — leave the Ranger (⇧K)");
    camera.setCinematic(camera.cinematic === c ? null : c);
    if (camera.cinematic && !settings.animate) panel.toast("Cinematics run with the time — Space runs it");
    refreshGui();
    touch();
  }
  function toggleLookAt() {
    camera.setLookAt(!settings.lookAt);
    panel.toast(settings.lookAt ? `View locked on ${BODY_NAMES[settings.target]}` : "View free");
    refreshGui();
    touch();
  }
  function toggleTelescope() {
    camera.setTelescope(!settings.telescope);
    panel.toast(settings.telescope ? `Telescope on ${BODY_NAMES[settings.target]} — the wheel zooms (to a 0.02° field), Y leaves` : "Telescope off");
    refreshGui();
    touch();
  }
  /**
   * Takes the free camera to a body — anywhere in the world, through the wormhole too: in orbit around
   * it (a planet, a moon: a few radii up), around it. Why it cannot, or null.
   */
  function goTo(b: Target): string | null {
    if (settings.ship) return "The Ranger flies there: the planner (O), the autopilot (0: approach)";
    if (b === "ranger" || b === "lander" || b === "endurance") {
      // a craft of the fleet: the camera a few of its sizes off it — behind, to its side, above —, moving
      // with it, around it
      if (!(settings.system === "gargantua" && settings.wormhole)) return "The craft fly in our universe (through the wormhole of the Gargantua-system scenes)";
      const p = fleet.pose(b, sim.time);
      if (!p) return `The ${BODY_NAMES[b]}: not known now`;
      const R = craftRadius(b);
      const o = [1.1 * R, 0.8 * R, -1.9 * R];
      const X = [0, 1, 2].map((k) => p.X[k]! + (p.ax[0][k]! * o[0]! + p.ax[1][k]! * o[1]! + p.ax[2][k]! * o[2]!) / M_METRES) as [number, number, number];
      const d = [p.X[0] - X[0], p.X[1] - X[1], p.X[2] - X[2]];
      const l = Math.hypot(...d);
      camera.setCinematic(null);
      if (camera.gravity) camera.setGravity(false);
      setHomePose(settings, X, [d[0] / l, d[1] / l, d[2] / l], p.ax[1], p.V);
      settings.motion = "geodesic";
      camera.setOurLanded(null);
      camera.sync();
      settings.rotation = "orbit";
      camera.selectTarget(b, { focus: true });
      panel.toast(`Camera: around the ${BODY_NAMES[b]}`);
      refreshGui();
      touch();
      return null;
    }
    if (b === "iss") {
      // the space station: the camera 110 m off it — behind, to starboard, above —, moving with it,
      // around it
      if (!(settings.system === "gargantua" && settings.wormhole && settings.iss)) return "The space station flies in our universe (through the wormhole of the Gargantua-system scenes)";
      const st = issTrack.peek(sim.time);
      if (!st) return "The space station: no orbit known at this date";
      const A = issAxes(st.X, st.V, sim.time);
      const o = [-70, 60, -55];
      const X = [0, 1, 2].map((k) => st.X[k]! + (A[0][k]! * o[0]! + A[1][k]! * o[1]! + A[2][k]! * o[2]!) / M_METRES) as [number, number, number];
      const d = [st.X[0] - X[0], st.X[1] - X[1], st.X[2] - X[2]];
      const l = Math.hypot(...d);
      camera.setCinematic(null);
      if (camera.gravity) camera.setGravity(false);
      setHomePose(settings, X, [d[0] / l, d[1] / l, d[2] / l], [-A[2][0], -A[2][1], -A[2][2]], st.V);
      settings.motion = "geodesic";
      camera.setOurLanded(null);
      camera.sync();
      settings.rotation = "orbit";
      camera.selectTarget("iss", { focus: true });
      panel.toast("Camera: around the ISS");
      refreshGui();
      touch();
      return null;
    }
    const id = b === "hole" ? "gargantua" : b;
    const u = universeOf(id);
    camera.setCinematic(null);
    if (!u || (u === "gargantua" && id !== "gargantua" && settings.system !== "gargantua")) {
      if (!camera.availableTargets().includes(b)) return `${BODY_NAMES[b]} is not in this world`;
      setView("orbit", false);
      camera.selectTarget(b, { frame: true });
      return null;
    }
    if (u === "ours" && !(settings.system === "gargantua" && settings.wormhole)) return "The solar system lies through the wormhole of the Gargantua-system scenes";
    try {
      const sb = u === "ours" ? solarBody(id) : null;
      const alt = sb ? Math.max(defaultAltKm(id), (2.2 * sb.radius * M_METRES) / 1e3) : undefined;
      const p = u === "ours"
        ? ourOrbitPose({ body: id, altKm: alt }, sim.time)
        : theirOrbitPose({ body: id, rM: id === "gargantua" ? 40 : undefined, altKm: id === "gargantua" ? undefined : 20000 }, sim.time, settings.spin, settings.massSolar);
      if (camera.gravity) camera.setGravity(false);
      if (p.frame === "ours") setHomePose(settings, p.X, p.fwd, p.up, p.vel);
      else setHolePose(settings, p.X, p.fwd, p.up, p.vel);
      settings.motion = "geodesic";
      camera.setOurLanded(null);
      camera.sync();
      settings.rotation = "orbit";
      camera.selectTarget(b, { focus: true });
      panel.toast(`Camera: around ${BODY_NAMES[b]}`);
      refreshGui();
      touch();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  /** The camera set down on a world, on its tripod, looking at the horizon (⇧T; the camera panel). */
  function standOn(b?: Target): string | null {
    if (settings.ship) return "The Ranger lands itself (the autopilot) — leave it (⇧K) to set the camera down";
    const why = camera.standOn(b as Parameters<typeof camera.standOn>[0]);
    if (why) return why;
    const on = camera.rigStatus()?.body;
    panel.toast(`Tripod on ${on ? BODY_NAMES[on as Target] : "the ground"} — drag to look around, the keys walk it, V another view`);
    refreshGui();
    touch();
    return null;
  }
  camPanel = new CameraPanel({
    settings, camera, view, setView: (v) => setView(v), setMount: (m) => setMount(m), cinematic, goTo, standOn,
    changed: (keys) => onSettingsChange(keys), toast: (t) => panel.toast(t),
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
    if (!onOurSide(settings, cam)) return void panel.toast("Our constellations are on the other side of the wormhole");
    const d = kind === "star" ? NAMED_STARS[index]!.v : CONSTELLATIONS[index]!.label;
    if (settings.ship) {
      // (the Ranger's views: its look turned — as onto a body, aimAt)
      if (settings.lookAt) toggleLookAt();
      const deg = 180 / Math.PI;
      for (let i = 0; i < 12; i++) {
        const c = cameraFrame(settings);
        const L = lookOf(settings, c, d);
        const b = Math.atan2(L[0] * c.right[0] + L[1] * c.right[1] + L[2] * c.right[2], L[0] * c.fwd[0] + L[1] * c.fwd[1] + L[2] * c.fwd[2]) * deg;
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
  const displayedHeight = (off: { width: number; height: number }) => Math.min(canvas.clientHeight, (canvas.clientWidth * off.height) / off.width);
  /** Builds the chart for the image about to be drawn (the offline render's scene while one runs). */
  function updateChart(force = false) {
    const o = chartOptions(settings, chartHover);
    const off = renderer.offlineScene;
    const s = off?.settings ?? settings;
    const t = off?.time ?? sim.time;
    const cam = cameraFrame(s);
    const aspect = off ? off.width / off.height : canvas.width / Math.max(canvas.height, 1);
    const key = chartOn(o)
      ? [cam.region, cam.ell, ...cam.n, ...cam.fwd, ...cam.up, ...cam.beta, s.fov, t, aspect, o.lines, o.names, o.stars, o.equatorial, o.horizontal, o.ecliptic, o.opacity, o.highlight, !!off].join()
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
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = 1 - ((e.clientY - r.top) / r.height) * 2;
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
    panel.toast(stars ? `Star names ${settings.starNames ? "on" : "off"}` : `Constellations ${settings.skyLines ? "on" : "off"}`);
  }
  function cycleGrids() {
    const states: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];
    const i = states.findIndex(([e, h]) => e === settings.gridEquatorial && h === settings.gridHorizontal);
    const [e, h] = states[(i + 1) % states.length]!;
    settings.gridEquatorial = e;
    settings.gridHorizontal = h;
    onSettingsChange(["gridEquatorial", "gridHorizontal"]);
    panel.refresh();
    const cam = cameraFrame(settings);
    const noHorizon = h && !horizonAt(settings, cam, sim.time);
    panel.toast(!e && !h ? "Grids off" : `${[e && "Equatorial", h && "Horizontal"].filter(Boolean).join(" + ")} grid${e && h ? "s" : ""}${noHorizon ? " — no world under the camera" : ""}`);
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
    const v = settings.ship ? (MOUNTS[settings.shipMount as Mount]?.short ?? "Ranger") : camera.cinematic ? { orbit: "Auto-orbit", dive: "Dive", journey: "Journey" }[camera.cinematic] : VIEW_LABEL[view()];
    btn.querySelector(".cam-mode")!.textContent = `${v}${settings.telescope ? " · 🔭" : ""}`;
    btn.querySelector(".cam-target")!.textContent = BODY_NAMES[settings.target];
    btn.classList.toggle("locked", settings.lookAt || (!settings.ship && view() === "orbit"));
    btn.style.setProperty("--body", `rgb(${BODY_COLOURS[settings.target] ?? "200, 200, 200"})`);
    btn.classList.toggle("active", camPanel?.open ?? false);
    previousTarget = settings.target;
  }
  function syncButtons() {
    transport?.update(true);
    $("btn-guide").classList.toggle("active", settings.shadowGuide);
    $("btn-sky").classList.toggle("active", settings.skyLines || settings.skyNames || settings.starNames || settings.gridEquatorial || settings.gridHorizontal || settings.skyEcliptic);
    $("btn-jet").classList.toggle("active", settings.jet);
    $("btn-cinema").classList.toggle("active", settings.cinematic);
    $("btn-ship").classList.toggle("active", settings.ship);
    $("btn-sound").classList.toggle("muted", !settings.sound);
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
    if (camera.nodeWarp !== "auto") return false;
    audio.cue("error");
    panel.toast("Auto warp: the manoeuvre sets the warp — AUTO on the time bar gives it to you");
    return true;
  }
  function setWarp(speed: number) {
    if (autoWarpHeld()) return;
    settings.timeSpeed = speed;
    refreshGui();
    scheduleUrlSave();
    touch();
    panel.toast(`Time warp ${fmtWarp(settings, false)}${settings.animate ? "" : " — paused (Space runs it)"} · ${+speed.toPrecision(3)} M/s`);
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
    panel.toast(settings.sound ? "Sound on" : "Sound off");
  }
  function togglePathInView() {
    settings.pathInView = !settings.pathInView;
    refreshGui();
    touch();
    panel.toast(settings.pathInView ? "Future path shown in the view" : "Future path hidden in the view (the map keeps it)");
  }
  function pilotHold(h: Hold) {
    camera.pilot.setHold(h);
    panel.toast(camera.pilot.hold === "none" ? "Attitude hold off" : `Hold: ${HOLD_NAMES[h]}`);
  }
  function pilotAuto(a: Auto) {
    if (a === "dock" && camera.docked) return panel.toast("Docked to the ISS — UNDOCK first");
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
    const help = m === "around" ? " — drag to turn around the ship" : m === "free" ? " — fly the camera, the ship flies on" : "";
    panel.toast(`Camera: ${MOUNTS[m].label}${help}`);
  }
  const coarse = matchMedia("(pointer: coarse)").matches;
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
  const flightHud = new FlightHud(settings, {
    hold: pilotHold, auto: pilotAuto, sas: pilotSas, warp, mount: setMount, roll: pilotRoll, sound: () => toggleSound(),
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
      panel.toast(camera.speedMode === "target" ? `Speed relative to ${BODY_NAMES[settings.target]}` : "Speed in orbit");
    },
    select: (b) => {
      if (camera.selectTarget(b as Target, { focus: false })) panel.toast(`Target: ${BODY_NAMES[settings.target]}`);
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
      const m = kind === "circular" ? camera.planTransfer("orbit", r ?? 30) : kind === "align" ? camera.planAlign("orbit") : kind === "target" ? camera.planTransfer("star") : camera.planTransfer("wormhole");
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
    autoState: (a) => ({ on: camera.pilot.auto === a || (a === "circularize" && camera.pilot.auto === "node" && !!camera.ourCirc), why: flightHud.autoWhy(a) }),
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
    flightComputer.openTab("mission");
  };
  // the transport bar (ui/transport.ts): over the toolbar, in the mission bar while flying
  const tpDock = document.createElement("div");
  tpDock.id = "tp-dock";
  document.body.append(tpDock);
  transport = new TransportBar({
    settings, time: () => sim.time, playPause: () => playPause(), warp, setWarp, realTime,
    record: () => toggleTake(), recording: () => ({ on: take.recording, seconds: take.seconds, frames: take.length }),
    railsNote: () => camera.railsNote,
    nodeWarp: () => camera.nodeWarp || (camera.plan.nodes.length && settings.ship ? "plan" : ""),
    toggleAutoWarp: () => {
      settings.autoWarp = !settings.autoWarp;
      refreshGui();
      scheduleUrlSave();
      panel.toast(settings.autoWarp ? "Auto warp — the manoeuvre sets the warp" : "Manual warp — yours to choose live (, and .), never faster than the manoeuvre allows");
    },
  });
  transport.mount(tpDock, false);
  /** Starts or stops recording a take (● on the time bar). */
  function toggleTake() {
    if (renderer.offlineActive) return panel.toast("A render is running");
    if (take.recording) {
      take.stop();
      renderDialog.takeChanged();
      panel.toast(`Take recorded · ${take.seconds.toFixed(1)} s — Render › Video renders it at full quality`);
    } else {
      take.start();
      panel.toast("Recording a take — fly, orbit, pause, warp as you like; ● again to stop");
    }
    transport?.update(true);
  }
  camera.onPilotMessage = (t) => {
    panel.toast(t);
    cockpitScreens.message(t);
    gameLog.add(/crash/i.test(t) ? "warn" : "pilot", t, sim.time);
  };
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
    else if (e.code === "KeyG" && e.shiftKey) pilotAuto("entry");
    else if (autos[e.code]) pilotAuto(autos[e.code]!);
    else if (e.code === "KeyT") pilotSas();
    else if (e.code === "KeyR" && e.shiftKey) {
      panel.toast(camera.resetShipView()); // (the camera back to the attach points)
      refreshGui();
    } else if (e.code === "KeyR") pilotRoll();
    else if (e.code === "KeyY" && e.shiftKey) togglePathInView(); // (Y alone: the telescope, every mode)
    else if ((e.code === "KeyZ" || e.code === "KeyX") && (camera.outsideView() === "free" || settings.shipMount === "cabin")) e.preventDefault(); // (the free camera's keys)
    else if (e.code === "KeyZ") camera.pilot.throttle = 1;
    else if (e.code === "KeyX") camera.pilot.throttle = 0;
    else if (e.code === "CapsLock") {
      camera.pilot.precision = !camera.pilot.precision;
      panel.toast(camera.pilot.precision ? "Precision controls" : "Normal controls");
    } else if (e.code === "Backquote") panel.toast(flightHud.cycleDensity());
    else if (e.code === "KeyK" && e.shiftKey) actions["btn-ship"]!(); // leave the Ranger
    else if (e.key.toLowerCase() === "m" && !e.shiftKey) flightHud.toggleMapView();
    else if (e.code === "KeyO") openMissions();
    else if (e.code === "KeyV") {
      const keys = Object.keys(MOUNTS) as Mount[];
      const i = keys.indexOf(settings.shipMount as Mount);
      setMount(keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]!);
    } else if (e.code === "Escape") {
      mission.stop("Mission stopped — you have the controls");
      camera.pilot.hold = "none";
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto);
    } else if (e.code === "KeyB") pilotAuto("dock");
    else if (e.code === "KeyF" && !e.shiftKey) {
      // the flight law in the air: rocket → plane → the sci-fi flight computer
      const V = VESSELS[fleet.active];
      if (!V.flies) panel.toast(`The ${V.name} is no aircraft: it flies as a rocket`);
      else {
        const order: Settings["flightMode"][] = ["rocket", "plane", "sf"];
        settings.flightMode = order[(order.indexOf(settings.flightMode) + 1) % 3]!;
        onSettingsChange(["flightMode"]);
        panel.toast(`${V.name}: flown as ${FLIGHT_MODE_HELP[settings.flightMode]}`);
      }
    } else if (e.code === "KeyF" && e.shiftKey) {
      settings.antigrav = !settings.antigrav;
      onSettingsChange(["antigrav"]);
      panel.toast(settings.antigrav ? "Antigravity on — the flight computer holds against gravity and the air for free" : "Antigravity off — every hold costs thrust and propellant");
    } else if (e.code === "KeyP" && !e.shiftKey) {
      const cfg = camera.airFlight.cfg;
      cfg.flaps = cfg.flaps === 0.5 ? 1 : cfg.flaps === 1 ? 0 : 0.5;
      panel.toast(`Flaps ${cfg.flaps === 0 ? "up" : cfg.flaps === 0.5 ? "half" : "full"}`);
    } else if (e.code === "KeyP" && e.shiftKey) {
      camera.airBrake = camera.airBrake > 0 ? 0 : 1;
      panel.toast(camera.airBrake > 0 ? "Air brake out" : "Air brake in");
    }
    else if (e.code === "BracketLeft" || e.code === "BracketRight") camera.cycleVessel(e.code === "BracketRight" ? 1 : -1); // (the craft flown: KSP's [ ])
    else if (e.code.startsWith("Arrow")) e.preventDefault(); // throttle (held) — about the cabin, the look
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
        dpadUp: () => setMount(MOUNT_KEYS[(MOUNT_KEYS.indexOf(settings.shipMount as Mount) + 1) % MOUNT_KEYS.length]!),
        dpadDown: () => setMount(MOUNT_KEYS[(MOUNT_KEYS.indexOf(settings.shipMount as Mount) + MOUNT_KEYS.length - 1) % MOUNT_KEYS.length]!),
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
    // time, in every mode: Space runs / pauses, , . slower / faster, / real time (by physical position:
    // ; : ! on AZERTY)
    if (e.code === "Space") {
      e.preventDefault();
      playPause();
      return;
    }
    if (e.code === "Comma" || e.code === "Period") {
      e.preventDefault();
      warp(e.code === "Period" ? 1 : -1);
      return;
    }
    if (e.code === "Slash") {
      e.preventDefault();
      realTime();
      return;
    }
    if (e.code in FLIGHT_KEYS) return; // flight keys fly, nothing else
    const k = e.key.toLowerCase();
    if (k === "h") toggleUi();
    else if (k === "r") {
      if (e.shiftKey) camera.resetView();
      else nextView(1);
      touch();
    } else if (e.key === "Tab") {
      e.preventDefault();
      nextTarget(e.shiftKey ? -1 : 1);
    } else if (k === "p") savePNG();
    else if (k === "f") fullscreen();
    // the camera, in every mode: V the next view, C the look locked on the target, Y the telescope; the
    // free camera's B falling freely, O T ⇧C its cinematics
    else if (k === "v") nextView(e.shiftKey ? -1 : 1);
    else if (k === "c" && !e.shiftKey) toggleLookAt();
    else if (k === "y") toggleTelescope();
    else if (k === "o") cinematic("orbit");
    else if (k === "c") cinematic("dive");
    else if (k === "t" && e.shiftKey) {
      const why = standOn();
      if (why) panel.toast(why);
    } else if (k === "t") cinematic("journey");
    else if (k === "b") setView(view() === "fall" ? "free" : "fall");
    else if (k === "g") toggle("shadowGuide");
    else if (k === "n" && !flying()) toggleConstellations(e.shiftKey);
    else if (k === "u" && !flying()) cycleGrids();
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
    snapshot: () => ({ save: tools.snapshot("before the video"), settings: { ...settings }, time: sim.time, water: renderer.water.clock, ev: renderer.autoExposureEV }),
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
  // the frame budget with the subsampling already coarse, raised back when it has room
  let renderScale = 1;
  let gpuEma = 0;
  let scaleTimer = 0;
  // the frame time measured at each scale (remembered 30 s, then tried again): a lower scale only when
  // it pays — the frame may be bound elsewhere (the browser's compositing), where a smaller image is
  // no faster, only blurrier
  const scaleMs = new Map<number, { ms: number; at: number }>();
  let scaleHeld = 0; // (how long the scale has held [s]: its first frames, the targets made anew, are not its measure)
  function resize() {
    // (with the dynamic resolution — the Game quality —, the image within the hardware tier's pixel
    // budget, then its scale; the finer qualities keep the ratio asked for: their still image is the point)
    const ratio = settings.dynamicResolution ? cappedRatio(settings.pixelRatio, canvas.clientWidth, canvas.clientHeight, renderer.tier.capMpx) : settings.pixelRatio;
    const dpr = ratio * renderScale;
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
    // (the Earth's maps and terrain tiles in first — up to half a minute —, and a camera on the ground
    // raised onto it: the live frames ask for them and carry the camera)
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 3; i++) await frame();
    for (let w = performance.now(); !renderer.earthSettled && performance.now() - w < 30000; ) await frame();
    for (let i = 0; i < 3; i++) await frame();
    const t0 = performance.now();
    renderer.startOffline(settings, o.time ?? sim.time, {
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
  // -------------------------------------------------------------------- the game's tools (F2, __bh.game)
  const tools = new GameTools({
    settings, camera, renderer,
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
  // the air's limits (flightair.ts): a point kept as the craft enters the air, the craft lost past them
  let entryPoint: GameSave | null = null;
  const craftLost = new CraftLost();
  camera.onAirEntry = () => {
    entryPoint = tools.snapshot("before the entry");
  };
  camera.onCraftLost = (why) => {
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
        panel.toast("Damage off — the air's limits are alarms only (Settings › Game › Ground & air)");
      },
      restart: currentScene ? () => applyPreset(currentScene!) : null,
    });
  };
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
      settings, renderer, camera, touch, snapshot, render, video, videoState, resize, preset: applyPreset, presets, refresh: refreshGui, skyLoading,
      /** the space station: its orbit (SGP4), the tracker the game flies it with, its elements, its geometry */
      iss: { orbit: issOrbit, track: issTrack, elements: issElements, station, start: issStart, hulls: { ranger: rangerHull, station: stationHulls } },
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
        chart: () => chart,
      },
      /** the sound: __bh.sound.play("sas-on"), __bh.sound.ctx */
      sound, audio,
      /** the cabin's screens: their picture (canvas: 4 × 2 slots of 512 px, the PFD first) */
      cockpitScreens,
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
          while (performance.now() - t1 < (moving ? 9000 : maxMs) && !(lastStats?.phase === "converged" && !moving)) await wait(250);
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
      time: () => sim.time,
      mission,
      /** a system's bodies (ephemeris) and camera placement, for automation */
      sys: {
        bodyState: (id: string, t: number) => bodyState(GARGANTUA_SYSTEM, id, t), setHolePose, mouth: (t?: number) => mouth(settings, t),
        /** our universe (home frame, our mouth at the origin) */
        setHomePose: (X: [number, number, number], fwd: [number, number, number], up?: [number, number, number], vel?: [number, number, number]) => setHomePose(settings, X, fwd, up, vel),
        homePosition: () => homePosition(settings),
        /** where the camera sees a body (CPU geodesics, retarded, aberrated): a look direction */
        look: (id: string) => bodyLook(settings, cameraFrame(settings), id as Body, sim.time).look,
      },
      /** Freezes the loop's own simulation; step(dt) then advances it (camera, mission, time) by dt. */
      freeze: (on: boolean) => (frozen = on),
      step: (dt: number) => {
        sim.step(dt);
        sim.applyRender(camera.piloting && !camera.cinematic ? camera.flightInfo() : null);
        sim.timeDirty = true;
        changed = true;
        return sim.time;
      },
      setTime: (t: number) => sim.setTime(t),
      /** the simulation (sim.ts): its clocks, its step */
      sim,
    },
  });

  // -------------------------------------------------------------------- loop
  let last = performance.now();
  const loopIv: number[] = [];
  let renderedAt = 0;
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
    }
    // (frozen: an automation steps the simulation itself, frame by frame — see __bh.step)
    // (frozen: an automation steps the simulation itself — __bh.step; an offline render or a video: the
    // scene held, or stepped by the video itself)
    if (!frozen && !renderer.offlineActive) {
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
      const ok = take.capture(settings, {
        time: sim.time, water: renderer.water.clock, ev: renderer.autoExposureEV, ship: renderer.shipPose, thrust: renderer.shipThrust,
        plasma: renderer.shipPlasma, path: renderer.cameraPath,
      });
      if (!ok) {
        renderDialog.takeChanged();
        panel.toast(`Take stopped at ${take.seconds.toFixed(0)} s (10 minutes at most) — Render › Video renders it`);
        transport?.update(true);
      }
    }
    // (the frame rate cap: no new image before its interval — less a refresh's fraction for the jitter)
    const capped = settings.fpsCap > 0 && !renderer.offlineActive && now - renderedAt < 1000 / settings.fpsCap - 0.25 * (renderer.refreshMs || 4);
    if (!capped) cpuProf.time("sky chart", () => updateChart());
    skyPanel.refresh();
    const st = capped ? null : cpuProf.time("render (encode, submit)", () => renderer.frame(settings, sim.time, changed, sim.timeDirty, displayChanged));
    if (st) {
      renderedAt = now;
      if (!firstFrame) {
        // the first image is on screen: the loading screen lifts once the scene's assets are in
        firstFrame = true;
        splash.firstImage();
      }
      fpsN++;
      changed = false;
      sim.timeDirty = false;
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
      const now = performance.now();
      scaleHeld += 1.5;
      const settled = scaleHeld >= 3;
      if (on && settled && gpuEma > 0) scaleMs.set(renderScale, { ms: gpuEma, at: now });
      const known = (x: number) => {
        const m = scaleMs.get(x);
        return m && now - m.at < 30000 ? m.ms : undefined;
      };
      const lower = Math.max(0.5, renderScale - 0.125), higher = Math.min(1, renderScale + 0.125);
      const kl = known(lower), kh = known(higher);
      const budget = renderer.frameBudget(settings);
      let want = renderScale;
      if (!on) want = 1;
      else if (!settled) want = renderScale;
      else if (gpuEma > 1.2 * budget && block >= 4 && (kl === undefined || kl < 0.9 * gpuEma)) want = lower;
      // (up when the larger scale was measured within the budget, or no slower; not measured lately, when
      // the frame grown as the pixels would stay within it)
      else if (higher > renderScale && (kh !== undefined ? kh <= Math.max(0.85 * budget, 1.1 * gpuEma) : gpuEma * (higher / renderScale) ** 2 < 0.85 * budget)) want = higher;
      if (want !== renderScale) {
        renderScale = want;
        gpuEma = 0; // (measured afresh at the new scale)
        scaleHeld = 0;
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
    if (flightHud.visible !== pil) {
      flightHud.show(pil);
      transport!.mount(pil ? flightHud.transportSlot : tpDock, pil);
    }
    // (a touch screen: the stick, the throttle, roll — outside, free, the fingers move the camera)
    touchFlight.update(pil && coarse && camera.outsideView() !== "free" && !flightHud.planning && !document.body.classList.contains("hide-ui"));
    if (pil && info) {
      // the Ranger's status (the telemetry; its changes go to the journal)
      let status: RangerStatus | null = null;
      try {
        status = cpuProf.time("Ranger status", () => rangerStatus(settings, camera, info, sim.time));
        tools.watch(status);
      } catch {
        /* (between two frames of a jump) */
      }
      // the cockpit's screens: the telemetry, drawn (a few times a second, while the cabin is seen)
      if (renderer.ship.cabinShown && cockpitScreens.draw({ info, status, settings, time: sim.time, runway: camera.runwayView() })) renderer.ship.updateScreens(cockpitScreens.canvas);
      // the cockpit's dashboard: the local up and the motion on the ship's axes, the speed, the height
      {
        const S = info.S as number[][];
        const toShip = (v: number[] | null | undefined) => (v ? ([0, 1, 2].map((i) => S[0]![i]! * v[0]! + S[1]![i]! * v[1]! + S[2]![i]! * v[2]!) as [number, number, number]) : null);
        const up = toShip(info.dirs.radialOut as number[] | null), fwd = toShip(info.dirs.prograde as number[] | null);
        renderer.cockpitDash = { up: up ?? [0, 1, 0], fwd: fwd ?? [0, 0, 1], speed: (status?.speed ?? 0) / 1000, alt: status?.altKm ?? 0, time: performance.now() / 1000 };
      }
      // (drawn with the image: on the loop's turns that rendered one — the markers then match the view
      // shown, not a pose one or two frames ahead of it)
      if (st || !flightHud.drawn) cpuProf.time("flight HUD (total)", () => flightHud.update({ ...info, probe: renderer.planetProbes.get(settings.target) ?? null, status }, sim.time));
      flightComputer.show(flightHud.mapView);
      flightComputer.update();
      cpuProf.time("sound", () => audio.update(dt, { flying: true, live: settings.animate && !frozen, info, status, fired: camera.pilot.fired }));
    } else {
      flightComputer.show(false);
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
      panel.toast(`That link's saved game could not be read: ${(e as Error).message}`);
    }
    const last = autosave.get();
    try {
      if (shared) panel.toast(`Shared flight: ${tools.load(shared)}`);
      else if (scene && presets[scene]) applyPreset(scene);
      else if (hash.length <= 1 && last && last.settings.autosave !== false) panel.toast(`Resumed: ${tools.load(last)}`);
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
    // (the targeting: around what is locked — the target, or the station clicked; the old brackets only
    // where it gives nothing)
    const lock = lockDraw();
    const marker = lock ? null : targetMarker();
    const hover = camera.hover;
    const ship = shipMarker();
    const tele = telescopeView(cam);
    // (the sky chart's words: over the live view — the offline one is letterboxed, its lines alone)
    const sky = chart && !renderer.offlineActive ? chart : null;
    const key = guide || camera.flyMode || marker || lock || hover || ship || tele || sky
      ? [lock ? lockKey(lock.v, overlay.width, overlay.height, Math.tan((settings.fov * Math.PI) / 360)) + lock.alpha.toFixed(2) : "",settings.spin, cam.r, cam.theta, cam.phi, settings.yaw, settings.pitch, settings.roll, settings.fov, cam.speed, overlay.width, overlay.height, camera.flyMode, marker?.key, hover?.body, hover?.x, hover?.y, ship?.key,
        tele && [tele.target?.name, tele.target?.ndc?.map((x) => x.toFixed(4)), tele.target?.dist.toPrecision(5), tele.tracking], sky ? chartKey : ""].join()
      : "off";
    if (key === guideKey) return;
    guideKey = key;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (key === "off") return;
    if (sky) drawChartLabels(ctx, sky.labels, overlay.width, overlay.height, devicePixelRatio);
    if (camera.flyMode) drawCrosshair(ctx);
    if (tele) drawTelescope(ctx, overlay.width, overlay.height, devicePixelRatio, tele);
    if (marker && !tele) drawMarker(ctx, marker);
    if (lock && !tele) {
      const k = devicePixelRatio;
      drawLock(ctx, lock.v, overlay.width, overlay.height, Math.tan((settings.fov * Math.PI) / 360), k, lock.alpha, camera.piloting ? { top: 56 * k, bottom: 255 * k } : { top: 0, bottom: 70 * k });
    }
    if (hover && hover.body !== marker?.body && !(lock && hover.body === settings.target)) drawHover(ctx, hover);
    if (ship) drawShipMarker(ctx, ship);
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

  // ------------------------------------------------------------------ the Ranger, seen from outside
  /**
   * Outside the ship (the Around and Free views): where it is on the screen and how far, once it is a
   * few pixels long — a diamond and its distance; off-screen, an arrow at the edge towards it.
   */
  function shipMarker() {
    if (!settings.ship || !camera.outsideView() || renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const t = shipToCamera(camera.shipPose(), settings.shipLookYaw, settings.shipLookPitch).t;
    const d = Math.hypot(...t);
    const W = overlay.width, H = overlay.height;
    const tanH = Math.tan((settings.fov * Math.PI) / 360);
    const size = (26 / Math.max(d, 1) / tanH) * (H / 2); // (its length on the screen, px)
    if (size > 60) return null;
    const alpha = Math.min(1, (60 - size) / 30);
    let px = W / 2, py = H / 2, onScreen = false;
    if (t[2] > 1e-6) {
      px = ((t[0] / t[2] / (tanH * (W / H)) + 1) / 2) * W;
      py = ((1 - t[1] / t[2] / tanH) / 2) * H;
      onScreen = px > 0 && px < W && py > 0 && py < H;
    }
    const label = `${VESSELS[settings.vessel].name.toUpperCase()} · ${d < 1e3 ? `${d.toFixed(0)} m` : `${(d / 1e3).toFixed(d < 1e4 ? 2 : 1)} km`}`;
    const dir = Math.atan2(-t[1], t[0]);
    return { px, py, onScreen, dir, alpha, label, key: [px.toFixed(1), py.toFixed(1), onScreen, dir.toFixed(3), alpha.toFixed(2), label].join() };
  }
  function drawShipMarker(ctx: CanvasRenderingContext2D, m: NonNullable<ReturnType<typeof shipMarker>>) {
    const k = devicePixelRatio;
    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.strokeStyle = "rgba(120, 255, 200, 0.95)";
    ctx.fillStyle = "rgba(120, 255, 200, 0.95)";
    ctx.lineWidth = 1.5 * k;
    ctx.font = `${11 * k}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    if (m.onScreen) {
      const r = 7 * k;
      ctx.beginPath();
      ctx.moveTo(m.px, m.py - r);
      ctx.lineTo(m.px + r, m.py);
      ctx.lineTo(m.px, m.py + r);
      ctx.lineTo(m.px - r, m.py);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m.px, m.py, 1.6 * k, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillText(m.label, m.px, m.py + r + 14 * k);
    } else {
      // (off the screen: an arrow at its edge, towards it)
      const W = overlay.width, H = overlay.height, e = 34 * k;
      const c = Math.cos(m.dir), s2 = Math.sin(m.dir);
      const f = Math.min((W / 2 - e) / Math.max(Math.abs(c), 1e-6), (H / 2 - e) / Math.max(Math.abs(s2), 1e-6));
      const x = W / 2 + c * f, y = H / 2 + s2 * f;
      ctx.translate(x, y);
      ctx.rotate(m.dir);
      ctx.beginPath();
      ctx.moveTo(10 * k, 0);
      ctx.lineTo(-6 * k, -7 * k);
      ctx.lineTo(-6 * k, 7 * k);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-m.dir);
      ctx.fillText(m.label, 0, 22 * k);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ target marker

  /**
   * The targeting HUD's figures (ui/targethud.ts): flying, always there; else while the camera is
   * handled, then fading, as the brackets did.
   */
  function lockDraw() {
    if (renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const idle = (performance.now() - camera.activity) / 1000;
    const alpha = settings.ship ? 1 : idle < 1.6 ? 1 : Math.max(0, 1 - (idle - 1.6) / 0.8);
    if (alpha <= 0) return null;
    const v = camera.lockView();
    if (!v || !v.dir.every(Number.isFinite)) return null;
    return { v: { ...v, colour: v.colour || BODY_COLOURS[v.id as Target] || "" }, alpha };
  }

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

  /** The telescope's overlay (ui/telescope.ts): the lens, the target where it is, the tracking. */
  function telescopeView(cam: ReturnType<typeof cameraFrame>): TelescopeView | null {
    if (!settings.telescope || renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const info = camera.targetInfo();
    const tanH = Math.tan((settings.fov * Math.PI) / 360);
    const ndc = info ? projectLook(cam, info.look, tanH, overlay.width / overlay.height) : null;
    return {
      fov: settings.fov, mPerM: 1476.625 * settings.massSolar, tracking: settings.lookAt,
      target: info ? { name: info.name, ang: info.ang, dist: info.dist, ndc: ndc ? [ndc[0], ndc[1]] : null } : null,
    };
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
    else if (!settings.ship) {
      const rs = camera.rigStatus();
      const carried = rs ? ` · on ${BODY_NAMES[rs.body]}, ${fmtHeight(rs.h * 1476.625 * settings.massSolar)}` : "";
      const v = view();
      const glyph = { orbit: "↻", free: "✦", follow: "⇢", tripod: "⊥", fall: "↓" }[v];
      const aimed = v === "orbit" || settings.lookAt ? ` ${BODY_NAMES[settings.target]}` : "";
      chips.push(`<span class="chip${v === "fall" ? " hot" : ""}">${glyph} ${v === "fall" && camera.landed ? "Landed" : VIEW_LABEL[v]}${aimed}${carried}</span>`);
    }
    if (settings.telescope) chips.push(`<span class="chip">🔭 ${settings.fov < 1 ? `${(settings.fov * 60).toFixed(settings.fov < 0.1 ? 1 : 0)}′` : `${settings.fov.toFixed(1)}°`}</span>`);
    if (camera.pad.connected) chips.push(`<span class="chip" title="Game controller">🎮</span>`);
    statusEl.innerHTML = phase + chips.join("");
    progressEl.firstElementChild!.setAttribute("style", `width:${(Math.min(progress, 1) * 100).toFixed(1)}%`);
    progressEl.classList.toggle("done", progress >= 1 && st.phase !== "offline");

    if (!$("hud").classList.contains("open")) return;
    const lines = [
      `<b>${st.width}×${st.height}</b>${renderer.hdr ? " · HDR" : ""} · gpu ${st.gpuMs.toFixed(1)} ms · ` +
        (st.phase === "realtime" ? `1 ray / ${st.block}×${st.block} px` : `${st.spp.toFixed(1)} spp`),
      `${where()} · θ = ${settings.inclination.toFixed(1)}° · t = ${sim.time.toFixed(0)} M${settings.animate ? "" : " (paused)"}`,
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
  for (const el of document.querySelectorAll<HTMLElement>("[data-tip]")) if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", el.dataset.tip!);
  let tipEl: HTMLElement | null = null;
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
    if (el === tipEl) return;
    hideTip();
    tipEl = el && !el.closest(".fl-root") ? el : null;
    if (!tipEl) return;
    if (!tipEl.getAttribute("aria-label")) tipEl.setAttribute("aria-label", tipEl.dataset.tip!);
    const target = tipEl;
    tipTimer = window.setTimeout(() => target.isConnected && showTip(target), 280);
  });
  document.addEventListener("pointerdown", () => {
    hideTip();
    tipEl = null;
  });

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
