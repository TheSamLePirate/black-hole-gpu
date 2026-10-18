// The F-35's panoramic cockpit display (docs/PLAN-F35.md, F5): its one 50 × 20 cm touch screen, drawn on a canvas
// (ship.ts uploads it onto the dashboard's display, material 36). Four portals under a strip of warnings and
// above a strip of the flight's state; each portal a page the pilot chooses by touching its title (the next) or
// its arrows: the tactical situation (a moving map, heading up: the airfields, the route, the range rings), the
// flight controls (the surfaces as they stand), the engine, the fuel, the STOVL, the navigation, the standby
// attitude, the checklists. Pure drawing from a PcdData — no state of the flight read here.

import { PCD_H, PCD_W } from "./pcd-size";
import { type Units, type UnitSys, unitsOf } from "../ui/unitsys";

type V3 = [number, number, number];

export type PcdPage = "TSD" | "FCS" | "ENG" | "FUEL" | "STOVL" | "CNI" | "ADI" | "CKL" | "ICAWS";
export const PCD_PAGES: PcdPage[] = ["TSD", "FCS", "ENG", "FUEL", "STOVL", "CNI", "ADI", "CKL", "ICAWS"];

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
  /** the Sun's height over the horizon there [°] (the display's automatic brightness) */
  sunAlt?: number;
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
  /** in a fight, the damage taken (0…1) */
  damage?: number;
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
/** the portals' slots: four across, two each side of the centre — a side shown as its two portals or as one twice as
 *  wide (its first slot's page), as a real PCD's halves */
const SLOTS = 4;
const PW = (PCD_W - 2 * SIDE - GAP * (SLOTS + 1)) / SLOTS;
const PH = PORTAL_END - TOP - GAP * 2;
/** a portal's title bar, its keys' bar at its foot (its page's keys) */
const HEAD = 46;
const FOOT = 50;
const D = Math.PI / 180;

/** A part of the display [px]. */
export interface PcdRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A portal shown: its slot, its frame, its part of the display (its gaps with it: what is redrawn), its key. */
interface Portal {
  slot: number;
  full: boolean;
  frame: PcdRect;
  region: PcdRect;
  key: string;
}
/** A page's key at its portal's foot: its label, lit, what it does (what to say; null: nothing). */
interface PcdKey {
  label: string;
  on?: boolean;
  act?: () => string | null;
}
/** the pages drawn over a whole wide portal (maps); the others keep a portal's width, centred */
const WIDE: ReadonlySet<PcdPage> = new Set(["TSD"]);
const TOP_STRIP: PcdRect = { x: 0, y: 0, w: PCD_W, h: TOP };
const BOTTOM_STRIP: PcdRect = { x: NOTCH[0], y: PORTAL_END, w: NOTCH[1] - NOTCH[0], h: PCD_H - PORTAL_END };
/** the data read every PERIOD [ms]; each part redrawn at its own pace (what moves fast often, the rest less) — in
 *  turn, one a frame: no frame pays for the whole display */
const PERIOD = 100;
/** the display's brightness at night (its NIGHT knob, the automatic one in the dark) */
const PCD_NIGHT = 0.4;
const PAGE_PERIOD: Record<PcdPage, number> = {
  TSD: 100,
  FCS: 100,
  ENG: 200,
  FUEL: 500,
  STOVL: 100,
  CNI: 250,
  ADI: 100,
  CKL: 500,
  ICAWS: 250,
};
const FONT = `"Eurostile", "DIN Alternate", "Arial Narrow", sans-serif`;
const RANGES = [5, 10, 20, 40, 80, 160];

