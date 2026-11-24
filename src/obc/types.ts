// Shared types for the embedded Linux On-Board Computer (OBC) — docs/PLAN-LINUX-OBC.md.
// Pure types (no DOM / WebGPU / unkernel runtime imports) so crew/, tests/, and main share one contract.

export type ObcPhase = "off" | "booting" | "ready" | "suspended" | "error";

export type ObcTheme = "interstellar" | "f35" | "a320" | "amber";

export type ObcViewMode = "term" | "fb" | "split";

export type ObcDistro = "alpine" | "debian";

export type ObcMemoryMiB = 512 | 1024 | 2048 | 4096;

export type ObcCpuCount = 1 | 2 | 4;

export type ObcWispMode = "auto" | "prod" | "local" | "custom" | "off";

export const OBC_MEMORY_OPTIONS: readonly ObcMemoryMiB[] = [512, 1024, 2048, 4096];

export const OBC_CPU_OPTIONS: readonly ObcCpuCount[] = [1, 2, 4];

export type ObcToolchainProfile = "python" | "node" | "bun" | "rust" | "claude" | "pi" | "full" | "all";

export interface ObcConfig {
  /** Linux rootfs distribution ("alpine" = Alpine 3.24 musl, "debian" = Debian 13 Trixie glibc) */
  distro: ObcDistro;
  /** Guest RAM in MiB (512, 1024, 2048 default, or 4096) */
  memoryMiB: ObcMemoryMiB;
  /** SMP vCPU count requested from Unkernel (1, 2, or 4; requires crossOriginIsolated for >1) */
  cpus: ObcCpuCount;
  /** Virtual /dev/fb0 width & height [px] */
  fbWidth: number;
  fbHeight: number;
  /** Enable kwemu Wasm JIT compiler */
  jit: boolean;
  /** Enable /dev/kwshm host-guest shared memory device */
  shm: boolean;
  /** Enable Unkernel guest CPU sampler (`vm.profile()`) */
  profile: boolean;
  /** Persist /data overlay (and /home/pilot) in IndexedDB */
  persistData: boolean;
  /** Wisp v1 relay selection mode */
  wispMode: ObcWispMode;
  /** Subtle CRT scanlines & cockpit phosphor glow FX */
  crtFx: boolean;
  /** Forward guest /dev/dsp & ALSA audio to WebAudio */
  soundEnabled: boolean;
  /** Allow mouse clicks/scroll/drag reporting to mouse-aware TUIs (bare hover floods always suppressed) */
  termMouse: boolean;
  /** Visual palette override ("auto" matches active craft) */
  theme: "auto" | ObcTheme;
  /** Sim-clock behavior when simulator is frozen/paused */
  syncMode: "interactive" | "strict";
  /** Terminal font size [px] (11..16) */
  fontSize: number;
  /** HUD console panel background opacity (0.72..1.0) */
  panelOpacity: number;
}

export const DEFAULT_OBC_CONFIG: ObcConfig = {
  distro: "alpine",
  memoryMiB: 2048,
  cpus: 4,
  fbWidth: 512,
  fbHeight: 512,
  jit: true,
  shm: false,
  profile: false,
  persistData: true,
  wispMode: "auto",
  crtFx: true,
  soundEnabled: false,
  termMouse: true,
  theme: "auto",
  syncMode: "interactive",
  fontSize: 13,
  panelOpacity: 0.94,
};

export type ObcWarmupState = "idle" | "warming" | "ready";

export interface ObcTerminalTabInfo {
  id: string;
  title: string;
  kind: "main" | "pty";
  pid: number | null;
  running: boolean;
  exitCode: number | null;
  cmd: string | null;
  active: boolean;
}

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
  /** The player's display units (`settings.units`, `src/ui/unitsys.ts`): metric by default, imperial as the option. Guest apps
   * show heights, speeds and distances in them; the other fields stay SI. */
  units: "metric" | "imperial";
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

/** Live Unkernel VM & host hardware telemetry for the Linux Machine Manager. */
export interface ObcKernelTelemetry {
  running: boolean;
  uptimeMs: number;
  compileMs: number;
  cpus: number;
  memoryMiB: number;
  memory64: boolean;
  cmdline: string;
  transport: string;
  crossOriginIsolated: boolean;
  cpuBlocker: string | null;
  activeWispUrl: string;
  switches: number;
  idles: number;
  yields: number;
  jit: { enabled: boolean; requested: boolean; compiled: number; live: number; maxLive: number; freed: number; failed: number } | null;
  block: { reads: number; writes: number; flushes: number; discards: number; bytesRead: number; bytesWritten: number } | null;
  net: { rx: number; tx: number; tcpOpened: number; dns: number } | null;
  vsock: { open: number; accepted: number; connected: number; bytesIn: number; bytesOut: number; resets: number } | null;
  display: { attaches: number; detaches: number; width: number; height: number; fps: number } | null;
  sound: { opens: number; starts: number; chunks: number; frames: number; playing: boolean } | null;
  shm: { open: number; reads: number; writes: number; bytesRead: number; bytesWritten: number } | null;
}

/** Persistent /data IndexedDB & browser storage summary. */
export interface ObcDiskInfo {
  persistData: boolean;
  idbBlocks: number | null;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  lastSyncAt: number | null;
  hasSnapshot: boolean;
}

export interface ObcGuestProcess {
  pid: number;
  user: string;
  mem: string;
  cmd: string;
}

export interface ObcGuestMount {
  fs: string;
  size: string;
  used: string;
  avail: string;
  pct: string;
  mount: string;
}

/** Live OS telemetry gathered inside the Linux guest via a single fast probe. */
export interface ObcGuestProbe {
  uname: string;
  distro: string;
  uptime: string;
  loadAvg: string;
  memTotalMiB: number;
  memUsedMiB: number;
  memAvailMiB: number;
  tools: Record<string, string>;
  processes: ObcGuestProcess[];
  mounts: ObcGuestMount[];
}

/** Persisted draggable & resizable geometry of the HUD OBC console window. */
export interface ObcWindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  maximized: boolean;
}
