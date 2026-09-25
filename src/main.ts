import GUI, { type Controller } from "lil-gui";
import { Renderer, type FrameStats } from "./renderer";
import { horizon, isco } from "./physics";
import { cameraFrame } from "./camera";
import { CameraController, isTyping } from "./controls";
import { physicalReadouts } from "./readouts";
import { criticalCurveDirections, projectLook } from "./shadow";
import { defaultSettings, presets, QUALITY, type Quality, type Settings } from "./settings";
import { loadFromUrl, saveToUrl } from "./urlstate";
import { setupRenderDialog } from "./renderdialog";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const overlay = $<HTMLCanvasElement>("overlay");
const errorEl = $("error");

const settings: Settings = { ...defaultSettings(), ...loadFromUrl(defaultSettings()) };
/** Rendering / performance choices survive preset changes. */
const KEEP_ON_PRESET: (keyof Settings)[] = [
  "pixelRatio", "realtimeSubsampling", "realtimeEps", "realtimeSteps", "qualityEps", "qualitySteps",
  "targetSpp", "quality", "tonemap", "bloom", "exposure", "animate", "timeSpeed", "bgIntensity", "starSize",
  "massSolar", "cinematicSpeed",
];
/** Settings that only affect the final resolve (no re-trace). */
const DISPLAY_ONLY = new Set<keyof Settings>(["exposure", "tonemap", "bloom"]);
/** Settings that don't affect the image at all. */
const NO_RENDER = new Set<keyof Settings>(["massSolar", "cinematicSpeed", "shadowGuide", "quality", "animate", "timeSpeed"]);

let changed = true; // scene (camera / parameters) changed since the last rendered frame
let timeDirty = false; // simulation time advanced since the last rendered frame
let displayChanged = true;
let simTime = 0;

