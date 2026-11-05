// Q6-ISS ISS1 — the ISS live streams' cameras, where they are on the station (docs/progress/refraction-horizons/Q6-ISS.md, "ISS1"):
// each camera's mount in the station's frame (metres: x forward — flying +XVV —, y starboard, z nadir; iss.ts, the model's
// frame — scripts/build-iss.py) and its line of sight, a first estimate. The mounts are read from NASA's ISS model (ISS2.glb, its
// parts' bounding boxes: Columbus_BARTOLOMEO, Node2_Details_EHDC_5, IDA2); the lines of sight from the operators' descriptions —
// ISS2 fits them on the corpus's frames (the limb, coasts, the docked vehicle) and replaces these.

import type { Vec3 } from "../physics";

export type IssCameraId = "sen-nadir" | "sen-horizon" | "sen-docking" | "nasa-harmony";

export interface IssCamera {
  id: IssCameraId;
  /** its stream and how it is described by its operator */
  stream: "sen" | "nasa";
  description: string;
  /** its mount [m, station frame] — the part's box centre the camera sits on — and how sure that is */
  mount: Vec3;
  mountFrom: string;
  /** its line of sight (unit, station frame) — an estimate until ISS2 — and its horizontal field [°] when known */
  look: Vec3;
  fovDeg: number | null;
  status: "estimate" | "calibrated";
}

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
/** Bartolomeo's box (Columbus's forward face): x 13.25–15.61, y 2.59–8.68, z 4.54–6.45 — its centre */
const BARTOLOMEO: Vec3 = [14.43, 5.64, 5.5];
/** IDA-2's ring (Harmony forward, on PMA-2): x 15.46–16.09, y −0.86–1.06, z 4.73–6.46 — its centre */
const IDA2: Vec3 = [15.78, 0.1, 5.6];
/** Harmony's external HD camera 5 (Node2_Details_EHDC_5): x 12.75–14.14, y 1.70–2.42, z 4.70–5.07 — its centre */
const EHDC5: Vec3 = [13.45, 2.06, 4.89];

export const ISS_CAMERAS: readonly IssCamera[] = [
  {
    id: "sen-nadir",
    stream: "sen",
    description: "Sen SpaceTV-1, nadir: straight down at the Earth (~240 × 180 km on the ground)",
    mount: BARTOLOMEO,
    mountFrom: "Sen: SpaceTV-1 on Airbus's Bartolomeo, on Columbus; the model's Columbus_BARTOLOMEO box (the camera's place on it unknown)",
    look: [0, 0, 1],
    fovDeg: null,
    status: "estimate",
  },
  {
    id: "sen-horizon",
    stream: "sen",
    description: "Sen SpaceTV-1, horizon: a wide angle over the limb, the station's structure in view now and then",
    mount: BARTOLOMEO,
    mountFrom: "as the nadir camera's",
    // (forward and down: the limb at the top of its frame in the corpus — the horizon's dip at 420 km is 20.3°; the axis ~35° down)
    look: unit([Math.cos((35 * Math.PI) / 180), 0, Math.sin((35 * Math.PI) / 180)]),
    fovDeg: null,
    status: "estimate",
  },
  {
    id: "sen-docking",
    stream: "sen",
    description: "Sen SpaceTV-1, docking: along the station at the vehicle docked to Harmony's forward port (IDA-2)",
    mount: BARTOLOMEO,
    mountFrom: "as the nadir camera's; aimed at IDA-2 a few metres to port",
    look: unit([IDA2[0] - BARTOLOMEO[0], IDA2[1] - BARTOLOMEO[1], IDA2[2] - BARTOLOMEO[2]]),
    fovDeg: null,
    status: "estimate",
  },
  {
    id: "nasa-harmony",
    stream: "nasa",
    description: "NASA's ISS live view: a camera on Harmony looking forward at an angle, IDA-2 in view (the stream's description)",
    mount: EHDC5,
    mountFrom: "the model's Node2_Details_EHDC_5 (Harmony's external HD camera 5) — the likeliest match, not confirmed",
    look: unit([IDA2[0] - EHDC5[0], IDA2[1] - EHDC5[1], IDA2[2] - EHDC5[2]]),
    fovDeg: null,
    status: "estimate",
  },
];

/** a camera by its id */
export const issCamera = (id: IssCameraId) => ISS_CAMERAS.find((c) => c.id === id)!;
