---
name: obc-build-fb-app
description: Build, optimize, and verify a real-time 20-30 Hz /dev/fb0 graphical avionics app (Rust, Python, or Node.js) that renders on the HUD console and 3D cockpits (Ranger MFD, F-35 PCD, A320 Lower ECAM).
---

# Skill: Build a Real-Time `/dev/fb0` Graphical App

Use this skill whenever asked to create or enhance a graphical instrument, radar, map, HUD, oscilloscope, or visualizer on `/dev/fb0`.

## Prerequisites
- Read `docs/TTY-AND-FB0.md` and `docs/OBC-ARCHITECTURE.md` before coding.
- Choose the best implementation language for the task:
  - **Rust** (`obc-install rust`): Best for 25–30 Hz complex instruments, raymarching, anti-aliased graphics, zero-GC predictability.
  - **Python** (`obc-install python`, `/obc/lib/obc.py`): Fastest prototyping with built-in `obc.Framebuffer`, `obc.AvionicsBus`, and `obc.RawKeys`.
  - **Node.js / Bun** (`obc-install node`, `/obc/lib/obc.mjs`): Fast `Uint32Array` rendering + seamless JSON RPC to `__bh`.

## Mandatory Design Rules
1. **Query exact active resolution** via `ioctl(fd, 0x4600 /* FBIOGET_VSCREENINFO */)` (typically `512×512`). **NEVER** read `/sys/class/graphics/fb0/virtual_size` (returns double-buffered `512,1024` and causes `ENOSPC`).
2. **Use `mmap(PROT_READ | PROT_WRITE, MAP_SHARED)`** of exact `xres * yres * 4` bytes and pack little-endian **XRGB8888** (`0xFF00_0000 | (r << 16) | (g << 8) | b`).
3. **Zero per-frame allocations**: Pre-allocate the pixel backbuffer once before the loop; clear with `.fill()`, draw primitives/text into the backbuffer, then copy to `mmap` in one shot (`flush()`).
4. **Live telemetry + optional `__bh` RPC**: Read `/obc/telemetry.json` each frame (`.trim()`, keep previous frame on transient error). Throttle slower `__bh` RPC calls (e.g. traffic/radar tracks) to 1–2 Hz so `/dev/fb0` stays locked at 20–30 Hz.
5. **CLI flags & clean exit**:
   - Support `--seconds <N>` for automated/timed runs.
   - Use non-blocking POSIX raw keyboard polling (`STDIN_FILENO`, RAII restore on exit).
   - Exit cleanly on `q`, `Esc`, or `Ctrl+C`, unmapping & closing `/dev/fb0` so the HUD/cockpit cleanly returns to TTY mode.
   - Display a compact bottom legend with live FPS and hotkeys (e.g. `[+-] Zoom [q] Quit`).

## Step-by-Step Workflow
1. Create your project directory under `/home/pilot/<app-name>/`.
2. Implement the renderer + telemetry loop + raw key handler.
3. Make the entrypoint executable (`chmod +x`) and symlink into `$HOME/.local/bin/<app-name>`.
4. **Verify**:
   - Run `<app-name> --seconds 1.5` and assert exit code `0` with zero stderr / zero `ENOSPC`.
   - Optionally route onto a 3D cockpit display (`obc-f35 pcd 0 OBC`, `obc-a320 ecam obcPage`, or `bh call cockpitScreens.setPage '[2, "obc"]'`) while running to inspect live rendering.
   - Verify terminal echo/cursor are cleanly restored after exit.
