// Flight displays of the Ranger: flight data, attitude ball (the orbital directions around the nose,
// the local horizon), throttle, SAS / holds / autopilots, warnings, markers in the view (prograde,
// retrograde, burn, nose), and the map: a top view of the black hole's surroundings with the ship,
// its velocity and its predicted free-fall path (periapsis, apoapsis, impact).

import type { Settings } from "../settings";
import type { CameraController } from "../controls";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "../pilot";
import { mouth } from "../wormhole";
import { BODY_NAMES, starCentre, starOrbitRadius } from "../targeting";
import { isco } from "../physics";

type Info = ReturnType<CameraController["flightInfo"]>;
type V3 = [number, number, number];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const HOLD_KEYS: [Hold, string, string][] = [
  ["prograde", "PRO", "1"], ["retrograde", "RETRO", "2"], ["radialOut", "RAD+", "3"], ["radialIn", "RAD−", "4"],
  ["normal", "NRM+", "5"], ["antinormal", "NRM−", "6"], ["target", "TGT", "7"],
];
const AUTO_KEYS: [Auto, string, string][] = [["hover", "HOLD", "8"], ["circularize", "CIRC", "9"], ["approach", "APPR", "0"]];

// marker colours (as in the navball tradition)
const COL = {
  prograde: "#d6f55b", retrograde: "#d6f55b", radialOut: "#5fd3ff", radialIn: "#5fd3ff",
  normal: "#e07bff", antinormal: "#e07bff", target: "#ff8a5c", burn: "#4d8dff",
};

export interface FlightHudActions {
  hold(h: Hold): void;
  auto(a: Auto): void;
  sas(): void;
  warp(dir: 1 | -1): void;
}

export class FlightHud {
  private root = h("div", "fl-root");
  private data = h("div", "fl-data glass");
  private warn = h("div", "fl-warn");
  private ctrl = h("div", "fl-ctrl glass");
  private ball = h("canvas", "fl-ball");
  private thr = h("div", "fl-thr");
  private thrFill = h("i");
  private thrText = h("span");
  private map = h("canvas", "fl-map glass");
  private marks: HTMLCanvasElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private rows: Record<string, HTMLElement> = {};
  private textAt = 0;
  private extent = 40;
  private zoom = 1;
  private ballImg: ImageData | null = null;
  private ballFrame = 0;
  visible = false;