export class Pcd {
  readonly canvas = new OffscreenCanvas(PCD_W, PCD_H);
  private g = this.canvas.getContext("2d")!;
  /** each slot's page */
  pages: PcdPage[] = ["TSD", "FCS", "ENG", "FUEL"];
  /** each side (left, right) shown as two portals or as one */
  halves: ("split" | "full")[] = ["split", "split"];
  /** the slot whose page menu is open (null: none) */
  menu: number | null = null;
  /** the TSD's range [the distance's unit: km, or NM]; its names and labels hidden */
  range = 20;
  declutter = false;
  /** the units shown (each draw's) */
  private u: Units = unitsOf("metric");
  /** the data drawn (read again every PERIOD, or at once after a touch), when */
  private data: PcdData | null = null;
  private dataAt = -Infinity;
  /** when each part was drawn (by its key); the parts to draw at once (a touch) */
  private drawn = new Map<string, number>();
  private forced = new Set<string>();
  /** the last touch on the display (u, v; when [ms]) and the last page changed (its part [px]; when [ms]) — the
   *  shader's ring and sweep (ship.wgsl pcdLight) */
  lastTouch: { u: number; v: number; at: number } | null = null;
  lastChange: { rect: PcdRect; at: number } | null = null;
  /** the touch's and the page change's age held [s] (a capture, a test: the ring and the sweep caught mid-way) */
  ageHeld: number | null = null;

  /** The portals shown: each side's two, or its one twice as wide. */
  portals(): Portal[] {
    const out: Portal[] = [];
    const y = TOP + GAP;
    for (let h = 0; h < 2; h++) {
      const k0 = 2 * h;
      if (this.halves[h] === "full")
        out.push({
          slot: k0,
          full: true,
          frame: { x: SIDE + GAP + k0 * (PW + GAP), y, w: 2 * PW + GAP, h: PH },
          region: { x: SIDE + GAP / 2 + k0 * (PW + GAP), y: TOP, w: 2 * (PW + GAP), h: PORTAL_END - TOP },
          key: `p${k0}F`,
        });
      else
        for (const k of [k0, k0 + 1])
          out.push({
            slot: k,
            full: false,
            frame: { x: SIDE + GAP + k * (PW + GAP), y, w: PW, h: PH },
            region: { x: SIDE + GAP / 2 + k * (PW + GAP), y: TOP, w: PW + GAP, h: PORTAL_END - TOP },
            key: `p${k}`,
          });
    }
    return out;
  }

  /** The display's parts, each redrawn on its own: the warnings' strip, the portals, the flight's state. */
  private regions(): { key: string; rect: PcdRect; portal?: Portal }[] {
    return [
      { key: "top", rect: TOP_STRIP },
      ...this.portals().map((P) => ({ key: P.key, rect: P.region, portal: P })),
      { key: "bottom", rect: BOTTOM_STRIP },
    ];
  }

  /** A touch at (u, v) on the display (0…1 across, down) — in a portal: its title's arrows (the page before, the
   *  next), its title (the pages' menu, then a page chosen in it), its corner (the side shown as one portal, or two),
   *  its page's keys at its foot. What it did (null: nothing). */
  touch(u: number, v: number): string | null {
    const x = u * PCD_W,
      y = v * PCD_H;
    const now = performance.now();
    this.lastTouch = { u, v, at: now };
    for (const P of this.portals()) {
      const f = P.frame;
      if (x < f.x || x > f.x + f.w || y < f.y || y > f.y + f.h) continue;
      const k = P.slot;
      const redraw = (changed: boolean) => {
        this.forced.add(P.key);
        if (changed) this.lastChange = { rect: P.region, at: now };
      };
      if (y < f.y + HEAD) {
        if (x < f.x + 112) {
          // (the arrows: the page before, the next)
          const i = PCD_PAGES.indexOf(this.pages[k]!);
          this.pages[k] = PCD_PAGES[(i + (x < f.x + 56 ? -1 : 1) + PCD_PAGES.length) % PCD_PAGES.length]!;
          this.menu = null;
          redraw(true);
          return this.pages[k]!;
        }
        if (x > f.x + f.w - 64) {
          // (the corner: this side as one portal, or two — the parts it covers drawn at once)
          const h = k >> 1;
          this.halves[h] = this.halves[h] === "full" ? "split" : "full";
          this.menu = null;
          for (const Q of this.portals())
            if (Q.slot >> 1 === h) {
              this.forced.add(Q.key);
              this.lastChange = { rect: Q.region, at: now };
            }
          return this.halves[h] === "full" ? `${this.pages[2 * h]} FULL` : "SPLIT";
        }
        this.menu = this.menu === k ? null : k;
        redraw(false);
        return this.menu === k ? "MENU" : null;
      }
      if (this.menu === k) {
        const hit = this.menuItems(this.content(P)).find((m) => x >= m.r.x && x <= m.r.x + m.r.w && y >= m.r.y && y <= m.r.y + m.r.h);
        this.menu = null;
        if (hit) this.pages[k] = hit.page;
        redraw(!!hit);
        return hit ? hit.page : null;
      }
      const keys = this.keys(this.pages[k]!);
      if (keys.length && y > f.y + f.h - FOOT) {
        const key = keys[Math.min(Math.floor(((x - f.x) / f.w) * keys.length), keys.length - 1)]!;
        const said = key.act?.() ?? null;
        if (said !== null) redraw(false);
        return said;
      }
      return null;
    }
    return null;
  }

