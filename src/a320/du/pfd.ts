// The A320's primary flight display (docs/PLAN-A320.md, A7): FlightGear's pfd.svg driven as its PFD.nas drives it —
// the attitude (the horizon, its ground and sky, the heading marks on it: translated by the non-linear pitch,
// 11.825 px a degree, then turned about the aircraft symbol by the roll), the bank scale and the slip, the speed
// tape (6.6 px a knot from 30 kt) and its marks (VMAX's barber pole, VLS, α prot, α max, the next VFE, green dot, S,
// F, the trend arrow, Mach above 0.5), the altitude drums and tape (243.34 px for 500 ft), the vertical speed's needle
// and digits, the heading tape (98.54 px for 10°) and the track diamond, the radio altitude, the baro setting, the
// ILS scales, the FMA (what data.ts gives until the FCU and the FMGC — A8). The units the instrument's: knots, feet,
// feet a minute; the metric altitude with the FCU's METRIC ALT button, or the metric units.
// Systems/pfd.xml's tables (the pitch's, the VS needle's and digits') are here too.

import pfdSvg from "../../../assets/a320/du/pfd.svg";
import type { DuData } from "./data";
import { type Ctx, Display, fontOf } from "./display";
import type { El, SvgDoc } from "./svg";

const D2R = Math.PI / 180;
/** FlightGear's colours (PFD.nas's setColor): amber, green, cyan (selected), white */
const AMBER = "rgb(187,97,0)";
const GREEN = "rgb(13,192,75)";
const CYAN = "rgb(23,154,183)";
const WHITE = "rgb(255,255,255)";
const GREY = "rgb(206,205,206)";

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** a table's value, linear between its entries (FlightGear's <table>) */
function table(t: readonly (readonly [number, number])[], x: number): number {
  if (x <= t[0]![0]) return t[0]![1];
  for (let i = 1; i < t.length; i++)
    if (x <= t[i]![0]) return t[i - 1]![1] + ((t[i]![1] - t[i - 1]![1]) * (x - t[i - 1]![0])) / (t[i]![0] - t[i - 1]![0]);
  return t[t.length - 1]![1];
}
// (Systems/pfd.xml: the pitch shown non-linear beyond −10° and 27.5°, the VS needle's angle and its digits' place)
const PITCH = [
  [-90, -57.5],
  [-80, -47.5],
  [-50, -32.5],
  [-30, -22.5],
  [-20, -17.5],
  [-15, -13.75],
  [-10, -10],
  [0, 0],
  [27.5, 27.5],
  [30, 28.75],
  [50, 38.75],
  [80, 53.75],
  [90, 63.75],
] as const;
const VS_NEEDLE = [
  [-6000, -76.6],
  [-4000, -74.8],
  [-2000, -73],
  [-1500, -70.2],
  [-1000, -66.5],
  [-750, -59.8],
  [-500, -49],
  [-250, -30.1],
  [0, 0],
  [250, 30.1],
  [500, 49],
  [750, 59.8],
  [1000, 66.5],
  [1500, 70.2],
  [2000, 73],
  [4000, 74.8],
  [6000, 76.6],
] as const;
const VS_DIGIT = [
  [-6000, 340],
  [-4000, 302],
  [-2000, 269],
  [-1500, 230],
  [-1000, 197],
  [-500, 110],
  [-200, 61],
  [0, 0],
  [200, -61],
  [500, -110],
  [1000, -197],
  [1500, -230],
  [2000, -269],
  [4000, -302],
  [6000, -340],
] as const;

