// The Ranger's cockpit screens: the flight's real telemetry, drawn as the film's displays — cyan
// monochrome, sharp text — into a 2048 × 1024 picture of 4 × 2 slots (512 px each) that the cabin's
// shader shows on its screens (ship.wgsl fsCabin; each screen's display given by where it is,
// scripts/build-cockpit.ts: the attitude straight before the pilot). Redrawn a few times a second while
// the cabin is seen.
//
//   0 PFD        the attitude (the horizon, the pitch ladder, the roll), the motion's marker, speed and
//                height tapes, the vertical speed
//   1 ORBIT      the orbit to scale round its body, apoapsis, periapsis, eccentricity, inclination, period
//   2 NAV        the target: distance, closing rate, closest approach; the path's next event
//   3 SYSTEMS    thrust, acceleration, thrust-to-weight, propellant, the mass flown, SAS / hold / autopilot
//   4 DOCKING    the port in reach: range, closing, offset (a cross-hair), the ports' angle; what is docked
//   5 PLAN       the manoeuvre nodes: when, how much; the plan's note
//   6 CLOCKS     (black, amber) the date, the scene's time, the ship's proper time, the warp
//   7 LOG        (black, white) the pilot's messages, the latest last

import type { Info } from "./flighthud";
import type { RunwayView } from "../controls";
import type { RangerStatus } from "../game/status";
import type { Settings } from "../settings";
import { VESSELS } from "../vessels";
import { EPOCH_DATE, M_SECONDS } from "../system/solar";
import { C_MPS, G0, M_METRES } from "../units";
import { caught } from "../debug";

const W = 2048, H = 1024, SLOT = 512;
/** the screens are portrait (≈ 3:4): each slot drawn in 512 × 683 units, squeezed into its square — the
 *  screen stretches it back */
const SH = 683;
const C = C_MPS;
const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
// the film's palette: cyan screens, their lines and text; the black ones' white and amber
const BG = "#04212c", PANEL = "#08394a", LINE = "#62e6ff", TEXT = "#c6f7ff", DIM = "#3c9fb6", AMBER = "#ffb347", RED = "#ff5a46", GREEN = "#7dff9a";

type V3 = [number, number, number];
/** near the ground (FlightHud's Info.surface) */
type SurfaceLike = { alt: number; vVert: number; vHor: number; twr: number; gLocal: number; landed?: boolean };
/** the air's figures the screens draw (FlightHud's Info.air) */
type AirLike = { u?: number[] | null; q: number; alpha: number; beta?: number; stalled?: boolean; stallA?: number | null; bestA?: number | null; speed?: number; heading?: number; pitch?: number; sf?: { speed: number; gamma: number; heading: number } | null };

export interface ScreenData {
  info: Info;
  status: RangerStatus | null;
  settings: Settings;
  /** the scene time [M] */
  time: number;
  /** the runway in reach (controls.ts runwayView): the NAV screen's approach */
  runway?: RunwayView | null;
}

const fmtKm = (km: number) => (!Number.isFinite(km) ? "∞" : Math.abs(km) >= 1e6 ? `${(km / 1e6).toFixed(2)} Gm` : Math.abs(km) >= 1e4 ? `${Math.round(km).toLocaleString("en-US")} km` : Math.abs(km) >= 10 ? `${km.toFixed(1)} km` : `${(km * 1000).toFixed(0)} m`);
const fmtSpeed = (ms: number) => (!Number.isFinite(ms) ? "—" : Math.abs(ms) >= 1e4 ? `${(ms / 1000).toFixed(2)} km/s` : `${ms.toFixed(1)} m/s`);
const fmtDur = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  const sign = s < 0 ? "−" : "";
  if (a < 60) return `${sign}${a.toFixed(0)} s`;
  if (a < 3600) return `${sign}${Math.floor(a / 60)}m ${String(Math.floor(a % 60)).padStart(2, "0")}s`;
  if (a < 86400 * 2) return `${sign}${Math.floor(a / 3600)}h ${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}m`;
  return `${sign}${(a / 86400).toFixed(1)} d`;
};

/**
 * The attitude the PFD shows, from the local up on the ship's axes (x left, y up, z nose): the roll
 * (> 0 banked right: the right wing low, the up leaning to the ship's left) and the pitch (> 0 nose up).
 * The horizon is drawn turned by −roll — banked right, its right end rises, the ground on the right —,
 * as the HUD's attitude ball shows it (its pixel to the right is the ship's −x).
 */
export function pfdAttitude(up: readonly number[] | null): { roll: number; pitch: number } {
  if (!up) return { roll: 0, pitch: 0 };
  return { roll: Math.atan2(up[0]!, up[1]!), pitch: Math.asin(Math.max(-1, Math.min(1, up[2]!))) };
}

export class CockpitScreens {
  readonly canvas = new OffscreenCanvas(W, H);
  private g = this.canvas.getContext("2d")!;
  private log: { t: number; text: string }[] = [];
  private lastDraw = -Infinity;

  /** A pilot's message for the log screen. */
  message(text: string) {
    this.log.push({ t: performance.now(), text });
    if (this.log.length > 30) this.log.shift();
  }

  /** Redraws the screens (at most `hz` times a second): whether it did. */
  draw(d: ScreenData, hz = 8): boolean {
    const now = performance.now();
    if (now - this.lastDraw < 1000 / hz) return false;
    this.lastDraw = now;
    const g = this.g;
    g.clearRect(0, 0, W, H);
    const slots: ((g: OffscreenCanvasRenderingContext2D, d: ScreenData) => void)[] = [
      (g, d) => this.pfd(g, d), (g, d) => this.orbit(g, d), (g, d) => this.nav(g, d), (g, d) => this.systems(g, d),
      (g, d) => this.docking(g, d), (g, d) => this.plan(g, d), (g, d) => this.clocks(g, d), (g, d) => this.logScreen(g, d),
    ];
    slots.forEach((fn, i) => {
      g.save();
      g.translate((i % 4) * SLOT, Math.floor(i / 4) * SLOT);
      g.beginPath();
      g.rect(0, 0, SLOT, SLOT);
      g.clip();
      g.scale(1, SLOT / SH);
      try {
        fn(g, d);
      } catch (e) {
        caught(`cockpit screen ${i}`, e); // (the slot left as it was drawn)
      }
      g.restore();
    });
    return true;
  }