  /** A page's keys at its portal's foot. */
  private keys(page: PcdPage): PcdKey[] {
    const step = (s: number) => () => {
      const j = Math.max(0, RANGES.indexOf(this.range));
      this.range = RANGES[Math.min(Math.max(j + s, 0), RANGES.length - 1)]!;
      return `RNG ${this.range}`;
    };
    switch (page) {
      case "TSD":
        return [
          { label: "RNG −", act: step(-1) },
          { label: `${this.range} ${this.u.distName}` },
          { label: "RNG +", act: step(1) },
          {
            label: "DCLT",
            on: this.declutter,
            act: () => ((this.declutter = !this.declutter), this.declutter ? "DCLT ON" : "DCLT OFF"),
          },
        ];
      default:
        return [];
    }
  }

  /** A portal's page area: under its title, over its keys; a narrow page centred in a wide portal. */
  private content(P: Portal): PcdRect {
    const f = P.frame;
    const page = this.pages[P.slot]!;
    const foot = this.keys(page).length && this.menu !== P.slot ? FOOT : 0;
    const w = P.full && !WIDE.has(page) && this.menu !== P.slot ? PW : f.w;
    return { x: f.x + (f.w - w) / 2, y: f.y + HEAD, w, h: f.h - HEAD - foot };
  }

  /** The pages' menu: a button a page, three across. */
  private menuItems(r: PcdRect) {
    const cols = 3,
      bw = (r.w - 40) / cols,
      bh = 64;
    return PCD_PAGES.map((page, i) => ({
      page,
      r: { x: r.x + 20 + (i % cols) * bw + 6, y: r.y + 30 + Math.floor(i / cols) * (bh + 18), w: bw - 12, h: bh },
    }));
  }

  /** A frame: the data read when due (every PERIOD, or at once after a touch), the part waiting longest drawn when
   *  due (two when the frames are slow; at its first look the display fills in six frames), a touched portal at once.
   *  The parts drawn (to upload). */
  frame(now: number, read: () => PcdData | null): PcdRect[] {
    if (!this.data || this.forced.size || now - this.dataAt >= PERIOD) {
      const d = read();
      if (!d) return [];
      this.data = d;
      this.dataAt = now;
    }
    const d = this.data;
    this.u = unitsOf(d.units);
    const regions = this.regions();
    const when = (key: string) => this.drawn.get(key) ?? -Infinity;
    let out = regions.filter((R) => this.forced.has(R.key));
    this.forced.clear();
    if (!out.length) {
      // (how late each part is, against its pace: the latest first)
      const late = (R: (typeof regions)[number]) => (now - when(R.key)) / this.period(R.key, R.portal);
      const order = [...regions].sort((a, b) => late(b) - late(a));
      out = [];
      for (const R of order.slice(0, 2)) if (late(R) >= 1 && !(out.length && (!Number.isFinite(when(R.key)) || late(R) < 2))) out.push(R);
    }
    for (const R of out) {
      this.region(R.rect, d, R.key, R.portal);
      this.drawn.set(R.key, now);
    }
    return out.map((R) => R.rect);
  }

