// The F-35's panoramic cockpit display (docs/PLAN-F35.md, F5): its one 50 × 20 cm touch screen, drawn on a canvas
// (ship.ts uploads it onto the dashboard's display, material 36). Four portals under a strip of warnings and
// above a strip of the flight's state; each portal a page the pilot chooses by touching its title (the next) or
// its arrows: the tactical situation (a moving map, heading up: the airfields, the route, the range rings), the
// flight controls (the surfaces as they stand), the engine, the fuel, the STOVL, the navigation, the standby
// attitude, the checklists. Pure drawing from a PcdData — no state of the flight read here.

import { PCD_H, PCD_W } from "./pcd-size";
import { type Units, type UnitSys, unitsOf } from "../ui/unitsys";

type V3 = [number, number, number];

export type PcdPage = "TSD" | "FCS" | "ENG" | "FUEL" | "STOVL" | "CNI" | "ADI" | "CKL";
export const PCD_PAGES: PcdPage[] = ["TSD", "FCS", "ENG", "FUEL", "STOVL", "CNI", "ADI", "CKL"];

/** An airfield on the map (lat, lon [°], its runway's heading [°], its name and ICAO code). */
export interface PcdField {
  name: string;
  icao?: string;
  lat: number;
  lon: number;
  rwy?: number;
}

/** What the display shows (SI, radians; null: not known). */
export interface PcdData {
  time: Date;
  /** the units shown (settings.units: metric unless imperial) */
  units?: UnitSys;
  /** where: latitude, longitude [°], altitude over the sea and the ground [m] */
  lat: number;
  lon: number;
  alt: number;
  agl: number;
  /** the attitude: heading, pitch, bank [rad]; the ground track [rad] */
  heading: number;
  pitch: number;
  bank: number;
  track: number;
  /** speeds: through the air (true), over the ground, vertical [m/s]; Mach; the load [g], its peak; the angle of attack [rad] */
  tas: number;
  gs: number;
  vs: number;
  mach: number;
  g: number;
  gPeak: number;
  alpha: number;
  /** the wind: its speed [m/s], where from [°] */
  wind: { speed: number; from: number } | null;
  /** the engine: the throttle and the spool (0…1), the afterburner lit (0…1), its thrust [N], the fuel flow [kg/s] */
  throttle: number;
  spool: number;
  ab: number;
  thrust: number;
  flow: number;
  /** the fuel [kg], full [kg]; the mass [kg] */
  fuel: number;
  fuelFull: number;
  mass: number;
  /** the surfaces (rad: stabilators, flaperons, leading-edge flaps, rudders — left, right) */
  surfaces: { stab: [number, number]; flaperon: [number, number]; lef: [number, number]; rudder: [number, number] } | null;
  /** the gear out (0…1), the flaps, the air brake (0…1), on its wheels */
  gear: number;
  flaps: number;
  brake: number;
  onGround: boolean;
  /** the STOVL mode (controller/stovl.ts) */
  stovl: { on: boolean; conv: number; swivel: number; hover: boolean; vz: number; heavy: boolean; clutch: number } | null;
  /** the vertical thrust it can give [N] (the hover's margin) */
  liftMax: number;
  /** the autopilot's modes: altitude, heading, speed held (null: off) */
  ap: { alt: number | null; hdg: number | null; spd: number | null };
  /** the airfields near, the alerts the HUD gives (their texts, their levels) */
  fields: PcdField[];
  /** the flight plan (game/flightplan.ts): its points, the active one, NAV engaged, to the active: distance [m],
   *  time [s], cross-track [m]; the bingo [kg] (null: none planned) */
  route: {
    wps: { name: string; lat: number; lon: number }[];
    active: number;
    l: boolean;
    v: boolean;
    dist: number;
    ete: number;
    xtk: number;
  } | null;
  bingo: number | null;
  alerts: { text: string; level: "warning" | "caution" | "advisory" }[];
  /** the radar's and the datalink's tracks (controller/radar.ts): east, north of the craft [m], their way [rad, from
   *  north] (null: unknown), their IFF, the lock, the datalink's alone */
  tracks?: {
    e: number;
    n: number;
    hdg: number | null;
    iff: string;
    air: boolean;
    locked: boolean;
    datalink: boolean;
    name: string;
    colour?: string;
  }[];
  /** a mission's places (controller/mission.ts missionMarks — P2): its zones to reach (amber), the SAMs' reach (red) */
  marks?: { kind: "zone" | "threat"; lat: number; lon: number; r: number; label: string; active: boolean }[];
}

const C = {
  bg: "#000000",
  frame: "#33454c",
  title: "#0b1a1e",
  white: "#e8f2f4",
  cyan: "#5fe7ff",
  green: "#4dff7a",
  magenta: "#ff5cf4",
  yellow: "#ffd23f",
  red: "#ff4a3a",
  grey: "#7d8b90",
  dim: "#24343a",
  amber: "#ffb03a",
  brown: "#5a3b1c",
  sky: "#1d5fa8",
};

const TOP = 58;
/** (the dashboard's face is notched at its bottom corners — the centre console's: the portals end at 83 % of the
 *  height, the flight's state below them in the notch's middle, from 29 % to 62 % across) */
