// The flight HUD's conformal symbology, drawn over the view (canvas.fl-hud, each frame): what is in the
// world drawn where it is seen — the horizon and the pitch ladder about the local vertical, the heading
// tape (the world's north), the bank scale, the orbital markers the view lacked (radial, normal),
// and for what leaves the screen an arrow at its edge, pointing to it.
//
// Directions come in camera coordinates (x right, y up, z forward — FlightHud's Info.dirs, the ship's
// axes Info.S): at infinity, so right from any mount. In the views from outside the ship only the
// markers and their arrows are drawn (the instruments belong to the pilot's seat and the chase).

import type { Settings } from "../../settings";
import type { FutureView, RunwayView } from "../../controls";
import { COL, FONT, MONO, marker } from "../hudkit";
import { C_MPS, G0, M_METRES, M_SECONDS } from "../../units";
import { dot } from "../../math/vec3";
import { blinkOn } from "../clock";
import type { HudItem } from "./declutter";
import { safeFrame } from "./safe";
import { type Box, drawn, fit } from "./layout";
import { drawJetHud, HMD_RGB, JET_GREEN, type JetHudInfo } from "./jethud";
import type { avionicsData } from "../../f35/cockpit";
import { alertsOf, type AlertInput } from "./alerts";
import type { HudKind } from "../../game/hudkind";
import type { InterceptCues } from "../../game/intercept";
import { unitsFor } from "../unitsys";
import { drawApproachHud, drawSpaceHud, type ApproachHudInfo, type SpaceHudInfo } from "./kindhud";
import { t, tf } from "../../i18n";

/** The phase lets this element show (hud/declutter.ts — none given: all). */
const on = (F: { show?: Record<HudItem, boolean> }, k: HudItem) => !F.show || F.show[k];

type V3 = [number, number, number];

/** What the symbology needs from the flight (a slice of FlightHud's Info). */
/** A fight's radar picture (controller/combat.ts): heading up — x right, y ahead [m] —, each contact's track
 *  turned from the nose's heading [rad] (null: still). */
/** the room's others on the radar's scope this frame (ui/netsession.ts writes it; heading up, metres) */
export const netRadar: RadarData = { contacts: [], missiles: [] };

export interface RadarData {
  contacts: {
    x: number;
    y: number;
    dz: number;
    trk: number | null;
    air: boolean;
    alive: boolean;
    locked: boolean;
    seen: boolean;
    name: string;
    /** a player's (docs/PLAN-RESEAU.md R1): drawn in his colour, a friend's */
    colour?: string;
    /** the IFF known (game/radar.ts); a track from the datalink only (drawn hollow) */
    iff?: string;
    datalink?: boolean;
  }[];
  missiles: { x: number; y: number; trk: number | null; red: boolean }[];
}

/** The F-35's radar as the HUD draws it (controller/radar.ts): its mode, its beam off the nose [rad], its picture,
 *  its lock (on the camera's axes: its designation box; its range [m], closure [m/s], altitude [m]). */
export interface RadarPicture {
  mode: string;
  beam: number;
  contacts: RadarData["contacts"];
  lock: {
    name: string;
    iff: string;
    range: number;
    closure: number;
    alt: number;
    cam?: V3 | null;
    /** the collision course on the camera's axes (a point 5 km along it) */
    collCam?: V3 | null;
    icpt?: InterceptCues;
  } | null;
}

export interface SymInfo {
  /** the flown craft's docking port's axis (camera coordinates): the COAS's boresight */
  dockBore?: number[] | null;
  /** a spacecraft's own panel (game/craftpanel.ts) */
  craftPanel?: import("../../game/craftpanel").CraftPanel | null;
  /** the powered landing's point (the LPD, controller/telemetry.ts) */
  lpd?: { dir: number[] | null; dist: number; moved: boolean } | null;
  /** the F-35's avionics (f35/cockpit.ts): its status block on the helmet */
  avionics?: ReturnType<typeof avionicsData> | null;
  S: number[][];
  /** where the ship is (the hole's region: its lensed tube may draw the path instead) */
  region?: string;
  /** near the hole: the radius [M], the speed relative to the local observer [c] and γ, the clock rate
   *  dτ/dt, the energy E per unit mass, the horizon's, ISCO's and photon orbit's radii [M], inside the
   *  ergosphere */
  r?: number;
  speed?: number;
  gamma?: number;
  dtau?: number;
  E?: number;
  rH?: number;
  isco?: number;
  photon?: number;
  ergo?: boolean;
  /** the flight plan: its burns (coordinate times [M], Δ(γβ) [c]), the one burning, now [M] */
  plan?: { nodes: { t: number; dv: number[] }[]; burning?: boolean | number | null; now: number } | null;
  /** the engine: its full thrust [the scene's acceleration unit] */
  engine?: { max: number; jet?: { kg: number; full: number; bingo?: number } | null } | null;
  /** a challenge flown (controller/challenge.ts): its banner, its next gates (corners in camera coordinates) */
  chal?: {
    title: string;
    kind: string;
    time: number;
    next: number;
    count: number;
    missed: number;
    over: number;
    ceiling: number | null;
    status: string;
    result: { text: string; medal: string | null } | null;
    figures: { idx: number; list: string[]; marks: number[] } | null;
    gates: { c: (V3 | null)[]; k: number; n: number; dist: number }[];
    radar: { contacts: { x: number; y: number; gate: number; next: boolean; trk: number | null }[] } | null;
  } | null;
  /** an aerobatic figure flown (controller/aerobatics.ts): its banner, its cue, its entry, the guide, its result */
  aero?: {
    title: string;
    mode: string;
    status: string;
    t: number;
    cue: string;
    entry: { v: number; vTol: number; vNow: number; agl: number; law: string; lawNow: string } | null;
    guide: { load: number | null; roll: number; nNow: number } | null;
    result: { score: number; notes: string[] } | null;
    seq: { idx: number; n: number; total: number } | null;
  } | null;
  /** the F-35's radar (controller/radar.ts) */
  radar?: RadarPicture | null;
  /** a fight flown (controller/combat.ts): every vector on the camera's axes from the craft [m] */
  combat?: {
    title: string;
    t: number;
    limit: number;
    status: string;
    result: string | null;
    weapon: string;
    stores: { aim120: number; aim9x: number; jdam: number; jsm?: number; gun: number; flares: number };
    damage: number;
    firing: boolean;
    targets: {
      d: V3;
      dist: number;
      name: string;
      kind: string;
      alive: boolean;
      locked: boolean;
      seen: boolean;
      ground: boolean;
      closing: number;
      /** a team-mate in a match (docs/PLAN-RESEAU.md R3): blue, never a shot's */
      friendly?: boolean;
    }[];
    missiles: { d: V3; dist: number; red: boolean; motor: boolean }[];
    rounds: V3[];
    /** the tracers: a streak each (its head, its tail) */
    tracers?: [V3, V3][];
    /** the gun's funnel: the stream's edges a wingspan apart, the nearest first; the solution's range, flight, reach */
    funnel?: { l: V3; r: V3; range: number }[];
    gun?: { range: number; tof: number; inRange: boolean } | null;
    booms: { d: V3; dist: number; age: number; size: number }[];
    lead: V3 | null;
    zone: { range: number; rMax: number; rMin: number; inRange: boolean } | null;
    fall: V3 | null;
    threats: { d: V3; dist: number }[];
    gunReady: boolean;
    shoot: boolean;
    gunHot: boolean;
    infinite: boolean;
    radar: RadarData;
    /** the hit marker: a hit of the player's this moment, a kill */
    hitMark?: "hit" | "kill" | null;
    /** shot down in a match, waiting to fly again */
    down?: boolean;
  } | null;
  /** a plane's flight plan: the active waypoint (its bearing [° true], its distance [m]) */
  nav?: { name: string; brg: number; dist: number; on: boolean } | null;
  /** an ILS approach: the runway, the needles [dots — null: not received], the distance [km], its phase */
  ils?: { id: string; loc: number | null; gs: number | null; dme: number; phase: string; auto: boolean } | null;
  /** the relief about us for the radar's scope (its place, heading, height; the ground's height at a place) */
  relief?: { lat: number; lon: number; hdg: number; alt: number; at: (lat: number, lon: number) => number } | null;
  /** the Auto-GCAS's and Auto-ACAS's state: flying up, the ground near, an escape */
  gcas?: { flyUp: boolean; near: boolean; escape: string | null } | null;
  /** the beginner's ring: where the jet is aimed (its heading and flight path [rad]) */
  aimRing?: { hdg: number; gamma: number } | null;
  /** a mission's objective (its bearing [° true], its distance [m], its height over ours [m]) */
  msn?: { name: string; brg: number; dist: number; dz: number } | null;
  /** the F-35B's STOVL mode (controller/telemetry.ts) */
  stovl?: { on: boolean; conv: number; swivel: number; hover: boolean; vz: number; heavy: boolean } | null;
  /** the docking: the ports' range, closing rate, angle; the guide (camera coordinates) */
  dock?: {
    range: number;
    closing: number;
    lateral: number;
    lateralRate: number;
    angle: number;
    docked: boolean;
    title: string;
    name: string;
  } | null;
  dockGuide?: { lat: V3; latRate: V3; axis: V3; gates: { d: V3; r: number; k: number }[] } | null;
  /** near the ground: height over it [m], vertical and horizontal speeds [m/s], thrust over weight, the
   *  local gravity [g], landed */
  surface?: { alt: number; vVert: number; vHor: number; twr: number; gLocal: number; landed?: boolean } | null;
  dirs: Record<string, V3 | null | undefined>;
  air?: {
    u?: number[] | null;
    q: number;
    inAir?: boolean;
    /** the angle of attack, the sideslip [rad]; the wing's stall and best lift-to-drag incidences */
    alpha?: number;
    beta?: number;
    stalled?: boolean;
    stallA?: number | null;
    bestA?: number | null;
    /** the speed through the air [m/s], the load and its limit [g] */
    speed?: number;
    g?: number;
    gMax?: number;
    /** how the craft flies in the air: rocket, plane, the sci-fi computer */
    mode?: string;
    /** the flight computer's command: speed [m/s], flight path angle, heading [rad] */
    sf?: { speed: number; gamma: number; heading: number } | null;
    /** Effective commanded direction through the air, in ship coordinates (as u). */
    sfU?: V3 | null;
    /** the load's peak this flight [g], Mach */
    gPeak?: number;
    mach?: number;
  } | null;
  /** the jet's systems and figures (plane mode in the air — ui/hud/jethud.ts): the altitude over the sea [m],
   *  the throttle, the modes engaged */
  jet?: Pick<JetHudInfo, "alt" | "throttle" | "modes"> | null;
  /** the craft's status (game/status.ts): the Space HUD's orbit, its next event, the target */
  status?: {
    soiName: string;
    kerr?: unknown;
    orbit: SpaceHudInfo["orbit"];
    next: SpaceHudInfo["next"];
    target: SpaceHudInfo["target"];
  } | null;
  /** the gear, the flaps, the air brake: the Approach HUD's */
  gear?: ApproachHudInfo["gear"];
}

export interface SymFrame {
  ctx: CanvasRenderingContext2D;
  /** the canvas [device px], its pixel ratio */
  W: number;
  H: number;
  dpr: number;
  /** the vertical field of view [°] */
  fov: number;
  s: Settings;
  i: SymInfo;
  /** a view from outside the ship (around, free, fly-by, the port's camera): markers only */
  outside: boolean;
  /** the HUD's density (0 full, 1 minimal, 2 clean) */
  density: number;
  /** where the heading tape may sit: below this [device px] */
  top: number;
  /** the future as the eye sees it: the predicted path, the places to come, the impact */
  future?: FutureView | null;
  /** the quarter of the orbit asked among the places to come [s] (labelled so) */
  quarter?: number;
  /** the runway in reach (its outline, centreline, aim point; the craft's place along and across it) */
  runway?: RunwayView | null;
  /** the scene's time [s] (the energy chevron's rate is taken in it) */
  simS?: number;
  /** the HUD's kind (game/hudkind.ts): its own readouts, the atmosphere's style (absent: as before — the jet's
   *  in plane mode) */
  kind?: HudKind;
  /** what the flight's phase lets the HUD draw (hud/declutter.ts; absent: everything) */
  show?: Record<HudItem, boolean>;
  /** a small screen (a phone): the symbology in the view kept, the boxes, scopes, heading tape and bank
   *  scale left to the HUD's panels (set here) */
  compact?: boolean;
}

const UNDER = "rgba(0, 0, 0, 0.42)";
/** the helmet's realistic look: a faint shade under its light (a dark green, as the visor's tint) */
const VISOR_SHADE = "rgba(0, 28, 12, 0.24)";
/** the ladder's, the heading's, the bank's colour (r, g, b): the HUD's cyan, the jet's green in its style */
const CYAN = "124, 214, 255";
let LADDER = CYAN;
const D = Math.PI / 180;
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const comb = (a: V3, ka: number, b: V3, kb: number): V3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
/** (camera coordinates are left-handed: a cross product there turns the other way — this is the
 *  right-handed world's a × b) */
const crossW = (a: V3, b: V3): V3 => [-(a[1] * b[2] - a[2] * b[1]), -(a[2] * b[0] - a[0] * b[2]), -(a[0] * b[1] - a[1] * b[0])];
const wrap360 = (a: number) => ((a % 360) + 360) % 360;