  /** Draws the whole display at once (the tests, a capture). */
  draw(d: PcdData, now: number) {
    this.u = unitsOf(d.units);
    this.data = d;
    for (const R of this.regions()) {
      this.region(R.rect, d, R.key, R.portal);
      this.drawn.set(R.key, now);
    }
  }

  /** Readies the fonts and the canvas (the F-35 chosen, before its cockpit is seen: no stall at the first drawing):
   *  the glyphs at every size and weight, the black under the parts. */
  warm() {
    const g = this.g;
    for (const w of ["500", "700"])
      for (const size of [16, 18, 20, 22, 24, 26, 28, 30, 34, 40, 48, 56]) {
        g.font = `${w} ${size}px ${FONT}`;
        g.fillStyle = C.white;
        g.fillText("0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ ◀▶°·%:/+−.,", 0, 40);
      }
    g.fillStyle = C.bg;
    g.fillRect(0, 0, PCD_W, PCD_H);
  }

  /** The look the shader needs (ship.wgsl pcdLight): the brightness — its knob's (DAY, NIGHT, NVG) or, automatic,
   *  the Sun's (dimmed from +5° down to civil twilight's −6°, as a pilot would) —, the style, the touch and the page
   *  change, their ages [s] (null: none lately), the change's part on the display (u0, v0, u1, v1). */
  look(now: number, knob: "auto" | "day" | "night" | "nvg", cinematic: boolean) {
    const T = this.lastTouch,
      C = this.lastChange;
    const sun = this.data?.sunAlt ?? 90;
    const day = Math.min(Math.max((sun + 6) / 11, 0), 1);
    const level = { day: 1, night: PCD_NIGHT, nvg: 0.2, auto: PCD_NIGHT + (1 - PCD_NIGHT) * day * day * (3 - 2 * day) }[knob];
    return {
      level,
      style: cinematic ? 1 : 0,
      touch: T && (now - T.at < 1000 || this.ageHeld !== null) ? { u: T.u, v: T.v, age: this.ageHeld ?? (now - T.at) / 1000 } : null,
      change:
        C && (now - C.at < 1000 || this.ageHeld !== null)
          ? {
              rect: [C.rect.x / PCD_W, C.rect.y / PCD_H, (C.rect.x + C.rect.w) / PCD_W, (C.rect.y + C.rect.h) / PCD_H] as [
                number,
                number,
                number,
                number,
              ],
              age: this.ageHeld ?? (now - C.at) / 1000,
            }
          : null,
    };
  }

  /** A part's pace [ms]: the warnings' strip (its clock in seconds) 250, the flight's state 100, a portal its page's
   *  (its menu open: 1 s). */
  private period(key: string, P?: Portal) {
    if (!P) return key === "top" ? 250 : PERIOD;
    return this.menu === P.slot ? 1000 : PAGE_PERIOD[this.pages[P.slot]!];
  }

  /** A part drawn over its own black. */
  private region(r: PcdRect, d: PcdData, key: string, P?: Portal) {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    g.fillStyle = C.bg;
    g.fillRect(r.x, r.y, r.w, r.h);
    if (P) this.portal(P, d);
    else if (key === "top") this.topStrip(d);
    else this.bottomStrip(d);
    g.restore();
  }

  // ---- the frame

