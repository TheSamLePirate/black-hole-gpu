// The overlay over the view (a 2D canvas the size of the image): the target's lock or its brackets, the
// body under the pointer, the ship seen from outside, the telescope's lens, the free flight's
// crosshair, the sky chart's words and the shadow guide's critical curve. Redrawn only when what it
// shows moved (a key of everything drawn).
import type { CameraController } from "../controls";
import type { Renderer } from "../renderer";
import type { Settings, Target } from "../settings";
import { cameraFrame } from "../camera";
import { criticalCurveDirections, projectLook } from "../shadow";
import { BODY_NAMES } from "../targeting";
import { shipToCamera } from "../mounts";
import { VESSELS } from "../vessels";
import type { ChartFrame } from "../skychart";
import { drawChartLabels } from "./skylabels";
import { drawTelescope, type TelescopeView } from "./telescope";
import { BODY_COLOURS } from "./camerapanel";
import { drawLock, lockKey } from "./targethud";
import { FONT, MONO } from "./hudkit";
import { safeFrame } from "./hud/safe";

export class ViewOverlay {
  private key = "";
  constructor(
    private overlay: HTMLCanvasElement,
    _settings: Settings,
    private main: CameraController,
    private renderer: Renderer,
  ) {}
  /** the view's controller and settings: a spectator's when one is out (its locks, brackets, telescope) */
  private get camera() {
    return this.main.viewController();
  }
  private get settings() {
    return this.camera.s;
  }