export function drawSymbology(F: SymFrame) {
  drawn.length = 0;
  const { ctx, W, H, dpr, s, i } = F;
  F.compact = W / dpr < 1000 || H / dpr < 560;
  const tanH = Math.tan((F.fov * D) / 2);
  const asp = W / H;
  const fpx = H / (2 * tanH);
  /** a direction on the screen [px] (unclipped), or null behind the eye */
  const pr = (d: V3 | null | undefined): [number, number] | null => {
    if (!d || d[2] <= 1e-3) return null;
    return [W / 2 + (d[0] / d[2]) * fpx, H / 2 - (d[1] / d[2]) * fpx];
  };
  const inside = (p: [number, number] | null, m = 0) => !!p && p[0] >= m && p[0] <= W - m && p[1] >= m && p[1] <= H - m;
  // (each mark twice — no more strokes in any look —: under it a dark outline for the bright sky (the readable look),
  // or, on the F-35's helmet, the light its visor shows: the mark's own glow about it, a faint shade under it to keep
  // it on a white cloud (realistic), a wider glow alone (cinematic) — docs/PLAN-PCD-AAA.md, Q8)
  let look: Settings["f35HmdLook"] = "readable";
  const glowOf = () => (look === "cinematic" ? { w: 6, a: 0.3 } : { w: 3.2, a: 0.22 });
  const stroke = (draw: () => void, col: string, lw: number, dash?: number[]) => {
    ctx.setLineDash(dash ? dash.map((x) => x * dpr) : []);
    const G = look === "readable" ? null : glowOf();
    for (const [w, c, a] of [G ? ([lw + G.w, col, G.a] as const) : ([lw + 2.4, UNDER, 1] as const), [lw, col, 1] as const]) {
      ctx.lineWidth = w * dpr;
      ctx.strokeStyle = look === "realistic" && a < 1 ? VISOR_SHADE : c;
      ctx.globalAlpha = look === "realistic" && a < 1 ? 1 : a;
      ctx.beginPath();
      draw();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);
  };
  const text = (t: string, x: number, y: number, col: string, size: number, align: CanvasTextAlign = "center", mono = false) => {
    ctx.font = `${mono ? 600 : 700} ${size * dpr}px ${mono ? MONO : FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineWidth = (look === "cinematic" ? 4 : 3) * dpr;
    ctx.strokeStyle = look === "readable" ? UNDER : look === "realistic" ? VISOR_SHADE : col;
    ctx.globalAlpha = look === "cinematic" ? 0.28 : 1;
    ctx.strokeText(t, x, y);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.fillText(t, x, y);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const up = i.dirs.up ?? null;
  const north = i.dirs.north ?? null;
  const pilotView = !F.outside && F.density < 2;
  // (the jet's style: flown as a plane, in the air, from the pilot's seat — its green, its tapes)
  const A0 = i.air;
  // (the Atmosphere HUD: the fighter's for every flight in the air; without a kind, the plane's only)
  // (the F-35's helmet: its symbology in the air whatever the phase — the approach's too)
  const helmet = !!i.engine?.jet;
  const atmo = F.kind ? F.kind === "atmo" || (helmet && F.kind === "approach") : A0?.mode === "plane";
  // (the F-35B in its STOVL mode keeps it to a hover: its helmet's symbology down to no speed at all)
  const jet = s.hudJet !== "off" && pilotView && atmo && i.jet && A0?.inAir && (A0.q > 20 || !!i.stovl?.on) ? i.jet : null;
  // (the F-35's helmet: its look, its colour the settings')
  if (helmet && s.vessel === "f35" && (s.shipMount === "cockpit" || s.shipMount === "cabin")) look = s.f35HmdLook ?? "realistic";
  const hmdRgb = helmet && s.vessel === "f35" ? (HMD_RGB[s.f35HmdColor] ?? JET_GREEN) : JET_GREEN;
  LADDER = jet ? hmdRgb : CYAN;
  const S = i.S;
  const nose: V3 = [S[0]![2]!, S[1]![2]!, S[2]![2]!];

  // ---- the horizon and the pitch ladder (about the local vertical)
  if (up && pilotView && s.hudHorizon && on(F, "horizon")) {
    // (the rungs centred on the view's own bearing — the ladder where the eye looks)
    let h0 = comb([0, 0, 1], 1, up, -up[2]);
    if (Math.hypot(...h0) < 0.05) h0 = comb(nose, 1, up, -dot(nose, up));
    if (Math.hypot(...h0) > 1e-6) {
      h0 = norm(h0);
      const side = norm(crossW(up, h0));
      const at = (e: number, a: number): V3 => comb(comb(h0, Math.cos(a), side, Math.sin(a)), Math.cos(e), up, Math.sin(e));
      // the view's elevation: the rungs within the screen and a little beyond
      const eView = Math.asin(Math.max(-1, Math.min(1, up[2])));
      const span = Math.atan(tanH) * 1.25;
      // the horizon: long, across the screen
      const hz: [number, number][] = [];
      const aw = Math.atan(tanH * asp) * 1.4;
      for (let k = -24; k <= 24; k++) {
        const p = pr(at(0, (k / 24) * aw));
        if (p) hz.push(p);
      }
      if (hz.length > 1)
        stroke(() => hz.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))), `rgba(${LADDER}, 0.8)`, 1.6);
      // the rungs every 5° (labelled every 10°): solid above, dashed below, their ends' ticks to the horizon
      const half = 95 * dpr,
        gap = 34 * dpr;
      // (the rungs within the HUD's field — a circle about the view's centre —, fading towards its rim)
      const field = Math.min(H, W) * 0.3;
      for (let deg = -85; deg <= 85; deg += 5) {
        if (deg === 0) continue;
        const e = deg * D;
        if (Math.abs(e - eView) > span) continue;
        const c0 = pr(at(e, 0));
        if (!c0) continue;
        const off = Math.hypot(c0[0] - W / 2, c0[1] - H / 2);
        if (off > field) continue;
        const fade = Math.min(1, (field - off) / (field * 0.3));
        const ce = Math.max(Math.cos(e), 0.08);
        const w = (deg % 10 === 0 ? half : half * 0.6) / fpx / ce,
          g = gap / fpx / ce;
        const col = `rgba(${LADDER}, ${((deg % 10 === 0 ? 0.85 : 0.55) * fade).toFixed(3)})`;
        const dash = deg < 0 ? [7, 5] : undefined;
        for (const sg of [-1, 1]) {
          const pts: [number, number][] = [];
          for (let k = 0; k <= 6; k++) {
            const p = pr(at(e, sg * (g + ((w - g) * k) / 6)));
            if (p) pts.push(p);
          }
          // (the end's tick towards the horizon)
          const tip = pr(at(e - (Math.sign(deg) * 8 * dpr) / fpx, sg * w));
          if (pts.length < 2) continue;
          stroke(
            () => {
              pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
              if (tip) ctx.lineTo(tip[0], tip[1]);
            },
            col,
            1.4,
            dash,
          );
          if (deg % 10 === 0) {
            const end = pts[pts.length - 1]!;
            text(`${deg}`, end[0] + sg * 18 * dpr, end[1], col, 11.5, "center", true);
          }
        }
      }
      // the zenith and the nadir
      for (const [d, lab] of [
        [up, "ZEN"],
        [comb(up, -1, up, 0), "NAD"],
      ] as const) {
        const p = pr(d as V3);
        if (!inside(p, 10 * dpr)) continue;
        stroke(
          () => {
            ctx.arc(p![0], p![1], 9 * dpr, 0, 2 * Math.PI);
          },
          `rgba(${LADDER}, 0.7)`,
          1.3,
        );
        text(lab, p![0], p![1] + 20 * dpr, `rgba(${LADDER}, 0.7)`, 10);
      }
    }
  }

  // ---- the heading tape (the world's north), at the top
  if (up && north && pilotView && s.hudHeading && !F.compact && on(F, "heading")) {
    const east = norm(crossW(north, up));
    const bearing = (d: V3 | null | undefined) => {
      if (!d) return null;
      const h = comb(d, 1, up, -dot(d, up));
      if (Math.hypot(...h) < 1e-4) return null;
      return wrap360(Math.atan2(dot(h, east), dot(h, north)) / D);
    };
    const view = bearing([0, 0, 1]) ?? bearing(nose);
    if (view !== null) {
      // (the scale's baseline; its figures above, the carets on it, the view's heading boxed under it)
      const cx = W / 2,
        y = F.top + 46 * dpr,
        wd = Math.min(420 * dpr, W * 0.36),
        degPx = wd / 70;
      // the scale: ticks every 5°, figures every 10°, the cardinal points named
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - wd / 2, y - 24 * dpr, wd, 34 * dpr);
      ctx.clip();
      for (let a = Math.floor((view - 40) / 5) * 5; a <= view + 40; a += 5) {
        const x = cx + (a - view) * degPx;
        const big = a % 10 === 0;
        stroke(
          () => {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y - (big ? 8 : 4) * dpr);
          },
          `rgba(${LADDER}, ${big ? 0.85 : 0.5})`,
          1.2,
        );
        if (big) {
          const v = wrap360(a);
          const card = { 0: "N", 90: "E", 180: "S", 270: "W" }[v];
          text(
            card ?? String(v / 10).padStart(2, "0"),
            x,
            y - 16 * dpr,
            card ? "rgba(255, 200, 90, 0.95)" : `rgba(${LADDER}, 0.85)`,
            card ? 13 : 11.5,
            "center",
            !card,
          );
        }
      }
      // the carets: the nose's heading, the track (where the craft goes), the target's bearing
      const caret = (b: number | null, col: string, down: boolean) => {
        if (b === null) return;
        let dx = b - view;
        dx = ((dx + 540) % 360) - 180;
        const x = cx + Math.max(-wd / 2 + 6 * dpr, Math.min(wd / 2 - 6 * dpr, dx * degPx));
        const yy = y + (down ? 1 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x - 5 * dpr, yy + 8 * dpr);
        ctx.lineTo(x + 5 * dpr, yy + 8 * dpr);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.strokeStyle = UNDER;
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.fill();
      };
      ctx.restore();
      const A = i.air;
      const track =
        A && A.u && A.q > 20
          ? bearing([
              S[0]![0]! * A.u[0]! + S[0]![1]! * A.u[1]! + S[0]![2]! * A.u[2]!,
              S[1]![0]! * A.u[0]! + S[1]![1]! * A.u[1]! + S[1]![2]! * A.u[2]!,
              S[2]![0]! * A.u[0]! + S[2]![1]! * A.u[1]! + S[2]![2]! * A.u[2]!,
            ])
          : bearing(i.dirs.prograde);
      caret(bearing(i.dirs.target), COL.target!, true);
      // (the flight plan's active waypoint: magenta, the route's colour)
      caret(i.nav ? i.nav.brg : null, "#ff4fd8", true);
      // (the beginner's ring — A1: where the jet is aimed, a cyan ring with its four ticks; the jet flies to it)
      const ar = i.aimRing;
      if (ar) {
        const p = pr(comb(comb(north, Math.cos(ar.hdg), east, Math.sin(ar.hdg)), Math.cos(ar.gamma), up, Math.sin(ar.gamma)));
        if (inside(p, 20 * dpr)) {
          const R = 16 * dpr;
          stroke(() => ctx.arc(p![0], p![1], R, 0, 2 * Math.PI), "#6fe8ff", 2);
          stroke(
            () => {
              for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ] as const) {
                ctx.moveTo(p![0] + dx * R, p![1] + dy * R);
                ctx.lineTo(p![0] + dx * (R + 8 * dpr), p![1] + dy * (R + 8 * dpr));
              }
            },
            "#6fe8ff",
            2,
          );
        }
      }
      // (a mission's objective — P2: amber on the tape, and where it is in the view, ringed, its name and distance)
      const m = i.msn;
      caret(m ? m.brg : null, "#ffb03a", true);
      if (m) {
        const b = m.brg * D,
          el = Math.atan2(m.dz, Math.max(m.dist, 1));
        const p = pr(comb(comb(north, Math.cos(b), east, Math.sin(b)), Math.cos(el), up, Math.sin(el)));
        if (inside(p, 14 * dpr)) {
          const R = 11 * dpr;
          stroke(() => ctx.arc(p![0], p![1], R, 0, 2 * Math.PI), "#ffb03a", 1.6);
          stroke(
            () => {
              ctx.moveTo(p![0], p![1] - 4 * dpr);
              ctx.lineTo(p![0] + 4 * dpr, p![1]);
              ctx.lineTo(p![0], p![1] + 4 * dpr);
              ctx.lineTo(p![0] - 4 * dpr, p![1]);
              ctx.closePath();
            },
            "#ffb03a",
            1.4,
          );
          const U = unitsFor(s);
          text(`${m.name}  ${U.dist(m.dist).toFixed(1)} ${U.distName}`, p![0] + R + 5 * dpr, p![1], "#ffb03a", 10.5, "left", true);
        }
      }
      caret(track, "#78ffaa", true);
      caret(bearing(nose), "#ffc85a", true);
      // the view's heading, boxed
      const box = `${String(Math.round(view) % 360).padStart(3, "0")}°`;
      ctx.fillStyle = "rgba(4, 10, 18, 0.72)";
      ctx.strokeStyle = `rgba(${LADDER}, 0.85)`;
      ctx.lineWidth = 1.2 * dpr;
      const bw = 52 * dpr,
        bh = 20 * dpr;
      ctx.fillRect(cx - bw / 2, y + 12 * dpr, bw, bh);
      ctx.strokeRect(cx - bw / 2, y + 12 * dpr, bw, bh);
      text(box, cx, y + 22 * dpr, "#ffffff", 12.5, "center", true);
    }
  }

  // ---- the bank scale: fixed to the craft, its pointer to the sky's up
  if (up && pilotView && s.hudBank && !F.compact && on(F, "bank")) {
    const X: V3 = [S[0]![0]!, S[1]![0]!, S[2]![0]!],
      Y: V3 = [S[0]![1]!, S[1]![1]!, S[2]![1]!];
    // (> 0 banked right: the left wing — the ship's +x — high)
    const bank = Math.atan2(dot(X, up), dot(Y, up));
    const cx = W / 2,
      cy = H / 2,
      R = Math.min(H, W) * 0.34;
    const col = `rgba(${LADDER}, 0.8)`;
    stroke(() => ctx.arc(cx, cy, R, -Math.PI / 2 - 60 * D, -Math.PI / 2 + 60 * D), `rgba(${LADDER}, 0.45)`, 1.2);
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const t = -Math.PI / 2 + a * D,
        l = a % 30 === 0 ? 12 : 7;
      stroke(
        () => {
          ctx.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R);
          ctx.lineTo(cx + Math.cos(t) * (R + l * dpr), cy + Math.sin(t) * (R + l * dpr));
        },
        col,
        a === 0 ? 2 : 1.2,
      );
    }
    const b = Math.max(-62 * D, Math.min(62 * D, -bank));
    const t = -Math.PI / 2 + b;
    const px = cx + Math.cos(t) * (R - 3 * dpr),
      py = cy + Math.sin(t) * (R - 3 * dpr);
    const nx = Math.cos(t),
      ny = Math.sin(t);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - nx * 11 * dpr - ny * 6 * dpr, py - ny * 11 * dpr + nx * 6 * dpr);
    ctx.lineTo(px - nx * 11 * dpr + ny * 6 * dpr, py - ny * 11 * dpr - nx * 6 * dpr);
    ctx.closePath();
    ctx.fillStyle = Math.abs(bank) > 60 * D ? "#ff5a46" : "#ffc85a";
    ctx.strokeStyle = UNDER;
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.fill();
    if (Math.abs(bank) > 1.5 * D)
      text(
        `${Math.abs(Math.round(bank / D))}° ${bank > 0 ? "R" : "L"}`,
        px - nx * 24 * dpr,
        py - ny * 24 * dpr,
        "#ffc85a",
        11,
        "center",
        true,
      );
  }

  // ---- the future: the path in perspective, the places to come, the impact
  if (F.future && F.density < 2) drawFuture(F, F.future, pr, stroke, text, inside);

  // ---- approach and landing: the runway, the vertical landing's scope and cues
  if (F.runway && s.hudRunway && on(F, "runway") && !F.outside && F.density < 2) drawRunway(F, F.runway, pr, stroke, text, inside);
  if (i.surface && !i.surface.landed && s.hudHover && on(F, "hover") && !F.outside && F.density < 2 && !F.compact)
    drawHover(F, i.surface, up, pr, stroke, text, inside);
  // ---- the powered landing's point: where the autopilot lands, the stick moving it (the LPD)
  if (i.lpd?.dir && !F.outside && F.density < 2) drawLpd(F, i.lpd, pr, stroke, text, inside);

  // ---- near Gargantua: the relativity box; the way to the hole named
  if (i.region === "hole" && s.hudRelativity && on(F, "relativity") && !F.outside && F.density < 2 && !F.compact && Number.isFinite(i.r))
    drawRelativity(F, pr, text, inside);

  // ---- in space: the next burn (its countdown, its Δv, its length, the aim), the docking's guide
  if (i.plan && i.plan.nodes.length && s.hudBurn && on(F, "burn") && !F.outside && F.density < 2)
    drawBurn(F, pr, stroke, text, inside, nose);
  if (i.chal) drawChallenge(F, pr, stroke, text);
  if (i.aero) drawAero(F, text);
  if (i.avionics && s.f35Avionics && pilotView) drawAvionics(F, i.avionics, text, hmdRgb);
  // (a spacecraft's own panel — the Lander's descent, the Endurance's mothership's: game/craftpanel.ts)
  else if (i.craftPanel && F.density < 2) drawCraftPanel(F, i.craftPanel, text);
  if (i.combat) drawCombat(F, pr, stroke, text);
  // (flying together, out of a fight or a course: the others on the scope, each in his colour — ui/netsession.ts)
  // (the F-35's radar — always on in the air: its scope, a fight's missiles on it, a course's gates; its lock's box)
  if (i.avionics && s.f35Radar && i.radar)
    drawRadar(
      F,
      { contacts: i.radar.contacts, missiles: i.combat?.radar.missiles ?? [] },
      i.chal?.radar?.contacts ?? null,
      text,
      stroke,
      i.radar,
    );
  if (i.radar?.lock && !i.combat) drawLockBox(F, pr, stroke, text, i.radar.lock);
  if (i.radar?.lock?.icpt) drawIntercept(F, pr, stroke, text, i.radar.lock, i.radar.lock.icpt);
  if (i.dock && i.dockGuide && !i.dock.docked && s.hudDock && on(F, "dock") && F.density < 2) drawDock(F, pr, stroke, text, inside);
  // (the docking's last 60 m: the COAS — the own port's boresight, a crosshair the target port's mark is flown into)
  if (i.dockBore && i.dirs.dock && s.hudDock && F.density < 2) drawCoas(F, i.dockBore as V3, i.dirs.dock as V3, pr, stroke, text, inside);

  // ---- in the air: the angle of attack, the energy, the sideslip, the load, the flight director
  const A = i.air;
  if (A && A.u && A.q > 20 && pilotView) drawAir(F, A, pr, stroke, text, up, fpx);
  if (jet && A && i.surface)
    drawJetHud(
      { ctx, W, H, dpr, compact: !!F.compact, top: F.top, units: s.units === "imperial" ? "aviation" : "metric" },
      {
        speed: A.speed ?? 0,
        mach: A.mach ?? 0,
        g: A.g ?? 1,
        gPeak: A.gPeak ?? A.g ?? 1,
        gMax: A.gMax ?? 9,
        alpha: A.alpha ?? 0,
        stall: A.stallA ?? null,
        alt: jet.alt,
        radar: i.surface.alt,
        vs: i.surface.vVert,
        throttle: jet.throttle,
        modes: jet.modes,
        wp: i.nav ?? null,
        law: s.vessel === "f35" ? s.f35Law : "normal",
        rgb: hmdRgb,
        bright: helmet && s.vessel === "f35" ? s.f35HmdBrightness : 1,
        look,
        // (the F-35: its helmet's symbology — the values boxed, its fuel, its hover)
        hmd: i.engine?.jet
          ? {
              fuel: i.engine.jet.kg,
              full: i.engine.jet.full,
              hover: i.stovl?.hover ? { gs: i.surface.vHor, vz: i.stovl.vz } : null,
              stovl: i.stovl?.on
                ? i.stovl.hover
                  ? "HOVER"
                  : i.stovl.conv < 1
                    ? `CONVERT ${Math.round(i.stovl.conv * 100)}`
                    : `STOVL ${Math.round(i.stovl.swivel * 95)}°`
                : null,
            }
          : undefined,
      },
      stroke,
      text,
    );

  // ---- the Auto-GCAS (A2): its chevrons closing on the centre as the ground nears, met when it flies up; the
  // Auto-ACAS's escape said
  if (i.gcas && pilotView && (i.gcas.near || i.gcas.flyUp || i.gcas.escape)) {
    const cx = W / 2,
      cy = H / 2;
    const col = i.gcas.flyUp || i.gcas.escape ? "#ff5a46" : "#ffc85a";
    const gap = (i.gcas.flyUp ? 18 : 60) * dpr;
    if (i.gcas.flyUp || i.gcas.near)
      for (const sx of [-1, 1])
        stroke(
          () => {
            const x0 = cx + sx * gap;
            ctx.moveTo(x0 + sx * 40 * dpr, cy - 22 * dpr);
            ctx.lineTo(x0, cy);
            ctx.lineTo(x0 + sx * 40 * dpr, cy + 22 * dpr);
          },
          col,
          3,
        );
    const label = i.gcas.flyUp ? "AUTO GCAS — FLY UP" : i.gcas.escape ? `AUTO ACAS — ${i.gcas.escape}` : "";
    if (label) text(label, cx, cy - 46 * dpr, col, 15, "center", true);
  }

  // ---- an ILS approach (P4): its needles about the view's centre — the glideslope's on the right, the localizer's
  // below —, the runway, the distance, the mode
  if (i.ils && pilotView && on(F, "heading")) drawIls(F, i.ils, text);

  // ---- the HUD's kind (game/hudkind.ts): the Space HUD's orbit block, the Approach HUD's radar altitude, its
  // deviations, its gear and flaps (the Atmosphere's: the fighter's, above)
  if (F.kind === "space" && pilotView && !F.compact && i.status && !i.status.kerr && i.region !== "hole")
    drawSpaceHud({ ctx, W, H, dpr }, { body: i.status.soiName, orbit: i.status.orbit, next: i.status.next, target: i.status.target }, text);
  if (F.kind === "approach" && pilotView && i.surface && !(helmet && jet)) {
    const mls = F.runway?.mls;
    drawApproachHud(
      { ctx, W, H, dpr, units: s.units === "imperial" ? "aviation" : "metric" },
      {
        radar: i.surface.alt,
        vs: i.surface.vVert,
        gear: i.gear ?? null,
        el: mls?.elIn ? mls.el : null,
        az: mls?.azIn ? mls.az : null,
        landed: !!i.surface.landed,
      },
      text,
      blinkOn(),
    );
  }

  // ---- the orbital markers the view lacked: radial, normal
  // (not for the F-35: an orbit's directions mean nothing to it — its flight path marker is the air's)
  if (s.hudMarkers && on(F, "markers") && !i.avionics) {
    const r = 11 * dpr;
    // (the target: the lock's ring, name, distance and edge arrow already — targethud.ts)
    for (const k of ["radialOut", "radialIn", "normal", "antinormal"] as const) {
      const p = pr(i.dirs[k]);
      if (!inside(p)) continue;
      ctx.lineWidth = 4.5 * dpr;
      marker(ctx, glyph(k), p![0], p![1], r, UNDER);
      ctx.lineWidth = 2 * dpr;
      marker(ctx, glyph(k), p![0], p![1], r, COL[k]!);
    }
  }

  // ---- what leaves the screen: an arrow at its edge, its glyph beside it
  if (s.hudEdge && on(F, "edge") && !i.avionics) {
    const m = 46 * dpr;
    // (the retrograde too when the prograde is off the screen as well — turned side-on, as before a
    // deorbit burn: the way to either end of the flight path)
    const proOn = inside(pr(i.dirs.prograde), m * 0.4);
    for (const k of ["prograde", "retrograde", "maneuver", "burn", "dock"] as const) {
      if (k === "maneuver" && i.dirs.burn) continue;
      if (k === "retrograde" && proOn) continue;
      const d = i.dirs[k];
      if (!d) continue;
      const p = pr(d);
      if (inside(p, m * 0.4)) continue;
      // (its direction on the screen: from the centre towards it — behind the eye, the other way round)
      let dx = d[0],
        dy = -d[1];
      if (d[2] <= 1e-3 && Math.hypot(dx, dy) < 1e-6) dx = 1;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const [x, y] = edgeAt(W, H, dpr, dx, dy);
      const col = COL[k] ?? "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x + dx * 16 * dpr, y + dy * 16 * dpr);
      ctx.lineTo(x - dy * 8 * dpr, y + dx * 8 * dpr);
      ctx.lineTo(x + dy * 8 * dpr, y - dx * 8 * dpr);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = UNDER;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      ctx.fill();
      ctx.lineWidth = 3.5 * dpr;
      marker(ctx, glyph(k), x - dx * 18 * dpr, y - dy * 18 * dpr, 7 * dpr, UNDER);
      ctx.lineWidth = 1.6 * dpr;
      marker(ctx, glyph(k), x - dx * 18 * dpr, y - dy * 18 * dpr, 7 * dpr, col);
    }
  }
}

const glyph = (k: string) =>
  ({
    radialOut: "radialOut",
    radialIn: "radialIn",
    normal: "normal",
    antinormal: "antinormal",
    target: "target",
    maneuver: "burn",
    burn: "burn",
    dock: "dock",
    prograde: "prograde",
    retrograde: "retrograde",
  })[k] ?? "prograde";

type Proj = (d: V3 | null | undefined) => [number, number] | null;
type Stroke = (draw: () => void, col: string, lw: number, dash?: number[]) => void;
type Text = (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void;

/** The speed's rate, eased (the energy chevron): the last sample. */
const energy = { t: 0, v: NaN, a: 0 };

/**
 * In the air, about the flight path vector (where the craft goes through the air):
 * - the angle of attack drawn where it is — the nose stands above the flight path by α, so the cues lie
 *   along that arc, in the craft's plane of symmetry: a green bracket on the best lift-to-drag incidence
 *   (±1.5°), an amber tick at 85 % of the stall, a red bar at the stall; the nose symbol between them
 *   reads the margin at a glance, α in figures beside it;
 * - the energy chevron: the speed's rate as the flight path it would hold — above the wings: the craft
 *   gains speed, below: it loses it (γ = atan(dV/dt / g));
 * - the sideslip: a ball under the flight path, off centre by β;
 * - the load in g, coloured against the craft's limit; STALL flashing;
 * - the flight director: where the flight computer wants the flight path (its climb angle, its heading).
 */
function drawAir(F: SymFrame, A: NonNullable<SymInfo["air"]>, pr: Proj, stroke: Stroke, text: Text, up: V3 | null, fpx: number) {
  const { ctx, dpr, s, i } = F;
  const S = i.S;
  const u = A.u!;
  const v = norm([
    S[0]![0]! * u[0]! + S[0]![1]! * u[1]! + S[0]![2]! * u[2]!,
    S[1]![0]! * u[0]! + S[1]![1]! * u[1]! + S[1]![2]! * u[2]!,
    S[2]![0]! * u[0]! + S[2]![1]! * u[1]! + S[2]![2]! * u[2]!,
  ]);
  const fp = pr(v);
  if (!fp) return;
  const r = 11 * dpr;
  // the craft's up and left about the flight path (the plane of symmetry: α measured in it)
  const Y: V3 = [S[0]![1]!, S[1]![1]!, S[2]![1]!],
    X: V3 = [S[0]![0]!, S[1]![0]!, S[2]![0]!];
  let p = comb(Y, 1, v, -dot(Y, v));
  if (Math.hypot(...p) < 1e-6) return;
  p = norm(p);
  const l = norm(comb(comb(X, 1, v, -dot(X, v)), 1, p, -dot(X, p)));
  const along = (a: number, side = 0): V3 => comb(comb(v, Math.cos(a), p, Math.sin(a)), 1, l, side);
  const alpha = A.alpha ?? 0;
  const stall = A.stallA ?? null;
  const best = A.bestA ?? null;

  // ---- the angle of attack
  if (s.hudAoA && stall && on(F, "airData")) {
    const w = (16 * dpr) / fpx;
    const seg = (a: number, w0: number, w1: number) => [pr(along(a, w0 * w)), pr(along(a, w1 * w))] as const;
    // the best lift-to-drag band: a bracket on the left
    if (best) {
      const lo = best - 1.5 * (Math.PI / 180),
        hi = best + 1.5 * (Math.PI / 180);
      const pts = [pr(along(hi, 1.2 * w)), pr(along(hi, 2 * w)), pr(along(lo, 2 * w)), pr(along(lo, 1.2 * w))];
      if (pts.every(Boolean))
        stroke(() => pts.forEach((q, j) => (j ? ctx.lineTo(q![0], q![1]) : ctx.moveTo(q![0], q![1]))), "rgba(120, 255, 170, 0.9)", 1.6);
    }
    // 85 % of the stall (amber), the stall (red)
    for (const [a, col, w0, w1] of [
      [stall * 0.85, "rgba(255, 200, 90, 0.9)", -1.4, 1.4],
      [stall, "rgba(255, 90, 70, 0.95)", -2.4, 2.4],
    ] as const) {
      const [a0, a1] = seg(a, w0, w1);
      if (a0 && a1)
        stroke(
          () => {
            ctx.moveTo(a0[0], a0[1]);
            ctx.lineTo(a1[0], a1[1]);
          },
          col,
          a === stall ? 2.2 : 1.4,
        );
    }
    // the incidence, in figures by the bracket
    const k = alpha / stall;
    const col =
      k >= 0.85
        ? k >= 1
          ? "#ff5a46"
          : "#ffc85a"
        : best && Math.abs(alpha - best) < 1.5 * (Math.PI / 180)
          ? "#78ffaa"
          : "rgba(214, 236, 255, 0.95)";
    const at = pr(along(Math.max(Math.min(alpha, stall * 1.2), -0.2), 2.6 * w));
    if (at) text(`α ${((alpha * 180) / Math.PI).toFixed(1)}°`, at[0], at[1], col, 12, "right", true);
  }

  // ---- the energy chevron: the speed's rate as a flight path angle
  if (s.hudEnergy && up && Number.isFinite(A.speed) && on(F, "airData")) {
    // (in the scene's time: a warp does not multiply the rate, a pause holds it)
    const now = F.simS ?? performance.now() / 1000;
    if (now < energy.t) energy.v = Number.NaN; // (time turned back: a fresh start)
    if (Number.isFinite(energy.v) && now > energy.t) {
      const dt = Math.min(now - energy.t, 0.5);
      const a = (A.speed! - energy.v) / Math.max(dt, 1e-3);
      if (dt > 0) energy.a += (a - energy.a) * Math.min(1, dt / 0.6);
    }
    energy.t = now;
    energy.v = A.speed!;
    let vu = comb(up, 1, v, -dot(up, v));
    if (Math.hypot(...vu) > 1e-6) {
      vu = norm(vu);
      const gam = Math.atan(energy.a / G0);
      const q = pr(comb(v, Math.cos(gam), vu, Math.sin(gam)));
      if (q) {
        const x = fp[0] - 2.3 * r,
          y = q[1];
        const col =
          Math.abs(energy.a) < 0.3 ? "rgba(214, 236, 255, 0.85)" : energy.a > 0 ? "rgba(120, 255, 170, 0.95)" : "rgba(255, 200, 90, 0.95)";
        stroke(
          () => {
            ctx.moveTo(x - 7 * dpr, y - 6 * dpr);
            ctx.lineTo(x, y);
            ctx.lineTo(x - 7 * dpr, y + 6 * dpr);
          },
          col,
          2,
        );
      }
    }
  }

  // ---- the sideslip: a ball under the flight path
  if (s.hudAoA && Number.isFinite(A.beta) && on(F, "airData")) {
    const y = fp[1] + 2.4 * r,
      half = 22 * dpr;
    const b = Math.max(-1, Math.min(1, (A.beta! * 180) / Math.PI / 8));
    stroke(
      () => {
        ctx.moveTo(fp[0] - half, y);
        ctx.lineTo(fp[0] + half, y);
        ctx.moveTo(fp[0] - 5 * dpr, y - 4 * dpr);
        ctx.lineTo(fp[0] - 5 * dpr, y + 4 * dpr);
        ctx.moveTo(fp[0] + 5 * dpr, y - 4 * dpr);
        ctx.lineTo(fp[0] + 5 * dpr, y + 4 * dpr);
      },
      "rgba(214, 236, 255, 0.55)",
      1.2,
    );
    ctx.beginPath();
    ctx.arc(fp[0] + b * half, y, 3.6 * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = Math.abs(b) > 0.5 ? "#ffc85a" : "rgba(214, 236, 255, 0.95)";
    ctx.fill();
  }

  // ---- the load, STALL
  if (s.hudEnergy && Number.isFinite(A.g) && on(F, "airData")) {
    const g = A.g!,
      k = g / (A.gMax || 9);
    if (Math.abs(g - 1) > 0.25 || k > 0.6)
      text(
        `${g.toFixed(1)} g`,
        fp[0] + 2.6 * r,
        fp[1] + 2.4 * r,
        k > 0.9 ? "#ff5a46" : k > 0.7 ? "#ffc85a" : "rgba(214, 236, 255, 0.9)",
        12,
        "left",
        true,
      );
  }
  const k = A.stallA ? alpha / A.stallA : 0;
  if (A.stalled || k > 0.92) {
    const on = A.stalled ? blinkOn() : true;
    if (on) text(A.stalled ? t("STALL") : "AOA", fp[0], fp[1] + 4 * r, A.stalled ? "#ff5a46" : "#ffc85a", 15);
  }

  // ---- the flight director: where the flight computer wants the flight path
  if (s.hudDirector && A.sf && A.sfU) {
    // Same air-relative frame as the FPV, using the effective command after all corrections.
    const u = A.sfU;
    const q = pr(norm(S.map((row) => dot(row as V3, u)) as V3));
    if (q) {
      const col = "rgba(224, 123, 255, 0.95)";
      stroke(
        () => {
          ctx.arc(q[0], q[1], 7 * dpr, 0, 2 * Math.PI);
          ctx.moveTo(q[0] - 12 * dpr, q[1]);
          ctx.lineTo(q[0] - 7 * dpr, q[1]);
          ctx.moveTo(q[0] + 7 * dpr, q[1]);
          ctx.lineTo(q[0] + 12 * dpr, q[1]);
        },
        col,
        1.6,
      );
      // (a dotted line to it from the flight path: the way to steer)
      if (Math.hypot(q[0] - fp[0], q[1] - fp[1]) > 3 * r)
        stroke(
          () => {
            ctx.moveTo(fp[0], fp[1]);
            ctx.lineTo(q[0], q[1]);
          },
          "rgba(224, 123, 255, 0.45)",
          1,
          [2, 4],
        );
    }
  }
}

/** A time ahead, short: 42 s, 3 min 20 s, 1 h 05 min. */
function ahead(t: number): string {
  if (!Number.isFinite(t)) return "—";
  if (t < 90) return `${Math.round(t)} s`;
  if (t < 3600) return `${Math.floor(t / 60)} min ${String(Math.round(t % 60)).padStart(2, "0")} s`;
  return `${Math.floor(t / 3600)} h ${String(Math.round((t % 3600) / 60)).padStart(2, "0")} min`;
}

/**
 * The future in the view:
 * - the predicted path in perspective (cyan), broken where its body hides it; on Gargantua's side the
 *   lensed tube (⇧Y) draws it instead when it is on;
 * - the ship's places to come — +10, +30, +60 s, a quarter of the orbit — as hollow rings, dated;
 * - where the path meets the ground (a red reticle on the spot as it turns now, its countdown) or the
 *   air's top (the entry, amber), or Gargantua's horizon; off screen, an arrow at the edge with the time.
 */
function drawFuture(
  F: SymFrame,
  fu: FutureView,
  pr: Proj,
  stroke: Stroke,
  text: Text,
  inside: (p: [number, number] | null, m?: number) => boolean,
) {
  const { ctx, W, H, dpr, s, i } = F;
  const tube = i.region === "hole" && s.pathInView;
  // (a wing carrying the craft: the free fall's path and its impact are not where it goes — the flight
  // path vector and the runway's cues are)
  const A = i.air;
  if (A && A.inAir && A.q > 1000 && A.mode === "plane") return;
  // ---- the path
  if (s.hudPath && !tube && fu.pts.length > 1 && on(F, "path")) {
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    for (const q of fu.pts) {
      const p = q.hid ? null : pr(q.d);
      if (!p || Math.abs(p[0] - W / 2) > W * 3 || Math.abs(p[1] - H / 2) > H * 3) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      run.push(p);
    }
    if (run.length > 1) runs.push(run);
    for (const r of runs)
      stroke(() => r.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))), "rgba(90, 220, 255, 0.7)", 1.8, [10, 6]);
  }
  // ---- the places to come
  if (s.hudFuture && on(F, "future")) {
    for (const m of fu.marks) {
      if (m.hid) continue;
      const p = pr(m.d);
      if (!inside(p, 8 * dpr)) continue;
      const big = m.t > 61;
      const quarter = F.quarter && Math.abs(m.t - F.quarter) < 1;
      stroke(
        () => {
          ctx.arc(p![0], p![1], 6.5 * dpr, 0, 2 * Math.PI);
          ctx.moveTo(p![0] - 11 * dpr, p![1]);
          ctx.lineTo(p![0] - 6.5 * dpr, p![1]);
          ctx.moveTo(p![0] + 6.5 * dpr, p![1]);
          ctx.lineTo(p![0] + 11 * dpr, p![1]);
        },
        big ? "rgba(214, 236, 255, 0.85)" : "rgba(90, 220, 255, 0.95)",
        1.5,
      );
      // (beside it, to the right: the marks of a path seen end-on stack up, their labels still read)
      text(
        quarter ? t("¼ ORBIT") : `+${ahead(m.t)}`,
        p![0] + 15 * dpr,
        p![1],
        big ? "rgba(214, 236, 255, 0.9)" : "rgba(90, 220, 255, 0.95)",
        10.5,
        "left",
        true,
      );
    }
  }
  // ---- the impact, the entry
  // (on the ground — landed, rolling — there is no impact to come: the prediction starts from it)
  if (s.hudImpact && fu.impact && !i.surface?.landed && on(F, "impact")) {
    const marks = [fu.impact, ...(fu.impact.ground ? [fu.impact.ground] : [])];
    for (const m of marks) {
      const ground = m.kind === "ground",
        air = m.kind === "air";
      const col = ground ? "#ff5a46" : air ? "#ffc85a" : "#ff8a5c";
      const label = ground
        ? tf("IMPACT {0}", ahead(m.t))
        : air
          ? tf("ENTRY {0}", ahead(m.t))
          : m.kind === "horizon"
            ? tf("HORIZON {0}", ahead(m.t))
            : tf("THE STAR {0}", ahead(m.t));
      const p = m.hid ? null : pr(m.d);
      if (inside(p, 20 * dpr)) {
        const R = 13 * dpr;
        stroke(
          () => {
            ctx.arc(p![0], p![1], R, 0, 2 * Math.PI);
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              ctx.moveTo(p![0] + dx * R * 0.45, p![1] + dy * R * 0.45);
              ctx.lineTo(p![0] + dx * R * 1.5, p![1] + dy * R * 1.5);
            }
          },
          col,
          1.8,
          air ? [4, 3] : undefined,
        );
        text(label, p![0], p![1] + R * 2.1, col, 12, "center", true);
      } else if (ground || m.kind === "horizon") {
        // (out of the view: an arrow at its edge, the countdown by it)
        const d = m.d;
        let dx = d[0],
          dy = -d[1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const [x, y] = edgeAt(W, H, dpr, dx, dy);
        ctx.beginPath();
        ctx.moveTo(x + dx * 16 * dpr, y + dy * 16 * dpr);
        ctx.lineTo(x - dy * 8 * dpr, y + dx * 8 * dpr);
        ctx.lineTo(x + dy * 8 * dpr, y - dx * 8 * dpr);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        text(label, x - dx * 30 * dpr, y - dy * 30 * dpr, col, 11.5, "center", true);
      }
    }
  }
}

/**
 * Where an arrow at the screen's edge goes for a screen direction (dx, dy, unit, y down): on the border
 * of the free frame (hud/safe.ts) — clear of the mission bar above and of the hub and its ball below.
 */
function edgeAt(W: number, H: number, dpr: number, dx: number, dy: number): [number, number] {
  const f = safeFrame();
  const top = f.top * dpr,
    bottom = Math.max(H * 0.55, H - f.bottom * dpr),
    side = f.side * dpr;
  const cy = (top + bottom) / 2,
    hy = (bottom - top) / 2,
    hx = W / 2 - side;
  const k = Math.min(hx / Math.max(Math.abs(dx), 1e-6), hy / Math.max(Math.abs(dy), 1e-6));
  return [W / 2 + dx * k, cy + dy * k];
}

/**
 * The runway in reach, drawn where it is: its outline on the ground, its centreline drawn 15 km back
 * (dashed, every kilometre), the aim point 2 km short of the threshold — the glide path's: the flight path
 * vector on the diamond is the craft on its glide path —; a box with the runway, the distance to its
 * threshold, the offset across the axis; on the final the glide path asked against the one flown;
 * FLARE low over it.
 */
/**
 * The runway's guidance on the HUD (game/mls.ts — the Shuttle's microwave landing system, PLAN-AEROPORTS A4):
 * an ILS's two scales — the elevation's right of the view's centre, the azimuth's under it —, two dots a
 * side (the elevation 1° a dot, the azimuth 1.5°), their diamonds magenta (guidance) where the path lies: high,
 * the diamond below; right of the axis, it to the left. Out of a station's coverage, its scale grey and no
 * diamond. The distance to the touchdown point under the azimuth's.
 */
/** The ILS's needles (game/ils.ts): two scales of two dots each way, their diamonds magenta (hollow: not received);
 *  its runway, its distance and its phase under the localizer's. */
function drawIls(F: SymFrame, L: NonNullable<SymInfo["ils"]>, text: Text) {
  const { ctx, dpr, W, H } = F;
  const s = Math.min(W, H);
  const cx = W / 2,
    cy = H / 2;
  const dot = 0.045 * s;
  const col = "rgba(120, 255, 170, 0.9)";
  ctx.save();
  ctx.lineWidth = 1.5 * dpr;
  ctx.strokeStyle = col;
  const ex = cx + 0.3 * s,
    ly = cy + 0.3 * s;
  for (let j = -2; j <= 2; j++) {
    if (!j) continue;
    ctx.beginPath();
    ctx.arc(ex, cy + j * dot, 3.2 * dpr, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + j * dot, ly, 3.2 * dpr, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(ex - 10 * dpr, cy);
  ctx.lineTo(ex + 10 * dpr, cy);
  ctx.moveTo(cx, ly - 10 * dpr);
  ctx.lineTo(cx, ly + 10 * dpr);
  ctx.stroke();
  const diamond = (x: number, y: number, filled: boolean) => {
    const r = 7 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.strokeStyle = "#ff6ee6";
    ctx.fillStyle = "#ff6ee6";
    if (filled) ctx.fill();
    else ctx.stroke();
  };
  // (the glideslope above us: its diamond up — fly up; the course right: its diamond right)
  diamond(ex, cy - (L.gs ?? 0) * dot, L.gs !== null);
  diamond(cx + (L.loc ?? 0) * dot, ly, L.loc !== null);
  const phase: Record<string, string> = {
    toIaf: "IAF",
    hold: "HOLD",
    intercept: "LOC",
    final: "LOC GS",
    flare: "FLARE",
    rollout: "ROLL",
    missed: "GA",
  };
  const U = unitsFor(F.s);
  text(
    `${L.id}  ${U.dist(L.dme * 1000).toFixed(1)} ${U.distName}  ${L.auto ? "AP " : ""}${phase[L.phase] ?? ""}`,
    cx,
    ly + 24 * dpr,
    col,
    12,
    "center",
    true,
  );
  ctx.restore();
}

function drawMls(F: SymFrame, rw: RunwayView, text: Text) {
  const { ctx, dpr, W, H } = F;
  const m = rw.mls;
  if (!m.azIn) return;
  const s = Math.min(W, H);
  const cx = W / 2,
    cy = H / 2;
  const dot = 0.05 * s;
  const scale = (x: number, y: number, vertical: boolean, on: boolean) => {
    ctx.strokeStyle = on ? "rgba(214, 236, 255, 0.85)" : "rgba(160, 175, 195, 0.45)";
    ctx.lineWidth = 1.5 * dpr;
    for (let j = -2; j <= 2; j++) {
      if (!j) continue;
      ctx.beginPath();
      ctx.arc(vertical ? x : x + j * dot, vertical ? y + j * dot : y, 3.2 * dpr, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x - 9 * dpr, y);
      ctx.lineTo(x + 9 * dpr, y);
    } else {
      ctx.moveTo(x, y - 9 * dpr);
      ctx.lineTo(x, y + 9 * dpr);
    }
    ctx.stroke();
  };
  const diamond = (x: number, y: number) => {
    const r = 7 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = "#ff6ee6";
    ctx.fill();
  };
  ctx.save();
  const ex = cx + 0.33 * s;
  const elOn = m.elIn && m.el !== null;
  scale(ex, cy, true, elOn);
  if (elOn) diamond(ex, cy + Math.max(-2.4, Math.min(2.4, m.el!)) * dot);
  text("EL", ex, cy - 2.7 * dot, elOn ? "rgba(214, 236, 255, 0.9)" : "rgba(160, 175, 195, 0.6)", 10.5, "center", true);
  // (under the flight path marker, clear of the attitude ball's ring below)
  const ay = cy + 0.17 * s;
  scale(cx, ay, false, true);
  diamond(cx - Math.max(-2.4, Math.min(2.4, m.az / 1.5)) * dot, ay);
  text(`${m.dmeKm.toFixed(1)} km · AZ`, cx - 2.7 * dot, ay, "rgba(214, 236, 255, 0.9)", 10.5, "right", true);
  ctx.restore();
}

function drawRunway(
  F: SymFrame,
  rw: RunwayView,
  pr: Proj,
  stroke: Stroke,
  text: Text,
  inside: (p: [number, number] | null, m?: number) => boolean,
) {
  const { ctx, dpr, W, H } = F;
  const front = (q: { d: V3 }) => q.d[2] > 1e-3;
  // the outline (its far end first: the near one may be behind the eye on the ground)
  if (rw.corners.every(front)) {
    const pts = rw.corners.map((q) => pr(q.d)!);
    ctx.beginPath();
    pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 220, 160, 0.12)";
    ctx.fill();
    stroke(
      () => {
        pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
      },
      "rgba(255, 220, 160, 0.95)",
      1.8,
    );
    // (the threshold: a bar across)
    stroke(
      () => {
        ctx.moveTo(pts[0]![0], pts[0]![1]);
        ctx.lineTo(pts[3]![0], pts[3]![1]);
      },
      "#ffffff",
      3,
    );
  }
  // the centreline drawn back from the threshold, its kilometres ticked
  const line = rw.line.filter(front).map((q) => pr(q.d)!);
  if (line.length > 1)
    stroke(() => line.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))), "rgba(124, 214, 255, 0.75)", 1.4, [8, 6]);
  // the path in the sky: the gates down the profile, the nearest brightest (guidance: magenta)
  rw.gates.forEach((g, k) => {
    if (!g.every(front)) return;
    const pts = g.map((q) => pr(q.d)!);
    stroke(
      () => {
        pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
      },
      `rgba(255, 110, 230, ${(0.95 - k * 0.15).toFixed(2)})`,
      k ? 1.4 : 2,
    );
  });
  // the approach chart's fixes ahead (game/procedures.ts — A5): a waypoint's star, its name and height
  for (const f of rw.fixes) {
    if (!front(f)) continue;
    const p = pr(f.d);
    if (!inside(p, 8 * dpr)) continue;
    const R = 6 * dpr;
    stroke(
      () => {
        ctx.moveTo(p![0], p![1] - R);
        ctx.lineTo(p![0] + R * 0.35, p![1] - R * 0.35);
        ctx.lineTo(p![0] + R, p![1]);
        ctx.lineTo(p![0] + R * 0.35, p![1] + R * 0.35);
        ctx.lineTo(p![0], p![1] + R);
        ctx.lineTo(p![0] - R * 0.35, p![1] + R * 0.35);
        ctx.lineTo(p![0] - R, p![1]);
        ctx.lineTo(p![0] - R * 0.35, p![1] - R * 0.35);
        ctx.closePath();
      },
      "#9fe8ff",
      1.5,
    );
    const name = f.id === "PU" ? t("PULL-UP") : f.id === "TD" ? t("TOUCHDOWN") : f.id;
    const hh = f.h >= 1000 ? `${(f.h / 1000).toFixed(1)} km` : `${f.h} m`;
    text(`${name} ${hh}`, p![0] + R + 5 * dpr, p![1], "#9fe8ff", 10, "left", true);
  }
  // the aim point
  const a = front(rw.aim) ? pr(rw.aim.d) : null;
  if (inside(a, 6 * dpr)) {
    const R = 8 * dpr;
    stroke(
      () => {
        ctx.moveTo(a![0], a![1] - R);
        ctx.lineTo(a![0] + R, a![1]);
        ctx.lineTo(a![0], a![1] + R);
        ctx.lineTo(a![0] - R, a![1]);
        ctx.closePath();
      },
      "#78ffaa",
      1.8,
    );
    text(t("AIM"), a![0] + R + 6 * dpr, a![1], "#78ffaa", 10.5, "left", true);
  }
  // the box: the runway, the distance to its threshold, the offset across the axis, the glide path
  const dist = Math.max(-rw.along, 0);
  const km = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  const off =
    Math.abs(rw.across) < 15
      ? t("ON AXIS")
      : `${rw.across > 0 ? "R" : "L"} ${Math.abs(rw.across) >= 1000 ? `${(Math.abs(rw.across) / 1000).toFixed(1)} km` : `${Math.round(Math.abs(rw.across))} m`}`;
  if (F.compact) {
    if (rw.final && rw.agl < 60 && rw.agl > 1 && blinkOn()) text(t("FLARE"), W / 2, H / 2 - 70 * dpr, "#ffc85a", 16);
    return;
  }
  // (left of the view's centre — the vertical landing's scope stands on the right —, clear of the panels:
  // moved up, else down, out from under any — hud/layout.ts)
  // (the surface wind on it — W4: where from, how strong, along and across the runway landed)
  const wind = rw.wind && rw.wind.u10 >= 0.5 ? rw.wind : null;
  const boxH = (rw.gRef !== null && rw.gam !== null ? 70 : 54) + (rw.papi !== null ? 16 : 0) + (wind ? 30 : 0);
  const want: Box = { x: (W / 2 - Math.min(W, H) * 0.44) / dpr - 96, y: (H / 2 - 10 * dpr) / dpr - 28, w: 192, h: boxH, id: "runway" };
  // (the jet HUD's tapes — drawn on this canvas, not panels: jethud.ts's geometry — kept clear too, the card
  // moved left of them first)
  const jt: Box[] = F.i.jet
    ? (() => {
        const off = Math.min(W * 0.3, Math.max(190 * dpr, Math.min(W, H) * 0.36));
        const half = Math.min(H * 0.22, 150 * dpr);
        return ([-1, 1] as const).map((sd) => ({
          x: (W / 2 + sd * off) / dpr - 90,
          y: (H / 2 - half) / dpr - 14,
          w: 180,
          h: (2 * half) / dpr + 28,
          id: `jet${sd}`,
        }));
      })()
    : [];
  const at =
    fit(want, "left", { reach: 320, others: jt }) ??
    fit(want, "up", { reach: 260, others: jt }) ??
    fit(want, "down", { reach: 260, others: jt }) ??
    want;
  drawn.push(at);
  const x = (at.x + 96) * dpr,
    y = (at.y + 28) * dpr;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.fillRect(x - 96 * dpr, y - 28 * dpr, 192 * dpr, boxH * dpr);
  text(
    `RWY ${String(Math.round(rw.rwy / 10) % 36 || 36).padStart(2, "0")} · ${rw.name.toUpperCase()}`,
    x,
    y - 14 * dpr,
    "rgba(255, 220, 160, 0.95)",
    11,
  );
  text(km, x, y + 4 * dpr, "#ffffff", 13, "center", true);
  text(
    off,
    x,
    y + 20 * dpr,
    Math.abs(rw.across) > 300 ? "#ffc85a" : Math.abs(rw.across) < 15 ? "#78ffaa" : "rgba(214, 236, 255, 0.95)",
    11.5,
    "center",
    true,
  );
  if (rw.gRef !== null && rw.gam !== null) {
    const e = ((rw.gam - rw.gRef) * 180) / Math.PI;
    text(
      // (the flight path's angle against the one commanded — not the profile's position: the hub's PROFILE —)
      tf("PATH {0} {1}°", e >= 0 ? "▲" : "▼", Math.abs(e).toFixed(1)),
      x,
      y + 35 * dpr,
      Math.abs(e) > 2 ? "#ffc85a" : "#78ffaa",
      11.5,
      "center",
      true,
    );
  }
  // the PAPI: four lights under the box — white above the path, red below (two and two: on it)
  if (rw.papi !== null) {
    const r = 5 * dpr,
      gap = 16 * dpr,
      py = y + (rw.gRef !== null && rw.gam !== null ? 54 : 38) * dpr;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(x + (k - 1.5) * gap, py, r, 0, 2 * Math.PI);
      ctx.fillStyle = k < rw.papi ? "#f4f8ff" : "#ff3c32";
      ctx.fill();
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.stroke();
    }
    text("PAPI", x + 2.6 * gap, py, "rgba(214, 236, 255, 0.8)", 10.5, "left", true);
  }
  if (wind) {
    const wy = y + ((rw.gRef !== null && rw.gam !== null ? 70 : 54) + (rw.papi !== null ? 16 : 0) - 16) * dpr;
    // (the gusts as a range — "6–9": the HUD's G reads as a 6)
    const gust = wind.gust > 0.5 ? `–${Math.round(wind.u10 + wind.gust)}` : "";
    text(
      tf("WIND {0}°/{1}{2} m/s", String(Math.round(wind.from) % 360 || 360).padStart(3, "0"), Math.round(wind.u10), gust),
      x,
      wy,
      "rgba(214, 236, 255, 0.95)",
      11,
      "center",
      true,
    );
    // (a tail wind amber; across, amber past 15 kt, red past 25 — the arrow the way it pushes)
    const along = wind.head >= 0 ? tf("HEAD {0}", Math.round(wind.head)) : tf("TAIL {0}", Math.round(-wind.head));
    const ac = Math.abs(wind.cross);
    const across = ac >= 0.5 ? ` · ${tf("CROSS {0}", `${wind.cross > 0 ? "←" : "→"}${Math.round(ac)}`)}` : "";
    text(
      `${along}${across}`,
      x,
      wy + 15 * dpr,
      wind.head < -0.5 || ac > 12.9 ? (ac > 12.9 ? "#ff5a46" : "#ffc85a") : ac > 7.7 ? "#ffc85a" : "#78ffaa",
      11,
      "center",
      true,
    );
  }
  drawMls(F, rw, text);
  // the flare: counted down over its last fifteen seconds, then called
  if (rw.final && rw.flareIn !== null && rw.flareIn > 0 && rw.flareIn <= 15 && rw.agl >= 60)
    text(tf("FLARE IN {0}", `${Math.ceil(rw.flareIn)} s`), W / 2, H / 2 - 70 * dpr, "#7cd6ff", 14);
  else if (rw.final && rw.agl < 60 && rw.agl > 1) {
    const on = blinkOn();
    if (on) text(t("FLARE"), W / 2, H / 2 - 70 * dpr, "#ffc85a", 16);
  }
}

/**
 * The vertical landing (low over the ground, slow — the Lander's, a hover):
 * - the drift scope beside the view (heading up): the velocity over the ground, its scale chosen for it;
 *   the vertical speed's bar, the height over the ground;
 * - the stop burn: at full thrust, how long until it must start to stop at the ground (BURN IN …, BURN
 *   NOW), from the descent rate, the thrust over weight and the local gravity;
 * - the touchdown spot in the view: where the craft comes down at this drift and descent rate.
 */
/** The landing point designator's mark: a cross in a circle on the ground where the powered landing goes, its distance,
 *  « LPD » — amber once the pilot moved it. */
function drawLpd(
  F: SymFrame,
  L: NonNullable<SymInfo["lpd"]>,
  pr: Proj,
  stroke: Stroke,
  text: Text,
  inside: (p: [number, number] | null, m?: number) => boolean,
) {
  const { ctx, dpr } = F;
  const p = pr(L.dir as V3);
  if (!p || !inside(p, 30 * dpr)) return;
  const col = L.moved ? "#ffc85a" : "#7cf0c0";
  const r = 13 * dpr;
  stroke(
    () => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
      ctx.moveTo(p[0] - r * 1.6, p[1]);
      ctx.lineTo(p[0] - r * 0.5, p[1]);
      ctx.moveTo(p[0] + r * 0.5, p[1]);
      ctx.lineTo(p[0] + r * 1.6, p[1]);
      ctx.moveTo(p[0], p[1] - r * 1.6);
      ctx.lineTo(p[0], p[1] - r * 0.5);
      ctx.moveTo(p[0], p[1] + r * 0.5);
      ctx.lineTo(p[0], p[1] + r * 1.6);
    },
    col,
    1.6,
  );
  const d = L.dist >= 1000 ? `${(L.dist / 1000).toFixed(1)} km` : `${Math.round(L.dist)} m`;
  text(`LPD ${d}`, p[0] + r * 1.9, p[1] - r * 0.4, col, 11, "left", true);
}

function drawHover(
  F: SymFrame,
  sf: NonNullable<SymInfo["surface"]>,
  up: V3 | null,
  pr: Proj,
  stroke: Stroke,
  text: Text,
  inside: (p: [number, number] | null, m?: number) => boolean,
) {
  const { ctx, dpr, W, H, i } = F;
  const A = i.air;
  // (a hover, a vertical descent: low and slow — not the glide to a runway)
  if (!(sf.alt < 3000) || (A && A.speed && A.speed > 160 && A.q > 20)) return;
  const drift = i.dirs.drift ?? null;
  const vDown = Math.max(-sf.vVert, 0);
  // ---- the scope (right of the view's centre, clear of the panels: moved up, else left — hud/layout.ts;
  // its box: the height above, the drift and the stop cue below, the vertical speed's bar and figure right)
  const want: Box = {
    x: (W / 2 + Math.min(W, H) * 0.44) / dpr - 58,
    y: (H / 2 + 20 * dpr) / dpr - 78,
    w: 58 + 52 + 22 + 64,
    h: 78 + 96,
    id: "scope",
  };
  const at = fit(want, "up", { reach: 300 }) ?? fit(want, "left", { reach: 300 }) ?? want;
  drawn.push(at);
  const R0 = 52 * dpr,
    cx = (at.x + 58) * dpr,
    cy = (at.y + 78) * dpr;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, R0 + 6 * dpr, 0, 2 * Math.PI);
  ctx.fill();
  stroke(
    () => {
      ctx.arc(cx, cy, R0, 0, 2 * Math.PI);
      ctx.moveTo(cx + R0 / 2, cy);
      ctx.arc(cx, cy, R0 / 2, 0, 2 * Math.PI);
      ctx.moveTo(cx - R0, cy);
      ctx.lineTo(cx + R0, cy);
      ctx.moveTo(cx, cy - R0);
      ctx.lineTo(cx, cy + R0);
    },
    "rgba(124, 214, 255, 0.45)",
    1,
  );
  const scales = [2, 5, 10, 20, 50, 100, 200];
  const full = scales.find((k) => k >= sf.vHor * 1.25) ?? 200;
  if (drift && up && sf.vHor > 0.05) {
    // (heading up: the view's horizontal forward, its right)
    let f = comb([0, 0, 1], 1, up, -up[2]);
    if (Math.hypot(...f) < 0.05) f = comb([0, 1, 0], 1, up, -up[1]);
    f = norm(f);
    const r = norm(crossW(up, f));
    const k = Math.min(sf.vHor / full, 1.15) * R0;
    const dx = dot(drift, r) * k * -1,
      dy = -dot(drift, f) * k;
    const tx = cx + dx,
      ty = cy + dy;
    const col = sf.vHor > 3 ? "#ffc85a" : "#78ffaa";
    stroke(
      () => {
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
      },
      col,
      2.2,
    );
    ctx.beginPath();
    ctx.arc(tx, ty, 4 * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = col;
    ctx.fill();
  }
  text(
    tf("DRIFT {0} m/s", sf.vHor.toFixed(sf.vHor < 10 ? 1 : 0)),
    cx,
    cy + R0 + 18 * dpr,
    sf.vHor > 3 ? "#ffc85a" : "rgba(214, 236, 255, 0.9)",
    11,
    "center",
    true,
  );
  text(`${full} m/s`, cx + R0 - 2 * dpr, cy - R0 + 2 * dpr, "rgba(124, 214, 255, 0.6)", 9, "right", true);
  text(
    `AGL ${sf.alt >= 1000 ? `${(sf.alt / 1000).toFixed(2)} km` : `${Math.round(sf.alt)} m`}`,
    cx,
    cy - R0 - 16 * dpr,
    "#ffffff",
    12,
    "center",
    true,
  );
  // ---- the vertical speed's bar (±20 m/s), right of the scope
  const bx = cx + R0 + 22 * dpr,
    bh = R0 * 2;
  stroke(
    () => {
      ctx.moveTo(bx, cy - bh / 2);
      ctx.lineTo(bx, cy + bh / 2);
      ctx.moveTo(bx - 4 * dpr, cy);
      ctx.lineTo(bx + 4 * dpr, cy);
    },
    "rgba(124, 214, 255, 0.5)",
    1.2,
  );
  const vv = Math.max(-1, Math.min(1, sf.vVert / 20));
  const vcol = vDown > Math.max(2, sf.alt / 10) ? "#ff5a46" : vDown > 2 ? "#ffc85a" : "#78ffaa";
  ctx.fillStyle = vcol;
  ctx.fillRect(bx - 3 * dpr, Math.min(cy, cy - vv * (bh / 2)), 6 * dpr, Math.abs(vv) * (bh / 2));
  text(`${sf.vVert >= 0 ? "▲" : "▼"} ${Math.abs(sf.vVert).toFixed(1)}`, bx + 8 * dpr, cy - vv * (bh / 2), vcol, 10.5, "left", true);
  // ---- the stop burn: the full-thrust deceleration against gravity, the distance it needs
  const g = sf.gLocal * G0;
  const net = (sf.twr - 1) * g;
  let cue = "",
    ccol = "rgba(214, 236, 255, 0.9)";
  if (vDown > 1) {
    if (net <= 0.05) (cue = t("TWR < 1 · NO STOP")), (ccol = "#ff5a46");
    else {
      const stop = (vDown * vDown) / (2 * net);
      const tIn = (sf.alt - stop * 1.1) / vDown;
      if (tIn <= 0) {
        if (blinkOn()) (cue = t("BURN NOW")), (ccol = "#ff5a46");
        else cue = " ";
      } else if (tIn < 60)
        (cue = tf("BURN IN {0} s", tIn.toFixed(tIn < 10 ? 1 : 0))), (ccol = tIn < 5 ? "#ffc85a" : "rgba(214, 236, 255, 0.9)");
      else cue = tf("STOP {0} m", Math.round(stop));
    }
  }
  if (cue) text(cue, cx, cy + R0 + 36 * dpr, ccol, 13, "center", true);
  // ---- the touchdown spot in the view: down the height, along the drift for as long as the fall lasts
  if (up && vDown > 0.3) {
    const tg = sf.alt / vDown;
    const v = comb(up, -sf.alt, drift ?? [0, 0, 0], sf.vHor * tg);
    const p = pr(norm(v));
    if (inside(p, 12 * dpr)) {
      const R = 11 * dpr;
      stroke(
        () => {
          ctx.arc(p![0], p![1], R, 0, 2 * Math.PI);
          ctx.moveTo(p![0] - R * 1.6, p![1]);
          ctx.lineTo(p![0] + R * 1.6, p![1]);
          ctx.moveTo(p![0], p![1] - R * 1.6);
          ctx.lineTo(p![0], p![1] + R * 1.6);
        },
        "#78ffaa",
        1.6,
      );
      text(`TD ${Math.round(tg)} s`, p![0], p![1] + R * 2.3, "#78ffaa", 11, "center", true);
    }
  }
}

/** the scene's acceleration unit [m/s²] (c² per M) and its time unit [s] (M / c) */
const A_UNIT = (C_MPS * C_MPS) / M_METRES;
const T_UNIT = M_SECONDS;

/**
 * The next burn: a box with its number, its countdown, its Δv and how long the engine needs for it; the
 * aim — the nose against the burn's direction —: a ring about the manoeuvre marker, green within 2°,
 * amber within 10°, red beyond, and the angle in figures. While it burns: BURNING.
 */
function drawBurn(
  F: SymFrame,
  pr: Proj,
  stroke: Stroke,
  text: Text,
  inside: (p: [number, number] | null, m?: number) => boolean,
  nose: V3,
) {
  const { ctx, dpr, W, H, i } = F;
  const P = i.plan!;
  const k = P.nodes.findIndex((n) => n.t >= P.now - 1e-9);
  if (k < 0) return;
  const n = P.nodes[k]!;
  const dv = Math.hypot(...n.dv) * C_MPS;
  const tIn = (n.t - P.now) * T_UNIT;
  const a = (i.engine?.max ?? 0) * A_UNIT;
  const len = a > 0 ? dv / a : Infinity;
  // the aim
  const dir = i.dirs.burn ?? i.dirs.maneuver ?? null;
  let err = NaN;
  if (dir) {
    err = (Math.acos(Math.max(-1, Math.min(1, dot(nose, dir)))) * 180) / Math.PI;
    const p = pr(dir);
    if (inside(p, 10 * dpr)) {
      const col = err < 2 ? "#78ffaa" : err < 10 ? "#ffc85a" : "#ff5a46";
      stroke(() => ctx.arc(p![0], p![1], 20 * dpr, 0, 2 * Math.PI), col, 1.6, err < 2 ? undefined : [5, 4]);
    }
  }
  if (F.compact) return;
  // the box (left of centre, under the runway's place)
  const x = W / 2 - Math.min(W, H) * 0.44,
    y = H / 2 + 74 * dpr;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.fillRect(x - 96 * dpr, y - 26 * dpr, 192 * dpr, 70 * dpr);
  const burning = !!P.burning;
  text(
    burning ? tf("BURNING ◆{0}", k + 1) : tf("BURN ◆{0} IN {1}", k + 1, ahead(Math.max(tIn, 0))),
    x,
    y - 12 * dpr,
    burning ? "#ffc85a" : "#7cd6ff",
    11.5,
    "center",
    true,
  );
  text(
    `Δv ${dv >= 1000 ? `${(dv / 1000).toFixed(2)} km/s` : `${dv.toFixed(1)} m/s`} · ${Number.isFinite(len) ? ahead(len) : t("no thrust")}`,
    x,
    y + 6 * dpr,
    "#ffffff",
    12,
    "center",
    true,
  );
  if (Number.isFinite(err))
    text(tf("AIM {0}°", err.toFixed(1)), x, y + 23 * dpr, err < 2 ? "#78ffaa" : err < 10 ? "#ffc85a" : "#ff5a46", 11.5, "center", true);
  // (the burn's start soon and the craft not turned: said)
  if (!burning && tIn < 30 && tIn > 0 && Number.isFinite(err) && err > 10 && blinkOn())
    text(t("TURN TO THE BURN"), W / 2, H / 2 + 60 * dpr, "#ffc85a", 13);
}

/**
 * The docking's guide: gates along the target port's axis — 5, 10, 20, 50, 100 m out —, the corridor to
 * fly through, as the eye sees them; a scope looking down the axis: the offset across it (the dot), its
 * drift over 10 s (the arrow), the scale chosen for it; the range, the closing rate (green slow, amber
 * fast, red too fast that near), the ports' angle.
 */
function drawDock(F: SymFrame, pr: Proj, stroke: Stroke, text: Text, inside: (p: [number, number] | null, m?: number) => boolean) {
  const { ctx, dpr, W, H, i } = F;
  const D = i.dock!,
    G = i.dockGuide!;
  const fpx = H / (2 * Math.tan((F.fov * Math.PI) / 180 / 2));
  // the gates
  if (D.range < 400)
    for (const g of G.gates) {
      // (the gates still ahead: those between the craft and the port)
      if (g.k >= D.range - 2) continue;
      const p = g.d[2] > 1e-3 ? pr(g.d) : null;
      if (!inside(p, -40 * dpr)) continue;
      const rad = Math.max(((0.8 + g.k * 0.08) / g.r) * fpx, 6 * dpr);
      stroke(() => ctx.arc(p![0], p![1], rad, 0, 2 * Math.PI), `rgba(95, 255, 208, ${g.k <= 20 ? 0.8 : 0.45})`, 1.3, [6, 4]);
      text(`${g.k} m`, p![0] + rad + 4 * dpr, p![1], "rgba(95, 255, 208, 0.75)", 9.5, "left", true);
    }
  if (D.range > 2000 || F.compact) return;
  // the scope, down the axis: its x and y the view's right and up across the axis
  const ax = norm(G.axis);
  let ex = comb([1, 0, 0], 1, ax, -ax[0]),
    ey = comb([0, 1, 0], 1, ax, -ax[1]);
  if (Math.hypot(...ex) < 0.1 || Math.hypot(...ey) < 0.1) return;
  ex = norm(ex);
  ey = norm(ey);
  const ox = dot(G.lat, ex),
    oy = dot(G.lat, ey);
  const rx = dot(G.latRate, ex) * 10,
    ry = dot(G.latRate, ey) * 10;
  const R0 = 52 * dpr,
    cx = W / 2 + Math.min(W, H) * 0.44,
    cy = H / 2 + 20 * dpr;
  const scales = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const full = scales.find((k) => k >= Math.max(Math.hypot(ox, oy), Math.hypot(ox + rx, oy + ry)) * 1.2) ?? 200;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, R0 + 6 * dpr, 0, 2 * Math.PI);
  ctx.fill();
  stroke(
    () => {
      ctx.arc(cx, cy, R0, 0, 2 * Math.PI);
      ctx.moveTo(cx + R0 / 2, cy);
      ctx.arc(cx, cy, R0 / 2, 0, 2 * Math.PI);
      ctx.moveTo(cx - R0, cy);
      ctx.lineTo(cx + R0, cy);
      ctx.moveTo(cx, cy - R0);
      ctx.lineTo(cx, cy + R0);
    },
    "rgba(95, 255, 208, 0.45)",
    1,
  );
  const k = R0 / full;
  const px = cx + Math.max(-1.15, Math.min(1.15, ox / full)) * R0,
    py = cy - Math.max(-1.15, Math.min(1.15, oy / full)) * R0;
  const on = Math.hypot(ox, oy) < Math.max(0.15, D.range * 0.02);
  stroke(
    () => {
      ctx.moveTo(px, py);
      ctx.lineTo(px + rx * k, py - ry * k);
    },
    "#ffc85a",
    1.8,
  );
  ctx.beginPath();
  ctx.arc(px, py, 5 * dpr, 0, 2 * Math.PI);
  ctx.fillStyle = on ? "#78ffaa" : "#5fffd0";
  ctx.fill();
  text(`${full} m`, cx + R0 - 2 * dpr, cy - R0 + 2 * dpr, "rgba(95, 255, 208, 0.6)", 9, "right", true);
  text(`${D.title.toUpperCase()} · ${D.name}`, cx, cy - R0 - 30 * dpr, "rgba(95, 255, 208, 0.95)", 10.5);
  text(
    tf("RANGE {0}", D.range >= 1000 ? `${(D.range / 1000).toFixed(2)} km` : `${D.range.toFixed(D.range < 10 ? 2 : 1)} m`),
    cx,
    cy - R0 - 14 * dpr,
    "#ffffff",
    12,
    "center",
    true,
  );
  const fast = D.closing > Math.max(0.3, D.range / 60);
  const ccol = D.closing < 0 ? "#ffc85a" : fast ? (D.range < 20 ? "#ff5a46" : "#ffc85a") : "#78ffaa";
  text(
    `${D.closing >= 0 ? t("CLOSING") : t("OPENING")} ${Math.abs(D.closing).toFixed(2)} m/s`,
    cx,
    cy + R0 + 18 * dpr,
    ccol,
    11.5,
    "center",
    true,
  );
  text(
    `LAT ${Math.hypot(ox, oy).toFixed(2)} m · ${Math.abs(D.lateralRate).toFixed(2)} m/s · ∠ ${D.angle.toFixed(1)}°`,
    cx,
    cy + R0 + 34 * dpr,
    on ? "#78ffaa" : "rgba(214, 236, 255, 0.9)",
    10.5,
    "center",
    true,
  );
}

/**
 * Near Gargantua, what its spacetime does to the flight (a box at the view's left, above the others):
 * - the clock: dτ/dt — the ship's seconds per far-away second —, a bar;
 * - the motion: the speed against the local observer and γ; the sky ahead's Doppler factor (√((1+β)/(1−β)):
 *   its light blue-shifted by it);
 * - the orbit: E per unit mass — bound below 1, the margin to escape —;
 * - the radius against the horizon, the photon orbit and the ISCO (inside one of them: said, red);
 * - the tide: the stretch along the radius per metre of the craft (2c² / (r³ M²)), in g;
 * and the radial-in marker named: the way to the hole.
 */
function drawRelativity(F: SymFrame, pr: Proj, text: Text, inside: (p: [number, number] | null, m?: number) => boolean) {
  const { ctx, dpr, W, H, i, s } = F;
  const r = i.r!,
    E = i.E ?? NaN,
    beta = i.speed ?? 0,
    g = i.gamma ?? 1,
    dt = i.dtau ?? NaN;
  const Mm = 1476.625 * s.massSolar;
  const tide = (2 * C_MPS * C_MPS) / (r * r * r * Mm * Mm) / G0;
  const x = W / 2 - Math.min(W, H) * 0.44,
    y = H / 2 - 150 * dpr;
  // the lines first: the box as wide as the widest (a fixed 192 px let the radii's line run 90 px out)
  const dop = beta < 1 ? Math.sqrt((1 + beta) / (1 - beta)) : Infinity;
  const crit =
    i.rH !== undefined && r < i.rH * 1.0001
      ? t("INSIDE THE HORIZON")
      : i.photon !== undefined && r < i.photon
        ? t("INSIDE THE PHOTON ORBIT")
        : i.isco !== undefined && r < i.isco
          ? t("BELOW THE ISCO")
          : i.ergo
            ? t("IN THE ERGOSPHERE")
            : "";
  const bound = E < 1;
  const lines: { t: string; col: string; size: number; dy: number }[] = [
    {
      t: `${beta.toFixed(3)} c · γ ${g.toFixed(3)} · ${tf("sky ahead ×{0}", dop.toFixed(2))}`,
      col: "rgba(214, 236, 255, 0.95)",
      size: 10.5,
      dy: 20,
    },
    ...(Number.isFinite(E)
      ? [
          {
            t: bound
              ? tf("E {0} · BOUND · {1} % to escape", E.toFixed(4), ((1 - E) * 100).toFixed(2))
              : tf("E {0} · ESCAPING", E.toFixed(4)),
            col: bound ? "#78ffaa" : "#ffc85a",
            size: 10.5,
            dy: 36,
          },
        ]
      : []),
    {
      t: `r ${r.toFixed(2)} M · ISCO ${(i.isco ?? NaN).toFixed(2)} · γ-orbit ${(i.photon ?? NaN).toFixed(2)} · H ${(i.rH ?? NaN).toFixed(2)}`,
      col: crit ? "#ff5a46" : "rgba(214, 236, 255, 0.9)",
      size: 10,
      dy: 52,
    },
    {
      t: crit || tf("tide {0} g/m", tide < 1e-3 ? tide.toExponential(1) : tide.toFixed(3)),
      col: crit ? "#ff5a46" : "rgba(214, 236, 255, 0.75)",
      size: 10,
      dy: 68,
    },
  ];
  let wide = 192 * dpr;
  for (const l of lines) {
    ctx.font = `600 ${l.size * dpr}px ${MONO}`;
    wide = Math.max(wide, ctx.measureText(l.t).width + 20 * dpr);
  }
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.fillRect(x - 96 * dpr, y - 26 * dpr, wide, 112 * dpr);
  text(t("RELATIVITY"), x - 96 * dpr + wide / 2, y - 13 * dpr, "rgba(255, 211, 107, 0.95)", 10.5);
  // the clock
  if (Number.isFinite(dt)) {
    text(`dτ/dt ${dt.toFixed(4)}`, x - 86 * dpr, y + 4 * dpr, "#ffffff", 11.5, "left", true);
    ctx.fillStyle = "rgba(124, 214, 255, 0.25)";
    ctx.fillRect(x + 26 * dpr, y, 60 * dpr, 6 * dpr);
    ctx.fillStyle = dt < 0.5 ? "#ff5a46" : dt < 0.9 ? "#ffc85a" : "#7cd6ff";
    ctx.fillRect(x + 26 * dpr, y, 60 * dpr * Math.max(0, Math.min(1, dt)), 6 * dpr);
  }
  // the motion, the orbit, the radius against the critical ones, the tide
  for (const l of lines) text(l.t, x - 86 * dpr, y + l.dy * dpr, l.col, l.size, "left", true);
  // the way to the hole
  const p = pr(i.dirs.radialIn);
  if (inside(p, 20 * dpr)) text("GARGANTUA", p![0], p![1] + 22 * dpr, "rgba(95, 211, 255, 0.9)", 10.5);
}

/** A challenge (controller/challenge.ts): its next gates in perspective — the next one yellow, the two after
 *  it fainter —, an arrow at the edge towards the next when it is out of view, its banner (the clock, the gate,
 *  the penalties) and, at its end, its result. */
function drawChallenge(
  F: SymFrame,
  pr: (d: V3 | null | undefined) => [number, number] | null,
  stroke: (draw: () => void, col: string, lw: number, dash?: number[]) => void,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
) {
  const { ctx, W, H, dpr, i } = F;
  const C = i.chal!;
  const COLS = ["255, 210, 63", "111, 210, 255", "111, 210, 255"];
  const ALPHA = [1, 0.75, 0.4];
  for (const g of [...C.gates].reverse()) {
    const P = g.c.map((d) => pr(d));
    const col = `rgba(${COLS[g.k]}, ${ALPHA[g.k]})`;
    if (P.every((p) => p)) {
      stroke(
        () => {
          ctx.moveTo(P[0]![0], P[0]![1]);
          for (const p of [P[1]!, P[2]!, P[3]!, P[0]!]) ctx.lineTo(p[0], p[1]);
        },
        col,
        g.k === 0 ? 3 : 2,
      );
      const top: [number, number] = [(P[2]![0] + P[3]![0]) / 2, (P[2]![1] + P[3]![1]) / 2];
      text(
        g.k === 0 ? `${g.n} · ${(g.dist / 1000).toFixed(1)} km` : String(g.n),
        top[0],
        top[1] - 12 * dpr,
        col,
        g.k === 0 ? 14 : 11,
        "center",
        true,
      );
    } else if (g.k === 0) {
      // (out of view: an arrow at the edge, towards it)
      const v = g.c.filter((d): d is V3 => !!d).reduce((a, d) => [a[0] + d[0], a[1] + d[1], a[2] + d[2]] as V3, [0, 0, 0] as V3);
      const a = Math.atan2(-v[1], v[0]);
      const r = Math.min(W, H) * 0.36;
      const x = W / 2 + Math.cos(a) * r,
        y = H / 2 + Math.sin(a) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(18 * dpr, 0);
      ctx.lineTo(-8 * dpr, -11 * dpr);
      ctx.lineTo(-8 * dpr, 11 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      text(`${g.n}`, x, y + 22 * dpr, col, 13, "center", true);
    }
  }
  // the radar: the course's next gates, the pad
  // (the radar's scope: drawn with the F-35's radar — the course's gates on it)
  if (F.s.f35Radar && C.radar && !F.i.radar) drawRadar(F, null, C.radar.contacts, text, stroke);
  // the banner
  const y = F.top + (F.compact ? 64 : 150) * dpr;
  const mm = Math.floor(C.time / 60),
    ss = (C.time % 60).toFixed(1).padStart(4, "0");
  const parts = [C.title.toUpperCase(), `${mm}:${ss}`];
  if (C.kind === "gates") parts.push(`${Math.min(C.next + 1, C.count)}/${C.count}`);
  if (C.missed) parts.push(`+${C.missed * 10} s`);
  if (C.over > 0.05) parts.push(`▲ ${C.over.toFixed(1)} s`);
  if (C.figures)
    parts.push(
      C.figures.list
        .map((f, k) =>
          k < C.figures!.idx ? `${f.toUpperCase()} ${C.figures!.marks[k]}` : k === C.figures!.idx ? `[${f.toUpperCase()}]` : f,
        )
        .join(" · "),
    );
  text(parts.join("   "), W / 2, y, "rgba(255, 210, 63, 1)", 14, "center", true);
  if (C.result) {
    const medal = C.result.medal;
    const col = medal === "gold" ? "#ffd23f" : medal === "silver" ? "#d8e2ea" : medal === "bronze" ? "#d08a4a" : "#ff6a5a";
    text(C.result.text, W / 2, H * 0.32, col, 22, "center", true);
  }
}

/** An aerobatic figure (controller/aerobatics.ts): its banner (its name, its clock, the box's count), its cue, its
 *  entry's window while armed, the guide — the load its program would pull, the roll's way —, its marks. */
function drawAero(
  F: SymFrame,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
) {
  const { W, H, dpr, i } = F;
  const A = i.aero!;
  const GOLD = "rgba(255, 210, 63, 1)";
  const y = F.top + (F.compact ? 64 : 150) * dpr;
  const parts = [A.title.toUpperCase(), `${A.t.toFixed(1)} s`];
  if (A.mode === "demo") parts.push("DEMO");
  if (A.seq) parts.push(`${A.seq.idx + 1}/${A.seq.n} · ${A.seq.total.toFixed(1)}`);
  text(parts.join("   "), W / 2, y, GOLD, 14, "center", true);
  if (A.status !== "done") text(A.cue, W / 2, y + 20 * dpr, "rgba(160, 255, 200, 0.95)", 13, "center", true);
  if (A.entry) {
    const okV = Math.abs(A.entry.vNow - A.entry.v) <= A.entry.vTol;
    const lawOk = A.entry.law === A.entry.lawNow;
    const txt = `ENTRY ${A.entry.v}±${A.entry.vTol} M/S · NOW ${Math.round(A.entry.vNow)} · LEVEL, WINGS LEVEL${lawOk ? "" : ` · ${A.entry.law.toUpperCase()} LAW`}`;
    text(txt, W / 2, y + 40 * dpr, okV && lawOk ? "rgba(160, 255, 200, 0.95)" : "rgba(255, 200, 90, 1)", 13, "center", true);
  }
  if (A.guide && A.guide.load !== null) {
    // (the guide, under the flight path: the load to pull — green when held within half a g —, the roll's way)
    const near = Math.abs(A.guide.nNow - A.guide.load) < 0.5;
    const g = A.guide.load >= 0 ? `PULL ${A.guide.load.toFixed(1)} G` : `PUSH ${A.guide.load.toFixed(1)} G`;
    const roll = A.guide.roll > 0 ? "   ROLL ▶" : A.guide.roll < 0 ? "◀ ROLL   " : "";
    const label = A.guide.roll < 0 ? `${roll}${g}` : `${g}${roll}`;
    text(label, W / 2, H * 0.72, near ? "rgba(160, 255, 200, 0.95)" : "rgba(255, 200, 90, 1)", 15, "center", true);
  }
  if (A.result) {
    text(
      `${A.title.toUpperCase()}  ${A.result.score.toFixed(1)}/20`,
      W / 2,
      H * 0.32,
      A.result.score >= 18 ? "#ffd23f" : A.result.score >= 14 ? "#d8e2ea" : "#ff9a6a",
      22,
      "center",
      true,
    );
    A.result.notes
      .slice(0, 3)
      .forEach((n, k) => text(n, W / 2, H * 0.32 + (26 + 18 * k) * dpr, "rgba(230, 240, 245, 0.9)", 13, "center", false));
  } else if (A.status === "done") text(`${A.title.toUpperCase()} — LAPSED`, W / 2, H * 0.32, "#ff6a5a", 22, "center", true);
}

/** A missile's motor on the screen at `p`, `depth` metres ahead: a glow, white-hot, a little orange, larger near. */
export function paintMotor(ctx: CanvasRenderingContext2D, p: [number, number], depth: number, fpx: number, dpr: number) {
  const r = Math.max(Math.min((6 * fpx) / Math.max(depth, 1), 40 * dpr), 2.5 * dpr);
  const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
  g.addColorStop(0, "rgba(255, 255, 240, 1)");
  g.addColorStop(0.35, "rgba(255, 190, 90, 0.8)");
  g.addColorStop(1, "rgba(255, 120, 40, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
  ctx.fill();
}

/**
 * An explosion on the screen at `p`, `depth` metres ahead (fpx: the pixels per unit of tangent): a flash, a fireball
 * swelling and cooling to smoke — its real size at its distance (the HUD's, the replay's — ui/replay.ts).
 */
export function paintBoom(
  ctx: CanvasRenderingContext2D,
  p: [number, number],
  depth: number,
  fpx: number,
  size: number,
  age: number,
  W: number,
  H: number,
  dpr: number,
) {
  const R = size * 14 * (0.5 + 1.6 * Math.min(age / 1.2, 1) + 0.3 * age);
  const r = Math.max((R * fpx) / depth, 2 * dpr);
  const heat = Math.max(0, 1 - age / 1.8);
  const fade = Math.max(0, 1 - age / 8);
  const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
  g.addColorStop(0, `rgba(255, ${Math.round(200 + 55 * heat)}, ${Math.round(150 * heat)}, ${0.95 * heat + 0.25 * fade})`);
  g.addColorStop(
    0.45,
    `rgba(${Math.round(255 * heat + 70 * (1 - heat))}, ${Math.round(110 * heat + 66 * (1 - heat))}, ${Math.round(30 * heat + 60 * (1 - heat))}, ${0.8 * heat + 0.45 * fade})`,
  );
  g.addColorStop(1, "rgba(60, 56, 52, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
  ctx.fill();
  if (age < 0.15) {
    ctx.fillStyle = `rgba(255, 250, 230, ${0.5 * (1 - age / 0.15)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/** A fight (controller/combat.ts): the explosions, the smoke-less motors' glow, the gun's tracers, the targets
 *  (the radar's in green, the lock a diamond with its range and closure), the gun's pipper on the lead, the
 *  launch zone's scale and its SHOOT cue, the bomb's fall point, the missile warning and its bearings, the
 *  stores, the damage, the end. */
function drawCombat(
  F: SymFrame,
  pr: (d: V3 | null | undefined) => [number, number] | null,
  stroke: (draw: () => void, col: string, lw: number, dash?: number[]) => void,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
) {
  const { ctx, W, H, dpr, i } = F;
  const K = i.combat!;
  const tanH = Math.tan((F.fov * D) / 2);
  const fpx = H / (2 * tanH);
  const GRN = "rgba(90, 255, 140, 0.95)",
    RED = "rgba(255, 70, 60, 1)",
    AMB = "rgba(255, 190, 60, 1)";
  const blink = Math.floor(performance.now() / 250) % 2 === 0;
  // the explosions: a flash, a fireball swelling and cooling to smoke (their real size at their distance)
  for (const b of K.booms) {
    const p = pr(b.d);
    if (p && b.d[2] > 0) paintBoom(ctx, p, b.d[2], fpx, b.size, b.age, W, H, dpr);
  }
  // the missiles' motors: a glow (white-hot, a little orange), larger near
  for (const m of K.missiles) {
    const p = pr(m.d);
    if (p && m.motor) paintMotor(ctx, p, m.d[2], fpx, dpr);
  }
  // the gun's tracers: each fifth round a streak, the others a spark
  ctx.fillStyle = "rgba(255, 220, 120, 0.95)";
  for (const d of K.rounds) {
    const p = pr(d);
    if (p) ctx.fillRect(p[0] - 1 * dpr, p[1] - 1 * dpr, 2 * dpr, 2 * dpr);
  }
  for (const [h, tl] of K.tracers ?? []) {
    const a = pr(h),
      b = pr(tl);
    if (a && b)
      stroke(
        () => {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        },
        "rgba(255, 200, 90, 0.95)",
        2.2,
      );
  }
  // the gun's funnel (the trigger held, or the target within 1.5 km): the stream of the rounds fired along the
  // gun's line, its edges a wingspan apart — the target fitting between them is at their range
  const F2 = K.funnel ?? [];
  if (F2.length > 2 && K.gunReady && (K.firing || (K.gun && K.gun.range < 1500))) {
    for (const side of ["l", "r"] as const) {
      const pts = F2.filter((f) => f.range > 150 && f.range < 1600)
        .map((f) => pr(f[side]))
        .filter((x): x is [number, number] => !!x);
      if (pts.length > 1)
        stroke(
          () => {
            ctx.moveTo(pts[0]![0], pts[0]![1]);
            for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
          },
          GRN,
          1.4,
        );
    }
  }
  // the hit marker: four ticks round the centre — a hit; thick and red — a kill
  if (K.hitMark) {
    const kill = K.hitMark === "kill";
    const c = [W / 2, H / 2],
      a = 9 * dpr,
      b = (kill ? 22 : 17) * dpr;
    stroke(
      () => {
        for (const [sx, sy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          ctx.moveTo(c[0]! + sx! * a, c[1]! + sy! * a);
          ctx.lineTo(c[0]! + sx! * b, c[1]! + sy! * b);
        }
      },
      kill ? RED : "rgba(255, 255, 255, 0.95)",
      kill ? 3.2 : 2,
    );
  }
  // the targets
  for (const q of K.targets) {
    const p = pr(q.d);
    // (locked: amber — red when a shot is good, its box doubled)
    const col = !q.alive
      ? "rgba(160, 160, 160, 0.7)"
      : q.friendly
        ? "rgba(110, 200, 255, 0.95)"
        : q.locked
          ? K.shoot
            ? RED
            : AMB
          : q.seen
            ? GRN
            : "rgba(90, 255, 140, 0.45)";
    if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) {
      // (an aircraft far off: a few pixels of a dark hull against the sky — its spot, as the eye picks one out, a dot
      // and a half wide, fainter the farther, gone past 20 km)
      // (only while the hull itself is a few pixels: zoomed in on it, the craft is seen, not a dot over it)
      const span = q.kind === "drone" ? 3.5 : q.kind === "airliner" ? 34 : 10.7;
      if (q.alive && !q.ground && q.d && q.d[2] > 0 && q.dist < 20_000 && (0.5 * span * fpx) / q.d[2] < 2.5 * dpr) {
        const r = 1.6 * dpr;
        ctx.fillStyle = `rgba(28, 30, 36, ${Math.min(0.9, Math.max(0.3, 1.15 - q.dist / 16_000))})`;
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], r, 0.75 * r, 0, 0, 2 * Math.PI);
        ctx.fill();
      }
      const s = (q.locked ? 16 : 11) * dpr;
      if (q.ground) {
        stroke(
          () => {
            ctx.moveTo(p[0], p[1] - s);
            ctx.lineTo(p[0] + s, p[1]);
            ctx.lineTo(p[0], p[1] + s);
            ctx.lineTo(p[0] - s, p[1]);
            ctx.closePath();
          },
          col,
          q.locked ? 2.2 : 1.5,
        );
      } else stroke(() => ctx.rect(p[0] - s, p[1] - s, 2 * s, 2 * s), col, q.locked ? 2.2 : 1.5);
      if (q.locked) {
        stroke(() => ctx.arc(p[0], p[1], s * 1.6, 0, 2 * Math.PI), col, 1.5);
        text(
          `${q.name}  ${(q.dist / 1000).toFixed(1)} km  ${q.closing >= 0 ? "+" : ""}${Math.round(q.closing)} m/s`,
          p[0],
          p[1] + s + 18 * dpr,
          col,
          12,
          "center",
          true,
        );
      } else if (q.seen) text((q.dist / 1000).toFixed(1), p[0], p[1] + s + 12 * dpr, col, 10, "center", true);
      if (!q.alive) text("SPLASH", p[0], p[1] - s - 8 * dpr, col, 11, "center", true);
    } else if (q.locked && q.alive) {
      // (out of view: an arrow at the edge towards it)
      const a = Math.atan2(-q.d[1], q.d[2] > 0 ? q.d[0] : -q.d[0] || 1e-3);
      const r = Math.min(W, H) * 0.4;
      const x = W / 2 + Math.cos(a) * r,
        y = H / 2 + Math.sin(a) * r;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = AMB;
      ctx.beginPath();
      ctx.moveTo(18 * dpr, 0);
      ctx.lineTo(-8 * dpr, -10 * dpr);
      ctx.lineTo(-8 * dpr, 10 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      text(`${q.name} ${(q.dist / 1000).toFixed(1)}`, x, y + 22 * dpr, AMB, 12, "center", true);
    }
  }
  // the gun's pipper on the lead — red, GUNS, when it sits on the target within the gun's reach
  const L = K.lead ? pr(K.lead) : null;
  if (L && K.gunReady) {
    const pc = K.gunHot ? RED : K.firing ? AMB : GRN;
    stroke(() => ctx.arc(L[0], L[1], 26 * dpr, 0, 2 * Math.PI), pc, K.gunHot ? 2.4 : 1.6);
    if (K.gunHot) stroke(() => ctx.arc(L[0], L[1], 34 * dpr, 0, 2 * Math.PI), pc, 1.2);
    ctx.fillStyle = pc;
    ctx.beginPath();
    ctx.arc(L[0], L[1], 2.5 * dpr, 0, 2 * Math.PI);
    ctx.fill();
    if (K.gunHot && blink) text("GUNS", L[0], L[1] - 46 * dpr, RED, 16, "center", true);
    // (the range bar: an arc from 12 o'clock, clockwise, a whole turn 2 km; the reach's tick at 1.2 km)
    const G2 = K.gun;
    if (G2) {
      const R = 30 * dpr;
      const a0 = -Math.PI / 2;
      stroke(() => ctx.arc(L[0], L[1], R, a0, a0 + 2 * Math.PI * Math.min(G2.range / 2000, 1)), pc, 3);
      const ar = a0 + 2 * Math.PI * (1200 / 2000);
      stroke(
        () => {
          ctx.moveTo(L[0] + Math.cos(ar) * (R - 4 * dpr), L[1] + Math.sin(ar) * (R - 4 * dpr));
          ctx.lineTo(L[0] + Math.cos(ar) * (R + 6 * dpr), L[1] + Math.sin(ar) * (R + 6 * dpr));
        },
        pc,
        1.6,
      );
      const U = unitsFor(F.s);
      text(
        `${Math.round(U.sys === "metric" ? G2.range : U.alt(G2.range))} ${U.altName}${G2.inRange ? "  IN RANGE" : ""}`,
        L[0],
        L[1] + 48 * dpr,
        G2.inRange ? pc : AMB,
        12,
        "center",
        true,
      );
    }
  }
  // the missile's steering: the allowable steering error's circle about the nose, the dot the target's way —
  // red, SHOOT, when the shot is good
  const nose: V3 = [i.S[0]![2]!, i.S[1]![2]!, i.S[2]![2]!];
  const lk = K.targets.find((q) => q.locked && q.alive);
  const pn = pr(nose);
  if (lk && pn && K.weapon !== "jdam") {
    const R = 64 * dpr;
    const c = K.shoot ? RED : AMB;
    stroke(() => ctx.arc(pn[0], pn[1], R, 0, 2 * Math.PI), c, K.shoot ? 2.2 : 1.3, K.shoot ? undefined : [6, 5]);
    // (the dot: the target's angle off the nose — 60° at the circle's rim)
    const dl = Math.hypot(...lk.d) || 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, (lk.d[0] * nose[0] + lk.d[1] * nose[1] + lk.d[2] * nose[2]) / dl)));
    const pt = pr(lk.d);
    let dx = pt ? pt[0] - pn[0] : lk.d[0],
      dy = pt ? pt[1] - pn[1] : -lk.d[1];
    const l = Math.hypot(dx, dy) || 1;
    const rr = Math.min((ang / ((60 * Math.PI) / 180)) * R, R);
    dx = (dx / l) * rr;
    dy = (dy / l) * rr;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(pn[0] + dx, pn[1] + dy, 5 * dpr, 0, 2 * Math.PI);
    ctx.fill();
  }
  // the bomb's fall point: a cross on the ground
  const fp = K.fall ? pr(K.fall) : null;
  if (fp) {
    stroke(
      () => {
        ctx.moveTo(fp[0] - 14 * dpr, fp[1]);
        ctx.lineTo(fp[0] + 14 * dpr, fp[1]);
        ctx.moveTo(fp[0], fp[1] - 14 * dpr);
        ctx.lineTo(fp[0], fp[1] + 14 * dpr);
      },
      GRN,
      1.6,
    );
    text("CCIP", fp[0] + 18 * dpr, fp[1] - 10 * dpr, GRN, 10, "left", true);
  }
  // the launch zone: a scale on the right — its least and its reach, the range now —, SHOOT in range
  const Z = K.zone;
  if (Z) {
    const x = W - (F.compact ? 40 : 120) * dpr,
      y0 = H * 0.3,
      y1 = H * 0.62;
    const top = Math.max(Z.rMax * 1.3, Z.range * 1.05, 1);
    const y = (r: number) => y1 - (y1 - y0) * Math.min(r / top, 1);
    stroke(
      () => {
        ctx.moveTo(x, y(0));
        ctx.lineTo(x, y(top));
        ctx.moveTo(x - 8 * dpr, y(Z.rMax));
        ctx.lineTo(x + 8 * dpr, y(Z.rMax));
        ctx.moveTo(x - 8 * dpr, y(Z.rMin));
        ctx.lineTo(x + 8 * dpr, y(Z.rMin));
      },
      GRN,
      1.4,
    );
    ctx.fillStyle = Z.inRange ? AMB : GRN;
    ctx.beginPath();
    ctx.moveTo(x - 4 * dpr, y(Z.range));
    ctx.lineTo(x - 14 * dpr, y(Z.range) - 6 * dpr);
    ctx.lineTo(x - 14 * dpr, y(Z.range) + 6 * dpr);
    ctx.fill();
    text(`${(Z.range / 1000).toFixed(1)}`, x - 18 * dpr, y(Z.range), Z.inRange ? AMB : GRN, 11, "right", true);
    if (K.shoot) {
      if (blink) text("SHOOT", W / 2, H * 0.62, RED, 22, "center", true);
    } else if (Z.inRange) text("IN RANGE · TURN", W / 2, H * 0.62, AMB, 14, "center", true);
  }
  // the missile warning: its bearings on a ring, MISSILE flashing
  if (K.threats.length) {
    const cx = W - (F.compact ? 70 : 170) * dpr,
      cy = H * 0.78,
      R = 42 * dpr;
    stroke(() => ctx.arc(cx, cy, R, 0, 2 * Math.PI), RED, 1.4);
    for (const m of K.threats) {
      const a = Math.atan2(m.d[0], m.d[2]);
      const k = Math.max(0.3, 1 - m.dist / 15_000);
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(a) * R * (1 - 0.6 * k + 0.6), cy - Math.cos(a) * R * (1 - 0.6 * k + 0.6), 5 * dpr, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (blink) text("MISSILE", W / 2, H * 0.36, RED, 24, "center", true);
    const near = Math.min(...K.threats.map((m) => m.dist));
    text(`${(near / 1000).toFixed(1)} km`, cx, cy + R + 14 * dpr, RED, 12, "center", true);
  }
  // the stores, the weapon chosen; the damage; the clock
  // (under the heading tape's annunciators, centred: clear of the panels in the corners)
  const yb = F.top + (F.compact ? 96 : 196) * dpr;
  const xb = W / 2;
  const S = K.stores;
  const sel = (w: string, s: string) => (K.weapon === w ? `[${s}]` : s);
  if (!F.s.f35WeaponPanel || F.compact)
    text(
      `${sel("aim9x", `9X ${S.aim9x}`)}  ${sel("aim120", `120 ${S.aim120}`)}  ${sel("jdam", `JDAM ${S.jdam}`)}${S.jsm ? `  ${sel("jsm", `JSM ${S.jsm}`)}` : ""}  GUN ${S.gun}  CM ${S.flares}`,
      xb,
      yb,
      GRN,
      13,
      "center",
      true,
    );
  else drawWeapons(F, text);
  if (F.s.f35Radar && !i.radar) drawRadar(F, K.radar, null, text, stroke);
  const mm = Math.floor(K.t / 60),
    ss = String(Math.floor(K.t % 60)).padStart(2, "0");
  text(
    `${K.title.toUpperCase()}  ${mm}:${ss}  · ${K.targets.filter((q) => q.alive).length} ${K.targets.length > 1 ? "TGTS" : "TGT"}`,
    xb,
    yb - 20 * dpr,
    GRN,
    12,
    "center",
    true,
  );
  if (K.damage > 0) text(`DAMAGE ${Math.round(K.damage)} %`, xb, yb + 20 * dpr, K.damage > 60 ? RED : AMB, 13, "center", true);
  if (K.result) text(K.result, W / 2, H * 0.32, K.status === "won" ? "#ffd23f" : RED, 22, "center", true);
}

/**
 * The weapons' panel (a fight): each store carried — its count as marks, the gun's rounds as a bar —, the one
 * chosen arrowed and boxed, empty ones red; ∞ with the infinite ammunition; the countermeasures; ARM.
 */
function drawWeapons(
  F: SymFrame,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
) {
  const { ctx, W, H, dpr, i } = F;
  const K = i.combat!;
  const S = K.stores;
  const x0 = W - (F.compact ? 190 : 250) * dpr,
    y0 = H * 0.36;
  const w = 220 * dpr,
    rowH = 30 * dpr;
  const rows: { id: string; name: string; n: number; max: number; bar?: boolean }[] = [
    { id: "gun", name: "GUN 25MM", n: S.gun, max: 220, bar: true },
    { id: "aim9x", name: "AIM-9X", n: S.aim9x, max: 2 },
    { id: "aim120", name: "AIM-120C", n: S.aim120, max: 4 },
    { id: "jdam", name: "GBU-32", n: S.jdam, max: 2 },
    ...(S.jsm !== undefined && (S.jsm > 0 || K.weapon === "jsm") ? [{ id: "jsm", name: "JSM", n: S.jsm, max: 2 }] : []),
    { id: "cm", name: "CMDS", n: S.flares, max: 30, bar: true },
  ];
  ctx.fillStyle = "rgba(2, 12, 8, 0.62)";
  ctx.fillRect(x0 - 10 * dpr, y0 - 26 * dpr, w + 20 * dpr, rows.length * rowH + 36 * dpr);
  text(
    K.firing ? "ARM · FIRING" : "ARM",
    x0,
    y0 - 12 * dpr,
    K.firing ? "rgba(255, 70, 60, 1)" : "rgba(90, 255, 140, 0.95)",
    11,
    "left",
    true,
  );
  if (K.infinite) text("∞", x0 + w, y0 - 12 * dpr, "rgba(255, 210, 63, 1)", 15, "right", true);
  rows.forEach((r, k) => {
    const y = y0 + k * rowH + 10 * dpr;
    const on = K.weapon === r.id || (r.id === "gun" && K.firing);
    const empty = r.n <= 0 && !K.infinite;
    const col = empty ? "rgba(255, 70, 60, 0.95)" : on ? "rgba(255, 210, 63, 1)" : "rgba(90, 255, 140, 0.9)";
    if (K.weapon === r.id) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(x0 - 6 * dpr, y - 12 * dpr, w + 12 * dpr, 24 * dpr);
      text("▶", x0 - 16 * dpr, y, col, 12, "right", true);
    }
    text(r.name, x0, y, col, 12.5, "left", true);
    const nx = x0 + 104 * dpr;
    if (r.bar) {
      // (a bar: the rounds or the cartridges left)
      const bw = 80 * dpr,
        f = K.infinite ? 1 : Math.max(0, Math.min(1, r.n / r.max));
      ctx.strokeStyle = col;
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(nx, y - 5 * dpr, bw, 10 * dpr);
      ctx.fillStyle = col;
      ctx.fillRect(nx, y - 5 * dpr, bw * f, 10 * dpr);
      text(K.infinite ? "∞" : String(r.n), x0 + w, y, col, 12, "right", true);
    } else {
      // (marks: one a store, hollow when gone)
      for (let j = 0; j < r.max; j++) {
        ctx.beginPath();
        ctx.rect(nx + j * 16 * dpr, y - 6 * dpr, 10 * dpr, 12 * dpr);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2 * dpr;
        ctx.stroke();
        if (K.infinite || j < r.n) {
          ctx.fillStyle = col;
          ctx.fill();
        }
      }
      text(K.infinite ? "∞" : String(r.n), x0 + w, y, col, 12, "right", true);
    }
  });
}