  constructor(private s: Settings, act: FlightHudActions) {
    this.marks = h("canvas", "fl-marks");
    // data panel
    const rows: [string, string][] = [
      ["mode", "Flight"], ["r", "r"], ["v", "Speed"], ["dtau", "Clock rate dτ/dt"], ["acc", "Thrust"],
      ["el", "Energy · ang. mom."], ["apsides", "Periapsis · apoapsis"], ["fate", "Course"], ["tgt", "Target"], ["tau", "Proper time"], ["warp", "Time warp"],
    ];
    this.data.append(h("div", "fl-title", "Ranger — flight data"));
    for (const [k, label] of rows) {
      const row = h("div", "fl-row");
      const v = h("b");
      row.append(h("span", "", label), v);
      this.rows[k] = v;
      this.data.append(row);
    }
    // controls: throttle | ball | buttons
    this.thr.append(this.thrFill, this.thrText);
    this.thr.title = "Throttle: ↑ / ↓ (Z full, X cut)";
    const btns = h("div", "fl-btns");
    const mk = (id: string, label: string, key: string, title: string, fn: () => void) => {
      const b = h("button", "", label) as HTMLButtonElement;
      b.title = `${title}  [${key}]`;
      b.onclick = fn;
      this.buttons.set(id, b);
      return b;
    };
    const g1 = h("div", "fl-group");
    g1.append(mk("sas", "SAS", "T", "Stability assist: holds the attitude, damps rotation", () => act.sas()));
    const g2 = h("div", "fl-group");
    for (const [hold, label, key] of HOLD_KEYS) g2.append(mk(hold, label, key, `Hold: ${HOLD_NAMES[hold]}`, () => act.hold(hold)));
    const g3 = h("div", "fl-group");
    for (const [a, label, key] of AUTO_KEYS) g3.append(mk(a, label, key, `Autopilot: ${AUTO_NAMES[a]}`, () => act.auto(a)));
    const g4 = h("div", "fl-group fl-warp");
    g4.append(mk("warpDown", "«", ",", "Slower time", () => act.warp(-1)), mk("warpUp", "»", ".", "Faster time", () => act.warp(1)));
    btns.append(g1, g2, g3, g4);
    this.ctrl.append(this.thr, this.ball, btns);
    this.map.title = "Top view (spin axis towards you) — wheel: zoom";
    this.map.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = Math.min(20, Math.max(0.05, this.zoom * Math.exp(e.deltaY * 0.0015)));
    }, { passive: false });
    this.root.append(this.warn, this.data, this.ctrl, this.map);
    document.body.append(this.marks, this.root);
    this.show(false);
  }

  show(on: boolean) {
    this.visible = on;
    this.root.hidden = !on;
    this.marks.hidden = !on;
  }

  /** Called every frame while piloting. */
  update(info: Info, time: number) {
    this.drawMarks(info);
    this.drawBall(info);
    this.drawMap(info, time);
    const now = performance.now();
    if (now - this.textAt > 100) {
      this.textAt = now;
      this.drawText(info);
    }
  }

  // ------------------------------------------------------------------------------------ text
  private drawText(i: Info) {
    const s = this.s;
    const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    const gUnit = 2.99792458e8 ** 2 / (1476.625 * s.massSolar) / 9.80665; // 1 c²/M in g
    const R = this.rows;
    const mode = i.auto !== "none" ? `Autopilot: ${AUTO_NAMES[i.auto]}` : i.hold !== "none" ? `Hold: ${HOLD_NAMES[i.hold]}` : i.sas ? "SAS" : "Manual";
    R.mode!.textContent = mode;
    R.r!.textContent = i.region === "hole" ? `${f(i.r)} M · ${f(i.r - i.rH)} M above the horizon` : `in the wormhole, ℓ = ${f(i.ell)} M`;
    R.v!.textContent = `${f(i.speed, 4)} c · γ ${f(i.gamma, 3)}`;
    R.dtau!.textContent = f(i.dtau, 4);
    R.acc!.textContent = i.accel > 0 ? `${i.accel.toPrecision(3)} c²/M · ${fmtG(i.accel * gUnit)}` : "coasting";
    R.el!.textContent = i.region === "hole" ? `E ${f(i.E, 4)} · L ${f(i.L, 3)} M` : "—";
    const p = i.path;
    let peri = NaN, apo = NaN;
    if (p && p.pts.length > 2) {
      const rs = p.pts.map((q) => Math.hypot(...q));
      rs.push(i.r);
      peri = Math.min(...rs);
      apo = Math.max(...rs);
    }
    R.apsides!.textContent = p ? `${f(peri, 1)} · ${p.fate === "escape" ? "∞" : f(apo, 1)} M` : "—";
    let fate = "—";
    if (p) {
      const t = p.pts.length * p.dt;
      fate = p.fate === "horizon" ? `into the horizon in ${fmtM(t, s)}` : p.fate === "escape" ? (i.E >= 1 ? "escape (unbound)" : "leaving") :
        p.fate === "star" ? `hits the star in ${fmtM(t, s)}` : p.fate === "wormhole" ? `into the wormhole in ${fmtM(t, s)}` :
        i.E < 1 ? "bound orbit" : "coasting";
    }
    R.fate!.textContent = fate;
    R.tgt!.textContent = Number.isFinite(i.targetDist)
      ? `${BODY_NAMES[i.target]} · ${f(i.targetDist, 1)} M · ${i.targetRate >= 0 ? "+" : "−"}${Math.abs(i.targetRate).toFixed(3)} c`
      : "—";
    R.tau!.textContent = `${f(i.properTime, 1)} M`;
    R.warp!.textContent = s.animate ? `${s.timeSpeed} M/s` : "paused (space)";
    // warnings
    const w: string[] = [];
    if (p?.fate === "horizon") w.push(`⚠ COLLISION COURSE — horizon in ${fmtM(p.pts.length * p.dt, s)}`);
    if (p?.fate === "star") w.push("⚠ COLLISION COURSE — the star");
    if (i.landed) w.push("Landed on the star");
    if (i.ergo) w.push("Ergosphere: no static observer — frame dragging carries you");
    else if (i.region === "hole" && i.r < i.photon) w.push("Inside the photon orbit: no circular orbit");
    else if (i.region === "hole" && i.r < i.isco) w.push("Below the ISCO: no stable circular orbit");
    if (!s.animate) w.push("Time paused — space to fly");
    this.warn.innerHTML = w.map((x) => `<div class="${x.startsWith("⚠") ? "hot" : ""}">${x}</div>`).join("");
    // buttons
    this.buttons.get("sas")!.classList.toggle("on", i.sas);
    for (const [hold] of HOLD_KEYS) this.buttons.get(hold)!.classList.toggle("on", i.hold === hold);
    for (const [a] of AUTO_KEYS) this.buttons.get(a)!.classList.toggle("on", i.auto === a);
    const t = Math.max(0, Math.min(1, i.throttle));
    this.thrFill.style.height = `${t * 100}%`;
    this.thrText.textContent = `${Math.round(t * 100)}%`;
  }

  // ------------------------------------------------------------------------------------ markers
  private drawMarks(i: Info) {
    const c = this.marks;
    const dpr = devicePixelRatio;
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const tanH = Math.tan((this.s.fov * Math.PI) / 360);
    const asp = W / H;
    const proj = (d: V3 | null) => {
      if (!d || d[2] <= 0.02) return null;
      const x = d[0] / (d[2] * tanH * asp), y = d[1] / (d[2] * tanH);
      if (Math.abs(x) > 1.05 || Math.abs(y) > 1.05) return null;
      return [((x + 1) / 2) * W, ((1 - y) / 2) * H] as const;
    };
    const r = 11 * dpr;
    ctx.lineWidth = 2 * dpr;
    const nose = proj([i.S[0][2], i.S[1][2], i.S[2][2]]);
    if (nose) {
      // the ship's nose: a W-shaped wing marker
      ctx.strokeStyle = "rgba(255, 200, 90, 0.95)";
      ctx.beginPath();
      ctx.moveTo(nose[0] - 2.2 * r, nose[1]);
      ctx.lineTo(nose[0] - r, nose[1]);
      ctx.lineTo(nose[0] - 0.5 * r, nose[1] + 0.6 * r);
      ctx.lineTo(nose[0], nose[1]);
      ctx.lineTo(nose[0] + 0.5 * r, nose[1] + 0.6 * r);
      ctx.lineTo(nose[0] + r, nose[1]);
      ctx.lineTo(nose[0] + 2.2 * r, nose[1]);
      ctx.stroke();
    }
    for (const k of ["prograde", "retrograde", "burn"] as const) {
      const p = proj(i.dirs[k]);
      if (p) marker(ctx, k, p[0], p[1], r, COL[k]);
    }
  }

  // ------------------------------------------------------------------------------------ attitude ball
  private drawBall(i: Info) {
    const c = this.ball;
    // (per-pixel sky/ground in JS: capped at 1.5× CSS resolution, redrawn every other frame)
    const dpr = Math.min(devicePixelRatio, 1.5);
    const size = Math.round(150 * dpr);
    if (c.width !== size) (c.width = size), (c.height = size);
    if ((this.ballFrame = (this.ballFrame + 1) % 2) === 1) return;
    const ctx = c.getContext("2d")!;
    const R0 = size / 2;
    const S = i.S;
    // camera → ship body: (x left, y up, z nose); shown with the ship's right to the right
    const body = (d: V3): V3 => [
      S[0][0] * d[0] + S[1][0] * d[1] + S[2][0] * d[2],
      S[0][1] * d[0] + S[1][1] * d[1] + S[2][1] * d[2],
      S[0][2] * d[0] + S[1][2] * d[1] + S[2][2] * d[2],
    ];
    // sky (away from the hole) / ground, with latitude lines every 30°
    if (!this.ballImg || this.ballImg.width !== size) this.ballImg = ctx.createImageData(size, size);
    const img = this.ballImg;
    const up = i.dirs.radialOut ? body(i.dirs.radialOut) : null;
    const px = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5 - R0) / R0, v = (R0 - y - 0.5) / R0;
        const q = u * u + v * v;
        const o = (y * size + x) * 4;
        if (q > 1) {
          px[o + 3] = 0;
          continue;
        }
        const d: V3 = [-u, v, Math.sqrt(1 - q)]; // body direction of this point
        let col: [number, number, number] = [28, 34, 44];
        if (up) {
          const e = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
          col = e > 0 ? [38, 92, 150] : [92, 64, 38];
          const lat = Math.asin(Math.max(-1, Math.min(1, e))) / (Math.PI / 6);
          if (Math.abs(lat - Math.round(lat)) < 0.035 / Math.max(Math.sqrt(1 - q), 0.2)) col = [210, 215, 225];
        }
        const shade = 0.55 + 0.45 * Math.sqrt(1 - q);
        px[o] = col[0] * shade;
        px[o + 1] = col[1] * shade;
        px[o + 2] = col[2] * shade;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // orbital markers (front hemisphere; behind: on the rim, dimmed)
    const r = 8 * dpr;
    ctx.lineWidth = 1.8 * dpr;
    for (const k of ["prograde", "retrograde", "radialOut", "radialIn", "normal", "antinormal", "target", "burn"] as const) {
      const dd = i.dirs[k];
      if (!dd) continue;
      const b = body(dd);
      let x = -b[0], y = b[1];
      let alpha = 1;
      if (b[2] < 0) {
        const l = Math.hypot(x, y) || 1;
        (x /= l), (y /= l), (alpha = 0.45);
      }
      ctx.globalAlpha = alpha;
      marker(ctx, k, R0 + x * (R0 - r), R0 - y * (R0 - r), r, COL[k]);
    }
    ctx.globalAlpha = 1;
    // nose reticle and the rotation rates (bars)
    ctx.strokeStyle = "#ffc85a";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(R0 - 16 * dpr, R0);
    ctx.lineTo(R0 - 6 * dpr, R0);
    ctx.lineTo(R0, R0 + 5 * dpr);
    ctx.lineTo(R0 + 6 * dpr, R0);
    ctx.lineTo(R0 + 16 * dpr, R0);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 200, 90, 0.8)";
    const w = i.omega;
    ctx.fillRect(R0, size - 5 * dpr, (-w[1] / 0.75) * R0 * 0.8, 3 * dpr); // yaw rate
    ctx.fillRect(size - 5 * dpr, R0, 3 * dpr, (w[0] / 0.75) * R0 * 0.8); // pitch rate
  }

  // ------------------------------------------------------------------------------------ map
  private drawMap(i: Info, time: number) {
    const c = this.map;
    const dpr = devicePixelRatio;
    const size = Math.round(240 * dpr);
    if (c.width !== size) (c.width = size), (c.height = size);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    const s = this.s;
    const font = `${11 * dpr}px Inter, system-ui, sans-serif`;
    ctx.font = font;
    if (i.region !== "hole" || !i.X) {
      ctx.fillStyle = "rgba(220, 225, 235, 0.8)";
      ctx.textAlign = "center";
      ctx.fillText(`In the wormhole · ℓ = ${i.ell.toFixed(2)} M`, size / 2, size / 2);
      return;
    }
    // extent: the ship, its path, the disk; eased
    let want = Math.max(Math.hypot(i.X[0], i.X[1]) * 1.3, (s.disk ? s.diskOuter : 12) * 1.15, 8);
    if (i.path) for (const p of i.path.pts) want = Math.max(want, Math.hypot(p[0], p[1]) * 1.1);
    want = Math.min(want, 400) * this.zoom;
    this.extent += (want - this.extent) * 0.08;
    const k = (size / 2 - 8 * dpr) / this.extent;
    const P = (x: number, y: number) => [size / 2 + x * k, size / 2 - y * k] as const;
    const circle = (r: number, stroke: string, dash: number[] = [], fill?: string) => {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, Math.max(r * k, 0.5), 0, 2 * Math.PI);
      if (fill) (ctx.fillStyle = fill), ctx.fill();
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    ctx.lineWidth = 1.2 * dpr;
    // disk
    if (s.disk) {
      const rIn = isco(s.spin);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, s.diskOuter * k, 0, 2 * Math.PI);
      ctx.arc(size / 2, size / 2, rIn * k, 0, 2 * Math.PI, true);
      ctx.fillStyle = "rgba(255, 150, 60, 0.18)";
      ctx.fill();
    }
    circle(i.isco, "rgba(120, 230, 150, 0.7)", [4, 3]);
    circle(i.photon, "rgba(255, 220, 120, 0.6)", [1.5, 2.5]);
    circle(2, "rgba(150, 170, 255, 0.5)", [3, 3]); // ergosphere (equator)
    circle(i.rH, "rgba(255, 255, 255, 0.8)", [], "#000");
    // star and its orbit
    if (s.sun) {
      circle(starOrbitRadius(s), "rgba(255, 230, 150, 0.25)", [2, 4]);
      const c0 = starCentre(s, time);
      const [x, y] = P(c0[0], c0[1]);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(s.sunRadius * k, 3 * dpr), 0, 2 * Math.PI);
      ctx.fillStyle = "#ffd36b";
      ctx.fill();
    }
    // wormhole mouth
    if (s.wormhole) {
      const m = mouth(s);
      const [x, y] = P(m.C[0], m.C[1]);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(m.rGlue * k, 3 * dpr), 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(200, 140, 255, 0.9)";
      ctx.stroke();
    }
    // predicted path
    const path = i.path;
    if (path && path.pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(...P(i.X[0], i.X[1]));
      for (const q of path.pts) ctx.lineTo(...P(q[0], q[1]));
      ctx.strokeStyle = path.fate === "horizon" || path.fate === "star" ? "rgba(255, 90, 70, 0.95)" : "rgba(255, 190, 80, 0.95)";
      ctx.lineWidth = 1.6 * dpr;
      ctx.setLineDash([5 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
      // apsides
      let iMin = -1, iMax = -1, rMin = Infinity, rMax = -Infinity;
      path.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (r < rMin) (rMin = r), (iMin = j);
        if (r > rMax) (rMax = r), (iMax = j);
      });
      const label = (j: number, t: string) => {
        if (j <= 0 || j >= path.pts.length - 1) return;
        const q = path.pts[j]!;
        const [x, y] = P(q[0], q[1]);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 2.5 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillText(t, x + 5 * dpr, y - 4 * dpr);
      };
      ctx.textAlign = "left";
      label(iMin, "Pe");
      if (path.fate === "continues") label(iMax, "Ap");
      if (path.fate === "horizon" || path.fate === "star") {
        const q = path.pts[path.pts.length - 1]!;
        const [x, y] = P(q[0], q[1]);
        ctx.strokeStyle = "#ff5a46";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - 4 * dpr, y - 4 * dpr);
        ctx.lineTo(x + 4 * dpr, y + 4 * dpr);
        ctx.moveTo(x + 4 * dpr, y - 4 * dpr);
        ctx.lineTo(x - 4 * dpr, y + 4 * dpr);
        ctx.stroke();
      }
    }
    // the ship: velocity, then a triangle along its nose
    const [sx, sy] = P(i.X[0], i.X[1]);
    if (i.V) {
      const vl = Math.hypot(i.V[0], i.V[1]);
      if (vl > 1e-6) {
        ctx.strokeStyle = COL.prograde;
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (i.V[0] / vl) * 22 * dpr * Math.min(1, vl * 3 + 0.3), sy - (i.V[1] / vl) * 22 * dpr * Math.min(1, vl * 3 + 0.3));
        ctx.stroke();
      }
    }
    const n = i.nose ?? [1, 0, 0];
    let a = Math.atan2(-n[1], n[0]);
    if (Math.hypot(n[0], n[1]) < 1e-3) a = 0;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(8 * dpr, 0);
    ctx.lineTo(-5 * dpr, 5 * dpr);
    ctx.lineTo(-2.5 * dpr, 0);
    ctx.lineTo(-5 * dpr, -5 * dpr);
    ctx.closePath();
    ctx.fillStyle = "#ffc85a";
    ctx.fill();
    ctx.restore();
    // legend: scale bar, height above the equator
    const bar = niceStep(this.extent / 2.5);
    ctx.strokeStyle = "rgba(230, 235, 245, 0.8)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(10 * dpr, size - 10 * dpr);
    ctx.lineTo(10 * dpr + bar * k, size - 10 * dpr);
    ctx.stroke();
    ctx.fillStyle = "rgba(230, 235, 245, 0.85)";
    ctx.textAlign = "left";
    ctx.fillText(`${bar} M`, 10 * dpr, size - 15 * dpr);
    ctx.textAlign = "right";
    ctx.fillText(`z ${i.X[2] >= 0 ? "+" : "−"}${Math.abs(i.X[2]).toFixed(1)} M`, size - 8 * dpr, size - 10 * dpr);
    ctx.fillText("top view", size - 8 * dpr, 16 * dpr);
  }
}

