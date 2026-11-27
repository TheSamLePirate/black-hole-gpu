import type { CameraController } from "../controls";
/** Shared control/telemetry for the panel, automation and TARS. */
export function airportExperience(camera: CameraController, enabled?: boolean) {
  const scene = camera.trafficAirport;
  if (!scene) return { active: false, enabled: false, network: null, weather: null, aircraft: [] };
  if (enabled !== undefined && scene.activity) {
    scene.activity.enabled = enabled;
    if (!enabled) scene.activity.clear();
  }
  return {
    active: true,
    code: scene.code,
    enabled: scene.activity?.enabled ?? false,
    network: scene.net?.source ?? null,
    weather: scene.weather ? { source: scene.weather.source, report: scene.weather.report, wind: scene.weather.wind } : null,
    aircraft: camera.trafficNow().map((c) => ({
      id: c.id,
      type: c.type,
      source: c.provenance ?? "observed",
      phase: c.phase,
      crabDeg: ((c.crab ?? 0) * 180) / Math.PI,
      airspeed: c.airspeed,
      age: c.age,
    })),
  };
}
