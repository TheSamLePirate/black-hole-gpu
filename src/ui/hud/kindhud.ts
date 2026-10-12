// The Space and Approach HUDs' own readouts (PLAN-MODES-AAA M4 — game/hudkind.ts chooses the kind; the
// Atmosphere's is the fighter's, hud/jethud.ts):
// - Space, in cyan, right of the view's centre: the orbit about the body of the sphere of influence — its
//   apsides with their heights and times, the inclination, the eccentricity, the period —, the next event on
//   the path (an impact in red), the target's range and closing rate;
// - Approach, in white: the radar altitude and the vertical speed large on the right, the glide's and the
//   axis's deviations from the runway's guidance (game/mls.ts — an ILS's scales of dots, the diamond where the
//   path is), the gear, the flaps and
//   the air brake under the centre (the gear up low, in red).
// Each box placed where no panel stands (hud/layout.ts fit), told to the layout as drawn.

import { t, tf } from "../../i18n";
import { drawn, fit, type Box } from "./layout";
import { jetUnits, type JetUnits } from "./jethud";
import { MONO } from "../hudkit";

type Text = (t: string, x: number, y: number, col: string, size: number, align?: CanvasTextAlign, mono?: boolean) => void;

const CYAN = "124, 214, 255";
const WHITE = "#f4f8ff";
const AMBER = "#ffc85a";
const RED = "#ff5a46";
const GREEN = "#78ffaa";

/** A duration on the HUD: 42 s, 12:05, 3 h 20, 2.4 d. */
export function hudDur(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const a = Math.max(0, s);
  if (a < 60) return `${a.toFixed(0)} s`;
  if (a < 3600) return `${Math.floor(a / 60)}:${String(Math.floor(a % 60)).padStart(2, "0")}`;
  if (a < 86400) return `${Math.floor(a / 3600)} h ${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}`;
  return `${(a / 86400).toFixed(1)} d`;
}

/** A height on the HUD [km]: 412.3 km, 38 400 km, 1.2 M km. */
export function hudKm(km: number): string {
  if (!Number.isFinite(km)) return "—";
  const a = Math.abs(km);
  if (a < 1000) return `${km.toFixed(1)} km`;
  if (a < 1e6) return `${Math.round(km).toLocaleString("en-US").replace(/,/g, " ")} km`;
  return `${(km / 1e6).toFixed(2)} M km`;
}

/** What the Space HUD reads (a slice of the status, game/status.ts). */
export interface SpaceHudInfo {
  body: string;
  orbit: { apKm: number; peKm: number; tAp: number; tPe: number; incDeg: number; ecc: number; period: number } | null;
  next: { kind: string; name: string; inS: number } | null;
  target: { name: string; distKm: number; rate: number } | null;
}

/** The Space HUD's lines (pure: tests/kindhud.test.ts). */
export function spaceLines(S: SpaceHudInfo): { t: string; col: string }[] {
  const out: { t: string; col: string }[] = [];
  const o = S.orbit;
  if (o) {
    const bound = o.ecc < 1 && Number.isFinite(o.apKm);
    out.push({ t: `${bound ? t("ORBIT") : t("ESCAPE")} · ${S.body.toUpperCase()}`, col: `rgb(${CYAN})` });
    if (bound) out.push({ t: `AP ${hudKm(o.apKm).padStart(11)}  T−${hudDur(o.tAp)}`, col: WHITE });
    // (a periapsis under the ground: in amber — the path meets it)
    out.push({ t: `PE ${hudKm(o.peKm).padStart(11)}  T−${hudDur(o.tPe)}`, col: o.peKm < 0 ? AMBER : WHITE });
    out.push({
      t: `INC ${o.incDeg.toFixed(1)}°  e ${o.ecc < 0.01 ? o.ecc.toFixed(4) : o.ecc.toFixed(3)}${bound ? `  P ${hudDur(o.period)}` : ""}`,
      col: "rgba(214, 236, 255, 0.85)",
    });
  } else out.push({ t: S.body.toUpperCase(), col: `rgb(${CYAN})` });
  const n = S.next;
  if (n) {
    const what =
      n.kind === "impact"
        ? tf("IMPACT {0}", n.name.toUpperCase())
        : n.kind === "enter"
          ? tf("SOI {0}", n.name.toUpperCase())
          : n.kind === "exit"
            ? tf("LEAVE {0}", n.name.toUpperCase())
            : tf("MOUTH {0}", n.name.toUpperCase());
    out.push({ t: `${what}  T−${hudDur(n.inS)}`, col: n.kind === "impact" ? RED : AMBER });
  }
  const g = S.target;
  if (g && Number.isFinite(g.distKm)) {
    const d = g.distKm < 10 ? `${(g.distKm * 1000).toFixed(0)} m` : hudKm(g.distKm);
    const r = Number.isFinite(g.rate)
      ? `  ${g.rate > 0 ? "+" : "−"}${Math.abs(g.rate) < 100 ? Math.abs(g.rate).toFixed(1) : Math.round(Math.abs(g.rate))} m/s`
      : "";
    out.push({ t: `TGT ${g.name.toUpperCase()} ${d}${r}`, col: g.rate < 0 ? GREEN : "rgba(214, 236, 255, 0.85)" });
  }
  return out;
}

