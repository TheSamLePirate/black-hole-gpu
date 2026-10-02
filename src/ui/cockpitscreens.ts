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
import type { RangerStatus } from "../game/status";
import type { Settings } from "../settings";
import { VESSELS } from "../vessels";
import { EPOCH_DATE, M_SECONDS } from "../system/solar";

const W = 2048, H = 1024, SLOT = 512;
/** the screens are portrait (≈ 3:4): each slot drawn in 512 × 683 units, squeezed into its square — the
 *  screen stretches it back */
const SH = 683;
const C = 299792458;
const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
// the film's palette: cyan screens, their lines and text; the black ones' white and amber
const BG = "#04212c", PANEL = "#08394a", LINE = "#62e6ff", TEXT = "#c6f7ff", DIM = "#3c9fb6", AMBER = "#ffb347", RED = "#ff5a46", GREEN = "#7dff9a";

type V3 = [number, number, number];

export interface ScreenData {
  info: Info;
  status: RangerStatus | null;
  settings: Settings;
  /** the scene time [M] */
  time: number;
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
      } catch {
        /* (a frame between two states: the slot left as it was drawn) */
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
    const roll = up ? Math.atan2(-up[0], up[1]) : 0;
    const pitch = up ? Math.asin(Math.max(-1, Math.min(1, up[2]))) : 0;
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
    if (pro && pro[2] > 0) {
      const mx = cx + (Math.atan2(-pro[0], pro[2]) * 180) / Math.PI * pxDeg, my = cy - (Math.asin(Math.max(-1, Math.min(1, pro[1]))) * 180) / Math.PI * pxDeg;
      if (Math.hypot(mx - cx, my - cy) < R - 10) {
        g.strokeStyle = GREEN;
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
      }
    }
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
    g.fillStyle = st && st.vVert < 0 ? AMBER : TEXT;
    g.fillText(st ? `V/S ${st.vVert >= 0 ? "+" : "−"}${fmtSpeed(Math.abs(st.vVert))}` : "", cx, 570);
    g.textAlign = "left";
    g.fillStyle = DIM;
    g.fillText("SPD", 14, 610);
    g.textAlign = "right";
    g.fillText("ALT", SLOT - 14, 610);
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
    this.rows(g, rows, 100, TEXT, 70);
  }

  // ---------------------------------------------------------------------------------- 3 SYSTEMS
  private systems(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const i = d.info;
    const v = VESSELS[i.vessel];
    this.frame(g, `SYSTEMS · ${v.name.toUpperCase()}`);
    const g0 = 9.80665;
    const aU = (C * C) / 1.476625e11 / (d.settings.massSolar || 1e8) * 1e8;
    const maxG = (i.engine.max * aU) / g0;
    const fuel = i.engine.fuel;
    this.bar(g, 30, 100, 60, 250, i.throttle, i.throttle > 0.02 ? AMBER : LINE, "THR");
    this.bar(g, 120, 100, 60, 250, fuel ? fuel.fraction : 1, fuel && fuel.fraction < 0.15 ? RED : GREEN, "PROP");
    this.bar(g, 210, 100, 60, 250, Math.min(1, Math.hypot(...(i.omega as number[])) / 0.5), LINE, "RATE");
    const others = i.assembly.filter((q) => q !== i.vessel);
    this.rows(g, [
      ["ENGINE", `${maxG.toFixed(2)} g max`],
      ["ACCEL", `${((i.accel * aU) / g0).toFixed(3)} g`],
      ["MASS", `${Math.round(i.mass / 1e3)} t`],
      ["SAS", i.sas ? "ON" : "OFF", i.sas ? GREEN : AMBER],
      ["HOLD", i.hold === "none" ? "—" : i.hold.toUpperCase()],
      ["AUTO", i.auto === "none" ? "—" : i.auto.toUpperCase(), i.auto !== "none" ? AMBER : TEXT],
    ], 420, TEXT, 44, 18, 23);
    g.font = `600 18px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText(others.length ? `+ ${others.map((q) => VESSELS[q].name).join(" + ")}` : "", 300, 120);
  }

  // ---------------------------------------------------------------------------------- 4 DOCKING
  private docking(g: OffscreenCanvasRenderingContext2D, d: ScreenData) {
    const dk = d.info.dock;
    const links = d.info.links ?? [];
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
    const off = Math.min(1, dk.lateral) * R;
    g.fillStyle = dk.lateral < 0.3 ? GREEN : AMBER;
    g.beginPath();
    g.arc(cx + off * 0.7, cy - off * 0.7, 10, 0, 2 * Math.PI);
    g.fill();
    this.rows(g, [
      ["RANGE", dk.range < 1000 ? `${dk.range.toFixed(2)} m` : fmtKm(dk.range / 1000)],
      ["CLOSING", `${dk.closing.toFixed(3)} m/s`, dk.closing > 0 && dk.closing < 0.5 ? GREEN : AMBER],
      ["OFFSET", `${dk.lateral.toFixed(2)} m`, dk.lateral < 0.3 ? GREEN : AMBER],
      ["AXES", `${dk.angle.toFixed(1)}°`, dk.angle < 10 ? GREEN : AMBER],
    ], 470, TEXT, 50, 18, 24);
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
    const rows: [string, string, string?][] = p.nodes.slice(0, 7).map((n, k) => {
      const dv = Math.hypot(...(n.dv as number[])) * C;
      const t = (n.t - d.time) * M_SECONDS;
      return [`${k + 1} ${(n.role ?? "node").toUpperCase()}`, `T−${fmtDur(t)} · ${dv >= 1000 ? `${(dv / 1000).toFixed(2)} km/s` : `${dv.toFixed(1)} m/s`}`, k === 0 && p.burning ? AMBER : TEXT];
    });
    this.rows(g, rows, 100, TEXT, 52, 18, 22);
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
    g.fillText("LOCAL", 22, 547);
    const loc = new Date();
    big(`${String(loc.getHours()).padStart(2, "0")}:${String(loc.getMinutes()).padStart(2, "0")}:${String(loc.getSeconds()).padStart(2, "0")}`, 604, "#fff4dc");
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
