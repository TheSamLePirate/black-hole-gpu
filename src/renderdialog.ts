import type { CameraController } from "./controls";
import type { OfflineOptions, OfflineStatus, Renderer } from "./renderer";
import type { Settings } from "./settings";
import type { Simulation } from "./sim";
import type { Take, TakeState } from "./take";
import { fmtFactor, fmtWarp, realTimeSpeed, warpLadder } from "./clock";
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

/** The video's shots: the scene going on from now (as live), a recorded take, or a cinematic. */
const SHOTS = {
  live: "Live: the scene goes on from now",
  take: "Recorded take",
  orbit: "Cinematic orbit around the target",
  journey: "Journey through the wormhole",
  dive: "Dive to the horizon",
} as const;
type Shot = keyof typeof SHOTS;
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
  const vRate = $<HTMLSelectElement>("v-rate");
  const vRestore = $<HTMLInputElement>("v-restore");
  const vNote = $<HTMLElement>("v-note");
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
  // Each frame is an offline render of the scene at that frame. The shot either goes on from now with
  // the simulation's own step (sim.ts: the camera's mode, the ship and its autopilots, the mission, the
  // cinematics — as live, the user's keys left out), or replays a take recorded live (take.ts). Frames
  // are encoded to H.264 in an MP4 as they come; the scene returns to where it was afterwards.
  let video: { stop: boolean; label: string } | null = null;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  vStop.disabled = true;
  vStop.onclick = () => {
    if (video) video.stop = true;
  };
  /** the shots: their names, what they need */
  const fillShots = () => {
    const take = d.take.ready ? `Recorded take (${d.take.seconds.toFixed(1)} s)` : "Recorded take (none yet: ● on the time bar)";
    const keep = vSource.value;
    vSource.innerHTML = (Object.keys(SHOTS) as Shot[])
      .map((k) => `<option value="${k}"${k === "take" && !d.take.ready ? " disabled" : ""}>${k === "take" ? take : SHOTS[k]}</option>`)
      .join("");
    vSource.value = keep && !(keep === "take" && !d.take.ready) ? keep : d.take.ready ? "take" : "live";
    const s = d.settings;
    const rt = realTimeSpeed(s);
    const rates = warpLadder(s).filter((w) => w !== s.timeSpeed);
    const keepRate = vRate.value;
    vRate.innerHTML = [`<option value="live">As live · ${fmtWarp(s, false)}</option>`, `<option value="0">Frozen · bullet time</option>`,
      ...rates.reverse().map((w) => `<option value="${w}">${fmtFactor(w / rt)} · ${+w.toPrecision(3)} M/s</option>`)].join("");
    vRate.value = [...vRate.options].some((o) => o.value === keepRate) ? keepRate : "live";
    syncShot();
  };
  const syncShot = () => {
    const take = vSource.value === "take";
    vRate.disabled = take || !!video;
    if (take) vDuration.value = d.take.seconds.toFixed(1);
    vDuration.disabled = take || !!video;
    vNote.textContent = take
      ? "The take replays what you did live — camera, ship, time — at the video's frame rate."
      : vSource.value === "live"
        ? "The scene goes on from now as it would live: the camera's mode, the ship and its autopilot, the mission, the time."
        : vRate.value === "0" ? "Time frozen: the camera moves through a still instant." : "";
  };
  vSource.onchange = syncShot;
  vRate.onchange = syncShot;
  videoBox.addEventListener("toggle", () => videoBox.open && fillShots());

  /** Waits for the offline frame, then encodes it. */
  const encodeFrame = async (run: { stop: boolean }, writer: VideoWriter, opts: OfflineOptions, time: number) => {
    d.renderer.startOffline(d.settings, time, opts);
    while (!d.renderer.offlineState?.done && !run.stop) await sleep(20);
    if (run.stop) return;
    const px = await d.renderer.exportRGBA(d.settings);
    await writer.addFrame(px.data, px.width, px.height);
  };

  vStart.onclick = async () => {
    if (video) return;
    syncSize();
    const w = size[0] & ~1;
    const h = size[1] & ~1;
    const fps = Number(vFps.value);
    const shot = vSource.value as Shot;
    if (shot === "take" && !d.take.ready) return;
    const duration = shot === "take" ? d.take.seconds : Math.min(600, Math.max(1, Number(vDuration.value) || 24));
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
    syncShot();
    const s = d.settings;
    const cam = d.camera;
    const sim = d.sim;
    const before = vRestore.checked ? d.snapshot() : null;
    const shutter = SHUTTERS[vShutter.value] ?? 0;
    const base = { ...options(), width: w, height: h };
    const started = performance.now();
    let n = Math.round(duration * fps);
    let error = "";
    const label = (i: number) => {
      const per = i > 0 ? (performance.now() - started) / 1000 / i : NaN;
      run.label = `🎞 frame ${i + 1} / ${n} · ETA ${fmtDuration(per * (n - i))} · `;
    };
    try {
      if (shot === "take") {
        // the take: each video frame, the recorded frame nearest its time
        let prevTime = NaN;
        for (const f of d.take.play(fps)) {
          if (run.stop) break;
          n = f.n;
          label(f.i);
          Object.assign(s, f.settings);
          d.applyState(f.state);
          const dtM = Number.isFinite(prevTime) ? Math.abs(f.state.time - prevTime) : 0;
          prevTime = f.state.time;
          await encodeFrame(run, writer, { ...base, shutter: shutter * dtM }, f.state.time);
        }
      } else {
        // the scene goes on: the simulation's step (1/60 s at most), the user's inputs left out
        const rate = vRate.value === "live" ? s.timeSpeed : Number(vRate.value);
        const frozen = rate === 0;
        s.animate = !frozen;
        if (!frozen) s.timeSpeed = rate;
        cam.bulletTime = frozen;
        cam.scripted = true;
        if (shot !== "live") {
          if (shot === "journey") s.journeyDuration = duration; // (the journey fills the video)
          cam.enabled = true;
          cam.setCinematic(shot);
          cam.enabled = false;
        }
        let clock = 0;
        for (let i = 0; i < n && !run.stop; i++) {
          label(i);
          const tf = i / fps;
          cam.enabled = true;
          while (clock < tf - 1e-9) {
            const dt = Math.min(1 / 60, tf - clock);
            sim.step(dt);
            clock += dt;
          }
          sim.applyRender(cam.piloting && !cam.cinematic ? cam.flightInfo() : null);
          cam.enabled = false;
          await encodeFrame(run, writer, { ...base, shutter: shutter * (frozen ? 0 : rate / fps) }, sim.time);
        }
      }
      if (!run.stop) {
        const blob = await writer.finish();
        d.download(blob, `${d.fileStem()}-${shot}-${duration.toFixed(0)}s-${fps}fps.mp4`);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    cam.scripted = false;
    cam.bulletTime = false;
    video = null;
    vStart.disabled = false;
    vStop.disabled = true;
    d.renderer.cancelOffline();
    btnStart.textContent = "Start render";
    bar.style.width = "0%";
    if (shot !== "live" && shot !== "take") {
      cam.enabled = true;
      cam.setCinematic(null);
    }
    if (before) d.restore(before);
    setActive(false);
    syncShot();
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