/** the speed's place on the tape [kt above its bottom: 30 kt] (PFD.nas: clamped 30…420) */
const tape = (kt: number) => clamp(kt, 30, 420) - 30;
// (the altitude's drums: FlightGear's Geneva drives — a digit rolls over in the last fifth of its unit)
const geneva10k = (x: number) => Math.floor(x / 100) + ((x / 10) % 1 < 0.9 || (x / 100) % 1 < 0.9 ? 0 : Math.max(0, ((x % 1) - 0.8) * 5));
const geneva1k = (x: number) => Math.floor(x / 10) + ((x / 10) % 1 < 0.9 ? 0 : Math.max(0, ((x % 1) - 0.8) * 5));
const geneva100 = (x: number) => Math.floor(x) + Math.max(0, ((x % 1) - 0.8) * 5);
const roundAlt = (x: number) => (x * 0.2 - Math.trunc(x * 0.2) < 0.5 ? 5 * Math.trunc(x * 0.2) : 5 + 5 * Math.trunc(x * 0.2));
const pad = (n: number, w: number) => String(Math.abs(Math.trunc(n))).padStart(w, "0");

export class Pfd extends Display {
  override hz = 20;
  /** the aircraft symbol's centre (AI_center's), the turn's pivot */
  private ai: [number, number] = [445.26, 513.17];
  /** the trend shown (−1, 0, 1: PFD.nas's hysteresis) */
  private trendShown = 0;
  private e = (id: string): El => this.doc!.get(id);

  constructor(side: 0 | 1 = 0) {
    super(side, pfdSvg);
  }

  protected override init(doc: SvgDoc) {
    this.ai = doc.get("AI_center").getCenter();
    // (PFD.nas's start: what nothing drives yet, the failures' flags, the tests' and the FMGC's marks)
    for (const id of [
      "FMA_catmode",
      "FMA_cattype",
      "FMA_catmode_box",
      "FMA_cattype_box",
      "FMA_cat_box",
      "spdLimError",
      "FMA_dh_box",
      "LOC_scale",
      "GS_scale",
      "AI_error",
      "HDG_error",
      "VS_error",
      "ASI_error",
      "ALT_error",
      "machError",
      "ilsError",
      "ASI_buss",
      "ASI_buss_ref",
      "ASI_buss_ref_blue",
      "ALT_box_flash",
      "ALT_box_amber",
      "AI_bank_lim_X",
      "AI_pitch_lim_X",
      "ALPHA_SW",
      "FPV",
      "FPD",
      "vdev_dot",
      "vdev_low",
      "vdev_high",
      "ECON_range_high",
      "ECON_range_low",
      "FMA_ctr_msg",
      "FMA_ctr_msg-10",
      "FMA_ctr_msg-11",
      "FMA_Middle2",
      "outerMarker",
      "middleMarker",
      "innerMarker",
      "v1_group",
      "v1_text",
      "vr_speed",
      "tailstrikeInd",
      "FMA_lvrclb",
      "vsFMArate",
      "ILS_HDG_L",
      "ILS_HDG_R",
      "CRS_pointer",
      "HDG_digit_L",
      "HDG_digit_R",
      "HDG_target",
      "FMA_nodh",
      "FMA_dh",
      "FMA_dhn",
    ])
      doc.get(id).hide();
  }

