import { Renderer, type FrameStats, type OfflineOptions } from "./renderer";
import { horizon, isco } from "./physics";
import { cameraFrame, switchAnchor } from "./camera";
import { CameraController, FLIGHT_KEYS, isTyping } from "./controls";
import { BODY_NAMES } from "./targeting";
import { HidPads } from "./gamepad";
import { MOUNTS, type Mount } from "./mounts";
import { FlightHud } from "./ui/flighthud";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "./pilot";
import { physicalReadouts } from "./readouts";
import { criticalCurveDirections, projectLook } from "./shadow";
import { defaultSettings, presets, QUALITY, type Settings } from "./settings";
import { SettingsPanel } from "./ui/panel";
import { SCHEMA, SCHEMA_BY_KEY } from "./ui/schema";
import { loadFromUrl, saveToUrl } from "./urlstate";
import { setupRenderDialog } from "./renderdialog";

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
  "targetSpp", "denoise", "denoiseStrength", "quality", "tonemap", "hdr", "hdrPeak", "bloom", "exposure", "animate", "timeSpeed", "bgIntensity", "starSize", "starBrightness", "skyL", "skyB", "skyRoll",
  "massSolar", "cinematicSpeed", "rotation", "cinematic", "waterRipples", "waterMirror", "waterSpeed", "waterGlow", "waterColor", "waterDensity", "waterGlowColor", "ship", "shipMount", "shipAlbedo", "shipMetal", "shipRough", "shipLight", "shipCoat",
];

let changed = true; // scene (camera / parameters) changed since the last rendered frame
let timeDirty = false; // simulation time advanced since the last rendered frame
let displayChanged = true;
let simTime = 0;

let firstFrame = false;

