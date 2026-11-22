#!/usr/bin/env python3
"""
obc — Standard Avionics & Framebuffer library for Black Hole GPU Linux OBC.
Works out of the box with zero third-party pip packages (pure Python 3 stdlib).

Usage:
    import obc
    bus = obc.AvionicsBus()
    state = bus.read()
    print(bus.vessel_id, state.height_over_ground, state.true_airspeed)
    bus.set_throttle(0.75)
"""

from __future__ import annotations

import json
import math
import mmap
import os
import socket
import struct
import time
from typing import Any, Dict, Optional, Tuple

TELEMETRY_PATH = "/obc/telemetry.json"
TAU_PATH = "/obc/tau"
CMD_PATH = "/obc/cmd"
RPC_REQ_PATH = "/obc/rpc_req"
RPC_RES_PATH = "/obc/rpc_res"
VSOCK_HOST_CID = 2
VSOCK_PORT = 4747


class State:
    """Typed wrapper around an OBC telemetry frame from __bh."""

    def __init__(self, raw: Dict[str, Any]) -> None:
        self.raw = raw
        self.sim_time: float = float(raw.get("sim_time_s", 0.0))
        self.sim_dt: float = float(raw.get("sim_dt", 0.0))
        self.warp: float = float(raw.get("warp", 1.0))
        self.frozen: bool = bool(raw.get("frozen", False))
        self.dtau_dt: float = float(raw.get("dtau_dt", 1.0))
        self.proper_time: float = float(raw.get("proper_time_s", 0.0))
        self.vessel_id: str = str(raw.get("vessel_id", "unknown"))
        self.vessel_kind: str = str(raw.get("vessel_kind", "spacecraft"))
        self.body: str = str(raw.get("body", "earth"))

        pos = raw.get("position") or {}
        self.lat: float = float(pos.get("lat_deg", 0.0))
        self.lon: float = float(pos.get("lon_deg", 0.0))
        self.height_ellipsoid: float = float(pos.get("height_ellipsoid_m", 0.0))
        self.altitude_msl: float = float(pos.get("altitude_msl_m", 0.0))
        self.height_over_ground: float = float(pos.get("height_over_ground_m", 0.0))

        att = raw.get("attitude") or {}
        self.heading: float = float(att.get("heading_deg", 0.0))
        self.pitch: float = float(att.get("pitch_deg", 0.0))
        self.roll: float = float(att.get("roll_deg", 0.0))

        fl = raw.get("flight") or {}
        self.true_airspeed: float = float(fl.get("true_airspeed_mps", 0.0))
        self.ground_speed: float = float(fl.get("ground_speed_mps", 0.0))
        self.vertical_speed: float = float(fl.get("vertical_speed_mps", 0.0))
        self.mach: float = float(fl.get("mach", 0.0))
        self.dynamic_pressure: float = float(fl.get("dynamic_pressure_pa", 0.0))
        self.alpha: float = float(fl.get("alpha_deg", 0.0))
        self.beta: float = float(fl.get("beta_deg", 0.0))
        self.g_load: float = float(fl.get("g_load", 1.0))
        self.stalled: bool = bool(fl.get("stalled", False))
        self.on_ground: bool = bool(fl.get("on_ground", False))
        self.hull_temp_k: float = float(fl.get("hull_temp_k", 288.0))

        self.orbit: Optional[Dict[str, Any]] = raw.get("orbit")
        self.systems: Dict[str, Any] = raw.get("systems") or {}
        self.nav: Dict[str, Any] = raw.get("nav") or {}


