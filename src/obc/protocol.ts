// Pure OBC protocol helpers: command validation, telemetry formatting, Wisp URL validation.
// Kept dependency-free so unit tests (`tests/obc-protocol.test.ts`) and crew/ can import directly.

import type { ObcCommand, ObcTauInfo, ObcTelemetry } from "./types";

const ALLOWED_AUTOPILOTS = new Set([
  "none",
  "off",
  "hover",
  "circularize",
  "approach",
  "orbit",
  "node",
  "transfer",
  "land",
  "takeoff",
  "dock",
  "entry",
  "burns",
  "keep",
  "ils",
  "hold",
  "tf",
  "goAround",
]);

const ALLOWED_HOLDS = new Set([
  "none",
  "off",
  "prograde",
  "retrograde",
  "radialOut",
  "radialIn",
  "normal",
  "antinormal",
  "target",
  "antiTarget",
  "maneuver",
]);

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const fin = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Parse and validate an untrusted JSON command object from Linux (`/obc/cmd` or AF_VSOCK).
 * Accepts either explicit `{ kind, ... }` or shorthand `{ throttle: 0.8 }`, `{ say: "..." }`, etc.
 * Returns null if invalid or out of protocol.
 */
export function parseObcCommand(raw: unknown): ObcCommand | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 4096) return null;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? o.kind : typeof o.cmd === "string" ? o.cmd : null;

  // Shorthand support: { throttle: 0.7 }
  if (!kind && "throttle" in o) {
    const v = fin(o.throttle);
    if (v === null) return null;
    return { kind: "throttle", value: clamp(v, 0, 1) };
  }
  if (!kind && "say" in o && typeof o.say === "string") {
    const text = o.say.trim().slice(0, 220);
    return text ? { kind: "say", text } : null;
  }
  if (!kind && "autopilot" in o && typeof o.autopilot === "string") {
    const mode = o.autopilot.trim();
    return ALLOWED_AUTOPILOTS.has(mode) ? { kind: "autopilot", mode } : null;
  }
  if (!kind && "hold" in o && typeof o.hold === "string") {
    const mode = o.hold.trim();
    return ALLOWED_HOLDS.has(mode) ? { kind: "hold", mode } : null;
  }
  if (!kind && "gear" in o && typeof o.gear === "boolean") {
    return { kind: "gear", down: o.gear };
  }
  if (!kind && "sas" in o && typeof o.sas === "boolean") {
    return { kind: "sas", on: o.sas };
  }
  if (!kind && ("pitch" in o || "roll" in o || "yaw" in o)) {
    const pitch = fin(o.pitch);
    const roll = fin(o.roll);
    const yaw = fin(o.yaw);
    const dur = fin(o.duration_ms);
    if (pitch === null && roll === null && yaw === null) return null;
    return {
      kind: "stick",
      ...(pitch !== null ? { pitch: clamp(pitch, -1, 1) } : {}),
      ...(roll !== null ? { roll: clamp(roll, -1, 1) } : {}),
      ...(yaw !== null ? { yaw: clamp(yaw, -1, 1) } : {}),
      ...(dur !== null ? { duration_ms: clamp(dur, 20, 5000) } : {}),
    };
  }

  switch (kind) {
    case "throttle": {
      const v = fin(o.value ?? o.throttle);
      if (v === null) return null;
      return { kind: "throttle", value: clamp(v, 0, 1) };
    }
    case "stick": {
      const pitch = fin(o.pitch);
      const roll = fin(o.roll);
      const yaw = fin(o.yaw);
      const dur = fin(o.duration_ms);
      if (pitch === null && roll === null && yaw === null) return null;
      return {
        kind: "stick",
        ...(pitch !== null ? { pitch: clamp(pitch, -1, 1) } : {}),
        ...(roll !== null ? { roll: clamp(roll, -1, 1) } : {}),
        ...(yaw !== null ? { yaw: clamp(yaw, -1, 1) } : {}),
        ...(dur !== null ? { duration_ms: clamp(dur, 20, 5000) } : {}),
      };
    }
    case "autopilot": {
      const mode = typeof o.mode === "string" ? o.mode.trim() : "";
      if (!ALLOWED_AUTOPILOTS.has(mode)) return null;
      return { kind: "autopilot", mode };
    }
    case "hold": {
      const mode = typeof o.mode === "string" ? o.mode.trim() : "";
      if (!ALLOWED_HOLDS.has(mode)) return null;
      return { kind: "hold", mode };
    }
    case "sas": {
      if (typeof o.on !== "boolean") return null;
      return { kind: "sas", on: o.on };
    }
    case "gear": {
      if (typeof o.down !== "boolean") return null;
      return { kind: "gear", down: o.down };
    }
    case "flaps": {
      const v = fin(o.value);
      if (v === null) return null;
      return { kind: "flaps", value: clamp(v, 0, 1) };
    }
    case "say": {
      const text = typeof o.text === "string" ? o.text.trim().slice(0, 220) : "";
      if (!text) return null;
      return { kind: "say", text };
    }
    case "ping": {
      const id = typeof o.id === "string" || typeof o.id === "number" ? o.id : undefined;
      return { kind: "ping", id };
    }
    default:
      return null;
  }
}

/** Format `/obc/tau` (and `/dev/tau`) in a simple key=value format easy to read in shell or Python. */
export function formatTauText(info: ObcTauInfo): string {
  return [
    `dtau_dt=${info.dtau_dt.toFixed(9)}`,
    `proper_time_s=${info.proper_time_s.toFixed(3)}`,
    `sim_time_s=${info.sim_time_s.toFixed(3)}`,
    `warp=${info.warp}`,
    `frozen=${info.frozen ? 1 : 0}`,
    `body=${info.body}`,
    "",
  ].join("\n");
}

/** Validate a user-configured Wisp proxy URL (empty string disables / falls back to dev relay). */
export function normalizeWispUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

/** Default empty telemetry object for boot-time / offline unit checks. */
export function emptyTelemetry(): ObcTelemetry {
  return {
    v: 1,
    wall_ms: Date.now(),
    sim_time_s: 0,
    sim_dt: 0,
    warp: 1,
    frozen: false,
    dtau_dt: 1,
    proper_time_s: 0,
    vessel_id: "ranger",
    vessel_kind: "spacecraft",
    body: "earth",
    position: {
      lat_deg: 0,
      lon_deg: 0,
      height_ellipsoid_m: 0,
      altitude_msl_m: 0,
      height_over_ground_m: 0,
    },
    attitude: { heading_deg: 0, pitch_deg: 0, roll_deg: 0 },
    flight: {
      true_airspeed_mps: 0,
      ground_speed_mps: 0,
      vertical_speed_mps: 0,
      mach: 0,
      dynamic_pressure_pa: 0,
      alpha_deg: 0,
      beta_deg: 0,
      g_load: 1,
      stalled: false,
      on_ground: false,
      hull_temp_k: 288,
    },
    orbit: null,
    systems: {
      throttle: 0,
      fuel_frac: 1,
      fuel_kg: null,
      gear: 0,
      flaps: 0,
      sas: true,
      autopilot: "none",
      hold: "none",
      rcs_mode: "rotate",
    },
    nav: { target: null, runway: null },
  };
}
