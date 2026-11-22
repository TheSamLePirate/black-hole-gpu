// Simulator adapter for the Linux On-Board Computer (OBC) — bridges live __bh / engine state
// (WGS84 geodesy, ground relief AGL, flight/air state, orbital elements, Kerr time dilation,
// controls, autopilot, voice) to `ObcRuntime`.

import type { Speech } from "../audio/voice";
import { warpFactor } from "../clock";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import type { GameTools } from "../game/tools";
import type { Settings } from "../settings";
import type { Simulation } from "../sim";
import { geoidDeg } from "../system/geoid-grid";
import { bodyFixedOf, heightOverGround } from "../system/our-surface";
import { M_SECONDS } from "../system/solar";
import { isAircraft, type VesselId } from "../vessels";
import type { ObcHostAdapter } from "./bridge";
import type { ObcCommand, ObcCommandResult, ObcTelemetry } from "./types";

export interface SimObcDeps {
  camera: CameraController;
  sim: Simulation;
  settings: Settings;
  tools: GameTools;
  voice: Speech;
  isFrozen: () => boolean;
  lastDt: () => number;
}

const R2D = 180 / Math.PI;
const fin = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** Convert `camera.attitudeNow()` radians (`{ heading, pitch, bank }`) to aviation degrees matching `src/a320/du/data.ts`. */
export function radAttitudeToDeg(att: { heading?: number; pitch?: number; bank?: number } | null | undefined): {
  heading_deg: number;
  pitch_deg: number;
  roll_deg: number;
} {
  const rawHdg = fin(att?.heading, 0) * R2D;
  const heading_deg = ((rawHdg % 360) + 360) % 360;
  const pitch_deg = Math.max(-90, Math.min(90, fin(att?.pitch, 0) * R2D));
  const roll_deg = Math.max(-180, Math.min(180, fin(att?.bank, 0) * R2D));
  return { heading_deg, pitch_deg, roll_deg };
}