/**
 * The radar's scope (a fight, a challenge): heading up, the craft at its centre; range rings, the scan's ±60°,
 * each contact by its kind — an aircraft a chevron pointing its way, its height's difference in hundreds of
 * metres; a ground target a square; a gate a bar across its way, the next one bright —, the missiles (red: at
 * the craft, cyan: its own) with their tracks, the lock ringed. Its range the setting's, or the one that holds
 * the lock and the nearest contacts.
 */
/** The radar scope's relief: a 48² image heading up over ±range [m] about us, the ground's height against ours (above
 *  red, within 300 m below amber, lower green brighter higher, the sea dark blue); kept and redrawn when we have moved a
 *  twentieth of the range, turned 3°, the range changed — twice a second at most. */
const RELIEF_N = 48;
let reliefImg: { canvas: HTMLCanvasElement; key: string; at: number } | null = null;
function radarRelief(R: NonNullable<SymInfo["relief"]>, range: number): HTMLCanvasElement {
  const D0 = Math.PI / 180;
  const RE = 6_371_008.8;
  const step = range / 10;
  const key = `${range}|${Math.round((R.lat * D0 * RE) / step)}|${Math.round((R.lon * D0 * RE * Math.cos(R.lat * D0)) / step)}|${Math.round(R.hdg / (3 * D0))}|${Math.round(R.alt / 100)}`;
  const now = performance.now();
  if (reliefImg && (reliefImg.key === key || now - reliefImg.at < 500)) return reliefImg.canvas;
  const canvas = reliefImg?.canvas ?? document.createElement("canvas");
  canvas.width = canvas.height = RELIEF_N;
  const g = canvas.getContext("2d")!;
  const im = g.createImageData(RELIEF_N, RELIEF_N);
  const c = Math.cos(R.hdg),
    sn = Math.sin(R.hdg);
  for (let j = 0; j < RELIEF_N; j++)
    for (let i = 0; i < RELIEF_N; i++) {
      // (the cell's centre: x right, y ahead [m] — turned to east and north by the heading)
      const x = ((i + 0.5) / RELIEF_N - 0.5) * 2 * range;
      const y = (0.5 - (j + 0.5) / RELIEF_N) * 2 * range;
      if (x * x + y * y > range * range * 1.05) continue;
      const e = x * c + y * sn,
        n = -x * sn + y * c;
      const h = R.at(R.lat + n / (D0 * RE), R.lon + e / (D0 * RE * Math.cos(R.lat * D0)));
      const d = h - R.alt;
      let r: number, gr: number, b: number;
      if (h <= 0.5) [r, gr, b] = [8, 26, 64];
      else if (d > 0) [r, gr, b] = [235, 60, 45];
      else if (d > -300) [r, gr, b] = [240, 170, 50];
      else {
        const k = Math.min(1, h / Math.max(R.alt, 1500));
        [r, gr, b] = [20 + 40 * k, 70 + 130 * k, 30 + 40 * k];
      }
      const o = (j * RELIEF_N + i) * 4;
      im.data[o] = r;
      im.data[o + 1] = gr;
      im.data[o + 2] = b;
      im.data[o + 3] = 255;
    }
  g.putImageData(im, 0, 0);
  reliefImg = { canvas, key, at: now };
  return canvas;
}