/** A box of lines, its frame in the colour, placed where no panel stands; null: no room. */
function linesBox(
  o: { ctx: CanvasRenderingContext2D; W: number; H: number; dpr: number },
  lines: { t: string; col: string }[],
  want: { x: number; y: number },
  frame: string,
  text: Text,
  id: string,
  dir: "up" | "down" = "down",
) {
  const { ctx, dpr } = o;
  ctx.font = `600 ${11 * dpr}px ${MONO}`;
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l.t).width);
  const box: Box = { x: want.x / dpr, y: want.y / dpr, w: w / dpr + 22, h: 12 + lines.length * 16, id };
  // (clear of the panels and of the boxes the canvas already drew this frame)
  const at = fit(box, dir, { reach: 260, others: [...drawn] });
  if (!at) return null;
  drawn.push(at);
  const x = at.x * dpr,
    y = at.y * dpr;
  ctx.fillStyle = "rgba(4, 10, 20, 0.55)";
  ctx.fillRect(x, y, at.w * dpr, at.h * dpr);
  ctx.strokeStyle = frame;
  ctx.lineWidth = 1.2 * dpr;
  // (the HUD's corner brackets, not a full frame)
  const c = 9 * dpr,
    X = x + at.w * dpr,
    Y = y + at.h * dpr;
  ctx.beginPath();
  ctx.moveTo(x, y + c);
  ctx.lineTo(x, y);
  ctx.lineTo(x + c, y);
  ctx.moveTo(X - c, Y);
  ctx.lineTo(X, Y);
  ctx.lineTo(X, Y - c);
  ctx.stroke();
  lines.forEach((l, k) => text(l.t, x + 11 * dpr, y + (14 + k * 16) * dpr, l.col, 11, "left", true));
  return at;
}

/** The Space HUD's block, right of the view's centre. */
export function drawSpaceHud(o: { ctx: CanvasRenderingContext2D; W: number; H: number; dpr: number }, S: SpaceHudInfo, text: Text) {
  const { W, H, dpr } = o;
  linesBox(o, spaceLines(S), { x: W / 2 + Math.min(W, H) * 0.3, y: H / 2 - 150 * dpr }, `rgba(${CYAN}, 0.8)`, text, "space");
}

/** What the Approach HUD reads (SI: m, m/s; the glide's path angles [°]; the axis's offset [m]). */
export interface ApproachHudInfo {
  radar: number;
  vs: number;
  gear: { down: boolean; ext: number; flaps: number; brake: number } | null;
  /** the runway's guidance (game/mls.ts): the angle above the profile [°, > 0 high] and off the axis [°, > 0 right],
   *  each null out of its station's coverage */
  el: number | null;
  az: number | null;
  /** the craft is landed */
  landed: boolean;
}

/** The glide's and the axis's deviations as dots (±2 at full scale, an ILS's): the glide 0.35° a dot, the axis 1.25°. */
export function deviationDots(a: Pick<ApproachHudInfo, "el" | "az">): { glide: number | null; axis: number | null } {
  const clamp = (v: number) => Math.max(-2.2, Math.min(2.2, v));
  return {
    // (above the path: the diamond below the centre — fly down to it)
    glide: a.el !== null ? clamp(a.el / 0.35) : null,
    // (right of the axis: the diamond left — the runway is there)
    axis: a.az !== null ? clamp(-a.az / 1.25) : null,
  };
}