  private text(s: string, x: number, y: number, colour = C.white, size = 26, align: CanvasTextAlign = "left", bold = false) {
    const g = this.g;
    g.font = `${bold ? "700 " : "500 "}${size}px ${FONT}`;
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

  /** A portal: its frame, its title bar (the arrows, the page's name, the corner's one-or-two), its page — or the
   *  pages' menu —, its keys. */
  private portal(P: Portal, d: PcdData) {
    const g = this.g;
    const f = P.frame;
    const page = this.pages[P.slot]!;
    const menu = this.menu === P.slot;
    g.strokeStyle = C.frame;
    g.lineWidth = 3;
    g.strokeRect(f.x, f.y, f.w, f.h);
    g.fillStyle = C.title;
    g.fillRect(f.x, f.y, f.w, HEAD);
    const my = f.y + HEAD / 2;
    this.text("◀", f.x + 28, my, C.grey, 24, "center");
    this.text("▶", f.x + 84, my, C.grey, 24, "center");
    g.strokeStyle = C.grey;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(f.x + 56, f.y + 8);
    g.lineTo(f.x + 56, f.y + HEAD - 8);
    g.moveTo(f.x + 112, f.y + 8);
    g.lineTo(f.x + 112, f.y + HEAD - 8);
    g.moveTo(f.x + f.w - 64, f.y + 8);
    g.lineTo(f.x + f.w - 64, f.y + HEAD - 8);
    g.stroke();
    // (the corner: one portal drawn as two, or two as one)
    const cx = f.x + f.w - 32;
    g.strokeStyle = C.grey;
    g.lineWidth = 2;
    if (P.full) {
      g.strokeRect(cx - 14, my - 9, 12, 18);
      g.strokeRect(cx + 2, my - 9, 12, 18);
    } else g.strokeRect(cx - 14, my - 9, 28, 18);
    this.text(menu ? "MENU" : page, f.x + f.w / 2 + 24, my, menu ? C.white : C.cyan, 30, "center", true);
    if (menu) g.fillRect(f.x + f.w / 2 - 40, f.y + HEAD - 4, 128, 3);
    const r = this.content(P);
    g.save();
    g.beginPath();
    g.rect(f.x + 2, r.y, f.w - 4, r.h);
    g.clip();
    if (menu) this.pageMenu(r, page);
    else
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
        case "ICAWS":
          this.icaws(r, d);
          break;
      }
    g.restore();
    // its page's keys: lit when on
    const keys = menu ? [] : this.keys(page);
    if (keys.length) {
      const y0 = f.y + f.h - FOOT;
      g.fillStyle = C.title;
      g.fillRect(f.x + 2, y0, f.w - 4, FOOT - 2);
      const kw = f.w / keys.length;
      keys.forEach((K, i) => {
        const x = f.x + i * kw;
        if (K.act) {
          g.strokeStyle = K.on ? C.cyan : C.frame;
          g.lineWidth = 2;
          g.strokeRect(x + 6, y0 + 6, kw - 12, FOOT - 14);
        }
        this.text(K.label, x + kw / 2, y0 + FOOT / 2 - 1, K.on ? C.cyan : K.act ? C.white : C.grey, 22, "center", true);
      });
    }
  }

  /** The pages' menu: the page shown lit. */
  private pageMenu(r: PcdRect, page: PcdPage) {
    const g = this.g;
    for (const m of this.menuItems(r)) {
      const on = m.page === page;
      g.fillStyle = on ? "#103a44" : "#0a171b";
      g.fillRect(m.r.x, m.r.y, m.r.w, m.r.h);
      g.strokeStyle = on ? C.cyan : C.frame;
      g.lineWidth = 2;
      g.strokeRect(m.r.x, m.r.y, m.r.w, m.r.h);
      this.text(m.page, m.r.x + m.r.w / 2, m.r.y + m.r.h / 2, on ? C.cyan : C.white, 26, "center", true);
    }
  }

  // ---- the pages