export function createSimObcAdapter(d: SimObcDeps): ObcHostAdapter {
  let stickTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    sampleTelemetry(): ObcTelemetry {
      const { camera, sim, settings, tools } = d;
      const vesselId: VesselId = fleet.active ?? "ranger";
      const aircraft = isAircraft(vesselId);
      const st = tools.status();
      const geo = camera.geoNow?.() ?? null;
      const att = camera.attitudeNow?.() ?? null;
      const info = camera.piloting ? camera.flightInfo() : null;
      const af = (camera as unknown as { airFlight?: { last?: Record<string, unknown> } }).airFlight?.last ?? null;
      const pilot = camera.pilot;
      const body = String(st?.soi ?? "earth");

      const latDeg = fin(geo?.lat, 0);
      const lonDeg = fin(geo?.lon, 0);
      const altMsl = fin(geo?.alt, st ? st.altKm * 1000 : 0);
      let heightEllipsoid = altMsl;
      let agl = fin((info?.surface as { alt?: number } | undefined)?.alt, altMsl);

      if (body === "earth" && Number.isFinite(latDeg) && Number.isFinite(lonDeg)) {
        const geoid = geoidDeg(latDeg, lonDeg);
        heightEllipsoid = altMsl + geoid;
        try {
          const bf = bodyFixedOf("earth", latDeg, lonDeg, heightEllipsoid);
          const hog = heightOverGround("earth", bf);
          if (Number.isFinite(hog)) agl = hog;
        } catch {
          // keep surface fallback
        }
      }

      const dtauDt = fin((info as { dtau?: number } | null)?.dtau, 1);
      const properTime = fin((pilot as unknown as { properTime?: number })?.properTime, sim.time * M_SECONDS);
      const frozen = d.isFrozen() || !settings.animate;

      const orb = st?.orbit
        ? {
            body,
            apoapsis_m: fin(st.orbit.apKm, 0) * 1000,
            periapsis_m: fin(st.orbit.peKm, 0) * 1000,
            semi_major_m: fin(st.orbit.aKm, 0) * 1000,
            eccentricity: fin(st.orbit.ecc, 0),
            inclination_deg: fin(st.orbit.incDeg, 0),
            period_s: fin(st.orbit.period, 0),
            speed_mps: fin(st.speed, 0),
            altitude_m: fin(st.altKm, 0) * 1000,
          }
        : null;

      const rwyRaw = camera.runwayView?.() ?? null;
      const runway = rwyRaw
        ? {
            ident: String(rwyRaw.des ?? rwyRaw.rwy ?? rwyRaw.name ?? "RWY"),
            name: String(rwyRaw.name ?? ""),
            dist_m: fin(Math.hypot(rwyRaw.along, rwyRaw.across), 0),
            loc_deg: fin(Math.atan2(rwyRaw.across, Math.max(1, Math.abs(rwyRaw.along))) * R2D, 0),
            gs_deg: fin((rwyRaw.gam ?? 0) - (rwyRaw.gRef ?? 0), 0),
            elev_m: fin((rwyRaw.hp ?? rwyRaw.agl) - rwyRaw.agl, 0),
          }
        : null;

      const fuelFrac = fin((info?.engine as { fuel?: { fraction?: number } } | undefined)?.fuel?.fraction, 1);
      const fuelKg = typeof (af as { fuel?: number } | null)?.fuel === "number" ? fin((af as { fuel?: number }).fuel, 0) : null;

      const attObj = att as { heading?: number; pitch?: number; bank?: number } | null;

      return {
        v: 1,
        wall_ms: Date.now(),
        sim_time_s: fin(sim.time * M_SECONDS, 0),
        sim_dt: frozen ? 0 : fin(d.lastDt(), 0),
        warp: fin(warpFactor(settings), 1),
        frozen,
        dtau_dt: dtauDt,
        proper_time_s: properTime,
        vessel_id: vesselId,
        vessel_kind: !camera.piloting ? "free" : aircraft ? "aircraft" : "spacecraft",
        body,
        position: {
          lat_deg: latDeg,
          lon_deg: lonDeg,
          height_ellipsoid_m: heightEllipsoid,
          altitude_msl_m: altMsl,
          height_over_ground_m: agl,
        },
        attitude: radAttitudeToDeg(attObj),
        flight: {
          true_airspeed_mps: fin(af?.tas ?? (info?.air as { speed?: number } | undefined)?.speed ?? orb?.speed_mps, 0),
          ground_speed_mps: fin(af?.gs ?? geo?.gs ?? (info?.surface as { vHor?: number } | undefined)?.vHor, 0),
          vertical_speed_mps: fin(af?.vs ?? geo?.vs ?? (info?.surface as { vVert?: number } | undefined)?.vVert, 0),
          mach: fin(af?.mach, 0),
          dynamic_pressure_pa: fin(af?.q ?? (info?.air as { q?: number } | undefined)?.q, 0),
          alpha_deg: fin(af?.alpha ?? (info?.air as { alpha?: number } | undefined)?.alpha, 0) * (af ? R2D : 1),
          beta_deg: fin(af?.beta ?? (info?.air as { beta?: number } | undefined)?.beta, 0) * (af ? R2D : 1),
          g_load: fin(af?.g ?? (info as { g?: number } | null)?.g, 1),
          stalled: Boolean(af?.stalled ?? (info?.air as { stalled?: boolean } | undefined)?.stalled),
          on_ground: Boolean(af?.onGround ?? (info?.surface as { landed?: boolean } | undefined)?.landed),
          hull_temp_k: fin((info as { heatK?: number } | null)?.heatK, 288),
        },
        orbit: orb,
        systems: {
          throttle: fin(pilot.throttle, 0),
          fuel_frac: fuelFrac,
          fuel_kg: fuelKg,
          gear: fin((camera as unknown as { gear?: number }).gear, 0),
          flaps: fin((camera as unknown as { flaps?: number }).flaps, 0),
          sas: Boolean(pilot.sas),
          autopilot: String(pilot.auto ?? "none"),
          hold: String(pilot.hold ?? "none"),
          rcs_mode: String((camera as unknown as { rcsMode?: string }).rcsMode ?? "rotate"),
        },
        nav: {
          target: st?.target?.name ?? null,
          runway,
        },
      };
    },

    executeCommand(cmd: ObcCommand): ObcCommandResult {
      const { camera, voice } = d;
      switch (cmd.kind) {
        case "ping":
          return { ok: true, msg: "pong", ...(cmd.id !== undefined ? { id: cmd.id } : {}) };
        case "throttle":
          camera.pilot.throttle = cmd.value;
          return { ok: true, msg: `throttle=${cmd.value.toFixed(2)}` };
        case "stick": {
          const inp = (camera as unknown as { pilotInput?: { pitch?: number; roll?: number; yaw?: number } }).pilotInput;
          if (!inp) return { ok: false, msg: "pilotInput unavailable" };
          if (cmd.pitch !== undefined) inp.pitch = cmd.pitch;
          if (cmd.roll !== undefined) inp.roll = cmd.roll;
          if (cmd.yaw !== undefined) inp.yaw = cmd.yaw;
          if (stickTimer) clearTimeout(stickTimer);
          stickTimer = setTimeout(() => {
            inp.pitch = 0;
            inp.roll = 0;
            inp.yaw = 0;
            stickTimer = null;
          }, cmd.duration_ms ?? 200);
          return { ok: true, msg: "stick applied" };
        }
        case "autopilot": {
          const mode = cmd.mode === "off" ? "none" : cmd.mode;
          camera.pilot.setAuto(mode as never);
          return { ok: true, msg: `autopilot=${mode}` };
        }
        case "hold": {
          const mode = cmd.mode === "off" ? "none" : cmd.mode;
          camera.pilot.setHold(mode as never);
          return { ok: true, msg: `hold=${mode}` };
        }
        case "sas":
          camera.pilot.sas = cmd.on;
          return { ok: true, msg: `sas=${cmd.on}` };
        case "gear": {
          const c = camera as unknown as { setGear?: (down: boolean) => void; toggleGear?: () => void };
          if (c.setGear) c.setGear(cmd.down);
          else c.toggleGear?.();
          return { ok: true, msg: `gear=${cmd.down ? "down" : "up"}` };
        }
        case "flaps": {
          const c = camera as unknown as { setFlaps?: (v: number) => void };
          if (c.setFlaps) c.setFlaps(cmd.value);
          return { ok: true, msg: `flaps=${cmd.value.toFixed(2)}` };
        }
        case "say":
          voice.say({ text: cmd.text, speaker: "tars", priority: 2 });
          return { ok: true, msg: "spoken" };
      }
    },
  };
}
