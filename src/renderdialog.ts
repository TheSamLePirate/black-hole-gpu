import type { CameraController } from "./controls";
import type { OfflineOptions, OfflineStatus, Renderer } from "./renderer";
import type { Settings } from "./settings";
import type { Simulation } from "./sim";
import type { Take, TakeState } from "./take";
import { fmtFactor, fmtWarp, realTimeSpeed, warpLadder } from "./clock";
import { VIDEO_EXT, VideoWriter, type VideoFormat } from "./video";
import { DRAFT_SPP, draftSize, SHOTS as SHOT_IDS, type Shot, videoFrames, videoName } from "./photo/videoplan";
import { onEscape } from "./ui/keys";
import { t, tf } from "./i18n";

/** The options' names as shown (their values stay the English keys below). */
const OPTION_TEXT: Record<string, string> = {
  Viewport: t("Viewport"),
  Custom: t("Custom"),
  "Square 2048²": t("Square 2048²"),
  "Square 4096²": t("Square 4096²"),
  "Portrait 2160×3840": t("Portrait 2160×3840"),
  "Reference · Dormand–Prince, tol 1e-6": t("Reference · Dormand–Prince, tol 1e-6"),
  "High · Dormand–Prince, tol 1e-5": t("High · Dormand–Prince, tol 1e-5"),
  "Draft · fixed-step RK4, ε 0.02": t("Draft · fixed-step RK4, ε 0.02"),
  "Video · Full HD frames, motion blur": t("Video · Full HD frames, motion blur"),
  "Mega photo · 8K reference": t("Mega photo · 8K reference"),
  off: t("off"),
  Off: t("Off"),
  "180° (half a frame)": t("180° (half a frame)"),
  "360° (whole frame)": t("360° (whole frame)"),
  "Interactive (30 ms/frame)": t("Interactive (30 ms/frame)"),
  "Balanced (80 ms/frame)": t("Balanced (80 ms/frame)"),
  "Turbo (250 ms/frame)": t("Turbo (250 ms/frame)"),
};

const RESOLUTIONS: Record<string, [number, number] | null> = {
  Viewport: null,
  "HD 1280×720": [1280, 720],
  "Full HD 1920×1080": [1920, 1080],
  "QHD 2560×1440": [2560, 1440],
  "4K UHD 3840×2160": [3840, 2160],
  "5K 5120×2880": [5120, 2880],
  "8K UHD 7680×4320": [7680, 4320],
  "Square 2048²": [2048, 2048],
  "Square 4096²": [4096, 4096],
  "Portrait 2160×3840": [2160, 3840],
  Custom: null,
};

const INTEGRATORS: Record<string, { tolerance: number; eps: number; maxSteps: number }> = {
  "Reference · Dormand–Prince, tol 1e-6": { tolerance: 1e-6, eps: 0.02, maxSteps: 12000 },
  "High · Dormand–Prince, tol 1e-5": { tolerance: 1e-5, eps: 0.02, maxSteps: 8000 },
  "Draft · fixed-step RK4, ε 0.02": { tolerance: 0, eps: 0.02, maxSteps: 6000 },
};

/** Render presets: what each purpose needs from resolution, sampling and integration. */
const PRESETS: Record<string, { res: string; spp: string; integ: string; noise: string; budget: string; video?: boolean } | null> = {
  Custom: null,
  // per frame: enough samples for a clean, temporally stable frame; fixed noise threshold so that
  // successive frames converge alike; motion blur (180° shutter) set in the Video section
  "Video · Full HD frames, motion blur": {
    res: "Full HD 1920×1080",
    spp: "64",
    integ: "High · Dormand–Prince, tol 1e-5",
    noise: "1 %",
    budget: "Turbo (250 ms/frame)",
    video: true,
  },
  // the largest resolution the GPU holds (8K if possible), reference integration, 1024 spp
  "Mega photo · 8K reference": {
    res: "8K UHD 7680×4320",
    spp: "1024",
    integ: "Reference · Dormand–Prince, tol 1e-6",
    noise: "0.2 %",
    budget: "Turbo (250 ms/frame)",
  },
};

/** The video's shots: the scene going on from now (as live), a recorded take, a camera move, the director's cameras. */
const SHOTS: Record<Shot, string> = {
  live: t("Live: the scene goes on from now"),
  take: t("Recorded take"),
  orbit: t("Cinematic orbit around the target"),
  dive: t("Dive to the horizon"),
  journey: t("Journey through the wormhole"),
  director: t("The director's cameras (a ship flown)"),
};
const SHUTTERS: Record<string, number> = { Off: 0, "180° (half a frame)": 0.5, "360° (whole frame)": 1 };