  /** The tactical situation: heading up, the ownship low in the portal, the airfields and their runways, the
   *  range rings, the track. */
  private tsd(r: PcdRect, d: PcdData) {
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
      if (!this.declutter) this.text(f.icao ?? f.name.slice(0, 6), x + 14, y + 18, C.cyan, 22);
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
        if (!this.declutter || i === rt.active) this.text(rt.wps[i]!.name, x + 16, y - 14, col, 22);
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
      if (!this.declutter || T.locked) this.text(T.name.slice(0, 10), x + 18, y - 14, col, 20);
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
  }

  /** The flight controls: the craft from above (its surfaces' bars coloured by their travel used), their
   *  deflections in a table beside it (left, right), the load, the incidence, the Mach, the law below. */
  private fcs(r: PcdRect, d: PcdData) {
    const g = this.g;
    const k = Math.min((r.w * 0.56) / 11.4, (r.h - 140) / 16.2);
    const cx = r.x + r.w * 0.3,
      cy = r.y + 14 + 8 * k;
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
    g.lineWidth = 2.5;
    g.beginPath();
    P.forEach(([x, y], i) => (i ? g.lineTo(cx + x * k, cy - y * k) : g.moveTo(cx + x * k, cy - y * k)));
    for (let i = P.length - 1; i >= 0; i--) g.lineTo(cx - P[i]![0] * k, cy - P[i]![1] * k);
    g.closePath();
    g.stroke();
    const s = d.surfaces;
    const col = (a: number, max: number) => (Math.abs(a) / max > 0.85 ? C.yellow : C.green);
    if (s) {
      const bar = (x0: number, y0: number, x1: number, y1: number, a: number, max: number) => {
        g.strokeStyle = col(a, max);
        g.lineWidth = Math.max(4, k * 0.38);
        g.beginPath();
        g.moveTo(cx + x0 * k, cy - y0 * k);
        g.lineTo(cx + x1 * k, cy - y1 * k);
        g.stroke();
      };
      // (the pilot's left: the screen's left — the craft seen from above, its nose up)
      bar(-1.0, -4.0, -4.9, -3.0, s.flaperon[0], 25 * D);
      bar(1.0, -4.0, 4.9, -3.0, s.flaperon[1], 25 * D);
      bar(-1.7, 0.5, -5.0, -1.9, s.lef[0], 30 * D);
      bar(1.7, 0.5, 5.0, -1.9, s.lef[1], 30 * D);
      bar(-1.1, -6.6, -3.3, -6.9, s.stab[0], 20 * D);
      bar(1.1, -6.6, 3.3, -6.9, s.stab[1], 20 * D);
      bar(-1.5, -5.6, -1.9, -6.2, s.rudder[0], 25 * D);
      bar(1.5, -5.6, 1.9, -6.2, s.rudder[1], 25 * D);
      // (the table: each surface's left and right, in degrees)
      const tx = r.x + r.w * 0.6,
        cl = r.x + r.w * 0.79,
        cr = r.x + r.w * 0.95;
      const deg = (a: number) => `${a >= 0 ? "+" : "−"}${Math.abs(a / D).toFixed(0)}`;
      this.text("L", cl, r.y + 30, C.grey, 20, "right");
      this.text("R", cr, r.y + 30, C.grey, 20, "right");
      (
        [
          ["LEF", s.lef, 30],
          ["FLPRN", s.flaperon, 25],
          ["STAB", s.stab, 20],
          ["RUD", s.rudder, 25],
        ] as const
      ).forEach(([name, lr, max], i) => {
        const y = r.y + 72 + i * 46;
        this.text(name, tx, y, C.grey, 22);
        this.text(deg(lr[0]), cl, y, col(lr[0], max * D), 26, "right", true);
        this.text(deg(lr[1]), cr, y, col(lr[1], max * D), 26, "right", true);
      });
    }
    // the load, the incidence, the Mach; the peak and the law
    const y = r.y + r.h - 82;
    g.strokeStyle = C.dim;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(r.x + 16, y - 32);
    g.lineTo(r.x + r.w - 16, y - 32);
    g.stroke();
    this.text(`G ${d.g.toFixed(1)}`, r.x + 24, y, d.g > 6.5 ? C.yellow : C.white, 30, "left", true);
    this.text(`AOA ${(d.alpha / D).toFixed(1)}°`, r.x + r.w * 0.36, y, d.alpha > 24 * D ? C.yellow : C.white, 30, "left", true);
    this.text(`M ${d.mach.toFixed(2)}`, r.x + r.w - 24, y, C.white, 30, "right", true);
    this.text(`PEAK ${d.gPeak.toFixed(1)} G`, r.x + 24, y + 44, C.grey, 22);
    this.text(d.stovl?.on ? "LAW STOVL" : "LAW CTOL · 7G", r.x + r.w - 24, y + 44, C.cyan, 22, "right", true);
  }

