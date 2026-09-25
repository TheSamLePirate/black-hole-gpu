import { Renderer, type FrameStats, type OfflineOptions } from "./renderer";
import { horizon, isco } from "./physics";
import { cameraFrame, switchAnchor } from "./camera";
import { CameraController, isTyping } from "./controls";
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
  }
  if (!(s.quality in QUALITY)) s.quality = d.quality;
  return s;
}
/** Rendering / performance choices survive preset changes. */
const KEEP_ON_PRESET: (keyof Settings)[] = [
  "pixelRatio", "realtimeSubsampling", "realtimeEps", "realtimeSteps", "qualityEps", "qualitySteps",
  "targetSpp", "denoise", "denoiseStrength", "quality", "tonemap", "hdr", "hdrPeak", "bloom", "exposure", "animate", "timeSpeed", "bgIntensity", "starSize", "starBrightness", "skyL", "skyB", "skyRoll",
  "massSolar", "cinematicSpeed",
];

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
  const skyLoading = renderer
    .loadSky()
    .then(() => touch())
    .catch((e) => console.warn("Real sky unavailable, using the procedural sky:", e));
  let guiDirty = false; // GUI widgets need refreshing (camera moved)

  const camera = new CameraController(canvas, settings, (mode) => {
    $("btn-orbit").classList.toggle("active", mode === "orbit");
    $("btn-dive").classList.toggle("active", mode === "dive");
    $("btn-journey").classList.toggle("active", mode === "journey");
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
    Object.assign(settings, defaultSettings(), keep, presets[name]);
    camera.setCinematic(null);
    camera.sync();
    refreshGui();
    touch();
    touchDisplay();
    scheduleUrlSave();
  }

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
    "btn-journey": () => {
      camera.setCinematic(camera.cinematic === "journey" ? null : "journey");
      refreshGui();
    },
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
    else if (k === "t") actions["btn-journey"]!();
    else if (k === "g") toggle("shadowGuide");
    else if (k === "j") toggle("jet");
    else if (k === "i") actions["btn-info"]!();
    else if (e.key === "Escape") camera.setCinematic(null);
    else if (/^[1-4]$/.test(e.key)) {
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
    __bh: { settings, renderer, camera, touch, snapshot, render, resize, preset: applyPreset, refresh: refreshGui, skyLoading },
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
    const key = settings.shadowGuide && cam.region === "hole"
      ? [settings.spin, cam.r, cam.theta, settings.yaw, settings.pitch, settings.fov, cam.speed, overlay.width, overlay.height].join()
      : "off";
    if (key === guideKey) return;
    guideKey = key;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (key === "off") return;
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

  /** Camera position for the HUD: distance to the hole, or ℓ through the wormhole. */
  function where() {
    if (!settings.wormhole || settings.anchor === "hole") return `r = ${settings.distance.toFixed(2)} M`;
    const side = settings.whL < 0 ? "our side" : "Gargantua side";
    return `ℓ = ${settings.whL.toFixed(2)} M (${side})`;
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
      `${phase}${cin}<br><span class="dim">${st.width}×${st.height}${renderer.hdr ? " · HDR" : ""} · ${fpsNow.toFixed(0)} fps · gpu ${st.gpuMs.toFixed(1)} ms · ` +
      `${where()} · θ = ${settings.inclination.toFixed(1)}° · t = ${simTime.toFixed(0)} M</span>`;
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
