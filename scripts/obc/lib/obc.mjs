// obc.mjs — High-Performance Node.js Avionics, TUI & /dev/fb0 Framebuffer SDK for Black Hole GPU Linux OBC.
// Zero third-party npm packages required. Uses Uint32Array packed XRGB8888 writes for ultra-fast real-time graphics.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

export const TELEMETRY_PATH = "/obc/telemetry.json";
export const TAU_PATH = "/obc/tau";
export const CMD_PATH = "/obc/cmd";
export const LAST_RESULT_PATH = "/obc/last_result.json";
export const RPC_REQ_PATH = "/obc/rpc_req";
export const RPC_RES_PATH = "/obc/rpc_res";
/** Keyed RPC (src/obc/bridge.ts, docs/PLAN-LINUX-OBC.md §2.1): `<id>.req` written here, `<id>.res` read back. */
export const RPC_DIR = "/obc/rpc";

/**
 * The telemetry v1 schema (dotted leaf paths of `/obc/telemetry.json`, `ObcTelemetry` in src/obc/types.ts). Checked
 * against the TypeScript, Rust and Python schemas by tests/obc-telemetry-contract.test.ts.
 */
export const TELEMETRY_FIELDS = Object.freeze([
  "v", "wall_ms", "sim_time_s", "sim_dt", "warp", "frozen", "dtau_dt", "proper_time_s", "vessel_id", "vessel_kind",
  "body", "units", "position.lat_deg", "position.lon_deg", "position.height_ellipsoid_m", "position.altitude_msl_m",
  "position.height_over_ground_m", "attitude.heading_deg", "attitude.pitch_deg", "attitude.roll_deg",
  "flight.true_airspeed_mps", "flight.ground_speed_mps", "flight.vertical_speed_mps", "flight.mach",
  "flight.dynamic_pressure_pa", "flight.alpha_deg", "flight.beta_deg", "flight.g_load", "flight.stalled",
  "flight.on_ground", "flight.hull_temp_k", "orbit.body", "orbit.apoapsis_m", "orbit.periapsis_m",
  "orbit.semi_major_m", "orbit.eccentricity", "orbit.inclination_deg", "orbit.period_s", "orbit.speed_mps",
  "orbit.altitude_m", "systems.throttle", "systems.fuel_frac", "systems.fuel_kg", "systems.gear", "systems.flaps",
  "systems.sas", "systems.autopilot", "systems.hold", "systems.rcs_mode", "nav.target", "nav.runway.ident",
  "nav.runway.name", "nav.runway.dist_m", "nav.runway.loc_deg", "nav.runway.gs_deg", "nav.runway.elev_m",
]);

/**
 * Display units, like the simulator's src/ui/unitsys.ts: metric by default (m, m/s, km), imperial as the option (ft,
 * kt, NM, ft/min). Pass the telemetry's `units` (the player's choice); `OBC_UNITS=metric|imperial` overrides it.
 */
export function unitsOf(sys = "metric") {
  const chosen = String(process.env.OBC_UNITS || sys || "metric")
    .trim()
    .toLowerCase();
  const metric = chosen !== "imperial";
  const u = {
    sys: metric ? "metric" : "imperial",
    metric,
    altName: metric ? "m" : "ft",
    spdName: metric ? "m/s" : "kt",
    vsName: metric ? "m/s" : "ft/min",
    distName: metric ? "km" : "NM",
    distUnitM: metric ? 1000 : 1852,
    alt: (m) => (metric ? m : m / 0.3048),
    spd: (v) => (metric ? v : (v * 3600) / 1852),
    vs: (v) => (metric ? v : (v / 0.3048) * 60),
    dist: (m) => m / (metric ? 1000 : 1852),
  };
  u.fAlt = (m) => `${Math.round(u.alt(m))} ${u.altName}`;
  u.fSpd = (v) => `${Math.round(u.spd(v))} ${u.spdName}`;
  u.fVs = (v) => (metric ? `${v >= 0 ? "+" : ""}${v.toFixed(1)} m/s` : `${v >= 0 ? "+" : ""}${Math.round(u.vs(v))} ft/min`);
  u.fDist = (m, digits = 1) => `${u.dist(m).toFixed(digits)} ${u.distName}`;
  return u;
}

const RPC_NONCE = randomBytes(4).toString("hex");
let rpcSeq = 0;

/** A request id unique across processes: `js-<pid>-<nonce>-<seq>` (a safe file name). */
export function nextRpcId() {
  rpcSeq += 1;
  return `js-${process.pid}-${RPC_NONCE}-${rpcSeq}`;
}