  /** Draws the overlay, if anything on it changed. `sky`: the sky chart's labels (`skyKey`: their version). */
  draw(sky: ChartFrame | null, skyKey: string) {
    const cam = cameraFrame(this.settings);
    const guide = this.settings.shadowGuide && cam.region === "hole";
    // (the targeting: around what is locked — the target, or the station clicked; the old brackets only
    // where it gives nothing)
    const lock = this.lockDraw();
    const marker = lock ? null : this.targetMarker();
    const hover = this.camera.hover;
    const ship = this.shipMarker();
    const tele = this.telescopeView(cam);
    const key =
      guide || this.camera.flyMode || marker || lock || hover || ship || tele || sky
        ? [
            lock
              ? lockKey(lock.v, this.overlay.width, this.overlay.height, Math.tan((this.settings.fov * Math.PI) / 360)) +
                lock.alpha.toFixed(2)
              : "",
            this.settings.spin,
            cam.r,
            cam.theta,
            cam.phi,
            this.settings.yaw,
            this.settings.pitch,
            this.settings.roll,
            this.settings.fov,
            cam.speed,
            this.overlay.width,
            this.overlay.height,
            this.camera.flyMode,
            marker?.key,
            hover?.body,
            hover?.x,
            hover?.y,
            ship?.key,
            tele && [tele.target?.name, tele.target?.ndc?.map((x) => x.toFixed(4)), tele.target?.dist.toPrecision(5), tele.tracking],
            sky ? skyKey : "",
          ].join()
        : "off";
    if (key === this.key) return;
    this.key = key;
    const ctx = this.overlay.getContext("2d")!;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (key === "off") return;
    if (sky) drawChartLabels(ctx, sky.labels, this.overlay.width, this.overlay.height, devicePixelRatio);
    if (this.camera.flyMode) this.drawCrosshair(ctx);
    if (tele) drawTelescope(ctx, this.overlay.width, this.overlay.height, devicePixelRatio, tele);
    if (marker && !tele) this.drawMarker(ctx, marker);
    if (lock && !tele) {
      const k = devicePixelRatio;
      drawLock(
        ctx,
        lock.v,
        this.overlay.width,
        this.overlay.height,
        Math.tan((this.settings.fov * Math.PI) / 360),
        k,
        lock.alpha,
        // (clear of the mission bar and the hub — or of the dock on foot: hud/safe.ts)
        { top: safeFrame().top * k, bottom: safeFrame().bottom * k },
      );
    }
    if (hover && hover.body !== marker?.body && !(lock && hover.body === this.settings.target)) this.drawHover(ctx, hover);
    if (ship) this.drawShipMarker(ctx, ship);
    if (!guide) return;
    const tanH = Math.tan((this.settings.fov * Math.PI) / 360);
    const aspect = this.overlay.width / this.overlay.height;
    const W = this.overlay.width;
    const H = this.overlay.height;
    ctx.lineWidth = Math.max(1.2, devicePixelRatio * 1.1);
    ctx.strokeStyle = "rgba(90, 255, 160, 0.9)";
    ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
    for (const line of criticalCurveDirections(cam, this.settings.spin)) {
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
    ctx.font = `${11 * devicePixelRatio}px ${MONO}`;
    ctx.fillText("critical curve (analytic)", 16 * devicePixelRatio, H - 16 * devicePixelRatio);
  }

  /**
   * Outside the ship (the Around and Free views): where it is on the screen and how far, once it is a
   * few pixels long — a diamond and its distance; off-screen, an arrow at the edge towards it.
   */
  private shipMarker() {
    if (!this.settings.ship || !this.camera.outsideView() || this.renderer.offlineActive || document.body.classList.contains("hide-ui"))
      return null;
    const t = shipToCamera(this.camera.shipPose(), this.settings.shipLookYaw, this.settings.shipLookPitch).t;
    const d = Math.hypot(...t);
    const W = this.overlay.width,
      H = this.overlay.height;
    const tanH = Math.tan((this.settings.fov * Math.PI) / 360);
    const size = (26 / Math.max(d, 1) / tanH) * (H / 2); // (its length on the screen, px)
    if (size > 60) return null;
    const alpha = Math.min(1, (60 - size) / 30);
    let px = W / 2,
      py = H / 2,
      onScreen = false;
    if (t[2] > 1e-6) {
      px = ((t[0] / t[2] / (tanH * (W / H)) + 1) / 2) * W;
      py = ((1 - t[1] / t[2] / tanH) / 2) * H;
      onScreen = px > 0 && px < W && py > 0 && py < H;
    }
    const label = `${VESSELS[this.settings.vessel].name.toUpperCase()} · ${d < 1e3 ? `${d.toFixed(0)} m` : `${(d / 1e3).toFixed(d < 1e4 ? 2 : 1)} km`}`;
    const dir = Math.atan2(-t[1], t[0]);
    return {
      px,
      py,
      onScreen,
      dir,
      alpha,
      label,
      key: [px.toFixed(1), py.toFixed(1), onScreen, dir.toFixed(3), alpha.toFixed(2), label].join(),
    };
  }
  private drawShipMarker(ctx: CanvasRenderingContext2D, m: NonNullable<ReturnType<ViewOverlay["shipMarker"]>>) {
    const k = devicePixelRatio;
    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.strokeStyle = "rgba(120, 255, 200, 0.95)";
    ctx.fillStyle = "rgba(120, 255, 200, 0.95)";
    ctx.lineWidth = 1.5 * k;
    ctx.font = `${11 * k}px ${MONO}`;
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
      const W = this.overlay.width,
        H = this.overlay.height,
        e = 34 * k;
      const c = Math.cos(m.dir),
        s2 = Math.sin(m.dir);
      const f = Math.min((W / 2 - e) / Math.max(Math.abs(c), 1e-6), (H / 2 - e) / Math.max(Math.abs(s2), 1e-6));
      const x = W / 2 + c * f,
        y = H / 2 + s2 * f;
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

  /**
   * The targeting HUD's figures (ui/targethud.ts): flying, always there; else while the camera is
   * handled, then fading, as the brackets did.
   */
  private lockDraw() {
    if (this.renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const idle = (performance.now() - this.camera.activity) / 1000;
    const alpha = this.settings.ship ? 1 : idle < 1.6 ? 1 : Math.max(0, 1 - (idle - 1.6) / 0.8);
    if (alpha <= 0) return null;
    // (on the approach, under 20 km over a runway: the eyes on the runway — no far target in the middle
    // of the view down to the flare)
    const rw = this.camera.piloting ? this.camera.runwayView() : null;
    if (rw && rw.agl < 20e3) return null;
    const v = this.camera.lockView();
    if (!v || !v.dir.every(Number.isFinite)) return null;
    return { v: { ...v, colour: v.colour || BODY_COLOURS[v.id as Target] || "" }, alpha };
  }

  /**
   * The target's marker: corner brackets around its apparent image (lensed and light-delayed), or an
   * arrow at the edge of the view when it is off-screen. Shown while the camera is handled, then fades.
   */
  private targetMarker() {
    if (this.renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const idle = (performance.now() - this.camera.activity) / 1000;
    const alpha = idle < 1.6 ? 1 : Math.max(0, 1 - (idle - 1.6) / 0.8);
    if (alpha <= 0) return null;
    const info = this.camera.targetInfo();
    if (!info) return null;
    const W = this.overlay.width;
    const H = this.overlay.height;
    const tanH = Math.tan((this.settings.fov * Math.PI) / 360);
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
    const riding = info.body === "star" ? this.camera.riding : 0;
    const label = `${this.settings.rotation === "orbit" ? "↻ " : ""}${info.name.toUpperCase()} · ${info.dist < 1e4 ? info.dist.toFixed(info.dist < 10 ? 2 : 1) : "∞"} M${riding > 0.5 ? " · co-moving" : ""}`;
    const dir = Math.atan2(-y, x); // screen direction of the target (off-screen arrow)
    return {
      body: info.body,
      px,
      py,
      radius,
      onScreen,
      dir,
      alpha,
      label,
      key: [info.body, px.toFixed(1), py.toFixed(1), radius.toFixed(1), onScreen, dir.toFixed(3), alpha.toFixed(2), label].join(),
    };
  }

  private drawMarker(ctx: CanvasRenderingContext2D, m: NonNullable<ReturnType<ViewOverlay["targetMarker"]>>) {
    const k = devicePixelRatio;
    const c = BODY_COLOURS[m.body];
    ctx.save();
    ctx.globalAlpha = m.alpha;
    ctx.strokeStyle = `rgba(${c}, 0.9)`;
    ctx.fillStyle = `rgba(${c}, 0.95)`;
    ctx.lineWidth = 1.4 * k;
    ctx.font = `600 ${12 * k}px ${FONT}`;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    // (a crisp drop shadow, not a blurred one: a blur is a GPU pass per draw — it cost the tracer
    // 23 → 9 fps once)
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 1 * k;
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
      ctx.fillText(m.label, m.px, Math.min(m.py + 2.4 * r + 8 * k, this.overlay.height - 8 * k));
    } else if (m.onScreen) {
      const r = m.radius;
      const l = Math.min(r * 0.45, 12 * k);
      ctx.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        ctx.moveTo(m.px + sx * r, m.py + sy * (r - l));
        ctx.lineTo(m.px + sx * r, m.py + sy * r);
        ctx.lineTo(m.px + sx * (r - l), m.py + sy * r);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(m.px, m.py, 1.6 * k, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillText(m.label, m.px, Math.min(m.py + r + 15 * k, this.overlay.height - 8 * k));
    } else {
      // arrow on an ellipse inset from the edges, pointing at the target
      const W = this.overlay.width;
      const H = this.overlay.height;
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
  private drawHover(ctx: CanvasRenderingContext2D, h: NonNullable<CameraController["hover"]>) {
    const k = devicePixelRatio;
    const c = BODY_COLOURS[h.body];
    ctx.save();
    ctx.font = `600 ${12 * k}px ${FONT}`;
    ctx.fillStyle = `rgba(${c}, 0.95)`;
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    // (a crisp drop shadow, not a blurred one: a blur is a GPU pass per draw — it cost the tracer
    // 23 → 9 fps once)
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 1 * k;
    ctx.textAlign = "left";
    const hint = h.body === this.settings.target ? "double-click: fly to" : "click: target";
    ctx.fillText(`${BODY_NAMES[h.body]}`, (h.x + 14) * k, (h.y + 22) * k);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `500 ${11 * k}px ${FONT}`;
    ctx.fillText(hint, (h.x + 14) * k, (h.y + 35) * k);
    ctx.restore();
  }

  /** The telescope's overlay (ui/telescope.ts): the lens, the target where it is, the tracking. */
  private telescopeView(cam: ReturnType<typeof cameraFrame>): TelescopeView | null {
    if (!this.settings.telescope || this.renderer.offlineActive || document.body.classList.contains("hide-ui")) return null;
    const info = this.camera.targetInfo();
    const tanH = Math.tan((this.settings.fov * Math.PI) / 360);
    const ndc = info ? projectLook(cam, info.look, tanH, this.overlay.width / this.overlay.height) : null;
    return {
      fov: this.settings.fov,
      mPerM: 1476.625 * this.settings.massSolar,
      tracking: this.settings.lookAt,
      target: info ? { name: info.name, ang: info.ang, dist: info.dist, ndc: ndc ? [ndc[0], ndc[1]] : null } : null,
    };
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D) {
    const x = this.overlay.width / 2;
    const y = this.overlay.height / 2;
    const k = devicePixelRatio;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      ctx.moveTo(x + dx! * 5 * k, y + dy! * 5 * k);
      ctx.lineTo(x + dx! * 12 * k, y + dy! * 12 * k);
    }
    ctx.stroke();
  }
}
