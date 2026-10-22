// The A320's navigation displays (docs/PLAN-A320.md, A7): drawn on the canvas as FlightGear's ND draws them
// (Models/Instruments/ND/canvas — airbusND.svg's layout: ARC's centre at (512, 824), its outer arc 700 px; ROSE's at
// (512, 522), 434 px; PLAN north up about the active waypoint), in the mode, range and layer the EFIS sets (the deck's
// properties: instrumentation/efis[n]/nd/display-mode, inputs/range-nm, nd/layer): the compass and its heading
// pointer, the track's diamond, the range arcs, the flight plan (its active leg, its points, their constraints), the
// airfields and their runways, the TCAS's traffic, GS / TAS, the wind, the active waypoint's name, bearing, distance
// and time; ROSE ILS's localizer and glideslope. The figures Airbus's: NM, knots, degrees (true: the game has no
// magnetic variation — "TRU" shown).

import type { DuData } from "./data";
import { COL, type Ctx, Display, fontOf } from "./display";
import type { NdExtra } from "./nd-data";

type Mode = "ILS" | "VOR" | "NAV" | "ARC" | "PLAN";
const D = Math.PI / 180;
const FONT = fontOf("");

/** a mode's geometry: the aircraft's place (the map's centre), the outer circle's radius [px], and what it spans [NM] */
interface Frame {
  cx: number;
  cy: number;
  R: number;
  /** NM a pixel */
  k: number;
  /** the map's up [°true]: the heading (ARC, ROSE), north (PLAN) */
  up: number;
  /** PLAN: its centre's place */
  lat0: number;
  lon0: number;
  plan: boolean;
}

export class Nd extends Display {
  override hz = 10;

  constructor(side: 0 | 1 = 0) {
    super(side, null);
  }

  private efis(d: DuData, k: string) {
    return d.deck[`instrumentation/efis${this.side ? "[1]" : ""}/${k}`];
  }

  draw(ctx: Ctx, d: DuData, _t: number) {
    const mode = String(this.efis(d, "nd/display-mode") ?? "ARC") as Mode;
    const range = Number(this.efis(d, "inputs/range-nm") ?? 40);
    const layer = String(this.efis(d, "nd/layer") ?? "");
    const X = d.nd;
    const hdg = d.heading;
    const arc = mode === "ARC";
    const plan = mode === "PLAN";
    // (PLAN: north up about the active waypoint — the aircraft's place when there is none)
    const ref = plan && X && X.active >= 0 ? X.route[X.active]! : { lat: d.lat, lon: d.lon };
    const F: Frame = arc
      ? { cx: 512, cy: 824, R: 700, k: 700 / range, up: hdg, lat0: d.lat, lon0: d.lon, plan: false }
      : { cx: 512, cy: 522, R: 434, k: 434 / (range / 2), up: plan ? 0 : hdg, lat0: ref.lat, lon0: ref.lon, plan };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // ---- the map (clipped to the compass: ARC its arc and the lines to the aircraft, ROSE / PLAN its circle)
    ctx.save();
    ctx.beginPath();
    if (arc) {
      ctx.moveTo(0, 704);
      ctx.lineTo(F.cx, F.cy + 120);
      ctx.lineTo(1024, 704);
      ctx.lineTo(1024, 340);
      ctx.arc(F.cx, F.cy, F.R, -Math.PI / 2 + 0.95, -Math.PI / 2 - 0.95, true);
      ctx.lineTo(0, 340);
    } else ctx.arc(F.cx, F.cy, F.R + 4, 0, Math.PI * 2);
    ctx.clip();
    if (X) {
      if (layer === "arpt" || range <= 40) this.fields(ctx, F, X, d, layer === "arpt", range);
      this.route(ctx, F, X, d, layer === "cstr", layer === "wpt");
      if (!plan) this.traffic(ctx, F, X);
    }
    ctx.restore();
    // ---- the compass, the range rings
    if (plan) this.planRose(ctx, F, range);
    else this.compass(ctx, F, d, arc, range);
    // ---- the aircraft
    if (plan) {
      if (X) {
        const [x, y] = this.xy(F, d.lat, d.lon);
        if (Math.hypot(x - F.cx, y - F.cy) < F.R) this.plane(ctx, x, y, hdg * D, 0.6);
      }
    } else this.plane(ctx, F.cx, F.cy, 0, 1);
    // ---- ROSE ILS: the localizer's course and deviation, the glideslope's scale
    if (mode === "ILS") this.ils(ctx, F, d);
    // ---- the corners
    this.corners(ctx, d, X, mode, range);
    if (!X) {
      text(ctx, "MAP NOT AVAIL", 512, 470, 38, COL.red, "center");
    }
  }