const BUDGETS: Record<string, number> = {
  "Interactive (30 ms/frame)": 30,
  "Balanced (80 ms/frame)": 80,
  "Turbo (250 ms/frame)": 250,
};

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

interface DialogDeps {
  renderer: Renderer;
  settings: Settings;
  /** the simulation: a video steps it (sim.ts) */
  sim: Simulation;
  /** the take recorded live (take.ts) */
  take: Take;
  /** a take's frame: the renderer's state and the scene's time as recorded */
  applyState: (st: TakeState) => void;
  /** the scene before a video, and back to it after */
  snapshot: () => unknown;
  restore: (snap: unknown) => void;
  time: () => number;
  download: (blob: Blob, name: string) => void;
  fileStem: () => string;
  onActiveChange: (active: boolean) => void;
  camera: CameraController;
  /** the director's cameras: whether they can film (a ship flown), and set — how to put the view back */
  director?: { available(): boolean; set(): () => void };
  /** a video done: shown, saved (else downloaded) */
  onVideo?: (v: VideoDone) => void;
  /** why the renderer cannot be taken now (a live capture grabbing the view), or null */
  busy?: () => string | null;
}

/** A video asked (the dialog's, the photo bar's, TARS's): what is not given, the dialog's fields. */
export interface VideoJob {
  shot: Shot;
  /** its length [s] (a take: its own) */
  seconds?: number;
  fps?: number;
  /** the scene's time: as live, frozen (0), or a warp [M/s] */
  rate?: "live" | number;
  /** the shutter, a fraction of the frame's interval (motion blur) */
  shutter?: number;
  /** a draft: 640×360 at most, 4 samples, the fixed-step integrator — the shot and its timing tested in seconds */
  draft?: boolean;
  format?: VideoFormat;
  /** the scene put back where it was after */
  restore?: boolean;
}

/** A video done: its file and what it is. */
export interface VideoDone {
  /** what was asked (the final from a draft: the same, not a draft) */
  job: VideoJob;
  blob: Blob;
  name: string;
  shot: Shot;
  draft: boolean;
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  frames: number;
  seconds: number;
}

