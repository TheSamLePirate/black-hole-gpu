// obc.mjs — Node.js standard Avionics & Framebuffer library for Black Hole GPU Linux OBC.
// Zero external dependencies. Reads /obc/telemetry.json, /obc/tau, writes /obc/cmd & /dev/fb0.

import fs from "node:fs";

export const TELEMETRY_PATH = "/obc/telemetry.json";
export const TAU_PATH = "/obc/tau";
export const CMD_PATH = "/obc/cmd";

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
    return { ok: true };
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

  setGear(down) {
    return this.send({ kind: "gear", down: Boolean(down) });
  }

  say(text) {
    return this.send({ kind: "say", text: String(text) });
  }
}

export class Framebuffer {
  constructor(path = "/dev/fb0", width = 512, height = 512) {
    this.path = path;
    this.width = width;
    this.height = height;
    this.fd = fs.openSync(path, "r+");
    this.buf = Buffer.alloc(width * height * 4);
  }

  clear(r = 4, g = 33, b = 44) {
    for (let i = 0; i < this.buf.length; i += 4) {
      this.buf[i] = b;
      this.buf[i + 1] = g;
      this.buf[i + 2] = r;
      this.buf[i + 3] = 255;
    }
  }

  pixel(x, y, r, g, b) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.buf[i] = b;
    this.buf[i + 1] = g;
    this.buf[i + 2] = r;
    this.buf[i + 3] = 255;
  }

  flush() {
    fs.writeSync(this.fd, this.buf, 0, this.buf.length, 0);
  }

  close() {
    if (this.fd >= 0) fs.closeSync(this.fd);
    this.fd = -1;
  }
}