  // ---------------------------------------------------------------------------------- helpers
  private frame(g: OffscreenCanvasRenderingContext2D, title: string, dark = false) {
    g.fillStyle = dark ? "#020304" : BG;
    g.fillRect(0, 0, SLOT, SH);
    if (!dark) {
      // (the film's screens: a faint grid, a lighter panel behind the title)
      g.strokeStyle = "rgba(98, 230, 255, 0.07)";
      g.lineWidth = 1;
      for (let x = 32; x < SH; x += 32) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, SH);
        g.moveTo(0, x);
        g.lineTo(SLOT, x);
        g.stroke();
      }
      g.fillStyle = PANEL;
      g.fillRect(0, 0, SLOT, 50);
    }
    g.fillStyle = dark ? AMBER : TEXT;
    g.font = `700 26px ${FONT}`;
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText(title, 18, 26);
    g.strokeStyle = dark ? "rgba(255, 179, 71, 0.5)" : LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 50);
    g.lineTo(SLOT, 50);
    g.stroke();
  }
  /** label: value rows from y, two columns */
  private rows(g: OffscreenCanvasRenderingContext2D, rows: [string, string, string?][], y0: number, colour = TEXT, step = 40, x0 = 18, size = 25) {
    rows.forEach(([k, v, c], i) => {
      const y = y0 + i * step;
      g.font = `600 ${size - 3}px ${FONT}`;
      g.fillStyle = DIM;
      g.textAlign = "left";
      g.fillText(k, x0, y);
      g.font = `700 ${size}px ${FONT}`;
      g.fillStyle = c ?? colour;
      g.textAlign = "right";
      g.fillText(v, SLOT - 18, y);
    });
    g.textAlign = "left";
  }
  private bar(g: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: number, colour: string, label: string) {
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    g.fillStyle = colour;
    const fh = Math.max(0, Math.min(1, f)) * (h - 6);
    g.fillRect(x + 3, y + h - 3 - fh, w - 6, fh);
    g.fillStyle = DIM;
    g.font = `600 18px ${FONT}`;
    g.textAlign = "center";
    g.fillText(label, x + w / 2, y + h + 18);
    g.fillStyle = TEXT;
    g.fillText(`${Math.round(Math.max(0, Math.min(1, f)) * 100)}`, x + w / 2, y - 14);
    g.textAlign = "left";
  }

  /** the local up and the motion on the ship's axes (x left, y up, z nose) */
  private shipVectors(info: Info): { up: V3 | null; pro: V3 | null } {
    const S = info.S as unknown as number[][];
    const toShip = (v: number[] | null | undefined): V3 | null => (v ? ([0, 1, 2].map((i) => S[0]![i]! * v[0]! + S[1]![i]! * v[1]! + S[2]![i]! * v[2]!) as V3) : null);
    return { up: toShip(info.dirs.radialOut as number[] | null), pro: toShip(info.dirs.prograde as number[] | null) };
  }

  // ---------------------------------------------------------------------------------- 0 PFD
  private pfd(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    this.frame(g, "PFD · ATTITUDE");
    const { up, pro } = this.shipVectors(d.info);
    const cx = SLOT / 2, cy = 300, R = 180;
    const { roll, pitch } = pfdAttitude(up);
    const pxDeg = 5.2;
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, 2 * Math.PI);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-roll);
    // the sky above (the horizon pitched), the ground below
    const hy = (pitch * 180) / Math.PI * pxDeg;
    g.fillStyle = "#0c5a76";
    g.fillRect(-400, -400 + hy, 800, 400);
    g.fillStyle = "#06222c";
    g.fillRect(-400, hy, 800, 400);
    g.strokeStyle = TEXT;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-400, hy);
    g.lineTo(400, hy);
    g.stroke();
    // the pitch ladder, every 10°
    g.font = `600 18px ${FONT}`;
    g.fillStyle = TEXT;
    g.lineWidth = 2;
    for (let a = -80; a <= 80; a += 10) {
      if (a === 0) continue;
      const y = hy - a * pxDeg;
      if (Math.abs(y) > R + 20) continue;
      const w = a % 20 === 0 ? 70 : 40;
      g.beginPath();
      g.moveTo(-w, y);
      g.lineTo(w, y);
      g.stroke();
      if (a % 20 === 0) {
        g.textAlign = "right";
        g.fillText(`${a}`, -w - 8, y + 6);
        g.textAlign = "left";
        g.fillText(`${a}`, w + 8, y + 6);
      }
    }
    g.restore();
    // the bezel, the roll's scale and pointer
    g.strokeStyle = LINE;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R, 0, 2 * Math.PI);
    g.stroke();
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const t = ((a - 90) * Math.PI) / 180;
      const l = a % 30 === 0 ? 18 : 10;
      g.beginPath();
      g.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
      g.lineTo(cx + Math.cos(t) * (R + l), cy + Math.sin(t) * (R + l));
      g.stroke();
    }
    const rp = -roll - Math.PI / 2;
    g.fillStyle = AMBER;
    g.beginPath();
    g.moveTo(cx + Math.cos(rp) * (R - 4), cy + Math.sin(rp) * (R - 4));
    g.lineTo(cx + Math.cos(rp - 0.05) * (R - 24), cy + Math.sin(rp - 0.05) * (R - 24));
    g.lineTo(cx + Math.cos(rp + 0.05) * (R - 24), cy + Math.sin(rp + 0.05) * (R - 24));
    g.fill();
    // the craft's symbol (fixed), the motion's marker (where it goes)
    g.strokeStyle = AMBER;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - 80, cy);
    g.lineTo(cx - 30, cy);
    g.lineTo(cx - 20, cy + 12);
    g.moveTo(cx + 80, cy);
    g.lineTo(cx + 30, cy);
    g.lineTo(cx + 20, cy + 12);
    g.stroke();
    g.fillStyle = AMBER;
    g.fillRect(cx - 4, cy - 4, 8, 8);
    // the flight path: through the air in it (the air's flow on the ship's axes), else the orbit's
    const Aa = d.info.air as AirLike | null | undefined;
    const inAir = !!(Aa && Aa.u && Aa.q > 20);
    const fpv = inAir ? (Aa!.u as V3) : pro;
    if (fpv && fpv[2] > 0) {
      const mx = cx + (Math.atan2(-fpv[0], fpv[2]) * 180) / Math.PI * pxDeg, my = cy - (Math.asin(Math.max(-1, Math.min(1, fpv[1]))) * 180) / Math.PI * pxDeg;
      if (Math.hypot(mx - cx, my - cy) < R - 10) {
        g.strokeStyle = Aa?.stalled && inAir ? RED : GREEN;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(mx, my, 12, 0, 2 * Math.PI);
        g.moveTo(mx - 24, my);
        g.lineTo(mx - 12, my);
        g.moveTo(mx + 12, my);
        g.lineTo(mx + 24, my);
        g.moveTo(mx, my - 12);
        g.lineTo(mx, my - 22);
        g.stroke();
        if (inAir && d.settings.cockpitAids) this.pfdAir(g, d, Aa!, mx, my, pxDeg, roll, pitch);
      }
    }
    if (d.settings.cockpitAids) this.pfdHeading(g, d, cx);
    // the figures: speed, height, vertical speed, pitch and roll
    const st = d.status;
    g.font = `700 24px ${FONT}`;
    g.fillStyle = TEXT;
    g.textAlign = "left";
    g.fillText(st ? fmtSpeed(st.speed) : "—", 14, 640);
    g.textAlign = "right";
    g.fillText(st ? fmtKm(st.altKm) : "—", SLOT - 14, 640);
    g.textAlign = "center";
    g.font = `600 20px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText(`PITCH ${((pitch * 180) / Math.PI).toFixed(1)}°  ROLL ${((roll * 180) / Math.PI).toFixed(1)}°`, cx, 535);
    // in the air: Mach, the dynamic pressure, the angle of attack, the load
    const A = (d.info as { air?: { inAir: boolean; mach: number; q: number; alpha: number; g: number; margins: { shield: number; hull: number; g: number }; mode: string } }).air;
    if (A?.inAir) {
      const hot = Math.max(A.margins.shield, A.margins.hull, A.margins.g) > 0.85;
      g.fillStyle = hot ? RED : AMBER;
      g.font = `700 19px ${FONT}`;
      g.fillText(`M ${A.mach.toFixed(2)} · q ${A.q >= 1000 ? `${(A.q / 1000).toFixed(1)} kPa` : `${A.q.toFixed(0)} Pa`} · α ${((A.alpha * 180) / Math.PI).toFixed(1)}° · ${A.g.toFixed(2)} G`, cx, 503);
      g.font = `600 20px ${FONT}`;
      g.fillStyle = DIM;
    }
    g.fillStyle = st && st.vVert < 0 ? AMBER : TEXT;
    g.fillText(st ? `V/S ${st.vVert >= 0 ? "+" : "−"}${fmtSpeed(Math.abs(st.vVert))}` : "", cx, 570);
    g.textAlign = "left";
    g.fillStyle = DIM;
    g.fillText("SPD", 14, 610);
    g.textAlign = "right";
    g.fillText("ALT", SLOT - 14, 610);
    g.textAlign = "left";
  }

  /**
   * The PFD in the air, about the flight path marker (the HUD's own cues, ui/hud/symbology.ts): the
   * angle of attack — the craft's symbol at the centre stands α above the flight path, so the best
   * lift-to-drag band (green bracket), 85 % of the stall (amber) and the stall (red) are marked above the
   * marker —; the energy chevron (the speed's rate as the climb it would buy); the sideslip ball; the
   * flight director (the flight computer's commanded path, on the rolled ladder).
   */
  private pfdAir(g: OffscreenCanvasRenderingContext2D, d: ScreenData, A: AirLike, mx: number, my: number, pxDeg: number, roll: number, pitch: number) {
    const deg = 180 / Math.PI;
    const s = d.settings;
    if (s.hudAoA && A.stallA) {
      const up = (a: number) => my - a * deg * pxDeg;
      if (A.bestA) {
        const lo = up(A.bestA - 1.5 / deg), hi = up(A.bestA + 1.5 / deg);
        g.strokeStyle = GREEN;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(mx - 30, hi);
        g.lineTo(mx - 40, hi);
        g.lineTo(mx - 40, lo);
        g.lineTo(mx - 30, lo);
        g.stroke();
      }
      for (const [a, col, w] of [[A.stallA * 0.85, AMBER, 22], [A.stallA, RED, 34]] as const) {
        g.strokeStyle = col;
        g.lineWidth = a === A.stallA ? 4 : 3;
        g.beginPath();
        g.moveTo(mx - w, up(a));
        g.lineTo(mx + w, up(a));
        g.stroke();
      }
      // the sideslip: a ball under the marker
      const b = Math.max(-1, Math.min(1, ((A.beta ?? 0) * deg) / 8));
      g.strokeStyle = DIM;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(mx - 34, my + 38);
      g.lineTo(mx + 34, my + 38);
      g.stroke();
      g.fillStyle = Math.abs(b) > 0.5 ? AMBER : TEXT;
      g.beginPath();
      g.arc(mx + b * 34, my + 38, 6, 0, 2 * Math.PI);
      g.fill();
    }
    // the energy chevron
    if (s.hudEnergy && Number.isFinite(A.speed)) {
      const now = performance.now() / 1000;
      const E = this.energy;
      if (Number.isFinite(E.v) && now > E.t) E.a += ((A.speed! - E.v) / Math.max(now - E.t, 1e-3) - E.a) * Math.min(1, (now - E.t) / 0.6);
      E.t = now;
      E.v = A.speed!;
      const y = my - Math.atan(E.a / G0) * deg * pxDeg;
      g.strokeStyle = Math.abs(E.a) < 0.3 ? TEXT : E.a > 0 ? GREEN : AMBER;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(mx - 62, y - 9);
      g.lineTo(mx - 52, y);
      g.lineTo(mx - 62, y + 9);
      g.stroke();
    }
    // the flight director: on the rolled ladder, the commanded climb angle and heading
    if (s.hudDirector && A.sf && Number.isFinite(A.heading)) {
      let dh = (A.sf.heading - (A.heading ?? 0)) * deg;
      dh = ((dh + 540) % 360) - 180;
      // (in the rolled ladder's frame: the horizon at the nose's pitch below the centre, the commanded
      // climb above it, the heading's difference across)
      const lx = dh * pxDeg, ly = (pitch - A.sf.gamma) * deg * pxDeg;
      const cx = SLOT / 2, cy = 300;
      const c = Math.cos(-roll), sn = Math.sin(-roll);
      const fx = cx + lx * c - ly * sn, fy = cy + lx * sn + ly * c;
      if (Math.hypot(fx - cx, fy - cy) < 170) {
        g.strokeStyle = "#e07bff";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(fx, fy, 9, 0, 2 * Math.PI);
        g.moveTo(fx - 20, fy);
        g.lineTo(fx - 9, fy);
        g.moveTo(fx + 9, fy);
        g.lineTo(fx + 20, fy);
        g.stroke();
      }
    }
  }
  private energy = { t: 0, v: NaN, a: 0 };

  /** The heading tape over the PFD's ball: the nose's heading against the world's north, ticks every 5°. */
  private pfdHeading(g: OffscreenCanvasRenderingContext2D, d: ScreenData, cx: number) {
    const S = d.info.S as unknown as number[][];
    const toShip = (v: number[] | null | undefined): V3 | null => (v ? ([0, 1, 2].map((i) => S[0]![i]! * v[0]! + S[1]![i]! * v[1]! + S[2]![i]! * v[2]!) as V3) : null);
    const up = toShip(d.info.dirs.up as number[] | null), north = toShip(d.info.dirs.north as number[] | null);
    if (!up || !north) return;
    // (the ship's frame is right-handed — x left, y up, z the nose —: east = north × up)
    const east: V3 = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
    if (Math.hypot(north[2], east[2]) < 1e-3) return;
    const hd = (((Math.atan2(east[2], north[2]) * 180) / Math.PI) + 360) % 360;
    const y = 96, wd = 380, dpx = wd / 60;
    g.save();
    g.beginPath();
    g.rect(cx - wd / 2, 58, wd, 48);
    g.clip();
    g.strokeStyle = LINE;
    g.fillStyle = TEXT;
    g.lineWidth = 2;
    g.font = `600 17px ${FONT}`;
    g.textAlign = "center";
    for (let a = Math.floor((hd - 35) / 5) * 5; a <= hd + 35; a += 5) {
      const x = cx + (a - hd) * dpx;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - (a % 10 === 0 ? 12 : 6));
      g.stroke();
      if (a % 10 === 0) {
        const v = ((a % 360) + 360) % 360;
        g.fillText({ 0: "N", 90: "E", 180: "S", 270: "W" }[v] ?? String(v / 10).padStart(2, "0"), x, y - 22);
      }
    }
    g.restore();
    g.fillStyle = AMBER;
    g.beginPath();
    g.moveTo(cx, y + 2);
    g.lineTo(cx - 7, y + 12);
    g.lineTo(cx + 7, y + 12);
    g.fill();
    g.fillStyle = "#04212c";
    g.fillRect(cx + wd / 2 - 70, 60, 70, 26);
    g.fillStyle = "#ffffff";
    g.font = `700 20px ${FONT}`;
    g.textAlign = "right";
    g.fillText(`${String(Math.round(hd) % 360).padStart(3, "0")}°`, cx + wd / 2 - 6, 74);
    g.textAlign = "left";
  }

  // ---------------------------------------------------------------------------------- 1 ORBIT
  private orbit(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const st = d.status;
    this.frame(g, `ORBIT · ${st?.soiName?.toUpperCase() ?? "—"}`);
    const o = st?.orbit;
    const cx = SLOT / 2, cy = 245;
    if (o && Number.isFinite(o.apKm) && st) {
      const Rkm = o.aKm * (1 - o.ecc) - o.peKm; // the body's radius
      const a = o.aKm, e = o.ecc;
      const b = a * Math.sqrt(Math.max(1 - e * e, 0));
      const k = 150 / Math.max(a * (1 + e), Rkm * 1.1);
      // the body, the orbit (its focus at the body's centre), the craft where it is (the time to periapsis)
      g.fillStyle = "#0e6688";
      g.beginPath();
      g.arc(cx, cy, Rkm * k, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = LINE;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(cx - a * e * k, cy, a * k, b * k, 0, 0, 2 * Math.PI);
      g.stroke();
      const M = 2 * Math.PI * (1 - o.tPe / Math.max(o.period, 1e-9));
      let E = M;
      for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const px = cx + (a * (Math.cos(E) - e)) * k, py = cy - b * Math.sin(E) * k;
      g.fillStyle = AMBER;
      g.beginPath();
      g.arc(px, py, 9, 0, 2 * Math.PI);
      g.fill();
      g.font = `700 18px ${FONT}`;
      g.fillStyle = TEXT;
      g.fillText("Pe", cx + a * (1 - e) * k + 8, cy + 6);
      g.textAlign = "right";
      g.fillText("Ap", cx - a * (1 + e) * k - 8, cy + 6);
      g.textAlign = "left";
      this.rows(g, [
        ["APOAPSIS", fmtKm(o.apKm)], ["PERIAPSIS", fmtKm(o.peKm)], ["ECC · INC", `${o.ecc.toFixed(4)} · ${o.incDeg.toFixed(1)}°`],
        ["PERIOD", fmtDur(o.period)], ["T−PE · T−AP", `${fmtDur(o.tPe)} · ${fmtDur(o.tAp)}`],
      ], 445, TEXT, 46, 18, 23);
    } else if ((d.info as { region?: string }).region === "hole" && d.settings.cockpitAids && d.settings.hudRelativity && Number.isFinite((d.info as { r?: number }).r)) {
      // about Gargantua: what its spacetime does to the flight (the HUD's relativity box)
      const I = d.info as unknown as { r: number; speed: number; gamma: number; dtau: number; E: number; rH: number; isco: number; photon: number; ergo: boolean };
      const Mm = 1476.625 * d.settings.massSolar;
      const tide = (2 * C * C) / (I.r ** 3 * Mm * Mm) / G0;
      const dop = I.speed < 1 ? Math.sqrt((1 + I.speed) / (1 - I.speed)) : Infinity;
      const inside = I.r < I.rH * 1.0001 ? "INSIDE THE HORIZON" : I.r < I.photon ? "INSIDE THE PHOTON ORBIT" : I.r < I.isco ? "BELOW THE ISCO" : I.ergo ? "IN THE ERGOSPHERE" : "";
      g.font = `700 30px ${FONT}`;
      g.fillStyle = inside ? RED : AMBER;
      g.textAlign = "center";
      g.fillText(inside || (st?.label ?? "KERR ORBIT"), cx, 110);
      g.textAlign = "left";
      this.rows(g, [
        ["dτ/dt", I.dtau.toFixed(4), I.dtau < 0.5 ? RED : I.dtau < 0.9 ? AMBER : TEXT],
        ["SPEED · γ", `${I.speed.toFixed(3)} c · ${I.gamma.toFixed(3)}`],
        ["SKY AHEAD", `×${dop.toFixed(2)} blue`],
        ["ENERGY", Number.isFinite(I.E) ? (I.E < 1 ? `${I.E.toFixed(4)} · BOUND ${((1 - I.E) * 100).toFixed(1)} %` : `${I.E.toFixed(4)} · ESCAPING`) : "—", I.E < 1 ? GREEN : AMBER],
        ["r", `${I.r.toFixed(2)} M`, inside ? RED : TEXT],
        ["ISCO · γ ORB · H", `${I.isco.toFixed(2)} · ${I.photon.toFixed(2)} · ${I.rH.toFixed(2)}`],
        ["TIDE", `${tide < 1e-3 ? tide.toExponential(1) : tide.toFixed(3)} g/m`],
      ], 170, TEXT, 62, 18, 23);
    } else {
      g.font = `700 30px ${FONT}`;
      g.fillStyle = AMBER;
      g.textAlign = "center";
      g.fillText(st?.label ?? "NO ORBIT", cx, cy);
      g.textAlign = "left";
    }
  }

  // ---------------------------------------------------------------------------------- 2 NAV
  private nav(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const rw = d.runway;
    if (rw && d.settings.cockpitAids && d.settings.hudRunway && -rw.along < 40e3 && rw.along < 4500) return this.approachScreen(g, rw);
    const st = d.status;
    const tg = st?.target;
    this.frame(g, `NAV · ${tg ? tg.name.toUpperCase() : "NO TARGET"}`);
    const rows: [string, string, string?][] = [];
    if (tg) {
      rows.push(["DISTANCE", fmtKm(tg.distKm)]);
      rows.push(["RANGE RATE", `${tg.rate <= 0 ? "▼ " : "▲ "}${fmtSpeed(Math.abs(tg.rate))}`, tg.rate < 0 ? AMBER : TEXT]);
      rows.push(["CLOSEST", Number.isFinite(tg.caKm) ? fmtKm(Math.max(tg.caKm, 0)) : "—"]);
      rows.push(["IN", Number.isFinite(tg.caIn) && tg.caIn > 0 ? fmtDur(tg.caIn) : "—"]);
    }
    rows.push(["STATUS", st?.label ?? "—"]);
    if (st?.next) rows.push([st.next.kind === "impact" ? "⚠ IMPACT" : st.next.kind === "enter" ? "ENTERS" : st.next.kind === "exit" ? "LEAVES" : "MOUTH", `${st.next.name} · ${fmtDur(st.next.inS)}`, st.next.kind === "impact" ? RED : TEXT]);
    rows.push(["SOI", st ? `${st.soiName} · ${fmtKm(st.soiKm)}` : "—"]);
    // the entry: its phase, its site, the guidance's bank and miss, the deorbit's countdown
    const E = (d.info as { entry?: { phase: string; site: { name: string } | null; bank: number; miss: { along: number; across: number; dist: number } | null; tBurn: number | null; dv: number } | null }).entry;
    if (E) {
      rows.push(["ENTRY", `${E.phase.toUpperCase()}${E.site ? ` · ${E.site.name.split(",")[0]!.toUpperCase()}` : ""}`, AMBER]);
      if (E.tBurn !== null) rows.push(["DEORBIT", `${E.dv.toFixed(0)} m/s · ${fmtDur(E.tBurn)}`, AMBER]);
      else rows.push(["BANK", `${((E.bank * 180) / Math.PI).toFixed(0)}°${E.miss ? ` · MISS ${fmtKm(E.miss.dist / 1e3)}` : ""}`]);
    }
    this.rows(g, rows, 100, TEXT, E ? 58 : 70);
  }

  /**
   * The approach (NAV, a runway in reach): the runway from above, its centreline drawn back, the craft
   * where it is along and across it (its track); the localizer's deviation (across, as an angle from the
   * aim point) and the glide path's (flown against asked, on the final) on scales — an ILS's two needles;
   * the distance, the offset, the height over the ground.
   */
  private approachScreen(g: OffscreenCanvasRenderingContext2D, rw: RunwayView) {
    this.frame(g, `APPROACH · RWY ${String(Math.round(rw.rwy / 10) % 36 || 36).padStart(2, "0")}`);
    // the plan view: the threshold low, the runway up the screen, the craft below it (clipped under the
    // title)
    const cx = SLOT / 2, ty = 330, span = Math.max(-rw.along, 2000) * 1.15, k = 240 / span;
    const L = 4500;
    g.save();
    g.beginPath();
    g.rect(0, 56, SLOT, SH - 56);
    g.clip();
    g.strokeStyle = "rgba(98, 230, 255, 0.35)";
    g.setLineDash([10, 8]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, ty);
    g.lineTo(cx, ty + 240);
    g.stroke();
    g.setLineDash([]);
    // (the kilometres back, ticked)
    g.fillStyle = DIM;
    g.font = `600 15px ${FONT}`;
    g.textAlign = "left";
    for (let km = 2; km * 1000 < span; km += km < 10 ? 2 : 10) {
      const y = ty + km * 1000 * k;
      g.fillRect(cx - 10, y, 20, 2);
      g.fillText(`${km}`, cx + 14, y + 5);
    }
    g.fillStyle = "rgba(255, 220, 160, 0.35)";
    g.fillRect(cx - Math.max(45 * k, 6), ty - L * k, Math.max(90 * k, 12), L * k);
    g.strokeStyle = "#ffdca0";
    g.lineWidth = 3;
    g.strokeRect(cx - Math.max(45 * k, 6), ty - L * k, Math.max(90 * k, 12), L * k);
    // the aim point
    const ay = ty + 2000 * k;
    g.strokeStyle = GREEN;
    g.beginPath();
    g.moveTo(cx, ay - 8);
    g.lineTo(cx + 8, ay);
    g.lineTo(cx, ay + 8);
    g.lineTo(cx - 8, ay);
    g.closePath();
    g.stroke();
    // the craft: across exaggerated ×4 (an offset of a few hundred metres reads)
    const px = cx + Math.max(-200, Math.min(200, rw.across * k * 4)), py = Math.max(70, Math.min(ty + 250, ty - rw.along * k));
    g.fillStyle = AMBER;
    g.beginPath();
    g.moveTo(px, py - 14);
    g.lineTo(px - 9, py + 10);
    g.lineTo(px + 9, py + 10);
    g.closePath();
    g.fill();
    g.restore();
    // the localizer's needle (across as an angle from the aim point, ±5°) and the glide path's (±4°)
    const dist = Math.max(-rw.along - 2000, 300);
    const loc = Math.atan2(rw.across, dist) * (180 / Math.PI);
    const gs = rw.gRef !== null && rw.gam !== null ? ((rw.gam - rw.gRef) * 180) / Math.PI : null;
    const sx = 60, sy = 600, sw = 392;
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + sw, sy);
    g.stroke();
    for (let j = -2; j <= 2; j++) {
      g.beginPath();
      g.arc(sx + sw / 2 + (j * sw) / 4.4, sy, j === 0 ? 0.1 : 5, 0, 2 * Math.PI);
      g.stroke();
    }
    const lx = sx + sw / 2 - Math.max(-1, Math.min(1, loc / 5)) * (sw / 2.2);
    g.fillStyle = Math.abs(loc) < 0.5 ? GREEN : AMBER;
    g.fillRect(lx - 4, sy - 18, 8, 36);
    g.fillStyle = DIM;
    g.font = `600 16px ${FONT}`;
    g.textAlign = "center";
    g.fillText("LOC", sx + sw / 2, sy + 34);
    if (gs !== null) {
      const gx = 470, gy0 = 140, gh = 300;
      g.strokeStyle = LINE;
      g.beginPath();
      g.moveTo(gx, gy0);
      g.lineTo(gx, gy0 + gh);
      g.stroke();
      const gy = gy0 + gh / 2 + Math.max(-1, Math.min(1, gs / 4)) * (gh / 2.2);
      g.fillStyle = Math.abs(gs) < 0.5 ? GREEN : AMBER;
      g.fillRect(gx - 18, gy - 4, 36, 8);
      g.fillStyle = DIM;
      g.fillText("GS", gx, gy0 - 14);
    }
    this.rows(g, [
      ["THRESHOLD", rw.along < 0 ? fmtKm(-rw.along / 1000) : "PAST"],
      ["OFFSET", Math.abs(rw.across) < 15 ? "ON AXIS" : `${rw.across > 0 ? "R" : "L"} ${fmtKm(Math.abs(rw.across) / 1000)}`, Math.abs(rw.across) > 300 ? AMBER : GREEN],
      ["AGL", fmtKm(rw.agl / 1000)],
    ], 470, TEXT, 34, 18, 21);
    g.textAlign = "left";
  }

  // ---------------------------------------------------------------------------------- 3 SYSTEMS
  private systems(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const i = d.info;
    const v = VESSELS[i.vessel];
    this.frame(g, `SYSTEMS · ${v.name.toUpperCase()}`);
    const g0 = G0;
    const aU = (C * C) / M_METRES / (d.settings.massSolar || 1e8) * 1e8;
    const maxG = (i.engine.max * aU) / g0;
    const fuel = i.engine.fuel;
    this.bar(g, 30, 100, 60, 250, i.throttle, i.throttle > 0.02 ? AMBER : LINE, "THR");
    this.bar(g, 120, 100, 60, 250, fuel ? fuel.fraction : 1, fuel && fuel.fraction < 0.15 ? RED : GREEN, "PROP");
    this.bar(g, 210, 100, 60, 250, Math.min(1, Math.hypot(...(i.omega as number[])) / 0.5), LINE, "RATE");
    // the skin against its limits (the shield, the hull)
    const A = (i as { air?: { shield: number; hull: number; shieldMax: number; hullMax: number; mode: string } }).air;
    if (A) {
      const ms = A.shieldMax ? A.shield / A.shieldMax : 0, mh = A.hull / A.hullMax;
      if (A.shieldMax) this.bar(g, 300, 100, 60, 250, Math.min(ms, 1), ms > 0.85 ? RED : ms > 0.6 ? AMBER : GREEN, "SHLD");
      this.bar(g, 390, 100, 60, 250, Math.min(mh, 1), mh > 0.85 ? RED : mh > 0.6 ? AMBER : GREEN, "HULL");
    }
    const others = i.assembly.filter((q) => q !== i.vessel);
    this.rows(g, [
      ["ENGINE", `${maxG.toFixed(2)} g max`],
      ["ACCEL", `${((i.accel * aU) / g0).toFixed(3)} g`],
      ["MASS", `${Math.round(i.mass / 1e3)} t`],
      ["SAS", i.sas ? "ON" : "OFF", i.sas ? GREEN : AMBER],
      ["HOLD", i.hold === "none" ? "—" : i.hold.toUpperCase()],
      ["AUTO", i.auto === "none" ? "—" : i.auto.toUpperCase(), i.auto !== "none" ? AMBER : TEXT],
      ["FLIGHT", A ? `${A.mode.toUpperCase()} · ${Math.round(A.shield || A.hull)} K` : "—"],
    ], 400, TEXT, 40, 18, 23);
    g.font = `600 18px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText(others.length ? `+ ${others.map((q) => VESSELS[q].name).join(" + ")}` : "", 300, 90);
  }

  // ---------------------------------------------------------------------------------- 4 DOCKING
  private docking(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const dk = d.info.dock;
    const links = d.info.links ?? [];
    const sf = d.info.surface as SurfaceLike | null | undefined;
    // (low and slow over the ground — not the glide to a runway)
    if (!dk && !links.length && sf && !sf.landed && sf.alt < 3000 && sf.vHor < 150 && d.settings.cockpitAids && d.settings.hudHover) return this.landingScreen(g, d, sf);
    this.frame(g, dk ? `DOCKING · ${dk.title.toUpperCase()}` : links.length ? "DOCKED" : "DOCKING");
    if (!dk) {
      g.font = `700 26px ${FONT}`;
      g.fillStyle = links.length ? GREEN : DIM;
      g.textAlign = "center";
      if (links.length) links.forEach((l, k) => g.fillText(`${l.title} · ${l.port}`, SLOT / 2, 260 + k * 46));
      else g.fillText("NO PORT IN RANGE", SLOT / 2, 320);
      g.textAlign = "left";
      return;
    }
    // the cross-hair: the ring's offset across the port's axis (±1 m full scale), the capture's circle
    const cx = SLOT / 2, cy = 240, R = 140;
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, 0, 2 * Math.PI);
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    g.strokeStyle = GREEN;
    g.beginPath();
    g.arc(cx, cy, R * 0.3, 0, 2 * Math.PI);
    g.stroke();
    // (the offset where it is across the axis, its drift over 10 s — the guide's vectors, seen down the
    // port's axis; without them, the offset's size alone)
    const G = d.info.dockGuide as { lat: V3; latRate: V3; axis: V3 } | null | undefined;
    let ox = Math.min(1, dk.lateral) * 0.7, oy = Math.min(1, dk.lateral) * 0.7, rx = 0, ry = 0;
    if (G && d.settings.cockpitAids) {
      const ax = G.axis, l = Math.hypot(...ax) || 1;
      const a: V3 = [ax[0] / l, ax[1] / l, ax[2] / l];
      const pj = (v: V3): V3 => { const t = v[0] * a[0] + v[1] * a[1] + v[2] * a[2]; return [v[0] - a[0] * t, v[1] - a[1] * t, v[2] - a[2] * t]; };
      const ex = pj([1, 0, 0]), ey = pj([0, 1, 0]);
      const lx = Math.hypot(...ex) || 1, ly = Math.hypot(...ey) || 1;
      const on = (v: V3, e: V3, le: number) => (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / le;
      ox = Math.max(-1.1, Math.min(1.1, on(G.lat, ex, lx)));
      oy = Math.max(-1.1, Math.min(1.1, on(G.lat, ey, ly)));
      rx = on(G.latRate, ex, lx) * 10;
      ry = on(G.latRate, ey, ly) * 10;
    }
    const px = cx + ox * R, py = cy - oy * R;
    if (rx || ry) {
      g.strokeStyle = AMBER;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.max(-R, Math.min(R, rx * R)), py - Math.max(-R, Math.min(R, ry * R)));
      g.stroke();
    }
    g.fillStyle = dk.lateral < 0.3 ? GREEN : AMBER;
    g.beginPath();
    g.arc(px, py, 10, 0, 2 * Math.PI);
    g.fill();
    this.rows(g, [
      ["RANGE", dk.range < 1000 ? `${dk.range.toFixed(2)} m` : fmtKm(dk.range / 1000)],
      ["CLOSING", `${dk.closing.toFixed(3)} m/s`, dk.closing > Math.max(0.3, dk.range / 60) ? (dk.range < 20 ? RED : AMBER) : dk.closing > 0 ? GREEN : AMBER],
      ["OFFSET", `${dk.lateral.toFixed(2)} m`, dk.lateral < 0.3 ? GREEN : AMBER],
      ["AXES", `${dk.angle.toFixed(1)}°`, dk.angle < 10 ? GREEN : AMBER],
    ], 470, TEXT, 50, 18, 24);
  }

  /**
   * LANDING (the docking screen's place, low over the ground with no port in reach): the drift scope —
   * the velocity over the ground, heading up, its scale chosen for it —, the vertical speed's bar, the
   * height, and the stop burn: when full thrust must start to stop at the ground (the HUD's own cues).
   */
  private landingScreen(g: OffscreenCanvasRenderingContext2D, d: ScreenData, sf: SurfaceLike) {
    this.frame(g, `LANDING · AGL ${sf.alt >= 1000 ? `${(sf.alt / 1000).toFixed(2)} km` : `${Math.round(sf.alt)} m`}`);
    const cx = 220, cy = 250, R = 150;
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, 0, 2 * Math.PI);
    g.moveTo(cx + R / 2, cy);
    g.arc(cx, cy, R / 2, 0, 2 * Math.PI);
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.stroke();
    const full = [2, 5, 10, 20, 50, 100, 200].find((k) => k >= sf.vHor * 1.25) ?? 200;
    // (the drift on the ship's axes: forward up the scope, its left to the left)
    const S = d.info.S as unknown as number[][];
    const dr = d.info.dirs.drift as number[] | null | undefined;
    if (dr && sf.vHor > 0.05) {
      const v = [0, 1, 2].map((i) => S[0]![i]! * dr[0]! + S[1]![i]! * dr[1]! + S[2]![i]! * dr[2]!);
      const h = Math.hypot(v[0]!, v[2]!) || 1;
      const k = (Math.min(sf.vHor / full, 1.1) * R) / h;
      const tx = cx - v[0]! * k, ty = cy - v[2]! * k;
      g.strokeStyle = sf.vHor > 3 ? AMBER : GREEN;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(tx, ty);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.beginPath();
      g.arc(tx, ty, 9, 0, 2 * Math.PI);
      g.fill();
    }
    g.fillStyle = DIM;
    g.font = `600 17px ${FONT}`;
    g.textAlign = "right";
    g.fillText(`${full} m/s`, cx + R, cy - R + 4);
    // the vertical speed (±20 m/s)
    const bx = 430, bh = 300;
    g.strokeStyle = LINE;
    g.beginPath();
    g.moveTo(bx, cy - bh / 2);
    g.lineTo(bx, cy + bh / 2);
    g.moveTo(bx - 14, cy);
    g.lineTo(bx + 14, cy);
    g.stroke();
    const vDown = Math.max(-sf.vVert, 0);
    const vv = Math.max(-1, Math.min(1, sf.vVert / 20));
    g.fillStyle = vDown > Math.max(2, sf.alt / 10) ? RED : vDown > 2 ? AMBER : GREEN;
    g.fillRect(bx - 10, Math.min(cy, cy - vv * (bh / 2)), 20, Math.abs(vv) * (bh / 2));
    // the stop burn
    const gl = sf.gLocal * G0, net = (sf.twr - 1) * gl;
    let cue = "—", col = TEXT;
    if (vDown > 1) {
      if (net <= 0.05) (cue = "TWR < 1"), (col = RED);
      else {
        const stop = (vDown * vDown) / (2 * net), tIn = (sf.alt - stop * 1.1) / vDown;
        if (tIn <= 0) (cue = "BURN NOW"), (col = RED);
        else if (tIn < 60) (cue = `IN ${tIn.toFixed(tIn < 10 ? 1 : 0)} s`), (col = tIn < 5 ? AMBER : TEXT);
        else cue = `STOP ${Math.round(stop)} m`;
      }
    }
    g.textAlign = "left";
    this.rows(g, [
      ["DRIFT", `${sf.vHor.toFixed(sf.vHor < 10 ? 1 : 0)} m/s`, sf.vHor > 3 ? AMBER : GREEN],
      ["V/S", `${sf.vVert >= 0 ? "+" : "−"}${Math.abs(sf.vVert).toFixed(1)} m/s`, vDown > 2 ? AMBER : TEXT],
      ["STOP BURN", cue, col],
      ["TWR", sf.twr.toFixed(2)],
    ], 460, TEXT, 46, 18, 23);
  }

  // ---------------------------------------------------------------------------------- 5 PLAN
  private plan(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const p = d.info.plan;
    this.frame(g, "PLAN · MANOEUVRES");
    if (!p || !p.nodes.length) {
      g.font = `700 26px ${FONT}`;
      g.fillStyle = DIM;
      g.textAlign = "center";
      g.fillText("NO PLAN", SLOT / 2, 320);
      g.textAlign = "left";
      return;
    }
    // the next burn, large: its countdown, its Δv and length, the aim (the HUD's burn cue)
    let y0 = 100;
    const nx = p.nodes.findIndex((n) => n.t >= d.time - 1e-9);
    if (nx >= 0 && d.settings.cockpitAids && d.settings.hudBurn) {
      const n = p.nodes[nx]!;
      const dv = Math.hypot(...(n.dv as number[])) * C;
      const aU = (C * C) / M_METRES / (d.settings.massSolar || 1e8) * 1e8;
      const a = d.info.engine.max * aU;
      const S = d.info.S as unknown as number[][];
      const bd = (d.info.dirs.burn ?? d.info.dirs.maneuver) as number[] | null;
      const aim = bd ? (Math.acos(Math.max(-1, Math.min(1, S[0]![2]! * bd[0]! + S[1]![2]! * bd[1]! + S[2]![2]! * bd[2]!))) * 180) / Math.PI : NaN;
      g.fillStyle = PANEL;
      g.fillRect(12, 62, SLOT - 24, 150);
      g.font = `700 22px ${FONT}`;
      g.fillStyle = p.burning ? AMBER : TEXT;
      g.fillText(p.burning ? `BURNING ◆${nx + 1}` : `NEXT BURN ◆${nx + 1}`, 24, 88);
      g.font = `700 44px ${FONT}`;
      g.fillStyle = "#ffffff";
      g.fillText(p.burning ? "NOW" : `T−${fmtDur((n.t - d.time) * M_SECONDS)}`, 24, 138);
      g.font = `600 21px ${FONT}`;
      g.fillStyle = TEXT;
      g.fillText(`Δv ${dv >= 1000 ? `${(dv / 1000).toFixed(2)} km/s` : `${dv.toFixed(1)} m/s`} · ${a > 0 ? fmtDur(dv / a) : "no thrust"}`, 24, 176);
      if (Number.isFinite(aim)) {
        g.fillStyle = aim < 2 ? GREEN : aim < 10 ? AMBER : RED;
        g.textAlign = "right";
        g.fillText(`AIM ${aim.toFixed(1)}°`, SLOT - 24, 176);
        g.textAlign = "left";
      }
      y0 = 250;
    }
    const rows: [string, string, string?][] = p.nodes.slice(0, y0 > 100 ? 4 : 7).map((n, k) => {
      const dv = Math.hypot(...(n.dv as number[])) * C;
      const t = (n.t - d.time) * M_SECONDS;
      return [`${k + 1} ${(n.role ?? "node").toUpperCase()}`, `T−${fmtDur(t)} · ${dv >= 1000 ? `${(dv / 1000).toFixed(2)} km/s` : `${dv.toFixed(1)} m/s`}`, k === 0 && p.burning ? AMBER : TEXT];
    });
    this.rows(g, rows, y0, TEXT, 52, 18, 22);
    g.font = `600 18px ${FONT}`;
    g.fillStyle = DIM;
    const words = (p.note ?? "").split(" ");
    let line = "", y = 500;
    for (const w of words) {
      if ((line + " " + w).length > 40) {
        g.fillText(line, 18, y);
        y += 24;
        line = w;
        if (y > 660) break;
      } else line = line ? `${line} ${w}` : w;
    }
    if (y <= 660) g.fillText(line, 18, y);
  }

  // ---------------------------------------------------------------------------------- 6 CLOCKS
  private clocks(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    this.frame(g, "CLOCKS", true);
    const date = new Date(EPOCH_DATE + d.time * M_SECONDS * 1000);
    const warp = d.settings.timeSpeed * M_SECONDS;
    const big = (text: string, y: number, c = AMBER) => {
      g.font = `700 44px ${FONT}`;
      g.fillStyle = c;
      g.fillText(text, 22, y);
    };
    g.font = `600 20px ${FONT}`;
    g.fillStyle = "rgba(255, 220, 160, 0.6)";
    g.fillText("UTC", 22, 122);
    big(date.toISOString().slice(11, 19), 180);
    g.fillStyle = "rgba(255, 220, 160, 0.6)";
    g.font = `600 20px ${FONT}`;
    g.fillText(date.toISOString().slice(0, 10), 22, 226);
    g.fillText("SHIP τ", 22, 299);
    big(fmtDur(d.info.properTime * M_SECONDS), 356, "#fff4dc");
    g.fillStyle = "rgba(255, 220, 160, 0.6)";
    g.font = `600 20px ${FONT}`;
    g.fillText("WARP", 22, 423);
    big(warp >= 1000 ? `×${Math.round(warp).toLocaleString("en-US")}` : `×${warp.toFixed(warp < 10 ? 1 : 0)}`, 480);
    g.fillStyle = "rgba(255, 220, 160, 0.6)";
    g.font = `600 20px ${FONT}`;
    // (near Gargantua: the ship's clock rate instead of the local time)
    const dt = (d.info as { dtau?: number; region?: string }).dtau;
    if ((d.info as { region?: string }).region === "hole" && Number.isFinite(dt) && d.settings.cockpitAids && d.settings.hudRelativity) {
      g.fillText("dτ/dt · THE SHIP'S CLOCK RATE", 22, 547);
      big(dt!.toFixed(4), 604, dt! < 0.5 ? "#ff7a5c" : dt! < 0.9 ? AMBER : "#fff4dc");
    } else {
      g.fillText("LOCAL", 22, 547);
      const loc = new Date();
      big(`${String(loc.getHours()).padStart(2, "0")}:${String(loc.getMinutes()).padStart(2, "0")}:${String(loc.getSeconds()).padStart(2, "0")}`, 604, "#fff4dc");
    }
  }

  // ---------------------------------------------------------------------------------- 7 LOG
  private logScreen(g: OffscreenCanvasRenderingContext2D, _d: ScreenData) {
    this.frame(g, "LOG", true);
    g.font = `600 19px ${FONT}`;
    const lines: string[] = [];
    for (const m of this.log.slice(-12)) {
      // (wrapped at 42 characters)
      let rest = m.text;
      while (rest.length > 42) {
        const cut = rest.lastIndexOf(" ", 42);
        lines.push(rest.slice(0, cut > 10 ? cut : 42));
        rest = rest.slice(cut > 10 ? cut + 1 : 42);
      }
      lines.push(rest);
    }
    const shown = lines.slice(-19);
    shown.forEach((l, k) => {
      g.fillStyle = k === shown.length - 1 ? "#ffffff" : "rgba(235, 240, 245, 0.7)";
      g.fillText(l, 18, 86 + k * 31);
    });
    if (!shown.length) {
      g.fillStyle = "rgba(235, 240, 245, 0.5)";
      g.fillText("— no messages —", 18, 90);
    }
  }
}