const PORTAL_END = Math.round(PCD_H * 0.83);
const NOTCH = [Math.round(PCD_W * 0.295), Math.round(PCD_W * 0.615)] as const;
const GAP = 8;
/** (the portals kept off the display's outer edge: its bezel's lip hides it) */
const SIDE = 28;
const PORTALS = 4;
const PW = (PCD_W - 2 * SIDE - GAP * (PORTALS + 1)) / PORTALS;
const PH = PORTAL_END - TOP - GAP * 2;
const HEAD = 46;
const D = Math.PI / 180;

export class Pcd {
  readonly canvas = new OffscreenCanvas(PCD_W, PCD_H);
  private g = this.canvas.getContext("2d")!;
  /** each portal's page */
  pages: PcdPage[] = ["TSD", "FCS", "ENG", "FUEL"];
  /** the TSD's range [the distance's unit: km, or NM] */
  range = 20;
  /** the units shown (each draw's) */
  private u: Units = unitsOf("metric");
  private last = -Infinity;
  private dirty = true;

  /** A touch at (u, v) on the display (0…1 across, down): a portal's title — its next page —, its arrows,
   *  the TSD's range. What it did (null: nothing). */
  touch(u: number, v: number): string | null {
    const x = u * PCD_W,
      y = v * PCD_H;
    for (let k = 0; k < PORTALS; k++) {
      const x0 = SIDE + GAP + k * (PW + GAP),
        y0 = TOP + GAP;
      if (x < x0 || x > x0 + PW || y < y0 || y > y0 + PH) continue;
      const i = PCD_PAGES.indexOf(this.pages[k]!);
      if (y < y0 + HEAD) {
        // (the arrows at the title's ends: back, forth; the title itself: forth)
        const step = x < x0 + 60 ? -1 : 1;
        this.pages[k] = PCD_PAGES[(i + step + PCD_PAGES.length) % PCD_PAGES.length]!;
        this.dirty = true;
        return this.pages[k]!;
      }
      if (this.pages[k] === "TSD" && y > y0 + PH - 70) {
        // (the range: − on the left, + on the right)
        const r = [5, 10, 20, 40, 80, 160];
        const j = Math.max(0, r.indexOf(this.range));
        this.range = r[Math.min(Math.max(j + (x < x0 + PW / 2 ? -1 : 1), 0), r.length - 1)]!;
        this.dirty = true;
        return `RNG ${this.range}`;
      }
    }
    return null;
  }

  /** Draws when due (10 Hz, or at once after a touch). Whether it drew. */
  draw(d: PcdData, now: number): boolean {
    if (!this.dirty && now - this.last < 100) return false;
    this.last = now;
    this.u = unitsOf(d.units);
    this.dirty = false;
    const g = this.g;
    g.save();
    g.fillStyle = C.bg;
    g.fillRect(0, 0, PCD_W, PCD_H);
    this.topStrip(d);
    for (let k = 0; k < PORTALS; k++) this.portal(k, d);
    this.bottomStrip(d);
    g.restore();
    return true;
  }

  // ---- the frame

  private text(s: string, x: number, y: number, colour = C.white, size = 26, align: CanvasTextAlign = "left", bold = false) {
    const g = this.g;
    g.font = `${bold ? "700 " : "500 "}${size}px "Eurostile", "DIN Alternate", "Arial Narrow", sans-serif`;
    g.fillStyle = colour;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.fillText(s, x, y);
  }

  private topStrip(d: PcdData) {
    const g = this.g;
    g.fillStyle = "#061014";
    g.fillRect(0, 0, PCD_W, TOP);
    const hh = String(d.time.getUTCHours()).padStart(2, "0"),
      mm = String(d.time.getUTCMinutes()).padStart(2, "0"),
      ss = String(d.time.getUTCSeconds()).padStart(2, "0");
    this.text(`F-35B`, 48, TOP / 2, C.cyan, 28, "left", true);
    this.text(`${hh}:${mm}:${ss}Z`, 180, TOP / 2, C.white, 26);
    // (the warnings and cautions, the gravest first)
    const w = d.alerts.filter((a) => a.level !== "advisory").slice(0, 3);
    const x = 420;
    if (!w.length) this.text("ICAWS · NO FAULTS", x, TOP / 2, C.green, 24);
    w.forEach((a, i) => {
      const c = a.level === "warning" ? C.red : C.yellow;
      g.fillStyle = c;
      g.fillRect(x + i * 440, 10, 430, TOP - 20);
      this.text(a.text.slice(0, 32), x + i * 440 + 215, TOP / 2, "#000", 22, "center", true);
    });
    this.text(
      `FUEL ${Math.round(d.fuel).toLocaleString("en")} KG`,
      PCD_W - 48,
      TOP / 2,
      d.fuel < 0.2 * d.fuelFull ? C.yellow : C.green,
      28,
      "right",
      true,
    );
  }

