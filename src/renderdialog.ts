import type { CameraController } from "./controls";
import type { OfflineOptions, OfflineStatus, Renderer } from "./renderer";
import type { Settings } from "./settings";
import { VideoWriter } from "./video";

const RESOLUTIONS: Record<string, [number, number] | null> = {
  "Viewport": null,
  "HD 1280×720": [1280, 720],
  "Full HD 1920×1080": [1920, 1080],
  "QHD 2560×1440": [2560, 1440],
  "4K UHD 3840×2160": [3840, 2160],
  "5K 5120×2880": [5120, 2880],
  "8K UHD 7680×4320": [7680, 4320],
  "Square 2048²": [2048, 2048],
  "Square 4096²": [4096, 4096],
  "Portrait 2160×3840": [2160, 3840],
  "Custom": null,
};

const INTEGRATORS: Record<string, { tolerance: number; eps: number; maxSteps: number }> = {
  "Reference · Dormand–Prince, tol 1e-6": { tolerance: 1e-6, eps: 0.02, maxSteps: 12000 },
  "High · Dormand–Prince, tol 1e-5": { tolerance: 1e-5, eps: 0.02, maxSteps: 8000 },
  "Draft · fixed-step RK4, ε 0.02": { tolerance: 0, eps: 0.02, maxSteps: 6000 },
};

/** Render presets: what each purpose needs from resolution, sampling and integration. */
const PRESETS: Record<string, { res: string; spp: string; integ: string; noise: string; budget: string; video?: boolean } | null> = {
  "Custom": null,
  // per frame: enough samples for a clean, temporally stable frame; fixed noise threshold so that
  // successive frames converge alike; motion blur (180° shutter) set in the Video section
  "Video · Full HD frames, motion blur": {
    res: "Full HD 1920×1080", spp: "64", integ: "High · Dormand–Prince, tol 1e-5", noise: "1 %", budget: "Turbo (250 ms/frame)", video: true,
  },
  // the largest resolution the GPU holds (8K if possible), reference integration, 1024 spp
  "Mega photo · 8K reference": {
    res: "8K UHD 7680×4320", spp: "1024", integ: "Reference · Dormand–Prince, tol 1e-6", noise: "0.2 %", budget: "Turbo (250 ms/frame)",
  },
};

const VIDEO_SOURCES: Record<string, "journey" | "orbit" | null> = {
  "Journey through the wormhole (T)": "journey",
  "Cinematic orbit (O)": "orbit",
  "Current view, time running": null,
};
const SHUTTERS: Record<string, number> = { "Off": 0, "180° (half a frame)": 0.5, "360° (whole frame)": 1 };

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
  time: () => number;
  download: (blob: Blob, name: string) => void;
  fileStem: () => string;
  onActiveChange: (active: boolean) => void;
  camera: CameraController;
}

/**
 * "Offline" render: the current scene frozen in time, rendered at any resolution over as many
 * frames as needed (bands of rows, progressive passes), with reference integration settings.
 */
