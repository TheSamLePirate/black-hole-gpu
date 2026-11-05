// Q6-ISS ISS4 — the live streams' cameras on the station as the player picks them (system/iss-cameras.ts the registry,
// camera/subjectcam.ts the view, main.ts issCameraView the one action the Camera panel, TARS and __bh take): their names and
// what they show, in the interface's language.

import { t } from "../i18n";
import { ISS_CAMERA_IDS, issCamera, type IssCameraId } from "../system/iss-cameras";

/** a camera's short name */
export function issCameraLabel(id: IssCameraId): string {
  switch (id) {
    case "sen-nadir":
      return t("Sen — nadir");
    case "sen-horizon":
      return t("Sen — horizon, looking aft");
    case "sen-docking":
      return t("Sen — docking port");
    case "nasa-harmony":
      return t("NASA — live view, nadir");
  }
}

/** what its framing comes from: fitted on the live stream, or estimated from its operator's description */
export function issCameraStatus(id: IssCameraId): string {
  return issCamera(id).status === "calibrated" ? t("calibrated on the live stream") : t("estimated from its description");
}

/** the cameras, for a list: id, name, status, field across [°] (null: none known) */
export function issCameraList(): { id: IssCameraId; label: string; status: string; calibrated: boolean; fovDeg: number | null }[] {
  return ISS_CAMERA_IDS.map((id) => {
    const c = issCamera(id);
    return { id, label: issCameraLabel(id), status: issCameraStatus(id), calibrated: c.status === "calibrated", fovDeg: c.fovDeg };
  });
}