function marker(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number, col: string) {
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === "prograde" || kind === "radialOut" || kind === "normal") {
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI);
    ctx.moveTo(x, y - r * 0.6);
    ctx.lineTo(x, y - r * 1.2);
    ctx.moveTo(x - r * 0.6, y);
    ctx.lineTo(x - r * 1.2, y);
    ctx.moveTo(x + r * 0.6, y);
    ctx.lineTo(x + r * 1.2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.15, 0, 2 * Math.PI);
    ctx.fill();
  } else if (kind === "burn") {
    ctx.arc(x, y, r * 0.8, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.5, y);
    ctx.lineTo(x + r * 0.5, y);
    ctx.moveTo(x, y - r * 0.5);
    ctx.lineTo(x, y + r * 0.5);
    ctx.stroke();
  } else if (kind === "target") {
    ctx.rect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
    ctx.stroke();
  } else {
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.42, y - r * 0.42);
    ctx.lineTo(x + r * 0.42, y + r * 0.42);
    ctx.moveTo(x + r * 0.42, y - r * 0.42);
    ctx.lineTo(x - r * 0.42, y + r * 0.42);
    ctx.stroke();
  }
}

function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

function fmtG(g: number) {
  return g >= 1e4 ? `${g.toExponential(1)} g` : `${g.toPrecision(3)} g`;
}

/** A coordinate time in M, with its duration for the chosen mass. */
function fmtM(t: number, s: Settings) {
  const sec = t * 4.925490947e-6 * s.massSolar;
  const d = sec < 120 ? `${sec.toFixed(0)} s` : sec < 7200 ? `${(sec / 60).toFixed(0)} min` : sec < 172800 ? `${(sec / 3600).toFixed(1)} h` : `${(sec / 86400).toFixed(1)} d`;
  return `${t.toFixed(0)} M (${d})`;
}