function drawRadar(
  F: SymFrame,
  R: RadarData | null,
  gates: { x: number; y: number; gate: number; next: boolean; trk: number | null }[] | null,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
  stroke: (draw: () => void, col: string, lw: number, dash?: number[]) => void,
  P?: RadarPicture,
) {
  const { ctx, H, dpr, s } = F;
  const rad = (F.compact ? 86 : 118) * dpr;
  // (bottom left, clear of the craft in the chase view; the key hints stand above it — .jet-hud)
  const cx = (F.compact ? 16 : 26) * dpr + rad,
    cy = H - (F.compact ? 24 : 34) * dpr - rad;
  const GR = "rgba(90, 255, 140, ";
  // (the range: the setting's, or the smallest step holding the lock, else the nearest few)
  const pts = [...(R?.contacts.filter((c) => c.alive) ?? []), ...(gates ?? [])];
  let range = s.f35RadarRange === "auto" ? 0 : Number(s.f35RadarRange) * 1000;
  if (!range) {
    const lockC = R?.contacts.find((c) => c.locked);
    const need = lockC
      ? Math.hypot(lockC.x, lockC.y)
      : Math.min(
          ...pts
            .map((c) => Math.hypot(c.x, c.y))
            .sort((a, b) => a - b)
            .slice(0, 3)
            .concat([Infinity]),
        ) || 10_000;
    const far = lockC
      ? need
      : Math.max(
          ...pts
            .map((c) => Math.hypot(c.x, c.y))
            .sort((a, b) => a - b)
            .slice(0, 3),
          1,
        );
    range = [10_000, 20_000, 40_000, 80_000, 160_000].find((r) => r > Math.max(need, far) * 1.1) ?? 160_000;
  }
  const k = rad / range;
  // the scope: its disc, its rings, its compass ticks, the scan's limits
  ctx.save();
  ctx.fillStyle = "rgba(2, 12, 8, 0.66)";
  ctx.beginPath();
  ctx.arc(cx, cy, rad + 6 * dpr, 0, 2 * Math.PI);
  ctx.fill();
  // (the relief under it, heading up — redrawn twice a second at most: radarRelief)
  const rel = s.f35RadarRelief !== false ? F.i.relief : null;
  if (rel) {
    const img = radarRelief(rel, range);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, 2 * Math.PI);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, cx - rad, cy - rad, 2 * rad, 2 * rad);
    ctx.restore();
  }
  for (const f of [1 / 3, 2 / 3, 1]) stroke(() => ctx.arc(cx, cy, rad * f, 0, 2 * Math.PI), `${GR}${f === 1 ? 0.6 : 0.3})`, 1);
  const scan = (60 * Math.PI) / 180;
  stroke(
    () => {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(scan) * rad, cy - Math.cos(scan) * rad);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - Math.sin(scan) * rad, cy - Math.cos(scan) * rad);
    },
    `${GR}0.25)`,
    1,
    [4, 4],
  );
  text(`${Math.round(range / 1000)} KM`, cx + rad, cy + rad + 2 * dpr, `${GR}0.9)`, 10.5, "right", true);
  text(P ? P.mode : "RDR", cx - rad, cy + rad + 2 * dpr, `${GR}0.9)`, 10.5, "left", true);
  // (the beam: where it sweeps now — on the lock in STT)
  if (P)
    stroke(
      () => {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(P.beam) * rad, cy - Math.cos(P.beam) * rad);
      },
      `${GR}${P.mode === "STT" ? 0.55 : 0.35})`,
      P.mode === "STT" ? 1.6 : 1,
    );
  // (clipped to the disc: a contact beyond the range on its rim)
  const at = (x: number, y: number): [number, number, boolean] => {
    const d = Math.hypot(x, y) * k;
    const out = d > rad;
    const f = out ? rad / d : 1;
    return [cx + x * k * f, cy - y * k * f, out];
  };
  // gates: a bar across the way they are flown, numbered
  for (const g of gates ?? []) {
    const [px, py] = at(g.x, g.y);
    const col = g.next ? "rgba(255, 210, 63, 1)" : "rgba(111, 210, 255, 0.8)";
    const a = g.trk ?? 0;
    stroke(
      () => {
        ctx.moveTo(px - Math.cos(a) * 7 * dpr, py - Math.sin(a) * 7 * dpr);
        ctx.lineTo(px + Math.cos(a) * 7 * dpr, py + Math.sin(a) * 7 * dpr);
      },
      col,
      g.next ? 3 : 2,
    );
    if (g.gate) text(String(g.gate), px + 9 * dpr, py - 8 * dpr, col, 10, "left", true);
  }
  // the targets
  for (const c of R?.contacts ?? []) {
    const [px, py, out] = at(c.x, c.y);
    const col = c.colour
      ? c.colour
      : !c.alive
        ? "rgba(160, 160, 160, 0.7)"
        : c.locked
          ? "rgba(255, 70, 60, 1)"
          : c.seen
            ? "rgba(255, 120, 90, 0.95)"
            : "rgba(255, 120, 90, 0.5)";
    ctx.fillStyle = col;
    // (a track from the datalink alone: drawn hollow — known, not the radar's own)
    if (c.datalink) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      ctx.arc(px, py, 5.5 * dpr, 0, 2 * Math.PI);
      ctx.stroke();
      if (c.trk !== null) {
        ctx.beginPath();
        ctx.moveTo(px + Math.sin(c.trk) * 5.5 * dpr, py - Math.cos(c.trk) * 5.5 * dpr);
        ctx.lineTo(px + Math.sin(c.trk) * 15 * dpr, py - Math.cos(c.trk) * 15 * dpr);
        ctx.stroke();
      }
      text(c.name, px, py - 13 * dpr, col, 9.5, "center", true);
      continue;
    }
    if (c.air) {
      // (a chevron along its track)
      const a = c.trk ?? 0;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -8 * dpr);
      ctx.lineTo(5.5 * dpr, 6 * dpr);
      ctx.lineTo(0, 2.5 * dpr);
      ctx.lineTo(-5.5 * dpr, 6 * dpr);
      ctx.closePath();
      ctx.fill();
      // (its speed vector: a tick ahead)
      if (c.trk !== null) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, -8 * dpr);
        ctx.lineTo(0, -18 * dpr);
        ctx.stroke();
      }
      ctx.restore();
      if (!out && c.alive) {
        const dz = Math.round(c.dz / 100);
        text(`${dz >= 0 ? "+" : ""}${dz}`, px + 9 * dpr, py + 8 * dpr, col, 9.5, "left", true);
      }
    } else ctx.fillRect(px - 4.5 * dpr, py - 4.5 * dpr, 9 * dpr, 9 * dpr);
    if (c.locked) stroke(() => ctx.arc(px, py, 11 * dpr, 0, 2 * Math.PI), col, 1.6);
    if (c.locked || c.colour) text(c.name, px, py - 16 * dpr, col, 10, "center", true);
  }
  // the missiles: a dot and its way
  for (const m of R?.missiles ?? []) {
    const [px, py] = at(m.x, m.y);
    const col = m.red ? "rgba(255, 50, 40, 1)" : "rgba(120, 225, 255, 1)";
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, 3 * dpr, 0, 2 * Math.PI);
    ctx.fill();
    if (m.trk !== null) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(m.trk) * 12 * dpr, py - Math.cos(m.trk) * 12 * dpr);
      ctx.stroke();
    }
  }
  // the craft: at the centre, its nose up
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8 * dpr);
  ctx.lineTo(cx + 6 * dpr, cy + 6 * dpr);
  ctx.lineTo(cx, cy + 3 * dpr);
  ctx.lineTo(cx - 6 * dpr, cy + 6 * dpr);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The radar's lock in the view (its target designation box): a square on it, its name, range, closure and
 *  altitude; out of the view, an arrow at the edge towards it. */