  private bottomStrip(d: PcdData) {
    const g = this.g;
    const [x0, x1] = NOTCH;
    const y0 = PORTAL_END;
    g.fillStyle = "#061014";
    g.fillRect(x0, y0, x1 - x0, PCD_H - y0);
    const ap = d.ap;
    const on = (b: boolean, s: string) => [s, b ? C.green : C.dim] as const;
    // (the flight plan's guidance: LNAV, VNAV in magenta — the route's colour)
    const nl = !!d.route?.l && ap.hdg !== null,
      nv = !!d.route?.v && ap.alt !== null;
    const row1: (readonly [string, string])[] = [
      nv
        ? [`VNAV ${Math.round(this.u.alt(ap.alt!))}`, C.magenta]
        : on(ap.alt !== null, ap.alt !== null ? `ALT ${Math.round(this.u.alt(ap.alt))}` : "ALT"),
      nl
        ? ["LNAV", C.magenta]
        : on(ap.hdg !== null, ap.hdg !== null ? `HDG ${String(Math.round((((ap.hdg / D) % 360) + 360) % 360)).padStart(3, "0")}` : "HDG"),
      on(ap.spd !== null, ap.spd !== null ? `A/T ${Math.round(this.u.spd(ap.spd))}` : "A/T"),
      [d.stovl?.on ? (d.stovl.hover ? "HOVER" : "STOVL") : "CTOL", d.stovl?.on ? C.cyan : C.white],
    ];
    const row2: (readonly [string, string])[] = [
      [`THR ${Math.round(d.throttle * 100)}%${d.ab > 0.05 ? " AB" : ""}`, d.ab > 0.05 ? C.amber : C.white],
      [d.gear > 0.99 ? "GEAR DN" : d.gear < 0.01 ? "GEAR UP" : "GEAR ↕", d.gear > 0.99 ? C.green : d.gear < 0.01 ? C.white : C.yellow],
      [`FLAPS ${Math.round(d.flaps * 100)}`, d.flaps > 0 ? C.cyan : C.white],
      [d.brake > 0.05 ? "SPD BRK" : "BRK IN", d.brake > 0.05 ? C.yellow : C.dim],
    ];
    const w = (x1 - x0) / 4;
    const h = (PCD_H - y0) / 2;
    row1.forEach(([s, c], i) => this.text(s, x0 + w * (i + 0.5), y0 + h * 0.55, c, 24, "center", true));
    row2.forEach(([s, c], i) => this.text(s, x0 + w * (i + 0.5), y0 + h * 1.45, c, 24, "center", true));
  }

  private portal(k: number, d: PcdData) {
    const g = this.g;
    const x0 = SIDE + GAP + k * (PW + GAP),
      y0 = TOP + GAP;
    g.strokeStyle = C.frame;
    g.lineWidth = 3;
    g.strokeRect(x0, y0, PW, PH);
    g.fillStyle = C.title;
    g.fillRect(x0, y0, PW, HEAD);
    const page = this.pages[k]!;
    this.text("◀", x0 + 24, y0 + HEAD / 2, C.grey, 24, "center");
    this.text("▶", x0 + PW - 24, y0 + HEAD / 2, C.grey, 24, "center");
    this.text(page, x0 + PW / 2, y0 + HEAD / 2, C.cyan, 30, "center", true);
    g.save();
    g.beginPath();
    g.rect(x0 + 2, y0 + HEAD, PW - 4, PH - HEAD - 2);
    g.clip();
    const r = { x: x0, y: y0 + HEAD, w: PW, h: PH - HEAD };
    switch (page) {
      case "TSD":
        this.tsd(r, d);
        break;
      case "FCS":
        this.fcs(r, d);
        break;
      case "ENG":
        this.eng(r, d);
        break;
      case "FUEL":
        this.fuel(r, d);
        break;
      case "STOVL":
        this.stovlPage(r, d);
        break;
      case "CNI":
        this.cni(r, d);
        break;
      case "ADI":
        this.adi(r, d);
        break;
      case "CKL":
        this.ckl(r, d);
        break;
    }
    g.restore();
  }

  // ---- the pages

