// The F-35's cockpit from the flight (docs/PLAN-F35.md, F5): what its panoramic display shows (src/f35/pcd.ts),
// read off the controller each time the display is drawn — where it is, how it flies, its engine, its fuel,
// its surfaces, its STOVL mode, the airfields near it.

import { cameraFrame } from "../camera";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import { SITES } from "../game/sites";
import type { Settings } from "../settings";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { toBodyFixed } from "../system/our-surface";
import { C_MPS, M_METRES } from "../units";
import { VESSELS } from "../vessels";
import { dryThrust, fuelFlow } from "./engine";
import type { F35Pose } from "./model";
import type { PcdData, PcdField } from "./pcd";
import { STOVL } from "./stovl";

type V3 = [number, number, number];

const FIELDS: PcdField[] = SITES.filter((s) => s.body === "earth" && s.runway).map((s) => ({
  name: s.name,
  icao: s.icao,
  lat: s.lat,
  lon: s.lon,
  rwy: s.rwy,
}));

/** The display's data now (null: not over the Earth). */
export function pcdData(
  c: CameraController,
  s: Settings,
  pose: F35Pose | null,
  alerts: { text: string; level: "warning" | "caution" | "advisory" }[],
  date: Date,
): PcdData | null {
  const cam = cameraFrame(s);
  const nav = c.ourNav(cam);
  const fr = c.sfFrame(cam);
  if (!nav || nav.ref !== "earth" || !fr) return null;
  const q = toBodyFixed("earth", nav.X, nav.t);
  const geo = cartToGeodetic(WGS84_A, WGS84_F, [q[0] * M_METRES, q[1] * M_METRES, q[2] * M_METRES]);
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const v = fr.vRel as V3;
  const vs = dot(v, fr.up as V3);
  const ve = dot(v, fr.east as V3),
    vn = dot(v, fr.north as V3);
  const att = c.attitudeNow() as { pitch?: number; bank?: number; heading?: number };
  const L = c.airFlight.last;
  const V = VESSELS.f35;
  const mass = fleet.massProps().mass;
  const toMs2 = C_MPS ** 2 / (1476.625 * s.massSolar);
  const e = c.jetAir();
  const dry = c.pilot.engineNow * c.thrustMax() * toMs2 * mass;
  const thrust = dry * c.jetThrust();
  const fuel = fleet.fuel.f35 ?? V.fuelKg ?? 0;
  const st = c.stovl;
  const m = c.jetModes;
  return {
    time: date,
    lat: (geo.lat * 180) / Math.PI,
    lon: (geo.lon * 180) / Math.PI,
    alt: geo.h,
    agl: fr.h,
    heading: att.heading ?? 0,
    pitch: att.pitch ?? 0,
    bank: att.bank ?? 0,
    track: Math.hypot(ve, vn) > 1 ? Math.atan2(ve, vn) : (att.heading ?? 0),
    tas: L?.speed ?? 0,
    gs: Math.hypot(ve, vn),
    vs,
    mach: L ? L.speed / Math.max(L.air.a, 1) : 0,
    g: c.airFlight.g,
    gPeak: c.airFlight.gPeak,
    alpha: L?.out.alpha ?? 0,
    wind: c.windNow ?? null,
    throttle: c.pilot.throttle,
    spool: c.pilot.engineNow,
    ab: c.abLevel,
    thrust,
    flow: V.turbofan && fuel > 0 ? fuelFlow(V.turbofan, thrust, dry, Math.max(e.sigma, 0.1)) : 0,
    fuel,
    fuelFull: V.fuelKg ?? 0,
    mass,
    surfaces: pose ? { stab: pose.stab, flaperon: pose.flaperon, lef: pose.lef, rudder: pose.rudder } : null,
    gear: c.gearExt,
    flaps: c.airFlight.cfg.flaps ?? 0,
    brake: c.airFlight.cfg.brake ?? 0,
    onGround: !!c.rolling || !!c.ourLanded,
    stovl:
      st.on || st.conv > 0
        ? { on: st.on, conv: st.conv, swivel: st.swivel, hover: st.hover, vz: st.vz, heavy: st.heavy, clutch: st.clutch }
        : null,
    liftMax: V.turbofan ? dryThrust(V.turbofan, e.mach, Math.max(e.sigma, 0)) * STOVL.boost : 0,
    ap: { alt: m.alt, hdg: m.hdg, spd: m.spd },
    fields: FIELDS,
    route: c.nav.route.wps.length
      ? {
          wps: c.nav.route.wps,
          active: c.nav.lnav?.active ?? 1,
          l: c.nav.on.l,
          v: c.nav.on.v,
          dist: c.nav.last.l?.dist ?? NaN,
          ete: c.nav.last.l?.ete ?? NaN,
          xtk: c.nav.last.l?.xtk ?? 0,
        }
      : null,
    bingo: c.routeBingo(),
    alerts,
  };
}

/** The helmet's avionics block (the F-35's status, ui/hud/symbology.ts drawAvionics): its engine, its fuel and the
 *  bingo, its configuration, its autopilot's modes, its STOVL, its damage in a fight. */
export function avionicsData(c: CameraController, s: Settings) {
  const V = VESSELS.f35;
  const mass = fleet.massProps().mass;
  const toMs2 = C_MPS ** 2 / (1476.625 * s.massSolar);
  const e = c.jetAir();
  const dry = c.pilot.engineNow * c.thrustMax() * toMs2 * mass;
  const thrust = dry * c.jetThrust();
  const fuel = fleet.fuel.f35 ?? V.fuelKg ?? 0;
  const flow = V.turbofan && fuel > 0 ? fuelFlow(V.turbofan, thrust, dry, Math.max(e.sigma, 0.1)) : 0;
  const m = c.jetModes;
  return {
    spool: c.pilot.engineNow,
    throttle: c.pilot.throttle,
    thrustKn: thrust / 1000,
    ab: c.abLevel,
    fuel,
    full: V.fuelKg ?? 0,
    flow,
    bingo: c.routeBingo(),
    infiniteFuel: s.f35InfiniteFuel,
    gear: c.gearExt,
    flaps: c.airFlight.cfg.flaps ?? 0,
    brake: c.airBrake,
    ap: { alt: m.alt !== null, hdg: m.hdg !== null, spd: m.spd !== null, lnav: c.nav.on.l, vnav: c.nav.on.v },
    stovl: c.stovl.on ? (c.stovl.hover ? "HOVER" : c.stovl.conv < 1 ? "CONV" : "STOVL") : null,
    damage: c.combat?.world.damage ?? 0,
    gLimit: s.f35GLimit,
  };
}