function fail(msg: string) {
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
  let guiDirty = false; // GUI widgets need refreshing (camera moved)

  const camera = new CameraController(canvas, settings, (mode) => {
    $("btn-orbit").classList.toggle("active", mode === "orbit");
    $("btn-dive").classList.toggle("active", mode === "dive");
    touch();
    guiDirty = true;
  });

  // -------------------------------------------------------------------- GUI
  const gui = new GUI({ title: "Controls", container: $("panel") });
  const controllers: Controller[] = [];
  const refreshGui = () => {
    controllers.forEach((c) => c.updateDisplay());
    syncButtons();
  };
  const add = <K extends keyof Settings>(folder: GUI, key: K, ...args: unknown[]) => {
    const c = (folder.add as (...a: unknown[]) => Controller)(settings, key, ...args).onChange(() => {
      syncButtons();
      if (DISPLAY_ONLY.has(key)) touchDisplay();
      else if (!NO_RENDER.has(key)) touch();
      if (key === "distance") camera.sync();
      scheduleUrlSave();
    });
    controllers.push(c);
    return c;
  };

  const presetState = { preset: "" };
  gui.add(presetState, "preset", ["", ...Object.keys(presets)]).name("scene preset").onChange((name: string) => {
    if (name) applyPreset(name);
  });
  function applyPreset(name: string) {
    const keep = Object.fromEntries(KEEP_ON_PRESET.map((k) => [k, settings[k]]));
    Object.assign(settings, defaultSettings(), keep, presets[name]);
    camera.setCinematic(null);
    camera.sync();
    refreshGui();
    touch();
    touchDisplay();
    scheduleUrlSave();
  }

  add(gui, "quality", { "Low": "low", "Medium": "medium", "High": "high", "Ultra": "ultra" })
    .name("quality")
    .onFinishChange((q: Quality) => {
      Object.assign(settings, QUALITY[q]);
      refreshGui();
      touch();
    });

  const fBH = gui.addFolder("Black hole");
  add(fBH, "spin", -0.999, 0.999, 0.001).name("spin a/M");
  add(fBH, "massSolar").name("mass [M☉] (units only)");

  const fCam = gui.addFolder("Observer");
  add(fCam, "distance", 1.1, 1000, 0.01).name("distance r [M]");
  add(fCam, "inclination", 0.2, 179.8, 0.1).name("inclination θ [°]");
  add(fCam, "azimuth", -360, 360, 0.1).name("azimuth φ [°]");
  add(fCam, "fov", 1, 150, 0.1).name("field of view [°]");
  add(fCam, "yaw", -180, 180, 0.1).name("look yaw [°]");
  add(fCam, "pitch", -89, 89, 0.1).name("look pitch [°]");
  add(fCam, "motion", { "static (ZAMO)": "static", "circular orbit": "orbit", "free fall (rain)": "infall", "boost along view": "forward" }).name("observer motion");
  add(fCam, "beta", 0, 0.99, 0.001).name("boost β (view)");
  add(fCam, "cinematicSpeed", 0.5, 60, 0.1).name("cinematic speed");
  fCam.close();

  const fDisk = gui.addFolder("Accretion disk (Novikov–Thorne)");
  add(fDisk, "disk").name("thin disk");
  add(fDisk, "diskTemp", 1500, 60000, 10).name("peak T_eff [K]");
  add(fDisk, "diskOuter", 3, 200, 0.1).name("outer radius [M]");
  add(fDisk, "diskTau", 0.01, 100, 0.01).name("optical depth τ");
  add(fDisk, "diskThickness", 0, 0.25, 0.001).name("thickness H/R (0 = thin)");
  add(fDisk, "turbulence", 0, 1, 0.01).name("turbulence");
  add(fDisk, "flowPeriod", 10, 400, 1).name("turbulence lifetime [M]");
  add(fDisk, "limbDarkening").name("limb darkening");
  add(fDisk, "diskEmission", { "visible band (CIE)": "visible", "bolometric g⁴σT⁴": "bolometric" }).name("brightness model");
  add(fDisk, "diskBrightness", 0, 4, 0.01).name("emissivity scale");

  const fJet = gui.addFolder("Relativistic jet (synchrotron)");
  add(fJet, "jet").name("enabled (J)");
  add(fJet, "jetLorentz", 1.01, 20, 0.01).name("bulk Lorentz factor Γ");
  add(fJet, "jetWidth", 0.3, 3, 0.01).name("width (parabolic)");
  add(fJet, "jetLength", 20, 600, 1).name("length [M]");
  add(fJet, "jetIntensity", 0, 5, 0.01).name("intensity");
  add(fJet, "jetCutoff", 0.2, 10, 0.01).name("synchrotron cutoff ν_c");
  add(fJet, "jetKnots", 0, 1, 0.01).name("knots / shocks");

  const fFlow = gui.addFolder("Hot flow (volumetric)");
  add(fFlow, "hotFlow").name("enabled");
  add(fFlow, "hotFlowHR", 0.05, 1.5, 0.01).name("thickness H/R");
  add(fFlow, "hotFlowAlpha", -1, 3, 0.01).name("spectral index α");
  add(fFlow, "hotFlowIntensity", 0, 5, 0.01).name("intensity");
  fFlow.close();

  const fSky = gui.addFolder("Background");
  add(fSky, "background", { "stars + Milky Way": "stars", "lensing grid": "checker", "image (equirect.)": "image" }).name("sky");
  add(fSky, "bgIntensity", 0, 20, 0.01).name("intensity");
  add(fSky, "starSize", 0.3, 4, 0.01).name("star PSF size");
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
  fSky.add({ load: () => fileInput.click() }, "load").name("load equirectangular image…");
  fSky.close();

  const fPhys = gui.addFolder("Physics & diagnostics");
  add(fPhys, "renderMode", {
    physical: "physical",
    "redshift g = ν_obs/ν_em": "redshift",
    "disk temperature": "temperature",
    "image order (plane crossings)": "order",
    "integration cost": "steps",
  }).name("view");
  add(fPhys, "shiftMode", {
    "full (Doppler+gravity+beaming)": "full",
    "gravitational only": "gravitational",
    "colour shift, no beaming": "noBeaming",
    "none (Interstellar)": "none",
  }).name("frequency shift");
  add(fPhys, "shadowGuide").name("Kerr shadow guide (G)");
  add(fPhys, "animate").name("animate (space)");
  add(fPhys, "timeSpeed", 0, 100, 0.1).name("time speed [M/s]");
  fPhys.close();

  const fRender = gui.addFolder("Rendering");
  add(fRender, "exposure", -8, 8, 0.01).name("exposure [EV]");
  add(fRender, "tonemap", ["AgX", "AgX punchy", "ACES", "clamp"]).name("tone map");
  add(fRender, "bloom", 0, 0.5, 0.001).name("bloom (optical PSF)");
  add(fRender, "pixelRatio", 0.25, 3, 0.05).name("pixel ratio").onFinishChange(resize);
  add(fRender, "realtimeSubsampling", ["auto", 1, 2, 3, 4, 6, 8]).name("realtime subsampling");
  add(fRender, "realtimeEps", 0.01, 0.3, 0.001).name("realtime RK4 ε");
  add(fRender, "realtimeSteps", 50, 5000, 1).name("realtime max steps");
  add(fRender, "qualityEps", 0.002, 0.1, 0.001).name("converged RK4 ε");
  add(fRender, "qualitySteps", 200, 50000, 1).name("converged max steps");
  add(fRender, "targetSpp", 1, 4096, 1).name("samples / pixel");
  add(fRender, "adaptiveIntegrator").name("error-controlled RK4");
  add(fRender, "integratorTolerance", 1e-7, 1e-3, 1e-7).name("RK4 local tolerance");
  add(fRender, "noiseThreshold", 0, 0.1, 0.001).name("adaptive sampling (rel. error)");
  add(fRender, "temporalBlend", 0.05, 1, 0.01).name("temporal blend (1 = off)");
  fRender.close();

  if (innerWidth < 800) gui.close();

  // -------------------------------------------------------------------- toolbar & keys
  const toggleUi = () => document.body.classList.toggle("hide-ui");
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  const toggle = (key: "animate" | "shadowGuide" | "jet") => {
    settings[key] = !settings[key];
    refreshGui();
    if (key !== "shadowGuide") touch();
    syncButtons();
    scheduleUrlSave();
  };
  const actions: Record<string, () => void> = {
    "btn-orbit": () => camera.setCinematic(camera.cinematic === "orbit" ? null : "orbit"),
    "btn-dive": () => camera.setCinematic(camera.cinematic === "dive" ? null : "dive"),
    "btn-play": () => toggle("animate"),
    "btn-guide": () => toggle("shadowGuide"),
    "btn-jet": () => toggle("jet"),
    "btn-shot": () => savePNG(),
    "btn-full": () => fullscreen(),
    "btn-hide": () => toggleUi(),
    "btn-info": () => $("info").classList.toggle("collapsed"),
    "btn-render": () => renderDialog.toggle(),
  };
  for (const [id, fn] of Object.entries(actions)) $(id).addEventListener("click", fn);
  function syncButtons() {
    $("btn-play").classList.toggle("active", settings.animate);
    $("btn-guide").classList.toggle("active", settings.shadowGuide);
    $("btn-jet").classList.toggle("active", settings.jet);
  }
  syncButtons();

  addEventListener("keydown", (e: KeyboardEvent) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") {
      e.preventDefault();
      toggle("animate");
    } else if (k === "h") toggleUi();
    else if (k === "r") {
      camera.resetView();
      touch();
    } else if (k === "p") savePNG();
    else if (k === "f") fullscreen();
    else if (k === "o") actions["btn-orbit"]!();
    else if (k === "d") actions["btn-dive"]!();
    else if (k === "g") toggle("shadowGuide");
    else if (k === "j") toggle("jet");
    else if (k === "i") actions["btn-info"]!();
    else if (e.key === "Escape") camera.setCinematic(null);
    else if ("1234".includes(k)) {
      settings.quality = (["low", "medium", "high", "ultra"] as const)[Number(k) - 1]!;
      Object.assign(settings, QUALITY[settings.quality]);
      refreshGui();
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
  Object.assign(globalThis, {
    __bh: { settings, renderer, camera, touch, snapshot, resize, preset: applyPreset, refresh: refreshGui },
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
    if (camera.update(dt)) {
      changed = true;
      guiDirty = true;
    }
    if (settings.animate && settings.timeSpeed > 0 && !renderer.offlineActive) {
      simTime += dt * settings.timeSpeed;
      timeDirty = true;
    }
    const st = renderer.frame(settings, simTime, changed, timeDirty, displayChanged);
    if (st) {
      fpsN++;
      changed = false;
      timeDirty = false;
      displayChanged = false;
      lastStats = st;
      if (st.offline) renderDialog.update(st.offline);
    }
    drawGuide();
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
    const key = settings.shadowGuide
      ? [settings.spin, cam.r, cam.theta, settings.yaw, settings.pitch, settings.fov, cam.speed, overlay.width, overlay.height].join()
      : "off";
    if (key === guideKey) return;
    guideKey = key;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!settings.shadowGuide) return;
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

  const statsEl = $("stats");
  const readoutEl = $("readouts");
  function updateHUD(st: FrameStats, fpsNow: number) {
    const phase =
      st.phase === "offline" && st.offline
        ? `<b class="cv">OFFLINE RENDER</b> ${st.offline.width}×${st.offline.height} · ${(st.offline.progress * 100).toFixed(1)} % · ${st.offline.spp.toFixed(1)} / ${st.offline.targetSpp} spp`
        : st.phase === "realtime"
        ? `<b class="rt">REALTIME</b> 1 ray / ${st.block}×${st.block} px`
        : st.phase === "converging"
          ? `<b class="cv">CONVERGING</b> ${st.spp.toFixed(1)} / ${settings.targetSpp} spp`
          : `<b class="ok">CONVERGED</b> ${settings.targetSpp} spp`;
    const cin = camera.cinematic ? ` · <b class="cin">${camera.cinematic.toUpperCase()}</b>` : "";
    statsEl.innerHTML =
      `${phase}${cin}<br><span class="dim">${st.width}×${st.height} · ${fpsNow.toFixed(0)} fps · gpu ${st.gpuMs.toFixed(1)} ms · ` +
      `r = ${settings.distance.toFixed(2)} M · θ = ${settings.inclination.toFixed(1)}° · t = ${simTime.toFixed(0)} M</span>`;
    if (!$("info").classList.contains("collapsed")) {
      const cam = cameraFrame(settings);
      readoutEl.innerHTML = physicalReadouts(settings.spin, settings.massSolar, cam)
        .map((r) => `<div class="row"${r.hint ? ` title="${r.hint}"` : ""}><span>${r.label}</span><span>${r.value}</span></div>`)
        .join("");
    }
    $("spin-badge").textContent = `a = ${settings.spin.toFixed(3)} · r₊ = ${horizon(settings.spin).toFixed(3)} M · ISCO = ${isco(settings.spin).toFixed(3)} M`;
  }
}

main();