function drawLockBox(
  F: SymFrame,
  pr: (d: V3 | null | undefined) => [number, number] | null,
  stroke: (draw: () => void, col: string, lw: number, dash?: number[]) => void,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
  L: NonNullable<RadarPicture["lock"]>,
) {
  const { ctx, W, H, dpr } = F;
  const col =
    L.iff === "hostile"
      ? "rgba(255, 90, 70, 1)"
      : L.iff === "friend"
        ? "rgba(110, 200, 255, 1)"
        : L.iff === "neutral"
          ? "rgba(235, 240, 245, 1)"
          : "rgba(255, 215, 80, 1)";
  const p = L.cam ? pr(L.cam) : null;
  const U = unitsFor(F.s);
  const cl = U.spd(L.closure);
  const label = `${L.name.toUpperCase()}  ${U.dist(L.range).toFixed(1)} ${U.distName}  ${cl >= 0 ? "+" : ""}${Math.round(cl)} ${U.spdName}  ${Math.round(U.alt(L.alt) / 100) * 100} ${U.altName}`;
  if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) {
    const s = 14 * dpr;
    stroke(() => ctx.rect(p[0] - s, p[1] - s, 2 * s, 2 * s), col, 2);
    text(label, p[0], p[1] + s + 14 * dpr, col, 11, "center", true);
  } else if (L.cam) {
    // (behind or beside: an arrow at the edge, on the way to turn)
    const a = Math.atan2(-L.cam[1], L.cam[0]);
    const r = Math.min(W, H) * 0.34;
    const x = W / 2 + Math.cos(a) * r,
      y = H / 2 + Math.sin(a) * r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(16 * dpr, 0);
    ctx.lineTo(-7 * dpr, -10 * dpr);
    ctx.lineTo(-7 * dpr, 10 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    text(label, x, y + 20 * dpr, col, 11, "center", true);
  }
}