/** The Approach HUD: the radar altitude and the vertical speed, the deviations, the gear and flaps. */
export function drawApproachHud(
  o: { ctx: CanvasRenderingContext2D; W: number; H: number; dpr: number; units: JetUnits },
  A: ApproachHudInfo,
  text: Text,
  blink: boolean,
) {
  const { ctx, W, H, dpr } = o;
  const U = jetUnits(o.units);
  const cx = W / 2,
    cy = H / 2;
  // ---- the radar altitude and the vertical speed, large, right of the centre
  const ra = U.alt(A.radar);
  const raTxt = ra < 100 ? ra.toFixed(0) : (Math.round(ra / 10) * 10).toLocaleString("en-US").replace(/,/g, " ");
  const vs = U.vs(A.vs);
  const vsTxt = `${vs > 0 ? "+" : vs < 0 ? "−" : ""}${Math.abs(vs) < 10 ? Math.abs(vs).toFixed(1) : Math.round(Math.abs(vs))}`;
  const sink = A.vs < -6 && A.radar < 150;
  linesBox(
    o,
    [
      { t: `RA ${raTxt} ${U.altName}`, col: A.radar < 30 && !A.landed ? AMBER : WHITE },
      { t: `VS ${vsTxt} ${o.units === "aviation" ? "FPM" : "M/S"}`, col: sink ? (blink ? RED : AMBER) : WHITE },
    ],
    { x: cx + Math.min(W, H) * 0.3, y: cy - 30 * dpr },
    "rgba(244, 248, 255, 0.85)",
    text,
    "approach",
  );
  // ---- the deviations on the final: the glide's scale right of the centre, the axis's under it
  const dev = deviationDots(A);
  const dot = 16 * dpr;
  const scale = (x: number, y: number, vertical: boolean, v: number | null) => {
    if (v === null) return;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      const px = vertical ? x : x + k * dot,
        py = vertical ? y + k * dot : y;
      if (k === 0) {
        ctx.moveTo(vertical ? px - 7 * dpr : px, vertical ? py : py - 7 * dpr);
        ctx.lineTo(vertical ? px + 7 * dpr : px, vertical ? py : py + 7 * dpr);
      } else ctx.arc(px, py, 2.6 * dpr, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(244, 248, 255, 0.85)";
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();
    }
    const dx = vertical ? x : x + v * dot,
      dy = vertical ? y + v * dot : y;
    ctx.beginPath();
    ctx.moveTo(dx, dy - 6 * dpr);
    ctx.lineTo(dx + 6 * dpr, dy);
    ctx.lineTo(dx, dy + 6 * dpr);
    ctx.lineTo(dx - 6 * dpr, dy);
    ctx.closePath();
    ctx.fillStyle = Math.abs(v) >= 2 ? AMBER : "#ff8ce6";
    ctx.fill();
  };
  scale(cx + Math.min(W, H) * 0.2, cy, true, dev.glide);
  scale(cx, cy + Math.min(W, H) * 0.2, false, dev.axis);
  if (dev.glide !== null) text("G/S", cx + Math.min(W, H) * 0.2, cy - 3 * dot, "rgba(244, 248, 255, 0.7)", 10);
  // ---- the gear, the flaps, the air brake: under the centre
  const G = A.gear;
  if (G && !A.landed) {
    const moving = G.ext > 0.02 && G.ext < 0.98;
    const gearUpLow = !G.down && A.radar < 300;
    const items: { t: string; col: string }[] = [
      {
        t: moving ? t("GEAR ↕") : G.down ? t("GEAR DN") : t("GEAR UP"),
        col: gearUpLow ? (blink ? RED : AMBER) : moving ? AMBER : G.down ? GREEN : "rgba(244, 248, 255, 0.7)",
      },
      {
        t: G.flaps === 0 ? t("FLAPS UP") : G.flaps < 1 ? t("FLAPS ½") : t("FLAPS FULL"),
        col: G.flaps > 0 ? WHITE : "rgba(244, 248, 255, 0.7)",
      },
    ];
    if (G.brake > 0) items.push({ t: t("BRAKE"), col: AMBER });
    const y = cy + Math.min(W, H) * 0.2 + 30 * dpr;
    ctx.font = `600 ${11 * dpr}px ${MONO}`;
    const gap = 18 * dpr;
    const widths = items.map((i) => ctx.measureText(i.t).width);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)) / 2;
    items.forEach((it, k) => {
      text(it.t, x, y, it.col, 11, "left", true);
      x += widths[k]! + gap;
    });
  }
}