  /** a place [°] on the screen: east and north of the centre [NM] turned so that `up` points up */
  private xy(F: Frame, lat: number, lon: number): [number, number] {
    const n = (lat - F.lat0) * 60;
    const e = (lon - F.lon0) * 60 * Math.cos(F.lat0 * D);
    return this.en(F, e, n);
  }
  private en(F: Frame, e: number, n: number): [number, number] {
    const a = -F.up * D;
    const x = e * Math.cos(a) + n * Math.sin(a);
    const y = -e * Math.sin(a) + n * Math.cos(a);
    return [F.cx + x * F.k, F.cy - y * F.k];
  }

  // ------------------------------------------------------------------------------------------------ the compass

  private compass(ctx: Ctx, F: Frame, d: DuData, arc: boolean, range: number) {
    const { cx, cy, R } = F;
    ctx.strokeStyle = COL.white;
    ctx.fillStyle = COL.white;
    ctx.lineWidth = 3;
    // (the rose: ARC its upper part, ROSE whole — ticks inside every 5°, longer every 10°, figures every 10°)
    const span = arc ? 54 : 180;
    ctx.beginPath();
    if (arc) ctx.arc(cx, cy, R, -Math.PI / 2 - span * D, -Math.PI / 2 + span * D);
    else ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    const first = Math.ceil((d.heading - span) / 5) * 5;
    for (let b = first; b <= d.heading + span; b += 5) {
      const rel = (b - d.heading) * D;
      const long = b % 10 === 0;
      const r1 = R,
        r2 = R - (long ? 26 : 14);
      const s = Math.sin(rel),
        c = Math.cos(rel);
      ctx.beginPath();
      ctx.moveTo(cx + s * r1, cy - c * r1);
      ctx.lineTo(cx + s * r2, cy - c * r2);
      ctx.stroke();
      if (long) {
        const v = (((b % 360) + 360) % 360) / 10;
        const big = v % 3 === 0;
        ctx.save();
        ctx.translate(cx + s * (R - (big ? 52 : 46)), cy - c * (R - (big ? 52 : 46)));
        ctx.rotate(rel);
        text(ctx, String(v), 0, 0, big ? 34 : 26, COL.white, "center", "middle");
        ctx.restore();
      }
    }
    // (the range: ARC's arcs at a quarter, a half, three quarters — the half's figure cyan; ROSE's inner ring at half)
    ctx.strokeStyle = COL.white;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    if (arc) {
      for (const f of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * f, -Math.PI / 2 - span * D, -Math.PI / 2 + span * D);
        ctx.stroke();
      }
      const lab = rangeLabel(range / 2);
      text(ctx, lab, cx - R * 0.5 * Math.sin(54 * D) - 30, cy - R * 0.5 * Math.cos(54 * D) + 34, 26, COL.cyan, "center");
      text(ctx, lab, cx + R * 0.5 * Math.sin(54 * D) + 30, cy - R * 0.5 * Math.cos(54 * D) + 34, 26, COL.cyan, "center");
    } else {
      ctx.setLineDash([10, 14]);
      ctx.beginPath();
      ctx.arc(cx, cy, R / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, rangeLabel(range / 4), cx - (R / 2) * 0.72 - 22, cy + (R / 2) * 0.72 + 22, 26, COL.cyan, "center");
      // (ROSE: the 45° marks outside the rose)
      for (const a of [45, 135, 225, 315]) {
        const s = Math.sin(a * D),
          c = Math.cos(a * D);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + s * (R + 8), cy - c * (R + 8));
        ctx.lineTo(cx + s * (R + 26), cy - c * (R + 26));
        ctx.stroke();
      }
    }
    // (the heading: the yellow line at the top, fixed; the track: the green diamond on the rose)
    ctx.strokeStyle = COL.yellow;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R - 30);
    ctx.lineTo(cx, cy - R + 26);
    ctx.stroke();
    const tr = (d.track - d.heading) * D;
    if (Math.abs(tr) < span * D) {
      ctx.save();
      ctx.translate(cx + Math.sin(tr) * (R - 12), cy - Math.cos(tr) * (R - 12));
      ctx.rotate(tr);
      ctx.strokeStyle = COL.green;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(9, 0);
      ctx.lineTo(0, 14);
      ctx.lineTo(-9, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** PLAN: north up, its rings (the outer the range's half — its figure —, the inner a quarter), N E S W */
  private planRose(ctx: Ctx, F: Frame, range: number) {
    const { cx, cy, R } = F;
    ctx.strokeStyle = COL.white;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    ctx.beginPath();
    ctx.arc(cx, cy, R / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [l, a] of [
      ["N", 0],
      ["E", 90],
      ["S", 180],
      ["W", 270],
    ] as const) {
      const s = Math.sin(a * D),
        c = Math.cos(a * D);
      ctx.beginPath();
      ctx.moveTo(cx + s * (R - 20), cy - c * (R - 20));
      ctx.lineTo(cx + s * (R + 20), cy - c * (R + 20));
      ctx.stroke();
      text(ctx, l, cx + s * (R - 46), cy - c * (R - 46), 32, COL.white, "center", "middle");
    }
    text(ctx, rangeLabel(range / 2), cx + R * 0.72 + 30, cy + R * 0.72 + 24, 26, COL.cyan, "center");
    text(ctx, rangeLabel(range / 4), cx + (R / 2) * 0.72 + 26, cy + (R / 2) * 0.72 + 22, 26, COL.cyan, "center");
  }

  /** the aircraft: the yellow symbol (its nose up, or turned on PLAN's map) */
  private plane(ctx: Ctx, x: number, y: number, rot: number, k: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(k, k);
    ctx.strokeStyle = COL.yellow;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(0, 44);
    ctx.moveTo(-35, 0);
    ctx.lineTo(35, 0);
    ctx.moveTo(-15, 32);
    ctx.lineTo(15, 32);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------ the map

  /** the airfields: a magenta star and its code (EFIS ARPT), their runways at short range (white) */
  private fields(ctx: Ctx, F: Frame, X: NdExtra, d: DuData, all: boolean, range: number) {
    const near = X.fields.filter((f) => all || X.route.some((w) => w.field && w.name === f.icao));
    for (const f of near) {
      if (!f.major && range > 40) continue;
      const [x, y] = this.xy(F, f.lat, f.lon);
      if (x < -40 || x > 1064 || y < -40 || y > 1064) continue;
      // (its runways, drawn to scale once they are a few pixels long)
      if (range <= 40)
        for (const r of f.rwys) {
          const [x1, y1] = this.xy(F, r[0], r[1]);
          const [x2, y2] = this.xy(F, r[2], r[3]);
          if (Math.hypot(x2 - x1, y2 - y1) < 6) continue;
          ctx.strokeStyle = COL.white;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      if (all) {
        star(ctx, x, y, 14, COL.magenta);
        text(ctx, f.icao, x + 20, y + 24, 24, COL.magenta, "left");
      }
    }
    void d;
  }

  /** the flight plan: its legs green (dashed when LNAV is off), the active leg's "to" white, the others green
   *  diamonds; the airfields' points stars; the constraints (EFIS CSTR) magenta; the waypoints' names */
  private route(ctx: Ctx, F: Frame, X: NdExtra, d: DuData, cstr: boolean, _wpt: boolean) {
    const W = X.route;
    if (W.length < 1) return;
    const P = W.map((w) => this.xy(F, w.lat, w.lon));
    const from = Math.max(X.active - 1, 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = COL.green;
    ctx.setLineDash(X.nav ? [] : [22, 16]);
    // (the active leg: from the aircraft when flown direct to its "to", else from the previous point)
    ctx.beginPath();
    if (X.active >= 0) {
      const [ax, ay] = X.active === 0 ? this.xy(F, d.lat, d.lon) : P[from]!;
      ctx.moveTo(ax, ay);
      for (let i = Math.max(X.active, 0); i < P.length; i++) ctx.lineTo(P[i]![0], P[i]![1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    W.forEach((w, i) => {
      if (i < from) return;
      const [x, y] = P[i]!;
      if (x < -60 || x > 1084 || y < -60 || y > 1084) return;
      const act = i === X.active;
      const c = act ? COL.white : COL.green;
      if (w.field) star(ctx, x, y, 16, c);
      else {
        ctx.strokeStyle = c;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y - 14);
        ctx.lineTo(x + 14, y);
        ctx.lineTo(x, y + 14);
        ctx.lineTo(x - 14, y);
        ctx.closePath();
        ctx.stroke();
      }
      text(ctx, w.name, x + 22, y - 12, 28, c, "left");
      if (cstr && w.alt !== undefined) {
        ctx.strokeStyle = COL.magenta;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.stroke();
        text(
          ctx,
          w.alt >= 10000 ? `FL${Math.round(w.alt / 100)}` : String(Math.round(w.alt / 10) * 10),
          x + 22,
          y + 26,
          24,
          COL.magenta,
          "left",
        );
      }
    });
  }

  /** the TCAS's traffic: a white diamond (hollow: other; filled: proximate), the TA an amber circle, the RA a red
   *  square; its height over us in hundreds of feet, its vertical arrow */
  private traffic(ctx: Ctx, F: Frame, X: NdExtra) {
    for (const T of X.traffic) {
      const [x, y] = this.en(F, T.e, T.n);
      if (Math.hypot(x - F.cx, y - F.cy) > F.R) continue;
      const c = T.level === "RA" ? COL.red : T.level === "TA" ? COL.amber : COL.white;
      ctx.fillStyle = ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (T.level === "RA") ctx.rect(x - 12, y - 12, 24, 24);
      else if (T.level === "TA") ctx.arc(x, y, 12, 0, Math.PI * 2);
      else {
        ctx.moveTo(x, y - 14);
        ctx.lineTo(x + 11, y);
        ctx.lineTo(x, y + 14);
        ctx.lineTo(x - 11, y);
        ctx.closePath();
      }
      if (T.level === "other") ctx.stroke();
      else ctx.fill();
      const h = Math.round(T.dz / 100);
      const lab = `${h >= 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}`;
      text(ctx, lab, x, T.dz >= 0 ? y - 22 : y + 42, 24, c, "center");
      if (T.vs) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 22, y + 10 * T.vs);
        ctx.lineTo(x + 22, y - 10 * T.vs);
        ctx.lineTo(x + 17, y - 4 * T.vs);
        ctx.moveTo(x + 22, y - 10 * T.vs);
        ctx.lineTo(x + 27, y - 4 * T.vs);
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ ROSE ILS

  private ils(ctx: Ctx, F: Frame, d: DuData) {
    const I = d.ils;
    const { cx, cy, R } = F;
    // (the course: the runway's from its name — "ILS 27 LFPB" — the game's true headings; none: the heading)
    const m = I ? /ILS (\d\d)/.exec(I.id) : null;
    const crs = m ? Number(m[1]) * 10 : Math.round(d.heading);
    const rel = (crs - d.heading) * D;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rel);
    ctx.strokeStyle = COL.magenta;
    ctx.lineWidth = 6;
    // (the course pointer's head and tail)
    ctx.beginPath();
    ctx.moveTo(0, -R + 30);
    ctx.lineTo(0, -R / 2 + 30);
    ctx.moveTo(-18, -R + 70);
    ctx.lineTo(18, -R + 70);
    ctx.moveTo(0, R / 2 - 30);
    ctx.lineTo(0, R - 30);
    ctx.stroke();
    // (the deviation scale: two dots each side, 1 dot 74 px; the bar where the localizer is)
    ctx.fillStyle = COL.white;
    ctx.strokeStyle = COL.white;
    ctx.lineWidth = 3;
    for (const k of [-2, -1, 1, 2]) {
      ctx.beginPath();
      ctx.arc(k * 74, 0, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (I?.loc !== null && I?.loc !== undefined) {
      const x = Math.max(Math.min(I.loc, 2.4), -2.4) * 74;
      ctx.strokeStyle = COL.magenta;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x, -R / 2 + 40);
      ctx.lineTo(x, R / 2 - 40);
      ctx.stroke();
    }
    ctx.restore();
    // (the glideslope: its scale on the right, its magenta diamond)
    const gx = 980;
    ctx.strokeStyle = COL.white;
    ctx.lineWidth = 3;
    for (const k of [-2, -1, 1, 2]) {
      ctx.beginPath();
      ctx.arc(gx, cy + k * 74, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = COL.yellow;
    ctx.beginPath();
    ctx.moveTo(gx - 22, cy);
    ctx.lineTo(gx + 22, cy);
    ctx.stroke();
    if (I?.gs !== null && I?.gs !== undefined) {
      const y = cy - Math.max(Math.min(I.gs, 2.4), -2.4) * 74;
      ctx.strokeStyle = COL.magenta;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(gx, y - 18);
      ctx.lineTo(gx + 14, y);
      ctx.lineTo(gx, y + 18);
      ctx.lineTo(gx - 14, y);
      ctx.closePath();
      ctx.stroke();
    }
    // (the ILS's name, course and DME, at the top right)
    text(ctx, I ? I.id.replace(/^ILS \d\d\s*/, "ILS ") : "ILS1", 1010, 40, 28, COL.magenta, "right");
    text(ctx, `CRS ${String(((crs % 360) + 360) % 360).padStart(3, "0")}°`, 1010, 76, 28, COL.magenta, "right");
    if (I) text(ctx, `DME ${I.dme.toFixed(1)}`, 1010, 112, 28, COL.magenta, "right");
  }

  // ------------------------------------------------------------------------------------------------ the corners

  private corners(ctx: Ctx, d: DuData, X: NdExtra | null, mode: Mode, range: number) {
    // (top left: GS, TAS; under them the wind's direction / speed and its arrow, turned as it blows on the map)
    text(ctx, "GS", 18, 38, 26, COL.white, "left");
    text(ctx, String(Math.round(d.gs)), 66, 38, 34, COL.green, "left");
    text(ctx, "TAS", 150, 38, 26, COL.white, "left");
    text(ctx, d.tas > 60 ? String(Math.round(d.tas)) : "---", 210, 38, 34, COL.green, "left");
    if (d.wind && d.tas > 60) {
      const dir = String(Math.round(((d.wind.dir % 360) + 360) % 360 || 360)).padStart(3, "0");
      text(ctx, `${dir}/${Math.round(d.wind.kt)}`, 18, 78, 32, COL.green, "left");
      if (d.wind.kt > 2) {
        // (the arrow: where the wind blows to, the map's up the heading — PLAN's north)
        const a = (d.wind.dir + 180 - (mode === "PLAN" ? 0 : d.heading)) * D;
        ctx.save();
        ctx.translate(48, 128);
        ctx.rotate(a);
        ctx.strokeStyle = COL.green;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 24);
        ctx.lineTo(0, -24);
        ctx.moveTo(-9, -12);
        ctx.lineTo(0, -24);
        ctx.lineTo(9, -12);
        ctx.stroke();
        ctx.restore();
      }
    } else text(ctx, "---/---", 18, 78, 32, COL.green, "left");
    // (top right: the active waypoint, its bearing, its distance, the time there — ROSE ILS has its ILS there)
    if (X && X.active >= 0 && mode !== "ILS") {
      const w = X.route[X.active]!;
      text(ctx, w.name, 900, 40, 30, COL.white, "right");
      text(ctx, `${String(Math.round(X.brg) % 360).padStart(3, "0")}°`, 1012, 40, 30, COL.green, "right");
      text(ctx, X.dist >= 100 ? X.dist.toFixed(0) : X.dist.toFixed(1), 950, 78, 32, COL.green, "right");
      text(ctx, "NM", 1012, 78, 26, COL.cyan, "right");
      if (Number.isFinite(X.ete)) {
        const at = new Date(d.time.getTime() + X.ete * 1000);
        text(
          ctx,
          `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`,
          1012,
          116,
          32,
          COL.green,
          "right",
        );
      }
    }
    // (the heading's reference: true — the game has no variation; the mode's name in ROSE VOR / ILS)
    if (mode !== "PLAN") text(ctx, "TRU", mode === "ARC" ? 600 : 610, mode === "ARC" ? 110 : 76, 26, COL.cyan, "left");
    if (mode === "VOR") text(ctx, "VOR1", 1010, 40, 28, COL.white, "right");
    // (bottom: the range's figure in PLAN; VOR1 / VOR2 not tuned)
    if (mode === "PLAN") text(ctx, `${range}`, 512, 1000, 26, COL.cyan, "center");
    text(ctx, "VOR1", 30, 960, 26, COL.white, "left");
    text(ctx, "---", 30, 996, 28, COL.green, "left");
    text(ctx, "VOR2", 994, 960, 26, COL.white, "right");
    text(ctx, "---", 994, 996, 28, COL.green, "right");
  }
}

/** a range's figure as the ND writes it (5, 10, 20, 2.5…) */
const rangeLabel = (r: number) => (r < 10 && r % 1 ? r.toFixed(1) : String(Math.round(r)));

function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  align: CanvasTextAlign = "left",
  base: CanvasTextBaseline = "alphabetic",
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillStyle = colour;
  ctx.fillText(s, x, y);
}

/** an airfield's star (four points) */
function star(ctx: Ctx, x: number, y: number, r: number, colour: string) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const k = i % 2 ? r * 0.35 : r;
    const px = x + Math.sin(a) * k,
      py = y - Math.cos(a) * k;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}