/** The intercept's cues on the lock (game/intercept.ts): the collision course's steering cue (a circle on the way
 *  to meet it, its heading), and under the HUD's centre the heading to fly, the merge's time, the aspect, the
 *  pursuit, the crossing angle. */
function drawIntercept(
  F: SymFrame,
  pr: (d: V3 | null | undefined) => [number, number] | null,
  stroke: (draw: () => void, col: string, lw: number, dash?: number[]) => void,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
  L: NonNullable<RadarPicture["lock"]>,
  I: InterceptCues,
) {
  const { ctx, W, H, dpr } = F;
  const col = "rgba(120, 255, 170, 1)";
  const p = L.collCam ? pr(L.collCam) : null;
  if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) {
    const r = 9 * dpr;
    stroke(() => ctx.arc(p[0], p[1], r, 0, 2 * Math.PI), col, 1.6);
    stroke(
      () => {
        ctx.moveTo(p[0], p[1] - r);
        ctx.lineTo(p[0], p[1] - r - 8 * dpr);
      },
      col,
      1.6,
    );
    ctx.fillStyle = col;
    ctx.fillRect(p[0] - 1.5 * dpr, p[1] - 1.5 * dpr, 3 * dpr, 3 * dpr);
  }
  const hdg = (a: number | null) => (a === null ? "---" : String(Math.round((a * 180) / Math.PI + 360) % 360).padStart(3, "0"));
  const tti =
    I.tti === null || !Number.isFinite(I.tti) || I.tti > 5999
      ? "--:--"
      : `${Math.floor(I.tti / 60)}:${String(Math.floor(I.tti % 60)).padStart(2, "0")}`;
  const pur = I.pursuit === "PURE" ? "PURE" : `${I.pursuit} ${Math.round(I.pursuitDeg)}°`;
  const line = `INTC ${hdg(I.collHdg)}  TTI ${tti}  AA ${Math.round(I.aspect)}${I.side}  ${pur}  HCA ${Math.round(I.hca)}`;
  text(line, W / 2, H * 0.78, col, 11, "center", true);
}

