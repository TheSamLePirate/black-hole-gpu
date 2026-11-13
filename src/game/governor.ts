// The resolution governor (audit 2026-11-10, AR-12 — main() cut by responsibility, wave 4.8, its last lot; the render session's
// levers, handed over to be moved as they are — 13 Nov 2026): the render scale in motion and held (dynamic resolution, the raster's
// own scale), the frame time measured at each scale, the hardware tier promoted or demoted on what it measures, the near Earth's
// raster pipeline given up for the traced one when too heavy and taken back when that is no faster. Out of main.ts's loop as it
// was there — the same rules, the same thresholds, the same order —, this module owning the state only it decides on; main's
// resize() reads the scale it chose.

import { t } from "../i18n";
import { demotionEligible, dynamicResolutionOn, promotionEligible } from "../quality-policy";
import type { Renderer } from "../renderer";
import type { Settings } from "../settings";
import { adapterId, cappedRatio, demoted, promoted, rememberLevel } from "../tier";

export interface GovernorDeps {
  renderer: Renderer;
  settings: Settings;
  canvas: HTMLCanvasElement;
  /** the canvas and the renderer's targets made at the scale chosen (main.ts's resize, which reads `renderScale`) */
  resize(): void;
  toast(text: string): void;
  /** a Kerr Bench running: no tier changed meanwhile */
  benching(): boolean;
}

export class Governor {
  // dynamic resolution: a fraction of the pixel ratio (1: as set), lowered when the GPU cannot keep
  // the frame budget with the subsampling already coarse, raised back when it has room. In motion only:
  // the camera held, the image refines at the full scale (the moving one kept for the next move)
  renderScale = 1;
  /** a scale held by the automation: the benches, the tests */
  forcedScale: number | null = null;
  /** the scale the motion had, while the camera is held at the full one; 0: none */
  movingScale = 0;
  /** how long the camera has been held [s]: a pause between two inputs is not */
  heldFor = 0;
  /** how long it has moved again [s]: a resize's own fresh frame is not a move */
  movingFor = 0;
  gpuEma = 0;
  scaleTimer = 0;
  // the frame time measured at each scale (remembered 30 s, then tried again): a lower scale only when
  // it pays — the frame may be bound elsewhere (the browser's compositing), where a smaller image is
  // no faster, only blurrier
  scaleMs = new Map<number, { ms: number; at: number }>();
  /** how long the scale has held [s]: its first frames, the targets made anew, are not its measure */
  scaleHeld = 0;
  measuredFrames = 0;
  calibrationWasReady = false;
  /** how long the GPU has idled with the image at the tier's pixel cap [s] */
  idleAtCap = 0;
  /** how long the GPU has been over budget at the coarsest block and smallest scale [s] */
  overAtFloor = 0;
  /** the last demotion [performance.now() ms]: no promotion for a minute after */
  demotedAt = -Infinity;
  /** how long the raster pipeline has been over budget at its floor [s]: the fallback to the traced one */
  rasterOver = 0;
  // (the fallback measured: the raster's frame time when it was given up [ms], how long the traced one has flown since [s];
  // renderer.rasterKept: the traced one proved no faster here — the raster kept, not given up again)
  rasterFellMs = 0;
  tracedFor = 0;

  constructor(private d: GovernorDeps) {}

  // (the raster pipeline draws the near Earth: its render scale in motion — earthRasterScale, 75 % by default, upscaled by
  // the display — is the motion's ceiling; the camera held, the full one: the refinement's)
  rasterOn() {
    return this.forcedScale === null && this.d.renderer.rasterPrimaryNow;
  }
  rasterTop() {
    return Math.max(0.5, Math.min(1, this.d.settings.earthRasterScale));
  }
  // (without the dynamic resolution, that scale itself in motion — with it, the governor's under it: below —; null: the scale
  // as the rest has it)
  // (moving: for 0.15 s — the frame after a resize is a realtime one whatever the camera does: taken for a move, it put the
  // motion's scale back, its resize made the next frame realtime again, and a held view went back and forth between the
  // two scales, its history lost at each, never refined; the same rule as the motion's scale given back, below)
  rasterScale(): number | null {
    const { renderer, settings } = this.d;
    return this.rasterOn() && !dynamicResolutionOn(settings) && settings.earthRasterScale < 1
      ? this.heldFor > 0.4 && !renderer.rasterHold
        ? 1
        : this.movingFor > 0.15
          ? this.rasterTop()
          : this.renderScale
      : null;
  }

