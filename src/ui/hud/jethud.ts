// The jet's HUD (plane mode, in the air — settings.hudJet): a fighter's head-up display over the conformal
// symbology, drawn in its green — the airspeed tape on the left, the altitude tape on the right (each value
// boxed, the autothrottle's speed and the autopilot's altitude bugged on them), Mach, the load and its peak,
// the incidence under the speed; the vertical speed and the radar altitude under the altitude; the
// autopilot's annunciators on top; the throttle and the afterburner bottom left. In a fighter's units (knots,
// feet, feet a minute) or the metric ones.

import type { JetModes } from "../../game/jet";
import { jetAnnunciators } from "../../game/jet";
import { blinkOn } from "../clock";

/** The jet's green (r, g, b) — what the ladder, the heading and the rest take in the jet's style. */
export const JET_GREEN = "110, 255, 150";
/** The helmet's symbology's colours (the F-35's setting, f35HmdColor). */
export const HMD_RGB = { green: JET_GREEN, amber: "255, 196, 92", cyan: "120, 225, 255", white: "236, 242, 248" } as const;
const AMBER = "#ffc85a";
const RED = "#ff5a46";

/** What the jet's HUD reads (SI: m/s, m, rad; the load in g). */
export interface JetHudInfo {
  /** the speed through the air, Mach, the load, its peak this flight, its limit; the incidence and its stall */
  speed: number;
  mach: number;
  g: number;
  gPeak: number;
  gMax: number;
  alpha: number;
  stall: number | null;
  /** the altitude over the sea, the height over the ground (the radar's), the vertical speed */
  alt: number;
  radar: number;
  vs: number;
  /** the throttle (0 … 1), the modes engaged */
  throttle: number;
  modes: JetModes;
  /** the F-35's helmet (its HMD: no head-up glass — the values boxed, no tapes): its fuel [kg] and full, its
   *  STOVL hover (the speed over the ground [m/s], the vertical speed held [m/s]) */
  hmd?: { fuel: number; full: number; hover: { gs: number; vz: number } | null; stovl: string | null };
  /** the symbology's colour ("r, g, b") and brightness (the F-35's settings) */
  rgb?: string;
  bright?: number;
  /** the flight plan's active waypoint: its name, its distance [m], NAV engaged */
  wp?: { name: string; dist: number; on: boolean } | null;
  /** the flight control law: the direct one said in amber (no computer: no limits) */
  law?: "normal" | "direct";
}

export type JetUnits = "aviation" | "metric";

/** The units shown: the speed (kt or m/s) and the altitude (ft or m) from SI, the vertical speed (ft/min or m/s). */
export function jetUnits(u: JetUnits) {
  return u === "aviation"
    ? {
        spd: (v: number) => v * 1.943844,
        alt: (m: number) => m / 0.3048,
        vs: (v: number) => (v / 0.3048) * 60,
        spdName: "KT",
        altName: "FT",
      }
    : { spd: (v: number) => v, alt: (m: number) => m, vs: (v: number) => v, spdName: "M/S", altName: "M" };
}

/** A tape's ticks about a value: every `step`, labelled every `label`, within ±half (the shown units). */
export function tapeTicks(value: number, half: number, step: number, label: number): { v: number; big: boolean }[] {
  const out: { v: number; big: boolean }[] = [];
  for (let v = Math.ceil((value - half) / step) * step; v <= value + half + 1e-9; v += step) {
    const k = Math.round(v / step) * step;
    out.push({ v: k, big: Math.abs(k / label - Math.round(k / label)) < 1e-9 });
  }
  return out;
}