/** The video rendering now (null: none). */
export interface VideoState {
  shot: Shot;
  draft: boolean;
  format: VideoFormat | null;
  width: number;
  height: number;
  /** the frame being rendered (from 0), of how many */
  frame: number;
  frames: number;
  /** the time left [s] (NaN: not known yet) */
  etaS: number;
}

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The dialog's page, built in the interface's language (its ids are the dialog's handles, its classes style.css's). */
function mountPanel(): HTMLElement {
  const sec = document.createElement("section");
  sec.id = "render";
  sec.className = "glass";
  sec.hidden = true;
  sec.dataset.testid = "render";
  const L = (label: string, control: string, title?: string) =>
    `<label${title ? ` title="${esc(title)}"` : ""}>${esc(label)}${control}</label>`;
  sec.innerHTML = `
      <header>
        <div>
          <h2>${esc(t("Offline render"))}</h2>
          <p>${esc(t("Scene frozen in time · any resolution · rendered progressively over many frames"))}</p>
        </div>
        <button id="render-close" class="icon" title="${esc(t("Hide (the render keeps running)"))}" aria-label="${esc(t("Hide (the render keeps running)"))}">✕</button>
      </header>
      <div class="form">
        ${L(t("Preset"), '<select id="r-preset"></select>', t("Sets resolution, sampling and integrator for the purpose"))}
        ${L(t("Resolution"), '<select id="r-res"></select>')}
        <div class="pair">
          ${L(t("Width"), '<input id="r-w" type="number" min="16" step="1" />')}
          ${L(t("Height"), '<input id="r-h" type="number" min="16" step="1" />')}
        </div>
        ${L(t("Samples / pixel"), '<select id="r-spp"></select>')}
        ${L(t("Geodesic integrator"), '<select id="r-int"></select>')}
        ${L(t("Adaptive sampling (noise threshold)"), '<select id="r-noise"></select>', t("Stop sampling a pixel once the relative standard error of its mean falls below this value"))}
        ${L(t("Motion-blur shutter [M]"), '<input id="r-shutter" type="number" min="0" step="0.5" value="0" />', t("Exposure time in units of M = GM/c³; samples are spread over it (motion blur of the flow)"))}
        ${L(t("GPU budget"), '<select id="r-budget"></select>')}
      </div>
      <div class="progress"><div id="r-bar"></div></div>
      <div id="r-status" role="status" aria-live="polite"></div>
      <div class="actions">
        <button id="r-start" class="primary">${esc(t("Start render"))}</button>
        <button id="r-pause">${esc(t("Pause"))}</button>
        <button id="r-stop">${esc(t("Close"))}</button>
      </div>
      <details id="r-video">
        <summary>${esc(t("Video"))}</summary>
        <div class="form">
          ${L(t("Shot"), '<select id="v-source"></select>', t("What the video films: the scene as it goes on from now (the camera's mode, the ship and its autopilot, the mission — as live), a take recorded live (● on the time bar), a camera move, or the director's cameras"))}
          <div class="pair">
            ${L(t("Duration [s]"), '<input id="v-duration" type="number" min="1" max="600" step="1" value="24" />')}
            ${L(t("Frame rate"), '<select id="v-fps"></select>')}
          </div>
          <div class="pair">
            ${L(t("Time"), '<select id="v-rate"></select>', t("The scene's time during the video: the live warp, another one, or frozen (the camera moves in a still instant)"))}
            ${L(t("Shutter"), '<select id="v-shutter"></select>', t("Motion blur of the flow: exposure as a fraction of the frame interval"))}
          </div>
          ${L(t("Format"), '<select id="v-format"></select>', t("MP4 (H.264) plays everywhere; WebM (VP9) is open — the other one when this browser cannot encode it"))}
          <label class="check" title="${esc(t("After the video, the scene returns to where it was (else it goes on from the video's end)"))}"><input id="v-restore" type="checkbox" checked /> ${esc(t("Return to the start afterwards"))}</label>
          <div id="v-note" class="note"></div>
        </div>
        <div class="actions">
          <button id="v-draft" title="${esc(t("640×360, 4 samples: the shot and its timing in seconds, before the final render"))}">${esc(t("Draft"))}</button>
          <button id="v-start" class="primary">${esc(t("Render video"))}</button>
          <button id="v-stop">${esc(t("Stop"))}</button>
        </div>
      </details>
      <div class="actions exports">
        <span>${esc(t("Export"))}</span>
        <button id="r-png" title="${esc(t("8-bit sRGB, tone-mapped"))}">PNG</button>
        <button id="r-png16" title="${esc(t("16 bits per channel sRGB, tone-mapped, no dithering"))}">${esc(t("PNG 16-bit"))}</button>
        <button id="r-exr" title="${esc(t("Linear scene radiance (half float), no bloom / tone mapping"))}">${esc(t("EXR (HDR)"))}</button>
      </div>`;
  document.body.append(sec);
  return sec;
}

/**
 * "Offline" render: the current scene frozen in time, rendered at any resolution over as many
 * frames as needed (bands of rows, progressive passes), with reference integration settings.
 */
