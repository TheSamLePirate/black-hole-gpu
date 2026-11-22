// Shared types for the embedded Linux On-Board Computer (OBC) — docs/PLAN-LINUX-OBC.md.
// Pure types (no DOM / WebGPU / unkernel runtime imports) so crew/, tests/, and main share one contract.

export type ObcPhase = "off" | "booting" | "ready" | "suspended" | "error";

export type ObcTheme = "interstellar" | "f35" | "a320" | "amber";

export type ObcViewMode = "term" | "fb" | "split";

export type ObcDistro = "alpine" | "debian";

export type ObcMemoryMiB = 512 | 1024 | 2048 | 4096;

export const OBC_MEMORY_OPTIONS: readonly ObcMemoryMiB[] = [512, 1024, 2048, 4096];

export type ObcToolchainProfile = "python" | "node" | "bun" | "rust" | "claude" | "pi" | "full" | "all";

export interface ObcConfig {
  /** Linux rootfs distribution ("alpine" = Alpine 3.24 musl, "debian" = Debian 13 Trixie glibc) */
  distro: ObcDistro;
  /** Guest RAM in MiB (512, 1024, 2048 default, or 4096) */
  memoryMiB: ObcMemoryMiB;
  /** Virtual /dev/fb0 width & height [px] */
  fbWidth: number;
  fbHeight: number;
  /** Enable kwemu Wasm JIT compiler */
  jit: boolean;
  /** Persist /data overlay (and /home/pilot) in IndexedDB */
  persistData: boolean;
  /** Subtle CRT scanlines & cockpit phosphor glow FX */
  crtFx: boolean;
  /** Forward guest /dev/dsp & ALSA audio to WebAudio */
  soundEnabled: boolean;
  /** Visual palette override ("auto" matches active craft) */
  theme: "auto" | ObcTheme;
  /** Sim-clock behavior when simulator is frozen/paused */
  syncMode: "interactive" | "strict";
}

export const DEFAULT_OBC_CONFIG: ObcConfig = {
  distro: "alpine",
  memoryMiB: 2048,
  fbWidth: 512,
  fbHeight: 512,
  jit: true,
  persistData: true,
  crtFx: true,
  soundEnabled: false,
  theme: "auto",
  syncMode: "interactive",
};

export interface ObcTelemetry {
  /** Protocol schema version */
  v: 1;
  /** Wall timestamp [ms] */
  wall_ms: number;
  /** Simulation time [s] since epoch */
  sim_time_s: number;
  /** Simulation step [s] (0 when paused/frozen) */
  sim_dt: number;
  /** Time warp multiplier */
  warp: number;
  /** Whether the simulation is paused or frozen */
  frozen: boolean;
  /** Relativistic time dilation d(tau)/dt near Kerr black hole / gravity well */
  dtau_dt: number;
  /** Ship proper time [s] */
  proper_time_s: number;
  /** Active vessel id ("ranger", "lander", "endurance", "f35b", "f35c", "a320", etc.) */
  vessel_id: string;
  /** Active vessel kind ("spacecraft" | "aircraft" | "free") */
  vessel_kind: "spacecraft" | "aircraft" | "free";
  /** Reference celestial body ("earth", "moon", "gargantua", "miller", etc.) */
  body: string;
  /** Geodetic WGS84 position (Earth) or planetocentric lat/lon/height */
  position: {
    lat_deg: number;
    lon_deg: number;
    /** Height above WGS84 ellipsoid [m] */
    height_ellipsoid_m: number;
    /** Altitude above mean sea level (geoid) [m] */
    altitude_msl_m: number;
    /** True height above ground relief AGL [m] */
    height_over_ground_m: number;
  };
  /** Vehicle attitude [deg] */
  attitude: {
    heading_deg: number;
    pitch_deg: number;
    roll_deg: number;
  };
  /** Velocity & atmospheric flight figures */
  flight: {
    true_airspeed_mps: number;
    ground_speed_mps: number;
    vertical_speed_mps: number;
    mach: number;
    dynamic_pressure_pa: number;
    alpha_deg: number;
    beta_deg: number;
    g_load: number;
    stalled: boolean;
    on_ground: boolean;
    hull_temp_k: number;
  };
  /** Keplerian orbital elements around current primary (null if unavailable) */
  orbit: {
    body: string;
    apoapsis_m: number;
    periapsis_m: number;
    semi_major_m: number;
    eccentricity: number;
    inclination_deg: number;
    period_s: number;
    speed_mps: number;
    altitude_m: number;
  } | null;
  /** Vehicle systems & controls readback */
  systems: {
    throttle: number;
    fuel_frac: number;
    fuel_kg: number | null;
    gear: number;
    flaps: number;
    sas: boolean;
    autopilot: string;
    hold: string;
    rcs_mode: string;
  };
  /** Active navigation target or runway approach summary */
  nav: {
    target: string | null;
    runway: {
      ident: string;
      name: string;
      dist_m: number;
      loc_deg: number;
      gs_deg: number;
      elev_m: number;
    } | null;
  };
}

export interface ObcTauInfo {
  dtau_dt: number;
  proper_time_s: number;
  sim_time_s: number;
  warp: number;
  frozen: boolean;
  body: string;
}

/** Validated command from Linux guest (via /obc/cmd or AF_VSOCK:4747) to the simulator. */
export type ObcCommand =
  | { kind: "throttle"; value: number }
  | { kind: "stick"; pitch?: number; roll?: number; yaw?: number; duration_ms?: number }
  | { kind: "autopilot"; mode: string }
  | { kind: "hold"; mode: string }
  | { kind: "sas"; on: boolean }
  | { kind: "gear"; down: boolean }
  | { kind: "flaps"; value: number }
  | { kind: "say"; text: string }
  | { kind: "ping"; id?: string | number };

export interface ObcCommandResult {
  ok: boolean;
  msg: string;
  id?: string | number;
}

export interface ObcScriptMeta {
  id: string;
  name: string;
  label: string;
  desc: string;
  cmd: string;
  category?: "cli" | "tui" | "fb";
  lang?: "sh" | "python" | "node";
  graphical?: boolean;
}

export interface ObcStatus {
  phase: ObcPhase;
  bootMs: number | null;
  memoryMiB: number;
  distro: string;
  arch: string;
  worker: boolean;
  transport: string;
  fbActive: boolean;
  fbWidth: number;
  fbHeight: number;
  fbFps: number;
  hasSnapshot: boolean;
  wispUrl: string;
  netEnabled: boolean;
  lastError: string | null;
  vsockClients: number;
  commandsHandled: number;
  consoleOpen: boolean;
  viewMode: ObcViewMode;
  activeScript: string | null;
  config: ObcConfig;
}

/** Snapshot of OBC state suitable for Crew console relay (lightweight, JSON-serializable). */
export interface ObcCrewSnapshot {
  phase: ObcPhase;
  distro: string;
  fbActive: boolean;
  dtauDt: number;
  activeScript: string | null;
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  seq: number;
}