  /** The tactical situation: heading up, the ownship low in the portal, the airfields and their runways, the
   *  range rings, the track. */
  private tsd(r: Rect, d: PcdData) {
    const g = this.g;
    const cx = r.x + r.w / 2,
      cy = r.y + r.h * 0.68;
    const px = (r.h * 0.6) / (this.range * this.u.distM);
    // (a point's place: east and north of the ownship [m] → turned heading up)
    const R = 6.371e6;
    const where = (lat: number, lon: number): [number, number] => {
      const e = (lon - d.lon) * D * R * Math.cos(d.lat * D),
        n = (lat - d.lat) * D * R;
      const c = Math.cos(d.heading),
        s = Math.sin(d.heading);
      return [cx + (e * c - n * s) * px, cy - (e * s + n * c) * px];
    };
    // range rings and the compass
    g.strokeStyle = C.dim;
    g.lineWidth = 2;
    for (const f of [0.5, 1]) {
      g.beginPath();
      g.arc(cx, cy, r.h * 0.6 * f, 0, 2 * Math.PI);
      g.stroke();
    }
    for (let a = 0; a < 360; a += 10) {
      const t = a * D - d.heading;
      const rr = r.h * 0.6;
      const L = a % 30 === 0 ? 18 : 9;
      g.beginPath();
      g.moveTo(cx + Math.sin(t) * rr, cy - Math.cos(t) * rr);
      g.lineTo(cx + Math.sin(t) * (rr - L), cy - Math.cos(t) * (rr - L));
      g.strokeStyle = C.grey;
      g.stroke();
      if (a % 30 === 0)
        this.text(
          a === 0 ? "N" : a === 90 ? "E" : a === 180 ? "S" : a === 270 ? "W" : String(a / 10),
          cx + Math.sin(t) * (rr - 36),
          cy - Math.cos(t) * (rr - 36),
          C.grey,
          22,
          "center",
        );
    }
    // the airfields: their runway (4.5 km) and their names
    for (const f of d.fields) {
      const [x, y] = where(f.lat, f.lon);
      if (Math.abs(x - cx) > r.w || Math.abs(y - cy) > r.h * 1.4) continue;
      g.strokeStyle = C.cyan;
      g.lineWidth = 4;
      const h = (f.rwy ?? 0) * D - d.heading;
      const L = Math.max(4500 * px, 8);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(h) * L, y - Math.cos(h) * L);
      g.stroke();
      g.beginPath();
      g.arc(x, y, 7, 0, 2 * Math.PI);
      g.stroke();
      this.text(f.icao ?? f.name.slice(0, 6), x + 14, y + 18, C.cyan, 22);
    }
    // a mission's places: the zones to reach (amber, the waiting dashed), the SAMs' reach (red, dashed)
    for (const m of d.marks ?? []) {
      const [x, y] = where(m.lat, m.lon);
      const rr = Math.max(m.r * px, 6);
      if (Math.abs(x - cx) - rr > r.w || Math.abs(y - cy) - rr > r.h * 1.4) continue;
      const col = m.kind === "threat" ? C.red : C.amber;
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.setLineDash(m.kind === "threat" || !m.active ? [10, 8] : []);
      g.beginPath();
      g.arc(x, y, rr, 0, 2 * Math.PI);
      g.stroke();
      g.setLineDash([]);
      if (m.kind === "zone" || rr > 20) this.text(m.label.slice(0, 22), x + rr * 0.72 + 6, y - rr * 0.72, col, 20);
    }
    // the route: its legs (the active magenta), its points (diamonds, their names); the active's bearing,
    // distance and time
    const rt = d.route;
    if (rt && rt.wps.length) {
      const P = rt.wps.map((w) => where(w.lat, w.lon));
      g.lineWidth = 3;
      for (let i = 1; i < P.length; i++) {
        g.strokeStyle = i === rt.active ? C.magenta : i < rt.active ? C.grey : C.white;
        g.setLineDash(i < rt.active ? [8, 8] : []);
        g.beginPath();
        g.moveTo(P[i - 1]![0], P[i - 1]![1]);
        g.lineTo(P[i]![0], P[i]![1]);
        g.stroke();
      }
      g.setLineDash([]);
      P.forEach(([x, y], i) => {
        if (Math.abs(x - cx) > r.w || Math.abs(y - cy) > r.h * 1.4) return;
        const col = i === rt.active ? C.magenta : C.white;
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, y - 11);
        g.lineTo(x + 11, y);
        g.lineTo(x, y + 11);
        g.lineTo(x - 11, y);
        g.closePath();
        g.stroke();
        this.text(rt.wps[i]!.name, x + 16, y - 14, col, 22);
      });
      const w = rt.wps[rt.active];
      if (w) {
        const brg =
          (Math.atan2(
            Math.sin((w.lon - d.lon) * D) * Math.cos(w.lat * D),
            Math.cos(d.lat * D) * Math.sin(w.lat * D) - Math.sin(d.lat * D) * Math.cos(w.lat * D) * Math.cos((w.lon - d.lon) * D),
          ) /
            D +
            360) %
          360;
        const ete = Number.isFinite(rt.ete) ? `${Math.floor(rt.ete / 60)}:${String(Math.floor(rt.ete % 60)).padStart(2, "0")}` : "--:--";
        this.text(
          `${rt.l ? "LNAV" : "RTE"}${rt.v ? "/VNAV" : ""} ▸ ${w.name}  ${String(Math.round(brg)).padStart(3, "0")}°  ${this.u.dist(rt.dist).toFixed(1)} ${this.u.distName}  ${ete}`,
          r.x + 16,
          r.y + 58,
          C.magenta,
          24,
        );
        if (rt.l)
          this.text(
            `XTK ${this.u.dist(Math.abs(rt.xtk)).toFixed(1)}${rt.xtk > 0 ? "R" : "L"}`,
            r.x + r.w - 16,
            r.y + 88,
            C.magenta,
            22,
            "right",
          );
      }
    }
    // the tracks (the radar's, the datalink's): the NATO shapes — a friend's half circle (blue), a hostile's
    // diamond (red), a neutral's square (white), an unknown's quatrefoil (yellow) —, their way a stick, the lock ringed
    for (const T of d.tracks ?? []) {
      const c0 = Math.cos(d.heading),
        s0 = Math.sin(d.heading);
      const x = cx + (T.e * c0 - T.n * s0) * px,
        y = cy - (T.e * s0 + T.n * c0) * px;
      if (Math.abs(x - cx) > r.w / 2 || y < r.y || y > r.y + r.h) continue;
      const col = T.colour ?? (T.iff === "friend" ? C.cyan : T.iff === "hostile" ? "#ff5a46" : T.iff === "neutral" ? C.white : "#ffd23f");
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = 3;
      g.beginPath();
      const k = 13;
      if (T.iff === "friend") g.arc(x, y, k, Math.PI, 2 * Math.PI);
      else if (T.iff === "hostile") {
        g.moveTo(x, y - k);
        g.lineTo(x + k, y);
        g.lineTo(x, y + k);
        g.lineTo(x - k, y);
        g.closePath();
      } else if (T.iff === "neutral") g.rect(x - k * 0.8, y - k * 0.8, k * 1.6, k * 1.6);
      else
        for (const [ox, oy] of [
          [0, -0.5],
          [0.5, 0],
          [0, 0.5],
          [-0.5, 0],
        ])
          g.arc(x + ox! * k, y + oy! * k, k * 0.5, 0, 2 * Math.PI);
      if (T.datalink) g.setLineDash([5, 4]);
      g.stroke();
      g.setLineDash([]);
      if (T.hdg !== null) {
        const a = T.hdg - d.heading;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.sin(a) * 34, y - Math.cos(a) * 34);
        g.stroke();
      }
      if (T.locked) {
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, k + 9, 0, 2 * Math.PI);
        g.stroke();
      }
      this.text(T.name.slice(0, 10), x + 18, y - 14, col, 20);
    }
    // the ground track's line, the ownship
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.setLineDash([10, 10]);
    const tk = d.track - d.heading;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(tk) * r.h * 0.6, cy - Math.cos(tk) * r.h * 0.6);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = C.green;
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.lineTo(cx + 14, cy + 14);
    g.lineTo(cx, cy + 6);
    g.lineTo(cx - 14, cy + 14);
    g.closePath();
    g.fill();
    // the nearest field's bearing and distance
    const near = nearest(d);
    if (near) {
      this.text(
        `${near.f.icao ?? near.f.name.slice(0, 8)}  ${String(Math.round(near.brg)).padStart(3, "0")}°  ${this.u.dist(near.dist).toFixed(1)} ${this.u.distName}`,
        r.x + 16,
        r.y + 26,
        C.cyan,
        24,
      );
    }
    this.text(
      `HDG ${String(Math.round((((d.heading / D) % 360) + 360) % 360)).padStart(3, "0")}`,
      r.x + r.w - 16,
      r.y + 26,
      C.white,
      24,
      "right",
    );
    // the range's buttons
    const yb = r.y + r.h - 34;
    g.strokeStyle = C.frame;
    g.strokeRect(r.x + 16, yb - 22, 80, 44);
    g.strokeRect(r.x + r.w - 96, yb - 22, 80, 44);
    this.text("−", r.x + 56, yb, C.white, 32, "center", true);
    this.text("+", r.x + r.w - 56, yb, C.white, 32, "center", true);
    this.text(`${this.range} ${this.u.distName}`, cx, yb, C.white, 26, "center", true);
  }

  /** The flight controls: the craft from above, each surface's deflection drawn and written; the load, the
   *  incidence, the law. */
  private fcs(r: Rect, d: PcdData) {
    const g = this.g;
    const cx = r.x + r.w / 2,
      cy = r.y + r.h * 0.45;
    const k = r.w / 14;
    // (the planform, nose up: metres from the centre)
    const P: [number, number][] = [
      [0, 7.7],
      [0.75, 4],
      [1.6, 0.4],
      [5.35, -2.2],
      [5.35, -3.2],
      [2.3, -3.3],
      [2.6, -5.2],
      [3.4, -6.3],
      [3.4, -7.2],
      [1.0, -6.5],
      [0, -6.6],
    ];
    g.strokeStyle = C.grey;
    g.lineWidth = 3;
    g.beginPath();
    P.forEach(([x, y], i) => (i ? g.lineTo(cx + x * k, cy - y * k) : g.moveTo(cx + x * k, cy - y * k)));
    for (let i = P.length - 1; i >= 0; i--) g.lineTo(cx - P[i]![0] * k, cy - P[i]![1] * k);
    g.closePath();
    g.stroke();
    const s = d.surfaces;
    if (s) {
      // (a surface: its span's line, coloured by its travel used; its value in degrees)
      const bar = (x0: number, y0: number, x1: number, y1: number, a: number, max: number, label: string, lx: number, ly: number) => {
        const f = Math.min(Math.abs(a) / max, 1);
        g.strokeStyle = f > 0.85 ? C.yellow : C.green;
        g.lineWidth = 10;
        g.beginPath();
        g.moveTo(cx + x0 * k, cy - y0 * k);
        g.lineTo(cx + x1 * k, cy - y1 * k);
        g.stroke();
        this.text(`${label}${a >= 0 ? "+" : ""}${(a / D).toFixed(0)}`, cx + lx * k, cy - ly * k, C.white, 21, "center");
      };
      // (the pilot's left: the screen's left — the craft seen from above, its nose up)
      bar(-1.0, -4.0, -4.9, -3.0, s.flaperon[0], 25 * D, "FLP ", -3.4, -4.5);
      bar(1.0, -4.0, 4.9, -3.0, s.flaperon[1], 25 * D, "FLP ", 3.4, -4.5);
      bar(-1.7, 0.5, -5.0, -1.9, s.lef[0], 30 * D, "LEF ", -4.6, 0.4);
      bar(1.7, 0.5, 5.0, -1.9, s.lef[1], 30 * D, "LEF ", 4.6, 0.4);
      bar(-1.1, -6.6, -3.3, -6.9, s.stab[0], 20 * D, "STAB ", -2.6, -7.8);
      bar(1.1, -6.6, 3.3, -6.9, s.stab[1], 20 * D, "STAB ", 2.6, -7.8);
      bar(-1.5, -5.6, -1.9, -6.2, s.rudder[0], 25 * D, "RUD ", -1.6, -5.0);
      bar(1.5, -5.6, 1.9, -6.2, s.rudder[1], 25 * D, "RUD ", 1.6, -5.0);
    }
    const y = r.y + r.h - 120;
    this.text(`G ${d.g.toFixed(1)}`, r.x + 30, y, d.g > 6.5 ? C.yellow : C.white, 30, "left", true);
    this.text(`PEAK ${d.gPeak.toFixed(1)}`, r.x + 30, y + 44, C.grey, 24);
    this.text(`AOA ${(d.alpha / D).toFixed(1)}°`, r.x + r.w / 2, y, d.alpha > 24 * D ? C.yellow : C.white, 30, "center", true);
    this.text(d.stovl?.on ? "LAW STOVL" : "LAW CTOL · 7G", r.x + r.w - 30, y, C.cyan, 26, "right", true);
    this.text(`MACH ${d.mach.toFixed(2)}`, r.x + r.w / 2, y + 44, C.grey, 24, "center");
  }

  /** The engine: the core's speed (N2) and the exhaust's temperature as dials, the thrust, the flow. */
  private eng(r: Rect, d: PcdData) {
    const n2 = d.thrust > 0 || d.spool > 0 ? 63 + 37 * d.spool + 2 * d.ab : 0;
    const egt = 420 + 430 * d.spool + 180 * d.ab;
    this.dial(r.x + r.w * 0.28, r.y + 150, 105, n2 / 110, `${n2.toFixed(0)}`, "N2 %", n2 > 103 ? C.yellow : C.green);
    this.dial(r.x + r.w * 0.72, r.y + 150, 105, egt / 1100, `${egt.toFixed(0)}`, "EGT °C", egt > 1000 ? C.yellow : C.green);
    const y = r.y + 320;
    this.text(`THRUST ${(d.thrust / 1000).toFixed(0)} KN`, r.x + 30, y, C.white, 30, "left", true);
    this.text(`FF ${Math.round(d.flow * 3600).toLocaleString("en")} KG/H`, r.x + 30, y + 50, C.white, 28);
    this.text(`THROTTLE ${Math.round(d.throttle * 100)}%`, r.x + 30, y + 100, C.white, 28);
    this.text(
      d.ab > 0.05 ? `AFTERBURNER ${Math.round(d.ab * 100)}%` : "AB OFF",
      r.x + 30,
      y + 150,
      d.ab > 0.05 ? C.amber : C.grey,
      28,
      "left",
      true,
    );
    if (d.stovl && d.stovl.clutch > 0)
      this.text(`LIFT FAN ${Math.round(d.stovl.clutch * 100)}%`, r.x + 30, y + 200, C.cyan, 28, "left", true);
  }

  private dial(cx: number, cy: number, R: number, f: number, value: string, label: string, colour: string) {
    const g = this.g;
    const a0 = 0.75 * Math.PI,
      a1 = 2.25 * Math.PI;
    g.lineWidth = 8;
    g.strokeStyle = C.dim;
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.stroke();
    g.strokeStyle = colour;
    g.beginPath();
    g.arc(cx, cy, R, a0, a0 + (a1 - a0) * Math.min(Math.max(f, 0), 1));
    g.stroke();
    this.text(value, cx, cy, C.white, 40, "center", true);
    this.text(label, cx, cy + R * 0.62, C.grey, 22, "center");
  }

  /** The fuel: the total, its gauge and its marks (joker, bingo), the flow, the endurance at it. */
  private fuel(r: Rect, d: PcdData) {
    const g = this.g;
    const f = d.fuelFull > 0 ? d.fuel / d.fuelFull : 0;
    const x = r.x + 40,
      y = r.y + 60,
      w = 90,
      h = r.h - 180;
    g.strokeStyle = C.frame;
    g.lineWidth = 3;
    g.strokeRect(x, y, w, h);
    g.fillStyle = f < (d.bingo !== null && d.fuelFull > 0 ? d.bingo / d.fuelFull : 0.2) ? C.yellow : C.green;
    g.fillRect(x + 4, y + 4 + (h - 8) * (1 - f), w - 8, (h - 8) * f);
    // (the bingo: the flight plan's when there is one — the fuel home with its reserve —, the joker 1 500 kg above it)
    const bg = d.bingo !== null && d.fuelFull > 0 ? Math.min(d.bingo / d.fuelFull, 0.95) : 0.2;
    for (const [m, s] of [
      [Math.min(bg + (d.bingo !== null ? 1500 / Math.max(d.fuelFull, 1) : 0.15), 0.98), "JOKER"],
      [bg, "BINGO"],
    ] as const) {
      const yy = y + h * (1 - m);
      g.strokeStyle = C.magenta;
      g.beginPath();
      g.moveTo(x - 10, yy);
      g.lineTo(x + w + 10, yy);
      g.stroke();
      this.text(s, x + w + 20, yy, C.magenta, 20);
    }
    const tx = r.x + 230;
    this.text(`${Math.round(d.fuel).toLocaleString("en")}`, tx, r.y + 90, C.white, 52, "left", true);
    this.text("KG TOTAL", tx, r.y + 135, C.grey, 22);
    const min = d.flow > 1e-3 ? d.fuel / d.flow / 60 : Infinity;
    this.text(`FLOW ${(d.flow * 60).toFixed(0)} KG/MIN`, tx, r.y + 210, C.white, 26);
    this.text(
      `ENDUR ${Number.isFinite(min) ? `${Math.floor(min)}:${String(Math.floor((min % 1) * 60)).padStart(2, "0")}` : "--:--"}`,
      tx,
      r.y + 255,
      C.white,
      26,
    );
    const rng = Number.isFinite(min) ? this.u.dist(d.gs * min * 60) : 0;
    this.text(`RANGE ${rng.toFixed(0)} ${this.u.distName}`, tx, r.y + 300, C.white, 26);
    this.text(`GW ${(d.mass / 1000).toFixed(1)} T`, tx, r.y + 360, C.cyan, 26, "left", true);
  }

  /** The STOVL: the craft from the side, its lift fan's door, its nozzle's angle; the hover's margin. */
  private stovlPage(r: Rect, d: PcdData) {
    const g = this.g;
    const S = d.stovl;
    const cx = r.x + r.w / 2,
      cy = r.y + 200;
    const k = r.w / 17;
    // (the side view, nose left)
    g.strokeStyle = C.grey;
    g.lineWidth = 3;
    g.beginPath();
    const side: [number, number][] = [
      [-7.7, 0.7],
      [-4.5, 1.6],
      [-2.8, 2.1],
      [0, 1.9],
      [3.6, 1.8],
      [5.0, 3.2],
      [6.4, 3.2],
      [6.2, 1.4],
      [7.2, 1.0],
      [6.0, 0.4],
      [-3, 0.1],
      [-7.7, 0.7],
    ];
    side.forEach(([x, y], i) => (i ? g.lineTo(cx + x * k, cy - y * k) : g.moveTo(cx + x * k, cy - y * k)));
    g.stroke();
    const conv = S?.conv ?? 0;
    // the fan's door, raised with the conversion
    g.strokeStyle = conv > 0.98 ? C.green : conv > 0 ? C.yellow : C.grey;
    g.lineWidth = 6;
    const da = conv * 68 * D;
    g.beginPath();
    g.moveTo(cx - 1.9 * k, cy - 2.05 * k);
    g.lineTo(cx - 1.9 * k - Math.cos(da) * 1.4 * k, cy - 2.05 * k - Math.sin(da) * 1.4 * k);
    g.stroke();
    // the fan's thrust down, the nozzle's along its angle
    const sw = S?.swivel ?? 0;
    const na = sw * 95 * D;
    g.strokeStyle = C.cyan;
    g.beginPath();
    g.moveTo(cx + 6.6 * k, cy - 1.0 * k);
    g.lineTo(cx + 6.6 * k + Math.cos(na) * 1.6 * k, cy - 1.0 * k + Math.sin(na) * 1.6 * k);
    g.stroke();
    if ((S?.clutch ?? 0) > 0) {
      g.strokeStyle = C.cyan;
      g.beginPath();
      g.moveTo(cx - 2.6 * k, cy);
      g.lineTo(cx - 2.6 * k, cy + 1.6 * k * (S?.clutch ?? 0));
      g.stroke();
    }
    const y = r.y + 360;
    this.text(
      S?.on ? (conv < 1 ? `CONVERTING ${Math.round(conv * 100)}%` : "STOVL MODE") : "CTOL — ⇧B CONVERT",
      r.x + 30,
      y,
      S?.on ? C.cyan : C.grey,
      28,
      "left",
      true,
    );
    this.text(`NOZZLE ${Math.round(sw * 95)}°`, r.x + 30, y + 48, C.white, 26);
    this.text(`DOORS ${conv > 0.98 ? "OPEN" : conv > 0 ? "TRANSIT" : "CLOSED"}`, r.x + 30, y + 92, C.white, 26);
    const margin = d.liftMax > 0 ? d.liftMax / (d.mass * 9.80665) : 0;
    this.text(
      `HOVER MARGIN ${margin > 0 ? `${((margin - 1) * 100).toFixed(0)}%` : "--"}`,
      r.x + 30,
      y + 136,
      margin < 1.02 ? C.yellow : C.green,
      26,
      "left",
      true,
    );
    if (S?.hover) this.text(`HOVER · VZ ${S.vz.toFixed(1)} M/S`, r.x + 30, y + 180, C.green, 26, "left", true);
  }

  /** The navigation: where, how fast, the wind, the nearest field. */
  private cni(r: Rect, d: PcdData) {
    const lat = `${d.lat >= 0 ? "N" : "S"} ${Math.abs(d.lat).toFixed(4)}°`,
      lon = `${d.lon >= 0 ? "E" : "W"} ${Math.abs(d.lon).toFixed(4)}°`;
    const rows: [string, string][] = [
      ["POS", `${lat}  ${lon}`],
      ["ALT", `${Math.round(this.u.alt(d.alt)).toLocaleString("en")} ${this.u.altName}`],
      ["RALT", `${Math.round(this.u.alt(d.agl)).toLocaleString("en")} ${this.u.altName}`],
      ["GS", `${Math.round(this.u.spd(d.gs))} ${this.u.spdName}`],
      ["TAS", `${Math.round(this.u.spd(d.tas))} ${this.u.spdName}  M${d.mach.toFixed(2)}`],
      ["VS", `${Math.round(this.u.vs(d.vs))} ${this.u.vsName}`],
      ["TRK", `${String(Math.round((((d.track / D) % 360) + 360) % 360)).padStart(3, "0")}°`],
      [
        "WIND",
        d.wind ? `${String(Math.round(d.wind.from)).padStart(3, "0")}° / ${Math.round(this.u.spd(d.wind.speed))} ${this.u.spdName}` : "--",
      ],
    ];
    rows.forEach(([a, b], i) => {
      this.text(a, r.x + 26, r.y + 40 + i * 46, C.grey, 24);
      this.text(b, r.x + 130, r.y + 40 + i * 46, C.white, 26, "left", true);
    });
    const near = nearest(d);
    if (near) {
      const eta = d.gs > 5 ? near.dist / d.gs / 60 : Infinity;
      this.text(`→ ${near.f.icao ?? ""} ${near.f.name.slice(0, 22)}`, r.x + 26, r.y + 430, C.cyan, 24, "left", true);
      this.text(
        `${String(Math.round(near.brg)).padStart(3, "0")}°  ${this.u.dist(near.dist).toFixed(1)} ${this.u.distName}  ETA ${Number.isFinite(eta) ? `${eta.toFixed(0)} MIN` : "--"}`,
        r.x + 26,
        r.y + 474,
        C.white,
        24,
      );
    }
  }

  /** The standby attitude: the horizon, the pitch's lines, the bank. */
  private adi(r: Rect, d: PcdData) {
    const g = this.g;
    const cx = r.x + r.w / 2,
      cy = r.y + r.h / 2 - 20;
    const R = Math.min(r.w, r.h) * 0.4;
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, 2 * Math.PI);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-d.bank);
    const ppd = R / 30;
    const off = (d.pitch / D) * ppd;
    g.fillStyle = C.sky;
    g.fillRect(-2 * R, -3 * R + off, 4 * R, 3 * R);
    g.fillStyle = C.brown;
    g.fillRect(-2 * R, off, 4 * R, 3 * R);
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    for (let p = -30; p <= 30; p += 10) {
      if (!p) continue;
      const y = off - p * ppd;
      g.beginPath();
      g.moveTo(-R * 0.25, y);
      g.lineTo(R * 0.25, y);
      g.stroke();
      this.text(String(Math.abs(p)), R * 0.35, y, C.white, 18, "center");
    }
    g.restore();
    g.strokeStyle = C.yellow;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx - R * 0.5, cy);
    g.lineTo(cx - R * 0.15, cy);
    g.lineTo(cx - R * 0.08, cy + 14);
    g.moveTo(cx + R * 0.5, cy);
    g.lineTo(cx + R * 0.15, cy);
    g.lineTo(cx + R * 0.08, cy + 14);
    g.stroke();
    this.text(`${Math.round(this.u.spd(d.tas))} ${this.u.spdName}`, r.x + 30, r.y + r.h - 40, C.white, 28, "left", true);
    this.text(`${Math.round(this.u.alt(d.alt))} ${this.u.altName}`, r.x + r.w - 30, r.y + r.h - 40, C.white, 28, "right", true);
  }

  /** The checklists: each item checked from the flight's state. */
  private ckl(r: Rect, d: PcdData) {
    const lists: { title: string; items: [string, boolean][] }[] = d.onGround
      ? [
          {
            title: "BEFORE TAKEOFF",
            items: [
              ["CANOPY CLOSED", true],
              ["FLAPS ½ (P)", d.flaps >= 0.5],
              ["SPD BRK IN", d.brake < 0.05],
              ["FUEL > JOKER", d.fuel > 0.35 * d.fuelFull],
              ["THROTTLE MIL / AB (W, ⇧W)", d.throttle > 0.95],
            ],
          },
        ]
      : d.stovl?.on
        ? [
            {
              title: "VERTICAL LANDING",
              items: [
                ["CONVERSION COMPLETE", (d.stovl?.conv ?? 0) >= 1],
                ["GEAR DOWN (G)", d.gear > 0.99],
                ["HOVER MARGIN > 2%", d.liftMax > 1.02 * d.mass * 9.80665],
                ["BELOW 65 M/S: HOVER", !!d.stovl?.hover],
                ["DESCEND: ALT (HELD)", !!d.stovl?.hover && d.stovl.vz < 0],
              ],
            },
          ]
        : [
            {
              title: "APPROACH",
              items: [
                ["GEAR DOWN (G)", d.gear > 0.99],
                ["FLAPS FULL (P)", d.flaps >= 1],
                [`SPEED < ${Math.round(this.u.spd(82.3))} ${this.u.spdName}`, d.tas < 82.3],
                ["AOA 10–14°", d.alpha > 10 * D && d.alpha < 14 * D],
                ["FUEL > BINGO", d.fuel > 0.2 * d.fuelFull],
              ],
            },
          ];
    let y = r.y + 40;
    for (const L of lists) {
      this.text(L.title, r.x + 26, y, C.cyan, 28, "left", true);
      y += 54;
      for (const [s, ok] of L.items) {
        this.text(ok ? "■" : "□", r.x + 30, y, ok ? C.green : C.yellow, 26);
        this.text(s, r.x + 70, y, ok ? C.green : C.white, 25);
        y += 46;
      }
    }
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The nearest airfield: its distance [m] and bearing [°]. */
function nearest(d: PcdData): { f: PcdField; dist: number; brg: number } | null {
  let best: { f: PcdField; dist: number; brg: number } | null = null;
  for (const f of d.fields) {
    const p1 = d.lat * D,
      p2 = f.lat * D,
      dl = (f.lon - d.lon) * D;
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const dist = 2 * 6.371e6 * Math.asin(Math.min(1, Math.sqrt(a)));
    const brg =
      (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D + 360) % 360;
    if (!best || dist < best.dist) best = { f, dist, brg };
  }
  return best;
}

export type { V3 as PcdV3 };