type Text = (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void;
type Stroke = (draw: () => void, col: string, lw: number, dash?: number[]) => void;

export function drawJetHud(
  o: { ctx: CanvasRenderingContext2D; W: number; H: number; dpr: number; compact: boolean; top: number; units: JetUnits },
  J: JetHudInfo,
  stroke: Stroke,
  text: Text,
) {
  const { ctx, W, H, dpr, compact } = o;
  const U = jetUnits(o.units);
  // (the helmet's colour and brightness — the F-35's settings —, else the fighter HUD's green)
  const RGB = J.rgb ?? JET_GREEN;
  const BR = J.bright ?? 1;
  const G = (a: number) => `rgba(${RGB}, ${(a * BR).toFixed(3)})`;
  const cx = W / 2,
    cy = H / 2;
  // (the tapes' distance from the centre, their height — within the HUD's glass)
  const off = Math.min(W * 0.3, Math.max(190 * dpr, Math.min(W, H) * 0.36));
  const half = Math.min(H * 0.22, 150 * dpr);
  const box = (x: number, y: number, w: number, h: number, s: string, align: "left" | "right", col = "#ffffff") => {
    ctx.fillStyle = "rgba(2, 14, 6, 0.72)";
    ctx.strokeStyle = G(0.95);
    ctx.lineWidth = 1.4 * dpr;
    const x0 = align === "left" ? x : x - w;
    ctx.fillRect(x0, y - h / 2, w, h);
    ctx.strokeRect(x0, y - h / 2, w, h);
    text(s, x0 + w - 6 * dpr, y, col, 15, "right", true);
  };

  // ---- a tape: its ticks scrolling past the value boxed at its middle, its target bugged
  const tape = (side: -1 | 1, value: number, span: number, step: number, label: number, fmt: (v: number) => string, bug: number | null) => {
    const x = cx + side * off;
    const k = half / span;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 70 * dpr, cy - half - 4 * dpr, 140 * dpr, 2 * half + 8 * dpr);
    ctx.clip();
    stroke(
      () => {
        ctx.moveTo(x, cy - half);
        ctx.lineTo(x, cy + half);
      },
      G(0.6),
      1.2,
    );
    for (const t of tapeTicks(value, span, step, label)) {
      const y = cy - (t.v - value) * k;
      // (the ticks on the tape's outer side, the figures beyond them)
      stroke(
        () => {
          ctx.moveTo(x, y);
          ctx.lineTo(x + side * (t.big ? 12 : 6) * dpr, y);
        },
        G(t.big ? 0.95 : 0.6),
        1.3,
      );
      if (t.big && Math.abs(y - cy) > 14 * dpr) text(fmt(t.v), x + side * 16 * dpr, y, G(0.9), 12, side < 0 ? "right" : "left", true);
    }
    // (the target: a hollow chevron on the tape — at its end when off it)
    if (bug !== null && Number.isFinite(bug)) {
      const y = Math.max(cy - half, Math.min(cy + half, cy - (bug - value) * k));
      stroke(
        () => {
          ctx.moveTo(x, y);
          ctx.lineTo(x - side * 9 * dpr, y - 6 * dpr);
          ctx.lineTo(x - side * 9 * dpr, y + 6 * dpr);
          ctx.closePath();
        },
        "rgba(224, 123, 255, 0.95)",
        1.8,
      );
    }
    ctx.restore();
    // (the value boxed, its pointer towards the tape)
    const bw = 66 * dpr,
      bh = 24 * dpr;
    const bx = x + side * 14 * dpr;
    box(bx, cy, bw, bh, fmt(value), side < 0 ? "right" : "left");
    return { x, bx, bw };
  };

  const spd = U.spd(J.speed),
    alt = U.alt(J.alt);
  const aviation = o.units === "aviation";
  // ---- the F-35's helmet: the airspeed and the altitude boxed, their names and Mach, the load, the incidence
  // beneath; the fuel bottom right; in a hover the speed over the ground and the vertical speed held
  if (J.hmd && !compact) {
    const bw = 92 * dpr,
      bh = 30 * dpr;
    // (closer in than a HUD's tapes: the runway's card and the radar altitude's dial keep their places outside)
    const hoff = Math.min(W * 0.2, 270 * dpr);
    const lx = cx - hoff,
      rx = cx + hoff;
    box(lx + bw / 2, cy, bw, bh, `${Math.round(spd)}`, "right");
    text(aviation ? "KCAS" : "M/S", lx, cy - bh, G(0.8), 11, "center", true);
    box(rx - bw / 2, cy, bw, bh, `${Math.round(alt / (aviation ? 10 : 1)) * (aviation ? 10 : 1)}`, "left");
    text(U.altName, rx, cy - bh, G(0.8), 11, "center", true);
    const ly = cy + 46 * dpr;
    const gk = J.g / 7;
    text(`M ${J.mach.toFixed(2)}`, lx - bw / 2, ly, G(0.95), 14, "left", true);
    text(`G ${J.g.toFixed(1)}`, lx - bw / 2, ly + 20 * dpr, gk > 0.95 ? RED : gk > 0.8 ? AMBER : G(0.95), 14, "left", true);
    text(`α ${((J.alpha * 180) / Math.PI).toFixed(1)}`, lx - bw / 2, ly + 40 * dpr, J.alpha > 0.61 ? AMBER : G(0.95), 14, "left", true);
    // (the direct law: the computer off — no limits, no protection —, said always, under the figures)
    if (J.law === "direct") text("DIRECT LAW", lx - bw / 2, ly + 62 * dpr, AMBER, 13, "left", true);
    const vs = U.vs(J.vs);
    text(
      `${vs >= 0 ? "+" : "−"}${aviation ? Math.abs(Math.round(vs / 10) * 10) : Math.abs(vs).toFixed(1)}`,
      rx + bw / 2,
      ly,
      G(0.95),
      14,
      "right",
      true,
    );
    if (Number.isFinite(J.radar) && J.radar < 1500)
      text(
        `R ${Math.round(U.alt(J.radar) / (aviation ? 10 : 5)) * (aviation ? 10 : 5)}`,
        rx + bw / 2,
        ly + 20 * dpr,
        J.radar < 60 ? AMBER : G(0.95),
        14,
        "right",
        true,
      );
    const fk = J.hmd.full > 0 ? J.hmd.fuel / J.hmd.full : 1;
    text(`FUEL ${Math.round(J.hmd.fuel)}`, rx + bw / 2, cy + half + 70 * dpr, fk < 0.2 ? AMBER : G(0.95), 14, "right", true);
    if (J.hmd.stovl) text(J.hmd.stovl, cx, cy + half + 40 * dpr, G(1), 14, "center", true);
    if (J.hmd.hover) {
      const hv = J.hmd.hover;
      text(
        `GS ${Math.round(U.spd(hv.gs))}   VZ ${hv.vz >= 0 ? "+" : "−"}${Math.abs(hv.vz).toFixed(1)}`,
        cx,
        cy + half + 60 * dpr,
        G(1),
        15,
        "center",
        true,
      );
    }
  } else if (!compact) {
    // ---- the airspeed (left): 10 kt ticks, 50 labelled; metric 5 / 25 m/s
    const L = tape(
      -1,
      spd,
      aviation ? 60 : 30,
      aviation ? 10 : 5,
      aviation ? 50 : 25,
      (v) => `${Math.round(v)}`,
      J.modes.spd !== null ? U.spd(J.modes.spd) : null,
    );
    text(U.spdName, L.bx - L.bw / 2, cy - half - 14 * dpr, G(0.8), 11, "center", true);
    // ---- the altitude (right): 100 ft ticks, 500 labelled; metric 20 / 100 m
    const R = tape(
      1,
      alt,
      aviation ? 600 : 200,
      aviation ? 100 : 20,
      aviation ? 500 : 100,
      (v) => `${Math.round(v)}`,
      J.modes.alt !== null ? U.alt(J.modes.alt) : null,
    );
    text(U.altName, R.bx + R.bw / 2, cy - half - 14 * dpr, G(0.8), 11, "center", true);

    // ---- under the speed: Mach, the load, its peak, the incidence
    const lx = L.bx - L.bw,
      ly = cy + half + 22 * dpr;
    const gk = J.g / (J.gMax || 9);
    text(`M ${J.mach.toFixed(2)}`, lx, ly, G(0.95), 13, "left", true);
    text(`G ${J.g.toFixed(1)}`, lx, ly + 18 * dpr, gk > 0.9 ? RED : gk > 0.7 ? AMBER : G(0.95), 13, "left", true);
    text(`${J.gPeak.toFixed(1)}`, lx + 64 * dpr, ly + 18 * dpr, G(0.6), 11, "left", true);
    const ak = J.stall ? J.alpha / J.stall : 0;
    text(`α ${((J.alpha * 180) / Math.PI).toFixed(1)}`, lx, ly + 36 * dpr, ak > 1 ? RED : ak > 0.85 ? AMBER : G(0.95), 13, "left", true);

    // ---- under the altitude: the vertical speed, the radar altitude (boxed low)
    const rx = R.bx + R.bw,
      ry = cy + half + 22 * dpr;
    const vs = U.vs(J.vs);
    const vsTxt = aviation
      ? `${vs >= 0 ? "+" : "−"}${Math.abs(Math.round(vs / 10) * 10)}`
      : `${vs >= 0 ? "+" : "−"}${Math.abs(vs).toFixed(1)}`;
    text(vsTxt, rx, ry, G(0.95), 13, "right", true);
    const radar = U.alt(J.radar);
    if (Number.isFinite(J.radar) && J.radar < 1500) {
      const r = `R ${Math.round(radar / (aviation ? 10 : 5)) * (aviation ? 10 : 5)}`;
      ctx.strokeStyle = G(0.9);
      ctx.lineWidth = 1.2 * dpr;
      ctx.strokeRect(rx - 72 * dpr, ry + 18 * dpr - 10 * dpr, 72 * dpr, 20 * dpr);
      text(r, rx - 6 * dpr, ry + 18 * dpr, J.radar < 60 ? AMBER : G(0.95), 13, "right", true);
    }
  }

  // ---- the annunciators: the modes engaged, under the heading tape
  const ann = jetAnnunciators(J.modes, {
    alt: (m) => `${Math.round(U.alt(m) / (aviation ? 10 : 1)) * (aviation ? 10 : 1)}`,
    spd: (v) => `${Math.round(U.spd(v))}`,
  }).filter((a) => a !== "AB");
  if (ann.length) text(ann.join("   "), cx, o.top + (compact ? 30 : 100) * dpr, G(1), 13, "center", true);

  // (the flight plan's active waypoint, magenta: its name, its distance)
  if (J.wp) {
    const d = aviation ? `${(J.wp.dist / 1852).toFixed(1)} NM` : `${(J.wp.dist / 1000).toFixed(1)} KM`;
    text(`▸ ${J.wp.name}  ${d}`, cx, o.top + (compact ? 48 : 118) * dpr, J.wp.on ? "#ff4fd8" : G(0.7), 12, "center", true);
  }

  // ---- the throttle, the afterburner (bottom left)
  const tx = compact ? 16 * dpr : cx - off - 66 * dpr,
    ty = compact ? H - 120 * dpr : cy + half + 90 * dpr;
  const bw = 90 * dpr,
    bh = 7 * dpr;
  ctx.strokeStyle = G(0.8);
  ctx.lineWidth = 1.2 * dpr;
  ctx.strokeRect(tx, ty, bw, bh);
  ctx.fillStyle = J.modes.ab ? AMBER : G(0.85);
  ctx.fillRect(tx, ty, bw * Math.min(Math.max(J.throttle, 0), 1), bh);
  text(`THR ${Math.round(J.throttle * 100)}`, tx, ty - 10 * dpr, G(0.9), 12, "left", true);
  if (J.modes.ab && blinkOn()) text("AB", tx + bw + 8 * dpr, ty + bh / 2, AMBER, 14, "left", true);
}