function replyFor(raw, id) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

function sleepMs(ms) {
  // Never use Atomics.wait (futex_wait hangs on emulated aarch64); use lightweight Alpine sleep fallback only for async RPCs.
  const sec = Math.max(0.02, ms / 1000).toFixed(3);
  spawnSync("/bin/sleep", [sec], { stdio: "ignore" });
}

export class AvionicsBus {
  constructor() {
    this._last = null;
  }

  read() {
    const raw = JSON.parse(fs.readFileSync(TELEMETRY_PATH, "utf8"));
    this._last = raw;
    return raw;
  }

  get vesselId() {
    return (this._last ?? this.read()).vessel_id;
  }

  get simDt() {
    const s = this._last ?? this.read();
    return s.frozen ? 0.1 : Math.max(0.02, Number(s.sim_dt) || 0.05);
  }

  tau() {
    const text = fs.readFileSync(TAU_PATH, "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
    }
    return out;
  }

  send(cmd) {
    fs.writeFileSync(CMD_PATH, `${JSON.stringify(cmd)}\n`, "utf8");
    try {
      return JSON.parse(fs.readFileSync(LAST_RESULT_PATH, "utf8"));
    } catch {
      return { ok: true, msg: "sent" };
    }
  }

  setThrottle(value) {
    return this.send({ kind: "throttle", value: Math.max(0, Math.min(1, Number(value))) });
  }

  setStick({ pitch, roll, yaw, durationMs = 200 } = {}) {
    return this.send({ kind: "stick", pitch, roll, yaw, duration_ms: durationMs });
  }

  setAutopilot(mode) {
    return this.send({ kind: "autopilot", mode: String(mode) });
  }

  setHold(mode) {
    return this.send({ kind: "hold", mode: String(mode) });
  }

  setSas(on) {
    return this.send({ kind: "sas", on: Boolean(on) });
  }

  setGear(down) {
    return this.send({ kind: "gear", down: Boolean(down) });
  }

  setFlaps(value) {
    return this.send({ kind: "flaps", value: Math.max(0, Math.min(1, Number(value))) });
  }

  say(text) {
    return this.send({ kind: "say", text: String(text) });
  }

  /**
   * Synchronous universal RPC to the full simulator `window.__bh` API & all 73 TARS tools, over the keyed 9p files
   * `/obc/rpc/<id>.req` -> `<id>.res` (the single slot `/obc/rpc_res` as fallback; `/obc/rpc_req` only on an older host).
   */
  bhRpc(payload, timeoutMs = 10000) {
    const id = nextRpcId();
    const line = `${JSON.stringify({ ...payload, id })}\n`;
    const reqPath = `${RPC_DIR}/${id}.req`;
    const resPath = `${RPC_DIR}/${id}.res`;
    let keyed = true;
    try {
      fs.writeFileSync(reqPath, line, { encoding: "utf8", flag: "wx" });
    } catch {
      keyed = false;
      fs.writeFileSync(RPC_REQ_PATH, line, "utf8");
    }
    const paths = keyed ? [resPath, RPC_RES_PATH] : [RPC_RES_PATH];
    const deadline = Date.now() + timeoutMs;
    let polls = 0;
    while (Date.now() < deadline) {
      for (const p of paths) {
        let parsed = null;
        try {
          parsed = replyFor(fs.readFileSync(p, "utf8"), id);
        } catch {
          // not written yet
        }
        if (parsed) {
          if (keyed) fs.rmSync(resPath, { force: true });
          return parsed;
        }
      }
      polls++;
      // Synchronous host RPCs resolve before writeFileSync even returns (polls === 1).
      // Only async Promise RPCs need a brief sleep between retries.
      sleepMs(polls < 5 ? 25 : 60);
    }
    if (keyed) fs.rmSync(reqPath, { force: true });
    return { id, ok: false, error: `RPC timeout after ${timeoutMs}ms` };
  }

  bhLs(path = "") {
    return this.bhRpc({ op: "ls", path });
  }

  bhGet(path, depth = 3) {
    return this.bhRpc({ op: "get", path, depth });
  }

  bhSet(path, value, refresh = true) {
    return this.bhRpc({ op: "set", path, value, refresh });
  }

  bhCall(path, ...args) {
    return this.bhRpc({ op: "call", path, args });
  }

  bhTools() {
    return this.bhRpc({ op: "tools" });
  }

  bhTool(name, toolArgs = {}) {
    return this.bhRpc({ op: "tool", name, toolArgs });
  }