  /** The scale resize() makes the targets at: a forced one first, the raster's, the canvas's without dynamic resolution. */
  scaleForResize(): number {
    const rs = this.rasterScale();
    // (a forced scale — __bh.forceScale, a measure's — first: the raster's own taken over it, the frame loop forced it back and called
    // resize again every frame — the targets made anew, the history lost at each, the image drawn at the raster's scale all along: every
    // forced scale but 0.75 measured 4–10 dB low — PLAN-J2 J2-6, 13 Nov 2026)
    if (this.forcedScale !== null) this.renderScale = this.forcedScale;
    else if (rs !== null) this.renderScale = rs;
    else if (!dynamicResolutionOn(this.d.settings)) this.renderScale = 1;
    return this.renderScale;
  }

  /** A scale held by the automation (__bh.forceScale; null: the governor's again). */
  force(x: number | null) {
    this.forcedScale = x === null ? null : Math.min(Math.max(x, 0.25), 1);
    if (this.forcedScale === null) this.renderScale = 1;
    this.d.resize();
  }

  /** A frame the GPU finished: its time in the scale's average (not a frame of the motion's denser rays). */
  measure() {
    const { renderer } = this.d;
    if (renderer.completedFrames !== this.measuredFrames) {
      this.measuredFrames = renderer.completedFrames;
      // (a frame of the motion's denser rays — Sharpness in motion, a turn —: not this scale's time; counted, a long
      // turn lowered the scale, and its 30 s memory then held it down after the turn)
      if (!renderer.lastFrameDense) this.gpuEma = this.gpuEma ? 0.9 * this.gpuEma + 0.1 * renderer.lastGpuMs : renderer.lastGpuMs;
    }
  }

