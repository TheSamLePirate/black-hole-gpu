// The A320's standby instrument, the ISIS (docs/PLAN-A320.md, A7): FlightGear's IESI (Models/Instruments/IESI/res/iesi.svg,
// its driver IESI.nas ported) — the attitude (the horizon moved by the pitch, turned by the roll about its centre, the
// bank pointer and the slip index with it), the speed tape (and the Mach above M .50), the altitude tape, its rolling
// hundreds and twenty-feet drums, the metres in their box, the baro setting (STD, or QNH in hPa and inHg). Powered, it
// aligns first (FlightGear's 90 s, here a few: "ALIGN"), then flies. The ILS scales of the real ISIS are not in
// FlightGear's picture: not drawn.

import isisSvg from "../../../assets/a320/du/isis.svg";
import type { DuData } from "./data";
import { type Ctx, Display, fontOf } from "./display";
import type { El, SvgDoc } from "./svg";

/** the alignment's length here [s] (FlightGear's 90 — the deck's first look would wait for it) */
const ALIGN_S = 4;

export class Isis extends Display {
  override hz = 10;
  private el: Record<string, El> = {};
  /** the centre of the attitude (AI_center's — the horizon's frame), the hundreds drum's digit height */
  private aiCenter: [number, number] = [512, 512];
  private digitH = 30;
  private start = Number.NaN;
  private machShown = false;

  constructor() {
    super(0, isisSvg);
  }

  protected override init(doc: SvgDoc) {
    const keys = [
      "IESI",
      "IESI_Init",
      "attRst",
      "attRstRect",
      "att90s",
      "ATTflag",
      "SPDwarn",
      "ALTwarn",
      "ASI_scale",
      "ASI_mach",
      "ASI_mach_decimal",
      "AI_center",
      "AI_horizon",
      "AI_bank",
      "AI_slipskid",
      "ALT_scale",
      "ALT_one",
      "ALT_two",
      "ALT_three",
      "ALT_four",
      "ALT_five",
      "ALT_digits",
      "ALT_hundreds",
      "ALT_hundreds_current",
      "ALT_hundreds_next",
      "ALT_tens",
      "ALT_meters",
      "QNH_setting",
      "QNH_std",
      "negText",
      "negText2",
      "metricM",
      "metricBox",
    ];
    for (const k of keys) this.el[k] = doc.get(k);
    const E = this.el;
    this.aiCenter = E.AI_center!.getCenter();
    E.IESI!.hide();
    E.IESI_Init!.show();
    E.ATTflag!.hide();
    E.attRst!.hide();
    E.attRstRect!.hide();
    E.SPDwarn!.hide();
    E.ALTwarn!.hide();
    // (FlightGear's pin programmes: the metric altitude and the inHg shown)
    for (const k of ["ALT_meters", "metricM", "metricBox"]) E[k]!.show();
  }

  /** The altitude's drum laid out (FlightGear's, from ALT_digits's bounds — here its glyphs measured in the displays'
   *  font): ALT_digits, authored "00", keeps one digit's column for the hundreds drum, which rolls in its right-most. */
  private layDrum(ctx: Ctx) {
    const E = this.el;
    const T = E.ALT_digits!;
    const run = T.runs[0];
    if (!run) return;
    const fs = run.style.fontSize;
    ctx.font = `${fs}px ${fontOf("")}`;
    const m = ctx.measureText("0");
    // (in the text's own units, then its transform's scale — the parent's)
    const wL = m.width,
      hL = m.actualBoundingBoxAscent || fs * 0.72;
    const [sx, , , sy] = T.tf;
    const right = run.x * sx,
      base = run.y * sy,
      w = wL * sx,
      h = hL * sy;
    this.digitH = hL;
    T.setTranslation(-wL, 0);
    E.ALT_hundreds_next!.setTranslation(0, -hL);
    E.ALT_hundreds!.clip = [right - w - 2, base - h + 1, right + 2, base + 3];
    this.drumLaid = true;
  }
  private drumLaid = false;