  bhSearch(query) {
    return this.bhRpc({ op: "search", query });
  }

  bhEval(expr) {
    return this.bhRpc({ op: "eval", expr });
  }

  bhMcdu(action, opts = {}) {
    return this.bhRpc({ op: "mcdu", action, ...opts });
  }
}

// Compact 5x7 uppercase/digit bitmap font for zero-dependency /dev/fb0 cockpit graphics
const FONT5X7 = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0, 4],
  ":": [0, 4, 0, 0, 0, 4, 0],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "%": [25, 26, 2, 4, 8, 11, 19],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [14, 17, 1, 6, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

/** Pack RGB into little-endian XRGB8888 uint32 (B, G, R, 0xFF in memory). */
export function packRgb(r, g, b) {
  return (0xff000000 | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
}

export class Framebuffer {
  constructor(path = "/dev/fb0", width = 512, height = 512) {
    this.path = path;
    this.width = width;
    this.height = height;
    this.fd = fs.openSync(path, "r+");
    this.buf = Buffer.allocUnsafe(width * height * 4);
    this.u32 = new Uint32Array(this.buf.buffer, this.buf.byteOffset, width * height);
  }

  static color(r, g, b) {
    return packRgb(r, g, b);
  }

  clear(r = 4, g = 24, b = 34) {
    this.u32.fill(packRgb(r, g, b));
  }

  clearU32(col) {
    this.u32.fill(col >>> 0);
  }

  pixel(x, y, col) {
    const ix = x | 0;
    const iy = y | 0;
    if (ix >= 0 && iy >= 0 && ix < this.width && iy < this.height) {
      this.u32[iy * this.width + ix] = col;
    }
  }

  hline(x0, x1, y, col) {
    const iy = y | 0;
    if (iy < 0 || iy >= this.height) return;
    let a = Math.max(0, Math.min(x0, x1) | 0);
    let b = Math.min(this.width - 1, Math.max(x0, x1) | 0);
    if (a > b) return;
    const off = iy * this.width;
    this.u32.fill(col, off + a, off + b + 1);
  }

  rect(x, y, w, h, col) {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.width, (x + w) | 0);
    const y1 = Math.min(this.height, (y + h) | 0);
    if (x0 >= x1 || y0 >= y1) return;
    for (let yy = y0; yy < y1; yy++) {
      const off = yy * this.width;
      this.u32.fill(col, off + x0, off + x1);
    }
  }

  strokeRect(x, y, w, h, col) {
    this.rect(x, y, w, 1, col);
    this.rect(x, y + h - 1, w, 1, col);
    this.rect(x, y, 1, h, col);
    this.rect(x + w - 1, y, 1, h, col);
  }

  line(x0, y0, x1, y1, col) {
    let ix0 = x0 | 0;
    let iy0 = y0 | 0;
    const ix1 = x1 | 0;
    const iy1 = y1 | 0;
    const dx = Math.abs(ix1 - ix0);
    const dy = -Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx + dy;
    const w = this.width;
    const h = this.height;
    const u = this.u32;
    while (true) {
      if (ix0 >= 0 && iy0 >= 0 && ix0 < w && iy0 < h) u[iy0 * w + ix0] = col;
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = err << 1;
      if (e2 >= dy) {
        err += dy;
        ix0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  circle(cx, cy, radius, col, steps = 96) {
    let px = (cx + radius) | 0;
    let py = cy | 0;
    for (let i = 1; i <= steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      const nx = Math.round(cx + radius * Math.cos(a));
      const ny = Math.round(cy + radius * Math.sin(a));
      this.line(px, py, nx, ny, col);
      px = nx;
      py = ny;
    }
  }

  filledCircle(cx, cy, radius, col) {
    const r = radius | 0;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const span = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
      this.hline(cx - span, cx + span, cy + dy, col);
    }
  }

  ellipse(cx, cy, rx, ry, col, steps = 96) {
    let px = (cx + rx) | 0;
    let py = cy | 0;
    for (let i = 1; i <= steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      const nx = Math.round(cx + rx * Math.cos(a));
      const ny = Math.round(cy + ry * Math.sin(a));
      this.line(px, py, nx, ny, col);
      px = nx;
      py = ny;
    }
  }

  barGauge(x, y, w, h, frac, fillCol, bgCol, borderCol) {
    this.rect(x, y, w, h, bgCol);
    const f = Math.max(0, Math.min(1, Number(frac) || 0));
    const fw = Math.round((w - 4) * f);
    if (fw > 0) this.rect(x + 2, y + 2, fw, Math.max(1, h - 4), fillCol);
    this.strokeRect(x, y, w, h, borderCol);
  }

  text(x, y, str, col, scale = 2) {
    let cx = x | 0;
    const s = String(str).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const glyph = FONT5X7[s[i]] ?? FONT5X7[" "];
      for (let ry = 0; ry < 7; ry++) {
        const bits = glyph[ry];
        if (!bits) continue;
        for (let rx = 0; rx < 5; rx++) {
          if (bits & (1 << (4 - rx))) {
            this.rect(cx + rx * scale, y + ry * scale, scale, scale, col);
          }
        }
      }
      cx += 6 * scale;
    }
  }

  lineClipped(x0, y0, x1, y1, col, minX, minY, maxX, maxY) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    const checks = [
      [-dx, x0 - minX],
      [dx, maxX - x0],
      [-dy, y0 - minY],
      [dy, maxY - y0],
    ];
    for (const [p, q] of checks) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return;
      } else {
        const r = q / p;
        if (p < 0) {
          if (r > t1) return;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return;
          if (r < t1) t1 = r;
        }
      }
    }
    this.line(Math.round(x0 + t0 * dx), Math.round(y0 + t0 * dy), Math.round(x0 + t1 * dx), Math.round(y0 + t1 * dy), col);
  }

  flush() {
    fs.writeSync(this.fd, this.buf, 0, this.buf.length, 0);
  }

  close() {
    if (this.fd >= 0) fs.closeSync(this.fd);
    this.fd = -1;
  }
}

