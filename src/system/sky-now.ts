// The sky where the camera stands, in figures (PLAN-CIEL C3, for TARS's telemetry "sky"): the world under it
// and its height, the Sun's and the Moon's altitude and azimuth — true, and as seen through the Earth's air
// (its refraction: the tracer's model, refraction.ts) —, the refraction at the horizon there.

import { cameraFrame } from "../camera";
import type { Settings } from "../settings";
import { altAzOf, horizonAt } from "../skychart";
import { cameraHome } from "../targeting";
import { cartToGeodetic, flatteningOf } from "./ellipsoid";
import { apparentAltitude, bending } from "./refraction";
import { bodyAxes, M_METRES, seenFrom, solarBody, utcOf } from "./solar";
import { eclipseNow } from "../eclipse/earth-moon";

const D = Math.PI / 180;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface SkyBody {
  /** its altitude above the horizon, geometric [°] */
  altDeg: number;
  /** where it is seen through the air [°] (= altDeg without refraction) */
  apparentAltDeg: number;
  /** from the north through the east [°] */
  azDeg: number;
}

export interface SkyNow {
  /** the world under the camera, the place's geodetic latitude and longitude [°], its height above it [m] */
  over: string;
  latDeg: number;
  lonDeg: number;
  heightM: number;
  /** the Earth's refraction there (null: off, another world, above 120 km) */
  refraction: { refractivity: number; horizonArcmin: number } | null;
  sun: SkyBody;
  moon?: SkyBody;
  /** the eclipse under way here (PLAN-CIEL C11): its phase, the Sun's share hidden, the Moon's share in the umbra [%] */
  eclipse?: { phase: string; sunHiddenPct: number; moonInUmbraPct: number };
}

/** The sky now at the camera (null: not over a world of ours). n0: the air's sea-level refractivity drawn. */
export function skyNow(s: Settings, t: number, n0: number): SkyNow | null {
  const cam = cameraFrame(s, t);
  const hz = horizonAt(s, cam, t);
  if (!hz) return null;
  const X = cameraHome(s, cam);
  // (the place's geodetic latitude, longitude and height: on the Earth's ellipsoid, its normal the zenith)
  const A = bodyAxes(solarBody(hz.body)!, t);
  const v0 = [X[0] - hz.C[0], X[1] - hz.C[1], X[2] - hz.C[2]];
  const q: [number, number, number] = [0, 1, 2].map((i) => A[i]![0] * v0[0]! + A[i]![1] * v0[1]! + A[i]![2] * v0[2]!) as [
    number,
    number,
    number,
  ];
  const g = cartToGeodetic(hz.R, flatteningOf(hz.body), q);
  const h = g.h * M_METRES;
  const zb = [Math.cos(g.lat) * Math.cos(g.lon), Math.cos(g.lat) * Math.sin(g.lon), Math.sin(g.lat)];
  const eb = [-Math.sin(g.lon), Math.cos(g.lon), 0];
  const home = (b: number[]): [number, number, number] =>
    [0, 1, 2].map((i) => A[0]![i]! * b[0]! + A[1]![i]! * b[1]! + A[2]![i]! * b[2]!) as [number, number, number];
  const zenith = home(zb),
    east = home(eb);
  const north: [number, number, number] = [
    zenith[1] * east[2] - zenith[2] * east[1],
    zenith[2] * east[0] - zenith[0] * east[2],
    zenith[0] * east[1] - zenith[1] * east[0],
  ];
  const local = { ...hz, zenith, east, north };
  const air = hz.body === "earth" && s.refraction !== false && h < 120e3;
  const body = (id: string): SkyBody => {
    const p = seenFrom(id, t, X).pos;
    const v = [p[0] - X[0], p[1] - X[1], p[2] - X[2]];
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    const [alt, az] = altAzOf(local, [v[0]! / l, v[1]! / l, v[2]! / l]);
    return { altDeg: r3(alt), apparentAltDeg: r3(air ? apparentAltitude(alt * D, h, n0) / D : alt), azDeg: r1(az) };
  };
  const sun = body("sun");
  const moon = hz.body === "earth" ? body("moon") : undefined;
  const ecl = moon ? eclipseNow(g.lat, g.lon, h, utcOf(t), sun.altDeg, moon.altDeg) : null;
  return {
    over: hz.body,
    latDeg: r3((g.lat * 180) / Math.PI),
    lonDeg: r3((g.lon * 180) / Math.PI),
    heightM: Math.round(h),
    refraction: air ? { refractivity: Number(n0.toPrecision(4)), horizonArcmin: r1(bending(0, h, n0) / (D / 60)) } : null,
    sun,
    ...(moon ? { moon } : {}),
    ...(ecl && (ecl.phase || ecl.sunHidden > 0 || ecl.moonInUmbra > 0)
      ? { eclipse: { phase: ecl.phase || "none", sunHiddenPct: r1(ecl.sunHidden * 100), moonInUmbraPct: r1(ecl.moonInUmbra * 100) } }
      : {}),
  };
}
