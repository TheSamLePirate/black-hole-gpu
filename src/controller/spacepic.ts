// The CameraController — the spacecraft's sensors (radar/space.ts, docs/PLAN-RADAR-AAA.md RD4): five times a second,
// flying the Ranger, the Lander or the Endurance in our universe, the craft about held by its own sensors — the space
// station, the fleet's other craft and the room's players (their navigation sent: the datalink) —, on its LVLH axes
// about the body it orbits (the Earth, the Moon…): what the HUD's space scope draws, the crew's lists, the tools.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { fleet } from "../fleet";
import { buildSpacePicture, SPACE_SENSORS, type SpaceObject, type SpaceTrack, type V3 } from "../radar/space";
import { solarBody } from "../system/solar";
import { BODY_NAMES, type Body, isCraft, isNetTarget, netTargets, ourTarget, targetCrafts } from "../targeting";
import { C_MPS, M_METRES } from "../units";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    spacePicStep: typeof spacePicStep;
    /** the spacecraft's picture now (RD4): the body it is about, its tracks on its LVLH axes, the nearest first */
    spacePic: SpacePic | null;
  }
}

/** The spacecraft's picture: the body it is about and that body's state (home frame [M, c]), our own place and velocity
 *  about it [m, m/s], its tracks on our LVLH axes (the nearest first), when it was built [wall ms]. */
export interface SpacePic {
  ref: string;
  refPos: number[];
  refVel: number[];
  own: { p: V3; v: V3 };
  tracks: SpaceTrack[];
  at: number;
}

/** The cross-sections the radar sees [m²]: the station's, each craft's (its hull and panels), a player's. */
const RCS: Record<string, number> = { iss: 2000, endurance: 800, lander: 60, ranger: 30 };
/** beyond this [m], nothing (another world's craft, the wormhole's far side) */
const FAR = 2e9;

function spacePicStep(this: CameraController, wallMs: number) {
  const s = this.s;
  const spec = SPACE_SENSORS[fleet.active];
  if (!spec || !s.ship) {
    this.spacePic = null;
    return;
  }
  if (this.spacePic && wallMs - this.spacePic.at < 200) return;
  const nav = this.ourNav(cameraFrame(s));
  const body = nav ? solarBody(nav.ref) : null;
  if (!nav || !body || nav.ref === "sun") {
    this.spacePic = null;
    return;
  }
  // (one inertial frame about the body's centre [m, m/s])
  const P = (x: readonly number[]): V3 => [
    (x[0]! - nav.refPos[0]!) * M_METRES,
    (x[1]! - nav.refPos[1]!) * M_METRES,
    (x[2]! - nav.refPos[2]!) * M_METRES,
  ];
  const Vv = (v: readonly number[]): V3 => [
    (v[0]! - nav.refVel[0]!) * C_MPS,
    (v[1]! - nav.refVel[1]!) * C_MPS,
    (v[2]! - nav.refVel[2]!) * C_MPS,
  ];
  const own = { p: P(nav.X), v: Vv(nav.V) };
  const objects: SpaceObject[] = [];
  const ids: Body[] = [...(s.iss ? (["iss"] as Body[]) : []), ...targetCrafts(s), ...netTargets.list()];
  const radius = body.radius * M_METRES;
  for (const b of ids) {
    // (where each truly is — a craft with no pose, a player with no sample: left out, not put at the body's centre as
    // the target's fallback does)
    const craft = isCraft(b);
    const net = isNetTarget(b);
    if (craft && !fleet.pose(b, nav.t)) continue;
    if (net && !netTargets.state(b, nav.t)) continue;
    const T = ourTarget(s, b, nav.t);
    const p = P(T.pos);
    if (Math.hypot(...p) < radius) continue;
    if (Math.hypot(p[0] - own.p[0], p[1] - own.p[1], p[2] - own.p[2]) > FAR) continue;
    objects.push({
      id: String(b),
      name: BODY_NAMES[b] ?? String(b),
      p,
      v: Vv(T.vel),
      rcs: RCS[String(b)] ?? 30,
      datalink: craft || net,
      kind: b === "iss" ? "station" : net ? "player" : "craft",
    });
  }
  this.spacePic = {
    ref: nav.ref,
    refPos: [...nav.refPos],
    refVel: [...nav.refVel],
    own,
    tracks: buildSpacePicture(own, objects, spec, radius),
    at: wallMs,
  };
}

export function installSpacePic(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { spacePicStep });
}
