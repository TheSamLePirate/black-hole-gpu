// Flight displays of the Ranger.
//
//  cockpit (bottom centre)  speed and altitude, the attitude ball (sky and ground relative to the hole,
//                           the orbital markers around the nose) inside a throttle arc, the autopilot's
//                           state, SAS / holds / autopilots
//  orbit panel (left)       course, periapsis and apoapsis with the time to them, E and L, the target
//                           with its closest approach, proper time, time warp
//  camera strip + map       attach points; a map of the real motions: in the centre-of-mass frame when
//                           the star has a mass (Gargantua moves too), the ship's trail and predicted
//                           geodesic, the star's and the hole's paths over the same time span, common
//                           time ticks, the closest approach to the target, the view cone; top or side view
//  view markers             nose, prograde / retrograde, burn, velocity relative to the target
//  warnings (top)           collision course, ergosphere, ISCO, photon orbit, time paused

import type { Settings } from "../settings";
import type { CameraController } from "../controls";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "../pilot";
import { MOUNT_KEYS, MOUNTS, type Mount } from "../mounts";
import { mouth } from "../wormhole";
import { barycentre, BODY_NAMES, starCentre, starOmega } from "../targeting";
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

// marker colours (the navball tradition)
const COL: Record<string, string> = {
  prograde: "#d6f55b", retrograde: "#d6f55b", radialOut: "#5fd3ff", radialIn: "#5fd3ff",
  normal: "#e07bff", antinormal: "#e07bff", target: "#ff8a5c", burn: "#4d8dff", tgtPrograde: "#ff8a5c", tgtRetrograde: "#ff8a5c",
};
const GLYPH: Record<string, string> = {
  prograde: "prograde", retrograde: "retrograde", radialOut: "prograde", radialIn: "retrograde", normal: "prograde", antinormal: "retrograde",
  target: "target", burn: "burn", tgtPrograde: "prograde", tgtRetrograde: "retrograde",
};

export interface FlightHudActions {
  hold(h: Hold): void;
  auto(a: Auto): void;
  sas(): void;
  warp(dir: 1 | -1): void;
  mount(m: Mount): void;
  lookAhead(): void;
  throttle(t: number): void;
}

export class FlightHud {
  private root = h("div", "fl-root");
  private warn = h("div", "fl-warn");
  private cockpit = h("div", "fl-cockpit glass");
  private status = h("div", "fl-status");
  private ball = h("canvas", "fl-ball");
  private big: Record<string, HTMLElement> = {};
  private orbit = h("div", "fl-orbit glass");
  private rows: Record<string, HTMLElement> = {};
  private right = h("div", "fl-right");
  private map = h("canvas", "fl-map");
  private mapBtns: Record<string, HTMLButtonElement> = {};
  private marks: HTMLCanvasElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private textAt = 0;
  private extent = 40;
  private centre: [number, number] = [0, 0];
  private zoom = 1;
  private view: "top" | "side" = "top";
  private frame: "cm" | "hole" = "cm";
  private trail: { X: V3; t: number }[] = [];
  private ballImg: ImageData | null = null;
  private ballFrame = 0;
  private throttleDrag = false;
  visible = false;