/**
 * The F-35's avionics block (top left, in the helmet's colour): the engine — its spool, the throttle, the thrust,
 * the afterburner —, the fuel — its gauge, the flow, the time left, the bingo (red past it) —, the configuration,
 * the autopilot's modes lit, the load against its limit, the STOVL, the damage in a fight, the cautions.
 */
/** The COAS (a crewed craft's alignment sight): a crosshair on the flown craft's port's boresight, the target port's
 *  mark a ring; aligned, the ring sits on the cross — green within 1°, amber within 5°. */
function drawCoas(
  F: SymFrame,
  bore: V3,
  port: V3,
  pr: Proj,
  stroke: Stroke,
  text: Text,
  inside: (p: [number, number] | null, m?: number) => boolean,
) {
  const { ctx, dpr } = F;
  const b = bore[2] > 0.05 ? pr(bore) : null;
  const p = port[2] > 0.05 ? pr(port) : null;
  const off =
    (Math.acos(
      Math.max(
        -1,
        Math.min(1, (bore[0] * port[0] + bore[1] * port[1] + bore[2] * port[2]) / (Math.hypot(...bore) * Math.hypot(...port) || 1)),
      ),
    ) *
      180) /
    Math.PI;
  const col = off < 1 ? "rgba(110, 255, 200, 0.95)" : off < 5 ? "rgba(255, 196, 92, 0.95)" : "rgba(255, 110, 90, 0.9)";
  if (b && inside(b, 20 * dpr)) {
    const r = 18 * dpr;
    stroke(
      () => {
        ctx.moveTo(b[0] - 2.2 * r, b[1]);
        ctx.lineTo(b[0] - 0.4 * r, b[1]);
        ctx.moveTo(b[0] + 0.4 * r, b[1]);
        ctx.lineTo(b[0] + 2.2 * r, b[1]);
        ctx.moveTo(b[0], b[1] - 2.2 * r);
        ctx.lineTo(b[0], b[1] - 0.4 * r);
        ctx.moveTo(b[0], b[1] + 0.4 * r);
        ctx.lineTo(b[0], b[1] + 2.2 * r);
      },
      col,
      1.4,
    );
    text(`COAS ${off.toFixed(1)}°`, b[0] + 2.4 * 18 * dpr, b[1] - 8 * dpr, col, 10.5, "left", true);
  }
  if (p && inside(p, 20 * dpr)) stroke(() => ctx.arc(p[0], p[1], 9 * dpr, 0, 2 * Math.PI), col, 1.6);
}