  /** The frame's: the scale, the tier and the pipeline decided on what was measured (`phase`: the last frame's, held or moving). */
  tick(dt: number, phase: string | undefined) {
    const { renderer, settings, canvas } = this.d;
    const lastStats = phase === undefined ? null : { phase };
    // (a compile or a stream begun or ended: the timings measured afresh — the image untouched)
    const calibrationReady = renderer.calibrationReady;
    if (calibrationReady !== this.calibrationWasReady) {
      this.calibrationWasReady = calibrationReady;
      this.gpuEma = 0;
      this.scaleHeld = this.idleAtCap = this.overAtFloor = 0;
      this.scaleMs.clear();
      renderer.resetQualityTiming();
    }
    // (the camera held for 0.4 s: the full scale, the image refined there; moving again: the motion's)
    const held = lastStats?.phase === "converging" || lastStats?.phase === "converged";
    this.heldFor = held ? this.heldFor + dt : 0;
    this.movingFor = held ? 0 : this.movingFor + dt;
    const dynOn = dynamicResolutionOn(settings) && !renderer.offlineActive && this.forcedScale === null;
    const terrainInspecting = renderer.terrainRasterInspecting;
    if (this.forcedScale !== null && this.renderScale !== this.forcedScale) {
      this.renderScale = this.forcedScale;
      this.d.resize();
    }
    const rs = this.rasterScale();
    if (this.forcedScale === null && rs !== null && Math.abs(rs - this.renderScale) > 1e-3) {
      this.gpuEma = 0;
      this.scaleHeld = 0;
      this.d.resize();
    } else if (rs === null && this.forcedScale === null && !dynOn && this.renderScale !== 1) {
      // (the raster's scale let go — the traced pipeline, the Earth left —: the canvas's again)
      this.d.resize();
    } else if (dynOn && this.rasterOn() && this.movingFor > 0.15 && this.renderScale > this.rasterTop() + 1e-3) {
      // (the governor's scale in motion under the raster's ceiling — moving for 0.15 s: rasterScale's rule)
      this.renderScale = this.rasterTop();
      this.gpuEma = 0;
      this.scaleHeld = 0;
      this.d.resize();
    }
    if (!terrainInspecting && dynOn && this.heldFor > 0.4 && this.renderScale < 1) {
      this.movingScale = this.renderScale;
      this.renderScale = 1;
      this.gpuEma = 0;
      this.scaleHeld = 0;
      this.d.resize();
    } else if (!terrainInspecting && this.movingFor > 0.15 && this.movingScale > 0) {
      if (dynOn && this.renderScale !== this.movingScale) {
        this.renderScale = this.movingScale;
        this.gpuEma = 0;
        this.scaleHeld = 0;
        this.d.resize();
      }
      this.movingScale = 0;
    }
    // (every 1.5 s in motion, by eighths, between half the pixel ratio and all of it)
    this.scaleTimer += dt;
    if (this.scaleTimer > 1.5) {
      this.scaleTimer = 0;
      // (in motion: moving for 0.15 s — rasterScale's rule; a held view's own resize is not a move)
      const moving = this.movingFor > 0.15;
      const on = dynOn && moving;
      const block = renderer.realtimeBlockNow;
      const now = performance.now();
      this.scaleHeld += 1.5;
      const settled = this.scaleHeld >= 3;
      if (!terrainInspecting && on && settled && this.gpuEma > 0) this.scaleMs.set(this.renderScale, { ms: this.gpuEma, at: now });
      const known = (x: number) => {
        const m = this.scaleMs.get(x);
        return m && now - m.at < 30000 ? m.ms : undefined;
      };
      // (the raster's: its scale in motion the ceiling; lowered only once its shading rate, chosen by the renderer, is at its
      // coarsest — the shading is its cost, not the pixels' count)
      const raster = this.rasterOn();
      // (PLAN-J2 J2-6 — the raster's scale left to the governor, its floor 2/3 a side, Sam's decision 6: measured, at 2/3 the turn's
      // PSNR 30.4 against 32.5 dB at 0.75 — a full-scale reference — for ~8 % of GPU, the image blurred for a frame rate; the pin
      // kept, the lever rasterScaleFree retired, lot R1, 13 Nov 2026)
      const lower = Math.max(0.5, this.renderScale - 0.125),
        higher = Math.min(raster ? this.rasterTop() : 1, this.renderScale + 0.125);
      const rateDone = !raster || settings.earthRasterShading !== "auto" || renderer.rasterRateCoarsest;
      const kl = known(lower),
        kh = known(higher);
      const budget = renderer.frameBudget(settings);
      let want = this.renderScale;
      if (this.forcedScale !== null) want = this.forcedScale;
      else if (terrainInspecting) want = this.renderScale;
      else if (!dynOn) want = 1;
      else if (!moving) want = this.renderScale;
      // (the raster's ground at every pixel — shadeLite —: the scale held at the raster's own — each step resampled the history
      // into the new size at a sample's weight, a blur pulse every few seconds in flight; the image is what is aimed at, at
      // the raster's full scale, not the governor's)
      else if (raster && renderer.rasterLiteActive) want = this.rasterTop();
      else if (!settled) want = this.renderScale;
      // (down once the blocks are coarse: at the same rays a finer block on a smaller image is no better in
      // motion — measured, equal on Kerr, 2.6 dB worse on Saturn's stars and edges —, the full scale kept)
      else if (this.gpuEma > 1.2 * budget && block >= 4 && rateDone && (kl === undefined || kl < 0.9 * this.gpuEma)) want = lower;
      // (up when the larger scale was measured within the budget, or no slower; not measured lately, when
      // the frame grown as the pixels would stay within it)
      else if (
        higher > this.renderScale &&
        (kh !== undefined
          ? kh <= Math.max(0.85 * budget, 1.1 * this.gpuEma)
          : this.gpuEma * (higher / this.renderScale) ** 2 < 0.85 * budget)
      )
        want = higher;
      if (want !== this.renderScale) {
        this.renderScale = want;
        this.gpuEma = 0; // (measured afresh at the new scale)
        this.scaleHeld = 0;
        this.d.resize();
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
      this.idleAtCap = promotionEligible({
        automatic: on,
        benching: this.d.benching(),
        stable: renderer.calibrationReady && settled,
        pixelCapped: capped,
        precisionCapped: renderer.effectiveQuality(settings).capped,
        tier: renderer.tier,
        scale: this.renderScale,
        block,
        sinceDemotionMs: now - this.demotedAt,
        measuredMs: this.gpuEma,
        budgetMs: budget,
      })
        ? this.idleAtCap + 1.5
        : 0;
      if (this.idleAtCap >= 12) {
        const up = promoted(renderer.tier);
        this.idleAtCap = 0;
        if (up) {
          renderer.setTier(up);
          this.scaleMs.clear();
          this.gpuEma = 0;
          this.scaleHeld = 0;
          this.d.resize();
          if (renderer.adapter) rememberLevel(adapterId(renderer.adapter), up);
        }
      }
      // (and the other way — the promotion's missing half (plan §3.4): over the budget and a half
      // at the coarsest block and the smallest scale, for 12 s — one tier down, its cap lowered)
      this.overAtFloor = demotionEligible({
        automatic: on,
        benching: this.d.benching(),
        stable: renderer.calibrationReady && settled,
        scale: this.renderScale,
        block,
        measuredMs: this.gpuEma,
        budgetMs: budget,
      })
        ? this.overAtFloor + 1.5
        : 0;
      // (the raster pipeline too heavy for this device: over the budget and a half at its coarsest shading, its smallest
      // scale and the coarsest blocks for 12 s, in motion — the traced pipeline for the session, said; the setting changed,
      // tried again — onSettingsChange)
      this.rasterOver =
        raster &&
        settings.earthRasterShading === "auto" &&
        settings.realtimeSubsampling === "auto" &&
        !this.d.benching() &&
        moving &&
        settled &&
        renderer.rasterRateCoarsest &&
        block >= 8 &&
        (!dynOn || this.renderScale <= 0.5 + 1e-3) &&
        !renderer.rasterKept &&
        this.gpuEma > 1.5 * budget
          ? this.rasterOver + 1.5
          : 0;
      // (the traced pipeline flown 6 s in motion since the fallback: kept only if it is a tenth faster at least — over a city's
      // buildings on an M1 it was not, 57 ms a frame at 14 fps and its blocks far blurrier than the raster's floor —, else the
      // raster back, said)
      if (renderer.rasterFellBack && this.rasterFellMs > 0 && moving && settled && this.gpuEma > 0) {
        this.tracedFor += 1.5;
        if (this.tracedFor >= 6) {
          if (this.gpuEma > 0.9 * this.rasterFellMs) {
            renderer.rasterFellBack = false;
            renderer.rasterKept = true;
            this.scaleMs.clear();
            this.gpuEma = 0;
            this.scaleHeld = 0;
            this.d.resize();
            this.d.toast(t("The near Earth is drawn by the raster pipeline again: the traced one is no faster here"));
          }
          this.rasterFellMs = 0;
        }
      }
      if (this.rasterOver >= 12) {
        this.rasterOver = 0;
        this.rasterFellMs = this.gpuEma;
        this.tracedFor = 0;
        renderer.rasterFellBack = true;
        this.scaleMs.clear();
        this.gpuEma = 0;
        this.scaleHeld = 0;
        this.d.resize();
        this.d.toast(t("The near Earth is drawn by the traced pipeline: the raster one is too heavy for this GPU"));
      }
      if (this.overAtFloor >= 12) {
        const down = demoted(renderer.tier);
        this.overAtFloor = 0;
        if (down) {
          renderer.setTier(down);
          this.scaleMs.clear();
          this.gpuEma = 0;
          this.scaleHeld = 0;
          this.demotedAt = now;
          this.d.resize();
          if (renderer.adapter) rememberLevel(adapterId(renderer.adapter), down);
        }
      }
    }
  }
}
