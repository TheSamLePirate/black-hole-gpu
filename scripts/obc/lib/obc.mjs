// obc.mjs — High-Performance Node.js Avionics, TUI & /dev/fb0 Framebuffer SDK for Black Hole GPU Linux OBC.
// Zero third-party npm packages required. Uses Uint32Array packed XRGB8888 writes for ultra-fast real-time graphics.

import { spawnSync } from "node:child_process";
import fs from "node:fs";

export const TELEMETRY_PATH = "/obc/telemetry.json";
export const TAU_PATH = "/obc/tau";
export const CMD_PATH = "/obc/cmd";
export const LAST_RESULT_PATH = "/obc/last_result.json";
export const RPC_REQ_PATH = "/obc/rpc_req";
export const RPC_RES_PATH = "/obc/rpc_res";

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

  /** Synchronous universal RPC to the full simulator `window.__bh` API & all 73 TARS tools. */
  bhRpc(payload, timeoutMs = 10000) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(RPC_REQ_PATH, `${JSON.stringify({ ...payload, id })}\n`, "utf8");
    const deadline = Date.now() + timeoutMs;
    let polls = 0;
    while (Date.now() < deadline) {
      try {
        const raw = fs.readFileSync(RPC_RES_PATH, "utf8").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id === id) return parsed;
        }
      } catch {
        // retry on transient read
      }
      polls++;
      // Synchronous host RPCs resolve before writeFileSync even returns (polls === 1).
      // Only async Promise RPCs need a brief sleep between retries.
      sleepMs(polls < 5 ? 25 : 60);
    }
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

  flush() {
    fs.writeSync(this.fd, this.buf, 0, this.buf.length, 0);
  }

  close() {
    if (this.fd >= 0) fs.closeSync(this.fd);
    this.fd = -1;
  }
}

/** WGS84 great-circle distance [m] and initial bearing [deg] between two geodetic coordinates. */
export function wgs84BearingDist(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const d2r = Math.PI / 180;
  const p1 = lat1 * d2r;
  const p2 = lat2 * d2r;
  const dp = (lat2 - lat1) * d2r;
  const dl = (lon2 - lon1) * d2r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const distM = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const bearingDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { distM, bearingDeg };
}

/** Build a clean 24-bit ANSI progress bar. */
export function ansiBar(frac, width = 20, fg = "98;230;255") {
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  const n = Math.round(f * width);
  return `\x1b[38;2;${fg}m${"█".repeat(n)}\x1b[38;2;36;74;92m${"░".repeat(width - n)}\x1b[0m`;
}