/** A spacecraft's own panel (game/craftpanel.ts): its title, its rows — a label, a value toned — in a box at the left. */
function drawCraftPanel(F: SymFrame, P: NonNullable<SymInfo["craftPanel"]>, text: Text) {
  const { ctx, dpr } = F;
  const TONE: Record<string, string> = {
    norm: "rgba(228, 240, 255, 0.95)",
    dim: "rgba(170, 190, 215, 0.6)",
    warn: "rgba(255, 196, 92, 1)",
    bad: "rgba(255, 90, 70, 1)",
    good: "rgba(110, 255, 200, 0.95)",
  };
  const lh = 17 * dpr;
  // (its place: left of the view's centre below the top's panels, clear of the HUD's own — hud/layout.ts —: moved
  // down, else right; at the top-left it sat under the target's card)
  const wantBox: Box = { x: 120, y: F.top / dpr + 150, w: 252, h: 17 * (P.rows.length + 1) + 12, id: "craftpanel" };
  const at = fit(wantBox, "down", { reach: 400 }) ?? fit(wantBox, "right", { reach: 300 }) ?? wantBox;
  drawn.push(at);
  const x = (at.x + 8) * dpr,
    w = 236 * dpr;
  const y0 = (at.y + 14) * dpr;
  const h = lh * (P.rows.length + 1) + 12 * dpr;
  ctx.fillStyle = "rgba(4, 10, 18, 0.55)";
  ctx.fillRect(x - 8 * dpr, y0 - 14 * dpr, w + 16 * dpr, h);
  ctx.fillStyle = "rgba(95, 255, 208, 0.9)";
  ctx.fillRect(x - 8 * dpr, y0 - 14 * dpr, 2 * dpr, h);
  text(P.title, x, y0, "rgba(95, 255, 208, 0.95)", 11, "left", true);
  P.rows.forEach((r, k) => {
    const y = y0 + lh * (k + 1);
    text(r.label, x, y, "rgba(170, 190, 215, 0.75)", 11, "left", true);
    text(r.value, x + w, y, TONE[r.tone ?? "norm"]!, 12, "right", true);
  });
}

function drawAvionics(
  F: SymFrame,
  A: NonNullable<SymInfo["avionics"]>,
  text: (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void,
  rgb: string,
) {
  const { ctx, dpr, i, s } = F;
  const br = s.f35HmdBrightness ?? 1;
  const G = (a: number) => `rgba(${rgb}, ${(a * br).toFixed(3)})`;
  const AMB = "rgba(255, 190, 60, 1)",
    RED = "rgba(255, 70, 60, 1)";
  const x = (F.compact ? 10 : 16) * dpr,
    w = 250 * dpr;
  let y = F.top + (F.compact ? 40 : 60) * dpr;
  const lh = 17 * dpr;
  const lines: (() => void)[] = [];
  const row = (draw: (y: number) => void) => lines.push(() => (draw(y), (y += lh)));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // the engine
  row((y) => {
    text(`ENG ${pct(A.spool)}`, x, y, G(0.95), 12, "left", true);
    text(`THR ${pct(A.throttle)}`, x + 86 * dpr, y, G(0.95), 12, "left", true);
    text(`${Math.round(A.thrustKn)} kN`, x + w, y, G(0.95), 12, "right", true);
  });
  if (A.ab > 0.05) row((y) => text(`AFTERBURNER ${pct(A.ab)}`, x, y, AMB, 12, "left", true));
  // the fuel: a gauge, the flow, the time left
  row((y) => {
    const f = A.full > 0 ? A.fuel / A.full : 0;
    const low = A.bingo !== null ? A.fuel < A.bingo : f < 0.2;
    const col = A.infiniteFuel ? G(0.95) : low ? RED : G(0.95);
    text(A.infiniteFuel ? "FUEL ∞" : `FUEL ${Math.round(A.fuel).toLocaleString("en").replace(/,/g, " ")} kg`, x, y, col, 12, "left", true);
    const gx = x + 140 * dpr,
      gw = 70 * dpr;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(gx, y - 5 * dpr, gw, 10 * dpr);
    ctx.fillStyle = col;
    ctx.fillRect(gx, y - 5 * dpr, gw * Math.max(0, Math.min(1, A.infiniteFuel ? 1 : f)), 10 * dpr);
    // (the bingo's mark on the gauge)
    if (A.bingo !== null && A.full > 0) {
      const bx = gx + gw * Math.min(1, A.bingo / A.full);
      ctx.fillStyle = "rgba(255, 92, 244, 1)";
      ctx.fillRect(bx - 1 * dpr, y - 8 * dpr, 2 * dpr, 16 * dpr);
    }
  });
  row((y) => {
    const min = A.flow > 0 ? A.fuel / A.flow / 60 : Infinity;
    text(`${Math.round(A.flow * 60)} kg/min`, x, y, G(0.8), 11, "left", true);
    if (!A.infiniteFuel && Number.isFinite(min))
      text(`${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, "0")} LEFT`, x + 104 * dpr, y, G(0.8), 11, "left", true);
    if (A.bingo !== null)
      text(
        `BINGO ${Math.round(A.bingo)}`,
        x + w,
        y,
        A.fuel < A.bingo && !A.infiniteFuel ? RED : "rgba(255, 92, 244, 1)",
        11,
        "right",
        true,
      );
  });
  // the configuration
  row((y) => {
    const gear = A.gear > 0.99 ? "GEAR DN" : A.gear < 0.01 ? "GEAR UP" : "GEAR ···";
    text(gear, x, y, A.gear > 0.01 && A.gear < 0.99 ? AMB : A.gear > 0.99 ? G(0.95) : G(0.6), 11.5, "left", true);
    text(`FLAPS ${A.flaps >= 1 ? "FULL" : A.flaps > 0 ? "½" : "UP"}`, x + 86 * dpr, y, A.flaps > 0 ? G(0.95) : G(0.6), 11.5, "left", true);
    text(A.brake > 0 ? "SPDBRK" : "", x + w, y, AMB, 11.5, "right", true);
  });
  // the autopilot's modes: lit when engaged
  row((y) => {
    const modes: [string, boolean][] = [
      ["ALT", A.ap.alt],
      ["HDG", A.ap.hdg],
      ["A/T", A.ap.spd],
      ["LNAV", A.ap.lnav],
      ["VNAV", A.ap.vnav],
    ];
    let mx = x;
    for (const [m, on] of modes) {
      if (on) {
        ctx.fillStyle = G(0.22);
        ctx.fillRect(mx - 2 * dpr, y - 8 * dpr, (m.length * 8 + 6) * dpr, 16 * dpr);
      }
      text(m, mx, y, on ? G(1) : G(0.35), 11.5, "left", true);
      mx += (m.length * 8 + 12) * dpr;
    }
  });
  // the load against its limit
  const g = i.air?.g ?? 1;
  row((y) => {
    text(`G ${g.toFixed(1)}`, x, y, Math.abs(g) > A.gLimit * 0.95 ? RED : g > A.gLimit * 0.8 ? AMB : G(0.95), 12, "left", true);
    text(`LIM ${A.gLimit.toFixed(1)}`, x + 70 * dpr, y, G(0.6), 11, "left", true);
    if (A.stovl) text(A.stovl, x + w, y, "rgba(120, 225, 255, 1)", 12, "right", true);
  });
  if (A.damage > 0) row((y) => text(`DAMAGE ${Math.round(A.damage)}%`, x, y, A.damage > 60 ? RED : AMB, 12.5, "left", true));
  // the cautions: the warnings red, the cautions amber (the three most urgent)
  const al = alertsOf({ ...(i as unknown as AlertInput), animate: s.animate, fmtM: () => "" })
    .filter((a) => a.level !== "advisory")
    .slice(0, 3);
  for (const a of al) row((y) => text(`▲ ${a.text}`, x, y, a.level === "warning" ? RED : AMB, 11, "left", true));
  // the panel behind, then its lines
  const h = (lines.length + 1) * lh;
  ctx.fillStyle = "rgba(2, 12, 8, 0.6)";
  ctx.fillRect(x - 8 * dpr, y - 16 * dpr, w + 16 * dpr, h + 4 * dpr);
  ctx.strokeStyle = G(0.35);
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(x - 8 * dpr, y - 16 * dpr, w + 16 * dpr, h + 4 * dpr);
  text("F-35B · AVIONICS", x, y - 4 * dpr, G(0.7), 10, "left", true);
  y += lh;
  for (const l of lines) l();
}
