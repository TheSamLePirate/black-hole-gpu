# Black Hole GPU — Embedded Linux OBC (`/home/pilot`)

You are running **inside the live Linux On-Board Computer (OBC)** embedded in the **Black Hole GPU** WebGPU flight & space simulator (Unkernel Linux 7.x `aarch64` Web Worker).

You have **full real-time bidirectional control** over the entire simulator — every spacecraft (Ranger, Artemis, Gargantua, JWST/Lagrange), aircraft (F-35B/C, Airbus A320), airport & real ILS approach, radar, weapons, Captain MCDU, 3D cockpit screens, HUD, camera, weather, time warp, and all **73 TARS tools** — directly from this Linux shell.

## Read First — Documentation Map

| File | When to read it |
|---|---|
| `README.md` | Quick-start commands, installed tools, creating & running programs in `/home/pilot` |
| `docs/OBC-ARCHITECTURE.md` | `/obc/*` 9p files, `telemetry.json` exact schema, `/obc/cmd` protocol, `AF_VSOCK:4747`, 3D cockpits, SDKs |
| `docs/BH-API-GUIDE.md` | Full `window.__bh` API + 73 TARS tools via `bh` CLI & `/obc/rpc/<id>.req`, units, WGS84 datums, F-35/A320/Orbit recipes |
| `docs/TTY-AND-FB0.md` | Building TUIs (Ratatui / Python / Node) & `/dev/fb0` graphics (`FBIOGET_VSCREENINFO` + `mmap`, `TIOCGWINSZ=(0,0)` fix, 1:1 PFD math) |
| `docs/UNKERNEL-LINUX.md` | Unkernel `aarch64` specifics: Alpine vs Debian, Wisp networking, persistence, `/usr/lib/kw/bin` stubs, RAM/Cargo limits |

## Available Agent Skills (`.claude/skills/` · `.pi/skills/` · `.agents/skills/`)

Load the relevant `SKILL.md` before executing complex tasks:

- **`obc-build-fb-app`** — Build, compile, and verify a real-time 20–30 Hz `/dev/fb0` graphical avionics app (Rust `mmap`, Python, or Node.js) that renders on HUD + 3D cockpits.
- **`obc-build-tui-app`** — Build an interactive TUI (Rust Ratatui 0.29, Python, or Node.js) safe for Unkernel's `TIOCGWINSZ=(0,0)` serial console and `100×26` 3D cockpit mirror.
- **`obc-control-sim`** — Pilot any craft, configure autopilots, fly real ILS approaches, drive A320 MCDU/ECAM or F-35 radar/weapons/PCD, and invoke any of the 73 TARS tools.
- **`obc-manage-linux`** — Manage Alpine/Debian packages, `obc-install` toolchains, Wisp networking, persistent `/home/pilot` apps, memory budgets, and system diagnostics.
- **`obc-rust-dev`** — Write, build, clippy-check, and test native Rust + Ratatui + `/dev/fb0` binaries directly inside the OBC VM without hitting RAM limits.

## Non-Negotiable Technical Rules (Unkernel OBC)

1. **Zero assumptions on terminal size**: Unkernel's serial TTY returns `TIOCGWINSZ = (0, 0)`. Always fall back to **`100×26`** (matching the HUD xterm and 3D cockpit `TermBuffer(100, 26)`). In Ratatui, use `Viewport::Fixed(Rect::new(0, 0, cols, rows))` when `crossterm::terminal::size()` returns `< 40×12`.
2. **`/dev/fb0` (`kwfb`) is double-buffered**: `/sys/class/graphics/fb0/virtual_size` reports `512,1024`, NOT the active buffer size. Writing `virtual_size` bytes fails with `ENOSPC`. **Always** query active `xres × yres` via `ioctl(FBIOGET_VSCREENINFO = 0x4600)` (typically `512×512`) and render via zero-copy **`mmap(PROT_READ|PROT_WRITE, MAP_SHARED)`** in little-endian **XRGB8888** (`0xFFRRGGBB`).
3. **Never use `Atomics.wait` in Node.js**: `futex_wait` can stall on emulated `aarch64`. Use async timers or `/bin/sleep` fallback when synchronous waiting is unavoidable.
4. **Heights & angles**:
   - `/obc/telemetry.json` reports `heading_deg`, `pitch_deg`, `roll_deg` in **degrees**.
   - Direct `__bh.camera.attitudeNow()` returns `heading`, `pitch`, `bank` in **radians** (multiply by `180 / Math.PI`).
   - Always distinguish **WGS84 ellipsoid height** (`height_ellipsoid_m`), **MSL** (`altitude_msl_m`), and **AGL** (`height_over_ground_m`).
5. **9p `/obc/telemetry.json` padding**: Fixed 2048-byte space-padded JSON with atomic rename. Always `.trim()` before parsing and keep the last valid frame on transient read errors.
6. **Clean exit & keyboard discipline**: Every interactive TUI and `/dev/fb0` app MUST restore terminal raw mode on exit and quit cleanly on `q`, `Esc`, or `Ctrl+C` (closing `/dev/fb0` automatically hands the display back to the terminal).
7. **Persistence**: Put new user programs in `/home/pilot/` (or `$HOME/.local/bin/` for global commands) — `/home/pilot` persists across reboots on the IndexedDB `/data` disk, whereas `/obc/*` is a host 9p mount (read-only except `/obc/cmd`, `/obc/rpc/` and `/obc/rpc_req`).
8. **PATH & stubs**: `/usr/lib/kw/bin/` holds Unkernel lazy-install stubs. Always keep `/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin` **ahead** of `/usr/lib/kw/bin` (configured automatically in `/etc/profile.d/obc.sh`).

## Quick Sanity Check Commands

```sh
obc-diag                          # Distro, kernel, RAM, telemetry, dτ/dt, installed toolchains
obc-rs --version                  # Native compiled Rust + Ratatui + /dev/fb0 multi-call binary (12 apps)
cat /obc/telemetry.json           # Live 5 Hz JSON snapshot from the simulator
cat /dev/tau                      # Relativistic proper time dτ/dt & warp factor
bh ls                             # List all live window.__bh namespaces
bh tools                          # List all 73 live TARS simulator tools
```