  constructor(private s: Settings, private act: FlightHudActions) {
    this.marks = h("canvas", "fl-marks");

    // ---- cockpit
    const readout = (key: string, label: string, side: string) => {
      const b = h("div", `fl-big ${side}`);
      const v = h("b");
      const sub = h("small");
      b.append(h("span", "", label), v, sub);
      this.big[key] = v;
      this.big[`${key}Sub`] = sub;
      return b;
    };
    const mid = h("div", "fl-mid");
    mid.append(readout("speed", "Speed", "l"), this.ball, readout("alt", "Altitude", "r"));
    const btns = h("div", "fl-btns");
    const mk = (id: string, label: string, key: string, title: string, fn: () => void, glyph?: string, col?: string) => {
      const b = h("button", "") as HTMLButtonElement;
      if (glyph) b.append(glyphSvg(glyph, col!));
      b.append(h("span", "", label));
      b.title = `${title}  [${key}]`;
      b.onclick = fn;
      this.buttons.set(id, b);
      return b;
    };
    const g1 = h("div", "fl-group");
    g1.append(mk("sas", "SAS", "T", "Stability assist: holds the attitude, damps rotation", () => act.sas()));
    const g2 = h("div", "fl-group");
    for (const [hold, label, key] of HOLD_KEYS) g2.append(mk(hold, label, key, `Hold ${HOLD_NAMES[hold]}`, () => act.hold(hold), GLYPH[hold], COL[hold]));
    const g3 = h("div", "fl-group");
    for (const [a, label, key] of AUTO_KEYS) g3.append(mk(a, label, key, `Autopilot: ${AUTO_NAMES[a]}`, () => act.auto(a)));
    btns.append(g1, h("span", "fl-sep"), g2, h("span", "fl-sep"), g3);
    const keys = h("div", "fl-keys");
    keys.innerHTML = "<kbd>W</kbd><kbd>S</kbd> pitch · <kbd>A</kbd><kbd>D</kbd> yaw · <kbd>Q</kbd><kbd>E</kbd> roll · <kbd>⇧</kbd> RCS · <kbd>↑</kbd><kbd>↓</kbd> throttle · <kbd>V</kbd> camera · <kbd>,</kbd><kbd>.</kbd> warp · <kbd>?</kbd> all keys";
    keys.title = "Keys by physical position (AZERTY: Z S · Q D · A E)";
    this.cockpit.append(this.status, mid, btns, keys);
    this.ball.title = "Attitude: sky (away from the hole) and ground, markers around the nose. Throttle: drag on the left arc";
    this.ball.addEventListener("pointerdown", (e) => this.onBall(e, true));
    this.ball.addEventListener("pointermove", (e) => this.onBall(e, false));
    this.ball.addEventListener("pointerup", () => (this.throttleDrag = false));

    // ---- orbit panel
    const head = h("button", "fl-head", "Orbit");
    head.onclick = () => this.orbit.classList.toggle("folded");
    this.orbit.append(head);
    const rows: [string, string][] = [
      ["course", "Course"], ["pe", "Periapsis"], ["ap", "Apoapsis"], ["el", "E · L"], ["dtau", "Clock rate dτ/dt"], ["thrust", "Thrust"],
      ["tgt", "Target"], ["ca", "Closest approach"], ["tau", "Proper time"],
    ];
    const body = h("div", "fl-rows");
    for (const [k, label] of rows) {
      const row = h("div", "fl-row");
      const v = h("b");
      row.append(h("span", "", label), v);
      this.rows[k] = v;
      body.append(row);
    }
    const warpRow = h("div", "fl-row fl-warprow");
    const wv = h("b");
    this.rows.warp = wv;
    const wb = (d: 1 | -1, t: string) => {
      const b = h("button", "", t) as HTMLButtonElement;
      b.title = d < 0 ? "Slower time [,]" : "Faster time [.]";
      b.onclick = () => act.warp(d);
      return b;
    };
    warpRow.append(h("span", "", "Time warp"), wb(-1, "«"), wv, wb(1, "»"));
    body.append(warpRow);
    this.orbit.append(body);

    // ---- camera strip + map
    const cams = h("div", "fl-cams glass");
    cams.append(h("span", "fl-label", "Camera"));
    for (const m of MOUNT_KEYS) {
      const b = h("button", "", MOUNTS[m].short) as HTMLButtonElement;
      b.title = `${MOUNTS[m].label}  [V / ⇧V]`;
      b.onclick = () => act.mount(m);
      this.buttons.set(`mount:${m}`, b);
      cams.append(b);
    }
    const ahead = h("button", "fl-ahead", "↺") as HTMLButtonElement;
    ahead.title = "Look ahead (drag the view to look around from the attach point) [double-click]";
    ahead.onclick = () => act.lookAhead();
    this.buttons.set("ahead", ahead);
    cams.append(ahead);
    const mapBox = h("div", "fl-mapbox glass");
    const bar = h("div", "fl-mapbar");
    const tog = (id: string, label: string, title: string, fn: () => void) => {
      const b = h("button", "", label) as HTMLButtonElement;
      b.title = title;
      b.onclick = fn;
      this.mapBtns[id] = b;
      return b;
    };
    bar.append(
      tog("top", "Top", "Seen from above the spin axis", () => (this.view = "top")),
      tog("side", "Side", "Seen edge-on (along the equator)", () => (this.view = "side")),
      h("span", "fl-sep"),
      tog("cm", "Centre of mass", "Inertial frame of the centre of mass: Gargantua moves too", () => (this.frame = "cm")),
      tog("hole", "Gargantua", "Gargantua's frame (fixed at the centre)", () => (this.frame = "hole")),
    );
    this.map.title = "Wheel: zoom · double-click: fit";
    this.map.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = Math.min(20, Math.max(0.03, this.zoom * Math.exp(e.deltaY * 0.0015)));
    }, { passive: false });
    this.map.addEventListener("dblclick", () => (this.zoom = 1));
    mapBox.append(bar, this.map);
    this.right.append(cams, mapBox);

    this.root.append(this.warn, this.orbit, this.cockpit, this.right);
    document.body.append(this.marks, this.root);
    this.show(false);
  }

  show(on: boolean) {
    this.visible = on;
    this.root.hidden = !on;
    this.marks.hidden = !on;
    document.body.classList.toggle("piloting", on);
    if (!on) this.trail = [];
  }

  /** Called every frame while piloting. */
  update(info: Info, time: number) {
    this.record(info, time);
    this.drawMarks(info);
    this.drawBall(info);
    this.drawMap(info, time);
    const now = performance.now();
    if (now - this.textAt > 100) {
      this.textAt = now;
      this.drawText(info, time);
    }
  }

  private onBall(e: PointerEvent, down: boolean) {
    const r = this.ball.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (down) {
      this.throttleDrag = x < 0.3;
      if (this.throttleDrag) this.ball.setPointerCapture(e.pointerId);
    }
    if (!this.throttleDrag) return;
    // the arc runs from the bottom (0 %) to the top (100 %) of the left side
    this.act.throttle(Math.min(1, Math.max(0, (0.93 - y) / 0.86)));
  }

  /** The ship's trail (black hole's frame, with times). */
  private record(i: Info, t: number) {
    if (!i.X) return;
    const last = this.trail[this.trail.length - 1];
    if (last && (t < last.t || Math.hypot(i.X[0] - last.X[0], i.X[1] - last.X[1], i.X[2] - last.X[2]) > 30)) this.trail = [];
    const step = Math.max(0.2, (2 * Math.PI * i.r ** 1.5) / 400);
    const prev = this.trail[this.trail.length - 1];
    if (!prev || t - prev.t >= step) this.trail.push({ X: [...i.X] as V3, t });
    if (this.trail.length > 500) this.trail.shift();
  }

  // ------------------------------------------------------------------------------------ text
  private drawText(i: Info, time: number) {
    const s = this.s;
    const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    const gUnit = 2.99792458e8 ** 2 / (1476.625 * s.massSolar) / 9.80665; // 1 c²/M in g
    // cockpit
    this.big.speed!.textContent = `${f(i.speed, 4)} c`;
    this.big.speedSub!.textContent = `γ ${f(i.gamma, 3)} · rel. ZAMO`;
    if (i.region === "hole") {
      this.big.alt!.textContent = `${f(i.r - i.rH, 2)} M`;
      this.big.altSub!.textContent = `r ${f(i.r, 2)} M`;
    } else {
      this.big.alt!.textContent = `ℓ ${f(i.ell, 2)} M`;
      this.big.altSub!.textContent = "in the wormhole";
    }
    let st = i.auto !== "none" ? `<b>Autopilot</b> ${AUTO_NAMES[i.auto]}` : i.hold !== "none" ? `<b>Hold</b> ${HOLD_NAMES[i.hold]}` : i.sas ? "<b>SAS</b> attitude hold" : "<b>Manual</b> no assistance";
    if (i.auto !== "none") {
      const phase = i.dirs.burn ? (i.throttle > 0.02 ? "burning" : "turning to the burn") : "RCS trim";
      st += ` · ${phase}${Number.isFinite(i.dv) ? ` · Δv ${i.dv < 1e-3 ? "<0.001" : i.dv.toFixed(3)} c` : ""}`;
    }
    if (i.moving) st += " · camera moving";
    this.status.innerHTML = st;
    // orbit panel
    const R = this.rows;
    const p = i.path;
    let peri = NaN, apo = NaN, tPe = NaN, tAp = NaN;
    if (p && p.pts.length > 2) {
      p.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (!(r >= peri)) (peri = r), (tPe = (j + 1) * p.dt);
        if (!(r <= apo)) (apo = r), (tAp = (j + 1) * p.dt);
      });
      if (i.r < peri) (peri = i.r), (tPe = 0);
      if (i.r > apo) (apo = i.r), (tAp = 0);
    }
    let course = "—", hot = false;
    if (p) {
      const t = p.pts.length * p.dt;
      if (p.fate === "horizon") (course = `into the horizon in ${fmtM(t, s)}`), (hot = true);
      else if (p.fate === "star") (course = `hits the star in ${fmtM(t, s)}`), (hot = true);
      else if (p.fate === "wormhole") course = `into the wormhole in ${fmtM(t, s)}`;
      else if (p.fate === "escape") course = i.E >= 1 ? "escape — unbound" : "leaving";
      else course = i.E < 1 ? "bound orbit" : "coasting";
    }
    R.course!.textContent = course;
    R.course!.classList.toggle("hot", hot);
    R.pe!.textContent = Number.isFinite(peri) ? `${f(peri, 1)} M · ${tPe > 0 ? `in ${fmtM(tPe, s)}` : "now"}` : "—";
    R.ap!.textContent = p?.fate === "escape" ? "∞" : Number.isFinite(apo) && p?.fate === "continues" ? `${f(apo, 1)} M · ${tAp > 0 ? `in ${fmtM(tAp, s)}` : "now"}` : "—";
    R.el!.textContent = i.region === "hole" ? `${f(i.E, 4)} · ${f(i.L, 3)} M` : "—";
    R.dtau!.textContent = f(i.dtau, 4);
    R.thrust!.textContent = i.accel > 0 ? `${i.accel.toPrecision(3)} c²/M · ${fmtG(i.accel * gUnit)}` : "coasting";
    R.tgt!.textContent = Number.isFinite(i.targetDist)
      ? `${BODY_NAMES[i.target]} · ${f(i.targetDist, 1)} M · ${i.targetRate >= 0 ? "+" : "−"}${Math.abs(i.targetRate).toFixed(3)} c`
      : "—";
    const ca = this.closestApproach(i, time);
    R.ca!.textContent = ca ? `${f(ca.d, 2)} M · ${ca.t > 0 ? `in ${fmtM(ca.t, s)}` : "now"}` : "—";
    R.tau!.textContent = `${f(i.properTime, 1)} M`;
    R.warp!.textContent = s.animate ? `${s.timeSpeed} M/s` : "paused";
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
    for (const m of MOUNT_KEYS) this.buttons.get(`mount:${m}`)!.classList.toggle("on", i.mount === m);
    this.buttons.get("ahead")!.classList.toggle("on", s.shipLookYaw !== 0 || s.shipLookPitch !== 0);
    const massive = s.sun && s.sunMass > 0;
    this.mapBtns.top!.classList.toggle("on", this.view === "top");
    this.mapBtns.side!.classList.toggle("on", this.view === "side");
    this.mapBtns.cm!.hidden = this.mapBtns.hole!.hidden = !massive;
    this.mapBtns.cm!.classList.toggle("on", this.frame === "cm");
    this.mapBtns.hole!.classList.toggle("on", this.frame === "hole");
  }

  /** Closest approach to the target along the predicted path (both moving; black hole's frame). */
  private closestApproach(i: Info, t0: number) {
    const p = i.path;
    if (!p || !i.X || i.target === "hole" || i.target === "barycentre") return null;
    const s = this.s;
    if (i.target === "star" && !s.sun) return null;
    if (i.target === "wormhole" && !s.wormhole) return null;
    const at = (t: number): V3 => (i.target === "star" ? starCentre(s, t) : mouth(s).C as V3);
    let best = { d: Math.hypot(...sub(i.X, at(t0))), t: 0 };
    p.pts.forEach((q, j) => {
      const d = Math.hypot(...sub(q, at(t0 + (j + 1) * p.dt)));
      if (d < best.d) best = { d, t: (j + 1) * p.dt };
    });
    return best;
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
    for (const k of ["prograde", "retrograde", "burn", "tgtPrograde", "tgtRetrograde"] as const) {
      const p = proj(i.dirs[k]);
      if (p) marker(ctx, GLYPH[k]!, p[0], p[1], r, COL[k]!);
    }
  }

  // ------------------------------------------------------------------------------------ attitude ball + throttle arc
  private drawBall(i: Info) {
    const c = this.ball;
    // (per-pixel sky/ground in JS: capped at 1.5× CSS resolution, redrawn every other frame)
    const dpr = Math.min(devicePixelRatio, 1.5);
    const size = Math.round(172 * dpr);
    if (c.width !== size) (c.width = size), (c.height = size);
    if ((this.ballFrame = (this.ballFrame + 1) % 2) === 1) return;
    const ctx = c.getContext("2d")!;
    const C0 = size / 2;
    const R0 = size / 2 - 14 * dpr; // the ball; the throttle arc around it
    const S = i.S;
    // camera → ship body: (x left, y up, z nose); shown with the ship's right to the right
    const body = (d: V3): V3 => [
      S[0][0] * d[0] + S[1][0] * d[1] + S[2][0] * d[2],
      S[0][1] * d[0] + S[1][1] * d[1] + S[2][1] * d[2],
      S[0][2] * d[0] + S[1][2] * d[1] + S[2][2] * d[2],
    ];
    if (!this.ballImg || this.ballImg.width !== size) this.ballImg = ctx.createImageData(size, size);
    const img = this.ballImg;
    const up = i.dirs.radialOut ? body(i.dirs.radialOut) : null;
    const px = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5 - C0) / R0, v = (C0 - y - 0.5) / R0;
        const q = u * u + v * v;
        const o = (y * size + x) * 4;
        if (q > 1) {
          px[o + 3] = 0;
          continue;
        }
        const d: V3 = [-u, v, Math.sqrt(1 - q)];
        let col: [number, number, number] = [28, 34, 44];
        if (up) {
          const e = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
          col = e > 0 ? [40, 96, 156] : [96, 66, 40];
          const lat = Math.asin(Math.max(-1, Math.min(1, e))) / (Math.PI / 6);
          if (Math.abs(lat - Math.round(lat)) < 0.035 / Math.max(Math.sqrt(1 - q), 0.2)) col = Math.round(lat) === 0 ? [255, 255, 255] : [200, 206, 218];
        }
        const shade = 0.5 + 0.5 * Math.sqrt(1 - q);
        px[o] = col[0] * shade;
        px[o + 1] = col[1] * shade;
        px[o + 2] = col[2] * shade;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // throttle arc: the left side around the ball, bottom → top
    const a0 = Math.PI * 0.62, a1 = Math.PI * 1.38;
    const t = Math.max(0, Math.min(1, i.throttle));
    ctx.lineCap = "round";
    ctx.lineWidth = 7 * dpr;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.beginPath();
    ctx.arc(C0, C0, R0 + 8 * dpr, a0, a1);
    ctx.stroke();
    if (t > 0.001) {
      const g = ctx.createLinearGradient(0, size, 0, 0);
      g.addColorStop(0, "#ff6a2c");
      g.addColorStop(1, "#ffd27a");
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.arc(C0, C0, R0 + 8 * dpr, a0, a0 + (a1 - a0) * t);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(235, 238, 245, 0.9)";
    ctx.font = `600 ${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(t * 100)}%`, 2 * dpr, 12 * dpr);
    // rotation rates: short arcs on the right (pitch) and at the bottom (yaw)
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(255, 200, 90, 0.85)";
    const w = i.omega;
    const arc = (mid: number, v: number) => {
      const k = Math.max(-1, Math.min(1, v / 0.75)) * 0.5;
      if (Math.abs(k) < 0.01) return;
      ctx.beginPath();
      ctx.arc(C0, C0, R0 + 8 * dpr, Math.min(mid, mid + k), Math.max(mid, mid + k));
      ctx.stroke();
    };
    arc(0, w[0]);
    arc(Math.PI / 2, -w[1]);
    // orbital markers (front hemisphere; behind: on the rim, dimmed)
    const r = 8 * dpr;
    ctx.lineWidth = 1.8 * dpr;
    for (const k of ["prograde", "retrograde", "radialOut", "radialIn", "normal", "antinormal", "target", "burn", "tgtPrograde"] as const) {
      const dd = i.dirs[k];
      if (!dd) continue;
      const b = body(dd);
      let x = -b[0], y = b[1];
      let alpha = 1;
      if (b[2] < 0) {
        const l = Math.hypot(x, y) || 1;
        (x /= l), (y /= l), (alpha = 0.4);
      }
      ctx.globalAlpha = alpha;
      marker(ctx, GLYPH[k]!, C0 + x * (R0 - r), C0 - y * (R0 - r), r, COL[k]!);
    }
    ctx.globalAlpha = 1;
    // the nose
    ctx.strokeStyle = "#ffc85a";
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(C0 - 18 * dpr, C0);
    ctx.lineTo(C0 - 7 * dpr, C0);
    ctx.lineTo(C0, C0 + 6 * dpr);
    ctx.lineTo(C0 + 7 * dpr, C0);
    ctx.lineTo(C0 + 18 * dpr, C0);
    ctx.stroke();
  }

  // ------------------------------------------------------------------------------------ map
  private drawMap(i: Info, t0: number) {
    const c = this.map;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 260) * dpr);
    const ch = Math.round((c.clientHeight || 260) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    const s = this.s;
    ctx.font = `${10.5 * dpr}px Inter, system-ui, sans-serif`;
    if (i.region !== "hole" || !i.X) {
      ctx.fillStyle = "rgba(220, 225, 235, 0.8)";
      ctx.textAlign = "center";
      ctx.fillText(`In the wormhole · ℓ = ${i.ell.toFixed(2)} M`, cw / 2, ch / 2);
      return;
    }
    const X0 = i.X;
    const massive = s.sun && s.sunMass > 0;
    const cm = massive && this.frame === "cm";
    // frame: positions relative to the centre of mass at their own time (or to Gargantua)
    const B = (t: number): V3 => (cm ? barycentre(s, t) : [0, 0, 0]);
    const at = (X: V3, t: number): V3 => sub(X, B(t));
    const side = this.view === "side";
    const pr = (X: V3): [number, number] => (side ? [X[0], X[2]] : [X[0], X[1]]);
    const path = i.path;
    const T = path ? Math.max(path.pts.length * path.dt, 50) : 200;
    // what the view must hold: the ship, its path and trail, the hole, the disk
    const pts: [number, number][] = [pr(at(X0, t0)), pr(at([0, 0, 0], t0))];
    if (path) path.pts.forEach((q, j) => pts.push(pr(at(q, t0 + (j + 1) * path.dt))));
    for (const q of this.trail) pts.push(pr(at(q.X, q.t)));
    // the target too (the star now and at the closest approach, the mouth)
    if (i.target === "star" && s.sun) {
      pts.push(pr(at(starCentre(s, t0), t0)));
      const ca = this.closestApproach(i, t0);
      if (ca) pts.push(pr(at(starCentre(s, t0 + ca.t), t0 + ca.t)));
    } else if (i.target === "wormhole" && s.wormhole) pts.push(pr(at(mouth(s).C as V3, t0)));
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 2; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
    const hc = pr(at([0, 0, 0], t0));
    const rDisk = s.disk ? s.diskOuter : 6;
    lo[0] = Math.min(lo[0]!, hc[0] - rDisk), hi[0] = Math.max(hi[0]!, hc[0] + rDisk);
    lo[1] = Math.min(lo[1]!, hc[1] - (side ? 2 : rDisk)), hi[1] = Math.max(hi[1]!, hc[1] + (side ? 2 : rDisk));
    const want = Math.max((hi[0]! - lo[0]!) / 2, ((hi[1]! - lo[1]!) / 2) * (cw / ch), 6) * 1.12 * this.zoom;
    const cen: [number, number] = [(hi[0]! + lo[0]!) / 2, (hi[1]! + lo[1]!) / 2];
    this.extent += (want - this.extent) * 0.1;
    this.centre[0] += (cen[0] - this.centre[0]) * 0.1;
    this.centre[1] += (cen[1] - this.centre[1]) * 0.1;
    const k = (cw / 2 - 8 * dpr) / this.extent;
    const P = (X: V3): [number, number] => {
      const q = pr(X);
      return [cw / 2 + (q[0] - this.centre[0]) * k, ch / 2 - (q[1] - this.centre[1]) * k];
    };
    const poly = (list: V3[], stroke: string, width: number, dash: number[] = []) => {
      if (list.length < 2) return;
      ctx.beginPath();
      list.forEach((X, j) => (j ? ctx.lineTo(...P(X)) : ctx.moveTo(...P(X))));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // around the hole at t0 (equatorial circles: seen edge-on, segments)
    const hole = at([0, 0, 0], t0);
    const ring = (r: number, stroke: string, dash: number[] = []) => {
      ctx.beginPath();
      const [x, y] = P(hole);
      if (side) {
        ctx.moveTo(x - r * k, y);
        ctx.lineTo(x + r * k, y);
      } else ctx.arc(x, y, Math.max(r * k, 0.6), 0, 2 * Math.PI);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2 * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (s.disk) {
      const [x, y] = P(hole);
      ctx.fillStyle = "rgba(255, 150, 60, 0.16)";
      if (side) ctx.fillRect(x - s.diskOuter * k, y - 1.5 * dpr, 2 * s.diskOuter * k, 3 * dpr);
      else {
        ctx.beginPath();
        ctx.arc(x, y, s.diskOuter * k, 0, 2 * Math.PI);
        ctx.arc(x, y, isco(s.spin) * k, 0, 2 * Math.PI, true);
        ctx.fill();
      }
    }
    ring(i.isco, "rgba(120, 230, 150, 0.65)", [4, 3]);
    ring(i.photon, "rgba(255, 220, 120, 0.55)", [1.5, 2.5]);
    if (!side) ring(2, "rgba(150, 170, 255, 0.45)", [3, 3]); // ergosphere (equator)
    {
      const [x, y] = P(hole);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(i.rH * k, 2.5 * dpr), 0, 2 * Math.PI);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
    }
    // the bodies' real paths over the span of the ship's prediction (and some of their past)
    const span = (f: (t: number) => V3, a: number, b: number, n = 120) =>
      Array.from({ length: n + 1 }, (_, j) => {
        const t = a + ((b - a) * j) / n;
        return at(f(t), t);
      });
    const tick = niceStep(T / 6);
    const tickTimes = Array.from({ length: Math.floor(T / tick) }, (_, j) => t0 + (j + 1) * tick);
    if (cm) {
      // Gargantua's own motion around the centre of mass (⊕)
      poly(span(() => [0, 0, 0], t0 - T * 0.5, t0), "rgba(255, 255, 255, 0.25)", 1.2);
      poly(span(() => [0, 0, 0], t0, t0 + T), "rgba(255, 255, 255, 0.55)", 1.2, [3, 3]);
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      for (const tt of tickTimes) {
        const [x, y] = P(at([0, 0, 0], tt));
        ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
      }
      const [bx, by] = P([0, 0, 0]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.arc(bx, by, 3.5 * dpr, 0, 2 * Math.PI);
      ctx.moveTo(bx - 6 * dpr, by);
      ctx.lineTo(bx + 6 * dpr, by);
      ctx.moveTo(bx, by - 6 * dpr);
      ctx.lineTo(bx, by + 6 * dpr);
      ctx.stroke();
    }
    if (s.sun) {
      const period = (2 * Math.PI) / Math.max(starOmega(s), 1e-9);
      poly(span((t) => starCentre(s, t), t0, t0 + period, 180), "rgba(255, 220, 140, 0.16)", 1);
      poly(span((t) => starCentre(s, t), t0 - Math.min(T * 0.5, period * 0.3), t0), "rgba(255, 211, 107, 0.35)", 1.5);
      poly(span((t) => starCentre(s, t), t0, t0 + Math.min(T, period)), "rgba(255, 211, 107, 0.85)", 1.5, [4, 3]);
      ctx.fillStyle = "rgba(255, 211, 107, 0.95)";
      for (const tt of tickTimes) {
        const [x, y] = P(at(starCentre(s, tt), tt));
        ctx.beginPath();
        ctx.arc(x, y, 2 * dpr, 0, 2 * Math.PI);
        ctx.fill();
      }
      const [x, y] = P(at(starCentre(s, t0), t0));
      ctx.beginPath();
      ctx.arc(x, y, Math.max(s.sunRadius * k, 3.5 * dpr), 0, 2 * Math.PI);
      ctx.fillStyle = "#ffd36b";
      ctx.fill();
    }
    if (s.wormhole) {
      const m = mouth(s);
      if (cm) poly(span(() => m.C as V3, t0, t0 + T, 60), "rgba(200, 140, 255, 0.35)", 1, [2, 3]);
      const [x, y] = P(at(m.C as V3, t0));
      ctx.beginPath();
      ctx.arc(x, y, Math.max(m.rGlue * k, 3 * dpr), 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(200, 140, 255, 0.9)";
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
    }
    // the ship: its trail, predicted geodesic with the common time ticks, closest approach
    poly([...this.trail.map((q) => at(q.X, q.t)), at(X0, t0)], "rgba(120, 200, 255, 0.5)", 1.4);
    if (path && path.pts.length > 1) {
      const fut = [at(X0, t0), ...path.pts.map((q, j) => at(q, t0 + (j + 1) * path.dt))];
      const bad = path.fate === "horizon" || path.fate === "star";
      poly(fut, bad ? "rgba(255, 90, 70, 0.95)" : "rgba(255, 190, 80, 0.95)", 1.7, [5, 3]);
      ctx.textAlign = "left";
      tickTimes.forEach((tt, j) => {
        const idx = (tt - t0) / path.dt - 1;
        if (idx < 0 || idx >= path.pts.length - 1) return;
        const a = path.pts[Math.floor(idx)]!, b = path.pts[Math.floor(idx) + 1]!;
        const f = idx - Math.floor(idx);
        const [x, y] = P(at([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tt));
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        if (j % 2 === 1) ctx.fillText(`+${fmtShort((j + 1) * tick)}`, x + 4 * dpr, y - 3 * dpr);
      });
      // apsides and impact
      let iMin = -1, iMax = -1, rMin = Infinity, rMax = -Infinity;
      path.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (r < rMin) (rMin = r), (iMin = j);
        if (r > rMax) (rMax = r), (iMax = j);
      });
      const label = (j: number, txt: string) => {
        if (j <= 0 || j >= path.pts.length - 1) return;
        const [x, y] = P(at(path.pts[j]!, t0 + (j + 1) * path.dt));
        ctx.fillStyle = "#9fe3ff";
        ctx.font = `600 ${10.5 * dpr}px Inter, system-ui, sans-serif`;
        ctx.fillText(txt, x + 5 * dpr, y + 11 * dpr);
        ctx.font = `${10.5 * dpr}px Inter, system-ui, sans-serif`;
      };
      label(iMin, "Pe");
      if (path.fate === "continues") label(iMax, "Ap");
      if (bad) {
        const [x, y] = P(fut[fut.length - 1]!);
        ctx.strokeStyle = "#ff5a46";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - 4 * dpr, y - 4 * dpr);
        ctx.lineTo(x + 4 * dpr, y + 4 * dpr);
        ctx.moveTo(x + 4 * dpr, y - 4 * dpr);
        ctx.lineTo(x - 4 * dpr, y + 4 * dpr);
        ctx.stroke();
      }
      const ca = this.closestApproach(i, t0);
      if (ca && ca.t > 0) {
        const j = Math.max(0, Math.round(ca.t / path.dt) - 1);
        const q = path.pts[Math.min(j, path.pts.length - 1)]!;
        const tt = t0 + ca.t;
        const tgt: V3 = i.target === "star" ? starCentre(s, tt) : (mouth(s).C as V3);
        const [x1, y1] = P(at(q, tt));
        const [x2, y2] = P(at(tgt, tt));
        ctx.strokeStyle = "rgba(255, 138, 92, 0.9)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ff8a5c";
        ctx.fillText(`CA ${ca.d.toFixed(1)} M`, (x1 + x2) / 2 + 5 * dpr, (y1 + y2) / 2);
      }
    }
    // view cone (the camera's direction), velocity, the ship along its nose
    const [sx, sy] = P(at(X0, t0));
    if (i.look) {
      const q = pr(i.look);
      const l = Math.hypot(q[0], q[1]);
      if (l > 0.05) {
        const a = Math.atan2(-q[1], q[0]);
        const half = Math.min(1.2, ((s.fov * Math.PI) / 360) * 1.4);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60 * dpr);
        g.addColorStop(0, "rgba(255, 255, 255, 0.2)");
        g.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, 60 * dpr * Math.min(1, l * 1.5), a - half, a + half);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (i.V) {
      const q = pr(i.V);
      const vl = Math.hypot(q[0], q[1]);
      if (vl > 1e-6) {
        const len = 24 * dpr * Math.min(1, vl * 3 + 0.3);
        ctx.strokeStyle = COL.prograde!;
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (q[0] / vl) * len, sy - (q[1] / vl) * len);
        ctx.stroke();
      }
    }
    const n = i.nose ? pr(i.nose) : [1, 0];
    const a = Math.hypot(n[0]!, n[1]!) < 1e-3 ? 0 : Math.atan2(-n[1]!, n[0]!);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(9 * dpr, 0);
    ctx.lineTo(-5 * dpr, 5.5 * dpr);
    ctx.lineTo(-2.5 * dpr, 0);
    ctx.lineTo(-5 * dpr, -5.5 * dpr);
    ctx.closePath();
    ctx.fillStyle = "#ffc85a";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1 * dpr;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // legend
    const bar = niceStep(this.extent / 2.5);
    ctx.strokeStyle = "rgba(230, 235, 245, 0.8)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(10 * dpr, ch - 10 * dpr);
    ctx.lineTo(10 * dpr + bar * k, ch - 10 * dpr);
    ctx.stroke();
    ctx.fillStyle = "rgba(230, 235, 245, 0.85)";
    ctx.textAlign = "left";
    ctx.fillText(`${bar} M`, 10 * dpr, ch - 15 * dpr);
    ctx.textAlign = "right";
    ctx.fillText(`ticks every ${fmtShort(tick)}`, cw - 8 * dpr, ch - 10 * dpr);
    ctx.fillText(`${side ? "edge-on · " : ""}z ${X0[2] >= 0 ? "+" : "−"}${Math.abs(X0[2]).toFixed(1)} M`, cw - 8 * dpr, 14 * dpr);
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function marker(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number, col: string) {
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === "prograde") {
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

/** The marker's glyph as a small SVG, for the buttons. */
function glyphSvg(kind: string, col: string) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-12 -12 24 24");
  svg.setAttribute("class", "fl-glyph");
  const d =
    kind === "prograde" ? "M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M0 -5V-10M-5 0H-10M5 0H10" :
    kind === "retrograde" ? "M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5" :
    kind === "target" ? "M-6 -6H6V6H-6Z" : "M-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M-4 0H4M0 -4V4";
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", col);
  p.setAttribute("stroke-width", "2");
  svg.append(p);
  return svg;
}

function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9)));
  const m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

function fmtShort(t: number) {
  return t >= 1000 ? `${+(t / 1000).toFixed(1)}k M` : `${t} M`;
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