function fail(msg: string) {
  document.getElementById("loading")?.remove();
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

async function main() {
  let renderer: Renderer;
  try {
    renderer = await Renderer.create(canvas);
  } catch (e) {
    fail(`${(e as Error).message}\n\nUse a WebGPU-capable browser (Chrome/Edge 113+, Safari 26+, Firefox 141+).`);
    return;
  }

  const touch = () => (changed = true);
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
    if (scene) touch();
    if (resized) resize();
    syncButtons();
    scheduleUrlSave();
  }

  const panel = new SettingsPanel($("panel"), {
    settings,
    defaults: defaultSettings,
    onChange: onSettingsChange,
    applyPreset: (name) => applyPreset(name),
    presetNames: Object.keys(presets),
    loadImage: () => fileInput.click(),
    connectController: HidPads.supported ? () => connectController() : undefined,
    shareUrl: () => {
      saveToUrl(settings, defaultSettings(), ["pixelRatio"]);
      return location.href;
    },
  });
  const refreshGui = () => {
    panel.refresh();
    syncButtons();
  };

  function applyPreset(name: string) {
    const keep = Object.fromEntries(KEEP_ON_PRESET.map((k) => [k, settings[k]]));
    const { time, ...preset } = presets[name] ?? {};
    Object.assign(settings, defaultSettings(), keep, preset);
    if (time !== undefined) {
      simTime = time;
      timeDirty = true;
    }
    camera.setCinematic(null);
    camera.sync();
    if (settings.ship) camera.setPilot(true); // the Ranger starts afresh (on a circular orbit near the hole)
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
  }
  syncButtons();
  syncRotationButtons();

  // -------------------------------------------------------------------- game controller
  // -------------------------------------------------------------------- piloting the Ranger
  const WARPS = [0.25, 0.5, 1, 2, 3, 6, 12, 25, 50, 100, 200, 500];
  function warp(dir: 1 | -1) {
    const i = WARPS.findIndex((w) => w >= settings.timeSpeed - 1e-9);
    const j = Math.max(0, Math.min(WARPS.length - 1, (i < 0 ? WARPS.length - 1 : i) + dir));
    settings.timeSpeed = WARPS[j]!;
    if (!settings.animate) toggle("animate");
    refreshGui();
    panel.toast(`Time warp: ${settings.timeSpeed} M/s`);
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
  function setMount(m: Mount) {
    if (settings.shipMount === m) return;
    settings.shipMount = m;
    refreshGui();
    scheduleUrlSave();
    panel.toast(`Camera: ${MOUNTS[m].label}`);
  }
  const flightHud = new FlightHud(settings, {
    hold: pilotHold, auto: pilotAuto, sas: pilotSas, warp, mount: setMount,
    lookAhead: () => camera.setLook(0, 0),
    throttle: (t) => {
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto); // taking the throttle ends the autopilot
      camera.pilot.throttle = t;
    },
  });
  camera.onPilotMessage = (t) => panel.toast(t);
  const flying = () => camera.piloting && !camera.cinematic && !renderer.offlineActive;
  /** Pilot keys (by physical position where it matters); true when handled. */
  function pilotKey(e: KeyboardEvent) {
    const holds: Record<string, Hold> = { Digit1: "prograde", Digit2: "retrograde", Digit3: "radialOut", Digit4: "radialIn", Digit5: "normal", Digit6: "antinormal", Digit7: "target" };
    const autos: Record<string, Auto> = { Digit8: "hover", Digit9: "circularize", Digit0: "approach" };
    if (holds[e.code]) pilotHold(holds[e.code]!);
    else if (autos[e.code]) pilotAuto(autos[e.code]!);
    else if (e.code === "KeyT") pilotSas();
    else if (e.code === "KeyZ") camera.pilot.throttle = 1;
    else if (e.code === "KeyX") camera.pilot.throttle = 0;
    else if (e.code === "KeyV") {
      const keys = Object.keys(MOUNTS) as Mount[];
      const i = keys.indexOf(settings.shipMount as Mount);
      setMount(keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]!);
    } else if (e.code === "Comma") warp(-1);
    else if (e.code === "Period") warp(1);
    else if (e.code === "Escape") {
      camera.pilot.hold = "none";
      if (camera.pilot.auto !== "none") pilotAuto(camera.pilot.auto);
    } else if (e.key.toLowerCase() === "b") panel.toast("Gravity is always on in the Ranger (K leaves it)");
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
    else if (/^[1-5]$/.test(e.key)) {
      settings.quality = (["low", "medium", "high", "ultra", "realtime"] as const)[Number(k) - 1]!;
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

  // -------------------------------------------------------------------- URL state
  let urlTimer = 0;
  function scheduleUrlSave() {
    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => saveToUrl(settings, defaultSettings(), ["pixelRatio"]), 400);
  }

  // -------------------------------------------------------------------- sizing
  function resize() {
    const dpr = settings.pixelRatio;
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
  Object.assign(globalThis, {
    __bh: {
      settings, renderer, camera, touch, snapshot, render, resize, preset: applyPreset, refresh: refreshGui, skyLoading,
      time: () => simTime,
      setTime: (t: number) => ((simTime = t), (timeDirty = true)),
    },
  });

  // -------------------------------------------------------------------- loop
  let last = performance.now();
  let fpsAcc = 0;
  let fpsN = 0;
  let fps = 0;
  let hudTimer = 0;
  let lastStats: FrameStats | null = null;
  let guideKey = "";

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fpsAcc += dt;
    if (fpsAcc > 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    if (camera.update(dt, simTime)) {
      changed = true;
      guiDirty = true;
    }
    if (settings.animate && settings.timeSpeed > 0 && !renderer.offlineActive) {
      simTime += dt * settings.timeSpeed;
      timeDirty = true;
    }
    // the liquid throat's waves run on their own clock (they move even with the scene's time paused)
    if (settings.cinematic && settings.wormhole && settings.waterSpeed > 0 && !renderer.offlineActive) {
      renderer.water.clock += dt * settings.waterSpeed;
      timeDirty = true;
    }
    // the camera's predicted free fall, drawn (lensed) by the tracer
    const path = camera.gravity ? camera.predictPath() : null;
    if (renderer.setCameraPath(settings.showGeodesic ? path : null)) changed = true;
    const st = renderer.frame(settings, simTime, changed, timeDirty, displayChanged);
    if (st) {
      if (!firstFrame) {
        // the first image is on screen: lift the loading veil
        firstFrame = true;
        $("loading").classList.add("done");
        setTimeout(() => $("loading").remove(), 800);
      }
      fpsN++;
      changed = false;
      timeDirty = false;
      displayChanged = false;
      lastStats = st;
      if (st.offline) renderDialog.update(st.offline);
    }
    drawGuide();
    renderer.shipPose = settings.ship ? camera.shipPose() : null;
    const pil = flying();
    if (flightHud.visible !== pil) flightHud.show(pil);
    if (pil) flightHud.update(camera.flightInfo(), simTime);
    hudTimer += dt;
    if (hudTimer > 0.15 && lastStats) {
      hudTimer = 0;
      updateHUD(lastStats, fps);
      if (guiDirty) {
        refreshGui();
        guiDirty = false;
        scheduleUrlSave();
      }
    }
  };
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
  const BODY_COLOURS = { hole: "255, 179, 92", star: "255, 217, 138", wormhole: "159, 184, 255", barycentre: "235, 240, 255" } as const;
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