  /** The engine: the core's speed (N2) and the exhaust's temperature as dials, the thrust, the flow. */
  private eng(r: PcdRect, d: PcdData) {
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
  private fuel(r: PcdRect, d: PcdData) {
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
  private stovlPage(r: PcdRect, d: PcdData) {
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
  private cni(r: PcdRect, d: PcdData) {
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
  private adi(r: PcdRect, d: PcdData) {
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

  /** The integrated cautions and warnings: each alert in its colour, the gravest first (warnings red, cautions
   *  amber, advisories white); in a fight, the damage. */
  private icaws(r: PcdRect, d: PcdData) {
    const g = this.g;
    const rank = { warning: 0, caution: 1, advisory: 2 } as const;
    const list = [...d.alerts].sort((a, b) => rank[a.level] - rank[b.level]);
    const n = (l: keyof typeof rank) => list.filter((a) => a.level === l).length;
    this.text(`WARN ${n("warning")}`, r.x + 24, r.y + 30, n("warning") ? C.red : C.grey, 24, "left", true);
    this.text(`CAUT ${n("caution")}`, r.x + r.w / 2, r.y + 30, n("caution") ? C.amber : C.grey, 24, "center", true);
    this.text(`ADV ${n("advisory")}`, r.x + r.w - 24, r.y + 30, n("advisory") ? C.white : C.grey, 24, "right", true);
    let y = r.y + 70;
    if (!list.length) this.text("NO FAULTS", r.x + r.w / 2, r.y + r.h / 2 - 20, C.green, 34, "center", true);
    for (const a of list.slice(0, Math.floor((r.h - 150) / 48))) {
      const c = a.level === "warning" ? C.red : a.level === "caution" ? C.amber : C.white;
      if (a.level === "warning") {
        g.fillStyle = c;
        g.fillRect(r.x + 16, y - 20, r.w - 32, 40);
      } else {
        g.strokeStyle = c;
        g.lineWidth = 2;
        g.strokeRect(r.x + 16, y - 20, r.w - 32, 40);
      }
      this.text(a.text.toUpperCase().slice(0, 34), r.x + 30, y, a.level === "warning" ? "#000" : c, 22, "left", true);
      y += 48;
    }
    // (in a fight: the damage taken)
    if (d.damage !== undefined && d.damage > 0) {
      const yb = r.y + r.h - 50,
        w = r.w - 200;
      this.text("DAMAGE", r.x + 24, yb, C.grey, 22);
      g.strokeStyle = C.frame;
      g.lineWidth = 2;
      g.strokeRect(r.x + 130, yb - 14, w, 28);
      g.fillStyle = d.damage > 0.6 ? C.red : d.damage > 0.3 ? C.amber : C.yellow;
      g.fillRect(r.x + 133, yb - 11, (w - 6) * Math.min(d.damage, 1), 22);
      this.text(`${Math.round(d.damage * 100)}%`, r.x + r.w - 24, yb, C.white, 24, "right", true);
    }
  }

  /** The checklists: each item checked from the flight's state. */
  private ckl(r: PcdRect, d: PcdData) {
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