/** Attach raw-mode keyboard listener on stdin (TTY) and return a cleanup function. */
export function startRawKeys(onKey) {
  if (!process.stdin.isTTY) return () => {};
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const handler = (chunk) => onKey(chunk);
    process.stdin.on("data", handler);
    return () => {
      try {
        process.stdin.off("data", handler);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {}
    };
  } catch {
    return () => {};
  }
}

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

/**
 * Geodesic distance [m] and initial / final bearings [deg] between two geodetic (WGS84) points: Vincenty's inverse
 * formula on the WGS84 ellipsoid (sub-millimetre for ordinary distances). For nearly antipodal points, where it does not
 * converge, it falls back to the great circle on the WGS84 authalic sphere (R = 6 371 007.2 m), flagged `approx: true`.
 */
export function wgs84Inverse(lat1, lon1, lat2, lon2) {
  const d2r = Math.PI / 180;
  const L = (lon2 - lon1) * d2r;
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(lat1 * d2r));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(lat2 * d2r));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cos2Alpha = 1;
  let cos2SigmaM = 0;
  let sinLambda = 0;
  let cosLambda = 1;
  let converged = false;
  for (let i = 0; i < 200; i++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    const t1 = cosU2 * sinLambda;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLambda;
    sinSigma = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinSigma === 0) return { distM: 0, bearingDeg: 0, finalBearingDeg: 0, approx: false };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (WGS84_F / 16) * cos2Alpha * (4 + WGS84_F * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) * WGS84_F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    const R = 6371007.2;
    const p1 = lat1 * d2r;
    const p2 = lat2 * d2r;
    const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(L / 2) ** 2;
    const distM = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    const y = Math.sin(L) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(L);
    const bearingDeg = ((Math.atan2(y, x) / d2r) % 360 + 360) % 360;
    return { distM, bearingDeg, finalBearingDeg: bearingDeg, approx: true };
  }
  const uSq = (cos2Alpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const dSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const distM = WGS84_B * A * (sigma - dSigma);
  const a1 = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
  const a2 = Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda);
  const norm = (r) => ((r / d2r) % 360 + 360) % 360;
  return { distM, bearingDeg: norm(a1), finalBearingDeg: norm(a2), approx: false };
}

/** WGS84 geodesic distance [m] and initial bearing [deg] between two geodetic coordinates (Vincenty, `wgs84Inverse`). */
export function wgs84BearingDist(lat1, lon1, lat2, lon2) {
  const { distM, bearingDeg } = wgs84Inverse(lat1, lon1, lat2, lon2);
  return { distM, bearingDeg };
}

/** Build a clean 24-bit ANSI progress bar. */
export function ansiBar(frac, width = 20, fg = "98;230;255") {
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  const n = Math.round(f * width);
  return `\x1b[38;2;${fg}m${"█".repeat(n)}\x1b[38;2;36;74;92m${"░".repeat(width - n)}\x1b[0m`;
}