export function setupRenderDialog(d: DialogDeps) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = document.getElementById("render") ?? mountPanel();
  const resSel = $<HTMLSelectElement>("r-res");
  const wIn = $<HTMLInputElement>("r-w");
  const hIn = $<HTMLInputElement>("r-h");
  const sppSel = $<HTMLSelectElement>("r-spp");
  const intSel = $<HTMLSelectElement>("r-int");
  const noiseSel = $<HTMLSelectElement>("r-noise");
  const shutterIn = $<HTMLInputElement>("r-shutter");
  const budgetSel = $<HTMLSelectElement>("r-budget");
  const bar = $<HTMLElement>("r-bar");
  const status = $<HTMLElement>("r-status");
  const btnStart = $<HTMLButtonElement>("r-start");
  const btnPause = $<HTMLButtonElement>("r-pause");
  const btnStop = $<HTMLButtonElement>("r-stop");
  const exports = [$<HTMLButtonElement>("r-png"), $<HTMLButtonElement>("r-png16"), $<HTMLButtonElement>("r-exr")];
  const presetSel = $<HTMLSelectElement>("r-preset");
  const videoBox = $<HTMLDetailsElement>("r-video");
  const vSource = $<HTMLSelectElement>("v-source");
  const vDuration = $<HTMLInputElement>("v-duration");
  const vFps = $<HTMLSelectElement>("v-fps");
  const vRate = $<HTMLSelectElement>("v-rate");
  const vRestore = $<HTMLInputElement>("v-restore");
  const vNote = $<HTMLElement>("v-note");
  const vShutter = $<HTMLSelectElement>("v-shutter");
  const vFormat = $<HTMLSelectElement>("v-format");
  const vDraft = $<HTMLButtonElement>("v-draft");
  const vStart = $<HTMLButtonElement>("v-start");
  const vStop = $<HTMLButtonElement>("v-stop");

  const fill = (sel: HTMLSelectElement, opts: string[], selected: string) => {
    sel.innerHTML = opts.map((o) => `<option value="${o}"${o === selected ? " selected" : ""}>${OPTION_TEXT[o] ?? o}</option>`).join("");
  };
  fill(resSel, Object.keys(RESOLUTIONS), "Full HD 1920×1080");
  fill(sppSel, ["16", "64", "256", "1024", "4096"], "256");
  fill(intSel, Object.keys(INTEGRATORS), "High · Dormand–Prince, tol 1e-5");
  fill(noiseSel, ["off", "0.2 %", "0.5 %", "1 %", "2 %"], "0.5 %");
  fill(budgetSel, Object.keys(BUDGETS), "Balanced (80 ms/frame)");
  fill(presetSel, Object.keys(PRESETS), "Custom");
  fill(vFps, ["24", "30", "60"], "24");
  fill(vShutter, Object.keys(SHUTTERS), "180° (half a frame)");
  vFormat.innerHTML = `<option value="mp4">${t("MP4 · H.264")}</option><option value="webm">${t("WebM · VP9")}</option>`;

  presetSel.onchange = () => {
    const p = PRESETS[presetSel.value];
    if (!p) return;
    resSel.value = p.res;
    // mega photo: fall back to the largest resolution this GPU can hold
    const max = d.renderer.maxRender;
    const fits = (r: [number, number] | null) => !!r && r[0] <= max.dimension && r[1] <= max.dimension && r[0] * r[1] <= max.pixels;
    if (!fits(RESOLUTIONS[p.res] ?? null)) {
      resSel.value = ["5K 5120×2880", "4K UHD 3840×2160", "QHD 2560×1440"].find((k) => fits(RESOLUTIONS[k]!)) ?? "Full HD 1920×1080";
    }
    sppSel.value = p.spp;
    intSel.value = p.integ;
    noiseSel.value = p.noise;
    budgetSel.value = p.budget;
    shutterIn.value = "0";
    videoBox.open = !!p.video;
    syncSize();
  };
  // a hand edit leaves the preset
  for (const el of [resSel, sppSel, intSel, noiseSel, budgetSel]) el.addEventListener("change", () => (presetSel.value = "Custom"));

  let size: [number, number] = [1920, 1080];
  const syncSize = () => {
    const preset = RESOLUTIONS[resSel.value];
    if (resSel.value === "Viewport") size = [d.renderer.size.width, d.renderer.size.height];
    else if (preset) size = preset;
    else size = [Math.max(16, Number(wIn.value) | 0), Math.max(16, Number(hIn.value) | 0)];
    wIn.value = String(size[0]);
    hIn.value = String(size[1]);
    const custom = resSel.value === "Custom";
    wIn.disabled = hIn.disabled = !custom;
    const max = d.renderer.maxRender;
    const tooBig = size[0] > max.dimension || size[1] > max.dimension || size[0] * size[1] > max.pixels;
    const mem = (size[0] * size[1] * 24 * 1.5) / 2 ** 20;
    status.textContent = tooBig
      ? `⚠ ${tf("{0} exceeds this GPU's limits (max {1}px, {2} Mpx)", `${size[0]}×${size[1]}`, max.dimension, (max.pixels / 1e6).toFixed(0))}`
      : tf("{0} Mpx · ≈{1} MB of GPU memory", ((size[0] * size[1]) / 1e6).toFixed(1), mem.toFixed(0));
    btnStart.disabled = tooBig;
  };
  resSel.onchange = syncSize;
  wIn.onchange = hIn.onchange = syncSize;

  // (a capture: the picture saved by itself once converged — the pause menu's, the bar's, TARS's; the box keeps
  // the choice for a render started by hand)
  const autoBox = document.createElement("input");
  autoBox.type = "checkbox";
  autoBox.id = "r-autosave";
  {
    const label = document.createElement("label");
    label.className = "check";
    label.title = t("Once the render has converged, the PNG is saved without a click");
    label.append(autoBox, ` ${t("Save the PNG when done")}`);
    status.after(label);
  }
  /** what the render saves by itself once converged; whether it has */
  let autoSave: "png" | "png16" | "exr" | null = null;
  let autoSaved = false;
  /** a capture's own choice for the start it asks (undefined: the box's) */
  let captureSave: "png" | "png16" | "exr" | null | undefined;

  let active = false;
  /** the offline render paused (its button: Resume) */
  let offPaused = false;
  const setActive = (a: boolean) => {
    active = a;
    btnPause.disabled = !a;
    btnStop.textContent = t("Close");
    btnStop.disabled = !a;
    for (const b of exports) b.disabled = !a;
    for (const el of [resSel, wIn, hIn, sppSel, intSel, noiseSel, shutterIn]) el.disabled = a;
    if (!a) syncSize();
    d.onActiveChange(a);
  };

  const options = (): OfflineOptions => {
    const integ = INTEGRATORS[intSel.value]!;
    const noise = noiseSel.value === "off" ? 0 : parseFloat(noiseSel.value) / 100;
    return {
      width: size[0],
      height: size[1],
      spp: Number(sppSel.value),
      tolerance: integ.tolerance,
      eps: integ.eps,
      maxSteps: integ.maxSteps,
      noiseThreshold: noise,
      minSpp: 16,
      shutter: Math.max(0, Number(shutterIn.value) || 0),
      budgetMs: BUDGETS[budgetSel.value]!,
    };
  };

  btnStart.onclick = () => {
    if (video) return void (status.textContent = `⚠ ${t("A video is rendering: stop it first")}`);
    const busy = d.busy?.();
    if (busy) return void (status.textContent = `⚠ ${busy}`);
    syncSize();
    const integ = INTEGRATORS[intSel.value]!;
    const noise = noiseSel.value === "off" ? 0 : parseFloat(noiseSel.value) / 100;
    const opts: OfflineOptions = {
      width: size[0],
      height: size[1],
      spp: Number(sppSel.value),
      tolerance: integ.tolerance,
      eps: integ.eps,
      maxSteps: integ.maxSteps,
      noiseThreshold: noise,
      minSpp: 16,
      shutter: Math.max(0, Number(shutterIn.value) || 0),
      budgetMs: BUDGETS[budgetSel.value]!,
    };
    d.renderer.startOffline(d.settings, d.time(), opts);
    autoSave = captureSave !== undefined ? captureSave : autoBox.checked ? "png" : null;
    captureSave = undefined;
    autoSaved = false;
    offPaused = false;
    btnPause.textContent = t("Pause");
    btnStart.textContent = t("Restart");
    setActive(true);
  };
  btnPause.onclick = () => {
    offPaused = !offPaused;
    d.renderer.pauseOffline(offPaused);
    btnPause.textContent = offPaused ? t("Resume") : t("Pause");
  };
  btnStop.onclick = () => {
    autoSave = null;
    d.renderer.cancelOffline();
    btnStart.textContent = t("Start render");
    bar.style.width = "0%";
    setActive(false);
  };
  budgetSel.onchange = () => d.renderer.setOfflineBudget(BUDGETS[budgetSel.value]!);

  // ------------------------------------------------------------------ video
  // Each frame is an offline render of the scene at that frame. The shot either goes on from now with
  // the simulation's own step (sim.ts: the camera's mode, the ship and its autopilots, the mission, the
  // cinematics, the director's cameras — as live, the user's keys left out), or replays a take recorded live
  // (take.ts). Frames are encoded (H.264 in an MP4, else VP9 in a WebM) as they come; the scene returns to where
  // it was afterwards. A draft: the same shot small, at 4 samples, the fixed-step integrator — tested in seconds.
  let video: (VideoState & { stop: boolean; label: string; started: number }) | null = null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  vStop.disabled = true;
  vStop.onclick = () => {
    if (video) video.stop = true;
  };
  /** the shots: their names, whether they can film now */
  const shots = () =>
    SHOT_IDS.map((id) => ({
      id,
      label:
        id === "take"
          ? d.take.ready
            ? tf("Recorded take ({0} s)", d.take.seconds.toFixed(1))
            : t("Recorded take (none yet: ● on the time bar)")
          : SHOTS[id],
      available: id === "take" ? d.take.ready : id === "director" ? !!d.director?.available() : true,
    }));
  const fillShots = () => {
    const keep = vSource.value as Shot;
    const list = shots();
    vSource.innerHTML = list.map((x) => `<option value="${x.id}"${x.available ? "" : " disabled"}>${esc(x.label)}</option>`).join("");
    vSource.value = list.find((x) => x.id === keep)?.available ? keep : d.take.ready ? "take" : "live";
    const s = d.settings;
    const rt = realTimeSpeed(s);
    const rates = warpLadder(s).filter((w) => w !== s.timeSpeed);
    const keepRate = vRate.value;
    vRate.innerHTML = [
      `<option value="live">${tf("As live · {0}", fmtWarp(s, false))}</option>`,
      `<option value="0">${t("Frozen · bullet time")}</option>`,
      ...rates.reverse().map((w) => `<option value="${w}">${fmtFactor(w / rt)} · ${+w.toPrecision(3)} M/s</option>`),
    ].join("");
    vRate.value = [...vRate.options].some((o) => o.value === keepRate) ? keepRate : "live";
    syncShot();
  };
  const syncShot = () => {
    const take = vSource.value === "take";
    vRate.disabled = take || !!video;
    if (take) vDuration.value = d.take.seconds.toFixed(1);
    vDuration.disabled = take || !!video;
    vDraft.disabled = vStart.disabled = !!video;
    vStop.disabled = !video;
    vNote.textContent = take
      ? t("The take replays what you did live — camera, ship, time — at the video's frame rate.")
      : vSource.value === "live"
        ? t("The scene goes on from now as it would live: the camera's mode, the ship and its autopilot, the mission, the time.")
        : vSource.value === "director"
          ? t("The director's cameras film the ship flown: chase, orbit, pass, tracking — the cuts its own.")
          : vRate.value === "0"
            ? t("Time frozen: the camera moves through a still instant.")
            : "";
  };
  vSource.onchange = syncShot;
  vRate.onchange = syncShot;
  videoBox.addEventListener("toggle", () => videoBox.open && fillShots());

  /** Waits for the offline frame, then encodes it. */
  const encodeFrame = async (run: { stop: boolean }, writer: VideoWriter, opts: OfflineOptions, time: number) => {
    d.renderer.startOffline(d.settings, time, opts);
    while (!d.renderer.offlineState?.done && !run.stop) {
      if (d.renderer.offlineState?.error) throw new Error(d.renderer.offlineState.error);
      if (!d.renderer.offlineActive) throw new Error("Render cancelled");
      await sleep(20);
    }
    if (run.stop) return;
    const px = await d.renderer.exportRGBA(d.settings);
    await writer.addFrame(px.data, px.width, px.height);
  };

  /** The dialog's fields as a video asked. */
  const formJob = (draft: boolean): VideoJob => ({
    shot: vSource.value as Shot,
    seconds: Number(vDuration.value) || 24,
    fps: Number(vFps.value),
    rate: vRate.value === "live" ? "live" : Number(vRate.value),
    shutter: SHUTTERS[vShutter.value] ?? 0,
    draft,
    format: vFormat.value as VideoFormat,
    restore: vRestore.checked,
  });
  vStart.onclick = () => {
    const why = startVideo(formJob(false));
    if (why) status.textContent = `⚠ ${why}`;
  };
  vDraft.onclick = () => {
    const why = startVideo(formJob(true));
    if (why) status.textContent = `⚠ ${why}`;
  };

  /** A video started (the dialog's, the photo bar's, TARS's): why not, or null — it renders on, its end told by
   *  onVideo (else downloaded). */
  function startVideo(job: VideoJob): string | null {
    if (video) return t("A video is rendering: stop it first");
    const busy = d.busy?.();
    if (busy) return busy;
    if (job.shot === "take" && !d.take.ready) return t("No take recorded yet: ● on the time bar");
    if (job.shot === "director" && !d.director?.available()) return t("The director's cameras film a ship flown: fly one first (F1)");
    // (a picture rendered or rendering: given way — the video takes the renderer)
    if (active) {
      autoSave = null;
      d.renderer.cancelOffline();
    }
    void runVideo(job);
    return null;
  }

  async function runVideo(job: VideoJob) {
    syncSize();
    const shot = job.shot;
    const draft = !!job.draft;
    const fw = size[0] & ~1;
    const fh = size[1] & ~1;
    const [w, h] = draft ? draftSize(fw, fh) : [fw, fh];
    const fps = job.fps ?? 24;
    const seconds = shot === "take" ? d.take.seconds : Math.min(600, Math.max(1, job.seconds ?? 24));
    let n = shot === "take" ? 0 : videoFrames(seconds, fps);
    const run: NonNullable<typeof video> = {
      shot,
      draft,
      format: null,
      width: w,
      height: h,
      frame: 0,
      frames: n,
      etaS: Number.NaN,
      stop: false,
      label: "",
      started: performance.now(),
    };
    video = run;
    setActive(true);
    syncShot();
    const cfg = await VideoWriter.supported(w, h, fps, job.format ?? "mp4");
    if (!cfg) {
      video = null;
      setActive(false);
      syncShot();
      status.textContent = `⚠ ${tf("this browser cannot encode a video at {0}", `${w}×${h}`)}`;
      return;
    }
    const writer = new VideoWriter(cfg, fps);
    run.format = writer.format;
    const s = d.settings;
    const cam = d.camera;
    const sim = d.sim;
    const before = job.restore !== false ? d.snapshot() : null;
    const undoDirector = shot === "director" ? d.director?.set() : undefined;
    const shutter = job.shutter ?? 0.5;
    const base: OfflineOptions = draft
      ? {
          width: w,
          height: h,
          spp: DRAFT_SPP,
          tolerance: 0,
          eps: 0.02,
          maxSteps: 6000,
          noiseThreshold: 0,
          minSpp: DRAFT_SPP,
          shutter: 0,
          budgetMs: BUDGETS["Turbo (250 ms/frame)"]!,
        }
      : { ...options(), width: w, height: h };
    let error = "";
    const label = (i: number) => {
      const per = i > 0 ? (performance.now() - run.started) / 1000 / i : Number.NaN;
      run.frame = i;
      run.frames = n;
      run.etaS = per * (n - i);
      run.label = `🎞 ${draft ? `${t("draft")} · ` : ""}${tf("frame {0} / {1} · ETA {2}", i + 1, n, fmtDuration(run.etaS))} · `;
    };
    try {
      if (shot === "take") {
        // the take: each video frame, the recorded frame nearest its time
        let prevTime = Number.NaN;
        for (const f of d.take.play(fps)) {
          if (run.stop) break;
          n = f.n;
          label(f.i);
          Object.assign(s, f.settings);
          d.applyState(f.state);
          const dtM = Number.isFinite(prevTime) ? Math.abs(f.state.time - prevTime) : 0;
          prevTime = f.state.time;
          await encodeFrame(run, writer, { ...base, shutter: draft ? 0 : shutter * dtM }, f.state.time);
        }
      } else {
        // the scene goes on: the simulation's step (1/60 s at most), the user's inputs left out
        const rate = job.rate === undefined || job.rate === "live" ? s.timeSpeed : job.rate;
        const frozen = rate === 0;
        s.animate = !frozen;
        if (!frozen) s.timeSpeed = rate;
        cam.bulletTime = frozen;
        cam.scripted = true;
        if (shot === "orbit" || shot === "dive" || shot === "journey") {
          if (shot === "journey") s.journeyDuration = seconds; // (the journey fills the video)
          cam.enabled = true;
          cam.setCinematic(shot);
          cam.enabled = false;
        }
        let clock = 0;
        for (let i = 0; i < n && !run.stop; i++) {
          label(i);
          const frameT = i / fps;
          cam.enabled = true;
          while (clock < frameT - 1e-9) {
            const dt = Math.min(1 / 60, frameT - clock);
            sim.step(dt);
            clock += dt;
          }
          sim.applyRender(cam.piloting && !cam.cinematic ? cam.flightInfo() : null);
          cam.enabled = false;
          await encodeFrame(run, writer, { ...base, shutter: draft ? 0 : shutter * (frozen ? 0 : rate / fps) }, sim.time);
        }
      }
      if (!run.stop) {
        const blob = await writer.finish();
        const done: VideoDone = {
          job: { ...job, seconds, fps },
          blob,
          name: videoName(d.fileStem(), shot, seconds, fps, draft, VIDEO_EXT[writer.format]),
          shot,
          draft,
          format: writer.format,
          width: w,
          height: h,
          fps,
          frames: n,
          seconds,
        };
        if (d.onVideo) d.onVideo(done);
        else d.download(blob, done.name);
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      writer.close();
    }
    cam.scripted = false;
    cam.bulletTime = false;
    video = null;
    d.renderer.cancelOffline();
    btnStart.textContent = t("Start render");
    bar.style.width = "0%";
    if (shot === "orbit" || shot === "dive" || shot === "journey") {
      cam.enabled = true;
      cam.setCinematic(null);
    }
    undoDirector?.();
    if (before) d.restore(before);
    setActive(false);
    syncShot();
    status.textContent = error
      ? `⚠ ${tf("video failed: {0}", error)}`
      : run.stop
        ? t("video stopped")
        : `✔ ${tf("video saved · {0} frames in {1}", n, fmtDuration((performance.now() - run.started) / 1000))}`;
  }

  const stem = () => `${d.fileStem()}-${sppSel.value}spp`;
  const save = async (encode: () => Promise<Blob>, name: string) => {
    try {
      d.download(await encode(), name);
    } catch (error) {
      status.textContent = `⚠ ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const saveAs = (kind: "png" | "png16" | "exr") =>
    kind === "png"
      ? save(() => d.renderer.exportPNG(d.settings), `${stem()}.png`)
      : kind === "png16"
        ? save(() => d.renderer.exportPNG16(d.settings), `${stem()}-16bit.png`)
        : save(() => d.renderer.exportEXR(d.settings), `${stem()}-linear.exr`);
  exports[0]!.onclick = () => saveAs("png");
  exports[1]!.onclick = () => saveAs("png16");
  exports[2]!.onclick = () => saveAs("exr");

  /**
   * A capture (the pause menu's, the top bar's, TARS's): the view now, rendered offline at once with the dialog's
   * settings — or a preset, a size, the samples given —, saved by itself once converged. Why not, or null.
   */
  function capture(o: { preset?: string; width?: number; height?: number; spp?: number; save?: "png" | "png16" | "exr" | null } = {}) {
    if (video) return t("A video is rendering: stop it first");
    const busy = d.busy?.();
    if (busy) return busy;
    toggle(true);
    if (o.preset && o.preset in PRESETS) {
      presetSel.value = o.preset;
      presetSel.onchange?.(new Event("change"));
    }
    if (o.width && o.height) {
      resSel.value = "Custom";
      wIn.value = String(Math.round(o.width));
      hIn.value = String(Math.round(o.height));
    }
    if (o.spp) {
      // (the nearest offered at or above it)
      const offered = [...sppSel.options].map((x) => Number(x.value));
      sppSel.value = String(offered.find((v) => v >= o.spp!) ?? offered[offered.length - 1]);
    }
    syncSize();
    if (btnStart.disabled) return status.textContent;
    captureSave = o.save === undefined ? "png" : o.save;
    btnStart.click();
    return null;
  }
  $<HTMLButtonElement>("render-close").onclick = () => toggle(false);

  let unEscape: (() => void) | undefined;
  function toggle(show?: boolean) {
    const visible = show ?? panel.hidden;
    panel.hidden = !visible;
    unEscape?.();
    unEscape = visible ? onEscape(() => toggle(false)) : undefined;
    document.getElementById("btn-render")?.classList.toggle("active", visible || active);
    if (visible) {
      syncSize();
      if (!video) fillShots();
    }
  }

  setActive(false);
  syncSize();
  fillShots();

  return {
    toggle,
    capture,
    /** a kind of picture saved now; the render stopped */
    save: (kind: "png" | "png16" | "exr") => void saveAs(kind),
    stop: () => btnStop.click(),
    /** the render running, its size, whether it saves itself */
    state: () => ({ active, video: !!video, autoSave, width: size[0], height: size[1], spp: Number(sppSel.value) }),
    /** a video: started (why not, or null), its state, stopped; the shots and whether they can film now */
    startVideo,
    videoState: (): VideoState | null =>
      video
        ? {
            shot: video.shot,
            draft: video.draft,
            format: video.format,
            width: video.width,
            height: video.height,
            frame: video.frame,
            frames: video.frames,
            etaS: video.etaS,
          }
        : null,
    stopVideo: () => {
      if (video) video.stop = true;
    },
    shots,
    /** a take was recorded: offered as the video's shot */
    takeChanged: () => {
      if (video) return;
      fillShots();
      if (d.take.ready) {
        vSource.value = "take";
        syncShot();
      }
    },
    size: () => ({ width: size[0], height: size[1] }),
    update(st: OfflineStatus) {
      for (const b of exports) b.disabled = !!st.error;
      // (a capture converged: saved once)
      if (st.done && autoSave && !autoSaved && !video) {
        autoSaved = true;
        void saveAs(autoSave);
      }
      btnPause.disabled = !!st.error;
      if (st.error) {
        status.textContent = `⚠ ${st.error}`;
        return;
      }
      bar.style.width = `${(st.progress * 100).toFixed(2)}%`;
      bar.classList.toggle("done", st.done);
      const state = st.done ? `✔ ${t("done")}` : st.paused ? t("paused") : t("rendering");
      status.textContent =
        (video?.label ?? "") +
        `${state} · ${st.width}×${st.height} · ${st.spp.toFixed(1)} / ${st.targetSpp} spp · ` +
        `${(st.progress * 100).toFixed(1)} % · ${tf("elapsed {0}", fmtDuration(st.elapsed))}` +
        (st.done ? "" : ` · ${tf("ETA {0}", fmtDuration(st.eta))}`);
    },
  };
}