  draw(ctx: Ctx, d: DuData, _t: number) {
    const doc = this.doc;
    if (!doc) return;
    const e = this.e;
    const [cx, cy] = this.ai;
    // ---- attitude: translated by the pitch, then turned about the aircraft symbol (the pitch's shift turned with the
    // horizon — FlightGear's transforms in that order)
    const roll = d.roll;
    const r = -roll * D2R;
    const sr = Math.sin(r),
      cr = Math.cos(r);
    const turned = (el: El, tx: number, ty: number) => el.setRotation(r, [cx, cy]).setTranslation(cr * tx - sr * ty, sr * tx + cr * ty);
    const p = table(PITCH, d.pitch);
    // (the ground's own pitch: its line held at the runway near the ground — Systems/pfd.xml's Ground Horizon)
    const agl = d.ra ?? 2500;
    const groundShift = clamp(
      table(
        [
          [1, 0],
          [150, 17.35],
        ],
        agl,
      ) + clamp(p, d.onGround ? -17.35 : 0, 17.35),
      -17.35,
      17.35,
    );
    turned(e("AI_horizon"), 0, p * 11.825);
    turned(e("AI_horizon_ground"), 0, groundShift * 11.825);
    turned(e("AI_horizon_sky"), 0, 0);
    // (the heading marks on the horizon: the heading tape's offset)
    const hdg = d.heading;
    const h10 = hdg / 10;
    const off = h10 - Math.trunc(h10);
    const middleOffset = off > 0.5 ? -(off - 1) * 98.5416 : -off * 98.5416;
    turned(e("AI_heading"), middleOffset, clamp(p, -17.35, 17.35) * 11.825);
    // (the bank scale turns with the roll about the symbol — its own frame shifted 3 px: AI_bank's translate)
    e("AI_bank").setRotation(r, [cx + 3, cy]);
    e("AI_agl_g").setRotation(r, [cx + 3, cy + 1.4]);
    e("AI_slipskid").setTranslation(clamp(d.slip, -15, 15) * 7, 0);
    // (the law's limits: green "=" in normal law, amber crosses otherwise)
    const normal = d.law === "normal";
    e("AI_bank_lim").setVisible(normal);
    e("AI_pitch_lim").setVisible(normal);
    e("AI_bank_lim_X").setVisible(!normal);
    e("AI_pitch_lim_X").setVisible(!normal);
    // (the flight directors: shown with the FD on and the attitude within their limits)
    const fd = !!d.fma.fd && d.pitch < 25 && d.pitch > -13 && Math.abs(roll) < 45;
    e("FD_roll").setVisible(fd);
    e("FD_pitch").setVisible(fd);
    // (the side stick's place, on the ground: the deck's sidestick)
    const stick = d.onGround && d.eng.some((x) => x.running);
    e("AI_stick").setVisible(stick);
    e("AI_stick_pos").setVisible(stick);
    if (stick)
      e("AI_stick_pos").setTranslation(
        Number(d.deck["controls/flight/aileron"] ?? 0) * 196.8,
        Number(d.deck["controls/flight/elevator"] ?? 0) * 151.5,
      );
    // ---- the radio altitude: under 2500 ft, rounded (10 ft above 50, 5 ft above 5), amber under 400 ft without a DH
    const ra = d.ra;
    if (ra !== null) {
      const k = ra >= 50 ? 10 : ra >= 5 ? 5 : 1;
      const agl = e("AI_agl").show();
      agl.setText(String(Math.round(clamp(ra, 0, 2500) / k) * k));
      agl.setColor(ra <= 400 ? AMBER : GREEN);
      for (const run of agl.runs) run.style = { ...run.style, fontSize: ra <= 400 ? 55 : 45 };
    } else e("AI_agl").hide();
    // (the ground: the tape's red band coming up under 565 ft)
    const gnd = ((ra ?? 9999) / 100) * 48.66856;
    e("ground").setTranslation(0, gnd);
    e("ground_ref")
      .setTranslation(0, gnd)
      .setVisible((ra ?? 9999) <= 565);
    // ---- the speed tape
    const ias = d.ias;
    const ASI = tape(ias);
    e("ASI_scale").setTranslation(0, ASI * 6.6);
    const mark = (id: string, kt: number) => e(id).setTranslation(0, (tape(kt) - ASI) * -6.6);
    // (VMAX: below 60 kt data.ts's is the Mach's limit read at no speed — VMO's there)
    const vmax = d.vmax > 60 ? d.vmax : 350;
    mark("ASI_max", vmax);
    mark("VPROT_MAX", vmax + 6);
    e("VPROT_MAX").setVisible(normal);
    const air = !d.onGround;
    // (VLS, α prot, α max: in flight; α max and α prot in normal law, the stall warning's otherwise)
    e("VLS_min").setVisible(air);
    e("ALPHA_PROT").setVisible(air && normal);
    e("ALPHA_MAX").setVisible(air && normal);
    e("ALPHA_SW").setVisible(air && !normal);
    mark("VLS_min", d.vls);
    mark("ALPHA_PROT", d.vaprot);
    mark("ALPHA_MAX", d.vamax);
    mark("ALPHA_SW", d.vamax);
    // (the next configuration's VFE: within 42 kt, not in FULL)
    const vfe = d.vfeNext;
    e("flap_max").setVisible(vfe !== null && Math.abs(vfe - ias) <= 42 && d.flapLever !== 4);
    if (vfe !== null) e("flap_max").setTranslation(0, (vfe - 30 - ASI) * -6.6);
    // (green dot clean, S in CONF 1, F in 2 and 3: within 42 kt)
    const lv = d.flapLever;
    e("clean_speed").setVisible(lv === 0 && Math.abs(d.greenDot - ias) <= 42);
    mark("clean_speed", d.greenDot);
    e("S_target").setVisible(lv === 1 && Math.abs(d.s - ias) <= 42 && agl >= 400);
    mark("S_target", d.s);
    e("F_target").setVisible((lv === 2 || lv === 3) && Math.abs(d.f - ias) <= 42 && agl >= 400);
    mark("F_target", d.f);
    // (the speed target: the FCU's or the FMGC's — A8)
    const tgt = d.targetSpeed;
    if (tgt === null) {
      for (const id of ["ASI_target", "ASI_digit_UP", "ASI_digit_DN", "ASI_decimal_UP", "ASI_decimal_DN"]) e(id).hide();
    } else {
      const diff = tgt - ias;
      e("ASI_target").setVisible(Math.abs(diff) <= 42);
      mark("ASI_target", tgt);
      e("ASI_digit_UP")
        .setVisible(diff > 42)
        .setText(Math.round(tgt).toString().padStart(3, " "));
      e("ASI_digit_DN")
        .setVisible(diff < -42)
        .setText(Math.round(tgt).toString().padStart(3, " "));
      e("ASI_decimal_UP").hide();
      e("ASI_decimal_DN").hide();
      for (const id of ["ASI_target", "ASI_digit_UP", "ASI_digit_DN"]) e(id).setColor(CYAN);
    }
    // (the trend arrow: 10 s ahead, shown past 2 kt — kept down to 1 kt)
    const trend = clamp(d.iasTrend, -50, 50);
    this.trendShown =
      trend >= 2 || (this.trendShown !== 0 && trend >= 1) ? 1 : trend <= -2 || (this.trendShown !== 0 && trend <= -1) ? -1 : 0;
    e("ASI_trend_up")
      .setVisible(this.trendShown === 1)
      .setTranslation(0, clamp(trend, 0, 50) * -6.6);
    e("ASI_trend_down")
      .setVisible(this.trendShown === -1)
      .setTranslation(0, clamp(trend, -50, 0) * -6.6);
    // (Mach: above 0.5)
    e("ASI_mach")
      .setVisible(d.mach >= 0.5)
      .setText(d.mach >= 0.999 ? ".999" : `.${pad(Math.round(d.mach * 1000), 3)}`);
    // ---- the altitude: the drums, the tape's labels every 500 ft, the target
    const alt = d.alt;
    const altAbs = Math.abs(alt);
    const altOffset = alt / 500 - Math.trunc(alt / 500);
    const midAltOffset = altOffset > 0.5 ? -(altOffset - 1) * 243.3424 : -altOffset * 243.3424;
    e("ALT_scale").setTranslation(0, -midAltOffset);
    const mid = roundAlt(alt / 100);
    e("ALT_five").setText(pad(mid + 10, 3));
    e("ALT_four").setText(pad(mid + 5, 3));
    e("ALT_three").setText(pad(mid, 3));
    e("ALT_two").setText(pad(mid - 5, 3));
    e("ALT_one").setText(pad(mid - 10, 3));
    e("ALT_neg").setVisible(alt < 0);
    e("ALT_tenthousands").setVisible(alt >= 0);
    e("ALT_thousands_zero").setVisible(altAbs >= 9900);
    const a = Math.trunc(altAbs);
    e("ALT_tenthousands").setTranslation(0, geneva10k((a % 100000) / 100) * 51.61);
    e("ALT_thousands").setTranslation(0, geneva1k((a % 10000) / 100) * 51.61);
    e("ALT_hundreds").setTranslation(0, geneva100((a % 1000) / 100) * 51.61);
    e("ALT_tens").setTranslation(0, (a % 100) * 1.498);
    // (the selected altitude: the FCU's — A8; within 565 ft on the tape, else its figure above or below)
    const ta = d.targetAlt;
    if (ta === null) for (const id of ["ALT_target", "ALT_digit_UP", "ALT_digit_DN", "ALT_digit_UP_metric"]) e(id).hide();
    else {
      const diff = ta - alt;
      e("ALT_target")
        .setVisible(Math.abs(diff) <= 565)
        .setTranslation(0, (diff / 100) * -48.66856);
      e("ALT_target_digit").setText(pad(Math.round(ta / 100), 3));
      const txt = d.baro.std ? `FL${String(Math.round(ta / 100)).padStart(3, " ")}` : String(Math.round(ta)).padStart(5, " ");
      e("ALT_digit_UP")
        .setVisible(diff > 565)
        .setText(txt);
      e("ALT_digit_DN")
        .setVisible(diff < -565)
        .setText(txt);
      for (const id of ["ALT_digit_UP", "ALT_digit_DN", "ALT_target"]) e(id).setColor(CYAN);
    }
    // (the metric altitude: the FCU's METRIC ALT button on — deckgame.ts deck/metric-alt — or the game's metric units)
    const metric = Number(d.deck["deck/metric-alt"] ?? 0) > 0.5 !== (d.units === "metric");
    for (const id of ["Metric_box", "Metric_letter", "Metric_cur_alt"]) e(id).setVisible(metric);
    e("Metric_cur_alt").setText(String(Math.round(alt * 0.3048)).padStart(5, " "));
    e("ALT_digit_UP_metric").setVisible(metric && ta !== null);
    if (ta !== null) e("ALT_digit_UP_metric").setText(`${String(Math.round(ta * 0.3048)).padStart(5, " ")}M`);
    // ---- the baro reference: STD, or QNH in hPa (in inHg with its knob)
    const std = d.baro.std;
    e("QNH").setVisible(!std);
    e("QNH_setting").setVisible(!std);
    e("QNH_std").setVisible(std);
    e("QNH_box").setVisible(std);
    const inhg =
      Number(d.deck[this.side === 0 ? "instrumentation/altimeter/inhg-left" : "instrumentation/altimeter/inhg-right"] ?? 0) > 0.5;
    e("QNH_setting").setText(inhg ? (d.baro.hpa * 0.02953).toFixed(2) : String(Math.round(d.baro.hpa)).padStart(4, " "));
    // ---- the vertical speed: the needle's table, the digits beside it (hundreds of ft/min, shown from 200),
    // amber past 6000 ft/min or descending hard near the ground
    const vs = d.vs;
    e("VS_pointer").setRotation(table(VS_NEEDLE, vs) * D2R, [513.0, -1049.7]);
    e("VS_box")
      .setTranslation(0, table(VS_DIGIT, vs))
      .setVisible(Math.abs(vs) >= 200);
    e("VS_digit").setText(pad(Math.round(Math.abs(vs) / 100), 2));
    const hot = Math.abs(vs) >= 6000 || (vs <= -2000 && agl <= 2500) || (vs <= -1200 && agl <= 1000);
    e("VS_digit").setColor(hot ? AMBER : GREEN);
    e("VS_pointer")
      .setColor(hot ? AMBER : GREEN)
      .setColorFill(hot ? AMBER : GREEN);
    // ---- the heading tape: its labels every 10°, big every 30°; the track's diamond
    e("HDG_scale").setTranslation(middleOffset, 0);
    let m = Math.round(h10);
    if (m === 36) m = 0;
    const lab = (k: number) => (((m + k) % 36) + 36) % 36;
    const ids = ["HDG_one", "HDG_two", "HDG_three", "HDG_four", "HDG_five", "HDG_six", "HDG_seven"];
    ids.forEach((id, i) => {
      const v = lab(i - 3);
      const el = e(id).setText(String(v));
      for (const run of el.runs) run.style = { ...run.style, fontSize: v % 3 === 0 ? 42 : 32 };
    });
    let trk = ((d.track - hdg + 540) % 360) - 180;
    if (d.gs < 5) trk = 0;
    e("TRK_pointer").setTranslation((clamp(trk, -23.62, 23.62) / 10) * 98.5416, 0);
    // ---- the ILS: its scales with the LS button (or an ILS flown), its diamonds when received, its name and DME
    const ls = Number(d.deck[this.side === 0 ? "modes/pfd/ILS1" : "modes/pfd/ILS2"] ?? 0) > 0.5;
    const ils = d.ils;
    const showIls = ls || !!ils;
    e("LOC_scale").setVisible(showIls);
    e("GS_scale").setVisible(showIls);
    e("LOC_pointer").setVisible(showIls && ils?.loc != null);
    e("GS_pointer").setVisible(showIls && ils?.gs != null);
    if (ils?.loc != null) e("LOC_pointer").setTranslation(clamp(ils.loc, -2.2, 2.2) * 98.5, 0);
    if (ils?.gs != null) e("GS_pointer").setTranslation(0, clamp(ils.gs, -2.2, 2.2) * -98.5);
    e("ils_code")
      .setVisible(showIls && !!ils)
      .setText(ils ? ils.id.replace(/^ILS\s*/, "").slice(0, 8) : "");
    e("ils_freq").setVisible(false);
    e("dme_dist")
      .setVisible(showIls && !!ils)
      .setText(ils ? (ils.dme < 19.95 ? ils.dme.toFixed(1) : ils.dme.toFixed(0)) : "");
    e("dme_dist_legend").setVisible(showIls && !!ils);
    // ---- the FMA (A8: the FMGC's modes; until then the thrust's when the levers are in a detent, A.FLOOR)
    const f = d.fma;
    const set = (id: string, s: string, col = GREEN) => e(id).setVisible(!!s).setText(s).setColor(col);
    const manual = f.thrust === "MAN TOGA" || f.thrust === "MAN FLX" || f.thrust === "MAN MCT";
    e("FMA_man").setVisible(manual);
    e("FMA_man_box").setVisible(manual);
    if (manual) {
      e("FMA_manmode").show().setText(f.thrust.slice(4));
      e("FMA_man_box").setColor(GREY);
    } else e("FMA_manmode").hide();
    e("FMA_flx_box").setVisible(f.thrust === "MAN FLX");
    e("FMA_flxmode").setVisible(f.thrust === "MAN FLX");
    e("FMA_flxtemp")
      .setVisible(f.thrust === "MAN FLX" && d.flexTemp !== null)
      .setText(d.flexTemp !== null ? `+${d.flexTemp}` : "");
    set("FMA_thrust", manual ? "" : f.thrust, f.thrust === "A.FLOOR" ? AMBER : GREEN);
    e("FMA_thrust_box").setVisible(f.thrust === "A.FLOOR");
    const modes = !!(f.fd || f.ap);
    set("FMA_pitch", modes ? f.vert : "");
    set("FMA_roll", modes ? f.lat : "");
    set("FMA_pitcharm", modes ? f.vertArmed : "", CYAN);
    set("FMA_pitcharm2", "", CYAN);
    set("FMA_rollarm", modes ? f.latArmed : "", CYAN);
    e("FMA_combined").hide();
    for (const id of ["FMA_pitch_box", "FMA_roll_box", "FMA_pitcharm_box", "FMA_rollarm_box", "FMA_combined_box"]) e(id).hide();
    set("FMA_ap", f.ap, WHITE);
    set("FMA_fd", f.fd, WHITE);
    set("FMA_athr", f.athr, f.athr ? WHITE : CYAN);
    for (const id of ["FMA_ap_box", "FMA_fd_box", "FMA_athr_box"]) e(id).hide();
    e("FMA_Middle1").show();
    doc.draw(ctx, 1024, 1024, fontOf);
  }
}
