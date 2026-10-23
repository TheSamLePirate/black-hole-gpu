// The A320's deck's texts (docs/PLAN-A320.md, A8): FlightGear's osgText — the FCU's windows (speed, heading, altitude,
// V/S), the baro settings, the radios, the transponder, the clock, the rudder trim — drawn in their slots of the
// displays' atlas (each a quad of the deck: scripts/build-a320-cockpit.py) as their LCDs show them: seven segments,
// amber, the unlit background clear (the shader cuts it out). Their values the deck's properties by FlightGear's
// formats; which of them shows (the FCU's speed or Mach, the lamp test's 888…) the rig's selects.

import type { DeckText } from "../deck";
import type { Props } from "../rig";
import type { DuData } from "./data";
import { type Ctx, Display, fontOf } from "./display";

/** FlightGear's printf: %s, %d, %f with flags, width and precision (the formats of a320.flightdeck.xml). */
export function printf(fmt: string, v: number | string | undefined): string {
  return fmt.replace(/%([-+0 ]*)(\d*)(?:\.(\d+))?([sdf])/g, (_, flags: string, width: string, prec: string, t: string) => {
    let s: string;
    if (t === "s") s = v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : v;
    else {
      const n = Number(v ?? 0);
      s = t === "d" ? String(Math.round(Math.abs(n))) : Math.abs(n).toFixed(prec === undefined ? 6 : Number(prec));
      const sign = n < 0 && Number(s) !== 0 ? "-" : flags.includes("+") ? "+" : "";
      const w = Number(width || 0);
      if (flags.includes("0")) s = sign + s.padStart(Math.max(w - sign.length, 0), "0");
      else s = sign + s;
    }
    const w = Number(width || 0);
    return flags.includes("-") ? s.padEnd(w) : s.padStart(w);
  });
}

/** A text's characters now. */
export function textOf(T: DeckText, P: Props): string {
  if (T.kind === "literal") return T.text;
  const v = T.prop ? P[T.prop] : undefined;
  if (T.kind === "number-value") return printf(T.format || "%s", v === undefined ? 0 : Number(v));
  return printf(T.format || "%s", v);
}

// the seven segments (a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle) of each glyph
const SEG: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  " ": "",
  o: "gcde",
  S: "afgcd",
  t: "fged",
  d: "bcdeg",
  L: "fed",
  R: "efab",
  A: "abcefg",
  E: "afged",
  F: "afge",
  P: "abefg",
  U: "bcdef",
  C: "afed",
  H: "bcefg",
  n: "ceg",
  r: "eg",
};
const AMBER = "#ffae2a";

export class DeckTexts extends Display {
  override hz = 4;
  constructor(
    private texts: DeckText[],
    /** the atlas's cell this canvas fills [px of 4096] */
    private cell: [number, number],
  ) {
    super(0, null);
  }

  draw(ctx: Ctx, d: DuData, _t: number) {
    ctx.clearRect(0, 0, 1024, 1024);
    for (const T of this.texts) {
      const s = textOf(T, d.deck);
      if (!s) continue;
      // (the slot in this canvas: its place in the atlas less the cell's)
      const x = T.slot[0] * 4096 - this.cell[0],
        y = T.slot[1] * 4096 - this.cell[1],
        w = T.slot[2] * 4096,
        h = T.slot[3] * 4096;
      seg(ctx, s, x, y, w, h, T.align);
    }
  }
}

/** A string in seven segments in the box (x, y, w, h), aligned as FlightGear aligns it; the point and the colon between
 *  the glyphs; a character without segments in the ECAM font. */
function seg(ctx: Ctx, s: string, x: number, y: number, w: number, h: number, align: string) {
  const ch = h * 0.86;
  const cw = ch * 0.56;
  const gap = ch * 0.16;
  const glyphs = [...s].filter((c) => c !== "." && c !== ":");
  const total = glyphs.length * (cw + gap) - gap;
  let cx = align === "left" ? x + gap : align === "right" ? x + w - total - gap : x + (w - total) / 2;
  const top = y + (h - ch) / 2;
  const t = ch * 0.12;
  ctx.fillStyle = AMBER;
  ctx.strokeStyle = AMBER;
  for (const c of s) {
    if (c === "." || c === ":") {
      // (between the glyphs: a dot at the foot, a colon in the middle)
      const px = cx - gap / 2;
      ctx.beginPath();
      if (c === ".") ctx.arc(px, top + ch - t / 2, t * 0.6, 0, Math.PI * 2);
      else {
        ctx.arc(px, top + ch * 0.32, t * 0.5, 0, Math.PI * 2);
        ctx.arc(px, top + ch * 0.7, t * 0.5, 0, Math.PI * 2);
      }
      ctx.fill();
      continue;
    }
    const segs = SEG[c] ?? SEG[c.toUpperCase()];
    if (segs === undefined) {
      ctx.font = `${ch}px ${fontOf("")}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(c, cx, top + ch);
    } else
      for (const k of segs) {
        // (a slanted segment: its ends pointed, the glyph leaning 8° as an LCD's)
        const sl = 0.14;
        const P = (u: number, v: number): [number, number] => [cx + u * cw + (1 - v) * sl * cw, top + v * ch];
        const half = 0.5;
        const pts: Record<string, [number, number][]> = {
          a: [P(0.08, 0), P(0.92, 0), P(0.8, t / ch), P(0.2, t / ch)],
          d: [P(0.2, 1 - t / ch), P(0.8, 1 - t / ch), P(0.92, 1), P(0.08, 1)],
          g: [
            P(0.1, half),
            P(0.22, half - t / ch / 2),
            P(0.78, half - t / ch / 2),
            P(0.9, half),
            P(0.78, half + t / ch / 2),
            P(0.22, half + t / ch / 2),
          ],
          f: [P(0, 0.04), P(t / cw, 0.12), P(t / cw, half - 0.06), P(0, half - 0.02)],
          b: [P(1, 0.04), P(1, half - 0.02), P(1 - t / cw, half - 0.06), P(1 - t / cw, 0.12)],
          e: [P(0, half + 0.02), P(t / cw, half + 0.06), P(t / cw, 0.88), P(0, 0.96)],
          c: [P(1, half + 0.02), P(1, 0.96), P(1 - t / cw, 0.88), P(1 - t / cw, half + 0.06)],
        };
        const q = pts[k]!;
        ctx.beginPath();
        ctx.moveTo(q[0]![0], q[0]![1]);
        for (let i = 1; i < q.length; i++) ctx.lineTo(q[i]![0], q[i]![1]);
        ctx.closePath();
        ctx.fill();
      }
    cx += cw + gap;
  }
}
