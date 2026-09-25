import { horizon } from "./physics";
import type { Settings } from "./settings";

type Cinematic = "orbit" | "dive" | null;

/**
 * Camera interaction: orbit / look with momentum, smooth logarithmic zoom, pinch zoom,
 * keyboard, and two cinematic modes:
 *  - orbit: the observer circles the hole (azimuth drift)
 *  - dive: exact free fall from rest at infinity (E = 1, L = Q = 0) integrated in proper time,
 *          seen from the infalling ("rain") frame; ends just outside the horizon.
 */
export class CameraController {
  cinematic: Cinematic = null;
  /** Input is ignored while disabled (e.g. during an offline render). */
  enabled = true;
  private vAz = 0; // °/s
  private vInc = 0;
  private vYaw = 0;
  private vPitch = 0;
  private targetDistance: number;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragLook = false;
  private lastMove = 0;
  private pinchDist = 0;
  private keys = new Set<string>();
  private diveSaved: Partial<Settings> | null = null;
  private diveHold = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private s: Settings,
    private onCinematicChange: (mode: Cinematic) => void,
  ) {
    this.targetDistance = s.distance;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dblclick", () => this.resetView());
    addEventListener("keydown", (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      this.keys.add(e.key);
    });
    addEventListener("keyup", (e: KeyboardEvent) => this.keys.delete(e.key));
    addEventListener("blur", () => this.keys.clear());
  }

  /** Call after the distance was changed from elsewhere (GUI, preset). */
  sync() {
    this.targetDistance = this.s.distance;
    this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
  }

  resetView() {
    this.s.yaw = 0;
    this.s.pitch = 0;
    this.vYaw = this.vPitch = 0;
  }

  setCinematic(mode: Cinematic) {
    if (this.cinematic === "dive" && mode !== "dive") this.endDive();
    this.cinematic = mode;
    if (mode === "dive") {
      const s = this.s;
      this.diveSaved = { distance: s.distance, motion: s.motion, azimuth: s.azimuth, yaw: s.yaw, pitch: s.pitch };
      s.motion = "infall";
      s.yaw = s.pitch = 0;
      this.diveHold = 0;
    }
    this.onCinematicChange(mode);
  }

  private endDive() {
    if (this.diveSaved) Object.assign(this.s, this.diveSaved);
    this.diveSaved = null;
    this.sync();
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragLook = e.button === 2 || e.shiftKey;
    this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
    if (this.pointers.size === 2) this.pinchDist = this.pinchSpan();
    if (this.cinematic === "orbit") this.setCinematic(null);
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    // released after a pause: no fling
    if (performance.now() - this.lastMove > 80) this.vAz = this.vInc = this.vYaw = this.vPitch = 0;
  };

  private pinchSpan() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const now = performance.now();
    const dtEv = Math.max(16, now - this.lastMove) / 1000;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.lastMove = now;

    if (this.pointers.size === 2) {
      const span = this.pinchSpan();
      if (this.pinchDist > 0 && span > 0) this.zoomBy(this.pinchDist / span);
      this.pinchDist = span;
      return;
    }
    const s = this.s;
    // fling velocity: smoothed and capped (°/s)
    const smooth = (v: number, inst: number) => clamp(0.5 * inst + 0.5 * v, -120, 120);
    if (this.dragLook) {
      const k = s.fov / this.canvas.clientHeight; // degrees per CSS pixel
      s.yaw = clamp(s.yaw - dx * k, -180, 180);
      s.pitch = clamp(s.pitch + dy * k, -89, 89);
      this.vYaw = smooth(this.vYaw, (-dx * k) / dtEv);
      this.vPitch = smooth(this.vPitch, (dy * k) / dtEv);
    } else {
      const k = 0.25 * Math.min(1, s.fov / 45);
      s.azimuth = wrapDeg(s.azimuth - dx * k);
      s.inclination = clamp(s.inclination - dy * k, 0.2, 179.8);
      this.vAz = smooth(this.vAz, (-dx * k) / dtEv);
      this.vInc = smooth(this.vInc, (-dy * k) / dtEv);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.altKey) {
      this.s.fov = clamp(this.s.fov * Math.exp(dy * 0.001), 1, 150);
    } else {
      this.zoomBy(Math.exp(dy * 0.0015));
    }
  };

  private zoomBy(f: number) {
    if (this.cinematic === "dive") return;
    const rMin = horizon(this.s.spin) + 0.05;
    this.targetDistance = clamp(rMin + (this.targetDistance - rMin) * f, rMin, 1000);
  }

  /** Advances momentum, keyboard and cinematics. Returns true when the camera changed. */
  update(dt: number): boolean {
    if (!this.enabled) return false;
    const s = this.s;
    const before = [s.azimuth, s.inclination, s.yaw, s.pitch, s.distance, s.fov].join();
    const dragging = this.pointers.size > 0;

    // keyboard (held keys)
    const kRate = 60 * dt;
    if (this.keys.has("ArrowLeft")) s.azimuth = wrapDeg(s.azimuth + kRate);
    if (this.keys.has("ArrowRight")) s.azimuth = wrapDeg(s.azimuth - kRate);
    if (this.keys.has("ArrowUp")) s.inclination = clamp(s.inclination - kRate, 0.2, 179.8);
    if (this.keys.has("ArrowDown")) s.inclination = clamp(s.inclination + kRate, 0.2, 179.8);
    if (this.keys.has("+") || this.keys.has("=")) this.zoomBy(Math.exp(-1.2 * dt));
    if (this.keys.has("-") || this.keys.has("_")) this.zoomBy(Math.exp(1.2 * dt));

    // momentum (exponential damping)
    if (!dragging) {
      const damp = Math.exp(-4 * dt);
      s.azimuth = wrapDeg(s.azimuth + this.vAz * dt);
      s.inclination = clamp(s.inclination + this.vInc * dt, 0.2, 179.8);
      s.yaw = clamp(s.yaw + this.vYaw * dt, -180, 180);
      s.pitch = clamp(s.pitch + this.vPitch * dt, -89, 89);
      this.vAz *= damp;
      this.vInc *= damp;
      this.vYaw *= damp;
      this.vPitch *= damp;
      for (const k of ["vAz", "vInc", "vYaw", "vPitch"] as const) if (Math.abs(this[k]) < 0.05) this[k] = 0;
    }

    if (this.cinematic === "orbit") {
      s.azimuth = wrapDeg(s.azimuth + s.cinematicSpeed * dt);
    } else if (this.cinematic === "dive") {
      this.stepDive(dt);
    } else {
      // smooth zoom towards the target distance (in log space)
      const rMin = horizon(s.spin) + 0.05;
      if (s.distance < rMin) s.distance = rMin;
      const cur = Math.log(s.distance - rMin + 1e-3);
      const tgt = Math.log(Math.max(this.targetDistance, rMin) - rMin + 1e-3);
      const next = cur + (tgt - cur) * (1 - Math.exp(-10 * dt));
      s.distance = Math.abs(tgt - cur) < 1e-4 ? this.targetDistance : rMin + Math.exp(next) - 1e-3;
    }
    return before !== [s.azimuth, s.inclination, s.yaw, s.pitch, s.distance, s.fov].join();
  }

  private stepDive(dt: number) {
    const s = this.s;
    const a = s.spin;
    const rH = horizon(a);
    const rEnd = rH + 0.04;
    if (s.distance <= rEnd) {
      this.diveHold += dt;
      if (this.diveHold > 2.5) this.setCinematic(null);
      return;
    }
    // proper-time budget this frame, sub-stepped (RK2) so the plunge stays accurate near r+
    let tau = s.cinematicSpeed * dt;
    const th = (s.inclination * Math.PI) / 180;
    const c2 = Math.cos(th) ** 2;
    const deriv = (r: number) => {
      const sig = r * r + a * a * c2;
      const del = r * r - 2 * r + a * a;
      return {
        dr: -Math.sqrt(2 * r * (r * r + a * a)) / sig, // Σ dr/dτ = −√(2r(r²+a²))
        dphi: (2 * a * r) / (sig * del), // Σ dφ/dτ = 2ar/Δ (frame dragging)
      };
    };
    let r = s.distance;
    let phi = (s.azimuth * Math.PI) / 180;
    while (tau > 0 && r > rEnd) {
      const h = Math.min(tau, 0.02 * (r - rH) + 1e-4);
      const k1 = deriv(r);
      const k2 = deriv(Math.max(r + 0.5 * h * k1.dr, rH + 1e-4));
      r += h * k2.dr;
      phi += h * k2.dphi;
      tau -= h;
    }
    s.distance = Math.max(r, rEnd);
    s.azimuth = wrapDeg((phi * 180) / Math.PI);
    this.targetDistance = s.distance;
  }
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function wrapDeg(d: number) {
  return ((((d + 360) % 720) + 720) % 720) - 360;
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