  draw(ctx: Ctx, d: DuData, t: number) {
    const doc = this.doc!;
    const E = this.el;
    if (!this.drumLaid) this.layDrum(ctx);
    if (!Number.isFinite(this.start)) this.start = t;
    const aligning = t - this.start < ALIGN_S;
    E.IESI!.setVisible(!aligning);
    E.IESI_Init!.setVisible(aligning);
    // (its count down: FlightGear's "INIT 90s", here the seconds left)
    if (aligning) E.att90s!.setText(`INIT ${Math.max(Math.ceil(ALIGN_S - (t - this.start)), 1)}s`);
    if (!aligning) this.fly(d);
    // (the baro: STD, or the QNH in hPa and inHg — shown while it aligns too)
    E.QNH_std!.setVisible(d.baro.std);
    E.QNH_setting!.setVisible(!d.baro.std);
    if (!d.baro.std) E.QNH_setting!.setText(`${Math.round(d.baro.hpa)}/${(Math.round(d.baro.hpa * 2.953) / 100).toFixed(2)}`);
    doc.draw(ctx, 1024, 1024, fontOf);
  }

  private fly(d: DuData) {
    const E = this.el;
    // ---- the speed: its tape (8.295 px a knot, from 30 kt), the Mach above .50 (hidden again below .45)
    E.ASI_scale!.setTranslation(0, clamp(d.ias - 30, 0, 490) * 8.295);
    this.machShown = this.machShown ? d.mach > 0.45 : d.mach >= 0.5;
    E.ASI_mach!.setVisible(this.machShown);
    E.ASI_mach_decimal!.setVisible(this.machShown);
    E.ASI_mach!.setText(String(Math.round(clamp(d.mach * 100, 0, 99))).padStart(2, " "));
    // ---- the attitude: the horizon down by the pitch (16.74 px a degree), turned by the roll about the centre; the
    // bank pointer turned with it (about the same centre, in its own frame)
    const r = (-d.roll * Math.PI) / 180;
    E.AI_horizon!.setTranslation(0, d.pitch * 16.74).setRotation(r, this.aiCenter);
    E.AI_bank!.setRotation(r, local(E.AI_bank!, this.aiCenter));
    // (the slip index: off the scale past 85)
    const skid = clamp(d.slip * 4, -90, 90);
    E.AI_slipskid!.setVisible(Math.abs(skid) < 85).setTranslation(-skid, 0);
    // ---- the altitude: its tape every 500 ft (258.55 px), its labels the hundreds about it, the drums
    const alt = clamp(d.alt, -2000, 50000);
    E.ALT_meters!.setText(String(Math.round((alt * 0.3048) / 10) * 10).padStart(5, " "));
    const mid = roundaboutAlt(alt / 100);
    const lab = (k: string, v: number) => E[k]!.setText(String(Math.abs(v)).padStart(3, "0"));
    lab("ALT_five", mid + 10);
    lab("ALT_four", mid + 5);
    lab("ALT_three", mid);
    lab("ALT_two", mid - 5);
    lab("ALT_one", mid - 10);
    E.negText!.setVisible(alt < 0);
    E.negText2!.setVisible(alt < 0);
    const off = alt / 500 - Math.trunc(alt / 500);
    const middle = off > 0.5 ? -(off - 1) * 258.5528 : -off * 258.5528;
    E.ALT_scale!.setTranslation(0, -middle);
    // (the 20 ft drum: the tens; the hundreds carried over the last 20 ft of each hundred)
    const a = Math.abs(alt);
    E.ALT_tens!.setTranslation(0, (Math.trunc(a) % 100) * 3.16);
    const hundreds = Math.trunc(a / 100);
    const upper = Math.trunc(a / 1000);
    const digit = hundreds - upper * 10;
    E.ALT_digits!.setText(upper > 0 ? String(upper) : "");
    E.ALT_hundreds_current!.setText(String(digit));
    E.ALT_hundreds_next!.setText(String(digit === 9 ? 0 : digit + 1));
    // (the drum's texts in their own scaled frame: the carry's travel in their units)
    E.ALT_hundreds!.setTranslation(0, clamp((a - hundreds * 100 - 80) / 20, 0, 1) * this.digitH * (E.ALT_hundreds_current!.tf[3] || 1));
  }
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** FlightGear's roundaboutAlt: the hundreds to the nearest five */
const roundaboutAlt = (x: number) => (x * 0.2 - Math.trunc(x * 0.2) < 0.5 ? 5 * Math.trunc(x * 0.2) : 5 + 5 * Math.trunc(x * 0.2));
/** a point of an element's parent's frame in the element's own (its SVG transform undone) */
function local(e: El, p: [number, number]): [number, number] {
  const [a, b, c, dd, ex, f] = e.tf;
  const det = a * dd - b * c || 1;
  const x = p[0] - ex,
    y = p[1] - f;
  return [(dd * x - c * y) / det, (-b * x + a * y) / det];
}