export function setupRenderDialog(d: DialogDeps) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $<HTMLElement>("render");
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
  const vRate = $<HTMLInputElement>("v-rate");
  const vShutter = $<HTMLSelectElement>("v-shutter");
  const vStart = $<HTMLButtonElement>("v-start");
  const vStop = $<HTMLButtonElement>("v-stop");

  const fill = (sel: HTMLSelectElement, opts: string[], selected: string) => {
    sel.innerHTML = opts.map((o) => `<option${o === selected ? " selected" : ""}>${o}</option>`).join("");
  };
  fill(resSel, Object.keys(RESOLUTIONS), "Full HD 1920×1080");
  fill(sppSel, ["16", "64", "256", "1024", "4096"], "256");
  fill(intSel, Object.keys(INTEGRATORS), "High · Dormand–Prince, tol 1e-5");
  fill(noiseSel, ["off", "0.2 %", "0.5 %", "1 %", "2 %"], "0.5 %");
  fill(budgetSel, Object.keys(BUDGETS), "Balanced (80 ms/frame)");
  fill(presetSel, Object.keys(PRESETS), "Custom");
  fill(vSource, Object.keys(VIDEO_SOURCES), "Journey through the wormhole (T)");
  fill(vFps, ["24", "30", "60"], "24");
  fill(vShutter, Object.keys(SHUTTERS), "180° (half a frame)");

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
      ? `⚠ ${size[0]}×${size[1]} exceeds this GPU's limits (max ${max.dimension}px, ${(max.pixels / 1e6).toFixed(0)} Mpx)`
      : `${(size[0] * size[1] / 1e6).toFixed(1)} Mpx · ≈${mem.toFixed(0)} MB of GPU memory`;
    btnStart.disabled = tooBig;
  };
  resSel.onchange = syncSize;
  wIn.onchange = hIn.onchange = syncSize;

  let active = false;
  const setActive = (a: boolean) => {
    active = a;
    btnPause.disabled = !a;
    btnStop.textContent = a ? "Close" : "Close";
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
    btnPause.textContent = "Pause";
    btnStart.textContent = "Restart";
    setActive(true);
  };
  btnPause.onclick = () => {
    const paused = btnPause.textContent === "Pause";
    d.renderer.pauseOffline(paused);
    btnPause.textContent = paused ? "Resume" : "Pause";
  };
  btnStop.onclick = () => {
    d.renderer.cancelOffline();
    btnStart.textContent = "Start render";
    bar.style.width = "0%";
    setActive(false);
  };
  budgetSel.onchange = () => d.renderer.setOfflineBudget(BUDGETS[budgetSel.value]!);

  // ------------------------------------------------------------------ video
  // Each frame is an offline render at the frame's time (the flow turns, the star orbits), with the
  // camera advanced by the chosen cinematic; frames are encoded to H.264 in an MP4 as they come.
  let video: { stop: boolean; label: string } | null = null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  vStop.disabled = true;
  vStop.onclick = () => {
    if (video) video.stop = true;
  };
  vStart.onclick = async () => {
    if (video) return;
    syncSize();
    const w = size[0] & ~1;
    const h = size[1] & ~1;
    const fps = Number(vFps.value);
    const duration = Math.min(600, Math.max(1, Number(vDuration.value) || 24));
    const rate = Math.max(0, Number(vRate.value) || 0);
    const cfg = await VideoWriter.supported(w, h, fps);
    if (!cfg) {
      status.textContent = `⚠ this browser cannot encode H.264 at ${w}×${h}`;
      return;
    }
    const writer = new VideoWriter(cfg, fps);
    const run = (video = { stop: false, label: "" });
    vStart.disabled = true;
    vStop.disabled = false;
    setActive(true);
    const cam = d.camera;
    const source = VIDEO_SOURCES[vSource.value] ?? null;
    const savedJourney = d.settings.journeyDuration;
    if (source === "journey") d.settings.journeyDuration = duration; // the journey fills the video
    cam.enabled = true;
    cam.setCinematic(source);
    cam.enabled = false;
    const t0 = d.time();
    const n = Math.round(duration * fps);
    const opts = { ...options(), width: w, height: h, shutter: (SHUTTERS[vShutter.value] ?? 0) * (rate / fps) };
    const started = performance.now();
    let camTime = 0;
    let error = "";
    try {
      for (let i = 0; i < n && !run.stop; i++) {
        const tf = i / fps;
        cam.enabled = true;
        while (camTime < tf - 1e-9) {
          const dt = Math.min(1 / 120, tf - camTime);
          cam.update(dt);
          camTime += dt;
        }
        cam.enabled = false;
        d.renderer.startOffline(d.settings, t0 + tf * rate, opts);
        const per = i > 0 ? (performance.now() - started) / 1000 / i : NaN;
        run.label = `🎞 frame ${i + 1} / ${n} · ETA ${fmtDuration(per * (n - i))} · `;
        while (!d.renderer.offlineState?.done && !run.stop) await sleep(20);
        if (run.stop) break;
        const px = await d.renderer.exportRGBA(d.settings);
        await writer.addFrame(px.data, px.width, px.height);
      }
      if (!run.stop) {
        const blob = await writer.finish();
        d.download(blob, `${d.fileStem()}-${duration}s-${fps}fps.mp4`);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    video = null;
    vStart.disabled = false;
    vStop.disabled = true;
    d.renderer.cancelOffline();
    btnStart.textContent = "Start render";
    bar.style.width = "0%";
    setActive(false);
    cam.setCinematic(null);
    d.settings.journeyDuration = savedJourney;
    status.textContent = error ? `⚠ video failed: ${error}` : run.stop ? "video stopped" : `✔ video saved · ${n} frames in ${fmtDuration((performance.now() - started) / 1000)}`;
  };

  const stem = () => `${d.fileStem()}-${sppSel.value}spp`;
  exports[0]!.onclick = async () => d.download(await d.renderer.exportPNG(d.settings), `${stem()}.png`);
  exports[1]!.onclick = async () => d.download(await d.renderer.exportPNG16(d.settings), `${stem()}-16bit.png`);
  exports[2]!.onclick = async () => d.download(await d.renderer.exportEXR(d.settings), `${stem()}-linear.exr`);
  $<HTMLButtonElement>("render-close").onclick = () => toggle(false);

  function toggle(show?: boolean) {
    const visible = show ?? panel.hidden;
    panel.hidden = !visible;
    document.getElementById("btn-render")?.classList.toggle("active", visible || active);
    if (visible) syncSize();
  }

  setActive(false);
  syncSize();

  return {
    toggle,
    size: () => ({ width: size[0], height: size[1] }),
    update(st: OfflineStatus) {
      bar.style.width = `${(st.progress * 100).toFixed(2)}%`;
      bar.classList.toggle("done", st.done);
      const state = st.done ? "✔ done" : st.paused ? "paused" : "rendering";
      status.textContent = (video?.label ?? "") +
        `${state} · ${st.width}×${st.height} · ${st.spp.toFixed(1)} / ${st.targetSpp} spp · ` +
        `${(st.progress * 100).toFixed(1)} % · elapsed ${fmtDuration(st.elapsed)}` +
        (st.done ? "" : ` · ETA ${fmtDuration(st.eta)}`);
    },
  };
}