class AvionicsBus:
    """Bidirectional bus connected to the simulator's __bh bridge via AF_VSOCK or 9p /obc."""

    def __init__(self, prefer_vsock: bool = True) -> None:
        self._sock: Optional[socket.socket] = None
        self._file = None
        self._last: Optional[State] = None
        if prefer_vsock:
            self._connect_vsock()

    def _connect_vsock(self) -> None:
        af = getattr(socket, "AF_VSOCK", 40)
        try:
            s = socket.socket(af, socket.SOCK_STREAM)
            s.settimeout(1.5)
            s.connect((VSOCK_HOST_CID, VSOCK_PORT))
            self._sock = s
            self._file = s.makefile("rwb", buffering=0)
        except OSError:
            self._sock = None
            self._file = None

    def _rpc(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if self._file is None:
            return None
        try:
            self._file.write((json.dumps(payload) + "\n").encode("utf-8"))
            line = self._file.readline()
            if not line:
                self.close()
                return None
            return json.loads(line.decode("utf-8"))
        except OSError:
            self.close()
            return None

    def read(self) -> State:
        resp = self._rpc({"op": "read"})
        if resp and isinstance(resp.get("telemetry"), dict):
            self._last = State(resp["telemetry"])
            return self._last
        with open(TELEMETRY_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
        self._last = State(raw)
        return self._last

    @property
    def vessel_id(self) -> str:
        return (self._last or self.read()).vessel_id

    @property
    def sim_dt(self) -> float:
        st = self._last or self.read()
        return max(0.02, st.sim_dt) if not st.frozen else 0.1

    def tau(self) -> Dict[str, str]:
        out: Dict[str, str] = {}
        try:
            with open(TAU_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    if "=" in line:
                        k, v = line.strip().split("=", 1)
                        out[k] = v
        except OSError:
            pass
        return out

    def wait_tick(self, poll_s: float = 0.05) -> State:
        """Wait until simulation time advances (respects __bh.freeze and warp)."""
        prev = self._last.sim_time if self._last else self.read().sim_time
        while True:
            st = self.read()
            if not st.frozen and st.sim_time != prev:
                return st
            time.sleep(poll_s)

    def send(self, command: Dict[str, Any]) -> Dict[str, Any]:
        resp = self._rpc({"op": "cmd", "cmd": command})
        if resp is not None:
            return resp
        with open(CMD_PATH, "w", encoding="utf-8") as f:
            f.write(json.dumps(command) + "\n")
        return {"ok": True, "msg": "sent via /obc/cmd"}

    def set_throttle(self, value: float) -> Dict[str, Any]:
        return self.send({"kind": "throttle", "value": max(0.0, min(1.0, float(value)))})

    def set_stick(
        self,
        pitch: Optional[float] = None,
        roll: Optional[float] = None,
        yaw: Optional[float] = None,
        duration_ms: int = 200,
    ) -> Dict[str, Any]:
        cmd: Dict[str, Any] = {"kind": "stick", "duration_ms": int(duration_ms)}
        if pitch is not None:
            cmd["pitch"] = max(-1.0, min(1.0, float(pitch)))
        if roll is not None:
            cmd["roll"] = max(-1.0, min(1.0, float(roll)))
        if yaw is not None:
            cmd["yaw"] = max(-1.0, min(1.0, float(yaw)))
        return self.send(cmd)

    def set_autopilot(self, mode: str) -> Dict[str, Any]:
        return self.send({"kind": "autopilot", "mode": str(mode)})

    def set_hold(self, mode: str) -> Dict[str, Any]:
        return self.send({"kind": "hold", "mode": str(mode)})

    def set_sas(self, on: bool) -> Dict[str, Any]:
        return self.send({"kind": "sas", "on": bool(on)})

    def set_gear(self, down: bool) -> Dict[str, Any]:
        return self.send({"kind": "gear", "down": bool(down)})

    def set_flaps(self, value: float) -> Dict[str, Any]:
        return self.send({"kind": "flaps", "value": max(0.0, min(1.0, float(value)))})

    def say(self, text: str) -> Dict[str, Any]:
        return self.send({"kind": "say", "text": str(text)})

    def bh_rpc(self, payload: Dict[str, Any], timeout_s: float = 10.0) -> Dict[str, Any]:
        """Universal RPC to the full simulator window.__bh API & all 73 TARS tools."""
        req_id = f"{int(time.time() * 1000)}-{os.getpid()}-{int(time.monotonic() * 1e6) % 99999}"
        body = dict(payload)
        body["id"] = req_id
        resp = self._rpc(body)
        if resp is not None:
            return resp
        with open(RPC_REQ_PATH, "w", encoding="utf-8") as f:
            f.write(json.dumps(body) + "\n")
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                with open(RPC_RES_PATH, "r", encoding="utf-8") as f:
                    parsed = json.load(f)
                if isinstance(parsed, dict) and parsed.get("id") == req_id:
                    return parsed
            except (OSError, json.JSONDecodeError):
                pass
            time.sleep(0.01)
        return {"id": req_id, "ok": False, "error": "RPC timeout"}

    def bh_ls(self, path: str = "") -> Dict[str, Any]:
        return self.bh_rpc({"op": "ls", "path": path})

    def bh_get(self, path: str, depth: int = 3) -> Dict[str, Any]:
        return self.bh_rpc({"op": "get", "path": path, "depth": depth})

    def bh_set(self, path: str, value: Any, refresh: bool = True) -> Dict[str, Any]:
        return self.bh_rpc({"op": "set", "path": path, "value": value, "refresh": refresh})

    def bh_call(self, path: str, *args: Any) -> Dict[str, Any]:
        return self.bh_rpc({"op": "call", "path": path, "args": list(args)})

    def bh_tools(self) -> Dict[str, Any]:
        return self.bh_rpc({"op": "tools"})

    def bh_tool(self, name: str, **kwargs: Any) -> Dict[str, Any]:
        return self.bh_rpc({"op": "tool", "name": name, "toolArgs": kwargs})

    def bh_search(self, query: str) -> Dict[str, Any]:
        return self.bh_rpc({"op": "search", "query": query})

    def bh_eval(self, expr: str) -> Dict[str, Any]:
        return self.bh_rpc({"op": "eval", "expr": expr})

    def bh_mcdu(self, action: str, **kwargs: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"op": "mcdu", "action": action}
        payload.update(kwargs)
        return self.bh_rpc(payload)

    def close(self) -> None:
        if self._file is not None:
            try:
                self._file.close()
            except OSError:
                pass
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._file = None
        self._sock = None


# Minimal 5x7 uppercase/digit bitmap font for zero-dependency /dev/fb0 cockpit graphics
_FONT5X7: Dict[str, Tuple[int, ...]] = {
    " ": (0, 0, 0, 0, 0, 0, 0),
    ".": (0, 0, 0, 0, 0, 0, 4),
    ":": (0, 4, 0, 0, 0, 4, 0),
    "-": (0, 0, 0, 14, 0, 0, 0),
    "+": (0, 4, 4, 31, 4, 4, 0),
    "/": (1, 2, 2, 4, 8, 8, 16),
    "%": (25, 26, 2, 4, 8, 11, 19),
    "0": (14, 17, 19, 21, 25, 17, 14),
    "1": (4, 12, 4, 4, 4, 4, 14),
    "2": (14, 17, 1, 2, 4, 8, 31),
    "3": (14, 17, 1, 6, 1, 17, 14),
    "4": (2, 6, 10, 18, 31, 2, 2),
    "5": (31, 16, 30, 1, 1, 17, 14),
    "6": (6, 8, 16, 30, 17, 17, 14),
    "7": (31, 1, 2, 4, 8, 8, 8),
    "8": (14, 17, 17, 14, 17, 17, 14),
    "9": (14, 17, 17, 15, 1, 2, 12),
    "A": (14, 17, 17, 31, 17, 17, 17),
    "B": (30, 17, 17, 30, 17, 17, 30),
    "C": (14, 17, 16, 16, 16, 17, 14),
    "D": (28, 18, 17, 17, 17, 18, 28),
    "E": (31, 16, 16, 30, 16, 16, 31),
    "F": (31, 16, 16, 30, 16, 16, 16),
    "G": (14, 17, 16, 23, 17, 17, 15),
    "H": (17, 17, 17, 31, 17, 17, 17),
    "I": (14, 4, 4, 4, 4, 4, 14),
    "J": (7, 2, 2, 2, 2, 18, 12),
    "K": (17, 18, 20, 24, 20, 18, 17),
    "L": (16, 16, 16, 16, 16, 16, 31),
    "M": (17, 27, 21, 21, 17, 17, 17),
    "N": (17, 25, 21, 19, 17, 17, 17),
    "O": (14, 17, 17, 17, 17, 17, 14),
    "P": (30, 17, 17, 30, 16, 16, 16),
    "Q": (14, 17, 17, 17, 21, 18, 13),
    "R": (30, 17, 17, 30, 20, 18, 17),
    "S": (15, 16, 16, 14, 1, 1, 30),
    "T": (31, 4, 4, 4, 4, 4, 4),
    "U": (17, 17, 17, 17, 17, 17, 14),
    "V": (17, 17, 17, 17, 17, 10, 4),
    "W": (17, 17, 17, 21, 21, 27, 17),
    "X": (17, 17, 10, 4, 10, 17, 17),
    "Y": (17, 17, 10, 4, 4, 4, 4),
    "Z": (31, 1, 2, 4, 8, 16, 31),
}


class Framebuffer:
    """Direct 32-bpp XRGB8888 renderer for Unkernel's /dev/fb0 (kwfb)."""

    def __init__(self, path: str = "/dev/fb0", width: int = 512, height: int = 512) -> None:
        self.path = path
        self.width = width
        self.height = height
        self.stride = width * 4
        self.size = self.stride * height
        self._fd = os.open(path, os.O_RDWR)
        self._buf = bytearray(self.size)
        try:
            self._mm: Optional[mmap.mmap] = mmap.mmap(self._fd, self.size, mmap.MAP_SHARED, mmap.PROT_WRITE | mmap.PROT_READ)
        except OSError:
            self._mm = None

    @staticmethod
    def color(r: int, g: int, b: int) -> bytes:
        # XRGB8888 little-endian: B, G, R, 0xFF
        return bytes((b & 255, g & 255, r & 255, 255))

    def clear(self, r: int = 4, g: int = 33, b: int = 44) -> None:
        px = self.color(r, g, b)
        self._buf[:] = px * (self.width * self.height)

    def pixel(self, x: int, y: int, px: bytes) -> None:
        if 0 <= x < self.width and 0 <= y < self.height:
            i = (y * self.width + x) * 4
            self._buf[i : i + 4] = px

    def rect(self, x: int, y: int, w: int, h: int, px: bytes) -> None:
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(self.width, x + w)
        y1 = min(self.height, y + h)
        if x0 >= x1 or y0 >= y1:
            return
        row = px * (x1 - x0)
        for yy in range(y0, y1):
            off = (yy * self.width + x0) * 4
            self._buf[off : off + len(row)] = row

    def line(self, x0: int, y0: int, x1: int, y1: int, px: bytes) -> None:
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.pixel(x0, y0, px)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def circle(self, cx: int, cy: int, radius: int, px: bytes, steps: int = 96) -> None:
        prev = None
        for i in range(steps + 1):
            a = (2.0 * math.pi * i) / steps
            pt = (int(round(cx + radius * math.cos(a))), int(round(cy + radius * math.sin(a))))
            if prev is not None:
                self.line(prev[0], prev[1], pt[0], pt[1], px)
            prev = pt

    def filled_circle(self, cx: int, cy: int, radius: int, px: bytes) -> None:
        r2 = radius * radius
        for dy in range(-radius, radius + 1):
            span = int(math.sqrt(max(0, r2 - dy * dy)))
            self.rect(cx - span, cy + dy, span * 2 + 1, 1, px)

    def ellipse(self, cx: int, cy: int, rx: int, ry: int, px: bytes, steps: int = 128) -> None:
        prev = None
        for i in range(steps + 1):
            a = (2.0 * math.pi * i) / steps
            pt = (int(round(cx + rx * math.cos(a))), int(round(cy + ry * math.sin(a))))
            if prev is not None:
                self.line(prev[0], prev[1], pt[0], pt[1], px)
            prev = pt

    def bar_gauge(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        frac: float,
        fill_px: bytes,
        bg_px: bytes,
        border_px: bytes,
    ) -> None:
        self.rect(x, y, w, h, bg_px)
        f = max(0.0, min(1.0, float(frac)))
        fw = int(round((w - 4) * f))
        if fw > 0:
            self.rect(x + 2, y + 2, fw, max(1, h - 4), fill_px)
        self.rect(x, y, w, 1, border_px)
        self.rect(x, y + h - 1, w, 1, border_px)
        self.rect(x, y, 1, h, border_px)
        self.rect(x + w - 1, y, 1, h, border_px)

    def sparkline(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        values: list,
        line_px: bytes,
        bg_px: bytes,
        border_px: bytes,
    ) -> None:
        self.rect(x, y, w, h, bg_px)
        self.rect(x, y, w, 1, border_px)
        self.rect(x, y + h - 1, w, 1, border_px)
        if len(values) < 2:
            return
        lo = min(values)
        hi = max(values)
        span = hi - lo if hi > lo else 1.0
        prev = None
        n = len(values) - 1
        for i, v in enumerate(values):
            px = x + 4 + int(round((w - 8) * (i / n)))
            py = y + h - 4 - int(round((h - 8) * ((v - lo) / span)))
            if prev is not None:
                self.line(prev[0], prev[1], px, py, line_px)
            prev = (px, py)

    def hline(self, x0: int, x1: int, y: int, px: bytes) -> None:
        if y < 0 or y >= self.height:
            return
        a = max(0, min(x0, x1))
        b = min(self.width, max(x0, x1) + 1)
        if a >= b:
            return
        off = (y * self.width + a) * 4
        self._buf[off : off + (b - a) * 4] = px * (b - a)

    def vline(self, x: int, y0: int, y1: int, px: bytes) -> None:
        if x < 0 or x >= self.width:
            return
        a = max(0, min(y0, y1))
        b = min(self.height, max(y0, y1) + 1)
        for yy in range(a, b):
            off = (yy * self.width + x) * 4
            self._buf[off : off + 4] = px

    def stroke_rect(self, x: int, y: int, w: int, h: int, px: bytes) -> None:
        self.rect(x, y, w, 1, px)
        self.rect(x, y + h - 1, w, 1, px)
        self.rect(x, y, 1, h, px)
        self.rect(x + w - 1, y, 1, h, px)

    def crosshair(self, cx: int, cy: int, size: int, px: bytes, gap: int = 4) -> None:
        self.hline(cx - size, cx - gap, cy, px)
        self.hline(cx + gap, cx + size, cy, px)
        self.vline(cx, cy - size, cy - gap, px)
        self.vline(cx, cy + gap, cy + size, px)

    def text(self, x: int, y: int, s: str, px: bytes, scale: int = 2) -> None:
        cx = x
        for ch in s.upper():
            glyph = _FONT5X7.get(ch, _FONT5X7[" "])
            for ry, bits in enumerate(glyph):
                for rx in range(5):
                    if bits & (1 << (4 - rx)):
                        self.rect(cx + rx * scale, y + ry * scale, scale, scale, px)
            cx += 6 * scale

    def flush(self) -> None:
        if self._mm is not None:
            self._mm.seek(0)
            self._mm.write(self._buf)
        else:
            os.lseek(self._fd, 0, os.SEEK_SET)
            os.write(self._fd, self._buf)

    def close(self) -> None:
        if self._mm is not None:
            self._mm.close()
            self._mm = None
        if self._fd >= 0:
            os.close(self._fd)
            self._fd = -1

    def __enter__(self) -> "Framebuffer":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()
