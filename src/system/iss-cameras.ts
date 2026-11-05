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
  /** the picture's right (unit, station frame) where the ground's flow fixed it (ISS2, scripts/iss-flow-yaw.py) */
  right?: Vec3;
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
    // (Sen's footprint, ~240 × 180 km from ~420 km: 2 atan(120 / 420) ≈ 32° across — to be fitted on the coasts, ISS2)
    fovDeg: 32,
    status: "estimate",
  },
  {
    id: "sen-horizon",
    stream: "sen",
    description: "Sen SpaceTV-1, horizon: a wide angle over the limb, looking aft, the station's structure in view now and then",
    // (ISS2 — scripts/iss-mount-fit.ts: the structure lit over the limb in 50 frames of 5 Nov 2026 against the game's station mesh
    // seen from a grid of mounts: the best 13.5, 12.0, 5.5 — starboard, past Bartolomeo's platform box (y 2.6–8.7) —, the
    // picture mirrored, its intersection over union 0.78; the ten best within 0.72–0.78 all starboard, y 8.5–14.5 m: a loose fit,
    // a thin band of sky to fit on. The box's centre had the eye inside a part, the station over the picture's top)
    mount: [13.5, 12.0, 5.5],
    mountFrom: "fitted on the structure over the limb (scripts/iss-mount-fit.ts): starboard of Bartolomeo's box, ±2–3 m",
    // (ISS2, fitted on the limb — scripts/iss-limb-fit.py, 14 of 20 frames of 4 Nov 2026 within a few tenths: its axis 47.5° below
    // the horizontal, roll ~0°, horizontal field 95° (a pinhole, no distortion; residual 1–2 px) —; its yaw from the ground's flow —
    // scripts/iss-flow-yaw.py, 9 pairs of the dense capture of 5 Nov 2026: 180.7° (177.3–182.7), the predicted directions within
    // 1.1° of the observed —: aft, the ground streaming away towards the limb; a mirrored picture not told apart at this yaw)
    look: unit([-Math.cos((47.5 * Math.PI) / 180), 0, Math.sin((47.5 * Math.PI) / 180)]),
    // (the picture mirrored — the structure's fit prefers it, nine of its ten best —: its right to starboard; direct it would be to
    // port, the ground's flow not telling the two apart)
    right: [0, 1, 0],
    fovDeg: 95,
    status: "calibrated",
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
    description:
      "NASA's ISS live view: a fixed camera looking down at the Earth, a cover's edge in view — not the forward view at IDA-2 the stream describes (ISS0: IDA-2 never seen, 4 and 5 Nov 2026)",
    mount: EHDC5,
    mountFrom:
      "unknown — the model's Node2_Details_EHDC_5 (Harmony's external HD camera 5) kept as a place-holder: that camera looks forward at IDA-2, this one down",
    // (ISS2, the ground's flow — scripts/iss-flow-yaw.py --tilt 90, 9 pairs of the dense capture of 5 Nov 2026: the ground streams
    // to the picture's right, the right aft (89.0° from the direction of flight; directions within 0.2°); its horizontal field
    // 36° (σ 3.6°) from the flow's length — the frames' interval read from their capture times, ±1–2 s; the nadir assumed: the
    // flow even from the picture's top to its bottom, a small tilt along the track not excluded)
    look: [0, 0, 1],
    right: [-1, 0, 0],
    fovDeg: 36,
    status: "calibrated",
  },
];

/** a camera by its id */
export const issCamera = (id: IssCameraId) => ISS_CAMERAS.find((c) => c.id === id)!;
/** the cameras' ids, in the registry's order */
export const ISS_CAMERA_IDS = ["sen-nadir", "sen-horizon", "sen-docking", "nasa-harmony"] as const satisfies readonly IssCameraId[];

/** the field across the picture [°] a camera without one is drawn with */
export const ISS_DEFAULT_FOV = 60;

/** A camera's native framing on the station's axes (x ahead, y starboard, z nadir): its mount [m], its line of sight, the
 *  picture's up and right and its field across [°]. The up from its right where fitted — right × look —, turned to the zenith's
 *  side when that points down: a mirrored picture (`mirrored`: the stream's right is the game's left — the game draws it unmirrored);
 *  else the zenith's side of the view (the right look × zenith; the forward where it looks along the vertical). */
export function issCameraFrame(id: IssCameraId): { mount: Vec3; look: Vec3; up: Vec3; right: Vec3; fovDeg: number; mirrored: boolean } {
  const c = issCamera(id) ?? ISS_CAMERAS[0]!;
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = c.look;
  const vertical = Math.abs(f[2]) > 0.98;
  let right = c.right;
  if (!right) right = unit(cross(f, vertical ? [1, 0, 0] : [0, 0, -1]));
  let up = unit(cross(right, f));
  // (z nadir: an up with z > 0 points down)
  const mirrored = !vertical && up[2] > 0;
  if (mirrored) up = [-up[0], -up[1], -up[2]];
  return { mount: c.mount, look: f, up, right, fovDeg: c.fovDeg ?? ISS_DEFAULT_FOV, mirrored };
}
