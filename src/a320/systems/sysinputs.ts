// The game's figures put on the systems' bag under FlightGear's names (docs/PLAN-A320.md, A10 — inputs.md lists what
// FlightGear's JSBSim system files read and none of them writes): the engines' spools and EGT (the FADEC's, fadec.ts),
// the APU's own (its Nasal module spools it), the air data, the gear on the ground, the tanks' contents, the time since
// the flight began. Pure.

import type { Props } from "../rig";

/** The flight's figures for the systems, a frame's. */
export interface SysFrame {
  /** the time since the flight began [s] (the generators' line contactors close after 10 s) */
  elapsed: number;
  lat: number;
  lon: number;
  /** over the ellipsoid [ft], the gear over the ground [ft], the vertical speed [ft/min] */
  altFt: number;
  aglFt: number;
  vsFpm: number;
  onGround: boolean;
  /** the gear's extension 0…1 */
  gear: number;
  /** the indicated airspeed, the ground speed [kt], the Mach number */
  ias: number;
  gs: number;
  mach: number;
  /** the total and the static air's temperatures [°C], the static pressure [inHg] */
  tatC: number;
  oatC: number;
  staticInHg: number;
  /** the angle of attack [deg], the flaps' and the slats' angles [deg] */
  alphaDeg: number;
  flapDeg: number;
  slatDeg: number;
  /** each engine: N1, N2 [%], EGT [°C], fuel flow [kg/s] */
  engines: { n1: number; n2: number; egt: number; ff: number }[];
  /** the five tanks [kg]: left outer, left inner, centre, right inner, right outer (fcs.ts TANKS_KG) */
  tanks: number[];
  /** the thrust levers' detent ("TOGA", "MCT", "CL", "IDLE"…), the fuel used by each engine [kg] (the systems' count:
   *  index.ts) */
  detent: string;
  fuelUsed?: [number, number];
}

const LB = 2.204623;
const GAL = 3.0283; // kg of Jet A in a US gallon

/** The frame's figures on the bag. */
export function putInputs(P: Props, f: SysFrame) {
  P["sim/time/elapsed-sec"] = f.elapsed;
  P["sim/freeze/master"] = 0;
  P["position/latitude-deg"] = f.lat;
  P["position/longitude-deg"] = f.lon;
  P["position/altitude-ft"] = f.altFt;
  P["position/gear-agl-ft"] = Math.max(f.aglFt, 0);
  P["velocities/vertical-speed-fps"] = f.vsFpm / 60;
  // (on the wheels: the main gear's and the nose's, JSBSim's own)
  const wow = f.onGround ? 1 : 0;
  for (const k of ["", "[1]", "[2]"]) {
    P[`gear/gear${k}/wow`] = wow;
    P[`gear/gear${k}/position-norm`] = f.gear;
    P[`gear/gear${k}/compression-norm`] = f.onGround ? 0.3 : 0;
  }
  P["fdm/jsbsim/position/wow"] = wow;
  P["fdm/jsbsim/gear/unit/WOW"] = wow;
  // (the speeds, the air)
  P["velocities/airspeed-kt"] = f.ias;
  P["instrumentation/airspeed-indicator/indicated-speed-kt"] = f.ias;
  P["instrumentation/airspeed-indicator/indicated-mach"] = f.mach;
  P["fdm/jsbsim/velocities/vc-kts"] = f.ias;
  P["velocities/groundspeed-kt"] = f.gs;
  P["fdm/jsbsim/propulsion/tat-c"] = f.tatC;
  P["environment/temperature-degc"] = f.oatC;
  P["accelerations/pilot-gdamped"] = 1;
  P["fdm/jsbsim/aero/alpha-deg"] = P["fdm/jsbsim/aero/alpha-deg-fixed"] = f.alphaDeg;
  P["fdm/jsbsim/fcs/flap-pos-deg"] = f.flapDeg;
  P["fdm/jsbsim/fcs/slat-pos-deg"] = f.slatDeg;
  // (the ADRs' sensors: the three static ports and pitots, the altimeters, the radio altimeters)
  const qc = f.staticInHg * ((1 + 0.2 * (f.mach * f.mach)) ** 3.5 - 1);
  for (const k of ["", "[1]", "[2]"]) {
    P[`systems/static${k}/pressure-inhg`] = f.staticInHg;
    P[`systems/pitot${k}/measured-total-pressure-inhg`] = f.staticInHg + qc;
  }
  for (const k of ["", "[1]", "[2]", "[3]", "[4]", "[5]"]) {
    P[`instrumentation/altimeter${k}/indicated-altitude-ft`] = f.altFt;
    P[`instrumentation/altimeter${k}/pressure-alt-ft`] = f.altFt;
  }
  P["instrumentation/altimeter/mode-c-alt-ft"] = P["instrumentation/altimeter/mode-s-alt-ft"] = f.altFt;
  P["instrumentation/radar-altimeter/radar-altitude-ft"] = P["instrumentation/radar-altimeter[1]/radar-altitude-ft"] = Math.max(f.aglFt, 0);
  // (the engines: the FADEC's spools and EGT)
  f.engines.forEach((e, k) => {
    const E = k ? "engines/engine[1]" : "engines/engine";
    P[`${E}/n1-actual`] = P[`${E}/n1`] = e.n1;
    P[`${E}/n2-actual`] = P[`${E}/n2`] = e.n2;
    P[`${E}/egt-actual`] = P[`${E}/egt-degc`] = e.egt;
    P[`${E}/fuel-flow_pph`] = e.ff * 3600 * LB;
    P[`fdm/jsbsim/propulsion/engine${k ? "[1]" : ""}/fuel-used-lbs`] = (f.fuelUsed?.[k] ?? 0) * LB;
    P[`systems/fadec/control-${k + 1}/detent-text`] = f.detent;
  });
  // (the tanks — FlightGear's FDM numbers them as the game: the outer and inner wings', the centre's —, the engines'
  // and the APU's feed lines full while their side has fuel)
  f.tanks.forEach((kg, k) => {
    P[`fdm/jsbsim/propulsion/tank${k ? `[${k}]` : ""}/contents-lbs`] = kg * LB;
    P[`consumables/fuel/tank${k ? `[${k}]` : ""}/level-kg`] = kg;
    P[`consumables/fuel/tank${k ? `[${k}]` : ""}/level-gal_us`] = kg / GAL;
  });
  const left = f.tanks[0]! + f.tanks[1]! + f.tanks[2]! / 2,
    right = f.tanks[3]! + f.tanks[4]! + f.tanks[2]! / 2;
  P["fdm/jsbsim/propulsion/tank[5]/contents-lbs"] = left > 1 ? 50 : 0;
  P["fdm/jsbsim/propulsion/tank[6]/contents-lbs"] = right > 1 ? 50 : 0;
  P["fdm/jsbsim/propulsion/tank[7]/contents-lbs"] = left + right > 1 ? 10 : 0;
}
